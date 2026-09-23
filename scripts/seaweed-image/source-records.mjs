import { createHash } from "node:crypto";

const RUN_ID = 35_884_717_093;
const REPOSITORY_ID = 1_357_514_939;
const REPOSITORY = "CleMeY15/auto-world";
const WORKFLOW_ID = 358_072_544;
const WORKFLOW_PATH = ".github/workflows/seaweed-build.yml";
const WORKFLOW_NAME = "SeaweedFS source diagnostic";
const SOURCE_SHA = "6dbc6964e121e54dc5409f5e646f9ae25c01788f";
const SOURCE_TREE = "0cf3a6f1e73b34d861521cc9d4008765c3740605";
const WORKFLOW_BYTES = 4_424;
const WORKFLOW_SHA256 = "4e1ed660814c52b909f5431ee51c9739766447cd83b36a398f44ac64d159a723";
const MAX_BUILD_ZIP_BYTES = 2 * 1024 ** 3;
const MAX_JSON_ZIP_BYTES = 2 * 1024 ** 2;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

const JOBS = Object.freeze([
  Object.freeze({ id: 107_261_820_542, name: "Independent SeaweedFS build 1" }),
  Object.freeze({ id: 107_261_820_365, name: "Independent SeaweedFS build 2" }),
  Object.freeze({ id: 107_281_267_691, name: "Compare independent SeaweedFS builds" }),
]);

const ARTIFACTS = Object.freeze([
  Object.freeze({ id: 10_764_820_767, name: "seaweed-build-1", size: 1_559_755_770, digest: "sha256:6fa3299b48bc978c35ce10ae6cd9b2cd86d5020a324c555a69c493dbb8a174e5", expiresAt: "2026-10-07T16:40:47Z", profile: "build" }),
  Object.freeze({ id: 10_764_417_203, name: "seaweed-build-2", size: 1_559_676_896, digest: "sha256:bf65a3505e832603907cbef61cbbecb2d6ba0b88853c7ed9b84e1aad854be242", expiresAt: "2026-10-07T16:37:45Z", profile: "build" }),
  Object.freeze({ id: 10_764_885_637, name: "seaweed-artifact-gate-1", size: 277, digest: "sha256:bb5ebe41e7fa8e52987a91ab4dae19f88ac412fedfa8ec78b368b861efe2759c", expiresAt: "2026-10-07T16:41:00Z", profile: "gate-1" }),
  Object.freeze({ id: 10_763_824_843, name: "seaweed-artifact-gate-2", size: 278, digest: "sha256:15a9e2e02c985ccdfb0c949c5141265a4c8b6af0b864a4951586d2c84e1ce69d", expiresAt: "2026-10-07T16:37:56Z", profile: "gate-2" }),
  Object.freeze({ id: 10_764_462_948, name: "seaweed-comparison", size: 244_644, digest: "sha256:e58db0edbd41cc2dcb6243464f0110fb4db1ec52dc81fbcd05860b1598254092", expiresAt: "2026-10-07T16:42:36Z", profile: "comparison" }),
]);

export const reviewedSeaweedSourcePolicy = Object.freeze({
  kind: "REVIEWED_SEAWEED_SOURCE_POLICY_V1",
  repository: REPOSITORY,
  repositoryId: REPOSITORY_ID,
  runId: RUN_ID,
  attempt: 1,
  workflowId: WORKFLOW_ID,
  workflowPath: WORKFLOW_PATH,
  sourceSha: SOURCE_SHA,
  workflowBytes: WORKFLOW_BYTES,
  workflowSha256: WORKFLOW_SHA256,
  jobs: JOBS,
  artifacts: ARTIFACTS,
});

function fail(code) {
  const error = new Error(code);
  Object.defineProperty(error, "state", { value: "INCONSISTENT", enumerable: true });
  throw error;
}

function data(object, key, code) {
  if (object === null || typeof object !== "object") fail(code);
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (descriptor === undefined || !("value" in descriptor)) fail(code);
  return descriptor.value;
}

function exact(object, key, expected, code) {
  if (data(object, key, code) !== expected) fail(code);
}

function list(object, key, code) {
  const value = data(object, key, code);
  if (!Array.isArray(value)) fail(code);
  return value;
}

function exactUrl(object, key, expected, code) {
  exact(object, key, expected, code);
}

function validateRun(record, attemptUrl = false) {
  const code = attemptUrl ? "seaweed_source_attempt_invalid" : "seaweed_source_run_invalid";
  exact(record, "id", RUN_ID, code);
  exact(record, "workflow_id", WORKFLOW_ID, code);
  exact(record, "name", WORKFLOW_NAME, code);
  exact(record, "path", WORKFLOW_PATH, code);
  exact(record, "head_branch", "main", code);
  exact(record, "head_sha", SOURCE_SHA, code);
  exact(record, "event", "workflow_dispatch", code);
  exact(record, "run_attempt", 1, code);
  exact(record, "status", "completed", code);
  exact(record, "conclusion", "success", code);
  exactUrl(record, "url", `https://api.github.com/repos/${REPOSITORY}/actions/runs/${RUN_ID}`, code);
  exactUrl(record, "workflow_url", `https://api.github.com/repos/${REPOSITORY}/actions/workflows/${WORKFLOW_ID}`, code);
  exactUrl(record, "jobs_url", `https://api.github.com/repos/${REPOSITORY}/actions/runs/${RUN_ID}${attemptUrl ? "/attempts/1" : ""}/jobs`, code);
  const repository = data(record, "repository", code);
  exact(repository, "id", REPOSITORY_ID, code);
  exact(repository, "full_name", REPOSITORY, code);
  const headRepository = data(record, "head_repository", code);
  exact(headRepository, "id", REPOSITORY_ID, code);
  exact(headRepository, "full_name", REPOSITORY, code);
}

function validateRepository(record) {
  const code = "seaweed_source_repository_invalid";
  exact(record, "id", REPOSITORY_ID, code);
  exact(record, "name", "auto-world", code);
  exact(record, "full_name", REPOSITORY, code);
  exactUrl(record, "url", `https://api.github.com/repos/${REPOSITORY}`, code);
  exactUrl(record, "html_url", `https://github.com/${REPOSITORY}`, code);
  const owner = data(record, "owner", code);
  exact(owner, "login", "CleMeY15", code);
  exact(owner, "id", 62_676_891, code);
  exact(owner, "type", "User", code);
}

function validateCommit(record) {
  const code = "seaweed_source_commit_invalid";
  exact(record, "sha", SOURCE_SHA, code);
  exactUrl(record, "url", `https://api.github.com/repos/${REPOSITORY}/commits/${SOURCE_SHA}`, code);
  exactUrl(record, "html_url", `https://github.com/${REPOSITORY}/commit/${SOURCE_SHA}`, code);
  const commit = data(record, "commit", code);
  const tree = data(commit, "tree", code);
  exact(tree, "sha", SOURCE_TREE, code);
  exactUrl(tree, "url", `https://api.github.com/repos/${REPOSITORY}/git/trees/${SOURCE_TREE}`, code);
}

function validateWorkflow(record) {
  const code = "seaweed_source_workflow_invalid";
  exact(record, "id", WORKFLOW_ID, code);
  exact(record, "path", WORKFLOW_PATH, code);
  exactUrl(record, "url", `https://api.github.com/repos/${REPOSITORY}/actions/workflows/${WORKFLOW_ID}`, code);
}

function validateWorkflowBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== WORKFLOW_BYTES) fail("seaweed_source_workflow_bytes_invalid");
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== WORKFLOW_SHA256) fail("seaweed_source_workflow_bytes_invalid");
}

function validateJobs(record) {
  const code = "seaweed_source_jobs_invalid";
  exact(record, "total_count", JOBS.length, code);
  const jobs = list(record, "jobs", code);
  if (jobs.length !== JOBS.length) fail(code);
  const remaining = new Map(JOBS.map((job) => [job.id, job]));
  for (const job of jobs) {
    const id = data(job, "id", code);
    const expected = remaining.get(id);
    if (expected === undefined) fail(code);
    remaining.delete(id);
    exact(job, "name", expected.name, code);
    exact(job, "run_id", RUN_ID, code);
    exact(job, "run_attempt", 1, code);
    exact(job, "workflow_name", WORKFLOW_NAME, code);
    exact(job, "head_branch", "main", code);
    exact(job, "head_sha", SOURCE_SHA, code);
    exact(job, "status", "completed", code);
    exact(job, "conclusion", "success", code);
    exactUrl(job, "run_url", `https://api.github.com/repos/${REPOSITORY}/actions/runs/${RUN_ID}`, code);
    exactUrl(job, "url", `https://api.github.com/repos/${REPOSITORY}/actions/jobs/${id}`, code);
  }
  if (remaining.size !== 0) fail(code);
}

function validateArtifact(record, expected, nowMs, code) {
  exact(record, "id", expected.id, code);
  exact(record, "name", expected.name, code);
  exact(record, "size_in_bytes", expected.size, code);
  exact(record, "digest", expected.digest, code);
  exact(record, "expired", false, code);
  exact(record, "expires_at", expected.expiresAt, code);
  if (!SHA256.test(expected.digest) || Date.parse(expected.expiresAt) <= nowMs) fail(code);
  const maximum = expected.profile === "build" ? MAX_BUILD_ZIP_BYTES : MAX_JSON_ZIP_BYTES;
  if (!Number.isSafeInteger(expected.size) || expected.size < 1 || expected.size > maximum) fail(code);
  exactUrl(record, "url", `https://api.github.com/repos/${REPOSITORY}/actions/artifacts/${expected.id}`, code);
  exactUrl(record, "archive_download_url", `https://api.github.com/repos/${REPOSITORY}/actions/artifacts/${expected.id}/zip`, code);
  const workflowRun = data(record, "workflow_run", code);
  exact(workflowRun, "id", RUN_ID, code);
  exact(workflowRun, "repository_id", REPOSITORY_ID, code);
  exact(workflowRun, "head_repository_id", REPOSITORY_ID, code);
  exact(workflowRun, "head_branch", "main", code);
  exact(workflowRun, "head_sha", SOURCE_SHA, code);
}

function artifactsById(records, nowMs, code) {
  if (!Array.isArray(records) || records.length !== ARTIFACTS.length) fail(code);
  const remaining = new Map(ARTIFACTS.map((artifact) => [artifact.id, artifact]));
  const found = new Map();
  for (const record of records) {
    const id = data(record, "id", code);
    const expected = remaining.get(id);
    if (expected === undefined) fail(code);
    validateArtifact(record, expected, nowMs, code);
    remaining.delete(id);
    found.set(id, record);
  }
  if (remaining.size !== 0) fail(code);
  return found;
}

function compareArtifactViews(left, right) {
  for (const expected of ARTIFACTS) {
    const a = left.get(expected.id);
    const b = right.get(expected.id);
    for (const key of ["id", "name", "size_in_bytes", "digest", "expired", "expires_at", "url", "archive_download_url"]) {
      if (data(a, key, "seaweed_source_artifact_views_inconsistent") !== data(b, key, "seaweed_source_artifact_views_inconsistent")) {
        fail("seaweed_source_artifact_views_inconsistent");
      }
    }
  }
}

export function validateSeaweedSourceRecords(input) {
  const inputCode = "seaweed_source_input_invalid";
  const repository = data(input, "repository", inputCode);
  const commit = data(input, "commit", inputCode);
  const run = data(input, "run", inputCode);
  const attempt1 = data(input, "attempt1", inputCode);
  const workflow = data(input, "workflow", inputCode);
  const workflowBytes = data(input, "workflowBytes", inputCode);
  const jobs = data(input, "jobs", inputCode);
  const artifacts = data(input, "artifacts", inputCode);
  const artifactRecords = data(input, "artifactRecords", inputCode);
  const runFinal = data(input, "runFinal", inputCode);
  const attempt1Final = data(input, "attempt1Final", inputCode);
  const observedAt = data(input, "observedAt", inputCode);
  const nowMs = typeof observedAt === "string" ? Date.parse(observedAt) : Number.NaN;
  if (!Number.isFinite(nowMs) || new Date(nowMs).toISOString() !== observedAt) fail("seaweed_source_time_invalid");
  validateRepository(repository);
  validateCommit(commit);
  validateRun(run);
  validateRun(attempt1, true);
  validateRun(runFinal);
  validateRun(attempt1Final, true);
  validateWorkflow(workflow);
  validateWorkflowBytes(workflowBytes);
  validateJobs(jobs);
  const code = "seaweed_source_artifacts_invalid";
  exact(artifacts, "total_count", ARTIFACTS.length, code);
  const listed = artifactsById(list(artifacts, "artifacts", code), nowMs, code);
  const individual = artifactsById(artifactRecords, nowMs, "seaweed_source_artifact_records_invalid");
  compareArtifactViews(listed, individual);

  const descriptors = ARTIFACTS.map((artifact) => Object.freeze({
    id: artifact.id,
    name: artifact.name,
    size: artifact.size,
    digest: artifact.digest,
    profile: artifact.profile,
    archiveDownloadUrl: `https://api.github.com/repos/${REPOSITORY}/actions/artifacts/${artifact.id}/zip`,
    expiresAt: artifact.expiresAt,
  }));
  return Object.freeze({
    kind: "SEAWEED_SOURCE_RECORDS_V1",
    authority: "CONSISTENT_ONLY",
    state: "COMPLETE",
    repository: REPOSITORY,
    repositoryId: REPOSITORY_ID,
    runId: RUN_ID,
    attempt: 1,
    workflowId: WORKFLOW_ID,
    workflowPath: WORKFLOW_PATH,
    sourceSha: SOURCE_SHA,
    workflowSha256: WORKFLOW_SHA256,
    artifacts: Object.freeze(descriptors),
  });
}
