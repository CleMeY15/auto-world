import assert from "node:assert/strict";
import { test } from "node:test";
import * as contract from "@auto-world/vehicle-schema";

const domains = [
  ["parseListingId", "lst_"],
  ["parseObservationId", "obs_"],
  ["parseConnectorRunId", "run_"],
  ["parseRawSnapshotId", "raw_"],
];

for (const [name, prefix] of domains) {
  test(`${name} accepts its own bounded ID domain through the public export`, () => {
    assert.equal(typeof contract[name], "function");
    for (const suffix of ["a", "synthetic-ID_1", "a".repeat(64)]) {
      const result = contract[name](`${prefix}${suffix}`);
      assert.ok(Object.isFrozen(result));
      assert.deepEqual(result, {
        success: true,
        data: `${prefix}${suffix}`,
      });
    }
  });

  test(`${name} rejects malformed and crossed domains without coercion`, () => {
    let coercions = 0;
    const hostile = { toString() { coercions += 1; throw new Error("opaque synthetic text"); } };
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    for (const input of [
      null, undefined, 0, hostile, proxy, new String(`${prefix}a`),
      prefix, `${prefix}_a`, `${prefix}a b`, `${prefix}a\n`, `${prefix}${"a".repeat(65)}`,
      ...["src_", "veh_", ...domains.map(([, value]) => value)]
        .filter((value) => value !== prefix).map((value) => `${value}synthetic`),
    ]) {
      const result = contract[name](input);
      assert.equal(result.success, false);
      assert.ok(Object.isFrozen(result));
      assert.ok(Object.isFrozen(result.issues));
      assert.deepEqual(Object.keys(result), ["success", "issues"]);
      assert.ok(result.issues.every((issue) => issue.path === "$"));
      assert.ok(!JSON.stringify(result).includes("opaque synthetic text"));
    }
    assert.equal(coercions, 0);
  });
}
