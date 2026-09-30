import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { authenticatePostgresRuntimeRestoreMaterial, authenticatePriorPostgresColdLoad,
  postgresRuntimeRestoreEngineInput, validatePostgresRuntimeRestoreEngineIdentity } from "../scripts/postgres-image/runtime-restore-input.mjs";
import { POSTGRES_RUNTIME_RESTORE_PIN as PIN } from "../scripts/postgres-image/runtime-restore-policy.mjs";
import { COLD_LOAD_PIN } from "../scripts/postgres-image/cold-load-policy.mjs";
const error = { message: "postgres_runtime_restore_material_invalid" };
const sha = (value) => createHash("sha256").update(value).digest("hex");
const nonce = "c".repeat(24);
const identity = () => ({ daemonId: "owned-daemon", endpoint: "unix:///var/tmp/aw-pr-ABC123/endpoint/docker.sock",
  dataRoot: "/var/tmp/aw-pr-ABC123/infra/data", containerdAddress: "/run/containerd/containerd.sock",
  containersNamespace: "awpgsql-" + nonce, pluginsNamespace: "plugins.awpgsql-" + nonce,
  dockerConfig: "/var/tmp/aw-pr-ABC123/client", contextName: "aw-pg-restore-" + nonce,
  socket: { dev: "1", ino: "2", uid: 0, gid: 1000, mode: 0o660 },
  socketDirectory: { dev: "1", ino: "3", uid: 0, gid: 1000, mode: 0o710 } });
test("SQL restore retains independent original/copy pins and prior cold-load provenance", () => {
  assert.equal(PIN.purpose, "POSTGRES_RUNTIME_SQL_RESTORE");
  for (const name of Object.keys(COLD_LOAD_PIN)) assert.deepEqual(PIN[name], COLD_LOAD_PIN[name]);
  assert.deepEqual(PIN.priorColdLoad, { file: "/var/tmp/aw-cl-NqQrTO/receipt.json", size: 59_779,
    sha256: "a686e2bece45448dd81778eea03083519795bcc49d72c58228fed048ea1f9411",
    recipeRevision: "cf702598081863335bd36801713adc5022541d73",
    executionId: "local-cold-load-35ae05a70312ef7fedfe5105", nonce: "35ae05a70312ef7fedfe5105" });
  assert.equal(PIN.auditRunId, "36673766454");
  assert.equal(PIN.auditRecipeRevision, "5186a241f9ab28add4098648aa4bc56d36b5e6dc");
  assert.equal(PIN.auditReceiptSha256, "93c7a582105c7e56aaa5091a4d589cb701ecebc64a9527d8eff40d684252cfbb");
  for (const value of [PIN, PIN.priorColdLoad, PIN.runtimePolicy, PIN.original, PIN.original.files]) assert.equal(Object.isFrozen(value), true);
});
test("committed runtime policy bytes match the separately fixed audit/config authority", () => {
  const bytes = readFileSync(new URL("../infra/postgres-image/candidate-runtime.json", import.meta.url));
  assert.equal(bytes.length, PIN.runtimePolicy.size); assert.equal(sha(bytes), PIN.runtimePolicy.sha256);
  const value = JSON.parse(bytes);
  assert.equal(value.audit.runId, PIN.auditRunId); assert.equal(value.audit.recipeRevision, PIN.auditRecipeRevision);
  assert.equal(value.audit.receipt.sha256, PIN.auditReceiptSha256);
  assert.equal(value.subject, JSON.parse(readFileSync(new URL("../infra/postgres-image/candidate-remote.json", import.meta.url))).subject);
});
test("runtime authentication refuses missing, changed, truncated, appended and nonbuffer bytes", () => {
  const source = readFileSync(new URL("../infra/postgres-image/candidate-runtime.json", import.meta.url));
  const changed = Buffer.from(source); changed[0] ^= 1;
  for (const bytes of [null, {}, "runtime", new Uint8Array(source), Buffer.alloc(0), changed, source.subarray(0, -1),
    Buffer.concat([source, Buffer.from("\n")]), Buffer.alloc(PIN.runtimePolicy.size + 1)]) {
    assert.throws(() => authenticatePostgresRuntimeRestoreMaterial(Buffer.alloc(0), Buffer.alloc(0), bytes), error);
  }
  // Correct runtime bytes still cannot authorize a forged or missing independently pinned private-copy receipt.
  const policy = readFileSync(new URL("../infra/postgres-image/candidate-remote.json", import.meta.url));
  for (const copy of [Buffer.alloc(0), Buffer.alloc(PIN.copyReceiptBytes), Buffer.from(JSON.stringify({ state: "VERIFIED", sha256: PIN.copyReceiptSha256 }))]) {
    assert.throws(() => authenticatePostgresRuntimeRestoreMaterial(policy, copy, source), error);
  }
});
test("prior cold-load hash and exact byte count reject self-asserted success before parsing", () => {
  for (const bytes of [null, {}, "receipt", Buffer.alloc(0), Buffer.alloc(PIN.priorColdLoad.size), Buffer.alloc(PIN.priorColdLoad.size - 1),
    Buffer.alloc(PIN.priorColdLoad.size + 1), Buffer.from(JSON.stringify({ state: "VERIFIED", sha256: PIN.priorColdLoad.sha256 }))]) {
    assert.throws(() => authenticatePriorPostgresColdLoad(bytes, {}, Buffer.alloc(0), Buffer.alloc(0)), error);
  }
});
test("projected engine identity closes purpose-specific endpoint, namespaces and native socket proofs", () => {
  const value = validatePostgresRuntimeRestoreEngineIdentity(identity(), nonce); assert.deepEqual(value, identity());
  assert.equal(Object.isFrozen(value), true); assert.equal(Object.isFrozen(value.socket), true);
  assert.equal(Object.isFrozen(value.socketDirectory), true);
});
for (const [name, mutate] of [
  ["extra field", (v) => { v.rootActor = { uid: 0 }; }], ["foreign endpoint", (v) => { v.endpoint = "unix:///var/run/docker.sock"; }],
  ["foreign data", (v) => { v.dataRoot = "/var/lib/docker"; }], ["alternate containerd", (v) => { v.containerdAddress = "/tmp/containerd.sock"; }],
  ["principal namespace", (v) => { v.containersNamespace = "moby"; }], ["principal plugins", (v) => { v.pluginsNamespace = "plugins.moby"; }],
  ["cold namespace", (v) => { v.containersNamespace = "awcold-" + nonce; }], ["wrong nonce", (v) => { v.pluginsNamespace = "plugins.awpgsql-" + "f".repeat(24); }],
  ["foreign context", (v) => { v.contextName = "default"; }], ["escaped config", (v) => { v.dockerConfig = "/var/tmp/aw-pr-ABC123/client/../foreign"; }],
  ["old directory", (v) => { v.dockerConfig = "/var/tmp/aw-cl-ABC123/client"; }], ["unknown daemon", (v) => { v.daemonId = ""; }],
  ["nonroot socket owner", (v) => { v.socket.uid = 1000; }], ["wrong socket group", (v) => { v.socket.gid = 989; }],
  ["open socket permissions", (v) => { v.socket.mode = 0o666; }], ["wrong directory group", (v) => { v.socketDirectory.gid = 0; }],
  ["public directory mode", (v) => { v.socketDirectory.mode = 0o755; }], ["numeric inode", (v) => { v.socket.ino = 2; }],
  ["zero inode", (v) => { v.socket.ino = "0"; }], ["leading-zero inode", (v) => { v.socket.ino = "02"; }],
  ["extra socket field", (v) => { v.socket.nlink = 1; }], ["nonobject socket", (v) => { v.socket = []; }],
]) test("engine identity rejects " + name, () => {
  const value = identity(); mutate(value); assert.throws(() => validatePostgresRuntimeRestoreEngineIdentity(value, nonce), error);
});
test("identity validators refuse coercible native metadata without conversion hooks", () => {
  let reads = 0; const object = { toString() { reads++; return "1"; } };
  for (const field of ["endpoint", "daemonId", "dockerConfig"]) {
    assert.throws(() => validatePostgresRuntimeRestoreEngineIdentity({ ...identity(), [field]: object }, nonce), error);
  }
  const value = identity(); value.socket.dev = object; assert.throws(() => validatePostgresRuntimeRestoreEngineIdentity(value, nonce), error);
  assert.throws(() => validatePostgresRuntimeRestoreEngineIdentity(identity(), object), error); assert.equal(reads, 0);
});
test("public engine input cannot turn well-framed fake metadata into authenticated material", () => {
  const base64 = (v) => Buffer.from(v).toString("base64");
  const start = { kind: "START", nonce, recipeRevision: "d".repeat(40), executionId: "local-pg-restore-" + nonce, identity: identity(),
    policyBytesBase64: base64("policy"), copyReceiptBytesBase64: base64("receipt"), runtimePolicyBytesBase64: base64("runtime"),
    workDirectory: "/var/tmp/aw-pr-ABC123/work", auditReceiptSha256: PIN.auditReceiptSha256 };
  assert.throws(() => postgresRuntimeRestoreEngineInput(start), error);
});
