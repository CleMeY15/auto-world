import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, readdirSync, rmdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { executeCandidateAudit } from "../seaweed-image/candidate-audit.mjs";
import { validateDatabaseRegistryManifest } from "../scanner/audit.mjs";
import { validateDatabaseMetadata } from "../scanner/audit-policy.mjs";
import { captureFiles } from "../scanner/controls.mjs";
import { evaluateLocalPostgresGosuAudit } from "./audit-policy.mjs";
import { executePostgresScannerControls, postgresCandidateInputDockerArguments,
  preparePostgresScannerControls } from "./scan.mjs";
import { validatePostgresRemoteCandidateReceipt, validatePostgresRemotePolicy,
  validatePostgresRemotePublicationReceipt, withVerifiedRemotePostgresCandidate } from "./candidate-remote.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const WORKFLOW_REF = "CleMeY15/auto-world/.github/workflows/postgres-candidate-remote-audit.yml@refs/heads/main";
const MAIN_BRANCH_URL = "https://api.github.com/repos/CleMeY15/auto-world/branches/main";
const POLICY_PATH = "infra/postgres-image/candidate-remote.json";
const PUBLICATION_RECEIPT_PATH = "infra/postgres-image/candidate-publication-receipt.json";
const AUDIT_KIND = "POSTGRES_EXACT_REMOTE_CANDIDATE_AUDIT_V1";
const MiB = 1024 ** 2;
const REVISION = /^[0-9a-f]{40}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ARTIFACTS = Object.freeze({ "audit-receipt.json": 8 * MiB,
  "candidate-vulnerabilities.json": 64 * MiB, "candidate-sbom.cdx.json": 64 * MiB,
  "database-evidence.json": 8 * MiB,
  "database-vulnerability-before-manifest.json": MiB, "database-vulnerability-after-manifest.json": MiB,
  "database-java-before-manifest.json": MiB, "database-java-after-manifest.json": MiB,
  "scanner-self.json": 64 * MiB, "scanner-self.cdx.json": 64 * MiB, "scanner-version-probe.json": 64 * MiB,
  "fixture-gomod-vulnerable-candidate.json": 64 * MiB, "fixture-gomod-vulnerable-baseline.json": 64 * MiB,
  "fixture-java-war-vulnerable-candidate.json": 64 * MiB, "fixture-java-war-vulnerable-baseline.json": 64 * MiB,
  "fixture-java-jar-clean-candidate-candidate.json": 64 * MiB });
const CONTROL_REPORTS = Object.freeze(Object.keys(ARTIFACTS).filter((file) => file.startsWith("scanner-") || file.startsWith("fixture-")));
const RECEIPT_FIELDS = ["kind", "state", "authority", "candidateAuthorization", "publication", "registryWrite", "admission",
  "imageExecution", "runId", "recipeRevision", "phase", "containerCleanup", "scanner", "databases",
  "subject", "reports", "scannerControls", "candidate", "registrySubject", "scannerInput", "findingCount", "blockerCount",
  "blockers", "blockersTruncated", "inventory", "failure", "artifactBytes", "supportStartedAt", "supportEndsAt", "archiveUntil"];
const PHASES = new Set(["PREPARE", "SCANNER_REPRODUCIBILITY", "BASELINE_CARRIER", "DATABASE_REGISTRY",
  "DATABASE_DOWNLOAD", "DATABASE_FRESHNESS", "SCANNER_CONTROLS", "CANDIDATE_MATERIALIZE", "ARCHIVE_IDENTITY",
  "VULNERABILITY_SCAN", "SBOM_SCAN", "REPORT_POLICY", "CANDIDATE_CLEANUP", "COMPLETE"]);
const SENSITIVE_VALUE = /(?:ghp_[a-z0-9]+|github_pat_[a-z0-9_]+|bearer\s+[a-z0-9._~+/-]{8,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/iu;
const SENSITIVE_KEY = /^(?:authorization|password|passwd|access[_-]?token|secret[_-]?token|github[_-]?token|auths|private[_-]?key)$/iu;

function fail(code) { throw new Error(code); }
function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value, keys) {
  return plain(value) && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function fixedReason(error) {
  return /^(?:postgres_remote_audit|postgres_remote_candidate|postgres_remote_publication|postgres_gosu_audit|postgres_scan|seaweed_audit|scanner)_[a-z0-9_]{1,64}$/u.test(error?.message ?? "")
    || error?.message === "postgres_candidate_inspection_failed" ? error.message : "postgres_remote_audit_failed";
}

export function requirePostgresRemoteAuditContext(env, { platform = process.platform,
  uid = process.getuid?.(), gid = process.getgid?.() } = {}) {
  if (platform !== "linux" || !Number.isSafeInteger(uid) || uid < 1 || !Number.isSafeInteger(gid) || gid < 1
    || env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted" || env.GITHUB_JOB !== "audit"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_REPOSITORY !== "CleMeY15/auto-world" || env.GITHUB_WORKFLOW_REF !== WORKFLOW_REF
    || env.GITHUB_RUN_NUMBER !== "1" || env.GITHUB_RUN_ATTEMPT !== "1"
    || !REVISION.test(env.GITHUB_SHA ?? "") || !RUN_ID.test(env.GITHUB_RUN_ID ?? "")
    || [env.RUNNER_TEMP, env.GITHUB_WORKSPACE].some((value) => typeof value !== "string"
      || !path.isAbsolute(value) || path.normalize(value) !== value)) fail("postgres_remote_audit_context_invalid");
  try {
    if (realpathSync(env.RUNNER_TEMP) !== env.RUNNER_TEMP || realpathSync(env.GITHUB_WORKSPACE) !== env.GITHUB_WORKSPACE) {
      fail("postgres_remote_audit_context_invalid");
    }
  } catch { fail("postgres_remote_audit_context_invalid"); }
  return Object.freeze({ root: path.join(env.RUNNER_TEMP, "postgres-candidate-remote-audit-work"),
    output: path.join(env.RUNNER_TEMP, "postgres-candidate-remote-audit-evidence"),
    builds: path.join(env.RUNNER_TEMP, "scanner-builds"), workspace: env.GITHUB_WORKSPACE,
    runId: env.GITHUB_RUN_ID, recipeRevision: env.GITHUB_SHA, uid, gid });
}

function defaultCommandRunner(command, args, options) {
  return spawnSync(command, args, { cwd: options.cwd, encoding: null, env: options.env,
    maxBuffer: options.maxBuffer, timeout: options.timeoutMs, windowsHide: true });
}
function readBoundedRegularFile(file, cap, uid) {
  let handle;
  try {
    handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(handle); const info = lstatSync(file);
    if (!before.isFile() || before.nlink !== 1 || info.isSymbolicLink()
      || before.dev !== info.dev || before.ino !== info.ino || before.size < 2 || before.size > cap
      || uid !== undefined && (before.uid !== uid || (before.mode & 0o777) !== 0o600)) {
      fail("postgres_remote_audit_input_invalid");
    }
    const bytes = readFileSync(handle); const after = fstatSync(handle);
    if (bytes.length !== before.size || after.dev !== before.dev || after.ino !== before.ino
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail("postgres_remote_audit_input_invalid");
    return bytes;
  } catch { fail("postgres_remote_audit_input_invalid"); }
  finally { if (handle !== undefined) closeSync(handle); }
}
function parseJson(bytes) {
  try { return JSON.parse(bytes.toString("utf8")); } catch { fail("postgres_remote_audit_input_invalid"); }
}
function committedBytes(relative, cap, context, commandRunner) {
  if (context.workspace !== ROOT) fail("postgres_remote_audit_checkout_invalid");
  const bytes = readBoundedRegularFile(path.join(ROOT, ...relative.split("/")), cap);
  const result = commandRunner("git", ["show", `HEAD:${relative}`], { cwd: context.workspace,
    env: { PATH: process.env.PATH ?? "", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" }, maxBuffer: cap + 1, timeoutMs: 60_000 });
  if (result?.error || result?.status !== 0 || !Buffer.isBuffer(result.stdout)
    || result.stdout.length > cap || !result.stdout.equals(bytes)) fail("postgres_remote_audit_input_uncommitted");
  return bytes;
}
async function readBoundedResponse(response) {
  if (response?.status !== 200 || !response.body) fail("postgres_remote_audit_main_invalid");
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 256 * 1024) { await reader.cancel(); fail("postgres_remote_audit_main_invalid"); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}
export async function verifyPostgresRemoteAuditMain(context, env, { commandRunner = defaultCommandRunner,
  fetchImpl = globalThis.fetch, timeoutMs = 60_000 } = {}) {
  const token = env.GITHUB_TOKEN;
  if (typeof token !== "string" || token.length < 1 || token.length > 8192 || env.GH_TOKEN !== token
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) fail("postgres_remote_audit_environment_invalid");
  const options = { cwd: context.workspace, env: { PATH: env.PATH ?? "", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
    maxBuffer: 256 * 1024, timeoutMs: 60_000 };
  const status = commandRunner("git", ["status", "--porcelain", "--untracked-files=normal"], options);
  const head = commandRunner("git", ["rev-parse", "HEAD"], options);
  if (status?.error || status?.status !== 0 || !Buffer.isBuffer(status.stdout) || status.stdout.length !== 0
    || head?.error || head?.status !== 0 || !Buffer.isBuffer(head.stdout)
    || head.stdout.toString("utf8").trim() !== context.recipeRevision) fail("postgres_remote_audit_checkout_invalid");
  const controller = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(MAIN_BRANCH_URL, { redirect: "error", signal: controller.signal, headers: {
      Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`,
      "User-Agent": "auto-world-postgres-remote-audit", "X-GitHub-Api-Version": "2022-11-28" } });
    const branch = parseJson(await readBoundedResponse(response));
    if (branch?.name !== "main" || branch?.protected !== true || branch?.commit?.sha !== context.recipeRevision) {
      fail("postgres_remote_audit_main_invalid");
    }
    return true;
  } catch { fail("postgres_remote_audit_main_invalid"); }
  finally { globalThis.clearTimeout(timer); }
}

export function projectPostgresRemoteAuditSnapshot(snapshot, context, policy, projectionContext) {
  const proof = snapshot?.archiveProof;
  if (!plain(snapshot) || !plain(proof) || typeof snapshot.file !== "string" || !path.isAbsolute(snapshot.file)
    || !snapshot.file.startsWith(`${context.root}${path.sep}`) || !isDeepStrictEqual(snapshot.policy, policy)
    || snapshot.subject !== policy.subject || snapshot.runId !== context.runId
    || snapshot.recipeRevision !== context.recipeRevision || snapshot.signal?.aborted
    || snapshot.imageId !== policy.candidate.imageId || proof.imageId !== snapshot.imageId
    || proof.configDigest !== snapshot.imageId || !isDeepStrictEqual(snapshot.diffIds, policy.candidate.diffIds)
    || !isDeepStrictEqual(proof.diffIds, policy.candidate.diffIds) || !SHA256.test(proof.archiveSha256 ?? "")
      || !Number.isSafeInteger(proof.archiveBytes) || proof.archiveBytes < 1024 || proof.archiveBytes > 2 * 1024 ** 3
    || proof.archiveSha256 !== projectionContext.archiveIdentity?.sha256
    || proof.archiveBytes !== projectionContext.archiveIdentity?.size
    || projectionContext.artifactName !== "/candidate/saved.tar") fail("postgres_remote_audit_snapshot_invalid");
  const subject = { artifactName: projectionContext.artifactName, imageId: snapshot.imageId,
    archiveSha256: proof.archiveSha256, tag: proof.tag, configDigest: proof.configDigest, diffIds: proof.diffIds };
  return { subject, receiptSubject: { ...subject, archiveBytes: proof.archiveBytes },
    policyInput: { archiveEvidence: subject, databaseEvidence: projectionContext.databaseEvidence } };
}

export function validatePostgresRemoteAuditCandidateReceipt(receipt, proof, context, policy,
  validate = validatePostgresRemoteCandidateReceipt) {
  validate(receipt, policy);
  if (receipt?.runId !== context.runId || receipt.recipeRevision !== context.recipeRevision
    || receipt.subject !== policy.subject || receipt.image?.imageId !== proof?.imageId
    || receipt.archive?.imageId !== proof?.imageId || !isDeepStrictEqual(receipt.image?.diffIds, proof?.diffIds)
    || !isDeepStrictEqual(receipt.archive?.diffIds, proof?.diffIds)
    || receipt.archive?.archiveSha256 !== proof?.archiveSha256 || receipt.archive?.archiveBytes !== proof?.archiveBytes) {
    fail("postgres_remote_audit_candidate_receipt_invalid");
  }
  return true;
}

export function evaluatePostgresRemoteAuditPolicy(input, context, evaluate = evaluateLocalPostgresGosuAudit) {
  const evidence = parseJson(readBoundedRegularFile(path.join(context.output, "database-evidence.json"), 8 * MiB));
  const databases = {};
  for (const [name, suffix] of [["vulnerability", "db/metadata.json"], ["java", "java-db/metadata.json"]]) {
    const observed = evidence?.observed?.[name];
    const matches = evidence?.files?.filter((entry) => entry?.path === path.join(context.root, "scanner-work/cache", suffix)) ?? [];
    if (!plain(observed?.value) || !exactKeys(observed.identity, ["sha256", "size"]) || matches.length !== 1
      || observed.identity.sha256 !== matches[0].sha256 || observed.identity.size !== matches[0].size) {
      fail("postgres_remote_audit_database_binding_invalid");
    }
    const normalized = validateDatabaseMetadata(observed.value, { now: input.now, database: name });
    const supplied = input.databaseEvidence?.[name];
    // Age advances between the engine's freeze and the report; immutable timestamp/version fields must agree.
    if (!plain(supplied) || ["updatedAt", "downloadedAt", "version", "maxAgeMs"].some((key) => normalized[key] !== supplied[key])) {
      fail("postgres_remote_audit_database_binding_invalid");
    }
    databases[name] = observed.value;
  }
  return evaluate({ ...input, databaseEvidence: databases });
}

export async function runPostgresRemoteScannerControls({ context, work, output, lock, scanner, binary,
  buildInventory, docker, cleanupDocker, proofs, frozen, verifyDatabases }, dependencies = {}) {
  if (typeof verifyDatabases !== "function") fail("postgres_remote_audit_database_binding_invalid");
  const prepare = dependencies.prepare ?? preparePostgresScannerControls;
  const { scannerSubject, scannerSubjectCopy, versionProbe, versionProbeFile } = prepare(work,
    { lock, scanner, scannerCopy: binary });
  const fixtureRecords = lock.fixtures.filter((entry) => entry.path.includes("scanner-fixtures/"));
  if (!fixtureRecords.some((entry) => entry.path === "infra/scanner/materials/scanner-fixtures/manifest.json")) {
    fail("postgres_remote_audit_fixture_invalid");
  }
  const fixtureFiles = await captureFiles(fixtureRecords.map((entry) => {
    if (!entry.path.startsWith("infra/scanner/materials/scanner-fixtures/") || entry.path.includes("..")) {
      fail("postgres_remote_audit_fixture_invalid");
    }
    return { path: path.join(ROOT, entry.path), cap: 4 * MiB };
  }));
  if (fixtureFiles.some((entry, index) => entry.sha256 !== fixtureRecords[index].sha256 || entry.size !== fixtureRecords[index].size)) {
    fail("postgres_remote_audit_fixture_invalid");
  }
  const controlInputs = await captureFiles([{ path: scannerSubjectCopy.path, cap: 512 * MiB },
    { path: versionProbeFile, cap: 8 * MiB }]);
  const files = [...frozen, ...fixtureFiles, ...controlInputs];
  await (dependencies.execute ?? executePostgresScannerControls)({ lock, scanner,
    cache: path.join(work, "cache"), output, fixtureRoot: path.join(ROOT, "infra/scanner/materials/scanner-fixtures"),
    versionProbe, subjectRoot: scannerSubject, docker, cleanupDocker, cleanupRecords: proofs,
    frozen: { files, buildInventory }, beforeScan: verifyDatabases });
  const reports = {};
  for (const file of CONTROL_REPORTS) {
    const bytes = readBoundedRegularFile(path.join(output, file), ARTIFACTS[file], context.uid);
    reports[file] = { sha256: sha256(bytes), size: bytes.length };
  }
  return { state: "COMPLETE", reports };
}

function cleanupRoot(context) {
  if (!existsSync(context.root)) return;
  const info = lstatSync(context.root);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== context.uid || (info.mode & 0o777) !== 0o700
    || realpathSync(context.root) !== context.root || readdirSync(context.root).length !== 0) fail("postgres_remote_audit_cleanup_uncertain");
  rmdirSync(context.root);
}
function rejectSensitiveJson(value) {
  const stack = [[value, 0]]; let nodes = 0;
  while (stack.length) {
    const [entry, depth] = stack.pop();
    if (++nodes > 2_000_000 || depth > 64) fail("postgres_remote_audit_artifact_invalid");
    if (typeof entry === "string" && SENSITIVE_VALUE.test(entry)) fail("postgres_remote_audit_artifact_invalid");
    if (entry && typeof entry === "object") {
      for (const [key, child] of Object.entries(entry)) {
        if (SENSITIVE_KEY.test(key)) fail("postgres_remote_audit_artifact_invalid");
        stack.push([child, depth + 1]);
      }
    }
  }
}
function validateArtifactDatabases(documents, receipt, context) {
  const evidence = documents["database-evidence.json"]?.value;
  if (evidence && !exactKeys(evidence, ["checkedAt", "maxAgeMsByDatabase", "files", "observed", "validation"])) {
    fail("postgres_remote_audit_artifact_invalid");
  }
  if (receipt.databases !== undefined) {
    if (!exactKeys(receipt.databases, ["files", "metadata", "registry"]) || !plain(evidence)
      || !isDeepStrictEqual(evidence.files, receipt.databases.files) || !Array.isArray(evidence.files)
      || evidence.files.length !== 4 || !exactKeys(evidence.observed, ["vulnerability", "java"])
      || !exactKeys(receipt.databases.metadata, ["vulnerability", "java"])
      || !Array.isArray(receipt.databases.registry) || receipt.databases.registry.length !== 2) fail("postgres_remote_audit_artifact_invalid");
    const checkedAt = new Date(evidence.checkedAt);
    if (!Number.isFinite(checkedAt.getTime()) || checkedAt.toISOString() !== evidence.checkedAt
      || !isDeepStrictEqual(evidence.maxAgeMsByDatabase, { vulnerability: 48 * 60 * 60 * 1000, java: null })) {
      fail("postgres_remote_audit_artifact_invalid");
    }
    const expectedFiles = ["db/trivy.db", "db/metadata.json", "java-db/trivy-java.db", "java-db/metadata.json"];
    if (evidence.files.some((entry, index) => !exactKeys(entry, ["path", "sha256", "size", "cap"])
      || entry.path !== path.join(context.root, "scanner-work/cache", expectedFiles[index])
      || !SHA256.test(entry.sha256) || !Number.isSafeInteger(entry.size) || entry.size < 1
      || !Number.isSafeInteger(entry.cap) || entry.cap < entry.size || entry.cap > 2 * 1024 ** 3)) {
      fail("postgres_remote_audit_artifact_invalid");
    }
    for (const [name, index] of [["vulnerability", 1], ["java", 3]]) {
      const observed = evidence.observed[name]; const identity = evidence.files[index];
      if (!exactKeys(observed, ["value", "identity"]) || !exactKeys(observed.identity, ["sha256", "size"])
        || !plain(observed.value) || Object.keys(observed.value).some((key) => !["Version", "UpdatedAt", "DownloadedAt", "NextUpdate"].includes(key))
        || observed.identity.sha256 !== identity.sha256 || observed.identity.size !== identity.size
        || !isDeepStrictEqual(validateDatabaseMetadata(observed.value, { now: checkedAt, database: name }), receipt.databases.metadata[name])) {
        fail("postgres_remote_audit_artifact_invalid");
      }
    }
  }
  const registries = receipt.databases?.registry;
  const retainedRegistryChange = receipt.state === "INCOMPLETE"
    && receipt.failure?.code === "seaweed_audit_database_registry_changed"
    && receipt.phase === "DATABASE_DOWNLOAD" && receipt.databases === undefined;
  for (const name of ["vulnerability", "java"]) {
    const before = documents[`database-${name}-before-manifest.json`];
    const after = documents[`database-${name}-after-manifest.json`];
    if (before) validateDatabaseRegistryManifest(before.bytes);
    if (after) {
      validateDatabaseRegistryManifest(after.bytes);
      if (!before || !before.bytes.equals(after.bytes) && !retainedRegistryChange) fail("postgres_remote_audit_artifact_invalid");
    }
    if (registries) {
      const expected = registries.filter((entry) => entry?.name === name);
      if (expected.length !== 1 || !before || !after) fail("postgres_remote_audit_artifact_invalid");
      const actual = validateDatabaseRegistryManifest(before.bytes);
      if (["digest", "size", "layerBytes"].some((key) => expected[0][key] !== actual[key])
        || expected[0].repository !== `ghcr.io/aquasecurity/trivy-${name === "java" ? "java-db" : "db"}`
        || expected[0].tag !== (name === "java" ? "1" : "2")) fail("postgres_remote_audit_artifact_invalid");
    }
  }
}
export function validatePostgresRemoteAuditArtifact(context, dependencies = {}) {
  try {
    const output = lstatSync(context.output);
    if (!output.isDirectory() || output.isSymbolicLink() || output.uid !== context.uid
      || (output.mode & 0o777) !== 0o700 || realpathSync(context.output) !== context.output) fail("postgres_remote_audit_artifact_invalid");
    const files = readdirSync(context.output);
    if (!files.includes("audit-receipt.json") || files.some((file) => !Object.hasOwn(ARTIFACTS, file))) fail("postgres_remote_audit_artifact_invalid");
    let total = 0; const documents = {};
    for (const file of files) {
      const bytes = readBoundedRegularFile(path.join(context.output, file), ARTIFACTS[file], context.uid);
      total += bytes.length; const value = parseJson(bytes);
      if (!plain(value)) fail("postgres_remote_audit_artifact_invalid");
      rejectSensitiveJson(value); documents[file] = { bytes, value };
      if ((file.startsWith("candidate-") || file.startsWith("scanner-") || file.startsWith("fixture-"))
        && !file.endsWith(".cdx.json") && (value.SchemaVersion !== 2 || !Array.isArray(value.Results)
          || Object.keys(value).some((key) => !["SchemaVersion", "CreatedAt", "ArtifactName", "ArtifactType", "Metadata", "Results", "Trivy"].includes(key)))) {
        fail("postgres_remote_audit_artifact_invalid");
      }
      if (file.endsWith(".cdx.json") && (value.bomFormat !== "CycloneDX" || !Array.isArray(value.components)
        || Object.keys(value).some((key) => !["bomFormat", "specVersion", "serialNumber", "version", "metadata", "components", "dependencies", "vulnerabilities"].includes(key)))) {
        fail("postgres_remote_audit_artifact_invalid");
      }
    }
    if (total > 256 * MiB) fail("postgres_remote_audit_artifact_invalid");
    const { value: receipt, bytes } = documents["audit-receipt.json"];
    if (Object.keys(receipt).some((key) => !RECEIPT_FIELDS.includes(key)) || receipt.kind !== AUDIT_KIND
      || !["INCOMPLETE", "BLOCKED", "COMPLETE"].includes(receipt.state) || receipt.authority !== "DIAGNOSTIC_ONLY"
      || receipt.candidateAuthorization !== "NOT_AUTHORIZED" || receipt.admission !== "NOT_AUTHORIZED"
      || receipt.publication !== "NOT_ATTEMPTED" || receipt.registryWrite !== "NOT_ATTEMPTED" || receipt.imageExecution !== "NOT_ATTEMPTED"
      || receipt.supportStartedAt !== null || receipt.supportEndsAt !== null || receipt.archiveUntil !== null
      || receipt.runId !== context.runId || receipt.recipeRevision !== context.recipeRevision || !PHASES.has(receipt.phase)
      || !Array.isArray(receipt.containerCleanup) || receipt.containerCleanup.length > 32
      || !bytes.equals(Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`))) fail("postgres_remote_audit_artifact_invalid");
    if (receipt.failure !== undefined && (!exactKeys(receipt.failure, ["code"])
      || fixedReason({ message: receipt.failure.code }) !== receipt.failure.code)) fail("postgres_remote_audit_artifact_invalid");
    if (receipt.failure && /(?:cleanup|ownership|container_identity)/u.test(receipt.failure.code)) {
      fail("postgres_remote_audit_artifact_invalid");
    }
    if (receipt.containerCleanup.some((entry) => !exactKeys(entry, ["kind", "state"])
      || !/^(?:db-(?:vulnerability|java)|self-json|self-cyclonedx|version-probe|fixture-(?:gomod-vulnerable|java-war-vulnerable|java-jar-clean-candidate)-(?:candidate|baseline)|scan-(?:json|cyclonedx))$/u.test(entry.kind)
      || !["OWNED_CONTAINER_REMOVED", "OWNED_CONTAINER_ABSENT"].includes(entry.state))) fail("postgres_remote_audit_artifact_invalid");
    if (receipt.scanner !== undefined && (!exactKeys(receipt.scanner, ["version", "sourceCommit", "binary", "builds", "lockSha256"])
      || receipt.scanner.version !== "0.74.0-autoworld.2" || !REVISION.test(receipt.scanner.sourceCommit)
      || !exactKeys(receipt.scanner.binary, ["sha256", "size"]) || !SHA256.test(receipt.scanner.binary.sha256)
      || !Number.isSafeInteger(receipt.scanner.binary.size) || receipt.scanner.binary.size < 1
      || receipt.scanner.binary.size > 512 * MiB || !SHA256.test(receipt.scanner.lockSha256)
      || !Array.isArray(receipt.scanner.builds) || receipt.scanner.builds.length !== 2
      || receipt.scanner.builds.some((entry) => !isDeepStrictEqual(entry, receipt.scanner.binary)))) fail("postgres_remote_audit_artifact_invalid");
    validateArtifactDatabases(documents, receipt, context);
    if (receipt.candidate !== undefined) {
      const readCommitted = dependencies.readCommitted ?? committedBytes;
      const policy = (dependencies.policyValidator ?? validatePostgresRemotePolicy)(parseJson(readCommitted(
        POLICY_PATH, 128 * 1024, context, dependencies.commandRunner ?? defaultCommandRunner)));
      (dependencies.remoteReceiptValidator ?? validatePostgresRemoteCandidateReceipt)(receipt.candidate, policy);
      if (receipt.candidate.runId !== context.runId || receipt.candidate.recipeRevision !== context.recipeRevision
        || receipt.registrySubject !== policy.subject || receipt.scannerInput !== "LOCAL_DOCKER_SAVE_ARCHIVE") fail("postgres_remote_audit_artifact_invalid");
      if (!exactKeys(receipt.subject, ["artifactName", "imageId", "archiveSha256", "tag", "configDigest", "diffIds", "archiveBytes"])
        || receipt.subject.artifactName !== "/candidate/saved.tar" || receipt.subject.imageId !== policy.candidate.imageId
        || receipt.subject.configDigest !== policy.candidate.imageId || !isDeepStrictEqual(receipt.subject.diffIds, policy.candidate.diffIds)
        || receipt.subject.archiveSha256 !== receipt.candidate.archive.archiveSha256
        || receipt.subject.archiveBytes !== receipt.candidate.archive.archiveBytes || receipt.subject.tag !== receipt.candidate.alias) {
        fail("postgres_remote_audit_artifact_invalid");
      }
    }
    if (receipt.state !== "INCOMPLETE" && (!receipt.candidate || !receipt.reports || receipt.phase !== "COMPLETE"
      || files.length !== Object.keys(ARTIFACTS).length)) fail("postgres_remote_audit_artifact_invalid");
    if (receipt.reports !== undefined) {
      if (!exactKeys(receipt.reports, ["vulnerability", "cyclonedx"])) fail("postgres_remote_audit_artifact_invalid");
      for (const [name, file] of [["vulnerability", "candidate-vulnerabilities.json"], ["cyclonedx", "candidate-sbom.cdx.json"]]) {
        const identity = receipt.reports[name]; const report = documents[file];
        if (!exactKeys(identity, ["sha256", "size"]) || !report || identity.sha256 !== sha256(report.bytes)
          || identity.size !== report.bytes.length) fail("postgres_remote_audit_artifact_invalid");
      }
    }
    if (receipt.scannerControls !== undefined) {
      if (!exactKeys(receipt.scannerControls, ["state", "reports"]) || receipt.scannerControls.state !== "COMPLETE"
        || !exactKeys(receipt.scannerControls.reports, CONTROL_REPORTS)) fail("postgres_remote_audit_artifact_invalid");
      for (const file of CONTROL_REPORTS) {
        const identity = receipt.scannerControls.reports[file]; const report = documents[file];
        if (!exactKeys(identity, ["sha256", "size"]) || !report || identity.sha256 !== sha256(report.bytes)
          || identity.size !== report.bytes.length) fail("postgres_remote_audit_artifact_invalid");
      }
    }
    if (receipt.state !== "INCOMPLETE" && !receipt.scannerControls) fail("postgres_remote_audit_artifact_invalid");
    if (receipt.state !== "INCOMPLETE") {
      const subject = Object.fromEntries(["artifactName", "imageId", "archiveSha256", "tag", "configDigest", "diffIds"]
        .map((key) => [key, receipt.subject[key]]));
      const evaluation = evaluatePostgresRemoteAuditPolicy({
        vulnerabilityReport: documents["candidate-vulnerabilities.json"].value,
        cyclonedxReport: documents["candidate-sbom.cdx.json"].value, subject, archiveEvidence: subject,
        databaseEvidence: receipt.databases.metadata, now: dependencies.now?.() ?? new Date(),
      }, context, dependencies.evaluatePolicy);
      if (evaluation.state !== receipt.state || evaluation.findings.length !== receipt.findingCount
        || evaluation.blockers.length !== receipt.blockerCount
        || !isDeepStrictEqual(evaluation.blockers.slice(0, 32), receipt.blockers)
        || (evaluation.blockers.length > 32) !== receipt.blockersTruncated
        || !isDeepStrictEqual(evaluation.inventory, receipt.inventory)) fail("postgres_remote_audit_artifact_invalid");
    }
    return true;
  } catch { fail("postgres_remote_audit_artifact_invalid"); }
}
function writePreflightFailure(context, error) {
  if (existsSync(context.output)) return;
  mkdirSync(context.output, { mode: 0o700 });
  const receipt = { kind: AUDIT_KIND, state: "INCOMPLETE", authority: "DIAGNOSTIC_ONLY",
    candidateAuthorization: "NOT_AUTHORIZED", publication: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED",
    registryWrite: "NOT_ATTEMPTED", imageExecution: "NOT_ATTEMPTED", runId: context.runId, recipeRevision: context.recipeRevision,
    phase: "PREPARE", containerCleanup: [], supportStartedAt: null, supportEndsAt: null, archiveUntil: null,
    failure: { code: fixedReason(error) } };
  writeFileSync(path.join(context.output, "audit-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

export async function runPostgresRemoteAudit(argv = process.argv.slice(2), env = process.env, dependencies = {}) {
  if (!Array.isArray(argv) || argv.length !== 1 || !["execute", "cleanup"].includes(argv[0])) fail("postgres_remote_audit_arguments_invalid");
  const context = requirePostgresRemoteAuditContext(env, dependencies.context);
  if (argv[0] === "cleanup") {
    (dependencies.cleanupRoot ?? cleanupRoot)(context);
    (dependencies.validateArtifact ?? validatePostgresRemoteAuditArtifact)(context, dependencies);
    return { state: "CLEANED", authority: "DIAGNOSTIC_ONLY", admission: "NOT_AUTHORIZED" };
  }
  try {
    const commandRunner = dependencies.commandRunner ?? defaultCommandRunner;
    await (dependencies.verifyMain ?? verifyPostgresRemoteAuditMain)(context, env, { commandRunner, fetchImpl: dependencies.fetchImpl });
    const readCommitted = dependencies.readCommitted ?? committedBytes;
    const policy = (dependencies.policyValidator ?? validatePostgresRemotePolicy)(parseJson(readCommitted(POLICY_PATH, 128 * 1024, context, commandRunner)));
    (dependencies.publicationReceiptValidator ?? validatePostgresRemotePublicationReceipt)(parseJson(readCommitted(
      PUBLICATION_RECEIPT_PATH, MiB, context, commandRunner)), policy);
    const provider = dependencies.remoteProvider ?? withVerifiedRemotePostgresCandidate;
    const materialize = ({ parent, runId, recipeRevision, signal }, inspect) => provider({ parent, policy, runId,
      recipeRevision, signal }, inspect, dependencies.remoteProviderDependencies);
    const validateCandidateReceipt = (receipt, proof, selectedContext) => validatePostgresRemoteAuditCandidateReceipt(
      receipt, proof, selectedContext, policy, dependencies.remoteReceiptValidator ?? validatePostgresRemoteCandidateReceipt);
    return await (dependencies.executeAudit ?? executeCandidateAudit)(context, { ...(dependencies.auditDependencies ?? {}),
      auditKind: AUDIT_KIND, materialize, validateCandidateReceipt, inputArguments: postgresCandidateInputDockerArguments,
      scannerControls: (input) => runPostgresRemoteScannerControls(input, dependencies.scannerControlDependencies),
      projectSnapshot: (snapshot, selectedContext) => projectPostgresRemoteAuditSnapshot(snapshot, context, policy, selectedContext),
      evaluatePolicy: (input) => evaluatePostgresRemoteAuditPolicy(input, context, dependencies.evaluatePolicy) });
  } catch (error) { writePreflightFailure(context, error); throw error; }
}

function publicFailure(error) {
  return JSON.stringify({ state: "FAILED", reason: fixedReason(error), authority: "DIAGNOSTIC_ONLY", admission: "NOT_AUTHORIZED" });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPostgresRemoteAudit().then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(publicFailure(error)); process.exitCode = 1; });
}
export { publicFailure as TEST_ONLY_publicPostgresRemoteAuditFailure };
