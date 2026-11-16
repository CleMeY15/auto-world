import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import { streamGitHubArtifactZip } from "../seaweed-image/download-artifact-zip.mjs";
import { githubArtifactZipProfiles, scanGitHubArtifactZip } from "../seaweed-image/read-artifact-zip.mjs";
import {
  SCANNER_RETENTION, canonicalJsonBytes, createScannerRetentionSidecar, sha256,
  validateScannerRetentionPublisherReceiptBytes,
} from "./retention-policy.mjs";
import { validateScannerRetentionPublisherObservation } from "./retention-copy-linux.mjs";
import {
  assertScannerRetentionLocalCapacity, assertScannerRetentionLocalTools, pipeScannerRetentionLocalCommands,
  restoreScannerRetentionCopy, runScannerRetentionLocalCommand, scannerRetentionHelperCommand,
  validateScannerRetentionPairProof,
} from "./retention-restore.mjs";

const API = `https://api.github.com/repos/${SCANNER_RETENTION.repository}`;
const WSL = "C:\\Windows\\System32\\wsl.exe";
const LINUX_NODE = "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node";
const LINUX_SCRIPT = "/mnt/c/Users/Administrator/Documents/ChatGPT/Auto-world/scripts/scanner/retention-copy-linux.mjs";
const RESPONSE_CAP = 1024 ** 2;
const TOKEN = /^[\x21-\x7e]{1,4096}$/u;

function fail(code) { throw new Error(`scanner_retention_copy_${code}`); }

async function responseBytes(response, cap = RESPONSE_CAP) {
  if (!response?.body || typeof response.body.getReader !== "function") fail("api_invalid");
  const reader = response.body.getReader(); const chunks = []; let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      if (!(item.value instanceof Uint8Array) || (total += item.value.byteLength) > cap) fail("api_limit");
      chunks.push(Buffer.from(item.value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}

async function requestJson(fetchImpl, endpoint, token) {
  let response;
  try {
    response = await fetchImpl(endpoint, { method: "GET", redirect: "error", signal: globalThis.AbortSignal.timeout(15_000), headers: {
      Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28",
    } });
  } catch { fail("api_failed"); }
  if (response.status !== 200 || response.redirected === true) fail("api_failed");
  const bytes = await responseBytes(response);
  try { return JSON.parse(bytes.toString("utf8")); } catch { fail("api_invalid"); }
}

function artifactUrls(id) {
  const url = `${API}/actions/artifacts/${id}`;
  return Object.freeze({ url, archive: `${url}/zip` });
}

export async function authenticateScannerRetentionPublisherArtifact(binding, token, fetchImpl = globalThis.fetch,
  now = Date.now) {
  const accepted = validateScannerRetentionPublisherObservation(binding);
  if (typeof token !== "string" || !TOKEN.test(token) || typeof fetchImpl !== "function" || typeof now !== "function") {
    fail("dependencies_invalid");
  }
  const runId = Number(accepted.runId); const urls = artifactUrls(accepted.artifactId);
  const [run, jobs, artifact, artifacts, commit] = await Promise.all([
    requestJson(fetchImpl, `${API}/actions/runs/${accepted.runId}`, token),
    requestJson(fetchImpl, `${API}/actions/runs/${accepted.runId}/attempts/1/jobs?per_page=100&page=1`, token),
    requestJson(fetchImpl, urls.url, token),
    requestJson(fetchImpl, `${API}/actions/runs/${accepted.runId}/artifacts?per_page=100&page=1`, token),
    requestJson(fetchImpl, `${API}/git/commits/${accepted.headSha}`, token),
  ]);
  const matchingJobs = Array.isArray(jobs?.jobs) ? jobs.jobs.filter((job) => job?.name === "Publish exact private scanner retention candidate") : [];
  const listed = Array.isArray(artifacts?.artifacts) ? artifacts.artifacts : [];
  const observedAt = now();
  const created = Date.parse(artifact?.created_at);
  const expires = Date.parse(artifact?.expires_at);
  if (run?.id !== runId || run.run_attempt !== 1 || run.run_number !== 1
    || run.path !== SCANNER_RETENTION.publisher.workflow || run.event !== "workflow_dispatch"
    || run.head_branch !== "main" || run.head_sha !== accepted.headSha
    || run.repository?.full_name !== SCANNER_RETENTION.repository || run.status !== "completed" || run.conclusion !== "success"
    || commit?.sha !== accepted.headSha || commit?.tree?.sha !== accepted.headTree
    || jobs?.total_count !== 1 || matchingJobs.length !== 1 || matchingJobs[0].status !== "completed"
    || matchingJobs[0].conclusion !== "success" || artifacts?.total_count !== 1 || listed.length !== 1
    || listed[0]?.id !== accepted.artifactId || artifact?.id !== accepted.artifactId
    || artifact.name !== accepted.artifactName || artifact.digest !== accepted.artifactDigest
    || artifact.size_in_bytes !== accepted.artifactBytes || artifact.expired !== false
    || artifact.url !== urls.url || artifact.archive_download_url !== urls.archive
    || artifact.workflow_run?.id !== runId || artifact.workflow_run?.head_sha !== accepted.headSha
    || listed[0]?.digest !== accepted.artifactDigest || listed[0]?.name !== accepted.artifactName
    || !Number.isFinite(observedAt) || !Number.isFinite(created) || !Number.isFinite(expires)
    || typeof artifact.created_at !== "string" || typeof artifact.expires_at !== "string"
    || created > observedAt || expires <= observedAt || expires <= created) fail("publisher_api_invalid");
  const createdAt = new Date(created).toISOString();
  return Object.freeze({ binding: accepted, identity: Object.freeze({ headSha: accepted.headSha,
    headTree: accepted.headTree, runId: accepted.runId }), artifact: Object.freeze({ id: accepted.artifactId,
    name: accepted.artifactName, digest: accepted.artifactDigest, size: accepted.artifactBytes }), createdAt });
}

function memoryHandle(size) {
  const bytes = Buffer.alloc(size); let position = 0;
  return Object.freeze({ bytes, async write(value, offset, length, requested) {
    const target = requested === null ? position : requested;
    if (!Buffer.isBuffer(value) || !Number.isSafeInteger(target) || target < 0 || target + length > bytes.length) {
      fail("artifact_write_invalid");
    }
    value.copy(bytes, target, offset, offset + length); if (requested === null) position += length;
    return { bytesWritten: length };
  } });
}

async function downloadReceipt(authenticated, token, dependencies) {
  const handle = memoryHandle(authenticated.artifact.size);
  await dependencies.download({ artifact: authenticated.artifact, handle,
    env: { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows", PATH: "C:\\Windows\\System32;C:\\Windows",
      GH_TOKEN: token, GH_PROMPT_DISABLED: "1", GH_DEBUG: "" } });
  const source = Object.freeze({ size: handle.bytes.length, async readAt(position, length) {
    return handle.bytes.subarray(position, position + length);
  } });
  let receiptBytes;
  const openEntrySink = (entry) => {
    if (entry.path !== "publisher-receipt.json") fail("artifact_profile_invalid");
    const chunks = []; let total = 0;
    return new Writable({ write(chunk, _encoding, callback) {
      total += chunk.length;
      if (total > SCANNER_RETENTION.publisher.receiptCapBytes) return callback(new Error("scanner_retention_copy_receipt_limit"));
      chunks.push(Buffer.from(chunk)); callback();
    }, final(callback) { receiptBytes = Buffer.concat(chunks, total); callback(); } });
  };
  await dependencies.scan({ source, descriptor: { size: authenticated.artifact.size, digest: authenticated.artifact.digest },
    profile: githubArtifactZipProfiles.scannerRetentionPublisherReceipt, openEntrySink });
  if (!Buffer.isBuffer(receiptBytes) || receiptBytes.length !== authenticated.binding.receiptBytes
    || sha256(receiptBytes) !== authenticated.binding.receiptSha256) fail("receipt_identity");
  validateScannerRetentionPublisherReceiptBytes(receiptBytes, authenticated.identity);
  return receiptBytes;
}

export function scannerRetentionWslCopyCommand() {
  return Object.freeze({ command: WSL, args: Object.freeze(["-d", "Ubuntu-24.04", "--cd", "/", "-u", "root",
    "--exec", "/usr/bin/env", "-i", "LANG=C.UTF-8", "LC_ALL=C.UTF-8", "TZ=UTC", "PATH=/usr/bin:/bin",
    LINUX_NODE, LINUX_SCRIPT]) });
}

function copyEnvelope(token, receiptBytes, authenticated) {
  return canonicalJsonBytes({ schemaVersion: 1, token, identity: authenticated.identity,
    artifact: { id: authenticated.artifact.id, name: authenticated.artifact.name, digest: authenticated.artifact.digest },
    receipt: receiptBytes.toString("base64") }, SCANNER_RETENTION.publisher.receiptCapBytes * 2 + 8192);
}

async function execute(binding, dependencies) {
  const token = dependencies.token;
  const authenticated = await authenticateScannerRetentionPublisherArtifact(binding, token,
    dependencies.fetchImpl, dependencies.now);
  const receiptBytes = await downloadReceipt(authenticated, token, dependencies);
  const authenticatedOptions = { identity: authenticated.identity,
    artifact: { id: authenticated.artifact.id, name: authenticated.artifact.name, digest: authenticated.artifact.digest },
    createdAt: authenticated.createdAt };
  const sidecar = createScannerRetentionSidecar(receiptBytes, authenticatedOptions);
  const sidecarBytes = canonicalJsonBytes(sidecar, SCANNER_RETENTION.local.sidecarCapBytes);
  dependencies.tools(); dependencies.capacity();
  const staged = validateScannerRetentionPairProof(await dependencies.pipe(scannerRetentionWslCopyCommand(),
    scannerRetentionHelperCommand("StageTar", sidecar, undefined, sidecarBytes), sidecar.innerTar,
    { sourceInput: copyEnvelope(token, receiptBytes, authenticated) }), "STAGED", sidecar, sidecarBytes);
  const committed = validateScannerRetentionPairProof(await dependencies.run(
    scannerRetentionHelperCommand("CommitPair", sidecar, staged, sidecarBytes), { input: sidecarBytes }),
  "COMMITTED", sidecar, sidecarBytes, staged);
  const inspected = validateScannerRetentionPairProof(await dependencies.run(
    scannerRetentionHelperCommand("InspectPair", sidecar, committed, sidecarBytes), { input: sidecarBytes }),
  "INSPECTED", sidecar, sidecarBytes, committed);
  return dependencies.restore({ sidecarBytes, receiptBytes, authenticatedOptions, pairProof: inspected },
    dependencies.restoreDependencies);
}

function defaults(options = {}) {
  return Object.freeze({ token: options.token ?? process.env.GH_TOKEN, fetchImpl: options.fetchImpl ?? globalThis.fetch,
    now: options.now ?? Date.now, download: options.download ?? streamGitHubArtifactZip,
    scan: options.scan ?? scanGitHubArtifactZip, tools: options.tools ?? assertScannerRetentionLocalTools,
    capacity: options.capacity ?? assertScannerRetentionLocalCapacity,
    pipe: options.pipe ?? pipeScannerRetentionLocalCommands, run: options.run ?? runScannerRetentionLocalCommand,
    restore: options.restore ?? restoreScannerRetentionCopy, restoreDependencies: options.restoreDependencies });
}

export async function runScannerRetentionCopy(options = {}) {
  const binding = validateScannerRetentionPublisherObservation(SCANNER_RETENTION.observations.publisher);
  return execute(binding, defaults(options));
}

export async function TEST_ONLY_runScannerRetentionCopy(options = {}) {
  return execute(validateScannerRetentionPublisherObservation(options.binding), defaults(options));
}

const direct = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (direct) {
  if (process.argv.length !== 2) { process.stderr.write("scanner_retention_copy_arguments_invalid\n"); process.exitCode = 1; }
  else runScannerRetentionCopy().then((bytes) => {
    if (!Buffer.isBuffer(bytes)) fail("restore_receipt_invalid");
    process.stdout.write(bytes);
  }).catch((error) => {
    process.stderr.write(`${/^scanner_retention_copy_/u.test(error?.message ?? "") ? error.message : "scanner_retention_copy_failed"}\n`);
    process.exitCode = 1;
  });
}
