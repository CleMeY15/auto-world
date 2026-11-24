"""Exercise a local report against a disposable PostgreSQL verification database."""
import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from leparking_pg_trial import KAGGLE, TABLE, canonical_rows, pg_json, psql


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def normal_import(path, database, provenance, expected, *, expect_conflict=False):
    importer = Path(__file__).with_name("leparking_pg_trial.py")
    command = [sys.executable, str(importer), str(path), "--database", database,
               "--provenance", provenance, "--expected", str(expected)]
    run = subprocess.run(command, text=True, capture_output=True, timeout=195)
    if expect_conflict:
        require(run.returncode == 1 and "trial_existing_row_conflict: transaction aborted" in run.stderr,
                "expected stored-row conflict was not observed")
        return
    require(run.returncode == 0, "import failed: " + run.stderr.strip())
    return json.loads(run.stdout)


def verify(args):
    require(re.fullmatch(r"autofindex_trial_[a-z0-9_]{1,40}", args.database), "use a dedicated trial database")
    require(re.fullmatch(r"[0-9a-f]{64}", args.oracle_sha256), "expected independent SHA-256")
    report = json.loads(args.report.read_text(encoding="utf-8"))
    canonical = canonical_rows(report, args.provenance, 2000)
    source = canonical[0]["source"]
    scope = f"provenance='{args.provenance}' AND source='{source}'"
    if psql(args.database, f"SELECT to_regclass('{TABLE}') IS NOT NULL;") == "t":
        require(psql(args.database, f"SELECT count(*) FROM {TABLE} WHERE {scope};") == "0",
                "the trial namespace must start empty")

    first = normal_import(args.report, args.database, args.provenance, 2000)
    replay = normal_import(args.report, args.database, args.provenance, 2000)
    require(first["newly_inserted"] == 2000 and replay["newly_inserted"] == 0
            and first["verified_rows"] == replay["verified_rows"] == 2000
            and first["sha256"] == replay["sha256"], "first import or exact replay differed")

    original = report["rows"][0]
    old_id = original["source_id"]
    present = {r["source_id"] for r in canonical}
    # The first row of the negative batch has a genuinely absent ID. The
    # second changes the price for a stored source ID. Neither may be written.
    if source == KAGGLE:
        new_id = next(f"negative_probe.csv:{n}" for n in range(2, 2004)
                      if f"negative_probe.csv:{n}" not in present)
        fresh = original | {"source_id": new_id}
        price_field = "price_gbp"
    else:
        new_id = next(f"ZZ{n:06d}" for n in range(2001) if f"ZZ{n:06d}" not in present)
        fresh = original | {"source_id": new_id,
                            "source_url": f"https://www.leparking.fr/voiture-occasion-detail/test/probe/{new_id}.html"}
        price_field = "price_eur"
    old_price = original[price_field]
    changed = original | {price_field: 1 if old_price != 1 else 2}
    with tempfile.TemporaryDirectory() as work:
        path = Path(work) / "negative.json"
        path.write_text(json.dumps(report | {"rows": [fresh, changed], "complete_unique": 2}), encoding="utf-8")
        normal_import(path, args.database, args.provenance, 2, expect_conflict=True)

    def sql_id(value):
        return f"({pg_json(value)} #>> '{{}}')"

    check = f"""SELECT json_build_array(count(*),count(DISTINCT source_id),
        count(*) FILTER (WHERE source_id={sql_id(new_id)}),
        max(price) FILTER (WHERE source_id={sql_id(old_id)}))
        FROM {TABLE} WHERE {scope};"""
    count, distinct, probe_count, persisted_price = json.loads(psql(args.database, check))
    require([count, distinct, probe_count, persisted_price] == [2000, 2000, 0, old_price],
            "post-conflict persistence differed")

    # Preserve COPY's trailing LF and byte encoding for comparison with the independently
    # constructed source oracle. psql() strips output for scalar queries, so read bytes here.
    copy_sql = f"""SET client_encoding='UTF8'; COPY (
        SELECT source_id,title,year,price,mileage FROM {TABLE}
        WHERE {scope} ORDER BY source_id COLLATE "C") TO STDOUT WITH (FORMAT CSV);"""
    copy = subprocess.run(["psql", "-X", "-qAt", "-w", "-v", "ON_ERROR_STOP=1", "--dbname", args.database],
                          input=copy_sql.encode(), capture_output=True, timeout=90)
    require(copy.returncode == 0, "independent CSV readback failed")
    digest = hashlib.sha256(copy.stdout).hexdigest()
    require(digest == args.oracle_sha256, "independent five-field source oracle differed")
    return {"source": source, "provenance": args.provenance, "database": args.database,
            "schema": "aw_marketplace_trial", "server_version": psql(args.database, "SHOW server_version;"),
            "first": first, "replay": replay, "committed_after_conflict": count,
            "distinct_ids_after_conflict": distinct, "mixed_batch_rejected": True,
            "unexpected_probe_rows": probe_count, "original_price_preserved": True,
            "oracle_columns": ["source_id", "title", "year", "price", "mileage"],
            "oracle_csv_bytes": len(copy.stdout), "expected_csv_sha256": args.oracle_sha256,
            "readback_csv_sha256": digest}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True)
    parser.add_argument("--provenance", choices=("fixture", "open-dataset"), required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--oracle-sha256", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    try:
        receipt = verify(args)
        args.out.mkdir(parents=True, exist_ok=True)
        destination = args.out / f"postgres-{args.provenance}-receipt.json"
        destination.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(receipt))
    except (ValueError, OSError, RuntimeError, subprocess.TimeoutExpired) as err:
        print(f"verification failed: {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
