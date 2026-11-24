#!/usr/bin/env bash
# Each run creates a new, isolated Compose project and removes only that test's resources.
set -euo pipefail
cd "$(dirname "$0")"
mode=${1:-core}
case "$mode" in
  core|web|renderer|reference) ;;
  *) echo "Usage: $0 core|web|renderer|reference" >&2; exit 2 ;;
esac
export COMPOSE_PROJECT_NAME="reader-smoke-$(python3 -c 'import secrets; print(secrets.token_hex(6))')"
export READER_PORT=0
export READER_ALLOWED_HOSTS=
export READER_SEARXNG_URL=
export SEARXNG_SECRET
SEARXNG_SECRET=$(python3 -c 'import secrets; print(secrets.token_hex(32))')

cleanup() {
  status=$?
  trap - EXIT
  if [[ $status -ne 0 ]]; then
    docker compose --profile '*' logs --no-color --tail=50 >&2 || true
  fi
  docker compose --profile '*' down --volumes --remove-orphans >/dev/null || true
  exit "$status"
}
trap cleanup EXIT

case "$mode" in
  core)
    if [[ ${READER_PUBLIC_DEMO:-0} == 1 ]]; then
      export READER_ALLOWED_HOSTS=example.com
    fi
    docker compose up -d --build reader
    docker compose run --rm --no-deps -T -v "$PWD:/checks:ro" -w /checks reader \
      python -m unittest -v test_app test_documents test_binary_documents test_fetch_document test_search_index test_web_search
    address=$(docker compose port reader 8788)
    python3 - "$address" <<'PY'
import json
import sys
import time
import os
from urllib.error import HTTPError
from urllib.request import Request, urlopen

base = "http://" + sys.argv[1]
def call(path, payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    req = Request(base + path, body, headers={"Content-Type": "application/json", "Accept": "application/json"})
    with urlopen(req, timeout=10) as response:
        return json.load(response)

for _ in range(60):
    try:
        if call("/health")["status"] == "ok":
            break
    except OSError:
        pass
    time.sleep(1)
else:
    raise SystemExit("Reader did not become ready")

source = "https://fixture.example/test"
document = {"url": source, "html": "<html><head><title>Fiche</title></head><body><main><h1>Essai</h1><p>AutoFindexCamille</p></main></body></html>"}
converted = call("/", document)["data"]
assert converted["url"] == source and "AutoFindexCamille" in converted["content"]
indexed = call("/v1/index", document)["data"]
assert indexed["sha256"] == converted["sha256"]
rows = call("/v1/search?q=AutoFindexCamille")["data"]
assert len(rows) == 1 and rows[0]["url"] == source
print("PASS container: HTML read, SHA-256, index and search via loopback HTTP.")
if os.getenv("READER_PUBLIC_DEMO") == "1":
    try:
        req = Request(base + "/https://example.com/", headers={"Accept": "application/json"})
        with urlopen(req, timeout=35) as resp:
            page = json.load(resp)["data"]
        if page["title"] == "Example Domain" and "# Example Domain" in page["content"]:
            print("LIVE PASS: example.com read from the public origin; title and Markdown heading verified.")
        else:
            print("LIVE MISMATCH: example.com response did not contain the expected title and Markdown heading.")
    except HTTPError as exc:
        print("LIVE UNAVAILABLE: example.com, HTTP", exc.code, exc.read(300).decode(errors="replace"))
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print("LIVE UNAVAILABLE: example.com,", type(exc).__name__, str(exc)[:200])
PY
    ;;
  web)
    export READER_SEARXNG_URL=http://searxng:8080
    docker compose --profile web up -d --build reader searxng
    docker compose exec -T -e READER_PUBLIC_DEMO="${READER_PUBLIC_DEMO:-0}" reader python - <<'PY'
import json
import os
import time
from urllib.error import HTTPError
from urllib.request import urlopen

base = os.environ["READER_SEARXNG_URL"]
for _ in range(120):
    try:
        with urlopen(base + "/healthz", timeout=3) as response:
            if response.read().strip() == b"OK":
                break
    except OSError:
        pass
    time.sleep(1)
else:
    raise SystemExit("SearXNG did not become ready via its internal network")
with urlopen(base + "/config", timeout=5) as response:
    config = json.load(response)
engines = {e["name"]: e["enabled"] for e in config["engines"]}
assert engines == {"wikipedia": True}, engines
with urlopen("http://127.0.0.1:8788/health", timeout=5) as response:
    assert json.load(response)["webSearchConfigured"] is True
# The JSON format is checked before the missing query is rejected.
# This exercises the actual SearXNG handler without contacting a public search engine.
try:
    with urlopen(base + "/search?format=json", timeout=5) as response:
        raise RuntimeError(f"unexpected status {response.status}")
except HTTPError as exc:
    assert exc.status == 400, exc.status
print("PASS container: SearXNG health, live engine settings, JSON search handler and Reader configuration.")
if os.getenv("READER_PUBLIC_DEMO") == "1":
    try:
        # One query via our own Reader; no hydration or detail-page requests.
        with urlopen("http://127.0.0.1:8788/v1/search/web?q=Porsche%20911&limit=1&read=0", timeout=20) as response:
            rows = json.load(response)["data"]
        if rows:
            print("LIVE PASS: Wikipedia via Reader, results =", len(rows), "first title =", rows[0]["title"][:160])
        else:
            print("LIVE EMPTY: Wikipedia via Reader returned zero results.")
    except HTTPError as exc:
        print("LIVE UNAVAILABLE: Wikipedia via Reader, HTTP", exc.code, exc.read(300).decode(errors="replace"))
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print("LIVE UNAVAILABLE: Wikipedia via Reader,", type(exc).__name__, str(exc)[:200])
PY
    ;;
  renderer)
    docker compose --profile render up -d --build reader renderer
    docker compose exec -T renderer python render_worker.py --check-install
    docker compose run --rm --no-deps -T -v "$PWD:/checks:ro" -w /checks renderer python -m unittest -v test_render_worker
    docker compose exec -T reader python - <<'PYRENDER'
import json
import os
import pathlib
import time
from urllib.request import Request, urlopen

for _ in range(60):
    try:
        with urlopen("http://127.0.0.1:8788/health", timeout=2) as response:
            ready = response.status == 200
        if ready and pathlib.Path(os.environ["READER_RENDER_SOCKET"]).is_socket():
            break
    except OSError:
        pass
    time.sleep(1)
else:
    raise SystemExit("Reader or renderer socket did not become ready")
html = "<!doctype html><main id='root'></main><script>const p=document.createElement('p');p.id='done';p.textContent='AutoFindexCamille';document.querySelector('#root').appendChild(p)</script>"
for fmt in ("markdown", "screenshot"):
    payload = json.dumps({"html": html, "format": fmt, "selector": "#done"}).encode()
    req = Request("http://127.0.0.1:8788/v1/render", payload, headers={"Content-Type":"application/json", "Accept":"application/json"})
    with urlopen(req, timeout=30) as response:
        if fmt == "screenshot":
            assert response.headers.get_content_type() == "image/png"
            assert response.read(8) == bytes.fromhex("89504e470d0a1a0a")
        else:
            assert "AutoFindexCamille" in json.load(response)["data"]["content"]
print("PASS renderer: dynamic uploaded DOM converted to Markdown and PNG via the isolated socket.")
PYRENDER
    ;;
  reference)
    docker compose --profile reference up -d reference
    docker compose exec -T reference node --input-type=module - <<'JS'
const endpoint = 'http://127.0.0.1:8081/';
const end = Date.now() + 120000;
let ready = false;
while (Date.now() < end) {
  try {
    const r = await fetch(endpoint, { signal: AbortSignal.timeout(3000) });
    await r.body?.cancel();
    ready = true; break;
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 1000));
}
if (!ready) throw Error("Official Jina Reader did not become ready on loopback");
const marker = 'AutoFindexCamille';
const html = '<html><head><title>Fiche véhicule</title></head><body><main><h1>Essai</h1><p>' + marker + '</p></main></body></html>';
// With no url, Jina computes a blob: source from the HTML bytes and skips DNS.
const r = await fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Respond-With': 'markdown' },
  body: JSON.stringify({ html }), signal: AbortSignal.timeout(30000),
});
const raw = await r.text();
if (!r.ok) throw Error('Jina HTTP ' + r.status + ': ' + raw.slice(0, 600));
const payload = JSON.parse(raw);
if (!payload?.data?.content?.includes(marker)) throw Error('Jina content missing: ' + raw.slice(0, 600));
console.log('PASS reference: official pinned Jina container converted uploaded HTML with no external network.');
JS
    ;;
esac
