#!/usr/bin/env python3
"""Private, bounded preparation store. Never connects to the project database."""

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
import sys
import tempfile


MAX_BUNDLE_BYTES = 32 * 1024 * 1024
MAX_OBSERVATION_BYTES = 1024 * 1024
URL = re.compile(r"https://www\.leboncoin\.fr/ad/voitures/([1-9][0-9]{0,19})\Z")
ISO = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\Z")
CODE = re.compile(r"[a-z_]{1,64}\Z")
SCHEMA_ID = "leboncoin-private-trial/v1"
COUNTERS = {"discovered", "attempted", "complete", "partial", "rejected", "stored"}
TABLES = {"metadata", "batches", "raw_observations", "observations", "batch_entries"}


class ImportRejected(Exception):
    """Only fixed codes leave the private importer."""


def require(condition, code):
    if not condition:
        raise ImportRejected(code)


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def encoded(value):
    try:
        return value.encode("utf-8", errors="strict")
    except (AttributeError, UnicodeError) as error:
        raise ImportRejected("invalid_utf8") from error


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def same(left, right):
    # Unlike Python equality, this distinguishes true from 1 and 1 from 1.0.
    return canonical(left) == canonical(right)


def strict_json(value):
    def object_pairs(pairs):
        result = {}
        for key, item in pairs:
            require(key not in result, "duplicate_json_key")
            result[key] = item
        return result

    def constant(_value):
        raise ImportRejected("invalid_json_number")

    try:
        return json.loads(value, object_pairs_hook=object_pairs, parse_constant=constant)
    except (ValueError, RecursionError, UnicodeError) as error:
        raise ImportRejected("invalid_json") from error


def exact_keys(value, keys, code):
    require(type(value) is dict and set(value) == set(keys), code)


def hex_string(value, length):
    return type(value) is str and re.fullmatch(r"[a-f0-9]{%d}" % length, value) is not None


def timestamp(value):
    require(type(value) is str and ISO.fullmatch(value) is not None, "invalid_timestamp")
    try:
        return dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=dt.timezone.utc)
    except ValueError as error:
        raise ImportRejected("invalid_timestamp") from error


REPLAY_JS = """
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { extractLeboncoinDomObservation } = await import(pathToFileURL(process.argv[1]).href);
const input = JSON.parse(readFileSync(0, 'utf8'));
const output = input.map(entry => extractLeboncoinDomObservation(
  Buffer.from(entry.observation_json, 'utf8'),
  { expectedUrl: entry.url, expectedListingId: entry.listing_id }));
process.stdout.write(JSON.stringify(output));
"""


def replay_normalizer(entries):
    if not entries:
        return []
    request = [{"observation_json": entry["observation_json"], "url": entry["url"],
                "listing_id": entry["listing_id"]} for entry in entries]
    try:
        result = subprocess.run(
            ["node", "--input-type=module", "-e", REPLAY_JS, str(Path(__file__).with_name("extract.mjs"))],
            input=encoded(canonical(request)), capture_output=True, timeout=60, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ImportRejected("normalizer_unavailable") from error
    require(result.returncode == 0 and len(result.stdout) <= MAX_BUNDLE_BYTES, "normalizer_failed")
    replayed = strict_json(result.stdout)
    require(type(replayed) is list and len(replayed) == len(entries), "normalizer_failed")
    return replayed


def validate_bundle(bundle):
    exact_keys(bundle, {"schema_version", "batch_id", "source_revision", "run_id", "plan_sha256",
                        "created_at", "summary", "entries"}, "invalid_bundle_schema")
    require(bundle["schema_version"] == "leboncoin-batch-bundle/v1", "invalid_bundle_schema")
    for key, length in (("batch_id", 32), ("source_revision", 40), ("plan_sha256", 64)):
        require(hex_string(bundle[key], length), "invalid_bundle_identity")
    require(type(bundle["run_id"]) is str and re.fullmatch(r"[0-9]{1,32}", bundle["run_id"]),
            "invalid_bundle_identity")
    created_at = timestamp(bundle["created_at"])
    summary = bundle["summary"]
    exact_keys(summary, COUNTERS | {"status", "stop_reason"}, "invalid_summary")
    for key in COUNTERS:
        require(type(summary[key]) is int and 0 <= summary[key] <= (1000 if key == "discovered" else 105),
                "invalid_summary")
    require(type(summary["status"]) is str and CODE.fullmatch(summary["status"]), "invalid_summary")
    require(summary["stop_reason"] is None or
            (type(summary["stop_reason"]) is str and CODE.fullmatch(summary["stop_reason"])), "invalid_summary")
    require(type(bundle["entries"]) is list and len(bundle["entries"]) <= 100, "entry_limit")
    require(summary["stored"] == 0 and summary["complete"] == len(bundle["entries"])
            and summary["complete"] <= summary["discovered"]
            and summary["complete"] + summary["partial"] + summary["rejected"] == summary["attempted"],
            "summary_count_mismatch")
    entries = []
    seen = set()
    for item in bundle["entries"]:
        exact_keys(item, {"observation", "observation_json", "normalized", "capture_sha256"}, "invalid_entry_schema")
        require(type(item["observation_json"]) is str, "invalid_observation")
        raw = encoded(item["observation_json"])
        require(0 < len(raw) <= MAX_OBSERVATION_BYTES, "observation_byte_limit")
        observation = strict_json(raw)
        require(type(observation) is dict and same(observation, item["observation"]), "observation_json_mismatch")
        require(observation.get("schema_version") == "leboncoin-dom-observation/v1"
                and observation.get("acquisition") == "own_playwright_dom", "invalid_observation")
        url = observation.get("url")
        match = URL.fullmatch(url) if type(url) is str else None
        require(match is not None and observation.get("requested_url") == url, "listing_identity_mismatch")
        listing_id = match.group(1)
        require(listing_id not in seen, "duplicate_listing")
        seen.add(listing_id)
        require(timestamp(observation.get("captured_at")) <= created_at, "capture_after_bundle")
        require(hex_string(item["capture_sha256"], 64), "invalid_capture_hash")
        normalized = item["normalized"]
        digest = sha256(raw)
        require(type(normalized) is dict and normalized.get("observation_sha256") == digest
                and type(normalized.get("observation_bytes")) is int
                and normalized["observation_bytes"] == len(raw), "observation_hash_mismatch")
        require(normalized.get("source") == {"name": "leboncoin", "listing_id": listing_id, "original_url": url},
                "listing_identity_mismatch")
        require(normalized.get("status") == "listing" and normalized.get("core_fields_observed") is True
                and normalized.get("issues") == []
                and type(normalized.get("fields")) is dict
                and type(normalized["fields"].get("model_year")) is dict
                and normalized["fields"]["model_year"].get("status") == "observed", "incomplete_normalized_entry")
        entries.append({"listing_id": listing_id, "url": url, "captured_at": observation["captured_at"],
                        "observation_json": item["observation_json"], "raw": raw, "sha256": digest,
                        "normalized": normalized, "normalized_json": canonical(normalized),
                        "capture_sha256": item["capture_sha256"]})
    for entry, replayed in zip(entries, replay_normalizer(entries)):
        require(same(entry["normalized"], replayed), "normalizer_replay_mismatch")
    return {**bundle, "validated_entries": entries, "bundle_sha256": sha256(encoded(canonical(bundle)))}


SQLITE_DDL = """
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS batches (
 batch_id TEXT PRIMARY KEY, bundle_sha256 TEXT NOT NULL, source_revision TEXT NOT NULL,
 run_id TEXT NOT NULL, plan_sha256 TEXT NOT NULL, created_at TEXT NOT NULL, summary_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS raw_observations (
 observation_sha256 TEXT PRIMARY KEY, source_id TEXT NOT NULL CHECK (source_id='leboncoin'),
 source_listing_id TEXT NOT NULL, original_url TEXT NOT NULL, captured_at TEXT NOT NULL,
 raw_bytes BLOB NOT NULL, byte_length INTEGER NOT NULL CHECK (byte_length=length(raw_bytes)),
 CHECK (original_url='https://www.leboncoin.fr/ad/voitures/' || source_listing_id));
CREATE TABLE IF NOT EXISTS observations (
 observation_sha256 TEXT PRIMARY KEY REFERENCES raw_observations(observation_sha256),
 normalized_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS batch_entries (
 batch_id TEXT NOT NULL REFERENCES batches(batch_id), source_listing_id TEXT NOT NULL,
 observation_sha256 TEXT NOT NULL REFERENCES observations(observation_sha256), capture_sha256 TEXT NOT NULL,
 PRIMARY KEY (batch_id,source_listing_id));
CREATE INDEX IF NOT EXISTS raw_listing_history ON raw_observations(source_id,source_listing_id,captured_at);
CREATE VIEW IF NOT EXISTS latest_listings AS
 SELECT source_id,source_listing_id,original_url,captured_at,observation_sha256,normalized_json
 FROM (SELECT r.*,o.normalized_json,
       row_number() OVER (PARTITION BY source_id,source_listing_id ORDER BY captured_at DESC,observation_sha256 DESC) AS ordinal
       FROM raw_observations r JOIN observations o USING(observation_sha256)) WHERE ordinal=1;
"""
SQLITE_SCHEMA_SHA = sha256(encoded(SQLITE_DDL))


def batch_values(batch):
    return (batch["batch_id"], batch["bundle_sha256"], batch["source_revision"], batch["run_id"],
            batch["plan_sha256"], batch["created_at"], canonical(batch["summary"]))


def verify_batch(connection, batch):
    found = connection.execute("SELECT batch_id,bundle_sha256,source_revision,run_id,plan_sha256,created_at,summary_json "
                               "FROM batches WHERE batch_id=?", (batch["batch_id"],)).fetchone()
    require(found == batch_values(batch), "batch_identity_conflict")
    count = connection.execute("SELECT count(*) FROM batch_entries WHERE batch_id=?", (batch["batch_id"],)).fetchone()[0]
    require(count == len(batch["validated_entries"]), "stored_count_mismatch")
    for entry in batch["validated_entries"]:
        row = connection.execute(
            "SELECT r.source_id,r.source_listing_id,r.original_url,r.captured_at,r.raw_bytes,r.byte_length,"
            "o.normalized_json,b.capture_sha256 FROM batch_entries b "
            "JOIN raw_observations r USING(observation_sha256) JOIN observations o USING(observation_sha256) "
            "WHERE b.batch_id=? AND b.source_listing_id=? AND b.observation_sha256=?",
            (batch["batch_id"], entry["listing_id"], entry["sha256"]),
        ).fetchone()
        expected = ("leboncoin", entry["listing_id"], entry["url"], entry["captured_at"], entry["raw"],
                    len(entry["raw"]), entry["normalized_json"], entry["capture_sha256"])
        require(row == expected, "stored_observation_conflict")


def sqlite_import(path, batch):
    connection = sqlite3.connect(path, timeout=10, isolation_level=None)
    try:
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA journal_mode=DELETE")
        connection.execute("PRAGMA synchronous=FULL")
        existing = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        require(not existing or existing == TABLES, "unrecognized_preparation_database")
        if existing:
            require(connection.execute("SELECT value FROM metadata WHERE key='schema'").fetchone()
                    == (SCHEMA_ID + ":" + SQLITE_SCHEMA_SHA,), "preparation_schema_mismatch")
        connection.executescript("BEGIN IMMEDIATE;\n" + SQLITE_DDL)
        connection.execute("INSERT INTO metadata(key,value) VALUES('schema',?) ON CONFLICT(key) DO NOTHING",
                           (SCHEMA_ID + ":" + SQLITE_SCHEMA_SHA,))
        before = connection.execute("SELECT count(*) FROM observations").fetchone()[0]
        replay = connection.execute("SELECT 1 FROM batches WHERE batch_id=?", (batch["batch_id"],)).fetchone() is not None
        connection.execute("INSERT INTO batches VALUES(?,?,?,?,?,?,?) ON CONFLICT(batch_id) DO NOTHING", batch_values(batch))
        found = connection.execute("SELECT bundle_sha256 FROM batches WHERE batch_id=?", (batch["batch_id"],)).fetchone()
        require(found == (batch["bundle_sha256"],), "batch_identity_conflict")
        for entry in batch["validated_entries"]:
            connection.execute("INSERT INTO raw_observations VALUES(?,?,?,?,?,?,?) ON CONFLICT(observation_sha256) DO NOTHING",
                               (entry["sha256"], "leboncoin", entry["listing_id"], entry["url"], entry["captured_at"],
                                entry["raw"], len(entry["raw"])))
            connection.execute("INSERT INTO observations VALUES(?,?) ON CONFLICT(observation_sha256) DO NOTHING",
                               (entry["sha256"], entry["normalized_json"]))
            connection.execute("INSERT INTO batch_entries VALUES(?,?,?,?) ON CONFLICT(batch_id,source_listing_id) DO NOTHING",
                               (batch["batch_id"], entry["listing_id"], entry["sha256"], entry["capture_sha256"]))
        verify_batch(connection, batch)
        after = connection.execute("SELECT count(*) FROM observations").fetchone()[0]
        connection.execute("COMMIT")
    except BaseException:
        if connection.in_transaction:
            connection.execute("ROLLBACK")
        raise
    finally:
        connection.close()
    with sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True) as reader:
        require(reader.execute("PRAGMA integrity_check").fetchone() == ("ok",), "sqlite_integrity_failed")
        require(reader.execute("PRAGMA foreign_key_check").fetchone() is None, "sqlite_foreign_key_failed")
        verify_batch(reader, batch)
        unique = reader.execute("SELECT count(*) FROM latest_listings").fetchone()[0]
    return {"schema_version": "leboncoin-batch-import-receipt/v1", "status": "stored",
            "batch_id": batch["batch_id"], "batch_listings": len(batch["validated_entries"]),
            "stored": len(batch["validated_entries"]),
            "new_observations": after - before, "total_observations": after, "total_unique_listings": unique,
            "replayed": replay, "sqlite_integrity": "ok", "postgres_import_generated": True,
            "project_database_updated": False}


def pg_text(value):
    # No source string becomes SQL syntax, including quotes, comments and psql commands.
    return "convert_from(decode('" + encoded(value).hex() + "','hex'),'UTF8')"


POSTGRES_DDL = """
DO $aw_trial$ BEGIN
 IF current_database()<>'autoworld' THEN RAISE EXCEPTION 'wrong_database'; END IF;
 IF to_regnamespace('aw_acquisition_trial') IS NOT NULL
    AND to_regclass('aw_acquisition_trial.metadata') IS NULL THEN
   RAISE EXCEPTION 'unrecognized_trial_schema';
 END IF;
END $aw_trial$;
SELECT pg_advisory_xact_lock(109624,137100);
CREATE SCHEMA IF NOT EXISTS aw_acquisition_trial;
REVOKE ALL ON SCHEMA aw_acquisition_trial FROM PUBLIC;
CREATE TABLE IF NOT EXISTS aw_acquisition_trial.metadata (key text PRIMARY KEY,value text NOT NULL);
CREATE TABLE IF NOT EXISTS aw_acquisition_trial.batches (
 batch_id text PRIMARY KEY,bundle_sha256 text NOT NULL,source_revision text NOT NULL,
 run_id text NOT NULL,plan_sha256 text NOT NULL,created_at timestamptz NOT NULL,summary_json jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS aw_acquisition_trial.raw_observations (
 observation_sha256 text PRIMARY KEY CHECK (observation_sha256 ~ '^[a-f0-9]{64}$'),
 source_id text NOT NULL CHECK (source_id='leboncoin'),source_listing_id text NOT NULL,
 original_url text NOT NULL,captured_at timestamptz NOT NULL,raw_bytes bytea NOT NULL,
 byte_length integer NOT NULL CHECK (byte_length=octet_length(raw_bytes)),
 CHECK (source_listing_id ~ '^[1-9][0-9]{0,19}$'),
 CHECK (original_url='https://www.leboncoin.fr/ad/voitures/' || source_listing_id),
 CHECK (encode(sha256(raw_bytes),'hex')=observation_sha256));
CREATE TABLE IF NOT EXISTS aw_acquisition_trial.observations (
 observation_sha256 text PRIMARY KEY REFERENCES aw_acquisition_trial.raw_observations,
 normalized_json jsonb NOT NULL CHECK (jsonb_typeof(normalized_json)='object'));
CREATE TABLE IF NOT EXISTS aw_acquisition_trial.batch_entries (
 batch_id text NOT NULL REFERENCES aw_acquisition_trial.batches,source_listing_id text NOT NULL,
 observation_sha256 text NOT NULL REFERENCES aw_acquisition_trial.observations,
 capture_sha256 text NOT NULL CHECK (capture_sha256 ~ '^[a-f0-9]{64}$'),
 PRIMARY KEY(batch_id,source_listing_id));
CREATE INDEX IF NOT EXISTS raw_listing_history ON aw_acquisition_trial.raw_observations(source_id,source_listing_id,captured_at);
CREATE OR REPLACE VIEW aw_acquisition_trial.latest_listings AS
 SELECT DISTINCT ON (source_id,source_listing_id)
 source_id,source_listing_id,original_url,captured_at,observation_sha256,normalized_json
 FROM aw_acquisition_trial.raw_observations JOIN aw_acquisition_trial.observations USING(observation_sha256)
 ORDER BY source_id,source_listing_id,captured_at DESC,observation_sha256 DESC;
CREATE TEMP TABLE aw_trial_expected (
 source_listing_id text PRIMARY KEY,observation_sha256 text UNIQUE,original_url text,captured_at timestamptz,
 raw_bytes bytea,byte_length integer,normalized_json jsonb,capture_sha256 text) ON COMMIT DROP;
"""
POSTGRES_SCHEMA_SHA = sha256(encoded(POSTGRES_DDL))


def postgres_sql(batch):
    batch_id = pg_text(batch["batch_id"])
    schema_marker = pg_text(SCHEMA_ID + ":" + POSTGRES_SCHEMA_SHA)
    values = [pg_text(value) for value in batch_values(batch)]
    values[5] += "::timestamptz"
    values[6] += "::jsonb"
    chunks = ["\\set ON_ERROR_STOP on\n\\set VERBOSITY terse\n"
              "-- Private preparation export; executing this file is a separate, verified database operation.\n"
              "BEGIN;\nSET LOCAL statement_timeout='30s';\nSET LOCAL lock_timeout='10s';\n"
              "SET LOCAL idle_in_transaction_session_timeout='30s';\nSET LOCAL search_path=pg_catalog;\n",
              POSTGRES_DDL,
              f"INSERT INTO aw_acquisition_trial.metadata VALUES('schema',{schema_marker}) ON CONFLICT(key) DO NOTHING;\n"
              f"DO $aw_trial$ BEGIN IF (SELECT value FROM aw_acquisition_trial.metadata WHERE key='schema') "
              f"IS DISTINCT FROM {schema_marker} THEN RAISE EXCEPTION 'trial_schema_mismatch'; END IF; END $aw_trial$;\n",
              "INSERT INTO aw_acquisition_trial.batches VALUES(" + ",".join(values) + ") ON CONFLICT(batch_id) DO NOTHING;\n",
              "DO $aw_trial$ BEGIN IF NOT EXISTS (SELECT 1 FROM aw_acquisition_trial.batches WHERE "
              f"batch_id={batch_id} AND ROW(batch_id,bundle_sha256,source_revision,run_id,plan_sha256,created_at,summary_json) "
              "IS NOT DISTINCT FROM ROW(" + ",".join(values) + ")) THEN RAISE EXCEPTION 'batch_identity_conflict'; "
              "END IF; END $aw_trial$;\n"]
    for entry in batch["validated_entries"]:
        row = [pg_text(entry["listing_id"]), pg_text(entry["sha256"]), pg_text(entry["url"]),
               pg_text(entry["captured_at"]) + "::timestamptz", "decode('" + entry["raw"].hex() + "','hex')",
               str(len(entry["raw"])), pg_text(entry["normalized_json"]) + "::jsonb", pg_text(entry["capture_sha256"])]
        chunks.append("INSERT INTO aw_trial_expected VALUES(" + ",".join(row) + ");\n")
    chunks.append("""
INSERT INTO aw_acquisition_trial.raw_observations
 SELECT observation_sha256,'leboncoin',source_listing_id,original_url,captured_at,raw_bytes,byte_length FROM aw_trial_expected
 ON CONFLICT(observation_sha256) DO NOTHING;
INSERT INTO aw_acquisition_trial.observations
 SELECT observation_sha256,normalized_json FROM aw_trial_expected ON CONFLICT(observation_sha256) DO NOTHING;
""")
    chunks.append(f"INSERT INTO aw_acquisition_trial.batch_entries SELECT {batch_id},source_listing_id,observation_sha256,capture_sha256 "
                  "FROM aw_trial_expected ON CONFLICT(batch_id,source_listing_id) DO NOTHING;\n")
    chunks.append(f"""
DO $aw_trial$ BEGIN
 IF (SELECT count(*) FROM aw_acquisition_trial.batch_entries WHERE batch_id={batch_id})<>{len(batch['validated_entries'])}
 THEN RAISE EXCEPTION 'stored_count_mismatch'; END IF;
 IF EXISTS (
  SELECT 1 FROM aw_trial_expected e
  LEFT JOIN aw_acquisition_trial.raw_observations r USING(observation_sha256)
  LEFT JOIN aw_acquisition_trial.observations o USING(observation_sha256)
  LEFT JOIN aw_acquisition_trial.batch_entries b ON b.batch_id={batch_id} AND b.source_listing_id=e.source_listing_id
  WHERE r.source_id IS DISTINCT FROM 'leboncoin' OR r.source_listing_id IS DISTINCT FROM e.source_listing_id
   OR r.original_url IS DISTINCT FROM e.original_url OR r.captured_at IS DISTINCT FROM e.captured_at
   OR r.raw_bytes IS DISTINCT FROM e.raw_bytes OR r.byte_length IS DISTINCT FROM e.byte_length
   OR o.normalized_json IS DISTINCT FROM e.normalized_json
   OR b.observation_sha256 IS DISTINCT FROM e.observation_sha256 OR b.capture_sha256 IS DISTINCT FROM e.capture_sha256
 ) THEN RAISE EXCEPTION 'stored_observation_conflict'; END IF;
END $aw_trial$;
COMMIT;
SELECT current_database() AS target_database,'aw_acquisition_trial' AS target_schema,
 (SELECT count(*) FROM aw_acquisition_trial.batch_entries WHERE batch_id={batch_id}) AS batch_listings,
 (SELECT count(*) FROM aw_acquisition_trial.observations) AS total_observations,
 (SELECT count(*) FROM aw_acquisition_trial.latest_listings) AS total_unique_listings,
 true AS transaction_committed;
""")
    return "".join(chunks)


def private_destination(directory):
    require(not directory.is_symlink(), "unsafe_output_directory")
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(directory.is_dir() and directory.stat().st_uid == os.getuid(), "unsafe_output_directory")
    directory.chmod(0o700)
    for name in ("trial.sqlite3", "normalized.jsonl", "import.sql", "import-receipt.json"):
        path = directory / name
        if path.exists() or path.is_symlink():
            require(not path.is_symlink() and stat.S_ISREG(path.stat().st_mode)
                    and path.stat().st_uid == os.getuid(), "unsafe_output_file")
            path.chmod(0o600)


def private_write(path, value):
    descriptor, temporary = tempfile.mkstemp(prefix=".import-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(encoded(value))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def import_bundle(bundle_path, output_directory):
    require(bundle_path.stat().st_size <= MAX_BUNDLE_BYTES, "bundle_byte_limit")
    raw = bundle_path.read_bytes()
    require(len(raw) <= MAX_BUNDLE_BYTES, "bundle_byte_limit")
    batch = validate_bundle(strict_json(raw))
    sql = postgres_sql(batch)
    private_destination(output_directory)
    database = output_directory / "trial.sqlite3"
    if not database.exists():
        descriptor = os.open(database, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(descriptor)
    receipt = sqlite_import(database.resolve(), batch)
    private_write(output_directory / "normalized.jsonl", "".join(entry["normalized_json"] + "\n" for entry in batch["validated_entries"]))
    private_write(output_directory / "import.sql", sql)
    private_write(output_directory / "import-receipt.json", canonical(receipt) + "\n")
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    args = parser.parse_args()
    previous_umask = os.umask(0o077)
    try:
        receipt = import_bundle(args.bundle, args.out_dir)
        print(canonical(receipt))
        return 0
    except ImportRejected as error:
        print(canonical({"schema_version": "leboncoin-batch-import-receipt/v1", "status": "failed", "code": str(error),
                         "project_database_updated": False}))
        return 2
    except (OSError, sqlite3.Error, ValueError, RecursionError):
        print(canonical({"schema_version": "leboncoin-batch-import-receipt/v1", "status": "failed",
                         "code": "private_import_failed", "project_database_updated": False}))
        return 2
    finally:
        os.umask(previous_umask)


if __name__ == "__main__":
    sys.exit(main())
