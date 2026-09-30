import { TextDecoder, isDeepStrictEqual } from "node:util";
import { clearTimeout, setTimeout } from "node:timers";
import { POSTGRES_PRIVATE_RUNTIME_EVIDENCE_PIN as PIN, postgresPrivateRuntimeEvidenceLimits as LIMITS,
  postgresPrivateRuntimeEvidenceFailureCodes as CODES, postgresPrivateRuntimeEvidencePhases as PHASES,
  freezePostgresPrivateRuntimeEvidence as freeze } from "./private-runtime-evidence-policy.mjs";

const PREFIX = "postgres_private_runtime_evidence_";
const NATIVE = ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"];
const HEX = /^[0-9a-f]{64}$/u;
const NONCE = /^[0-9a-f]{24}$/u;
const REV = /^[0-9a-f]{40}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const fail = () => { throw new Error(PREFIX + "control_invalid"); };

export function postgresPrivateRuntimeEvidenceRecord(value, fields) {
  const ownKeys = value !== null && typeof value === "object" ? Reflect.ownKeys(value) : [];
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || ownKeys.some((key) => typeof key !== "string") || !isDeepStrictEqual(ownKeys.sort(), [...fields].sort())) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (fields.some((key) => !descriptors[key].enumerable || !("value" in descriptors[key]))) fail();
  return Object.fromEntries(fields.map((key) => [key, descriptors[key].value]));
}

export function postgresPrivateRuntimeEvidenceIdentity(stat) {
  return { dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid), gid: Number(stat.gid),
    mode: Number(stat.mode & 0o7777n), nlink: Number(stat.nlink), size: Number(stat.size),
    mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) };
}

export function validatePostgresPrivateRuntimeEvidenceIdentity(value, expected = {}) {
  value = postgresPrivateRuntimeEvidenceRecord(value, NATIVE);
  if (["dev", "ino", "mtimeNs", "ctimeNs"].some((key) => typeof value[key] !== "string" || !DECIMAL.test(value[key]))
    || value.dev === "0" || value.ino === "0"
    || ["uid", "gid", "mode", "nlink", "size"].some((key) => !Number.isSafeInteger(value[key]) || value[key] < 0)
    || value.mode !== 0o600 || value.nlink !== 1 || value.size < 1 || value.size > LIMITS.sourceBytes
    || Object.entries(expected).some(([key, item]) => !NATIVE.includes(key) || value[key] !== item)) fail();
  return freeze(value);
}

export function postgresPrivateRuntimeEvidenceLocation(nonce, recipeRevision) {
  if (typeof nonce !== "string" || !NONCE.test(nonce) || recipeRevision !== undefined
    && (typeof recipeRevision !== "string" || !REV.test(recipeRevision))) fail();
  return freeze({ nonce, executionId: `local-runtime-evidence-${nonce}`,
    directory: `${PIN.parent}/${PIN.directoryPrefix}${nonce}`, ...(recipeRevision === undefined ? {} : { recipeRevision }) });
}

export function validatePostgresPrivateRuntimeEvidenceSources(value, sources = PIN.sources) {
  if (!Array.isArray(value) || value.length !== 3 || !Array.isArray(sources) || sources.length !== 3) fail();
  const result = value.map((item, index) => {
    item = postgresPrivateRuntimeEvidenceRecord(item, ["role", "fd", "source", "size", "sha256", "identity"]);
    const expected = sources[index];
    if (["role", "fd", "source", "size", "sha256"].some((key) => item[key] !== expected[key])) fail();
    item.identity = validatePostgresPrivateRuntimeEvidenceIdentity(item.identity,
      { uid: expected.uid, gid: expected.gid, size: expected.size });
    return item;
  });
  if (new Set(result.map((item) => `${item.identity.dev}:${item.identity.ino}`)).size !== 3) fail();
  return freeze(result);
}

export function validatePostgresPrivateRuntimeEvidencePayloads(value, sources = PIN.sources) {
  if (!Array.isArray(value) || value.length !== 3) fail();
  const result = value.map((item, index) => {
    item = postgresPrivateRuntimeEvidenceRecord(item, ["name", "role", "size", "sha256", "sourceIdentity", "identity"]);
    const expected = sources[index];
    if (["name", "role", "size", "sha256"].some((key) => item[key] !== expected[key])) fail();
    item.sourceIdentity = validatePostgresPrivateRuntimeEvidenceIdentity(item.sourceIdentity,
      { uid: expected.uid, gid: expected.gid, size: expected.size });
    item.identity = validatePostgresPrivateRuntimeEvidenceIdentity(item.identity, { uid: 1000, gid: 1000, size: expected.size });
    if (item.identity.dev === item.sourceIdentity.dev && item.identity.ino === item.sourceIdentity.ino) fail();
    return item;
  });
  const originals = new Set(result.map((item) => `${item.sourceIdentity.dev}:${item.sourceIdentity.ino}`));
  if (new Set(result.map((item) => `${item.identity.dev}:${item.identity.ino}`)).size !== 3
    || result.some((item) => originals.has(`${item.identity.dev}:${item.identity.ino}`))) fail();
  return freeze(result);
}

export function validatePostgresPrivateRuntimeEvidenceReceiptFile(value) {
  value = postgresPrivateRuntimeEvidenceRecord(value, ["name", "size", "sha256", "identity"]);
  if (value.name !== "receipt.json" || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > LIMITS.receiptBytes
    || typeof value.sha256 !== "string" || !HEX.test(value.sha256)) fail();
  value.identity = validatePostgresPrivateRuntimeEvidenceIdentity(value.identity, { uid: 1000, gid: 1000, size: value.size });
  return freeze(value);
}

export function validatePostgresPrivateRuntimeEvidenceFrame(raw, expected = {}) {
  if (raw === null || typeof raw !== "object") fail();
  const kindDescriptor = Object.getOwnPropertyDescriptor(raw, "kind");
  if (!kindDescriptor || !("value" in kindDescriptor)) fail();
  const kind = kindDescriptor.value;
  const headers = ["kind", "nonce", "recipeRevision", "executionId", "directory"];
  const fields = {
    START: ["kind", "nonce", "deadline", "sources"],
    PREPARED: [...headers, "payloads"], PUBLISHED: [...headers, "receipt"],
    RESULT: [...headers, "receipt", "payloads", "sourceUnchanged", "descriptorsClosed"],
    COMMIT: ["kind", "nonce", "sources"], FINALIZE: ["kind", "nonce", "rootSourcesUnchanged", "rootDescriptorsClosed"],
    ABORT: ["kind", "nonce"], FAILED: ["kind", "nonce", "code", "phase", "cleanup"],
  };
  if (typeof kind !== "string" || !Object.hasOwn(fields, kind) || expected.kind !== undefined && kind !== expected.kind) fail();
  const value = postgresPrivateRuntimeEvidenceRecord(raw, fields[kind]);
  if (typeof value.nonce !== "string" || !NONCE.test(value.nonce) || expected.nonce !== undefined && value.nonce !== expected.nonce) fail();
  const sources = expected.sources ?? PIN.sources;
  if (kind === "START" && (!Number.isSafeInteger(value.deadline) || value.deadline <= Date.now()
    || value.deadline > Date.now() + LIMITS.operationMs)) fail();
  if (kind === "START" || kind === "COMMIT") value.sources = validatePostgresPrivateRuntimeEvidenceSources(value.sources, sources);
  if (["PREPARED", "PUBLISHED", "RESULT"].includes(kind)) {
    if (typeof value.recipeRevision !== "string" || !REV.test(value.recipeRevision)) fail();
    const location = postgresPrivateRuntimeEvidenceLocation(value.nonce, value.recipeRevision);
    if (value.directory !== location.directory || value.executionId !== location.executionId
      || expected.recipeRevision !== undefined && value.recipeRevision !== expected.recipeRevision) fail();
  }
  if (kind === "PREPARED" || kind === "RESULT") value.payloads = validatePostgresPrivateRuntimeEvidencePayloads(value.payloads, sources);
  if (kind === "PUBLISHED" || kind === "RESULT") value.receipt = validatePostgresPrivateRuntimeEvidenceReceiptFile(value.receipt);
  if (kind === "RESULT" && (value.sourceUnchanged !== true || value.descriptorsClosed !== true)
    || kind === "FINALIZE" && (value.rootSourcesUnchanged !== true || value.rootDescriptorsClosed !== true)) fail();
  if (kind === "FAILED" && (typeof value.code !== "string" || !CODES.some((code) => value.code === PREFIX + code)
    || !PHASES.includes(value.phase) || !["CONFIRMED", "UNVERIFIED"].includes(value.cleanup)
    || value.code === PREFIX + "cleanup_uncertain" && value.cleanup !== "UNVERIFIED")) fail();
  return freeze(value);
}

// One bounded channel owns both byte counters and all reader/writer errors.
export function postgresPrivateRuntimeEvidenceChannel(input, output, options = {}) {
  let buffer = Buffer.alloc(0); let traffic = 0; let queued; let waiting; let eofWaiting; let writerWaiting;
  let ended = false; let broken = false; let writerEnded = false; let sending = false; let locked = false;
  const charge = (size) => { traffic += size; if (traffic > LIMITS.trafficBytes) fail(); };
  const reject = () => {
    broken = true;
    for (const pending of [waiting, eofWaiting, writerWaiting]) if (pending) pending.reject(new Error(PREFIX + "control_invalid"));
    waiting = undefined; eofWaiting = undefined; writerWaiting = undefined;
  };
  const onData = (chunk) => {
    try {
      if (!Buffer.isBuffer(chunk) || ended || broken || locked) fail(); charge(chunk.length); buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (locked && buffer.length) fail();
        const newline = buffer.indexOf(10);
        if (newline < 0) { if (buffer.length > LIMITS.frameBytes) fail(); break; }
        if (newline < 2 || newline > LIMITS.frameBytes) fail();
        const frame = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, newline)));
        const value = validatePostgresPrivateRuntimeEvidenceFrame(frame, options);
        buffer = buffer.subarray(newline + 1);
        locked = true;
        if (waiting) { const pending = waiting; waiting = undefined; pending.resolve(value); }
        else { if (queued !== undefined) fail(); queued = value; }
        if (eofWaiting) fail();
      }
    } catch { reject(); }
  };
  const onEnd = () => {
    ended = true;
    if (buffer.length || waiting || eofWaiting && queued !== undefined) reject();
    else if (eofWaiting) { const pending = eofWaiting; eofWaiting = undefined; pending.resolve(); }
  };
  input.on("data", onData); input.on("end", onEnd); input.on("error", reject); output.on("error", reject);
  const bounded = (action, timeoutMs) => {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > LIMITS.operationMs) return Promise.reject(new Error(PREFIX + "control_invalid"));
    return new Promise((resolve, rejectPromise) => {
      const timer = setTimeout(() => { reject(); rejectPromise(new Error(PREFIX + "control_invalid")); }, timeoutMs);
      const done = { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); rejectPromise(error); } };
      try { action(done); } catch { done.reject(new Error(PREFIX + "control_invalid")); }
    });
  };
  const send = (frame, timeoutMs, allowNext) => bounded((pending) => {
    if (broken || writerEnded || output.destroyed || sending || writerWaiting
      || allowNext && (!locked || queued !== undefined || waiting || eofWaiting || ended || buffer.length)) fail();
    const value = validatePostgresPrivateRuntimeEvidenceFrame(frame, options);
    const bytes = Buffer.from(JSON.stringify(value) + "\n");
    if (bytes.length - 1 > LIMITS.frameBytes) fail(); charge(bytes.length); sending = true; writerWaiting = pending;
    output.write(bytes, (error) => {
      sending = false; writerWaiting = undefined;
      if (error || broken) { reject(); pending.reject(new Error(PREFIX + "control_invalid")); }
      else { if (allowNext) locked = false; pending.resolve(); }
    });
  }, timeoutMs);
  const endWriter = (timeoutMs, allowNext) => bounded((pending) => {
    if (broken || writerEnded || sending || writerWaiting || output.destroyed
      || allowNext && (!locked || queued !== undefined || waiting || eofWaiting || ended || buffer.length)) fail();
    writerEnded = true; writerWaiting = pending;
    output.end(() => {
      writerWaiting = undefined;
      if (broken) pending.reject(new Error(PREFIX + "control_invalid"));
      else { if (allowNext) locked = false; pending.resolve(); }
    });
  }, timeoutMs);
  return Object.freeze({
    next: (timeoutMs = LIMITS.gitCommandMs) => bounded((pending) => {
      if (broken || waiting || eofWaiting || locked && queued === undefined) fail();
      if (queued !== undefined) { const value = queued; queued = undefined; pending.resolve(value); }
      else { if (ended) fail(); waiting = pending; }
    }, timeoutMs),
    eof: (timeoutMs = LIMITS.cleanupMs) => bounded((pending) => {
      if (broken || waiting || eofWaiting || queued !== undefined || buffer.length) fail();
      if (ended) pending.resolve(); else eofWaiting = pending;
    }, timeoutMs),
    send: (frame, timeoutMs = LIMITS.cleanupMs) => send(frame, timeoutMs, false),
    sendAndAllowNext: (frame, timeoutMs = LIMITS.cleanupMs) => send(frame, timeoutMs, true),
    end: (timeoutMs = LIMITS.cleanupMs) => endWriter(timeoutMs, false),
    endAndAllowNext: (timeoutMs = LIMITS.cleanupMs) => endWriter(timeoutMs, true),
    healthy: () => { if (broken) fail(); },
    writerClosed: () => writerEnded && output.writableFinished && !broken,
    // These streams belong to one invocation. Keep terminal error handlers so an
    // asynchronous EPIPE after disposal cannot escape as an unfiltered exception.
    dispose: () => { reject(); input.removeListener("data", onData); input.removeListener("end", onEnd); },
  });
}

export function validatePostgresPrivateRuntimeEvidenceAcknowledgement(raw, expected) {
  const value = postgresPrivateRuntimeEvidenceRecord(raw, ["state", "authority", "nonce", "executionId", "recipeRevision", "privateRoot",
    "receipt", "sources", "payloads", "legacy", "cleanup", "historicalIntegrity", "currentness", "runtimePermission", "closure", "requiredMissing",
    "registryRead", "registryWrite", "network", "signing", "admission", "supportStartedAt", "supportEndsAt", "archiveUntil"]);
  if (typeof expected?.recipeRevision !== "string" || !REV.test(expected.recipeRevision)) fail();
  const location = postgresPrivateRuntimeEvidenceLocation(expected.nonce, expected.recipeRevision);
  value.legacy = postgresPrivateRuntimeEvidenceRecord(value.legacy, Object.keys(PIN.legacy));
  value.cleanup = postgresPrivateRuntimeEvidenceRecord(value.cleanup, ["rootDescriptors", "workerDescriptors", "child", "output", "writer"]);
  if (!Array.isArray(value.requiredMissing) || Object.getPrototypeOf(value.requiredMissing) !== Array.prototype) fail();
  const missingKeys = Reflect.ownKeys(value.requiredMissing);
  const expectedKeys = [...PIN.requiredMissing.map((_, index) => String(index)), "length"];
  if (missingKeys.some((key) => typeof key !== "string") || !isDeepStrictEqual(missingKeys.sort(), expectedKeys.sort())) fail();
  const missingDescriptors = Object.getOwnPropertyDescriptors(value.requiredMissing);
  if (!Object.hasOwn(missingDescriptors.length, "value") || missingDescriptors.length.value !== PIN.requiredMissing.length
    || PIN.requiredMissing.some((_, index) => !Object.hasOwn(missingDescriptors[index], "value") || !missingDescriptors[index].enumerable)) fail();
  value.requiredMissing = PIN.requiredMissing.map((_, index) => missingDescriptors[index].value);
  if (value.state !== "ADDENDUM_VERIFIED" || value.authority !== "LOCAL_DIAGNOSTIC"
    || value.nonce !== location.nonce || value.executionId !== location.executionId || value.recipeRevision !== location.recipeRevision
    || value.privateRoot !== location.directory || !isDeepStrictEqual(value.legacy, PIN.legacy)
    || !isDeepStrictEqual(value.cleanup, { rootDescriptors: "CLOSED", workerDescriptors: "CLOSED", child: "CLOSED_EXIT_0",
      output: "EOF_ZERO_STDERR", writer: "CLOSED" })
    || value.historicalIntegrity !== "VERIFIED" || value.currentness !== "NOT_EVALUATED" || value.runtimePermission !== "NOT_GRANTED"
    || value.closure !== "INCOMPLETE" || !isDeepStrictEqual(value.requiredMissing, PIN.requiredMissing)
    || ["registryRead", "registryWrite", "network", "signing"].some((key) => value[key] !== "NOT_ATTEMPTED")
    || value.admission !== "NOT_AUTHORIZED" || ["supportStartedAt", "supportEndsAt", "archiveUntil"].some((key) => value[key] !== null)) fail();
  value.sources = validatePostgresPrivateRuntimeEvidenceSources(value.sources);
  value.payloads = validatePostgresPrivateRuntimeEvidencePayloads(value.payloads);
  value.receipt = validatePostgresPrivateRuntimeEvidenceReceiptFile(value.receipt);
  if (!isDeepStrictEqual(value.sources, expected.sources)
    || value.payloads.some((item, index) => !isDeepStrictEqual(item.sourceIdentity, value.sources[index].identity))
    || expected.payloads !== undefined && !isDeepStrictEqual(value.payloads, expected.payloads)
    || expected.receipt !== undefined && !isDeepStrictEqual(value.receipt, expected.receipt)) fail();
  const receiptId = `${value.receipt.identity.dev}:${value.receipt.identity.ino}`;
  if ([...value.sources.map((item) => item.identity), ...value.payloads.map((item) => item.identity)]
    .some((item) => `${item.dev}:${item.ino}` === receiptId)) fail();
  return freeze(value);
}

export function postgresPrivateRuntimeEvidenceFailureDiagnostic(error, phase = "CONTEXT", cleanup = "UNVERIFIED") {
  let code = PREFIX + "operation_failed";
  try { const message = error?.message; if (CODES.some((item) => message === PREFIX + item)) code = message; }
  catch { /* Arbitrary errors and accessors never become output. */ }
  return Object.freeze({ code, phase: PHASES.includes(phase) ? phase : "CONTEXT",
    cleanup: code !== PREFIX + "cleanup_uncertain" && cleanup === "CONFIRMED" ? "CONFIRMED" : "UNVERIFIED" });
}
