import assert from "node:assert/strict";
import test from "node:test";

import { collectAuthenticatedSeaweedSource, requireAuthenticatedSeaweedSource } from "../scripts/seaweed-image/source-origin.mjs";

test("caller-shaped source origin receipts cannot cross the in-process authority boundary", () => {
  const forged = Object.freeze({
    kind: "SEAWEED_SOURCE_ORIGIN_V1",
    schemaVersion: 1,
    state: "AUTHENTICATED",
    authority: "GITHUB_API_READ",
    candidateAuthorization: "NOT_AUTHORIZED",
    repository: "CleMeY15/auto-world",
    runId: 35884717093,
    attempt: 1,
    artifacts: [],
  });
  for (const value of [null, undefined, {}, forged, JSON.parse(JSON.stringify(forged)), new Proxy(forged, {})]) {
    assert.throws(
      () => requireAuthenticatedSeaweedSource(value),
      { code: "seaweed_source_origin_not_authenticated" },
    );
  }
});
test("production source collector rejects transport and policy injection before any network read", async () => {
  await assert.rejects(
    collectAuthenticatedSeaweedSource({ execFile: () => { throw new Error("must not run"); } }),
    { code: "seaweed_source_origin_options_invalid" },
  );
  await assert.rejects(
    collectAuthenticatedSeaweedSource({ policy: {} }),
    { code: "seaweed_source_origin_options_invalid" },
  );
  const accessor = {};
  Object.defineProperty(accessor, "signal", { get() { throw new Error("must not run"); } });
  await assert.rejects(
    collectAuthenticatedSeaweedSource(accessor),
    { code: "seaweed_source_origin_options_invalid" },
  );
});
