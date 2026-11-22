import assert from "node:assert/strict";
import test from "node:test";
import { createServer, get } from "node:http";
import { performance } from "node:perf_hooks";
import { once } from "node:events";
import { parseSourceRegistry } from "@auto-world/source-registry";
import { systemScheduler } from "@auto-world/connector-sdk";
import { NOW, SOURCE, fakeLease, registry } from "../../_sdk/test-support/fixtures.mjs";
import { syntheticStore } from "../../_sdk/test-support/store.mjs";
import { runWithTransport } from "../dist/runner.js";
import { digest } from "../dist/manifest.js";
import * as publicApi from "../dist/index.js";

const origin = "https://inventory.example";
const seed = (id) => ({ sourceListingId: id, url: `${origin}/cars/${id}` });
const manifest = (ids = ["car-1"]) => ({ schemaVersion: 1, sourceId: SOURCE, territory: "FR", origin,
  maxBodyBytes: 32768, entries: ids.map(seed) });
const request = (invocationKey = "owned-1") => ({ schemaVersion: 1, audience: "internal",
  fields: ["source_listing_id", "url", "price", "mileage", "vin"], mode: "full", invocationKey,
  limits: { maxPages: 10, maxItems: 100, maxRunMs: 30000, maxEffectMs: 5000, maxPageBytes: 65536, maxJsonDepth: 8, maxJsonMembers: 1000 } });
const html = (price = "12345.67") => `<!doctype html><html><head><title>Owned fictitious fixture</title>
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Car",
  name: "Fictitious test vehicle", offers: { "@type": "Offer", price, priceCurrency: "EUR" },
  mileageFromOdometer: { "@type": "QuantitativeValue", value: 45000, unitCode: "KMT" },
  vehicleIdentificationNumber: "WVWZZZ1JZXW000001" })}</script></head><body>Not a real advertisement.</body></html>`;

function crawlRegistry(mode = "explicit_tombstone") {
  const source = globalThis.structuredClone(registry());
  for (const revision of source.revisions) {
    const configuration = revision.configuration;
    configuration.acquisitionMethods = ["crawl"];
    configuration.legalStatus = "permitted_crawl";
    configuration.policy.grants[0].acquisitionMethod = "crawl";
    Object.assign(configuration.operations, { deletionMode: mode, timeoutMs: 5000, maxRetries: 0, requestsPerMinute: 60000 });
  }
  const parsed = parseSourceRegistry(source);
  assert.equal(parsed.success, true, JSON.stringify(parsed));
  return parsed.data;
}

async function harness(t) {
  const trace = [], events = [], received = [];
  const pages = new Map([["/cars/car-1", { status: 200, body: html() }], ["/cars/car-2", { status: 200, body: html("20000") }]]);
  const server = createServer((incoming, response) => {
    received.push(incoming.url);
    const page = pages.get(incoming.url) ?? { status: 404, body: "missing" };
    response.writeHead(page.status, { "Content-Type": "text/html; charset=utf-8" });
    response.end(page.body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const port = server.address().port;
  const started = performance.now();
  const time = { clock: { nowMs: () => NOW + Math.floor(performance.now() - started) }, scheduler: systemScheduler };
  const store = syntheticStore(time, trace);
  let source = crawlRegistry();
  const ports = {
    authority: { async loadVerifiedCurrent(input) {
      trace.push("authority");
      return { trust: "authenticated_current", registry: source, authorityRevision: 2,
        verifiedAsOf: input.asOf, authorizationBasisRef: "evidence_sdk_synthetic" };
    } },
    lease: fakeLease(time, trace), store: store.port, clock: time.clock, scheduler: time.scheduler,
    random: { next: () => 0 }, telemetry: { emit(event) { events.push(event); } },
  };
  // Test-only: map this one logical source to our own loopback fixture. Production
  // package exports have no such exception and always use public HTTPS/TLS.
  const transport = { async capture(input) {
    assert.equal(new URL(input.url).origin, origin);
    trace.push("http");
    return new Promise((resolve, reject) => {
      const req = get({ hostname: "127.0.0.1", port, path: new URL(input.url).pathname, signal: input.signal }, (response) => {
        if (response.statusCode !== 200) { response.resume(); resolve({ success: false, kind: "terminal" }); return; }
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > input.maxBytes) { response.destroy(); resolve({ success: false, kind: "terminal" }); return; }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => resolve({ success: true, body: new Uint8Array(Buffer.concat(chunks)), contentType: "text/html", status: 200 }));
      });
      req.on("error", reject);
    });
  } };
  return { pages, trace, events, received, store, ports, transport, setSource(value) { source = value; },
    run: (key = "owned-1", seeds = manifest(), custom = request(key)) => runWithTransport(custom, seeds, ports, transport) };
}

test("public package exports only the guarded acquisition entry point", () => {
  assert.deepEqual(Object.keys(publicApi), ["runSeededHttpConnector"]);
});

test("owned HTTP body is staged exactly before normalized observations and stable URL", async (t) => {
  const h = await harness(t);
  const result = await h.run();
  assert.equal(result.result.status, "completed", JSON.stringify(result));
  assert.equal(result.coverage, "seed_manifest_only");
  assert.equal(result.requestedPages, 1);
  const state = h.store.snapshot();
  assert.equal(state.raw.size, 1);
  assert.equal(state.observations.size, 3);
  const raw = [...state.raw.values()][0];
  const envelope = JSON.parse(new globalThis.TextDecoder().decode(raw.bytes));
  assert.equal(Buffer.from(envelope.bodyBase64, "base64").toString("utf8"), html());
  assert.equal(envelope.bodySha256, digest(Buffer.from(html())));
  assert.equal(raw.pending.sha256, digest(raw.bytes));
  assert.ok(h.trace.indexOf("store.raw.staged") < h.trace.indexOf("store.page.committed"));
  const values = [...state.observations.values()];
  assert.equal(values.find((item) => item.field === "price").value.amountMinor, 1234567);
  assert.ok(values.every((item) => item.provenance.raw.sha256 === raw.pending.sha256));
});

test("completed replay does not refetch; a later run appends a new price observation", async (t) => {
  const h = await harness(t);
  const first = await h.run();
  assert.equal(first.result.status, "completed");
  const replay = await h.run();
  assert.deepEqual(replay.result, first.result);
  assert.equal(h.received.length, 1);
  h.pages.set("/cars/car-1", { status: 200, body: html("11900.00") });
  assert.equal((await h.run("owned-2")).result.status, "completed");
  assert.deepEqual([...h.store.snapshot().observations.values()].filter((item) => item.field === "price").map((item) => item.value.amountMinor), [1234567, 1190000]);
  assert.equal(h.received.length, 2);
});

test("changed manifest conflicts with a reused invocation key before another fetch", async (t) => {
  const h = await harness(t);
  assert.equal((await h.run()).result.status, "completed");
  const conflict = await h.run("owned-1", manifest(["car-2"]));
  assert.equal(conflict.result.status, "failed");
  assert.equal(conflict.result.error.code, "idempotency_conflict");
  assert.equal(h.received.length, 1);
});

test("interrupted commit resumes staged original bytes without a second HTTP request", async (t) => {
  const h = await harness(t);
  h.store.faults.set("page.committed", "before");
  assert.equal((await h.run()).result.status, "failed");
  assert.equal(h.store.snapshot().raw.size, 1);
  assert.equal(h.store.snapshot().observations.size, 0);
  h.pages.set("/cars/car-1", { status: 200, body: html("1.00") });
  const resumed = await h.run();
  assert.equal(resumed.result.status, "completed", JSON.stringify(resumed));
  assert.equal(h.received.length, 1);
  assert.equal([...h.store.snapshot().observations.values()].find((item) => item.field === "price").value.amountMinor, 1234567);
});

test("a smaller seed manifest never withdraws other known listings", async (t) => {
  const h = await harness(t);
  assert.equal((await h.run("owned-1", manifest(["car-1", "car-2"]))).result.status, "completed");
  assert.equal((await h.run("owned-2", manifest(["car-1"]))).result.status, "completed");
  const state = h.store.snapshot();
  assert.equal(state.tombstones.size, 0);
  assert.deepEqual([...state.inventories.values()][0].activeSourceListingIds, ["car-1", "car-2"]);
});

test("full-reconciliation policies are rejected before network acquisition", async (t) => {
  const h = await harness(t);
  for (const mode of ["both", "full_reconciliation"]) {
    h.setSource(crawlRegistry(mode));
    const result = await h.run();
    assert.equal(result.result.status, "failed");
    assert.equal(result.result.error.code, "authority_untrusted");
  }
  assert.equal(h.received.length, 0);
});

test("policy is guarded again before finalizing a seed manifest", async (t) => {
  const h = await harness(t);
  h.store.hooks.set("page.committed", (phase) => { if (phase === "prepared") h.setSource(crawlRegistry("both")); });
  const result = await h.run();
  assert.equal(result.result.status, "failed");
  assert.equal(result.result.error.code, "authority_untrusted");
  assert.equal(h.store.snapshot().tombstones.size, 0);
});

test("unsupported HTML remains in raw evidence and never becomes an empty successful catalogue", async (t) => {
  const h = await harness(t);
  h.pages.set("/cars/car-1", { status: 200, body: "<html><body>Access denied</body></html>" });
  const result = await h.run();
  assert.equal(result.result.status, "failed");
  assert.equal(result.result.error.phase, "map");
  assert.equal(h.store.snapshot().raw.size, 1);
  assert.equal(h.store.snapshot().observations.size, 0);
});

test("403 and 404 do not create sold/withdrawn records or replace known prices", async (t) => {
  const h = await harness(t);
  assert.equal((await h.run()).result.status, "completed");
  for (const status of [403, 404]) {
    h.pages.set("/cars/car-1", { status, body: "unavailable" });
    assert.equal((await h.run(`owned-${status}`)).result.status, "failed");
  }
  const state = h.store.snapshot();
  assert.equal(state.observations.size, 3);
  assert.equal(state.tombstones.size, 0);
  assert.equal([...state.projections.values()][0].state, "active");
});

test("invalid limits or unsupported fields have no acquisition side effects", async (t) => {
  const h = await harness(t);
  const limited = request(); limited.limits.maxPages = 1;
  assert.equal((await h.run("owned-1", manifest(["car-1", "car-2"]), limited)).result.error.code, "invalid_request");
  const unsupported = request(); unsupported.fields.push("power");
  assert.equal((await h.run("owned-1", manifest(), unsupported)).result.error.code, "invalid_request");
  assert.equal(h.received.length, 0);
  assert.equal(h.store.snapshot().raw.size, 0);
});

test("telemetry excludes source URL, body text and VIN", async (t) => {
  const h = await harness(t);
  assert.equal((await h.run()).result.status, "completed");
  const events = JSON.stringify(h.events);
  assert.ok(h.events.some((item) => item.kind === "raw.staged"));
  for (const sensitive of [origin, "WVWZZZ1JZXW000001", "Fictitious test vehicle", "bodyBase64"]) assert.equal(events.includes(sensitive), false);
});
