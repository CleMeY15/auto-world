import { SCANNER_RETENTION, sha256 } from "./retention-policy.mjs";

const METADATA_CAP = 1024 ** 2;
const REQUEST_TIMEOUT_MS = 15_000;
const OBJECT_ACCEPT = "application/vnd.github.object+json";
const RAW_ACCEPT = "application/vnd.github.raw+json";
const PREFIX = "scanner_retention_publish_source_blob_";
const REASONS = new Set(["dependencies_invalid", "item_invalid", "timeout", "request_failed",
  "response_invalid", "response_limit", "body_invalid", "body_failed", "metadata_invalid", "identity_invalid"]);

function failure(reason) { return new Error(`${PREFIX}${reason}`); }

function remainingTime(deadline, now) {
  const observed = now();
  if (!Number.isSafeInteger(observed) || !Number.isSafeInteger(deadline) || deadline <= observed) {
    throw failure("timeout");
  }
  return deadline - observed;
}

function safeFailure(error) {
  return error instanceof Error && REASONS.has(error.message.slice(PREFIX.length))
    && error.message.startsWith(PREFIX) ? error : failure("request_failed");
}

async function requestBytes({ endpoint, token, accept, cap, deadline, now, fetchImpl }) {
  const duration = Math.min(REQUEST_TIMEOUT_MS, remainingTime(deadline, now));
  const controller = new globalThis.AbortController();
  let timer; let response; let reader; let bytes; let closeFailure;
  const interrupted = new Promise((_resolve, reject) => {
    timer = globalThis.setTimeout(() => {
      controller.abort(); reject(failure("timeout"));
    }, duration);
  });
  const receive = async () => {
    response = await fetchImpl(endpoint, {
      method: "GET", redirect: "error", signal: controller.signal,
      headers: { Accept: accept, Authorization: `Bearer ${token}`,
        "User-Agent": "auto-world-scanner-retention-publisher", "X-GitHub-Api-Version": "2022-11-28" },
    });
    // A late transport response must not start a new read after the deadline.
    if (controller.signal.aborted) {
      try { Promise.resolve(response?.body?.cancel?.()).catch(() => {}); }
      catch { /* timeout remains authoritative */ }
      throw failure("timeout");
    }
    remainingTime(deadline, now);
    if (response?.status !== 200 || response.redirected !== false
      || (response.url && response.url !== endpoint) || typeof response.headers?.get !== "function") {
      throw failure("response_invalid");
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(contentLength)
      || !Number.isSafeInteger(Number(contentLength)) || Number(contentLength) > cap)) {
      throw failure("response_limit");
    }
    if (typeof response.body?.getReader !== "function") throw failure("body_invalid");
    reader = response.body.getReader();
    const chunks = []; let length = 0;
    while (true) {
      const item = await reader.read();
      remainingTime(deadline, now);
      if (controller.signal.aborted) throw failure("timeout");
      if (item?.done === true) break;
      if (item?.done !== false || !(item.value instanceof Uint8Array) || item.value.byteLength === 0) {
        throw failure("body_invalid");
      }
      if (item.value.byteLength > cap - length) throw failure("response_limit");
      chunks.push(Buffer.from(item.value)); length += item.value.byteLength;
    }
    return Buffer.concat(chunks, length);
  };
  try {
    bytes = await Promise.race([receive(), interrupted]);
  } catch (error) {
    controller.abort();
    try {
      const close = reader ? reader.cancel() : response?.body?.cancel?.();
      if (close !== undefined) await Promise.race([close, interrupted]);
    } catch { /* original refusal wins; cancellation is bounded by the same deadline */ }
    throw safeFailure(error);
  } finally {
    globalThis.clearTimeout(timer);
    try { reader?.releaseLock(); }
    catch { controller.abort(); closeFailure = failure("body_failed"); }
  }
  if (closeFailure) throw closeFailure;
  return bytes;
}

// Only the authenticated policy's literal records may select a request or cap.
export async function readScannerRetentionQualifiedBlob({ context, fetchImpl = globalThis.fetch,
  item, deadline, now = Date.now }) {
  if (typeof context?.token !== "string" || !/^[\x21-\x7e]{1,8192}$/u.test(context.token)
    || typeof fetchImpl !== "function" || typeof now !== "function" || !Number.isSafeInteger(deadline)) {
    throw failure("dependencies_invalid");
  }
  if (!SCANNER_RETENTION.qualification.staticQualifiedBlobs.includes(item)) throw failure("item_invalid");
  const endpoint = `https://api.github.com/repos/${SCANNER_RETENTION.repository}/contents/${item.sourcePath
    .split("/").map(encodeURIComponent).join("/")}?ref=${SCANNER_RETENTION.qualification.headSha}`;
  const options = { endpoint, token: context.token, deadline, now, fetchImpl };
  const metadataBytes = await requestBytes({ ...options, accept: OBJECT_ACCEPT, cap: METADATA_CAP });
  let metadata;
  try { metadata = JSON.parse(new globalThis.TextDecoder("utf-8", { fatal: true }).decode(metadataBytes)); }
  catch { throw failure("metadata_invalid"); }
  if (metadata?.type !== "file" || metadata.path !== item.sourcePath || metadata.size !== item.bytes
    || typeof metadata.sha !== "string" || !/^[a-f0-9]{40}$/u.test(metadata.sha)) {
    throw failure("metadata_invalid");
  }
  const bytes = await requestBytes({ ...options, accept: RAW_ACCEPT, cap: item.bytes });
  if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) throw failure("identity_invalid");
  return bytes;
}
