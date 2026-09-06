import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deriveSourceHealth,
  evaluatePolicyEligibility,
} from "@auto-world/source-registry";
import {
  SYNTHETIC_NOW,
  syntheticConfiguration,
  syntheticHealthSample,
  syntheticRegistry,
  syntheticRequest,
  syntheticRevision,
} from "./fixtures/synthetic.mjs";
import { assertIssue, assertSuccess } from "./helpers.mjs";

test("derives healthy only when every measurement is present and within thresholds", () => {
  const health = assertSuccess(deriveSourceHealth(syntheticRegistry(), syntheticHealthSample(), SYNTHETIC_NOW));
  assert.deepEqual(health, {
    sourceId: "src_synthetic_feed",
    revision: 1,
    asOf: SYNTHETIC_NOW,
    status: "healthy",
    reasons: [],
  });
});

test("treats thresholds as inclusive", () => {
  const sample = syntheticHealthSample({
    windowStartAt: "2026-09-06T11:30:00.000Z",
    windowEndAt: "2026-09-06T11:45:00.000Z",
    lastSuccessAt: "2026-09-06T11:30:00.000Z",
    errorBps: 100,
    parseErrorBps: 100,
    staleBps: 500,
    latencyP95Ms: 2_000,
  });
  const health = assertSuccess(deriveSourceHealth(syntheticRegistry(), sample, SYNTHETIC_NOW));
  assert.equal(health.status, "healthy");
  assert.deepEqual(health.reasons, []);
});

test("orders all degraded reasons deterministically", () => {
  const sample = syntheticHealthSample({
    circuit: "half_open",
    errorBps: 101,
    parseErrorBps: 101,
    staleBps: 501,
    latencyP95Ms: 2_001,
  });
  const health = assertSuccess(deriveSourceHealth(syntheticRegistry(), sample, SYNTHETIC_NOW));
  assert.equal(health.status, "degraded");
  assert.deepEqual(health.reasons, ["circuit_half_open", "error_rate", "parse_error_rate", "stale_ratio", "latency"]);
});

test("orders unhealthy and unknown reasons deterministically", () => {
  const sample = syntheticHealthSample({
    windowStartAt: "2026-09-06T11:00:00.000Z",
    windowEndAt: "2026-09-06T11:30:00.000Z",
    lastSuccessAt: null,
    errorBps: null,
    parseErrorBps: null,
    staleBps: null,
    latencyP95Ms: null,
    circuit: "open",
  });
  const health = assertSuccess(deriveSourceHealth(syntheticRegistry(), sample, SYNTHETIC_NOW));
  assert.equal(health.status, "unhealthy");
  assert.deepEqual(health.reasons, ["circuit_open", "no_success", "stale_sample", "missing_measurements"]);
});

test("marks a stale last success unhealthy", () => {
  const health = assertSuccess(deriveSourceHealth(syntheticRegistry(), syntheticHealthSample({ lastSuccessAt: "2026-09-06T11:29:59.999Z" }), SYNTHETIC_NOW));
  assert.equal(health.status, "unhealthy");
  assert.deepEqual(health.reasons, ["stale_success"]);
});

test("keeps missing nonzero-count metrics unknown instead of inventing zero", () => {
  const sample = syntheticHealthSample({ errorBps: null, parseErrorBps: null, staleBps: null, latencyP95Ms: null });
  const health = assertSuccess(deriveSourceHealth(syntheticRegistry(), sample, SYNTHETIC_NOW));
  assert.equal(health.status, "unknown");
  assert.deepEqual(health.reasons, ["missing_measurements"]);
});

test("keeps zero-volume samples with null measurements unknown", () => {
  const sample = syntheticHealthSample({
    requestCount: 0,
    itemCount: 0,
    errorBps: null,
    parseErrorBps: null,
    staleBps: null,
    latencyP95Ms: null,
  });
  const health = assertSuccess(deriveSourceHealth(syntheticRegistry(), sample, SYNTHETIC_NOW));
  assert.equal(health.status, "unknown");
  assert.deepEqual(health.reasons, ["missing_measurements"]);
});

test("requires null rate and latency measurements when request count is zero", () => {
  const sample = syntheticHealthSample({ requestCount: 0, errorBps: 0, latencyP95Ms: 0 });
  assertIssue(deriveSourceHealth(syntheticRegistry(), sample, SYNTHETIC_NOW), "invalid_value", "$.sample.errorBps");
});

test("requires null parse and stale measurements when item count is zero", () => {
  const sample = syntheticHealthSample({ itemCount: 0, parseErrorBps: 0, staleBps: 0 });
  assertIssue(deriveSourceHealth(syntheticRegistry(), sample, SYNTHETIC_NOW), "invalid_value", "$.sample.parseErrorBps");
});

test("rejects a sample for another source", () => {
  assertIssue(deriveSourceHealth(syntheticRegistry(), syntheticHealthSample({ sourceId: "src_other" }), SYNTHETIC_NOW), "invalid_value", "$.sample.sourceId");
});

test("health never mutates or authorizes a blocked source", () => {
  const configuration = syntheticConfiguration({ legalStatus: "blocked", policy: null });
  const registry = syntheticRegistry({ revisions: [syntheticRevision({ configuration })] });
  const before = JSON.stringify(registry);
  assert.equal(assertSuccess(deriveSourceHealth(registry, syntheticHealthSample(), SYNTHETIC_NOW)).status, "healthy");
  const decision = assertSuccess(evaluatePolicyEligibility(registry, syntheticRequest(), SYNTHETIC_NOW));
  assert.equal(decision.eligible, false);
  assert.equal(JSON.stringify(registry), before);
});
