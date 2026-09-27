import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_LOCATIONS = 1;
const REQUEST_TIMEOUT_MS = 5_000;
const POLL_INTERVAL_MS = 1_000;
const FID = /^([1-9][0-9]{0,9}),((?:[0-9a-f]{2}){5,12})$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const OBJECT_PATH = /^\/buckets\/[a-z0-9][a-z0-9-]{0,62}\/[a-z0-9][a-z0-9-]{0,127}$/u;
const LOOPBACK_LOCATION = "127.0.0.1:8080";
const TRANSIENT_CURL_EXIT_CODES = new Set([5, 6, 7, 28, 35, 52, 56]);

export const PERSISTED_DATA_READINESS_PROTOCOL = Object.freeze({
  kind: "SEAWEED_PERSISTED_DATA_READINESS_PROTOCOL",
  version: 1,
  metadata: "EXACT_SINGLE_CHUNK_FID_AND_SIZE",
  lookup: "EXACT_VOLUME_ID_SINGLE_LOOPBACK_LOCATION",
  directRead: "FIXED_LOOPBACK_HTTP_200_SIZE_SHA256",
  maxResponseBytes: MAX_RESPONSE_BYTES,
  maxChunks: 1,
  maxLocations: MAX_LOCATIONS,
  expectedLocation: LOOPBACK_LOCATION,
  finalReadReserveMs: 12_000,
});
export const PERSISTED_DATA_READINESS_PROTOCOL_SHA256 = createHash("sha256")
  .update(JSON.stringify(PERSISTED_DATA_READINESS_PROTOCOL)).digest("hex");

export class PersistedDataReadinessError extends Error {
  constructor(reason) {
    super("persisted_data_readiness_failed");
    this.name = "PersistedDataReadinessError";
    this.reason = reason;
  }
}

export function classifyPersistedDataReadinessFailure(error) {
  const reason = error instanceof PersistedDataReadinessError ? error.reason : undefined;
  if (reason === "IDENTITY_CHANGED") return "PERSISTED_IDENTITY_CHANGED";
  if (["METADATA_OVERSIZED", "METADATA_MALFORMED", "METADATA_INVALID",
    "METADATA_STATUS_INVALID"].includes(reason)) return "PERSISTED_METADATA_INVALID";
  if (["LOOKUP_OVERSIZED", "LOOKUP_MALFORMED", "LOOKUP_INVALID", "LOOKUP_LOCATION_MISMATCH",
    "LOOKUP_STATUS_INVALID"].includes(reason)) return "PERSISTED_REGISTRATION_INVALID";
  if (reason === "DIRECT_DATA_MISMATCH") return "PERSISTED_DIRECT_READ_MISMATCH";
  if (reason === "DEADLINE_EXHAUSTED") return "PERSISTED_DATA_NOT_READY";
  return undefined;
}

function fail(reason) { throw new PersistedDataReadinessError(reason); }

function boundedJson(body, kind, reviver) {
  if (typeof body !== "string" || Buffer.byteLength(body) > MAX_RESPONSE_BYTES) fail(`${kind}_OVERSIZED`);
  try { return JSON.parse(body, reviver); } catch { fail(`${kind}_MALFORMED`); }
}

function integerNumber(value, maximum = Number.MAX_SAFE_INTEGER) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum
    ? value : undefined;
}

function parseFid(value) {
  const matched = typeof value === "string" ? FID.exec(value) : null;
  if (matched === null || !/^[1-9][0-9]{0,9}$/u.test(matched[1])) return undefined;
  const volumeId = Number(matched[1]);
  return Number.isSafeInteger(volumeId) && volumeId <= 0xffffffff && String(volumeId) === matched[1]
    ? { volumeId, suffix: matched[2] } : undefined;
}

export function parsePersistedObjectMetadata(body, expectedSize) {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > MAX_RESPONSE_BYTES) {
    fail("METADATA_EXPECTATION_INVALID");
  }
  const rawFileKeys = new WeakMap();
  const entry = boundedJson(body, "METADATA", function fileKeyReviver(key, value, context) {
    if (key === "file_key") {
      if (typeof value !== "number" || !/^(?:0|[1-9][0-9]{0,19})$/u.test(context?.source ?? "")) {
        fail("METADATA_INVALID");
      }
      rawFileKeys.set(this, context.source);
    }
    return value;
  });
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)
    || entry.Content !== null || !Array.isArray(entry.chunks) || entry.chunks.length !== 1) {
    fail("METADATA_INVALID");
  }
  const chunk = entry.chunks[0];
  if (chunk === null || typeof chunk !== "object" || Array.isArray(chunk)
    || chunk.fid === null || typeof chunk.fid !== "object" || Array.isArray(chunk.fid)) {
    fail("METADATA_INVALID");
  }
  const parsedFid = parseFid(chunk.file_id);
  const volumeId = parsedFid?.volumeId;
  const chunkSize = integerNumber(chunk.size);
  const fileSize = integerNumber(entry.FileSize);
  const structuredVolumeId = integerNumber(chunk.fid.volume_id, 0xffffffff);
  const fileKeySource = chunk?.fid !== null && typeof chunk?.fid === "object"
    ? rawFileKeys.get(chunk.fid) : undefined;
  let fileKey;
  try { fileKey = fileKeySource === undefined ? undefined : BigInt(fileKeySource); } catch { fileKey = undefined; }
  const cookie = chunk.fid.cookie === undefined ? 0 : integerNumber(chunk.fid.cookie, 0xffffffff);
  const canonicalFileId = volumeId === undefined || fileKey === undefined || fileKey < 1n
    || fileKey > 0xffffffffffffffffn || cookie === undefined ? undefined
    : `${volumeId},${fileKey.toString(16).padStart(fileKey.toString(16).length + fileKey.toString(16).length % 2,
      "0")}${cookie.toString(16).padStart(8, "0")}`;
  if (volumeId === undefined || chunkSize !== expectedSize || fileSize !== expectedSize
    || chunk.offset !== undefined && integerNumber(chunk.offset) !== 0
    || chunk.is_chunk_manifest !== undefined && chunk.is_chunk_manifest !== false
    || structuredVolumeId !== volumeId || canonicalFileId !== chunk.file_id) fail("METADATA_INVALID");
  return Object.freeze({ fid: chunk.file_id, volumeId: String(volumeId), size: expectedSize });
}

export function parsePersistedVolumeLookup(body, expectedVolumeId) {
  if (typeof expectedVolumeId !== "string" || !/^[1-9][0-9]{0,9}$/u.test(expectedVolumeId)
    || Number(expectedVolumeId) > 0xffffffff || String(Number(expectedVolumeId)) !== expectedVolumeId) {
    fail("LOOKUP_EXPECTATION_INVALID");
  }
  const lookup = boundedJson(body, "LOOKUP");
  if (lookup === null || typeof lookup !== "object" || Array.isArray(lookup)
    || lookup.error !== undefined && lookup.error !== ""
    || typeof lookup.volumeOrFileId !== "string" || lookup.volumeOrFileId !== expectedVolumeId
    || !Array.isArray(lookup.locations) || lookup.locations.length !== 1
    || lookup.locations.length > MAX_LOCATIONS) fail("LOOKUP_INVALID");
  for (const location of lookup.locations) {
    if (location === null || typeof location !== "object" || Array.isArray(location)
      || location.url !== LOOPBACK_LOCATION || location.publicUrl !== LOOPBACK_LOCATION) {
      fail("LOOKUP_LOCATION_MISMATCH");
    }
  }
  return true;
}

function responseScript(kind, url, direct = false) {
  const fields = direct
    ? `bytes=$(wc -c < "$work/body") || exit 1
if test "$bytes" -gt ${MAX_RESPONSE_BYTES}; then printf '%s\\n' 'AW_OVERSIZED_V1'; exit 0; fi
digest=$(sha256sum "$work/body" | cut -d ' ' -f 1) || exit 1
printf '%s\\n%s\\n%s\\n%s\\n%s\\n' 'AW_DIRECT_V1' "$curl_rc" "$status" "$bytes" "$digest"`
    : `bytes=$(wc -c < "$work/body") || exit 1
if test "$bytes" -gt ${MAX_RESPONSE_BYTES}; then printf '%s\\n' 'AW_OVERSIZED_V1'; exit 0; fi
printf '%s\\n%s\\n%s\\n' 'AW_${kind}_V1' "$curl_rc" "$status"
cat "$work/body"`;
  return `set -eu
command -v curl >/dev/null 2>&1 && command -v mktemp >/dev/null 2>&1 || exit 1
${direct ? "command -v sha256sum >/dev/null 2>&1 || exit 1\n" : ""}work=$(mktemp -d /tmp/aw-data-readiness.XXXXXXXX) || exit 1
trap 'rm -f "$work/body"; rmdir "$work"' EXIT
: > "$work/body"
status=''; curl_rc=0
status=$(curl --silent --output "$work/body" --write-out '%{http_code}' --connect-timeout 1 --max-time 2 \
  --proto '=http' --max-redirs 0 --max-filesize ${MAX_RESPONSE_BYTES} '${url}' 2>/dev/null) || curl_rc=$?
${fields}`;
}

function metadataScript(objectPath) {
  return responseScript("METADATA", `http://127.0.0.1:8888${objectPath}?metadata=true`);
}

function lookupScript(volumeId) {
  return responseScript("LOOKUP", `http://127.0.0.1:9333/dir/lookup?volumeId=${volumeId}&read=yes`);
}

function directScript(fid) {
  return responseScript("DIRECT", `http://127.0.0.1:8080/${fid}`, true);
}

function parseResponse(stdout, kind) {
  if (stdout === "AW_OVERSIZED_V1\n") fail(`${kind}_OVERSIZED`);
  const prefix = `AW_${kind}_V1\n`;
  if (typeof stdout !== "string" || !stdout.startsWith(prefix)) fail(`${kind}_PROBE_INVALID`);
  const afterPrefix = stdout.slice(prefix.length);
  const first = afterPrefix.indexOf("\n"); const second = afterPrefix.indexOf("\n", first + 1);
  if (first < 1 || second < first + 2) fail(`${kind}_PROBE_INVALID`);
  const curlRc = afterPrefix.slice(0, first); const status = afterPrefix.slice(first + 1, second);
  if (!/^[0-9]{1,3}$/u.test(curlRc) || !/^[0-9]{3}$/u.test(status)) fail(`${kind}_PROBE_INVALID`);
  return { curlRc: Number(curlRc), status: Number(status), body: afterPrefix.slice(second + 1) };
}

function parseDirectResponse(stdout, expectedSize, expectedSha256) {
  if (stdout === "AW_OVERSIZED_V1\n") fail("DIRECT_OVERSIZED");
  const matched = /^AW_DIRECT_V1\n([0-9]{1,3})\n([0-9]{3})\n([0-9]{1,18})\n([0-9a-f]{64})\n$/u.exec(stdout);
  if (matched === null) fail("DIRECT_PROBE_INVALID");
  return { curlRc: Number(matched[1]), status: Number(matched[2]),
    matches: Number(matched[3]) === expectedSize && matched[4] === expectedSha256 };
}

function requestOptions(options, deadline, reserveMs, now) {
  const remaining = Math.floor(deadline - now() - reserveMs);
  if (remaining < 1) fail("DEADLINE_EXHAUSTED");
  return { ...options, timeoutMs: Math.min(remaining, REQUEST_TIMEOUT_MS) };
}

async function pause(wait, signal, milliseconds) {
  if (signal?.aborted) fail("ABORTED");
  await wait(milliseconds, signal);
  if (signal?.aborted) fail("ABORTED");
}

function defaultWait(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = globalThis.setTimeout(finish, milliseconds);
    const abort = () => { globalThis.clearTimeout(timer); reject(new PersistedDataReadinessError("ABORTED")); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function validateTransaction(input) {
  if (typeof input?.runCommand !== "function" || typeof input.containerName !== "string"
    || !/^[a-z0-9][a-z0-9-]{0,127}$/u.test(input.containerName) || typeof input.deadline !== "number"
    || !Number.isFinite(input.deadline) || !OBJECT_PATH.test(input.objectPath)
    || !Number.isSafeInteger(input.expectedSize) || input.expectedSize < 1
    || input.expectedSize > MAX_RESPONSE_BYTES) fail("INPUT_INVALID");
}

async function runProbe(input, script, reserveMs) {
  const result = await input.runCommand(["container", "exec", input.containerName, "/bin/sh", "-c", script],
    requestOptions(input.options, input.deadline, reserveMs, input.now), [0]);
  if (result.stderr.trim() !== "") fail("PROBE_INVALID");
  return result.stdout;
}

async function poll(input, operation, reserveMs) {
  while (true) {
    const outcome = await operation();
    if (outcome.done) return outcome.value;
    const remaining = Math.floor(input.deadline - input.now() - reserveMs);
    if (remaining < 1) fail("DEADLINE_EXHAUSTED");
    await pause(input.wait, input.options.signal, Math.min(POLL_INTERVAL_MS, remaining));
  }
}

function transient(response) {
  if (response.curlRc === 0) return false;
  if (response.status === 0 && TRANSIENT_CURL_EXIT_CODES.has(response.curlRc)) return true;
  fail("TRANSPORT_INVALID");
}

function sharedInput(input) {
  validateTransaction(input);
  return { ...input, now: input.now ?? performance.now.bind(performance), wait: input.wait ?? defaultWait };
}

export async function capturePersistedDataIdentity(input) {
  const actual = sharedInput(input);
  return poll(actual, async () => {
    const response = parseResponse(await runProbe(actual, metadataScript(actual.objectPath), 0), "METADATA");
    if (transient(response) || response.status === 404
      || response.status >= 500 && response.status <= 599) return { done: false };
    if (response.status !== 200) fail("METADATA_STATUS_INVALID");
    return { done: true, value: parsePersistedObjectMetadata(response.body, actual.expectedSize) };
  }, 0);
}

export async function verifyPersistedDataReadiness(input) {
  const actual = sharedInput(input);
  const identityFid = parseFid(input.identity?.fid);
  if (input.identity === null || typeof input.identity !== "object" || identityFid === undefined
    || typeof input.identity.volumeId !== "string" || String(identityFid.volumeId) !== input.identity.volumeId
    || input.identity.size !== input.expectedSize
    || !SHA256.test(input.expectedSha256)) fail("INPUT_INVALID");
  await poll(actual, async () => {
    const response = parseResponse(await runProbe(actual, metadataScript(actual.objectPath),
      PERSISTED_DATA_READINESS_PROTOCOL.finalReadReserveMs), "METADATA");
    if (transient(response) || response.status === 404
      || response.status >= 500 && response.status <= 599) return { done: false };
    if (response.status !== 200) fail("METADATA_STATUS_INVALID");
    const observed = parsePersistedObjectMetadata(response.body, actual.expectedSize);
    if (observed.fid !== input.identity.fid || observed.volumeId !== input.identity.volumeId
      || observed.size !== input.identity.size) fail("IDENTITY_CHANGED");
    return { done: true };
  }, PERSISTED_DATA_READINESS_PROTOCOL.finalReadReserveMs);
  await poll(actual, async () => {
    const response = parseResponse(await runProbe(actual, lookupScript(input.identity.volumeId),
      PERSISTED_DATA_READINESS_PROTOCOL.finalReadReserveMs), "LOOKUP");
    if (transient(response) || response.status === 404
      || response.status >= 500 && response.status <= 599) return { done: false };
    if (response.status !== 200) fail("LOOKUP_STATUS_INVALID");
    parsePersistedVolumeLookup(response.body, input.identity.volumeId);
    return { done: true };
  }, PERSISTED_DATA_READINESS_PROTOCOL.finalReadReserveMs);
  await poll(actual, async () => {
    const response = parseDirectResponse(await runProbe(actual, directScript(input.identity.fid),
      PERSISTED_DATA_READINESS_PROTOCOL.finalReadReserveMs), actual.expectedSize, actual.expectedSha256);
    if (transient(response) || response.status === 404 || response.status >= 500) return { done: false };
    if (response.status !== 200) fail("DIRECT_STATUS_INVALID");
    if (!response.matches) fail("DIRECT_DATA_MISMATCH");
    return { done: true };
  }, PERSISTED_DATA_READINESS_PROTOCOL.finalReadReserveMs);
}

export function remainingReadinessBudget(deadline, reserveMs = 0, now = performance.now.bind(performance)) {
  const remaining = Math.floor(deadline - now() - reserveMs);
  if (!Number.isFinite(remaining) || remaining < 1) fail("DEADLINE_EXHAUSTED");
  return remaining;
}

export function TEST_ONLY_persistedDataReadinessScripts(objectPath, fid) {
  if (!OBJECT_PATH.test(objectPath) || !FID.test(fid)) fail("INPUT_INVALID");
  return Object.freeze([metadataScript(objectPath), lookupScript(FID.exec(fid)[1]), directScript(fid)]);
}
