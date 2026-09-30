import { TextDecoder, isDeepStrictEqual } from "node:util";
import { clearTimeout, setTimeout } from "node:timers";

export const COLD_LOAD_PHASES = Object.freeze(["PREFLIGHT", "BEFORE_LOAD", "AFTER_LOAD", "BEFORE_REMOVE", "AFTER_REMOVE"]);
const FRAME_BYTES = 65_536;
const TOTAL_BYTES = 1024 ** 2;
const MAX_SEQUENCE = 256;
const writers = new WeakMap();
const NONCE = /^[0-9a-f]{24}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const plain = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const exact = (v, fields) => plain(v) && isDeepStrictEqual(Object.keys(v).sort(), [...fields].sort());
const fail = () => { throw new Error("postgres_cold_load_control_invalid"); };

export function validateColdLoadStart(value) {
  if (!exact(value, ["kind", "nonce", "recipeRevision", "executionId", "identity", "policyBytesBase64", "copyReceiptBytesBase64"])
    || value.kind !== "START" || typeof value.nonce !== "string" || !NONCE.test(value.nonce)
    || typeof value.recipeRevision !== "string" || !REVISION.test(value.recipeRevision)
    || value.executionId !== `local-cold-load-${value.nonce}` || !plain(value.identity)
    || [value.policyBytesBase64, value.copyReceiptBytesBase64].some((item) => typeof item !== "string"
      || item.length < 4 || item.length > 40_000 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(item)
      || Buffer.from(item, "base64").toString("base64") !== item)) fail();
  return value;
}

export function coldLoadFrameReader(stream) {
  let buffer = Buffer.alloc(0); let total = 0; let queued; let waiting; let ended = false; let broken = false; let locked = false;
  const reject = () => { broken = true; if (waiting) { waiting.reject(new Error("postgres_cold_load_control_invalid")); waiting = undefined; } };
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
      if (broken || waiting || locked && queued === undefined || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
        return Promise.reject(new Error("postgres_cold_load_control_invalid"));
      }
      if (queued !== undefined) { const value = queued; queued = undefined; return Promise.resolve(value); }
      if (ended) return Promise.reject(new Error("postgres_cold_load_control_invalid"));
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
    stream.on("error", () => { state.broken = true; state.reject?.(new Error("postgres_cold_load_control_invalid")); });
    writers.set(stream, state);
  }
  return state;
}
export function assertColdLoadWriterHealthy(stream) { if (writer(stream).broken) fail(); }
export async function writeColdLoadFrame(stream, value, afterWrite) {
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
        if (error) { state.broken = true; reject(new Error("postgres_cold_load_control_invalid")); return; }
        try { if (state.broken) fail(); afterWrite?.(); resolve(); } catch { reject(new Error("postgres_cold_load_control_invalid")); }
      });
    }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("postgres_cold_load_control_invalid")), 10_000); })]);
  } catch { fail(); } finally { state.reject = undefined; clearTimeout(timer); }
}

function context(nonce, identity) {
  if (typeof nonce !== "string" || !NONCE.test(nonce) || !plain(identity) || typeof identity.daemonId !== "string"
    || identity.daemonId.length < 1 || identity.daemonId.length > 128
    || !/^unix:\/\/\/var\/tmp\/aw-cl-[A-Za-z0-9]{6}\/endpoint\/docker\.sock$/u.test(identity.endpoint ?? "")) fail();
}
export function coldLoadParentControl(nonce, identity) {
  context(nonce, identity); let sequence = 0; let phaseIndex = 0;
  return Object.freeze({
    accept: (value) => {
      if (!exact(value, ["kind", "nonce", "sequence", "phase"]) || value.kind !== "REQUEST" || value.nonce !== nonce
        || value.sequence !== sequence + 1 || value.sequence > MAX_SEQUENCE) fail();
      const index = COLD_LOAD_PHASES.indexOf(value.phase);
      if (index < phaseIndex || index > phaseIndex + 1 || sequence === 0 && index !== 0) fail();
      sequence++; phaseIndex = index;
      return Object.freeze({ kind: "GRANT", nonce, sequence, attestation: Object.freeze({ state: "VERIFIED",
        purpose: "COLD_LOAD_ONLY", phase: value.phase, daemonId: identity.daemonId, endpoint: identity.endpoint }) });
    },
    assertComplete: () => { if (sequence === 0 || phaseIndex !== COLD_LOAD_PHASES.length - 1) fail(); },
  });
}
export function coldLoadWorkerControl(nonce, identity, reader, stream) {
  context(nonce, identity); let sequence = 0; let busy = false; let phaseIndex = 0;
  return Object.freeze({
    authorize: async (phase) => {
      const index = COLD_LOAD_PHASES.indexOf(phase);
      if (busy || sequence >= MAX_SEQUENCE || index < phaseIndex || index > phaseIndex + 1 || sequence === 0 && index !== 0) fail();
      busy = true; phaseIndex = index; sequence++;
      try {
        if (sequence > 1) reader.allowNext();
        await writeColdLoadFrame(stream, { kind: "REQUEST", nonce, sequence, phase });
        const grant = await reader.next();
        const expected = { kind: "GRANT", nonce, sequence, attestation: { state: "VERIFIED", purpose: "COLD_LOAD_ONLY",
          phase, daemonId: identity.daemonId, endpoint: identity.endpoint } };
        if (!isDeepStrictEqual(grant, expected)) fail();
        return Object.freeze(grant.attestation);
      } finally { busy = false; }
    },
  });
}

export const coldLoadProtocolLimits = Object.freeze({ frameBytes: FRAME_BYTES, totalBytes: TOTAL_BYTES, maxSequence: MAX_SEQUENCE });
