import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSourceRegistry } from "@auto-world/source-registry";
import {
  cloneSynthetic,
  syntheticConfiguration,
  syntheticRegistry,
} from "./fixtures/synthetic.mjs";
import { assertIssue, assertSuccess } from "./helpers.mjs";

test("parses a synthetic disabled source registry through the public export", () => {
  assert.deepEqual(assertSuccess(parseSourceRegistry(syntheticRegistry())), syntheticRegistry());
});

test("round-trips a complete registry through JSON", () => {
  const parsed = assertSuccess(parseSourceRegistry(syntheticRegistry()));
  assert.deepEqual(assertSuccess(parseSourceRegistry(JSON.parse(JSON.stringify(parsed)))), parsed);
});

test("accepts every declared legal status without inferring permission", () => {
  for (const legalStatus of [
    "official_api",
    "licensed_partner",
    "dealer_feed",
    "permitted_crawl",
    "restricted",
    "blocked",
    "unknown",
  ]) {
    const configuration = syntheticConfiguration({ legalStatus, policy: null });
    assertSuccess(parseSourceRegistry(syntheticRegistry({ revisions: [{ ...syntheticRegistry().revisions[0], configuration }] })));
  }
});

test("rejects invented legal status values", () => {
  const configuration = syntheticConfiguration({ legalStatus: "public_website" });
  const registry = syntheticRegistry({ revisions: [{ ...syntheticRegistry().revisions[0], configuration }] });
  assertIssue(parseSourceRegistry(registry), "invalid_value", "$.revisions[0].configuration.legalStatus");
});

test("accepts only schema version 1", () => {
  assertIssue(parseSourceRegistry(syntheticRegistry({ schemaVersion: 2 })), "unsupported_version", "$.schemaVersion");
});

test("requires a source ID in the canonical namespace", () => {
  assertIssue(parseSourceRegistry(syntheticRegistry({ sourceId: "veh_wrong" })), "invalid_value", "$.sourceId");
});

test("rejects empty revision history", () => {
  assertIssue(parseSourceRegistry(syntheticRegistry({ revisions: [] })), "invalid_value", "$.revisions");
});

test("rejects duplicate territories", () => {
  const configuration = syntheticConfiguration({ territories: ["FR", "FR"] });
  const registry = syntheticRegistry({ revisions: [{ ...syntheticRegistry().revisions[0], configuration }] });
  assertIssue(parseSourceRegistry(registry), "duplicate_id", "$.revisions[0].configuration.territories[1]");
});

test("rejects duplicate contextual grant tuples", () => {
  const configuration = syntheticConfiguration();
  configuration.policy.grants.push(cloneSynthetic(configuration.policy.grants[0]));
  const registry = syntheticRegistry({ revisions: [{ ...syntheticRegistry().revisions[0], configuration }] });
  assertIssue(parseSourceRegistry(registry), "duplicate_id", "$.revisions[0].configuration.policy.grants[2]");
});

test("rejects credential values instead of secret references", () => {
  const configuration = syntheticConfiguration({ credentials: { kind: "secret_ref", ref: "secret://auto-world/synthetic", value: "synthetic-secret-value" } });
  const registry = syntheticRegistry({ revisions: [{ ...syntheticRegistry().revisions[0], configuration }] });
  assertIssue(parseSourceRegistry(registry), "unknown_key", "$.revisions[0].configuration.credentials");
});

test("rejects malformed secret references", () => {
  for (const ref of ["synthetic-secret-value", "secret://other/synthetic", "secret://auto-world/alias\n"]) {
    const configuration = syntheticConfiguration({ credentials: { kind: "secret_ref", ref } });
    const registry = syntheticRegistry({ revisions: [{ ...syntheticRegistry().revisions[0], configuration }] });
    assertIssue(parseSourceRegistry(registry), "invalid_value", "$.revisions[0].configuration.credentials.ref");
  }
});

test("rejects C0 and C1 controls in display names", () => {
  for (const displayName of ["synthetic\nsource", "synthetic\u0085source", "synthetic\u009fsource"]) {
    const configuration = syntheticConfiguration({ displayName });
    const registry = syntheticRegistry({ revisions: [{ ...syntheticRegistry().revisions[0], configuration }] });
    assertIssue(parseSourceRegistry(registry), "invalid_value", "$.revisions[0].configuration.displayName");
  }
});

test("does not retain mutable caller references", () => {
  const input = syntheticRegistry();
  const parsed = assertSuccess(parseSourceRegistry(input));
  input.revisions[0].configuration.territories[0] = "DE";
  input.revisions[0].configuration.policy.authorization.basisRef = "evidence_mutated";
  assert.equal(parsed.revisions[0].configuration.territories[0], "FR");
  assert.equal(parsed.revisions[0].configuration.policy.authorization.basisRef, "evidence_synthetic_contract");
});

test("deep-freezes successful registry graphs without freezing input", () => {
  const input = cloneSynthetic(syntheticRegistry());
  const parsed = assertSuccess(parseSourceRegistry(input));
  assert.equal(Object.isFrozen(input), false);
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.revisions), true);
  assert.equal(Object.isFrozen(parsed.revisions[0].configuration.policy.grants[0].fields), true);
  assert.throws(() => parsed.revisions.push(parsed.revisions[0]), TypeError);
});

test("rejects caching beyond normalized retention", () => {
  const configuration = syntheticConfiguration({
    policy: {
      ...syntheticConfiguration().policy,
      caching: { allowed: true, maxAgeSeconds: 172_801 },
    },
  });
  const registry = syntheticRegistry({ revisions: [{ ...syntheticRegistry().revisions[0], configuration }] });
  assertIssue(parseSourceRegistry(registry), "invalid_value", "$.revisions[0].configuration.policy.caching.maxAgeSeconds");
});

test("requires zero cache age when caching is forbidden", () => {
  const configuration = syntheticConfiguration({
    policy: { ...syntheticConfiguration().policy, caching: { allowed: false, maxAgeSeconds: 1 } },
  });
  const registry = syntheticRegistry({ revisions: [{ ...syntheticRegistry().revisions[0], configuration }] });
  assertIssue(parseSourceRegistry(registry), "invalid_value", "$.revisions[0].configuration.policy.caching.maxAgeSeconds");
});

test("requires source publication identity in every grant", () => {
  const policy = { ...syntheticConfiguration().policy, grants: [{ territory: "FR", acquisitionMethod: "feed", audience: "internal", fields: ["price"] }] };
  const configuration = syntheticConfiguration({ policy });
  const registry = syntheticRegistry({ revisions: [{ ...syntheticRegistry().revisions[0], configuration }] });
  assertIssue(parseSourceRegistry(registry), "invalid_value", "$.revisions[0].configuration.policy.grants[0].fields");
});

test("requires every declared policy section", () => {
  for (const section of ["authorization", "grants", "caching", "retention", "media", "pii", "takedown"]) {
    const policy = cloneSynthetic(syntheticConfiguration().policy);
    delete policy[section];
    const configuration = syntheticConfiguration({ policy });
    const registry = syntheticRegistry({ revisions: [{ ...syntheticRegistry().revisions[0], configuration }] });
    assertIssue(parseSourceRegistry(registry), "missing_field", `$.revisions[0].configuration.policy.${section}`);
  }
});

test("requires every authorization reference and timestamp", () => {
  for (const field of ["basisRef", "reviewerRef", "reviewedAt", "validFrom", "validUntil"]) {
    const policy = cloneSynthetic(syntheticConfiguration().policy);
    delete policy.authorization[field];
    const configuration = syntheticConfiguration({ policy });
    const registry = syntheticRegistry({ revisions: [{ ...syntheticRegistry().revisions[0], configuration }] });
    assertIssue(parseSourceRegistry(registry), "missing_field", `$.revisions[0].configuration.policy.authorization.${field}`);
  }
});

test("requires every source configuration section", () => {
  for (const field of ["displayName", "territories", "acquisitionMethods", "credentials", "legalStatus", "policy", "operations", "healthPolicy"]) {
    const configuration = syntheticConfiguration();
    delete configuration[field];
    const registry = syntheticRegistry({ revisions: [{ ...syntheticRegistry().revisions[0], configuration }] });
    assertIssue(parseSourceRegistry(registry), "missing_field", `$.revisions[0].configuration.${field}`);
  }
});

test("requires every operations field", () => {
  for (const field of ["incremental", "fullReconcileIntervalSeconds", "deletionMode", "deletionPropagationSeconds", "freshnessSeconds", "requestsPerMinute", "concurrency", "timeoutMs", "maxRetries"]) {
    const configuration = syntheticConfiguration();
    delete configuration.operations[field];
    const registry = syntheticRegistry({ revisions: [{ ...syntheticRegistry().revisions[0], configuration }] });
    assertIssue(parseSourceRegistry(registry), "missing_field", `$.revisions[0].configuration.operations.${field}`);
  }
});

test("requires every health-policy field", () => {
  for (const field of ["maxSampleAgeSeconds", "maxSuccessAgeSeconds", "maxErrorBps", "maxParseErrorBps", "maxStaleBps", "maxLatencyP95Ms"]) {
    const configuration = syntheticConfiguration();
    delete configuration.healthPolicy[field];
    const registry = syntheticRegistry({ revisions: [{ ...syntheticRegistry().revisions[0], configuration }] });
    assertIssue(parseSourceRegistry(registry), "missing_field", `$.revisions[0].configuration.healthPolicy.${field}`);
  }
});

test("requires every audit event field", () => {
  for (const field of ["eventId", "kind", "actorRef", "at", "reasonRef"]) {
    const registry = syntheticRegistry();
    delete registry.revisions[0].event[field];
    assertIssue(parseSourceRegistry(registry), "missing_field", `$.revisions[0].event.${field}`);
  }
});

test("rejects invalid authorization date ordering", () => {
  const authorizations = [
    { validFrom: "2027-01-01T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z" },
    { reviewedAt: "2027-01-01T00:00:00.001Z", validUntil: "2027-01-01T00:00:00.000Z" },
  ];
  for (const authorization of authorizations) {
    const configuration = syntheticConfiguration({ policy: { ...syntheticConfiguration().policy, authorization: { ...syntheticConfiguration().policy.authorization, ...authorization } } });
    const registry = syntheticRegistry({ revisions: [{ ...syntheticRegistry().revisions[0], configuration }] });
    assert.equal(parseSourceRegistry(registry).success, false);
  }
});

test("rejects nonpositive operational durations", () => {
  for (const field of ["fullReconcileIntervalSeconds", "deletionPropagationSeconds", "freshnessSeconds", "timeoutMs"]) {
    const configuration = syntheticConfiguration();
    configuration.operations[field] = 0;
    const registry = syntheticRegistry({ revisions: [{ ...syntheticRegistry().revisions[0], configuration }] });
    assertIssue(parseSourceRegistry(registry), "invalid_value", `$.revisions[0].configuration.operations.${field}`);
  }
});

test("rejects VIN and seller PII in consumer or B2B grants", () => {
  for (const audience of ["consumer", "b2b"]) {
    for (const field of ["vin", "seller_pii"]) {
      const policy = {
        ...syntheticConfiguration().policy,
        grants: [
          { territory: "FR", acquisitionMethod: "feed", audience: "internal", fields: ["source_listing_id", field] },
          { territory: "FR", acquisitionMethod: "feed", audience, fields: ["source_listing_id", field] },
        ],
      };
      const configuration = syntheticConfiguration({ policy });
      const registry = syntheticRegistry({ revisions: [{ ...syntheticRegistry().revisions[0], configuration }] });
      assert.equal(parseSourceRegistry(registry).success, false);
    }
  }
});

test("requires external audience fields to be a subset of the matching internal clause", () => {
  const policy = {
    ...syntheticConfiguration().policy,
    grants: [
      { territory: "FR", acquisitionMethod: "feed", audience: "internal", fields: ["source_listing_id", "price"] },
      { territory: "FR", acquisitionMethod: "feed", audience: "consumer", fields: ["source_listing_id", "mileage"] },
    ],
  };
  const configuration = syntheticConfiguration({ policy });
  const registry = syntheticRegistry({ revisions: [{ ...syntheticRegistry().revisions[0], configuration }] });
  assertIssue(parseSourceRegistry(registry), "invalid_value", "$.revisions[0].configuration.policy.grants[1].fields");
});

test("enforces media mode against grants and retention", () => {
  const configurations = [
    syntheticConfiguration({
      policy: { ...syntheticConfiguration().policy, media: { mode: "none", attributionRequired: false }, retention: { ...syntheticConfiguration().policy.retention, mediaSeconds: 1 } },
    }),
    syntheticConfiguration({
      policy: { ...syntheticConfiguration().policy, media: { mode: "licensed_copy", attributionRequired: true } },
    }),
  ];
  for (const configuration of configurations) {
    const registry = syntheticRegistry({ revisions: [{ ...syntheticRegistry().revisions[0], configuration }] });
    assert.equal(parseSourceRegistry(registry).success, false);
  }
});

test("enforces PII purpose and retention policy", () => {
  const policy = {
    ...syntheticConfiguration().policy,
    pii: { mode: "professional_only", purposeRef: null },
  };
  const configuration = syntheticConfiguration({ policy });
  const registry = syntheticRegistry({ revisions: [{ ...syntheticRegistry().revisions[0], configuration }] });
  assert.equal(parseSourceRegistry(registry).success, false);
});
