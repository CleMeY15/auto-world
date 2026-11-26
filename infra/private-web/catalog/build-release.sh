#!/bin/sh
set -eu
# Run on the source tree already installed from the frozen pnpm lock by the publisher.
mode=${1:-}
if [ "$mode" != build ] && [ "$mode" != verify ]; then exit 64; fi
if [ "$(id -u)" = 0 ]; then echo 'Une identité de build non privilégiée est requise.' >&2; exit 1; fi
cd "$(dirname "$0")/../../.."
PATH="/opt/aw-private-node/bin:$PATH"
export PATH
if [ "$(node --version)" != v22.23.2 ]; then echo 'Version Node de la livraison incompatible.' >&2; exit 1; fi
if [ "$mode" = build ]; then
    if [ "$(pnpm --version)" != 10.15.0 ]; then echo 'Version pnpm incompatible.' >&2; exit 1; fi
    NEXT_PUBLIC_PRIVATE_WEB=1 NEXT_TELEMETRY_DISABLED=1 pnpm exec turbo run build \
        --concurrency=1 --filter=@auto-world/source-registry --filter=@auto-world/web
fi
test -s apps/web/.next/BUILD_ID
test -s apps/web/.next/server/app/catalogue/page.js
test -s 'apps/web/.next/server/app/catalogue/[id]/page.js'
test -s connectors/leboncoin-spike/rust-export/catalog_page.sql
test -s connectors/leboncoin-spike/rust-export/migrations/0004-catalog-provenance.up.sql
test -s packages/source-registry/dist/index.js
/opt/aw-private-node/bin/node --input-type=module <<'JS'
import { catalogPublicationGrant } from "./packages/source-registry/bin/catalog-publication-grant.mjs";
if (typeof catalogPublicationGrant !== "function") throw Error("Registry package missing");
const { createRequire } = await import("node:module");
const appRequire = createRequire(new URL("./apps/web/package.json", import.meta.url));
appRequire("next");
JS
if [ "$mode" = verify ]; then
/usr/bin/python3 -I -B - <<'PY'
import runpy
try:
    import gunicorn, psycopg2
except ImportError:
    raise SystemExit("Le Python système du lecteur exige python3-gunicorn et python3-psycopg2.")
module = runpy.run_path("services/private-catalog/catalog_reader.py")
if not callable(module["application"]):
    raise SystemExit("Reader application missing")
PY
fi
echo 'Paquet catalogue, dépendances et routes de production vérifiés.'
