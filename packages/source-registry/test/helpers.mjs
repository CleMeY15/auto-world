import assert from "node:assert/strict";

export function assertSuccess(result) {
  assert.equal(result.success, true, JSON.stringify(result));
  return result.data;
}

export function assertIssue(result, code, path) {
  assert.equal(result.success, false, "expected validation failure");
  assert.deepEqual(result.issues, [{ code, path }]);
  assert.equal(JSON.stringify(result).includes("synthetic-secret-value"), false);
}
