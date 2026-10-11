import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import test from "node:test";
import { createDemoApi } from "../dist/index.js";

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  assert.equal(typeof address, "object");
  const port = address.port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function rawRequest(port, headers, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, method: "POST", path: "/v1/demo/search", headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.once("error", reject);
    request.end(body);
  });
}

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
    telemetry: { log(event) { events.push(event); } },
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
  assert.ok(events.some((event) => event.status === 499 && event.code === "cancelled"));
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
