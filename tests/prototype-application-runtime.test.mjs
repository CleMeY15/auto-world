import assert from "node:assert/strict";
import test from "node:test";

import { createApplicationRuntime, TEST_ONLY_abortableDelay } from "../scripts/prototype-application/runtime.mjs";
import { createCliEventSink, parseArguments, runServer } from "../scripts/prototype-application/server.mjs";

const conditions = new Set(["auto-world-demo", "auto-world-prototype"]);
const state = { project: "aw-test-12345678-1234-4123-8123-123456789abc",
  credentials: { pgBootstrap: "a".repeat(64), pgWriter: "b".repeat(64) } };

test("prepareApplication performs bounded setup under the project lock", async () => {
  const calls = [];
  const runtime = createApplicationRuntime({ conditions,
    withProjectLock: async (_state, action) => { calls.push("lock:start"); const result = await action(); calls.push("lock:end"); return result; },
    compose: async () => calls.push("config"), pull: async () => calls.push("pull"),
    prepareTools: async () => calls.push("tools"), up: async () => calls.push("up"),
    migrateConnector: async () => calls.push("connector"), provisionRoles: async () => { calls.push("roles"); return {}; },
    migrateSearch: async () => calls.push("search"), ensureRawBucket: async () => calls.push("bucket"),
    serviceHealth: async () => { calls.push("health"); return ["postgres", "redis", "opensearch", "object-store"].map((service) => ({ service, status: "passed" })); },
  });
  await runtime.prepareApplication(state);
  assert.deepEqual(calls, ["lock:start", "config", "pull", "tools", "up", "connector", "roles", "search", "bucket", "health", "lock:end"]);
});

test("prepareApplication classifies the failing fixed step without replacing its cause", async () => {
  const failure = new Error("injected_bucket_failure");
  const runtime = createApplicationRuntime({ conditions, withProjectLock: async (_state, action) => action(),
    compose: async () => {}, pull: async () => {}, prepareTools: async () => {}, up: async () => {},
    migrateConnector: async () => {}, provisionRoles: async () => {}, migrateSearch: async () => {},
    ensureRawBucket: async () => { throw failure; }, serviceHealth: async () => [] });
  await assert.rejects(runtime.prepareApplication(state), (error) => {
    assert.equal(error, failure);
    assert.equal(error.prototypeApplicationStep, "ensure-raw-bucket");
    assert.equal(Object.keys(error).includes("prototypeApplicationStep"), false);
    return true;
  });
});

test("openApplication binds a distinct loopback API and closes worker before pools", async () => {
  const calls = [];
  let consumerCalls = 0;
  const runtime = createApplicationRuntime({ conditions, publishedPort: async (_state, service) => service === "postgres" ? 15_432 : 19_200,
    delay: (resolve) => { globalThis.queueMicrotask(resolve); return 0; },
    loadModules: async () => ({
      createPostgresPrototype: (config) => ({ store: {}, lease: {}, close: async () => calls.push("ingestion:close"), config }),
      createSearchPrototype: (config) => ({ config, readPort: {}, consume: async ({ signal }) => {
        consumerCalls += 1; if (consumerCalls === 1) return { status: "published" };
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true })); return { status: "idle" };
      }, close: async () => calls.push("search:close") }),
      createDemoApi: (config) => ({ config, listen: async (input) => calls.push(`listen:${input.host}:${input.port}`),
        close: async () => calls.push("api:close") }), ingest: async () => ({ status: "completed" }), generatedAdapter: () => ({}),
    }) });
  const application = await runtime.openApplication(state, { port: 3_211 });
  assert.equal(application.url, "http://127.0.0.1:3211");
  while (consumerCalls < 2) await new Promise((resolve) => globalThis.setImmediate(resolve));
  const firstClose = application.close();
  const secondClose = application.close();
  assert.equal(firstClose, secondClose);
  await firstClose;
  assert.equal(consumerCalls, 2);
  assert.deepEqual(calls, ["listen:127.0.0.1:3211", "api:close", "search:close", "ingestion:close"]);
  await application.close();
  await assert.rejects(runtime.openApplication(state, { port: 3_210 }), /prototype_application_port_invalid/u);
});

test("openApplication seed is explicit and uses the stable synthetic invocation", async () => {
  const ingests = [];
  const runtime = createApplicationRuntime({ conditions, publishedPort: async (_state, service) => service === "postgres" ? 15_432 : 19_200,
    loadModules: async () => ({ createPostgresPrototype: () => ({ store: {}, lease: {}, close: async () => {} }),
      createSearchPrototype: () => ({ readPort: {}, close: async () => {} }),
      createDemoApi: () => ({ listen: async () => {}, close: async () => {} }),
      generatedAdapter: (count) => ({ count }), ingest: async (...args) => { ingests.push(args); return { status: "completed" }; } }) });
  const application = await runtime.openApplication(state, { seed: true, consume: false });
  assert.equal(ingests.length, 1);
  assert.equal(ingests[0][1].count, 1_000);
  assert.equal(ingests[0][2], "prototype-application-seed-v1");
  assert.deepEqual(ingests[0][4], { maxEffectMs: 10_000, maxRunMs: 100_000 });
  assert.deepEqual(ingests[0][5], { timeoutMs: 10_000 });
  await application.close();
});

test("failed seed closes every resource after the listener was safely bound", async () => {
  const calls = [];
  const runtime = createApplicationRuntime({ conditions, publishedPort: async (_state, service) => service === "postgres" ? 15_432 : 19_200,
    loadModules: async () => ({ createPostgresPrototype: () => ({ store: {}, lease: {}, close: async () => calls.push("ingestion:close") }),
      createSearchPrototype: () => ({ readPort: {}, close: async () => calls.push("search:close") }),
      createDemoApi: () => ({ listen: async () => calls.push("listen"), close: async () => calls.push("api:close") }),
      generatedAdapter: () => ({}), ingest: async () => ({ status: "failed" }) }) });
  await assert.rejects(runtime.openApplication(state, { seed: true, consume: false }), /prototype_application_seed_failed/u);
  assert.deepEqual(calls, ["listen", "api:close", "search:close", "ingestion:close"]);
});

test("bind failure cannot seed or consume and closes only its own clients", async () => {
  const calls = [];
  const runtime = createApplicationRuntime({ conditions, publishedPort: async (_state, service) => service === "postgres" ? 15_432 : 19_200,
    loadModules: async () => ({ createPostgresPrototype: () => ({ close: async () => calls.push("ingestion:close") }),
      createSearchPrototype: () => ({ readPort: {}, consume: async () => calls.push("consume"), close: async () => calls.push("search:close") }),
      createDemoApi: () => ({ listen: async () => { calls.push("listen"); throw new Error("EADDRINUSE"); },
        close: async () => calls.push("api:close") }),
      generatedAdapter: () => ({}), ingest: async () => { calls.push("seed"); return { status: "completed" }; } }) });
  await assert.rejects(runtime.openApplication(state, { seed: true }), /EADDRINUSE/u);
  assert.deepEqual(calls, ["listen", "api:close", "search:close", "ingestion:close"]);
});

test("external cancellation aborts an active seed and never returns an application", async () => {
  const calls = [];
  const controller = new globalThis.AbortController();
  let seedStarted;
  const started = new Promise((resolve) => { seedStarted = resolve; });
  const runtime = createApplicationRuntime({ conditions, publishedPort: async (_state, service) => service === "postgres" ? 15_432 : 19_200,
    loadModules: async () => ({ createPostgresPrototype: () => ({ close: async () => calls.push("ingestion:close") }),
      createSearchPrototype: () => ({ readPort: {}, close: async () => calls.push("search:close") }),
      createDemoApi: () => ({ listen: async () => calls.push("listen"), close: async () => calls.push("api:close") }),
      generatedAdapter: () => ({}), ingest: async (...args) => {
        const signal = args[6].signal; seedStarted();
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
        return { status: "cancelled" };
      } }) });
  const opening = runtime.openApplication(state, { seed: true, signal: controller.signal });
  await started;
  controller.abort();
  await assert.rejects(opening, /prototype_application_cancelled/u);
  assert.deepEqual(calls, ["listen", "api:close", "search:close", "ingestion:close"]);
});

test("already-aborted external signal is rejected before module or client creation", async () => {
  const controller = new globalThis.AbortController(); controller.abort();
  let loaded = false;
  const runtime = createApplicationRuntime({ conditions, loadModules: async () => { loaded = true; return {}; } });
  await assert.rejects(runtime.openApplication(state, { signal: controller.signal }), /prototype_application_cancelled/u);
  assert.equal(loaded, false);
});

test("bounded delay removes its abort listener after timeout settlement", async () => {
  const listeners = new Set();
  let complete;
  const signal = { aborted: false,
    addEventListener: (_name, listener) => listeners.add(listener),
    removeEventListener: (_name, listener) => listeners.delete(listener) };
  const pending = TEST_ONLY_abortableDelay(250, signal, (callback) => { complete = callback; return 1; });
  assert.equal(listeners.size, 1);
  complete();
  await pending;
  assert.equal(listeners.size, 0);
});

test("consumer health is sampled without emitting idle-loop noise", async () => {
  const events = [];
  let consumed = 0;
  const runtime = createApplicationRuntime({ conditions, now: () => 1_000,
    publishedPort: async (_state, service) => service === "postgres" ? 15_432 : 19_200,
    delay: (resolve) => { globalThis.queueMicrotask(resolve); return 0; },
    loadModules: async () => ({ createPostgresPrototype: () => ({ close: async () => {} }),
      createSearchPrototype: () => ({ readPort: {}, consume: async () => ({ status: ++consumed === 1 ? "idle" : "halted" }),
        health: async () => ({ pending: 2, lagMs: 30, alert: "critical" }), close: async () => {} }),
      createDemoApi: () => ({ listen: async () => {}, close: async () => {} }), ingest: async () => ({ status: "completed" }),
      generatedAdapter: () => ({}) }) });
  const application = await runtime.openApplication(state, { onEvent: (event) => events.push(event) });
  while (consumed < 2) await new Promise((resolve) => globalThis.setImmediate(resolve));
  await application.close();
  assert.deepEqual(events, [{ name: "application_health", pending: 2, lagMs: 30, alert: "critical" }]);
});

test("CLI event sink emits only fixed sanitized operational fields", () => {
  const events = [];
  const sink = createCliEventSink((event) => events.push(event));
  sink({ name: "published", documents: 10, attempt: 1, durationMs: 12.5, lagMs: 3,
    requestId: "secret-request", sourceId: "secret-source" });
  sink({ name: "api.failure", route: "/v1/demo/search", status: 503, code: "read_unavailable",
    requestId: "secret-request", operationKey: "secret-operation" });
  sink({ name: "application_health", pending: 2, lagMs: 100, alert: "warning", runId: "secret-run" });
  sink({ name: "application_consumer", status: "idle" });
  sink({ name: "api.failure", route: "/admin", status: 503, code: "read_unavailable" });
  assert.deepEqual(events, [
    { event: "prototype_application_signal", name: "published", documents: 10, attempt: 1, durationMs: 12.5, lagMs: 3 },
    { event: "prototype_application_signal", name: "api.failure", route: "/v1/demo/search", status: 503, code: "read_unavailable" },
    { event: "prototype_application_signal", name: "application_health", pending: 2, lagMs: 100, alert: "warning" },
  ]);
});

test("runtime refuses production or missing explicit prototype conditions", async () => {
  await assert.rejects(createApplicationRuntime({ conditions: new Set(), environment: {} }).prepareApplication(state), /prototype_conditions_required/u);
  await assert.rejects(createApplicationRuntime({ conditions, environment: { NODE_ENV: "production" } }).prepareApplication(state), /prototype_production_forbidden/u);
});

test("server arguments are strict and shutdown preserves data while stopping services", async () => {
  const project = state.project;
  assert.deepEqual(parseArguments(["--project", project, "--port", "3212", "--no-consume"]),
    { port: 3_212, seed: false, consume: false, project });
  assert.throws(() => parseArguments(["--project", "aw-test-not-a-uuid"]), /prototype_application_arguments_invalid/u);
  assert.throws(() => parseArguments(["--port", "3210"]), /prototype_application_arguments_invalid/u);
  assert.throws(() => parseArguments(["--seed", "--seed"]), /prototype_application_arguments_invalid/u);
  const calls = [];
  const controller = new globalThis.AbortController();
  const result = await runServer(["--project", project, "--no-consume"], {
    conditions,
    loadProject: async () => state, prepareApplication: async () => calls.push("prepare"),
    openApplication: async (_state, options) => { calls.push(`sink:${typeof options.onEvent}`);
      return { port: 3_211, close: async () => calls.push("close") }; }, signal: controller.signal,
    emit: (value) => { calls.push(value.event); if (value.event === "prototype_application_ready") controller.abort(); },
    withProjectLock: async (_state, action) => { calls.push("lock"); return action(); },
    stop: async () => calls.push("stop"),
  });
  assert.deepEqual(result, { project, port: 3_211 });
  assert.deepEqual(calls, ["prototype_application_project", "prepare", "sink:function", "prototype_application_ready", "close", "lock", "stop"]);
});

test("server guards and cancellation happen before unsafe lifecycle transitions", async () => {
  let initialized = 0;
  const active = new globalThis.AbortController();
  await assert.rejects(runServer([], { conditions: new Set(), signal: active.signal,
    initProject: async () => { initialized += 1; return state; } }), /prototype_conditions_required/u);
  await assert.rejects(runServer([], { conditions, environment: { NODE_ENV: "production" }, signal: active.signal,
    initProject: async () => { initialized += 1; return state; } }), /prototype_production_forbidden/u);
  assert.equal(initialized, 0);

  const calls = [];
  const cancelled = new globalThis.AbortController();
  await assert.rejects(runServer([], { conditions, signal: cancelled.signal, initProject: async () => state,
    prepareApplication: async () => { calls.push("prepare"); cancelled.abort(); },
    openApplication: async () => calls.push("open"), emit: (event) => calls.push(event.event),
    withProjectLock: async (_state, action) => action(), stop: async () => calls.push("stop") }),
  /prototype_application_cancelled/u);
  assert.deepEqual(calls, ["prototype_application_project", "prepare"]);
});

test("server still stops services after close failure and preserves the primary error", async () => {
  const controller = new globalThis.AbortController();
  const calls = [];
  await assert.rejects(runServer([], { conditions, signal: controller.signal, initProject: async () => state,
    prepareApplication: async () => {}, openApplication: async () => ({ port: 3_211,
      close: async () => { calls.push("close"); throw new Error("close_failed"); } }),
    emit: (event) => { if (event.event === "prototype_application_ready") controller.abort(); },
    withProjectLock: async (_state, action) => action(),
    stop: async () => calls.push("stop") }), /close_failed/u);
  assert.deepEqual(calls, ["close", "stop"]);
});

test("server startup failure preserves services for inspection", async () => {
  const controller = new globalThis.AbortController();
  const calls = [];
  await assert.rejects(runServer([], { conditions, signal: controller.signal, initProject: async () => state,
    prepareApplication: async () => {}, openApplication: async () => { throw new Error("startup_failed"); },
    emit: (event) => calls.push(event),
    withProjectLock: async (_state, action) => action(), stop: async () => { calls.push("stop"); throw new Error("stop_failed"); } }),
  /startup_failed/u);
  assert.deepEqual(calls, [{ event: "prototype_application_project", project: state.project, port: 3_211 }]);
});
