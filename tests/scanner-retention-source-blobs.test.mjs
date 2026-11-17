import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SCANNER_RETENTION as P, sha256 } from "../scripts/scanner/retention-policy.mjs";
import { readScannerRetentionQualifiedBlob } from "../scripts/scanner/retention-source-blobs.mjs";

const OBJECT_ACCEPT = "application/vnd.github.object+json";
const RAW_ACCEPT = "application/vnd.github.raw+json";
const context = Object.freeze({ token: "unit-test-token" });
const now = () => 1_000;
const deadline = 31_000;
const errorPattern = /scanner_retention_publish_source_blob_/u;
const war = P.qualification.staticQualifiedBlobs.find((item) => item.sourcePath.endsWith("/test.war"));
const json = P.qualification.staticQualifiedBlobs.find((item) => item.sourcePath.endsWith("/manifest.json"));
const small = P.qualification.staticQualifiedBlobs[0];
const sourceBytes = (item) => readFileSync(new URL(`../${item.sourcePath}`, import.meta.url));
const endpoint = (item) => `https://api.github.com/repos/${P.repository}/contents/${item.sourcePath
  .split("/").map(encodeURIComponent).join("/")}?ref=${P.qualification.headSha}`;

function metadata(item, bytes = sourceBytes(item)) {
  return { type: "file", path: item.sourcePath, size: item.bytes,
    sha: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
    encoding: item.bytes > 1024 ** 2 ? "none" : "base64", content: "",
    download_url: "https://untrusted.invalid/never-follow-this" };
}

function response(bytes, options = {}) {
  let offset = 0;
  const observed = { reads: 0, cancels: 0, released: 0 };
  const reader = {
    async read() {
      observed.reads++;
      if (offset < bytes.length) {
        const chunk = bytes.subarray(offset, offset + (options.chunkBytes ?? 65_536));
        offset += chunk.length; return { done: false, value: chunk };
      }
      if (options.afterBytes) return options.afterBytes();
      return { done: true, value: undefined };
    },
    async cancel() { observed.cancels++; if (options.cancel) return options.cancel(); },
    releaseLock() { observed.released++; if (options.release) options.release(); },
  };
  return { value: { status: options.status ?? 200, redirected: options.redirected ?? false,
    url: options.url ?? "", headers: { get: (name) => name === "content-length" ? options.contentLength ?? null : null },
    body: options.body === null ? null : { getReader: () => reader, cancel: () => reader.cancel() } }, observed };
}

function transport(item, { meta = metadata(item), bytes = sourceBytes(item), metadataResponse, rawResponse } = {}) {
  const calls = [];
  const first = metadataResponse ?? response(Buffer.from(JSON.stringify(meta)));
  const second = rawResponse ?? response(bytes);
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.ok(calls.length <= 2, "no fallback or repeated request");
    return calls.length === 1 ? first.value : second.value;
  };
  return { calls, first, second, fetchImpl,
    run: (overrides = {}) => readScannerRetentionQualifiedBlob({ context, item, now, deadline, fetchImpl, ...overrides }) };
}

test("all eighteen literal mappings use only metadata then raw at the immutable qualification SHA", async () => {
  assert.equal(P.qualification.staticQualifiedBlobs.length, 18);
  for (const item of P.qualification.staticQualifiedBlobs) {
    const bytes = sourceBytes(item);
    const fixture = transport(item, { bytes });
    // Current code is not a substitute for historical qualified snapshots.
    if (bytes.length === item.bytes && sha256(bytes) === item.sha256) {
      assert.deepEqual(await fixture.run(), bytes);
    } else {
      await assert.rejects(fixture.run(), /source_blob_identity_invalid/u);
    }
    assert.equal(fixture.calls.length, 2);
    for (const [index, call] of fixture.calls.entries()) {
      assert.equal(call.url, endpoint(item));
      assert.equal(call.options.method, "GET");
      assert.equal(call.options.redirect, "error");
      assert.deepEqual(call.options.headers, { Accept: index === 0 ? OBJECT_ACCEPT : RAW_ACCEPT,
        Authorization: `Bearer ${context.token}`, "User-Agent": "auto-world-scanner-retention-publisher",
        "X-GitHub-Api-Version": "2022-11-28" });
      assert.ok(call.options.signal instanceof globalThis.AbortSignal);
    }
    assert.equal(fixture.first.observed.released, 1);
    assert.equal(fixture.second.observed.released, 1);
  }
});

test("the qualified 2.5MB WAR passes as raw bytes despite object encoding none", async () => {
  const bytes = sourceBytes(war);
  assert.equal(bytes.length, 2_525_883);
  assert.equal(sha256(bytes), "b852f605a56a1e109bdd17aaa8d85007c4327708bf6e3b4b56a9876b4a1077ba");
  const meta = metadata(war); assert.equal(meta.encoding, "none");
  const fixture = transport(war, { meta, rawResponse: response(bytes, { contentLength: String(bytes.length) }) });
  const received = await fixture.run();
  assert.deepEqual(received, bytes);
  assert.ok(fixture.second.observed.reads > 2);
  assert.equal(P.bootstrap.commandOutputCapBytes, 1_048_576);
});

test("raw qualified JSON is accepted by byte identity, while an API JSON envelope is refused", async () => {
  const bytes = sourceBytes(json);
  assert.doesNotThrow(() => JSON.parse(bytes.toString()));
  assert.deepEqual(await transport(json).run(), bytes);
  for (const wrong of [Buffer.from(JSON.stringify(metadata(json))), Buffer.from('{"message":"Not Found"}')]) {
    await assert.rejects(transport(json, { bytes: wrong }).run(), /source_blob_identity_invalid/u);
  }
});

test("only the authenticated policy's selected record and a valid deadline/token can start requests", async () => {
  const fixture = transport(small);
  for (const overrides of [
    { item: { ...small } }, { item: { ...small, sourcePath: "../secret" } },
    { item: { ...small, bytes: small.bytes + 1 } }, { item: null },
    { context: { token: "bad\nheader" } }, { context: {} },
    { deadline: NaN }, { deadline: 1_000 }, { now: () => NaN }, { fetchImpl: undefined, now: null },
  ]) await assert.rejects(fixture.run(overrides), errorPattern);
  assert.equal(fixture.calls.length, 0);
});

test("metadata type, path, size and blob identity are checked before raw intake", async () => {
  for (const mutate of [
    (m) => { m.type = "symlink"; }, (m) => { m.type = "dir"; },
    (m) => { m.path = "infra/scanner/other.json"; }, (m) => { m.size++; },
    (m) => { m.size = String(m.size); }, (m) => { m.sha = "not-a-blob"; },
    (m) => { delete m.sha; },
  ]) {
    const meta = metadata(war); mutate(meta);
    const fixture = transport(war, { meta });
    await assert.rejects(fixture.run(), /source_blob_metadata_invalid/u);
    assert.equal(fixture.calls.length, 1);
  }
  for (const bytes of [Buffer.from("not json"), Buffer.from([0xff]), Buffer.from("null")]) {
    const fixture = transport(war, { metadataResponse: response(bytes) });
    await assert.rejects(fixture.run(), /source_blob_metadata_invalid/u);
    assert.equal(fixture.calls.length, 1);
  }
});

test("metadata keeps its 1MiB cap and raw bodies stop at their exact member cap", async () => {
  const overMeta = response(Buffer.alloc(1_048_577));
  const fixture = transport(war, { metadataResponse: overMeta });
  await assert.rejects(fixture.run(), /source_blob_response_limit/u);
  assert.equal(fixture.calls.length, 1);
  assert.equal(overMeta.observed.cancels, 1);
  assert.equal(overMeta.observed.released, 1);
  assert.equal(fixture.calls[0].options.signal.aborted, true);

  const overRaw = response(Buffer.concat([sourceBytes(small), Buffer.from("x")]));
  const rawFixture = transport(small, { rawResponse: overRaw });
  await assert.rejects(rawFixture.run(), /source_blob_response_limit/u);
  assert.equal(overRaw.observed.cancels, 1);
  assert.equal(overRaw.observed.released, 1);
  assert.equal(rawFixture.calls[1].options.signal.aborted, true);
});

test("truncation, same-length corruption and incorrect content lengths cannot pass raw intake", async () => {
  const original = sourceBytes(war);
  const changed = Buffer.from(original); changed[changed.length - 1] ^= 1;
  for (const bytes of [original.subarray(0, -1), changed]) {
    await assert.rejects(transport(war, { bytes }).run(), /source_blob_identity_invalid/u);
  }
  for (const contentLength of [String(war.bytes + 1), "-1", "invalid", "9007199254740992", "01"]) {
    const body = response(original, { contentLength });
    await assert.rejects(transport(war, { rawResponse: body }).run(), /source_blob_response_limit/u);
    assert.equal(body.observed.reads, 0);
    assert.equal(body.observed.cancels, 1);
  }
});

test("status, redirected response, alternate URL and missing body refuse without fallback", async () => {
  for (const options of [
    { status: 302 }, { status: 404 }, { status: 206 }, { redirected: true },
    { url: "https://raw.githubusercontent.com/other/branch/file" }, { body: null },
  ]) {
    const body = response(sourceBytes(small), options);
    const fixture = transport(small, { rawResponse: body });
    await assert.rejects(fixture.run(), /source_blob_(?:response|body)_invalid/u);
    assert.equal(fixture.calls.length, 2);
    assert.equal(fixture.calls[1].options.signal.aborted, true);
  }
});

test("EOF and reader closure must succeed after all expected bytes arrive", async () => {
  for (const options of [
    { afterBytes: () => { throw new Error("private stream failure"); } },
    { afterBytes: () => ({ done: false, value: Buffer.alloc(0) }) },
    { release: () => { throw new Error("private release failure"); } },
  ]) {
    const body = response(sourceBytes(small), options);
    const fixture = transport(small, { rawResponse: body });
    await assert.rejects(fixture.run(), (error) => {
      assert.match(error.message, errorPattern);
      assert.doesNotMatch(error.message, /private/u); return true;
    });
    assert.equal(body.observed.released, 1);
  }
});

test("request failures expose only fixed reasons and never start a raw fallback", async () => {
  let calls = 0;
  await assert.rejects(readScannerRetentionQualifiedBlob({ context, item: small, now, deadline,
    fetchImpl: async () => { calls++; throw new Error("Authorization: private credential"); } }),
  { message: "scanner_retention_publish_source_blob_request_failed" });
  assert.equal(calls, 1);
});

test("the request timer aborts a transport that never responds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  const pending = readScannerRetentionQualifiedBlob({ context, item: small, now, deadline,
    fetchImpl: (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
  const refused = assert.rejects(pending, /source_blob_timeout/u);
  t.mock.timers.tick(15_000);
  await refused; assert.equal(signal.aborted, true);
});

test("a response arriving after timeout is cancelled without reading its body", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let respond;
  const late = response(Buffer.from(JSON.stringify(metadata(small))));
  const pending = readScannerRetentionQualifiedBlob({ context, item: small, now, deadline,
    fetchImpl: () => new Promise((resolve) => { respond = resolve; }) });
  const refused = assert.rejects(pending, /source_blob_timeout/u);
  t.mock.timers.tick(15_000); await refused;
  respond(late.value); await Promise.resolve();
  assert.equal(late.observed.reads, 0);
  assert.equal(late.observed.cancels, 1);
});

test("the remaining operation deadline bounds a body stalled after its expected bytes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const raw = response(sourceBytes(small), { afterBytes: () => {
    entered(); return new Promise(() => {});
  } });
  const fixture = transport(small, { rawResponse: raw });
  const refused = assert.rejects(fixture.run({ deadline: 1_500 }), /source_blob_timeout/u);
  await waiting; t.mock.timers.tick(500); await refused;
  assert.equal(fixture.calls[1].options.signal.aborted, true);
  assert.equal(raw.observed.cancels, 1); assert.equal(raw.observed.released, 1);
});

test("a failed body's cancellation cannot run beyond the same request deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let cancelled;
  const waiting = new Promise((resolve) => { cancelled = resolve; });
  const raw = response(Buffer.alloc(small.bytes + 1), { cancel: () => {
    cancelled(); return new Promise(() => {});
  } });
  const fixture = transport(small, { rawResponse: raw });
  const refused = assert.rejects(fixture.run(), /source_blob_response_limit/u);
  await waiting; t.mock.timers.tick(15_000); await refused;
  assert.equal(raw.observed.cancels, 1); assert.equal(raw.observed.released, 1);
});
