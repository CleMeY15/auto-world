"""Attribute archived Le Parking records using the publisher label on the matching card."""
import argparse
import hashlib
import json
import os
import re
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from lxml import html
from verify_saved_parking_xpath import has_class, listing_href, normalized, verify

AUTO_SCOUT_DOMAINS = frozenset("autoscout24." + ending for ending in ("de", "fr", "be", "nl", "lu", "ch", "at", "it", "es", "eu", "com"))
TARGETS = AUTO_SCOUT_DOMAINS | {"mobile.de"}
OWNER = 'ancestor::li[' + has_class("li-result") + '][1]'


def matched_card(panel, expected, origin_id, url):
    titles = panel.xpath('.//a[' + has_class("tag_f_titre") + ']')
    if len(titles) != 1:
        return False
    key = listing_href(url, titles[0].get("href"))
    if not key or key[0] != origin_id or normalized(" ".join(titles[0].itertext())) != expected["title"]:
        return False
    prices = set()
    for p in panel.xpath('.//p[' + has_class("prix") + ']'):
        found = re.fullmatch(r"([0-9 ]+) €", normalized(p.text_content()))
        if found:
            prices.add(int(found[1].replace(" ", "")))
    if prices != {expected["price_eur"]}:
        return False
    for specs in panel.xpath('.//ul[' + has_class("info") + ']'):
        vals = [normalized(x.text_content()) for x in specs.xpath("./li")]
        if len(vals) >= 3 and vals[2] == str(expected["year"]):
            distance = re.fullmatch(r"([0-9 ]+) Km", vals[1], re.I)
            if distance and int(distance[1].replace(" ", "")) == expected["mileage_km"]:
                return True
    return False


def page_matches(data, url, selected, native_href_ids=None):
    doc = html.document_fromstring(data.decode("utf-8-sig"))
    panels = defaultdict(list)
    for panel in doc.xpath('//*[@id="resultats"]//div[' + has_class("right-result-bloc") + ']'):
        owner = panel.xpath(OWNER)
        if owner:
            panels[owner[0]].append(panel)
    native_owners = set()
    if native_href_ids is not None:
        for a in doc.xpath('//*[@id="resultats"]//a[@href]'):
            try:
                parsed = urlsplit(urljoin(url, a.get("href")))
            except ValueError:
                continue
            host = parsed.hostname or ""
            if parsed.scheme in {"http", "https"} and any(host == domain or host.endswith("." + domain) for domain in TARGETS):
                owner = a.xpath(OWNER)
                if owner:
                    native_owners.add(owner[0])
    for mark in doc.xpath('//*[@id="resultats"]//*[' + has_class("site-bottom") + ']//a[@href]'):
        domain = normalized(mark.text_content()).lower()
        if domain not in TARGETS:
            continue
        link = listing_href(url, mark.get("href"))
        owner = mark.xpath(OWNER)
        if not link or not owner or link[0] not in selected:
            continue
        own_panels = panels[owner[0]]
        if len(own_panels) == 1 and matched_card(own_panels[0], selected[link[0]], link[0], url):
            if native_href_ids is not None and owner[0] in native_owners:
                native_href_ids.add(link[0])
            yield link[0], domain


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True, type=Path)
    parser.add_argument("--seed-receipt", type=Path)
    parser.add_argument("--input-sha256", required=True, help="Expected hash of the previously imported private batch.")
    parser.add_argument("--expected", type=int, default=2000)
    parser.add_argument("--private-map", type=Path, help="Optional, new private file for a PostgreSQL read-only join.")
    args = parser.parse_args()
    os.umask(0o077)
    receipt = json.loads((args.run / "receipt.json").read_text())
    pilot = json.loads(args.seed_receipt.read_text()) if args.seed_receipt else None
    source_validation = verify(args.run, args.expected, pilot)
    if not source_validation["all_verified"]:
        raise ValueError("the original batch failed independent source validation")
    batch = (args.run / receipt["private_output"]).read_bytes()
    digest = hashlib.sha256(batch).hexdigest()
    if digest != args.input_sha256:
        raise ValueError("wrong input file for this database batch")
    selected = {r["source_id"]: r for r in json.loads(batch)["rows"]}
    evidence = defaultdict(set)
    observations = Counter()
    native_href_ids = set()
    for item in receipt["requests"]:
        if item["status"] == "results":
            raw = (args.run / "pages" / item["file"]).read_bytes()
            if hashlib.sha256(raw).hexdigest() != item["sha256"]:
                raise ValueError("archived page changed since validation")
            for token, domain in page_matches(raw, item["url"], selected, native_href_ids):
                evidence[token].add(domain)
                observations[domain] += 1
    by_id = {token: sorted(labels) for token, labels in sorted(evidence.items())}
    groups = {"mobile.de": sorted(k for k, v in evidence.items() if "mobile.de" in v),
              "AutoScout24": sorted(k for k, v in evidence.items() if v & AUTO_SCOUT_DOMAINS)}
    mapping = dict(source="leparking", scope=f"prior-authorized-{args.expected}", by_source_id=by_id, publishers=groups)
    stats = dict(batch_rows=len(selected), batch_sha256=digest, source_pages=source_validation["source_page_digests_verified"],
                 publisher_counts={g: len(ids) for g, ids in groups.items()}, union=len(evidence),
                 publisher_overlap=len(set(groups["mobile.de"]) & set(groups["AutoScout24"])),
                 distinct_by_domain=dict(sorted(Counter(x for doms in evidence.values() for x in doms).items())),
                 observations_by_domain=dict(sorted(observations.items())),
                 with_a_visible_target_publisher_domain_href_in_own_card=len(native_href_ids),
                 origin_label_link_is_leparking_for_all_matches=True)
    if args.private_map:
        args.private_map.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with args.private_map.open("x", encoding="utf8") as f:
            json.dump(mapping, f, sort_keys=True, separators=(",", ":"))
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
