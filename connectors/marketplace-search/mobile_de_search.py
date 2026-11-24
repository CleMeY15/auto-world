"""Read one page of used cars using the official mobile.de Search API (new XML)."""
import argparse
import base64
import hashlib
import json
import os
import re
import sys
from collections import Counter
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from xml.etree import ElementTree as ET

from private_rows import write_rows

ENDPOINT = "https://services.mobile.de/search-api/search"
SANDBOX_ENDPOINT = "https://services.sandbox.mobile.de/search-api/search"
ACCEPT = "application/vnd.de.mobile.api+xml"
BYTE_LIMIT = 8_000_000


class SearchError(ValueError):
    """A safe, user-visible error without response bodies or credentials."""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def search_url(limit=10, country="DE", *, sandbox=False):
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 100:
        raise SearchError("page size must be in the range 1..100")
    if not isinstance(country, str) or not re.fullmatch("[A-Z]{2}", country):
        raise SearchError("country must be a two-letter uppercase country code")
    params = {"classification": "refdata/classes/Car", "condition": "USED",
              "country": country, "page.number": 1, "page.size": limit}
    return (SANDBOX_ENDPOINT if sandbox else ENDPOINT) + "?" + urlencode(params)


def source_text(ad, field):
    value = ad.findtext(field)
    return value.strip() if value and value.strip() else None


def integer(value):
    if value and re.fullmatch(r"[0-9]{1,15}", value):
        return int(value)
    return None


def gross_price(value):
    if not value or not re.fullmatch(r"[0-9]{1,15}(?:\.[0-9]{1,2})?", value):
        return None
    try:
        amount = Decimal(value)
        if amount > 0:
            return format(amount, ".2f")
    except InvalidOperation:
        pass
    return None


def listing_url(value, ad_id):
    """Accept only a publisher detail URL whose public identity matches the XML ad."""
    if not value or not ad_id or any(c.isspace() or ord(c) < 32 for c in value):
        return None
    try:
        url = urlsplit(value)
        host = url.hostname or ""
        if (url.scheme != "https" or not (host == "mobile.de" or host.endswith(".mobile.de"))
                or url.username or url.password or url.port not in (443, None) or "\\" in value):
            return None
        if url.path == "/fahrzeuge/details.html":
            return value if parse_qs(url.query, keep_blank_values=True).get("id") == [ad_id] else None
        match = re.fullmatch(r"/auto-inserat/[^/]+/([0-9]+)\.html", url.path)
        return value if match and match[1] == ad_id else None
    except ValueError:
        return None


def listing(ad):
    registration = source_text(ad, "firstRegistration") or ""
    year = int(registration[:4]) if re.fullmatch(r"(?:18|19|20)[0-9]{2}(?:0[1-9]|1[0-2])", registration) else None
    if year is not None and not 1886 <= year <= date.today().year + 1:
        year = None
    currency = source_text(ad, "price/currency") or ""
    ad_id = source_text(ad, "mobileAdId")
    return {"source": "mobile.de", "source_id": ad_id,
            "source_url": listing_url(source_text(ad, "detailPageUrl"), ad_id),
            "title": source_text(ad, "modelDescription"),
            "price": gross_price(source_text(ad, "price/consumerPriceGross")),
            "currency": currency if re.fullmatch(r"[A-Z]{3}", currency) else None,
            "year": year, "mileage_km": integer(source_text(ad, "mileage"))}


def parse_search_xml(data):
    if (not isinstance(data, bytes) or len(data) > BYTE_LIMIT or b'\x00' in data
            or b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper()):
        raise SearchError("unusable or oversized XML document")
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise SearchError("invalid XML search data") from exc
    if root.tag != "searchResult" or root.find("ads") is None:
        raise SearchError("expected a new-XML searchResult with ads")
    ads = root.findall("ads/ad")
    counts = Counter()
    by_id = {}
    conflicts = set()
    missing = Counter()
    for ad in ads:
        row = listing(ad)
        key = row["source_id"]
        if not key:
            counts["no_id"] += 1
            missing["source_id"] += 1
            continue
        if key in by_id:
            counts["repeated_ids"] += 1
            if by_id[key] != row:
                conflicts.add(key)
        else:
            by_id[key] = row
    complete = []
    for key, row in by_id.items():
        if key in conflicts:
            continue
        missing_fields = [name for name, value in row.items() if value is None]
        if missing_fields:
            counts["incomplete_ids"] += 1
            missing.update(missing_fields)
        else:
            complete.append(row)
    return {"rows": complete, "observed": len(ads), "distinct_ids": len(by_id),
            "no_id": counts["no_id"], "repeated_ids": counts["repeated_ids"],
            "conflicting_ids": len(conflicts), "incomplete_ids": counts["incomplete_ids"],
            "complete": len(complete), "missing_fields": dict(missing),
            "total_reported": integer(source_text(root, "total")),
            "current_page": integer(source_text(root, "currentPage"))}


def fetch_search(username, password, *, limit=10, country="DE", sandbox=False, opener=None):
    url = search_url(limit, country, sandbox=sandbox)
    if not username or not password or ":" in username:
        raise SearchError("mobile.de Search API account credentials are required")
    authorization = base64.b64encode(f"{username}:{password}".encode()).decode("ascii")
    request = Request(url, headers={"User-Agent": "AutoFindex/1.0 (official Search API)",
                                    "Accept": ACCEPT, "Authorization": "Basic " + authorization})
    client = opener if opener is not None else build_opener(NoRedirect())
    try:
        with client.open(request, timeout=25) as response:
            if response.status != 200:
                raise SearchError(f"mobile.de search returned HTTP {response.status}")
            if response.headers.get_content_type() not in {ACCEPT, "application/xml", "text/xml"}:
                raise SearchError("unexpected search response media type")
            data = response.read(BYTE_LIMIT + 1)
    except HTTPError as exc:
        code = exc.code
        exc.close()
        raise SearchError(f"mobile.de search returned HTTP {code}") from None
    except (OSError, URLError) as exc:
        raise SearchError("mobile.de search transport failed") from exc
    result = parse_search_xml(data)
    if result["observed"] > limit or result["current_page"] != 1:
        raise SearchError("received a different page or more ads than requested")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    input_group = parser.add_mutually_exclusive_group()
    input_group.add_argument("--xml", type=Path, help="Read a saved official XML search page.")
    parser.add_argument("--limit", type=int, default=10)
    input_group.add_argument("--sandbox", action="store_true", help="Query the official sandbox with its own credentials.")
    parser.add_argument("--country", default="DE", help="Seller country as an ISO alpha-2 code.")
    parser.add_argument("--documentation-example", action="store_true",
                        help="Mark the saved XML as an example supplied in mobile.de documentation.")
    parser.add_argument("--output", type=Path, help="Write accepted rows to a new private JSON file.")
    args = parser.parse_args()
    if args.documentation_example and not args.xml:
        parser.error("--documentation-example requires --xml")
    try:
        if args.xml:
            with args.xml.open("rb") as stream:
                result = parse_search_xml(stream.read(BYTE_LIMIT + 1))
        else:
            prefix = "MOBILE_DE_SANDBOX_" if args.sandbox else "MOBILE_DE_API_"
            result = fetch_search(os.getenv(prefix + "USERNAME"), os.getenv(prefix + "PASSWORD"),
                                  limit=args.limit, country=args.country, sandbox=args.sandbox)
        rows = result.pop("rows")
        data = json.dumps(sorted(rows, key=lambda row: row["source_id"]), ensure_ascii=False,
                          sort_keys=True, separators=(",", ":")).encode("utf-8")
        mode = "saved_xml" if args.xml else ("sandbox_api" if args.sandbox else "live_api")
        if args.documentation_example:
            mode = "documentation_xml_example"
        if args.output:
            write_rows(args.output, "mobile.de", mode, rows)
        result.update(mode=mode, rows_sha256=hashlib.sha256(data).hexdigest())
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (SearchError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
