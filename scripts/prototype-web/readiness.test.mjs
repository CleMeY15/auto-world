import assert from "node:assert/strict";
import test from "node:test";

import { waitForWebServices } from "./readiness.mjs";

const services = ["postgres", "redis", "opensearch", "object-store"];
const health = (failed = []) => services.map((service) => failed.includes(service)
  ? { service, phase: "usable-health", status: "failed", code: "dependency_unavailable",
      reason: "infra_search_not_ready", durationMs: 2, secret: "must-not-leak" }
  : { service, phase: "usable-health", status: "passed", code: "ready", durationMs: 1 });

function clock(initial = 10_000) {
  let value = initial;
  const delays = [];
  return { now: () => value, delays, delay: async (milliseconds) => { delays.push(milliseconds); value += milliseconds; } };
}

test("waits with bounded probes until all four usable services pass", async () => {
  const time = clock();
  const probes = [];
  const diagnostics = [];
  const result = await waitForWebServices({ project: "aw-test", deadlineAt: 20_000 }, {
    ...time,
    async serviceHealth(state) {
      probes.push(state.deadlineAt);
      return probes.length < 3 ? health(["opensearch"]) : health();
    },
    onDiagnostic: (entry) => diagnostics.push(entry),
  });
  assert.deepEqual(result.map((entry) => [entry.service, entry.status]), services.map((service) => [service, "passed"]));
  assert.deepEqual(probes, [20_000, 20_000, 20_000]);
  assert.deepEqual(time.delays, [1_000, 1_000]);
  assert.equal(diagnostics.length, 1);
  assert.equal(Object.hasOwn(diagnostics[0], "secret"), false);
});

test("times out with the last sanitized health and deduplicated diagnostics", async () => {
  const time = clock();
  const diagnostics = [];
  await assert.rejects(waitForWebServices({ deadlineAt: 12_500 }, {
    ...time, serviceHealth: async () => health(["object-store"]), onDiagnostic: (entry) => diagnostics.push(entry),
  }), (error) => {
    assert.equal(error.name, "prototype_web_usable_readiness_timeout");
    assert.equal(error.message, "prototype_web_usable_readiness_timeout");
    assert.equal(error.health.find((entry) => entry.service === "object-store").status, "failed");
    assert.equal(JSON.stringify(error.health).includes("must-not-leak"), false);
    return true;
  });
  assert.deepEqual(time.delays, [1_000, 1_000, 500]);
  assert.equal(diagnostics.length, 1);
});

test("honors an already expired and a shortened caller deadline", async () => {
  const expired = clock();
  let probes = 0;
  await assert.rejects(waitForWebServices({ deadlineAt: 10_000 }, {
    ...expired, serviceHealth: async () => { probes += 1; return health(); }, onDiagnostic() {},
  }), { name: "prototype_web_usable_readiness_timeout", message: "prototype_web_usable_readiness_timeout" });
  assert.equal(probes, 0);

  const shortened = clock();
  const deadlines = [];
  await assert.rejects(waitForWebServices({ deadlineAt: 10_250 }, {
    ...shortened, serviceHealth: async (state) => { deadlines.push(state.deadlineAt); return health(["postgres"]); }, onDiagnostic() {},
  }), { name: "prototype_web_usable_readiness_timeout" });
  assert.deepEqual(deadlines, [10_250]);
  assert.deepEqual(shortened.delays, [250]);
});

test("caps readiness at 120 seconds and refuses success completed after its deadline", async () => {
  const capped = clock();
  const result = await waitForWebServices({}, {
    ...capped,
    serviceHealth: async (state) => { assert.equal(state.deadlineAt, 130_000); return health(); },
    onDiagnostic() {},
  });
  assert.equal(result.every((entry) => entry.status === "passed"), true);

  let current = 10_000;
  await assert.rejects(waitForWebServices({ deadlineAt: 10_100 }, {
    now: () => current,
    serviceHealth: async (state) => { assert.equal(state.deadlineAt, 10_100); current = 10_101; return health(); },
    delay: async () => assert.fail("late successful probe must not delay"),
    onDiagnostic() {},
  }), (error) => {
    assert.equal(error.name, "prototype_web_usable_readiness_timeout");
    assert.equal(error.message, "prototype_web_usable_readiness_timeout");
    assert.equal(error.health.every((entry) => entry.status === "passed"), true);
    return true;
  });
});

test("rejects malformed, missing, duplicate, unexpected and invalid status responses immediately", async () => {
  const cases = [
    null,
    health().slice(0, 3),
    [health()[0], health()[0], health()[2], health()[3]],
    [...health().slice(0, 3), { service: "unknown", status: "passed" }],
    health().map((entry, index) => index === 0 ? { ...entry, status: "starting" } : entry),
    health().map((entry, index) => index === 0 ? { ...entry, durationMs: "raw" } : entry),
  ];
  for (const response of cases) {
    const time = clock();
    let delayed = false;
    await assert.rejects(waitForWebServices({}, {
      ...time, serviceHealth: async () => response, delay: async () => { delayed = true; }, onDiagnostic() {},
    }), { name: "prototype_web_usable_readiness_invalid", message: "prototype_web_usable_readiness_invalid" });
    assert.equal(delayed, false);
  }
});
