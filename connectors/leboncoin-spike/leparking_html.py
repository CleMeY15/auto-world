"""Read vehicle cards from a local Le Parking HTML results page, without networking."""

import re
from datetime import date
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

from leparking_page import EMPTY


BASE_URL = "https://www.leparking.fr/"
DETAIL_PATH = re.compile(r"/voiture-occasion-detail/(?:[^/?#\\]+/)+([A-Z0-9]{8})\.html")
REDIRECT_PATH = re.compile(r"/tools/([A-Z0-9]{8})/[0-9]+/[DT]/P\.html")
INTEGER = r"(?:[0-9]{1,3}(?: [0-9]{3}){1,2}|[0-9]{1,9})"
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link",
        "meta", "param", "source", "track", "wbr"}
FIELDS = ("title", "price_eur", "year", "mileage_km")


def listing_link(raw):
    if not raw or "\\" in raw or any(char.isspace() or ord(char) < 32 for char in raw):
        return None
    try:
        url = urljoin(BASE_URL, raw)
        parts = urlsplit(url)
    except ValueError:
        return None
    if parts.scheme != "https" or parts.netloc.lower() not in {"www.leparking.fr", "leparking.fr"}:
        return None
    if parts.query or parts.fragment:
        return None
    match = DETAIL_PATH.fullmatch(parts.path) or REDIRECT_PATH.fullmatch(parts.path)
    return ("leparking:" + match.group(1), url) if match else None


class CardReader(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.card = None
        self.rows = []
        self.canonical = {}
        self.in_results = False
        self.empty_message = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        # Record hidden subtrees even when their parent is outside #resultats.
        # This also prevents a hidden container from opening a results scope.
        hidden = (tag in {"script", "style", "template", "noscript"} or "hidden" in attrs
                  or (attrs.get("aria-hidden") or "").casefold() == "true"
                  or (self.stack and self.stack[-1][1] == "hidden"))
        if hidden:
            if tag not in VOID:
                self.stack.append((tag, "hidden", [], None))
            return
        classes = set((attrs.get("class") or "").split())
        role = None
        href = None
        if attrs.get("id") == "resultats":
            self.in_results = True
            role = "results"
        if self.in_results and tag == "a" and attrs.get("href"):
            observed = listing_link(attrs["href"])
            if observed and DETAIL_PATH.fullmatch(urlsplit(observed[1]).path):
                self.canonical.setdefault(observed[0], set()).add(observed[1])
        if self.in_results and tag == "div" and "right-result-bloc" in classes:
            # An interrupted card cannot supply fields to the next one.
            if self.card is not None:
                while self.stack and self.stack[-1][1] != "card":
                    self.stack.pop()
                if self.stack:
                    self.stack.pop()
            self.card = {"links": [], **{field: set() for field in FIELDS}}
            role = "card"
        elif self.card is not None:
            if tag == "a" and ("tag_f_titre" in classes or "btn-plus" in classes):
                role = "title" if "tag_f_titre" in classes else "detail"
                href = attrs.get("href")
            elif tag == "p" and "prix" in classes:
                role = "price"
            elif tag == "ul" and "info" in classes:
                role = "specs"
            elif tag == "li":
                spec_list = next((frame for frame in reversed(self.stack) if frame[1] == "specs"), None)
                if spec_list is not None:
                    # The native list is fuel, km, model year, gearbox and postal code.
                    # Postal codes in some countries also have four digits.
                    role = "year_spec" if len(spec_list[2]) == 2 else "spec"
                    spec_list[2].append("")
        if self.in_results and self.card is None and role is None and tag in {"p", "li", "h1", "h2", "h3", "div"}:
            role = "message"
        if tag not in VOID and (self.card is not None or role == "results" or self.stack):
            self.stack.append((tag, role, [], href))

    def handle_data(self, data):
        if self.stack and self.stack[-1][1] == "hidden":
            return
        if self.in_results and self.card is None:
            # Inline elements can split one message, e.g. <p>Aucune <b>annonce</b>.</p>.
            for _, role, chunks, _ in reversed(self.stack):
                if role in {"message", "results"}:
                    chunks.append(data)
                    break
            return
        if self.card is not None:
            for _, role, chunks, _ in self.stack:
                if role in {"title", "detail", "price", "spec", "year_spec"}:
                    chunks.append(data)

    def handle_endtag(self, tag):
        for pos in range(len(self.stack) - 1, -1, -1):
            if self.stack[pos][0] != tag:
                continue
            frames = self.stack[pos:]
            del self.stack[pos:]
            for _, role, chunks, href in reversed(frames):
                if role in {"message", "results"} and EMPTY.fullmatch(" ".join("".join(chunks).split())):
                    self.empty_message = True
                if role == "results":
                    self.in_results = False
                if self.card is None:
                    continue
                value = " ".join(" ".join(chunks).split())
                if role == "card":
                    self.rows.append(self.card)
                    self.card = None
                elif role in {"title", "detail"}:
                    link = listing_link(href)
                    if link and (role == "title" or value.casefold() == "détail"):
                        self.card["links"].append(link)
                    if role == "title" and link and value:
                        self.card["title"].add(value)
                elif role == "price" and re.fullmatch(INTEGER + r" €", value):
                    euros = int(value[:-2].replace(" ", ""))
                    if euros > 0:
                        self.card["price_eur"].add(euros)
                elif role in {"spec", "year_spec"}:
                    if re.fullmatch(INTEGER + r" km", value, re.IGNORECASE):
                        self.card["mileage_km"].add(int(value[:-3].replace(" ", "")))
                    elif (role == "year_spec" and re.fullmatch(r"[0-9]{4}", value)
                          and 1886 <= int(value) <= date.today().year + 1):
                        self.card["year"].add(int(value))
            return


def parse_html(body):
    reader = CardReader()
    reader.feed(body)
    reader.close()
    grouped = {}
    ambiguous = set()
    rejected = 0
    for raw in reader.rows:
        keys = {key for key, _ in raw["links"]}
        if len(keys) != 1:
            ambiguous.update(keys)
            rejected += 1
            continue
        grouped.setdefault(keys.pop(), []).append(raw)

    cards = []
    evidence = {}
    conflicts = 0
    for key, occurrences in grouped.items():
        source_id = key.split(":", 1)[1]
        values = {field: sorted(set().union(*(raw[field] for raw in occurrences)))
                  for field in FIELDS}
        evidence[source_id] = values
        field_conflicts = sum(len(observed) > 1 for observed in values.values())
        if field_conflicts:
            conflicts += field_conflicts
            ambiguous.add(key)
        if key in ambiguous:
            continue
        # Use just one observed card for all fields, even when a second copy
        # has complementary values. Never invent a complete observation.
        raw = max(occurrences, key=lambda r: sum(bool(r[name]) for name in FIELDS))
        urls = {url for _, url in raw["links"]}
        canon = reader.canonical.get(key, set())
        if len(canon) == 1:
            urls.update(canon)
        url = min(urls, key=lambda value: ("/voiture-occasion-detail/" not in value,
                                            "/D/" not in value, value))
        fields = {name: next(iter(raw[name]), None) for name in FIELDS}
        cards.append({"key": key, "source_id": key.split(":", 1)[1], "url": url, **fields,
                      "complete": all(v is not None for v in fields.values())})
    if grouped:
        status = "results"
    elif reader.empty_message and not reader.rows:
        status = "empty_results"
    else:
        status = "unrecognized"
    return {"status": status, "cards": cards, "observed_values": evidence,
            "conflict_ids": sorted(key.split(":", 1)[1] for key in ambiguous),
            "observations": len(reader.rows),
            "duplicates": sum(len(rr) - 1 for rr in grouped.values()),
            "complete": sum(card["complete"] for card in cards),
            "unidentified_or_ambiguous": rejected, "conflicting_fields": conflicts}
