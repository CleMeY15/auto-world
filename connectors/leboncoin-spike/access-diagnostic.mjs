import { constants, createCipheriv, createHash, createPublicKey, publicEncrypt, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

export const ACCESS_TARGET_URL = "https://www.leboncoin.fr/ad/voitures/3305814470";
export const KEY_FINGERPRINT = "e0055ec14db6da8090b3a6f0764cb147bbf116bda87cd7d0eb709d8fdaa4d999";
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_ENVELOPE_BYTES = 192 * 1024;
export const FRAGMENT_PREFIX = "AUTO_FINDEX_SEALED ";
const PRIVATE_SCHEMA = "leboncoin-access-capture/v1";
const ENVELOPE_SCHEMA = "leboncoin-access-envelope/v1";
const MAX_PRIVATE_BYTES = 128 * 1024;
const FRAGMENT_SIZE = 3000;
const MAX_FRAGMENTS = 96;
const RESPONSE_HEADERS = ["content-type", "content-length", "content-encoding", "cache-control", "server", "via", "retry-after", "x-cache", "vary"];
const REQUEST_HEADERS = ["user-agent", "accept", "accept-language", "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site", "sec-fetch-user", "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform"];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identifier = (value) => typeof value === "string" && value.trim() === value && /^[A-Za-z0-9._-]{1,128}$/u.test(value);
const hexadecimal = (value, length) => typeof value === "string" && value.length === length && /^[a-f0-9]+$/u.test(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 10_000 ? value : null;
const statusCode = (value) => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;

export function validateDiagnosticPublicKey(pem, expectedFingerprint = KEY_FINGERPRINT) {
  try {
    if (typeof pem !== "string" || Buffer.byteLength(pem) > 8192
      || !/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/u.test(pem)
      || !hexadecimal(expectedFingerprint, 64)) throw new Error();
    const key = createPublicKey(pem);
    const fingerprint = hash(key.export({ type: "spki", format: "der" }));
    if (key.type !== "public" || key.asymmetricKeyType !== "rsa" || key.asymmetricKeyDetails?.modulusLength !== 3072
      || fingerprint !== expectedFingerprint) throw new Error();
    return { key, fingerprint };
  } catch { throw new Error("public_key_invalid"); }
}

export async function loadDiagnosticPublicKey() {
  const pem = await readFile(new URL("./access-diagnostic-public.pem", import.meta.url), "utf8");
  return validateDiagnosticPublicKey(pem);
}

export function diagnosticIdentity(env, captureId = randomBytes(16).toString("hex")) {
  if (!hexadecimal(env?.GITHUB_SHA, 40) || typeof env?.GITHUB_RUN_ID !== "string"
    || env.GITHUB_RUN_ID.trim() !== env.GITHUB_RUN_ID || !/^[1-9][0-9]{0,19}$/u.test(env.GITHUB_RUN_ID) || env.GITHUB_RUN_ATTEMPT !== "1"
    || !hexadecimal(captureId, 32)) throw new Error("diagnostic_identity_invalid");
  return { schema_version: PRIVATE_SCHEMA, commit_sha: env.GITHUB_SHA, github_run_id: env.GITHUB_RUN_ID,
    github_run_attempt: 1, capture_id: captureId, target_url_sha256: hash(ACCESS_TARGET_URL) };
}

/** Selection happens before persistence. Cookie/auth/location and arbitrary headers are excluded. */
export function selectDiagnosticHeaders(input, kind = "response") {
  const allowed = kind === "request" ? REQUEST_HEADERS : RESPONSE_HEADERS;
  const selected = {};
  let limited = false;
  const entries = input && typeof input === "object" ? Object.entries(input) : [];
  for (const [name, value] of entries.slice(0, 128)) {
    const key = name.toLowerCase();
    if (!allowed.includes(key)) continue;
    if (typeof value !== "string" || Buffer.byteLength(value) > 1024 || selected[key] !== undefined) { limited = true; continue; }
    const candidate = { ...selected, [key]: value };
    if (Buffer.byteLength(JSON.stringify(candidate)) > 4096) { limited = true; continue; }
    selected[key] = value;
  }
  return { values: selected, limited: limited || entries.length > 128 };
}

function withTimeout(promise, milliseconds) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("diagnostic_timeout")), Math.max(1, milliseconds));
  })]).finally(() => globalThis.clearTimeout(timer));
}

/** Passive event accumulator; it never navigates, fetches or follows a response URL. */
export function trackAccessDocument({ url, frameId }) {
  if (url !== ACCESS_TARGET_URL || !identifier(frameId)) throw new Error("diagnostic_identity_invalid");
  let primary = null;
  let ambiguous = false;
  let read = false;
  let terminal;
  const settled = new Promise((resolve) => { terminal = resolve; });
  const counters = { document_requests_observed: 0, main_document_requests_observed: 0, iframe_document_requests_observed: 0,
    redirects_observed: 0 };
  const increment = (key) => {
    counters[key] += 1;
    if (counters[key] > 10_000) { counters[key] = 10_000; ambiguous = true; terminal(); }
  };
  const rejectIdentity = () => { ambiguous = true; terminal(); };
  const request = (event) => {
    if (event?.type !== "Document") return;
    increment("document_requests_observed");
    if (event.frameId !== frameId) {
      increment("iframe_document_requests_observed");
      if (primary && event.requestId === primary.request_id) rejectIdentity();
      return;
    }
    increment("main_document_requests_observed");
    if (event.redirectResponse) { increment("redirects_observed"); rejectIdentity(); }
    if (primary || event.request?.url !== url || event.request?.method !== "GET"
      || !identifier(event.requestId) || !identifier(event.loaderId)) { rejectIdentity(); return; }
    primary = { request_id: event.requestId, loader_id: event.loaderId, frame_id: frameId,
      request_headers: selectDiagnosticHeaders(event.request.headers, "request"), response: null,
      finished: false, failed: false };
  };
  const response = (event) => {
    if (!primary || event?.requestId !== primary.request_id) return;
    if (event.type !== "Document" || event.frameId !== frameId || event.loaderId !== primary.loader_id
      || event.response?.url !== url || statusCode(event.response?.status) === null || primary.response) {
      rejectIdentity(); return;
    }
    primary.response = { status: event.response.status, headers: selectDiagnosticHeaders(event.response.headers),
      mime_type: ["text/html", "text/plain", "application/json"].includes(event.response.mimeType) ? event.response.mimeType : "other" };
  };
  const finished = (event) => {
    if (primary && event?.requestId === primary.request_id) { primary.finished = true; terminal(); }
  };
  const failed = (event) => {
    if (primary && event?.requestId === primary.request_id) { primary.failed = true; terminal(); }
  };
  const identity = () => ambiguous ? "ambiguous" : primary?.response ? "matched" : "missing";
  return { request, response, finished, failed,
    counts: () => ({ ...counters }),
    finalize(capture) {
      return { ...capture, identity_status: identity(), counts: { ...counters },
        ...(ambiguous ? { document: null, body: { status: "identity_rejected", representation: null, bytes: null, sha256: null, base64: null } } : {}) };
    },
    async capture(session, timeoutMs = 1500) {
      if (read) throw new Error("diagnostic_read_already_attempted");
      read = true;
      let bodyStatus = "unavailable";
      let bytes = null;
      let representation = null;
      const expiresAt = Date.now() + Math.min(1500, Math.max(1, timeoutMs));
      const remaining = () => Math.max(1, expiresAt - Date.now());
      try {
        if (primary && !ambiguous && !primary.finished && !primary.failed) await withTimeout(settled, remaining());
        if (ambiguous) bodyStatus = "identity_rejected";
        else if (!primary?.response) bodyStatus = "no_response";
        else if (primary.failed || !primary.finished) bodyStatus = "loading_failed";
        else {
          const body = await withTimeout(session.send("Network.getResponseBody", { requestId: primary.request_id }), remaining());
          if (ambiguous) bodyStatus = "identity_rejected";
          else if (typeof body?.body !== "string" || typeof body.base64Encoded !== "boolean") bodyStatus = "unavailable";
          else if (body.base64Encoded) {
            if (body.body.length > 4 * Math.ceil(MAX_BODY_BYTES / 3)) bodyStatus = "limit_exceeded";
            else if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(body.body)) bodyStatus = "unavailable";
            else {
              bytes = Buffer.from(body.body, "base64");
              if (bytes.toString("base64") !== body.body) { bytes = null; bodyStatus = "unavailable"; }
              else representation = "cdp_base64";
            }
          } else if (Buffer.byteLength(body.body, "utf8") > MAX_BODY_BYTES) bodyStatus = "limit_exceeded";
          else { bytes = Buffer.from(body.body, "utf8"); representation = "cdp_text_utf8"; }
          if (bytes && bytes.length > MAX_BODY_BYTES) { bytes = null; representation = null; bodyStatus = "limit_exceeded"; }
          if (bytes) bodyStatus = "captured";
        }
      } catch (error) {
        bodyStatus = error?.message === "diagnostic_timeout" ? "timeout"
          : /evicted/iu.test(String(error?.message)) ? "evicted" : "unavailable";
      }
      if (ambiguous) { bodyStatus = "identity_rejected"; bytes = null; representation = null; }
      return { identity_status: identity(), counts: { ...counters },
        document: ambiguous || !primary ? null : { request_id: primary.request_id, loader_id: primary.loader_id, frame_id: primary.frame_id,
          request_headers: primary.request_headers, response: primary.response },
        body: { status: bodyStatus, representation, bytes: bytes?.length ?? null, sha256: bytes ? hash(bytes) : null,
          base64: bytes ? bytes.toString("base64") : null } };
    },
  };
}

export async function installAccessObserver(context, page) {
  const session = await context.newCDPSession(page);
  const { frameTree } = await session.send("Page.getFrameTree");
  const tracker = trackAccessDocument({ url: ACCESS_TARGET_URL, frameId: frameTree?.frame?.id });
  session.on("Network.requestWillBeSent", tracker.request);
  session.on("Network.responseReceived", tracker.response);
  session.on("Network.loadingFinished", tracker.finished);
  session.on("Network.loadingFailed", tracker.failed);
  await session.send("Network.enable", { maxResourceBufferSize: MAX_BODY_BYTES, maxTotalBufferSize: 2 * MAX_BODY_BYTES, maxPostDataSize: 0 });
  return { capture: (timeoutMs) => tracker.capture(session, timeoutMs), counts: tracker.counts, finalize: tracker.finalize };
}

export function summarizeAccessCapture(record) {
  const captured = record?.body?.status === "captured" && record.identity_status === "matched";
  const text = captured && typeof record.body.base64 === "string" ? Buffer.from(record.body.base64, "base64").toString("utf8") : "";
  const headers = record?.document?.response?.headers?.values ?? {};
  const status = statusCode(record?.document?.response?.status);
  const signals = {
    javascript_required: /please enable (?:javascript|js) and disable|enable javascript to continue/iu.test(text),
    human_verification: /verify (?:that )?you are human|v[ée]rifiez que vous [êe]tes (?:un )?humain|captcha|v[ée]rification de s[ée]curit[ée]|checking your browser/iu.test(text),
    access_denied: /access denied|acc[èe]s refus[ée]|votre acc[èe]s a [ée]t[ée] bloqu[ée]|request blocked/iu.test(text),
    rate_limit: /too many requests|rate limit|trafic inhabituel|unusual traffic/iu.test(text),
  };
  const mime = headers["content-type"]?.split(";")[0]?.trim().toLowerCase() ?? record?.document?.response?.mime_type;
  // These are markers in source content, including scripts; they do not prove
  // that a human-verification screen was displayed or why access was refused.
  const classification = status === 429 ? "rate_limited"
    : signals.javascript_required || signals.human_verification ? "verification_markers_observed"
      : status === 403 ? "generic_access_denied"
        : signals.rate_limit || signals.access_denied ? "refusal_markers_observed"
          : status === 200 && captured ? "no_refusal_observed" : "unknown";
  return { schema_version: "leboncoin-access-summary/v1", capture_id: record?.identity?.capture_id ?? null,
    captured_at: record?.captured_at ?? null, identity_status: record?.identity_status ?? "missing", classification, signals,
    navigation_status: status, body_status: record?.body?.status ?? "unavailable",
    body_representation: captured ? record.body.representation : null,
    cdp_body_bytes: captured ? record.body.bytes : null, cdp_body_sha256: captured ? record.body.sha256 : null,
    content_type: ["text/html", "text/plain", "application/json"].includes(mime) ? mime : "other",
    content_encoding: ["gzip", "br", "identity", "deflate"].includes(headers["content-encoding"]) ? headers["content-encoding"] : "unknown",
    retry_after_present: Object.hasOwn(headers, "retry-after"),
    headers_limited: record?.document?.request_headers?.limited === true || record?.document?.response?.headers?.limited === true,
    ...Object.fromEntries(["document_requests_observed", "main_document_requests_observed", "iframe_document_requests_observed", "redirects_observed"]
      .map((key) => [key, count(record?.counts?.[key])])),
  };
}

export function sealAccessCapture(record, validatedKey) {
  const plaintext = Buffer.from(JSON.stringify(record), "utf8");
  if (plaintext.length > MAX_PRIVATE_BYTES || !validatedKey?.key || !hexadecimal(validatedKey.fingerprint, 64)) throw new Error("diagnostic_seal_failed");
  const aad = Buffer.from(JSON.stringify(record.identity), "utf8");
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const wrappedKey = publicEncrypt({ key: validatedKey.key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" }, key);
    const envelope = { schema_version: ENVELOPE_SCHEMA, algorithm: "RSA-OAEP-SHA256/AES-256-GCM",
      key_fingerprint_sha256: validatedKey.fingerprint, aad_base64: aad.toString("base64"),
      wrapped_key_base64: wrappedKey.toString("base64"), nonce_base64: nonce.toString("base64"),
      tag_base64: cipher.getAuthTag().toString("base64"), ciphertext_base64: ciphertext.toString("base64") };
    const bytes = Buffer.from(`${JSON.stringify(envelope)}\n`, "utf8");
    if (bytes.length > MAX_ENVELOPE_BYTES) throw new Error();
    return bytes;
  } catch { throw new Error("diagnostic_seal_failed"); }
  finally { key.fill(0); }
}

function base64(value, limit) {
  if (typeof value !== "string" || value.length > 4 * Math.ceil(limit / 3)
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) throw new Error("envelope_invalid");
  const bytes = Buffer.from(value, "base64");
  if (bytes.length > limit || bytes.toString("base64") !== value) throw new Error("envelope_invalid");
  return bytes;
}

export function inspectSealedEnvelope(bytes, expectedIdentity, expectedFingerprint = KEY_FINGERPRINT) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > MAX_ENVELOPE_BYTES) throw new Error("envelope_invalid");
  const envelope = JSON.parse(new globalThis.TextDecoder("utf8", { fatal: true }).decode(bytes));
  const fields = ["schema_version", "algorithm", "key_fingerprint_sha256", "aad_base64", "wrapped_key_base64", "nonce_base64", "tag_base64", "ciphertext_base64"];
  if (!envelope || Object.keys(envelope).length !== fields.length || fields.some((key) => !Object.hasOwn(envelope, key))
    || envelope.schema_version !== ENVELOPE_SCHEMA || envelope.algorithm !== "RSA-OAEP-SHA256/AES-256-GCM"
    || envelope.key_fingerprint_sha256 !== expectedFingerprint) throw new Error("envelope_invalid");
  const aad = JSON.parse(new globalThis.TextDecoder("utf8", { fatal: true }).decode(base64(envelope.aad_base64, 1024)));
  if (JSON.stringify(aad) !== JSON.stringify(expectedIdentity)
    || base64(envelope.wrapped_key_base64, 384).length !== 384
    || base64(envelope.nonce_base64, 12).length !== 12 || base64(envelope.tag_base64, 16).length !== 16
    || base64(envelope.ciphertext_base64, MAX_PRIVATE_BYTES).length < 1) throw new Error("envelope_invalid");
  return { sha256: hash(bytes), bytes: bytes.length };
}

export function encodeSealedFragments(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > MAX_ENVELOPE_BYTES) throw new Error("fragment_limit");
  const encoded = Buffer.from(bytes).toString("base64");
  const total = Math.ceil(encoded.length / FRAGMENT_SIZE);
  if (total > MAX_FRAGMENTS) throw new Error("fragment_limit");
  return Array.from({ length: total }, (_, index) => `${FRAGMENT_PREFIX}${JSON.stringify({
    schema_version: "leboncoin-sealed-fragment/v1", index: index + 1, count: total, bytes: bytes.length,
    sha256: hash(bytes), data: encoded.slice(index * FRAGMENT_SIZE, (index + 1) * FRAGMENT_SIZE),
  })}`);
}

export function decodeSealedFragments(lines) {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > MAX_FRAGMENTS) throw new Error("fragment_invalid");
  let first;
  const chunks = lines.map((line, index) => {
    if (typeof line !== "string" || Buffer.byteLength(line) > 4096 || !line.startsWith(FRAGMENT_PREFIX)) throw new Error("fragment_invalid");
    const item = JSON.parse(line.slice(FRAGMENT_PREFIX.length));
    if (!item || Object.keys(item).length !== 6 || item.schema_version !== "leboncoin-sealed-fragment/v1" || item.index !== index + 1
      || item.count !== lines.length || !Number.isInteger(item.bytes) || item.bytes < 1 || item.bytes > MAX_ENVELOPE_BYTES
      || !hexadecimal(item.sha256, 64) || typeof item.data !== "string" || item.data.length < 1 || item.data.length > FRAGMENT_SIZE
      || (index < lines.length - 1 && item.data.length !== FRAGMENT_SIZE)) throw new Error("fragment_invalid");
    first ??= item;
    if (item.sha256 !== first.sha256 || item.bytes !== first.bytes) throw new Error("fragment_invalid");
    return item.data;
  });
  const bytes = base64(chunks.join(""), MAX_ENVELOPE_BYTES);
  if (bytes.length !== first.bytes || hash(bytes) !== first.sha256) throw new Error("fragment_invalid");
  return bytes;
}
