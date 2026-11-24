"""Read the vehicle actually described by an individual Le Parking HTML page."""
import json
import re
from urllib.parse import urlsplit, urlunsplit

from own_fetch import looks_gated
from custom_detail import (BAD_SCREEN, MAX_BYTES, DetailError, DetailHTML, compact,
                           kilometers, one, parse_amount, structured, year_of)

DETAIL = re.compile(r"/voiture-occasion-detail/(?:[^/?#%\\]+/)+([A-Z0-9]{8})\.html")


def parking_identity(url):
    try:
        if not isinstance(url, str) or re.search(r"[\s\\\x00-\x1f]", url):
            raise ValueError
        parts = urlsplit(url)
        match = DETAIL.fullmatch(parts.path)
        if (parts.scheme != "https" or parts.netloc not in {"leparking.fr", "www.leparking.fr"} or
                not match or parts.query or parts.fragment or any(p in {".", ".."} for p in parts.path.split("/"))):
            raise ValueError
        return "leparking.fr", match[1], urlunsplit(("https", "www.leparking.fr", parts.path, "", ""))
    except (TypeError, ValueError):
        raise DetailError("unsupported_url", "Expected an individual Le Parking HTTPS URL.") from None


def parse_parking(content, source_url=None):
    if not isinstance(content, (bytes, str)) or not content or len(content) > MAX_BYTES:
        raise DetailError("invalid_input", "Expected a saved HTML detail document up to 8 MB.")
    if isinstance(content, bytes):
        try:
            content = content.decode("utf-8-sig")
        except UnicodeError:
            raise DetailError("invalid_input", "Expected UTF-8 HTML.") from None
    if len(content.encode("utf-8")) > MAX_BYTES or "\x00" in content:
        raise DetailError("invalid_input", "Invalid or oversized UTF-8 HTML.")
    if looks_gated(content.encode("utf-8")):
        raise DetailError("blocked_or_unavailable", "Verification or consent screen.")
    parser = DetailHTML()
    parser.feed(content)
    parser.close()
    if BAD_SCREEN.search(" ".join(parser.titles + parser.headings[:1])):
        raise DetailError("blocked_or_unavailable", "Access or availability notice.")
    docs = []
    for script in parser.scripts:
        try:
            # Le Parking uses literal line breaks inside some quoted display names.
            docs.append(json.loads(script, strict=False))
        except (ValueError, RecursionError):
            continue
    cars, _, is_list = structured(docs)
    if is_list or len(cars) != 1:
        raise DetailError("not_single_vehicle", "Expected one vehicle and its own advertised offer.")
    car = cars[0]
    offer = car.get("offers")
    if not isinstance(offer, dict) or str(offer.get("@type", "")).lower() != "offer":
        raise DetailError("incomplete", "The vehicle's advertised offer is missing.")
    availability = str(offer.get("availability", "")).lower().rstrip("/").rsplit("/", 1)[-1]
    if availability in {"soldout", "outofstock", "discontinued"}:
        raise DetailError("blocked_or_unavailable", "The advertised offer is marked unavailable.")
    urls = [*parser.urls, car.get("url"), offer.get("url")]
    if source_url is not None:
        urls.insert(0, source_url)
    identities = [parking_identity(u) for u in urls if u]
    identity = one(identities, "identity")
    if not identity:
        raise DetailError("missing_url", "The listing identifier is missing.")
    name = car.get("name")
    odo = car.get("mileageFromOdometer")
    amount = parse_amount(offer.get("price"), structured_price=True)
    unit = compact(offer.get("priceCurrency")).upper()
    mileage = None
    if isinstance(odo, dict) and compact(odo.get("unitCode")).upper() in {"KM", "KMT"}:
        mileage = kilometers(odo.get("value"))
    year = year_of(car.get("productionDate"))
    if (not isinstance(name, str) or not compact(name) or amount is None or
            not re.fullmatch("[A-Z]{3}", unit) or mileage is None or year is None):
        raise DetailError("incomplete", "Missing vehicle name, advertised price/currency, year or km.")
    source, source_id, url = identity
    return dict(source=source, source_id=source_id, source_url=url, title=compact(name), price=amount,
                currency=unit, year=year, mileage_km=mileage)
