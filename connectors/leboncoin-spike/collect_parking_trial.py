"""Finite private Le Parking trial using only explicitly supplied public search pages."""
import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from http.client import HTTPException
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from marketplace_pages import audit_files, parse_input, FIELDS

USER_AGENT = "AutoFindex/1.0 (private authorized vehicle data trial)"
MAX_BYTES = 4_000_000
TARGET = 2000
MODE = "leparking-html"
STOP = {"access_refused", "rate_limited", "verification_signal", "verification_mention", "redirect",
        "systematic_unrecognized", "systematic_empty", "systematic_network_errors", "invalid_response"}
STRONG_TITLE = re.compile(r"<title\b[^>]*>\s*(?:access denied|just a moment|vérification de sécurité|"
                          r"security (?:check|verification)|captcha|verify you are human)\b", re.I)


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def write(path, data):
    temp = path.with_suffix(path.suffix + ".part")
    temp.write_bytes(data)
    temp.replace(path)


def save_json(path, payload):
    write(path, (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode())


def validate_url(url):
    parsed = urlsplit(url)
    decoded = unquote(parsed.path)
    if (parsed.scheme != "https" or parsed.netloc != "www.leparking.fr"
            or not decoded.startswith("/voiture-occasion/") or parsed.fragment
            or len(url) > 2500 or "\\" in decoded or ".." in decoded.split("/")
            or any(ord(c) <= 32 for c in url)):
        raise ValueError("inventory must contain public HTTPS Le Parking search-page URLs only")
    return url


def inventory(path):
    return list(dict.fromkeys(validate_url(line.strip()) for line in path.read_text(encoding="utf-8").splitlines()
                              if line.strip() and not line.lstrip().startswith("#")))


class UnsafeRedirect(Exception):
    def __init__(self, status):
        self.status = status


class SearchRedirect(HTTPRedirectHandler):
    def __init__(self, gap):
        super().__init__()
        self.hops = []
        self.gap = gap

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        try:
            dest = validate_url(newurl)
        except ValueError:
            raise UnsafeRedirect(code) from None
        if len(self.hops) >= 3 or dest == req.full_url or dest in self.hops:
            raise UnsafeRedirect(code)
        redirected = super().redirect_request(req, fp, code, msg, headers, dest)
        if redirected is not None:
            self.hops.append(dest)
            time.sleep(self.gap)
        return redirected


def refusal_metadata(exc):
    """Report only known classifications, never copy identifiers from a challenge."""
    result = {"via_header_present": bool(exc.headers.get("Via"))}
    server = exc.headers.get("Server", "").lower()
    for product in ("cloudflare", "awselb", "nginx", "akamaighost", "envoy", "varnish", "apache"):
        if product in server:
            result["server_product"] = product
            break
    reasons = [exc.headers.get(k, "").strip().upper() for k in ("X-Mitmproxy-Blocked-Reason", "X-Deny-Reason")]
    robots = "ROBOTS_DENIED" in reasons
    # A recognisable gateway header or body can identify a rejection layer.
    # Lack of any such signature does not establish a denial by the origin.
    proxy_marked = bool(exc.headers.get("X-Mitmproxy-Blocked-Reason"))
    try:
        excerpt = exc.read(1200).decode("ascii", errors="ignore").upper()
        robots = robots or "ROBOTS_DENIED" in excerpt
    except (OSError, HTTPException):
        pass
    result.update(robots_denied_marker=robots, intermediary_marked=proxy_marked,
                  denial_attribution="intermediary_indicated" if proxy_marked else "unestablished")
    retry = exc.headers.get("Retry-After", "")
    if re.fullmatch(r"[0-9]{1,9}", retry):
        result["retry_after_seconds"] = int(retry)
    return result


def fetch(url, gap=3):
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
    redirect = SearchRedirect(gap)
    try:
        with build_opener(redirect).open(request, timeout=30) as response:
            status = response.status
            result = {"http": status, "redirects_followed": len(redirect.hops)}
            if redirect.hops:
                result["final_url"] = redirect.hops[-1]
            if status != 200 or response.headers.get_content_type() not in {"text/html", "application/xhtml+xml"}:
                return None, {**result, "status": "invalid_response"}
            raw = response.read(MAX_BYTES + 1)
            if len(raw) > MAX_BYTES:
                return None, {**result, "status": "invalid_response", "reason": "oversize"}
            return raw, {**result, "status": "received"}
    except UnsafeRedirect as exc:
        return None, {"status": "redirect", "http": exc.status, "redirects_followed": len(redirect.hops)}
    except HTTPError as exc:
        code = exc.code
        meta = refusal_metadata(exc)
        exc.close()
        if code in (401, 403):
            outcome = "access_refused"
        elif code == 429:
            outcome = "rate_limited"
        elif 300 <= code < 400:
            outcome = "redirect"
        elif code in (404, 410):
            outcome = "not_found"
        elif code >= 500:
            outcome = "server_error"
        else:
            outcome = "invalid_response"
        return None, {"status": outcome, "http": code, "redirects_followed": len(redirect.hops), **meta}
    except (OSError, URLError, HTTPException) as exc:
        return None, {"status": "network_error", "reason": type(exc).__name__, "redirects_followed": len(redirect.hops)}


def finalize(out, records, files, reason, target):
    audit = audit_files(MODE, files, include_rows=True)
    selected = audit.pop("rows")[:target]
    count = len(selected)
    # Importer uses exact per-report counts. Overread from the last fetched page stays in the receipt.
    row_report = {"format": MODE, "complete_unique": count, "rows": selected}
    name = "parking-input-2000.json" if count == target else "parking-input-partial.json"
    save_json(out / name, row_report)
    receipt = {"checked_at": now(), "goal": target, "goal_met": count == target, "stop_reason": reason,
               "network_requests_in_record": sum(1 + r.get("redirects_followed", 0) for r in records if r["source"] == "http"),
               "pages_analyzed": len(files), "requests": records, "selected": count,
               "complete_available": audit["complete_unique"], "distinct_identified": audit["distinct_identified"],
               "partial_unique": audit["partial_unique"], "conflicting_unique": audit["conflicting_unique"],
               "repeat_observations": audit["repeat_observations"],
               "missing_fields_on_partial_rows": audit["missing_fields_on_partial_rows"],
               "pages": audit["pages"], "private_output": name}
    save_json(out / "receipt.json", receipt)
    return receipt


def run(args, fetcher=None):
    if fetcher is None:
        fetcher = lambda url: fetch(url, args.gap)
    targets = inventory(args.urls)[:args.max_pages]
    if args.seed_url and (not targets or targets[0] != args.seed_url):
        raise ValueError("--seed-url must equal the first inventory URL")
    args.out.mkdir(parents=True, exist_ok=True, mode=0o700)
    pages = args.out / "pages"
    pages.mkdir(mode=0o700, exist_ok=True)
    ledger = args.out / "journal.json"
    records = json.loads(ledger.read_text()) if ledger.exists() else []
    old = {r["url"]: r for r in records}
    if [r["url"] for r in records] != targets[:len(records)]:
        raise ValueError("saved journal must be an exact prefix of this inventory")
    prior = {}
    if (args.out / "receipt.json").exists():
        prior = json.loads((args.out / "receipt.json").read_text())
    if prior.get("goal_met") and not args.offline:
        return prior
    hard_stop = next((r["status"] for r in records if r["status"] in STOP), None)
    hard_stop = hard_stop or (prior.get("stop_reason") if prior.get("stop_reason") in STOP else None)
    offline = args.offline or bool(hard_stop)
    known_complete, paths = set(), []
    next_gate = TARGET
    unknown_streak = empty_streak = failure_streak = 0
    reason = hard_stop or "inventory_exhausted"
    for i, url in enumerate(targets, 1):
        rec = old.get(url)
        if rec is not None:
            if "file" not in rec:
                if rec["status"] in STOP:
                    reason = rec["status"]
                    break
                continue
            if rec["file"] != f"page-{i:03}.html":
                raise ValueError("unexpected file in saved journal")
            path = pages / rec["file"]
            raw = path.read_bytes()
            if hashlib.sha256(raw).hexdigest() != rec["sha256"]:
                raise ValueError("saved response digest mismatch")
        else:
            if offline:
                reason = hard_stop or "offline_saved_pages_exhausted"
                break
            seed = i == 1 and args.seed_html is not None
            if seed:
                raw = args.seed_html.read_bytes()
                if len(raw) > MAX_BYTES:
                    raise ValueError("seed exceeds page size bound")
                meta = {"status": "received", "http": None}
            else:
                # Space even the first subsequent fetch after a process restart or seed.
                if i > 1:
                    time.sleep(args.gap)
                started = time.monotonic()
                raw, meta = fetcher(url)
                meta["elapsed_seconds"] = round(time.monotonic() - started, 3)
            rec = {"ordinal": i, "url": url, "source": "seed" if seed else "http", "at": now(), **meta}
            records.append(rec)
            if raw is None:
                save_json(ledger, records)
                print(f"page={i} status={rec['status']} HTTP={rec.get('http')}", flush=True)
                if rec["status"] in STOP:
                    reason = rec["status"]
                    break
                failure_streak = failure_streak + 1 if rec["status"] in {"network_error", "server_error"} else 0
                if failure_streak >= 3:
                    reason = "systematic_network_errors"
                    break
                continue
            path = pages / f"page-{i:03}.html"
            write(path, raw)
            rec.update(file=path.name, bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest())
            save_json(ledger, records)
        try:
            body = raw.decode("utf-8-sig", errors="strict")
            rows, _, _, metrics = parse_input(MODE, body)
            status = "verification_signal" if STRONG_TITLE.search(body[:50000]) else metrics["status"]
        except UnicodeDecodeError:
            rows, metrics, status = [], {"observations": 0}, "unrecognized_encoding"
        rec["status"] = status
        rec["observations"] = metrics["observations"]
        if status in {"verification_signal", "verification_mention"} and "file" in rec:
            path.unlink(missing_ok=True)
            rec.pop("file")
        save_json(ledger, records)
        if status in STOP:
            reason = status
            break
        failure_streak = 0
        unknown_streak = unknown_streak + 1 if status not in {"results", "empty_results"} else 0
        empty_streak = empty_streak + 1 if status == "empty_results" else 0
        # Even a page with no usable row can explicitly invalidate an ID seen earlier.
        # Keep it in the final reconciliation without ever joining partial observations.
        if status == "conflict":
            paths.append(path)
        if unknown_streak >= 3 or empty_streak >= 5:
            reason = "systematic_unrecognized" if unknown_streak >= 3 else "systematic_empty"
            break
        if status != "results":
            continue
        paths.append(path)
        known_complete.update(r["source_id"] for r in rows if all(r[k] is not None for k in FIELDS))
        print(f"page={i} status={status} cards={metrics['observations']} candidate_ids={len(known_complete)}", flush=True)
        if len(known_complete) >= next_gate:
            audit = audit_files(MODE, paths)
            if audit["complete_unique"] >= TARGET:
                reason = "target_met"
                break
            next_gate = len(known_complete) + TARGET - audit["complete_unique"]
    return finalize(args.out, records, paths, reason, TARGET)


def main():
    os.umask(0o077)
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--urls", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--gap", type=float, default=3)
    p.add_argument("--max-pages", type=int, default=140)
    p.add_argument("--seed-url")
    p.add_argument("--seed-html", type=Path)
    p.add_argument("--offline", action="store_true")
    args = p.parse_args()
    if not (3 <= args.gap <= 120 and 1 <= args.max_pages <= 160):
        p.error("gap must be between 3 and 120 seconds, max-pages between 1 and 160")
    if bool(args.seed_url) != bool(args.seed_html):
        p.error("seed requires both URL and body")
    try:
        receipt = run(args)
    except (OSError, ValueError) as exc:
        print(f"collection error: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({k: receipt[k] for k in ("stop_reason", "pages_analyzed", "complete_available", "selected")}), flush=True)
    return 0 if receipt["goal_met"] else 1


if __name__ == "__main__":
    sys.exit(main())
