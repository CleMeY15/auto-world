import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, closeSync, fchmodSync, fstatSync, fsyncSync, lstatSync,
  mkdirSync, openSync, readFileSync, realpathSync, writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { CORE_EVIDENCE, loadPostgresCoreEvidenceAcceptance,
  validatePostgresCoreEvidenceAcceptanceBytes } from "./core-evidence-acceptance.mjs";
import { validatePostgresRemotePolicy, validatePostgresRemotePublicationReceipt } from "./candidate-remote.mjs";
import { verifyPostgresRemoteAuditMain } from "./candidate-remote-audit.mjs";
import { validatePostgresRemoteRuntimePolicy, verifyPostgresRuntimeAuditApi,
  replayPostgresRuntimeAudit } from "./candidate-remote-runtime-diagnostic.mjs";
import { postgresRuntimeAuditValidUntil } from "./runtime-restore-audit.mjs";

export const ATTESTATION = Object.freeze({
  repository: "CleMeY15/auto-world",
  subjectName: "ghcr.io/clemey15/auto-world-postgres-gosu",
  subjectDigest: "sha256:0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93",
  predicateType: "https://github.com/CleMeY15/auto-world/attestations/postgres-private-image-evidence/v1",
  workflowPath: ".github/workflows/postgres-candidate-attest-v2.yml",
});
export const SIGNER_JOB_BUDGET_MS = 20 * 60 * 1000;
export const CURRENT_AUDIT_VALID_UNTIL = "2026-10-02T01:15:45.849Z";
const SUBJECT = `${ATTESTATION.subjectName}@${ATTESTATION.subjectDigest}`;
const WORKFLOW_REF = `${ATTESTATION.repository}/${ATTESTATION.workflowPath}@refs/heads/main`;
const SHA = /^[0-9a-f]{40}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const RUN = /^[1-9][0-9]{0,19}$/u;
const ERROR = "postgres_candidate_attestation_evidence_invalid";
const FILES = Object.freeze({ policy: "infra/postgres-image/candidate-remote.json",
  publication: "infra/postgres-image/candidate-publication-receipt.json",
  runtimePolicy: "infra/postgres-image/candidate-runtime.json",
  coreAcceptance: "infra/postgres-image/core-evidence-acceptance.json",
  coreInventory: "infra/postgres-image/core-evidence-inventory.json",
  controls: "infra/postgres-image/package-controls.json" });
const fail = (code = ERROR) => { throw new Error(code); };
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const identity = bytes => ({ bytes: bytes.length, sha256: sha256(bytes) });
const freeze = value => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const parse = bytes => { try { return JSON.parse(bytes.toString("utf8")); } catch { fail(); } };

// Check data descriptors before touching values. Serialization must not invoke
// inherited toJSON hooks, getters, symbols or sparse-array accessors.
function data(value, depth = 0) {
  if (depth > 32) fail("postgres_candidate_attestation_predicate_invalid");
  if (value === null || ["string", "boolean"].includes(typeof value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object"
    || Object.getPrototypeOf(value) !== (Array.isArray(value) ? Array.prototype : Object.prototype)) {
    fail("postgres_candidate_attestation_predicate_invalid");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (Array.isArray(value)) {
    if (keys.length !== value.length + 1 || descriptors.length.value !== value.length || value.length > 4096) {
      fail("postgres_candidate_attestation_predicate_invalid");
    }
    return Array.from({ length: value.length }, (_unused, index) => {
      const d = descriptors[String(index)];
      if (!d || !Object.hasOwn(d, "value") || !d.enumerable) fail("postgres_candidate_attestation_predicate_invalid");
      return data(d.value, depth + 1);
    });
  }
  if (keys.length > 512 || keys.some(key => typeof key !== "string"
    || !Object.hasOwn(descriptors[key], "value") || !descriptors[key].enumerable)) {
    fail("postgres_candidate_attestation_predicate_invalid");
  }
  return Object.fromEntries(keys.map(key => [key, data(descriptors[key].value, depth + 1)]));
}
function encode(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(encode).join(",")}]`;
  return `{${Object.entries(value).map(([key, child]) => `${JSON.stringify(key)}:${encode(child)}`).join(",")}}`;
}
function exact(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}
function byteIdentity(value) {
  return exact(value, ["bytes", "sha256"]) && HASH.test(value.sha256)
    && Number.isSafeInteger(value.bytes) && value.bytes > 1 && value.bytes <= 8 * 1024 ** 2;
}
const instant = value => typeof value === "string" && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;

function basePredicate(policy, runtimePolicy, core) {
  const groups = ["ACCEPTED_RUNTIME_ORIGINALS", "CANDIDATE_IMAGE_RETENTION", "CURRENT_SOURCE_RECIPE_BUNDLE"];
  return {
    kind: "POSTGRES_CANDIDATE_ATTESTATION_PREDICATE_V1", state: "EVIDENCE_VERIFIED",
    authority: "REVIEWED_MAIN_SIGNER", admission: "NOT_AUTHORIZED",
    subject: { name: ATTESTATION.subjectName, digest: ATTESTATION.subjectDigest,
      platform: policy.platform, imageId: policy.candidate.imageId, manifest: policy.manifest },
    source: { buildRecipeRevision: policy.publisher.recipeRevision, buildRunId: policy.publisher.runId,
      buildWorkflow: policy.publisher.workflowPath, evidenceRecipeRevision: core.acceptance.recipeRevision },
    coreEvidence: { state: core.acceptance.state, acceptance: CORE_EVIDENCE.acceptance,
      inventory: CORE_EVIDENCE.inventory, closedAcknowledgement: core.acceptance.closedAcknowledgement,
      counts: core.acceptance.inventory, policy: core.acceptance.policy, sourceBundle: core.acceptance.sourceBundle,
      legalCompliance: "NOT_EVALUATED", binaryReproduction: "NOT_ESTABLISHED" },
    audit: { state: "COMPLETE", runId: runtimePolicy.audit.runId,
      recipeRevision: runtimePolicy.audit.recipeRevision, artifact: runtimePolicy.audit.artifact,
      receipt: runtimePolicy.audit.receipt, scanner: runtimePolicy.audit.scanner,
      files: runtimePolicy.audit.files, findings: 0, blockers: 0 },
    retainedEvidence: groups.map(id => {
      const group = core.inventory.groups.find(item => item.id === id);
      if (!group) fail();
      return group;
    }),
    support: { durationFromActivation: "P1Y", archiveRetentionAfterSupport: "P365D",
      supportStartsAt: null, supportEndsAt: null, archiveRetainUntil: null,
      continuousSecurityControls: "REQUIRED_DURING_SUPPORT", automaticDeletion: false },
    settingsObservation: parse(readFileSync(new URL(`../../${FILES.controls}`, import.meta.url))),
  };
}

export function validateCandidateAttestationPredicate(value, expected) {
  const candidate = data(value); const comparison = data(expected);
  if (!exact(candidate, ["kind", "state", "authority", "admission", "subject", "source", "coreEvidence",
    "audit", "retainedEvidence", "support", "settingsObservation", "signer", "access", "currentness"])
    || !isDeepStrictEqual(candidate, comparison)) fail("postgres_candidate_attestation_predicate_invalid");
  const policy = validatePostgresRemotePolicy(parse(readFileSync(new URL(`../../${FILES.policy}`, import.meta.url))));
  const runtimePolicy = validatePostgresRemoteRuntimePolicy(parse(readFileSync(
    new URL(`../../${FILES.runtimePolicy}`, import.meta.url))), policy);
  const base = basePredicate(policy, runtimePolicy, loadPostgresCoreEvidenceAcceptance());
  for (const [key, fixed] of Object.entries(base)) {
    if (!isDeepStrictEqual(candidate[key], fixed)) fail("postgres_candidate_attestation_predicate_invalid");
  }
  if (!exact(candidate.signer, ["runId", "recipeRevision", "workflow", "ref"])
    || !RUN.test(candidate.signer.runId) || !SHA.test(candidate.signer.recipeRevision)
    || candidate.signer.workflow !== ATTESTATION.workflowPath || candidate.signer.ref !== "refs/heads/main"
    || !exact(candidate.access, ["receipt", "controls", "artifact", "registryRead", "anonymousRead", "forkIsolation"])
    || !byteIdentity(candidate.access.receipt) || !byteIdentity(candidate.access.controls)
    || !isDeepStrictEqual(candidate.access.controls, identity(readFileSync(new URL(`../../${FILES.controls}`, import.meta.url))))
    || !exact(candidate.access.artifact, ["id", "name", "size", "digest"])
    || !Number.isSafeInteger(candidate.access.artifact.id) || candidate.access.artifact.id < 1
    || candidate.access.artifact.name !== "postgres-candidate-attestation-access"
    || !Number.isSafeInteger(candidate.access.artifact.size) || candidate.access.artifact.size < 1
    || candidate.access.artifact.size > 8 * 1024 ** 2
    || !/^sha256:[0-9a-f]{64}$/u.test(candidate.access.artifact.digest)
    || candidate.access.registryRead !== "AUTHENTICATED_BEFORE_AND_AFTER"
    || candidate.access.anonymousRead !== "AUTHORIZATION_DENIED"
    || candidate.access.forkIsolation !== "NOT_VERIFIED"
    || !exact(candidate.currentness, ["checkedAt", "validUntil", "signerBudgetMs", "javaMaxAgeMs"])
    || !instant(candidate.currentness.checkedAt) || !instant(candidate.currentness.validUntil)
    || candidate.currentness.validUntil !== CURRENT_AUDIT_VALID_UNTIL
    || candidate.currentness.signerBudgetMs !== SIGNER_JOB_BUDGET_MS || candidate.currentness.javaMaxAgeMs !== null
    || Date.parse(candidate.currentness.checkedAt) + SIGNER_JOB_BUDGET_MS >= Date.parse(candidate.currentness.validUntil)) {
    fail("postgres_candidate_attestation_predicate_invalid");
  }
  return freeze(candidate);
}

function readRegular(file, cap, uid) {
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(fd, { bigint: true }); const named = lstatSync(file, { bigint: true });
    const same = next => ["dev", "ino", "mode", "nlink", "uid", "gid", "size", "mtimeNs", "ctimeNs"]
      .every(key => before[key] === next[key]);
    if (!before.isFile() || before.nlink !== 1n || before.uid !== BigInt(uid)
      || (before.mode & 0o022n) !== 0n || before.size < 2n || before.size > BigInt(cap) || !same(named)) fail();
    const bytes = readFileSync(fd);
    if (BigInt(bytes.length) !== before.size || !same(fstatSync(fd, { bigint: true }))
      || !same(lstatSync(file, { bigint: true }))) fail();
    return bytes;
  } finally { if (fd !== undefined) closeSync(fd); }
}
function command(commandName, args, options) {
  return spawnSync(commandName, args, { cwd: options.cwd, env: options.env, encoding: null,
    maxBuffer: options.maxBuffer, timeout: options.timeoutMs, windowsHide: true });
}
function committed(relative, context, runner) {
  const bytes = readRegular(path.join(context.workspace, relative), 4 * 1024 ** 2, context.uid);
  const result = runner("git", ["show", `HEAD:${relative}`], { cwd: context.workspace,
    env: { PATH: process.env.PATH ?? "", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
    maxBuffer: 4 * 1024 ** 2 + 1, timeoutMs: 60_000 });
  if (result?.error || result?.status !== 0 || !Buffer.isBuffer(result.stdout) || !result.stdout.equals(bytes)) fail();
  return bytes;
}
function contextFor(input, env, native = {}) {
  const uid = native.uid ?? process.getuid?.(); const gid = native.gid ?? process.getgid?.();
  if (!exact(input, ["workspace", "now"]) || !(input.now instanceof Date) || !Number.isFinite(input.now.getTime())
    || (native.platform ?? process.platform) !== "linux" || !Number.isSafeInteger(uid) || uid < 1
    || !Number.isSafeInteger(gid) || gid < 1 || env.GITHUB_ACTIONS !== "true"
    || env.RUNNER_ENVIRONMENT !== "github-hosted" || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_JOB !== "signer" || env.GITHUB_REPOSITORY !== ATTESTATION.repository
    || env.GITHUB_REF !== "refs/heads/main" || env.GITHUB_WORKFLOW_REF !== WORKFLOW_REF
    || env.GITHUB_RUN_NUMBER !== "1" || env.GITHUB_RUN_ATTEMPT !== "1"
    || !RUN.test(env.GITHUB_RUN_ID ?? "") || !SHA.test(env.GITHUB_SHA ?? "")
    || env.GITHUB_WORKSPACE !== input.workspace || !path.isAbsolute(input.workspace)
    || path.normalize(input.workspace) !== input.workspace || typeof env.RUNNER_TEMP !== "string"
    || !path.isAbsolute(env.RUNNER_TEMP) || path.normalize(env.RUNNER_TEMP) !== env.RUNNER_TEMP) {
    fail("postgres_candidate_attestation_context_invalid");
  }
  for (const directory of [input.workspace, env.RUNNER_TEMP]) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid
      || (stat.mode & 0o022) !== 0 || realpathSync(directory) !== directory) fail("postgres_candidate_attestation_context_invalid");
  }
  return { workspace: input.workspace, uid, gid, recipeRevision: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID,
    auditDirectory: path.join(env.RUNNER_TEMP, "postgres-candidate-attestation-audit-input"),
    accessDirectory: path.join(env.RUNNER_TEMP, "postgres-candidate-attestation-access-input"),
    output: path.join(env.RUNNER_TEMP, "postgres-candidate-attestation") };
}
function writeExclusive(file, bytes, uid) {
  let fd;
  try {
    fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    fchmodSync(fd, 0o600); let offset = 0;
    while (offset < bytes.length) {
      const count = writeSync(fd, bytes, offset, bytes.length - offset);
      if (!Number.isSafeInteger(count) || count < 1) fail();
      offset += count;
    }
    fsyncSync(fd);
  } finally { if (fd !== undefined) closeSync(fd); }
  if (!readRegular(file, 4 * 1024 ** 2, uid).equals(bytes)) fail();
}

export async function prepareCandidateAttestation(input, env = process.env, dependencies = {}) {
  const context = contextFor(input, env, dependencies.context);
  const runner = dependencies.commandRunner ?? command;
  const read = dependencies.readCommitted ?? committed;
  await (dependencies.verifyMain ?? verifyPostgresRemoteAuditMain)(context, env, { commandRunner: runner });
  const bytes = Object.fromEntries(Object.entries(FILES).map(([key, relative]) => [key, read(relative, context, runner)]));
  const policy = validatePostgresRemotePolicy(parse(bytes.policy));
  if (policy.subject !== SUBJECT) fail();
  validatePostgresRemotePublicationReceipt(parse(bytes.publication), policy);
  const runtimePolicy = validatePostgresRemoteRuntimePolicy(parse(bytes.runtimePolicy), policy);
  const core = validatePostgresCoreEvidenceAcceptanceBytes(bytes.coreAcceptance, bytes.coreInventory);
  await (dependencies.verifyAuditApi ?? verifyPostgresRuntimeAuditApi)(runtimePolicy, env, { now: () => input.now });
  const audit = (dependencies.replayAudit ?? replayPostgresRuntimeAudit)(context.auditDirectory, runtimePolicy, context,
    { now: () => input.now, readCommitted: (relative, _cap, actual, commandRunner) => read(relative, actual, commandRunner), commandRunner: runner });
  const validUntil = new Date(postgresRuntimeAuditValidUntil(
    parse(readRegular(path.join(context.auditDirectory, "database-evidence.json"), 4 * 1024 ** 2, context.uid)),
    parse(readRegular(path.join(context.auditDirectory, "candidate-vulnerabilities.json"), 4 * 1024 ** 2, context.uid)), input.now));
  if (validUntil.toISOString() !== CURRENT_AUDIT_VALID_UNTIL || audit.receipt.state !== "COMPLETE") fail();
  if (!Number.isFinite(validUntil.getTime()) || input.now.getTime() + SIGNER_JOB_BUDGET_MS >= validUntil.getTime()) {
    fail("postgres_candidate_attestation_signing_window_expired");
  }
  // Intake and access receipt validators are imported only in preparation; the
  // official verifier's pure predicate checks need no package credential.
  const accessModule = await import("./candidate-attestation-access.mjs");
  const intake = await import("./attestation-artifact-input.mjs");
  const accessBytes = readRegular(path.join(context.accessDirectory, "access-receipt.json"), 1024 ** 2, context.uid);
  const access = await (dependencies.validateAccess ?? accessModule.validatePostgresAttestationAccessReceipt)(
    parse(accessBytes), policy, { runId: context.runId, recipeRevision: context.recipeRevision, controlsIdentity: identity(bytes.controls) });
  const descriptor = await (dependencies.verifyAccessArtifact ?? intake.verifyCurrentRunArtifactApi)(
    "access", Number(env.POSTGRES_ATTESTATION_ACCESS_ARTIFACT_ID), env);
  const artifact = Object.fromEntries(["id", "name", "size", "digest"].map(key => [key, descriptor[key]]));
  const predicate = { ...basePredicate(policy, runtimePolicy, core),
    signer: { runId: context.runId, recipeRevision: context.recipeRevision, workflow: ATTESTATION.workflowPath, ref: "refs/heads/main" },
    access: { receipt: identity(accessBytes), controls: identity(bytes.controls), artifact,
      registryRead: "AUTHENTICATED_BEFORE_AND_AFTER", anonymousRead: "AUTHORIZATION_DENIED", forkIsolation: "NOT_VERIFIED" },
    currentness: { checkedAt: input.now.toISOString(), validUntil: validUntil.toISOString(),
      signerBudgetMs: SIGNER_JOB_BUDGET_MS, javaMaxAgeMs: null } };
  if (!access) fail();
  validateCandidateAttestationPredicate(predicate, predicate);
  mkdirSync(context.output, { mode: 0o700 });
  const predicateBytes = Buffer.from(`${encode(data(predicate))}\n`);
  const receipt = { kind: "POSTGRES_CANDIDATE_PRE_SIGN_RECEIPT_V1", state: "EVIDENCE_VERIFIED",
    authority: "REVIEWED_MAIN_SIGNER", candidateAuthorization: "NOT_AUTHORIZED", admission: "NOT_AUTHORIZED",
    signing: "PENDING_OFFICIAL_ACTION", repository: ATTESTATION.repository, workflowPath: ATTESTATION.workflowPath,
    sourceRef: "refs/heads/main", runId: context.runId, runNumber: "1", runAttempt: "1", recipeRevision: context.recipeRevision,
    subject: { name: ATTESTATION.subjectName, digest: ATTESTATION.subjectDigest },
    predicate: { type: ATTESTATION.predicateType, sha256: sha256(predicateBytes), bytes: predicateBytes.length, file: "predicate.json" } };
  writeExclusive(path.join(context.output, "predicate.json"), predicateBytes, context.uid);
  writeExclusive(path.join(context.output, "pre-sign-receipt.json"), Buffer.from(`${encode(data(receipt))}\n`), context.uid);
  return freeze({ predicatePath: path.join(context.output, "predicate.json"), receiptPath: path.join(context.output, "pre-sign-receipt.json"), predicate, receipt });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== "prepare") {
    console.error(JSON.stringify({ state: "FAILED", code: "postgres_candidate_attestation_arguments_invalid", admission: "NOT_AUTHORIZED" }));
    process.exitCode = 1;
  } else prepareCandidateAttestation({ workspace: process.env.GITHUB_WORKSPACE, now: new Date() }).then(() =>
    console.log(JSON.stringify({ state: "EVIDENCE_VERIFIED", admission: "NOT_AUTHORIZED" }))).catch(error => {
      console.error(JSON.stringify({ state: "FAILED", code: /^postgres_candidate_attestation_[a-z_]+$/u.test(error?.message ?? "")
        ? error.message : "postgres_candidate_attestation_failed", admission: "NOT_AUTHORIZED" }));
      process.exitCode = 1;
    });
}
