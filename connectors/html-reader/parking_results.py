"""Read archived French Le Parking results locally, retaining the displayed publisher labels.

Vehicle fields and Le Parking URL validation reuse the project's leparking_html reader.
A label must be visible in the same li-result as a complete matching vehicle panel.
Source and source_id always identify Le Parking. No source-site requests are made.
"""
from collections import Counter, defaultdict
import re
from urllib.parse import urlsplit

from leparking_html import CardReader, DETAIL_PATH, FIELDS, VOID, listing_link, parse_html


MAX_PAGE_BYTES = 8_000_000
DOMAIN = re.compile(r"(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}")
AUTOSCOUT = {"autoscout24." + country for country in
             ("fr", "de", "be", "nl", "lu", "ch", "at", "it", "es", "eu", "com", "pl")}


def platform(domain):
    return "AutoScout24" if domain in AUTOSCOUT else domain


class LabelReader(CardReader):
    """Associate site-bottom labels and complete raw field observations with their nearest owner."""
    def __init__(self):
        super().__init__()
        self.owners = []
        self.frames = []

    def handle_starttag(self, tag, attrs):
        previous = self.card
        super().handle_starttag(tag, attrs)
        attrs = dict(attrs)
        classes = (attrs.get("class") or "").split()
        _, owner, hidden, mark, anchor = self.frames[-1] if self.frames else (None, None, False, False, None)
        hidden = (hidden or tag in {"script", "style", "template", "noscript"} or "hidden" in attrs
                  or (attrs.get("aria-hidden") or "").casefold() == "true")
        if not hidden and self.in_results:
            if tag == "li" and "li-result" in classes:
                owner = {"panels": [], "labels": []}
                self.owners.append(owner)
                mark, anchor = False, None
            if owner is not None:
                if self.card is not previous and self.card is not None:
                    owner["panels"].append(self.card)
                mark = mark or "site-bottom" in classes
                if mark and tag == "a":
                    anchor = (attrs.get("href") or "", [])
                    owner["labels"].append(anchor)
        if tag not in VOID:
            self.frames.append((tag, owner, hidden, mark, anchor))

    def handle_data(self, value):
        super().handle_data(value)
        if self.frames:
            _, _, hidden, _, anchor = self.frames[-1]
            if not hidden and anchor is not None:
                anchor[1].append(value)

    def handle_endtag(self, tag):
        super().handle_endtag(tag)
        if tag not in VOID:
            for i in range(len(self.frames) - 1, -1, -1):
                if self.frames[i][0] == tag:
                    del self.frames[i:]
                    break


def input_text(body):
    if not isinstance(body, (bytes, str)) or len(body) > MAX_PAGE_BYTES:
        raise ValueError("Expected one local HTML page up to 8 MB.")
    if isinstance(body, bytes):
        body = body.decode("utf-8-sig")
    if "\x00" in body or len(body.encode("utf-8")) > MAX_PAGE_BYTES:
        raise ValueError("Expected UTF-8 HTML up to 8 MB.")
    return body


def origin_mark(href):
    # Premium cards may use the label-specific L redirect. Its ID can tie the
    # origin label to a card, but neither it nor the title redirect is a detail URL.
    link = listing_link(href)
    if link:
        return link
    match = re.fullmatch(r"(?:https://(?:www\.)?leparking\.fr)?/tools/([A-Z0-9]{8})/[0-9]+/L/P\.html", href)
    return ("leparking:" + match[1], None) if match else None


def parse_results(body):
    """Parse one saved page and return normalized rows, diagnostics and field evidence."""
    text = input_text(body)
    base = parse_html(text)
    labels = LabelReader()
    labels.feed(text)
    labels.close()
    eligible = {r["key"]: r for r in base["cards"] if r["complete"]}
    closed_panels = {id(raw) for raw in labels.rows}
    origins = defaultdict(set)
    detail_links = defaultdict(set)
    invalid_labels = 0
    for owner in labels.owners:
        if len(owner["panels"]) != 1:
            continue
        raw = owner["panels"][0]
        if id(raw) not in closed_panels:
            continue
        ids = {k for k, _ in raw["links"]}
        if len(ids) != 1:
            continue
        key = next(iter(ids))
        expected = eligible.get(key)
        if not expected or any(raw[f] != {expected[f]} for f in FIELDS):
            continue
        for href, chunks in owner["labels"]:
            target = origin_mark(href)
            domain = " ".join("".join(chunks).split()).casefold().removeprefix("www.")
            if not target or target[0] != key or not DOMAIN.fullmatch(domain):
                invalid_labels += 1
                continue
            origins[key].add(domain)
            if target[1] and DETAIL_PATH.fullmatch(urlsplit(target[1]).path):
                detail_links[key].add(target[1])

    rows = []
    no_detail = 0
    for key, card in eligible.items():
        urls = detail_links[key].copy()
        if DETAIL_PATH.fullmatch(urlsplit(card["url"]).path):
            urls.add(card["url"])
        if not urls:
            no_detail += 1
            continue
        domains = sorted(origins[key])
        rows.append({"source": "leparking.fr", "source_id": card["source_id"], "source_url": min(urls),
                     "title": card["title"], "price": f'{card["price_eur"]}.00', "currency": "EUR",
                     "year": card["year"], "mileage_km": card["mileage_km"],
                     "origin_domains": domains, "origin_platforms": sorted({platform(d) for d in domains})})
    return {"status": base["status"], "rows": rows, "observations": base["observations"],
            "incomplete": sum(not row["complete"] for row in base["cards"]),
            "unidentified_or_ambiguous": base["unidentified_or_ambiguous"],
            "tracking_only": no_detail, "invalid_label_observations": invalid_labels,
            "duplicates": base["duplicates"], "conflict_ids": base["conflict_ids"],
            "observed_values": base["observed_values"]}


def merge_results(pages):
    """Merge local pages by Le Parking ID. Exclude conflicting field evidence, including partial cards."""
    rows = {}
    conflicts = set()
    evidence = defaultdict(lambda: defaultdict(set))
    counts = Counter()
    for page in pages:
        counts["pages"] += 1
        counts["pages_" + page["status"]] += 1
        for name in ("observations", "incomplete", "unidentified_or_ambiguous", "tracking_only", "invalid_label_observations", "duplicates"):
            counts[name] += page[name]
        conflicts.update(page["conflict_ids"])
        for key, fields in page["observed_values"].items():
            for field, values in fields.items():
                evidence[key][field].update(values)
                if len(evidence[key][field]) > 1:
                    conflicts.add(key)
        for row in page["rows"]:
            key = row["source_id"]
            previous = rows.get(key)
            if previous is None:
                rows[key] = dict(row)
            else:
                previous["source_url"] = min(previous["source_url"], row["source_url"])
                previous["origin_domains"] = sorted(set(previous["origin_domains"]) | set(row["origin_domains"]))
                previous["origin_platforms"] = sorted({platform(d) for d in previous["origin_domains"]})
    merged = [rows[key] for key in sorted(rows.keys() - conflicts)]
    by_domain = Counter(d for row in merged for d in row["origin_domains"])
    mobile = {r["source_id"] for r in merged if "mobile.de" in r["origin_platforms"]}
    scout = {r["source_id"] for r in merged if "AutoScout24" in r["origin_platforms"]}
    label = sum(bool(row["origin_domains"]) for row in merged)
    summary = {**counts, "distinct_observed_ids": len(evidence), "distinct_conflicting_ids": len(conflicts),
               "complete_distinct_with_detail_url": len(merged), "with_origin_label": label,
               "without_origin_label": len(merged)-label, "mobile_de": len(mobile), "autoscout24": len(scout),
               "both_platforms": len(mobile & scout), "either_platform": len(mobile | scout),
               "only_other_origin": label-len(mobile | scout), "counts_by_domain": dict(sorted(by_domain.items()))}
    return {"rows": merged, "summary": summary, "conflict_ids": sorted(conflicts)}
