import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { POSTGRES_RUNTIME_RESTORE_PHASES, assertPostgresRuntimeRestoreWriterHealthy, postgresRuntimeRestoreFrameReader,
  postgresRuntimeRestoreParentControl, postgresRuntimeRestoreProtocolLimits, postgresRuntimeRestoreWorkerControl,
  validatePostgresRuntimeAuditGrant, validatePostgresRuntimeRestoreStart, writePostgresRuntimeRestoreFrame } from "../scripts/postgres-image/runtime-restore-protocol.mjs";
import { POSTGRES_RUNTIME_RESTORE_PIN as PIN, postgresRuntimeRestoreLimits } from "../scripts/postgres-image/runtime-restore-policy.mjs";
import { validatePostgresRuntimeRestoreWorkerStatus } from "../scripts/postgres-image/runtime-restore-worker.mjs";
const error = { message: "postgres_runtime_restore_control_invalid" };
const nonce = "c".repeat(24);
const identity = { daemonId: "owned-daemon", endpoint: "unix:///var/tmp/aw-pr-ABC123/endpoint/docker.sock", dockerConfig: "/var/tmp/aw-pr-ABC123/client" };
const auditSha = PIN.auditReceiptSha256;
const base64 = (value) => Buffer.from(value).toString("base64");
const start = () => ({ kind: "START", nonce, recipeRevision: "d".repeat(40), executionId: "local-pg-restore-" + nonce,
  identity, policyBytesBase64: base64("policy"), copyReceiptBytesBase64: base64("receipt"),
  runtimePolicyBytesBase64: base64("runtime"), workDirectory: "/var/tmp/aw-pr-ABC123/work", auditReceiptSha256: auditSha });
const request = (sequence, phase = "PREFLIGHT", intent = "OWNERSHIP") => ({ kind: "REQUEST", nonce, sequence, phase, intent });
const encoded = (value) => Buffer.from(JSON.stringify(value) + "\n");
const audit = (phase = "PREFLIGHT", now = Date.now()) => ({ state: "VERIFIED_CURRENT", purpose: "POSTGRES_RUNTIME_SQL_RESTORE", phase,
  daemonId: identity.daemonId, endpoint: identity.endpoint, auditReceiptSha256: auditSha,
  checkedAt: new Date(now).toISOString(), validUntil: new Date(now + 60_000).toISOString() });
test("worker /proc contract binds all four actor IDs, cleared groups/capabilities and NNP", () => {
  const status = "Pid:\t4242\nUid:\t1000\t1000\t1000\t1000\nGid:\t1000\t1000\t1000\t1000\nGroups:\t\n"
    + "CapInh:\t0000000000000000\nCapPrm:\t0000000000000000\nCapEff:\t0000000000000000\nCapAmb:\t0000000000000000\nNoNewPrivs:\t1\n";
  assert.deepEqual(validatePostgresRuntimeRestoreWorkerStatus(status, 4242), { uid: 1000, gid: 1000, supplementalGroups: "CLEARED",
    inheritedCapabilities: "NONE", effectiveCapabilities: "NONE", ambientCapabilities: "NONE", noNewPrivileges: true });
  assert.equal(validatePostgresRuntimeRestoreWorkerStatus(status.replace("Groups:\t\n", "Groups:\t1000\n"), 4242).uid, 1000);
  for (const [before, after] of [["Pid:\t4242", "Pid:\t4243"], ["Uid:\t1000\t1000\t1000\t1000", "Uid:\t1000\t0\t1000\t1000"],
    ["Gid:\t1000\t1000\t1000\t1000", "Gid:\t1000\t1000\t1000\t989"], ["Groups:\t\n", "Groups:\t989\n"],
    ["Groups:\t\n", "Groups:\t1000 1000\n"], ["NoNewPrivs:\t1", "NoNewPrivs:\t0"],
    ...["CapInh", "CapPrm", "CapEff", "CapAmb"].map((name) => [name + ":\t0000000000000000", name + ":\t0000000000000001"])]) {
    assert.throws(() => validatePostgresRuntimeRestoreWorkerStatus(status.replace(before, after), 4242), error);
  }
  for (const [raw, pid] of [[status, 1], [status, "4242"], ["x".repeat(16_385), 4242], [Buffer.from(status), 4242], ["", 4242]]) {
    assert.throws(() => validatePostgresRuntimeRestoreWorkerStatus(raw, pid), error);
  }
});
test("fixed thirteen phases and bounded byte, sequence, execution and cleanup budgets", () => {
  assert.deepEqual(POSTGRES_RUNTIME_RESTORE_PHASES, ["PREFLIGHT", "LOAD", "PROBE", "SOURCE_START", "SOURCE_SQL", "SOURCE_RESTART", "DUMP",
    "SOURCE_DISPOSE", "RESTORE_START", "RESTORE_SQL", "RESTORE_RESTART", "CLEANUP", "FINAL_SEAL"]);
  assert.equal(Object.isFrozen(POSTGRES_RUNTIME_RESTORE_PHASES), true);
  assert.deepEqual(postgresRuntimeRestoreProtocolLimits, { frameBytes: 65_536, totalBytes: 8 * 1024 ** 2, maxSequence: 4096 });
  assert.deepEqual(postgresRuntimeRestoreLimits, { supervisorMs: 1_200_000, engineMs: 900_000, cleanupMs: 120_000,
    daemonCleanupMs: 25_000, receiptBytes: 131_072, auditGrantMaxAgeMs: 5000, dumpBytes: 16 * 1024 ** 2 });
});
test("START is closed, local, typed and canonical", () => {
  assert.deepEqual(validatePostgresRuntimeRestoreStart(start()), start()); let converted = 0;
  const object = { toString() { converted++; return nonce; } };
  for (const mutate of [
    (v) => { v.extra = true; }, (v) => { v.kind = "GRANT"; }, (v) => { v.nonce = object; },
    (v) => { v.recipeRevision = object; }, (v) => { v.recipeRevision = "d".repeat(39); },
    (v) => { v.executionId = "local-cold-load-" + nonce; }, (v) => { v.workDirectory = "/var/tmp/foreign"; },
    (v) => { v.auditReceiptSha256 = object; }, (v) => { v.auditReceiptSha256 = "a".repeat(63); },
    (v) => { v.identity = { ...identity, dockerConfig: object }; },
    (v) => { v.policyBytesBase64 = ""; }, (v) => { v.policyBytesBase64 = "Zg"; },
    (v) => { v.policyBytesBase64 = "Zh=="; }, (v) => { v.copyReceiptBytesBase64 = "a".repeat(40_004); },
    (v) => { v.runtimePolicyBytesBase64 = object; }, (v) => { delete v.runtimePolicyBytesBase64; },
  ]) { const v = start(); mutate(v); assert.throws(() => validatePostgresRuntimeRestoreStart(v), error); }
  assert.equal(converted, 0);
});
test("fragmented binary UTF8 accepts clean EOF and refuses premature finish", async () => {
  const stream = new PassThrough(); const reader = postgresRuntimeRestoreFrameReader(stream); const pending = reader.next();
  const bytes = encoded({ text: "é車" }); const split = bytes.indexOf(0xc3) + 1;
  stream.write(bytes.subarray(0, split)); assert.throws(() => reader.assertFinished(), error);
  stream.end(bytes.subarray(split)); assert.deepEqual(await pending, { text: "é車" });
  if (!stream.readableEnded) await new Promise((resolve) => stream.once("end", resolve)); reader.assertFinished(); reader.close();
});
for (const [name, bytes] of [
  ["malformed JSON", Buffer.from("{]\n")], ["array JSON", Buffer.from("[]\n")], ["primitive JSON", Buffer.from("42\n")],
  ["invalid UTF8", Buffer.from([123, 34, 120, 34, 58, 34, 255, 34, 125, 10])],
  ["oversized unfinished frame", Buffer.alloc(65_537, 65)], ["unterminated JSON", Buffer.from('{"x":1}')],
]) test("reader rejects " + name, async () => {
  const stream = new PassThrough(); const reader = postgresRuntimeRestoreFrameReader(stream); const pending = reader.next();
  stream.end(bytes); await assert.rejects(pending, error); reader.close();
});
test("a 64KiB frame is accepted and one extra payload byte is refused", async () => {
  for (const extra of [0, 1]) {
    const stream = new PassThrough(); const reader = postgresRuntimeRestoreFrameReader(stream);
    const value = { x: "a".repeat(65_528 + extra) }; const pending = reader.next(); stream.end(encoded(value));
    if (extra) await assert.rejects(pending, error);
    else { assert.deepEqual(await pending, value); if (!stream.readableEnded) await new Promise((r) => stream.once("end", r)); reader.assertFinished(); }
    reader.close();
  }
});
test("exactly eight MiB total is accepted and further metadata is refused", async () => {
  const stream = new PassThrough(); const reader = postgresRuntimeRestoreFrameReader(stream); let bytes = 0;
  try {
    for (let index = 0; index < 128; index++) {
      const total = index === 127 ? 8 * 1024 ** 2 - bytes : 65_537;
      const value = { x: "a".repeat(total - 9) }; const frame = encoded(value); assert.equal(frame.length, total);
      const pending = reader.next(); stream.write(frame); assert.deepEqual(await pending, value); reader.allowNext(); bytes += total;
    }
    assert.equal(bytes, 8 * 1024 ** 2);
    const pending = reader.next(); stream.write(encoded({})); await assert.rejects(pending, error);
  } finally { reader.close(); stream.destroy(); }
});
test("bounded wait rejects malformed timeout and overlapping reads", async () => {
  const stream = new PassThrough(); const reader = postgresRuntimeRestoreFrameReader(stream);
  for (const timeout of [0, -1, 90_001, 1.5, Number.NaN]) await assert.rejects(reader.next(timeout), error);
  const pending = reader.next(10); await assert.rejects(reader.next(10), error); await assert.rejects(pending, error);
  reader.close(); stream.destroy();
});
test("metadata wait accepts the fixed90s command ceiling while preserving clean framing", async () => {
  const stream = new PassThrough(); const reader = postgresRuntimeRestoreFrameReader(stream); const pending = reader.next(90_000);
  stream.end(encoded(request(1))); assert.deepEqual(await pending, request(1));
  if (!stream.readableEnded) await new Promise((resolve) => stream.once("end", resolve)); reader.assertFinished(); reader.close();
});
test("pipelined or partial future messages fail before any grant", async () => {
  for (const suffix of [encoded(request(2)), Buffer.from("{")]) {
    const stream = new PassThrough(); const reader = postgresRuntimeRestoreFrameReader(stream); const output = new PassThrough();
    let grants = 0; output.on("data", (chunk) => { grants += chunk.length; }); const first = reader.next();
    stream.write(Buffer.concat([encoded(request(1)), suffix])); assert.deepEqual(await first, request(1));
    await assert.rejects(async () => { reader.assertReadyToReply(); await writePostgresRuntimeRestoreFrame(output, { kind: "GRANT" }); }, error);
    assert.equal(grants, 0); assert.throws(() => reader.allowNext(), error); await assert.rejects(reader.next(), error);
    reader.close(); stream.destroy(); output.destroy();
  }
});
test("lock remains through verification; completed grant opens exactly one request", async () => {
  const stream = new PassThrough(); const reader = postgresRuntimeRestoreFrameReader(stream); const output = new PassThrough(); output.resume();
  try {
    const first = reader.next(); stream.write(encoded(request(1))); await first; await assert.rejects(reader.next(), error);
    await writePostgresRuntimeRestoreFrame(output, { kind: "GRANT" }, () => reader.allowNext());
    const second = reader.next(); stream.write(encoded(request(2))); assert.deepEqual(await second, request(2));
    stream.write(encoded(request(3))); assert.throws(() => reader.assertReadyToReply(), error);
  } finally { reader.close(); stream.destroy(); output.destroy(); }
});
test("writer rejects oversized/nonobject frames before stream writes", async () => {
  const stream = new PassThrough(); let bytes = 0; stream.on("data", (chunk) => { bytes += chunk.length; });
  for (const value of [[], null, { x: "a".repeat(65_529) }]) await assert.rejects(writePostgresRuntimeRestoreFrame(stream, value), error);
  assert.equal(bytes, 0); stream.destroy();
});
test("lifetime EPIPE handling survives callbacks and later error events", async () => {
  const failure = Object.assign(new Error("fixture"), { code: "EPIPE" });
  const stream = new Writable({ write(_bytes, _encoding, callback) { callback(failure); } });
  await assert.rejects(writePostgresRuntimeRestoreFrame(stream, request(1)), error);
  await new Promise((r) => globalThis.setImmediate(r)); assert.throws(() => assertPostgresRuntimeRestoreWriterHealthy(stream), error);
  const late = new Writable({ write(_bytes, _encoding, callback) { callback(); } });
  await writePostgresRuntimeRestoreFrame(late, request(1)); late.emit("error", failure);
  assert.throws(() => assertPostgresRuntimeRestoreWriterHealthy(late), error);
  await assert.rejects(writePostgresRuntimeRestoreFrame(late, request(2)), error); late.destroy();
});
test("failed afterWrite permanently closes publication", async () => {
  const stream = new Writable({ write(_bytes, _encoding, callback) { callback(); } });
  await assert.rejects(writePostgresRuntimeRestoreFrame(stream, request(1), () => { throw new Error("fixture"); }), error);
  assert.throws(() => assertPostgresRuntimeRestoreWriterHealthy(stream), error);
  await assert.rejects(writePostgresRuntimeRestoreFrame(stream, request(2)), error); stream.destroy();
});
test("timed-out writer ignores late callback instead of reopening the gate", async () => {
  const stream = new EventEmitter(); let callback; let grants = 0; stream.write = (_bytes, cb) => { callback = cb; };
  await assert.rejects(writePostgresRuntimeRestoreFrame(stream, request(1), () => { grants++; }), error);
  callback(); assert.equal(grants, 0); assert.throws(() => assertPostgresRuntimeRestoreWriterHealthy(stream), error);
});
test("parent supports thirteen forward phases/repeats and rejects stale/foreign metadata", () => {
  const parent = postgresRuntimeRestoreParentControl(nonce, identity, auditSha); let sequence = 0; assert.throws(() => parent.assertComplete(), error);
  for (const phase of POSTGRES_RUNTIME_RESTORE_PHASES) {
    const accepted = parent.accept(request(++sequence, phase));
    assert.deepEqual(parent.grant(accepted), { kind: "GRANT", nonce, sequence, intent: "OWNERSHIP",
      attestation: { state: "VERIFIED", purpose: "POSTGRES_RUNTIME_SQL_RESTORE", phase, daemonId: identity.daemonId, endpoint: identity.endpoint } });
    if (phase !== "FINAL_SEAL") { parent.grant(parent.accept(request(++sequence, phase))); assert.throws(() => parent.assertComplete(), error); }
  }
  parent.assertComplete(); assert.throws(() => parent.accept(request(sequence, "FINAL_SEAL")), error);
  for (const change of [{ nonce: "a".repeat(24) }, { sequence: 2 }, { sequence: 1.5 }, { phase: "LOAD" },
    { kind: "GRANT" }, { intent: "COMMAND" }, { command: "docker run" }, { phase: "UNKNOWN" }]) {
    assert.throws(() => postgresRuntimeRestoreParentControl(nonce, identity, auditSha).accept({ ...request(1), ...change }), error);
  }
});
test("cleanup is terminal for execution and never grants candidate code", () => {
  const parent = postgresRuntimeRestoreParentControl(nonce, identity, auditSha);
  parent.grant(parent.accept(request(1))); parent.grant(parent.accept(request(2, "CLEANUP")));
  for (const value of [request(3, "RESTORE_START"), request(3, "CLEANUP", "AUDIT"), request(3, "FINAL_SEAL", "AUDIT")]) assert.throws(() => parent.accept(value), error);
  parent.grant(parent.accept(request(3, "FINAL_SEAL"))); parent.assertComplete();
  assert.throws(() => postgresRuntimeRestoreParentControl(nonce, identity, auditSha).accept(request(1, "CLEANUP")), error);
});
test("4096 repeated sequence grants are accepted and request4097 fails", () => {
  const parent = postgresRuntimeRestoreParentControl(nonce, identity, auditSha);
  for (let sequence = 1; sequence <= 4096; sequence++) parent.grant(parent.accept(request(sequence)));
  assert.throws(() => parent.accept(request(4097)), error);
});
test("grant requires the exact accepted local request, not cloned or superseded data", () => {
  const parent = postgresRuntimeRestoreParentControl(nonce, identity, auditSha); const accepted = parent.accept(request(1));
  assert.throws(() => parent.grant({ ...accepted }), error);
  const next = parent.accept(request(2)); assert.throws(() => parent.grant(accepted), error); parent.grant(next);
});
test("coercible endpoints never trigger conversion", () => {
  let reads = 0; const object = { toString() { reads++; return identity.endpoint; } };
  assert.throws(() => postgresRuntimeRestoreParentControl(nonce, { ...identity, endpoint: object }, auditSha), error); assert.equal(reads, 0);
});
test("audit grants bind expected hash, identity, phase, 5s freshness and effective deadline", () => {
  const now = Date.now(); const value = audit("PROBE", now);
  assert.equal(validatePostgresRuntimeAuditGrant(value, "PROBE", identity, auditSha, now).state, "VERIFIED_CURRENT");
  for (const change of [{ state: "INCOMPLETE" }, { purpose: "COLD_LOAD_ONLY" }, { phase: "LOAD" },
    { daemonId: "foreign" }, { endpoint: "unix:///var/run/docker.sock" }, { auditReceiptSha256: "f".repeat(64) },
    { extra: true }, { checkedAt: "invalid" }, { validUntil: "invalid" }, { checkedAt: new Date(now + 1).toISOString() },
    { checkedAt: new Date(now - 5001).toISOString() }, { validUntil: new Date(now).toISOString() }]) {
    assert.throws(() => validatePostgresRuntimeAuditGrant({ ...value, ...change }, "PROBE", identity, auditSha, now), error);
  }
  assert.equal(validatePostgresRuntimeAuditGrant({ ...value, checkedAt: new Date(now - 5000).toISOString() }, "PROBE", identity, auditSha, now).state, "VERIFIED_CURRENT");
  assert.throws(() => validatePostgresRuntimeAuditGrant(value, "PROBE", identity, auditSha, Infinity), error);
  assert.throws(() => validatePostgresRuntimeAuditGrant(value, "PROBE", identity, "f".repeat(64), now), error);
});
test("direct grant calls keep expected SHA and execution phase typed", () => {
  const now = Date.now(); let reads = 0; const object = { toString() { reads++; return auditSha; } };
  assert.throws(() => validatePostgresRuntimeAuditGrant({ ...audit("PROBE", now), auditReceiptSha256: object }, "PROBE", identity, object, now), error);
  for (const phase of ["CLEANUP", "FINAL_SEAL", "UNKNOWN"]) assert.throws(() => validatePostgresRuntimeAuditGrant(audit(phase, now), phase, identity, auditSha, now), error);
  assert.equal(reads, 0);
});
function channels() {
  const inbound = new PassThrough(); const outbound = new PassThrough();
  const reader = postgresRuntimeRestoreFrameReader(inbound); const requests = postgresRuntimeRestoreFrameReader(outbound);
  return { inbound, outbound, reader, requests, worker: postgresRuntimeRestoreWorkerControl(nonce, identity, reader, outbound, auditSha),
    parent: postgresRuntimeRestoreParentControl(nonce, identity, auditSha),
    close() { reader.close(); requests.close(); inbound.destroy(); outbound.destroy(); } };
}
test("duplex framing separates ownership/audit grants across all thirteen phases", async () => {
  const io = channels(); let calls = 0;
  try {
    for (const phase of POSTGRES_RUNTIME_RESTORE_PHASES) for (const intent of ["OWNERSHIP", ...(["CLEANUP", "FINAL_SEAL"].includes(phase) ? [] : ["AUDIT"])]) {
      const observed = io.requests.next(); const pending = intent === "AUDIT" ? io.worker.beforeExecution(phase) : io.worker.authorize(phase);
      pending.catch(() => {});
      const accepted = io.parent.accept(await observed);
      await writePostgresRuntimeRestoreFrame(io.inbound, io.parent.grant(accepted, intent === "AUDIT" ? audit(phase) : null));
      assert.equal((await pending).state, intent === "AUDIT" ? "VERIFIED_CURRENT" : "VERIFIED"); io.requests.allowNext(); calls++;
    }
    assert.equal(calls, 24); io.parent.assertComplete(); await assert.rejects(io.worker.beforeExecution("CLEANUP"), error);
  } finally { io.close(); }
});
for (const [name, mutate] of [
  ["nonce", (g) => { g.nonce = "a".repeat(24); }], ["sequence", (g) => { g.sequence = 2; }],
  ["intent", (g) => { g.intent = "OWNERSHIP"; }], ["purpose", (g) => { g.attestation.purpose = "EMPTY_DAEMON_PROBE"; }],
  ["phase", (g) => { g.attestation.phase = "LOAD"; }], ["socket", (g) => { g.attestation.endpoint = "unix:///var/run/docker.sock"; }],
  ["receipt hash", (g) => { g.attestation.auditReceiptSha256 = "f".repeat(64); }], ["extra field", (g) => { g.extra = true; }],
  ["stale grant", (g) => { g.attestation.checkedAt = new Date(Date.now() - 5001).toISOString(); }],
  ["expired deadline", (g) => { g.attestation.validUntil = new Date(Date.now() - 1).toISOString(); }],
]) test("worker rejects " + name + " before execution authorization", async () => {
  const io = channels();
  try {
    const observed = io.requests.next(); const pending = io.worker.beforeExecution("PREFLIGHT");
    pending.catch(() => {});
    const accepted = io.parent.accept(await observed); const grant = globalThis.structuredClone(io.parent.grant(accepted, audit()));
    mutate(grant); await writePostgresRuntimeRestoreFrame(io.inbound, grant); await assert.rejects(pending, error);
  } finally { io.close(); }
});
test("worker rejects overlapping ownership/audit requests", async () => {
  const io = channels();
  try {
    const observed = io.requests.next(); const pending = io.worker.authorize("PREFLIGHT");
    pending.catch(() => {});
    await assert.rejects(io.worker.beforeExecution("PREFLIGHT"), error);
    await writePostgresRuntimeRestoreFrame(io.inbound, io.parent.grant(io.parent.accept(await observed))); await pending;
  } finally { io.close(); }
});
