import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, existsSync, fchmodSync, fstatSync, fsyncSync, lstatSync,
  mkdirSync, openSync, readFileSync, realpathSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DOCKER = "/usr/bin/docker";
const GIT = "/usr/bin/git";
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/u;
const CONTAINER_ID = /^[0-9a-f]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const MAX_JSON_BYTES = 1024 ** 2;
const LABEL_OWNER = "com.auto-world.postgres-diagnostic";
const LABEL_PURPOSE = "com.auto-world.postgres-diagnostic-purpose";
const PURPOSE = "gosu-correction-runtime";
const SCANNER_ARTIFACT_NAME = "/candidate/saved.tar";
const PGDATA = "/var/lib/postgresql/data";
const EPHEMERAL_PGDATA_TMPFS = `${PGDATA}:rw,nosuid,nodev,noexec,size=16777216,mode=0700`;
const CONTAINER_PROFILE_FORMAT = [
  '{"Name":{{json .Name}},"Labels":{{json .Config.Labels}},',
  '"NetworkMode":{{json .HostConfig.NetworkMode}},"ReadonlyRootfs":{{json .HostConfig.ReadonlyRootfs}},',
  '"RestartPolicyName":{{json .HostConfig.RestartPolicy.Name}},"Memory":{{json .HostConfig.Memory}},',
  '"MemorySwap":{{json .HostConfig.MemorySwap}},"NanoCpus":{{json .HostConfig.NanoCpus}},',
  '"PidsLimit":{{json .HostConfig.PidsLimit}},"ShmSize":{{json .HostConfig.ShmSize}},',
  '"CapDrop":{{json .HostConfig.CapDrop}},"CapAdd":{{json .HostConfig.CapAdd}},',
  '"SecurityOpt":{{json .HostConfig.SecurityOpt}},"PortBindings":{{json .HostConfig.PortBindings}},',
  '"Tmpfs":{{json .HostConfig.Tmpfs}},"Mounts":{{json .Mounts}}}',
].join("");
const OWNERSHIP_FORMATS = Object.freeze({
  container: '{"Id":{{json .Id}},"Labels":{{json .Config.Labels}}}',
  volume: '{"Name":{{json .Name}},"Labels":{{json .Labels}}}',
  image: '{"Id":{{json .Id}},"Labels":{{json .Config.Labels}}}',
});
const BASE = Object.freeze({
  repository: "postgres",
  tag: "17.11-alpine3.24",
  indexDigest: "sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24",
  platformDigest: "sha256:aa90e97ee862e558111d34cfb8b2c4bec768c2b039fb791341686928560263b3",
  configId: "sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537",
  os: "linux",
  architecture: "amd64",
  variant: null,
});
const FIXED_LIMITS = Object.freeze({
  commandOutputBytes: 4 * 1024 ** 2,
  commandTimeoutMs: 120_000,
  buildTimeoutMs: 600_000,
  readinessTimeoutMs: 60_000,
  archiveBytes: 1024 ** 3,
  memoryBytes: 1024 ** 3,
  memorySwapBytes: 1024 ** 3,
  nanoCpus: 1_000_000_000,
  pids: 256,
  shmBytes: 128 * 1024 ** 2,
});
const ALLOWED_CAPABILITIES = Object.freeze(["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETGID", "SETUID"]);
const PAYLOAD = "auto-world-postgres-gosu-diagnostic-v1";
const PAYLOAD_SHA256 = createHash("sha256").update(PAYLOAD).digest("hex");

function fail(code, phase) {
  const error = new Error(code);
  if (phase) error.phase = phase;
  throw error;
}
function plain(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value, expected) {
  return plain(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function parseJson(bytes, code = "postgres_diagnostic_json_invalid") {
  if (!Buffer.isBuffer(bytes) || bytes.length < 2 || bytes.length > MAX_JSON_BYTES) fail(code);
  try { return JSON.parse(bytes.toString("utf8")); } catch { fail(code); }
}

export function parseDiagnosticArguments(argv) {
  if (!Array.isArray(argv) || argv.length !== 2 || argv[0] !== "--output"
    || typeof argv[1] !== "string" || !path.isAbsolute(argv[1]) || path.normalize(argv[1]) !== argv[1]) {
    fail("postgres_diagnostic_arguments_invalid");
  }
  return Object.freeze({ output: argv[1] });
}

export function validateDiagnosticLock(value, dockerfileBytes) {
  if (!exactKeys(value, ["schemaVersion", "state", "authority", "base", "apk", "docker", "recipe", "runtime", "limits"])
    || value.schemaVersion !== 1 || value.state !== "diagnostic_only" || value.authority !== "LOCAL_DIAGNOSTIC"
    || JSON.stringify(value.base) !== JSON.stringify(BASE)
    || !exactKeys(value.docker, ["clientVersion", "serverVersion", "engine", "storageDriver"])
    || value.docker.clientVersion !== "28.0.4" || value.docker.serverVersion !== "28.0.4"
    || value.docker.engine !== "Docker Engine - Community" || value.docker.storageDriver !== "overlay2"
    || !exactKeys(value.recipe, ["path", "sha256"])
    || value.recipe.path !== "infra/postgres-image/Dockerfile" || value.recipe.sha256 !== sha256(dockerfileBytes)
    || !exactKeys(value.runtime, ["postgresUid", "postgresGid", "gosuPath", "removedPath", "payloadSha256"])
    || value.runtime.postgresUid !== 70 || value.runtime.postgresGid !== 70
    || value.runtime.gosuPath !== "/usr/bin/gosu" || value.runtime.removedPath !== "/usr/local/bin/gosu"
    || value.runtime.payloadSha256 !== PAYLOAD_SHA256
    || JSON.stringify(value.limits) !== JSON.stringify(FIXED_LIMITS)
    || !exactKeys(value.apk, ["package", "version", "architecture", "fileName", "sourcePath", "sha256", "size", "sourceUrl",
      "index", "expectedKeys", "apkbuild", "provenance", "executable", "versionOutput"])
    || value.apk.package !== "gosu" || value.apk.version !== "1.19-r5" || value.apk.architecture !== "x86_64"
    || value.apk.fileName !== "gosu-1.19-r5.apk" || value.apk.sourcePath !== "infra/postgres-image/materials/gosu-1.19-r5.apk"
    || value.apk.sha256 !== "cd51335dcbc412f28088452a2407ff13e01dce9e11718feee4beec69cf2ebcad"
    || value.apk.size !== 830337
    || value.apk.sourceUrl !== "https://dl-cdn.alpinelinux.org/alpine/v3.24/community/x86_64/gosu-1.19-r5.apk"
    || !exactKeys(value.apk.index, ["fileName", "sourcePath", "sha256", "size", "sourceUrl"])
    || value.apk.index.fileName !== "APKINDEX.tar.gz"
    || value.apk.index.sourcePath !== "infra/postgres-image/materials/APKINDEX-v3.24-community-x86_64.tar.gz"
    || value.apk.index.sha256 !== "87d288609457bab7c5dd63f13e3ebda73511adfedafebd9226dac4e55f3c69f3"
    || value.apk.index.size !== 2517261
    || value.apk.index.sourceUrl !== "https://dl-cdn.alpinelinux.org/alpine/v3.24/community/x86_64/APKINDEX.tar.gz"
    || JSON.stringify(value.apk.expectedKeys) !== JSON.stringify([{
      name: "alpine-devel@lists.alpinelinux.org-6165ee59.rsa.pub",
      sourcePath: "infra/postgres-image/materials/alpine-devel@lists.alpinelinux.org-6165ee59.rsa.pub",
      sha256: "207e4696d3c05f7cb05966aee557307151f1f00217af4143c1bcaf33b8df733f", size: 800,
    }])
    || JSON.stringify(value.apk.apkbuild) !== JSON.stringify({
      sourcePath: "infra/postgres-image/materials/APKBUILD-1e1aed58b7720fcb6b1859043d543b33019d8c4f",
      commit: "1e1aed58b7720fcb6b1859043d543b33019d8c4f",
      sha256: "e8ebdfafcedf25013b39055c83171936109c9ffb4c0262d8aef4139e0a481192", size: 825,
    })
    || JSON.stringify(value.apk.provenance) !== JSON.stringify({ sourcePath: "infra/postgres-image/materials/provenance.json",
      sha256: "42c2700a73a76ffe44436143474d2edafd2a02d5890d87fff3b33eae5d0af577", size: 2836 })
    || JSON.stringify(value.apk.executable) !== JSON.stringify({ path: "/usr/bin/gosu",
      sha256: "6d3214ab9d2f1e9ffda75ea2f6bb1f454a13a78dd70318e09eee814ce32cce03",
      size: 1977120, mode: "0755", goVersion: "go1.26.8" })
    || value.apk.versionOutput !== "1.19 (go1.26.8 on linux/amd64; gc)") {
    fail("postgres_diagnostic_lock_invalid");
  }
  return Object.freeze(value);
}

export function validateMaterialBytes(bytes, expected) {
  if (!Buffer.isBuffer(bytes) || !plain(expected) || bytes.length !== expected.size || sha256(bytes) !== expected.sha256) {
    fail("postgres_diagnostic_material_invalid");
  }
  return Object.freeze({ bytes: bytes.length, sha256: expected.sha256 });
}

export function dockerBuildArguments(lock, context, tag, nonce) {
  if (!plain(lock) || !path.isAbsolute(context) || path.normalize(context) !== context
    || !/^aw-postgres-gosu:[0-9a-f]{24}$/u.test(tag) || !/^[0-9a-f]{24}$/u.test(nonce)) {
    fail("postgres_diagnostic_build_arguments_invalid");
  }
  return ["build", "--network=none", "--pull=false", "--no-cache", "--progress=plain",
    "--label", `${LABEL_OWNER}=${nonce}`, "--label", `${LABEL_PURPOSE}=${PURPOSE}`,
    "--tag", tag, "--file", path.join(context, "Dockerfile"), context];
}

export function postgresContainerArguments({ name, tag, nonce, volume, envFile }) {
  if (![name, tag, nonce, volume, envFile].every((value) => typeof value === "string")
    || !/^aw-pg-gosu-[0-9a-f]{24}-(?:one|two)$/u.test(name) || !/^aw-postgres-gosu:[0-9a-f]{24}$/u.test(tag)
    || !/^[0-9a-f]{24}$/u.test(nonce) || volume !== `aw-pg-gosu-${nonce}-data`
    || !path.isAbsolute(envFile) || path.normalize(envFile) !== envFile) fail("postgres_diagnostic_container_arguments_invalid");
  return ["create", "--name", name, "--label", `${LABEL_OWNER}=${nonce}`, "--label", `${LABEL_PURPOSE}=${PURPOSE}`,
    "--network", "none", "--read-only", "--restart", "no", "--cap-drop", "ALL",
    ...ALLOWED_CAPABILITIES.flatMap((capability) => ["--cap-add", capability]),
    "--security-opt", "no-new-privileges=true", "--memory", String(FIXED_LIMITS.memoryBytes),
    "--memory-swap", String(FIXED_LIMITS.memorySwapBytes), "--cpus", "1", "--pids-limit", String(FIXED_LIMITS.pids),
    "--shm-size", String(FIXED_LIMITS.shmBytes), "--stop-timeout", "30",
    "--tmpfs", "/var/run/postgresql:rw,nosuid,nodev,noexec,size=16777216,mode=0775",
    "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=67108864,mode=1777",
    "--env-file", envFile, "--mount", `type=volume,src=${volume},dst=${PGDATA}`, tag];
}

export function ephemeralContainerArguments({ name, image, nonce, entrypoint, command = [] }) {
  const match = /^aw-pg-gosu-([0-9a-f]{24})-(probe|base-export|candidate-export)$/u.exec(name);
  const candidateTag = `aw-postgres-gosu:${nonce}`; const baseRef = `${BASE.repository}@${BASE.platformDigest}`;
  if (![name, image, nonce, entrypoint].every((value) => typeof value === "string")
    || !match || match[1] !== nonce || !/^[0-9a-f]{24}$/u.test(nonce)
    || !Array.isArray(command) || command.some((value) => typeof value !== "string" || value.length > 4096)
    || (match?.[2] === "probe" && (image !== candidateTag || entrypoint !== "/bin/sh" || command.length !== 2
      || command[0] !== "-ec"))
    || (match?.[2] === "base-export" && (image !== baseRef || entrypoint !== "/bin/true" || command.length !== 0))
    || (match?.[2] === "candidate-export" && (image !== candidateTag || entrypoint !== "/bin/true" || command.length !== 0))) {
    fail("postgres_diagnostic_ephemeral_arguments_invalid");
  }
  return ["create", "--name", name, "--label", `${LABEL_OWNER}=${nonce}`, "--label", `${LABEL_PURPOSE}=${PURPOSE}`,
    "--network", "none", "--read-only", "--cap-drop", "ALL",
    ...(match[2] === "probe" ? ["--cap-add", "SETGID", "--cap-add", "SETUID"] : []),
    "--security-opt", "no-new-privileges=true",
    "--memory", "134217728", "--memory-swap", "134217728", "--cpus", "0.5", "--pids-limit", "64",
    "--tmpfs", EPHEMERAL_PGDATA_TMPFS, "--entrypoint", entrypoint, image, ...command];
}

export function containerProfileInspectArguments(id) {
  if (typeof id !== "string" || !CONTAINER_ID.test(id)) fail("postgres_diagnostic_container_id_invalid");
  return ["container", "inspect", "--format", CONTAINER_PROFILE_FORMAT, id];
}

function writeExclusive(file, bytes, mode = 0o600) {
  const handle = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try { writeFileSync(handle, bytes); fsyncSync(handle); fchmodSync(handle, mode); } finally { closeSync(handle); }
}
function requirePrivateEmptyDirectory(directory) {
  try {
    const entry = lstatSync(directory); const real = realpathSync(directory);
    const insideRepository = path.relative(ROOT, directory);
    const containsRepository = path.relative(directory, ROOT);
    if (process.platform !== "linux" || process.getuid === undefined || !path.isAbsolute(directory)
      || path.normalize(directory) !== directory || real !== directory || entry.isSymbolicLink() || !entry.isDirectory()
      || entry.uid !== process.getuid() || (entry.mode & 0o777) !== 0o700 || readdirSync(directory).length !== 0
      || insideRepository === "" || (!insideRepository.startsWith(`..${path.sep}`) && insideRepository !== "..")
      || containsRepository === "" || (!containsRepository.startsWith(`..${path.sep}`) && containsRepository !== "..")) {
      fail("postgres_diagnostic_output_invalid");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "postgres_diagnostic_output_invalid") throw error;
    fail("postgres_diagnostic_output_invalid");
  }
}
function fileIdentity(file, cap) {
  let handle;
  try {
    const node = lstatSync(file);
    if (!node.isFile() || node.isSymbolicLink() || node.nlink !== 1 || node.uid !== process.getuid()
      || node.size < 1 || node.size > cap) fail("postgres_diagnostic_output_invalid");
    handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW); fchmodSync(handle, 0o600);
    const descriptor = fstatSync(handle);
    if (descriptor.dev !== node.dev || descriptor.ino !== node.ino || descriptor.size !== node.size
      || descriptor.nlink !== 1 || descriptor.uid !== process.getuid()) fail("postgres_diagnostic_output_invalid");
    const bytes = readFileSync(handle); const after = fstatSync(handle); const final = lstatSync(file);
    if (after.dev !== descriptor.dev || after.ino !== descriptor.ino || after.size !== descriptor.size
      || final.dev !== descriptor.dev || final.ino !== descriptor.ino || final.size !== descriptor.size
      || final.nlink !== 1 || final.isSymbolicLink()) fail("postgres_diagnostic_output_invalid");
    return Object.freeze({ bytes: bytes.length, sha256: sha256(bytes) });
  } catch (error) {
    if (error instanceof Error && error.message === "postgres_diagnostic_output_invalid") throw error;
    fail("postgres_diagnostic_output_invalid");
  } finally { if (handle !== undefined) closeSync(handle); }
}
function actualRunner(command, args, options) {
  return spawnSync(command, args, { cwd: options.cwd, env: options.env, encoding: null,
    timeout: options.timeout, maxBuffer: FIXED_LIMITS.commandOutputBytes, windowsHide: true });
}
function defaultGit(args) {
  const result = spawnSync(GIT, args, { cwd: ROOT, env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" },
    encoding: null, timeout: 30_000, maxBuffer: 4 * MAX_JSON_BYTES });
  if (result.error || result.status !== 0) fail("postgres_diagnostic_repository_invalid");
  return Buffer.from(result.stdout);
}

export function validateCommandResult(result, phase) {
  if (!plain(result) || result.error || result.signal || result.status !== 0
    || !Buffer.isBuffer(result.stdout) || !Buffer.isBuffer(result.stderr)
    || result.stdout.length > FIXED_LIMITS.commandOutputBytes || result.stderr.length > FIXED_LIMITS.commandOutputBytes) {
    fail("postgres_diagnostic_command_failed", phase);
  }
  return result;
}
function validateCommandTransport(result, phase) {
  if (!plain(result) || result.error || result.signal || !Number.isInteger(result.status)
    || !Buffer.isBuffer(result.stdout) || !Buffer.isBuffer(result.stderr)
    || result.stdout.length > FIXED_LIMITS.commandOutputBytes || result.stderr.length > FIXED_LIMITS.commandOutputBytes) {
    fail("postgres_diagnostic_command_failed", phase);
  }
  return result;
}

function repositoryInputs(gitCommand) {
  if (gitCommand(["status", "--porcelain", "--untracked-files=normal"]).toString("utf8").trim() !== "") {
    fail("postgres_diagnostic_repository_invalid");
  }
  const revision = gitCommand(["rev-parse", "HEAD"]).toString("utf8").trim();
  if (!REVISION.test(revision)) fail("postgres_diagnostic_repository_invalid");
  const read = (file) => Buffer.from(gitCommand(["show", `HEAD:${file}`]));
  const dockerfile = read("infra/postgres-image/Dockerfile");
  const lockBytes = read("infra/postgres-image/lock.json");
  if (!dockerfile.equals(readFileSync(path.join(ROOT, "infra/postgres-image/Dockerfile")))
    || !lockBytes.equals(readFileSync(path.join(ROOT, "infra/postgres-image/lock.json")))) {
    fail("postgres_diagnostic_repository_invalid");
  }
  const lock = validateDiagnosticLock(parseJson(lockBytes), dockerfile);
  const materialRecords = [lock.apk, lock.apk.index, ...lock.apk.expectedKeys, lock.apk.apkbuild, lock.apk.provenance];
  const materials = new Map();
  for (const material of materialRecords) {
    const bytes = read(material.sourcePath);
    const working = readFileSync(path.join(ROOT, material.sourcePath));
    if (!bytes.equals(working)) fail("postgres_diagnostic_repository_invalid");
    validateMaterialBytes(bytes, material);
    materials.set(material.sourcePath, bytes);
  }
  return Object.freeze({ revision, dockerfile, lockBytes, lock, materials });
}

function validateDockerVersion(version, info, lock) {
  if (!plain(version) || !plain(info) || version.Client?.Version !== lock.docker.clientVersion
    || version.Server?.Version !== lock.docker.serverVersion || version.Server?.Platform?.Name !== lock.docker.engine
    || info.ServerVersion !== lock.docker.serverVersion || info.Driver !== lock.docker.storageDriver
    || info.OSType !== lock.base.os || info.Architecture !== "x86_64") {
    fail("postgres_diagnostic_docker_invalid");
  }
}
function validateBaseInspect(value, lock) {
  if (!Array.isArray(value) || value.length !== 1) fail("postgres_diagnostic_base_invalid");
  const image = value[0];
  if (image.Id !== lock.base.configId || image.Os !== lock.base.os || image.Architecture !== lock.base.architecture
    || !Array.isArray(image.RepoDigests) || !image.RepoDigests.includes(`${lock.base.repository}@${lock.base.platformDigest}`)
    || !Array.isArray(image.RootFS?.Layers) || image.RootFS.Layers.length < 1) fail("postgres_diagnostic_base_invalid");
  return image;
}
function validateCandidateInspect(value, lock, base, nonce) {
  if (!Array.isArray(value) || value.length !== 1) fail("postgres_diagnostic_candidate_invalid");
  const image = value[0]; const layers = image.RootFS?.Layers;
  if (!IMAGE_ID.test(image.Id) || image.Id === base.Id || image.Os !== lock.base.os || image.Architecture !== lock.base.architecture
    || image.Config?.Labels?.[LABEL_OWNER] !== nonce || image.Config?.Labels?.[LABEL_PURPOSE] !== PURPOSE
    || JSON.stringify(image.Config?.Entrypoint) !== JSON.stringify(base.Config?.Entrypoint)
    || JSON.stringify(image.Config?.Cmd) !== JSON.stringify(base.Config?.Cmd)
    || image.Config?.User !== base.Config?.User || JSON.stringify(image.Config?.ExposedPorts) !== JSON.stringify(base.Config?.ExposedPorts)
    || !Array.isArray(layers) || layers.length <= base.RootFS.Layers.length
    || JSON.stringify(layers.slice(0, base.RootFS.Layers.length)) !== JSON.stringify(base.RootFS.Layers)) {
    fail("postgres_diagnostic_candidate_invalid");
  }
  return image;
}

function commandEnvironment(work) {
  const dockerConfig = path.join(work, "docker-config"); const home = path.join(work, "home");
  mkdirSync(dockerConfig, { mode: 0o700 }); mkdirSync(home, { mode: 0o700 });
  return { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", HOME: home, DOCKER_CONFIG: dockerConfig,
    DOCKER_HOST: "unix:///var/run/docker.sock" };
}
function safeName(nonce, suffix) { return `aw-pg-gosu-${nonce}-${suffix}`; }
function assertNoRuntimeCredentials(environment) {
  if (["GH_TOKEN", "GITHUB_TOKEN", "DOCKER_AUTH_CONFIG"].some((key) => environment[key] !== undefined)) {
    fail("postgres_diagnostic_environment_invalid");
  }
}
function fixedContainerProfile(value, name, nonce, volume) {
  if (!plain(value) || value.Name !== `/${name}` || value.Labels?.[LABEL_OWNER] !== nonce
    || value.Labels?.[LABEL_PURPOSE] !== PURPOSE || value.NetworkMode !== "none"
    || value.ReadonlyRootfs !== true || value.RestartPolicyName !== "no" || value.Memory !== FIXED_LIMITS.memoryBytes
    || value.MemorySwap !== FIXED_LIMITS.memorySwapBytes || value.NanoCpus !== FIXED_LIMITS.nanoCpus
    || value.PidsLimit !== FIXED_LIMITS.pids || value.ShmSize !== FIXED_LIMITS.shmBytes
    || !value.CapDrop?.includes("ALL") || !Array.isArray(value.CapAdd)
    || JSON.stringify([...value.CapAdd].sort()) !== JSON.stringify([...ALLOWED_CAPABILITIES].sort())
    || !value.SecurityOpt?.includes("no-new-privileges=true")
    || (plain(value.PortBindings) && Object.keys(value.PortBindings).length > 0)
    || !value.Mounts?.some((mount) => mount.Type === "volume" && mount.Name === volume
      && mount.Destination === "/var/lib/postgresql/data")) fail("postgres_diagnostic_runtime_profile_invalid");
  return value;
}
function fixedEphemeralProfile(value, name, nonce) {
  const capabilities = name.endsWith("-probe") ? ["SETGID", "SETUID"] : [];
  if (!plain(value) || value.Name !== `/${name}` || value.Labels?.[LABEL_OWNER] !== nonce
    || value.Labels?.[LABEL_PURPOSE] !== PURPOSE || value.NetworkMode !== "none"
    || value.ReadonlyRootfs !== true || value.RestartPolicyName !== "no"
    || value.Memory !== 134217728 || value.MemorySwap !== 134217728
    || value.NanoCpus !== 500000000 || value.PidsLimit !== 64 || !value.CapDrop?.includes("ALL")
    || JSON.stringify([...(value.CapAdd ?? [])].sort()) !== JSON.stringify(capabilities)
    || !value.SecurityOpt?.includes("no-new-privileges=true")
    || value.Tmpfs?.[PGDATA] !== EPHEMERAL_PGDATA_TMPFS.slice(PGDATA.length + 1)
    || Object.keys(value.Tmpfs ?? {}).length !== 1
    || (plain(value.PortBindings) && Object.keys(value.PortBindings).length > 0)
    || value.Mounts?.some((mount) => mount.Type === "volume")) {
    fail("postgres_diagnostic_ephemeral_profile_invalid");
  }
  return value;
}

function parseCreatedId(bytes) {
  const value = bytes.toString("utf8").trim();
  if (!CONTAINER_ID.test(value)) fail("postgres_diagnostic_container_id_invalid");
  return value;
}
function parseProbe(bytes, lock) {
  const text = bytes.toString("utf8").trim();
  const expected = `${lock.apk.versionOutput}\nuid=${lock.runtime.postgresUid}\ngid=${lock.runtime.postgresGid}\npath=${lock.runtime.gosuPath}\nold=absent\npackage=${lock.apk.version}`;
  if (text !== expected) fail("postgres_diagnostic_gosu_probe_invalid");
  return Object.freeze({ version: lock.apk.versionOutput, uid: lock.runtime.postgresUid,
    gid: lock.runtime.postgresGid, path: lock.runtime.gosuPath, removedPath: lock.runtime.removedPath });
}
function parseProcessProbe(bytes, lock) {
  const text = bytes.toString("utf8").trim();
  const match = /^uid=([0-9]+)\ngid=([0-9]+)\nexe=(.+)$/u.exec(text);
  if (!match || Number(match[1]) !== lock.runtime.postgresUid || Number(match[2]) !== lock.runtime.postgresGid
    || !/\/postgres$/u.test(match[3])) fail("postgres_diagnostic_privilege_switch_invalid");
  return Object.freeze({ uid: Number(match[1]), gid: Number(match[2]), executable: match[3] });
}

function sanitizeFailure(error, cleanup, activePhase, completedPhases) {
  const reason = error instanceof Error && /^postgres_diagnostic_[a-z_]+$/u.test(error.message)
    ? error.message : "postgres_diagnostic_failed";
  const failurePhase = typeof error?.phase === "string" ? error.phase : activePhase;
  return Object.freeze({ kind: "POSTGRES_GOSU_DIAGNOSTIC_RECEIPT_V1", state: "INCOMPLETE",
    authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED", supportStartedAt: null,
    vulnerabilityAudit: "NOT_ATTEMPTED", phase: /^[A-Z0-9_]+$/u.test(failurePhase) ? failurePhase : "INPUT",
    reason, cleanup, completedPhases: completedPhases.map(({ name, result, durationMs }) => ({ name, result, durationMs })) });
}

function ownedLabel(value, nonce) { return value?.Labels?.[LABEL_OWNER] === nonce; }
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }
function resourceAbsent(kind, name, result) {
  validateCommandTransport(result, "CLEANUP");
  if (result.status !== 1 || !["", "[]"].includes(result.stdout.toString("utf8").trim())) return false;
  const escaped = escapeRegex(name); const message = result.stderr.toString("utf8").trim();
  if (kind === "container") return new RegExp(`^Error: No such (?:object|container): ${escaped}$`, "u").test(message);
  if (kind === "image") return new RegExp(`^(?:Error: No such object: |Error response from daemon: No such image: )${escaped}$`, "u").test(message);
  return new RegExp(`^Error response from daemon: get ${escaped}: no such volume$`, "u").test(message);
}

export function cleanupOwnedResource(kind, name, expectedId, nonce, invoke) {
  if (!["container", "volume", "image"].includes(kind) || typeof name !== "string" || !/^[0-9a-z_.:-]+$/u.test(name)
    || (expectedId !== null && typeof expectedId !== "string") || !/^[0-9a-f]{24}$/u.test(nonce)
    || typeof invoke !== "function") fail("postgres_diagnostic_cleanup_invalid");
  const inspectArgs = [kind, "inspect", "--format", OWNERSHIP_FORMATS[kind], name];
  const inspected = invoke(inspectArgs, `cleanup_${kind}_inspect`, true);
  if (resourceAbsent(kind, name, inspected)) return "ABSENT";
  if (inspected.status !== 0) fail("postgres_diagnostic_cleanup_inspection_failed");
  const value = parseJson(inspected.stdout, "postgres_diagnostic_cleanup_invalid");
  const actualId = kind === "volume" ? value.Name : value.Id;
  const owned = ownedLabel(value, nonce);
  if (!owned || (expectedId !== null && actualId !== expectedId)) fail("postgres_diagnostic_ownership_uncertain");
  const removeArgs = kind === "container" ? ["container", "rm", "--force", "--volumes", actualId]
    : kind === "volume" ? ["volume", "rm", actualId] : ["image", "rm", actualId];
  validateCommandResult(invoke(removeArgs, `cleanup_${kind}_remove`), `CLEANUP_${kind.toUpperCase()}`);
  return "REMOVED";
}

export async function runPostgresDiagnostic(argv = process.argv.slice(2), dependencies = {}) {
  const args = parseDiagnosticArguments(argv);
  if (process.platform !== "linux" && dependencies.platform !== "linux") fail("postgres_diagnostic_requires_linux");
  if (!plain(dependencies) || Object.keys(dependencies).some((key) => !["runner", "git", "randomBytes", "now", "sleep", "platform"].includes(key))) {
    fail("postgres_diagnostic_dependencies_invalid");
  }
  assertNoRuntimeCredentials(process.env);
  requirePrivateEmptyDirectory(args.output);
  const repository = repositoryInputs(dependencies.git ?? defaultGit);
  const lock = repository.lock;
  const apkBytes = repository.materials.get(lock.apk.sourcePath);
  const indexBytes = repository.materials.get(lock.apk.index.sourcePath);
  const nonce = (dependencies.randomBytes ?? randomBytes)(12).toString("hex");
  if (!/^[0-9a-f]{24}$/u.test(nonce)) fail("postgres_diagnostic_nonce_invalid");
  const now = dependencies.now ?? (() => new Date()); const sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const runner = dependencies.runner ?? actualRunner;
  const logs = path.join(args.output, "logs"); const work = path.join(args.output, "work");
  const materials = path.join(args.output, "materials"); const context = path.join(work, "context");
  mkdirSync(logs, { mode: 0o700 }); mkdirSync(work, { mode: 0o700 }); mkdirSync(materials, { mode: 0o700 });
  mkdirSync(context, { mode: 0o700 });
  const env = commandEnvironment(work); let sequence = 0; let phase = "PREFLIGHT";
  const resources = { containers: new Map(), volume: null, image: null };
  const phases = []; const startedAt = now().toISOString();
  const invoke = (dockerArgs, name, allowFailure = false, timeout = FIXED_LIMITS.commandTimeoutMs) => {
    const result = runner(DOCKER, dockerArgs, { cwd: work, env, timeout });
    sequence += 1; const prefix = `${String(sequence).padStart(3, "0")}-${name}`;
    writeExclusive(path.join(logs, `${prefix}.stdout`), Buffer.from(result.stdout ?? []));
    writeExclusive(path.join(logs, `${prefix}.stderr`), Buffer.from(result.stderr ?? []));
    validateCommandTransport(result, phase);
    if (!allowFailure) validateCommandResult(result, phase);
    return result;
  };
  const record = (name, fn) => {
    phase = name; const started = Date.now(); const value = fn();
    phases.push({ name, result: "PASSED", durationMs: Math.max(0, Date.now() - started) }); return value;
  };
  const requireAbsent = (kind, name) => {
    const inspectArgs = [kind, "inspect", "--format", OWNERSHIP_FORMATS[kind], name];
    const inspected = invoke(inspectArgs, `${name}-absence`, true);
    if (inspected.status === 0) fail("postgres_diagnostic_name_occupied");
    if (!resourceAbsent(kind, name, inspected)) fail("postgres_diagnostic_resource_preflight_failed");
  };
  const cleanup = () => {
    let result = "COMPLETE";
    const attempt = (operation) => { try { operation(); } catch { result = "INCOMPLETE"; } };
    for (const [name, id] of [...resources.containers.entries()].reverse()) {
      attempt(() => cleanupOwnedResource("container", name, id, nonce, invoke));
    }
    if (resources.volume) attempt(() => cleanupOwnedResource("volume", resources.volume.name, resources.volume.name, nonce, invoke));
    if (resources.image) attempt(() => cleanupOwnedResource("image", resources.image.tag, resources.image.id, nonce, invoke));
    for (const [kind, listArgs] of [["container", ["ps", "-aq", "--filter", `label=${LABEL_OWNER}=${nonce}`]],
      ["volume", ["volume", "ls", "-q", "--filter", `label=${LABEL_OWNER}=${nonce}`]],
      ["image", ["image", "ls", "-q", "--filter", `label=${LABEL_OWNER}=${nonce}`]]]) {
      attempt(() => {
        const listed = validateCommandResult(invoke(listArgs, `cleanup_${kind}_inventory`), "CLEANUP");
        if (listed.stdout.toString("utf8").trim() !== "") fail("postgres_diagnostic_cleanup_incomplete");
      });
    }
    return result;
  };
  let envFile;
  try {
    for (const material of [lock.apk, lock.apk.index, ...lock.apk.expectedKeys, lock.apk.apkbuild, lock.apk.provenance]) {
      const destination = path.join(materials, path.basename(material.sourcePath));
      writeExclusive(destination, repository.materials.get(material.sourcePath));
      validateMaterialBytes(readFileSync(destination), material);
    }
    writeExclusive(path.join(context, "Dockerfile"), repository.dockerfile);
    writeExclusive(path.join(context, lock.apk.fileName), apkBytes);
    writeExclusive(path.join(context, lock.apk.index.fileName), indexBytes);

    const { version, info } = record("DOCKER_PREFLIGHT", () => ({
      version: parseJson(validateCommandResult(invoke(["version", "--format", "{{json .}}"], "docker-version")).stdout),
      info: parseJson(validateCommandResult(invoke(["info", "--format", "{{json .}}"], "docker-info")).stdout),
    }));
    validateDockerVersion(version, info, lock);
    const baseRef = `${lock.base.repository}@${lock.base.platformDigest}`;
    const baseInspectResult = record("BASE_IDENTITY", () => validateCommandResult(invoke(["image", "inspect", baseRef], "base-inspect")));
    const base = validateBaseInspect(parseJson(baseInspectResult.stdout), lock);

    const tag = `aw-postgres-gosu:${nonce}`;
    requireAbsent("image", tag);
    resources.image = { tag, id: null };
    record("CANDIDATE_BUILD", () => validateCommandResult(
      invoke(dockerBuildArguments(lock, context, tag, nonce), "candidate-build", false, FIXED_LIMITS.buildTimeoutMs)));
    const candidateResult = record("CANDIDATE_IDENTITY", () => validateCommandResult(invoke(["image", "inspect", tag], "candidate-inspect")));
    const candidate = validateCandidateInspect(parseJson(candidateResult.stdout), lock, base, nonce);
    resources.image = { tag, id: candidate.Id };

    const createOwned = (name, createArgs) => {
      requireAbsent("container", name);
      resources.containers.set(name, null);
      const id = parseCreatedId(validateCommandResult(invoke(createArgs, `${name}-create`)).stdout);
      resources.containers.set(name, id); return id;
    };
    const probeName = safeName(nonce, "probe");
    const probeScript = [
      "test ! -e /usr/local/bin/gosu",
      'test "$(command -v gosu)" = /usr/bin/gosu',
      "version=$(/usr/bin/gosu --version 2>&1); printf '%s\\n' \"$version\"",
      `/usr/bin/gosu postgres /bin/sh -ec 'apk info --quiet -e "gosu=1.19-r5" >/dev/null; printf "uid=%s\\ngid=%s\\npath=%s\\nold=absent\\npackage=1.19-r5\\n" "$(id -u)" "$(id -g)" "$(command -v gosu)"'`,
    ].join("; ");
    const probeId = record("GOSU_PROBE_CREATE", () => createOwned(probeName,
      ephemeralContainerArguments({ name: probeName, image: tag, nonce, entrypoint: "/bin/sh",
        command: ["-ec", probeScript] })));
    record("GOSU_PROBE_PROFILE", () => fixedEphemeralProfile(parseJson(validateCommandResult(
      invoke(containerProfileInspectArguments(probeId), "gosu-probe-inspect")).stdout), probeName, nonce));
    const gosuProbe = record("GOSU_PROBE_RUN", () => parseProbe(
      validateCommandResult(invoke(["start", "--attach", probeId], "gosu-probe-run")).stdout, lock));
    cleanupOwnedResource("container", probeName, probeId, nonce, invoke); resources.containers.delete(probeName);

    const volume = `aw-pg-gosu-${nonce}-data`;
    requireAbsent("volume", volume);
    resources.volume = { name: volume };
    record("VOLUME_CREATE", () => validateCommandResult(invoke(["volume", "create", "--label", `${LABEL_OWNER}=${nonce}`,
      "--label", `${LABEL_PURPOSE}=${PURPOSE}`, volume], "volume-create")));
    envFile = path.join(work, "postgres.env");
    const password = (dependencies.randomBytes ?? randomBytes)(32).toString("hex");
    if (!/^[0-9a-f]{64}$/u.test(password)) fail("postgres_diagnostic_secret_invalid");
    writeExclusive(envFile, Buffer.from(`POSTGRES_PASSWORD=${password}\nPOSTGRES_USER=awdiag\nPOSTGRES_DB=awdiag\n`));

    const waitReady = async (name) => {
      const deadline = Date.now() + FIXED_LIMITS.readinessTimeoutMs;
      while (Date.now() < deadline) {
        const result = invoke(["exec", name, "pg_isready", "--username", "awdiag", "--dbname", "awdiag", "--quiet"], `${name}-ready`, true);
        if (result.status === 0) return;
        await sleep(1000);
      }
      fail("postgres_diagnostic_readiness_timeout", phase);
    };
    const runContainer = async (suffix, write) => {
      const name = safeName(nonce, suffix); const id = createOwned(name,
        postgresContainerArguments({ name, tag, nonce, volume, envFile }));
      phase = `RUNTIME_${suffix.toUpperCase()}_START`;
      validateCommandResult(invoke(["start", id], `${name}-start`), phase);
      const profile = parseJson(validateCommandResult(invoke(containerProfileInspectArguments(id), `${name}-inspect`), phase).stdout);
      fixedContainerProfile(profile, name, nonce, volume);
      await waitReady(name);
      const processScript = "awk '/^Uid:/{print \"uid=\"$2}/^Gid:/{print \"gid=\"$2}' /proc/1/status; printf 'exe='; readlink /proc/1/exe";
      const processProbe = parseProcessProbe(validateCommandResult(
        invoke(["exec", "--user", `${lock.runtime.postgresUid}:${lock.runtime.postgresGid}`,
          name, "/bin/sh", "-ec", processScript], `${name}-process`), phase).stdout, lock);
      if (write) {
        const sql = `CREATE TABLE diagnostic_payload (id integer PRIMARY KEY, payload text NOT NULL); INSERT INTO diagnostic_payload VALUES (1, '${PAYLOAD}');`;
        validateCommandResult(invoke(["exec", name, "psql", "--username", "awdiag", "--dbname", "awdiag", "--no-psqlrc",
          "--set", "ON_ERROR_STOP=1", "--command", sql], `${name}-write`), phase);
      }
      const read = validateCommandResult(invoke(["exec", name, "psql", "--username", "awdiag", "--dbname", "awdiag", "--no-psqlrc",
        "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1", "--command", "SELECT payload FROM diagnostic_payload WHERE id = 1;"],
      `${name}-read`), phase).stdout.toString("utf8").trim();
      if (read !== PAYLOAD) fail("postgres_diagnostic_readback_mismatch", phase);
      validateCommandResult(invoke(["stop", "--time", "30", id], `${name}-stop`), phase);
      cleanupOwnedResource("container", name, id, nonce, invoke); resources.containers.delete(name);
      return processProbe;
    };
    const runProfile = async (name, write) => {
      const phaseName = `RUNTIME_${name.toUpperCase()}`;
      phase = phaseName; const started = Date.now();
      const value = await runContainer(name, write);
      phases.push({ name: phaseName, result: "PASSED", durationMs: Math.max(0, Date.now() - started) });
      return value;
    };
    const firstProcess = await runProfile("one", true);
    const secondProcess = await runProfile("two", false);

    const exportRootfs = (kind, image) => {
      const name = safeName(nonce, `${kind}-export`); const id = createOwned(name,
        ephemeralContainerArguments({ name, image, nonce, entrypoint: "/bin/true" }));
      fixedEphemeralProfile(parseJson(validateCommandResult(
        invoke(containerProfileInspectArguments(id), `${name}-inspect`), phase).stdout), name, nonce);
      const output = path.join(args.output, `${kind}-rootfs.tar`);
      validateCommandResult(invoke(["export", "--output", output, id], `${name}-export`, false, FIXED_LIMITS.buildTimeoutMs), phase);
      const identity = fileIdentity(output, FIXED_LIMITS.archiveBytes);
      cleanupOwnedResource("container", name, id, nonce, invoke); resources.containers.delete(name);
      return identity;
    };
    phase = "EXPORTS";
    const baseRootfs = exportRootfs("base", baseRef);
    const candidateRootfs = exportRootfs("candidate", tag);
    const archiveFile = path.join(args.output, "candidate-image.tar");
    validateCommandResult(invoke(["image", "save", "--output", archiveFile, tag], "candidate-save", false, FIXED_LIMITS.buildTimeoutMs), phase);
    const archive = fileIdentity(archiveFile, FIXED_LIMITS.archiveBytes);
    writeExclusive(path.join(args.output, "base-inspect.json"), baseInspectResult.stdout);
    writeExclusive(path.join(args.output, "candidate-inspect.json"), candidateResult.stdout);
    writeExclusive(path.join(args.output, "diff-ids.json"), Buffer.from(`${JSON.stringify({
      base: base.RootFS.Layers, candidate: candidate.RootFS.Layers,
    }, null, 2)}\n`));
    const cleanupState = cleanup();
    if (cleanupState !== "COMPLETE") fail("postgres_diagnostic_cleanup_incomplete", "CLEANUP");
    if (envFile && existsSync(envFile)) unlinkSync(envFile);
    const receipt = Object.freeze({
      kind: "POSTGRES_GOSU_DIAGNOSTIC_RECEIPT_V1", state: "VERIFIED", authority: "LOCAL_DIAGNOSTIC",
      admission: "NOT_AUTHORIZED", supportStartedAt: null, vulnerabilityAudit: "NOT_ATTEMPTED",
      registryWrite: "NOT_ATTEMPTED", startedAt, completedAt: now().toISOString(),
      recipe: { revision: repository.revision, lockSha256: sha256(repository.lockBytes),
        dockerfileSha256: lock.recipe.sha256 },
      docker: lock.docker, base: lock.base,
      apk: { package: lock.apk.package, version: lock.apk.version, sha256: lock.apk.sha256, bytes: lock.apk.size,
        indexSha256: lock.apk.index.sha256, indexBytes: lock.apk.index.size,
        expectedKeys: lock.apk.expectedKeys, versionOutput: lock.apk.versionOutput,
        verification: { index: "PASSED_DURING_OFFLINE_BUILD", package: "PASSED_DURING_OFFLINE_BUILD" } },
      candidate: { imageId: candidate.Id, diffIds: candidate.RootFS.Layers,
        configDigest: candidate.Id, tag, archive, rootfs: candidateRootfs,
        additionalLabels: { [LABEL_OWNER]: nonce, [LABEL_PURPOSE]: PURPOSE } },
      archiveEvidence: { artifactName: SCANNER_ARTIFACT_NAME, imageId: candidate.Id, archiveSha256: archive.sha256,
        tag, configDigest: candidate.Id, diffIds: candidate.RootFS.Layers },
      baseExport: { imageId: base.Id, diffIds: base.RootFS.Layers, rootfs: baseRootfs },
      runtime: { gosu: gosuProbe, firstProcess, secondProcess, payloadSha256: PAYLOAD_SHA256,
        profiles: 2, cleanup: cleanupState }, phases,
    });
    writeExclusive(path.join(args.output, "receipt.json"), Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`));
    rmSync(work, { recursive: true, force: false });
    return receipt;
  } catch (error) {
    const cleanupState = cleanup();
    if (envFile && existsSync(envFile)) unlinkSync(envFile);
    const receipt = sanitizeFailure(error, cleanupState, phase, phases);
    if (!existsSync(path.join(args.output, "failure-receipt.json"))) {
      writeExclusive(path.join(args.output, "failure-receipt.json"), Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`));
    }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runPostgresDiagnostic().then((receipt) => console.log(JSON.stringify({ state: receipt.state,
    admission: receipt.admission, archiveSha256: receipt.candidate.archive.sha256 })))
    .catch((error) => {
      console.error(JSON.stringify({ state: "INCOMPLETE", admission: "NOT_AUTHORIZED",
        reason: error instanceof Error && /^postgres_diagnostic_[a-z_]+$/u.test(error.message)
          ? error.message : "postgres_diagnostic_failed" }));
      process.exitCode = 1;
    });
}
