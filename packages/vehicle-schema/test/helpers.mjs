import assert from "node:assert/strict";

export function assertSuccess(result) {
  assert.equal(result.success, true, JSON.stringify(result));
  return result.data;
}

export function assertIssue(result, code, path) {
  assert.equal(result.success, false, "expected validation to fail");
  assert.deepEqual(result.issues, [{ code, path }]);
  const serialized = JSON.stringify(result.issues);
  assert.equal(serialized.includes("SYNTHET1C12345678"), false);
  return result.issues[0];
}
