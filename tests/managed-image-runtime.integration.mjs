import { constants } from "node:fs";
import fs from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { run } from "../scripts/data-infra/runtime.mjs";
import { sqlText } from "../scripts/data-infra/migrations.mjs";
import { conditionalRawWrite, digestBytes, rawKey } from "../scripts/data-infra/raw-protocol.mjs";
import { validateTarArchive } from "../scripts/data-infra/backup.mjs";
import { removeOwnedHelper } from "../scripts/data-infra/helper-cleanup.mjs";
import { operationSignal, protectedRecovery, withCancellation } from "../scripts/data-infra/cancellation.mjs";

// Only the direct, explicitly gated Linux invocation registers tests. Importing
// this module for pure contract tests never starts Docker or registers a test.
export const CASE_NAMES = Object.freeze(["start-and-refusal", "sql-raw-index", "restart-persistence", "cold-canonical-restore"]);
const ROLES = ["postgres", "opensearch", "redis", "seaweedfs", "aws-cli"];
const SERVICES = ["postgres", "opensearch", "redis", "object-store"];
const ROLE = { postgres: "postgres", opensearch: "opensearch", redis: "redis", "object-store": "seaweedfs" };
const DATA = { postgres: "/var/lib/postgresql/data", opensearch: "/usr/share/opensearch/data", redis: "/data", "object-store": "/data" };
const PORT = { postgres: 5432, opensearch: 9200, redis: 6379, "object-store": 8333 };
const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const MiB = 1024 ** 2;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const matches = (expression, value) => typeof value === "string" && expression.test(value);
const RAW = Buffer.from('{"synthetic":true,"vehicle":"runtime-001"}\n');
const INDEX = "aw-managed-runtime";
const IDENTITY = ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeNs", "ctimeNs"];
const ensure = (condition) => { if (!condition) throw new Error("failed"); };
const keys = (value, expected) => value !== null && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
const safePath = (value) => typeof value === "string" && path.isAbsolute(value) && path.resolve(value) === value && !/[\0,\r\n]/u.test(value);
const inside = (parent, file) => { const relative = path.relative(parent, file); return relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative); };
const sameIdentity = (left, right) => IDENTITY.every((field) => left[field] === right[field]);

function proof(value, cap) {
  ensure(keys(value, ["path", "size", "sha256"]) && safePath(value.path) && Number.isSafeInteger(value.size) && value.size > 0 && value.size <= cap && matches(HASH, value.sha256));
}

export function validateRuntimeInput(value, expectedRun) {
  ensure(keys(value, ["schemaVersion", "run", "ownerToken", "sourceInputs", "roles"]) && value.schemaVersion === 1 && matches(UUID, value.ownerToken));
  ensure(keys(value.run, ["sourceCommit", "runId", "attempt"]) && matches(/^[a-f0-9]{40}$/u, value.run.sourceCommit) &&
    matches(/^[1-9][0-9]{0,23}$/u, value.run.runId) && matches(/^[1-9][0-9]{0,7}$/u, value.run.attempt) && isDeepStrictEqual(value.run, expectedRun));
  ensure(Array.isArray(value.sourceInputs) && value.sourceInputs.length > 0 && value.sourceInputs.length <= 512);
  for (const file of value.sourceInputs) proof(file, MiB);
  ensure(Array.isArray(value.roles) && value.roles.length === 5 && new Set(value.roles.map((item) => item?.role)).size === 5);
  for (const item of value.roles) {
    ensure(keys(item, ["role", "imageId", "platform", "subject", "reports", "evidence"]) && ROLES.includes(item.role) && matches(DIGEST, item.imageId) && item.platform === "linux/amd64");
    ensure(keys(item.reports, ["json", "sbom"]));
    proof(item.reports.json, 64 * MiB); proof(item.reports.sbom, 64 * MiB);
    ensure(Array.isArray(item.evidence) && item.evidence.length <= 512);
    for (const file of item.evidence) proof(file, 4 * MiB);
    const subject = item.subject;
    if (["postgres", "opensearch", "aws-cli"].includes(item.role)) {
      ensure(item.evidence.length > 0 && keys(subject, ["kind", "imageId", "os", "architecture", "archiveSha256", "archiveBytes", "archiveCapBytes", "artifactName"]) &&
        subject.kind === "LOCAL_MANAGED_IMAGE_V1" && subject.imageId === item.imageId && subject.os === "linux" && subject.architecture === "amd64" &&
        matches(HASH, subject.archiveSha256) && Number.isSafeInteger(subject.archiveBytes) && subject.archiveBytes > 0 &&
        subject.archiveCapBytes === (item.role === "opensearch" ? 4 : 2) * 1024 ** 3 && subject.archiveBytes <= subject.archiveCapBytes && subject.artifactName === `/managed-image-${item.role}.tar`);
    } else {
      ensure(keys(subject, ["kind", "repository", "manifestDigest", "platform"]) && subject.kind === "UPSTREAM_REGISTRY_SUBJECT" &&
        subject.repository === (item.role === "redis" ? "library/redis" : "chrislusf/seaweedfs") && matches(DIGEST, subject.manifestDigest) &&
        keys(subject.platform, ["os", "architecture", "variant", "digest"]) && subject.platform.os === "linux" && subject.platform.architecture === "amd64" &&
        subject.platform.variant === null && matches(DIGEST, subject.platform.digest));
    }
  }
  return value;
}

export function createRuntimeCompose(input, project, directory, credentials, options = {}) {
  validateRuntimeInput(input, input.run);
  ensure(matches(/^aw-test-[a-f0-9-]{36}$/u, project) && matches(UUID, project.slice(8)) && safePath(directory));
  ensure(keys(credentials, ["postgres", "redis", "s3Access", "s3Secret"]) && Object.values(credentials).every((value) => matches(HASH, value)));
  ensure(keys(options, []) || keys(options, ["restore"]));
  const restore = Object.hasOwn(options, "restore") ? options.restore : false;
  ensure(typeof restore === "boolean");
  const images = Object.fromEntries(input.roles.map((item) => [item.role, item.imageId]));
  const labels = { "io.auto-world.owner": input.ownerToken };
  const services = Object.fromEntries(SERVICES.map((service) => [service, {
    image: images[ROLE[service]], platform: "linux/amd64", pull_policy: "never", container_name: `${project}-${service}`,
    tty: false, stdin_open: false, restart: "unless-stopped", labels, networks: ["foundation"],
    volumes: [{ type: "volume", source: `${service}-data`, target: DATA[service], volume: { nocopy: restore || service === "object-store" } }],
    ports: [{ target: PORT[service], host_ip: "127.0.0.1", protocol: "tcp" }],
    logging: { driver: "none" },
  }]));
  Object.assign(services.postgres, {
    environment: { POSTGRES_USER: "aw_bootstrap", POSTGRES_PASSWORD: credentials.postgres, POSTGRES_DB: "autoworld",
      POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale=C --auth-host=scram-sha-256 --auth-local=scram-sha-256", POSTGRES_HOST_AUTH_METHOD: "scram-sha-256" },
    command: ["postgres", "-c", "password_encryption=scram-sha-256"], cpus: 1, mem_limit: "768m", pids_limit: 512, stop_grace_period: "30s",
  });
  Object.assign(services.opensearch, { environment: { OPENSEARCH_JAVA_OPTS: "-Xms512m -Xmx512m" },
    cpus: 1.5, mem_limit: "2g", pids_limit: 1024, stop_grace_period: "60s",
    ulimits: { memlock: { soft: -1, hard: -1 }, nofile: { soft: 65536, hard: 65536 } } });
  Object.assign(services.redis, { environment: { REDISCLI_AUTH: credentials.redis },
    command: ["redis-server", "--appendonly", "yes", "--appendfsync", "everysec", "--requirepass", credentials.redis],
    cpus: 0.5, mem_limit: "256m", pids_limit: 256, stop_grace_period: "30s" });
  Object.assign(services["object-store"], { entrypoint: ["/bin/sh", "/run/aw/bootstrap.sh"],
    tmpfs: ["/run/aw-private:rw,noexec,nosuid,size=1m,mode=0700"],
    command: ["server", "-dir=/data", "-master.telemetry=false", "-s3", "-s3.port=8333", "-s3.port.iceberg=0", "-s3.port.lance=0", "-s3.config=/run/aw-private/s3.json"],
    cpus: 0.75, mem_limit: "768m", pids_limit: 512, stop_grace_period: "30s" });
  services["object-store"].volumes.push(
    { type: "bind", source: path.join(directory, "s3.json"), target: "/run/aw-input/s3.json", read_only: true },
    { type: "bind", source: path.join(directory, "object-store-init.sh"), target: "/run/aw/bootstrap.sh", read_only: true });
  return { services, volumes: Object.fromEntries(SERVICES.map((service) => [`${service}-data`, { name: `${project}_${service}-data`, labels }])),
    networks: { foundation: { name: `${project}_foundation`, driver: "bridge", internal: false,
      driver_opts: { "com.docker.network.bridge.host_binding_ipv4": "127.0.0.1" }, labels } } };
}

async function readVerified(file, cap, expected, capture = false) {
  ensure(safePath(file) && await fs.realpath(file) === file);
  const initial = await fs.lstat(file, { bigint: true });
  ensure(initial.isFile() && initial.nlink === 1n && initial.uid === BigInt(process.getuid()) && initial.size > 0n && initial.size <= BigInt(cap));
  if (expected) ensure(initial.size === BigInt(expected.size) && (!expected.identity || sameIdentity(initial, expected.identity)));
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    ensure(sameIdentity(initial, await handle.stat({ bigint: true })));
    const hash = createHash("sha256"), buffer = Buffer.alloc(MiB), chunks = [];
    let size = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, size);
      if (!bytesRead) break;
      size += bytesRead; ensure(size <= cap && BigInt(size) <= initial.size);
      hash.update(buffer.subarray(0, bytesRead));
      if (capture) chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    const sha256 = hash.digest("hex");
    ensure(BigInt(size) === initial.size && sameIdentity(initial, await handle.stat({ bigint: true })) && sameIdentity(initial, await fs.lstat(file, { bigint: true })));
    if (expected) ensure(size === expected.size && sha256 === expected.sha256 && (!expected.identity || sameIdentity(initial, expected.identity)));
    return { path: file, size, sha256, identity: initial, ...(capture ? { bytes: Buffer.concat(chunks) } : {}) };
  } finally { await handle.close(); }
}

async function initialize() {
  ensure(process.platform === "linux" && process.getuid() !== 0 && constants.O_NOFOLLOW && constants.O_NONBLOCK &&
    process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_ENVIRONMENT === "github-hosted");
  const inputFile = process.env.AW_MANAGED_RUNTIME_INPUT, hash = process.env.AW_MANAGED_RUNTIME_INPUT_SHA256;
  ensure(safePath(inputFile) && path.basename(inputFile) === "runtime-input.json" && matches(HASH, hash) && safePath(process.env.RUNNER_TEMP));
  const parent = path.dirname(inputFile), parentInfo = await fs.lstat(parent, { bigint: true });
  ensure(await fs.realpath(parent) === parent && inside(await fs.realpath(process.env.RUNNER_TEMP), inputFile) && parentInfo.isDirectory() &&
    parentInfo.uid === BigInt(process.getuid()) && (parentInfo.mode & 0o777n) === 0o700n);
  const inputProof = await readVerified(inputFile, MiB, null, true);
  ensure(inputProof.sha256 === hash && (inputProof.identity.mode & 0o777n) === 0o600n);
  const input = validateRuntimeInput(JSON.parse(inputProof.bytes.toString("utf8")), {
    sourceCommit: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
  });
  await fs.access(path.join(parent, "runtime-result.json")).then(() => { throw new Error("failed"); }, (error) => ensure(error.code === "ENOENT"));
  const context = { input, inputProof, parent, parentInfo, deadline: Date.now() + 20 * 60_000, cleanupDeadline: null,
    blocked: false, references: [], directories: new Map(), files: new Map(), projects: [], helpers: new Set(), imageSnapshots: new Map(),
    credentials: Object.fromEntries(["postgres", "redis", "s3Access", "s3Secret"].map((name) => [name, randomBytes(32).toString("hex")])) };
  const references = new Map();
  const sources = new Set(input.sourceInputs.map((item) => item.path));
  for (const item of [...input.sourceInputs, ...input.roles.flatMap((role) => [role.reports.json, role.reports.sbom, ...role.evidence])]) {
    const previous = references.get(item.path);
    ensure(!previous || previous.sha256 === item.sha256 && previous.size === item.size);
    ensure(sources.has(item.path) ? ["infra", "scripts", "tests"].some((directory) => inside(path.join(ROOT, directory), item.path)) : inside(process.env.RUNNER_TEMP, item.path));
    references.set(item.path, item);
  }
  for (const item of references.values()) context.references.push(await readVerified(item.path, 64 * MiB, item));
  const bootstrap = context.references.find((item) => item.path === path.join(ROOT, "infra/object-store-init.sh"));
  ensure(bootstrap);
  context.bootstrap = (await readVerified(bootstrap.path, MiB, bootstrap, true)).bytes;
  for (const item of input.roles) {
    const json = JSON.parse((await readVerified(item.reports.json.path, 64 * MiB, item.reports.json, true)).bytes.toString("utf8"));
    const sbom = JSON.parse((await readVerified(item.reports.sbom.path, 64 * MiB, item.reports.sbom, true)).bytes.toString("utf8"));
    ensure(json.Metadata?.ImageID === item.imageId && json.Metadata.ImageConfig?.os === "linux" && json.Metadata.ImageConfig.architecture === "amd64" &&
      sbom.bomFormat === "CycloneDX" && sbom.metadata?.component?.name === json.ArtifactName);
    ensure(item.subject.kind === "LOCAL_MANAGED_IMAGE_V1" ? json.ArtifactName === item.subject.artifactName :
      [item.subject.manifestDigest, item.subject.platform.digest].some((digest) => json.ArtifactName === `${item.subject.repository}@${digest}`));
  }
  context.environment = Object.fromEntries(["PATH", "HOME", "TMPDIR", "DOCKER_CONFIG", "TZ", "LANG", "LC_ALL"].flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]]));
  context.directory = await fs.mkdtemp(path.join(parent, "runtime-")); await fs.chmod(context.directory, 0o700);
  context.directories.set(context.directory, await fs.lstat(context.directory, { bigint: true }));
  return context;
}

function remaining(context, requested = 15_000) {
  const time = (context.cleanupDeadline ?? Math.min(context.deadline, context.phaseDeadline ?? Infinity)) - Date.now(); ensure(time > 0);
  return Math.min(requested, time, 20 * 60_000);
}

async function docker(context, args, { timeoutMs = 15_000, env = {}, input } = {}) {
  ensure(!context.blocked);
  try { return await run("/usr/bin/docker", args, { timeoutMs: remaining(context, timeoutMs), env: { ...context.environment, ...env }, input }); }
  catch (error) { if (error?.code === "process_termination_unverified") context.blocked = true; }
  // CLI diagnostics can contain private data; retain only the closure state.
  throw new Error("failed");
}

async function checked(context, args, options) { const result = await docker(context, args, options); ensure(result.code === 0); return result.stdout.trim(); }
async function inspected(context, type, name) { const values = JSON.parse(await checked(context, [type, "inspect", name])); ensure(values.length === 1); return values[0]; }
async function verifyReferences(context) {
  await readVerified(context.inputProof.path, MiB, context.inputProof);
  for (const item of context.references) await readVerified(item.path, 64 * MiB, item);
}
async function verifyImages(context) {
  for (const item of context.input.roles) {
    const image = await inspected(context, "image", item.imageId);
    ensure(image.Id === item.imageId && image.Os === "linux" && image.Architecture === "amd64");
    if (item.subject.kind === "UPSTREAM_REGISTRY_SUBJECT") ensure(image.RepoDigests?.some((digest) => digest.endsWith(`@${item.subject.platform.digest}`)));
    const signature = JSON.stringify([image.Id, image.Os, image.Architecture, image.Config]);
    ensure(!context.imageSnapshots.has(item.role) || context.imageSnapshots.get(item.role) === signature);
    context.imageSnapshots.set(item.role, signature);
  }
}

async function privateFile(context, file, bytes, mode = 0o600) {
  ensure(inside(context.directory, file) && !context.files.has(file));
  await fs.writeFile(file, bytes, { flag: "wx", mode });
  context.files.set(file, await fs.lstat(file, { bigint: true }));
}
async function stablePrivateFile(context, file, contentMayChange = false) {
  const expected = context.files.get(file), actual = await fs.lstat(file, { bigint: true });
  ensure(expected && actual.isFile() && actual.nlink === 1n && ["dev", "ino", "uid", "gid", "mode"].every((field) => actual[field] === expected[field]) &&
    (contentMayChange || sameIdentity(expected, actual)) && await fs.realpath(file) === file);
  return actual;
}
async function scopedList(context, type, filter) { return (await checked(context, [type, "ls", ...(type === "container" ? ["-aq"] : ["--format", "{{.Name}}"]), "--filter", filter])).split(/\s+/u).filter(Boolean); }

async function createProject(context, restore = false) {
  const project = `aw-test-${randomUUID()}`, directory = path.join(context.directory, project);
  await fs.mkdir(directory, { mode: 0o700 }); context.directories.set(directory, await fs.lstat(directory, { bigint: true }));
  const value = { project, directory, restore, containers: new Map(), volumes: new Map(), network: null };
  context.projects.push(value);
  for (const service of SERVICES) {
    ensure(!(await scopedList(context, "container", `name=^/${project}-${service}$`)).length);
    ensure(!(await scopedList(context, "volume", `name=^${project}_${service}-data$`)).length);
  }
  ensure(!(await scopedList(context, "network", `name=^${project}_foundation$`)).length);
  await privateFile(context, path.join(directory, "object-store-init.sh"), context.bootstrap, 0o400);
  ensure(digestBytes(await fs.readFile(path.join(directory, "object-store-init.sh"))) === digestBytes(context.bootstrap));
  await privateFile(context, path.join(directory, "s3.json"), JSON.stringify({ identities: [{ name: "managed-runtime", credentials: [{ accessKey: context.credentials.s3Access,
    secretKey: context.credentials.s3Secret }], actions: ["Admin:aw-raw", "Read:aw-raw", "List:aw-raw", "Write:aw-raw"] }] }));
  await privateFile(context, path.join(directory, "compose.json"), JSON.stringify(createRuntimeCompose(context.input, project, directory, context.credentials, { restore })));
  await compose(context, value, ["create", "--no-build"]);
  await verifyProject(context, value, true);
  return value;
}

async function compose(context, project, args, timeoutMs = 120_000) {
  await stablePrivateFile(context, path.join(project.directory, "compose.json"));
  return checked(context, ["compose", "--project-name", project.project, "--project-directory", project.directory, "--file", path.join(project.directory, "compose.json"), ...args], { timeoutMs });
}

export async function containerSignature(context, project, service, value, stopped = false) {
    const expectedImage = context.input.roles.find((item) => item.role === ROLE[service]).imageId;
    ensure(value.Config?.Labels?.["io.auto-world.owner"] === context.input.ownerToken && value.Config.Labels["com.docker.compose.project"] === project.project &&
      value.Config.Labels["com.docker.compose.service"] === service && value.Name === `/${project.project}-${service}` &&
      value.Image === expectedImage && value.Config.Tty === false && value.Config.OpenStdin === false && value.HostConfig?.Privileged === false &&
      value.HostConfig.NetworkMode === `${project.project}_foundation` && (!stopped || ["created", "exited"].includes(value.State?.Status)));
    const expected = [{ Type: "volume", Name: `${project.project}_${service}-data`, Destination: DATA[service], RW: true }];
    if (service === "object-store") for (const [file, destination] of [["s3.json", "/run/aw-input/s3.json"], ["object-store-init.sh", "/run/aw/bootstrap.sh"]]) {
      await stablePrivateFile(context, path.join(project.directory, file));
      expected.push({ Type: "bind", Source: path.join(project.directory, file), Destination: destination, RW: false });
    }
    const mounts = value.Mounts.filter((mount) => mount.Type !== "tmpfs");
    ensure(mounts.length === expected.length && expected.every((item) => mounts.some((mount) => Object.entries(item).every(([key, content]) => mount[key] === content))));
    ensure(value.Mounts.every((mount) => mount.Type !== "tmpfs" || service === "object-store" && mount.Destination === "/run/aw-private"));
    // Compose v2.38.2 uses Binds for ordinary copy-up volumes, and Mounts for
    // NoCopy volumes. Validate every declaration against its effective mount.
    const declarations = [], hostMounts = value.HostConfig.Mounts ?? [], hostBinds = value.HostConfig.Binds ?? [];
    const noCopy = project.restore || service === "object-store";
    ensure(Array.isArray(hostMounts) && Array.isArray(hostBinds));
    for (const mount of hostMounts) {
      const match = expected.find((item) => item.Type === mount?.Type && item.Destination === mount.Target);
      ensure(match && mount.Source === (match.Type === "volume" ? match.Name : match.Source) &&
        (match.RW ? mount.ReadOnly === undefined || mount.ReadOnly === false : mount.ReadOnly === true));
      if (match.Type === "volume") ensure(noCopy ? mount.VolumeOptions?.NoCopy === true :
        mount.VolumeOptions?.NoCopy === undefined || mount.VolumeOptions.NoCopy === false);
      ensure(mount.VolumeOptions?.Subpath === undefined || mount.VolumeOptions.Subpath === "");
      declarations.push(match.Destination);
    }
    for (const bind of hostBinds) {
      ensure(typeof bind === "string");
      const match = expected.find((item) => (item.Type !== "volume" || !noCopy) &&
        bind === `${item.Type === "volume" ? item.Name : item.Source}:${item.Destination}:${item.RW ? "rw" : "ro"}`);
      ensure(match); declarations.push(match.Destination);
    }
    ensure(declarations.length === expected.length && new Set(declarations).size === expected.length);
    return JSON.stringify([value.Id, value.Image, mounts.sort((left, right) => left.Destination.localeCompare(right.Destination))]);
}

async function verifyProject(context, project, stopped = false) {
  const labelsMatch = (labels) => labels?.["io.auto-world.owner"] === context.input.ownerToken && labels["com.docker.compose.project"] === project.project;
  for (const service of SERVICES) {
    const value = await inspected(context, "container", `${project.project}-${service}`);
    const signature = await containerSignature(context, project, service, value, stopped);
    ensure(!project.containers.has(service) || project.containers.get(service).signature === signature);
    project.containers.set(service, { id: value.Id, signature, state: value.State.Status });
    const volume = await inspected(context, "volume", `${project.project}_${service}-data`);
    ensure(volume.Name === `${project.project}_${service}-data` && labelsMatch(volume.Labels) && volume.Driver === "local" && volume.Scope === "local");
    const volumeSignature = JSON.stringify(volume);
    ensure(!project.volumes.has(service) || project.volumes.get(service) === volumeSignature); project.volumes.set(service, volumeSignature);
  }
  const network = await inspected(context, "network", `${project.project}_foundation`);
  ensure(labelsMatch(network.Labels) && network.Driver === "bridge" && network.Internal === false && network.Options?.["com.docker.network.bridge.host_binding_ipv4"] === "127.0.0.1");
  ensure(!project.network || project.network === network.Id); project.network = network.Id;
  ensure(Object.keys(network.Containers ?? {}).every((id) => [...project.containers.values()].some((item) => item.id === id)));
}

async function sql(context, project, query) {
  return checked(context, ["exec", "--env", "PGPASSWORD", project.containers.get("postgres").id, "psql", "-X", "-A", "-t", "-q", "--host=127.0.0.1",
    "--username=aw_bootstrap", "--dbname=autoworld", "--set=ON_ERROR_STOP=1", "--set=VERBOSITY=sqlstate", "--command", query], { env: { PGPASSWORD: context.credentials.postgres } });
}
async function redis(context, project, ...args) { return checked(context, ["exec", project.containers.get("redis").id, "redis-cli", "--raw", ...args]); }
async function endpoint(context, project, service) {
  const value = await inspected(context, "container", project.containers.get(service).id), bindings = value.NetworkSettings.Ports[`${PORT[service]}/tcp`];
  ensure(Array.isArray(bindings) && bindings.length === 1 && bindings[0].HostIp === "127.0.0.1" && /^[1-9][0-9]{0,4}$/u.test(bindings[0].HostPort));
  return `http://127.0.0.1:${bindings[0].HostPort}`;
}
async function request(context, project, service, route, method = "GET", body) {
  const signal = operationSignal(), timeout = globalThis.AbortSignal.timeout(remaining(context));
  const response = await globalThis.fetch(`${await endpoint(context, project, service)}${route}`, { method, headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: signal ? globalThis.AbortSignal.any([signal, timeout]) : timeout });
  const chunks = []; let size = 0;
  if (response.body) {
    const reader = response.body.getReader();
    try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; ensure(size <= MiB); chunks.push(Buffer.from(chunk.value)); } }
    finally { await reader.cancel(); reader.releaseLock(); }
  }
  return { status: response.status, bytes: Buffer.concat(chunks) };
}
async function search(context, project, route, method = "GET", body) {
  const response = await request(context, project, "opensearch", route, method, body); ensure(response.status >= 200 && response.status < 300);
  return JSON.parse(response.bytes.toString("utf8"));
}
async function identityProcesses(context, project) {
  for (const [service, uid, processName] of [["postgres", 70, "postgres"], ["opensearch", 1000, "java"], ["object-store", 1000, null]]) {
    const status = await checked(context, ["exec", project.containers.get(service).id, "cat", "/proc/1/status"]);
    for (const field of ["Uid", "Gid"]) ensure(new RegExp(`^${field}:\\s+${uid}\\s+${uid}\\s+${uid}\\s+${uid}\\s*$`, "mu").test(status));
    if (processName) ensure(new RegExp(`^Name:\\s+${processName}\\s*$`, "mu").test(status));
    const ownership = await checked(context, ["exec", project.containers.get(service).id, "stat", "-c", "%u:%g", DATA[service]]);
    ensure(ownership === `${uid}:${uid}`);
  }
}
async function start(context, project) {
  context.phaseDeadline = Math.min(context.deadline, Date.now() + 5 * 60_000);
  try {
    await compose(context, project, ["start"]);
    for (;;) {
      try {
        ensure(await sql(context, project, "SELECT 1;") === "1" && await redis(context, project, "PING") === "PONG");
        ensure(["green", "yellow"].includes((await search(context, project, "/_cluster/health")).status));
        const ready = await request(context, project, "object-store", "/aw-raw", "HEAD"); ensure([200, 401, 403, 404].includes(ready.status));
        break;
      } catch { ensure(!context.blocked && Date.now() < context.phaseDeadline && !operationSignal()?.aborted); await delay(500); }
    }
    await verifyProject(context, project); await identityProcesses(context, project);
  } finally { context.phaseDeadline = null; }
}

async function helper(context, imageId, args, { network = "none", capabilities = [], mounts = [], env = {}, root = false, entrypoint, timeoutMs = 15_000 } = {}) {
  const name = `aw-helper-${randomUUID()}`; context.helpers.add(name);
  const command = ["run", "--rm", "--pull=never", "--name", name, "--label", `io.auto-world.owner=${context.input.ownerToken}`, "--platform", "linux/amd64",
    "--network", network, "--read-only", "--user", root ? "0:0" : `${process.getuid()}:${process.getgid()}`, "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--memory", "256m", "--memory-swap", "256m", "--cpus", "0.5", "--pids-limit", "128", "--log-driver", "none", "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=16m",
    "--ulimit", root ? "fsize=2147483648:2147483648" : "fsize=2097152:2097152", ...capabilities.flatMap((value) => ["--cap-add", value]), ...mounts.flatMap((value) => ["--mount", value]),
    ...Object.keys(env).flatMap((value) => ["--env", value])];
  if (root) command.push("--tmpfs", "/usr/share/opensearch/data:rw,nosuid,nodev,noexec,size=1m");
  if (entrypoint) command.push("--entrypoint", entrypoint);
  try { return await docker(context, [...command, imageId, ...args], { timeoutMs: root ? 120_000 : timeoutMs, env }); }
  finally {
    await protectedRecovery(async () => {
      await removeOwnedHelper(name, context.input.ownerToken, { runProcess: (_executable, values, options) => docker(context, values, options) });
      context.helpers.delete(name);
    });
  }
}

async function s3(context, project, operation, key, bytes, wrongKey = false, timeoutMs = 15_000) {
  const directory = path.join(context.directory, `s3-${randomUUID()}`);
  await fs.mkdir(directory, { mode: 0o700 }); context.directories.set(directory, await fs.lstat(directory, { bigint: true }));
  const input = path.join(directory, "input.bin"), output = path.join(directory, "output.bin");
  await privateFile(context, input, bytes ?? Buffer.alloc(0)); await privateFile(context, output, Buffer.alloc(0));
  const args = ["--endpoint-url", "http://object-store:8333", "--no-cli-pager", "--no-cli-auto-prompt", "--cli-connect-timeout", "3", "--cli-read-timeout", "5", "s3api", operation, "--bucket", "aw-raw"];
  if (key) args.push("--key", key);
  if (operation === "put-object") args.push("--if-none-match", "*", "--body", "/work/input.bin");
  if (operation === "get-object") args.push("/work/output.bin");
  const result = await helper(context, context.input.roles.find((item) => item.role === "aws-cli").imageId, args, {
    network: `${project.project}_foundation`, timeoutMs, mounts: [`type=bind,src=${input},dst=/work/input.bin,readonly`, `type=bind,src=${output},dst=/work/output.bin`],
    env: { AWS_ACCESS_KEY_ID: wrongKey ? "0".repeat(64) : context.credentials.s3Access, AWS_SECRET_ACCESS_KEY: context.credentials.s3Secret,
      AWS_DEFAULT_REGION: "us-east-1", AWS_EC2_METADATA_DISABLED: "true", AWS_REQUEST_CHECKSUM_CALCULATION: "WHEN_REQUIRED", AWS_RESPONSE_CHECKSUM_VALIDATION: "WHEN_REQUIRED" },
  });
  await stablePrivateFile(context, input); await stablePrivateFile(context, output, true);
  if (wrongKey) { ensure(result.code !== 0 && /\((?:InvalidAccessKeyId|SignatureDoesNotMatch|AccessDenied)\)/u.test(result.stderr)); return; }
  if (operation === "put-object" && result.code !== 0) {
    if (/\(PreconditionFailed\)|\(412\)/u.test(result.stderr)) return "precondition412";
    if (/\(ConditionalRequestConflict\)|\(409\)/u.test(result.stderr)) return "conflict409";
  }
  ensure(result.code === 0);
  if (operation === "put-object") return "created";
  if (operation === "get-object") { const value = await fs.readFile(output); ensure(value.length <= MiB); return value; }
}

async function marker(context, project) {
  const value = JSON.parse(await sql(context, project, "SELECT document::text FROM managed_runtime_marker WHERE id='vehicle-1';"));
  ensure(keys(value, ["marker", "raw_key", "sha256", "raw_payload"]) && value.marker === "runtime-001" && value.raw_key === context.key &&
    value.sha256 === digestBytes(RAW) && value.raw_payload === RAW.toString("utf8")); return value;
}
async function verifyStored(context, project) {
  const value = await marker(context, project); ensure(digestBytes(await s3(context, project, "get-object", value.raw_key)) === value.sha256); return value;
}
async function indexDocument(context, project, value) {
  await search(context, project, `/${INDEX}`, "PUT", { mappings: { properties: { marker: { type: "keyword" }, raw_key: { type: "keyword" }, sha256: { type: "keyword" }, raw_payload: { type: "keyword" } } } });
  await search(context, project, `/${INDEX}/_doc/vehicle-1?refresh=true`, "PUT", value);
}
async function verifySearch(context, project, expected) {
  const result = await search(context, project, `/${INDEX}/_search?q=marker:runtime-001&size=10&track_total_hits=true`);
  ensure(result.hits?.total?.value === 1 && result.hits.total.relation === "eq" && result.hits.hits?.length === 1 &&
    result.hits.hits[0]._id === "vehicle-1" && isDeepStrictEqual(result.hits.hits[0]._source, expected));
}

async function coldWriters(context, project) {
  await verifyProject(context, project, true);
  for (const service of SERVICES) {
    const holders = await scopedList(context, "container", `volume=${project.project}_${service}-data`);
    ensure(holders.length === 1 && project.containers.get(service).id.startsWith(holders[0]));
  }
}
async function archiveHelper(context, args, mounts, capabilities) {
  const result = await helper(context, context.input.roles.find((item) => item.role === "opensearch").imageId,
    ["-euo", "pipefail", "-c", args], { root: true, entrypoint: "/bin/bash", mounts, capabilities }); ensure(result.code === 0);
}
async function emptyVolume(context, project, service) {
  await archiveHelper(context, 'shopt -s nullglob dotglob; entries=(/target/*); test "${#entries[@]}" -eq 0',
    [`type=volume,src=${project.project}_${service}-data,dst=/target,readonly,volume-nocopy`], ["DAC_OVERRIDE"]);
}
async function restoreCanonical(context) {
  await compose(context, context.source, ["stop", "--timeout", "60"]); await coldWriters(context, context.source);
  const archives = new Map();
  for (const service of ["postgres", "object-store"]) {
    await coldWriters(context, context.source);
    const file = path.join(context.directory, `${service}.tar`); await privateFile(context, file, Buffer.alloc(0));
    await archiveHelper(context, "tar --format=ustar --numeric-owner -C /source -cf /archive.tar .",
      [`type=volume,src=${context.source.project}_${service}-data,dst=/source,readonly,volume-nocopy`, `type=bind,src=${file},dst=/archive.tar`], ["DAC_OVERRIDE"]);
    await stablePrivateFile(context, file, true); await fs.chmod(file, 0o400); context.files.set(file, await fs.lstat(file, { bigint: true }));
    const identity = await readVerified(file, 2 * 1024 ** 3); await validateTarArchive(file, { deadlineAt: context.deadline });
    await readVerified(file, 2 * 1024 ** 3, identity); archives.set(service, identity);
  }
  context.target = await createProject(context, true); await coldWriters(context, context.target);
  for (const service of SERVICES) await emptyVolume(context, context.target, service);
  await coldWriters(context, context.target);
  await archiveHelper(context, 'shopt -s nullglob dotglob; entries=(/target/*); test "${#entries[@]}" -eq 0; chown 1000:1000 /target; test "$(stat -c %u:%g /target)" = 1000:1000',
    [`type=volume,src=${context.target.project}_opensearch-data,dst=/target,volume-nocopy`], ["CHOWN"]);
  for (const [service, archive] of archives) {
    await coldWriters(context, context.source); await coldWriters(context, context.target); await readVerified(archive.path, 2 * 1024 ** 3, archive);
    await validateTarArchive(archive.path, { deadlineAt: context.deadline });
    await archiveHelper(context, "tar --numeric-owner --same-owner --same-permissions --delay-directory-restore -C /target -xf /archive.tar",
      [`type=volume,src=${context.target.project}_${service}-data,dst=/target,volume-nocopy`, `type=bind,src=${archive.path},dst=/archive.tar,readonly`], ["DAC_OVERRIDE", "CHOWN", "FOWNER"]);
    await readVerified(archive.path, 2 * 1024 ** 3, archive);
  }
  for (const [service, uid] of [["postgres", 70], ["object-store", 1000]]) {
    await archiveHelper(context, `test "$(stat -c %u:%g /target)" = ${uid}:${uid}`,
      [`type=volume,src=${context.target.project}_${service}-data,dst=/target,readonly,volume-nocopy`], ["DAC_OVERRIDE"]);
  }
  await start(context, context.target);
  const absent = await request(context, context.target, "opensearch", `/${INDEX}`); ensure(absent.status === 404);
  ensure(await redis(context, context.target, "EXISTS", "managed-runtime") === "0");
  const restored = await verifyStored(context, context.target); await indexDocument(context, context.target, restored); await verifySearch(context, context.target, restored);
  ensure(await redis(context, context.target, "SET", "managed-runtime", restored.sha256) === "OK");
}

const CASES = [
  async (context) => {
    await verifyImages(context); context.source = await createProject(context); await start(context, context.source);
    const version = await helper(context, context.input.roles.find((item) => item.role === "aws-cli").imageId, ["--version"]);
    ensure(version.code === 0 && /^aws-cli\/2\.38\.5\s/u.test(version.stdout));
    await s3(context, context.source, "create-bucket");
    const key = rawKey("src_runtime", `run_${randomUUID()}`, "raw_start");
    ensure(await s3(context, context.source, "put-object", key, RAW) === "created" && digestBytes(await s3(context, context.source, "get-object", key)) === digestBytes(RAW));
    await s3(context, context.source, "get-object", key, undefined, true);
    const unsigned = await request(context, context.source, "object-store", `/aw-raw/${key}`); ensure([401, 403].includes(unsigned.status));
  },
  async (context) => {
    await verifyProject(context, context.source); context.key = rawKey("src_runtime", `run_${randomUUID()}`, "raw_record");
    for (const status of ["created", "replay"]) {
      const result = await conditionalRawWrite({ bytes: RAW, put: (time) => s3(context, context.source, "put-object", context.key, RAW, false, time),
        get: (time) => s3(context, context.source, "get-object", context.key, undefined, false, time) });
      ensure(result.status === status && result.sha256 === digestBytes(RAW));
    }
    const value = { marker: "runtime-001", raw_key: context.key, sha256: digestBytes(RAW), raw_payload: RAW.toString("utf8") };
    await sql(context, context.source, `CREATE TABLE managed_runtime_marker(id text PRIMARY KEY, document jsonb NOT NULL); INSERT INTO managed_runtime_marker VALUES ('vehicle-1',${sqlText(JSON.stringify(value))}::jsonb);`);
    const stored = await verifyStored(context, context.source); await indexDocument(context, context.source, stored); await verifySearch(context, context.source, stored);
    ensure(await redis(context, context.source, "SET", "managed-runtime", stored.sha256) === "OK");
  },
  async (context) => {
    await verifyProject(context, context.source); await compose(context, context.source, ["stop", "--timeout", "60"]); await coldWriters(context, context.source);
    await start(context, context.source); const stored = await verifyStored(context, context.source); await verifySearch(context, context.source, stored);
    ensure(await redis(context, context.source, "GET", "managed-runtime") === stored.sha256);
  },
  restoreCanonical,
];

async function cleanup(context) {
  context.cleanupDeadline = Date.now() + 120_000;
  let failed = false;
  for (const name of context.helpers) {
    try { await removeOwnedHelper(name, context.input.ownerToken, { runProcess: (_executable, args, options) => docker(context, args, options) }); }
    catch { failed = true; }
  }
  for (const project of [...context.projects].reverse()) {
    try {
      // A partially failed create is discovered only through its four exact names.
      for (const service of SERVICES) {
        const names = await scopedList(context, "container", `name=^/${project.project}-${service}$`);
        if (!names.length) continue;
        ensure(names.length === 1);
        const value = await inspected(context, "container", names[0]);
        const signature = await containerSignature(context, project, service, value);
        ensure(!project.containers.has(service) || signature === project.containers.get(service).signature);
        await checked(context, ["container", "rm", "--force", value.Id]);
        ensure(!(await scopedList(context, "container", `name=^/${project.project}-${service}$`)).length);
      }
      for (const service of SERVICES) {
        const name = `${project.project}_${service}-data`, found = await scopedList(context, "volume", `name=^${name}$`);
        if (!found.length) continue;
        ensure(found.length === 1 && found[0] === name && !(await scopedList(context, "container", `volume=${name}`)).length);
        const value = await inspected(context, "volume", name);
        ensure(value.Name === name && value.Labels?.["io.auto-world.owner"] === context.input.ownerToken && value.Labels["com.docker.compose.project"] === project.project &&
          value.Driver === "local" && value.Scope === "local" && (!project.volumes.has(service) || project.volumes.get(service) === JSON.stringify(value)));
        await checked(context, ["volume", "rm", name]); ensure(!(await scopedList(context, "volume", `name=^${name}$`)).length);
      }
      const name = `${project.project}_foundation`, found = await scopedList(context, "network", `name=^${name}$`);
      if (found.length) {
        ensure(found.length === 1 && found[0] === name); const value = await inspected(context, "network", name);
        ensure(value.Labels?.["io.auto-world.owner"] === context.input.ownerToken && value.Labels["com.docker.compose.project"] === project.project &&
          (!project.network || value.Id === project.network) && Object.keys(value.Containers ?? {}).length === 0);
        await checked(context, ["network", "rm", value.Id]); ensure(!(await scopedList(context, "network", `name=^${name}$`)).length);
      }
    } catch { failed = true; }
  }
  if (!failed) {
    try {
      for (const [directory, identity] of [...context.directories].reverse()) {
        const current = await fs.lstat(directory, { bigint: true }); ensure(current.isDirectory() && current.dev === identity.dev && current.ino === identity.ino && current.uid === identity.uid && (current.mode & 0o777n) === 0o700n);
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          const file = path.join(directory, entry.name); ensure(entry.isFile() && context.files.has(file));
          await stablePrivateFile(context, file, true); await fs.unlink(file); context.files.delete(file);
        }
        await fs.rmdir(directory);
      }
    } catch { failed = true; }
  }
  ensure(!failed && !context.blocked);
}

async function main() {
  const cases = CASE_NAMES.map((name) => ({ name, status: "not_run", code: "not_run" }));
  let context, failed = false, cleanupResult = "failed";
  await withCancellation(async () => {
    try {
      for (let index = 0; index < CASE_NAMES.length; index++) {
        await test(CASE_NAMES[index], async () => {
          if (failed) throw new Error("not_run");
          try {
            if (!context) context = await initialize();
            ensure(!operationSignal()?.aborted); await verifyReferences(context); await verifyImages(context);
            await CASES[index](context); await verifyImages(context); await verifyReferences(context);
            cases[index] = { name: CASE_NAMES[index], status: "passed", code: "verified" };
          } catch { failed = true; cases[index] = { name: CASE_NAMES[index], status: "failed", code: "failed" }; throw new Error("failed"); }
        });
      }
    } finally {
      if (context) {
        await protectedRecovery(async () => { try { await cleanup(context); cleanupResult = "passed"; } catch { process.exitCode = 1; } });
        const current = await fs.lstat(context.parent, { bigint: true });
        ensure(current.isDirectory() && current.dev === context.parentInfo.dev && current.ino === context.parentInfo.ino && current.uid === context.parentInfo.uid && (current.mode & 0o777n) === 0o700n);
        const result = { schemaVersion: 1, run: context.input.run, roles: ROLES.map((role) => ({ role, imageId: context.input.roles.find((item) => item.role === role).imageId })), cases, cleanup: { result: cleanupResult } };
        await fs.writeFile(path.join(context.parent, "runtime-result.json"), `${JSON.stringify(result)}\n`, { flag: "wx", mode: 0o600 });
      }
    }
  }, { processExit: true });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch(() => { process.stderr.write("failed\n"); process.exitCode = 1; });
}
