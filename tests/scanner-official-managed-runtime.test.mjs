import assert from "node:assert/strict";
import test from "node:test";
import { commandFailureDiagnostic, validateManagedRuntimeResult, validatePreparedRuntimeImage } from "../scripts/scanner/official-audit.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

const run = { sourceCommit: "a".repeat(40), runId: "90001", attempt: "2" };
const roles = ["postgres", "opensearch", "redis", "seaweedfs", "aws-cli"].map((role, index) =>
  ({ role, imageId: `sha256:${String(index + 1).repeat(64)}` }));
const fixture = freeze({ schemaVersion: 1, run: clone(run), roles: clone(roles), cases: [
  { name: "start-and-refusal", status: "passed", code: "verified" },
  { name: "sql-raw-index", status: "passed", code: "verified" },
  { name: "restart-persistence", status: "passed", code: "verified" },
  { name: "cold-canonical-restore", status: "passed", code: "verified" },
], cleanup: { result: "passed" } });
const expected = freeze({ run: clone(run), roles: roles.map((role) => ({ ...role, parentPrivateEvidence: "not a published field" })) });
const reject = (value, ...contexts) => assert.throws(() => validateManagedRuntimeResult(value, contexts.length ? contexts[0] : expected),
  /scanner_managed_runtime_result_invalid/u);

test("managed runtime returns a detached finite result without mutating frozen input or publishing parent metadata", () => {
  const before = JSON.stringify(fixture), expectedBefore = JSON.stringify(expected);
  const result = validateManagedRuntimeResult(fixture, expected);
  assert.deepEqual(result, fixture);
  assert.notEqual(result, fixture);
  assert.notEqual(result.run, fixture.run);
  assert.notEqual(result.roles, fixture.roles);
  assert.notEqual(result.cases, fixture.cases);
  assert.notEqual(result.cleanup, fixture.cleanup);
  result.roles.forEach((role, index) => assert.notEqual(role, fixture.roles[index]));
  result.cases.forEach((item, index) => assert.notEqual(item, fixture.cases[index]));
  result.run.attempt = "changed";
  result.roles[0].imageId = "changed";
  result.cases[0].code = "changed";
  result.cleanup.result = "changed";
  assert.equal(JSON.stringify(fixture), before);
  assert.equal(JSON.stringify(expected), expectedBefore);
  assert.equal(JSON.stringify(validateManagedRuntimeResult(fixture, expected)).includes("parentPrivateEvidence"), false);
});

test("managed runtime binds the complete role set independently of role ordering", () => {
  const value = clone(fixture);
  value.roles.reverse();
  assert.deepEqual(validateManagedRuntimeResult(freeze(value), expected), value);
});

test("managed runtime retains a cleanup failure even when every case passed", () => {
  const value = clone(fixture);
  value.cleanup.result = "failed";
  assert.deepEqual(validateManagedRuntimeResult(freeze(value), expected), value);
});

for (let failedIndex = 0; failedIndex < 4; failedIndex++) {
  for (const cleanup of ["passed", "failed"]) {
    test(`managed runtime retains failure at case ${failedIndex + 1} and cleanup ${cleanup}`, () => {
      const value = clone(fixture);
      value.cases[failedIndex].status = "failed";
      value.cases[failedIndex].code = "failed";
      for (const item of value.cases.slice(failedIndex + 1)) { item.status = "not_run"; item.code = "not_run"; }
      value.cleanup.result = cleanup;
      assert.deepEqual(validateManagedRuntimeResult(freeze(value), expected), value);
    });
  }
}

for (const [label, mutate] of [
  ["absent result", () => undefined],
  ["null result", () => null],
  ["array result", () => []],
  ["empty result", () => ({})],
  ["schema version string", (value) => ({ ...value, schemaVersion: "1" })],
  ["unknown schema version", (value) => ({ ...value, schemaVersion: 2 })],
  ["extra top-level private payload", (value) => ({ ...value, payload: "private runtime output" })],
  ["extra run field", (value) => { value.run.environment = "private"; return value; }],
  ["extra role field", (value) => { value.roles[0].logs = "private"; return value; }],
  ["extra case field", (value) => { value.cases[0].observations = "private"; return value; }],
  ["extra cleanup field", (value) => { value.cleanup.error = "private"; return value; }],
  ["missing run", (value) => { delete value.run; return value; }],
  ["missing cleanup", (value) => { delete value.cleanup; return value; }],
  ["missing role", (value) => { value.roles.pop(); return value; }],
  ["extra role", (value) => { value.roles.push(clone(value.roles[0])); return value; }],
  ["duplicate role", (value) => { value.roles[1] = clone(value.roles[0]); return value; }],
  ["unknown role with undefined image ID", (value) => { value.roles[0] = { role: "unknown", imageId: undefined }; return value; }],
  ["array role with undefined image ID", (value) => { value.roles[0] = { role: ["postgres"], imageId: undefined }; return value; }],
  ["role string coercion", (value) => { value.roles[0].role = ["postgres"]; return value; }],
  ["image ID string coercion", (value) => { value.roles[0].imageId = [value.roles[0].imageId]; return value; }],
  ["substituted image ID", (value) => { value.roles[0].imageId = `sha256:${"f".repeat(64)}`; return value; }],
  ["swapped role subjects", (value) => { [value.roles[0].imageId, value.roles[1].imageId] = [value.roles[1].imageId, value.roles[0].imageId]; return value; }],
  ["no observed cases", (value) => { value.cases = []; return value; }],
  ["no cases field", (value) => { delete value.cases; return value; }],
  ["partial case report", (value) => { value.cases.pop(); return value; }],
  ["extra case", (value) => { value.cases.push(clone(value.cases[0])); return value; }],
  ["duplicate case", (value) => { value.cases[1] = clone(value.cases[0]); return value; }],
  ["out-of-order cases", (value) => { value.cases.reverse(); return value; }],
  ["arbitrary case name", (value) => { value.cases[0].name = "private log text"; return value; }],
  ["passed case without verification", (value) => { value.cases[0].code = "not_run"; return value; }],
  ["arbitrary status string", (value) => { value.cases[0].status = "success: private text"; return value; }],
  ["arbitrary code string", (value) => { value.cases[0].code = "private error details"; return value; }],
  ["failed case with verified code", (value) => { value.cases[0].status = "failed"; return value; }],
  ["not-run before any failure", (value) => { value.cases[0].status = "not_run"; value.cases[0].code = "not_run"; return value; }],
  ["all cases unobserved", (value) => { value.cases.forEach((item) => { item.status = "not_run"; item.code = "not_run"; }); return value; }],
  ["passed case after a failure", (value) => { value.cases[0].status = "failed"; value.cases[0].code = "failed"; return value; }],
  ["second failure after a failure", (value) => { value.cases.forEach((item) => { item.status = "failed"; item.code = "failed"; }); return value; }],
  ["arbitrary cleanup string", (value) => { value.cleanup.result = "cleanup failed with private text"; return value; }],
  ["boolean cleanup", (value) => { value.cleanup.result = true; return value; }],
]) {
  test(`managed runtime rejects ${label}`, () => reject(mutate(clone(fixture))));
}

for (const key of ["sourceCommit", "runId", "attempt"]) {
  test(`managed runtime rejects stale ${key}`, () => {
    const value = clone(fixture);
    value.run[key] = key === "sourceCommit" ? "b".repeat(40) : "999";
    reject(value);
  });
}

for (const [key, invalid] of [
  ["sourceCommit", "A".repeat(40)], ["sourceCommit", "a".repeat(39)], ["sourceCommit", ["a".repeat(40)]],
  ["runId", "0"], ["runId", "01"], ["runId", "-1"], ["runId", "1.0"], ["runId", 90001],
  ["attempt", "0"], ["attempt", "02"], ["attempt", "NaN"], ["attempt", ["2"]],
]) {
  test(`managed runtime rejects malformed ${key} ${JSON.stringify(invalid)} even with matching parent input`, () => {
    const value = clone(fixture), context = clone(expected);
    value.run[key] = invalid;
    context.run[key] = invalid;
    reject(value, context);
  });
}

for (const [label, mutate] of [
  ["absent context", () => undefined],
  ["missing run", (context) => { delete context.run; return context; }],
  ["missing roles", (context) => { delete context.roles; return context; }],
  ["missing expected role", (context) => { context.roles.pop(); return context; }],
  ["duplicate expected role", (context) => { context.roles[1] = clone(context.roles[0]); return context; }],
  ["unknown expected role", (context) => { context.roles[0].role = "unknown"; return context; }],
  ["invalid expected config ID", (context) => { context.roles[0].imageId = "postgres:latest"; return context; }],
  ["coerced expected config ID", (context) => { context.roles[0].imageId = [context.roles[0].imageId]; return context; }],
]) {
  test(`managed runtime refuses ${label}`, () => reject(fixture, mutate(clone(expected))));
}

const inspectedFixture = freeze([{ Id: roles[2].imageId, Os: "linux", Architecture: "amd64" }]);
const scanFixture = freeze({ ArtifactID: `sha256:${"f".repeat(64)}`, Metadata: { ImageID: roles[2].imageId } });

test("prepared runtime binds the inspected Linux amd64 config ID to Metadata.ImageID, independently of ArtifactID", () => {
  assert.equal(validatePreparedRuntimeImage(inspectedFixture, scanFixture), roles[2].imageId);
  assert.equal(validatePreparedRuntimeImage(inspectedFixture, freeze({ Metadata: { ImageID: roles[2].imageId } })), roles[2].imageId);
});

for (const [label, mutate] of [
  ["empty inspect", () => []],
  ["multiple inspected images", (value) => [...value, clone(value[0])]],
  ["non-array inspect", (value) => value[0]],
  ["non-Linux image", (value) => { value[0].Os = "windows"; return value; }],
  ["wrong architecture", (value) => { value[0].Architecture = "arm64"; return value; }],
  ["image tag instead of config ID", (value) => { value[0].Id = "redis:latest"; return value; }],
  ["config ID coercion", (value) => { value[0].Id = [value[0].Id]; return value; }],
  ["substituted inspected config ID", (value) => { value[0].Id = scanFixture.ArtifactID; return value; }],
]) {
  test(`prepared runtime refuses ${label}`, () => assert.throws(() => validatePreparedRuntimeImage(mutate(clone(inspectedFixture)), scanFixture),
    /scanner_managed_runtime_image_invalid/u));
}

for (const [label, report] of [
  ["missing report", undefined],
  ["ArtifactID alone", { ArtifactID: roles[2].imageId }],
  ["missing metadata image ID", { ArtifactID: roles[2].imageId, Metadata: {} }],
  ["ArtifactID matches but metadata differs", { ArtifactID: roles[2].imageId, Metadata: { ImageID: roles[1].imageId } }],
  ["coerced metadata image ID", { Metadata: { ImageID: [roles[2].imageId] } }],
]) {
  test(`prepared runtime refuses ${label}`, () => assert.throws(() => validatePreparedRuntimeImage(inspectedFixture, freeze(report)),
    /scanner_managed_runtime_image_invalid/u));
}

test("private runtime diagnostics publish byte counts and a finite reason without any private output", () => {
  const token = `ghp_${"a".repeat(25)}`;
  const result = { stdout: Buffer.from(`TAP version 13\nPRIVATE_TOKEN=${token}\nvehicle payload é\n`),
    stderr: Buffer.from(`error: private assertion\nAuthorization: Bearer ${token}\nENV=private-value\n`), status: 1 };
  const beforeStdout = Buffer.from(result.stdout), beforeStderr = Buffer.from(result.stderr);
  const published = commandFailureDiagnostic(result, { privateOutput: true });
  assert.deepEqual(published, { stdoutBytes: result.stdout.length, stderrBytes: result.stderr.length, reason: "private_runtime_output_not_published" });
  for (const marker of [token, "PRIVATE_TOKEN", "vehicle", "TAP version", "assertion", "Authorization", "ENV=", "private-value"]) {
    assert.equal(JSON.stringify(published).includes(marker), false, marker);
  }
  assert.deepEqual(result.stdout, beforeStdout);
  assert.deepEqual(result.stderr, beforeStderr);
});

test("private runtime diagnostics do not expose non-buffer output or extra diagnostic fields", () => {
  for (const result of [{ stdout: "secret", stderr: "private" }, { stdout: null, stderr: undefined },
    { stdout: new Uint8Array([1, 2]), stderr: {}, stdoutTail: "private", stderrErrors: "private", env: "private" }]) {
    assert.deepEqual(commandFailureDiagnostic(result, { privateOutput: true }),
      { stdoutBytes: 0, stderrBytes: 0, reason: "private_runtime_output_not_published" });
  }
});

test("public command diagnostics retain legacy tails, redaction, error filtering and byte counts", () => {
  const token = `ghp_${"a".repeat(25)}`;
  const aws = `AKIA${"A".repeat(16)}`;
  const stdout = Buffer.from(`visible é ${token} ${aws}\nhttps://user:password@example.invalid/path\n`);
  const stderr = Buffer.from(`progress\nAuthorization: Bearer ${token}\nERROR: useful failure\nnot found: useful path\n`);
  const published = commandFailureDiagnostic({ stdout, stderr });
  assert.deepEqual(published, { stdoutBytes: stdout.length, stderrBytes: stderr.length,
    stdoutTail: "visible é [redacted] [redacted]\nhttps://[redacted]@example.invalid/path\n",
    stderrTail: "progress\nAuthorization: Bearer [redacted]\nERROR: useful failure\nnot found: useful path\n",
    stderrErrors: "ERROR: useful failure\nnot found: useful path" });
  assert.deepEqual(commandFailureDiagnostic({ stdout, stderr }, { privateOutput: false }), published);
  const long = commandFailureDiagnostic({ stdout: Buffer.from("x".repeat(5000)), stderr: Buffer.from("y".repeat(5000)) });
  assert.equal(long.stdoutBytes, 5000);
  assert.equal(long.stderrBytes, 5000);
  assert.equal(long.stdoutTail, "x".repeat(4096));
  assert.equal(long.stderrTail, "y".repeat(4096));
});
