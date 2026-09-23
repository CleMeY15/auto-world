import { execFile as nodeExecFile } from "node:child_process";

const REST_VERSION = "2022-11-28";
const HOST = "github.com";
const JSON_ACCEPT = "application/vnd.github+json";
const RAW_ACCEPT = "application/vnd.github.raw+json";
const MAX_JSON_BYTES = 16 * 1024 ** 2;
const MAX_WORKFLOW_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 120_000;
const GH_EXECUTABLE = process.platform === "win32" ? "C:\\Program Files\\GitHub CLI\\gh.exe"
  : process.platform === "linux" ? "/usr/bin/gh" : undefined;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
const REPOSITORY = /^[A-Za-z0-9._-]{1,100}$/u;
const WORKFLOW_PATH = /^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/u;
const COMMIT = /^[0-9a-f]{40}$/u;

export const seaweedWorkflowSourceExpectation = Object.freeze({
  bytes: 4_424,
  digest: "sha256:4e1ed660814c52b909f5431ee51c9739766447cd83b36a398f44ac64d159a723",
});

function apiError(code) {
  return Object.assign(new Error(code), { code });
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function snapshotPolicy(policy) {
  if (policy === null || typeof policy !== "object" || Array.isArray(policy)) throw apiError("seaweed_github_api_policy_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(policy);
  const value = (name) => Object.hasOwn(descriptors, name) && Object.hasOwn(descriptors[name], "value")
    ? descriptors[name].value : undefined;
  const owner = value("owner");
  const repo = value("repo");
  const runId = value("runId");
  const workflowPath = value("workflowPath");
  const workflowId = value("workflowId");
  const commitSha = value("commitSha");
  const artifactIds = value("artifactIds");
  if (!OWNER.test(owner ?? "") || !REPOSITORY.test(repo ?? "") || repo === "." || repo === ".."
    || !positiveInteger(runId) || !WORKFLOW_PATH.test(workflowPath ?? "") || !positiveInteger(workflowId)
    || !COMMIT.test(commitSha ?? "") || !Array.isArray(artifactIds) || artifactIds.length !== 5
    || artifactIds.some((id) => !positiveInteger(id)) || new Set(artifactIds).size !== artifactIds.length) {
    throw apiError("seaweed_github_api_policy_invalid");
  }
  return Object.freeze({ owner, repo, runId, workflowPath, workflowId, commitSha, artifactIds: Object.freeze([...artifactIds]) });
}

function snapshotOptions(options, allowInjection) {
  if (!allowInjection && GH_EXECUTABLE === undefined) throw apiError("seaweed_github_api_platform_unsupported");
  if (options === undefined) return Object.freeze({
    signal: undefined, timeoutMs: DEFAULT_TIMEOUT_MS, execFile: nodeExecFile, executable: GH_EXECUTABLE,
  });
  if (options === null || typeof options !== "object" || Array.isArray(options)) throw apiError("seaweed_github_api_options_invalid");
  const descriptors = Object.getOwnPropertyDescriptors(options);
  const value = (name) => Object.hasOwn(descriptors, name) && Object.hasOwn(descriptors[name], "value")
    ? descriptors[name].value : undefined;
  const signal = value("signal");
  const timeoutMs = value("timeoutMs") ?? DEFAULT_TIMEOUT_MS;
  const injected = value("execFile");
  if (signal !== undefined && !(signal instanceof globalThis.AbortSignal)) throw apiError("seaweed_github_api_options_invalid");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS
    || (!allowInjection && injected !== undefined) || (injected !== undefined && typeof injected !== "function")) {
    throw apiError("seaweed_github_api_options_invalid");
  }
  return Object.freeze({
    signal, timeoutMs, execFile: injected ?? nodeExecFile,
    executable: injected === undefined ? GH_EXECUTABLE : "TEST_ONLY_gh",
  });
}

function encodedPath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function makeEndpoints(policy) {
  const repository = `repos/${encodeURIComponent(policy.owner)}/${encodeURIComponent(policy.repo)}`;
  const run = `${repository}/actions/runs/${policy.runId}`;
  return Object.freeze({
    repository,
    commit: `${repository}/commits/${policy.commitSha}`,
    run,
    attempt1: `${run}/attempts/1`,
    workflow: `${repository}/actions/workflows/${policy.workflowId}`,
    workflowRaw: `${repository}/contents/${encodedPath(policy.workflowPath)}?ref=${policy.commitSha}`,
    jobs: `${run}/attempts/1/jobs?per_page=100`,
    artifacts: `${run}/artifacts?per_page=100`,
    artifact: (id) => `${repository}/actions/artifacts/${id}`,
  });
}

function executeGh(execFile, executable, endpoint, accept, maximumBytes, deadline, externalSignal) {
  return new Promise((resolve, reject) => {
    if (externalSignal?.aborted === true) {
      reject(apiError("seaweed_github_api_aborted"));
      return;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reject(apiError("seaweed_github_api_timeout"));
      return;
    }
    const controller = new globalThis.AbortController();
    let settled = false;
    let child;
    const cleanup = () => {
      globalThis.clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onAbort);
    };
    const finish = (error, stdout) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error !== null && error !== undefined) {
        reject(apiError(error.code === "ETIMEDOUT" || Date.now() >= deadline
          ? "seaweed_github_api_timeout" : "seaweed_github_api_request_failed"));
        return;
      }
      if (!(stdout instanceof Uint8Array) || stdout.byteLength > maximumBytes) {
        reject(apiError("seaweed_github_api_output_invalid"));
        return;
      }
      resolve(Buffer.from(stdout));
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      controller.abort();
      reject(apiError("seaweed_github_api_aborted"));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      externalSignal?.removeEventListener("abort", onAbort);
      controller.abort();
      reject(apiError("seaweed_github_api_timeout"));
    }, remaining);
    externalSignal?.addEventListener("abort", onAbort, { once: true });
    const args = ["api", "--method", "GET", "--hostname", HOST,
      "--header", `Accept: ${accept}`, "--header", `X-GitHub-Api-Version: ${REST_VERSION}`, endpoint];
    try {
      child = execFile(executable, args, {
        encoding: null,
        maxBuffer: maximumBytes,
        timeout: remaining,
        signal: controller.signal,
        shell: false,
        windowsHide: true,
      }, finish);
    } catch {
      cleanup();
      settled = true;
      reject(apiError("seaweed_github_api_request_failed"));
    }
    void child;
  });
}

function parseJson(bytes) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw apiError("seaweed_github_api_json_invalid");
  }
}

async function read(policyInput, optionsInput, allowInjection) {
  const policy = snapshotPolicy(policyInput);
  const options = snapshotOptions(optionsInput, allowInjection);
  const endpoints = makeEndpoints(policy);
  const deadline = Date.now() + options.timeoutMs;
  const json = async (endpoint) => parseJson(await executeGh(
    options.execFile, options.executable, endpoint, JSON_ACCEPT, MAX_JSON_BYTES, deadline, options.signal,
  ));
  const repository = await json(endpoints.repository);
  const commit = await json(endpoints.commit);
  const run = await json(endpoints.run);
  const attempt1 = await json(endpoints.attempt1);
  const workflow = await json(endpoints.workflow);
  const workflowBytes = await executeGh(options.execFile, options.executable, endpoints.workflowRaw, RAW_ACCEPT,
    MAX_WORKFLOW_BYTES, deadline, options.signal);
  const jobs = await json(endpoints.jobs);
  const artifacts = await json(endpoints.artifacts);
  const artifactRecords = [];
  for (const id of policy.artifactIds) artifactRecords.push(await json(endpoints.artifact(id)));
  const runFinal = await json(endpoints.run);
  const attempt1Final = await json(endpoints.attempt1);
  return Object.freeze({
    repository, commit, run, attempt1, workflow, workflowBytes, jobs, artifacts,
    artifactRecords: Object.freeze(artifactRecords), runFinal, attempt1Final,
  });
}

export function readSeaweedGitHubApi(policy, options) {
  return read(policy, options, false);
}

export function TEST_ONLY_readSeaweedGitHubApi(policy, options) {
  return read(policy, options, true);
}
