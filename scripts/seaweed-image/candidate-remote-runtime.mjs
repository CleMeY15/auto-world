import {
  isPublicSeaweedRuntimePhase, isPublicSeaweedRuntimeReason,
  validateSeaweedRuntimePersistenceProof, validateSeaweedRuntimeProfileProof,
  validateSeaweedRuntimeStrictContentionProof, verifyLocalSeaweedRuntimeProfile,
  verifyLocalSeaweedRuntimeRestartPersistence, verifyLocalSeaweedRuntimeStrictContention,
} from "./candidate-runtime.mjs";
import {
  validateSeaweedRuntimeBackupRestoreProof, verifyLocalSeaweedRuntimeBackupRestore,
} from "./backup-restore.mjs";
import {
  isPublicSeaweedHostLoopbackPhase, isPublicSeaweedHostLoopbackReason,
  validateSeaweedRuntimeHostLoopbackProof, verifyLocalSeaweedRuntimeHostLoopback,
} from "./host-loopback.mjs";
import * as remoteCandidate from "./candidate-remote.mjs";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const MAX_ARTIFACT_BYTES = 1024 ** 3;
const RUNTIME_CODES = new Set([
  "seaweed_candidate_runtime_failed", "seaweed_candidate_runtime_cleanup_failed",
  "seaweed_candidate_runtime_persistence_failed", "seaweed_candidate_runtime_persistence_cleanup_failed",
  "seaweed_candidate_runtime_backup_restore_failed", "seaweed_candidate_runtime_backup_restore_cleanup_failed",
  "seaweed_candidate_runtime_host_loopback_failed", "seaweed_candidate_runtime_host_loopback_cleanup_failed",
]);

function fail(code) { throw new Error(code); }
function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
  return plain(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function cloneFrozen(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneFrozen));
  if (plain(value)) return Object.freeze(Object.fromEntries(Object.entries(value)
    .map(([key, item]) => [key, cloneFrozen(item)])));
  return value;
}
function validBytes(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_ARTIFACT_BYTES;
}

export function validateRemoteSeaweedAuditBinding(value, policyInput) {
  const policy = remoteCandidate.validateRemoteSeaweedCandidatePolicy(policyInput);
  if (!exactKeys(value, ["kind", "state", "subject", "runId", "runNumber", "runAttempt",
    "recipeRevision", "artifact", "files"])
    || !exactKeys(value.artifact, ["id", "name", "bytes", "digest"])
    || !exactKeys(value.files, ["receipt", "vulnerability", "cyclonedx"])
    || Object.values(value.files).some((file) => !exactKeys(file, ["sha256", "bytes"]))
    || value.kind !== "SEAWEED_REMOTE_AUDIT_BINDING_V1" || value.state !== "COMPLETE"
    || !DIGEST.test(policy.subject.split("@").at(-1) ?? "")
    || value.subject !== policy.subject || !RUN_ID.test(value.runId)
    || value.runNumber !== "1" || value.runAttempt !== "1" || !REVISION.test(value.recipeRevision)
    || !Number.isSafeInteger(value.artifact.id) || value.artifact.id < 1
    || !ARTIFACT_NAME.test(value.artifact.name) || !validBytes(value.artifact.bytes)
    || !DIGEST.test(value.artifact.digest)
    || Object.values(value.files).some((file) => !SHA256.test(file.sha256) || !validBytes(file.bytes))) {
    fail("seaweed_remote_runtime_audit_binding_invalid");
  }
  return cloneFrozen(value);
}

function validateSuite(suite, expected) {
  if (!exactKeys(suite, ["basic", "persistence", "strict", "backup", "hostLoopback"])
    || !exactKeys(suite.strict, ["runtimeProof", "strictProof"])) {
    fail("seaweed_remote_runtime_suite_invalid");
  }
  try {
    const basic = validateSeaweedRuntimeProfileProof(suite.basic, expected);
    const persistence = validateSeaweedRuntimePersistenceProof(suite.persistence, expected);
    const strictRuntime = validateSeaweedRuntimeProfileProof(suite.strict.runtimeProof, expected);
    const strictProof = validateSeaweedRuntimeStrictContentionProof(suite.strict.strictProof, expected);
    const backup = validateSeaweedRuntimeBackupRestoreProof(suite.backup, expected);
    const hostLoopback = validateSeaweedRuntimeHostLoopbackProof(suite.hostLoopback, expected);
    return cloneFrozen({ basic, persistence, strict: { runtimeProof: strictRuntime, strictProof },
      backup, hostLoopback });
  } catch { fail("seaweed_remote_runtime_suite_invalid"); }
}

function validateMaterialContext(value, input) {
  if (!exactKeys(value, ["parent", "dockerConfig", "imageId", "diffId", "runId", "recipeRevision",
    "signal", "subject", "archiveProof"])
    || value.runId !== input.runId || value.recipeRevision !== input.recipeRevision
    || value.subject !== input.policy.subject || value.imageId !== input.policy.candidate.imageId
    || value.diffId !== input.policy.candidate.diffId || !(value.signal instanceof globalThis.AbortSignal)
    || value.signal.aborted) {
    fail("seaweed_remote_runtime_material_context_invalid");
  }
  return Object.freeze({ parent: value.parent, dockerConfig: value.dockerConfig, imageId: value.imageId,
    runId: value.runId, recipeRevision: value.recipeRevision, signal: value.signal });
}

function sanitizeRuntimeFailure(error) {
  const code = RUNTIME_CODES.has(error?.code) ? error.code : "seaweed_remote_runtime_diagnostics_failed";
  const host = code.includes("host_loopback");
  const phaseValid = host ? isPublicSeaweedHostLoopbackPhase(error?.phase)
    : isPublicSeaweedRuntimePhase(error?.phase);
  const reasonValid = host ? isPublicSeaweedHostLoopbackReason(error?.reason)
    : isPublicSeaweedRuntimeReason(error?.reason);
  let runtimeCleanupFailure = null;
  const cleanup = error?.runtimeCleanupFailure;
  const cleanupHost = typeof cleanup?.code === "string" && cleanup.code.includes("host_loopback");
  if (RUNTIME_CODES.has(cleanup?.code)
    && (cleanupHost ? isPublicSeaweedHostLoopbackPhase(cleanup.phase) : isPublicSeaweedRuntimePhase(cleanup.phase))
    && (cleanupHost ? isPublicSeaweedHostLoopbackReason(cleanup.reason) : isPublicSeaweedRuntimeReason(cleanup.reason))) {
    runtimeCleanupFailure = cloneFrozen({ code: cleanup.code, phase: cleanup.phase, reason: cleanup.reason });
  }
  return cloneFrozen({ code, phase: phaseValid ? error.phase : null, reason: reasonValid ? error.reason : null,
    runtimeCleanupFailure });
}

function sanitizeProviderFailure(error) {
  const exact = error?.message === "seaweed_remote_runtime_material_failed"
    && exactKeys(Object.fromEntries(Object.keys(error).map((key) => [key, error[key]])),
      ["code", "inspectionFailed", "primaryFailure", "imageCleanupFailure", "temporaryCleanupFailure"])
    && error.code === "seaweed_remote_runtime_material_failed" && typeof error.inspectionFailed === "boolean";
  const fixed = (value) => value === null || value === "seaweed_remote_runtime_diagnostics_failed"
    || typeof value === "string" && value.length <= 128 && /^seaweed_remote_candidate_[a-z0-9_]+$/u.test(value)
    ? value : null;
  if (!exact) return cloneFrozen({ inspectionFailed: false, primaryFailure: null,
    imageCleanupFailure: null, temporaryCleanupFailure: null });
  return cloneFrozen({ inspectionFailed: error.inspectionFailed, primaryFailure: fixed(error.primaryFailure),
    imageCleanupFailure: fixed(error.imageCleanupFailure), temporaryCleanupFailure: fixed(error.temporaryCleanupFailure) });
}

function aggregateFailure(diagnosticFailure, providerFailure) {
  const error = new Error("seaweed_remote_runtime_candidate_failed");
  Object.assign(error, { code: "seaweed_remote_runtime_candidate_failed", state: "INCOMPLETE",
    authority: "DIAGNOSTIC_ONLY", candidateAuthorization: "NOT_AUTHORIZED", diagnosticFailure,
    materialPrimaryFailure: providerFailure.primaryFailure,
    imageCleanupFailure: providerFailure.imageCleanupFailure,
    temporaryCleanupFailure: providerFailure.temporaryCleanupFailure });
  return error;
}

function validateInput(value) {
  if (!exactKeys(value, ["parent", "policy", "runId", "recipeRevision", "signal", "validateFilesystem",
    "validateRuntimeConfig", "auditBinding"])) fail("seaweed_remote_runtime_arguments_invalid");
  const policy = remoteCandidate.validateRemoteSeaweedCandidatePolicy(value.policy);
  const auditBinding = validateRemoteSeaweedAuditBinding(value.auditBinding, policy);
  if (!RUN_ID.test(value.runId) || !REVISION.test(value.recipeRevision)
    || typeof value.validateFilesystem !== "function" || typeof value.validateRuntimeConfig !== "function"
    || value.signal !== undefined && !(value.signal instanceof globalThis.AbortSignal)) {
    fail("seaweed_remote_runtime_arguments_invalid");
  }
  return { ...value, policy, auditBinding };
}

function validateDependencies(value) {
  const keys = ["materialize", "validateMaterialReceipt", "verifyRuntime", "verifyPersistence", "verifyStrict",
    "verifyBackup", "verifyHostLoopback"];
  if (!plain(value) || Object.keys(value).some((key) => !keys.includes(key))
    || Object.values(value).some((item) => typeof item !== "function")) {
    fail("seaweed_remote_runtime_arguments_invalid");
  }
  return {
    materialize: value.materialize ?? remoteCandidate.withVerifiedRemoteSeaweedRuntimeMaterial,
    validateMaterialReceipt: value.validateMaterialReceipt
      ?? remoteCandidate.validateRemoteSeaweedRuntimeMaterialReceipt,
    verifyRuntime: value.verifyRuntime ?? verifyLocalSeaweedRuntimeProfile,
    verifyPersistence: value.verifyPersistence ?? verifyLocalSeaweedRuntimeRestartPersistence,
    verifyStrict: value.verifyStrict ?? verifyLocalSeaweedRuntimeStrictContention,
    verifyBackup: value.verifyBackup ?? verifyLocalSeaweedRuntimeBackupRestore,
    verifyHostLoopback: value.verifyHostLoopback ?? verifyLocalSeaweedRuntimeHostLoopback,
  };
}

export function validateRemoteSeaweedRuntimeCandidateReceipt(receipt, policyInput, auditBindingInput) {
  const policy = remoteCandidate.validateRemoteSeaweedCandidatePolicy(policyInput);
  const auditBinding = validateRemoteSeaweedAuditBinding(auditBindingInput, policy);
  if (!exactKeys(receipt, ["kind", "state", "authority", "candidateAuthorization", "publication",
    "imageExecution", "vulnerabilityAudit", "registryWrite", "signing", "admission", "runId",
    "recipeRevision", "subject", "auditBinding", "material", "suite"])
    || receipt.kind !== "SEAWEED_REMOTE_RUNTIME_CANDIDATE_RECEIPT_V1" || receipt.state !== "VERIFIED"
    || receipt.authority !== "DIAGNOSTIC_ONLY" || receipt.candidateAuthorization !== "NOT_AUTHORIZED"
    || receipt.publication !== "PUBLISHED_UNADMITTED" || receipt.imageExecution !== "VERIFIED_DIAGNOSTIC"
    || receipt.vulnerabilityAudit !== "EXACT_REMOTE_AUDIT_COMPLETE"
    || receipt.registryWrite !== "NOT_ATTEMPTED" || receipt.signing !== "NOT_ATTEMPTED"
    || receipt.admission !== "NOT_AUTHORIZED" || !RUN_ID.test(receipt.runId)
    || !REVISION.test(receipt.recipeRevision) || receipt.subject !== policy.subject
    || JSON.stringify(receipt.auditBinding) !== JSON.stringify(auditBinding)) {
    fail("seaweed_remote_runtime_receipt_invalid");
  }
  let material;
  try { material = remoteCandidate.validateRemoteSeaweedRuntimeMaterialReceipt(receipt.material, policy); }
  catch { fail("seaweed_remote_runtime_receipt_invalid"); }
  if (material.runId !== receipt.runId || material.recipeRevision !== receipt.recipeRevision
    || material.subject !== receipt.subject || material.image?.imageId !== policy.candidate.imageId) {
    fail("seaweed_remote_runtime_receipt_invalid");
  }
  const suite = validateSuite(receipt.suite, { imageId: material.image.imageId,
    runId: receipt.runId, recipeRevision: receipt.recipeRevision });
  return cloneFrozen({ ...receipt, auditBinding, material, suite });
}

export async function withVerifiedRemoteSeaweedRuntimeCandidate(inputValue, dependencies = {}) {
  const input = validateInput(inputValue); const deps = validateDependencies(dependencies);
  if (typeof deps.materialize !== "function" || typeof deps.validateMaterialReceipt !== "function") {
    fail("seaweed_remote_runtime_arguments_invalid");
  }
  let diagnosticFailure = null;
  let materialized;
  const inspectRuntime = async (context) => {
    const runtimeInput = validateMaterialContext(context, input);
    const expected = { imageId: runtimeInput.imageId, runId: runtimeInput.runId,
      recipeRevision: runtimeInput.recipeRevision };
    try {
      const basic = validateSeaweedRuntimeProfileProof(await deps.verifyRuntime(runtimeInput), expected);
      const persistence = validateSeaweedRuntimePersistenceProof(await deps.verifyPersistence(runtimeInput), expected);
      const strictResult = await deps.verifyStrict(runtimeInput);
      if (!exactKeys(strictResult, ["runtimeProof", "strictContentionProof"])) {
        fail("seaweed_remote_runtime_suite_invalid");
      }
      const strict = { runtimeProof: validateSeaweedRuntimeProfileProof(strictResult.runtimeProof, expected),
        strictProof: validateSeaweedRuntimeStrictContentionProof(strictResult.strictContentionProof, expected) };
      const backup = validateSeaweedRuntimeBackupRestoreProof(await deps.verifyBackup(runtimeInput), expected);
      const hostLoopback = validateSeaweedRuntimeHostLoopbackProof(await deps.verifyHostLoopback(runtimeInput), expected);
      return validateSuite({ basic, persistence, strict, backup, hostLoopback }, expected);
    } catch (error) {
      diagnosticFailure = sanitizeRuntimeFailure(error);
      throw new Error("seaweed_remote_runtime_diagnostics_failed", { cause: error });
    }
  };
  try {
    materialized = await deps.materialize({ parent: input.parent, policy: input.policy, runId: input.runId,
      recipeRevision: input.recipeRevision, signal: input.signal, validateFilesystem: input.validateFilesystem,
      validateRuntimeConfig: input.validateRuntimeConfig }, inspectRuntime);
  } catch (error) {
    const observed = sanitizeProviderFailure(error);
    const providerFailure = diagnosticFailure !== null && observed.primaryFailure === null
      ? cloneFrozen({ ...observed, inspectionFailed: true,
        primaryFailure: "seaweed_remote_runtime_diagnostics_failed" }) : observed;
    throw aggregateFailure(diagnosticFailure, providerFailure);
  }
  if (!exactKeys(materialized, ["material", "runtime"])) {
    throw aggregateFailure(diagnosticFailure, sanitizeProviderFailure(undefined));
  }
  let material; let suite;
  try {
    material = deps.validateMaterialReceipt(materialized.material, input.policy);
    suite = validateSuite(materialized.runtime, { imageId: material.image.imageId,
      runId: input.runId, recipeRevision: input.recipeRevision });
  } catch {
    throw aggregateFailure(cloneFrozen({ code: "seaweed_remote_runtime_diagnostics_failed", phase: null,
      reason: null, runtimeCleanupFailure: null }), sanitizeProviderFailure(undefined));
  }
  return validateRemoteSeaweedRuntimeCandidateReceipt({
    kind: "SEAWEED_REMOTE_RUNTIME_CANDIDATE_RECEIPT_V1", state: "VERIFIED", authority: "DIAGNOSTIC_ONLY",
    candidateAuthorization: "NOT_AUTHORIZED", publication: "PUBLISHED_UNADMITTED",
    imageExecution: "VERIFIED_DIAGNOSTIC", vulnerabilityAudit: "EXACT_REMOTE_AUDIT_COMPLETE",
    registryWrite: "NOT_ATTEMPTED", signing: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED",
    runId: input.runId, recipeRevision: input.recipeRevision, subject: input.policy.subject,
    auditBinding: input.auditBinding, material, suite,
  }, input.policy, input.auditBinding);
}
