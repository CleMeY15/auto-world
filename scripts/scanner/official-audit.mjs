import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statfsSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { TextDecoder } from "node:util";
import { baselineFixtureArguments, candidateDockerArguments, collectImageAudits, databaseDownloadDockerArguments, databaseEvidence,
  fixtureScanMode, projectAuditBudget, validateDatabaseRegistryManifest, versionProbeBytes } from "./audit.mjs";
import { assertFilesUnchanged, captureFiles, compareSameDatabase, readBoundedJson, validateFixtureReport } from "./controls.mjs";
import { parseOfficialGoBuildInfo } from "./official-build-info.mjs";
import { evaluateArchiveImageReport, evaluateImageReport, validateSelfReport, validateVersionProbeReport } from "./official-controls.mjs";

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
  if (!Array.isArray(argv) || ![6, 8].includes(argv.length)) fail("scanner_official_arguments_invalid");
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
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
  if (!keys(managed.gosu, ["version", "sourceCommit", "archiveBytes", "archiveSha256", "goModSha256", "goSumSha256"]) ||
      !keys(managed.opensearch, ["version", "profile", "sourceCommit", "gradleVersion", "gradleDistributionSha256", "gradleWrapperJarSha256", "jackson2", "jackson3", "runtimeJdk"]) ||
      !keys(managed.amazonLinux, ["releasever", "repositoryGuid", "repomdSha256", "primarySha256"]) ||
      managed.gosu?.sourceCommit !== "29b939aa5bd4dc588af765b8248f6e39150d2565" || managed.gosu.version !== "1.20" || managed.gosu.archiveBytes !== 18160 ||
      managed.gosu.archiveSha256 !== "2b70da8a5480fafedc16bb1fc91b572f064d03df736cbd91a616af2f1b66ab51" ||
      managed.gosu.goModSha256 !== "216dbdc31af7371e368b90a85837c6dcf8aa7139cb449ecceaa0526d91900c3a" ||
      managed.gosu.goSumSha256 !== "3f4d244f09dc5009ad68d99b2d99815f48fddf693fad8e734bbe820b315f43e7" ||
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
  if (!safePath(source) || !safePath(destination) || existsSync(destination) || realpathSync(source) !== source ||
      realpathSync(path.dirname(destination)) !== path.dirname(destination)) fail("scanner_managed_evidence_invalid");
  const files = [];
  let total = 0;
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(source, file);
      const info = lstatSync(file);
      if (info.isSymbolicLink() || relative.split(path.sep).some((segment) => !/^[A-Za-z0-9_.-]+$/u.test(segment) || [".", ".."].includes(segment))) fail("scanner_managed_evidence_invalid");
      if (info.isDirectory()) { visit(file); continue; }
      if (!info.isFile() || info.nlink !== 1 || info.size > 4 * MiB || !/(?:\.(?:txt|json|xml|tsv|log|toml|patch|properties|sha1|sha256|exit-code)|(?:^|[/._-])(?:LICENSE|PATENTS|NOTICE)|(?:^|\/)go\.(?:mod|sum)|(?:^|\/)[A-Za-z0-9_.-]+\.status)$/u.test(relative.replaceAll(path.sep, "/"))) fail("scanner_managed_evidence_invalid");
      const bytes = readFileSync(file);
      total += bytes.length;
      if (bytes.length !== info.size || total > 64 * MiB || files.length >= 4096 || bytes.includes(0)) fail("scanner_managed_evidence_invalid");
      let text;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail("scanner_managed_evidence_invalid"); }
      if (/(?:gh[oprsu]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|Authorization:\s*(?:Bearer|Basic)\s+\S+)/iu.test(text)) fail("scanner_managed_evidence_invalid");
      files.push({ relative, bytes, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
  };
  visit(source);
  if (!files.length) fail("scanner_managed_evidence_invalid");
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

export async function auditOfficialScanner({ scanner: inputScanner, buildInfo, output, scope = "upstream" }) {
  if (!["upstream", "managed"].includes(scope)) fail("scanner_official_arguments_invalid");
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
    let managed;
    let managedInputs = [];
    if (scope === "managed") {
      managed = validateManagedImageLock((await readBoundedJson(path.join(ROOT, "infra/managed-images/lock.json"), MiB)).value, config);
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
      receipt.managedSources = managedInputs;
      const disk = statfsSync(runnerTemp);
      receipt.managedDisk = { freeBytes: disk.bavail * disk.bsize, requiredFreeBytes: 20 * GiB };
      if (receipt.managedDisk.freeBytes < receipt.managedDisk.requiredFreeBytes) fail("scanner_managed_disk_insufficient");
    }
    const original = await captureFiles([{ path: inputScanner, cap: 512 * MiB }, { path: buildInfo, cap: 8 * MiB }]);
    validateOfficialScannerIdentity(original[0], config.scanner);
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
      ...database.files.map(({ path: file, cap }) => ({ path: file, cap })), ...managedInputs.map(({ path: file, cap }) => ({ path: file, cap }))]);
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
            command(DOCKER, ["buildx", "build", "--platform", "linux/amd64", "--progress", "plain", "--file", path.join(ROOT, candidate.dockerfile),
              "--target", "runtime", "--tag", tag, "--metadata-file", metadataFile, "--load", ROOT], { timeout: 90 * 60_000 });
            const inspectedFile = path.join(output, `managed-${candidate.role}-inspect.json`);
            const inspected = JSON.parse(command(DOCKER, ["image", "inspect", tag], { file: inspectedFile }).toString("utf8"));
            const metadata = (await readBoundedJson(metadataFile, MiB)).value;
            const identity = validateManagedLocalImage(inspected, metadata, tag);
            command(DOCKER, ["image", "save", "--output", archive, tag]); chmodSync(archive, 0o444);
            const frozen = await captureFiles([{ path: archive, cap: 2 * GiB }, { path: metadataFile, cap: MiB }, { path: inspectedFile, cap: MiB }]);
            build.subject = { kind: "LOCAL_MANAGED_IMAGE_V1", ...identity, archiveSha256: frozen[0].sha256, archiveBytes: frozen[0].size, artifactName: `/${path.basename(archive)}` };
            build.result = "passed"; localImages.set(candidate.role, { ...candidate, archive, frozen, subject: build.subject });
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
            if (receipt.commands.at(-1)?.error || cleanupUncertain) throw error;
          }
          await assertFilesUnchanged(inputs);
        }
      });
    }
    await phase("five_image_audits", async () => {
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
          if (local) await assertFilesUnchanged(local.frozen);
          for (const format of ["json", "cyclonedx"]) {
            try { command(DOCKER, local ? officialArchiveScanArguments(carrier, scanner, cache, local.archive, format) : officialImageScanArguments(carrier, scanner, cache, image, format),
              { file: format === "json" ? files.json : files.sbom }); }
            catch (error) { failures.push(error); }
          }
          if (local) await assertFilesUnchanged(local.frozen);
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
            validateOfficialArchiveSbom(report.json, report.sbom, local.subject);
            return evaluateArchiveImageReport(report.json, local.subject, new Date());
          }
          validateOfficialImageSbom(report.json, report.sbom, image);
          return evaluateImageReport(report.json, image, [], new Date(), { expectedScannerVersion: config.scanner.version });
        },
      });
      receipt.reports = collected.reports; receipt.blockers = collected.blockers; receipt.rejections = collected.rejections;
      if (collected.rejections.length) fail("scanner_official_images_blocked");
    });
    if (managed && receipt.builds.some((build) => build.result !== "passed" || build.evidenceExport !== "passed")) fail("scanner_managed_build_incomplete");
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
