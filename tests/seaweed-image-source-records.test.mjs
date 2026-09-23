import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  reviewedSeaweedSourcePolicy, validateSeaweedSourceRecords,
} from "../scripts/seaweed-image/source-records.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));
const repository = { id: 1_357_514_939, full_name: "CleMeY15/auto-world" };
const baseRun = {
  id: 35_884_717_093, workflow_id: 358_072_544, name: "SeaweedFS source diagnostic",
  path: ".github/workflows/seaweed-build.yml", head_branch: "main",
  head_sha: "6dbc6964e121e54dc5409f5e646f9ae25c01788f", event: "workflow_dispatch",
  run_attempt: 1, status: "completed", conclusion: "success",
  url: "https://api.github.com/repos/CleMeY15/auto-world/actions/runs/35884717093",
  workflow_url: "https://api.github.com/repos/CleMeY15/auto-world/actions/workflows/358072544",
  jobs_url: "https://api.github.com/repos/CleMeY15/auto-world/actions/runs/35884717093/jobs",
  repository, head_repository: repository,
};

function artifact(expected) {
  return {
    id: expected.id, name: expected.name, size_in_bytes: expected.size, digest: expected.digest,
    expired: false, expires_at: expected.expiresAt,
    url: `https://api.github.com/repos/CleMeY15/auto-world/actions/artifacts/${expected.id}`,
    archive_download_url: `https://api.github.com/repos/CleMeY15/auto-world/actions/artifacts/${expected.id}/zip`,
    workflow_run: {
      id: 35_884_717_093, repository_id: 1_357_514_939, head_repository_id: 1_357_514_939,
      head_branch: "main", head_sha: "6dbc6964e121e54dc5409f5e646f9ae25c01788f",
    },
  };
}

function fixture() {
  const artifactRecords = reviewedSeaweedSourcePolicy.artifacts.map(artifact);
  return {
    repository: {
      id: 1_357_514_939, name: "auto-world", full_name: "CleMeY15/auto-world",
      url: "https://api.github.com/repos/CleMeY15/auto-world", html_url: "https://github.com/CleMeY15/auto-world",
      owner: { login: "CleMeY15", id: 62_676_891, type: "User" },
    },
    commit: {
      sha: "6dbc6964e121e54dc5409f5e646f9ae25c01788f",
      url: "https://api.github.com/repos/CleMeY15/auto-world/commits/6dbc6964e121e54dc5409f5e646f9ae25c01788f",
      html_url: "https://github.com/CleMeY15/auto-world/commit/6dbc6964e121e54dc5409f5e646f9ae25c01788f",
      commit: {
        tree: { sha: "0cf3a6f1e73b34d861521cc9d4008765c3740605", url: "https://api.github.com/repos/CleMeY15/auto-world/git/trees/0cf3a6f1e73b34d861521cc9d4008765c3740605" },
      },
    },
    run: clone(baseRun),
    attempt1: { ...clone(baseRun), jobs_url: "https://api.github.com/repos/CleMeY15/auto-world/actions/runs/35884717093/attempts/1/jobs" },
    runFinal: clone(baseRun),
    attempt1Final: { ...clone(baseRun), jobs_url: "https://api.github.com/repos/CleMeY15/auto-world/actions/runs/35884717093/attempts/1/jobs" },
    workflow: {
      id: 358_072_544, name: "SeaweedFS source diagnostic", path: ".github/workflows/seaweed-build.yml",
      state: "disabled_manually", url: "https://api.github.com/repos/CleMeY15/auto-world/actions/workflows/358072544",
    },
    workflowBytes: readFileSync(new URL("../.github/workflows/seaweed-build.yml", import.meta.url)),
    jobs: {
      total_count: 3,
      jobs: reviewedSeaweedSourcePolicy.jobs.map((job) => ({
        ...job, run_id: 35_884_717_093, run_attempt: 1, workflow_name: "SeaweedFS source diagnostic",
        head_branch: "main", head_sha: "6dbc6964e121e54dc5409f5e646f9ae25c01788f",
        status: "completed", conclusion: "success",
        run_url: "https://api.github.com/repos/CleMeY15/auto-world/actions/runs/35884717093",
        url: `https://api.github.com/repos/CleMeY15/auto-world/actions/jobs/${job.id}`,
      })),
    },
    artifacts: { total_count: 5, artifacts: clone(artifactRecords) },
    artifactRecords: clone(artifactRecords),
    observedAt: "2026-09-23T18:00:00.000Z",
  };
}

function rejects(change, code) {
  const value = fixture();
  change(value);
  assert.throws(() => validateSeaweedSourceRecords(value), (error) => {
    assert.equal(error.message, code);
    assert.equal(error.state, "INCONSISTENT");
    return true;
  });
}

test("returns frozen consistent-only download descriptors for the exact reviewed source records", () => {
  const value = fixture();
  value.jobs.jobs.reverse();
  value.artifacts.artifacts.reverse();
  const result = validateSeaweedSourceRecords(value);
  assert.equal(result.authority, "CONSISTENT_ONLY");
  assert.equal(result.state, "COMPLETE");
  assert.equal(result.artifacts.length, 5);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.artifacts));
  assert.ok(result.artifacts.every(Object.isFrozen));
  assert.deepEqual(result.artifacts[0], {
    id: 10_764_820_767, name: "seaweed-build-1", size: 1_559_755_770,
    digest: "sha256:6fa3299b48bc978c35ce10ae6cd9b2cd86d5020a324c555a69c493dbb8a174e5",
    profile: "build", archiveDownloadUrl: "https://api.github.com/repos/CleMeY15/auto-world/actions/artifacts/10764820767/zip",
    expiresAt: "2026-10-07T16:40:47Z",
  });
});

test("rejects run, attempt, workflow and immutable workflow-byte substitutions", () => {
  rejects((value) => { value.repository.id += 1; }, "seaweed_source_repository_invalid");
  rejects((value) => { value.commit.commit.tree.sha = "0".repeat(40); }, "seaweed_source_commit_invalid");
  rejects((value) => { value.run.repository.id += 1; }, "seaweed_source_run_invalid");
  rejects((value) => { value.run.head_repository.id += 1; }, "seaweed_source_run_invalid");
  rejects((value) => { value.attempt1.jobs_url = value.run.jobs_url; }, "seaweed_source_attempt_invalid");
  rejects((value) => { value.runFinal.conclusion = "failure"; }, "seaweed_source_run_invalid");
  rejects((value) => { value.attempt1Final.head_sha = "0".repeat(40); }, "seaweed_source_attempt_invalid");
  rejects((value) => { value.workflow.path = ".github/workflows/other.yml"; }, "seaweed_source_workflow_invalid");
  rejects((value) => { value.workflowBytes[0] ^= 1; }, "seaweed_source_workflow_bytes_invalid");
});

test("rejects missing, extra, duplicate and unsuccessful jobs", () => {
  rejects((value) => { value.jobs.jobs.pop(); value.jobs.total_count = 2; }, "seaweed_source_jobs_invalid");
  rejects((value) => { value.jobs.jobs.push({ ...value.jobs.jobs[0], id: 1 }); value.jobs.total_count = 4; }, "seaweed_source_jobs_invalid");
  rejects((value) => { value.jobs.jobs[1] = clone(value.jobs.jobs[0]); }, "seaweed_source_jobs_invalid");
  rejects((value) => { value.jobs.jobs[0].conclusion = "failure"; }, "seaweed_source_jobs_invalid");
});

test("rejects altered, missing, duplicate, expired and cross-view artifact records", () => {
  rejects((value) => { value.artifacts.artifacts[0].digest = `sha256:${"0".repeat(64)}`; }, "seaweed_source_artifacts_invalid");
  rejects((value) => { value.artifacts.artifacts.pop(); value.artifacts.total_count = 4; }, "seaweed_source_artifacts_invalid");
  rejects((value) => { value.artifactRecords[1] = clone(value.artifactRecords[0]); }, "seaweed_source_artifact_records_invalid");
  rejects((value) => { value.observedAt = "2026-10-07T16:42:36.000Z"; }, "seaweed_source_artifacts_invalid");
  rejects((value) => { value.artifactRecords[0].expired = true; }, "seaweed_source_artifact_records_invalid");
  rejects((value) => {
    Object.defineProperty(value.artifactRecords[0], "digest", { get() { throw new Error("getter executed"); } });
  }, "seaweed_source_artifact_records_invalid");
});

test("requires an explicit safe observation time", () => {
  rejects((value) => { value.observedAt = "2026-09-23T18:00:00Z"; }, "seaweed_source_time_invalid");
  rejects((value) => { value.observedAt = undefined; }, "seaweed_source_time_invalid");
});
