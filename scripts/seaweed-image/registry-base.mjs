import { createHash } from "node:crypto";

const REGISTRY_ORIGIN = "https://registry-1.docker.io";
const TOKEN_URL = "https://auth.docker.io/token";
const SERVICE = "registry.docker.io";
const REPOSITORY = "chrislusf/seaweedfs";
const SCOPE = `repository:${REPOSITORY}:pull`;
const MANIFEST_DIGEST = "sha256:f83509b0721dfd8e2e07faf76c0a899f67a8a889c89abe2fa0a5227ba1320362";
const MANIFEST_SIZE = 2_193;
const MANIFEST_MEDIA_TYPE = "application/vnd.oci.image.manifest.v1+json";
const MANIFEST_ACCEPT = [
  MANIFEST_MEDIA_TYPE,
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const MAX_TIMEOUT_MS = 30 * 60_000;
const MAX_TOKEN_BYTES = 64 * 1024;
const MAX_REDIRECTS = 5;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const authenticatedDescriptors = new WeakSet();

function registryError(code) {
  return Object.assign(new Error(code), { code, state: "INCOMPLETE", stage: "BASE_REGISTRY_READ" });
}

function fail(code) {
  throw registryError(`seaweed_base_registry_${code}`);
}

function dataProperties(input, allowed, code) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== "string" || !allowed.has(key) || !("value" in descriptors[key]))) fail(code);
  return (key) => descriptors[key]?.value;
}

function snapshotOptions(input, allowInjection) {
  const value = dataProperties(input, new Set(["signal", "timeoutMs", ...(allowInjection ? ["fetch", "now"] : [])]), "options_invalid");
  const signal = value("signal");
  const timeoutMs = value("timeoutMs") ?? DEFAULT_TIMEOUT_MS;
  const fetchImplementation = value("fetch") ?? globalThis.fetch;
  const now = value("now") ?? Date.now;
  if (signal !== undefined && !(signal instanceof globalThis.AbortSignal)) fail("options_invalid");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS ||
      typeof fetchImplementation !== "function" || typeof now !== "function") fail("options_invalid");
  return Object.freeze({ signal, timeoutMs, fetchImplementation, now });
}

function snapshotStreamOptions(input, allowInjection) {
  const value = dataProperties(input, new Set(["descriptor", "sink", "signal", "timeoutMs", ...(allowInjection ? ["fetch", "now"] : [])]), "options_invalid");
  const descriptor = value("descriptor");
  const sink = value("sink");
  if ((typeof descriptor !== "object" && typeof descriptor !== "function") || descriptor === null ||
      !authenticatedDescriptors.has(descriptor)) fail("descriptor_unauthenticated");
  if (sink === null || (typeof sink !== "object" && typeof sink !== "function")) fail("sink_invalid");
  let cursor = sink;
  let write;
  while (cursor !== null && write === undefined) {
    const property = Object.getOwnPropertyDescriptor(cursor, "write");
    if (property !== undefined) {
      if (!("value" in property) || typeof property.value !== "function") fail("sink_invalid");
      write = property.value;
    }
    cursor = Object.getPrototypeOf(cursor);
  }
  if (write === undefined) fail("sink_invalid");
  const common = snapshotOptions(Object.fromEntries([
    ["signal", value("signal")], ["timeoutMs", value("timeoutMs")],
    ...(allowInjection ? [["fetch", value("fetch")], ["now", value("now")]] : []),
  ].filter(([, item]) => item !== undefined)), allowInjection);
  return Object.freeze({ ...common, descriptor, sink, write });
}

function deadlineController(options) {
  if (options.signal?.aborted) fail("aborted");
  const controller = new globalThis.AbortController();
  const deadline = options.now() + options.timeoutMs;
  let timedOut = false;
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs);
  return Object.freeze({
    signal: controller.signal,
    deadline,
    check() {
      if (options.signal?.aborted) fail("aborted");
      if (timedOut || options.now() >= deadline) fail("timeout");
    },
    close() {
      globalThis.clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    },
  });
}

function safeUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail("redirect_invalid"); }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "") fail("redirect_invalid");
  return url;
}

async function cancelBody(response) {
  try { await response.body?.cancel(); } catch { /* failure remains the original bounded protocol error */ }
}

async function fetchManual({ fetchImplementation, url: initialUrl, headers, deadline, allowCrossOrigin }) {
  let url = safeUrl(initialUrl);
  const initialOrigin = url.origin;
  let leftInitialOrigin = false;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    deadline.check();
    const requestHeaders = new globalThis.Headers(headers);
    if (url.origin !== REGISTRY_ORIGIN) requestHeaders.delete("authorization");
    let response;
    try {
      response = await fetchImplementation(url, { method: "GET", headers: requestHeaders, redirect: "manual", signal: deadline.signal });
    } catch (error) {
      deadline.check();
      void error;
      fail("request_failed");
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    await cancelBody(response);
    if (redirect === MAX_REDIRECTS) fail("redirect_limit_exceeded");
    const location = response.headers.get("location");
    if (location === null) fail("redirect_invalid");
    const next = safeUrl(new URL(location, url).href);
    if (next.origin !== initialOrigin) {
      if (!allowCrossOrigin || leftInitialOrigin) fail("redirect_invalid");
      leftInitialOrigin = true;
    } else if (leftInitialOrigin) {
      fail("redirect_invalid");
    }
    url = next;
  }
  fail("redirect_limit_exceeded");
}

async function readBounded(response, maximum, deadline, code) {
  if (response.body === null) fail(code);
  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of response.body) {
      deadline.check();
      if (!(chunk instanceof Uint8Array) || size + chunk.byteLength > maximum) fail(code);
      chunks.push(Buffer.from(chunk));
      size += chunk.byteLength;
    }
  } catch (error) {
    await cancelBody(response);
    if (error?.code?.startsWith("seaweed_base_registry_")) throw error;
    deadline.check();
    fail("stream_failed");
  }
  deadline.check();
  return Buffer.concat(chunks, size);
}

function parseChallenge(value) {
  if (typeof value !== "string" || !/^Bearer\s/iu.test(value)) fail("challenge_invalid");
  const parameters = new Map();
  const tail = value.replace(/^Bearer\s+/iu, "");
  const matcher = /([A-Za-z][A-Za-z0-9_-]*)="([^"\r\n]*)"(?:\s*,\s*|$)/gyu;
  let offset = 0;
  while (offset < tail.length) {
    matcher.lastIndex = offset;
    const match = matcher.exec(tail);
    if (match === null || parameters.has(match[1].toLowerCase())) fail("challenge_invalid");
    parameters.set(match[1].toLowerCase(), match[2]);
    offset = matcher.lastIndex;
  }
  if (parameters.size !== 3 || parameters.get("realm") !== TOKEN_URL || parameters.get("service") !== SERVICE ||
      parameters.get("scope") !== SCOPE) fail("challenge_invalid");
}

async function bearerToken(options, resourceUrl, accept, deadline) {
  const challenge = await fetchManual({
    fetchImplementation: options.fetchImplementation,
    url: resourceUrl,
    headers: { accept },
    deadline,
    allowCrossOrigin: false,
  });
  if (challenge.status === 429) {
    await cancelBody(challenge);
    fail("rate_limited");
  }
  if (challenge.status !== 401) {
    await cancelBody(challenge);
    fail("challenge_invalid");
  }
  try { parseChallenge(challenge.headers.get("www-authenticate")); } finally { await cancelBody(challenge); }
  const tokenUrl = new URL(TOKEN_URL);
  tokenUrl.searchParams.set("service", SERVICE);
  tokenUrl.searchParams.set("scope", SCOPE);
  tokenUrl.searchParams.set("client_id", "auto-world-seaweed-base-reader");
  const response = await fetchManual({
    fetchImplementation: options.fetchImplementation,
    url: tokenUrl.href,
    headers: { accept: "application/json" },
    deadline,
    allowCrossOrigin: false,
  });
  if (response.status === 429) {
    await cancelBody(response);
    fail("rate_limited");
  }
  if (response.status !== 200 || !/^application\/json(?:;|$)/iu.test(response.headers.get("content-type") ?? "")) {
    await cancelBody(response);
    fail("token_invalid");
  }
  const bytes = await readBounded(response, MAX_TOKEN_BYTES, deadline, "token_invalid");
  let parsed;
  try { parsed = JSON.parse(bytes.toString("utf8")); } catch { fail("token_invalid"); }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) fail("token_invalid");
  const token = typeof parsed.token === "string" ? parsed.token : parsed.access_token;
  if (typeof token !== "string" || token.length < 1 || token.length > 32 * 1024 || !/^[\x21-\x7e]+$/u.test(token) ||
      (parsed.token !== undefined && parsed.access_token !== undefined && parsed.token !== parsed.access_token)) fail("token_invalid");
  return token;
}

async function authenticatedResponse(options, resourceUrl, accept, deadline, allowCrossOrigin) {
  const token = await bearerToken(options, resourceUrl, accept, deadline);
  const response = await fetchManual({
    fetchImplementation: options.fetchImplementation,
    url: resourceUrl,
    headers: { accept, authorization: `Bearer ${token}` },
    deadline,
    allowCrossOrigin,
  });
  if (response.status === 429) {
    await cancelBody(response);
    fail("rate_limited");
  }
  if (response.status !== 200) {
    await cancelBody(response);
    fail("response_invalid");
  }
  return response;
}

function checkContentLength(response, expected) {
  const value = response.headers.get("content-length");
  if (value !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(value) || Number(value) !== expected)) fail("size_invalid");
}

function checkDigestHeader(response, expected) {
  const value = response.headers.get("docker-content-digest");
  if (value !== null && value !== expected) fail("digest_invalid");
}

function snapshotDescriptor(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("manifest_invalid");
  const keys = Object.keys(value).sort();
  if (keys.join("\0") !== ["digest", "mediaType", "size"].sort().join("\0") ||
      typeof value.mediaType !== "string" || !DIGEST.test(value.digest) || !Number.isSafeInteger(value.size) || value.size < 1) fail("manifest_invalid");
  const descriptor = Object.freeze({ mediaType: value.mediaType, digest: value.digest, size: value.size });
  authenticatedDescriptors.add(descriptor);
  return descriptor;
}

async function fetchManifest(options) {
  const deadline = deadlineController(options);
  try {
    const url = `${REGISTRY_ORIGIN}/v2/${REPOSITORY}/manifests/${MANIFEST_DIGEST}`;
    const response = await authenticatedResponse(options, url, MANIFEST_ACCEPT, deadline, false);
    try {
      if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== MANIFEST_MEDIA_TYPE) fail("manifest_media_type_invalid");
      checkContentLength(response, MANIFEST_SIZE);
      checkDigestHeader(response, MANIFEST_DIGEST);
    } catch (error) {
      await cancelBody(response);
      throw error;
    }
    const bytes = await readBounded(response, MANIFEST_SIZE, deadline, "manifest_size_invalid");
    if (bytes.length !== MANIFEST_SIZE || `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== MANIFEST_DIGEST) fail("manifest_identity_invalid");
    let parsed;
    try { parsed = JSON.parse(bytes.toString("utf8")); } catch { fail("manifest_invalid"); }
    if (parsed?.schemaVersion !== 2 || parsed.mediaType !== MANIFEST_MEDIA_TYPE || !Array.isArray(parsed.layers) || parsed.layers.length !== 10) fail("manifest_invalid");
    const config = snapshotDescriptor(parsed.config);
    const layers = Object.freeze(parsed.layers.map(snapshotDescriptor));
    return Object.freeze({ bytes: Buffer.from(bytes), digest: MANIFEST_DIGEST, mediaType: MANIFEST_MEDIA_TYPE, config, layers });
  } finally {
    deadline.close();
  }
}

async function writeChunk(options, chunk) {
  let offset = 0;
  while (offset < chunk.byteLength) {
    let result;
    try { result = await options.write.call(options.sink, chunk, offset, chunk.byteLength - offset, null); } catch { fail("sink_write_failed"); }
    if (!Number.isSafeInteger(result?.bytesWritten) || result.bytesWritten < 1 || result.bytesWritten > chunk.byteLength - offset) fail("sink_write_failed");
    offset += result.bytesWritten;
  }
}

async function streamBlob(options) {
  const deadline = deadlineController(options);
  try {
    const { descriptor } = options;
    const url = `${REGISTRY_ORIGIN}/v2/${REPOSITORY}/blobs/${descriptor.digest}`;
    const response = await authenticatedResponse(options, url, "application/octet-stream", deadline, true);
    try {
      checkContentLength(response, descriptor.size);
      checkDigestHeader(response, descriptor.digest);
    } catch (error) {
      await cancelBody(response);
      throw error;
    }
    if (response.body === null) fail("stream_failed");
    const hash = createHash("sha256");
    let size = 0;
    try {
      for await (const value of response.body) {
        deadline.check();
        if (!(value instanceof Uint8Array) || value.byteLength < 1 || size + value.byteLength > descriptor.size) fail("size_invalid");
        const chunk = Buffer.from(value);
        await writeChunk(options, chunk);
        hash.update(chunk);
        size += chunk.byteLength;
      }
    } catch (error) {
      await cancelBody(response);
      if (error?.code?.startsWith("seaweed_base_registry_")) throw error;
      deadline.check();
      fail("stream_failed");
    }
    deadline.check();
    if (size !== descriptor.size) fail("size_invalid");
    if (`sha256:${hash.digest("hex")}` !== descriptor.digest) fail("digest_invalid");
    return Object.freeze({ size, digest: descriptor.digest, mediaType: descriptor.mediaType,
      authority: "PINNED_BASE_ONLY", candidateAuthorization: "NOT_AUTHORIZED" });
  } finally {
    deadline.close();
  }
}

export function fetchPinnedBaseManifest(options = {}) {
  return fetchManifest(snapshotOptions(options, false));
}

export function TEST_ONLY_fetchPinnedBaseManifest(options = {}) {
  return fetchManifest(snapshotOptions(options, true));
}

export function streamPinnedBaseBlob(options) {
  return streamBlob(snapshotStreamOptions(options, false));
}

export function TEST_ONLY_streamPinnedBaseBlob(options) {
  return streamBlob(snapshotStreamOptions(options, true));
}
