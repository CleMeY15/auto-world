import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, TextDecoder } from "node:util";

import { validatePostgresPackageControls } from "./candidate-attestation-access.mjs";
import { validatePostgresRemoteCandidateReceipt, validatePostgresRemotePolicy } from "./candidate-remote.mjs";
import { evaluateLocalPostgresGosuAudit, validatePostgresGosuReportInventory } from "./audit-policy.mjs";
import { postgresRuntimeAuditValidUntil } from "./runtime-restore-audit.mjs";
import { validateDatabaseRegistryManifest } from "../scanner/audit.mjs";
import {
  loadPostgresAdmissionArchiveContext,
  verifyPostgresAdmissionArchiveFast,
} from "./admission-archive-maintenance.mjs";

const ERROR = "postgres_admission_authority_denied";
const REVOKED = "postgres_admission_authority_revoked";
const EXPIRED = "postgres_admission_lease_expired";
const ROOT = "/opt/auto-world/postgres-admission";
const HIGH_WATER = `${ROOT}/high-water.json`;
const INTENT = `${ROOT}/.high-water-update.intent`;
const TEMPORARY = `${ROOT}/.high-water-update.tmp`;
const INITIALIZED = `${ROOT}/authority-state-initialized.json`;
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REPOSITORY = "CleMeY15/auto-world";
const REF = "refs/heads/main";
const API_VERSION = "2026-03-10";
const AUTHORITY_PATHS = Object.freeze([
  "infra/postgres-image/admission-policy.json",
  "infra/postgres-image/admission-inventory.json",
  "infra/postgres-image/package-controls.json",
]);
const STATES = Object.freeze(["PENDING", "ACTIVE", "REVOKED"]);
const PHASES = Object.freeze(["AUTHORITY", "IMAGE_ACQUIRE", "DAEMON_START", "IMAGE_LOAD", "VOLUME_CREATE",
  "CONTAINER_CREATE", "CONTAINER_START", "READINESS", "SERVICE", "SQL_CHECK", "MIGRATION", "BACKUP",
  "RESTORE_VERIFY", "STOP", "CLEANUP"]);
const WAIVERS = Object.freeze([
  "JAVA_DATABASE_MAX_AGE_NOT_ENFORCED",
  "EXTERNAL_AUTHENTICATED_FORK_PROBE_SKIPPED_BY_USER",
]);
const SHA256 = /^[0-9a-f]{64}$/u;
const SHA1 = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const FILE_BYTES = 1024 ** 2;
const TOTAL_BYTES = 8 * 1024 ** 2;
const REQUEST_MS = 5_000;
const BOOTSTRAP_MS = 30_000;
const RENEWAL_MS = 20_000;
const LEASE_MS = 60_000;
const PACKAGE_CONTROLS_MS = 24 * 60 * 60 * 1000;
const MANIFEST_ACCESS_MS = 15 * 60 * 1000;
const ARCHIVE_FULL_MS = 24 * 60 * 60 * 1000;
const MAX_REVISIONS = 1024;
const MAX_EXECUTION_FILES = 128;
const AUDIT_ROLES = Object.freeze([
  "audit-receipt.json", "candidate-sbom.cdx.json", "candidate-vulnerabilities.json", "database-evidence.json",
  "database-java-after-manifest.json", "database-java-before-manifest.json",
  "database-vulnerability-after-manifest.json", "database-vulnerability-before-manifest.json",
  "fixture-gomod-vulnerable-baseline.json", "fixture-gomod-vulnerable-candidate.json",
  "fixture-java-jar-clean-candidate-candidate.json", "fixture-java-war-vulnerable-baseline.json",
  "fixture-java-war-vulnerable-candidate.json", "scanner-self.cdx.json", "scanner-self.json",
  "scanner-version-probe.json",
]);
const CONTROL_ROLES = Object.freeze(AUDIT_ROLES.filter((role) => role.startsWith("scanner-") || role.startsWith("fixture-")));
const leases = new WeakMap();
const sessions = new WeakMap();

function deny() { throw new Error(ERROR); }
function denyRevoked() { throw new Error(REVOKED); }
function need(value) { if (!value) deny(); return value; }
function plain(value) { return value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype; }
function exact(value, keys) {
  need(plain(value) && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort()));
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}
function array(value, maximum) { need(Array.isArray(value) && value.length <= maximum); return [...value]; }
function integer(value, minimum = 0) { need(Number.isSafeInteger(value) && value >= minimum); return value; }
function text(value, maximum = 4096) { need(typeof value === "string" && value.length > 0 && value.length <= maximum
  && !/[\0\r\n]/u.test(value)); return value; }
function digest(value) { need(typeof value === "string" && DIGEST.test(value)); return value; }
function sha(value) { need(typeof value === "string" && SHA256.test(value)); return value; }
function commit(value) { need(typeof value === "string" && SHA1.test(value)); return value; }
function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (plain(value)) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freeze(item)])));
  return value;
}
function canonical(value) { return Buffer.from(`${JSON.stringify(value)}\n`, "utf8"); }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function blobHash(value) { return createHash("sha1").update(`blob ${value.length}\0`).update(value).digest("hex"); }
function parse(bytes) {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)); } catch { deny(); }
}
function instant(value) { need(typeof value === "string" && INSTANT.test(value)
  && new Date(value).toISOString() === value); return value; }
function calendarDate(value) {
  need(typeof value === "string" && DATE.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value);
  return value;
}
function addCalendarYear(value) {
  const [year, month, day] = value.split("-").map(Number);
  const nextYear = year + 1; const last = new Date(Date.UTC(nextYear, month, 0)).getUTCDate();
  return `${String(nextYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}
function addElapsedDays(value, days) {
  return new Date(Date.parse(`${value}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
function safeRelative(value) {
  text(value, 256); need(!value.startsWith("/") && !value.includes("\\") && !value.includes("//")
    && value.split("/").every((part) => part !== "" && part !== "." && part !== "..")); return value;
}

function captureCredential() {
  let gh; let github;
  try { gh = process.env.GH_TOKEN; github = process.env.GITHUB_TOKEN; }
  finally { delete process.env.GH_TOKEN; delete process.env.GITHUB_TOKEN; }
  const values = [gh, github].filter((value) => value !== undefined);
  need(values.length === 1); const token = values[0];
  need(typeof token === "string" && token.length > 0 && token.length <= 8192 && !/[\0\r\n]/u.test(token));
  return token;
}
function requireHost() {
  need(process.platform === "linux" && process.getuid?.() === 0 && process.getgid?.() === 0);
}

function validatePolicy(value) {
  const policy = exact(value, ["schemaVersion", "kind", "repository", "ref", "authorityPaths", "apiVersion", "hosts",
    "limits", "cadence", "states", "entrypoint", "intents", "phases", "waivers"]);
  need(policy.schemaVersion === 1 && policy.kind === "POSTGRES_ADMISSION_POLICY_V1"
    && policy.repository === REPOSITORY && policy.ref === REF && policy.apiVersion === API_VERSION
    && isDeepStrictEqual(policy.authorityPaths, AUTHORITY_PATHS) && isDeepStrictEqual(policy.hosts, ["api.github.com", "ghcr.io"])
    && isDeepStrictEqual(policy.states, STATES) && policy.entrypoint === "scripts/postgres-image/admitted-postgres.mjs"
    && isDeepStrictEqual(policy.intents, ["SERVICE", "SQL_CHECK", "MIGRATION", "BACKUP", "RESTORE_VERIFY"])
    && isDeepStrictEqual(policy.phases, PHASES) && isDeepStrictEqual(policy.waivers, WAIVERS));
  need(isDeepStrictEqual(policy.limits, { fileBytes: FILE_BYTES, totalBytes: TOTAL_BYTES, requestMs: REQUEST_MS,
    bootstrapMs: BOOTSTRAP_MS, renewalMs: RENEWAL_MS, revisions: MAX_REVISIONS, executionFiles: MAX_EXECUTION_FILES }));
  need(isDeepStrictEqual(policy.cadence, { leaseMs: LEASE_MS, renewByMs: 35_000, watcherMs: 1_000,
    operationMs: 5_000, drainMs: 30_000, vulnerabilityDatabaseMs: 172_800_000,
    packageControlsMs: PACKAGE_CONTROLS_MS, manifestAccessMs: MANIFEST_ACCESS_MS, archiveFullMs: ARCHIVE_FULL_MS }));
  return freeze(policy);
}

function validateImage(value) {
  const image = exact(value, ["subject", "manifestDigest", "configDigest", "diffIdsSha256", "diffIds"]);
  text(image.subject); digest(image.manifestDigest); digest(image.configDigest); sha(image.diffIdsSha256);
  image.diffIds = array(image.diffIds, 128).map(digest); need(image.diffIds.length > 0);
  need(hash(canonical(image.diffIds)) === image.diffIdsSha256 && image.subject.endsWith(`@${image.manifestDigest}`));
  return image;
}
function validatePin(value) {
  const pin = exact(value, ["path", "size", "sha256"]); safeRelative(pin.path); integer(pin.size, 1); sha(pin.sha256); return pin;
}
function validateBytePin(value) {
  const pin = exact(value, ["bytes", "sha256"]); integer(pin.bytes, 1); sha(pin.sha256); return pin;
}
function validateBuild(value) {
  const build = exact(value, ["recipeRevision", "workflowPath", "runId", "attempt", "publication", "remotePolicy",
    "sourceClosure"]);
  commit(build.recipeRevision); safeRelative(build.workflowPath); need(build.workflowPath.startsWith(".github/workflows/"));
  need(/^[1-9][0-9]{0,19}$/u.test(build.runId) && typeof build.attempt === "string"
    && /^[1-9][0-9]{0,9}$/u.test(build.attempt)
    && build.remotePolicy.path === "infra/postgres-image/candidate-remote.json");
  for (const key of ["publication", "remotePolicy", "sourceClosure"]) build[key] = validatePin(build[key]);
  return build;
}
function validateP1(value) {
  const p1 = exact(value, ["policy", "acceptance", "inventory", "referenceDigest", "counts"]);
  p1.policy = validateBytePin(p1.policy); need(isDeepStrictEqual(p1.policy, { bytes: 731542,
    sha256: "f4857beebba7df2f474e3385c38a69f7cfa0bec330d3d3f65ed7795255de871c" }));
  p1.acceptance = validatePin(p1.acceptance); p1.inventory = validatePin(p1.inventory); sha(p1.referenceDigest);
  need(isDeepStrictEqual(p1.counts, { references: 496, objects: 474 })); return p1;
}
function validateRuntimeEvidence(value) {
  const runtime = exact(value, ["groups", "coldReceipt", "sqlReceipt", "dump", "closedAcknowledgement", "privateAddendum"]);
  runtime.groups = array(runtime.groups, 64).map((entry) => {
    const group = exact(entry, ["role", "sha256", "references", "objects", "bytes"]); text(group.role, 128); sha(group.sha256);
    integer(group.references, 1); integer(group.objects, 1); integer(group.bytes, 1); return group;
  });
  need(runtime.groups.length > 0 && runtime.groups.every((item, index) => index === 0
    || runtime.groups[index - 1].role < item.role));
  for (const key of ["coldReceipt", "sqlReceipt", "dump", "closedAcknowledgement", "privateAddendum"]) {
    runtime[key] = validateBytePin(runtime[key]);
  }
  return runtime;
}
function validateP4(value) {
  const p4 = exact(value, ["originalAcceptance", "outputAcceptance"]);
  p4.originalAcceptance = validatePin(p4.originalAcceptance); p4.outputAcceptance = validatePin(p4.outputAcceptance); return p4;
}
function validateP5(value) {
  const p5 = exact(value, ["acceptance", "recipeRevision", "completePolicy", "launchPlan", "counts", "proofs"]);
  p5.acceptance = validateBytePin(p5.acceptance); need(isDeepStrictEqual(p5.acceptance, { bytes: 4604,
    sha256: "9079ccb664f39d54296fcb4a4ae1287c6bfe116db7518d18ee0a4db4cb8e438b" }));
  commit(p5.recipeRevision); p5.completePolicy = validateBytePin(p5.completePolicy); p5.launchPlan = validateBytePin(p5.launchPlan);
  const countKeys = ["references", "referenceBytes", "evidenceObjects", "evidenceObjectBytes", "controlObjects",
    "controlObjectBytes", "evidenceCopies", "controlCopies", "controlReferences"];
  p5.counts = exact(p5.counts, countKeys); for (const count of Object.values(p5.counts)) integer(count, 1);
  need(p5.counts.references === 1094 && p5.counts.evidenceObjects === 840 && p5.counts.controlObjects === 43
    && p5.counts.evidenceCopies === 2 && p5.counts.controlCopies === 2 && p5.counts.controlReferences === 44);
  const proofKeys = ["rootAcknowledgement", "rootCandidate", "controlManifest", "terminalManifest", "inventory",
    "provisionalReceipt", "capacity", "outerInvocation", "sourceBundle", "actualReview", "postAckJournal",
    "postAckPublisher", "rootChainFreeze"];
  p5.proofs = exact(p5.proofs, proofKeys); for (const key of proofKeys) p5.proofs[key] = validateBytePin(p5.proofs[key]);
  return p5;
}
function validateGenerationRoot(value, generation) {
  const root = exact(value, ["schemaVersion", "kind", "admissionGeneration", "image", "build", "evidence",
    "archiveLocator", "executionFiles", "waivers"]);
  need(root.schemaVersion === 1 && root.kind === "POSTGRES_ADMISSION_GENERATION_ROOT_V1"
    && root.admissionGeneration === generation && isDeepStrictEqual(root.waivers, WAIVERS));
  root.image = validateImage(root.image);
  root.build = validateBuild(root.build);
  need(plain(root.evidence) && isDeepStrictEqual(Object.keys(root.evidence).sort(), ["p1", "runtime", "p4", "p5"].sort()));
  root.evidence = { p1: validateP1(root.evidence.p1), runtime: validateRuntimeEvidence(root.evidence.runtime),
    p4: validateP4(root.evidence.p4), p5: validateP5(root.evidence.p5) };
  root.archiveLocator = exact(root.archiveLocator, ["schemaVersion", "size", "sha256"]);
  need(root.archiveLocator.schemaVersion === 1); integer(root.archiveLocator.size, 1); sha(root.archiveLocator.sha256);
  root.executionFiles = array(root.executionFiles, MAX_EXECUTION_FILES).map(validatePin);
  need(root.executionFiles.length > 0 && root.executionFiles.every((item, index) => index === 0
    || root.executionFiles[index - 1].path < item.path));
  return freeze(root);
}

function normalizeAuditEvidence(value, generationRoot) {
  const audit = exact(value, ["kind", "subject", "checkedAt", "validUntil", "source", "files"]);
  need(audit.kind === "POSTGRES_ADMISSION_CURRENT_AUDIT_V1" && audit.subject === generationRoot.image.subject);
  instant(audit.checkedAt); instant(audit.validUntil); need(Date.parse(audit.checkedAt) <= Date.parse(audit.validUntil));
  audit.source = exact(audit.source, ["recipeRevision", "workflowPath", "runId", "attempt"]);
  commit(audit.source.recipeRevision);
  need(audit.source.workflowPath === ".github/workflows/postgres-admission-current-audit.yml"
    && /^[1-9][0-9]{0,19}$/u.test(audit.source.runId) && typeof audit.source.attempt === "string"
    && /^[1-9][0-9]{0,9}$/u.test(audit.source.attempt));
  audit.files = array(audit.files, 32).map((value) => {
    const file = exact(value, ["role", "size", "sha256"]); text(file.role, 128); integer(file.size, 1); sha(file.sha256); return file;
  });
  need(isDeepStrictEqual(audit.files.map((item) => item.role), AUDIT_ROLES));
  return freeze(audit);
}
function normalizePackageEvidence(value) {
  const current = exact(value, ["size", "sha256", "observedAt"]);
  integer(current.size, 1); sha(current.sha256); instant(current.observedAt); return freeze(current);
}
function evaluatePackageEvidence(current, controlsBytes, now) {
  need(current.size === controlsBytes.length && current.sha256 === hash(controlsBytes));
  const controls = validatePostgresPackageControls(parse(controlsBytes));
  need(current.observedAt === controls.observedAt); const observedAt = Date.parse(instant(current.observedAt));
  need(observedAt <= now.getTime() && now.getTime() <= observedAt + PACKAGE_CONTROLS_MS);
  return controls;
}

function validateCurrentEvidence(value, state, generationRoot, prior) {
  const current = exact(value, ["audit", "packageControls"]);
  if (state === "PENDING" || state === "REVOKED" && prior?.state !== "ACTIVE" && prior?.state !== "REVOKED") {
    need(current.audit === null && current.packageControls === null);
    return freeze(current);
  }
  need(current.audit !== null && current.packageControls !== null);
  current.audit = normalizeAuditEvidence(current.audit, generationRoot);
  current.packageControls = normalizePackageEvidence(current.packageControls);
  return freeze(current);
}
function validateDates(revision, prior) {
  if (revision.state === "PENDING") {
    need(revision.supportStartedAt === null && revision.supportEndsAt === null && revision.archiveUntil === null
      && revision.revocationReason === null); return;
  }
  if (revision.state === "REVOKED" && prior?.state !== "ACTIVE" && prior?.state !== "REVOKED") {
    need(revision.supportStartedAt === null && revision.supportEndsAt === null && revision.archiveUntil === null);
    text(revision.revocationReason, 128); return;
  }
  const started = calendarDate(revision.supportStartedAt), ends = calendarDate(revision.supportEndsAt);
  const archive = calendarDate(revision.archiveUntil);
  need(ends === addCalendarYear(started) && archive === addElapsedDays(ends, 365));
  if (revision.state === "ACTIVE") need(revision.revocationReason === null);
  else text(revision.revocationReason, 128);
  if (prior?.state !== "PENDING") {
    need(prior.supportStartedAt === started && prior.supportEndsAt === ends && prior.archiveUntil === archive);
  }
}
function validateRevision(value, expectedNumber, priorHash, rootHash, prior, generationRoot) {
  const revision = exact(value, ["authorityRevision", "previousRevisionSha256", "generationRootSha256", "state",
    "supportStartedAt", "supportEndsAt", "archiveUntil", "currentEvidence", "revocationReason"]);
  need(revision.authorityRevision === expectedNumber && revision.previousRevisionSha256 === priorHash
    && revision.generationRootSha256 === rootHash && STATES.includes(revision.state));
  validateDates(revision, prior);
  if (prior?.state === "REVOKED") need(revision.state === "REVOKED");
  if (prior?.state === "ACTIVE") need(revision.state !== "PENDING");
  revision.currentEvidence = validateCurrentEvidence(revision.currentEvidence, revision.state, generationRoot, prior);
  return freeze(revision);
}
function validatePreviousGeneration(value) {
  const prior = exact(value, ["admissionGeneration", "generationRootSha256", "authorityRevision",
    "currentRevisionSha256", "state"]);
  integer(prior.admissionGeneration, 1); sha(prior.generationRootSha256); integer(prior.authorityRevision, 1);
  sha(prior.currentRevisionSha256); need(STATES.includes(prior.state)); return freeze(prior);
}
function validateInventory(value) {
  const inventory = exact(value, ["schemaVersion", "kind", "repository", "admissionGeneration", "generationRoot",
    "previousGenerations", "authorityRevisions", "revisionHashes", "authorityRevision", "currentRevisionSha256"]);
  need(inventory.schemaVersion === 1 && inventory.kind === "POSTGRES_ADMISSION_INVENTORY_V1"
    && inventory.repository === REPOSITORY); integer(inventory.admissionGeneration, 1);
  inventory.generationRoot = validateGenerationRoot(inventory.generationRoot, inventory.admissionGeneration);
  const rootHash = hash(canonical(inventory.generationRoot));
  inventory.previousGenerations = array(inventory.previousGenerations, MAX_REVISIONS).map(validatePreviousGeneration);
  need(inventory.previousGenerations.every((item, index) => item.admissionGeneration === index + 1)
    && inventory.previousGenerations.length === inventory.admissionGeneration - 1);
  const rawRevisions = array(inventory.authorityRevisions, MAX_REVISIONS);
  const rawHashes = array(inventory.revisionHashes, MAX_REVISIONS); need(rawRevisions.length > 0 && rawHashes.length === rawRevisions.length);
  const revisions = []; let priorHash = null;
  for (let index = 0; index < rawRevisions.length; index += 1) {
    const revision = validateRevision(rawRevisions[index], index + 1, priorHash, rootHash, revisions.at(-1),
      inventory.generationRoot);
    const revisionHash = hash(canonical(revision)); need(rawHashes[index] === revisionHash);
    revisions.push(revision); priorHash = revisionHash;
  }
  need(inventory.authorityRevision === revisions.length && inventory.currentRevisionSha256 === priorHash);
  inventory.authorityRevisions = revisions; inventory.revisionHashes = rawHashes.map(sha);
  return freeze({ ...inventory, generationRootSha256: rootHash, currentRevision: revisions.at(-1) });
}

async function boundedResponse(response, maximum, deadline) {
  need(response?.status === 200 && response.redirected === false && response.body);
  return readResponseBody(response, maximum, deadline);
}
async function readResponseBody(response, maximum, deadline) {
  need(response?.body);
  const reader = response.body.getReader(); const chunks = []; let total = 0;
  while (true) {
    need(performance.now() < deadline); const { done, value } = await reader.read(); if (done) break;
    need(value instanceof Uint8Array); total += value.byteLength;
    if (total > maximum) { await reader.cancel().catch(() => {}); deny(); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}
async function request(url, token, deadline, maximum) {
  need(typeof url === "string" && (url.startsWith("https://api.github.com/") || url.startsWith("https://ghcr.io/")));
  const remaining = deadline - performance.now(); need(remaining > 0);
  const controller = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), Math.min(REQUEST_MS, remaining));
  try {
    const response = await globalThis.fetch(url, { method: "GET", redirect: "error", signal: controller.signal,
      headers: { Accept: url.startsWith("https://api.github.com/") ? "application/vnd.github+json"
        : "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
      Authorization: `Bearer ${token}`, "User-Agent": "auto-world-postgres-admission",
      ...(url.startsWith("https://api.github.com/") ? { "X-GitHub-Api-Version": API_VERSION } : {}) } });
    return await boundedResponse(response, maximum, deadline);
  } catch { deny(); }
  finally { globalThis.clearTimeout(timer); }
}
function registryChallenge(value) {
  need(typeof value === "string");
  const match = /^Bearer realm="([^"]+)",service="([^"]+)",scope="([^"]+)"$/u.exec(value);
  need(match && match[1] === "https://ghcr.io/token" && match[2] === "ghcr.io"
    && match[3] === "repository:clemey15/auto-world-postgres-gosu:pull"); return match;
}
async function registryRequest(url, deadline, authorization, statuses, maximum = FILE_BYTES) {
  need(typeof url === "string" && (url.startsWith("https://ghcr.io/v2/") || url.startsWith("https://ghcr.io/token?")));
  const remaining = deadline - performance.now(); need(remaining > 0);
  const controller = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), Math.min(REQUEST_MS, remaining));
  try {
    const response = await globalThis.fetch(url, { method: "GET", redirect: "error", signal: controller.signal,
      headers: { Accept: url.startsWith("https://ghcr.io/token?") ? "application/json"
        : "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
        ...(authorization ? { Authorization: authorization } : {}), "User-Agent": "auto-world-postgres-admission" } });
    need(statuses.includes(response?.status) && response.redirected === false);
    const bytes = await readResponseBody(response, maximum, deadline); return { response, bytes };
  } catch { deny(); }
  finally { globalThis.clearTimeout(timer); }
}
async function protectedMain(token, deadline) {
  const bytes = await request(`https://api.github.com/repos/${REPOSITORY}/branches/main`, token, deadline, FILE_BYTES);
  const value = parse(bytes); need(value?.name === "main" && value?.protected === true); return commit(value?.commit?.sha);
}
async function contentAt(file, revision, token, deadline) {
  const encoded = file.split("/").map(encodeURIComponent).join("/");
  const bytes = await request(`https://api.github.com/repos/${REPOSITORY}/contents/${encoded}?ref=${revision}`,
    token, deadline, 2 * FILE_BYTES);
  const value = parse(bytes); need(value?.type === "file" && value.path === file && value.name === path.posix.basename(file)
    && value.encoding === "base64" && Number.isSafeInteger(value.size) && value.size >= 1 && value.size <= FILE_BYTES
    && typeof value.content === "string");
  const decoded = Buffer.from(value.content.replace(/\n/gu, ""), "base64");
  need(decoded.toString("base64") === value.content.replace(/\n/gu, "") && decoded.length === value.size
    && blobHash(decoded) === value.sha && value.sha === commit(value.sha)); return decoded;
}
async function manifestAccess(token, generationRoot, deadline) {
  const repository = generationRoot.image.subject.slice(0, generationRoot.image.subject.indexOf("@"));
  need(repository === "ghcr.io/clemey15/auto-world-postgres-gosu");
  const url = `https://ghcr.io/v2/clemey15/auto-world-postgres-gosu/manifests/${generationRoot.image.manifestDigest}`;
  const initial = await registryRequest(url, deadline, null, [401], 32 * 1024);
  registryChallenge(initial.response.headers?.get?.("www-authenticate"));
  const user = parse(await request("https://api.github.com/user", token, deadline, 32 * 1024));
  need(typeof user?.login === "string" && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(user.login));
  const scope = "repository:clemey15/auto-world-postgres-gosu:pull";
  const tokenUrl = `https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(scope)}`;
  const basic = `Basic ${Buffer.from(`${user.login}:${token}`, "utf8").toString("base64")}`;
  const issued = await registryRequest(tokenUrl, deadline, basic, [200], 32 * 1024);
  const tokenDocument = parse(issued.bytes); const registryToken = tokenDocument?.token ?? tokenDocument?.access_token;
  need(tokenDocument?.token === undefined || tokenDocument?.access_token === undefined
    || tokenDocument.token === tokenDocument.access_token);
  need(typeof registryToken === "string" && registryToken.length > 0 && registryToken.length <= 32 * 1024
    && !/[\0\r\n]/u.test(registryToken));
  const authenticated = async () => {
    const result = await registryRequest(url, deadline, `Bearer ${registryToken}`, [200]);
    need(result.response.headers?.get?.("docker-content-digest") === generationRoot.image.manifestDigest);
    const type = result.response.headers?.get?.("content-type")?.split(";", 1)[0];
    need(["application/vnd.oci.image.manifest.v1+json",
      "application/vnd.docker.distribution.manifest.v2+json"].includes(type)); return result.bytes;
  };
  const first = await authenticated(); need(`sha256:${hash(first)}` === generationRoot.image.manifestDigest);
  const anonymous = await registryRequest(url, deadline, null, [401, 403], 32 * 1024);
  const laterChallenge = anonymous.response.headers?.get?.("www-authenticate");
  if (laterChallenge !== null && laterChallenge !== undefined) registryChallenge(laterChallenge);
  const second = await authenticated(); need(first.equals(second));
  const checkedAt = new Date(); need(Number.isFinite(checkedAt.getTime()));
  return new Date(checkedAt.getTime() + MANIFEST_ACCESS_MS).toISOString();
}

function native(stat) {
  return { dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid), gid: Number(stat.gid),
    mode: Number(stat.mode & 0o7777n), nlink: Number(stat.nlink), size: Number(stat.size),
    mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) };
}
function sameNative(left, right) { return isDeepStrictEqual(left, right); }
function sameDirectory(left, right) {
  return ["dev", "ino", "uid", "gid", "mode"].every((key) => left[key] === right[key]);
}
function protectedRoot() {
  const stat = fs.lstatSync(ROOT, { bigint: true });
  need(stat.isDirectory() && !stat.isSymbolicLink() && Number(stat.uid) === 0 && Number(stat.gid) === 0
    && Number(stat.mode & 0o7777n) === 0o700 && fs.realpathSync(ROOT) === ROOT);
  const fd = fs.openSync(ROOT, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { need(sameNative(native(stat), native(fs.fstatSync(fd, { bigint: true })))); return native(stat); }
  finally { fs.closeSync(fd); }
}
function missing(file) { try { fs.lstatSync(file); return false; } catch (error) { need(error?.code === "ENOENT"); return true; } }
function holdProtectedAncestors(file) {
  const directories = []; let current = path.dirname(file);
  while (true) { directories.unshift(current); const parent = path.dirname(current); if (parent === current) break; current = parent; }
  const handles = [];
  try {
    for (const directory of directories) {
      const named = fs.lstatSync(directory, { bigint: true });
      need(named.isDirectory() && !named.isSymbolicLink() && Number(named.uid) === 0 && Number(named.gid) === 0
        && (Number(named.mode & 0o7777n) & 0o022) === 0 && fs.realpathSync(directory) === directory);
      const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      need(sameDirectory(native(named), native(fs.fstatSync(fd, { bigint: true })))); handles.push({ fd, identity: native(named) });
    }
    return handles;
  } catch (error) {
    for (const item of handles.reverse()) try { fs.closeSync(item.fd); } catch { /* denial remains */ }
    throw error;
  }
}
function closeProtectedAncestors(handles) {
  let valid = true;
  for (const item of handles.reverse()) {
    try { if (!sameDirectory(item.identity, native(fs.fstatSync(item.fd, { bigint: true })))) valid = false; }
    catch { valid = false; }
    try { fs.closeSync(item.fd); } catch { valid = false; }
  }
  need(valid);
}
function readOwned(file, maximum, mode = 0o600, deadline = Number.POSITIVE_INFINITY) {
  need(performance.now() < deadline);
  const ancestors = holdProtectedAncestors(file);
  try {
  const named = fs.lstatSync(file, { bigint: true });
  need(named.isFile() && !named.isSymbolicLink() && Number(named.uid) === 0 && Number(named.gid) === 0
    && Number(named.mode & 0o7777n) === mode && Number(named.nlink) === 1 && Number(named.size) >= 1
    && Number(named.size) <= maximum);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd, { bigint: true }); need(sameNative(native(named), native(opened)));
    const size = Number(opened.size), bytes = Buffer.alloc(size), extra = Buffer.alloc(1); let offset = 0;
    while (offset < size) {
      need(performance.now() < deadline);
      const count = fs.readSync(fd, bytes, offset, Math.min(1024 ** 2, size - offset), offset); need(count > 0); offset += count;
    }
    need(fs.readSync(fd, extra, 0, 1, offset) === 0);
    need(sameNative(native(named), native(fs.fstatSync(fd, { bigint: true })))
      && sameNative(native(named), native(fs.lstatSync(file, { bigint: true })))); return { bytes, identity: native(named) };
  } finally { fs.closeSync(fd); }
  } finally { closeProtectedAncestors(ancestors); }
}
function auditCap(role) {
  if (role === "audit-receipt.json" || role === "database-evidence.json") return 8 * 1024 ** 2;
  if (role.startsWith("database-") && role.endsWith("-manifest.json")) return FILE_BYTES;
  return 64 * 1024 ** 2;
}
function readGenerationFile(pin, generationRoot, deadline) {
  const executionPin = generationRoot.executionFiles.find((item) => item.path === pin.path);
  need(executionPin && isDeepStrictEqual(executionPin, pin));
  const file = path.join(REPOSITORY_ROOT, ...pin.path.split("/")); need(file.startsWith(`${REPOSITORY_ROOT}${path.sep}`));
  const stat = fs.lstatSync(file, { bigint: true }); const mode = Number(stat.mode & 0o7777n);
  need(stat.isFile() && !stat.isSymbolicLink() && Number(stat.uid) === 0 && Number(stat.gid) === 0
    && (mode & 0o022) === 0);
  const read = readOwned(file, FILE_BYTES, mode, deadline);
  need(read.bytes.length === pin.size && hash(read.bytes) === pin.sha256); return read.bytes;
}
function verifyCurrentAudit(current, generationRoot, now, deadline) {
  const documents = {};
  for (const pin of current.files) {
    const file = `${ROOT}/current-audits/${pin.sha256}.json`;
    const read = readOwned(file, auditCap(pin.role), 0o400, deadline);
    need(read.bytes.length === pin.size && hash(read.bytes) === pin.sha256); documents[pin.role] = { bytes: read.bytes, value: parse(read.bytes) };
  }
  const receipt = documents["audit-receipt.json"].value;
  need(receipt?.kind === "POSTGRES_EXACT_REMOTE_CANDIDATE_AUDIT_V1" && receipt.state === "COMPLETE"
    && receipt.authority === "DIAGNOSTIC_ONLY" && receipt.candidateAuthorization === "NOT_AUTHORIZED"
    && receipt.admission === "NOT_AUTHORIZED" && receipt.publication === "NOT_ATTEMPTED"
    && receipt.registryWrite === "NOT_ATTEMPTED" && receipt.imageExecution === "NOT_ATTEMPTED"
    && receipt.runId === current.source.runId && receipt.recipeRevision === current.source.recipeRevision
    && receipt.phase === "COMPLETE" && receipt.registrySubject === generationRoot.image.subject
    && receipt.scannerInput === "LOCAL_DOCKER_SAVE_ARCHIVE"
    && Number.isSafeInteger(receipt.findingCount) && receipt.findingCount >= 0
    && receipt.blockerCount === 0 && isDeepStrictEqual(receipt.blockers, [])
    && receipt.supportStartedAt === null && receipt.supportEndsAt === null && receipt.archiveUntil === null);
  const subject = receipt.subject;
  need(plain(subject) && isDeepStrictEqual(Object.keys(subject).sort(),
    ["artifactName", "imageId", "archiveSha256", "tag", "configDigest", "diffIds", "archiveBytes"].sort())
    && subject.artifactName === "/candidate/saved.tar" && subject.imageId === generationRoot.image.configDigest
    && subject.configDigest === generationRoot.image.configDigest && isDeepStrictEqual(subject.diffIds, generationRoot.image.diffIds));
  const remotePolicyBytes = readGenerationFile(generationRoot.build.remotePolicy, generationRoot, deadline);
  const remotePolicy = validatePostgresRemotePolicy(parse(remotePolicyBytes));
  need(remotePolicy.subject === generationRoot.image.subject
    && remotePolicy.manifest.digest === generationRoot.image.manifestDigest
    && remotePolicy.candidate.imageId === generationRoot.image.configDigest
    && remotePolicy.candidate.diffIds.length === generationRoot.image.diffIds.length
    && remotePolicy.candidate.diffIds.every((value, index) => value === generationRoot.image.diffIds[index])
    && remotePolicy.publisher.workflowPath === generationRoot.build.workflowPath
    && remotePolicy.publisher.runId === generationRoot.build.runId
    && remotePolicy.publisher.runAttempt === generationRoot.build.attempt
    && remotePolicy.publisher.recipeRevision === generationRoot.build.recipeRevision
    && remotePolicy.publisher.receiptSha256 === generationRoot.build.publication.sha256
    && remotePolicy.publisher.receiptBytes === generationRoot.build.publication.size);
  const candidate = validatePostgresRemoteCandidateReceipt(receipt.candidate, remotePolicy);
  need(candidate.runId === current.source.runId && candidate.recipeRevision === current.source.recipeRevision
    && subject.archiveSha256 === candidate.archive.archiveSha256
    && subject.archiveBytes === candidate.archive.archiveBytes && subject.tag === candidate.alias);
  const auditSubject = { artifactName: subject.artifactName, imageId: subject.imageId,
    archiveSha256: subject.archiveSha256, tag: subject.tag, configDigest: subject.configDigest, diffIds: subject.diffIds };
  const vulnerabilityReport = documents["candidate-vulnerabilities.json"].value;
  const cyclonedxReport = documents["candidate-sbom.cdx.json"].value;
  const databaseEvidence = documents["database-evidence.json"].value;
  need(isDeepStrictEqual(receipt.reports, {
    vulnerability: { sha256: hash(documents["candidate-vulnerabilities.json"].bytes),
      size: documents["candidate-vulnerabilities.json"].bytes.length },
    cyclonedx: { sha256: hash(documents["candidate-sbom.cdx.json"].bytes),
      size: documents["candidate-sbom.cdx.json"].bytes.length },
  }));
  need(receipt.scannerControls?.state === "COMPLETE" && plain(receipt.scannerControls.reports)
    && isDeepStrictEqual(Object.keys(receipt.scannerControls.reports).sort(), [...CONTROL_ROLES].sort()));
  for (const role of CONTROL_ROLES) need(isDeepStrictEqual(receipt.scannerControls.reports[role], {
    sha256: hash(documents[role].bytes), size: documents[role].bytes.length,
  }));
  need(Array.isArray(receipt.databases?.registry) && receipt.databases.registry.length === 2);
  for (const [name, repository, tag] of [["vulnerability", "ghcr.io/aquasecurity/trivy-db", "2"],
    ["java", "ghcr.io/aquasecurity/trivy-java-db", "1"]]) {
    const before = documents[`database-${name}-before-manifest.json`].bytes;
    const after = documents[`database-${name}-after-manifest.json`].bytes;
    need(before.equals(after)); const observed = validateDatabaseRegistryManifest(before);
    const expected = receipt.databases.registry.filter((entry) => entry?.name === name);
    need(expected.length === 1 && expected[0].repository === repository && expected[0].tag === tag
      && expected[0].digest === observed.digest && expected[0].size === observed.size
      && expected[0].layerBytes === observed.layerBytes);
  }
  const packageCount = receipt.inventory?.packageCount; integer(packageCount, 1);
  const os = vulnerabilityReport?.Metadata?.OS;
  const inventorySubject = { artifactName: auditSubject.artifactName, imageId: auditSubject.imageId,
    configDigest: auditSubject.configDigest, diffIds: auditSubject.diffIds, tag: auditSubject.tag,
    os: "linux", architecture: "amd64", osFamily: os?.Family, osVersion: os?.Name };
  validatePostgresGosuReportInventory({ vulnerabilityReport, cyclonedxReport,
    expected: { subject: inventorySubject, packageCount } });
  need(plain(databaseEvidence?.observed) && plain(databaseEvidence.observed.vulnerability)
    && plain(databaseEvidence.observed.java));
  const databaseValues = { vulnerability: databaseEvidence.observed.vulnerability.value,
    java: databaseEvidence.observed.java.value };
  const evaluated = evaluateLocalPostgresGosuAudit({ vulnerabilityReport, cyclonedxReport, subject: auditSubject,
    archiveEvidence: auditSubject, databaseEvidence: databaseValues, now });
  need(evaluated.state === "COMPLETE" && evaluated.findings.length === receipt.findingCount
    && evaluated.blockers.length === 0 && evaluated.inventory.packageCount === packageCount);
  const validUntil = postgresRuntimeAuditValidUntil({ observed: databaseEvidence.observed }, vulnerabilityReport, now);
  need(current.checkedAt === vulnerabilityReport.CreatedAt);
  need(current.validUntil === validUntil && now.getTime() <= Date.parse(validUntil));
  return validUntil;
}
function highWaterRecord(value) {
  const record = exact(value, ["schemaVersion", "kind", "admissionGeneration", "generationRootSha256",
    "authorityRevision", "revisionSha256", "state", "resolvedMainSha"]);
  need(record.schemaVersion === 1 && record.kind === "POSTGRES_ADMISSION_HIGH_WATER_V1");
  integer(record.admissionGeneration, 1); sha(record.generationRootSha256); integer(record.authorityRevision, 1);
  sha(record.revisionSha256); need(STATES.includes(record.state)); commit(record.resolvedMainSha); return freeze(record);
}
function initializedBytes() {
  return canonical({ schemaVersion: 1, kind: "POSTGRES_ADMISSION_STATE_INITIALIZED_V1" });
}
function loadInitialized() {
  const read = readOwned(INITIALIZED, 1024); need(read.bytes.equals(initializedBytes())); return read;
}
function createInitialized() {
  const bytes = initializedBytes(); const rootBefore = protectedRoot(); need(missing(INITIALIZED));
  let rootFd = fs.openSync(ROOT, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  let initializedFd; let created = false; let complete = false;
  try {
    initializedFd = fs.openSync(INITIALIZED, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL
      | fs.constants.O_NOFOLLOW, 0o600); created = true; fs.fchmodSync(initializedFd, 0o600);
    writeAll(initializedFd, bytes); fs.fsyncSync(initializedFd); verifyOpenRecord(INITIALIZED, initializedFd, bytes);
    fs.fsyncSync(rootFd); fs.closeSync(initializedFd); initializedFd = undefined;
    need(sameDirectory(rootBefore, native(fs.fstatSync(rootFd, { bigint: true }))));
    fs.closeSync(rootFd); rootFd = undefined;
    const retained = loadInitialized(); need(retained.bytes.equals(bytes)); complete = true;
  } finally {
    if (initializedFd !== undefined) try { fs.closeSync(initializedFd); } catch { /* durable sentinel denies retry */ }
    if (rootFd !== undefined) try { fs.closeSync(rootFd); } catch { /* durable sentinel denies retry */ }
    need(complete && created && !missing(INITIALIZED));
  }
}
function ensureInitialized() { if (missing(INITIALIZED)) createInitialized(); else loadInitialized(); }
function retainedRuntime() {
  for (let generation = 1; generation <= MAX_REVISIONS + 1; generation += 1) {
    if (!missing(`${ROOT}/generation-${generation}`) || !missing(`${ROOT}/restore-generation-${generation}`)) return true;
  }
  return false;
}
function loadHighWater() {
  protectedRoot(); need(missing(INTENT) && missing(TEMPORARY));
  if (missing(HIGH_WATER)) {
    need(missing(INITIALIZED) && !retainedRuntime()); return null;
  }
  if (!missing(INITIALIZED)) loadInitialized();
  const read = readOwned(HIGH_WATER, 16 * 1024); const parsed = highWaterRecord(parse(read.bytes));
  need(read.bytes.equals(canonical(parsed))); return { value: parsed, bytes: read.bytes, identity: read.identity };
}
function compareHighWater(stored, inventory) {
  if (!stored) return;
  const prior = stored.value;
  need(inventory.admissionGeneration >= prior.admissionGeneration);
  if (inventory.admissionGeneration === prior.admissionGeneration) {
    need(inventory.generationRootSha256 === prior.generationRootSha256
      && inventory.authorityRevision >= prior.authorityRevision
      && inventory.revisionHashes[prior.authorityRevision - 1] === prior.revisionSha256);
    if (prior.state === "REVOKED") need(inventory.currentRevision.state === "REVOKED");
  } else {
    const retained = inventory.previousGenerations[prior.admissionGeneration - 1];
    need(retained?.generationRootSha256 === prior.generationRootSha256
      && retained.authorityRevision === prior.authorityRevision
      && retained.currentRevisionSha256 === prior.revisionSha256 && retained.state === prior.state);
  }
}
function writeAll(fd, bytes) {
  let offset = 0; while (offset < bytes.length) {
    const count = fs.writeSync(fd, bytes, offset, bytes.length - offset, offset); need(count > 0); offset += count;
  }
}
function verifyOpenRecord(file, fd, bytes) {
  const stat = fs.fstatSync(fd, { bigint: true });
  need(stat.isFile() && Number(stat.uid) === 0 && Number(stat.gid) === 0 && Number(stat.mode & 0o7777n) === 0o600
    && Number(stat.nlink) === 1 && Number(stat.size) === bytes.length);
  const read = Buffer.alloc(bytes.length), extra = Buffer.alloc(1); let offset = 0;
  while (offset < bytes.length) { const count = fs.readSync(fd, read, offset, bytes.length - offset, offset); need(count > 0); offset += count; }
  need(fs.readSync(fd, extra, 0, 1, offset) === 0 && read.equals(bytes)
    && sameNative(native(stat), native(fs.lstatSync(file, { bigint: true }))));
}
function quarantineHighWater(marker, rootBefore) {
  let markerFd; let rootFd; let complete = false;
  try {
    if (missing(INTENT)) {
      markerFd = fs.openSync(INTENT, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL
        | fs.constants.O_NOFOLLOW, 0o600);
      fs.fchmodSync(markerFd, 0o600); writeAll(markerFd, marker); fs.fsyncSync(markerFd);
      verifyOpenRecord(INTENT, markerFd, marker);
    }
    rootFd = fs.openSync(ROOT, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    fs.fsyncSync(rootFd); need(sameDirectory(rootBefore, native(fs.fstatSync(rootFd, { bigint: true }))));
    if (markerFd !== undefined) { fs.closeSync(markerFd); markerFd = undefined; }
    fs.closeSync(rootFd); rootFd = undefined; complete = true;
  } finally {
    if (markerFd !== undefined) try { fs.closeSync(markerFd); } catch { /* denial remains */ }
    if (rootFd !== undefined) try { fs.closeSync(rootFd); } catch { /* denial remains */ }
    need(complete && !missing(INTENT));
  }
}
function persistHighWater(value, previous) {
  const record = highWaterRecord(value), bytes = canonical(record); const rootBefore = protectedRoot();
  need(missing(INTENT) && missing(TEMPORARY));
  const marker = canonical({ schemaVersion: 1, kind: "POSTGRES_ADMISSION_HIGH_WATER_UPDATE_INTENT_V1",
    admissionGeneration: record.admissionGeneration, authorityRevision: record.authorityRevision,
    revisionSha256: record.revisionSha256 });
  let rootFd = fs.openSync(ROOT, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  let markerFd; let temporaryFd; let commitFd; let mutated = false; let complete = false;
  try {
    markerFd = fs.openSync(INTENT, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL
      | fs.constants.O_NOFOLLOW, 0o600); mutated = true; fs.fchmodSync(markerFd, 0o600);
    writeAll(markerFd, marker); fs.fsyncSync(markerFd); verifyOpenRecord(INTENT, markerFd, marker); fs.fsyncSync(rootFd);
    temporaryFd = fs.openSync(TEMPORARY, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL
      | fs.constants.O_NOFOLLOW, 0o600); fs.fchmodSync(temporaryFd, 0o600);
    writeAll(temporaryFd, bytes); fs.fsyncSync(temporaryFd); verifyOpenRecord(TEMPORARY, temporaryFd, bytes);
    if (previous) {
      const old = readOwned(HIGH_WATER, 16 * 1024); need(old.bytes.equals(previous.bytes)
        && sameNative(old.identity, previous.identity));
    } else need(missing(HIGH_WATER));
    fs.closeSync(temporaryFd); temporaryFd = undefined;
    fs.renameSync(TEMPORARY, HIGH_WATER); fs.fsyncSync(rootFd);
    const retained = readOwned(HIGH_WATER, 16 * 1024); need(retained.bytes.equals(bytes));
    fs.closeSync(markerFd); markerFd = undefined;
    need(sameDirectory(rootBefore, native(fs.fstatSync(rootFd, { bigint: true }))));
    fs.closeSync(rootFd); rootFd = undefined;
    commitFd = fs.openSync(ROOT, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    need(sameDirectory(rootBefore, native(fs.fstatSync(commitFd, { bigint: true }))));
    fs.unlinkSync(INTENT); fs.fsyncSync(commitFd);
    need(missing(INTENT) && sameDirectory(rootBefore, native(fs.fstatSync(commitFd, { bigint: true }))));
    fs.closeSync(commitFd); commitFd = undefined; complete = true;
  } finally {
    if (temporaryFd !== undefined) try { fs.closeSync(temporaryFd); } catch { /* marker intentionally remains */ }
    if (markerFd !== undefined) try { fs.closeSync(markerFd); } catch { /* marker intentionally remains */ }
    if (rootFd !== undefined) try { fs.closeSync(rootFd); } catch { /* marker intentionally remains */ }
    if (commitFd !== undefined) try { fs.closeSync(commitFd); } catch { /* retirement uncertainty is quarantined */ }
    if (!complete && mutated && missing(INTENT)) quarantineHighWater(marker, rootBefore);
    need(complete);
  }
  return record;
}

function verifyExecutionFiles(generationRoot, deadline) {
  const rootStat = fs.lstatSync(REPOSITORY_ROOT, { bigint: true });
  need(rootStat.isDirectory() && !rootStat.isSymbolicLink() && Number(rootStat.uid) === 0 && Number(rootStat.gid) === 0
    && (Number(rootStat.mode & 0o7777n) & 0o022) === 0 && fs.realpathSync(REPOSITORY_ROOT) === REPOSITORY_ROOT);
  for (const pin of generationRoot.executionFiles) {
    need(performance.now() < deadline);
    const file = path.join(REPOSITORY_ROOT, ...pin.path.split("/")); need(file.startsWith(`${REPOSITORY_ROOT}${path.sep}`));
    const stat = fs.lstatSync(file, { bigint: true }); const mode = Number(stat.mode & 0o7777n);
    need(stat.isFile() && !stat.isSymbolicLink() && Number(stat.uid) === 0 && Number(stat.gid) === 0
      && (mode & 0o022) === 0);
    const read = readOwned(file, FILE_BYTES, mode, deadline);
    need(read.bytes.length === pin.size && hash(read.bytes) === pin.sha256);
  }
}
function verifyArchiveHealth(inventory, policyBytes, now, deadline) {
  const directory = `${ROOT}/archive-health`;
  const file = `${directory}/generation-${inventory.admissionGeneration}.json`;
  const marker = `${directory}/.generation-${inventory.admissionGeneration}.update-intent`;
  const temporary = `${directory}/.generation-${inventory.admissionGeneration}.tmp`;
  need(missing(marker) && missing(temporary));
  const read = readOwned(file, FILE_BYTES, 0o600, deadline); const envelope = exact(parse(read.bytes),
    ["kind", "state", "observedAt", "report", "process", "command", "policy"]);
  need(read.bytes.equals(canonical(envelope)) && envelope.kind === "POSTGRES_ADMISSION_ARCHIVE_HEALTH_ENVELOPE_V1"
    && envelope.state === "VERIFIED");
  const observedAt = Date.parse(instant(envelope.observedAt)); need(observedAt <= now.getTime());
  need(isDeepStrictEqual(envelope.process,
    { status: 0, signal: null, closed: true, stdoutEOF: true, stderrEOF: true }));
  envelope.command = exact(envelope.command, ["size", "sha256"]); integer(envelope.command.size, 1); sha(envelope.command.sha256);
  const commandPin = inventory.generationRoot.executionFiles.find((item) =>
    item.path === "scripts/postgres-image/admission-archive-maintenance.mjs");
  need(commandPin && isDeepStrictEqual(envelope.command, { size: commandPin.size, sha256: commandPin.sha256 }));
  envelope.policy = exact(envelope.policy, ["size", "sha256"]); integer(envelope.policy.size, 1); sha(envelope.policy.sha256);
  need(isDeepStrictEqual(envelope.policy, { size: policyBytes.length, sha256: hash(policyBytes) }));
  const report = exact(envelope.report, ["kind", "state", "scope", "completedAt", "validUntil", "admissionGeneration",
    "generationRootSha256", "archiveLocatorSha256", "executionFilesSha256", "roots", "imageArchive", "claims"]);
  need(report.kind === "POSTGRES_ADMISSION_ARCHIVE_FULL_V1" && report.state === "VERIFIED"
    && report.scope === "COMPLETE_ARCHIVE_HEALTH" && report.admissionGeneration === inventory.admissionGeneration
    && report.generationRootSha256 === inventory.generationRootSha256
    && report.archiveLocatorSha256 === inventory.generationRoot.archiveLocator.sha256);
  const completed = Date.parse(instant(report.completedAt)), validUntil = Date.parse(instant(report.validUntil));
  need(completed <= observedAt && observedAt <= now.getTime() && validUntil === completed + ARCHIVE_FULL_MS
    && now.getTime() < validUntil);
  need(isDeepStrictEqual(report.imageArchive, { size: 305474048,
    sha256: "2c1b6b002076fa3772aa9fc899befb86fe525aee1ee1c8007d85bba200c73a05" })
    && isDeepStrictEqual(report.claims, { readOnly: true, objectPayloadParsed: false,
      runtimeAuthority: "NOT_GRANTED", admission: "NOT_AUTHORIZED" }));
  need(performance.now() < deadline);
  const context = loadPostgresAdmissionArchiveContext(inventory.generationRoot);
  const fast = verifyPostgresAdmissionArchiveFast(context);
  need(performance.now() < deadline && missing(marker) && missing(temporary));
  need(fast.admissionGeneration === inventory.admissionGeneration
    && fast.generationRootSha256 === inventory.generationRootSha256
    && fast.archiveLocatorSha256 === inventory.generationRoot.archiveLocator.sha256
    && report.executionFilesSha256 === fast.executionFilesSha256
    && isDeepStrictEqual(report.roots, fast.roots) && isDeepStrictEqual(report.imageArchive, fast.imageArchive)
    && isDeepStrictEqual(report.claims, fast.claims));
  return { fast, validUntil: report.validUntil,
    archiveSetId: hash(canonical({ archiveLocatorSha256: fast.archiveLocatorSha256,
      roots: fast.roots.map((item) => ({ role: item.role, membershipSha256: item.membershipSha256 })) })) };
}

function currentHighWater(inventory, resolvedMainSha) {
  return freeze({ schemaVersion: 1, kind: "POSTGRES_ADMISSION_HIGH_WATER_V1",
    admissionGeneration: inventory.admissionGeneration, generationRootSha256: inventory.generationRootSha256,
    authorityRevision: inventory.authorityRevision, revisionSha256: inventory.currentRevisionSha256,
    state: inventory.currentRevision.state, resolvedMainSha });
}
function identicalHighWater(previous, next) { return previous && isDeepStrictEqual(previous.value, next); }
function ensureSupportCurrent(revision, now) {
  const day = now.toISOString().slice(0, 10);
  need(day >= revision.supportStartedAt && day < revision.supportEndsAt);
}
async function bootstrap(token, budgetMs, manifestCache) {
  const deadline = performance.now() + budgetMs;
  const firstMain = await protectedMain(token, deadline); const files = new Map(); let aggregate = 0;
  for (const file of AUTHORITY_PATHS) {
    const bytes = await contentAt(file, firstMain, token, deadline); aggregate += bytes.length; need(aggregate <= TOTAL_BYTES);
    files.set(file, bytes);
  }
  const secondMain = await protectedMain(token, deadline); need(secondMain === firstMain && performance.now() < deadline);
  const policyBytes = files.get(AUTHORITY_PATHS[0]); const inventoryBytes = files.get(AUTHORITY_PATHS[1]);
  const controlsBytes = files.get(AUTHORITY_PATHS[2]);
  validatePolicy(parse(policyBytes)); validatePostgresPackageControls(parse(controlsBytes));
  const now = new Date(); need(Number.isFinite(now.getTime())); const inventory = validateInventory(parse(inventoryBytes));
  const previous = loadHighWater(); compareHighWater(previous, inventory);
  const nextHighWater = currentHighWater(inventory, firstMain); const revision = inventory.currentRevision;
  if (revision.state === "REVOKED") {
    ensureInitialized();
    if (!identicalHighWater(previous, nextHighWater)) persistHighWater(nextHighWater, previous);
    denyRevoked();
  }
  if (revision.state !== "ACTIVE") deny();
  ensureSupportCurrent(revision, now);
  const p2ValidUntil = verifyCurrentAudit(revision.currentEvidence.audit, inventory.generationRoot, now, deadline);
  const packageControls = evaluatePackageEvidence(revision.currentEvidence.packageControls, controlsBytes, now);
  const p3SettingsValidUntil = new Date(Date.parse(packageControls.observedAt) + PACKAGE_CONTROLS_MS).toISOString();
  need(performance.now() < deadline);
  verifyExecutionFiles(inventory.generationRoot, deadline);
  const archive = verifyArchiveHealth(inventory, policyBytes, now, deadline);
  if (manifestCache.manifestDigest !== inventory.generationRoot.image.manifestDigest
    || performance.now() - manifestCache.checkedMonotonic >= MANIFEST_ACCESS_MS) {
    manifestCache.validUntil = await manifestAccess(token, inventory.generationRoot, deadline);
    manifestCache.manifestDigest = inventory.generationRoot.image.manifestDigest;
    manifestCache.checkedMonotonic = performance.now();
  }
  const currentness = freeze({ p2ValidUntil, p3SettingsValidUntil,
    p3ManifestValidUntil: instant(manifestCache.validUntil), archiveValidUntil: instant(archive.validUntil),
    supportValidUntil: `${revision.supportEndsAt}T00:00:00.000Z` });
  const currentWall = new Date(); const currentWallMs = currentWall.getTime();
  need(Number.isFinite(currentWallMs) && performance.now() < deadline
    && Object.values(currentness).every((value) => Date.parse(value) > currentWallMs));
  ensureInitialized();
  if (!identicalHighWater(previous, nextHighWater)) persistHighWater(nextHighWater, previous);
  const retainedWallMs = new Date().getTime();
  need(Number.isFinite(retainedWallMs) && performance.now() < deadline
    && Object.values(currentness).every((value) => Date.parse(value) > retainedWallMs));
  const generationRoot = inventory.generationRoot;
  return freeze({ admissionGeneration: inventory.admissionGeneration, authorityRevision: inventory.authorityRevision,
    revisionSha256: inventory.currentRevisionSha256, resolvedMainSha: firstMain,
    image: { subject: generationRoot.image.subject, manifestDigest: generationRoot.image.manifestDigest,
      configDigest: generationRoot.image.configDigest, diffIdsSha256: generationRoot.image.diffIdsSha256 },
    archiveSetId: archive.archiveSetId, generationRoot, currentness });
}
function makeLease(state, authorityBinding) {
  const issuedMonotonic = performance.now(); const wall = new Date().getTime();
  const earliestWall = Math.min(...Object.values(authorityBinding.currentness).map(Date.parse));
  need(Number.isFinite(wall) && Number.isFinite(earliestWall) && earliestWall > wall);
  const deadlineMonotonic = Math.min(issuedMonotonic + LEASE_MS, issuedMonotonic + earliestWall - wall);
  const binding = freeze({ admissionGeneration: authorityBinding.admissionGeneration,
    authorityRevision: authorityBinding.authorityRevision, revisionSha256: authorityBinding.revisionSha256,
    resolvedMainSha: authorityBinding.resolvedMainSha, issuedMonotonic, deadlineMonotonic,
    image: authorityBinding.image, archiveSetId: authorityBinding.archiveSetId, currentness: authorityBinding.currentness,
    generationRoot: authorityBinding.generationRoot });
  const lease = Object.freeze({}); leases.set(lease, { state, binding, active: true }); return lease;
}

export async function openPostgresAdmissionAuthority() {
  if (arguments.length !== 0) deny(); const token = captureCredential(); requireHost();
  const state = { token, closed: false, acquired: false, renewing: false,
    manifestCache: { manifestDigest: null, checkedMonotonic: Number.NEGATIVE_INFINITY, validUntil: null }, binding: null };
  try { state.binding = await bootstrap(token, BOOTSTRAP_MS, state.manifestCache); }
  catch (error) { state.token = null; throw [ERROR, REVOKED].includes(error?.message) ? error : new Error(ERROR); }
  const authority = {
    acquire() {
      need(arguments.length === 0 && !state.closed && !state.acquired); state.acquired = true;
      return makeLease(state, state.binding);
    },
    async renew(priorLease) {
      need(arguments.length === 1 && !state.closed && state.acquired && !state.renewing);
      const prior = leases.get(priorLease); need(prior?.state === state && prior.active);
      const started = performance.now(); need(started < prior.binding.deadlineMonotonic); state.renewing = true;
      try {
        const budget = Math.min(RENEWAL_MS, prior.binding.deadlineMonotonic - started);
        need(budget > 0); const next = await bootstrap(state.token, budget, state.manifestCache);
        need(performance.now() < prior.binding.deadlineMonotonic); prior.active = false; state.binding = next;
        return makeLease(state, next);
      } catch (error) {
        prior.active = false; throw [ERROR, REVOKED].includes(error?.message) ? error : new Error(ERROR);
      }
      finally { state.renewing = false; }
    },
    assertCurrent(lease, phase, minimumRemainingMs = 0) {
      need(arguments.length === 2 || arguments.length === 3); const record = leases.get(lease);
      need(!state.closed && record?.state === state && record.active && PHASES.includes(phase)
        && Number.isSafeInteger(minimumRemainingMs) && minimumRemainingMs >= 0 && minimumRemainingMs <= LEASE_MS);
      if (performance.now() + Math.max(minimumRemainingMs, 5_000) >= record.binding.deadlineMonotonic) {
        throw new Error(EXPIRED);
      }
      return record.binding;
    },
    close() {
      need(arguments.length === 0 && !state.closed); state.closed = true; state.token = null; state.binding = null;
    },
  };
  const frozen = Object.freeze(authority); sessions.set(frozen, state); return frozen;
}
