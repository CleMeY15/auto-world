import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, closeSync, constants, copyFileSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, rmSync, statfsSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { TextDecoder } from "node:util";
import { baselineFixtureArguments, candidateDockerArguments, collectImageAudits, databaseDownloadDockerArguments, databaseEvidence,
  fixtureScanMode, projectAuditBudget, validateDatabaseRegistryManifest, versionProbeBytes } from "./audit.mjs";
import { assertFilesUnchanged, captureFiles, compareSameDatabase, readBoundedJson, validateFixtureReport } from "./controls.mjs";
import { assertManagedArchiveUnchanged, captureManagedArchive } from "./managed-archive.mjs";
import { parseOfficialGoBuildInfo } from "./official-build-info.mjs";
import { buildOwnedScanner } from "./owned-build.mjs";
import { createOwnedDockerCleanupRegistry, validateOwnedImageAbsence } from "./owned-cleanup.mjs";
import { createSharedBudgetController, validateOwnedBuilderAudit } from "./owned-controls.mjs";
import { captureOwnedScannerPair, createOwnedPublicEvidence, publishOwnedScannerEvidence, qualifyOwnedScanner } from "./owned-qualification.mjs";
import { evaluateArchiveImageReport, evaluateImageReport, MANAGED_GOSU_SOURCE, validateSelfReport, validateVersionProbeReport } from "./official-controls.mjs";
import { combineSeaweedRustGate, helperContainerCreateArguments, helperContainerRemoveArguments, helperCopyCommand,
  helperSoftLimitControlCommand, prepareSeaweedRustLockViews, seaweedRustLimits, seaweedRustPublicSourcePath, seaweedRustScanArguments,
  seaweedRustSourceFetchArguments, validateSeaweedRustControlReport, validateSeaweedRustHelperAbsence,
  validateSeaweedRustHelperContainer, validateSeaweedRustHelperMeasurement, validateSeaweedRustLockUniverse,
  validateSeaweedRustPublicEvidence, validateSeaweedRustPublicSourceMapping, validateSeaweedRustSourceLock } from "./seaweed-rust-source.mjs";
import { runSeaweedGoS3SourcePreflight, seaweedGoS3DockerInfoArguments, seaweedGoS3DockerVersionArguments,
  seaweedGoS3GnuTarVersionArguments, seaweedGoS3PythonVersionArguments, validateSeaweedGoS3Profile,
  seaweedGoS3SourceRefusalError, seaweedGoS3SourceRefusalReceipt, validateSeaweedGoS3SourceRefusal,
  runSeaweedGoS3InertQualification, seaweedGoS3QualificationNames, seaweedGoS3QualificationRefusalReceipt,
  validateSeaweedGoS3QualificationImage, validateSeaweedGoS3QualificationContainer } from "./seaweed-go-s3.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DOCKER = "/usr/bin/docker";
const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const OFFICIAL_BINARY_SHA256 = "d1dfca6ae10a1ad4540bb94e64f0510077c47008920a9b554986b39dca573d83";
const ROLES = new Map([["postgres", "library/postgres"], ["opensearch", "opensearchproject/opensearch"], ["redis", "library/redis"],
  ["seaweedfs", "chrislusf/seaweedfs"], ["aws-cli", "amazon/aws-cli"]]);
// Trivy e713f67 pkg/fanal/types/const.go:167-173 and pkg/sbom/io/encode.go:170-204.
const AGGREGATING_TYPES = new Set(["python-pkg", "conda-pkg", "gemspec", "node-pkg", "jar"]);
const fail = (code) => { throw new Error(code); };
export function captureSeaweedGoS3QualificationFile({ file, cap }) {
  if (process.platform !== "linux" || typeof process.getuid !== "function" || !constants.O_NOFOLLOW || !constants.O_NONBLOCK ||
      typeof file !== "string" || !path.isAbsolute(file) || path.resolve(file) !== file ||
      !Number.isSafeInteger(cap) || cap < 1 || cap > 8 * MiB) fail("scanner_seaweed_go_s3_qualification_file_invalid");
  const fields = ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"];
  const identity = (info) => {
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n || info.uid !== BigInt(process.getuid()) ||
        (info.mode & 0o222n) !== 0n || info.size < 1n || info.size > BigInt(cap) ||
        fields.some((key) => typeof info[key] !== "bigint" || info[key] < 0n)) fail("scanner_seaweed_go_s3_qualification_file_invalid");
    return Object.fromEntries(fields.map((key) => [key, String(info[key])]));
  };
  let fd;
  try {
    if (realpathSync(file) !== file) fail("scanner_seaweed_go_s3_qualification_file_invalid");
    const initial = identity(lstatSync(file, { bigint: true }));
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const same = (info) => {
      if (JSON.stringify(identity(info)) !== JSON.stringify(initial)) fail("scanner_seaweed_go_s3_qualification_file_changed");
    };
    same(fstatSync(fd, { bigint: true }));
    const hash = createHash("sha256"), buffer = Buffer.alloc(MiB);
    let bytes = 0;
    for (;;) {
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, cap - bytes + 1), bytes);
      if (count === 0) break;
      bytes += count;
      if (bytes > cap || BigInt(bytes) > BigInt(initial.size)) fail("scanner_seaweed_go_s3_qualification_file_changed");
      hash.update(buffer.subarray(0, count));
    }
    if (BigInt(bytes) !== BigInt(initial.size)) fail("scanner_seaweed_go_s3_qualification_file_changed");
    same(fstatSync(fd, { bigint: true })); same(lstatSync(file, { bigint: true }));
    if (realpathSync(file) !== file) fail("scanner_seaweed_go_s3_qualification_file_changed");
    return { bytes, sha256: hash.digest("hex"), identity: initial };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
export function deferManagedImageAuditFailure({ scope, error, cleanupUncertain }) {
  if (scope !== "managed" || cleanupUncertain !== false || !(error instanceof Error) ||
      error.message !== "scanner_official_images_blocked") throw error;
  return error;
}
const SEAWEED_RUST_SUBJECT_FAILURES = Object.freeze({
  control: new Set(["scanner_official_command_failed", "scanner_json_file_invalid", "scanner_seaweed_rust_report_invalid",
    "scanner_seaweed_rust_inventory_mismatch", "scanner_seaweed_rust_control_blocked"]),
  source: new Set(["scanner_official_command_failed", "scanner_json_file_invalid", "scanner_seaweed_rust_report_invalid",
    "scanner_seaweed_rust_sbom_invalid", "scanner_seaweed_rust_inventory_mismatch"]),
  helper: new Set(["scanner_official_command_failed", "scanner_seaweed_rust_helper_control_invalid",
    "scanner_seaweed_rust_helper_copy_failed", "scanner_seaweed_rust_helper_container_invalid",
    "scanner_seaweed_rust_helper_measurement_invalid"]),
});
const seaweedRustGlobalFailures = new WeakSet();
export function classifySeaweedRustHelperCommandFailure({ error, record, operation }) {
  if (!(error instanceof Error) || !["softLimitControl", "create", "inspect", "copy"].includes(operation)) throw error;
  if (!record || record.error != null || record.signal != null) {
    seaweedRustGlobalFailures.add(error);
    return error;
  }
  if (error.message === "scanner_official_command_failed" && operation === "copy") {
    return new Error("scanner_seaweed_rust_helper_copy_failed", { cause: error });
  }
  return error;
}
export function classifySeaweedRustSubjectFailure(error, subject) {
  if (!(error instanceof Error) || seaweedRustGlobalFailures.has(error) || !SEAWEED_RUST_SUBJECT_FAILURES[subject]?.has(error.message)) throw error;
  return error;
}
const managedEvidenceDiagnostics = new WeakMap();
const refuseManagedEvidence = (guard, { relative, observed, limit } = {}) => {
  const error = new Error("scanner_managed_evidence_invalid");
  const diagnostic = { schemaVersion: 1, guard };
  if (typeof relative === "string") diagnostic.pathSha256 = createHash("sha256").update(relative.replaceAll(path.sep, "/")).digest("hex");
  if (Number.isSafeInteger(observed) && observed >= 0) diagnostic.observed = observed;
  if (Number.isSafeInteger(limit) && limit >= 0) diagnostic.limit = limit;
  managedEvidenceDiagnostics.set(error, Object.freeze(diagnostic));
  throw error;
};
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
const safePath = (value) => typeof value === "string" && path.isAbsolute(value) && !/[\0,\r\n]/u.test(value);
const digest = (value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);

export function managedEvidenceDiagnostic(error) {
  return managedEvidenceDiagnostics.get(error);
}

export function commandFailureDiagnostic(result, { privateOutput = false } = {}) {
  if (privateOutput) return { stdoutBytes: Buffer.isBuffer(result.stdout) ? result.stdout.length : 0,
    stderrBytes: Buffer.isBuffer(result.stderr) ? result.stderr.length : 0, reason: "private_runtime_output_not_published" };
  const redacted = (bytes) => (Buffer.isBuffer(bytes) ? bytes.toString("utf8") : "")
    .replaceAll(/(?:gh[oprsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})/gu, "[redacted]")
    .replaceAll(/(Authorization:\s*(?:Bearer|Basic)\s+)\S+/giu, "$1[redacted]")
    .replaceAll(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/giu, "$1[redacted]@");
  const stdout = redacted(result.stdout), stderr = redacted(result.stderr);
  return { stdoutBytes: result.stdout?.length ?? 0, stderrBytes: result.stderr?.length ?? 0,
    stdoutTail: stdout.slice(-4096), stderrTail: stderr.slice(-4096),
    stderrErrors: stderr.split("\n").filter((line) => /\b(?:not found|no such file or directory|error|failed)\b/iu.test(line))
      .slice(0, 16).map((line) => line.slice(0, 512)).join("\n").slice(0, 4096) };
}

export function throwCommandFailure(primary, cleanupError) {
  if (primary) {
    if (cleanupError) primary.cleanupError = cleanupError;
    throw primary;
  }
  if (cleanupError) throw cleanupError;
}

export function removeOwnedAuditWork(work, runnerTemp) {
  if (!path.isAbsolute(work) || path.resolve(work) !== work || path.dirname(work) !== runnerTemp ||
      !/^aw-official-scanner-[A-Za-z0-9]{6}$/u.test(path.basename(work)) || realpathSync(runnerTemp) !== runnerTemp) fail("scanner_owned_work_cleanup_invalid");
  if (!existsSync(work)) return { attempted: true, absent: true };
  if (realpathSync(work) !== work || !lstatSync(work).isDirectory()) fail("scanner_owned_work_cleanup_invalid");
  const writable = (directory) => {
    chmodSync(directory, 0o700);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) writable(file);
      else if (entry.isFile()) chmodSync(file, 0o600);
    }
  };
  writable(work);
  rmSync(work, { recursive: true, force: false });
  if (existsSync(work)) fail("scanner_owned_work_cleanup_uncertain");
  return { attempted: true, absent: true };
}

export function validatePreparedRuntimeImage(inspected, report) {
  if (!Array.isArray(inspected) || inspected.length !== 1 || !digest(inspected[0]?.Id) ||
      inspected[0].Os !== "linux" || inspected[0].Architecture !== "amd64" || inspected[0].Id !== report?.Metadata?.ImageID) {
    fail("scanner_managed_runtime_image_invalid");
  }
  return inspected[0].Id;
}

export function validateManagedRuntimeResult(value, expected) {
  const keys = (entry, names) => entry && typeof entry === "object" && !Array.isArray(entry) &&
    Object.keys(entry).length === names.length && names.every((name) => Object.hasOwn(entry, name));
  const caseNames = ["start-and-refusal", "sql-raw-index", "restart-persistence", "cold-canonical-restore"];
  if (!keys(value, ["schemaVersion", "run", "roles", "cases", "cleanup"]) || value.schemaVersion !== 1 ||
      !keys(value.run, ["sourceCommit", "runId", "attempt"]) || typeof value.run.sourceCommit !== "string" || !/^[a-f0-9]{40}$/u.test(value.run.sourceCommit) ||
      typeof value.run.runId !== "string" || !/^[1-9][0-9]*$/u.test(value.run.runId) ||
      typeof value.run.attempt !== "string" || !/^[1-9][0-9]*$/u.test(value.run.attempt) ||
      !["sourceCommit", "runId", "attempt"].every((key) => typeof value.run[key] === "string" && value.run[key] === expected?.run?.[key]) ||
      !Array.isArray(expected?.roles) || expected.roles.length !== 5 || !Array.isArray(value.roles) || value.roles.length !== 5 ||
      !Array.isArray(value.cases) || value.cases.length !== 4 || !keys(value.cleanup, ["result"]) ||
      !["passed", "failed"].includes(value.cleanup.result)) fail("scanner_managed_runtime_result_invalid");
  const subjects = new Map();
  for (const role of expected.roles) {
    if (!ROLES.has(role?.role) || subjects.has(role.role) || !digest(role.imageId)) fail("scanner_managed_runtime_result_invalid");
    subjects.set(role.role, role.imageId);
  }
  const seen = new Set();
  for (const role of value.roles) {
    if (!keys(role, ["role", "imageId"]) || !ROLES.has(role.role) || !digest(role.imageId) ||
        seen.has(role.role) || subjects.get(role.role) !== role.imageId) fail("scanner_managed_runtime_result_invalid");
    seen.add(role.role);
  }
  let failed = false;
  for (const [index, item] of value.cases.entries()) {
    if (!keys(item, ["name", "status", "code"]) || item.name !== caseNames[index] ||
        !(failed ? item.status === "not_run" && item.code === "not_run"
          : (item.status === "passed" && item.code === "verified") || (item.status === "failed" && item.code === "failed"))) {
      fail("scanner_managed_runtime_result_invalid");
    }
    if (item.status === "failed") failed = true;
  }
  return { schemaVersion: 1, run: { sourceCommit: value.run.sourceCommit, runId: value.run.runId, attempt: value.run.attempt },
    roles: value.roles.map(({ role, imageId }) => ({ role, imageId })),
    cases: value.cases.map(({ name, status, code }) => ({ name, status, code })), cleanup: { result: value.cleanup.result } };
}

export async function readManagedRuntimeResult(file, expected) {
  try { return validateManagedRuntimeResult((await readBoundedJson(file, MiB)).value, expected); }
  catch (error) {
    if (error?.code === "ENOENT") fail("scanner_managed_runtime_result_missing");
    throw error;
  }
}

export async function publishManagedRuntimeResult({ resultFile, publicFile, expected, childFailed, receipt }) {
  receipt.functionalRuntime = "FAILED_NOT_ACCEPTED";
  receipt.milestone2Completion = "NOT_ESTABLISHED";
  const result = await readManagedRuntimeResult(resultFile, expected);
  writeJson(publicFile, result);
  receipt.runtimeCases = result.cases;
  receipt.runtimeCleanup = result.cleanup;
  const passed = !childFailed && result.cleanup.result === "passed" && result.cases.every((item) => item.status === "passed");
  receipt.functionalRuntime = passed ? "VERIFIED_DIAGNOSTIC_ONLY" : "FAILED_NOT_ACCEPTED";
  return { result, passed };
}

export function bindManagedGosuEvidence(subject, proof = {}) {
  if (subject?.kind !== "LOCAL_MANAGED_IMAGE_V1" || subject.artifactName !== "/managed-image-postgres.tar" ||
      !digest(subject.imageId) || typeof subject.archiveSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(subject.archiveSha256) ||
      !Number.isSafeInteger(subject.archiveBytes) || subject.archiveBytes < 1 || subject.os !== "linux" || subject.architecture !== "amd64" ||
      proof === null || typeof proof !== "object") fail("scanner_gosu_source_evidence_invalid");
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const pin = MANAGED_GOSU_SOURCE;
  const files = [["buildInfo", pin.buildInfoSha256], ["goMod", pin.goModSha256], ["goSum", pin.goSumSha256], ["finalInventory", pin.finalInventorySha256]];
  if (files.some(([key, sha]) => !Buffer.isBuffer(proof[key]) || proof[key].length > MiB || hash(proof[key]) !== sha) ||
      proof.buildInfo.length !== pin.buildInfoBytes || !Buffer.isBuffer(proof.binaryInventory) || !Buffer.isBuffer(proof.sourceInventory) ||
      !proof.binaryInventory.equals(Buffer.from(`${pin.binarySha256}  /out/gosu\n`)) ||
      !proof.sourceInventory.equals(Buffer.from(`${pin.sourceArchiveSha256}  /tmp/gosu-source.tar.gz\n`))) fail("scanner_gosu_source_evidence_invalid");
  return { kind: "SOURCE_BOUND_GOSU_V1", imageId: subject.imageId, archiveSha256: subject.archiveSha256, archiveBytes: subject.archiveBytes,
    os: subject.os, architecture: subject.architecture, ...pin };
}

export function managedGosuHashArguments(subject) {
  if (subject?.kind !== "LOCAL_MANAGED_IMAGE_V1" || subject.artifactName !== "/managed-image-postgres.tar" || !digest(subject.imageId) ||
      subject.os !== "linux" || subject.architecture !== "amd64" || typeof subject.archiveSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(subject.archiveSha256) ||
      !Number.isSafeInteger(subject.archiveBytes) || subject.archiveBytes < 1) fail("scanner_gosu_source_evidence_invalid");
  return ["run", "--rm", "--pull=never", "--platform", "linux/amd64", "--network=none", "--read-only", "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true", "--user", "70:70", "--pids-limit", "16", "--memory", "64m", "--memory-swap", "64m", "--cpus", "1",
    "--entrypoint", "sha256sum", subject.imageId, "/usr/local/bin/gosu"];
}

export function parseOfficialAuditArguments(argv) {
  if (!Array.isArray(argv) || ![6, 8, 10].includes(argv.length)) fail("scanner_official_arguments_invalid");
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (argv[index] === "--producer") {
      if (values.has("--producer") || argv[index + 1] !== "auto-world") fail("scanner_official_arguments_invalid");
      values.set("--producer", "auto-world"); continue;
    }
    if (argv[index] === "--scope") {
      if (values.has("--scope") || argv[index + 1] !== "managed") fail("scanner_official_arguments_invalid");
      values.set("--scope", "managed"); continue;
    }
    if (!["--scanner", "--build-info", "--output"].includes(argv[index]) || values.has(argv[index]) || !safePath(argv[index + 1])) fail("scanner_official_arguments_invalid");
    values.set(argv[index], path.resolve(argv[index + 1]));
  }
  const result = { scanner: values.get("--scanner"), buildInfo: values.get("--build-info"), output: values.get("--output") };
  if (Object.values(result).some((value) => typeof value !== "string") || new Set(Object.values(result)).size !== 3) fail("scanner_official_arguments_invalid");
  if (values.has("--scope")) result.scope = values.get("--scope");
  if (values.has("--producer")) result.producer = values.get("--producer");
  return result;
}

export function validateManagedImageLock(managed, official) {
  const keys = (value, expected) => value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
  const tools = new Map([["go-builder", ["library/golang", "1.27.3-alpine3.24"]], ["jdk-builder", ["library/eclipse-temurin", "25.0.4.1_1-jdk-noble"]]]);
  const toolPins = new Map([
    ["go-builder", ["sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c", "sha256:bff16a94c0b4b6d9642581e2a3aa81beb3edb940b2f5a3aac1d22c6a68cb7747"]],
    ["jdk-builder", ["sha256:ba0f0e1a33864105e1d454e88105c617ab40f71062db1f306bf58be32a3f8e5e", "sha256:bb022f5eb485497a672821166e469ce4e2289593d74356b6b327cd43d46e3ff0"]],
  ]);
  const recipes = new Map([["postgres", "Dockerfile.postgres"], ["opensearch", "Dockerfile.opensearch-core"], ["aws-cli", "Dockerfile.aws-cli"]]);
  if (!keys(managed, ["schemaVersion", "state", "platform", "buildTools", "candidates", "gosu", "opensearch", "amazonLinux"]) ||
      managed?.schemaVersion !== 1 || managed.state !== "DIAGNOSTIC_ONLY_NOT_ADMITTED" || managed.platform !== "linux/amd64" ||
      !Array.isArray(managed.buildTools) || managed.buildTools.length !== tools.size ||
      !Array.isArray(managed.candidates) || managed.candidates.length !== recipes.size) fail("scanner_managed_lock_invalid");
  const seen = new Set();
  for (const tool of managed.buildTools) {
    const expected = tools.get(tool?.role);
    if (!keys(tool, ["role", "repository", "version", "manifestDigest", "platform"]) || !keys(tool.platform, ["os", "architecture", "variant", "digest"]) ||
        !expected || seen.has(tool.role) || tool.repository !== expected[0] || tool.version !== expected[1] || !digest(tool.manifestDigest) ||
        tool.platform?.os !== "linux" || tool.platform.architecture !== "amd64" || tool.platform.variant !== null || !digest(tool.platform.digest) ||
        tool.manifestDigest !== toolPins.get(tool.role)[0] || tool.platform.digest !== toolPins.get(tool.role)[1]) fail("scanner_managed_lock_invalid");
    seen.add(tool.role);
  }
  seen.clear();
  for (const candidate of managed.candidates) {
    if (!keys(candidate, ["role", "dockerfile", "baseDigest"]) || !recipes.has(candidate?.role) || seen.has(candidate.role) || candidate.dockerfile !== `infra/managed-images/${recipes.get(candidate.role)}` ||
        !digest(candidate.baseDigest) || candidate.baseDigest !== official?.images?.find((image) => image.role === candidate.role)?.platform?.digest) fail("scanner_managed_lock_invalid");
    seen.add(candidate.role);
  }
  if (!keys(managed.gosu, ["version", "sourceCommit", "archiveBytes", "archiveSha256", "goModSha256", "goSumSha256", "buildInfoBytes", "buildInfoSha256", "binarySha256"]) ||
      !keys(managed.opensearch, ["version", "profile", "sourceCommit", "gradleVersion", "gradleDistributionSha256", "gradleWrapperJarSha256", "jackson2", "jackson3", "runtimeJdk"]) ||
      !keys(managed.amazonLinux, ["releasever", "repositoryGuid", "repomdSha256", "primarySha256"]) ||
      managed.gosu?.sourceCommit !== "29b939aa5bd4dc588af765b8248f6e39150d2565" || managed.gosu.version !== "1.20" || managed.gosu.archiveBytes !== 18160 ||
      managed.gosu.archiveSha256 !== "2b70da8a5480fafedc16bb1fc91b572f064d03df736cbd91a616af2f1b66ab51" ||
      managed.gosu.goModSha256 !== "216dbdc31af7371e368b90a85837c6dcf8aa7139cb449ecceaa0526d91900c3a" ||
      managed.gosu.goSumSha256 !== "3f4d244f09dc5009ad68d99b2d99815f48fddf693fad8e734bbe820b315f43e7" ||
      managed.gosu.buildInfoBytes !== MANAGED_GOSU_SOURCE.buildInfoBytes || managed.gosu.buildInfoSha256 !== MANAGED_GOSU_SOURCE.buildInfoSha256 ||
      managed.gosu.binarySha256 !== MANAGED_GOSU_SOURCE.binarySha256 ||
      managed.opensearch?.sourceCommit !== "4ee42a94e87f66fbf1e62a9871b1b87f91e02472" || managed.opensearch.profile !== "minimal-core-no-jdk" ||
      managed.opensearch.version !== "3.9.0" || managed.opensearch.gradleVersion !== "9.7.1" ||
      managed.opensearch.gradleDistributionSha256 !== "92c1a136d76b5017732a66d2e0a648ebff00dd3687d8bff0d0047a1bd904fdf2" ||
      managed.opensearch.gradleWrapperJarSha256 !== "7a9ce74cff467ca1bf60a4fcd9f05185acceda4d0f382434d393e17864262c5d" ||
      managed.opensearch.jackson2 !== "2.22.3" || managed.opensearch.jackson3 !== "3.2.3" ||
      managed.opensearch.runtimeJdk !== "PRESERVE_EXACT_BASE_DIRECTORY_VERIFY_BEFORE_AFTER" ||
      managed.amazonLinux?.releasever !== "2023.12.20261026" || managed.amazonLinux.repositoryGuid !== "762fda855b4bc601a07d99c19a1a9ff82429e78f450f59450cd12522ec5b7ae6" ||
      managed.amazonLinux.repomdSha256 !== "0c790663fd4779e47e261b22155386c82927f2d2c15e0bb90ff6501db0dee1b5" ||
      managed.amazonLinux.primarySha256 !== "ae212a8a70fae3dcce4d56e05926ca7d2c6000468879ab33759477767be6d570") fail("scanner_managed_lock_invalid");
  return managed;
}

export function validateManagedLocalImage(inspected, metadata, tag) {
  const image = inspected?.[0];
  if (!/^auto-world-managed\/(?:postgres|opensearch|aws-cli):[a-f0-9]{40}$/u.test(tag ?? "") || !Array.isArray(inspected) || inspected.length !== 1 ||
      !digest(image?.Id) || image.Os !== "linux" || image.Architecture !== "amd64" || !Array.isArray(image.RepoTags) || !image.RepoTags.includes(tag) ||
      metadata?.["containerimage.config.digest"] !== image.Id || !digest(metadata["containerimage.digest"])) fail("scanner_managed_image_invalid");
  return { imageId: image.Id, os: image.Os, architecture: image.Architecture };
}

export function officialArchiveScanArguments(carrier, scanner, cache, archive, format = "json") {
  if (!safePath(archive) || !/^managed-image-(?:postgres|opensearch|aws-cli)\.tar$/u.test(path.basename(archive))) fail("scanner_managed_archive_invalid");
  const args = candidateDockerArguments({ carrier, scanner, cache, mode: "fs", target: archive, format,
    extra: ["--offline-scan", ...(format === "json" ? ["--severity", "HIGH,CRITICAL"] : [])] });
  args[args.indexOf(carrier) + 1] = "image";
  const input = args.pop(); args.push("--input", input);
  return args;
}

export function exportManagedTextEvidence(source, destination) {
  if (!safePath(source) || !safePath(destination)) refuseManagedEvidence("PATH_INVALID");
  if (existsSync(destination)) refuseManagedEvidence("DESTINATION_OCCUPIED");
  if (realpathSync(source) !== source) refuseManagedEvidence("SOURCE_IDENTITY");
  if (realpathSync(path.dirname(destination)) !== path.dirname(destination)) refuseManagedEvidence("DESTINATION_PARENT_IDENTITY");
  const files = [];
  let total = 0;
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(source, file);
      const info = lstatSync(file);
      if (info.isSymbolicLink()) refuseManagedEvidence("ENTRY_SYMLINK");
      if (relative.split(path.sep).some((segment) => !/^[A-Za-z0-9_.-]+$/u.test(segment) || [".", ".."].includes(segment))) refuseManagedEvidence("ENTRY_NAME");
      if (info.isDirectory()) { visit(file); continue; }
      if (!info.isFile()) refuseManagedEvidence("ENTRY_TYPE", { relative });
      if (info.nlink !== 1) refuseManagedEvidence("ENTRY_HARDLINK", { relative, observed: info.nlink, limit: 1 });
      if (info.size > 4 * MiB) refuseManagedEvidence("ENTRY_BYTES", { relative, observed: info.size, limit: 4 * MiB });
      if (!/(?:\.(?:txt|json|xml|tsv|log|toml|patch|properties|sha1|sha256|exit-code)|(?:^|[/._-])(?:LICENSE|PATENTS|NOTICE)|(?:^|\/)go\.(?:mod|sum)|(?:^|\/)[A-Za-z0-9_.-]+\.status)$/u.test(relative.replaceAll(path.sep, "/"))) refuseManagedEvidence("ENTRY_EXTENSION", { relative });
      const bytes = readFileSync(file);
      total += bytes.length;
      if (bytes.length !== info.size) refuseManagedEvidence("READ_SIZE_CHANGED", { relative, observed: bytes.length, limit: info.size });
      if (total > 64 * MiB) refuseManagedEvidence("TOTAL_BYTES", { relative, observed: total, limit: 64 * MiB });
      if (files.length >= 4096) refuseManagedEvidence("FILE_COUNT", { relative, observed: files.length + 1, limit: 4096 });
      if (bytes.includes(0)) refuseManagedEvidence("CONTENT_NUL", { relative });
      let text;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { refuseManagedEvidence("CONTENT_UTF8", { relative }); }
      if (/(?:gh[oprsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|Authorization:\s*(?:Bearer|Basic)\s+\S+)/iu.test(text)) refuseManagedEvidence("CREDENTIAL_PATTERN", { relative });
      files.push({ relative, bytes, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
  };
  visit(source);
  if (!files.length) refuseManagedEvidence("EMPTY_SOURCE");
  mkdirSync(destination, { mode: 0o700 });
  for (const file of files) {
    const target = path.join(destination, file.relative);
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, file.bytes, { flag: "wx", mode: 0o400 });
  }
  return files.map(({ relative, bytes, sha256 }) => ({ path: relative.replaceAll(path.sep, "/"), size: bytes.length, sha256 }));
}

export function validateOfficialReleaseConfig(config) {
  if (config?.schemaVersion !== 1 || config.scanner?.version !== "0.76.1" || config.scanner.sourceCommit !== "e713f67f7d54decdcd9b3132c9751833dcced698" ||
      config.scanner.archive?.name !== "trivy_0.76.1_Linux-64bit.tar.gz" || config.scanner.archive.bytes !== 52676794 ||
      config.scanner.archive.sha256 !== "c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0" ||
      config.scanner.binarySha256 !== OFFICIAL_BINARY_SHA256 || config.scanner.mainModuleVersion !== "v0.76.1+dirty" || config.scanner.vcsModified !== true ||
      !Array.isArray(config.images) || config.images.length !== ROLES.size) fail("scanner_official_config_invalid");
  const seen = new Set();
  for (const image of config.images) {
    if (!ROLES.has(image?.role) || seen.has(image.role) || image.repository !== ROLES.get(image.role) ||
        typeof image.version !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(image.version) || !digest(image.manifestDigest) ||
        image.platform?.os !== "linux" || image.platform.architecture !== "amd64" || ![null, undefined].includes(image.platform.variant) || !digest(image.platform.digest)) fail("scanner_official_config_invalid");
    seen.add(image.role);
  }
  return config;
}

export function validateOfficialScannerIdentity(identity, scannerConfig) {
  if (scannerConfig?.binarySha256 !== OFFICIAL_BINARY_SHA256 || identity?.sha256 !== scannerConfig.binarySha256 ||
      !Number.isSafeInteger(identity.size) || identity.size < 1) fail("scanner_official_binary_identity_invalid");
  return identity;
}

export function officialImageScanArguments(carrier, scanner, cache, image, format = "json") {
  return candidateDockerArguments({ carrier, scanner, cache, mode: "image", target: `${image.repository}@${image.platform.digest}`, format,
    extra: ["--image-src", "remote", ...(format === "json" ? ["--severity", "HIGH,CRITICAL"] : [])] });
}

export function ownedRunArguments(args, name, owner) {
  if (args[0] !== "run" || !/^aw-official-[a-f0-9-]{36}$/u.test(name) || !/^[a-f0-9-]{36}$/u.test(owner)) fail("scanner_official_container_arguments_invalid");
  return ["run", "--name", name, "--label", `io.auto-world.scanner-official=${owner}`, ...args.slice(1)];
}

export function validateOwnedContainer(value, name, owner) {
  if (!Array.isArray(value) || value.length !== 1 || value[0]?.Name !== `/${name}` || !/^[a-f0-9]{64}$/u.test(value[0].Id ?? "") ||
      value[0].Config?.Labels?.["io.auto-world.scanner-official"] !== owner) fail("scanner_official_cleanup_owner_invalid");
  return value[0].Id;
}

export function validateContainerAbsence(result, name) {
  if (!/^aw-official-[a-f0-9-]{36}$/u.test(name)) return false;
  const message = result.stderr?.toString("utf8")?.trim();
  return !result.error && result.status === 1 && result.signal === null &&
    [`Error response from daemon: No such container: ${name}`, `Error: No such object: ${name}`].includes(message);
}

function property(component, name) {
  const values = component?.properties?.filter((entry) => entry?.name === name);
  if (!Array.isArray(values) || values.length !== 1 || typeof values[0].value !== "string") fail("scanner_official_sbom_invalid");
  return values[0].value;
}

function packageComponentName(component, type) {
  if (component.group === undefined || component.group === "") return component.name;
  if (typeof component.group !== "string" || typeof component.purl !== "string") fail("scanner_official_sbom_invalid");
  // encode.go:381-401 splits names only for Maven GroupID and npm scopes.
  if (["jar", "pom", "gradle", "sbt"].includes(type) && component.purl.startsWith("pkg:maven/")) return `${component.group}:${component.name}`;
  if (["node-pkg", "npm", "yarn", "pnpm", "bun"].includes(type) && component.purl.startsWith("pkg:npm/")) return `${component.group}/${component.name}`;
  fail("scanner_official_sbom_invalid");
}

export function validateOfficialImageSbom(report, sbom, image) {
  const subject = `${image.repository}@${image.platform.digest}`;
  return validateImageSbomInventory(report, sbom, subject);
}

export function validateOfficialArchiveSbom(report, sbom, subject) {
  if (subject?.kind !== "LOCAL_MANAGED_IMAGE_V1" || !digest(subject.imageId) || report?.Metadata?.ImageID !== subject.imageId ||
      !/^\/managed-image-(?:postgres|opensearch|aws-cli)\.tar$/u.test(subject.artifactName ?? "")) fail("scanner_managed_archive_invalid");
  return validateImageSbomInventory(report, sbom, subject.artifactName);
}

function validateImageSbomInventory(report, sbom, subject) {
  if (report?.ArtifactType !== "container_image" || report.ArtifactName !== subject || report.Metadata?.ImageConfig?.os !== "linux" ||
      report.Metadata.ImageConfig.architecture !== "amd64" || sbom?.bomFormat !== "CycloneDX" || !/^1\.[4-7]$/u.test(sbom.specVersion ?? "") ||
      sbom.metadata?.component?.type !== "container" || sbom.metadata.component.name !== subject ||
      !Array.isArray(report.Results) || !report.Results.length || !Array.isArray(sbom.components) || !sbom.components.length || sbom.components.length > 100_000) fail("scanner_official_sbom_invalid");
  const expected = new Set();
  for (const result of report.Results) {
    if (!Array.isArray(result.Packages) || !result.Packages.length) fail("scanner_official_sbom_invalid");
    for (const pkg of result.Packages) {
      if (typeof pkg?.Name !== "string" || !pkg.Name || pkg.Version !== undefined && typeof pkg.Version !== "string" ||
          pkg.Release !== undefined && typeof pkg.Release !== "string" || pkg.Epoch !== undefined && (!Number.isSafeInteger(pkg.Epoch) || pkg.Epoch < 0)) fail("scanner_official_sbom_invalid");
      expected.add(JSON.stringify([pkg.Name, `${pkg.Epoch ? `${pkg.Epoch}:` : ""}${pkg.Version ?? ""}${pkg.Release ? `-${pkg.Release}` : ""}`, result.Type]));
    }
  }
  const actual = new Set();
  const os = [];
  const applications = new Set();
  const refs = new Set([sbom.metadata.component["bom-ref"]]);
  for (const component of sbom.components) {
    if (typeof component?.["bom-ref"] !== "string" || !component["bom-ref"] || refs.has(component["bom-ref"])) fail("scanner_official_sbom_invalid");
    refs.add(component["bom-ref"]);
    if (component.type === "library") {
      if (typeof component.name !== "string" || !component.name || component.version !== undefined && typeof component.version !== "string") fail("scanner_official_sbom_invalid");
      const type = property(component, "aquasecurity:trivy:PkgType");
      actual.add(JSON.stringify([packageComponentName(component, type), component.version ?? "", type]));
    } else if (component.type === "operating-system") os.push(component);
    else if (component.type === "application") applications.add(JSON.stringify([component.name, property(component, "aquasecurity:trivy:Type"), property(component, "aquasecurity:trivy:Class")]));
    else fail("scanner_official_sbom_invalid");
  }
  const expectedApplications = new Set(report.Results.filter((entry) => entry.Class === "lang-pkgs" && !AGGREGATING_TYPES.has(entry.Type))
    .map((entry) => JSON.stringify([entry.Target, entry.Type, entry.Class])));
  if (typeof sbom.metadata.component["bom-ref"] !== "string" || actual.size !== expected.size || [...expected].some((entry) => !actual.has(entry)) ||
      applications.size !== expectedApplications.size || [...expectedApplications].some((entry) => !applications.has(entry))) fail("scanner_official_sbom_inventory_mismatch");
  if (report.Metadata.OS) {
    if (os.length !== 1 || os[0].name !== report.Metadata.OS.Family || os[0].version !== report.Metadata.OS.Name ||
        property(os[0], "aquasecurity:trivy:Type") !== report.Metadata.OS.Family || property(os[0], "aquasecurity:trivy:Class") !== "os-pkgs") fail("scanner_official_sbom_os_mismatch");
  } else if (os.length) fail("scanner_official_sbom_os_mismatch");
  if (!Array.isArray(sbom.dependencies) || sbom.dependencies.length > refs.size) fail("scanner_official_sbom_relations_invalid");
  const edges = new Set();
  for (const relation of sbom.dependencies) {
    if (!refs.has(relation?.ref) || edges.has(relation.ref) || !Array.isArray(relation.dependsOn) ||
        new Set(relation.dependsOn).size !== relation.dependsOn.length || relation.dependsOn.some((ref) => !refs.has(ref))) fail("scanner_official_sbom_relations_invalid");
    edges.add(relation.ref);
  }
  return { packageCount: expected.size, applicationCount: applications.size, operatingSystemCount: os.length };
}

function readOnlyTree(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) fail("scanner_official_symlink_refused");
    if (entry.isDirectory()) readOnlyTree(target);
    else if (entry.isFile()) chmodSync(target, 0o444);
    else fail("scanner_official_file_invalid");
  }
  chmodSync(directory, 0o555);
}

export async function collectSeaweedRustHelperIdentity({ metadata, imageId, imageReport, directory, limitDirectory = path.join(directory, "limit-control"),
  name, owner, freeBytes }, operations) {
  const operationNames = ["softLimitControl", "create", "inspect", "copy", "measure", "listHostFiles", "remove", "proveAbsent"];
  if (!safePath(directory) || !safePath(limitDirectory) || !/^aw-seaweed-rust-[a-f0-9-]{36}$/u.test(name ?? "") || !/^[a-f0-9-]{36}$/u.test(owner ?? "") ||
      !digest(imageId) || imageId !== metadata?.image?.configDigest || imageReport?.Metadata?.ImageID !== imageId ||
      !Number.isSafeInteger(freeBytes) || freeBytes < seaweedRustLimits.helperFreeBytes ||
      !operations || Object.keys(operations).length !== operationNames.length || operationNames.some((key) => typeof operations[key] !== "function")) {
    fail("scanner_seaweed_rust_helper_arguments_invalid");
  }
  const journal = [];
  let owned;
  let primary;
  const roleResults = new Map();
  try {
    const control = helperSoftLimitControlCommand({ directory: limitDirectory });
    await operations.softLimitControl(control); journal.push({ operation: "soft_limit_control", result: "passed" });
    const createArguments = helperContainerCreateArguments({ name, owner, imageId });
    let response;
    try { response = await operations.create(createArguments); journal.push({ operation: "create", result: "passed" }); }
    catch (error) { journal.push({ operation: "create", result: "response_lost_or_failed" }); primary = error; }
    let inspected;
    try { inspected = await operations.inspect(name); }
    catch { fail("scanner_seaweed_rust_helper_cleanup_uncertain"); }
    if (!Array.isArray(inspected)) fail("scanner_seaweed_rust_helper_cleanup_uncertain");
    try { owned = validateSeaweedRustHelperContainer({ inspected, name, owner, imageId }); }
    catch { fail("scanner_seaweed_rust_helper_cleanup_uncertain"); }
    if (response !== undefined && String(response).trim() !== owned.containerId) fail("scanner_seaweed_rust_helper_cleanup_uncertain");
    if (response === undefined && primary) journal.push({ operation: "recover_owned_container_for_cleanup", result: "passed" });
    journal.push({ operation: "inspect_created", result: "passed" });
    if (primary) throw primary;
    for (const role of metadata.roles) {
      const destination = path.join(directory, path.basename(role.helper.path));
      try {
        const copy = helperCopyCommand({ containerName: name, sourcePath: role.helper.path, destination,
          expectedBytes: role.helper.bytes, home: directory, temporary: directory });
        await operations.copy(copy); journal.push({ operation: `copy_${role.role}`, result: "passed" });
        const after = validateSeaweedRustHelperContainer({ inspected: await operations.inspect(name), name, owner, imageId });
        if (after.containerId !== owned.containerId || JSON.stringify(after.anonymousVolumes) !== JSON.stringify(owned.anonymousVolumes)) {
          fail("scanner_seaweed_rust_helper_container_invalid");
        }
        journal.push({ operation: `inspect_${role.role}`, result: "passed" });
        const measured = await operations.measure({ role: role.role, file: destination });
        roleResults.set(role.role, validateSeaweedRustHelperMeasurement({ role: role.role, file: destination, ...measured, metadata }));
        journal.push({ operation: `measure_${role.role}`, result: "passed" });
      } catch (error) {
        const failure = classifySeaweedRustSubjectFailure(error, "helper");
        roleResults.set(role.role, { role: role.role, result: "rejected", reason: failure.message });
        journal.push({ operation: `collect_${role.role}`, result: "rejected", reason: failure.message });
      }
    }
    const hostFiles = await operations.listHostFiles(directory);
    const allowedFiles = new Set(metadata.roles.map((role) => path.basename(role.helper.path)));
    const expectedFiles = metadata.roles.filter(({ role }) => roleResults.get(role)?.result === "passed")
      .map((role) => path.basename(role.helper.path));
    if (!Array.isArray(hostFiles) || new Set(hostFiles).size !== hostFiles.length || hostFiles.some((file) => !allowedFiles.has(file)) ||
        expectedFiles.some((file) => !hostFiles.includes(file))) {
      fail("scanner_seaweed_rust_helper_inventory_invalid");
    }
    for (const role of metadata.roles) {
      const first = roleResults.get(role.role);
      if (first?.result !== "passed") continue;
      try {
        const file = path.join(directory, path.basename(role.helper.path));
        const measured = await operations.measure({ role: role.role, file });
        const finalMeasurement = validateSeaweedRustHelperMeasurement({ role: role.role, file, ...measured, metadata });
        if (JSON.stringify(finalMeasurement) !== JSON.stringify(first)) fail("scanner_seaweed_rust_helper_measurement_invalid");
        journal.push({ operation: `revalidate_${role.role}`, result: "passed" });
      } catch (error) {
        const failure = classifySeaweedRustSubjectFailure(error, "helper");
        roleResults.set(role.role, { role: role.role, result: "rejected", reason: failure.message });
        journal.push({ operation: `revalidate_${role.role}`, result: "rejected", reason: failure.message });
      }
    }
    const measurements = [...roleResults.values()];
    if (measurements.every((item) => item.result === "passed") &&
        measurements.reduce((sum, item) => sum + item.bytes, 0) !== seaweedRustLimits.helperCombinedBytes) {
      fail("scanner_seaweed_rust_helper_measurement_invalid");
    }
    if (primary) throw primary;
  } catch (error) { primary = error; }
  finally {
    if (owned) {
      try {
        await operations.remove(helperContainerRemoveArguments(owned.containerId)); journal.push({ operation: "remove_owned", result: "passed" });
        const absence = await operations.proveAbsent(name, owned.anonymousVolumes);
        if (!validateSeaweedRustHelperAbsence(absence, name, owned.anonymousVolumes)) fail("scanner_seaweed_rust_helper_cleanup_uncertain");
        journal.push({ operation: "prove_absent", result: "passed" });
      } catch { primary = new Error("scanner_seaweed_rust_helper_cleanup_uncertain"); }
    }
  }
  if (primary) throw primary;
  const measurements = metadata.roles.map(({ role }) => roleResults.get(role));
  return { result: measurements.every((item) => item.result === "passed") ? "passed" : "rejected",
    evidenceClass: "ARTIFACT_TO_IMAGE_IDENTITY", imageId, measurements, journal,
    copiedBytes: measurements.filter((item) => item.result === "passed").reduce((sum, item) => sum + item.bytes, 0),
    intrinsicBinaryInventory: "NOT_ESTABLISHED", sourceToBinaryEquivalence: "NOT_ESTABLISHED" };
}

export async function measureSeaweedRustHelperFile(file) {
  const info = lstatSync(file);
  let identity;
  try { [identity] = await captureFiles([{ path: file, cap: 512 * MiB }]); }
  catch (error) {
    if (error?.message !== "scanner_snapshot_invalid") throw error;
    fail("scanner_seaweed_rust_helper_measurement_invalid");
  }
  return { info: { isFile: info.isFile(), isSymbolicLink: info.isSymbolicLink(), nlink: info.nlink, mode: info.mode & 0o777 },
    identity: { size: identity.size, sha256: identity.sha256 } };
}

export async function runManagedSeaweedRustPostImageLifecycle({ receipt, originalImageFailure }, operations) {
  const operationNames = ["sourceAndHelperAudits", "producedImageRuntime"];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) || !operations ||
      Object.keys(operations).length !== operationNames.length || operationNames.some((name) => typeof operations[name] !== "function") ||
      !Array.isArray(receipt.reports) || !Array.isArray(receipt.rejections) || !Array.isArray(receipt.builds) || !Array.isArray(receipt.phases)) {
    fail("scanner_seaweed_rust_lifecycle_invalid");
  }
  if (originalImageFailure != null && (originalImageFailure?.message !== "scanner_official_images_blocked" || receipt.reports.length !== 5 ||
      receipt.rejections.length < 1 || !receipt.phases?.some((entry) => entry?.name === "five_image_audits" &&
        entry.result === "failed" && entry.reason === "scanner_official_images_blocked"))) {
    fail("scanner_seaweed_rust_lifecycle_invalid");
  }
  const sourceStart = Date.now();
  let diagnostics;
  try {
    diagnostics = await operations.sourceAndHelperAudits();
    if (!diagnostics || typeof diagnostics !== "object" || Array.isArray(diagnostics) ||
        Object.keys(diagnostics).length !== 1 || !Object.hasOwn(diagnostics, "failure") ||
        diagnostics.failure !== null && !(diagnostics.failure instanceof Error)) fail("scanner_seaweed_rust_lifecycle_invalid");
  } catch (error) {
    receipt.phases.push({ name: "seaweed_rust_source_and_helper_audits", result: "failed", reason: error.message,
      durationMs: Date.now() - sourceStart });
    throw error;
  }
  receipt.phases.push({ name: "seaweed_rust_source_and_helper_audits", result: diagnostics.failure ? "failed" : "passed",
    ...(diagnostics.failure ? { reason: diagnostics.failure.message } : {}), durationMs: Date.now() - sourceStart });
  let gate, gateFailure;
  try { gate = combineSeaweedRustGate({ originalReports: receipt.reports, controls: receipt.seaweedRustControls,
    sourceAudits: receipt.seaweedRustSourceAudits, helpers: receipt.seaweedRustHelpers, managedBuilds: receipt.builds }); }
  catch (error) { gateFailure = error; }
  if (originalImageFailure) throw originalImageFailure;
  if (diagnostics.failure) throw diagnostics.failure;
  if (gateFailure) throw gateFailure;
  receipt.seaweedRustGate = gate;
  return operations.producedImageRuntime();
}

export function exportSeaweedRustAuditReportPair({ directory, role, jsonFile, cyclonedxFile }) {
  if (!safePath(directory) || !["volume", "worker"].includes(role) || !safePath(jsonFile) || !safePath(cyclonedxFile) ||
      jsonFile === cyclonedxFile) fail("scanner_seaweed_rust_evidence_export_invalid");
  const publishedJson = path.join(directory, `${role}.json`);
  const publishedCyclonedx = path.join(directory, `${role}.cdx.json`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (existsSync(publishedJson) || existsSync(publishedCyclonedx)) fail("scanner_seaweed_rust_evidence_export_invalid");
  for (const [source, target] of [[jsonFile, publishedJson], [cyclonedxFile, publishedCyclonedx]]) {
    const info = lstatSync(source);
    if (!info.isFile() || info.isSymbolicLink()) fail("scanner_seaweed_rust_evidence_export_invalid");
    copyFileSync(source, target); chmodSync(target, 0o400);
  }
  return { role, jsonFile: publishedJson, cyclonedxFile: publishedCyclonedx };
}

export async function auditAndPublishSeaweedRustControlReport({ control, file, directory, metadata, artifactName, now }) {
  if (!["cargo-lock-vulnerable", "cargo-lock-clean"].includes(control) || !safePath(file) || !safePath(directory)) {
    fail("scanner_seaweed_rust_evidence_export_invalid");
  }
  let result, failure, reportRead = false;
  try {
    const report = (await readBoundedJson(file)).value;
    reportRead = true;
    result = validateSeaweedRustControlReport({ control, report, metadata, artifactName, now });
  }
  catch (error) { failure = classifySeaweedRustSubjectFailure(error, "control"); }
  if (reportRead) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const published = path.join(directory, `${control}.json`);
    if (existsSync(published)) fail("scanner_seaweed_rust_evidence_export_invalid");
    copyFileSync(file, published); chmodSync(published, 0o400);
  }
  return failure ? { result: null, failure } : { result, failure: null };
}

export async function auditAndPublishSeaweedRustSourceReports({ role, files, directory, metadata, artifactName, now }) {
  if (!["volume", "worker"].includes(role) || !files || !safePath(files.json) || !safePath(files.sbom) || !safePath(directory)) {
    fail("scanner_seaweed_rust_evidence_export_invalid");
  }
  let result, failure, reportsRead = false;
  try {
    const report = (await readBoundedJson(files.json)).value;
    const sbom = (await readBoundedJson(files.sbom)).value;
    reportsRead = true;
    result = validateSeaweedRustLockUniverse({ role, report, sbom, metadata, artifactName, now });
  }
  catch (error) { failure = classifySeaweedRustSubjectFailure(error, "source"); }
  if (reportsRead) exportSeaweedRustAuditReportPair({ directory, role, jsonFile: files.json, cyclonedxFile: files.sbom });
  return failure ? { result: null, failure } : { result, failure: null };
}

export async function auditOfficialScanner({ scanner: inputScanner, buildInfo, output, scope = "upstream", producer }) {
  if (!["upstream", "managed"].includes(scope) || producer !== undefined && producer !== "auto-world") fail("scanner_official_arguments_invalid");
  const sharedBudget = producer === "auto-world" ? createSharedBudgetController() : null;
  if (process.platform !== "linux" || process.getuid?.() === 0 || process.env.GITHUB_ACTIONS !== "true" ||
      process.env.RUNNER_ENVIRONMENT !== "github-hosted" || !safePath(process.env.RUNNER_TEMP)) fail("scanner_official_requires_nonroot_linux_actions");
  const runnerTemp = realpathSync(process.env.RUNNER_TEMP);
  for (const file of [inputScanner, buildInfo, output]) {
    const relative = path.relative(runnerTemp, file);
    if (!safePath(file) || !relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || realpathSync(path.dirname(file)) !== path.dirname(file)) fail("scanner_official_path_outside_runner_temp");
  }
  if (existsSync(output)) fail("scanner_official_output_exists");
  mkdirSync(output, { mode: 0o700 });
  const work = mkdtempSync(path.join(runnerTemp, "aw-official-scanner-")); chmodSync(work, 0o755);
  const dockerConfig = path.join(work, "docker-config"); mkdirSync(dockerConfig, { mode: 0o700 });
  const environment = { PATH: process.env.PATH, HOME: work, TMPDIR: work, DOCKER_CONFIG: dockerConfig, TZ: "UTC", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
  const receipt = { schemaVersion: 1, state: "diagnostic_only", admission: "NOT_AUTHORIZED", scope, result: "failed", phases: [], reports: [], blockers: [], commands: [] };
  if (scope === "managed") {
    receipt.executionScope = "BUILD_AND_AUDIT_DIAGNOSTIC_ONLY";
    receipt.functionalRuntime = "PENDING_NOT_ACCEPTED";
    receipt.milestone2Completion = "NOT_ESTABLISHED";
  }
  receipt.run = Object.fromEntries(["GITHUB_REPOSITORY", "GITHUB_SHA", "GITHUB_WORKFLOW_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"].map((key) => [key, process.env[key] ?? ""]));
  const ownedRun = { workflow: process.env.GITHUB_WORKFLOW ?? "", runId: process.env.GITHUB_RUN_ID ?? "",
    runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT), sourceSha: process.env.GITHUB_SHA ?? "" };
  let built, ownedPublic, ownedControlsPublic, activeBudgetStage;
  const ownedCopies = [];
  const owner = randomUUID();
  let cleanupUncertain = false, cleanupBudgetFailure;
  const invoke = (executable, args, timeout, env = environment, cleaning = false, maxOutputBytes = 128 * MiB) => {
    let boundedTimeout = timeout;
    if (sharedBudget) {
      if (!cleaning) boundedTimeout = sharedBudget.commandTimeoutMs(timeout);
      else try { boundedTimeout = sharedBudget.cleanupCommandTimeoutMs(timeout); }
      catch (error) { cleanupBudgetFailure ??= error.message; boundedTimeout = Math.min(timeout, 5_000); }
    }
    return spawnSync(executable, args, { timeout: boundedTimeout,
      maxBuffer: maxOutputBytes, encoding: null, windowsHide: true, env });
  };
  const dockerCleanup = createOwnedDockerCleanupRegistry({ budget: sharedBudget,
    execute: (args, { timeoutMs, maxBytes }) => spawnSync(DOCKER, args, {
      timeout: timeoutMs, maxBuffer: maxBytes, encoding: null, windowsHide: true, env: environment }) });
  const successful = (result) => !result.error && result.status === 0 && result.signal === null;
  const command = (executable, originalArgs, { file, timeout = 10 * 60_000, env = environment, privateOutput = false,
    expectedStdout, requireEmptyStderr = false, maxOutputBytes = 128 * MiB } = {}) => {
    if (cleanupUncertain) fail("scanner_official_cleanup_uncertain");
    const name = executable === DOCKER && originalArgs[0] === "run" ? `aw-official-${randomUUID()}` : null;
    const args = name ? ownedRunArguments(originalArgs, name, owner) : originalArgs;
    if (name) dockerCleanup.registerContainer({ name, owner });
    let result, primary;
    try { result = invoke(executable, args, timeout, env, false, maxOutputBytes); }
    catch (error) { primary = error; result = { error, status: null, signal: null, stdout: null, stderr: null }; }
    const prefix = `command-${String(receipt.commands.length + 1).padStart(3, "0")}`;
    const record = { executable: path.basename(executable), exitCode: result.status, signal: result.signal, error: result.error?.code ?? null };
    if (!successful(result)) record.diagnostic = commandFailureDiagnostic(result, { privateOutput });
    receipt.commands.push(record);
    if (!successful(result) || expectedStdout !== undefined && !Buffer.from(expectedStdout).equals(result.stdout ?? Buffer.alloc(0)) ||
      requireEmptyStderr && (result.stderr?.length ?? 0) !== 0) primary ??= new Error("scanner_official_command_failed");
    let cleanupError;
    try {
      writeFileSync(file ?? path.join(output, `${prefix}.stdout`), result.stdout ?? Buffer.alloc(0), { flag: "wx", mode: 0o600 });
      writeFileSync(path.join(output, `${prefix}.stderr`), result.stderr ?? Buffer.alloc(0), { flag: "wx", mode: 0o600 });
    } catch (error) { primary ??= error; }
    finally {
      if (name) {
        try {
          record.cleanup = dockerCleanup.cleanupContainer(name);
          record.ownedContainerAbsent = true;
        } catch (error) {
          cleanupUncertain = true;
          cleanupError = new Error("scanner_official_cleanup_uncertain", { cause: error });
          record.cleanup = error.ownedCleanup ?? null;
          record.cleanupFailure = cleanupError.message;
        }
      }
    }
    throwCommandFailure(primary, cleanupError);
    return result.stdout;
  };
  const phase = async (name, operation) => {
    const start = Date.now();
    try { const value = await operation(); receipt.phases.push({ name, result: "passed", durationMs: Date.now() - start }); return value; }
    catch (error) { receipt.phases.push({ name, result: "failed", reason: error.message, durationMs: Date.now() - start }); throw error; }
  };
  try {
    const configFile = path.join(ROOT, "infra/scanner/official-release.json");
    const lockFile = path.join(ROOT, "infra/scanner/scanner-lock.json");
    const policyInputs = await captureFiles([{ path: configFile, cap: MiB }, { path: lockFile, cap: MiB }]);
    const config = validateOfficialReleaseConfig((await readBoundedJson(configFile, MiB)).value);
    const lock = (await readBoundedJson(lockFile, MiB)).value;
    let managed, rustMetadata, rustMetadataFile, seaweedGoS3Profile, seaweedGoS3ProfileFile, seaweedGoS3ConfigFile;
    let managedInputs = [];
    if (scope === "managed") {
      managed = validateManagedImageLock((await readBoundedJson(path.join(ROOT, "infra/managed-images/lock.json"), MiB)).value, config);
      rustMetadataFile = path.join(ROOT, "infra/managed-images/seaweed-rust-source.json");
      rustMetadata = validateSeaweedRustSourceLock((await readBoundedJson(rustMetadataFile, MiB)).value, config);
      seaweedGoS3ProfileFile = path.join(ROOT, "infra/managed-images/seaweed-go-s3/profile.json");
      seaweedGoS3ConfigFile = path.join(ROOT, "infra/managed-images/seaweed-go-s3/source-config.json");
      seaweedGoS3Profile = validateSeaweedGoS3Profile((await readBoundedJson(seaweedGoS3ProfileFile, MiB)).value);
      const sourceFiles = [];
      const visit = (directory) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const file = path.join(directory, entry.name);
          if (entry.isSymbolicLink()) fail("scanner_managed_source_invalid");
          if (entry.isDirectory()) visit(file);
          else if (entry.isFile()) sourceFiles.push({ path: file, cap: MiB });
          else fail("scanner_managed_source_invalid");
        }
      };
      visit(path.join(ROOT, "infra/managed-images"));
      managedInputs = await captureFiles(sourceFiles);
      const profileInput = managedInputs.find((entry) => entry.path === seaweedGoS3ProfileFile);
      const configInput = managedInputs.find((entry) => entry.path === seaweedGoS3ConfigFile);
      if (!profileInput || !configInput || configInput.size !== seaweedGoS3Profile.source.configBytes ||
          configInput.sha256 !== seaweedGoS3Profile.source.configSha256) fail("scanner_seaweed_go_s3_profile_invalid");
      receipt.managedSources = managedInputs;
      const disk = statfsSync(runnerTemp);
      receipt.managedDisk = { freeBytes: disk.bavail * disk.bsize, requiredFreeBytes: 20 * GiB };
      if (receipt.managedDisk.freeBytes < receipt.managedDisk.requiredFreeBytes) fail("scanner_managed_disk_insufficient");
    }
    const original = await captureFiles([{ path: inputScanner, cap: 512 * MiB }, { path: buildInfo, cap: 8 * MiB }]);
    validateOfficialScannerIdentity(original[0], config.scanner);
    if (sharedBudget) ownedCopies.push(inputScanner);
    const inventory = parseOfficialGoBuildInfo(readFileSync(buildInfo));
    let pair;
    if (sharedBudget) {
      built = await phase("owned_scanner_build", async () => buildOwnedScanner({ output: path.join(work, "owned-build-public"), scope, budget: sharedBudget }));
      ownedPublic = built.publicDirectory;
      ({ pair } = await captureOwnedScannerPair(built, ownedRun));
      activeBudgetStage = "owned:controls"; sharedBudget.startStage(activeBudgetStage, 25 * 60_000);
      ownedControlsPublic = createOwnedPublicEvidence(path.join(work, "owned-controls-public"), ownedRun);
      receipt.producer = { kind: built.kind, binary: pair.binary, run: pair.run, source: pair.source, state: pair.state };
    }
    const subject = path.join(work, "subject"); mkdirSync(subject, { mode: 0o755 });
    const scanner = path.join(subject, "trivy"); copyFileSync(built?.candidatePath ?? inputScanner, scanner); chmodSync(scanner, 0o555); chmodSync(subject, 0o555);
    if (built) ownedCopies.push(scanner);
    if (built) writeFileSync(path.join(output, "go-build-info.txt"), built.rawBuildInfo.A, { flag: "wx", mode: 0o400 });
    else copyFileSync(buildInfo, path.join(output, "go-build-info.txt"));
    const [binary] = await captureFiles([{ path: scanner, cap: 512 * MiB }]);
    if (binary.sha256 !== (pair?.binary.sha256 ?? original[0].sha256) || binary.size !== (pair?.binary.bytes ?? original[0].size)) fail("scanner_official_binary_changed");
    receipt.subject = binary;
    receipt.buildInventory = pair ?? inventory;
    await assertFilesUnchanged(original);
    await assertFilesUnchanged(policyInputs);
    if (!built) {
      const version = command(scanner, ["--version"], { file: path.join(output, "scanner-version.txt"), timeout: 30_000 }).toString("utf8");
      if (!/^Version: 0\.76\.1\r?$/mu.test(version)) fail("scanner_official_version_invalid");
    }
    const probe = path.join(work, "scanner-version-probe"); mkdirSync(probe);
    const probeFile = path.join(probe, "go.mod");
    writeFileSync(probeFile, versionProbeBytes({ scanner: { upstreamVersion: config.scanner.version }, compiler: { version: "1.27.3" } }), { flag: "wx" });
    chmodSync(probeFile, 0o444); chmodSync(probe, 0o555);
    const fixtureRoot = path.join(ROOT, "infra/scanner/materials/scanner-fixtures");
    const fixturePins = lock.fixtures.filter((entry) => entry.path.includes("scanner-fixtures/"));
    const fixtureFiles = fixturePins.map((entry) => ({ path: path.join(ROOT, entry.path), cap: 4 * MiB }));
    const fixtureSnapshot = await captureFiles(fixtureFiles);
    if (fixtureSnapshot.some((entry, index) => entry.sha256 !== fixturePins[index].sha256 || entry.size !== fixturePins[index].size)) fail("scanner_official_fixture_changed");
    const fixtures = (await readBoundedJson(path.join(fixtureRoot, "manifest.json"), MiB)).value.fixtures;
    const carrier = `${lock.baseline.repository}@${lock.baseline.platformDigest}`;
    let carrierBytes;
    await phase("diagnostic_carrier", async () => {
      command(DOCKER, ["pull", "--platform", "linux/amd64", carrier]);
      const inspected = JSON.parse(command(DOCKER, ["image", "inspect", carrier], { file: path.join(output, "carrier-inspect.json") }).toString("utf8"));
      carrierBytes = inspected?.[0]?.Size;
      if (inspected.length !== 1 || inspected[0].Os !== "linux" || inspected[0].Architecture !== "amd64" || !Number.isSafeInteger(carrierBytes) || carrierBytes < 1 || carrierBytes > 2 * GiB ||
          !inspected[0].RepoDigests?.includes(carrier)) fail("scanner_official_carrier_invalid");
      if (managed) {
        const bashVersion = command("/usr/bin/bash", ["--noprofile", "--norc", "--version"],
          { file: path.join(output, "bash-version.txt"), timeout: 30_000 }).toString("utf8");
        if (!/^GNU bash, version [1-9][0-9]*\.[0-9]+(?:\.[0-9]+)?/u.test(bashVersion)) fail("scanner_seaweed_rust_helper_control_invalid");
      }
      command(DOCKER, ["version", "--format", "{{json .}}"], { file: path.join(output, "docker-version.json") });
      command(DOCKER, ["buildx", "version"], { file: path.join(output, "buildx-version.txt") });
    });
    const cache = path.join(work, "cache"); mkdirSync(cache, { mode: 0o755 });
    const registry = (checkpoint) => [
      { name: "vulnerability", repository: "ghcr.io/aquasecurity/trivy-db", tag: "2" },
      { name: "java", repository: "ghcr.io/aquasecurity/trivy-java-db", tag: "1" },
    ].map((entry) => ({ ...entry, ...validateDatabaseRegistryManifest(command(DOCKER, ["buildx", "imagetools", "inspect", "--raw", `${entry.repository}:${entry.tag}`],
      { file: path.join(output, `database-${entry.name}-${checkpoint}-manifest.json`) })) }));
    const before = registry("before");
    await phase("database_download", async () => {
      for (const kind of ["vulnerability", "java"]) command(DOCKER, databaseDownloadDockerArguments({ baseline: carrier, cache, user: `${process.getuid()}:${process.getgid()}`, registries: before, kind }));
    });
    const after = registry("after");
    receipt.databaseRegistries = { before, after };
    if (JSON.stringify(before) !== JSON.stringify(after)) fail("scanner_database_registry_changed");
    const database = await databaseEvidence(cache, new Date(), output); readOnlyTree(cache);
    const ownedInputs = built ? [{ path: built.candidatePath, cap: 256 * MiB },
      { path: path.join(ROOT, "infra/scanner/owned-scanner-lock.json"), cap: MiB },
      { path: path.join(ROOT, "infra/managed-images/seaweed-rust-source.json"), cap: MiB }] : [];
    const inputs = await captureFiles([{ path: configFile, cap: MiB }, { path: lockFile, cap: MiB }, { path: scanner, cap: 512 * MiB }, ...ownedInputs,
      { path: probeFile, cap: MiB }, ...original.map(({ path: file, cap }) => ({ path: file, cap })), ...fixtureFiles,
      ...database.files.map(({ path: file, cap }) => ({ path: file, cap })), ...managedInputs.map(({ path: file, cap }) => ({ path: file, cap }))]);
    await assertFilesUnchanged(original); await assertFilesUnchanged(policyInputs); await assertFilesUnchanged(fixtureSnapshot);
    receipt.inputs = inputs;
    receipt.budget = projectAuditBudget({ buildInputBytes: original.reduce((sum, entry) => sum + entry.size, 0) +
      (built ? 3 * pair.binary.bytes + built.controlFixturePaths.reduce((sum, entry) => sum + entry.bytes, 0) : 0), materialBytes: fixtureSnapshot.reduce((sum, entry) => sum + entry.size, 0),
      databaseBytes: database.files.reduce((sum, entry) => sum + entry.size, 0), baselineImageBytes: carrierBytes, versionProbeBytes: lstatSync(probeFile).size });
    const scan = (mode, target, file, format = "json", extra = ["--offline-scan"]) => command(DOCKER, candidateDockerArguments({ carrier, scanner, cache, mode, target, format, extra }), { file });
    if (built) await phase("owned_scanner_qualification", async () => {
      const referenceSubject = path.join(work, "reference"); mkdirSync(referenceSubject, { mode: 0o755 });
      const referenceScanner = path.join(referenceSubject, "trivy"); copyFileSync(inputScanner, referenceScanner); chmodSync(referenceScanner, 0o555); chmodSync(referenceSubject, 0o555);
      ownedCopies.push(referenceScanner);
      const [reference] = await captureFiles([{ path: referenceScanner, cap: 512 * MiB }]);
      validateOfficialScannerIdentity(reference, config.scanner); inputs.push(reference);
      receipt.budget = projectAuditBudget({ ...receipt.budget, buildInputBytes: receipt.budget.buildInputBytes + reference.size });
      const rustControlMetadata = rustMetadata ?? validateSeaweedRustSourceLock((await readBoundedJson(path.join(ROOT, "infra/managed-images/seaweed-rust-source.json"), MiB)).value, config);
      const controlsWork = path.join(work, "owned-controls"); mkdirSync(controlsWork, { mode: 0o700 });
      const databaseJoin = { vulnerabilityDbSha256: database.files[0].sha256, javaDbSha256: database.files[2].sha256 };
      const checkInputs = async () => { await assertFilesUnchanged(inputs); await databaseEvidence(cache, new Date()); };
      const qualification = await qualifyOwnedScanner({ built, pair, carrier, cache, subject, referenceSubject, referenceScanner,
        probe, fixtures, fixtureRoot, lock, rustMetadata: rustControlMetadata, databaseJoin, command, work: controlsWork,
        publicEvidence: ownedControlsPublic, checkInputs, onState: (state) => { receipt.ownedQualification = state; },
        auditBuilder: async (candidate) => {
          const image = { role: "go-builder", repository: "library/golang", version: "1.27.3-alpine3.24",
            manifestDigest: "sha256:b8c9b82affbbb82a020bbcf998dad2ba9516944ac7e883524642a481a9505e9c",
            platform: { os: "linux", architecture: "amd64", variant: null, digest: "sha256:bff16a94c0b4b6d9642581e2a3aa81beb3edb940b2f5a3aac1d22c6a68cb7747" } };
          await checkInputs();
          const reports = [];
          for (const format of ["json", "cyclonedx"]) {
            const file = path.join(controlsWork, `go-builder-${format}.json`);
            command(DOCKER, officialImageScanArguments(carrier, candidate, cache, image, format), { file, privateOutput: true, maxOutputBytes: 8 * MiB });
            reports.push((await readBoundedJson(file, 4 * MiB)).value);
          }
          const inventory = validateOfficialImageSbom(reports[0], reports[1], image);
          const proof = validateOwnedBuilderAudit({ run: pair.run, binary: pair.binary, databaseJoin, subject: image,
            report: reports[0], sbom: reports[1], inventory, now: new Date() });
          ownedControlsPublic.write("go-builder.json", reports[0]); ownedControlsPublic.write("go-builder.cdx.json", reports[1]);
          await checkInputs();
          return proof;
        },
      });
      receipt.ownedQualification = qualification;
      sharedBudget.finishStage(activeBudgetStage, "PASSED"); activeBudgetStage = null;
      activeBudgetStage = "downstream:audit"; sharedBudget.startStage(activeBudgetStage, 225 * 60_000);
    });
    if (!built) await phase("self_audit", async () => {
      const json = path.join(output, "scanner-self.json"); const sbom = path.join(output, "scanner-self.cdx.json");
      scan("rootfs", subject, json, "json", ["--offline-scan", "--severity", "HIGH,CRITICAL"]); scan("rootfs", subject, sbom, "cyclonedx");
      validateSelfReport((await readBoundedJson(json)).value, (await readBoundedJson(sbom)).value, inventory, config.scanner.version, { expectedScannerVersion: config.scanner.version });
      await assertFilesUnchanged(inputs);
    });
    if (!built) await phase("main_version_probe", async () => {
      const file = path.join(output, "scanner-version-probe.json"); scan("fs", probe, file, "json", ["--offline-scan", "--severity", "HIGH,CRITICAL"]);
      validateVersionProbeReport((await readBoundedJson(file)).value, config.scanner.version, { expectedScannerVersion: config.scanner.version });
      await assertFilesUnchanged(inputs);
    });
    if (!built) await phase("fixtures_and_same_database_baseline", async () => {
      for (const fixture of fixtures) {
        const target = fixture.material[0].path.startsWith("gomod/") ? "gomod" : fixture.material[0].path;
        const mode = fixtureScanMode(fixture); const file = path.join(output, `fixture-${fixture.id}-official.json`);
        scan(mode, path.join(fixtureRoot, target), file);
        const observed = validateFixtureReport(fixture, (await readBoundedJson(file)).value, config.scanner.version);
        if (fixture.id !== "java-jar-clean-candidate") {
          const baselineFile = path.join(output, `fixture-${fixture.id}-baseline.json`);
          command(DOCKER, baselineFixtureArguments(lock, cache, fixtureRoot, mode, target), { file: baselineFile });
          compareSameDatabase(observed, validateFixtureReport(fixture, (await readBoundedJson(baselineFile)).value, lock.baseline.version));
        }
        await assertFilesUnchanged(inputs);
      }
    });
    const localImages = new Map();
    if (managed) {
      await phase("builder_image_audits", async () => {
        const collected = await collectImageAudits(managed.buildTools, {
          beforeScan: async () => { await databaseEvidence(cache, new Date()); await assertFilesUnchanged(inputs); },
          scan: async (image) => {
            for (const format of ["json", "cyclonedx"]) command(DOCKER, officialImageScanArguments(carrier, scanner, cache, image, format),
              { file: path.join(output, `builder-${image.role}.${format === "json" ? "json" : "cdx.json"}`) });
          },
          afterScan: async () => assertFilesUnchanged(inputs),
          captureReport: async (image) => {
            const files = [path.join(output, `builder-${image.role}.json`), path.join(output, `builder-${image.role}.cdx.json`)];
            const frozen = await captureFiles(files.map((file) => ({ path: file, cap: 64 * MiB })));
            return { files, frozen, identity: frozen.map(({ sha256, size }) => ({ sha256, size })) };
          },
          readReport: async (_image, report) => { await assertFilesUnchanged(report.frozen); return { json: (await readBoundedJson(report.files[0])).value, sbom: (await readBoundedJson(report.files[1])).value }; },
          evaluate: async (image, report) => { validateOfficialImageSbom(report.json, report.sbom, image); return evaluateImageReport(report.json, image, [], new Date()); },
        });
        receipt.builderReports = collected.reports; receipt.builderBlockers = collected.blockers;
        if (collected.rejections.length) fail("scanner_managed_builders_blocked");
      });
      await phase("managed_image_builds", async () => {
        const source = process.env.GITHUB_SHA;
        if (!/^[a-f0-9]{40}$/u.test(source ?? "")) fail("scanner_managed_source_invalid");
        receipt.builds = [];
        const artifacts = path.join(work, "managed-images"); mkdirSync(artifacts, { mode: 0o755 });
        for (const candidate of managed.candidates) {
          await assertFilesUnchanged(inputs);
          const tag = `auto-world-managed/${candidate.role}:${source}`;
          const metadataFile = path.join(artifacts, `${candidate.role}-buildx.json`);
          const archive = path.join(artifacts, `managed-image-${candidate.role}.tar`);
          const evidence = path.join(output, "managed-evidence", candidate.role);
          const build = { role: candidate.role, result: "failed", identityKind: "LOCAL_DIAGNOSTIC_NOT_REGISTRY_SUBJECT" };
          receipt.builds.push(build);
          try {
            if (sharedBudget) {
              const existing = invoke(DOCKER, ["image", "inspect", tag], 15_000);
              if (!validateOwnedImageAbsence(existing, tag)) fail("scanner_owned_image_tag_not_absent");
              dockerCleanup.registerImage({ tag, owner });
            }
            command(DOCKER, ["buildx", "build", "--platform", "linux/amd64", "--progress", "plain", "--file", path.join(ROOT, candidate.dockerfile),
              "--target", "runtime", "--tag", tag, ...(sharedBudget ? ["--label", `io.auto-world.scanner-official=${owner}`] : []),
              "--metadata-file", metadataFile, "--load", ROOT], { timeout: 90 * 60_000 });
            const inspectedFile = path.join(output, `managed-${candidate.role}-inspect.json`);
            const inspected = JSON.parse(command(DOCKER, ["image", "inspect", tag], { file: inspectedFile }).toString("utf8"));
            const metadata = (await readBoundedJson(metadataFile, MiB)).value;
            const identity = validateManagedLocalImage(inspected, metadata, tag);
            if (sharedBudget) dockerCleanup.bindImageId(tag, identity.imageId);
            command(DOCKER, ["image", "save", "--output", archive, tag]); chmodSync(archive, 0o444);
            const frozen = await captureFiles([{ path: metadataFile, cap: MiB }, { path: inspectedFile, cap: MiB }]);
            const archiveSnapshot = await captureManagedArchive(archive, candidate.role);
            await assertFilesUnchanged(frozen);
            build.subject = { kind: "LOCAL_MANAGED_IMAGE_V1", ...identity, archiveSha256: archiveSnapshot.sha256, archiveBytes: archiveSnapshot.size,
              archiveCapBytes: archiveSnapshot.cap, artifactName: `/${path.basename(archive)}` };
            build.result = "passed"; localImages.set(candidate.role, { ...candidate, archive, archiveSnapshot, frozen, subject: build.subject });
          } catch (error) {
            build.reason = error.message;
            if (receipt.commands.at(-1)?.error || cleanupUncertain) throw error;
          }
          if (build.result !== "passed" && candidate.role !== "opensearch") {
            build.evidenceExport = "not_attempted_runtime_failed";
            await assertFilesUnchanged(inputs);
            continue;
          }
          // The evidence target exports text/JUnit only. A recorded failed core
          // build remains failed; its retained status cannot approve runtime.
          try {
            command(DOCKER, ["buildx", "build", "--platform", "linux/amd64", "--progress", "plain", "--file", path.join(ROOT, candidate.dockerfile),
              "--target", "evidence", "--output", `type=local,dest=${evidence}`, ROOT], { timeout: 90 * 60_000 });
            const published = path.join(output, "managed-public-evidence");
            if (!existsSync(published)) mkdirSync(published, { mode: 0o700 });
            build.publicEvidence = exportManagedTextEvidence(evidence, path.join(published, candidate.role));
            if (candidate.role === "postgres" && build.result === "passed") {
              const runtime = path.join(artifacts, "postgres-runtime"); mkdirSync(runtime, { mode: 0o700 });
              const finalInventory = command(DOCKER, managedGosuHashArguments(build.subject),
                { file: path.join(runtime, "binary-sha256.txt"), timeout: 30_000 });
              build.gosuSourceEvidence = bindManagedGosuEvidence(build.subject, { finalInventory,
                buildInfo: readFileSync(path.join(evidence, "build-info.txt")), binaryInventory: readFileSync(path.join(evidence, "binary-sha256.txt")),
                sourceInventory: readFileSync(path.join(evidence, "source-sha256.txt")), goMod: readFileSync(path.join(evidence, "go.mod")), goSum: readFileSync(path.join(evidence, "go.sum")) });
              localImages.get(candidate.role).gosuEvidence = build.gosuSourceEvidence;
              build.runtimeGosuEvidence = exportManagedTextEvidence(runtime, path.join(published, "postgres-runtime"));
            }
            if (candidate.role === "opensearch" && build.result === "passed") {
              const runtime = path.join(artifacts, "opensearch-runtime"); mkdirSync(runtime, { mode: 0o700 });
              for (const file of ["jdk-restored.txt", "runtime-java-version.txt", "runtime-java-properties.txt"]) {
                command(DOCKER, ["run", "--rm", "--pull=never", "--platform", "linux/amd64", "--network=none", "--read-only", "--cap-drop=ALL",
                  "--security-opt=no-new-privileges=true", "--user", "1000:1000", "--pids-limit", "32", "--memory", "64m", "--memory-swap", "64m", "--cpus", "1",
                  "--entrypoint", "/bin/cat", build.subject.imageId, `/managed-evidence/${file}`], { file: path.join(runtime, file), timeout: 30_000 });
              }
              build.runtimeJdkEvidence = exportManagedTextEvidence(runtime, path.join(published, "opensearch-runtime"));
            }
            build.evidenceExport = "passed";
          } catch (error) {
            build.evidenceExport = "failed"; build.evidenceReason = error.message;
            const diagnostic = managedEvidenceDiagnostic(error);
            if (diagnostic) build.evidenceDiagnostic = diagnostic;
            if (receipt.commands.at(-1)?.error || cleanupUncertain) throw error;
          }
          await assertFilesUnchanged(inputs);
        }
      });
    }
    let originalImageFailure, seaweedGoS3SourceImage;
    try { await phase("five_image_audits", async () => {
      receipt.runtimeSubjects = config.images.map((image) => localImages.has(image.role)
        ? { role: image.role, ...localImages.get(image.role).subject }
        : { role: image.role, kind: "UPSTREAM_REGISTRY_SUBJECT", repository: image.repository, manifestDigest: image.manifestDigest, platform: image.platform });
      const reports = new Map();
      const collected = await collectImageAudits(config.images, {
        beforeScan: async () => { if (cleanupUncertain) fail("scanner_official_cleanup_uncertain"); await databaseEvidence(cache, new Date()); await assertFilesUnchanged(inputs); },
        scan: async (image) => {
          const files = { json: path.join(output, `image-${image.role}.json`), sbom: path.join(output, `image-${image.role}.cdx.json`) }; reports.set(image.role, files);
          const failures = [];
          const local = localImages.get(image.role);
          if (managed?.candidates.some((candidate) => candidate.role === image.role) && !local) fail("scanner_managed_image_not_built");
          for (const format of ["json", "cyclonedx"]) {
            if (local) { await assertFilesUnchanged(local.frozen); await assertManagedArchiveUnchanged(local.archiveSnapshot); }
            try { command(DOCKER, local ? officialArchiveScanArguments(carrier, scanner, cache, local.archive, format) : officialImageScanArguments(carrier, scanner, cache, image, format),
              { file: format === "json" ? files.json : files.sbom }); }
            catch (error) { failures.push(error); }
            if (local) { await assertManagedArchiveUnchanged(local.archiveSnapshot); await assertFilesUnchanged(local.frozen); }
          }
          if (failures.length) throw failures[0];
        },
        afterScan: async () => assertFilesUnchanged(inputs),
        captureReport: async (image) => {
          const files = reports.get(image.role); const frozen = await captureFiles([{ path: files.json, cap: 64 * MiB }, { path: files.sbom, cap: 64 * MiB }]);
          return { identity: frozen.map(({ sha256, size }) => ({ sha256, size })), files, frozen };
        },
        readReport: async (_image, report) => {
          const json = await readBoundedJson(report.files.json); const sbom = await readBoundedJson(report.files.sbom); await assertFilesUnchanged(report.frozen);
          return { json: json.value, sbom: sbom.value };
        },
        evaluate: async (image, report) => {
          const local = localImages.get(image.role);
          if (local) {
            await assertFilesUnchanged(local.frozen);
            await assertManagedArchiveUnchanged(local.archiveSnapshot);
            validateOfficialArchiveSbom(report.json, report.sbom, local.subject);
            if (image.role === "postgres" && !local.gosuEvidence) fail("scanner_gosu_source_evidence_invalid");
            const evaluated = evaluateArchiveImageReport(report.json, local.subject, new Date(), local.gosuEvidence);
            if (evaluated.sourceComponents) {
              receipt.sourceBoundInventory = [{ role: image.role, rawPackageCount: evaluated.rawPackageCount,
                versionedPackageCount: evaluated.versionedPackageCount, sourceBoundPackageCount: evaluated.sourceBoundPackageCount,
                sourceComponents: evaluated.sourceComponents }];
            }
            return evaluated;
          }
          validateOfficialImageSbom(report.json, report.sbom, image);
          return evaluateImageReport(report.json, image, [], new Date(), { expectedScannerVersion: config.scanner.version });
        },
      });
      receipt.reports = collected.reports; receipt.blockers = collected.blockers; receipt.rejections = collected.rejections;
      if (collected.rejections.length) fail("scanner_official_images_blocked");
    }); } catch (error) {
      originalImageFailure = deferManagedImageAuditFailure({ scope, error, cleanupUncertain });
    }
    if (managed) await runManagedSeaweedRustPostImageLifecycle({ receipt, originalImageFailure }, {
      sourceAndHelperAudits: async () => {
      const sourceRoot = path.join(work, "seaweed-rust-source-inputs"); mkdirSync(sourceRoot, { mode: 0o700 });
      for (const entry of rustMetadata.files) {
        const destination = path.join(sourceRoot, ...entry.path.split("/"));
        mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
        if (existsSync(destination)) fail("scanner_seaweed_rust_source_invalid");
        const fetch = seaweedRustSourceFetchArguments(entry, destination);
        command(fetch.command, fetch.args, { timeout: fetch.timeoutMs, requireEmptyStderr: true });
      }
      const prepared = prepareSeaweedRustLockViews({ metadata: rustMetadata, sourceRoot,
        viewsRoot: path.join(work, "seaweed-rust-lock-views") });
      const sourceInputs = await captureFiles(prepared.originals.map(({ path: file, cap }) => ({ path: file, cap })));
      if (sourceInputs.some((entry, index) => entry.size !== prepared.originals[index].size || entry.sha256 !== prepared.originals[index].sha256)) {
        fail("scanner_seaweed_rust_source_changed");
      }
      receipt.seaweedRustSources = sourceInputs.map(({ path: file, size, sha256 }) => ({
        path: path.relative(sourceRoot, file).replaceAll(path.sep, "/"), size, sha256 }));
      const viewByRole = new Map(prepared.views.map((entry) => [entry.role, entry]));
      const publicRoot = path.join(work, "seaweed-rust-public"); mkdirSync(publicRoot, { mode: 0o700 });
      const publicSources = path.join(publicRoot, "sources"); mkdirSync(publicSources, { mode: 0o700 });
      for (const entry of rustMetadata.files) {
        const relative = seaweedRustPublicSourcePath(entry.path);
        const destination = path.join(publicSources, ...relative.split("/"));
        mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
        copyFileSync(path.join(sourceRoot, ...entry.path.split("/")), destination); chmodSync(destination, 0o400);
      }
      const publicSourceInputs = await captureFiles(rustMetadata.files.map((entry) => {
        const relative = seaweedRustPublicSourcePath(entry.path);
        return { path: path.join(publicSources, ...relative.split("/")), cap: MiB };
      }));
      receipt.seaweedRustPublicSources = validateSeaweedRustPublicSourceMapping({ metadata: rustMetadata,
        originals: receipt.seaweedRustSources,
        copies: publicSourceInputs.map(({ path: file, size, sha256 }) => ({
          path: path.relative(publicSources, file).replaceAll(path.sep, "/"), size, sha256 })),
      });
      writeJson(path.join(publicRoot, "source-map.json"), receipt.seaweedRustPublicSources);
      chmodSync(path.join(publicRoot, "source-map.json"), 0o400);
      copyFileSync(rustMetadataFile, path.join(publicRoot, "seaweed-rust-source.json"));
      chmodSync(path.join(publicRoot, "seaweed-rust-source.json"), 0o400);
      receipt.seaweedRustControls = [];
      receipt.seaweedRustSourceAudits = [];
      receipt.seaweedRustHelpers = [];
      const rustFailures = [];
      const globalCheck = async () => {
        if (cleanupUncertain) fail("scanner_official_cleanup_uncertain");
        await databaseEvidence(cache, new Date()); await assertFilesUnchanged(inputs); await assertFilesUnchanged(sourceInputs);
      };
      for (const control of rustMetadata.controls) {
        await globalCheck();
        const view = viewByRole.get(control.role); const file = path.join(output, `seaweed-rust-${control.role}.json`);
        let failure, result;
        try {
          try { command(DOCKER, seaweedRustScanArguments({ carrier, scanner, cache, view: view.path, format: "json" }), { file }); }
          catch (error) {
            if (receipt.commands.at(-1)?.error || receipt.commands.at(-1)?.signal || cleanupUncertain) throw error;
            failure = classifySeaweedRustSubjectFailure(error, "control");
          }
          if (!failure) ({ result, failure } = await auditAndPublishSeaweedRustControlReport({ control: control.role, file,
            directory: path.join(publicRoot, "controls"), metadata: rustMetadata, artifactName: view.artifactName, now: new Date() }));
          if (failure) {
            receipt.seaweedRustControls.push({ role: control.role, result: "rejected", reason: failure.message });
            rustFailures.push(failure);
          } else receipt.seaweedRustControls.push(result);
        } finally { await globalCheck(); }
      }
      for (const role of rustMetadata.roles) {
        await globalCheck();
        const view = viewByRole.get(role.role);
        const files = { json: path.join(output, `seaweed-rust-${role.role}.json`), sbom: path.join(output, `seaweed-rust-${role.role}.cdx.json`) };
        const scanFailures = [];
        for (const format of ["json", "cyclonedx"]) {
          try { command(DOCKER, seaweedRustScanArguments({ carrier, scanner, cache, view: view.path, format }),
            { file: format === "json" ? files.json : files.sbom }); }
          catch (error) {
            if (receipt.commands.at(-1)?.error || receipt.commands.at(-1)?.signal || cleanupUncertain) throw error;
            scanFailures.push(classifySeaweedRustSubjectFailure(error, "source"));
          }
          await globalCheck();
        }
        let result, failure;
        try {
          if (scanFailures.length) failure = scanFailures[0];
          else ({ result, failure } = await auditAndPublishSeaweedRustSourceReports({ role: role.role, files,
            directory: path.join(publicRoot, "audits"), metadata: rustMetadata, artifactName: view.artifactName, now: new Date() }));
          if (failure) {
            receipt.seaweedRustSourceAudits.push({ role: role.role, result: "rejected", reason: failure.message }); rustFailures.push(failure);
          } else {
            receipt.seaweedRustSourceAudits.push(result);
            if (result.result !== "passed") rustFailures.push(new Error("scanner_seaweed_rust_policy_blocked"));
          }
        } finally { await globalCheck(); }
      }
      const seaweed = config.images.find((image) => image.role === "seaweedfs");
      const reference = `${seaweed.repository}@${seaweed.platform.digest}`;
      command(DOCKER, ["pull", "--platform", "linux/amd64", reference], { timeout: 5 * 60_000 });
      const inspected = JSON.parse(command(DOCKER, ["image", "inspect", reference],
        { file: path.join(output, "seaweed-rust-image-inspect.json") }).toString("utf8"));
      const imageReport = (await readBoundedJson(path.join(output, "image-seaweedfs.json"))).value;
      const imageId = validatePreparedRuntimeImage(inspected, imageReport);
      if (imageId !== `sha256:${seaweedGoS3Profile.source.configSha256}` || reference !==
          `${seaweedGoS3Profile.source.repository}@${seaweedGoS3Profile.source.platformDigest}`) {
        fail("scanner_seaweed_go_s3_profile_invalid");
      }
      seaweedGoS3SourceImage = { reference, imageId, manifestDigest: seaweedGoS3Profile.source.platformDigest,
        configDigest: `sha256:${seaweedGoS3Profile.source.configSha256}`, platform: "linux/amd64" };
      const helperRoot = path.join(work, "seaweed-rust-helper-copies"); mkdirSync(helperRoot, { mode: 0o700 });
      const limitRoot = path.join(work, "seaweed-rust-soft-limit-control"); mkdirSync(limitRoot, { mode: 0o700 });
      const disk = statfsSync(helperRoot); const freeBytes = disk.bavail * disk.bsize;
      let helperReceipt, helperFailure;
      try {
        helperReceipt = await collectSeaweedRustHelperIdentity({ metadata: rustMetadata, imageId, imageReport, directory: helperRoot,
          limitDirectory: limitRoot, name: `aw-seaweed-rust-${randomUUID()}`, owner, freeBytes }, {
          softLimitControl: async (spec) => {
            try { command(spec.command, spec.args, { timeout: spec.timeoutMs, env: spec.environment, expectedStdout: spec.expectedStdout }); }
            catch (error) {
              throw classifySeaweedRustHelperCommandFailure({ error, record: receipt.commands.at(-1), operation: "softLimitControl" });
            }
          },
          create: async (args) => {
            try { return command(DOCKER, args, { timeout: 30_000, requireEmptyStderr: true }).toString("utf8").trim(); }
            catch (error) {
              throw classifySeaweedRustHelperCommandFailure({ error, record: receipt.commands.at(-1), operation: "create" });
            }
          },
          inspect: async (name) => {
            const result = invoke(DOCKER, ["container", "inspect", name], 15_000);
            const record = { executable: "docker", operation: "seaweed_rust_inspect_container", exitCode: result.status,
              signal: result.signal, error: result.error?.code ?? null };
            if (!successful(result)) record.diagnostic = commandFailureDiagnostic(result);
            receipt.commands.push(record);
            if (record.error != null || record.signal != null) {
              throw classifySeaweedRustHelperCommandFailure({ error: new Error("scanner_official_command_failed"), record, operation: "inspect" });
            }
            return successful(result) ? JSON.parse(result.stdout.toString("utf8")) : result;
          },
          copy: async (spec) => {
            try { command(spec.command, spec.args, { timeout: spec.timeoutMs, env: spec.environment,
              expectedStdout: spec.expectedStdout, requireEmptyStderr: true }); }
            catch (error) {
              throw classifySeaweedRustHelperCommandFailure({ error, record: receipt.commands.at(-1), operation: "copy" });
            }
          },
          measure: async ({ file }) => measureSeaweedRustHelperFile(file),
          listHostFiles: async (directory) => readdirSync(directory),
          remove: async (args) => { command(DOCKER, args, { timeout: 30_000, requireEmptyStderr: true }); },
          proveAbsent: async (name, anonymousVolumes) => {
            const container = invoke(DOCKER, ["container", "inspect", name], 15_000);
            receipt.commands.push({ executable: "docker", operation: "seaweed_rust_prove_container_absent", exitCode: container.status,
              signal: container.signal, error: container.error?.code ?? null });
            const volumes = anonymousVolumes.map((volume) => {
              const result = invoke(DOCKER, ["volume", "inspect", volume], 15_000);
              receipt.commands.push({ executable: "docker", operation: "seaweed_rust_prove_volume_absent", exitCode: result.status,
                signal: result.signal, error: result.error?.code ?? null });
              return result;
            });
            return anonymousVolumes.length ? { container, volumes } : container;
          },
        });
      } catch (error) {
        if (error.message === "scanner_seaweed_rust_helper_cleanup_uncertain") { cleanupUncertain = true; throw error; }
        if (receipt.commands.at(-1)?.error || receipt.commands.at(-1)?.signal || cleanupUncertain) throw error;
        helperFailure = classifySeaweedRustSubjectFailure(error, "helper");
        receipt.seaweedRustHelpers = rustMetadata.roles.map(({ role }) => ({ role, result: "rejected", reason: helperFailure.message }));
        rustFailures.push(helperFailure);
      }
      if (!helperFailure) {
        receipt.seaweedRustHelpers = helperReceipt.measurements;
        writeJson(path.join(publicRoot, "helper-measurements.json"), helperReceipt);
        if (helperReceipt.result === "rejected") {
          rustFailures.push(new Error(helperReceipt.measurements.find((entry) => entry.result === "rejected").reason));
        }
      }
      await globalCheck();
      const controlEvidence = receipt.seaweedRustControls.map((entry) => entry.result === "passed" ? ({
        role: entry.role, result: entry.result, evidenceClass: entry.evidenceClass, packageCount: entry.inventory.pairs.length,
        inventorySha256: entry.inventory.sha256, findingCount: entry.findingCount, blockerCount: entry.blockerCount,
      }) : ({ role: entry.role, result: "rejected", reason: entry.reason }));
      const sourceEvidence = receipt.seaweedRustSourceAudits.map((entry) => entry.evidenceClass ? ({
        role: entry.role, result: entry.result, evidenceClass: entry.evidenceClass, scope: entry.scope, lockSha256: entry.lockSha256,
        contextImageDigest: entry.contextImageDigest, packageCount: entry.packageCount, inventorySha256: entry.inventorySha256,
        findingCount: entry.findings.length, blockerCount: entry.blockers.length,
      }) : ({ role: entry.role, result: "rejected", reason: entry.reason }));
      const helperEvidence = receipt.seaweedRustHelpers.map((entry) => entry.evidenceClass ? ({
        role: entry.role, result: entry.result, evidenceClass: entry.evidenceClass, imageDigest: entry.imageDigest, bytes: entry.bytes,
        sha256: entry.sha256, hostCopyMode: entry.hostCopyMode, hostCopyNlink: entry.hostCopyNlink,
        intrinsicBinaryInventory: entry.intrinsicBinaryInventory, sourceToBinaryEquivalence: entry.sourceToBinaryEquivalence,
      }) : ({ role: entry.role, result: "rejected", reason: entry.reason }));
      const publicReceipt = { schemaVersion: 1, state: "diagnostic_only", admission: "NOT_AUTHORIZED", milestone2: "NOT_ESTABLISHED",
        controls: controlEvidence, sourceAudits: sourceEvidence, helpers: helperEvidence, limitations: rustMetadata.limitations };
      validateSeaweedRustPublicEvidence(publicReceipt, rustMetadata);
      writeJson(path.join(publicRoot, "receipt.json"), publicReceipt);
      const published = path.join(output, "managed-public-evidence"); if (!existsSync(published)) mkdirSync(published, { mode: 0o700 });
      receipt.seaweedRustPublicEvidence = exportManagedTextEvidence(publicRoot, path.join(published, "seaweed-rust-source"));
      await assertFilesUnchanged(inputs); await assertFilesUnchanged(sourceInputs); await assertFilesUnchanged(publicSourceInputs);
        return { failure: rustFailures[0] ?? null };
      },
      producedImageRuntime: async () => {
        await phase("seaweed_go_s3_source_preflight", async () => {
          if (!seaweedGoS3SourceImage) fail("scanner_seaweed_go_s3_source_preflight_invalid");
          const directory = path.join(work, `seaweed-go-s3-preflight-${randomUUID()}`); mkdirSync(directory, { mode: 0o700 });
          const archive = path.join(directory, "source-save.tar");
          const frozenConfig = path.join(directory, "source-config.json");
          copyFileSync(seaweedGoS3ConfigFile, frozenConfig); chmodSync(frozenConfig, 0o444);
          const publicRoot = path.join(directory, "public"); mkdirSync(publicRoot, { mode: 0o700 });
          const inspector = path.join(ROOT, "scripts/scanner/seaweed_profile_archive.py");
          const python = "/usr/bin/python3";
          const preflightInputs = await captureFiles([
            { path: seaweedGoS3ProfileFile, cap: MiB }, { path: seaweedGoS3ConfigFile, cap: MiB }, { path: frozenConfig, cap: MiB },
            { path: inspector, cap: MiB }, { path: path.join(ROOT, "scripts/scanner/seaweed-go-s3.mjs"), cap: MiB },
            { path: import.meta.filename, cap: MiB },
          ]);
          if (preflightInputs[1].size !== preflightInputs[2].size || preflightInputs[1].sha256 !== preflightInputs[2].sha256) {
            fail("scanner_seaweed_go_s3_profile_invalid");
          }
          const finiteToolProbe = (executable, args, operation) => {
            const result = invoke(executable, args, 30_000);
            const record = { executable: path.basename(executable), operation, exitCode: result.status, signal: result.signal,
              error: result.error?.code ?? null };
            receipt.commands.push(record);
            if (!successful(result)) { record.diagnostic = commandFailureDiagnostic(result); fail("scanner_official_command_failed"); }
            if ((result.stderr?.length ?? 0) > 0 && (result.stdout?.length ?? 0) > 0) fail("scanner_seaweed_go_s3_tool_evidence_invalid");
            return Buffer.concat([result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0)]).toString("utf8").trim();
          };
          const filesystemEvidence = (directoryPath) => {
            const resolved = realpathSync(directoryPath);
            const identity = lstatSync(resolved);
            const disk = statfsSync(resolved, { bigint: true });
            const free = disk.bavail * disk.bsize;
            if (free < 1n || free > BigInt(Number.MAX_SAFE_INTEGER)) fail("scanner_seaweed_go_s3_filesystem_invalid");
            return { path: resolved, filesystemId: `${identity.dev}:${disk.type}`, freeBytes: Number(free) };
          };
          let result;
          try {
            result = await runSeaweedGoS3SourcePreflight({ source: seaweedGoS3SourceImage,
              paths: { archive, config: frozenConfig, inspector, python, scratchDirectory: directory } }, {
            assertInputsUnchanged: async () => { await assertFilesUnchanged(inputs); await assertFilesUnchanged(preflightInputs); },
            probeTools: async () => {
              const version = JSON.parse(command(DOCKER, seaweedGoS3DockerVersionArguments(),
                { file: path.join(directory, "docker-version.json"), timeout: 30_000, requireEmptyStderr: true }).toString("utf8"));
              const info = JSON.parse(command(DOCKER, seaweedGoS3DockerInfoArguments(),
                { file: path.join(directory, "docker-info.json"), timeout: 30_000, requireEmptyStderr: true }).toString("utf8"));
              return { docker: { clientVersion: version?.Client?.Version, serverVersion: version?.Server?.Version,
                apiVersion: version?.Client?.ApiVersion, dockerRootDir: info?.DockerRootDir,
                operatingSystem: info?.OSType, architecture: info?.Architecture },
              python: { version: finiteToolProbe(python, seaweedGoS3PythonVersionArguments(), "seaweed_go_s3_python_version") },
              gnuTar: { version: finiteToolProbe("/usr/bin/tar", seaweedGoS3GnuTarVersionArguments(), "seaweed_go_s3_gnu_tar_version") } };
            },
            statFilesystems: async ({ scratchDirectory, dockerRootDirectory }) => {
              const scratch = filesystemEvidence(scratchDirectory), docker = filesystemEvidence(dockerRootDirectory);
              return { scratch, docker };
            },
            saveSource: async (spec) => { command(spec.command, spec.args, { timeout: spec.timeoutMs, requireEmptyStderr: true }); },
            lockArchive: async (file) => { chmodSync(file, 0o444); },
            captureArchive: async ({ file, cap }) => {
              const [captured] = await captureFiles([{ path: file, cap }]);
              return { bytes: captured.size, sha256: captured.sha256 };
            },
            inspectSource: async (spec) => {
              const reportFile = path.join(directory, "source-preflight.json");
              try { command(spec.command, spec.args, { file: reportFile, timeout: spec.timeoutMs, requireEmptyStderr: true }); }
              catch (error) {
                const record = receipt.commands.at(-1);
                if (record?.error != null || record?.signal != null || record?.exitCode !== 2 || record?.diagnostic?.stderrBytes !== 0) throw error;
                const refusal = validateSeaweedGoS3SourceRefusal((await readBoundedJson(reportFile, 4 * MiB)).value);
                throw seaweedGoS3SourceRefusalError(refusal);
              }
              return (await readBoundedJson(reportFile, 4 * MiB)).value;
            },
            removeOwnedArchive: async (file) => {
              try {
                if (!existsSync(file)) return;
                const info = lstatSync(file);
                if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) fail("scanner_seaweed_go_s3_cleanup_uncertain");
                chmodSync(file, 0o600); unlinkSync(file);
              } catch { fail("scanner_seaweed_go_s3_cleanup_uncertain"); }
            },
            archiveAbsent: async (file) => {
              try { lstatSync(file); return false; }
              catch (error) {
                if (error?.code === "ENOENT") return true;
                fail("scanner_seaweed_go_s3_cleanup_uncertain");
              }
            },
            });
          } catch (error) {
            const refusalReceipt = seaweedGoS3SourceRefusalReceipt(error);
            if (!refusalReceipt) throw error;
            receipt.seaweedGoS3SourcePreflight = refusalReceipt;
            writeJson(path.join(publicRoot, "source-preflight-refusal.json"), refusalReceipt);
            const published = path.join(output, "managed-public-evidence");
            if (!existsSync(published)) mkdirSync(published, { mode: 0o700 });
            receipt.seaweedGoS3PublicEvidence = exportManagedTextEvidence(publicRoot, path.join(published, "seaweed-go-s3"));
            throw error;
          }
          receipt.seaweedGoS3SourcePreflight = result;
          writeJson(path.join(publicRoot, "source-preflight.json"), result);
          const published = path.join(output, "managed-public-evidence");
          if (!existsSync(published)) mkdirSync(published, { mode: 0o700 });
          receipt.seaweedGoS3PublicEvidence = exportManagedTextEvidence(publicRoot, path.join(published, "seaweed-go-s3"));
          await assertFilesUnchanged(inputs); await assertFilesUnchanged(preflightInputs);
        });
        await phase("seaweed_go_s3_inert_qualification", async () => {
          const directory = path.join(work, `seaweed-go-s3-inert-${randomUUID()}`);
          mkdirSync(directory, { mode: 0o700 });
          const runId = randomUUID(), started = performance.now();
          const names = seaweedGoS3QualificationNames({ runId, scratchDirectory: directory });
          const inspector = path.join(ROOT, "scripts/scanner/seaweed_profile_archive.py");
          const qualificationInputs = await captureFiles([
            { path: inspector, cap: MiB }, { path: path.join(ROOT, "scripts/scanner/seaweed-go-s3.mjs"), cap: MiB },
            { path: import.meta.filename, cap: MiB },
          ]);
          const filePaths = new Set(Object.values(names.paths));
          const snapshots = new Map(), cleanedContainers = new Map(), cleanedImages = new Map(), cleanedVolumes = new Set();
          let privateOutputBytes = 0, cleaning = false;
          const decode = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes ?? Buffer.alloc(0));
          const execute = async (spec) => {
            // Leave ten minutes inside the thirty-minute total for owned cleanup and absence proofs.
            const remainingMs = Math.floor((cleaning ? 30 : 20) * 60_000 - (performance.now() - started));
            if (remainingMs <= 0) {
              if (!cleaning) fail("scanner_seaweed_go_s3_qualification_timeout");
              cleanupBudgetFailure ??= "scanner_seaweed_go_s3_qualification_timeout";
            }
            const result = invoke(spec.command, spec.args, Math.min(spec.timeoutMs, remainingMs > 0 ? remainingMs : 5_000), environment, cleaning);
            const record = { executable: path.basename(spec.command), operation: spec.operation,
              exitCode: result.status, signal: result.signal, error: result.error?.code ?? null };
            receipt.commands.push(record);
            if (result.error || result.signal !== null || !Number.isSafeInteger(result.status)) {
              record.diagnostic = commandFailureDiagnostic(result);
              fail("scanner_seaweed_go_s3_qualification_process_failed");
            }
            if ((result.stdout?.length ?? 0) > spec.stdoutLimitBytes || (result.stderr?.length ?? 0) > spec.stderrLimitBytes) {
              fail("scanner_seaweed_go_s3_qualification_output_limit");
            }
            const outputBytes = (result.stdout?.length ?? 0) + (result.stderr?.length ?? 0);
            const retainOutput = privateOutputBytes + outputBytes <= 4 * MiB;
            if (!retainOutput && !cleaning) fail("scanner_seaweed_go_s3_qualification_output_limit");
            // Only the validated public receipt is exported. Process details stay in this private job directory.
            const prefix = `qualification-${String(receipt.commands.length).padStart(3, "0")}`;
            if (retainOutput) {
              privateOutputBytes += outputBytes;
              try {
                writeFileSync(path.join(directory, `${prefix}.stdout`), result.stdout ?? Buffer.alloc(0), { flag: "wx", mode: 0o600 });
                writeFileSync(path.join(directory, `${prefix}.stderr`), result.stderr ?? Buffer.alloc(0), { flag: "wx", mode: 0o600 });
              } catch (error) {
                if (!cleaning) throw error;
                record.outputRetained = false;
              }
            } else record.outputRetained = false;
            return { exitCode: result.status, stdout: decode(result.stdout), stderr: decode(result.stderr) };
          };
          const docker = (operation, args) => execute({ operation: `inert_${operation}`, command: DOCKER, args,
            timeoutMs: 30_000, stdoutLimitBytes: 4 * MiB, stderrLimitBytes: 64 * 1024 });
          const absent = (result, kind, name) => {
            const messages = kind === "container" ? [`Error response from daemon: No such container: ${name}`, `Error: No such object: ${name}`]
              : kind === "image" ? [`Error response from daemon: No such image: ${name}`, `Error: No such image: ${name}`]
                : [`Error response from daemon: get ${name}: no such volume`, `Error response from daemon: No such volume: ${name}`];
            return result.exitCode === 1 && ["", "[]\n"].includes(result.stdout) &&
              messages.some((message) => result.stderr === message || result.stderr === `${message}\n`);
          };
          const inspect = (kind, name) => docker(`${kind}_inspect`, [kind, "inspect", name]);
          const requireAbsent = async (kind, name) => {
            if (!absent(await inspect(kind, name), kind, name)) fail("scanner_seaweed_go_s3_cleanup_uncertain");
          };
          const parsed = (result) => {
            if (result.exitCode !== 0 || result.stderr !== "") fail("scanner_seaweed_go_s3_cleanup_uncertain");
            return JSON.parse(result.stdout);
          };
          const fileAbsent = (file) => {
            try { lstatSync(file); return false; }
            catch (error) { if (error?.code === "ENOENT") return true; throw error; }
          };
          const ownedFile = (file) => {
            if (!filePaths.has(file) || path.dirname(file) !== directory || realpathSync(directory) !== directory || realpathSync(file) !== file) {
              fail("scanner_seaweed_go_s3_cleanup_uncertain");
            }
            const info = lstatSync(file);
            if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== process.getuid()) {
              fail("scanner_seaweed_go_s3_cleanup_uncertain");
            }
          };
          const capture = ({ file, cap }) => {
            if (!filePaths.has(file)) fail("scanner_seaweed_go_s3_qualification_file_invalid");
            const current = captureSeaweedGoS3QualificationFile({ file, cap });
            if (snapshots.has(file) && JSON.stringify(snapshots.get(file)) !== JSON.stringify(current)) {
              fail("scanner_seaweed_go_s3_qualification_file_changed");
            }
            snapshots.set(file, current);
            return current;
          };
          const filesystemEvidence = (directoryPath) => {
            const resolved = realpathSync(directoryPath), identity = lstatSync(resolved), disk = statfsSync(resolved, { bigint: true });
            const free = disk.bavail * disk.bsize;
            if (free < 1n || free > BigInt(Number.MAX_SAFE_INTEGER)) fail("scanner_seaweed_go_s3_filesystem_invalid");
            return { path: resolved, filesystemId: `${identity.dev}:${disk.type}`, freeBytes: Number(free) };
          };
          const cleanupOwned = async (journal) => {
            cleaning = true;
            let uncertain = false;
            for (const entry of [...journal.containers].reverse()) {
              try {
                if (entry.name !== names.containers[entry.stage]) fail("scanner_seaweed_go_s3_cleanup_uncertain");
                const result = await inspect("container", entry.name);
                if (absent(result, "container", entry.name)) {
                  if (entry.containerId !== null) fail("scanner_seaweed_go_s3_cleanup_uncertain");
                  continue;
                }
                const image = journal.images.find((item) => item.stage === entry.stage);
                const value = validateSeaweedGoS3QualificationContainer(parsed(result), {
                  owner: runId, stage: entry.stage, name: entry.name, imageId: image?.imageId,
                });
                if (entry.containerId !== null && entry.containerId !== value.containerId ||
                    entry.volumeNames.length > 0 && JSON.stringify(entry.volumeNames) !== JSON.stringify(value.mounts.map((mount) => mount.name))) {
                  fail("scanner_seaweed_go_s3_cleanup_uncertain");
                }
                cleanedContainers.set(entry.name, value.containerId);
                for (const mount of value.mounts) {
                  const volumes = parsed(await inspect("volume", mount.name));
                  if (!Array.isArray(volumes) || volumes.length !== 1 || volumes[0]?.Name !== mount.name || volumes[0].Driver !== "local" ||
                      volumes[0].Scope !== "local" || volumes[0].Options !== null && Object.keys(volumes[0].Options ?? {}).length !== 0) {
                    fail("scanner_seaweed_go_s3_cleanup_uncertain");
                  }
                  cleanedVolumes.add(mount.name);
                }
                const removed = await docker("container_remove", ["container", "rm", "--force", "--volumes", value.containerId]);
                if (removed.exitCode !== 0 || removed.stderr !== "") fail("scanner_seaweed_go_s3_cleanup_uncertain");
              } catch { uncertain = true; }
            }
            for (const entry of [...journal.images].reverse()) {
              try {
                if (entry.tag !== names.tags[entry.stage]) fail("scanner_seaweed_go_s3_cleanup_uncertain");
                const result = await inspect("image", entry.tag);
                if (absent(result, "image", entry.tag)) {
                  if (entry.imageId !== null) fail("scanner_seaweed_go_s3_cleanup_uncertain");
                  continue;
                }
                const value = validateSeaweedGoS3QualificationImage(parsed(result), {
                  owner: runId, stage: entry.stage, tag: entry.tag, imageId: entry.imageId,
                });
                cleanedImages.set(entry.tag, value.imageId);
                const removed = await docker("image_remove", ["image", "rm", entry.tag]);
                if (removed.exitCode !== 0 || removed.stderr !== "") fail("scanner_seaweed_go_s3_cleanup_uncertain");
              } catch { uncertain = true; }
            }
            for (const entry of journal.paths) {
              try {
                if (!filePaths.has(entry.path)) fail("scanner_seaweed_go_s3_cleanup_uncertain");
                if (fileAbsent(entry.path)) continue;
                ownedFile(entry.path); chmodSync(entry.path, 0o600); unlinkSync(entry.path);
              } catch { uncertain = true; }
            }
            if (uncertain) { cleanupUncertain = true; fail("scanner_seaweed_go_s3_cleanup_uncertain"); }
          };
          let result;
          try {
            result = await runSeaweedGoS3InertQualification({ sourcePreflight: receipt.seaweedGoS3SourcePreflight, runId,
              paths: { scratchDirectory: directory, python: "/usr/bin/python3", inspector } }, {
              assertInputsUnchanged: async () => { await assertFilesUnchanged(inputs); await assertFilesUnchanged(qualificationInputs); },
              statFilesystems: async ({ scratchDirectory, dockerRootDirectory }) => ({
                scratch: filesystemEvidence(scratchDirectory), docker: filesystemEvidence(dockerRootDirectory),
              }),
              assertNamesAbsent: async () => {
                for (const file of filePaths) if (!fileAbsent(file)) fail("scanner_seaweed_go_s3_qualification_collision");
                for (const name of Object.values(names.containers)) {
                  if (!absent(await inspect("container", name), "container", name)) fail("scanner_seaweed_go_s3_qualification_collision");
                }
                for (const tag of Object.values(names.tags)) {
                  if (!absent(await inspect("image", tag), "image", tag)) fail("scanner_seaweed_go_s3_qualification_collision");
                }
                return { containersAbsent: true, imagesAbsent: true, filesAbsent: true };
              },
              execute,
              captureFile: async (args) => capture(args),
              lockFile: async (file) => { ownedFile(file); chmodSync(file, 0o444); },
              copyOwnedFile: async ({ source, destination }) => {
                if (source !== names.paths.sourceExport || destination !== names.paths.filteredRootfs || !fileAbsent(destination)) {
                  fail("scanner_seaweed_go_s3_qualification_file_invalid");
                }
                capture({ file: source, cap: 8 * MiB });
                copyFileSync(source, destination, constants.COPYFILE_EXCL); ownedFile(destination); chmodSync(destination, 0o600);
                capture({ file: source, cap: 8 * MiB });
              },
              elapsedMs: () => Math.floor(performance.now() - started),
              cleanupOwned,
              cleanupAbsent: async (journal) => {
                try {
                  for (const entry of journal.containers) {
                    await requireAbsent("container", entry.name);
                    if (cleanedContainers.has(entry.name)) await requireAbsent("container", cleanedContainers.get(entry.name));
                  }
                  for (const entry of journal.images) {
                    await requireAbsent("image", entry.tag);
                    if (cleanedImages.has(entry.tag)) await requireAbsent("image", cleanedImages.get(entry.tag));
                  }
                  for (const name of cleanedVolumes) await requireAbsent("volume", name);
                  for (const entry of journal.paths) if (!fileAbsent(entry.path)) fail("scanner_seaweed_go_s3_cleanup_uncertain");
                  return { containersAbsent: true, imagesAbsent: true, volumesAbsent: true, filesAbsent: true };
                } catch { cleanupUncertain = true; fail("scanner_seaweed_go_s3_cleanup_uncertain"); }
              },
            });
          } catch (error) {
            result = seaweedGoS3QualificationRefusalReceipt(error);
            if (!result) throw error;
            receipt.seaweedGoS3Qualification = result;
            const publicRoot = path.join(directory, "public"); mkdirSync(publicRoot, { mode: 0o700 });
            writeJson(path.join(publicRoot, "inert-qualification-refusal.json"), result);
            receipt.seaweedGoS3QualificationPublicEvidence = exportManagedTextEvidence(publicRoot,
              path.join(output, "managed-public-evidence", "seaweed-go-s3-qualification"));
            throw error;
          }
          receipt.seaweedGoS3Qualification = result;
          const publicRoot = path.join(directory, "public"); mkdirSync(publicRoot, { mode: 0o700 });
          writeJson(path.join(publicRoot, "inert-qualification.json"), result);
          receipt.seaweedGoS3QualificationPublicEvidence = exportManagedTextEvidence(publicRoot,
            path.join(output, "managed-public-evidence", "seaweed-go-s3-qualification"));
          await assertFilesUnchanged(inputs); await assertFilesUnchanged(qualificationInputs);
        });
        await phase("seaweed_go_s3_construction", async () => fail("scanner_seaweed_go_s3_construction_pending"));
        return phase("produced_image_runtime", async () => {
       await assertFilesUnchanged(inputs);
      const directory = path.join(work, `managed-runtime-${randomUUID()}`); mkdirSync(directory, { mode: 0o700 });
      const runtimeFile = path.join(ROOT, "tests/managed-image-runtime.integration.mjs");
      const runtimeSources = await captureFiles([runtimeFile, path.join(ROOT, "infra/compose.json"), path.join(ROOT, "infra/object-store-init.sh"),
        ...["runtime", "migrations", "raw-protocol", "backup", "helper-cleanup", "cancellation"].map((name) => path.join(ROOT, `scripts/data-infra/${name}.mjs`)),
        ...["up", "down"].map((direction) => path.join(ROOT, `infra/migrations/0001-foundation.${direction}.sql`))].map((file) => ({ path: file, cap: MiB })));
      const roles = [];
      receipt.runtimePreparation = [];
      for (const image of config.images) {
        const report = receipt.reports.find((entry) => entry.role === image.role);
        if (report?.result !== "passed" || report.findingCount !== 0 || report.blockerCount !== 0 || !Array.isArray(report.report) || report.report.length !== 2) {
          fail("scanner_managed_runtime_prerequisite_invalid");
        }
        const reportFiles = [path.join(output, `image-${image.role}.json`), path.join(output, `image-${image.role}.cdx.json`)];
        const reports = await captureFiles(reportFiles.map((file) => ({ path: file, cap: 64 * MiB })));
        if (reports.some((file, index) => file.size !== report.report[index].size || file.sha256 !== report.report[index].sha256)) fail("scanner_frozen_input_changed");
        const audited = (await readBoundedJson(reportFiles[0])).value;
        const local = localImages.get(image.role);
        let imageId, subject;
        const evidence = [];
        if (local) {
          await assertManagedArchiveUnchanged(local.archiveSnapshot);
          imageId = local.subject.imageId; subject = local.subject;
          const build = receipt.builds.find((entry) => entry.role === image.role);
          const groups = [{ name: image.role, files: build.publicEvidence },
            { name: `${image.role}-runtime`, files: build.runtimeGosuEvidence ?? build.runtimeJdkEvidence ?? [] }];
          for (const group of groups) for (const entry of group.files) {
            evidence.push({ path: path.join(output, "managed-public-evidence", group.name, entry.path), size: entry.size, sha256: entry.sha256 });
          }
        } else {
          if (!["redis", "seaweedfs"].includes(image.role)) fail("scanner_managed_runtime_prerequisite_invalid");
          const reference = `${image.repository}@${image.platform.digest}`;
          command(DOCKER, ["pull", "--platform", "linux/amd64", reference], { timeout: 5 * 60_000 });
          const inspected = JSON.parse(command(DOCKER, ["image", "inspect", reference],
            { file: path.join(directory, `${image.role}-inspect.json`) }).toString("utf8"));
          imageId = validatePreparedRuntimeImage(inspected, audited);
          subject = { kind: "UPSTREAM_REGISTRY_SUBJECT", repository: image.repository, manifestDigest: image.manifestDigest, platform: image.platform };
          receipt.runtimePreparation.push({ role: image.role, reference, imageId });
        }
        if (audited?.Metadata?.ImageID !== imageId) fail("scanner_managed_runtime_image_invalid");
        await assertFilesUnchanged(reports);
        roles.push({ role: image.role, imageId, platform: "linux/amd64", subject,
          reports: { json: { path: reports[0].path, size: reports[0].size, sha256: reports[0].sha256 },
            sbom: { path: reports[1].path, size: reports[1].size, sha256: reports[1].sha256 } }, evidence });
      }
      const run = { sourceCommit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT };
      const runtimeInput = { schemaVersion: 1, run, ownerToken: randomUUID(),
        sourceInputs: [...managedInputs, ...runtimeSources].map(({ path: file, size, sha256 }) => ({ path: file, size, sha256 })), roles };
      const inputFile = path.join(directory, "runtime-input.json"); writeJson(inputFile, runtimeInput);
      const frozenInput = await captureFiles([{ path: inputFile, cap: MiB }]);
      const childEnvironment = { ...environment, GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", RUNNER_TEMP: runnerTemp,
        GITHUB_SHA: run.sourceCommit, GITHUB_RUN_ID: run.runId, GITHUB_RUN_ATTEMPT: run.attempt,
        AW_MANAGED_RUNTIME_INPUT: inputFile, AW_MANAGED_RUNTIME_INPUT_SHA256: frozenInput[0].sha256 };
      receipt.functionalRuntime = "FAILED_NOT_ACCEPTED";
      let childFailure;
      try { command(process.execPath, ["--test", runtimeFile], { file: path.join(directory, "runtime.stdout"),
        timeout: 22 * 60_000 + 15_000, env: childEnvironment, privateOutput: true }); }
      catch (error) { childFailure = error; }
      if (childFailure && (receipt.commands.at(-1)?.error || receipt.commands.at(-1)?.signal)) {
        receipt.runtimeCleanup = { result: "failed" };
        fail("scanner_managed_runtime_termination_uncertain");
      }
      await assertFilesUnchanged(frozenInput); await assertFilesUnchanged(runtimeSources); await assertFilesUnchanged(inputs);
      const { passed } = await publishManagedRuntimeResult({ resultFile: path.join(directory, "runtime-result.json"),
        publicFile: path.join(output, "managed-runtime-result.json"), expected: runtimeInput, childFailed: Boolean(childFailure), receipt });
      if (!passed) fail("scanner_managed_runtime_incomplete");
        });
      },
    });
    await assertFilesUnchanged(inputs);
    receipt.result = "passed";
  } catch (error) {
    receipt.failure = error.message;
    ownedPublic ??= error.ownedPublicDirectory;
    if (error.ownedCleanup) receipt.ownedCleanup = error.ownedCleanup;
    throw error;
  } finally {
    if (sharedBudget) {
      if (activeBudgetStage && sharedBudget.snapshot().active?.name === activeBudgetStage) {
        try { sharedBudget.finishStage(activeBudgetStage, receipt.result === "passed" ? "PASSED" : "FAILED"); }
        catch (error) { receipt.result = "failed"; receipt.failure ??= error.message; }
        activeBudgetStage = null;
      }
      if (built || ownedCopies.length) {
        let cleanupError;
        if (built) try { built.cleanup.cleanupAll(); } catch (error) { cleanupError = error; }
        for (const file of ownedCopies) {
          try { chmodSync(path.dirname(file), 0o755); if (existsSync(file)) unlinkSync(file); }
          catch (error) { cleanupError ??= error; }
        }
        receipt.ownedCleanup = { ...receipt.ownedCleanup, absent: (built ? built.cleanup.verify() : receipt.ownedCleanup?.absent === true) && ownedCopies.every((file) => !existsSync(file)),
          ...(cleanupError ? { failure: cleanupError.message } : {}) };
        if (cleanupError) { receipt.result = "failed"; receipt.failure ??= cleanupError.message; }
      }
      try { receipt.dockerCleanup = dockerCleanup.cleanupAll(); }
      catch (error) {
        cleanupUncertain = true; receipt.result = "failed"; receipt.failure ??= error.message;
        receipt.dockerCleanup = error.ownedCleanup ?? dockerCleanup.snapshot();
      }
      if (cleanupBudgetFailure) {
        receipt.result = "failed"; receipt.failure ??= cleanupBudgetFailure;
        receipt.cleanupBudgetFailure = cleanupBudgetFailure;
      }
      receipt.timeBudget = sharedBudget.snapshot();
      if (built && receipt.ownedCleanup?.absent !== true) {
        receipt.result = "failed"; receipt.failure ??= "scanner_owned_cleanup_uncertain";
      }
      try {
        const directories = [];
        if (ownedPublic?.manifest) directories.push(["build", ownedPublic]);
        if (ownedControlsPublic) {
          ownedControlsPublic.write("final-state.json", { run: ownedRun, qualification: receipt.ownedQualification ?? null,
            cleanup: receipt.ownedCleanup ?? null, dockerCleanup: receipt.dockerCleanup ?? null,
            result: receipt.result, failure: receipt.failure ?? null, budget: receipt.timeBudget });
          directories.push(["controls", ownedControlsPublic]);
        }
        if (directories.length) receipt.ownedPublicEvidence = await publishOwnedScannerEvidence({ directories,
          destination: path.join(output, "owned-scanner-public"), run: ownedRun, exportDirectory: exportManagedTextEvidence });
      } catch (error) {
        receipt.result = "failed"; receipt.failure ??= error.message;
        receipt.ownedPublicEvidenceFailure = error.message;
      }
      try { receipt.workCleanup = removeOwnedAuditWork(work, runnerTemp); }
      catch (error) { receipt.result = "failed"; receipt.failure ??= error.message;
        receipt.workCleanup = { attempted: true, absent: false, failure: error.message }; }
    }
    // Shared registry images are not uniquely owned resources and are never broadly pruned.
    receipt.workRetention = sharedBudget && receipt.workCleanup?.absent ? "REMOVED_WITH_ABSENCE_PROOF" : "DISPOSABLE_RUNNER_JOB_ONLY_NOT_SUPPORTED_ARCHIVE";
    receipt.cleanupUncertain = cleanupUncertain;
    writeJson(path.join(output, "official-audit-receipt.json"), receipt);
  }
  if (receipt.result !== "passed") fail(receipt.failure ?? "scanner_owned_qualification_failed");
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await auditOfficialScanner(parseOfficialAuditArguments(process.argv.slice(2)));
}
