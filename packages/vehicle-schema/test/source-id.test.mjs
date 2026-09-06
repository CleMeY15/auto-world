import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSourceId } from "@auto-world/vehicle-schema";

test("public SourceId parser preserves the canonical namespace and immutable result", () => {
  for (const value of ["src_A", "src_synthetic-1_2", `src_${"a".repeat(64)}`]) {
    const result = parseSourceId(value);
    assert.deepEqual(result, { success: true, data: value });
    assert.equal(Object.isFrozen(result), true);
  }
});

test("public SourceId parser rejects wrong domains, coercion, bounds and line terminators", () => {
  for (const value of [undefined, null, {}, [], 1, "", "src_", "lst_synthetic", "src_-bad", "src__bad", "src_a/b", "src_a\n", "src_a\r", "src_a\u2028", `src_${"a".repeat(65)}`]) {
    const result = parseSourceId(value);
    assert.equal(result.success, false);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.issues), true);
    assert.deepEqual(result.issues, [{ code: typeof value === "string" ? "invalid_value" : "invalid_type", path: "$" }]);
  }
});

test("public SourceId parser never coerces or exposes hostile object content", () => {
  let calls = 0;
  const hostile = { toString() { calls += 1; throw new Error("synthetic-sensitive-value"); } };
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  for (const value of [hostile, proxy]) {
    const result = parseSourceId(value);
    assert.deepEqual(result, { success: false, issues: [{ code: "invalid_type", path: "$" }] });
    assert.doesNotMatch(JSON.stringify(result), /synthetic-sensitive-value/u);
  }
  assert.equal(calls, 0);
});
