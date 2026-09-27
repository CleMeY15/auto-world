import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { capturePersistedDataIdentity, classifyPersistedDataReadinessFailure,
  parsePersistedObjectMetadata, parsePersistedVolumeLookup, PersistedDataReadinessError,
  PERSISTED_DATA_READINESS_PROTOCOL, PERSISTED_DATA_READINESS_PROTOCOL_SHA256,
  TEST_ONLY_persistedDataReadinessScripts, verifyPersistedDataReadiness } from
  "../scripts/seaweed-image/persisted-data-readiness.mjs";

const payload = "persisted-data";
const expectedSize = Buffer.byteLength(payload);
const expectedSha256 = createHash("sha256").update(payload).digest("hex");
const fid = "7,0100000000";
const metadata = JSON.stringify({ FileSize: expectedSize, Content: null, chunks: [{
  file_id: fid, size: expectedSize, fid: { volume_id: 7, file_key: 1 },
}] });
const lookup = JSON.stringify({ volumeOrFileId: "7", locations: [{
  url: "127.0.0.1:8080", publicUrl: "127.0.0.1:8080",
}] });

function output(kind, status, body, curlRc = 0) {
  return { status: 0, stdout: `AW_${kind}_V1\n${curlRc}\n${String(status).padStart(3, "0")}\n${body}`,
    stderr: "" };
}

function direct(status = 200, size = expectedSize, digest = expectedSha256, curlRc = 0) {
  return { status: 0, stdout: `AW_DIRECT_V1\n${curlRc}\n${status}\n${size}\n${digest}\n`, stderr: "" };
}

function transaction(overrides = {}) {
  const calls = []; let metadataCalls = 0; let lookupCalls = 0; let directCalls = 0;
  const runCommand = async (args, options, statuses) => {
    calls.push({ args, options, statuses });
    assert.equal(args[0], "container"); assert.equal(args[1], "exec");
    assert.equal(options.timeoutMs, overrides.timeoutMs ?? 5_000); assert.deepEqual(statuses, [0]);
    const script = args.at(-1);
    if (script.includes("AW_METADATA_V1")) {
      metadataCalls += 1;
      return overrides.metadata?.(metadataCalls) ?? output("METADATA", 200, metadata);
    }
    if (script.includes("AW_LOOKUP_V1")) {
      lookupCalls += 1;
      return overrides.lookup?.(lookupCalls) ?? output("LOOKUP", 200, lookup);
    }
    if (script.includes("AW_DIRECT_V1")) {
      directCalls += 1;
      return overrides.direct?.(directCalls) ?? direct();
    }
    throw new Error("unexpected command");
  };
  return { calls, runCommand, counts: () => ({ metadataCalls, lookupCalls, directCalls }) };
}

const base = (value) => ({ runCommand: value.runCommand, containerName: "aw-readiness-test",
  deadline: 390_000, objectPath: "/buckets/aw-raw/restart-proof", expectedSize,
  options: {}, now: () => 0, wait: async () => {} });

test("protocol descriptor is versioned, bounded and self-hashed", () => {
  assert.equal(PERSISTED_DATA_READINESS_PROTOCOL.version, 1);
  assert.equal(PERSISTED_DATA_READINESS_PROTOCOL.maxResponseBytes, 64 * 1024);
  assert.equal(PERSISTED_DATA_READINESS_PROTOCOL.finalReadReserveMs, 12_000);
  assert.match(PERSISTED_DATA_READINESS_PROTOCOL_SHA256, /^[0-9a-f]{64}$/u);
});

test("metadata parser binds canonical text fid to exact numeric fid including uint64 max", () => {
  assert.deepEqual(parsePersistedObjectMetadata(metadata, expectedSize),
    { fid, volumeId: "7", size: expectedSize });
  const maximum = `{"FileSize":${expectedSize},"Content":null,"chunks":[{"file_id":"7,ffffffffffffffffffffffff",`
    + `"offset":0,"size":${expectedSize},"fid":{"volume_id":7,`
    + '"file_key":18446744073709551615,"cookie":4294967295}}]}';
  assert.deepEqual(parsePersistedObjectMetadata(maximum, expectedSize),
    { fid: "7,ffffffffffffffffffffffff", volumeId: "7", size: expectedSize });
  const conflict = metadata.replace('"file_id":"7,0100000000"', '"file_id":"7,0200000000"');
  assert.throws(() => parsePersistedObjectMetadata(conflict, expectedSize), { reason: "METADATA_INVALID" });
  const stringKey = metadata.replace('"file_key":1', '"file_key":"1"');
  assert.throws(() => parsePersistedObjectMetadata(stringKey, expectedSize), { reason: "METADATA_MALFORMED" });
  const stringOffset = metadata.replace('"size":14', '"offset":"0","size":14');
  assert.throws(() => parsePersistedObjectMetadata(stringOffset, expectedSize), { reason: "METADATA_INVALID" });
  const stringCookie = metadata.replace('"file_key":1', '"file_key":1,"cookie":"0"');
  assert.throws(() => parsePersistedObjectMetadata(stringCookie, expectedSize), { reason: "METADATA_INVALID" });
  assert.doesNotThrow(() => parsePersistedObjectMetadata(metadata.replace('"size":14',
    '"size":14,"is_compressed":false'), expectedSize));
  for (const compressed of ["true", '"false"']) {
    assert.throws(() => parsePersistedObjectMetadata(metadata.replace('"size":14',
      `"size":14,"is_compressed":${compressed}`), expectedSize), { reason: "METADATA_INVALID" });
  }
});

test("lookup parser rejects a foreign advertised location", () => {
  assert.equal(parsePersistedVolumeLookup(lookup, "7"), true);
  const foreign = lookup.replaceAll("127.0.0.1:8080", "10.0.0.4:8080");
  assert.throws(() => parsePersistedVolumeLookup(foreign, "7"), { reason: "LOOKUP_LOCATION_MISMATCH" });
  const duplicate = JSON.stringify({ volumeOrFileId: "7", locations: [
    { url: "127.0.0.1:8080", publicUrl: "127.0.0.1:8080" },
    { url: "127.0.0.1:8080", publicUrl: "127.0.0.1:8080" },
  ] });
  assert.throws(() => parsePersistedVolumeLookup(duplicate, "7"), { reason: "LOOKUP_INVALID" });
});

test("generated probes use fixed nonredirecting loopback endpoints and bounded transfers", () => {
  const scripts = TEST_ONLY_persistedDataReadinessScripts("/buckets/aw-raw/restart-proof", fid);
  assert.match(scripts[0], /127\.0\.0\.1:8888\/buckets\/aw-raw\/restart-proof\?metadata=true/u);
  assert.match(scripts[1], /127\.0\.0\.1:9333\/dir\/lookup\?volumeId=7&read=yes/u);
  assert.match(scripts[2], /127\.0\.0\.1:8080\/7,0100000000/u);
  for (const script of scripts) {
    assert.equal(script.includes("--location"), false);
    assert.match(script, /--max-filesize 65536/u);
    if (process.platform === "linux") assert.equal(spawnSync("/bin/sh", ["-n"], { input: script }).status, 0);
  }
});

test("transaction captures the original identity then proves metadata, lookup and direct bytes in order", async () => {
  const value = transaction();
  const identity = await capturePersistedDataIdentity(base(value));
  await verifyPersistedDataReadiness({ ...base(value), identity, expectedSha256 });
  assert.deepEqual(value.counts(), { metadataCalls: 2, lookupCalls: 1, directCalls: 1 });
  assert.deepEqual(value.calls.map(({ args }) => args.at(-1).match(/AW_(METADATA|LOOKUP|DIRECT)_V1/u)?.[1]),
    ["METADATA", "METADATA", "LOOKUP", "DIRECT"]);
});

test("only transport and lookup 5xx retry while changed identity and wrong bytes fail closed", async () => {
  let waits = 0;
  const transient = transaction({ lookup: (count) => count === 1 ? output("LOOKUP", 503, "") : undefined });
  await verifyPersistedDataReadiness({ ...base(transient), identity: { fid, volumeId: "7", size: expectedSize },
    expectedSha256, wait: async () => { waits += 1; } });
  assert.equal(waits, 1); assert.equal(transient.counts().lookupCalls, 2);

  const changed = transaction({ metadata: () => output("METADATA", 200,
    metadata.replace('"file_id":"7,0100000000","size"',
      '"file_id":"7,0200000000","size"').replace('"file_key":1', '"file_key":2')) });
  await assert.rejects(verifyPersistedDataReadiness({ ...base(changed),
    identity: { fid, volumeId: "7", size: expectedSize }, expectedSha256 }), { reason: "IDENTITY_CHANGED" });
  assert.deepEqual(changed.counts(), { metadataCalls: 1, lookupCalls: 0, directCalls: 0 });

  const mismatch = transaction({ direct: () => direct(200, expectedSize, "f".repeat(64)) });
  await assert.rejects(verifyPersistedDataReadiness({ ...base(mismatch),
    identity: { fid, volumeId: "7", size: expectedSize }, expectedSha256 }),
  { reason: "DIRECT_DATA_MISMATCH" });
  assert.equal(mismatch.counts().directCalls, 1);
});

test("metadata and direct transient readiness responses retry, but auth and mixed transport fail immediately", async () => {
  for (const [name, override] of [
    ["metadata-500", { metadata: (count) => count === 1 ? output("METADATA", 500, "") : undefined }],
    ["direct-404", { direct: (count) => count === 1 ? direct(404) : undefined }],
    ["lookup-transport", { lookup: (count) => count === 1 ? output("LOOKUP", 0, "", 7) : undefined }],
  ]) {
    let waits = 0;
    const value = transaction(override);
    await verifyPersistedDataReadiness({ ...base(value), identity: { fid, volumeId: "7", size: expectedSize },
      expectedSha256, wait: async () => { waits += 1; } });
    assert.equal(waits, 1, name);
  }
  for (const response of [output("METADATA", 403, ""), output("METADATA", 302, ""),
    output("METADATA", 600, ""),
    output("METADATA", 403, "", 7)]) {
    const value = transaction({ metadata: () => response });
    await assert.rejects(capturePersistedDataIdentity(base(value)));
    assert.equal(value.counts().metadataCalls, 1);
  }
  const direct600 = transaction({ direct: () => direct(600) });
  await assert.rejects(verifyPersistedDataReadiness({ ...base(direct600),
    identity: { fid, volumeId: "7", size: expectedSize }, expectedSha256 }),
  { reason: "DIRECT_STATUS_INVALID" });
  assert.equal(direct600.counts().directCalls, 1);
});

test("each request and retry sleep shrink against one deadline while preserving the final 12 second reserve", async () => {
  const bounded = transaction({ timeoutMs: 1_000 });
  await verifyPersistedDataReadiness({ ...base(bounded), deadline: 13_000,
    identity: { fid, volumeId: "7", size: expectedSize }, expectedSha256 });
  assert.equal(bounded.calls.every(({ options }) => options.timeoutMs === 1_000), true);

  let now = 0; const waits = [];
  const exhausted = transaction({ timeoutMs: 500,
    metadata: () => output("METADATA", 0, "", 7) });
  await assert.rejects(verifyPersistedDataReadiness({ ...base(exhausted), deadline: 12_500,
    identity: { fid, volumeId: "7", size: expectedSize }, expectedSha256,
    now: () => now, wait: async (milliseconds) => { waits.push(milliseconds); now += milliseconds; } }),
  { reason: "DEADLINE_EXHAUSTED" });
  assert.deepEqual(waits, [500]);
  assert.equal(exhausted.counts().metadataCalls, 1);

  let afterDirect = 0;
  const reserveConsumed = transaction({ timeoutMs: 1_000,
    direct: () => { afterDirect = 1_001; return direct(); } });
  await assert.rejects(verifyPersistedDataReadiness({ ...base(reserveConsumed), deadline: 13_000,
    identity: { fid, volumeId: "7", size: expectedSize }, expectedSha256, now: () => afterDirect }),
  { reason: "DEADLINE_EXHAUSTED" });
  assert.equal(reserveConsumed.counts().directCalls, 1);
});

test("oversized bounded responses abort without retry or raw data in the error", async () => {
  const value = transaction({ metadata: () => ({ status: 0, stdout: "AW_OVERSIZED_V1\n", stderr: "" }) });
  await assert.rejects(capturePersistedDataIdentity(base(value)), (error) => {
    assert.equal(error.reason, "METADATA_OVERSIZED");
    assert.equal(JSON.stringify(error).includes("file_id"), false);
    return true;
  });
  assert.equal(value.counts().metadataCalls, 1);
});

test("transaction rejects a noncanonical or conflicting identity before constructing a shell URL", async () => {
  for (const identity of [
    { fid, volumeId: "07", size: expectedSize },
    { fid, volumeId: "8", size: expectedSize },
    { fid: "7,010000000", volumeId: "7", size: expectedSize },
  ]) {
    const value = transaction();
    await assert.rejects(verifyPersistedDataReadiness({ ...base(value), identity, expectedSha256 }),
      { reason: "INPUT_INVALID" });
    assert.equal(value.calls.length, 0);
  }
});

test("internal failures map to a closed public readiness vocabulary", () => {
  for (const [reason, expected] of [
    ["METADATA_MALFORMED", "PERSISTED_METADATA_INVALID"],
    ["IDENTITY_CHANGED", "PERSISTED_IDENTITY_CHANGED"],
    ["LOOKUP_LOCATION_MISMATCH", "PERSISTED_REGISTRATION_INVALID"],
    ["DIRECT_DATA_MISMATCH", "PERSISTED_DIRECT_READ_MISMATCH"],
    ["DEADLINE_EXHAUSTED", "PERSISTED_DATA_NOT_READY"],
    ["DIRECT_OVERSIZED", "PERSISTED_READINESS_PROBE_INVALID"],
    ["DIRECT_PROBE_INVALID", "PERSISTED_READINESS_PROBE_INVALID"],
    ["DIRECT_STATUS_INVALID", "PERSISTED_READINESS_PROBE_INVALID"],
    ["METADATA_PROBE_INVALID", "PERSISTED_READINESS_PROBE_INVALID"],
    ["LOOKUP_PROBE_INVALID", "PERSISTED_READINESS_PROBE_INVALID"],
    ["PROBE_COMMAND_INVALID", "PERSISTED_READINESS_PROBE_INVALID"],
    ["PROBE_INVALID", "PERSISTED_READINESS_PROBE_INVALID"],
    ["TRANSPORT_INVALID", "PERSISTED_READINESS_PROBE_INVALID"],
  ]) {
    assert.equal(classifyPersistedDataReadinessFailure(new PersistedDataReadinessError(reason)), expected);
  }
  assert.equal(classifyPersistedDataReadinessFailure(new PersistedDataReadinessError("INPUT_INVALID")), undefined);
  assert.equal(classifyPersistedDataReadinessFailure(new Error("private")), undefined);
});

test("a rejected command adapter becomes a fixed probe failure without exposing its error", async () => {
  const runCommand = async () => { throw new Error(`private ${fid}`); };
  await assert.rejects(capturePersistedDataIdentity({ ...base({ runCommand }), runCommand }), (error) => {
    assert.equal(error.reason, "PROBE_COMMAND_INVALID");
    assert.equal(classifyPersistedDataReadinessFailure(error), "PERSISTED_READINESS_PROBE_INVALID");
    assert.equal(JSON.stringify(error).includes(fid), false);
    return true;
  });
});
