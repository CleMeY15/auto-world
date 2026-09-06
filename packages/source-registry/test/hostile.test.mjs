import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appendSourceRevision,
  deriveSourceHealth,
  evaluatePolicyEligibility,
  parseSourceRegistry,
} from "@auto-world/source-registry";
import {
  SYNTHETIC_NOW,
  syntheticEnabledRegistry,
  syntheticHealthSample,
  syntheticRegistry,
  syntheticRequest,
} from "./fixtures/synthetic.mjs";
import { assertIssue } from "./helpers.mjs";

test("rejects unknown keys without echoing names or values", () => {
  const secret = "synthetic-secret-value";
  const result = parseSourceRegistry({ ...syntheticRegistry(), [secret]: secret });
  assertIssue(result, "unknown_key", "$");
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("rejects unknown nested keys at their enclosing schema path", () => {
  const input = syntheticRegistry();
  input.revisions[0].configuration.policy.authorization.unexpected = "synthetic-secret-value";
  const result = parseSourceRegistry(input);
  assertIssue(result, "unknown_key", "$.revisions[0].configuration.policy.authorization");
  assert.equal(JSON.stringify(result).includes("synthetic-secret-value"), false);
});

test("rejects symbol properties", () => {
  const input = syntheticRegistry();
  input[Symbol("hidden")] = true;
  assertIssue(parseSourceRegistry(input), "unknown_key", "$");
});

test("rejects non-enumerable properties", () => {
  const hidden = syntheticRegistry();
  Object.defineProperty(hidden, "hidden", { value: true });
  assertIssue(parseSourceRegistry(hidden), "unknown_key", "$");
});

test("rejects accessors without invoking them", () => {
  let calls = 0;
  const input = syntheticRegistry();
  Object.defineProperty(input, "sourceId", {
    enumerable: true,
    get() {
      calls += 1;
      return "src_accessor";
    },
  });
  assertIssue(parseSourceRegistry(input), "invalid_object", "$");
  assert.equal(calls, 0);
});

test("rejects sparse and augmented revision arrays", () => {
  const sparse = syntheticRegistry({ revisions: [syntheticRegistry().revisions[0], syntheticRegistry().revisions[0]] });
  delete sparse.revisions[1];
  assertIssue(parseSourceRegistry(sparse), "invalid_object", "$.revisions");
  const augmented = syntheticRegistry();
  augmented.revisions.extra = true;
  assertIssue(parseSourceRegistry(augmented), "invalid_object", "$.revisions");
});

test("sanitizes revoked proxies at every public boundary", () => {
  const values = [syntheticRegistry(), syntheticRegistry(), syntheticEnabledRegistry(), syntheticEnabledRegistry(), syntheticRegistry()];
  const calls = [
    (value) => parseSourceRegistry(value),
    (value) => appendSourceRevision(value, syntheticRegistry().revisions[0]),
    (value) => evaluatePolicyEligibility(value, syntheticRequest(), SYNTHETIC_NOW),
    (value) => evaluatePolicyEligibility(syntheticEnabledRegistry(), value, SYNTHETIC_NOW),
    (value) => deriveSourceHealth(value, syntheticHealthSample(), SYNTHETIC_NOW),
  ];
  const paths = ["$", "$.registry", "$.registry", "$.request", "$.registry"];
  for (let index = 0; index < calls.length; index += 1) {
    const { proxy, revoke } = Proxy.revocable(values[index], {});
    revoke();
    assertIssue(calls[index](proxy), "invalid_object", paths[index]);
  }
});

test("rejects hostile reflection failures without leaking exceptions", () => {
  const input = new Proxy(syntheticRegistry(), {
    ownKeys() {
      throw new Error("synthetic-secret-value");
    },
  });
  const result = parseSourceRegistry(input);
  assertIssue(result, "invalid_object", "$");
  assert.equal(JSON.stringify(result).includes("synthetic-secret-value"), false);
});
