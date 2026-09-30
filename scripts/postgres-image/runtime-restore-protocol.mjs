import { TextDecoder, isDeepStrictEqual } from "node:util";
import { clearTimeout, setTimeout } from "node:timers";

export const POSTGRES_RUNTIME_RESTORE_PHASES = Object.freeze(["PREFLIGHT", "LOAD", "PROBE", "SOURCE_START", "SOURCE_SQL", "SOURCE_RESTART", "DUMP", "SOURCE_DISPOSE", "RESTORE_START", "RESTORE_SQL", "RESTORE_RESTART", "CLEANUP", "FINAL_SEAL"]);
const FRAME_BYTES = 65_536;
const TOTAL_BYTES = 8 * 1024 ** 2;
const MAX_SEQUENCE = 4096;
const writers = new WeakMap();
const NONCE = /^[0-9a-f]{24}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v, fields) => plain(v) && isDeepStrictEqual(Object.keys(v).sort(), [...fields].sort());
const fail = () => { throw new Error("postgres_runtime_restore_control_invalid"); };

export function validatePostgresRuntimeRestoreStart(value) {
  if (!exact(value, ["kind", "nonce", "recipeRevision", "executionId", "identity", "policyBytesBase64", "copyReceiptBytesBase64",
    "runtimePolicyBytesBase64", "workDirectory", "auditReceiptSha256"])
    || value.kind !== "START" || typeof value.nonce !== "string" || !NONCE.test(value.nonce)
    || typeof value.recipeRevision !== "string" || !REVISION.test(value.recipeRevision)
    || value.executionId !== `local-pg-restore-${value.nonce}` || !plain(value.identity)
    || typeof value.identity.dockerConfig !== "string" || typeof value.workDirectory !== "string"
    || value.workDirectory !== value.identity.dockerConfig.replace(/\/client$/u, "/work")
    || typeof value.auditReceiptSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.auditReceiptSha256)
    || [value.policyBytesBase64, value.copyReceiptBytesBase64, value.runtimePolicyBytesBase64].some((item) => typeof item !== "string"
      || item.length < 4 || item.length > 40_000 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(item)
      || Buffer.from(item, "base64").toString("base64") !== item)) fail();
  return value;
}

export function postgresRuntimeRestoreFrameReader(stream) {
  let buffer = Buffer.alloc(0); let total = 0; let queued; let waiting; let ended = false; let broken = false; let locked = false;
  const reject = () => { broken = true; if (waiting) { waiting.reject(new Error("postgres_runtime_restore_control_invalid")); waiting = undefined; } };
  const data = (chunk) => {
    try {
      if (!Buffer.isBuffer(chunk) || ended || broken || locked) fail();
      total += chunk.length;
      if (total > TOTAL_BYTES) fail();
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (locked && buffer.length) fail();
        const newline = buffer.indexOf(10);
        if (newline < 0) { if (buffer.length > FRAME_BYTES) fail(); break; }
        if (newline < 2 || newline > FRAME_BYTES) fail();
        const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, newline)));
        if (!plain(parsed)) fail();
        buffer = buffer.subarray(newline + 1);
        locked = true;
        if (waiting) { const current = waiting; waiting = undefined; current.resolve(parsed); }
        else { if (queued !== undefined) fail(); queued = parsed; }
      }
    } catch { reject(); }
  };
  const end = () => { ended = true; if (buffer.length || waiting) reject(); };
  stream.on("data", data); stream.on("end", end); stream.on("error", reject);
  return Object.freeze({
    next: (timeoutMs = 30_000) => {
      if (broken || waiting || locked && queued === undefined || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 90_000) {
        return Promise.reject(new Error("postgres_runtime_restore_control_invalid"));
      }
      if (queued !== undefined) { const value = queued; queued = undefined; return Promise.resolve(value); }
      if (ended) return Promise.reject(new Error("postgres_runtime_restore_control_invalid"));
      let timer;
      return new Promise((resolve, rejectPromise) => {
        waiting = { resolve, reject: rejectPromise };
        timer = setTimeout(reject, timeoutMs);
      }).finally(() => clearTimeout(timer));
    },
    // Only the local caller opens this gate after completing verification and writing its grant.
    allowNext: () => { if (broken || ended || !locked || waiting || queued !== undefined || buffer.length) fail(); locked = false; },
    assertReadyToReply: () => { if (broken || ended || !locked || waiting || queued !== undefined || buffer.length) fail(); },
    assertFinished: () => { if (broken || !ended || buffer.length || queued !== undefined || waiting) fail(); },
    close: () => { stream.off("data", data); stream.off("end", end); stream.off("error", reject); reject(); },
  });
}

function writer(stream) {
  let state = writers.get(stream);
  if (!state) {
    state = { broken: false, reject: undefined };
    // Keep one handler for the stream's lifetime: EPIPE may follow an already-fired write callback.
    stream.on("error", () => { state.broken = true; state.reject?.(new Error("postgres_runtime_restore_control_invalid")); });
    writers.set(stream, state);
  }
  return state;
}
export function assertPostgresRuntimeRestoreWriterHealthy(stream) { if (writer(stream).broken) fail(); }
export async function writePostgresRuntimeRestoreFrame(stream, value, afterWrite) {
  const state = writer(stream);
  if (state.broken || state.reject || afterWrite !== undefined && typeof afterWrite !== "function") fail();
  let bytes;
  try { bytes = Buffer.from(`${JSON.stringify(value)}\n`); } catch { fail(); }
  if (!plain(value) || bytes.length > FRAME_BYTES + 1) fail();
  let timer;
  try {
    await Promise.race([new Promise((resolve, reject) => {
      state.reject = reject;
      stream.write(bytes, (error) => {
        if (error) { state.broken = true; reject(new Error("postgres_runtime_restore_control_invalid")); return; }
        try { if (state.broken) fail(); afterWrite?.(); resolve(); } catch { reject(new Error("postgres_runtime_restore_control_invalid")); }
      });
    }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("postgres_runtime_restore_control_invalid")), 10_000); })]);
  } catch { state.broken = true; fail(); } finally { state.reject = undefined; clearTimeout(timer); }
}

function context(nonce, identity) {
  if (typeof nonce !== "string" || !NONCE.test(nonce) || !plain(identity) || typeof identity.daemonId !== "string"
    || identity.daemonId.length < 1 || identity.daemonId.length > 128
    || typeof identity.endpoint !== "string"
    || !/^unix:\/\/\/var\/tmp\/aw-pr-[A-Za-z0-9]{6}\/endpoint\/docker\.sock$/u.test(identity.endpoint ?? "")) fail();
}
function nextPhase(phase, previous, sequence) {
  const index = POSTGRES_RUNTIME_RESTORE_PHASES.indexOf(phase);
  const cleanup = POSTGRES_RUNTIME_RESTORE_PHASES.indexOf("CLEANUP");
  if (index < 0 || index < previous || index > previous + 1 && index !== cleanup || sequence === 0 && index !== 0) fail();
  return index;
}
export function validatePostgresRuntimeAuditGrant(value, phase, identity, receiptSha256, now = Date.now()) {
  if (!plain(identity) || typeof identity.daemonId !== "string" || !/^[A-Za-z0-9:_-]{1,128}$/u.test(identity.daemonId) || typeof identity.endpoint !== "string"
    || !/^unix:\/\/\/var\/tmp\/aw-pr-[A-Za-z0-9]{6}\/endpoint\/docker\.sock$/u.test(identity.endpoint)
    || typeof receiptSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(receiptSha256)) fail();
  if (!exact(value, ["state", "purpose", "phase", "daemonId", "endpoint", "auditReceiptSha256", "checkedAt", "validUntil"])
    || value.state !== "VERIFIED_CURRENT" || value.purpose !== "POSTGRES_RUNTIME_SQL_RESTORE" || value.phase !== phase
    || value.daemonId !== identity.daemonId || value.endpoint !== identity.endpoint || value.auditReceiptSha256 !== receiptSha256
    || !POSTGRES_RUNTIME_RESTORE_PHASES.includes(phase) || ["CLEANUP", "FINAL_SEAL"].includes(phase)
    || [value.checkedAt, value.validUntil].some((v) => typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v)
      || !Number.isFinite(Date.parse(v))) || !Number.isFinite(now)
    || Date.parse(value.checkedAt) > now || now - Date.parse(value.checkedAt) > 5_000 || Date.parse(value.validUntil) <= now) fail();
  return Object.freeze(value);
}
export function postgresRuntimeRestoreParentControl(nonce, identity, auditReceiptSha256) {
  context(nonce, identity); let sequence = 0; let phaseIndex = 0;
  if (typeof auditReceiptSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(auditReceiptSha256)) fail();
  let accepted;
  return Object.freeze({
    accept: (value) => {
      if (!exact(value, ["kind", "nonce", "sequence", "phase", "intent"]) || value.kind !== "REQUEST" || value.nonce !== nonce
        || !["OWNERSHIP", "AUDIT"].includes(value.intent) || value.intent === "AUDIT" && ["CLEANUP", "FINAL_SEAL"].includes(value.phase)
        || value.sequence !== sequence + 1 || value.sequence > MAX_SEQUENCE) fail();
      phaseIndex = nextPhase(value.phase, phaseIndex, sequence); sequence++;
      accepted = Object.freeze({ ...value }); return accepted;
    },
    grant: (request, audit = null) => {
      if (request !== accepted) fail();
      const attestation = request.intent === "AUDIT" ? validatePostgresRuntimeAuditGrant(audit, request.phase, identity, auditReceiptSha256)
        : Object.freeze({ state: "VERIFIED", purpose: "POSTGRES_RUNTIME_SQL_RESTORE", phase: request.phase,
          daemonId: identity.daemonId, endpoint: identity.endpoint });
      return Object.freeze({ kind: "GRANT", nonce, sequence, intent: request.intent, attestation });
    },
    assertComplete: () => { if (sequence === 0 || phaseIndex !== POSTGRES_RUNTIME_RESTORE_PHASES.length - 1) fail(); },
  });
}
export function postgresRuntimeRestoreWorkerControl(nonce, identity, reader, stream, auditReceiptSha256) {
  context(nonce, identity); let sequence = 0; let busy = false; let phaseIndex = 0;
  if (typeof auditReceiptSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(auditReceiptSha256)) fail();
  const request = async (phase, intent) => {
      if (busy || sequence >= MAX_SEQUENCE || intent === "AUDIT" && ["CLEANUP", "FINAL_SEAL"].includes(phase)) fail();
      const index = nextPhase(phase, phaseIndex, sequence);
      busy = true; phaseIndex = index; sequence++;
      try {
        if (sequence > 1) reader.allowNext();
        await writePostgresRuntimeRestoreFrame(stream, { kind: "REQUEST", nonce, sequence, phase, intent });
        const grant = await reader.next();
        if (!exact(grant, ["kind", "nonce", "sequence", "intent", "attestation"]) || grant.kind !== "GRANT"
          || grant.nonce !== nonce || grant.sequence !== sequence || grant.intent !== intent) fail();
        if (intent === "AUDIT") validatePostgresRuntimeAuditGrant(grant.attestation, phase, identity, auditReceiptSha256);
        else if (!isDeepStrictEqual(grant.attestation, { state: "VERIFIED", purpose: "POSTGRES_RUNTIME_SQL_RESTORE",
          phase, daemonId: identity.daemonId, endpoint: identity.endpoint })) fail();
        return Object.freeze(grant.attestation);
      } finally { busy = false; }
  };
  return Object.freeze({
    authorize: (phase) => request(phase, "OWNERSHIP"),
    beforeExecution: (phase) => request(phase, "AUDIT"),
  });
}

export const postgresRuntimeRestoreProtocolLimits = Object.freeze({ frameBytes: FRAME_BYTES, totalBytes: TOTAL_BYTES, maxSequence: MAX_SEQUENCE });
