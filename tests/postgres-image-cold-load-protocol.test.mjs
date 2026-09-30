import assert from "node:assert/strict";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { assertColdLoadWriterHealthy, coldLoadFrameReader, coldLoadParentControl, coldLoadWorkerControl,
  validateColdLoadStart, writeColdLoadFrame } from "../scripts/postgres-image/cold-load-protocol.mjs";

const nonce = "c".repeat(24);
const identity = { daemonId: "owned-daemon", endpoint: "unix:///var/tmp/aw-cl-ABC123/endpoint/docker.sock" };
const start = () => ({ kind: "START", nonce, recipeRevision: "d".repeat(40), executionId: `local-cold-load-${nonce}`,
  identity, policyBytesBase64: Buffer.from("policy fixture").toString("base64"),
  copyReceiptBytesBase64: Buffer.from("receipt fixture").toString("base64") });
const request = (sequence, phase = "PREFLIGHT") => ({ kind: "REQUEST", nonce, sequence, phase });

test("metadata framing accepts fragmented binary UTF-8 and requires a clean complete stream", async () => {
  const stream = new PassThrough(); const reader = coldLoadFrameReader(stream);
  const pending = reader.next();
  const bytes = Buffer.from(`${JSON.stringify({ kind: "fixture", text: "é" })}\n`);
  const split = bytes.indexOf(0xc3) + 1;
  stream.write(bytes.subarray(0, split)); stream.end(bytes.subarray(split));
  assert.deepEqual(await pending, { kind: "fixture", text: "é" });
  if (!stream.readableEnded) await new Promise((resolve) => stream.on("end", resolve));
  reader.assertFinished(); reader.close();
});

for (const [name, bytes] of [
  ["malformed JSON", Buffer.from("{]\n")], ["nonobject JSON", Buffer.from("[]\n")],
  ["invalid UTF-8", Buffer.from([123, 34, 120, 34, 58, 34, 0xff, 34, 125, 10])],
  ["oversized partial frame", Buffer.alloc(65_537, 65)],
  ["unterminated frame", Buffer.from('{"kind":"partial"}')],
]) test(`framing rejects ${name} without returning content`, async () => {
  const stream = new PassThrough(); const reader = coldLoadFrameReader(stream); const pending = reader.next();
  stream.end(bytes);
  await assert.rejects(pending, { message: "postgres_cold_load_control_invalid" }); reader.close();
});

test("framing rejects extra terminal frames and an unbounded metadata burst", async () => {
  for (const bytes of [Buffer.from('{"a":1}\n{"b":2}\n'), Buffer.alloc(1024 ** 2 + 1)]) {
    const stream = new PassThrough(); const reader = coldLoadFrameReader(stream); const pending = reader.next();
    stream.end(bytes);
    if (bytes.length < 100) {
      await pending; if (!stream.readableEnded) await new Promise((resolve) => stream.on("end", resolve));
      assert.throws(() => reader.assertFinished(), { message: "postgres_cold_load_control_invalid" });
    } else await assert.rejects(pending, { message: "postgres_cold_load_control_invalid" });
    reader.close();
  }
});

test("missing metadata has a bounded wait", async () => {
  const stream = new PassThrough(); const reader = coldLoadFrameReader(stream);
  await assert.rejects(reader.next(10), { message: "postgres_cold_load_control_invalid" });
  reader.close(); stream.destroy();
});

test("START binds the local recipe and nonce and forbids paths/commands/base64 variants", () => {
  assert.deepEqual(validateColdLoadStart(start()), start());
  for (const mutate of [
    (v) => { v.executionId = "local-cold-load-other"; },
    (v) => { v.command = "root command"; }, (v) => { v.nonce = "e".repeat(24); },
    (v) => { v.recipeRevision = "short"; }, (v) => { v.policyBytesBase64 = "YWJj="; },
    (v) => { v.copyReceiptBytesBase64 = "a".repeat(40_001); },
  ]) { const value = start(); mutate(value); assert.throws(() => validateColdLoadStart(value)); }
});

test("root verification control enforces nonce, strict sequence, ordered phases and closed fields", () => {
  for (const invalid of [request(2), { ...request(1), nonce: "a".repeat(24) }, request(1, "AFTER_LOAD"),
    { ...request(1), command: "docker run" }, { ...request(1), phase: "STOP_FOREIGN" }, { ...request(1), sequence: 1.5 }]) {
    assert.throws(() => coldLoadParentControl(nonce, identity).accept(invalid));
  }
  const parent = coldLoadParentControl(nonce, identity);
  parent.accept(request(1)); parent.accept(request(2)); parent.accept(request(3, "BEFORE_LOAD"));
  assert.throws(() => parent.accept(request(4, "PREFLIGHT")));
  assert.throws(() => parent.assertComplete());
  parent.accept(request(4, "AFTER_LOAD")); parent.accept(request(5, "BEFORE_REMOVE")); parent.accept(request(6, "AFTER_REMOVE"));
  parent.assertComplete(); assert.throws(() => parent.accept(request(6, "AFTER_REMOVE")));
});

test("verification request count is bounded even when a client repeats the current phase", () => {
  const parent = coldLoadParentControl(nonce, identity);
  for (let sequence = 1; sequence <= 256; sequence++) parent.accept(request(sequence));
  assert.throws(() => parent.accept(request(257)));
});

test("worker accepts only the corresponding freshly verified root grant", async () => {
  for (const mutate of [
    () => {}, (v) => { v.nonce = "f".repeat(24); }, (v) => { v.sequence = 2; },
    (v) => { v.attestation.phase = "AFTER_LOAD"; }, (v) => { v.attestation.endpoint = "unix:///var/run/docker.sock"; },
    (v) => { v.attestation.purpose = "EMPTY_DAEMON_PROBE"; }, (v) => { v.extra = true; },
  ]) {
    const inbound = new PassThrough(); const outbound = new PassThrough();
    const inputReader = coldLoadFrameReader(inbound); const requestReader = coldLoadFrameReader(outbound);
    const worker = coldLoadWorkerControl(nonce, identity, inputReader, outbound);
    const pendingRequest = requestReader.next(); const pendingAuthorization = worker.authorize("PREFLIGHT");
    const observed = await pendingRequest;
    const grant = globalThis.structuredClone(coldLoadParentControl(nonce, identity).accept(observed)); mutate(grant);
    await writeColdLoadFrame(inbound, grant);
    if (grant.nonce === nonce && grant.sequence === 1 && Object.keys(grant).length === 4
      && grant.attestation.phase === "PREFLIGHT" && grant.attestation.endpoint === identity.endpoint
      && grant.attestation.purpose === "COLD_LOAD_ONLY") assert.equal((await pendingAuthorization).state, "VERIFIED");
    else await assert.rejects(pendingAuthorization, { message: "postgres_cold_load_control_invalid" });
    inputReader.close(); requestReader.close(); inbound.destroy(); outbound.destroy();
  }
});

test("worker forbids overlapping authorizations", async () => {
  const inbound = new PassThrough(); const outbound = new PassThrough();
  const reader = coldLoadFrameReader(inbound); const requests = coldLoadFrameReader(outbound);
  const worker = coldLoadWorkerControl(nonce, identity, reader, outbound);
  const observed = requests.next(); const first = worker.authorize("PREFLIGHT");
  await assert.rejects(worker.authorize("PREFLIGHT"), { message: "postgres_cold_load_control_invalid" });
  await writeColdLoadFrame(inbound, coldLoadParentControl(nonce, identity).accept(await observed)); await first;
  reader.close(); requests.close(); inbound.destroy(); outbound.destroy();
});

test("pipelined requests fail before the first grant even with a valid future sequence", async () => {
  const stream = new PassThrough(); const reader = coldLoadFrameReader(stream);
  const output = new PassThrough(); let grantBytes = 0; output.on("data", (chunk) => { grantBytes += chunk.length; });
  const first = reader.next();
  stream.write(`${JSON.stringify(request(1))}\n${JSON.stringify(request(2))}\n`);
  assert.deepEqual(await first, request(1));
  await assert.rejects(async () => {
    reader.assertReadyToReply();
    await writeColdLoadFrame(output, coldLoadParentControl(nonce, identity).accept(request(1)), () => reader.allowNext());
  }, { message: "postgres_cold_load_control_invalid" });
  assert.equal(grantBytes, 0);
  assert.throws(() => reader.allowNext(), { message: "postgres_cold_load_control_invalid" });
  await assert.rejects(reader.next(), { message: "postgres_cold_load_control_invalid" });
  reader.close(); stream.destroy(); output.destroy();
});

test("incoming metadata stays blocked throughout verification and grant publication", async () => {
  const stream = new PassThrough(); const reader = coldLoadFrameReader(stream);
  const first = reader.next(); stream.write(`${JSON.stringify(request(1))}\n`); await first;
  stream.write(`${JSON.stringify(request(2))}\n`);
  assert.throws(() => reader.allowNext()); reader.close(); stream.destroy();
});

test("the written-grant callback permits exactly the next request", async () => {
  const stream = new PassThrough(); const reader = coldLoadFrameReader(stream); const output = new PassThrough();
  output.resume();
  const first = reader.next(); stream.write(`${JSON.stringify(request(1))}\n`); await first;
  await writeColdLoadFrame(output, coldLoadParentControl(nonce, identity).accept(request(1)), () => reader.allowNext());
  const second = reader.next(); stream.write(`${JSON.stringify(request(2))}\n`);
  assert.deepEqual(await second, request(2)); reader.close(); stream.destroy(); output.destroy();
});

test("EPIPE and error events following write callbacks remain closed and handled", async () => {
  const error = Object.assign(new Error("nonsensitive fixture"), { code: "EPIPE" });
  const failing = new Writable({ write(_bytes, _encoding, callback) { callback(error); } });
  await assert.rejects(writeColdLoadFrame(failing, request(1)), { message: "postgres_cold_load_control_invalid" });
  await new Promise((resolve) => globalThis.setImmediate(resolve));
  assert.throws(() => assertColdLoadWriterHealthy(failing));
  const late = new Writable({ write(_bytes, _encoding, callback) { callback(); } });
  await writeColdLoadFrame(late, request(1)); late.emit("error", error);
  assert.throws(() => assertColdLoadWriterHealthy(late), { message: "postgres_cold_load_control_invalid" });
  await assert.rejects(writeColdLoadFrame(late, request(2)), { message: "postgres_cold_load_control_invalid" });
  late.destroy();
});
