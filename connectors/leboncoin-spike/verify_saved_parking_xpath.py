"""Independently verify a saved Le Parking HTML collection with lxml and no network.

Compare each selected ID, title, year, EUR price and kilometre reading on a single
vehicle card. Check that its exact listing locator occurs on the same page for
the same ID. Output only aggregate evidence and a PostgreSQL COPY-compatible
UTF-8 CSV SHA-256 for source_id,title,year,price,mileage ordered by source_id.
"""
import argparse
from collections import defaultdict
import csv
import hashlib
import io
import json
from pathlib import Path
import re
import sys
from urllib.parse import urljoin, urlsplit

from lxml import html


def has_class(token):
    return f'contains(concat(" ",normalize-space(@class)," "), " {token} ")'


def normalized(text):
    return " ".join(text.split())


def listing_href(base, href):
    if not href or "\\" in href or any(char.isspace() or ord(char) < 32 for char in href):
        return None
    try:
        url = urljoin(base, href)
        parts = urlsplit(url)
    except ValueError:
        return None
    if (parts.scheme != "https" or parts.netloc.lower() not in {"www.leparking.fr", "leparking.fr"}
            or parts.query or parts.fragment):
        return None
    match = re.fullmatch(r"/tools/([A-Z0-9]{8})/[0-9]+/[TD]/P\.html", parts.path)
    if match is None:
        match = re.fullmatch(r"/voiture-occasion-detail/(?:[^/?#]+/)+([A-Z0-9]{8})\.html", parts.path)
    return (match[1], url) if match else None


def page_cards(data, source_url):
    dom = html.document_fromstring(data.decode("utf-8-sig"))
    page_links = defaultdict(set)
    for href in dom.xpath("//a[@href]/@href"):
        link = listing_href(source_url, href)
        if link:
            key, url = link
            page_links[key].add(url)
    panels = dom.xpath('//*[@id="resultats"]//div[' + has_class("right-result-bloc") + ']')
    for panel in panels:
        titles = panel.xpath('.//a[' + has_class("tag_f_titre") + ']')
        if len(titles) != 1:
            continue
        title = normalized(" ".join(titles[0].itertext()))
        identifiers = [titles[0], *panel.xpath('.//a[' + has_class("btn-plus") + ']')]
        keys = {link[0] for anchor in identifiers if (link := listing_href(source_url, anchor.get("href")))}
        prices = set()
        for node in panel.xpath('.//p[' + has_class("prix") + ']'):
            match = re.fullmatch(r"([0-9 ]+) €", normalized(node.text_content()))
            if match:
                prices.add(int(match[1].replace(" ", "")))
        if len(keys) != 1 or len(prices) != 1 or not title:
            continue
        key = next(iter(keys))
        price = next(iter(prices))
        card_urls = {link[1] for href in panel.xpath(".//a[@href]/@href")
                     if (link := listing_href(source_url, href)) and link[0] == key}
        for item_list in panel.xpath('.//ul[' + has_class("info") + ']'):
            specs = [normalized(item.text_content()) for item in item_list.xpath("./li")]
            if len(specs) < 3:
                continue
            km = re.fullmatch(r"([0-9 ]+) Km", specs[1], flags=re.I)
            if km and re.fullmatch(r"[0-9]{4}", specs[2]):
                yield key, (title, int(specs[2]), price, int(km[1].replace(" ", ""))), card_urls, page_links[key]


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def verify(run, expected, seed_receipt=None):
    if not 1 <= expected <= 100000:
        raise ValueError("expected must be between 1 and 100000")
    receipt = json.loads((run / "receipt.json").read_text(encoding="utf8"))
    filename = receipt["private_output"]
    if filename not in {"parking-input-2000.json", "parking-input-partial.json"}:
        raise ValueError("unexpected local collector output name")
    report = json.loads((run / filename).read_text(encoding="utf8"))
    rows = report["rows"]
    if (report["format"] != "leparking-html" or report["complete_unique"] != expected
            or receipt["selected"] != expected or len(rows) != expected):
        raise ValueError("collected format or count differs from expected")
    if expected == 2000 and not (receipt["goal_met"] and receipt["goal"] == 2000 and filename == "parking-input-2000.json"):
        raise ValueError("missing completed 2000-record receipt")
    witnesses = defaultdict(list)
    pages = 0
    for item in receipt["requests"]:
        if item["status"] != "results":
            continue
        if item["file"] != f"page-{item['ordinal']:03}.html":
            raise ValueError("unexpected saved source filename")
        source_url = item["url"]
        parsed = urlsplit(source_url)
        if parsed.scheme != "https" or parsed.netloc.lower() not in {"www.leparking.fr", "leparking.fr"}:
            raise ValueError("unexpected source page host or scheme")
        data = (run / "pages" / item["file"]).read_bytes()
        if sha256(data) != item["sha256"]:
            raise ValueError("saved source digest mismatch")
        if item["source"] == "seed":
            if seed_receipt is None:
                raise ValueError("a separate seed HTTP receipt is required for the seeded page")
            if not (seed_receipt["status"] == 200 and seed_receipt["url"] == source_url
                    and seed_receipt["digest"] == item["sha256"]):
                raise ValueError("seed HTTP receipt does not match saved source")
        elif item["source"] != "http" or item["http"] != 200:
            raise ValueError("missing successful HTTP response evidence")
        for key, fields, card_urls, page_urls in page_cards(data, source_url):
            witnesses[key].append((fields, card_urls, page_urls))
        pages += 1

    seen = set()
    same_card_fields = 0
    same_page_href = 0
    direct_card_href = 0
    output = io.StringIO(newline="")
    csv_writer = csv.writer(output, lineterminator="\n")
    for row in sorted(rows, key=lambda entry: entry["source_id"]):
        key = row["source_id"]
        if row["source"] != "leparking" or not re.fullmatch(r"[A-Z0-9]{8}", key) or key in seen:
            raise ValueError("unexpected source or duplicate/invalid source ID")
        seen.add(key)
        fields = (row["title"], row["year"], row["price_eur"], row["mileage_km"])
        exact = [observation for observation in witnesses[key] if observation[0] == fields]
        if not exact:
            continue
        same_card_fields += 1
        url = row["source_url"]
        matched = [entry for entry in exact if url in entry[2]]
        if not matched:
            continue
        same_page_href += 1
        direct_card_href += int(any(url in entry[1] for entry in matched))
        title, year, price, mileage = matched[0][0]
        csv_writer.writerow([key, title, year, price, mileage])
    verified = same_page_href == expected
    data = output.getvalue().encode("utf-8")
    return dict(records=len(seen), source_page_digests_verified=pages,
                id_and_four_fields_same_card=same_card_fields, exact_same_id_href_on_observation_page=same_page_href,
                href_within_the_matching_card=direct_card_href, href_elsewhere_on_observation_page_only=same_page_href-direct_card_href,
                all_verified=verified, projected_csv_columns=["source_id","title","year","price","mileage"],
                projected_csv_bytes=len(data) if verified else None, projected_csv_sha256=sha256(data) if verified else None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--expected", type=int, default=2000)
    parser.add_argument("--seed-receipt", type=Path, help="Prior HTTP receipt if a directly downloaded pilot page was reused")
    args = parser.parse_args()
    try:
        seed = json.loads(args.seed_receipt.read_text(encoding="utf8")) if args.seed_receipt else None
        result = verify(args.run, args.expected, seed)
    except (ValueError, KeyError, OSError, TypeError) as exc:
        # Omit contents and paths in the aggregate verification report.
        print(json.dumps({"all_verified": False, "error_type": type(exc).__name__}), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return int(not result["all_verified"])


if __name__ == "__main__":
    raise SystemExit(main())
