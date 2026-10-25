import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { baselineFixtureArguments, candidateDockerArguments, collectImageAudits, databaseDownloadDockerArguments, databaseEvidence,
  fixtureScanMode, projectAuditBudget, validateDatabaseRegistryManifest, versionProbeBytes } from "./audit.mjs";
import { assertFilesUnchanged, captureFiles, compareSameDatabase, readBoundedJson, validateFixtureReport } from "./controls.mjs";
import { parseOfficialGoBuildInfo } from "./official-build-info.mjs";
import { evaluateImageReport, validateSelfReport, validateVersionProbeReport } from "./official-controls.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DOCKER = "/usr/bin/docker";
const MiB = 1024 ** 2;
const GiB = 1024 ** 3;
const ROLES = new Map([["postgres", "library/postgres"], ["opensearch", "opensearchproject/opensearch"], ["redis", "library/redis"],
  ["seaweedfs", "chrislusf/seaweedfs"], ["aws-cli", "amazon/aws-cli"]]);
// Trivy e713f67 pkg/fanal/types/const.go:167-173 and pkg/sbom/io/encode.go:170-204.
const AGGREGATING_TYPES = new Set(["python-pkg", "conda-pkg", "gemspec", "node-pkg", "jar"]);
const fail = (code) => { throw new Error(code); };
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
const safePath = (value) => typeof value === "string" && path.isAbsolute(value) && !/[\0,\r\n]/u.test(value);
const digest = (value) => /^sha256:[a-f0-9]{64}$/u.test(value ?? "");

export function commandFailureDiagnostic(result) {
  const tail = (bytes) => (Buffer.isBuffer(bytes) ? bytes.toString("utf8") : "")
    .replaceAll(/(?:gh[oprsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})/gu, "[redacted]")
    .replaceAll(/(Authorization:\s*(?:Bearer|Basic)\s+)\S+/giu, "$1[redacted]")
    .replaceAll(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/giu, "$1[redacted]@")
    .slice(-4096);
  return { stdoutBytes: result.stdout?.length ?? 0, stderrBytes: result.stderr?.length ?? 0,
    stdoutTail: tail(result.stdout), stderrTail: tail(result.stderr) };
}

export function parseOfficialAuditArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 6) fail("scanner_official_arguments_invalid");
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!["--scanner", "--build-info", "--output"].includes(argv[index]) || values.has(argv[index]) || !safePath(argv[index + 1])) fail("scanner_official_arguments_invalid");
    values.set(argv[index], path.resolve(argv[index + 1]));
  }
  const result = { scanner: values.get("--scanner"), buildInfo: values.get("--build-info"), output: values.get("--output") };
  if (new Set(Object.values(result)).size !== 3) fail("scanner_official_arguments_invalid");
  return result;
}

export function validateOfficialReleaseConfig(config) {
  if (config?.schemaVersion !== 1 || config.scanner?.version !== "0.76.1" || config.scanner.sourceCommit !== "e713f67f7d54decdcd9b3132c9751833dcced698" ||
      config.scanner.archive?.name !== "trivy_0.76.1_Linux-64bit.tar.gz" || config.scanner.archive.bytes !== 52676794 ||
      config.scanner.archive.sha256 !== "c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0" ||
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

export async function auditOfficialScanner({ scanner: inputScanner, buildInfo, output }) {
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
  const receipt = { schemaVersion: 1, state: "diagnostic_only", admission: "NOT_AUTHORIZED", result: "failed", phases: [], reports: [], blockers: [], commands: [] };
  receipt.run = Object.fromEntries(["GITHUB_REPOSITORY", "GITHUB_SHA", "GITHUB_WORKFLOW_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"].map((key) => [key, process.env[key] ?? ""]));
  const owner = randomUUID();
  let cleanupUncertain = false;
  const invoke = (executable, args, timeout) => spawnSync(executable, args, { timeout, maxBuffer: 128 * MiB, encoding: null, windowsHide: true, env: environment });
  const successful = (result) => !result.error && result.status === 0 && result.signal === null;
  const command = (executable, originalArgs, { file, timeout = 10 * 60_000 } = {}) => {
    if (cleanupUncertain) fail("scanner_official_cleanup_uncertain");
    const name = executable === DOCKER && originalArgs[0] === "run" ? `aw-official-${randomUUID()}` : null;
    const args = name ? ownedRunArguments(originalArgs, name, owner) : originalArgs;
    const result = invoke(executable, args, timeout);
    const prefix = `command-${String(receipt.commands.length + 1).padStart(3, "0")}`;
    const record = { executable: path.basename(executable), exitCode: result.status, signal: result.signal, error: result.error?.code ?? null };
    if (!successful(result)) record.diagnostic = commandFailureDiagnostic(result);
    receipt.commands.push(record);
    try {
      writeFileSync(file ?? path.join(output, `${prefix}.stdout`), result.stdout ?? Buffer.alloc(0), { flag: "wx", mode: 0o600 });
      writeFileSync(path.join(output, `${prefix}.stderr`), result.stderr ?? Buffer.alloc(0), { flag: "wx", mode: 0o600 });
    } finally {
      if (name) {
        try {
          const inspected = invoke(DOCKER, ["container", "inspect", name], 15_000);
          record.cleanup = { inspected: inspected.status, removed: false };
          if (!validateContainerAbsence(inspected, name)) {
            record.cleanup.diagnostic = commandFailureDiagnostic(inspected);
            if (!successful(inspected)) fail("scanner_official_cleanup_uncertain");
            const id = validateOwnedContainer(JSON.parse(inspected.stdout.toString("utf8")), name, owner);
            const removed = invoke(DOCKER, ["container", "rm", "--force", id], 30_000);
            if (!successful(removed)) { record.cleanup.diagnostic = commandFailureDiagnostic(removed); fail("scanner_official_cleanup_uncertain"); }
            record.cleanup.removed = true;
            const absence = invoke(DOCKER, ["container", "inspect", name], 15_000);
            if (!validateContainerAbsence(absence, name)) { record.cleanup.diagnostic = commandFailureDiagnostic(absence); fail("scanner_official_cleanup_uncertain"); }
          }
          record.ownedContainerAbsent = true;
        } catch {
          cleanupUncertain = true;
          fail("scanner_official_cleanup_uncertain");
        }
      }
    }
    if (!successful(result)) fail("scanner_official_command_failed");
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
    const original = await captureFiles([{ path: inputScanner, cap: 512 * MiB }, { path: buildInfo, cap: 8 * MiB }]);
    const inventory = parseOfficialGoBuildInfo(readFileSync(buildInfo));
    const subject = path.join(work, "subject"); mkdirSync(subject, { mode: 0o755 });
    const scanner = path.join(subject, "trivy"); copyFileSync(inputScanner, scanner); chmodSync(scanner, 0o555); chmodSync(subject, 0o555);
    copyFileSync(buildInfo, path.join(output, "go-build-info.txt"));
    const [binary] = await captureFiles([{ path: scanner, cap: 512 * MiB }]);
    if (binary.sha256 !== original[0].sha256 || binary.size !== original[0].size) fail("scanner_official_binary_changed");
    receipt.subject = binary;
    receipt.buildInventory = inventory;
    await assertFilesUnchanged(original);
    await assertFilesUnchanged(policyInputs);
    const version = command(scanner, ["--version"], { file: path.join(output, "scanner-version.txt"), timeout: 30_000 }).toString("utf8");
    if (!/^Version: 0\.76\.1\r?$/mu.test(version)) fail("scanner_official_version_invalid");
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
    const inputs = await captureFiles([{ path: configFile, cap: MiB }, { path: lockFile, cap: MiB }, { path: scanner, cap: 512 * MiB },
      { path: probeFile, cap: MiB }, ...original.map(({ path: file, cap }) => ({ path: file, cap })), ...fixtureFiles,
      ...database.files.map(({ path: file, cap }) => ({ path: file, cap }))]);
    await assertFilesUnchanged(original); await assertFilesUnchanged(policyInputs); await assertFilesUnchanged(fixtureSnapshot);
    receipt.inputs = inputs;
    receipt.budget = projectAuditBudget({ buildInputBytes: original.reduce((sum, entry) => sum + entry.size, 0), materialBytes: fixtureSnapshot.reduce((sum, entry) => sum + entry.size, 0),
      databaseBytes: database.files.reduce((sum, entry) => sum + entry.size, 0), baselineImageBytes: carrierBytes, versionProbeBytes: lstatSync(probeFile).size });
    const scan = (mode, target, file, format = "json", extra = ["--offline-scan"]) => command(DOCKER, candidateDockerArguments({ carrier, scanner, cache, mode, target, format, extra }), { file });
    await phase("self_audit", async () => {
      const json = path.join(output, "scanner-self.json"); const sbom = path.join(output, "scanner-self.cdx.json");
      scan("rootfs", subject, json, "json", ["--offline-scan", "--severity", "HIGH,CRITICAL"]); scan("rootfs", subject, sbom, "cyclonedx");
      validateSelfReport((await readBoundedJson(json)).value, (await readBoundedJson(sbom)).value, inventory, config.scanner.version, { expectedScannerVersion: config.scanner.version });
      await assertFilesUnchanged(inputs);
    });
    await phase("main_version_probe", async () => {
      const file = path.join(output, "scanner-version-probe.json"); scan("fs", probe, file, "json", ["--offline-scan", "--severity", "HIGH,CRITICAL"]);
      validateVersionProbeReport((await readBoundedJson(file)).value, config.scanner.version, { expectedScannerVersion: config.scanner.version });
      await assertFilesUnchanged(inputs);
    });
    await phase("fixtures_and_same_database_baseline", async () => {
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
    await phase("five_image_audits", async () => {
      const reports = new Map();
      const collected = await collectImageAudits(config.images, {
        beforeScan: async () => { if (cleanupUncertain) fail("scanner_official_cleanup_uncertain"); await databaseEvidence(cache, new Date()); await assertFilesUnchanged(inputs); },
        scan: async (image) => {
          const files = { json: path.join(output, `image-${image.role}.json`), sbom: path.join(output, `image-${image.role}.cdx.json`) }; reports.set(image.role, files);
          const failures = [];
          for (const format of ["json", "cyclonedx"]) {
            try { command(DOCKER, officialImageScanArguments(carrier, scanner, cache, image, format), { file: format === "json" ? files.json : files.sbom }); }
            catch (error) { failures.push(error); }
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
          validateOfficialImageSbom(report.json, report.sbom, image);
          return evaluateImageReport(report.json, image, [], new Date(), { expectedScannerVersion: config.scanner.version });
        },
      });
      receipt.reports = collected.reports; receipt.blockers = collected.blockers; receipt.rejections = collected.rejections;
      if (collected.rejections.length) fail("scanner_official_images_blocked");
    });
    await assertFilesUnchanged(inputs);
    receipt.result = "passed";
  } catch (error) {
    receipt.failure = error.message;
    throw error;
  } finally {
    // No image/cache pruning: this new directory belongs only to the disposable runner job.
    receipt.workRetention = "DISPOSABLE_RUNNER_JOB_ONLY_NOT_SUPPORTED_ARCHIVE";
    writeJson(path.join(output, "official-audit-receipt.json"), receipt);
  }
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await auditOfficialScanner(parseOfficialAuditArguments(process.argv.slice(2)));
}
