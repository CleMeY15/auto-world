import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendSourceRevision,
  evaluatePolicyEligibility,
  parseSourceRegistry,
} from "@auto-world/source-registry";
import {
  cloneSynthetic,
  syntheticConfiguration,
  syntheticEvent,
  syntheticPolicy,
  syntheticRegistry,
  syntheticRequest,
  syntheticRevision,
} from "./fixtures/synthetic.mjs";
import { assertSuccess } from "./helpers.mjs";

test("preserves the complete synthetic policy lifecycle through serialization", () => {
  const request = syntheticRequest();
  let registry = assertSuccess(parseSourceRegistry(syntheticRegistry()));
  assert.equal(assertSuccess(evaluatePolicyEligibility(registry, request, "2026-01-01T12:00:00.000Z")).reason, "disabled");

  registry = assertSuccess(appendSourceRevision(registry, syntheticRevision({
    revision: 2,
    state: "enabled",
    configuration: cloneSynthetic(registry.revisions[0].configuration),
    event: syntheticEvent({ eventId: "aud_lifecycle_enable_1", kind: "enable", at: "2026-01-02T00:00:00.000Z", reasonRef: "reason_lifecycle_enable" }),
  })));
  assert.equal(assertSuccess(evaluatePolicyEligibility(registry, request, "2026-01-03T00:00:00.000Z")).eligible, true);

  const replacement = syntheticConfiguration({
    displayName: "Synthetic replacement policy",
    policy: syntheticPolicy({ authorization: { validUntil: "2028-01-01T00:00:00.000Z" } }),
  });
  registry = assertSuccess(appendSourceRevision(registry, syntheticRevision({
    revision: 3,
    state: "disabled",
    configuration: replacement,
    event: syntheticEvent({ eventId: "aud_lifecycle_replace", kind: "replace_configuration", at: "2026-02-01T00:00:00.000Z", reasonRef: "reason_lifecycle_replace" }),
  })));
  assert.equal(assertSuccess(evaluatePolicyEligibility(registry, request, "2026-02-01T12:00:00.000Z")).reason, "disabled");

  registry = assertSuccess(appendSourceRevision(registry, syntheticRevision({
    revision: 4,
    state: "enabled",
    configuration: cloneSynthetic(replacement),
    event: syntheticEvent({ eventId: "aud_lifecycle_enable_2", kind: "enable", at: "2026-02-02T00:00:00.000Z", reasonRef: "reason_lifecycle_reenable" }),
  })));
  assert.equal(assertSuccess(evaluatePolicyEligibility(registry, request, "2026-03-01T00:00:00.000Z")).eligible, true);
  assert.equal(assertSuccess(evaluatePolicyEligibility(registry, request, "2028-01-01T00:00:00.000Z")).reason, "policy_not_current");

  registry = assertSuccess(appendSourceRevision(registry, syntheticRevision({
    revision: 5,
    state: "takedown",
    configuration: cloneSynthetic(replacement),
    event: syntheticEvent({ eventId: "aud_lifecycle_takedown", kind: "takedown", at: "2028-01-02T00:00:00.000Z", reasonRef: "reason_lifecycle_takedown" }),
  })));
  assert.equal(assertSuccess(evaluatePolicyEligibility(registry, request, "2028-01-03T00:00:00.000Z")).reason, "takedown");

  const reparsed = assertSuccess(parseSourceRegistry(JSON.parse(JSON.stringify(registry))));
  assert.deepEqual(reparsed.revisions.map(({ event }) => event.kind), ["create", "enable", "replace_configuration", "enable", "takedown"]);
  assert.deepEqual(reparsed.revisions[0], syntheticRegistry().revisions[0]);
  assert.equal(Object.isFrozen(reparsed.revisions), true);
});
