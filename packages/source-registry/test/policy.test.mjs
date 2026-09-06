import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendSourceRevision,
  evaluatePolicyEligibility,
} from "@auto-world/source-registry";
import {
  SYNTHETIC_NOW,
  cloneSynthetic,
  syntheticConfiguration,
  syntheticEnabledRegistry,
  syntheticEvent,
  syntheticPolicy,
  syntheticRegistry,
  syntheticRequest,
  syntheticRevision,
} from "./fixtures/synthetic.mjs";
import { assertIssue, assertSuccess } from "./helpers.mjs";

function nextEnable(configuration = syntheticConfiguration(), overrides = {}) {
  return syntheticRevision({
    revision: 2,
    state: "enabled",
    configuration,
    event: syntheticEvent({
      eventId: "aud_synthetic_enable",
      kind: "enable",
      at: "2026-01-02T00:00:00.000Z",
      reasonRef: "reason_synthetic_enable",
    }),
    ...overrides,
  });
}

test("evaluates a complete synthetic scoped policy as eligible, never allowed", () => {
  const decision = assertSuccess(evaluatePolicyEligibility(syntheticEnabledRegistry(), syntheticRequest(), SYNTHETIC_NOW));
  assert.equal(decision.eligible, true);
  assert.equal(decision.sourceId, "src_synthetic_feed");
  assert.equal(decision.revision, 2);
  assert.equal(decision.asOf, SYNTHETIC_NOW);
  assert.equal(Object.hasOwn(decision, "allowed"), false);
  assert.deepEqual(decision.policy, syntheticPolicy());
  assert.equal(Object.isFrozen(decision.policy.retention), true);
});

test("denies a disabled registry", () => {
  const decision = assertSuccess(evaluatePolicyEligibility(syntheticRegistry(), syntheticRequest(), SYNTHETIC_NOW));
  assert.deepEqual(decision, {
    eligible: false,
    sourceId: "src_synthetic_feed",
    revision: 1,
    asOf: SYNTHETIC_NOW,
    reason: "disabled",
  });
});

test("denies a takedown registry before evaluating policy scope", () => {
  const enabled = syntheticEnabledRegistry();
  const takedown = syntheticRevision({
    revision: 3,
    state: "takedown",
    configuration: cloneSynthetic(enabled.revisions[1].configuration),
    event: syntheticEvent({
      eventId: "aud_synthetic_takedown",
      kind: "takedown",
      at: "2026-02-01T00:00:00.000Z",
      reasonRef: "reason_synthetic_takedown",
    }),
  });
  const registry = assertSuccess(appendSourceRevision(enabled, takedown));
  const decision = assertSuccess(evaluatePolicyEligibility(registry, syntheticRequest(), SYNTHETIC_NOW));
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "takedown");
});

test("denies evaluation before the latest audit event", () => {
  const decision = assertSuccess(evaluatePolicyEligibility(syntheticEnabledRegistry(), syntheticRequest(), "2026-01-01T12:00:00.000Z"));
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "future_revision");
});

test("rejects malformed eligibility input instead of returning ineligible", () => {
  const result = evaluatePolicyEligibility(syntheticEnabledRegistry(), syntheticRequest({ fields: [] }), SYNTHETIC_NOW);
  assertIssue(result, "invalid_value", "$.request.fields");
  assert.equal(Object.hasOwn(result, "eligible"), false);
});

test("denies a request outside the contextual territory and method clause", () => {
  for (const request of [
    syntheticRequest({ territory: "DE" }),
    syntheticRequest({ acquisitionMethod: "api" }),
  ]) {
    const decision = assertSuccess(evaluatePolicyEligibility(syntheticEnabledRegistry(), request, SYNTHETIC_NOW));
    assert.equal(decision.eligible, false);
    assert.equal(decision.reason, "scope_not_granted");
  }
});

test("does not union fields across separate grants", () => {
  const decision = assertSuccess(evaluatePolicyEligibility(
    syntheticEnabledRegistry(),
    syntheticRequest({ audience: "consumer", fields: ["source_listing_id", "price", "mileage"] }),
    SYNTHETIC_NOW,
  ));
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "scope_not_granted");
});

test("never treats consumer grant as a B2B grant", () => {
  const decision = assertSuccess(evaluatePolicyEligibility(syntheticEnabledRegistry(), syntheticRequest({ audience: "b2b" }), SYNTHETIC_NOW));
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "scope_not_granted");
});

test("denies VIN and seller PII outside the internal audience", () => {
  for (const field of ["vin", "seller_pii"]) {
    const request = syntheticRequest({ fields: ["source_listing_id", field] });
    const decision = assertSuccess(evaluatePolicyEligibility(syntheticEnabledRegistry(), request, SYNTHETIC_NOW));
    assert.equal(decision.eligible, false);
    assert.equal(decision.reason, "internal_only_field");
  }
});

test("authorization start is inclusive and expiry is exclusive", () => {
  const policy = syntheticPolicy({ authorization: { validFrom: "2026-01-02T00:00:00.000Z" } });
  const configuration = syntheticConfiguration({ policy });
  const registry = syntheticEnabledRegistry({ revisions: [syntheticRevision({ configuration }), nextEnable(cloneSynthetic(configuration))] });
  const atStart = assertSuccess(evaluatePolicyEligibility(registry, syntheticRequest(), "2026-01-02T00:00:00.000Z"));
  const atExpiry = assertSuccess(evaluatePolicyEligibility(registry, syntheticRequest(), "2027-01-01T00:00:00.000Z"));
  assert.equal(atStart.eligible, true);
  assert.equal(atExpiry.eligible, false);
  assert.equal(atExpiry.reason, "policy_not_current");
});

test("denies current access after a historically valid authorization expires", () => {
  const decision = assertSuccess(evaluatePolicyEligibility(syntheticEnabledRegistry(), syntheticRequest(), "2027-01-01T00:00:00.001Z"));
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "policy_not_current");
});

test("requires complete policy before enablement", () => {
  const configuration = syntheticConfiguration({ policy: null });
  assertIssue(appendSourceRevision(syntheticRegistry({ revisions: [syntheticRevision({ configuration })] }), nextEnable(configuration)), "invalid_value", "$.nextRevision.configuration.policy");
});

test("requires positive raw and normalized retention before enablement", () => {
  for (const retention of [
    { rawSeconds: 0, normalizedSeconds: 86_400 },
    { rawSeconds: 86_400, normalizedSeconds: 0 },
  ]) {
    const policy = syntheticPolicy({ retention });
    const configuration = syntheticConfiguration({ policy });
    const registry = syntheticRegistry({ revisions: [syntheticRevision({ configuration })] });
    assert.equal(appendSourceRevision(registry, nextEnable(cloneSynthetic(configuration))).success, false);
  }
});

test("enforces legal-status acquisition-method compatibility", () => {
  const cases = [
    ["official_api", "api", true],
    ["official_api", "feed", false],
    ["dealer_feed", "feed", true],
    ["dealer_feed", "api", false],
    ["permitted_crawl", "crawl", true],
    ["permitted_crawl", "feed", false],
    ["licensed_partner", "manual", true],
    ["restricted", "feed", false],
    ["blocked", "feed", false],
    ["unknown", "feed", false],
  ];
  for (const [legalStatus, acquisitionMethod, expected] of cases) {
    const policy = syntheticPolicy({
      grants: [{ territory: "FR", acquisitionMethod, audience: "internal", fields: ["source_listing_id"] }],
    });
    const configuration = syntheticConfiguration({ legalStatus, acquisitionMethods: [acquisitionMethod], policy });
    const registry = syntheticRegistry({ revisions: [syntheticRevision({ configuration })] });
    assert.equal(appendSourceRevision(registry, nextEnable(cloneSynthetic(configuration))).success, expected);
  }
});
