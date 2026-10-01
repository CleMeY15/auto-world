import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, chownSync, copyFileSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { finalizePostgresSourceClosureMaterials, retainPostgresSourceMaterial } from "../scripts/postgres-image/source-closure.mjs";

const sha = (algorithm, bytes) => createHash(algorithm).update(bytes).digest("hex");
const payload = Buffer.from("source bytes kept as data\n");
function material(bytes = payload, overrides = {}) {
  return { id: "fixture-source", role: "SOURCE_AUX", origin: "fixture", commit: "1".repeat(40),
    path: "main/fixture/source", url: "https://raw.githubusercontent.com/alpinelinux/aports/" + "1".repeat(40) + "/main/fixture/source",
    expected: { sha256: sha("sha256", bytes), sha512: sha("sha512", bytes), gitBlobSha1: null,
      size: bytes.length, gitMode: null, gitType: null }, ...overrides };
}
const signal = () => new globalThis.AbortController().signal;
const response = (bytes = payload, headers = {}) => new globalThis.Response(bytes, { status: 200, headers });
const native = process.platform === "linux";
const credentialUrl = () => {
  const url = new URL("https://raw.githubusercontent.com/source");
  url.username = "fixture"; url.password = "fixture"; return url.href;
};
function storage(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pg-source-closure-test-")); chmodSync(directory, 0o700);
  t.after(() => rmSync(directory, { recursive: true, force: true })); return directory;
}

test("opaque source retention seals complete bytes and reuses only fully rehashed bytes", { skip: !native }, async (t) => {
  const directory = storage(t); let calls = 0;
  const first = await retainPostgresSourceMaterial(material(), { directory, signal: signal(), fetchImplementation: async () => { calls++; return response(); } });
  assert.equal(first.eof, true); assert.equal(first.acquisition, "HTTPS_BYTES_VERIFIED");
  assert.equal(first.sha512, material().expected.sha512); assert.equal(first.identity.nlink, 1);
  const saved = path.join(directory, "blobs", first.name);
  assert.deepEqual(readFileSync(saved), payload); assert.equal(lstatSync(saved).mode & 0o777, 0o600);
  const second = await retainPostgresSourceMaterial(material(), { directory, signal: signal(), fetchImplementation: async () => { throw new Error("must not fetch"); } });
  assert.equal(second.acquisition, "EXISTING_BYTES_REVERIFIED"); assert.deepEqual(second.identity, first.identity); assert.equal(calls, 1);
  writeFileSync(saved, Buffer.alloc(payload.length));
  await assert.rejects(retainPostgresSourceMaterial(material(), { directory, signal: signal(), fetchImplementation: async () => response() }), /digest_invalid/u);
  assert.deepEqual(readFileSync(saved), Buffer.alloc(payload.length));
});

test("wrong digest and truncated body preserve failed bytes without a published blob", { skip: !native }, async (t) => {
  for (const bytes of [Buffer.from("wrong bytes"), payload.subarray(0, payload.length - 1)]) {
    const directory = storage(t);
    await assert.rejects(retainPostgresSourceMaterial(material(), { directory, signal: signal(), fetchImplementation: async () => response(bytes) }), /(?:digest|size)_invalid/u);
    assert.deepEqual(readdirSync(path.join(directory, "blobs")), []);
    assert.equal(readdirSync(path.join(directory, "attempts")).length, 1);
  }
});

test("a failed material can finish in a later attempt without altering preserved failure", { skip: !native }, async (t) => {
  const directory = storage(t);
  await assert.rejects(retainPostgresSourceMaterial(material(), { directory, signal: signal(), fetchImplementation: async () => response(Buffer.from("broken")) }));
  const failed = readdirSync(path.join(directory, "attempts"))[0]; const before = readFileSync(path.join(directory, "attempts", failed));
  const result = await retainPostgresSourceMaterial(material(), { directory, signal: signal(), fetchImplementation: async () => response() });
  assert.equal(result.eof, true); assert.deepEqual(readFileSync(path.join(directory, "attempts", failed)), before);
});

test("HTTP redirects stay inside exact HTTPS host policy and retain expected bytes", { skip: !native }, async (t) => {
  const directory = storage(t); const urls = [];
  const result = await retainPostgresSourceMaterial(material(), { directory, signal: signal(), fetchImplementation: async (url, options) => {
    urls.push(url); assert.equal(options.redirect, "manual"); assert.equal(options.headers["Accept-Encoding"], "identity");
    return urls.length === 1 ? new globalThis.Response(null, { status: 302, headers: { location: "https://codeload.github.com/alpinelinux/aports/tar.gz/" + "1".repeat(40) } }) : response();
  } });
  assert.equal(urls.length, 2); assert.equal(result.finalUrl, urls[1]);
});

test("signed redirect queries stay in the request and never enter retained metadata or records", { skip: !native }, async (t) => {
  const directory = storage(t); const urls = [];
  const location = "https://release-assets.githubusercontent.com/source?fixture-signature=temporary%2Bcapability%2Fvalue";
  const result = await retainPostgresSourceMaterial(material(), { directory, signal: signal(), fetchImplementation: async url => {
    urls.push(url);
    return urls.length === 1 ? new globalThis.Response(null, { status: 302, headers: { location } }) : response();
  } });
  assert.deepEqual(urls, [material().url, location]); assert.equal(result.finalUrl, "https://release-assets.githubusercontent.com/source");
  const fixture = finalizerFixture(); fixture.materials[0] = { ...fixture.materials[0], acquisition: result.acquisition, finalUrl: result.finalUrl };
  const receiptBytes = Buffer.from(JSON.stringify(finalizePostgresSourceClosureMaterials(fixture)));
  assert.equal(receiptBytes.includes("fixture-signature"), false); assert.equal(receiptBytes.includes("temporary"), false);
  assert.equal(JSON.stringify(result).includes("temporary"), false);
  for (const leaf of readdirSync(directory).filter(name => lstatSync(path.join(directory, name)).isFile())) {
    assert.equal(readFileSync(path.join(directory, leaf)).includes("temporary"), false);
  }
});

test("redirect credentials, HTTP, unknown hosts and redirect loops never publish", { skip: !native }, async (t) => {
  for (const location of ["http://raw.githubusercontent.com/source", credentialUrl(), "https://example.org/source", material().url]) {
    const directory = storage(t); let calls = 0;
    await assert.rejects(retainPostgresSourceMaterial(material(), { directory, signal: signal(), fetchImplementation: async () => {
      calls++; return new globalThis.Response(null, { status: 302, headers: { location } });
    } }), /(?:url|redirect)_invalid/u);
    assert.ok(calls <= 5); assert.deepEqual(readdirSync(path.join(directory, "blobs")), []);
  }
});

test("length, content coding, HTTP failures and streamed caps fail before publication", { skip: !native }, async (t) => {
  const scenarios = [
    () => response(payload, { "content-length": String(payload.length - 1) }),
    () => response(payload, { "content-encoding": "gzip" }),
    () => new globalThis.Response("missing", { status: 404 }),
    () => response(Buffer.concat([payload, payload])),
  ];
  for (const makeResponse of scenarios) {
    const directory = storage(t);
    await assert.rejects(retainPostgresSourceMaterial(material(), { directory, signal: signal(), fetchImplementation: async () => makeResponse() }), /(?:size_invalid|response_)/u);
    assert.deepEqual(readdirSync(path.join(directory, "blobs")), []);
  }
  const directory = storage(t);
  await assert.rejects(retainPostgresSourceMaterial(material(), { directory, signal: signal(), maxBytes: payload.length - 1, fetchImplementation: async () => response() }), /size_invalid/u);
});

test("Git symlink blobs retain pointer bytes as regular data without following the target", { skip: !native }, async (t) => {
  const bytes = Buffer.from("../never-execute-this"); const pin = material(bytes);
  pin.expected.gitBlobSha1 = sha("sha1", Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]));
  pin.expected.gitMode = "120000"; pin.expected.gitType = "blob";
  const directory = storage(t);
  const result = await retainPostgresSourceMaterial(pin, { directory, signal: signal(), fetchImplementation: async () => response(bytes) });
  const file = path.join(directory, "blobs", result.name);
  assert.equal(lstatSync(file).isSymbolicLink(), false); assert.deepEqual(readFileSync(file), bytes);
  const changed = material(bytes); changed.expected.gitBlobSha1 = "0".repeat(40); changed.expected.gitMode = "120000"; changed.expected.gitType = "blob";
  await assert.rejects(retainPostgresSourceMaterial(changed, { directory: storage(t), signal: signal(), fetchImplementation: async () => response(bytes) }), /digest_invalid/u);
});

test("symlink roots and substituted cached paths are rejected without touching targets", { skip: !native }, async (t) => {
  const parent = storage(t); const target = storage(t); const linked = path.join(parent, "linked"); symlinkSync(target, linked);
  await assert.rejects(retainPostgresSourceMaterial(material(), { directory: linked, signal: signal(), fetchImplementation: async () => response() }), /storage_invalid/u);
  const directory = storage(t);
  const result = await retainPostgresSourceMaterial(material(), { directory, signal: signal(), fetchImplementation: async () => response() });
  const destination = path.join(directory, "blobs", result.name); rmSync(destination);
  const foreign = path.join(target, "foreign"); writeFileSync(foreign, payload, { mode: 0o600 }); symlinkSync(foreign, destination);
  await assert.rejects(retainPostgresSourceMaterial(material(), { directory, signal: signal(), fetchImplementation: async () => response() }));
  assert.deepEqual(readFileSync(foreign), payload);
});

test("abort, invalid pins and URL authority are refused before a network request", async (t) => {
  let calls = 0; const fetchImplementation = async () => { calls++; return response(); };
  for (const url of ["http://raw.githubusercontent.com/source", credentialUrl(), "https://example.org/source"]) {
    await assert.rejects(retainPostgresSourceMaterial(material(payload, { url }), { directory: "/unused", signal: signal(), fetchImplementation }), /url_invalid/u);
  }
  const invalid = material(); invalid.expected.sha256 = null; invalid.expected.sha512 = null;
  await assert.rejects(retainPostgresSourceMaterial(invalid, { directory: "/unused", signal: signal(), fetchImplementation }), /material_invalid/u);
  if (native) {
    const controller = new globalThis.AbortController(); controller.abort();
    await assert.rejects(retainPostgresSourceMaterial(material(), { directory: storage(t), signal: controller.signal, fetchImplementation }));
  }
  assert.equal(calls, 0);
});

test("retention snapshots the material before asynchronous transport and rejects URL coercion", async t => {
  let reads = 0;
  const invalid = material(payload, { url: { toString() { reads++; return material().url; } } });
  await assert.rejects(retainPostgresSourceMaterial(invalid, { directory: "/unused", signal: signal() }), /url_invalid/u);
  assert.equal(reads, 0);
  if (native) {
    const pin = material(); const expectedId = pin.id; const expectedSha = pin.expected.sha256; let observedUrl;
    const result = await retainPostgresSourceMaterial(pin, { directory: storage(t), signal: signal(), fetchImplementation: async url => {
      observedUrl = url; pin.id = "mutated"; pin.url = "https://example.org/changed"; pin.expected.sha256 = "0".repeat(64); return response();
    } });
    assert.equal(result.id, expectedId); assert.equal(result.sha256, expectedSha); assert.equal(observedUrl, material().url);
  }
});

test("the whole byte operation excludes a concurrent writer and leaves no normal lock", { skip: !native }, async t => {
  const directory = storage(t); let release; let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { release = resolve; });
  const first = retainPostgresSourceMaterial(material(), { directory, signal: signal(), fetchImplementation: async () => {
    entered(); await waiting; return response();
  } });
  await ready;
  const lock = path.join(directory, ".collection-lock"); assert.equal(lstatSync(lock).mode & 0o7777, 0o600);
  await assert.rejects(retainPostgresSourceMaterial(material(), { directory, signal: signal(), fetchImplementation: async () => response() }), /collection_locked/u);
  release(); await first; assert.equal(readdirSync(directory).includes(".collection-lock"), false);
});

test("a stale crash lock blocks without replacement, reading or removal", { skip: !native }, async t => {
  const directory = storage(t); const file = path.join(directory, ".collection-lock");
  writeFileSync(file, "preserved stale lock", { flag: "wx", mode: 0o600 });
  const before = lstatSync(file, { bigint: true }); let calls = 0;
  await assert.rejects(retainPostgresSourceMaterial(material(), { directory, signal: signal(), fetchImplementation: async () => { calls++; return response(); } }), /collection_locked/u);
  assert.equal(calls, 0); assert.deepEqual(lstatSync(file, { bigint: true }), before);
  assert.equal(readFileSync(file, "utf8"), "preserved stale lock");
});

test("substituting an owned lock preserves both foreign and original objects with cleanup priority", { skip: !native }, async t => {
  const directory = storage(t); const lock = path.join(directory, ".collection-lock"); const previous = path.join(directory, "original-lock");
  await assert.rejects(retainPostgresSourceMaterial(material(), { directory, signal: signal(), fetchImplementation: async () => {
    renameSync(lock, previous); writeFileSync(lock, "foreign fixture", { flag: "wx", mode: 0o600 }); return response();
  } }), /cleanup_uncertain/u);
  assert.equal(readFileSync(lock, "utf8"), "foreign fixture"); assert.ok(readFileSync(previous).length > 0);
});

test("hardlinked cached objects fail without a request or alteration", { skip: !native }, async t => {
  const directory = storage(t);
  const first = await retainPostgresSourceMaterial(material(), { directory, signal: signal(), fetchImplementation: async () => response() });
  const file = path.join(directory, "blobs", first.name); const extra = path.join(directory, "extra-link"); linkSync(file, extra);
  let calls = 0;
  await assert.rejects(retainPostgresSourceMaterial(material(), { directory, signal: signal(), fetchImplementation: async () => { calls++; return response(); } }), /storage_invalid/u);
  assert.equal(calls, 0); assert.deepEqual(readFileSync(file), payload); assert.deepEqual(readFileSync(extra), payload);
});

test("a cached FIFO is refused nonblocking under a real child deadline", { skip: !native }, t => {
  const directory = storage(t); const blobs = path.join(directory, "blobs"); mkdirSync(blobs, { mode: 0o700 });
  const file = path.join(blobs, `sha256-${material().expected.sha256}.blob`);
  assert.equal(spawnSync("/usr/bin/mkfifo", ["-m", "600", file], { timeout: 5000, encoding: "utf8" }).status, 0);
  const code = `import {retainPostgresSourceMaterial} from ${JSON.stringify(new URL("../scripts/postgres-image/source-closure.mjs", import.meta.url).href)};
    try { await retainPostgresSourceMaterial(${JSON.stringify(material())}, {directory:${JSON.stringify(directory)}, signal:new AbortController().signal,
      fetchImplementation:async()=>{throw new Error('MUST_NOT_FETCH');}}); process.exitCode=2; }
    catch(error) { if(error.message!=='postgres_source_closure_storage_invalid') process.exitCode=3; }`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { timeout: 5000, encoding: "utf8" });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.stderr, "");
  assert.equal(lstatSync(file).isFIFO(), true); assert.equal(readdirSync(directory).includes(".collection-lock"), false);
});

// These are caller-facts fixtures for a pure comparison, never fake native acceptance.
function finalizerFixture() {
  const expectedMaterials = [material(), material(Buffer.from("second fixture\n"), { id: "fixture-second" })];
  const materials = expectedMaterials.map((v, index) => ({ id: v.id, name: `sha256-${v.expected.sha256}.blob`,
    size: v.expected.size, sha256: v.expected.sha256, sha512: v.expected.sha512, gitBlobSha1: null, eof: true,
    acquisition: "EXISTING_BYTES_REVERIFIED", identity: { dev: "1", ino: String(index + 1), uid: 1000, gid: 1000,
      mode: 0o600, nlink: 1, size: v.expected.size, mtimeNs: "1", ctimeNs: "1" } }));
  return { expectedMaterials, materials, failures: [], observedNames: materials.map(v => v.name) };
}

test("pure finalization compares complete facts but never establishes source closure or authority", () => {
  const fixture = finalizerFixture(); const result = finalizePostgresSourceClosureMaterials(fixture);
  assert.equal(result.state, "BYTES_VERIFIED_UNADMITTED"); assert.deepEqual(result.counts, { expected: 2, verified: 2, failed: 0, totalBytes: 41 });
  assert.equal(result.claims.authority, "NONE"); assert.equal(result.claims.sourceClosure, "NOT_ESTABLISHED");
  assert.equal(result.claims.admission, "NOT_AUTHORIZED"); assert.equal(result.claims.runtimePermission, "NOT_GRANTED");
  assert.equal(result.claims.supportStartedAt, null); assert.equal(result.claims.supportEndsAt, null); assert.equal(result.claims.archiveUntil, null);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.materials[0].identity));
  fixture.materials[0].identity.ino = "3"; assert.equal(result.materials[0].identity.ino, "1");
});

test("missing, failed or extra inventory facts remain incomplete", () => {
  for (const mutate of [
    v => { v.materials.pop(); v.observedNames.pop(); },
    v => { const missing = v.materials.pop(); v.observedNames.pop(); v.failures.push({ id: missing.id, reason: "postgres_source_closure_download_failed" }); },
    v => { v.observedNames.push(`sha256-${"0".repeat(64)}.blob`); },
  ]) {
    const value = finalizerFixture(); mutate(value); assert.equal(finalizePostgresSourceClosureMaterials(value).state, "INCOMPLETE");
  }
});

test("duplicates, conflicting outcomes and invalid pure proofs cannot be finalized", () => {
  for (const mutate of [
    v => { v.expectedMaterials[1] = v.expectedMaterials[0]; },
    v => { v.materials[1] = v.materials[0]; },
    v => { v.failures.push({ id: v.materials[0].id, reason: "postgres_source_closure_download_failed" }); },
    v => { v.observedNames.push(v.observedNames[0]); },
    v => { v.materials[0].eof = false; }, v => { v.materials[0].sha256 = "0".repeat(64); },
    v => { v.materials[0].identity.nlink = 2; }, v => { v.materials[0].identity.mode = 0o4600; },
    v => { v.materials[0].identity.uid = 0; }, v => { v.materials[0].identity.dev = ["1"]; },
    v => { v.materials[0].name = "foreign.blob"; },
    v => { v.materials[0].acquisition = "HTTPS_BYTES_VERIFIED"; v.materials[0].finalUrl = "https://release-assets.githubusercontent.com/source?fixture-query=temporary%2Bvalue"; },
    v => { v.failures = [{ id: "foreign", reason: "postgres_source_closure_download_failed" }]; },
    v => { const missing = v.materials.pop(); v.observedNames.pop(); v.failures = [{ id: missing.id, reason: "postgres_source_closure_private_text" }]; },
    v => { const missing = v.materials.pop(); v.observedNames.pop(); v.failures = [{ id: missing.id, reason: "postgres_source_closure_cleanup_uncertain" }]; },
  ]) {
    const value = finalizerFixture(); mutate(value);
    assert.throws(() => finalizePostgresSourceClosureMaterials(value), { message: "postgres_source_closure_proof_invalid" });
  }
});

test("pure finalization refuses accessors, coercion, hidden fields and decorated arrays without reading getters", () => {
  let reads = 0;
  for (const mutate of [
    v => { Object.defineProperty(v, "materials", { get() { reads++; return []; }, enumerable: true }); },
    v => { Object.defineProperty(v.materials[0], "acquisition", { get() { reads++; return "EXISTING_BYTES_REVERIFIED"; }, enumerable: true }); },
    v => { v.materials[0].sha256 = { toString() { reads++; return "0".repeat(64); } }; },
    v => { v.materials[0].identity[Symbol("fixture")] = true; },
    v => { Object.defineProperty(v.materials[0], "extra", { value: true }); },
    v => { v.materials.extra = true; }, v => { delete v.materials[0]; },
  ]) {
    const value = finalizerFixture(); mutate(value);
    assert.throws(() => finalizePostgresSourceClosureMaterials(value), { message: "postgres_source_closure_proof_invalid" });
  }
  assert.equal(reads, 0);
});

test("real root handoff runs the fixed 323 batch as genuine 1000 with networking disabled and seals atomic records", {
  skip: !native || process.getuid() !== 0 || process.versions.node !== "22.23.2",
}, t => {
  const root = mkdtempSync("/var/tmp/pg-source-public-");
  // Only this newly owned fixture tree is changed; checkout permissions stay intact.
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chownSync(root, 0, 1000); chmodSync(root, 0o750);
  for (const relative of ["scripts", "scripts/postgres-image", "infra", "infra/postgres-image"]) {
    const directory = path.join(root, relative); mkdirSync(directory); chownSync(directory, 0, 1000); chmodSync(directory, 0o750);
  }
  const sources = ["scripts/postgres-image/source-closure.mjs", "scripts/postgres-image/source-closure-manifest.mjs", "infra/postgres-image/source-closure-materials.json"];
  const sourcePins = [];
  for (const relative of sources) {
    const file = path.join(root, relative); copyFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), file);
    chownSync(file, 0, 1000); chmodSync(file, 0o440);
    sourcePins.push({ source: relative, size: readFileSync(file).length, sha256: sha("sha256", readFileSync(file)) });
  }
  const output = path.join(root, "output"); mkdirSync(output); chownSync(output, 1000, 1000); chmodSync(output, 0o700);
  const driver = path.join(root, "driver.mjs");
  writeFileSync(driver, `import assert from 'node:assert/strict'; import {createHash} from 'node:crypto';
    import {readFileSync,readdirSync,lstatSync} from 'node:fs';
    import {collectPostgresSourceClosure} from './scripts/postgres-image/source-closure.mjs';
    const before=readdirSync('/proc/self/fd').sort(); let calls=0;
    globalThis.fetch=async()=>{calls++;throw new Error('NO_NETWORK_FIXTURE');};
    const ack=await collectPostgresSourceClosure({directory:${JSON.stringify(output)}});
    assert.equal(calls,323);assert.equal(ack.state,'INCOMPLETE');assert.equal(ack.counts.expected,323);assert.equal(ack.counts.failed,323);
    assert.equal(ack.counts.verified,0);assert.equal(ack.receipt.eof,true);assert.equal(ack.context.eof,true);
    const bytes=readFileSync(${JSON.stringify(output)}+'/'+ack.receipt.name);
    assert.equal(bytes.length,ack.receipt.size);assert.equal(createHash('sha256').update(bytes).digest('hex'),ack.receipt.sha256);
    const receipt=JSON.parse(bytes);assert.deepEqual(receipt.context.sources,${JSON.stringify(sourcePins)});
    assert.equal(receipt.context.executedCodeAuthentication,'REQUIRES_EXTERNAL_READONLY_SNAPSHOT');
    assert.equal(receipt.context.sourceObservation,'SELF_OBSERVED_DISK_BYTES');
    assert.deepEqual(receipt.actor.kernelSupplementaryGroups,[]);assert.equal(receipt.actor.uid,1000);assert.equal(receipt.actor.gid,1000);assert.equal(receipt.actor.noNewPrivs,1);
    assert.ok(receipt.sourceFiles.every(v=>v.identity.uid===0&&v.identity.gid===1000&&v.identity.mode===0o440&&v.eof===true));
    assert.equal(receipt.claims.admission,'NOT_AUTHORIZED');assert.equal(receipt.claims.supportStartedAt,null);
    assert.equal(readdirSync(${JSON.stringify(output)}).includes('.collection-lock'),false);
    assert.equal(readdirSync(${JSON.stringify(output)}).some(v=>v.startsWith('.record-')),false);
    assert.equal(lstatSync(${JSON.stringify(output)}+'/'+ack.receipt.name).mode&0o7777,0o600);
    assert.deepEqual(readdirSync('/proc/self/fd').sort(),before);
    console.log(JSON.stringify({state:'PARTIAL_NATIVE_ORCHESTRATION_VERIFIED',expected:323,failed:323,networkUsed:false}));
  `, { flag: "wx", mode: 0o440 }); chownSync(driver, 0, 1000); chmodSync(driver, 0o440);
  const node = "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node";
  const result = spawnSync("/usr/bin/setpriv", ["--reuid=1000", "--regid=1000", "--clear-groups", "--inh-caps=-all",
    "--ambient-caps=-all", "--no-new-privs", "--", node, driver], {
    cwd: root, timeout: 60000, encoding: "utf8", maxBuffer: 64 * 1024,
    env: { PATH: "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin:/usr/sbin:/usr/bin:/bin",
      HOME: "/home/autoworld", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC" },
  });
  assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), { state: "PARTIAL_NATIVE_ORCHESTRATION_VERIFIED", expected: 323, failed: 323, networkUsed: false });
  for (const pin of sourcePins) assert.equal(sha("sha256", readFileSync(path.join(root, pin.source))), pin.sha256);
});
