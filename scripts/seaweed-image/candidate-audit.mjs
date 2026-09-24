import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  realpathSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { databaseDownloadDockerArguments, databaseEvidence,
  validateDatabaseRegistryManifest } from "../scanner/audit.mjs";
import { assertFilesUnchanged, captureFiles, parseGoBuildInfo, readBoundedJson,
  validateBuildPair } from "../scanner/controls.mjs";
import { evaluateLocalSeaweedCandidateAudit } from "./candidate-audit-policy.mjs";
import { withVerifiedLocalSeaweedCandidate } from "./materialize-candidate.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const LOCK_FILE = path.join(ROOT, "infra/scanner/scanner-lock.json");
const WORKFLOW_REF = "CleMeY15/auto-world/.github/workflows/seaweed-candidate-audit.yml@refs/heads/main";
const DOCKER = "/usr/bin/docker";
const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const GIT_SHA = /^[0-9a-f]{40}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const INPUT_NAME = "/candidate/saved.tar";
const OPERATION_DEADLINE_MS = 240 * 60_000;

function fail(code) { throw new Error(code); }
function hash(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function ownedDirectory(directory, uid) {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid
    || (stat.mode & 0o777) !== 0o700 || realpathSync(directory) !== directory) {
    fail("seaweed_audit_directory_invalid");
  }
}

export function requireCandidateAuditContext(env, { platform = process.platform, uid = process.getuid?.(),
  gid = process.getgid?.() } = {}) {
  if (platform !== "linux" || !Number.isSafeInteger(uid) || uid < 1
    || !Number.isSafeInteger(gid) || gid < 1
    || env.GITHUB_ACTIONS !== "true" || env.RUNNER_ENVIRONMENT !== "github-hosted"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_REPOSITORY !== "CleMeY15/auto-world" || env.GITHUB_WORKFLOW_REF !== WORKFLOW_REF
    || env.GITHUB_RUN_NUMBER !== "1" || env.GITHUB_RUN_ATTEMPT !== "1"
    || !GIT_SHA.test(env.GITHUB_SHA ?? "") || !RUN_ID.test(env.GITHUB_RUN_ID ?? "")
    || typeof env.RUNNER_TEMP !== "string" || !path.isAbsolute(env.RUNNER_TEMP)
    || path.normalize(env.RUNNER_TEMP) !== env.RUNNER_TEMP) fail("seaweed_audit_context_invalid");
  if (realpathSync(env.RUNNER_TEMP) !== env.RUNNER_TEMP) fail("seaweed_audit_context_invalid");
  return Object.freeze({ root: path.join(env.RUNNER_TEMP, "seaweed-candidate-audit-work"),
    output: path.join(env.RUNNER_TEMP, "seaweed-candidate-audit-evidence"),
    builds: path.join(env.RUNNER_TEMP, "scanner-builds"), runId: env.GITHUB_RUN_ID,
    recipeRevision: env.GITHUB_SHA, uid, gid });
}

function safePath(value) {
  return typeof value === "string" && path.posix.isAbsolute(value) && path.posix.normalize(value) === value
    && !value.includes(",") && !value.includes("\0") && !value.includes("\r") && !value.includes("\n");
}

export function candidateInputDockerArguments({ carrier, scanner, cache, archive, uid, gid, format }) {
  if (!/^[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/u.test(carrier ?? "")
    || ![scanner, cache, archive].every(safePath) || !Number.isSafeInteger(uid)
    || !Number.isSafeInteger(gid) || uid < 1 || gid < 1
    || !["json", "cyclonedx"].includes(format)) fail("seaweed_audit_scan_arguments_invalid");
  const args = ["run", "--rm", "--pull=never", "--platform", "linux/amd64", "--network=none",
    "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges=true", "--user", `${uid}:${gid}`,
    "--pids-limit", "256", "--memory", "4g", "--memory-swap", "4g", "--cpus", "2",
    "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=2g", "--mount", `type=bind,src=${scanner},dst=/scanner,readonly`,
    "--mount", `type=bind,src=${cache},dst=/cache,readonly`,
    "--mount", `type=bind,src=${archive},dst=${INPUT_NAME},readonly`,
    "--entrypoint", "/scanner", carrier, "image", "--input", INPUT_NAME, "--cache-dir", "/cache",
    "--skip-db-update", "--skip-java-db-update", "--skip-version-check", "--offline-scan",
    "--quiet", "--cache-backend", "memory", "--format", format, "--list-all-pkgs"];
  if (format === "json") args.push("--scanners", "vuln", "--severity", "HIGH,CRITICAL");
  return args;
}

function command(args, { output, timeout = 10 * 60_000, deadlineAt, dockerConfig } = {}) {
  const remaining = deadlineAt === undefined ? timeout : Math.min(timeout, deadlineAt - Date.now());
  if (!Number.isSafeInteger(remaining) || remaining < 1000) fail("seaweed_audit_deadline_exceeded");
  const result = spawnSync(DOCKER, args, { timeout: remaining, maxBuffer: 64 * MiB,
    encoding: null, windowsHide: true,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.RUNNER_TEMP,
      DOCKER_CONFIG: dockerConfig, TMPDIR: process.env.RUNNER_TEMP,
      TZ: "UTC", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } });
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0);
  if (output) writeFileSync(output, stdout, { flag: "wx", mode: 0o600 });
  if (result.error || result.status !== 0) fail("seaweed_audit_command_failed");
  return stdout;
}

function manifestEvidence(output, checkpoint, docker) {
  return [
    { name: "vulnerability", repository: "ghcr.io/aquasecurity/trivy-db", tag: "2" },
    { name: "java", repository: "ghcr.io/aquasecurity/trivy-java-db", tag: "1" },
  ].map((entry) => {
    const manifest = docker(["buildx", "imagetools", "inspect", "--raw",
      `${entry.repository}:${entry.tag}`]);
    writeFileSync(path.join(output, `database-${entry.name}-${checkpoint}-manifest.json`), manifest,
      { flag: "wx", mode: 0o600 });
    return { ...entry, ...validateDatabaseRegistryManifest(manifest) };
  });
}

function existingContainerIds(docker, name) {
  const output = docker(["container", "ls", "-a", "--no-trunc", "--quiet",
    "--filter", `name=^/${name}$`]).toString("utf8").trim();
  if (!output) return [];
  const ids = output.split("\n");
  if (ids.some((id) => !/^[0-9a-f]{64}$/u.test(id))) fail("seaweed_audit_container_identity_uncertain");
  return ids;
}

export function ownedContainerRunArguments(args, { name, nonce, runId }) {
  if (!Array.isArray(args) || args[0] !== "run" || !args.includes("--rm")
    || !/^aw-seaweed-audit-[1-9][0-9]{0,19}-(?:db-vulnerability|db-java|scan-json|scan-cyclonedx)$/u.test(name ?? "")
    || !/^[0-9a-f]{32}$/u.test(nonce ?? "") || !RUN_ID.test(runId ?? "")) {
    fail("seaweed_audit_container_arguments_invalid");
  }
  return ["run", "--name", name, "--label", `org.auto-world.audit.run=${runId}`,
    "--label", `org.auto-world.audit.nonce=${nonce}`, ...args.slice(1)];
}

export function ownedContainerRun(args, { kind, carrier, runId, docker, cleanupDocker, proofs, output,
  timeout, nonce = randomBytes(16).toString("hex") }) {
  const name = `aw-seaweed-audit-${runId}-${kind}`;
  if (existingContainerIds(cleanupDocker, name).length !== 0) fail("seaweed_audit_container_preexisting");
  const ownedArgs = ownedContainerRunArguments(args, { name, nonce, runId });
  let failure;
  try { docker(ownedArgs, { output, timeout }); }
  catch (error) { failure = error; }
  let cleanupFailure;
  try {
    const ids = existingContainerIds(cleanupDocker, name);
    if (ids.length > 1) fail("seaweed_audit_container_identity_uncertain");
    if (ids.length === 1) {
      const inspected = JSON.parse(cleanupDocker(["container", "inspect", "--format", "{{json .}}",
        ids[0]]).toString("utf8"));
      if (inspected?.Id !== ids[0] || inspected.Name !== `/${name}`
        || inspected.Config?.Image !== carrier
        || inspected.Config?.Labels?.["org.auto-world.audit.run"] !== runId
        || inspected.Config?.Labels?.["org.auto-world.audit.nonce"] !== nonce) {
        fail("seaweed_audit_container_identity_uncertain");
      }
      cleanupDocker(["container", "rm", "-f", ids[0]]);
    }
    if (existingContainerIds(cleanupDocker, name).length !== 0) fail("seaweed_audit_container_cleanup_uncertain");
    proofs.push({ kind, state: ids.length === 1 ? "OWNED_CONTAINER_REMOVED" : "OWNED_CONTAINER_ABSENT" });
  } catch (error) { cleanupFailure = error; }
  if (cleanupFailure) fail("seaweed_audit_container_cleanup_uncertain");
  if (failure) throw failure;
}

function makeReadOnly(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink() || lstatSync(file).isSymbolicLink()) fail("seaweed_audit_symlink_refused");
    if (entry.isDirectory()) makeReadOnly(file);
    chmodSync(file, entry.isDirectory() ? 0o555 : 0o444);
  }
  chmodSync(directory, 0o555);
}

function makeWritable(directory, uid) {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid) fail("seaweed_audit_cleanup_uncertain");
  chmodSync(directory, 0o700);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const child = lstatSync(file);
    if (child.isSymbolicLink() || child.uid !== uid) fail("seaweed_audit_cleanup_uncertain");
    if (child.isDirectory()) makeWritable(file, uid);
    else if (child.isFile() && child.nlink === 1) chmodSync(file, 0o600);
    else fail("seaweed_audit_cleanup_uncertain");
  }
}

function countTree(directory, cap = 6 * GiB) {
  let bytes = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const stat = lstatSync(file);
    if (stat.isSymbolicLink()) fail("seaweed_audit_symlink_refused");
    bytes += stat.isDirectory() ? countTree(file, cap) : stat.size;
    if (bytes > cap) fail("seaweed_audit_budget_exceeded");
  }
  return bytes;
}

async function scannerPair(buildRoot, work, lockBytes) {
  const lock = JSON.parse(lockBytes.toString("utf8"));
  const builds = [1, 2].map((number) => path.join(buildRoot, `scanner-build-${number}`));
  const receipts = await Promise.all(builds.map(async (directory) =>
    (await readBoundedJson(path.join(directory, "build-receipt.json"), 8 * MiB)).value));
  const closures = await Promise.all(builds.map((directory) =>
    readBoundedJson(path.join(directory, "module-closure.json"), 16 * MiB)));
  const buildInfos = await Promise.all(builds.map(async (directory) => {
    const file = path.join(directory, "go-build-info.txt");
    const [identity] = await captureFiles([{ path: file, cap: 8 * MiB }]);
    return { identity, value: parseGoBuildInfo(readFileSync(file)) };
  }));
  const binary = validateBuildPair(receipts[0], receipts[1], {
    sourceCommit: lock.scanner.sourceCommit, lockSha256: hash(lockBytes),
    moduleClosures: closures, buildInfos,
  });
  const built = await captureFiles(builds.map((directory) => ({ path: path.join(directory, "trivy"),
    cap: 512 * MiB })));
  if (built.some((entry) => entry.sha256 !== binary.sha256 || entry.size !== binary.size)) {
    fail("seaweed_audit_scanner_binary_changed");
  }
  const scanner = path.join(work, "scanner");
  copyFileSync(built[0].path, scanner, 0);
  chmodSync(scanner, 0o555);
  return { lock, binary, scanner, builds: built.map((entry) => ({ sha256: entry.sha256, size: entry.size })) };
}

function cleanedRoot(root) {
  if (!existsSync(root)) return;
  ownedDirectory(root, process.getuid());
  if (readdirSync(root).length !== 0) fail("seaweed_audit_cleanup_uncertain");
  rmdirSync(root);
}

export function validateAuditedCandidateReceipt(candidate, proof, context) {
  if (candidate?.state !== "VERIFIED" || candidate.kind !== "SEAWEED_LOCAL_CANDIDATE_RECEIPT_V1"
    || candidate.authority !== "PREPARATION_ONLY" || candidate.candidateAuthorization !== "NOT_AUTHORIZED"
    || candidate.imageExecution !== "NOT_ATTEMPTED" || candidate.publication !== "NOT_ATTEMPTED"
    || candidate.vulnerabilityAudit !== "NOT_ATTEMPTED" || candidate.admission !== "NOT_ATTEMPTED"
    || candidate.imageId !== proof?.imageId || candidate.diffId !== proof?.diffId
    || candidate.archiveSha256 !== proof?.archiveSha256 || candidate.archiveBytes !== proof?.archiveBytes
    || candidate.runId !== context?.runId || candidate.recipeRevision !== context?.recipeRevision) {
    fail("seaweed_audit_candidate_receipt_invalid");
  }
  return true;
}

async function execute(context, dependencies = {}) {
  const ensureOwned = dependencies.ownedDirectory ?? ownedDirectory;
  const runCommand = dependencies.command ?? command;
  const readScannerPair = dependencies.scannerPair ?? scannerPair;
  const readManifests = dependencies.manifestEvidence ?? manifestEvidence;
  const readDatabases = dependencies.databaseEvidence ?? databaseEvidence;
  const inputArguments = dependencies.inputArguments ?? candidateInputDockerArguments;
  const evaluatePolicy = dependencies.evaluatePolicy ?? evaluateLocalSeaweedCandidateAudit;
  if (existsSync(context.root) || existsSync(context.output)) fail("seaweed_audit_output_exists");
  mkdirSync(context.root, { mode: 0o700 });
  mkdirSync(context.output, { mode: 0o700 });
  ensureOwned(context.root, context.uid);
  const work = path.join(context.root, "scanner-work");
  const candidate = path.join(context.root, "candidate");
  mkdirSync(work, { mode: 0o700 });
  mkdirSync(candidate, { mode: 0o700 });
  const dockerConfig = path.join(work, "docker-config");
  mkdirSync(dockerConfig, { mode: 0o700 });
  const deadlineAt = Date.now() + OPERATION_DEADLINE_MS;
  const abortController = new globalThis.AbortController();
  const deadlineTimer = globalThis.setTimeout(() => abortController.abort(), OPERATION_DEADLINE_MS);
  const docker = (args, options = {}) => runCommand(args, { ...options, deadlineAt, dockerConfig });
  const cleanupDocker = (args) => runCommand(args, { timeout: 60_000, dockerConfig });
  const receipt = { kind: "SEAWEED_EXACT_CANDIDATE_AUDIT_V1", state: "INCOMPLETE",
    authority: "DIAGNOSTIC_ONLY", candidateAuthorization: "NOT_AUTHORIZED",
    publication: "NOT_ATTEMPTED", admission: "NOT_ATTEMPTED", imageExecution: "NOT_ATTEMPTED",
    runId: context.runId, recipeRevision: context.recipeRevision, phase: "PREPARE",
    containerCleanup: [] };
  let thrown; let inspectionFailure;
  try {
    receipt.phase = "SCANNER_REPRODUCIBILITY";
    const lockBytes = readFileSync(LOCK_FILE);
    const { lock, binary, scanner, builds } = await readScannerPair(context.builds, work, lockBytes);
    receipt.scanner = { version: lock.scanner.version, sourceCommit: lock.scanner.sourceCommit,
      binary, builds, lockSha256: hash(lockBytes) };
    const carrier = `${lock.baseline.repository}@${lock.baseline.platformDigest}`;
    receipt.phase = "BASELINE_CARRIER";
    docker(["pull", "--platform", "linux/amd64", carrier]);
    const cache = path.join(work, "cache"); mkdirSync(cache, { mode: 0o700 });
    receipt.phase = "DATABASE_REGISTRY";
    const before = readManifests(context.output, "before", docker);
    receipt.phase = "DATABASE_DOWNLOAD";
    for (const kind of ["vulnerability", "java"]) {
      ownedContainerRun(databaseDownloadDockerArguments({ baseline: carrier, cache,
        user: `${context.uid}:${context.gid}`, registries: before, kind }), {
        kind: `db-${kind}`, carrier, runId: context.runId,
        docker, cleanupDocker, proofs: receipt.containerCleanup, timeout: 10 * 60_000,
      });
    }
    const after = readManifests(context.output, "after", docker);
    if (JSON.stringify(before) !== JSON.stringify(after)) fail("seaweed_audit_database_registry_changed");
    receipt.phase = "DATABASE_FRESHNESS";
    const database = await readDatabases(cache, new Date(), context.output);
    receipt.databases = { ...database, registry: before };
    makeReadOnly(cache);
    const frozen = await captureFiles([{ path: scanner, cap: 512 * MiB }, ...database.files.map((entry) =>
      ({ path: entry.path, cap: entry.cap }))]);
    receipt.phase = "CANDIDATE_MATERIALIZE";
    let evaluation; let archiveIdentity; let proof;
    const materialize = dependencies.materialize ?? withVerifiedLocalSeaweedCandidate;
    const inspectArchive = async (snapshot) => {
      proof = snapshot.archiveProof;
      receipt.phase = "ARCHIVE_IDENTITY";
      [archiveIdentity] = await captureFiles([{ path: snapshot.file, cap: 2 * GiB }]);
      if (archiveIdentity.sha256 !== proof.archiveSha256 || archiveIdentity.size !== proof.archiveBytes
        || snapshot.imageId !== proof.imageId || snapshot.diffId !== proof.diffId
        || snapshot.runId !== context.runId || snapshot.recipeRevision !== context.recipeRevision) {
        fail("seaweed_audit_archive_changed");
      }
      const subject = { artifactName: INPUT_NAME, imageId: snapshot.imageId,
        archiveSha256: proof.archiveSha256, tag: proof.tag };
      receipt.subject = { ...subject, diffId: snapshot.diffId, archiveBytes: proof.archiveBytes,
        configSha256: proof.configSha256, configBytes: proof.configBytes,
        layerSha256: proof.layerSha256, layerBytes: proof.layerBytes };
      const reports = [
        { format: "json", file: path.join(context.output, "candidate-vulnerabilities.json") },
        { format: "cyclonedx", file: path.join(context.output, "candidate-sbom.cdx.json") },
      ];
      for (const report of reports) {
        receipt.phase = report.format === "json" ? "VULNERABILITY_SCAN" : "SBOM_SCAN";
        ownedContainerRun(inputArguments({ carrier, scanner, cache, archive: snapshot.file,
          uid: context.uid, gid: context.gid, format: report.format }),
        { kind: `scan-${report.format}`, carrier, runId: context.runId,
          docker, cleanupDocker, proofs: receipt.containerCleanup,
          output: report.file, timeout: 30 * 60_000 });
        await assertFilesUnchanged([...frozen, archiveIdentity]);
        const current = await readDatabases(cache, new Date());
        if (JSON.stringify(current.files) !== JSON.stringify(database.files)) fail("seaweed_audit_database_changed");
      }
      receipt.phase = "REPORT_POLICY";
      const vuln = await readBoundedJson(reports[0].file, 64 * MiB);
      const sbom = await readBoundedJson(reports[1].file, 64 * MiB);
      evaluation = evaluatePolicy({ vulnerabilityReport: vuln.value,
        cyclonedxReport: sbom.value, subject, now: new Date() });
      receipt.reports = { vulnerability: vuln.identity, cyclonedx: sbom.identity };
      await assertFilesUnchanged([...frozen, archiveIdentity]);
    };
    const candidateReceipt = await materialize({ parent: candidate, recipeRevision: context.recipeRevision,
      createdAt: new Date().toISOString(), runId: context.runId,
      signal: abortController.signal }, async (snapshot) => {
      try { await inspectArchive(snapshot); }
      catch (error) {
        inspectionFailure = error;
        throw error;
      }
    });
    receipt.phase = "CANDIDATE_CLEANUP";
    validateAuditedCandidateReceipt(candidateReceipt, proof, context);
    receipt.candidate = candidateReceipt;
    receipt.findingCount = evaluation.findings.length;
    receipt.blockerCount = evaluation.blockers.length;
    receipt.blockers = evaluation.blockers.slice(0, 32);
    receipt.blockersTruncated = evaluation.blockers.length > 32;
    receipt.state = evaluation.state;
    receipt.phase = "COMPLETE";
  } catch (error) {
    // The materializer deliberately hides callback errors after cleaning its image and archive.
    // Only its plain inspection marker proves that no additional cleanup failure was reported.
    const inspectionMarker = error?.code === "seaweed_candidate_inspection_failed";
    const plainMarker = inspectionMarker && Object.keys(error).sort().join("|")
      === "authority|candidateAuthorization|code|state";
    const reason = inspectionMarker && !plainMarker
      ? new Error("seaweed_audit_candidate_cleanup_uncertain")
      : inspectionFailure && plainMarker ? inspectionFailure : error;
    thrown = reason;
    receipt.failure = { code: /^[a-z][a-z0-9_]{1,79}$/u.test(reason?.message ?? "")
      ? reason.message : "seaweed_audit_failed" };
  } finally {
    globalThis.clearTimeout(deadlineTimer);
    try {
      if (existsSync(candidate)) {
        ensureOwned(candidate, context.uid);
        if (readdirSync(candidate).length !== 0) fail("seaweed_audit_candidate_cleanup_uncertain");
        rmdirSync(candidate);
      }
      if (existsSync(work)) {
        ensureOwned(work, context.uid);
        const cache = path.join(work, "cache");
        if (existsSync(cache)) makeWritable(cache, context.uid);
        rmSync(work, { recursive: true });
      }
      ensureOwned(context.root, context.uid);
      if (readdirSync(context.root).length !== 0) fail("seaweed_audit_cleanup_uncertain");
    } catch {
      receipt.state = "INCOMPLETE";
      receipt.failure = { code: "seaweed_audit_cleanup_uncertain" };
      thrown = new Error("seaweed_audit_cleanup_uncertain");
    }
    receipt.artifactBytes = countTree(context.output);
    if (receipt.artifactBytes > 256 * MiB) {
      receipt.state = "INCOMPLETE"; receipt.failure = { code: "seaweed_audit_evidence_budget_exceeded" };
      thrown = new Error("seaweed_audit_evidence_budget_exceeded");
    }
    writeFileSync(path.join(context.output, "audit-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`,
      { flag: "wx", mode: 0o600 });
  }
  if (thrown || receipt.state !== "COMPLETE") fail(receipt.failure?.code ?? "seaweed_audit_blocked");
  return receipt;
}

export async function TEST_ONLY_executeCandidateAudit(context, dependencies) {
  return execute(context, dependencies);
}

export async function runCandidateAudit(argv = process.argv.slice(2), env = process.env,
  dependencies = {}) {
  if (argv.length !== 1 || !["execute", "cleanup"].includes(argv[0])) fail("seaweed_audit_arguments_invalid");
  const context = requireCandidateAuditContext(env, dependencies.context);
  if (argv[0] === "cleanup") {
    cleanedRoot(context.root);
    return { state: "CLEANED", candidateAuthorization: "NOT_AUTHORIZED" };
  }
  return execute(context, dependencies);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await runCandidateAudit();
  console.log(JSON.stringify(result));
}
