import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  TEST_ONLY_fetchPinnedBaseManifest,
  TEST_ONLY_streamPinnedBaseBlob,
} from "../scripts/seaweed-image/registry-base.mjs";

const manifestBytes = await readFile(new URL("../infra/seaweed-image/base-manifest.json", import.meta.url));
const configBytes = await readFile(new URL("../infra/seaweed-image/base-config.json", import.meta.url));
const registry = "https://registry-1.docker.io";
const manifestDigest = "sha256:f83509b0721dfd8e2e07faf76c0a899f67a8a889c89abe2fa0a5227ba1320362";
const manifestUrl = `${registry}/v2/chrislusf/seaweedfs/manifests/${manifestDigest}`;
const challenge = 'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:chrislusf/seaweedfs:pull"';

const response = (body, status = 200, headers = {}) => new globalThis.Response(body, { status, headers });
const unauthorized = (header = challenge) => response(null, 401, { "www-authenticate": header });
const tokenResponse = () => response(JSON.stringify({ token: "fixed-test-token", access_token: "fixed-test-token" }), 200,
  { "content-type": "application/json; charset=utf-8" });
const manifestResponse = (bytes = manifestBytes, headers = {}) => response(bytes, 200, {
  "content-type": "application/vnd.oci.image.manifest.v1+json",
  "content-length": String(bytes.length),
  "docker-content-digest": manifestDigest,
  ...headers,
});

function trackedBody(chunks, onCancel = () => undefined) {
  return new globalThis.ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
    cancel: onCancel,
  });
}

function trackedStreamingBody(chunks, onCancel) {
  let index = 0;
  return new globalThis.ReadableStream({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
    },
    cancel: onCancel,
  }, { highWaterMark: 0 });
}

function trackedDiscardResponse(status, headers, onCancel) {
  return response(trackedBody([Buffer.from("discarded upstream body")], onCancel), status, headers);
}

function successfulManifestFetch(records = []) {
  return async (input, init) => {
    const url = input.href ?? String(input);
    records.push({ url, init });
    if (url === manifestUrl && !init.headers.has("authorization")) return unauthorized();
    if (url.startsWith("https://auth.docker.io/token?")) return tokenResponse();
    if (url === manifestUrl && init.headers.get("authorization") === "Bearer fixed-test-token") return manifestResponse();
    throw new Error(`unexpected request ${url}`);
  };
}

async function authenticatedManifest(records = []) {
  return TEST_ONLY_fetchPinnedBaseManifest({ fetch: successfulManifestFetch(records), timeoutMs: 5_000 });
}

test("fetches only the pinned manifest digest through the exact anonymous pull challenge", async () => {
  const records = [];
  const result = await authenticatedManifest(records);
  assert.equal(result.digest, manifestDigest);
  assert.deepEqual(result.bytes, manifestBytes);
  assert.equal(result.config.digest, "sha256:31d61f5e8771cbd5993912cd051be0c7bcdc207faaa12c50e1a3b8371631c927");
  assert.equal(result.layers.length, 10);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.config), true);
  assert.equal(Object.isFrozen(result.layers), true);
  assert.ok(records.every(({ init }) => init.redirect === "manual"));
  assert.deepEqual(records.map(({ url }) => url), [manifestUrl,
    "https://auth.docker.io/token?service=registry.docker.io&scope=repository%3Achrislusf%2Fseaweedfs%3Apull&client_id=auto-world-seaweed-base-reader",
    manifestUrl]);
  assert.equal(records[0].init.headers.has("authorization"), false);
  assert.equal(records[1].init.headers.has("authorization"), false);
  assert.equal(records[2].init.headers.get("authorization"), "Bearer fixed-test-token");
  assert.equal(records.some(({ url }) => /:4\.47(?:$|[?/])/u.test(url)), false);
});

test("streams an authenticated config descriptor, supports partial writes, and strips bearer on the CDN hop", async () => {
  const manifest = await authenticatedManifest();
  const blobUrl = `${registry}/v2/chrislusf/seaweedfs/blobs/${manifest.config.digest}`;
  const cdnUrl = "https://cdn.example.invalid/signed/config";
  const records = [];
  const fetch = async (input, init) => {
    const url = input.href ?? String(input);
    records.push({ url, authorization: init.headers.get("authorization") });
    if (url === blobUrl && !init.headers.has("authorization")) return unauthorized();
    if (url.startsWith("https://auth.docker.io/token?")) return tokenResponse();
    if (url === blobUrl) return response(null, 307, { location: cdnUrl });
    if (url === cdnUrl) return response(configBytes, 200, { "content-length": String(configBytes.length) });
    throw new Error(`unexpected request ${url}`);
  };
  const written = [];
  const sink = {
    async write(bytes, offset, length, position) {
      assert.equal(position, null);
      const amount = Math.min(7, length);
      written.push(Buffer.from(bytes.subarray(offset, offset + amount)));
      return { bytesWritten: amount };
    },
  };
  const receipt = await TEST_ONLY_streamPinnedBaseBlob({ descriptor: manifest.config, sink, fetch, timeoutMs: 5_000 });
  assert.deepEqual(Buffer.concat(written), configBytes);
  assert.deepEqual(receipt, {
    size: configBytes.length,
    digest: manifest.config.digest,
    mediaType: manifest.config.mediaType,
    authority: "PINNED_BASE_ONLY",
    candidateAuthorization: "NOT_AUTHORIZED",
  });
  assert.deepEqual(records, [
    { url: blobUrl, authorization: null },
    { url: "https://auth.docker.io/token?service=registry.docker.io&scope=repository%3Achrislusf%2Fseaweedfs%3Apull&client_id=auto-world-seaweed-base-reader", authorization: null },
    { url: blobUrl, authorization: "Bearer fixed-test-token" },
    { url: cdnUrl, authorization: null },
  ]);
});

test("rejects cloned and locally parsed descriptors before network or sink I/O", async () => {
  const first = await authenticatedManifest();
  const second = await authenticatedManifest();
  let called = false;
  const sink = { async write() { called = true; return { bytesWritten: 1 }; } };
  const fetch = async () => { called = true; throw new Error("must not run"); };
  assert.throws(() => TEST_ONLY_streamPinnedBaseBlob({ descriptor: { ...first.config }, sink, fetch }),
    /seaweed_base_registry_descriptor_unauthenticated/u);
  const parsed = JSON.parse(manifestBytes.toString("utf8"));
  assert.throws(() => TEST_ONLY_streamPinnedBaseBlob({ descriptor: parsed.config, sink, fetch }),
    /seaweed_base_registry_descriptor_unauthenticated/u);
  assert.notEqual(first.config, second.config);
  assert.equal(called, false);
});

test("rejects challenge realm, service, scope, syntax, and duplicate parameters", async () => {
  const headers = [
    'Bearer realm="http://auth.docker.io/token",service="registry.docker.io",scope="repository:chrislusf/seaweedfs:pull"',
    'Bearer realm="https://auth.docker.io/token",service="evil",scope="repository:chrislusf/seaweedfs:pull"',
    'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:chrislusf/seaweedfs:pull,push"',
    'Basic realm="registry"',
    `${challenge},scope="repository:chrislusf/seaweedfs:pull"`,
  ];
  for (const header of headers) {
    let calls = 0;
    await assert.rejects(TEST_ONLY_fetchPinnedBaseManifest({ fetch: async () => { calls += 1; return unauthorized(header); } }),
      /seaweed_base_registry_challenge_invalid/u);
    assert.equal(calls, 1, header);
  }
});

test("rejects manifest redirects, wrong identity headers, media type, truncation, and excess bytes", async () => {
  const cases = [
    response(null, 307, { location: "https://evil.invalid/manifest" }),
    manifestResponse(manifestBytes, { "docker-content-digest": `sha256:${"0".repeat(64)}` }),
    manifestResponse(manifestBytes, { "content-type": "application/json" }),
    manifestResponse(manifestBytes.subarray(0, -1)),
    manifestResponse(Buffer.concat([manifestBytes, Buffer.from("x")])),
  ];
  for (const finalResponse of cases) {
    let call = 0;
    const fetch = async () => {
      call += 1;
      if (call === 1) return unauthorized();
      if (call === 2) return tokenResponse();
      return finalResponse;
    };
    await assert.rejects(TEST_ONLY_fetchPinnedBaseManifest({ fetch }), /seaweed_base_registry_/u);
  }
});

test("rejects HTTP, repeated cross-origin, and registry-return redirects while never forwarding bearer", async () => {
  const manifest = await authenticatedManifest();
  const blobUrl = `${registry}/v2/chrislusf/seaweedfs/blobs/${manifest.config.digest}`;
  const locations = [
    ["http://cdn.example.invalid/blob"],
    ["https://one.example.invalid/blob", "https://two.example.invalid/blob"],
    ["https://one.example.invalid/blob", blobUrl],
  ];
  for (const chain of locations) {
    const observed = [];
    let step = 0;
    const fetch = async (input, init) => {
      const url = input.href ?? String(input);
      observed.push({ url, authorization: init.headers.get("authorization") });
      if (url === blobUrl && observed.length === 1) return unauthorized();
      if (url.startsWith("https://auth.docker.io/token?")) return tokenResponse();
      if (url === blobUrl && observed.length === 3) return response(null, 307, { location: chain[step++] });
      return response(null, 307, { location: chain[step++] });
    };
    await assert.rejects(TEST_ONLY_streamPinnedBaseBlob({ descriptor: manifest.config,
      sink: { async write() { throw new Error("unreachable"); } }, fetch }), /seaweed_base_registry_redirect_invalid/u);
    assert.ok(observed.filter(({ url }) => !url.startsWith(registry)).every(({ authorization }) => authorization === null));
  }
});

test("rejects corrupt, short, and oversized blob bodies and invalid sink progress", async () => {
  const manifest = await authenticatedManifest();
  const bodyCases = [
    Buffer.alloc(configBytes.length),
    configBytes.subarray(0, -1),
    Buffer.concat([configBytes, Buffer.from("x")]),
  ];
  for (const body of bodyCases) {
    let call = 0;
    const fetch = async () => {
      call += 1;
      if (call === 1) return unauthorized();
      if (call === 2) return tokenResponse();
      return response(body, 200);
    };
    await assert.rejects(TEST_ONLY_streamPinnedBaseBlob({ descriptor: manifest.config,
      sink: { async write(_bytes, _offset, length) { return { bytesWritten: length }; } }, fetch }),
    /seaweed_base_registry_(?:digest|size)_invalid/u);
  }
  let call = 0;
  const fetch = async () => {
    call += 1;
    if (call === 1) return unauthorized();
    if (call === 2) return tokenResponse();
    return response(configBytes, 200);
  };
  await assert.rejects(TEST_ONLY_streamPinnedBaseBlob({ descriptor: manifest.config,
    sink: { async write() { return { bytesWritten: 0 }; } }, fetch }), /seaweed_base_registry_sink_write_failed/u);
});

test("stops sink writes and emits no receipt when aborted after the first body chunk", async () => {
  const manifest = await authenticatedManifest();
  const controller = new globalThis.AbortController();
  const split = Math.floor(configBytes.length / 2);
  let call = 0;
  let cancellations = 0;
  const fetch = async () => {
    call += 1;
    if (call === 1) return unauthorized();
    if (call === 2) return tokenResponse();
    return response(trackedStreamingBody([configBytes.subarray(0, split), configBytes.subarray(split)], () => {
      cancellations += 1;
    }), 200, { "content-length": String(configBytes.length) });
  };
  const writes = [];
  const operation = TEST_ONLY_streamPinnedBaseBlob({
    descriptor: manifest.config,
    signal: controller.signal,
    sink: {
      async write(bytes, offset, length) {
        writes.push(Buffer.from(bytes.subarray(offset, offset + length)));
        controller.abort();
        return { bytesWritten: length };
      },
    },
    fetch,
    timeoutMs: 5_000,
  });
  await assert.rejects(operation, /seaweed_base_registry_aborted/u);
  assert.deepEqual(writes, [configBytes.subarray(0, split)]);
  assert.equal(cancellations, 1);
});

test("stops sink writes and emits no receipt when the deadline expires after the first body chunk", async () => {
  const manifest = await authenticatedManifest();
  const split = Math.floor(configBytes.length / 2);
  let call = 0;
  let clock = 0;
  let cancellations = 0;
  const fetch = async () => {
    call += 1;
    if (call === 1) return unauthorized();
    if (call === 2) return tokenResponse();
    return response(trackedStreamingBody([configBytes.subarray(0, split), configBytes.subarray(split)], () => {
      cancellations += 1;
    }), 200, { "content-length": String(configBytes.length) });
  };
  const writes = [];
  const operation = TEST_ONLY_streamPinnedBaseBlob({
    descriptor: manifest.config,
    sink: {
      async write(bytes, offset, length) {
        writes.push(Buffer.from(bytes.subarray(offset, offset + length)));
        clock = 101;
        return { bytesWritten: length };
      },
    },
    fetch,
    now: () => clock,
    timeoutMs: 100,
  });
  await assert.rejects(operation, /seaweed_base_registry_timeout/u);
  assert.deepEqual(writes, [configBytes.subarray(0, split)]);
  assert.equal(cancellations, 1);
});

test("cancels discarded redirect, challenge, and invalid-header response bodies", async () => {
  let redirectCancellations = 0;
  await assert.rejects(TEST_ONLY_fetchPinnedBaseManifest({
    fetch: async () => trackedDiscardResponse(307, { location: "http://cdn.example.invalid/manifest" }, () => {
      redirectCancellations += 1;
    }),
  }), /seaweed_base_registry_redirect_invalid/u);
  assert.equal(redirectCancellations, 1);

  let challengeCancellations = 0;
  let challengeCall = 0;
  const challengeResult = await TEST_ONLY_fetchPinnedBaseManifest({
    fetch: async () => {
      challengeCall += 1;
      if (challengeCall === 1) {
        return trackedDiscardResponse(401, { "www-authenticate": challenge }, () => {
          challengeCancellations += 1;
        });
      }
      if (challengeCall === 2) return tokenResponse();
      return manifestResponse();
    },
  });
  assert.equal(challengeResult.digest, manifestDigest);
  assert.equal(challengeCancellations, 1);

  let invalidHeaderCancellations = 0;
  let invalidHeaderCall = 0;
  await assert.rejects(TEST_ONLY_fetchPinnedBaseManifest({
    fetch: async () => {
      invalidHeaderCall += 1;
      if (invalidHeaderCall === 1) return unauthorized();
      if (invalidHeaderCall === 2) return tokenResponse();
      return response(trackedBody([manifestBytes], () => {
        invalidHeaderCancellations += 1;
      }), 200, {
        "content-type": "application/vnd.oci.image.manifest.v1+json",
        "content-length": String(manifestBytes.length),
        "docker-content-digest": `sha256:${"0".repeat(64)}`,
      });
    },
  }), /seaweed_base_registry_digest_invalid/u);
  assert.equal(invalidHeaderCancellations, 1);
});

test("honors pre-abort and rejects accessor-bearing option objects without invoking them", async () => {
  const controller = new globalThis.AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(TEST_ONLY_fetchPinnedBaseManifest({ signal: controller.signal, fetch: async () => { calls += 1; } }),
    /seaweed_base_registry_aborted/u);
  assert.equal(calls, 0);
  const hostile = {};
  Object.defineProperty(hostile, "fetch", { enumerable: true, get() { calls += 1; throw new Error("getter"); } });
  assert.throws(() => TEST_ONLY_fetchPinnedBaseManifest(hostile), /seaweed_base_registry_options_invalid/u);
  assert.equal(calls, 0);
  const manifest = await authenticatedManifest();
  const sink = {};
  Object.defineProperty(sink, "write", { get() { calls += 1; throw new Error("getter"); } });
  assert.throws(() => TEST_ONLY_streamPinnedBaseBlob({ descriptor: manifest.config, sink, fetch: async () => undefined }),
    /seaweed_base_registry_sink_invalid/u);
  assert.equal(calls, 0);
});

test("reports registry and token rate limits with a bounded opaque error", async () => {
  const limited = response("sensitive upstream response", 429, { "content-type": "text/plain", "retry-after": "60" });
  await assert.rejects(TEST_ONLY_fetchPinnedBaseManifest({ fetch: async () => limited }), (error) => {
    assert.equal(error.code, "seaweed_base_registry_rate_limited");
    assert.equal(error.message, "seaweed_base_registry_rate_limited");
    assert.equal(JSON.stringify(error).includes("sensitive"), false);
    assert.equal(JSON.stringify(error).includes("auth.docker.io"), false);
    return true;
  });
  let call = 0;
  await assert.rejects(TEST_ONLY_fetchPinnedBaseManifest({ fetch: async () => ++call === 1 ? unauthorized() : limited }),
    /seaweed_base_registry_rate_limited/u);
});
