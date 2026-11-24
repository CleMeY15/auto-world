"""Validate a complete local vehicle snapshot, commit it in PostgreSQL, then read it back.

The fixed aw_marketplace_trial schema is separate from the project catalogue.
Its rows are immutable per provenance, source and source ID. A changed value
for the same key rejects the whole trial batch. No marketplace HTTP is made.
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

from leparking_html import listing_link

KAGGLE = "kaggle-uk-used-cars"
KAGGLE_DATASET = "https://www.kaggle.com/datasets/adityadesai13/used-car-dataset-ford-and-mercedes"
TABLE = "aw_marketplace_trial.listings"
COLUMNS = "source, source_id, source_locator, title, price, currency, year, mileage, distance_unit"
RECORD_TYPE = ("source text, source_id text, source_locator text, title text, price bigint, "
               "currency text, year integer, mileage bigint, distance_unit text")
ROW_FIELDS = tuple(COLUMNS.split(", "))


def integer(value, lower, upper):
    return type(value) is int and lower <= value <= upper


def canonical_rows(report, provenance, expected):
    if not isinstance(report, dict) or not integer(expected, 1, 100_000):
        raise ValueError("invalid report or target")
    fmt = report.get("format")
    is_parking = fmt in ("leparking-md", "leparking-html")
    if is_parking:
        if provenance not in ("fixture", "authorized-export"):
            raise ValueError("invalid provenance for Le Parking report")
        source = "leparking"
    elif fmt == KAGGLE and provenance == "open-dataset":
        source = KAGGLE
    else:
        raise ValueError("unsupported report format or provenance")
    rows = report.get("rows")
    if not (isinstance(rows, list) and type(report.get("complete_unique")) is int
            and report["complete_unique"] == len(rows) == expected):
        raise ValueError("complete exported row count must equal expected target")

    seen, valid = set(), []
    for pos, row in enumerate(rows, start=1):
        if not isinstance(row, dict) or row.get("source") != source:
            raise ValueError(f"wrong source at row {pos}")
        src_id = row.get("source_id")
        url = row.get("source_url")
        if not isinstance(src_id, str) or not isinstance(url, str) or len(url) > 8192:
            raise ValueError(f"invalid identity or URL at row {pos}")
        if is_parking:
            # Match the same public link shapes as the reader and preserve its observed URL.
            # listing_link also accepts relative hrefs on input to HTML; this output is absolute.
            link = listing_link(url)
            if not link or link != ("leparking:" + src_id, url) or urlsplit(url).scheme != "https":
                raise ValueError(f"URL does not identify the Le Parking row at {pos}")
            price, mileage = row.get("price_eur"), row.get("mileage_km")
            currency, unit = "EUR", "km"
        else:
            match = re.fullmatch(r"[A-Za-z0-9_-]+\.csv:([1-9][0-9]{0,9})", src_id)
            if not match or int(match[1]) < 2 or url != KAGGLE_DATASET:
                raise ValueError(f"invalid dataset row reference at {pos}")
            price, mileage = row.get("price_gbp"), row.get("mileage_miles")
            currency, unit = "GBP", "mi"
        title, year = row.get("title"), row.get("year")
        if not isinstance(title, str) or not title.strip() or len(title) > 2048:
            raise ValueError(f"invalid title at row {pos}")
        if any(ord(c) < 32 and c not in "\n\r\t" for c in title):
            raise ValueError(f"invalid title character at row {pos}")
        if not integer(price, 1, 2**63 - 1) or not integer(mileage, 0, 2**63 - 1):
            raise ValueError(f"invalid price or mileage at row {pos}")
        if not integer(year, 1886, date.today().year + 1):
            raise ValueError(f"invalid model year at row {pos}")
        if src_id in seen:
            raise ValueError(f"duplicate ID at row {pos}")
        seen.add(src_id)
        valid.append(dict(zip(ROW_FIELDS, (source, src_id, url, title, price, currency, year, mileage, unit))))
    return sorted(valid, key=lambda entry: entry["source_id"])


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")


def pg_json(value):
    # Only hexadecimal characters reach SQL syntax, including for quotes, newlines and backslashes.
    return f"convert_from(decode('{encode(value).hex()}','hex'),'UTF8')::jsonb"


def psql(database, sql):
    command = ["psql", "-X", "-qAt", "-w", "-v", "ON_ERROR_STOP=1", "--dbname", database]
    run = subprocess.run(command, input=sql, text=True, encoding="utf-8", capture_output=True, timeout=90)
    if run.returncode:
        # Do not leak row contents, role paths, credentials or a SQL error's input line.
        if "trial_existing_row_conflict" in run.stderr:
            raise ValueError("trial_existing_row_conflict: transaction aborted")
        if "trial_row_verification_failed" in run.stderr:
            raise ValueError("trial_row_verification_failed: transaction aborted")
        raise RuntimeError(f"psql returned {run.returncode}; no receipt for this stage")
    return run.stdout.strip()


def import_trial(database, provenance, rows):
    if not re.fullmatch(r"[a-zA-Z_][a-zA-Z_0-9]{0,62}", database):
        raise ValueError("expected a database name; supply connection settings through libpq")
    if provenance not in ("fixture", "authorized-export", "open-dataset") or not rows:
        raise ValueError("invalid trial provenance or empty rows")
    src = rows[0]["source"]
    if src not in ("leparking", KAGGLE) or any(r["source"] != src for r in rows):
        raise ValueError("invalid trial source")
    # Both substitutions below are from closed sets. The payload itself goes through pg_json.
    sql = f"""
BEGIN;
SET LOCAL search_path TO pg_catalog, pg_temp;
SET LOCAL client_min_messages TO warning;
SET LOCAL lock_timeout TO '30s';
SELECT pg_advisory_xact_lock(8736240190566);
CREATE SCHEMA IF NOT EXISTS aw_marketplace_trial;
CREATE TABLE IF NOT EXISTS {TABLE} (
    provenance text NOT NULL CHECK (provenance IN ('fixture','authorized-export','open-dataset')),
    source text NOT NULL, source_id text NOT NULL, source_locator text NOT NULL,
    title text NOT NULL, price bigint NOT NULL CHECK (price > 0), currency text NOT NULL,
    year integer NOT NULL CHECK (year >= 1886), mileage bigint NOT NULL CHECK (mileage >= 0),
    distance_unit text NOT NULL,
    CHECK ((source = 'leparking' AND provenance IN ('fixture','authorized-export') AND currency='EUR' AND distance_unit='km')
        OR (source='{KAGGLE}' AND provenance='open-dataset' AND currency='GBP' AND distance_unit='mi')),
    PRIMARY KEY(provenance,source,source_id)
);
CREATE TEMP TABLE trial_input ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset({pg_json(rows)}) AS records({RECORD_TYPE});
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_temp.trial_input i
        JOIN {TABLE} s USING (source,source_id)
        WHERE s.provenance='{provenance}' AND
          ((s.source_locator,s.title,s.price,s.currency,s.year,s.mileage,s.distance_unit)
           IS DISTINCT FROM (i.source_locator,i.title,i.price,i.currency,i.year,i.mileage,i.distance_unit))
    ) THEN RAISE EXCEPTION 'trial_existing_row_conflict'; END IF;
END $$;
WITH inserted AS (
  INSERT INTO {TABLE} (provenance,{COLUMNS})
  SELECT '{provenance}',{COLUMNS} FROM pg_temp.trial_input
  ON CONFLICT (provenance,source,source_id) DO NOTHING RETURNING 1
)
SELECT count(*) FROM inserted;
DO $$
BEGIN
    IF EXISTS (
        SELECT {COLUMNS} FROM pg_temp.trial_input
        EXCEPT SELECT {COLUMNS} FROM {TABLE} WHERE provenance='{provenance}' AND source='{src}'
    ) THEN RAISE EXCEPTION 'trial_row_verification_failed'; END IF;
END $$;
COMMIT;
"""
    inserted = int(psql(database, sql))
    ids = [r["source_id"] for r in rows]
    reread = f"""
SELECT json_agg(row_to_json(m) ORDER BY source_id COLLATE "C") FROM (
    SELECT {COLUMNS} FROM {TABLE}
    WHERE provenance='{provenance}' AND source='{src}'
      AND source_id IN (SELECT jsonb_array_elements_text({pg_json(ids)}))
) m;
"""
    try:
        # New psql process means an independent session after COMMIT.
        verified = json.loads(psql(database, reread))
        if rows != verified:
            raise ValueError("different field values or count")
    except (RuntimeError, ValueError, OSError, subprocess.TimeoutExpired) as err:
        raise RuntimeError("commit succeeded but independent readback was not verified") from err
    return dict(database=database, schema="aw_marketplace_trial", source=src, provenance=provenance,
                requested=len(rows), newly_inserted=inserted, already_present=len(rows)-inserted,
                verified_rows=len(verified), verified_fields=list(ROW_FIELDS),
                sha256=hashlib.sha256(encode(verified)).hexdigest(), separate_readback_connection=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--provenance", required=True, choices=("fixture", "authorized-export", "open-dataset"))
    parser.add_argument("--database", required=True)
    parser.add_argument("--expected", type=int, default=2000)
    args = parser.parse_args()
    try:
        report = json.loads(args.report.read_text(encoding="utf-8"))
        rows = canonical_rows(report, args.provenance, args.expected)
        receipt = import_trial(args.database, args.provenance, rows)
    except (ValueError, OSError, RuntimeError, subprocess.TimeoutExpired) as err:
        print(f"trial failed: {err}", file=sys.stderr)
        return 1
    print(json.dumps(receipt, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
