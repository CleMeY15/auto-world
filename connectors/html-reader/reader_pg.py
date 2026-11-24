"""Store complete HTML-reader observations in an explicitly selected local trial database.

Input is an array, or a reader report with observations and an empty errors array.
Each observation has provenance, document_sha256 (source document bytes) and row.
Provenance is supplied by the acquisition step.
Rows from different documents are append-only observations. The original currency is preserved.
"""
import argparse
from datetime import date
from decimal import Decimal
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from custom_detail import listing_identity
from parking_detail import parking_identity
from parking_results import DOMAIN, platform

CURRENCIES = ('EUR', 'CHF', 'GBP', 'USD')
PROVENANCES = ('direct-origin', 'archived', 'indexed', 'indirect', 'synthetic')
FIELDS = ('source', 'source_id', 'source_url', 'title', 'price', 'currency', 'year', 'mileage_km')
TABLE = 'aw_html_trial.observations'
KEYS = ('provenance', 'document_sha256', 'source', 'source_id')
SORT = ', '.join(f'{key} COLLATE "C"' for key in KEYS)
COLUMNS = 'provenance, document_sha256, source, source_id, source_url, title, price, currency, year, mileage_km, origin_domains, origin_platforms'
RECORD = 'provenance text, document_sha256 text, source text, source_id text, source_url text, title text, price numeric(18,2), currency text, year integer, mileage_km bigint, origin_domains text[], origin_platforms text[]'


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def integer(value, lower, upper):
    return type(value) is int and lower <= value <= upper


def labels(row):
    if not {'origin_domains', 'origin_platforms'} & row.keys():
        return {}
    if row['source'] != 'leparking.fr':
        raise ValueError('publisher labels belong to Le Parking observations')
    domains = row.get('origin_domains')
    if not isinstance(domains, list) or len(domains) > 128:
        raise ValueError('expected a list of publisher domains')
    clean_domains = set()
    for domain in domains:
        domain = domain.strip().lower().removeprefix('www.') if isinstance(domain, str) else ''
        if not DOMAIN.fullmatch(domain):
            raise ValueError('invalid publisher domain')
        clean_domains.add(domain)
    expected = {platform(d) for d in clean_domains}
    supplied = row.get('origin_platforms', sorted(expected))
    if not isinstance(supplied, list) or len(supplied) > 128 or not all(isinstance(s, str) for s in supplied):
        raise ValueError('expected a list of publisher platforms')
    if set(supplied) != expected:
        raise ValueError('publisher platforms must match the displayed domains')
    return {'origin_domains': sorted(clean_domains), 'origin_platforms': sorted(expected)}


def clean(item):
    row = item.get('row') if isinstance(item, dict) else None
    if not isinstance(row, dict) or item.get('provenance') not in PROVENANCES:
        raise ValueError('missing row or unknown observation provenance')
    digest = item.get('document_sha256')
    if not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest):
        raise ValueError('expected a SHA-256 digest of the source document')
    subset = {field: row.get(field) for field in FIELDS}
    for field, limit in (('source', 128), ('source_id', 256), ('title', 2048), ('source_url', 8192)):
        value = subset[field]
        if not isinstance(value, str) or not value.strip() or len(value) > limit or any(ord(c) < 32 for c in value):
            raise ValueError('invalid ' + field)
    identity = parking_identity if subset['source'] == 'leparking.fr' else listing_identity
    if identity(subset['source_url']) != (subset['source'], subset['source_id'], subset['source_url']):
        raise ValueError('source URL and native listing identity must match the reader output')
    if subset['currency'] not in CURRENCIES:
        raise ValueError('expected a stated currency in EUR, CHF, GBP or USD')
    if not integer(subset['year'], 1886, date.today().year + 1):
        raise ValueError('expected a complete vehicle year')
    if not integer(subset['mileage_km'], 0, 2**63 - 1):
        raise ValueError('expected nonnegative integer mileage in km')
    amount = subset['price']
    if not isinstance(amount, (str, int, float)) or not re.fullmatch(r'[0-9]{1,16}(\.[0-9]{1,2})?', str(amount)):
        raise ValueError('invalid price')
    value = Decimal(str(amount))
    if value <= 0:
        raise ValueError('expected a positive price')
    return dict(subset, price=format(value, '.2f'), provenance=item['provenance'], document_sha256=digest, **labels(row))


def psql(database, sql):
    # Disallow service strings and network destinations for this local trial.
    if not re.fullmatch(r'autofindex_trial_[a-z0-9_]{1,45}', database):
        raise ValueError('expected an explicitly named autofindex_trial_* database')
    if os.getenv('PGSERVICE') or os.getenv('PGSERVICEFILE'):
        raise ValueError('select a local database without a libpq service')
    for key in ('PGHOST', 'PGHOSTADDR'):
        host = os.getenv(key, '')
        if host and not (key == 'PGHOST' and (host.startswith('/') or host == 'localhost')):
            try:
                local_address = ipaddress.ip_address(host).is_loopback
            except ValueError:
                local_address = False
            if not local_address:
                raise ValueError('local PostgreSQL connection required')
    command = ['psql', '-X', '-w', '-qAt', '-v', 'ON_ERROR_STOP=1', '--dbname', database]
    run = subprocess.run(command, input=sql, text=True, encoding='utf-8', capture_output=True, timeout=90)
    if run.returncode:
        if 'html_observation_conflict' in run.stderr:
            raise ValueError('different fields for the same source document and listing; transaction rolled back')
        raise RuntimeError('PostgreSQL command failed; no verification receipt')
    return run.stdout.strip()


def import_observations(database, items):
    if isinstance(items, dict):
        if items.get('errors') != []:
            raise ValueError('a reader report must have an empty errors array before import')
        items = items.get('observations')
    if not isinstance(items, list) or not 1 <= len(items) <= 2000:
        raise ValueError('expected 1 to 2000 observations')
    distinct = {}
    for item in items:
        row = clean(item)
        key = tuple(row[name] for name in KEYS)
        if distinct.setdefault(key, row) != row:
            raise ValueError('different fields for one observation in input')
    rows = [distinct[key] for key in sorted(distinct)]
    # Only hex text representing validated JSON enters SQL. The payload stays on stdin.
    records = f"jsonb_to_recordset(convert_from(decode('{encode(rows).hex()}','hex'),'UTF8')::jsonb) AS p({RECORD})"
    currency_list = ','.join(f"'{currency}'" for currency in CURRENCIES)
    sql = f"""
    BEGIN;
    SET LOCAL search_path TO pg_catalog, pg_temp;
    SET LOCAL lock_timeout TO '15s';
    SET LOCAL client_min_messages TO warning;
    SELECT pg_advisory_xact_lock(8736240190581);
    CREATE SCHEMA IF NOT EXISTS aw_html_trial;
    CREATE TABLE IF NOT EXISTS {TABLE} (
        provenance text NOT NULL CHECK (provenance IN ('direct-origin','archived','indexed','indirect','synthetic')),
        document_sha256 text NOT NULL, source text NOT NULL, source_id text NOT NULL,
        source_url text NOT NULL, title text NOT NULL, price numeric(18,2) NOT NULL CHECK (price > 0),
        currency text NOT NULL CONSTRAINT html_supported_currency CHECK(currency IN ({currency_list})),
        year integer NOT NULL, mileage_km bigint NOT NULL,
        PRIMARY KEY(provenance,document_sha256,source,source_id));
    ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS origin_domains text[],
        ADD COLUMN IF NOT EXISTS origin_platforms text[];
    DO $$ BEGIN
        IF EXISTS (SELECT FROM pg_constraint WHERE conrelid='{TABLE}'::regclass
                   AND conname='observations_currency_check') THEN
            -- Upgrade the EUR-only constraint from the initial pilot.
            ALTER TABLE {TABLE} DROP CONSTRAINT observations_currency_check,
                ADD CONSTRAINT html_supported_currency CHECK (currency IN ({currency_list}));
        END IF;
    END $$;
    CREATE TEMP TABLE html_stage ON COMMIT DROP AS SELECT * FROM {records};
    WITH inserted AS (
        INSERT INTO {TABLE} ({COLUMNS}) SELECT {COLUMNS} FROM pg_temp.html_stage
        ON CONFLICT DO NOTHING RETURNING 1) SELECT count(*) FROM inserted;
    DO $$ BEGIN
        IF EXISTS (SELECT {COLUMNS} FROM pg_temp.html_stage EXCEPT SELECT {COLUMNS} FROM {TABLE})
        THEN RAISE EXCEPTION 'html_observation_conflict'; END IF;
    END $$;
    COMMIT;
    """
    inserted = int(psql(database, sql))
    reread = f"""SELECT json_agg(jsonb_strip_nulls(to_jsonb(v)) ORDER BY {SORT}) FROM (
        SELECT t.provenance, t.document_sha256, t.source, t.source_id, t.source_url, t.title,
               t.price::text AS price, t.currency, t.year, t.mileage_km, t.origin_domains, t.origin_platforms
        FROM {TABLE} t JOIN (SELECT * FROM {records}) i
        USING(provenance, document_sha256, source, source_id)) v;"""
    try:
        persisted = json.loads(psql(database, reread))
        if rows != persisted:
            raise ValueError('mismatch')
    except (OSError, RuntimeError, ValueError, subprocess.TimeoutExpired) as err:
        raise RuntimeError('commit succeeded but independent readback was not verified') from err
    return dict(database=database, table=TABLE, received=len(items), unique_observations=len(rows),
                inserted=inserted, already_stored=len(rows)-inserted, verified=len(persisted),
                provenance_counts={p: sum(r['provenance'] == p for r in rows) for p in PROVENANCES},
                readback_sha256=hashlib.sha256(encode(persisted)).hexdigest())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('--database', required=True)
    args = parser.parse_args()
    try:
        result = import_observations(args.database, json.loads(args.input.read_text(encoding='utf-8')))
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as err:
        print(f'HTML import failed: {err}', file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
