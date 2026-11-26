"""Authenticated AutoFindex site's internal PostgreSQL reader, served over a Unix socket."""
import json
import logging
import os
import re
import subprocess
from contextlib import closing
from datetime import timezone
from pathlib import Path
from urllib.parse import parse_qsl

import psycopg2
from psycopg2.extras import RealDictCursor


ROOT = Path(__file__).resolve().parents[2]
GRANT_CHECK = ROOT / "packages/source-registry/bin/catalog-publication-grant.mjs"
PROJECTION = ROOT / "connectors/leboncoin-spike/rust-export/catalog_page.sql"
VEHICLE_VOCABULARY = PROJECTION.with_name("vehicle_labels.json").read_text(encoding="utf-8")
VEHICLE_MODELS = json.loads(VEHICLE_VOCABULARY)
BRANDS = sorted(VEHICLE_MODELS)
MAX_SAFE_INTEGER = 9_007_199_254_740_991
BOUNDS = {
    "priceMin": (0, MAX_SAFE_INTEGER // 100), "priceMax": (0, MAX_SAFE_INTEGER // 100),
    "yearMin": (1886, 9999), "yearMax": (1886, 9999), "kmMax": (0, MAX_SAFE_INTEGER),
}
LIST_PARAMS = {"after", "limit", "q", "brand", *BOUNDS}
QUERY = PROJECTION.read_text(encoding="utf-8")
SERVICE = "af_rust_export_reader"
DATASET = "autoworld/leboncoin"
LIST = "/internal/catalog"
LISTING_ID = re.compile(r"[1-9][0-9]{0,19}")
LOG = logging.getLogger("autofind.private_catalog")


class CatalogUnavailable(Exception):
    pass


def publication_grant():
    registry = os.environ.get("AUTOFIND_SOURCE_REGISTRY", "")
    admission = "/etc/aw-private-web/catalog-admission.json"
    evidence = os.environ.get("AUTOFIND_CATALOG_EVIDENCE", "")
    if not all(Path(path).is_absolute() for path in (registry, evidence)):
        raise CatalogUnavailable("registry_unconfigured")
    try:
        result = subprocess.run(["node", str(GRANT_CHECK), registry, admission, evidence], capture_output=True,
                                stdin=subprocess.DEVNULL, timeout=2, check=True)
        grant = json.loads(result.stdout)
        return {"valid_from": grant["validFrom"], "valid_until": grant["validUntil"],
                "normalized_seconds": grant["normalizedSeconds"], "media_seconds": grant["mediaSeconds"],
                "dom_batch_ids": grant["domBatchIds"], "export_ids": grant["rustExportSha256"]}
    except (OSError, subprocess.SubprocessError, KeyError, TypeError, ValueError):
        raise CatalogUnavailable("publication_grant_unavailable") from None


def listing(row):
    listing_id = row["source_listing_id"]
    km = row["mileage_km"]
    year = row["year"]
    make = row["brand"] if isinstance(row["brand"], str) and row["brand"] in VEHICLE_MODELS else None
    model = row["model"] if make and row["model"] in VEHICLE_MODELS[make] else None
    return {
        "source_listing_id": listing_id,
        "source_url": "https://www.leboncoin.fr/ad/voitures/" + listing_id,
        "source_label": "Leboncoin",
        "observed_at": row["record_at"].astimezone(timezone.utc).isoformat(),
        "observed_at_kind": row["record_time_kind"],
        "brand": make,
        "model": model,
        "year": year if type(year) is int and 1886 <= year <= 9999 else None,
        "mileage_km": km if type(km) is int and 0 <= km <= MAX_SAFE_INTEGER else None,
        "price_amount_minor": row["price_amount_minor"],
        "price_currency": "EUR" if row["price_amount_minor"] is not None else None,
        "images": row["photo_references"],
    }


def filter_params(params):
    brand = params.get("brand", "")
    if brand and (len(brand) > 50 or not brand[0].isalnum()
                  or any(not c.isalnum() and c not in " .&-" for c in brand)):
        raise ValueError
    filters = {"brand": brand}
    for key, (minimum, maximum) in BOUNDS.items():
        raw = params.get(key, "")
        if not raw:
            filters[key] = None
            continue
        if not re.fullmatch(r"[0-9]{1,16}", raw) or not minimum <= int(raw) <= maximum:
            raise ValueError
        filters[key] = int(raw)
    for low, high in (("priceMin", "priceMax"), ("yearMin", "yearMax")):
        if filters[low] is not None and filters[high] is not None and filters[low] > filters[high]:
            raise ValueError
    return filters


def query_listings(grant, after, listing_id, count, search, filters):
    try:
        with closing(psycopg2.connect(service=SERVICE, connect_timeout=3,
                                      application_name="autofind-private-catalog")) as connection:
            connection.set_session(readonly=True, isolation_level="REPEATABLE READ")
            with connection, connection.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute("SET LOCAL search_path = pg_catalog")
                cursor.execute("SET LOCAL statement_timeout = '3500ms'")
                cursor.execute("SET LOCAL lock_timeout = '1s'")
                cursor.execute("SELECT current_database() AS database, current_user AS role")
                identity = cursor.fetchone()
                if identity["database"] != "autoworld" or identity["role"] != SERVICE:
                    raise CatalogUnavailable("unexpected_database_identity")
                cursor.execute(QUERY, {**grant, **filters, "after": after, "listing_id": listing_id, "page_size": count,
                                       "search": search, "vehicle_vocabulary": VEHICLE_VOCABULARY})
                return [listing(row) for row in cursor.fetchall()]
    except psycopg2.Error:
        raise CatalogUnavailable("postgres_unavailable") from None


def read(path, query):
    listing_id = ""
    after = ""
    limit = 20
    search = ""
    params = {}
    if path == LIST:
        try:
            pairs = parse_qsl(query, strict_parsing=True, max_num_fields=len(LIST_PARAMS), keep_blank_values=True)
            params = dict(pairs)
            if len(pairs) != len(params) or params.keys() - LIST_PARAMS:
                raise ValueError
            search = params.get("q", "")
            if len(search) > 80 or any(not c.isprintable() for c in search):
                raise ValueError
            search = search.strip()
            if "after" in params:
                after = params["after"]
                if not LISTING_ID.fullmatch(after):
                    raise ValueError
            if "limit" in params:
                if not re.fullmatch(r"(?:[1-9][0-9]?|100)", params["limit"]):
                    raise ValueError
                limit = int(params["limit"])
        except ValueError:
            return "400 Bad Request", {"error": "invalid_query"}
    elif path.startswith(LIST + "/") and LISTING_ID.fullmatch(path[len(LIST) + 1:]) and not query:
        listing_id = path[len(LIST) + 1:]
    else:
        return "404 Not Found", {"error": "not_found"}

    try:
        filters = filter_params(params)
    except ValueError:
        return "400 Bad Request", {"error": "invalid_query"}
    grant = publication_grant()
    rows = query_listings(grant, after, listing_id, 1 if listing_id else limit + 1, search, filters)
    if listing_id:
        return ("200 OK", rows[0]) if rows else ("404 Not Found", {"error": "not_found"})
    return "200 OK", {"dataset": DATASET, "items": rows[:limit], "brands": BRANDS,
                      "next_cursor": rows[limit - 1]["source_listing_id"] if len(rows) > limit else None}


def application(environ, start_response):
    if os.environ.get("AUTOFIND_PRIVATE_CATALOG") != "1":
        status, payload = "503 Service Unavailable", {"error": "catalog_unavailable"}
    elif (environ.get("HTTP_HOST") != "localhost"
          or any(key == "HTTP_FORWARDED" or key.startswith("HTTP_X_FORWARDED_") for key in environ)):
        status, payload = "403 Forbidden", {"error": "forbidden"}
    elif environ.get("REQUEST_METHOD") != "GET":
        status, payload = "405 Method Not Allowed", {"error": "method"}
    else:
        try:
            status, payload = read(environ.get("PATH_INFO", ""), environ.get("QUERY_STRING", ""))
        except CatalogUnavailable as exc:
            LOG.warning("%s", exc.args[0])
            status, payload = "503 Service Unavailable", {"error": "catalog_unavailable"}
    body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
    start_response(status, [("Content-Type", "application/json; charset=utf-8"),
                            ("Cache-Control", "private, no-store"), ("Content-Length", str(len(body))),
                            ("X-Content-Type-Options", "nosniff")])
    return [body]
