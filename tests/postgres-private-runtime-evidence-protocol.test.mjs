import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { POSTGRES_PRIVATE_RUNTIME_EVIDENCE_PIN as PIN, postgresPrivateRuntimeEvidenceLimits as LIMITS } from "../scripts/postgres-image/private-runtime-evidence-policy.mjs";
import { postgresPrivateRuntimeEvidenceChannel, postgresPrivateRuntimeEvidenceLocation,
  postgresPrivateRuntimeEvidenceRecord, validatePostgresPrivateRuntimeEvidenceFrame,
  validatePostgresPrivateRuntimeEvidenceAcknowledgement, postgresPrivateRuntimeEvidenceFailureDiagnostic } from "../scripts/postgres-image/private-runtime-evidence-protocol.mjs";

const nonce = "a".repeat(24); const revision = "b".repeat(40);
const location = postgresPrivateRuntimeEvidenceLocation(nonce, revision);
const clone = (value) => globalThis.structuredClone(value);
const invalid = /postgres_private_runtime_evidence_control_invalid/u;
const identity = (ino, uid, gid, size) => ({ dev: "2096", ino: String(ino), uid, gid, size,
  mode: 0o600, nlink: 1, mtimeNs: "1790786471778509866", ctimeNs: "1790786471778509866" });
const sources = PIN.sources.map((item, index) => ({ role: item.role, fd: item.fd, source: item.source,
  size: item.size, sha256: item.sha256, identity: identity(100 + index, item.uid, item.gid, item.size) }));
const payloads = PIN.sources.map((item, index) => ({ role: item.role, name: item.name, size: item.size, sha256: item.sha256,
  sourceIdentity: clone(sources[index].identity), identity: identity(200 + index, 1000, 1000, item.size) }));
const receipt = { name: "receipt.json", size: 9000, sha256: "c".repeat(64), identity: identity(300, 1000, 1000, 9000) };
const prepared = () => ({ kind: "PREPARED", ...location, payloads: clone(payloads) });
const published = () => ({ kind: "PUBLISHED", ...location, receipt: clone(receipt) });
const start = () => ({ kind: "START", nonce, deadline: Date.now() + 60000, sources: clone(sources) });
const commit = () => ({ kind: "COMMIT", nonce, sources: clone(sources) });
const finalize = () => ({ kind: "FINALIZE", nonce, rootSourcesUnchanged: true, rootDescriptorsClosed: true });
const result = () => ({ kind: "RESULT", ...location, receipt: clone(receipt), payloads: clone(payloads), sourceUnchanged: true, descriptorsClosed: true });
const bytes = (value) => Buffer.from(JSON.stringify(value) + "\n");
function channel() {
  const input = new PassThrough(); const output = new PassThrough(); output.resume();
  const control = postgresPrivateRuntimeEvidenceChannel(input, output, { nonce });
  return { input, output, control, close: () => { control.dispose(); input.destroy(); output.destroy(); } };
}
function acknowledgement() {
  return { state: "ADDENDUM_VERIFIED", authority: "LOCAL_DIAGNOSTIC", nonce, executionId: location.executionId,
    recipeRevision: revision, privateRoot: location.directory, receipt: clone(receipt), sources: clone(sources), payloads: clone(payloads),
    legacy: clone(PIN.legacy), cleanup: { rootDescriptors: "CLOSED", workerDescriptors: "CLOSED", child: "CLOSED_EXIT_0", output: "EOF_ZERO_STDERR", writer: "CLOSED" },
    historicalIntegrity: "VERIFIED", currentness: "NOT_EVALUATED", runtimePermission: "NOT_GRANTED", closure: "INCOMPLETE",
    requiredMissing: clone(PIN.requiredMissing), registryRead: "NOT_ATTEMPTED", registryWrite: "NOT_ATTEMPTED", network: "NOT_ATTEMPTED",
    signing: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED", supportStartedAt: null, supportEndsAt: null, archiveUntil: null };
}

test("fixed source pins, roles, recipes and limits stay independent and frozen", () => {
  assert.equal(PIN.sources.reduce((sum, item) => sum + item.size, 0), 145933);
  assert.deepEqual(PIN.sources.map((item) => item.fd), [3, 4, 5]);
  assert.equal(PIN.legacy.size, 89249); assert.equal(PIN.requiredMissing.length, 3);
  assert.equal(PIN.sql.recipeRevision, "70c396301808bf89652b1ba408d9aff282340483");
  assert.equal(LIMITS.frameBytes, 16384); assert.equal(LIMITS.trafficBytes, 131072);
  assert.equal(Object.isFrozen(PIN.sources[0]), true); assert.equal(Object.isFrozen(PIN.legacy), true);
});

test("closed frames bind exact roles, source byte pins and native identities", () => {
  for (const value of [start(), prepared(), commit(), published(), finalize(), result(), { kind: "ABORT", nonce }]) {
    assert.deepEqual(validatePostgresPrivateRuntimeEvidenceFrame(value, { nonce }), value);
  }
  for (const mutate of [
    (v) => { v.sources.reverse(); }, (v) => { v.sources[0].fd = 4; },
    (v) => { v.sources[0].sha256 = "f".repeat(64); }, (v) => { v.sources[0].identity.uid = 1000; },
    (v) => { v.sources[0].identity.nlink = 2; }, (v) => { v.sources[0].identity.mode = 0o644; },
    (v) => { v.sources[0].identity.ino = "0100"; }, (v) => { v.sources[0].identity.dev = "0"; },
    (v) => { v.deadline = Date.now() - 1; }, (v) => { v.deadline = Date.now() + LIMITS.operationMs + 10000; },
    (v) => { v.extra = "untrusted"; }, (v) => { v.nonce = "z".repeat(24); },
  ]) { const value = start(); mutate(value); assert.throws(() => validatePostgresPrivateRuntimeEvidenceFrame(value), invalid); }
  const changed = result(); changed.descriptorsClosed = false;
  assert.throws(() => validatePostgresPrivateRuntimeEvidenceFrame(changed), invalid);
});

test("getters, symbols, unknown kinds and extra payload keys fail without executing accessors", () => {
  let calls = 0;
  const accessor = { nonce }; Object.defineProperty(accessor, "kind", { enumerable: true, get: () => { calls++; return "ABORT"; } });
  assert.throws(() => validatePostgresPrivateRuntimeEvidenceFrame(accessor), invalid); assert.equal(calls, 0);
  const symbol = { kind: "ABORT", nonce, [Symbol("hidden")]: true };
  assert.throws(() => postgresPrivateRuntimeEvidenceRecord(symbol, ["kind", "nonce"]), invalid);
  assert.throws(() => validatePostgresPrivateRuntimeEvidenceFrame({ kind: "__proto__", nonce }), invalid);
  const value = prepared(); value.payloads[0].raw = "never exposed";
  assert.throws(() => validatePostgresPrivateRuntimeEvidenceFrame(value), invalid);
});

test("every recipe-bearing frame and the ACK requires a literal revision before serialization", () => {
  for (const make of [prepared, published, result]) for (const bad of [undefined, null, [], "", "b".repeat(39)]) {
    const value = make(); value.recipeRevision = bad;
    assert.throws(() => validatePostgresPrivateRuntimeEvidenceFrame(value), invalid);
  }
  assert.throws(() => validatePostgresPrivateRuntimeEvidenceAcknowledgement(acknowledgement(), { nonce, sources }), invalid);
});

test("final ACK needs every closure status and binds the original/source/copy proof pair", () => {
  const expected = { nonce, recipeRevision: revision, sources, payloads, receipt };
  assert.deepEqual(validatePostgresPrivateRuntimeEvidenceAcknowledgement(acknowledgement(), expected), acknowledgement());
  for (const mutate of [
    (v) => { v.state = "PUBLISHED_AWAITING_SUPERVISOR_ACK"; }, (v) => { v.cleanup.child = "EXIT_ONLY"; },
    (v) => { v.cleanup.writer = "UNVERIFIED"; }, (v) => { v.runtimePermission = "GRANTED"; },
    (v) => { v.currentness = "VERIFIED"; }, (v) => { v.supportStartedAt = "2026-09-30"; },
    (v) => { v.legacy.sha256 = "d".repeat(64); }, (v) => { v.payloads[0].sourceIdentity.ctimeNs = "1"; },
    (v) => { v.receipt.identity.ino = v.payloads[0].identity.ino; }, (v) => { v.extra = true; },
  ]) { const value = acknowledgement(); mutate(value); assert.throws(() => validatePostgresPrivateRuntimeEvidenceAcknowledgement(value, expected), invalid); }
});

test("nested ACK records and missing roles never execute accessors or retain hidden data", () => {
  const expected = { nonce, recipeRevision: revision, sources, payloads, receipt };
  for (const name of ["legacy", "cleanup", "requiredMissing"]) {
    const value = acknowledgement(); let reads = 0;
    const key = name === "legacy" ? "sha256" : name === "cleanup" ? "child" : "0";
    const original = value[name][key];
    Object.defineProperty(value[name], key, { enumerable: true, configurable: true,
      get: () => { reads++; return reads === 1 ? original : "harmless_marker"; } });
    assert.throws(() => validatePostgresPrivateRuntimeEvidenceAcknowledgement(value, expected), invalid);
    assert.equal(reads, 0);
    for (const hidden of ["hidden", Symbol("private")]) {
      const extra = acknowledgement(); Object.defineProperty(extra[name], hidden, { value: "hidden content", enumerable: false });
      assert.throws(() => validatePostgresPrivateRuntimeEvidenceAcknowledgement(extra, expected), invalid);
    }
    const inherited = acknowledgement(); Object.setPrototypeOf(inherited[name], { hidden: "private" });
    assert.throws(() => validatePostgresPrivateRuntimeEvidenceAcknowledgement(inherited, expected), invalid);
    const extra = acknowledgement(); extra[name].extra = "unexpected";
    assert.throws(() => validatePostgresPrivateRuntimeEvidenceAcknowledgement(extra, expected), invalid);
  }
});

test("pipelined PREPARED and PUBLISHED are rejected before COMMIT", async () => {
  const value = channel();
  try {
    const first = value.control.next(1000);
    value.input.write(Buffer.concat([bytes(prepared()), bytes(published())]));
    await first; assert.throws(() => value.control.healthy(), invalid);
    await assert.rejects(value.control.sendAndAllowNext(commit(), 1000), invalid);
  } finally { value.close(); }
});

test("later data and even partial bytes while seals hold the gate cause rejection", async () => {
  for (const extra of [bytes(published()), Buffer.from("{")]) {
    const value = channel();
    try {
      const first = value.control.next(1000); value.input.write(bytes(prepared())); await first;
      value.input.write(extra); assert.throws(() => value.control.healthy(), invalid);
      await assert.rejects(value.control.next(1000), invalid);
    } finally { value.close(); }
  }
});

test("only completed grant writes open each subsequent receive phase", async () => {
  const value = channel();
  try {
    let pending = value.control.next(1000); value.input.write(bytes(prepared())); await pending;
    await assert.rejects(value.control.next(1000), invalid);
    await value.control.sendAndAllowNext(commit(), 1000);
    pending = value.control.next(1000); value.input.write(bytes(published())); await pending;
    await value.control.send(finalize(), 1000);
    await assert.rejects(value.control.next(1000), invalid);
    await value.control.endAndAllowNext(1000); assert.equal(value.control.writerClosed(), true);
    pending = value.control.next(1000); value.input.end(bytes(result()));
    assert.equal((await pending).kind, "RESULT"); await value.control.eof(1000); value.control.healthy();
  } finally { value.close(); }
});

test("native child stdout retains observed successful finish after the await continuation", () => {
  const moduleUrl = new URL("../scripts/postgres-image/private-runtime-evidence-protocol.mjs", import.meta.url).href;
  const frame = { kind: "ABORT", nonce };
  const code = `import { postgresPrivateRuntimeEvidenceChannel } from ${JSON.stringify(moduleUrl)};
const control=postgresPrivateRuntimeEvidenceChannel(process.stdin,process.stdout);
try {
  const frame=await control.next(5000);
  await control.send(frame,5000);
  await control.end(5000);
  if(!control.writerClosed())throw Error('native stdout finish fixture');
} finally { control.dispose(); }`;
  const observed = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    input: bytes(frame), encoding: "utf8", timeout: 10000, maxBuffer: 4096,
  });
  assert.equal(observed.error, undefined); assert.equal(observed.signal, null); assert.equal(observed.status, 0);
  assert.equal(observed.stderr, ""); assert.equal(observed.stdout, bytes(frame).toString());
});

test("an actual final callback error cannot establish writer finish or open a receive grant", async () => {
  const input = new PassThrough();
  const output = new Writable({ write: (_chunk, _encoding, callback) => callback(),
    final: callback => callback(new Error("harmless native final fixture")) });
  const control = postgresPrivateRuntimeEvidenceChannel(input, output, { nonce });
  try {
    const pending = control.next(1000); input.write(bytes(prepared())); await pending;
    await assert.rejects(control.endAndAllowNext(1000), invalid);
    assert.equal(control.writerClosed(), false); assert.throws(() => control.healthy(), invalid);
    await assert.rejects(control.next(1000), invalid);
  } finally { control.dispose(); input.destroy(); output.destroy(); }
});

test("a late reader or writer error invalidates an already observed successful finish", async () => {
  for (const side of ["input", "output"]) {
    const value = channel();
    try {
      await value.control.end(1000); assert.equal(value.control.writerClosed(), true);
      value[side].emit("error", new Error("harmless late terminal fixture"));
      assert.equal(value.control.writerClosed(), false); assert.throws(() => value.control.healthy(), invalid);
    } finally { value.close(); }
  }
});

test("receive gate remains closed while a grant write callback is pending", async () => {
  const input = new PassThrough(); let finishWrite;
  const output = new Writable({ write: (_chunk, _encoding, callback) => { finishWrite = callback; } });
  const control = postgresPrivateRuntimeEvidenceChannel(input, output, { nonce });
  try {
    const first = control.next(1000); input.write(bytes(prepared())); await first;
    const sending = control.sendAndAllowNext(commit(), 1000);
    const rejected = assert.rejects(sending, invalid);
    input.write(bytes(published())); await rejected;
    finishWrite(); assert.throws(() => control.healthy(), invalid);
  } finally { control.dispose(); input.destroy(); output.destroy(); }
});

test("EOF is mandatory and duplicate final frames or trailing bytes are forbidden", async () => {
  for (const extra of [bytes(result()), Buffer.from(" ")]) {
    const value = channel();
    try {
      const pending = value.control.next(1000); value.input.write(bytes(result())); await pending;
      const eof = value.control.eof(1000); const rejected = assert.rejects(eof, invalid);
      value.input.end(extra); await rejected;
    } finally { value.close(); }
  }
  const value = channel();
  try { const pending = value.control.next(1000); value.input.end(); await assert.rejects(pending, invalid); }
  finally { value.close(); }
});

test("malformed UTF8/JSON, oversized frames and missing EOF close the channel", async () => {
  for (const chunk of [Buffer.from([0xff, 10]), Buffer.from("{broken}\n"), Buffer.alloc(LIMITS.frameBytes + 1, 123)]) {
    const value = channel();
    try { const pending = value.control.next(1000); const rejected = assert.rejects(pending, invalid); value.input.write(chunk); await rejected; }
    finally { value.close(); }
  }
  const value = channel();
  try { await assert.rejects(value.control.eof(10), invalid); }
  finally { value.close(); }
});

test("aggregate reader and writer traffic is capped together", async () => {
  const value = channel();
  try {
    for (let index = 0; index < 200; index++) {
      const pending = value.control.next(1000); const rejected = pending.catch((error) => error);
      value.input.write(bytes(prepared()));
      const answer = await rejected;
      if (answer instanceof Error) { assert.match(answer.message, invalid); return; }
      try { await value.control.sendAndAllowNext(commit(), 1000); }
      catch (error) { assert.match(error.message, invalid); return; }
    }
    assert.fail("traffic budget never enforced");
  } finally { value.close(); }
});

test("disposal rejects pending operations and consumes late pipe errors without raw output", async () => {
  const value = channel();
  try {
    const next = value.control.next(1000); const rejected = assert.rejects(next, invalid);
    value.control.dispose(); await rejected;
    assert.doesNotThrow(() => value.input.emit("error", new Error("private pipe output")));
    assert.doesNotThrow(() => value.output.emit("error", new Error("private EPIPE output")));
    assert.throws(() => value.control.healthy(), invalid);
    assert.equal(value.control.writerClosed(), false);
  } finally { value.close(); }
});

test("failure output is closed and cleanup uncertainty cannot become confirmed", () => {
  assert.deepEqual(postgresPrivateRuntimeEvidenceFailureDiagnostic(new Error("secret output"), "bogus", "CONFIRMED"),
    { code: "postgres_private_runtime_evidence_operation_failed", phase: "CONTEXT", cleanup: "CONFIRMED" });
  assert.equal(postgresPrivateRuntimeEvidenceFailureDiagnostic(new Error("postgres_private_runtime_evidence_cleanup_uncertain"), "CLEANUP", "CONFIRMED").cleanup, "UNVERIFIED");
  const throwing = { get message() { throw new Error("private output"); } };
  assert.equal(postgresPrivateRuntimeEvidenceFailureDiagnostic(throwing).code, "postgres_private_runtime_evidence_operation_failed");
});
