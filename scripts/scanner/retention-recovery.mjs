import { Writable } from "node:stream";
import { streamGitHubArtifactZip } from "../seaweed-image/download-artifact-zip.mjs";
import { githubArtifactZipProfiles, scanGitHubArtifactZip } from "../seaweed-image/read-artifact-zip.mjs";
import { SCANNER_RETENTION as P, sha256 } from "./retention-policy.mjs";

const API = `https://api.github.com/repos/${P.repository}`;
const JOB_NAME = "Publish exact private scanner retention candidate";
const JSON_CAP = 1048576;
const fail = (reason) => { throw new Error(`scanner_retention_publish_recovery_${reason}`); };

function runMatches(run, id, number, headSha, status, conclusion) {
  return run?.id === Number(id) && run.workflow_id === P.publisher.recovery.workflowId
    && run.run_number === number && run.run_attempt === 1 && run.path === P.publisher.workflow
    && run.event === "workflow_dispatch" && run.head_branch === "main" && run.head_sha === headSha
    && run.repository?.full_name === P.repository && run.head_repository?.full_name === P.repository
    && run.status === status && run.conclusion === conclusion;
}

export function validateScannerRetentionRecoveryApis(data, context, now = Date.now) {
  const recovery = P.publisher.recovery; const old = recovery.predecessor;
  if (typeof context?.runId !== "string" || !/^[1-9][0-9]{0,15}$/u.test(context.runId)
    || !Number.isSafeInteger(Number(context.runId)) || context.runId === old.runId
    || !/^[a-f0-9]{40}$/u.test(context.headSha ?? "")) fail("context_invalid");
  const { workflow, history, previous, current, jobs, artifact, artifacts, commit } = data;
  if (workflow?.id !== recovery.workflowId || workflow.path !== P.publisher.workflow || workflow.state !== "active"
    || history?.total_count !== 2 || !Array.isArray(history.workflow_runs) || history.workflow_runs.length !== 2
    || !runMatches(previous, old.runId, 1, old.headSha, "completed", "failure")
    || !runMatches(current, context.runId, 2, context.headSha, "in_progress", null)
    || history.workflow_runs.filter((run) => runMatches(run, old.runId, 1, old.headSha, "completed", "failure")).length !== 1
    || history.workflow_runs.filter((run) => runMatches(run, context.runId, 2, context.headSha, "in_progress", null)).length !== 1
    || commit?.sha !== old.headSha || commit.tree?.sha !== old.headTree) fail("history_invalid");
  const job = jobs?.jobs?.[0];
  if (jobs?.total_count !== 1 || !Array.isArray(jobs.jobs) || jobs.jobs.length !== 1
    || job?.id !== old.jobId || job.run_id !== Number(old.runId) || job.run_attempt !== 1
    || job.head_sha !== old.headSha || job.name !== JOB_NAME
    || job.status !== "completed" || job.conclusion !== "failure") fail("job_invalid");
  const observedAt = now();
  const matchesArtifact = (value) => value?.id === old.artifactId && value.name === old.artifactName
    && value.digest === old.artifactDigest && value.size_in_bytes === old.artifactBytes
    && value.created_at === old.createdAt && value.expires_at === old.expiresAt && value.expired === false
    && value.url === `${API}/actions/artifacts/${old.artifactId}`
    && value.archive_download_url === `${API}/actions/artifacts/${old.artifactId}/zip`
    && value.workflow_run?.id === Number(old.runId) && value.workflow_run?.head_sha === old.headSha
    && value.workflow_run?.head_branch === "main";
  if (!Number.isFinite(observedAt) || Date.parse(old.createdAt) > observedAt
    || Date.parse(old.expiresAt) <= observedAt || !matchesArtifact(artifact)
    || artifacts?.total_count !== 1 || !Array.isArray(artifacts.artifacts) || artifacts.artifacts.length !== 1
    || !matchesArtifact(artifacts.artifacts[0])) fail("artifact_invalid");
  return Object.freeze({ id: old.artifactId, size: old.artifactBytes, digest: old.artifactDigest });
}

async function requestJson(fetchImpl, endpoint, context, deadline, now) {
  const remaining = Math.min(15000, deadline - now());
  if (!Number.isSafeInteger(remaining) || remaining <= 0) fail("timeout");
  const controller = new globalThis.AbortController();
  let reader; let response; let timer;
  const interrupted = new Promise((_resolve, reject) => {
    timer = globalThis.setTimeout(() => {
      controller.abort(); reject(new Error("scanner_retention_publish_recovery_timeout"));
    }, remaining);
  });
  const receive = async () => {
    response = await fetchImpl(endpoint, { method: "GET", redirect: "error", signal: controller.signal,
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${context.token}`,
        "User-Agent": "auto-world-scanner-retention-recovery", "X-GitHub-Api-Version": "2022-11-28" } });
    if (controller.signal.aborted) {
      try { Promise.resolve(response?.body?.cancel?.()).catch(() => {}); } catch { /* late response */ }
      fail("timeout");
    }
    if (response?.status !== 200 || response.redirected !== false || !response.body?.getReader
      || (response.url && response.url !== endpoint)) fail("api_invalid");
    const length = response.headers?.get?.("content-length");
    if (length != null && (!/^[0-9]+$/u.test(length) || Number(length) > JSON_CAP)) fail("api_invalid");
    reader = response.body.getReader(); const chunks = []; let total = 0;
    while (true) {
      const part = await reader.read();
      if (controller.signal.aborted || now() >= deadline) fail("timeout");
      if (part.done === true) break;
      if (part.done !== false || !(part.value instanceof Uint8Array)
        || (total += part.value.length) > JSON_CAP) fail("api_invalid");
      chunks.push(Buffer.from(part.value));
    }
    return JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
  };
  try { return await Promise.race([receive(), interrupted]); }
  catch (error) {
    controller.abort();
    try {
      const close = reader ? reader.cancel() : response?.body?.cancel?.();
      if (close !== undefined) await Promise.race([close, interrupted]);
    } catch { /* original refusal remains authoritative */ }
    if (/^scanner_retention_publish_recovery_/u.test(error?.message ?? "")) throw error;
    fail("api_invalid");
  } finally {
    globalThis.clearTimeout(timer);
    try { reader?.releaseLock(); } catch { controller.abort(); fail("api_invalid"); }
  }
}

export function validateScannerRetentionFailedPublisherReceipt(bytes) {
  const old = P.publisher.recovery.predecessor;
  if (!Buffer.isBuffer(bytes) || bytes.length !== old.receiptBytes || sha256(bytes) !== old.receiptSha256) {
    fail("receipt_invalid");
  }
  const receipt = JSON.parse(bytes.toString("utf8"));
  if (receipt.result !== "FAILED" || receipt.runId !== old.runId || receipt.runAttempt !== 1
    || receipt.headSha !== old.headSha || receipt.headTree !== old.headTree || receipt.cleanup.state !== "UNKNOWN"
    || ["tag", "ghcrManifestDigest", "innerTar", "restoreManifest", "oci"].some((key) => receipt[key] !== null)
    || receipt.phases.length !== 6 || receipt.phases.at(-1).name !== "official_provenance"
    || receipt.phases.at(-1).result !== "FAILED") fail("receipt_invalid");
  return Object.freeze({ runId: old.runId, result: "FAILED", cleanup: "UNKNOWN", receiptSha256: old.receiptSha256 });
}

export async function verifyScannerRetentionPublisherRecovery({ context, env, deadline, now = Date.now,
  fetchImpl = globalThis.fetch, download = streamGitHubArtifactZip, scan = scanGitHubArtifactZip }) {
  const recovery = P.publisher.recovery; const old = recovery.predecessor;
  const endpoints = {
    workflow: `${API}/actions/workflows/${recovery.workflowId}`,
    history: `${API}/actions/workflows/${recovery.workflowId}/runs?per_page=100&page=1`,
    previous: `${API}/actions/runs/${old.runId}`,
    current: `${API}/actions/runs/${context.runId}`,
    jobs: `${API}/actions/runs/${old.runId}/attempts/1/jobs?per_page=100&page=1`,
    artifact: `${API}/actions/artifacts/${old.artifactId}`,
    artifacts: `${API}/actions/runs/${old.runId}/artifacts?per_page=100&page=1`,
    commit: `${API}/git/commits/${old.headSha}`,
  };
  const data = Object.fromEntries(await Promise.all(Object.entries(endpoints).map(async ([key, endpoint]) =>
    [key, await requestJson(fetchImpl, endpoint, context, deadline, now)])));
  const artifact = validateScannerRetentionRecoveryApis(data, context, now);
  const zip = Buffer.alloc(artifact.size); let position = 0;
  const handle = { async write(value, offset, length, requested) {
    const target = requested === null ? position : requested;
    if (!Buffer.isBuffer(value) || !Number.isSafeInteger(target) || target !== position
      || !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0
      || offset + length > value.length || target + length > zip.length) fail("zip_invalid");
    value.copy(zip, target, offset, offset + length); position += length;
    return { bytesWritten: length };
  } };
  const timeoutMs = Math.min(60000, deadline - now());
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) fail("timeout");
  await download({ artifact, handle, timeoutMs, env: { ...env, GH_TOKEN: context.token } });
  if (position !== zip.length || `sha256:${sha256(zip)}` !== artifact.digest || now() >= deadline) fail("zip_invalid");
  let receiptBytes;
  await scan({ source: { size: zip.length, async readAt(start, length) { return zip.subarray(start, start + length); } },
    descriptor: { size: zip.length, digest: artifact.digest }, profile: githubArtifactZipProfiles.scannerRetentionPublisherReceipt,
    openEntrySink(entry) {
      if (entry.path !== "publisher-receipt.json") fail("zip_invalid");
      const chunks = []; let total = 0;
      return new Writable({ write(chunk, _encoding, callback) {
        total += chunk.length;
        if (total > old.receiptBytes) return callback(new Error("scanner_retention_publish_recovery_receipt_invalid"));
        chunks.push(Buffer.from(chunk)); callback();
      }, final(callback) { receiptBytes = Buffer.concat(chunks, total); callback(); } });
    } });
  if (now() >= deadline) fail("timeout");
  return validateScannerRetentionFailedPublisherReceipt(receiptBytes);
}
