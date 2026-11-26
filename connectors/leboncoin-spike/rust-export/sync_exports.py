"""Import completed local files from the existing Rust producer into the private project database."""
import argparse
import fcntl
import json
import os
import re
import stat
import sys
import tempfile
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

import psycopg2

from project_export import MARKER, Rejected, instant, load_policy, process


NAME = re.compile(r"listings_rust_v2_[0-9]{8}_[0-9]{6}\.json")


def active_exports(service):
    with closing(psycopg2.connect(service=service, connect_timeout=6)) as conn, conn, conn.cursor() as cur:
        cur.execute("SET LOCAL search_path=pg_catalog")
        cur.execute("SET LOCAL lock_timeout='5s'")
        cur.execute("SET LOCAL statement_timeout='20s'")
        cur.execute("SELECT current_database(), obj_description(to_regclass('aw_acquisition_trial.rust_exports'),'pg_class')")
        if cur.fetchone() != ("autoworld", MARKER):
            raise Rejected("wrong_project_database_or_migration")
        cur.execute("SELECT aw_acquisition_trial.purge_rust_exports()")
        expired = cur.fetchone()[0]
        cur.execute("SELECT export_sha256 FROM aw_acquisition_trial.rust_exports")
        return {row[0] for row in cur}, expired


def synchronize(directory, since, state, policy, service):
    if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}", service):
        raise Rejected("invalid_postgres_service")
    now = datetime.now(timezone.utc)
    if not directory.is_dir():
        raise Rejected("export_directory_missing")
    if state.is_symlink() or not state.is_dir() or state.stat().st_mode & 0o077:
        raise Rejected("private_state_directory_required")
    with (state / "sync.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        known, expired = active_exports(service)
        scope = load_policy(policy, now)
        start = max(since, now - min(scope.raw, scope.normalized))
        receipt_path = state / "processed.json"
        try:
            saved = json.loads(receipt_path.read_text())
        except (FileNotFoundError, json.JSONDecodeError, UnicodeError):
            saved = {}
        if not isinstance(saved, dict):
            saved = {}
        updated = {}
        counts = {"new_exports": 0, "new_export_rows": 0, "expired_exports": expired, "rejected": 0}
        for path in sorted(directory.iterdir()):
            if not NAME.fullmatch(path.name):
                continue
            st = path.lstat()
            if not stat.S_ISREG(st.st_mode) or not start.timestamp() <= st.st_mtime < now.timestamp() - 5:
                continue
            fingerprint = [st.st_ino, st.st_ctime_ns, st.st_mtime_ns, st.st_size]
            receipt = saved.get(path.name, {})
            if (isinstance(receipt, dict) and receipt.get("file") == fingerprint
                    and isinstance(receipt.get("sha"), str) and isinstance(receipt.get("expires"), (int, float))
                    and (receipt["sha"] in known or receipt["expires"] <= now.timestamp())):
                updated[path.name] = receipt
                continue
            try:
                result = process(path, policy, service=service)
            except (Rejected, OSError) as exc:
                counts["rejected"] += 1
                print(str(exc) if isinstance(exc, Rejected) else "export_unreadable", file=sys.stderr)
                continue
            updated[path.name] = {"file": fingerprint, "sha": result["export_sha256"],
                                   "expires": datetime.fromisoformat(result["retain_until"]).timestamp()}
            known.add(result["export_sha256"])
            if result["status"] == "inserted":
                counts["new_exports"] += 1
                counts["new_export_rows"] += result["rows"]
        with tempfile.NamedTemporaryFile(mode="w", dir=state, delete=False) as output:
            tmp = Path(output.name)
            try:
                json.dump(updated, output)
                output.flush()
                os.fsync(output.fileno())
                os.replace(tmp, receipt_path)
            finally:
                tmp.unlink(missing_ok=True)
        return counts


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--since", required=True, type=instant)
    parser.add_argument("--state", required=True, type=Path)
    parser.add_argument("--policy", required=True, type=Path)
    parser.add_argument("--service", required=True)
    args = parser.parse_args()
    try:
        report = synchronize(**vars(args))
        print(json.dumps(report))
        sys.exit(int(report["rejected"] > 0))
    except (psycopg2.Error, OSError, ValueError):
        sys.exit("private_project_export_sync_failed")
