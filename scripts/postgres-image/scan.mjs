import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, chownSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { evaluateLocalPostgresGosuAudit } from "./audit-policy.mjs";
import { baselineFixtureArguments, candidateDockerArguments, databaseDownloadDockerArguments, databaseEvidence,
  fixtureScanMode, validateDatabaseRegistryManifest, versionProbeBytes } from "../scanner/audit.mjs";
import { assertFilesUnchanged, captureFiles, compareSameDatabase, parseGoBuildInfo, readBoundedJson,
  validateBuildPair, validateFixtureReport, validateSelfReport, validateVersionProbeReport } from "../scanner/controls.mjs";
import { candidateInputDockerArguments } from "../seaweed-image/candidate-audit.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DOCKER = "/usr/bin/docker";
const INPUT_NAME = "/candidate/saved.tar";
const SCAN_UID = 1_000;
const SCAN_GID = 1_000;
const RETAINED_SCANNER_LOCK_SHA256 = "3c27ad6cecfe30395aa2f7f32de51b638c4684fb2e921a32a4779424b06f95ba";
const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const DEADLINE_MS = 90 * 60_000;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const HEX = /^[a-f0-9]{64}$/u;
const TAG = /^aw-postgres-gosu:[a-f0-9]{24}$/u;
const NONCE = /^[a-f0-9]{24}$/u;
const OWNER_LABEL = "com.auto-world.postgres-diagnostic";
const PURPOSE_LABEL = "com.auto-world.postgres-diagnostic-purpose";
const PURPOSE = "gosu-correction-runtime";

function fail(code) { throw new Error(code); }
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function plain(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value, keys) {
  return plain(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function privateDirectory(directory, { empty = false } = {}) {
  const stat = lstatSync(directory);
  if (process.platform !== "linux" || !stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory ||
      stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700 || empty && readdirSync(directory).length !== 0) {
    fail("postgres_scan_directory_invalid");
  }
}
function safeAbsolute(value) {
  return typeof value === "string" && path.isAbsolute(value) && path.normalize(value) === value && !value.includes("\0");
}
function overlaps(left, right) {
  const relative = path.relative(left, right);
  return relative === "" || relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

export function parsePostgresScanArguments(argv) {
  const paths = Array.isArray(argv) ? [argv[1], argv[3], argv[5], argv[7]] : [];
  if (!Array.isArray(argv) || argv.length !== 8 || argv[0] !== "--diagnostic" || argv[2] !== "--scanner-inputs" ||
      argv[4] !== "--work" || argv[6] !== "--output" || ![argv[1], argv[3], argv[5], argv[7]].every(safeAbsolute) ||
      paths.some((left, index) => paths.some((right, other) => index !== other && overlaps(left, right)))) {
    fail("postgres_scan_arguments_invalid");
  }
  return Object.freeze({ diagnostic: argv[1], scannerInputs: argv[3], work: argv[5], output: argv[7] });
}

function identity(file, cap) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > cap) fail("postgres_scan_file_invalid");
  const bytes = readFileSync(file);
  return Object.freeze({ path: file, sha256: hash(bytes), size: bytes.length, cap });
}

export function writePostgresCommandFailureEvidence(directory, ordinal,
  { phase, status, signal, errorCode, stdout, stderr }) {
  const stat = lstatSync(directory);
  if (!safeAbsolute(directory) || !stat.isDirectory() || stat.isSymbolicLink() || !Number.isSafeInteger(ordinal) ||
      ordinal < 1 || ordinal > 999 || !/^[a-z0-9-]{1,80}$/u.test(phase) ||
      status !== null && !Number.isInteger(status) || signal !== null && typeof signal !== "string" ||
      errorCode !== null && typeof errorCode !== "string" || !Buffer.isBuffer(stdout) || !Buffer.isBuffer(stderr) ||
      stdout.length > 64 * MiB || stderr.length > 64 * MiB) fail("postgres_scan_command_evidence_invalid");
  const prefix = `${String(ordinal).padStart(2, "0")}-${phase}`;
  const stdoutName = `${prefix}.stdout.log`; const stderrName = `${prefix}.stderr.log`;
  writeFileSync(path.join(directory, stdoutName), stdout, { flag: "wx", mode: 0o600 });
  writeFileSync(path.join(directory, stderrName), stderr, { flag: "wx", mode: 0o600 });
  return Object.freeze({ phase, status, signal, errorCode,
    stdout: Object.freeze({ file: `command-failures/${stdoutName}`, sha256: hash(stdout), size: stdout.length }),
    stderr: Object.freeze({ file: `command-failures/${stderrName}`, sha256: hash(stderr), size: stderr.length }) });
}

function sameConfigExceptLabels(base, candidate, additions) {
  if (!plain(base) || !plain(candidate) || !plain(additions)) return false;
  const baseLabels = base.Labels ?? {};
  const candidateLabels = candidate.Labels ?? {};
  if (!plain(baseLabels) || !plain(candidateLabels) || Object.keys(additions).some((key) => Object.hasOwn(baseLabels, key))) return false;
  const before = { ...base }; const after = { ...candidate };
  delete before.Labels; delete after.Labels;
  return isDeepStrictEqual(before, after) && isDeepStrictEqual(candidateLabels, { ...baseLabels, ...additions });
}

export function validatePostgresDiagnosticEvidence({ receipt, baseInspect, candidateInspect, archiveIdentity }) {
  if (!plain(receipt) || receipt.kind !== "POSTGRES_GOSU_DIAGNOSTIC_RECEIPT_V1" || receipt.state !== "VERIFIED" ||
      receipt.authority !== "LOCAL_DIAGNOSTIC" || receipt.admission !== "NOT_AUTHORIZED" || receipt.supportStartedAt !== null ||
      receipt.vulnerabilityAudit !== "NOT_ATTEMPTED" || receipt.registryWrite !== "NOT_ATTEMPTED" ||
      !Array.isArray(baseInspect) || baseInspect.length !== 1 || !Array.isArray(candidateInspect) || candidateInspect.length !== 1 ||
      !plain(archiveIdentity)) fail("postgres_scan_diagnostic_invalid");
  const base = baseInspect[0]; const candidate = candidateInspect[0]; const recorded = receipt.candidate;
  const evidence = receipt.archiveEvidence; const labels = recorded?.additionalLabels;
  if (!DIGEST.test(recorded?.imageId ?? "") || recorded.imageId !== recorded.configDigest || recorded.imageId !== candidate.Id ||
      !Array.isArray(recorded.diffIds) || recorded.diffIds.length < 2 || recorded.diffIds.some((entry) => !DIGEST.test(entry)) ||
      JSON.stringify(recorded.diffIds) !== JSON.stringify(candidate.RootFS?.Layers) || !TAG.test(recorded.tag ?? "") ||
      !HEX.test(recorded.archive?.sha256 ?? "") || recorded.archive.sha256 !== archiveIdentity.sha256 ||
      recorded.archive.bytes !== archiveIdentity.size || !exactKeys(labels, [OWNER_LABEL, PURPOSE_LABEL]) ||
      !NONCE.test(labels[OWNER_LABEL] ?? "") || labels[PURPOSE_LABEL] !== PURPOSE ||
      candidate.Config?.Labels?.[OWNER_LABEL] !== labels[OWNER_LABEL] || candidate.Config?.Labels?.[PURPOSE_LABEL] !== PURPOSE ||
      !sameConfigExceptLabels(base.Config, candidate.Config, labels) ||
      !exactKeys(evidence, ["artifactName", "imageId", "archiveSha256", "tag", "configDigest", "diffIds"]) ||
      evidence.artifactName !== INPUT_NAME || evidence.imageId !== recorded.imageId || evidence.configDigest !== recorded.configDigest ||
      evidence.archiveSha256 !== archiveIdentity.sha256 || evidence.tag !== recorded.tag ||
      JSON.stringify(evidence.diffIds) !== JSON.stringify(recorded.diffIds) ||
      receipt.baseExport?.imageId !== base.Id || JSON.stringify(receipt.baseExport?.diffIds) !== JSON.stringify(base.RootFS?.Layers)) {
    fail("postgres_scan_diagnostic_invalid");
  }
  return Object.freeze({ subject: Object.freeze({ ...evidence, diffIds: Object.freeze([...evidence.diffIds]) }),
    imageId: recorded.imageId, tag: recorded.tag, additionalLabels: Object.freeze({ ...labels }) });
}

export async function authenticatePostgresScannerPair(inputs, work) {
  privateDirectory(inputs);
  const lockFile = path.join(inputs, "scanner-lock.json");
  const lockBytes = readFileSync(lockFile);
  const repositoryLock = readFileSync(path.join(ROOT, "infra/scanner/scanner-lock.json"));
  const lock = JSON.parse(lockBytes.toString("utf8"));
  const current = JSON.parse(repositoryLock.toString("utf8"));
  if (hash(lockBytes) !== RETAINED_SCANNER_LOCK_SHA256 ||
      ["schemaVersion", "state", "scanner", "compiler", "patches", "fixtures", "upstreamTestMaterials", "baseline"]
        .some((key) => JSON.stringify(lock[key]) !== JSON.stringify(current[key]))) fail("postgres_scan_scanner_lock_changed");
  const builds = [1, 2].map((number) => path.join(inputs, `build-${number}`));
  builds.forEach((directory) => privateDirectory(directory));
  const receipts = await Promise.all(builds.map(async (directory) =>
    (await readBoundedJson(path.join(directory, "build-receipt.json"), 8 * MiB)).value));
  const closures = await Promise.all(builds.map((directory) => readBoundedJson(path.join(directory, "module-closure.json"), 16 * MiB)));
  const buildInfos = await Promise.all(builds.map(async (directory) => {
    const file = path.join(directory, "go-build-info.txt");
    const [fileIdentity] = await captureFiles([{ path: file, cap: 8 * MiB }]);
    return { identity: fileIdentity, value: parseGoBuildInfo(readFileSync(file)) };
  }));
  const binary = validateBuildPair(receipts[0], receipts[1], { sourceCommit: lock.scanner.sourceCommit,
    lockSha256: hash(lockBytes), moduleClosures: closures, buildInfos });
  const binaries = await captureFiles(builds.map((directory) => ({ path: path.join(directory, "trivy"), cap: 512 * MiB })));
  if (binaries.some((entry) => entry.sha256 !== binary.sha256 || entry.size !== binary.size)) fail("postgres_scan_scanner_binary_changed");
  const scanner = path.join(work, "scanner"); copyFileSync(binaries[0].path, scanner); chmodSync(scanner, 0o555);
  return Object.freeze({ lock, lockIdentity: { sha256: hash(lockBytes), size: lockBytes.length }, binary,
    buildInfos, scanner, frozenBuildFiles: [{ path: lockFile, cap: 8 * MiB }, ...builds.flatMap((directory) => [
      { path: path.join(directory, "build-receipt.json"), cap: 8 * MiB },
      { path: path.join(directory, "module-closure.json"), cap: 16 * MiB },
      { path: path.join(directory, "go-build-info.txt"), cap: 8 * MiB },
      { path: path.join(directory, "trivy"), cap: 512 * MiB },
    ])] });
}

function command(args, { output, timeout = 10 * 60_000, deadlineAt, dockerConfig, failureRecorder,
  phase = "docker-command" } = {}) {
  const remaining = deadlineAt === undefined ? timeout : Math.min(timeout, deadlineAt - Date.now());
  if (!Number.isSafeInteger(remaining) || remaining < 1000) fail("postgres_scan_deadline_exceeded");
  const result = spawnSync(DOCKER, args, { encoding: null, timeout: remaining, maxBuffer: 64 * MiB, windowsHide: true,
    env: { PATH: "/usr/bin:/bin", HOME: path.dirname(dockerConfig), DOCKER_CONFIG: dockerConfig,
      TMPDIR: path.dirname(dockerConfig), TZ: "UTC", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } });
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0);
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0);
  if (result.error || result.signal || result.status !== 0 || !Buffer.isBuffer(result.stdout) || !Buffer.isBuffer(result.stderr)) {
    const record = failureRecorder?.({ phase, status: Number.isInteger(result.status) ? result.status : null,
      signal: typeof result.signal === "string" ? result.signal : null,
      errorCode: typeof result.error?.code === "string" && /^[A-Z0-9_]{1,64}$/u.test(result.error.code) ? result.error.code : null,
      stdout, stderr });
    const error = new Error("postgres_scan_command_failed");
    if (record) error.diagnostic = record;
    throw error;
  }
  if (output) writeFileSync(output, stdout, { flag: "wx", mode: 0o600 });
  return stdout;
}

function manifestEvidence(output, checkpoint, docker) {
  return [{ name: "vulnerability", repository: "ghcr.io/aquasecurity/trivy-db", tag: "2" },
    { name: "java", repository: "ghcr.io/aquasecurity/trivy-java-db", tag: "1" }].map((entry) => {
    const bytes = docker(["buildx", "imagetools", "inspect", "--raw", `${entry.repository}:${entry.tag}`],
      { phase: `database-registry-${checkpoint}-${entry.name}` });
    writeFileSync(path.join(output, `database-${entry.name}-${checkpoint}-manifest.json`), bytes, { flag: "wx", mode: 0o600 });
    return { ...entry, ...validateDatabaseRegistryManifest(bytes) };
  });
}

export function postgresOwnedContainerArguments(args, { kind, nonce }) {
  if (!Array.isArray(args) || args[0] !== "run" || !args.includes("--rm") ||
      !/^(?:db-vulnerability|db-java|self-json|self-cyclonedx|version-probe|fixture-[a-z0-9-]+-(?:candidate|baseline)|candidate-(?:json|cyclonedx))$/u.test(kind ?? "") ||
      !/^[a-f0-9]{32}$/u.test(nonce ?? "")) fail("postgres_scan_container_arguments_invalid");
  const name = `aw-pg-scan-${nonce}-${kind}`;
  return ["run", "--name", name, "--label", `com.auto-world.postgres-scan=${nonce}`, ...args.slice(1)];
}

function containerIds(docker, name) {
  const value = docker(["container", "ls", "-a", "--no-trunc", "--quiet", "--filter", `name=^/${name}$`])
    .toString("utf8").trim();
  if (!value) return [];
  const ids = value.split("\n");
  if (ids.length > 1 || ids.some((id) => !/^[a-f0-9]{64}$/u.test(id))) fail("postgres_scan_container_identity_uncertain");
  return ids;
}

function runOwnedContainer(args, { kind, docker, cleanupDocker = docker, cleanupRecords = [], output, timeout }) {
  const nonce = randomBytes(16).toString("hex"); const name = `aw-pg-scan-${nonce}-${kind}`;
  if (containerIds(cleanupDocker, name).length !== 0) fail("postgres_scan_container_preexisting");
  let failure;
  try { docker(postgresOwnedContainerArguments(args, { kind, nonce }), { output, timeout, phase: `container-${kind}` }); }
  catch (error) { failure = error; }
  try {
    const ids = containerIds(cleanupDocker, name);
    if (ids.length === 1) {
      let inspected;
      try { inspected = JSON.parse(cleanupDocker(["container", "inspect", "--format", "{{json .}}", ids[0]]).toString("utf8")); }
      catch { fail("postgres_scan_container_identity_uncertain"); }
      if (inspected?.Id !== ids[0] || inspected.Name !== `/${name}` ||
          inspected.Config?.Labels?.["com.auto-world.postgres-scan"] !== nonce) fail("postgres_scan_container_identity_uncertain");
      cleanupDocker(["container", "rm", "-f", ids[0]]);
    }
    if (containerIds(cleanupDocker, name).length !== 0) fail("postgres_scan_container_cleanup_uncertain");
    cleanupRecords.push(Object.freeze({ kind, state: ids.length === 1 ? "OWNED_CONTAINER_REMOVED" : "OWNED_CONTAINER_ABSENT" }));
  } catch (error) {
    cleanupRecords.push(Object.freeze({ kind, state: "CLEANUP_UNCERTAIN" }));
    throw error;
  }
  if (failure) throw failure;
}

export function TEST_ONLY_runOwnedContainer(args, options) { return runOwnedContainer(args, options); }

function makeReadOnly(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name); const stat = lstatSync(file);
    if (entry.isSymbolicLink() || stat.isSymbolicLink()) fail("postgres_scan_database_symlink_refused");
    if (entry.isDirectory()) makeReadOnly(file);
    else if (entry.isFile() && stat.nlink === 1) chmodSync(file, 0o444);
    else fail("postgres_scan_database_file_invalid");
  }
  chmodSync(directory, 0o555);
}

async function executeControls({ lock, scanner, cache, output, fixtureRoot, versionProbe, subjectRoot, docker, cleanupDocker,
  cleanupRecords, frozen }) {
  const carrier = `${lock.baseline.repository}@${lock.baseline.platformDigest}`;
  const run = (args, kind, file) => runOwnedContainer(args, { kind, docker, cleanupDocker, cleanupRecords,
    output: file, timeout: 30 * 60_000 });
  const selfJson = path.join(output, "scanner-self.json");
  const selfSbom = path.join(output, "scanner-self.cdx.json");
  run(candidateDockerArguments({ carrier, scanner, cache, mode: "rootfs", target: subjectRoot,
    extra: ["--offline-scan", "--severity", "HIGH,CRITICAL"] }), "self-json", selfJson);
  run(candidateDockerArguments({ carrier, scanner, cache, mode: "rootfs", target: subjectRoot,
    format: "cyclonedx", extra: ["--offline-scan"] }), "self-cyclonedx", selfSbom);
  validateSelfReport((await readBoundedJson(selfJson)).value, (await readBoundedJson(selfSbom)).value,
    frozen.buildInventory, lock.scanner.upstreamVersion);
  await assertFilesUnchanged(frozen.files);
  const probeReport = path.join(output, "scanner-version-probe.json");
  run(candidateDockerArguments({ carrier, scanner, cache, mode: "fs", target: versionProbe,
    extra: ["--offline-scan", "--severity", "HIGH,CRITICAL"] }), "version-probe", probeReport);
  validateVersionProbeReport((await readBoundedJson(probeReport)).value, lock.scanner.upstreamVersion);
  await assertFilesUnchanged(frozen.files);
  const manifest = JSON.parse(readFileSync(path.join(fixtureRoot, "manifest.json"), "utf8"));
  for (const fixture of manifest.fixtures) {
    const target = fixture.material[0].path.startsWith("gomod/") ? "gomod" : fixture.material[0].path.replace(/^java\//u, "java/");
    const mode = fixtureScanMode(fixture); const absolute = path.join(fixtureRoot, target);
    const candidateFile = path.join(output, `fixture-${fixture.id}-candidate.json`);
    run(candidateDockerArguments({ carrier, scanner, cache, mode, target: absolute, extra: ["--offline-scan"] }),
      `fixture-${fixture.id}-candidate`, candidateFile);
    const candidate = validateFixtureReport(fixture, (await readBoundedJson(candidateFile)).value);
    if (fixture.id !== "java-jar-clean-candidate") {
      const baselineFile = path.join(output, `fixture-${fixture.id}-baseline.json`);
      run(baselineFixtureArguments(lock, cache, fixtureRoot, mode, target), `fixture-${fixture.id}-baseline`, baselineFile);
      compareSameDatabase(candidate, validateFixtureReport(fixture, (await readBoundedJson(baselineFile)).value, lock.baseline.version));
    }
    await assertFilesUnchanged(frozen.files);
  }
}

export async function executePostgresScan(context, dependencies = {}) {
  if (!exactKeys(context, ["diagnostic", "scannerInputs", "work", "output"])) fail("postgres_scan_context_invalid");
  const paths = [context.diagnostic, context.scannerInputs, context.work, context.output];
  if (!paths.every(safeAbsolute) || paths.some((left, index) => paths.some((right, other) =>
    index !== other && overlaps(left, right)))) fail("postgres_scan_context_invalid");
  const runCommand = dependencies.command ?? command;
  const scannerPair = dependencies.scannerPair ?? authenticatePostgresScannerPair;
  const dbManifests = dependencies.manifestEvidence ?? manifestEvidence;
  const dbEvidence = dependencies.databaseEvidence ?? databaseEvidence;
  const environment = dependencies.environment ?? process.env;
  const runtime = dependencies.runtime ?? { platform: process.platform, uid: process.getuid?.(), gid: process.getgid?.() };
  if (runtime.platform !== "linux" || runtime.uid !== 0 || runtime.gid !== 0) fail("postgres_scan_requires_linux_root");
  if (["GH_TOKEN", "GITHUB_TOKEN", "DOCKER_AUTH_CONFIG", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"]
    .some((key) => environment[key] !== undefined)) fail("postgres_scan_auth_environment_refused");
  privateDirectory(context.diagnostic); privateDirectory(context.scannerInputs);
  if (existsSync(context.work) || existsSync(context.output)) fail("postgres_scan_output_exists");
  mkdirSync(context.work, { mode: 0o700 }); mkdirSync(context.output, { mode: 0o700 });
  privateDirectory(context.work, { empty: true }); privateDirectory(context.output, { empty: true });
  const receipt = { kind: "POSTGRES_GOSU_LOCAL_AUDIT_V1", state: "INCOMPLETE", authority: "DIAGNOSTIC_ONLY", evidenceVisibility: "PRIVATE_LOCAL_ONLY",
    admission: "NOT_AUTHORIZED", supportStartedAt: null, publication: "NOT_ATTEMPTED", phase: "INPUT",
    commandFailures: [], containerCleanup: [] };
  const deadlineAt = Date.now() + DEADLINE_MS;
  const dockerConfig = path.join(context.work, "docker-config"); mkdirSync(dockerConfig, { mode: 0o700 });
  const commandFailures = path.join(context.output, "command-failures"); mkdirSync(commandFailures, { mode: 0o700 });
  let failureOrdinal = 0;
  const failureRecorder = (failure) => {
    const record = writePostgresCommandFailureEvidence(commandFailures, ++failureOrdinal, failure);
    receipt.commandFailures.push(record);
    return record;
  };
  const docker = (args, options = {}) => runCommand(args, { ...options, deadlineAt, dockerConfig, failureRecorder });
  const cleanupDocker = (args, options = {}) => runCommand(args, { ...options, timeout: 60_000, dockerConfig,
    failureRecorder, phase: options.phase ?? "container-cleanup" });
  let operationFailure;
  try {
    const archiveOriginal = identity(path.join(context.diagnostic, "candidate-image.tar"), GiB);
    const diagnosticReceiptFile = path.join(context.diagnostic, "receipt.json");
    const baseInspectFile = path.join(context.diagnostic, "base-inspect.json");
    const candidateInspectFile = path.join(context.diagnostic, "candidate-inspect.json");
    const diagnosticReceiptRecord = await readBoundedJson(diagnosticReceiptFile, 4 * MiB);
    const baseInspectRecord = await readBoundedJson(baseInspectFile, 4 * MiB);
    const candidateInspectRecord = await readBoundedJson(candidateInspectFile, 4 * MiB);
    const diagnosticReceipt = diagnosticReceiptRecord.value;
    const baseInspect = baseInspectRecord.value;
    const candidateInspect = candidateInspectRecord.value;
    const verified = validatePostgresDiagnosticEvidence({ receipt: diagnosticReceipt, baseInspect, candidateInspect,
      archiveIdentity: archiveOriginal });
    receipt.subject = verified.subject;
    receipt.inputs = { archive: { sha256: archiveOriginal.sha256, size: archiveOriginal.size },
      diagnosticReceipt: diagnosticReceiptRecord.identity, baseInspect: baseInspectRecord.identity,
      candidateInspect: candidateInspectRecord.identity };
    const inputSnapshots = [archiveOriginal,
      { path: diagnosticReceiptFile, cap: 4 * MiB, ...diagnosticReceiptRecord.identity },
      { path: baseInspectFile, cap: 4 * MiB, ...baseInspectRecord.identity },
      { path: candidateInspectFile, cap: 4 * MiB, ...candidateInspectRecord.identity }];
    await assertFilesUnchanged(inputSnapshots);
    receipt.phase = "SCANNER_PAIR";
    const pair = await scannerPair(context.scannerInputs, context.work);
    receipt.scanner = { version: pair.lock.scanner.version, sourceCommit: pair.lock.scanner.sourceCommit,
      lock: pair.lockIdentity, binary: pair.binary };
    const carrier = `${pair.lock.baseline.repository}@${pair.lock.baseline.platformDigest}`;
    docker(["pull", "--platform", "linux/amd64", carrier], { phase: "baseline-carrier-pull" });
    const cache = path.join(context.output, "database-cache"); mkdirSync(cache, { mode: 0o700 }); chownSync(cache, SCAN_UID, SCAN_GID);
    receipt.phase = "DATABASES";
    const before = dbManifests(context.output, "before", docker);
    for (const kind of ["vulnerability", "java"]) {
      runOwnedContainer(databaseDownloadDockerArguments({ baseline: carrier, cache,
        user: `${SCAN_UID}:${SCAN_GID}`, registries: before, kind }),
      { kind: `db-${kind}`, docker, cleanupDocker, cleanupRecords: receipt.containerCleanup, timeout: 15 * 60_000 });
    }
    const after = dbManifests(context.output, "after", docker);
    if (JSON.stringify(before) !== JSON.stringify(after)) fail("postgres_scan_database_registry_changed");
    const database = await dbEvidence(cache, new Date(), context.output);
    const databaseRecord = (await readBoundedJson(path.join(context.output, "database-evidence.json"), 8 * MiB)).value;
    receipt.databases = { files: database.files, metadata: database.metadata, registry: before };
    makeReadOnly(cache);
    const archive = path.join(context.work, "candidate-image.tar"); copyFileSync(archiveOriginal.path, archive); chmodSync(archive, 0o444);
    const scannerSubject = path.join(context.work, "scanner-subject"); mkdirSync(scannerSubject, { mode: 0o755 });
    copyFileSync(pair.scanner, path.join(scannerSubject, "trivy")); chmodSync(path.join(scannerSubject, "trivy"), 0o555);
    const versionProbe = path.join(context.work, "scanner-version-probe"); mkdirSync(versionProbe, { mode: 0o755 });
    writeFileSync(path.join(versionProbe, "go.mod"), versionProbeBytes(pair.lock), { flag: "wx", mode: 0o444 });
    const fixtureRoot = path.join(ROOT, "infra/scanner/materials/scanner-fixtures");
    const fixtureFiles = pair.lock.fixtures.filter((entry) => entry.path.includes("scanner-fixtures/")).map((entry) => {
      const file = path.join(ROOT, entry.path); const observed = identity(file, 4 * MiB);
      if (observed.sha256 !== entry.sha256 || observed.size !== entry.size) fail("postgres_scan_fixture_changed");
      return { path: file, cap: 4 * MiB };
    });
    const frozenFiles = [...inputSnapshots, ...await captureFiles([{ path: pair.scanner, cap: 512 * MiB },
      { path: archive, cap: GiB }, { path: path.join(versionProbe, "go.mod"), cap: 8 * MiB },
      ...pair.frozenBuildFiles, ...database.files.map((entry) => ({ path: entry.path, cap: entry.cap })), ...fixtureFiles])];
    receipt.phase = "SCANNER_CONTROLS";
    await (dependencies.executeControls ?? executeControls)({ lock: pair.lock, scanner: pair.scanner, cache, output: context.output,
      fixtureRoot, versionProbe, subjectRoot: scannerSubject, docker, frozen: { files: frozenFiles,
        buildInventory: pair.buildInfos[0].value }, cleanupDocker, cleanupRecords: receipt.containerCleanup });
    const reports = { vulnerability: path.join(context.output, "candidate-vulnerabilities.json"),
      cyclonedx: path.join(context.output, "candidate-sbom.cdx.json") };
    for (const [format, file] of [["json", reports.vulnerability], ["cyclonedx", reports.cyclonedx]]) {
      runOwnedContainer(candidateInputDockerArguments({ carrier, scanner: pair.scanner, cache,
        archive, uid: SCAN_UID, gid: SCAN_GID, format }),
      { kind: `candidate-${format}`, docker, cleanupDocker, cleanupRecords: receipt.containerCleanup,
        output: file, timeout: 30 * 60_000 });
      await assertFilesUnchanged(frozenFiles);
    }
    receipt.phase = "POLICY";
    const vulnerability = await readBoundedJson(reports.vulnerability, 64 * MiB);
    const cyclonedx = await readBoundedJson(reports.cyclonedx, 64 * MiB);
    const evaluation = evaluateLocalPostgresGosuAudit({ vulnerabilityReport: vulnerability.value,
      cyclonedxReport: cyclonedx.value, subject: verified.subject, archiveEvidence: verified.subject,
      databaseEvidence: { vulnerability: databaseRecord.observed.vulnerability.value,
        java: databaseRecord.observed.java.value }, now: new Date() });
    receipt.reports = { vulnerability: vulnerability.identity, cyclonedx: cyclonedx.identity };
    await assertFilesUnchanged(frozenFiles);
    receipt.findingCount = evaluation.findings.length; receipt.blockerCount = evaluation.blockers.length;
    receipt.blockers = evaluation.blockers.slice(0, 32); receipt.blockersTruncated = evaluation.blockers.length > 32;
    receipt.state = evaluation.state; receipt.phase = "COMPLETE";
    if (receipt.state !== "COMPLETE") fail("postgres_scan_policy_blocked");
  } catch (error) {
    receipt.state = "INCOMPLETE"; receipt.failure = { code: /^postgres_[a-z_]+$/u.test(error?.message ?? "")
      ? error.message : "postgres_scan_failed" };
    operationFailure = error;
  } finally {
    try {
      if (existsSync(context.work)) {
        privateDirectory(context.work);
        rmSync(context.work, { recursive: true });
      }
      receipt.workCleanup = "COMPLETE";
    } catch {
      receipt.state = "INCOMPLETE";
      receipt.workCleanup = "INCOMPLETE";
      receipt.failure = { code: "postgres_scan_work_cleanup_failed" };
      operationFailure = new Error(receipt.failure.code);
    }
    writeFileSync(path.join(context.output, "audit-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  }
  if (operationFailure) throw operationFailure;
  return receipt;
}

export async function runPostgresScan(argv = process.argv.slice(2)) {
  const context = parsePostgresScanArguments(argv);
  return executePostgresScan(context);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPostgresScan().then((receipt) => console.log(JSON.stringify({ state: receipt.state, admission: receipt.admission,
    blockerCount: receipt.blockerCount }))).catch((error) => {
    console.error(JSON.stringify({ state: "INCOMPLETE", admission: "NOT_AUTHORIZED",
      reason: /^postgres_[a-z_]+$/u.test(error?.message ?? "") ? error.message : "postgres_scan_failed" }));
    process.exitCode = 1;
  });
}
