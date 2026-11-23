#!/usr/bin/env python3
"""Isolated, bounded comparison. Never retries blocked pages or logs listing bodies."""
import argparse
import asyncio
import hashlib
import html
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

CAP = 100
GAP = 10
BUDGET_SECONDS = 25 * 60
URL_RE = re.compile(r"https://www\.leboncoin\.fr/ad/voitures/([0-9]{8,12})(?![0-9])")
BLOCK = re.compile(r"(you have been blocked|access denied|verify (you are|that you)|captcha.*(challenge|verification)|datadome device check|désolé.*bloqué)", re.I)
PRICE = re.compile(r"(?<!\w)(?:[0-9]{1,3}(?:[\s.,\xa0][0-9]{3})+|[0-9]{4,7})\s*(?:€|EUR)(?!\w)", re.I)
KM = re.compile(r"\b[0-9]{1,3}(?:[\s.,\xa0]?[0-9]{3})+\s*km\b", re.I)
YEAR = re.compile(r"\b(?:19[89][0-9]|20[012][0-9])\b")
CAR = re.compile(r"\b(porsche|mercedes|audi|bmw|peugeot|renault|volkswagen|kia|toyota|ford|fiat|tesla|nissan|citro[eë]n|volvo|hyundai|mazda)\b", re.I)

def digest(value):
    return hashlib.sha256(str(value).encode()).hexdigest()

def extract_links(body):
    return ["https://www.leboncoin.fr/ad/voitures/" + i for i in URL_RE.findall(html.unescape(body))]

def classify(body, status=None):
    body = str(body)[:500_000]
    plain = re.sub(r"<[^>]+>", " ", body)
    compact = html.unescape(plain).replace("\u202f", " ")
    fields = {
        "brand_hint": bool(CAR.search(compact)),
        "price_hint": bool(PRICE.search(compact)),
        "mileage_hint": bool(KM.search(compact)),
        "year_hint": bool(YEAR.search(compact)),
    }
    if status in (403, 429):
        return "refused", fields
    if re.search(r"(you have been blocked|datadome device check|access denied)", compact[:12_000], re.I):
        return "verification", fields
    if BLOCK.search(compact[:12_000]) and not (fields["price_hint"] and fields["mileage_hint"]):
        return "verification", fields
    if all(fields.values()):
        return "complete", fields
    if fields["price_hint"] and fields["brand_hint"]:
        return "partial", fields
    return "no_vehicle_data", fields

class Bench:
    def __init__(self, name, source_urls):
        self.name = name
        self.frontier = list(dict.fromkeys(source_urls))
        self.seen = set()
        self.start = time.monotonic()
        self.last = None
        self.rows = []
        self.reason = None
        self.search_results = 0
        self.search_unique = set()
        self.search_complete = 0

    def ready(self):
        if self.reason is not None or len(self.rows) >= CAP:
            return False
        if time.monotonic() - self.start >= BUDGET_SECONDS:
            self.reason = "time_budget"
            return False
        return True

    def delay(self):
        if self.last is not None:
            remaining = GAP - (time.monotonic() - self.last)
            if remaining > 0:
                time.sleep(remaining)

    def add(self, target, outcome, status=None, fields=None, body="", duration=None):
        self.rows.append({
            "ordinal": len(self.rows) + 1,
            "url_sha256": digest(target),
            "status": status,
            "outcome": outcome,
            "fields": fields or {},
            "content_sha256": digest(body) if body else None,
            "duration_seconds": round(duration or 0, 3),
        })
        self.last = time.monotonic()
        if outcome in ("refused", "verification", "provider_quota", "environment_error"):
            self.reason = outcome

    def next_url(self):
        while self.frontier:
            u = self.frontier.pop(0)
            if u not in self.seen and URL_RE.fullmatch(u):
                self.seen.add(u)
                return u
        return None

    def consider_links(self, body):
        for u in extract_links(body):
            if len(self.seen) + len(self.frontier) >= 500:
                break
            if u not in self.seen and u not in self.frontier:
                self.frontier.append(u)

    def search_ad(self, ad):
        u = getattr(ad, "url", None) if not isinstance(ad, dict) else ad.get("url")
        title = getattr(ad, "subject", None) if not isinstance(ad, dict) else ad.get("subject")
        price = getattr(ad, "price", None) if not isinstance(ad, dict) else ad.get("price")
        if not isinstance(u, str) or not URL_RE.fullmatch(u):
            return False
        if u in self.search_unique or len(self.search_unique) >= CAP:
            return False
        self.search_unique.add(u)
        self.search_results += 1
        if title and price is not None:
            self.search_complete += 1  # basic search-card fields only; not a detailed vehicle record
        return True

    def output(self, out_dir, installed=True):
        outcomes = {}
        for row in self.rows:
            outcomes[row["outcome"]] = outcomes.get(row["outcome"], 0) + 1
        report = {
            "schema_version": "autofindex-free-benchmark/v1",
            "method": self.name,
            "cap": CAP,
            "installed": installed,
            "attempted_detail_pages": len(self.rows),
            "complete_detail_pages": outcomes.get("complete", 0),
            "partial_detail_pages": outcomes.get("partial", 0),
            "search_cards_returned": self.search_results,
            "search_cards_with_title_price": self.search_complete,
            "source_refusals": outcomes.get("refused", 0),
            "verification_pages": outcomes.get("verification", 0),
            "outcomes": outcomes,
            "stop_reason": self.reason or ("cap_reached" if len(self.rows) >= CAP or self.search_results >= CAP else "candidates_exhausted"),
            "candidate_urls": len(self.seen) + len(self.frontier),
            "duration_seconds": round(time.monotonic() - self.start, 2),
            "source_access_approved": False,
            "database_updated": False,
            "source_request_count": "not_measured_for_embedded_page_assets",
            "rows": self.rows,
        }
        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        (out / f"{self.name}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        public = {k: v for k, v in report.items() if k != "rows"}
        print("AUTOFINDEX_BENCH " + json.dumps(public, ensure_ascii=False), flush=True)
        return report

def fetch_jina(u):
    req = urllib.request.Request("https://r.jina.ai/" + u,
                                 headers={"Accept": "text/plain"})
    try:
        with urllib.request.urlopen(req, timeout=35) as response:
            return response.status, response.read(500_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read(8000).decode("utf-8", "replace")

def run_details(bench, getter):
    while bench.ready():
        u = bench.next_url()
        if not u:
            break
        bench.delay()
        at = time.monotonic()
        try:
            status, body = getter(u)
            outcome, fields = classify(body, status)
            if status == 429:
                outcome = "provider_quota"
            bench.add(u, outcome, status, fields, body, time.monotonic() - at)
            if outcome not in ("refused", "verification", "provider_quota", "environment_error"):
                bench.consider_links(body)
        except Exception as exc:
            message = str(exc).lower()
            outcome = "refused" if ("403" in message or "forbidden" in message) else "environment_error"
            bench.add(u, outcome, None, {"exception": type(exc).__name__}, "", time.monotonic()-at)

def run_lbc(bench, finder=False):
    import lbc
    if finder:
        # Finder is a scheduler built on exactly this lbc client, not another network route.
        folder = os.environ.get("LBC_FINDER_DIR", "")
        if folder:
            sys.path.insert(0, folder)
        from model import Search, Parameters
        assert Search and Parameters
    client = lbc.Client()
    for page in range(1, 5):
        if not bench.ready() or bench.search_results >= CAP:
            break
        bench.delay()
        at = time.monotonic()
        try:
            result = client.search(text="Porsche", category=lbc.Category.VEHICULES_VOITURES,
                                   page=page, limit=min(35, CAP - bench.search_results),
                                   sort=lbc.Sort.NEWEST)
            items = list(getattr(result, "ads", []))
            for ad in items:
                bench.search_ad(ad)
            bench.last = time.monotonic()
            if not items:
                bench.reason = "empty_search"
                break
        except Exception as exc:
            message = str(exc).lower()
            reason = "refused" if ("403" in message or "datadome" in message or "forbidden" in message) else "environment_error"
            bench.add(f"search:{page}", reason, None, {"exception": type(exc).__name__}, "", time.monotonic()-at)
            break

def run_lbc_api(bench):
    import subprocess
    import signal
    root = os.environ.get("LBC_API_DIR")
    if not root or not Path(root).is_dir():
        raise RuntimeError("LBC_API_DIR missing")
    process = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app",
                                "--host", "127.0.0.1", "--port", "18765"],
                               cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               start_new_session=True)
    try:
        ok = False
        for _ in range(40):
            if process.poll() is not None:
                break
            try:
                with urllib.request.urlopen("http://127.0.0.1:18765/health", timeout=2) as response:
                    if response.status == 200:
                        ok = True
                        break
            except Exception:
                time.sleep(.25)
        if not ok:
            raise RuntimeError("local API not ready")
        for page in range(1, 5):
            if not bench.ready() or bench.search_results >= CAP:
                break
            bench.delay()
            payload = json.dumps({"text": "Porsche", "page": page,
                                  "limit": min(35, CAP - bench.search_results)}).encode()
            request = urllib.request.Request("http://127.0.0.1:18765/v1/search/cars",
                                             data=payload, method="POST",
                                             headers={"Content-Type": "application/json"})
            at = time.monotonic()
            try:
                with urllib.request.urlopen(request, timeout=40) as response:
                    data = json.load(response)
                ads = data.get("ads", []) if isinstance(data, dict) else []
                for ad in ads:
                    bench.search_ad(ad)
                bench.last = time.monotonic()
                if not ads:
                    bench.reason = "empty_search"
                    break
            except urllib.error.HTTPError as exc:
                body = exc.read(6000).decode("utf-8", "replace")
                outcome = "refused" if exc.code in (403, 429) or "403" in body or "datadome" in body.lower() else "environment_error"
                bench.add("search:"+str(page), outcome, exc.code,
                          {"provider_error": True}, "", time.monotonic() - at)
                break
    finally:
        try: os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError: pass
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()

def run_scrapling(bench):
    from scrapling.fetchers import StealthySession
    # No CAPTCHA solver, custom fingerprint, login, proxies, or retry.
    with StealthySession(headless=True) as session:
        def read(u):
            page = session.fetch(u)
            status = getattr(page, "status", None)
            body = getattr(page, "body", b"")
            if isinstance(body, bytes):
                body = body.decode("utf-8", "replace")
            return status, str(body)
        run_details(bench, read)

async def crawl4ai_async(bench):
    from crawl4ai import AsyncWebCrawler
    async with AsyncWebCrawler() as crawler:
        while bench.ready():
            u = bench.next_url()
            if not u: break
            bench.delay()
            at = time.monotonic()
            try:
                item = await crawler.arun(url=u)
                status = getattr(item, "status_code", None)
                body = str(getattr(item, "html", "") or getattr(item, "markdown", ""))
                outcome, fields = classify(body, status)
                if getattr(item, "success", True) is False and outcome not in ("refused", "verification"):
                    outcome = "environment_error"
                bench.add(u, outcome, status, fields, body, time.monotonic()-at)
                if outcome in ("refused", "verification", "environment_error"):
                    break
                bench.consider_links(body)
            except Exception as exc:
                reason = "refused" if ("403" in str(exc) or "datadome" in str(exc).lower()) else "environment_error"
                bench.add(u, reason, None, {"exception": type(exc).__name__}, "", time.monotonic()-at)

async def crawlee_async(bench):
    from crawlee.crawlers import PlaywrightCrawler
    while bench.ready():
        u = bench.next_url()
        if not u: break
        bench.delay()
        at = time.monotonic()
        page_values = []
        crawler = PlaywrightCrawler(max_requests_per_crawl=1, max_request_retries=0,
                                  max_concurrency=1)
        @crawler.router.default_handler
        async def handler(context):
            response = getattr(context, "response", None)
            status = getattr(response, "status", None)
            content = await context.page.content()
            page_values.append((status, content))
        try:
            await crawler.run([u])
            if not page_values:
                raise RuntimeError("Crawler returned no page data")
            status, body = page_values[0]
            outcome, fields = classify(body, status)
            bench.add(u, outcome, status, fields, body, time.monotonic()-at)
            if outcome in ("refused", "verification"):
                break
            bench.consider_links(body)
        except Exception as exc:
            msg = str(exc).lower()
            reason = "refused" if ("403" in msg or "datadome" in msg) else "environment_error"
            bench.add(u, reason, None, {"exception":type(exc).__name__}, "", time.monotonic()-at)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--method", required=True, choices=["jina", "lbc", "lbc-finder", "lbc-api",
                                                          "scrapling", "crawl4ai", "crawlee", "cloudflare"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--seeds", default=str(Path(__file__).with_name("free-benchmark-seeds.json")))
    args = ap.parse_args()
    urls = json.loads(Path(args.seeds).read_text(encoding="utf-8"))
    assert isinstance(urls, list) and len(urls) >= 3 and len(urls) == len(set(urls))
    assert all(URL_RE.fullmatch(u) for u in urls)
    bench = Bench(args.method, urls)
    installed = True
    try:
        if args.method == "jina":
            run_details(bench, fetch_jina)
        elif args.method in ("lbc", "lbc-finder"):
            run_lbc(bench, args.method == "lbc-finder")
        elif args.method == "lbc-api":
            run_lbc_api(bench)
        elif args.method == "scrapling":
            run_scrapling(bench)
        elif args.method == "crawl4ai":
            asyncio.run(crawl4ai_async(bench))
        elif args.method == "crawlee":
            asyncio.run(crawlee_async(bench))
        else:
            installed = False
            bench.reason = "cloudflare_account_and_token_required"
    except Exception as exc:
        installed = False
        bench.reason = "installation_or_api_error"
        bench.rows.append({"ordinal":0, "status":None, "outcome":"environment_error",
                           "exception_type":type(exc).__name__})
    bench.output(args.out, installed)

if __name__ == "__main__":
    main()
