"""Import an operator-supplied manifest of authorized mobile.de detail URLs sequentially."""
import argparse
from contextlib import closing, contextmanager
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time

from custom_detail import DetailError
from lecteur import MOBILE_URL, read_mobile
from reader_pg import import_observations, validate_database_name


def private_file(path):
    """New state contains listing data; keep it private from the first write."""
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        return
    os.close(fd)


@contextmanager
def exclusive_state(path):
    # A separate SQLite lock stays held while the state DB commits checkpoints.
    # The OS releases it if the process dies; filesystem-local use is required.
    path = path.resolve()
    guard = path.with_name(path.name + ".lock")
    private_file(guard)
    with closing(sqlite3.connect(guard, timeout=0)) as lock:
        try:
            lock.execute("BEGIN EXCLUSIVE")
        except sqlite3.OperationalError as err:
            if getattr(err, "sqlite_errorcode", None) == getattr(sqlite3, "SQLITE_BUSY", 5) or "locked" in str(err).lower():
                raise DetailError("batch_busy", "Another process holds this local batch state.") from err
            raise
        private_file(path)
        with closing(sqlite3.connect(path)) as state:
            state.row_factory = sqlite3.Row
            yield state


def open_manifest(state, manifest, database):
    validate_database_name(database)
    state.executescript("""
        CREATE TABLE IF NOT EXISTS mobile_batch (
            singleton INTEGER PRIMARY KEY CHECK(singleton=1), sha256 TEXT NOT NULL,
            database_name TEXT NOT NULL, supplied INTEGER NOT NULL,
            halt TEXT, last_http TEXT, last_db TEXT, last_request REAL NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS mobile_jobs (
            seq INTEGER PRIMARY KEY, url TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'queued',
            staged TEXT, inserted INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX IF NOT EXISTS mobile_jobs_status ON mobile_jobs(status,seq);
    """)
    config = state.execute("SELECT * FROM mobile_batch WHERE singleton=1").fetchone()
    digest = hashlib.sha256()
    supplied = 0
    with manifest.open("rb") as stream, state:
        for index, raw in enumerate(stream, 1):
            digest.update(raw)
            line = raw.rstrip(b"\r\n")
            if not line:
                continue
            if len(line) > 160 or not line.isascii() or not MOBILE_URL.fullmatch(line.decode("ascii")):
                raise DetailError("invalid_manifest", f"Line {index} must be an exact authorized listing URL.")
            supplied += 1
            if config is None:
                state.execute("INSERT OR IGNORE INTO mobile_jobs(url) VALUES(?)", (line.decode("ascii"),))
        if not supplied:
            raise DetailError("invalid_manifest", "The manifest has no supplied listing URLs.")
        if config is None:
            state.execute("INSERT INTO mobile_batch(singleton,sha256,database_name,supplied) VALUES(1,?,?,?)",
                          (digest.hexdigest(), database, supplied))
        elif config["sha256"] != digest.hexdigest() or config["database_name"] != database:
            raise DetailError("batch_config_mismatch", "This state belongs to a different manifest or database.")


def set_halt(state, code, message, http=None):
    value = {"code": code, "message": message}
    if http:
        value["http"] = http
    state.execute("UPDATE mobile_batch SET halt=? WHERE singleton=1", (json.dumps(value),))


def summary(state):
    cfg = state.execute("SELECT * FROM mobile_batch WHERE singleton=1").fetchone()
    c = state.execute("""SELECT COUNT(*) AS distinct_urls, COALESCE(SUM(status='verified'),0) AS verified,
                          COALESCE(SUM(status='unavailable'),0) AS unavailable, COALESCE(SUM(inserted),0) AS inserted,
                          COALESCE(SUM(status IN ('queued','staged')),0) AS pending FROM mobile_jobs""").fetchone()
    halt = json.loads(cfg["halt"]) if cfg["halt"] else None
    return {"status": "stopped" if halt else "completed" if not c["pending"] else "in_progress",
            "manifest_sha256": cfg["sha256"], "database": cfg["database_name"], "supplied": cfg["supplied"],
            **dict(c), "stop": halt,
            "last_http": json.loads(cfg["last_http"]) if cfg["last_http"] else None,
            "last_postgresql": json.loads(cfg["last_db"]) if cfg["last_db"] else None}


def run_batch(manifest, path, database, interval, resume_after_clearance=False, resume_after_repair=False):
    if not math.isfinite(interval) or interval <= 0:
        raise DetailError("invalid_interval", "Use a finite positive interval in seconds per listing.")
    if resume_after_clearance and resume_after_repair:
        raise DetailError("invalid_resume", "Select a single type of resumption.")
    with exclusive_state(path) as state:
        open_manifest(state, manifest, database)
        cfg = state.execute("SELECT halt,last_request FROM mobile_batch WHERE singleton=1").fetchone()
        if cfg["halt"]:
            cause = json.loads(cfg["halt"])["code"]
            # Only a staged database write or parser failure can resume after a local repair.
            local = cause in ("postgres_unverified", "parse_error")
            if (local and not resume_after_repair) or (not local and not resume_after_clearance):
                return summary(state)
            with state:
                state.execute("UPDATE mobile_batch SET halt=NULL WHERE singleton=1")
        last_request = cfg["last_request"]
        while True:
            # Prefer an already downloaded observation, including after an interrupted DB import.
            job = state.execute("SELECT * FROM mobile_jobs WHERE status='staged' ORDER BY seq LIMIT 1").fetchone()
            if job is None:
                job = state.execute("SELECT * FROM mobile_jobs WHERE status='queued' ORDER BY seq LIMIT 1").fetchone()
                if job is None:
                    break
                wait = last_request + interval - time.time()
                if wait > 0:
                    time.sleep(wait)
                last_request = time.time()
                with state:
                    # If interrupted after the GET but before its outcome is checkpointed,
                    # prohibit a blind automatic retry on the next invocation.
                    set_halt(state, "interrupted_fetch", "Previous request outcome was not recorded.",
                             {"requested_url": job["url"]})
                    state.execute("UPDATE mobile_batch SET last_request=? WHERE singleton=1", (last_request,))
                report = {"observations": [], "documents": [], "errors": []}
                try:
                    read_mobile(job["url"], report)
                except (DetailError, ValueError, OSError) as error:
                    http = report.get("http", {})
                    last_request = time.time()
                    with state:
                        state.execute("UPDATE mobile_batch SET last_request=?,last_http=? WHERE singleton=1",
                                      (last_request, json.dumps(http)))
                        if http.get("result") == "http_error" and http.get("detail_http") in (404, 410):
                            state.execute("UPDATE mobile_jobs SET status='unavailable' WHERE seq=?", (job["seq"],))
                            state.execute("UPDATE mobile_batch SET halt=NULL WHERE singleton=1")
                            continue
                        result = http.get("result")
                        reason = "parse_error" if result == "html_received" else result or "transport_error"
                        if getattr(error, "code", None) == "blocked_or_unavailable":
                            reason = "verification_or_unavailable"
                        set_halt(state, reason, str(error), http)
                    break
                observations = report["observations"]
                last_request = time.time()
                with state:
                    state.execute("UPDATE mobile_batch SET last_request=?,last_http=? WHERE singleton=1",
                                  (last_request, json.dumps(report["http"])))
                    state.execute("UPDATE mobile_jobs SET status='staged',staged=? WHERE seq=?",
                                  (json.dumps(observations, ensure_ascii=False), job["seq"]))
                    state.execute("UPDATE mobile_batch SET halt=NULL WHERE singleton=1")
            else:
                observations = json.loads(job["staged"])
            try:
                receipt = import_observations(database, observations)
                if receipt["verified"] != 1 or receipt["inserted"] not in (0, 1):
                    raise RuntimeError("Detached PostgreSQL readback did not verify exactly one observation.")
            except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
                with state:
                    set_halt(state, "postgres_unverified", str(error))
                break
            with state:
                state.execute("UPDATE mobile_jobs SET status='verified',staged=NULL,inserted=? WHERE seq=?",
                              (receipt["inserted"], job["seq"]))
                state.execute("UPDATE mobile_batch SET last_db=? WHERE singleton=1", (json.dumps(receipt),))
        return summary(state)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("manifest", type=Path, help="UTF-8 text, one exact authorized HTTPS listing URL per line")
    p.add_argument("--state", required=True, type=Path, help="Local SQLite progress file, retained between runs")
    p.add_argument("--database", required=True, help="Local destination: autofindex_trial_* or the autoworld collection schema")
    p.add_argument("--interval-seconds", type=float, required=True, help="Positive minimum time between listing requests")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--resume-after-clearance", action="store_true",
                   help="Resume a stopped HTTP batch after the publisher restored or confirmed access")
    g.add_argument("--resume-after-repair", action="store_true",
                   help="Resume a stopped parser or database operation following local repair")
    args = p.parse_args(argv)
    try:
        result = run_batch(args.manifest, args.state, args.database, args.interval_seconds,
                           args.resume_after_clearance, args.resume_after_repair)
    except (OSError, sqlite3.Error, ValueError) as error:
        result = {"status": "error", "stop": {"code": getattr(error, "code", "batch_error"), "message": str(error)}}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "completed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
