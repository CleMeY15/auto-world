import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import { createDemoApi } from "../dist/index.js";
import { createSyntheticDemoReadPort } from "../demo/createSyntheticDemoReadPort.mjs";

const NOW = "2026-10-12T00:00:00.000Z";
const LISTING_ID = "lst_socket_lifecycle";

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  assert.equal(typeof address, "object");
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function rawRequest(port, headers, body, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, method: options.method ?? "POST", path: options.path ?? "/v1/demo/search", headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.once("error", reject);
    request.end(body);
  });
}

function response(overrides = {}) {
  return {
    schemaVersion: 1,
    dataMode: "synthetic",
    fixtureVersion: "fixture-v1",
    dataAsOf: NOW,
    state: "complete",
    results: [{ listingId: LISTING_ID, availability: "active", price: { status: "unavailable" }, mileage: { status: "unavailable" }, evidence: [] }],
    totalCount: 1,
    ...overrides,
  };
}

async function listen(readPort, options = {}) {
  const port = await availablePort();
  const app = createDemoApi({ readPort, clock: options.clock ?? (() => new Date(NOW)), requestIds: () => "req_33333333333333333333333333333333", telemetry: options.telemetry, loopbackPolicy: { boundPort: port } });
  await app.listen({ host: "127.0.0.1", port });
  return { app, port };
}

function searchRequest(port, body = '{"schemaVersion":1,"sort":"listing_asc"}') {
  return rawRequest(port, { host: `127.0.0.1:${port}`, "content-type": "application/json", "content-length": Buffer.byteLength(body) }, body);
}

test("the actual synthetic read port returns non-empty search and matching detail envelopes over HTTP", async (context) => {
  const readPort = await createSyntheticDemoReadPort({ nowMs: () => Date.parse(NOW) });
  const { app, port } = await listen(readPort);
  context.after(() => app.close());
  const search = await searchRequest(port);
  assert.equal(search.status, 200);
  assert.notEqual(search.body, "");
  const searchEnvelope = JSON.parse(search.body);
  assert.equal(searchEnvelope.schemaVersion, 1);
  assert.match(searchEnvelope.requestId, /^req_[0-9a-f]{32}$/u);
  assert.ok(searchEnvelope.data.results.length > 0);
  const listingId = searchEnvelope.data.results[0].listingId;
  const detail = await rawRequest(port, { host: `127.0.0.1:${port}` }, undefined, { method: "GET", path: `/v1/demo/listings/${listingId}` });
  assert.equal(detail.status, 200);
  assert.notEqual(detail.body, "");
  const detailEnvelope = JSON.parse(detail.body);
  assert.equal(detailEnvelope.data.results.length, 1);
  assert.equal(detailEnvelope.data.results[0].listingId, listingId);
});

test("real HTTP failures always return the closed non-empty error envelope", async (context) => {
  const cases = [
    ["typed failure", { async search() { return { success: false, error: { code: "invalid_cursor" } }; }, async getListing() { return { success: false, error: { code: "read_unavailable" } }; } }, 400, "invalid_cursor"],
    ["throw", { async search() { throw new Error("private failure"); }, async getListing() { return { success: false, error: { code: "read_unavailable" } }; } }, 503, "read_unavailable"],
    ["malformed", { async search() { return { success: true, data: { malformed: true } }; }, async getListing() { return { success: false, error: { code: "read_unavailable" } }; } }, 503, "read_unavailable"],
    ["cancelled", { async search() { return { success: false, error: { code: "cancelled" } }; }, async getListing() { return { success: false, error: { code: "read_unavailable" } }; } }, 408, "cancelled"],
  ];
  for (const [name, readPort, status, code] of cases) {
    const running = await listen(readPort);
    context.after(() => running.app.close());
    const reply = await searchRequest(running.port);
    assert.equal(reply.status, status, name);
    assert.notEqual(reply.body, "", name);
    assert.deepEqual(JSON.parse(reply.body).error, { code }, name);
    await running.app.close();
  }

  const missing = await listen({ async search() { return { success: true, data: response() }; }, async getListing() { return { success: true, data: response({ results: [], totalCount: 0 }) }; } });
  context.after(() => missing.app.close());
  const reply = await rawRequest(missing.port, { host: `127.0.0.1:${missing.port}` }, undefined, { method: "GET", path: `/v1/demo/listings/${LISTING_ID}` });
  assert.equal(reply.status, 404);
  assert.notEqual(reply.body, "");
  assert.deepEqual(JSON.parse(reply.body).error, { code: "not_found" });
});

test("the application deadline returns one 408 envelope over a real socket and suppresses late reads", async (context) => {
  const events = [];
  let portSignal;
  let lateResolved = false;
  const running = await listen({
    search(_query, readContext) {
      portSignal = readContext.signal;
      return new Promise((resolve) => readContext.signal.addEventListener("abort", () => {
        setTimeout(() => { lateResolved = true; resolve({ success: true, data: response() }); }, 20);
      }, { once: true }));
    },
    async getListing() { return { success: false, error: { code: "read_unavailable" } }; },
  }, { clock: () => new Date(), telemetry: { log(event) { events.push(event); }, span(event) { events.push(event); } } });
  context.after(() => running.app.close());
  const started = Date.now();
  const reply = await searchRequest(running.port);
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 4_800 && elapsed < 7_000, `deadline elapsed ${elapsed}ms`);
  assert.equal(reply.status, 408);
  assert.notEqual(reply.body, "");
  assert.deepEqual(JSON.parse(reply.body).error, { code: "cancelled" });
  assert.equal(portSignal.aborted, true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(lateResolved, true);
  assert.equal(events.filter((event) => event.name === "read_port.query").length, 1);
  assert.equal(events.find((event) => event.name === "read_port.query").status, 408);
  assert.equal(events.filter((event) => event.name === "api.request").length, 1);
  assert.equal(events.find((event) => event.name === "api.request").status, 408);
});

test("raw duplicate correlation headers reject without reflecting attacker values", async (context) => {
  const port = await availablePort();
  const app = createDemoApi({
    readPort: { async search() { throw new Error("must not run"); }, async getListing() { throw new Error("must not run"); } },
    requestIds: () => "req_22222222222222222222222222222222",
    loopbackPolicy: { boundPort: port },
  });
  context.after(() => app.close());
  await app.listen({ host: "127.0.0.1", port });
  const body = '{"schemaVersion":1,"sort":"listing_asc"}';
  const reply = await rawRequest(port, ["Host", `127.0.0.1:${port}`, "Content-Type", "application/json", "Content-Length", String(Buffer.byteLength(body)), "X-Request-Id", "req_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "x-request-id", "req_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"], body);
  assert.equal(reply.status, 400);
  assert.equal(JSON.parse(reply.body).requestId, "req_22222222222222222222222222222222");
  assert.doesNotMatch(reply.body, /aaaa|bbbb/u);
});

test("a disconnected client aborts the read signal and records internal 499 without a write", async (context) => {
  const port = await availablePort();
  const events = [];
  let observedSignal;
  const app = createDemoApi({
    readPort: {
      search(_query, context) {
        observedSignal = context.signal;
        return new Promise((resolve) => context.signal.addEventListener("abort", () => resolve({ success: false, error: { code: "cancelled" } }), { once: true }));
      },
      async getListing() { return { success: false, error: { code: "read_unavailable" } }; },
    },
    telemetry: { log(event) { events.push(event); }, span(event) { events.push(event); }, metric(event) { events.push(event); } },
    clock: () => new Date(NOW),
    loopbackPolicy: { boundPort: port },
  });
  context.after(() => app.close());
  await app.listen({ host: "127.0.0.1", port });
  const body = '{"schemaVersion":1,"sort":"listing_asc"}';
  const request = http.request({ host: "127.0.0.1", port, method: "POST", path: "/v1/demo/search", headers: { host: `127.0.0.1:${port}`, "content-type": "application/json", "content-length": Buffer.byteLength(body) } });
  request.on("error", () => {});
  request.write(body);
  request.end();
  for (let index = 0; index < 50 && observedSignal === undefined; index += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(observedSignal);
  request.destroy();
  for (let index = 0; index < 50 && !observedSignal.aborted; index += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(observedSignal.aborted, true);
  for (let index = 0; index < 50 && !events.some((event) => event.status === 499); index += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(events.filter((event) => event.name === "read_port.query").length, 1);
  assert.deepEqual(events.find((event) => event.name === "read_port.query"), {
    name: "read_port.query", requestId: events.find((event) => event.name === "read_port.query").requestId,
    route: "/v1/demo/search", status: 499, durationMs: events.find((event) => event.name === "read_port.query").durationMs, code: "cancelled",
  });
  assert.equal(events.filter((event) => event.name === "api.request").length, 1);
  assert.equal(events.find((event) => event.name === "api.request").status, 499);
  assert.equal(events.find((event) => event.name === "api.request").code, "cancelled");
  assert.equal(events.filter((event) => event.name === "api.search").length, 1);
  assert.equal(events.find((event) => event.name === "api.search").status, 499);
  assert.equal(events.find((event) => event.name === "api.search").code, "cancelled");
  assert.equal(events.filter((event) => event.name === "api_requests_total").length, 1);
  assert.deepEqual(events.find((event) => event.name === "api_requests_total").labels, { route: "/v1/demo/search", status: "499" });
  assert.equal(events.filter((event) => event.name === "api_request_duration_ms").length, 1);
  assert.equal(events.filter((event) => event.name === "api_errors_total").length, 1);
  assert.deepEqual(events.find((event) => event.name === "api_errors_total").labels, { code: "cancelled" });
});

test("a client close after onSend but before response finish records 499 instead of premature 200", async (context) => {
  const port = await availablePort();
  const events = [];
  let onSendStarted = false;
  let releaseOnSend;
  const onSendGate = new Promise((resolve) => { releaseOnSend = resolve; });
  const app = createDemoApi({
    readPort: {
      async search() { return { success: true, data: response() }; },
      async getListing() { return { success: false, error: { code: "read_unavailable" } }; },
    },
    telemetry: { log(event) { events.push(event); }, span(event) { events.push(event); }, metric(event) { events.push(event); } },
    clock: () => new Date(NOW),
    loopbackPolicy: { boundPort: port },
  });
  app.addHook("onSend", async (_request, _reply, payload) => {
    onSendStarted = true;
    await onSendGate;
    return payload;
  });
  context.after(() => app.close());
  await app.listen({ host: "127.0.0.1", port });
  const body = '{"schemaVersion":1,"sort":"listing_asc"}';
  const request = http.request({ host: "127.0.0.1", port, method: "POST", path: "/v1/demo/search", headers: { host: `127.0.0.1:${port}`, "content-type": "application/json", "content-length": Buffer.byteLength(body) } });
  request.on("error", () => {});
  request.end(body);
  for (let index = 0; index < 50 && !onSendStarted; index += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(onSendStarted, true);
  request.destroy();
  for (let index = 0; index < 50 && !events.some((event) => event.name === "api.request"); index += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  const terminal = events.find((event) => event.name === "api.request");
  releaseOnSend();
  assert.ok(terminal);
  assert.equal(events.filter((event) => event.name === "api.request").length, 1);
  assert.equal(terminal.status, 499);
  assert.equal(terminal.code, "cancelled");
  assert.equal(events.filter((event) => event.name === "api.search").length, 1);
  assert.equal(events.find((event) => event.name === "api.search").status, 499);
  assert.equal(events.find((event) => event.name === "api.search").code, "cancelled");
  assert.equal(events.filter((event) => event.name === "read_port.query").length, 1);
  assert.equal(events.find((event) => event.name === "read_port.query").status, 200);
  assert.equal(events.find((event) => event.name === "read_port.query").code, undefined);
  assert.equal(events.filter((event) => event.name === "api_requests_total").length, 1);
  assert.deepEqual(events.find((event) => event.name === "api_requests_total").labels, { route: "/v1/demo/search", status: "499" });
  assert.equal(events.filter((event) => event.name === "api_request_duration_ms").length, 1);
  assert.equal(events.filter((event) => event.name === "api_errors_total").length, 1);
  assert.deepEqual(events.find((event) => event.name === "api_errors_total").labels, { code: "cancelled" });
});

test("the five-second handler deadline aborts a pending read and returns closed cancellation", async (context) => {
  const events = [];
  let portSignal;
  let lateResolved = false;
  const app = createDemoApi({
    readPort: {
      search(_query, context) {
        portSignal = context.signal;
        return new Promise((resolve) => context.signal.addEventListener("abort", () => {
          setTimeout(() => { lateResolved = true; resolve({ success: false, error: { code: "read_unavailable" } }); }, 20);
        }, { once: true }));
      },
      async getListing() { return { success: false, error: { code: "read_unavailable" } }; },
    },
    telemetry: { log(event) { events.push(event); }, span(event) { events.push(event); } },
  });
  context.after(() => app.close());
  const started = Date.now();
  const reply = await app.inject({ method: "POST", url: "/v1/demo/search", headers: { host: "127.0.0.1:3210", "content-type": "application/json" }, payload: { schemaVersion: 1, sort: "listing_asc" } });
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 4_800 && elapsed < 7_000, `deadline elapsed ${elapsed}ms`);
  assert.equal(reply.statusCode, 408);
  assert.equal(JSON.parse(reply.body).error.code, "cancelled");
  assert.equal(portSignal.aborted, true);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(lateResolved, true);
  assert.equal(events.filter((event) => event.name === "read_port.query").length, 1);
  assert.equal(events.find((event) => event.name === "read_port.query").status, 408);
  assert.equal(events.filter((event) => event.name === "api.request").length, 1);
  assert.equal(events.find((event) => event.name === "api.request").status, 408);
});
