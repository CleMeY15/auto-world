import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import {
  loadPostgresAdmissionArchiveContext,
  verifyPostgresAdmissionArchiveFast,
} from "./admission-archive-maintenance.mjs";

const ROOT = "/opt/auto-world/postgres-admission";
const REPOSITORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VERIFIER = "scripts/postgres-image/admission-archive-maintenance.mjs";
const POLICY = "infra/postgres-image/admission-policy.json";
const NODE = "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node";
const NODE_PIN = { size: 124836408, sha256: "3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327" };
const ERROR = "postgres_admission_archive_observation_failed";
const CAP = 1024 ** 2;
const TIMEOUT_MS = 10 * 60 * 1000;
const SHA = /^[a-f0-9]{64}$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function need(value) { if (!value) throw new Error(ERROR); }
function exact(value, keys) {
  need(value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
    && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort()));
  return value;
}
function canonical(value) { return Buffer.from(`${JSON.stringify(value)}\n`, "utf8"); }
function sha(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function parse(bytes) {
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes));
  need(bytes.equals(canonical(value))); return value;
}
function pin(value) {
  exact(value, ["size", "sha256"]); need(Number.isSafeInteger(value.size) && value.size > 0 && SHA.test(value.sha256));
  return value;
}
function native(status) {
  return { dev: String(status.dev), ino: String(status.ino), uid: Number(status.uid), gid: Number(status.gid),
    mode: Number(status.mode & 0o7777n), nlink: Number(status.nlink), size: Number(status.size),
    mtimeNs: String(status.mtimeNs), ctimeNs: String(status.ctimeNs) };
}
function directoryNative(status) {
  const value = native(status); return Object.fromEntries(["dev", "ino", "uid", "gid", "mode"].map(key => [key, value[key]]));
}
function holdDirectories(target, handles) {
  const parts = target.split("/").filter(Boolean); let name = "";
  for (const part of parts) {
    name += `/${part}`;
    const status = fs.lstatSync(name, { bigint: true });
    need(status.isDirectory() && !status.isSymbolicLink() && status.uid === 0n && status.gid === 0n
      && (Number(status.mode) & 0o022) === 0);
    const fd = fs.openSync(name, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_DIRECTORY);
    handles.push({ name, fd, identity: directoryNative(status) });
    need(isDeepStrictEqual(directoryNative(fs.fstatSync(fd, { bigint: true })), directoryNative(status)));
  }
}
function resealDirectories(handles) {
  for (const handle of handles) {
    need(isDeepStrictEqual(directoryNative(fs.fstatSync(handle.fd, { bigint: true })), handle.identity)
      && isDeepStrictEqual(directoryNative(fs.lstatSync(handle.name, { bigint: true })), handle.identity));
  }
}
function readSealed(name, expected, mode, maximum = CAP) {
  const handles = []; let fd;
  try {
    holdDirectories(path.dirname(name), handles);
    const status = fs.lstatSync(name, { bigint: true }), identity = native(status);
    need(status.isFile() && !status.isSymbolicLink() && identity.uid === 0 && identity.gid === 0
      && identity.mode === mode && identity.nlink === 1 && identity.size > 0 && identity.size <= maximum);
    if (expected) { pin(expected); need(identity.size === expected.size); }
    fd = fs.openSync(name, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    need(isDeepStrictEqual(native(fs.fstatSync(fd, { bigint: true })), identity));
    const bytes = Buffer.alloc(identity.size); let offset = 0;
    while (offset < bytes.length) { const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset); need(count > 0); offset += count; }
    need(fs.readSync(fd, Buffer.alloc(1), 0, 1, offset) === 0);
    need(isDeepStrictEqual(native(fs.fstatSync(fd, { bigint: true })), identity)
      && isDeepStrictEqual(native(fs.lstatSync(name, { bigint: true })), identity));
    if (expected) need(sha(bytes) === expected.sha256);
    resealDirectories(handles); return bytes;
  } finally {
    let failed = false;
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { failed = true; } }
    for (const handle of handles.reverse()) { try { fs.closeSync(handle.fd); } catch { failed = true; } }
    need(!failed);
  }
}
function maintenanceInput(generation) {
  const name = `${ROOT}/maintenance-generation-${generation}`;
  const sidecar = readSealed(`${name}.sha256`, null, 0o400, 65).toString("ascii");
  need(/^[a-f0-9]{64}\n$/u.test(sidecar));
  const bytes = readSealed(`${name}.json`, null, 0o400); need(sha(bytes) === sidecar.slice(0, 64));
  const value = parse(bytes);
  exact(value, ["schemaVersion", "kind", "generationRoot", "generationRootSha256", "command", "policy",
    "supportStartedAt", "supportEndsAt", "archiveUntil"]);
  need(value.schemaVersion === 1 && value.kind === "POSTGRES_ADMISSION_ARCHIVE_MAINTENANCE_INPUT_V1"
    && value.generationRoot.admissionGeneration === generation && SHA.test(value.generationRootSha256)
    && sha(canonical(value.generationRoot)) === value.generationRootSha256);
  pin(value.command); pin(value.policy);
  for (const key of ["supportStartedAt", "supportEndsAt", "archiveUntil"]) need(typeof value[key] === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value[key]));
  const command = value.generationRoot.executionFiles.find(item => item.path === VERIFIER);
  need(command && command.size === value.command.size && command.sha256 === value.command.sha256);
  readSealed(path.join(REPOSITORY, VERIFIER), value.command, 0o400);
  readSealed(path.join(REPOSITORY, POLICY), value.policy, 0o400);
  readSealed(NODE, NODE_PIN, 0o755, NODE_PIN.size);
  return value;
}
async function observeVerifier(generation) {
  return new Promise((resolve, reject) => {
    const child = spawn(NODE, ["--disable-proto=throw", path.join(REPOSITORY, VERIFIER), "--generation", String(generation), "--mode", "FULL"],
      { cwd: REPOSITORY, env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", HOME: "/nonexistent" },
        stdio: ["ignore", "pipe", "pipe"] });
    let stdoutEOF = false, stderrEOF = false, stdoutSize = 0, stderrSize = 0, failed = false;
    const stdout = [], stderr = [];
    const stop = () => { failed = true; child.kill("SIGKILL"); };
    const timer = setTimeout(stop, TIMEOUT_MS);
    child.stdout.on("data", bytes => { stdoutSize += bytes.length; if (stdoutSize > CAP) stop(); else stdout.push(bytes); });
    child.stderr.on("data", bytes => { stderrSize += bytes.length; if (stderrSize > 64 * 1024) stop(); else stderr.push(bytes); });
    child.stdout.once("end", () => { stdoutEOF = true; }); child.stderr.once("end", () => { stderrEOF = true; });
    child.stdout.once("error", stop); child.stderr.once("error", stop);
    child.once("error", stop);
    child.once("close", (status, signal) => {
      clearTimeout(timer);
      if (failed || status !== 0 || signal !== null || !stdoutEOF || !stderrEOF || stderrSize !== 0) { reject(new Error(ERROR)); return; }
      try { resolve({ report: parse(Buffer.concat(stdout)), process: { status, signal, closed: true, stdoutEOF, stderrEOF } }); }
      catch { reject(new Error(ERROR)); }
    });
  });
}
function fullReport(value, fast, now) {
  exact(value, ["kind", "state", "scope", "completedAt", "validUntil", "admissionGeneration", "generationRootSha256",
    "archiveLocatorSha256", "executionFilesSha256", "roots", "imageArchive", "claims"]);
  need(value.kind === "POSTGRES_ADMISSION_ARCHIVE_FULL_V1" && value.state === "VERIFIED" && value.scope === "COMPLETE_ARCHIVE_HEALTH");
  for (const key of ["completedAt", "validUntil"]) need(INSTANT.test(value[key]) && new Date(value[key]).toISOString() === value[key]);
  const completed = Date.parse(value.completedAt), until = Date.parse(value.validUntil);
  need(completed <= now && until === completed + 86_400_000 && now < until);
  for (const key of ["admissionGeneration", "generationRootSha256", "archiveLocatorSha256", "executionFilesSha256", "roots", "imageArchive", "claims"])
    need(isDeepStrictEqual(value[key], fast[key]));
  return value;
}
function retain(generation, envelope) {
  const directory = `${ROOT}/archive-health`, target = `${directory}/generation-${generation}.json`;
  const temporary = `${directory}/.generation-${generation}.tmp`;
  const marker = `${directory}/.generation-${generation}.update-intent`, handles = [];
  const markerBytes = canonical({ kind: "POSTGRES_ADMISSION_ARCHIVE_HEALTH_UPDATE_INTENT_V1", admissionGeneration: generation,
    generationRootSha256: envelope.report.generationRootSha256, observedAt: envelope.observedAt });
  let fd, markerFd, commitFd, markerIdentity, directoryIdentity, success = false, retired = false;
  const closeHandles = () => {
    let failed = false;
    for (const handle of handles.splice(0).reverse()) { try { fs.closeSync(handle.fd); } catch { failed = true; } }
    need(!failed);
  };
  const absent = name => { try { fs.lstatSync(name); need(false); } catch (error) { need(error.code === "ENOENT"); } };
  try {
    holdDirectories(directory, handles); directoryIdentity = handles.at(-1).identity;
    need(directoryIdentity.mode === 0o700); absent(marker); absent(temporary);
    let prior = null;
    try {
      const status = fs.lstatSync(target, { bigint: true }); prior = native(status);
      need(status.isFile() && prior.uid === 0 && prior.gid === 0 && prior.mode === 0o600 && prior.nlink === 1);
      const old = parse(readSealed(target, { size: prior.size, sha256: sha(readSealed(target, null, 0o600)) }, 0o600));
      need(old.kind === envelope.kind && old.report.generationRootSha256 === envelope.report.generationRootSha256
        && Date.parse(old.observedAt) < Date.parse(envelope.observedAt)
        && Date.parse(old.report.completedAt) <= Date.parse(envelope.report.completedAt));
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const bytes = canonical(envelope); need(bytes.length <= CAP);
    markerFd = fs.openSync(marker, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    let markerOffset = 0;
    while (markerOffset < markerBytes.length) { const count = fs.writeSync(markerFd, markerBytes, markerOffset, markerBytes.length - markerOffset, markerOffset); need(count > 0); markerOffset += count; }
    fs.fsyncSync(markerFd); markerIdentity = native(fs.fstatSync(markerFd, { bigint: true }));
    need(markerIdentity.uid === 0 && markerIdentity.gid === 0 && markerIdentity.mode === 0o600 && markerIdentity.nlink === 1);
    fs.fsyncSync(handles.at(-1).fd);
    fd = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    const identity = native(fs.fstatSync(fd, { bigint: true })); need(identity.uid === 0 && identity.gid === 0 && identity.mode === 0o600 && identity.nlink === 1);
    let offset = 0;
    while (offset < bytes.length) { const count = fs.writeSync(fd, bytes, offset, bytes.length - offset, offset); need(count > 0); offset += count; }
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    readSealed(temporary, { size: bytes.length, sha256: sha(bytes) }, 0o600); resealDirectories(handles);
    if (prior) need(isDeepStrictEqual(native(fs.lstatSync(target, { bigint: true })), prior));
    else { try { fs.lstatSync(target); need(false); } catch (error) { need(error.code === "ENOENT"); } }
    fs.renameSync(temporary, target); fs.fsyncSync(handles.at(-1).fd);
    need(readSealed(target, { size: bytes.length, sha256: sha(bytes) }, 0o600).equals(bytes)); resealDirectories(handles);
    need(readSealed(marker, { size: markerBytes.length, sha256: sha(markerBytes) }, 0o600).equals(markerBytes));
    fs.closeSync(markerFd); markerFd = undefined; closeHandles();
    need(isDeepStrictEqual(directoryNative(fs.lstatSync(directory, { bigint: true })), directoryIdentity)
      && isDeepStrictEqual(native(fs.lstatSync(marker, { bigint: true })), markerIdentity));
    commitFd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    need(isDeepStrictEqual(directoryNative(fs.fstatSync(commitFd, { bigint: true })), directoryIdentity));
    fs.unlinkSync(marker); retired = true; fs.fsyncSync(commitFd);
    fs.closeSync(commitFd); commitFd = undefined; success = true;
  } finally {
    let failed = false;
    if (fd !== undefined) { try { fs.closeSync(fd); } catch { failed = true; } }
    if (markerFd !== undefined) { try { fs.closeSync(markerFd); } catch { failed = true; } }
    if (commitFd !== undefined) { try { fs.closeSync(commitFd); } catch { failed = true; } }
    try { closeHandles(); } catch { failed = true; }
    if ((!success || failed) && retired) {
      // Quarantine an uncertain final retirement; a new authority rejects this fixed marker.
      let quarantineFd, quarantineParent;
      try {
        need(isDeepStrictEqual(directoryNative(fs.lstatSync(directory, { bigint: true })), directoryIdentity));
        quarantineFd = fs.openSync(marker, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
        let offset = 0;
        while (offset < markerBytes.length) { const count = fs.writeSync(quarantineFd, markerBytes, offset, markerBytes.length - offset, offset); need(count > 0); offset += count; }
        fs.fsyncSync(quarantineFd);
        quarantineParent = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
        need(isDeepStrictEqual(directoryNative(fs.fstatSync(quarantineParent, { bigint: true })), directoryIdentity));
        fs.fsyncSync(quarantineParent);
      } finally {
        let uncertain = false;
        for (const descriptor of [quarantineFd, quarantineParent]) if (descriptor !== undefined) {
          try { fs.closeSync(descriptor); } catch { uncertain = true; }
        }
        need(!uncertain);
      }
    }
    need(success && !failed);
  }
}

export async function retainPostgresAdmissionArchiveObservation() {
  need(arguments.length === 0 && process.platform === "linux" && process.getuid?.() === 0 && process.getgid?.() === 0);
  need(process.argv.length === 4 && process.argv[2] === "--generation" && /^[1-9][0-9]{0,9}$/u.test(process.argv[3]));
  const generation = Number(process.argv[3]); need(Number.isSafeInteger(generation));
  const input = maintenanceInput(generation), context = loadPostgresAdmissionArchiveContext(input.generationRoot);
  const fast = verifyPostgresAdmissionArchiveFast(context), observation = await observeVerifier(generation);
  const observedAt = new Date().toISOString();
  const after = verifyPostgresAdmissionArchiveFast(loadPostgresAdmissionArchiveContext(input.generationRoot));
  need(isDeepStrictEqual(after, fast)); fullReport(observation.report, after, Date.parse(observedAt));
  const envelope = { kind: "POSTGRES_ADMISSION_ARCHIVE_HEALTH_ENVELOPE_V1", state: "VERIFIED", observedAt,
    report: observation.report, process: observation.process, command: input.command, policy: input.policy };
  retain(generation, envelope);
  return Object.freeze({ kind: "POSTGRES_ADMISSION_ARCHIVE_OBSERVATION_RESULT_V1", state: "RETAINED",
    admissionGeneration: generation, completedAt: observation.report.completedAt, validUntil: observation.report.validUntil,
    generationRootSha256: observation.report.generationRootSha256, archiveLocatorSha256: observation.report.archiveLocatorSha256 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(canonical(await retainPostgresAdmissionArchiveObservation())); }
  catch { process.stderr.write(`${ERROR}\n`); process.exitCode = 1; }
}
