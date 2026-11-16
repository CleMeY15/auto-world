import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync,
  readSync, rmSync, writeSync,
} from "node:fs";

import {
  SCANNER_RETENTION, canonicalJsonBytes, sha256, validateScannerRetentionPublisherReceiptBytes,
} from "./retention-policy.mjs";

const NODE = "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node";
const DOCKER = "/usr/bin/docker";
const ROOT_PREFIX = "/var/tmp/auto-world-scanner-retention-copy-";
const ENVELOPE_CAP = SCANNER_RETENTION.publisher.receiptCapBytes * 2 + 8192;
const OUTPUT_CAP = 1024 ** 2;
const HEX40 = /^[a-f0-9]{40}$/u;
const HEX64 = /^[a-f0-9]{64}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;

function fail(code) { throw new Error(`scanner_retention_copy_linux_${code}`); }

function exact(value, keys, code) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).join("\0") !== keys.join("\0")) fail(code);
}

export function validateScannerRetentionPublisherObservation(value) {
  exact(value, ["runId", "runAttempt", "runNumber", "headSha", "headTree", "artifactId", "artifactName",
    "artifactDigest", "artifactBytes", "receiptBytes", "receiptSha256"], "publisher_observation_invalid");
  if (typeof value.runId !== "string" || !RUN_ID.test(value.runId) || value.runAttempt !== 1 || value.runNumber !== 1
    || typeof value.headSha !== "string" || !HEX40.test(value.headSha)
    || typeof value.headTree !== "string" || !HEX40.test(value.headTree)
    || !Number.isSafeInteger(value.artifactId) || value.artifactId < 1
    || value.artifactName !== `${SCANNER_RETENTION.publisher.artifactNamePrefix}${value.runId}-1`
    || typeof value.artifactDigest !== "string" || !DIGEST.test(value.artifactDigest)
    || !Number.isSafeInteger(value.artifactBytes) || value.artifactBytes < 1 || value.artifactBytes > 1024 ** 2
    || !Number.isSafeInteger(value.receiptBytes) || value.receiptBytes < 1
    || value.receiptBytes > SCANNER_RETENTION.publisher.receiptCapBytes
    || typeof value.receiptSha256 !== "string" || !HEX64.test(value.receiptSha256)) {
    fail("publisher_observation_invalid");
  }
  return Object.freeze({ ...value });
}

function readBoundedStdin() {
  const chunks = []; let total = 0;
  while (true) {
    const chunk = Buffer.allocUnsafe(Math.min(65536, ENVELOPE_CAP + 1 - total));
    const count = readSync(0, chunk, 0, chunk.length, null);
    if (count === 0) break;
    total += count;
    if (total > ENVELOPE_CAP) fail("envelope_limit");
    chunks.push(chunk.subarray(0, count));
  }
  return Buffer.concat(chunks, total);
}

function parseEnvelope(bytes, observation = SCANNER_RETENTION.observations.publisher) {
  const accepted = validateScannerRetentionPublisherObservation(observation);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { fail("envelope_invalid"); }
  if (!canonicalJsonBytes(value, ENVELOPE_CAP).equals(bytes)) fail("envelope_invalid");
  exact(value, ["schemaVersion", "token", "identity", "artifact", "receipt"], "envelope_invalid");
  exact(value.identity, ["headSha", "headTree", "runId"], "envelope_invalid");
  exact(value.artifact, ["id", "name", "digest"], "envelope_invalid");
  if (value.schemaVersion !== 1 || typeof value.token !== "string" || value.token.length < 1
    || value.token.length > 4096 || /[^\x21-\x7e]/u.test(value.token)
    || value.identity.headSha !== accepted.headSha || value.identity.headTree !== accepted.headTree
    || value.identity.runId !== accepted.runId || value.artifact.id !== accepted.artifactId
    || value.artifact.name !== accepted.artifactName || value.artifact.digest !== accepted.artifactDigest
    || typeof value.receipt !== "string") fail("envelope_invalid");
  const receiptBytes = Buffer.from(value.receipt, "base64");
  if (receiptBytes.toString("base64") !== value.receipt || receiptBytes.length !== accepted.receiptBytes
    || sha256(receiptBytes) !== accepted.receiptSha256) fail("receipt_identity");
  const receipt = validateScannerRetentionPublisherReceiptBytes(receiptBytes, value.identity);
  return Object.freeze({ token: value.token, receipt, subject: `${SCANNER_RETENTION.package}@${receipt.ghcrManifestDigest}` });
}

function childEnvironment(root, dockerConfig) {
  return Object.freeze({ HOME: root, TMPDIR: root, DOCKER_CONFIG: dockerConfig, LANG: "C.UTF-8", LC_ALL: "C.UTF-8",
    TZ: "UTC", PATH: "/usr/bin:/bin" });
}

function command(args, { input = Buffer.alloc(0), env, cap = OUTPUT_CAP, accept = [0] } = {}) {
  const result = spawnSync(DOCKER, args, { input, env, encoding: null, maxBuffer: cap, windowsHide: true,
    shell: false, timeout: SCANNER_RETENTION.local.operationTimeoutMs });
  if (result.error || result.signal !== null || !accept.includes(result.status)
    || !Buffer.isBuffer(result.stdout) || !Buffer.isBuffer(result.stderr)
    || result.stdout.length > cap || result.stderr.length > cap) fail("docker_command");
  return result;
}

function hashFile(file, expected) {
  const info = lstatSync(file); const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== 0 || opened.dev !== info.dev
      || opened.ino !== info.ino || opened.size !== expected.bytes) fail("staged_identity");
    const hash = createHash("sha256"); const buffer = Buffer.allocUnsafe(1024 ** 2); let total = 0;
    while (total < expected.bytes) {
      const count = readSync(descriptor, buffer, 0, Math.min(buffer.length, expected.bytes - total), null);
      if (count < 1) fail("staged_identity");
      hash.update(buffer.subarray(0, count)); total += count;
    }
    if (readSync(descriptor, buffer, 0, 1, null) !== 0 || hash.digest("hex") !== expected.sha256) fail("staged_identity");
  } finally { closeSync(descriptor); }
}

function emitFile(file, expected) {
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.allocUnsafe(1024 ** 2); let total = 0; const hash = createHash("sha256");
    while (total < expected.bytes) {
      const count = readSync(descriptor, buffer, 0, Math.min(buffer.length, expected.bytes - total), null);
      if (count < 1) fail("staged_changed");
      let offset = 0;
      while (offset < count) { const written = writeSync(1, buffer, offset, count - offset); if (written < 1) fail("stdout"); offset += written; }
      hash.update(buffer.subarray(0, count)); total += count;
    }
    if (readSync(descriptor, buffer, 0, 1, null) !== 0 || hash.digest("hex") !== expected.sha256) fail("staged_changed");
  } finally { closeSync(descriptor); }
}

export function scannerRetentionLinuxCreateArguments(name, subject) {
  if (!/^aw-scanner-retention-copy-[a-f0-9]{16}$/u.test(name)
    || !subject.startsWith(`${SCANNER_RETENTION.package}@sha256:`)
    || !DIGEST.test(subject.slice(SCANNER_RETENTION.package.length + 1))) fail("container_identity");
  // The scratch image intentionally has no default command; this command is never started.
  return ["create", "--name", name, "--network", "none", "--read-only", "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges=true", "--pull", "never", subject,
    SCANNER_RETENTION.publisher.contextPayloadPath];
}

export function scannerRetentionLinuxCopyPlan(envelopeBytes, observation = SCANNER_RETENTION.observations.publisher) {
  const parsed = parseEnvelope(envelopeBytes, observation);
  return Object.freeze({ subject: parsed.subject, innerTar: parsed.receipt.innerTar,
    contextPayloadPath: SCANNER_RETENTION.publisher.contextPayloadPath });
}

export function runScannerRetentionLinuxCopy(envelopeBytes = readBoundedStdin()) {
  if (process.platform !== "linux" || process.getuid() !== 0 || process.execPath !== NODE || process.version !== "v22.23.2") {
    fail("host_invalid");
  }
  const parsed = parseEnvelope(envelopeBytes); let root; let container; let pulled = false; let environment;
  try {
    root = mkdtempSync(ROOT_PREFIX); chmodSync(root, 0o700);
    const dockerConfig = `${root}/docker-config`; mkdirSync(dockerConfig, { mode: 0o700 }); environment = childEnvironment(root, dockerConfig);
    const version = command(["version", "--format", "{{json .}}"], { env: environment });
    let versions; try { versions = JSON.parse(version.stdout.toString("utf8")); } catch { fail("docker_version"); }
    if (versions?.Client?.Version !== "28.0.4" || versions?.Server?.Version !== "28.0.4") fail("docker_version");
    const before = command(["image", "inspect", parsed.subject], { env: environment, accept: [0, 1] });
    if (before.status === 0) fail("preexisting_image");
    command(["login", "ghcr.io", "--username", "CleMeY15", "--password-stdin"],
      { input: Buffer.from(`${parsed.token}\n`, "utf8"), env: environment });
    command(["pull", "--platform", "linux/amd64", parsed.subject], { env: environment, cap: 4 * 1024 ** 2 }); pulled = true;
    const image = command(["image", "inspect", parsed.subject, "--format", "{{json .}}"], { env: environment });
    let imageValue; try { imageValue = JSON.parse(image.stdout.toString("utf8")); } catch { fail("image_identity"); }
    if (imageValue?.Os !== "linux" || imageValue?.Architecture !== "amd64"
      || !Array.isArray(imageValue?.RepoDigests) || !imageValue.RepoDigests.includes(parsed.subject)
      || imageValue?.Id !== parsed.receipt.oci.config.digest) {
      fail("image_identity");
    }
    const name = `aw-scanner-retention-copy-${randomBytes(8).toString("hex")}`;
    const created = command(scannerRetentionLinuxCreateArguments(name, parsed.subject), { env: environment });
    container = created.stdout.toString("utf8").trim();
    if (!HEX64.test(container)) fail("container_identity");
    const state = command(["container", "inspect", container, "--format", "{{json .State}}"], { env: environment });
    let stateValue; try { stateValue = JSON.parse(state.stdout.toString("utf8")); } catch { fail("container_state"); }
    if (stateValue?.Status !== "created" || stateValue?.Running !== false || stateValue?.StartedAt !== "0001-01-01T00:00:00Z") {
      fail("container_state");
    }
    const staged = `${root}/scanner-closure.tar`;
    command(["cp", `${container}:${SCANNER_RETENTION.publisher.contextPayloadPath}`, staged], { env: environment });
    hashFile(staged, parsed.receipt.innerTar);
    emitFile(staged, parsed.receipt.innerTar);
    command(["container", "rm", container], { env: environment }); container = undefined;
    command(["image", "rm", parsed.subject], { env: environment }); pulled = false;
    command(["logout", "ghcr.io"], { env: environment });
    rmSync(root, { recursive: true, force: false }); root = undefined;
  } finally {
    let uncertain = false;
    if (environment && container) { try { command(["container", "rm", "--force", container], { env: environment }); } catch { uncertain = true; } }
    if (environment && pulled) { try { command(["image", "rm", parsed.subject], { env: environment }); } catch { uncertain = true; } }
    if (root) { try { rmSync(root, { recursive: true, force: false }); } catch { uncertain = true; } }
    if (uncertain) fail("cleanup_uncertain");
  }
}

const direct = process.argv[1] && new URL(import.meta.url).pathname === process.argv[1].replaceAll("\\", "/");
if (direct) {
  try { runScannerRetentionLinuxCopy(); } catch (error) {
    process.stderr.write(`${/^scanner_retention_copy_linux_/u.test(error?.message ?? "") ? error.message : "scanner_retention_copy_linux_failed"}\n`);
    process.exitCode = 1;
  }
}
