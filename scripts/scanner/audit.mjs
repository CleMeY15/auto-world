import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { evaluateImageReport, validateDatabaseMetadata } from "./audit-policy.mjs";
import { assertFilesUnchanged, captureFiles, compareSameDatabase, parseGoBuildInfo, readBoundedJson, validateBuildPair, validateFixtureReport, validateSelfReport, validateVersionProbeReport } from "./controls.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const LOCK_PATH = path.join(ROOT, "infra/scanner/scanner-lock.json");
const DOCKER = "/usr/bin/docker";
const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const DATABASE_DOWNLOAD_TMPFS_BYTES = 3 * GiB;
const DATABASE_DOWNLOAD_MEMORY_BYTES = 4 * GiB;

function fail(code) { throw new Error(code); }

function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

export function parseAuditArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.startsWith("--") ? argv[index].slice(2) : "";
    if (!key || values.has(key) || argv[index + 1] === undefined) fail("scanner_audit_arguments_invalid");
    values.set(key, argv[index + 1]);
  }
  if ([...values.keys()].some((key) => !["build-root", "output"].includes(key))) fail("scanner_audit_arguments_invalid");
  const buildRoot = values.get("build-root");
  const output = values.get("output");
  if (![buildRoot, output].every((value) => typeof value === "string" && path.isAbsolute(value)) || path.resolve(buildRoot) === path.resolve(output)) fail("scanner_audit_arguments_invalid");
  return { buildRoot: path.resolve(buildRoot), output: path.resolve(output) };
}

function command(executable, args, { cwd, timeout = 10 * 60_000, output } = {}) {
  const result = spawnSync(executable, args, { cwd, timeout, maxBuffer: 128 * MiB, encoding: null, windowsHide: true,
    env: { ...process.env, HOME: process.env.RUNNER_TEMP, TMPDIR: process.env.RUNNER_TEMP, TZ: "UTC", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } });
  const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0);
  const stderr = Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.alloc(0);
  if (output) writeFileSync(output, stdout, { flag: "wx" });
  if (result.error || result.status !== 0) {
    const diagnostic = { executable: path.basename(executable), exitCode: result.status, stdout: { size: stdout.length }, stderr: { size: stderr.length },
      tail: stderr.toString("utf8").slice(-4096).replaceAll(/(?:gh[oprsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})/gu, "[redacted]") };
    const error = new Error("scanner_audit_command_failed"); error.diagnostic = diagnostic; throw error;
  }
  return stdout;
}

function treeSize(directory) {
  let size = 0;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const info = lstatSync(absolute);
    if (info.isSymbolicLink()) fail("scanner_audit_symlink_refused");
    size += entry.isDirectory() ? treeSize(absolute) : info.size;
    if (size > 8 * GiB) fail("scanner_audit_job_budget_exceeded");
  }
  return size;
}

function cacheFiles(cache) {
  return [
    { path: path.join(cache, "db/trivy.db"), cap: 2 * GiB },
    { path: path.join(cache, "db/metadata.json"), cap: 8 * MiB },
    { path: path.join(cache, "java-db/trivy-java.db"), cap: 2 * GiB },
    { path: path.join(cache, "java-db/metadata.json"), cap: 8 * MiB },
  ];
}

function makeReadOnly(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink() || lstatSync(absolute).isSymbolicLink()) fail("scanner_audit_symlink_refused");
    if (entry.isDirectory()) { makeReadOnly(absolute); chmodSync(absolute, 0o555); }
    else chmodSync(absolute, 0o444);
  }
  chmodSync(directory, 0o555);
}

function makeWritable(directory) {
  if (!existsSync(directory)) return;
  chmodSync(directory, 0o755);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink() || lstatSync(absolute).isSymbolicLink()) continue;
    if (entry.isDirectory()) makeWritable(absolute);
    else chmodSync(absolute, 0o600);
  }
}

function dockerBase(lock, cache, mounts = []) {
  return ["run", "--rm", "--pull=never", "--platform", "linux/amd64", "--network=none", "--read-only", "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true", "--user", "65532:65532", "--pids-limit", "256", "--memory", "1g", "--memory-swap", "1g", "--cpus", "1",
    "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=64m", "--mount", `type=bind,src=${cache},dst=/cache,readonly`, ...mounts,
    `${lock.baseline.repository}@${lock.baseline.platformDigest}`];
}

export function baselineFixtureArguments(lock, cache, fixtures, mode, target) {
  if (!["fs", "rootfs"].includes(mode) || typeof fixtures !== "string" || !path.isAbsolute(fixtures) ||
      typeof target !== "string" || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u.test(target)) fail("scanner_baseline_fixture_arguments_invalid");
  const args = dockerBase(lock, cache, ["--mount", `type=bind,src=${fixtures},dst=/fixtures,readonly`]);
  return [...args, mode, "--cache-dir", "/cache", "--skip-db-update", "--skip-java-db-update", "--skip-version-check", "--offline-scan",
    "--cache-backend", "memory", "--quiet", "--scanners", "vuln", "--format", "json", "--list-all-pkgs", `/fixtures/${target}`];
}

function baselineFixture(lock, cache, fixtures, mode, target, output) {
  command(DOCKER, baselineFixtureArguments(lock, cache, fixtures, mode, target), { output });
}

export function fixtureScanMode(fixture) {
  if (fixture?.id === "gomod-vulnerable") return "fs";
  if (["java-war-vulnerable", "java-jar-clean-candidate"].includes(fixture?.id)) return "rootfs";
  fail("scanner_fixture_mode_invalid");
}

export function validateDatabaseRegistryManifest(manifest) {
  if (!Buffer.isBuffer(manifest) || manifest.length < 64 || manifest.length > 8 * MiB) fail("scanner_database_registry_manifest_invalid");
  let document;
  try { document = JSON.parse(manifest.toString("utf8")); } catch { fail("scanner_database_registry_manifest_invalid"); }
  if (document?.schemaVersion !== 2 || !Array.isArray(document.layers) || document.layers.length < 1 || document.layers.length > 8) fail("scanner_database_registry_manifest_invalid");
  let layerBytes = 0;
  for (const layer of document.layers) {
    if (!/^sha256:[a-f0-9]{64}$/u.test(layer?.digest ?? "") || typeof layer.mediaType !== "string" || !layer.mediaType ||
        !Number.isSafeInteger(layer.size) || layer.size < 1) fail("scanner_database_registry_manifest_invalid");
    layerBytes += layer.size;
  }
  // Trivy retains the OCI layer while go-getter copies it to getter*/archive, then streams decompression to the cache.
  if (!Number.isSafeInteger(layerBytes) || layerBytes >= GiB || DATABASE_DOWNLOAD_TMPFS_BYTES - (2 * layerBytes) < GiB) fail("scanner_database_layer_budget_exceeded");
  return { digest: `sha256:${sha256(manifest)}`, size: manifest.length, layerBytes };
}

export function databaseDownloadDockerArguments({ baseline, cache, user, registries, kind }) {
  if (!/^[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/u.test(baseline ?? "") ||
      typeof cache !== "string" || !path.isAbsolute(cache) || !/^\d+:\d+$/u.test(user ?? "") ||
      !Array.isArray(registries) || registries.length !== 2 || !["vulnerability", "java"].includes(kind)) fail("scanner_database_download_arguments_invalid");
  const references = registries.map((entry) => `${entry?.repository}@${entry?.digest}`);
  if (references.some((entry) => !/^[a-z0-9.]+(?:[._/-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/u.test(entry))) fail("scanner_database_download_arguments_invalid");
  return ["run", "--rm", "--pull=never", "--platform", "linux/amd64", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges=true",
    "--user", user, "--pids-limit", "256", "--memory", "4g", "--memory-swap", "4g", "--cpus", "1",
    "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=3g,mode=1777", "--mount", `type=bind,src=${cache},dst=/cache`, baseline, "image", "--cache-dir", "/cache",
    "--db-repository", references[0], "--java-db-repository", references[1], kind === "vulnerability" ? "--download-db-only" : "--download-java-db-only"];
}

export function candidateDockerArguments({ carrier, scanner, cache, mode, target, format = "json", extra = [] }) {
  const safePath = (value) => typeof value === "string" && path.isAbsolute(value) && !value.includes("\0") && !value.includes(",");
  if (!/^[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/u.test(carrier ?? "") ||
      !["image", "fs", "rootfs"].includes(mode) || !safePath(scanner) || !safePath(cache) ||
      typeof target !== "string" || !target || !["json", "cyclonedx"].includes(format) || !Array.isArray(extra)) fail("scanner_candidate_arguments_invalid");
  const filesystem = mode !== "image";
  if (filesystem && !safePath(target) || !filesystem && !/^[a-z0-9]+(?:[._/-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/u.test(target)) fail("scanner_candidate_arguments_invalid");
  const containerTarget = filesystem ? `/${path.basename(target)}` : target;
  if (filesystem && !/^\/[A-Za-z0-9_.-]{1,255}$/u.test(containerTarget)) fail("scanner_candidate_arguments_invalid");
  const args = ["run", "--rm", "--pull=never", "--platform", "linux/amd64", `--network=${filesystem ? "none" : "bridge"}`, "--read-only",
    "--cap-drop=ALL", "--security-opt=no-new-privileges=true", "--user", "65532:65532", "--pids-limit", "256", "--memory", "2g",
    "--memory-swap", "2g", "--cpus", "2", "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=512m", "--mount", `type=bind,src=${scanner},dst=/scanner,readonly`,
    "--mount", `type=bind,src=${cache},dst=/cache,readonly`];
  if (filesystem) args.push("--mount", `type=bind,src=${target},dst=${containerTarget},readonly`);
  args.push("--entrypoint", "/scanner", carrier, mode, "--cache-dir", "/cache", "--skip-db-update", "--skip-java-db-update", "--skip-version-check",
    "--quiet", "--cache-backend", "memory", "--format", format, "--list-all-pkgs");
  if (format === "json") args.push("--scanners", "vuln");
  args.push(...extra, containerTarget);
  return args;
}

function candidateScan(carrier, scanner, cache, mode, target, output, extra = [], format = "json") {
  command(DOCKER, candidateDockerArguments({ carrier, scanner, cache, mode, target, format, extra }), { output });
}

export function versionProbeBytes(lock) {
  if (!/^\d+\.\d+\.\d+$/u.test(lock?.scanner?.upstreamVersion ?? "") || !/^\d+\.\d+\.\d+$/u.test(lock?.compiler?.version ?? "")) fail("scanner_version_probe_lock_invalid");
  return Buffer.from(`module auto.world/scanner-version-probe\n\ngo ${lock.compiler.version}\n\nrequire github.com/aquasecurity/trivy v${lock.scanner.upstreamVersion}\n`, "utf8");
}

async function databaseEvidence(cache, now) {
  const files = cacheFiles(cache);
  const snapshot = await captureFiles(files);
  const vulnerability = (await readBoundedJson(files[1].path, files[1].cap)).value;
  const java = (await readBoundedJson(files[3].path, files[3].cap)).value;
  return { files: snapshot, metadata: {
    vulnerability: validateDatabaseMetadata(vulnerability, { now, expectedVersion: 2 }),
    java: validateDatabaseMetadata(java, { now, expectedVersion: 1 }),
  } };
}

function databaseRegistryEvidence(output, checkpoint) {
  return [
    { name: "vulnerability", repository: "ghcr.io/aquasecurity/trivy-db", tag: "2", reference: "ghcr.io/aquasecurity/trivy-db:2" },
    { name: "java", repository: "ghcr.io/aquasecurity/trivy-java-db", tag: "1", reference: "ghcr.io/aquasecurity/trivy-java-db:1" },
  ].map((entry) => {
    const manifest = command(DOCKER, ["buildx", "imagetools", "inspect", "--raw", entry.reference]);
    writeFileSync(path.join(output, `database-${entry.name}-${checkpoint}-manifest.json`), manifest, { flag: "wx" });
    return { ...entry, ...validateDatabaseRegistryManifest(manifest) };
  });
}

export async function auditScanner({ buildRoot, output }) {
  if (process.platform !== "linux" || process.env.GITHUB_ACTIONS !== "true" || !process.env.RUNNER_TEMP) fail("scanner_audit_requires_linux_actions");
  if (existsSync(output)) fail("scanner_audit_output_exists");
  mkdirSync(output, { recursive: true });
  const work = path.join(process.env.RUNNER_TEMP, "aw-scanner-audit-work");
  if (existsSync(work)) fail("scanner_audit_work_exists");
  mkdirSync(work);
  const receipt = { schemaVersion: 1, state: "diagnostic_only", result: "failed", phases: [], reports: [], blockers: [] };
  receipt.run = { repository: process.env.GITHUB_REPOSITORY ?? "", workflowSha: process.env.GITHUB_WORKFLOW_SHA ?? "",
    sourceSha: process.env.GITHUB_SHA ?? "", runId: process.env.GITHUB_RUN_ID ?? "", attempt: process.env.GITHUB_RUN_ATTEMPT ?? "" };
  let buildInputBytes = 0;
  const phase = async (name, operation) => {
    const started = Date.now();
    try { const value = await operation(); receipt.phases.push({ name, result: "passed", durationMs: Date.now() - started }); return value; }
    catch (error) { receipt.phases.push({ name, result: "failed", durationMs: Date.now() - started, reason: error.message, diagnostic: error.diagnostic }); throw error; }
  };
  try {
    buildInputBytes = treeSize(buildRoot);
    if (buildInputBytes > 6 * GiB) fail("scanner_audit_input_budget_exceeded");
    const lockBytes = readFileSync(LOCK_PATH);
    const lock = JSON.parse(lockBytes.toString("utf8"));
    if (!Array.isArray(lock.images) || lock.images.length !== 6 || !Array.isArray(lock.alternatives) || lock.alternatives.length !== 2) fail("scanner_audit_inventory_invalid");
    const builds = [1, 2].map((repeat) => path.join(buildRoot, `scanner-build-${repeat}`));
    const receipts = await phase("reproducibility", async () => Promise.all(builds.map(async (directory) => (await readBoundedJson(path.join(directory, "build-receipt.json"), 8 * MiB)).value)));
    const moduleClosures = await Promise.all(builds.map((directory) => readBoundedJson(path.join(directory, "module-closure.json"), 16 * MiB)));
    const buildInfos = await Promise.all(builds.map(async (directory) => {
      const file = path.join(directory, "go-build-info.txt");
      const [identity] = await captureFiles([{ path: file, cap: 8 * MiB }]);
      return { identity, value: parseGoBuildInfo(readFileSync(file)) };
    }));
    const binaryIdentity = validateBuildPair(receipts[0], receipts[1], {
      sourceCommit: lock.scanner.sourceCommit, lockSha256: sha256(lockBytes), moduleClosures, buildInfos,
    });
    const buildBinaries = await captureFiles(builds.map((directory) => ({ path: path.join(directory, "trivy"), cap: 512 * MiB })));
    if (buildBinaries.some((entry) => entry.sha256 !== binaryIdentity.sha256 || entry.size !== binaryIdentity.size)) fail("scanner_build_binary_changed");
    const subject = path.join(work, "subject"); mkdirSync(subject);
    const scanner = path.join(subject, "trivy"); copyFileSync(buildBinaries[0].path, scanner); chmodSync(scanner, 0o555);
    const versionProbe = path.join(work, "scanner-version-probe"); mkdirSync(versionProbe);
    const probeBytes = versionProbeBytes(lock);
    const versionProbeFile = path.join(versionProbe, "go.mod"); writeFileSync(versionProbeFile, probeBytes, { flag: "wx" });
    const retainedVersionProbe = path.join(output, "scanner-main-version-probe.go.mod"); writeFileSync(retainedVersionProbe, probeBytes, { flag: "wx" });
    chmodSync(versionProbeFile, 0o444); chmodSync(versionProbe, 0o555);
    const [versionProbeSnapshot] = await captureFiles([{ path: versionProbeFile, cap: 8 * MiB }]);
    const [retainedVersionProbeSnapshot] = await captureFiles([{ path: retainedVersionProbe, cap: 8 * MiB }]);
    if (versionProbeSnapshot.sha256 !== retainedVersionProbeSnapshot.sha256 || versionProbeSnapshot.size !== retainedVersionProbeSnapshot.size) fail("scanner_version_probe_evidence_changed");
    const fixtureRoot = path.join(ROOT, "infra/scanner/materials/scanner-fixtures");
    const fixtureManifest = JSON.parse(readFileSync(path.join(fixtureRoot, "manifest.json"), "utf8"));

    const baseline = `${lock.baseline.repository}@${lock.baseline.platformDigest}`;
    let baselineImageBytes = 0;
    await phase("baseline_tcb", async () => {
      command(DOCKER, ["pull", "--platform", "linux/amd64", baseline], { timeout: 10 * 60_000 });
      const inspect = command(DOCKER, ["image", "inspect", baseline]);
      const parsed = JSON.parse(inspect.toString("utf8"));
      baselineImageBytes = parsed?.[0]?.Size;
      if (!Number.isSafeInteger(baselineImageBytes) || baselineImageBytes < 1 || baselineImageBytes > 2 * GiB) fail("scanner_baseline_image_invalid");
      writeFileSync(path.join(output, "baseline-image-inspect.json"), inspect, { flag: "wx" });
      writeFileSync(path.join(output, "docker-version.json"), command(DOCKER, ["version", "--format", "{{json .}}"]), { flag: "wx" });
      const buildxVersion = command(DOCKER, ["buildx", "version"]);
      if (buildxVersion.length < 1 || buildxVersion.length > 64 * 1024) fail("scanner_buildx_version_invalid");
      writeFileSync(path.join(output, "docker-buildx-version.txt"), buildxVersion, { flag: "wx" });
    });
    const cache = path.join(work, "cache"); mkdirSync(cache);
    const registryBefore = await phase("database_registry_before", async () => databaseRegistryEvidence(output, "before"));
    await phase("database_download", async () => {
      const user = `${process.getuid()}:${process.getgid()}`;
      command(DOCKER, databaseDownloadDockerArguments({ baseline, cache, user, registries: registryBefore, kind: "vulnerability" }), { timeout: 10 * 60_000 });
      command(DOCKER, databaseDownloadDockerArguments({ baseline, cache, user, registries: registryBefore, kind: "java" }), { timeout: 10 * 60_000 });
    });
    const registryAfter = await phase("database_registry_after", async () => databaseRegistryEvidence(output, "after"));
    if (JSON.stringify(registryBefore) !== JSON.stringify(registryAfter)) fail("scanner_database_registry_changed");
    const now = new Date();
    const database = await phase("database_freeze", async () => databaseEvidence(cache, now));
    const transientDownloadBytes = DATABASE_DOWNLOAD_TMPFS_BYTES + (DATABASE_DOWNLOAD_MEMORY_BYTES - DATABASE_DOWNLOAD_TMPFS_BYTES);
    const jobBytes = buildInputBytes + treeSize(path.join(ROOT, "infra/scanner")) + treeSize(cache) + baselineImageBytes + transientDownloadBytes + versionProbeSnapshot.size;
    if (jobBytes > 8 * GiB) fail("scanner_audit_job_budget_exceeded");
    receipt.budget = { buildInputBytes, baselineImageBytes, transientDownloadBytes, versionProbeBytes: versionProbeSnapshot.size,
      projectedJobBytes: jobBytes, artifactLimitBytes: 6 * GiB, jobLimitBytes: 8 * GiB };
    makeReadOnly(cache);
    const fixtureFiles = lock.fixtures.filter((entry) => entry.path.includes("scanner-fixtures/")).map((entry) => ({ path: path.join(ROOT, entry.path), cap: 4 * MiB }));
    const buildEvidenceFiles = builds.flatMap((directory) => [
      { path: path.join(directory, "module-closure.json"), cap: 16 * MiB },
      { path: path.join(directory, "go-build-info.txt"), cap: 8 * MiB },
    ]);
    const frozen = await captureFiles([{ path: scanner, cap: 512 * MiB }, { path: versionProbeFile, cap: 8 * MiB }, ...buildEvidenceFiles, ...cacheFiles(cache), ...fixtureFiles]);
    receipt.subject = binaryIdentity;
    receipt.versionProbe = { input: { sha256: versionProbeSnapshot.sha256, size: versionProbeSnapshot.size },
      retained: { sha256: retainedVersionProbeSnapshot.sha256, size: retainedVersionProbeSnapshot.size } };
    receipt.databases = { ...database, registry: registryBefore };

    await phase("self_audit", async () => {
      const reportPath = path.join(output, "scanner-self.json");
      candidateScan(baseline, scanner, cache, "rootfs", subject, reportPath, ["--offline-scan", "--severity", "HIGH,CRITICAL"]);
      const sbomPath = path.join(output, "scanner-sbom.cdx.json");
      candidateScan(baseline, scanner, cache, "rootfs", subject, sbomPath, ["--offline-scan"], "cyclonedx");
      validateSelfReport((await readBoundedJson(reportPath)).value, (await readBoundedJson(sbomPath)).value, buildInfos[0].value, lock.scanner.upstreamVersion);
      await assertFilesUnchanged(frozen);
    });

    await phase("main_version_probe", async () => {
      const reportPath = path.join(output, "scanner-main-version-probe.json");
      candidateScan(baseline, scanner, cache, "fs", versionProbe, reportPath, ["--offline-scan", "--severity", "HIGH,CRITICAL"]);
      const report = await readBoundedJson(reportPath);
      receipt.versionProbe.report = report.identity;
      validateVersionProbeReport(report.value, lock.scanner.upstreamVersion);
      await assertFilesUnchanged(frozen);
    });

    await phase("fixture_controls", async () => {
      const failures = [];
      for (const fixture of fixtureManifest.fixtures) {
        const target = fixture.material[0].path.startsWith("gomod/") ? "gomod" : fixture.material[0].path.replace(/^java\//u, "java/");
        const mode = fixtureScanMode(fixture);
        const candidatePath = path.join(output, `fixture-${fixture.id}-candidate.json`);
        let candidateError;
        try { candidateScan(baseline, scanner, cache, mode, path.join(fixtureRoot, target), candidatePath, ["--offline-scan"]); }
        catch (error) { candidateError = error; }
        await assertFilesUnchanged(frozen);
        let baselinePath;
        let baselineError;
        if (fixture.id !== "java-jar-clean-candidate") {
          baselinePath = path.join(output, `fixture-${fixture.id}-baseline.json`);
          try { baselineFixture(lock, cache, fixtureRoot, mode, target, baselinePath); }
          catch (error) { baselineError = error; }
        }
        try {
          if (candidateError) throw candidateError;
          if (baselineError) throw baselineError;
          const candidate = validateFixtureReport(fixture, (await readBoundedJson(candidatePath)).value);
          if (baselinePath) {
            const baselineInventory = validateFixtureReport(fixture, (await readBoundedJson(baselinePath)).value, lock.baseline.version);
            compareSameDatabase(candidate, baselineInventory);
          }
        } catch (error) {
          failures.push({ id: fixture.id, reason: error.message, diagnostic: error.diagnostic });
        }
        await assertFilesUnchanged(frozen);
      }
      receipt.fixtureControls = failures;
      if (failures.length) {
        const error = new Error("scanner_fixture_controls_blocked"); error.diagnostic = { failures }; throw error;
      }
    });

    await phase("image_audits", async () => {
      for (const image of [...lock.images, ...lock.alternatives]) {
        const current = await databaseEvidence(cache, new Date());
        if (JSON.stringify(current.files) !== JSON.stringify(database.files)) fail("scanner_database_changed");
        const reportPath = path.join(output, `image-${image.role}.json`);
        candidateScan(baseline, scanner, cache, "image", `${image.repository}@${image.platform.digest}`, reportPath,
          ["--image-src", "remote", "--severity", "HIGH,CRITICAL"]);
        const reportFile = await readBoundedJson(reportPath);
        const evaluation = evaluateImageReport(reportFile.value, image, [], new Date());
        receipt.reports.push({ role: image.role, report: reportFile.identity, findingCount: evaluation.findings.length, blockerCount: evaluation.blockers.length });
        receipt.blockers.push(...evaluation.blockers.map((entry) => ({ role: image.role, ...entry })));
        await assertFilesUnchanged(frozen);
      }
      if (receipt.blockers.length) fail("scanner_image_audit_blocked");
    });
    receipt.result = "passed";
  } finally {
    receipt.artifactBytes = treeSize(output);
    receipt.jobInputBytes = buildInputBytes + treeSize(path.join(ROOT, "infra/scanner"));
    if (receipt.artifactBytes > 6 * GiB || receipt.jobInputBytes > 8 * GiB) receipt.result = "failed_budget";
    writeFileSync(path.join(output, "audit-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
    makeWritable(work);
    rmSync(work, { recursive: true, force: true });
  }
  if (receipt.result !== "passed") fail("scanner_audit_blocked");
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await auditScanner(parseAuditArguments(process.argv.slice(2)));
}
