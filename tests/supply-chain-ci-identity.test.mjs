import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createNativeCiIdentity, validateNativeCiIdentity } from "../scripts/supply-chain/ci-identity.mjs";
import { sha256 } from "../scripts/supply-chain/strict-json.mjs";

const workflow = readFileSync(new URL("../.github/workflows/native-bootstrap.yml", import.meta.url));
const environment = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "CleMeY15/auto-world", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1",
  GITHUB_SHA: "a".repeat(40), GITHUB_WORKFLOW_SHA: "a".repeat(40), GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/pull/8/merge",
  GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/native-bootstrap.yml@refs/pull/8/merge" };

test("CI identity binds exact workflow path, event, ref, source and workflow file bytes", () => {
  const run = createNativeCiIdentity(environment, workflow);
  assert.equal(run.workflowFileSha256, sha256(workflow));
  assert.equal(run.event, "pull_request");
  assert.equal(validateNativeCiIdentity(run, run), run);
  const main = createNativeCiIdentity({ ...environment, GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main",
    GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/native-bootstrap.yml@refs/heads/main" }, workflow);
  assert.equal(main.event, "push");
});

test("another workflow at the same commit cannot supply native evidence", () => {
  const run = createNativeCiIdentity(environment, workflow);
  assert.throws(() => validateNativeCiIdentity({ ...run, workflowRef: run.workflowRef.replace("native-bootstrap.yml", "other.yml") }, run));
  assert.throws(() => createNativeCiIdentity({ ...environment, GITHUB_WORKFLOW_REF: environment.GITHUB_WORKFLOW_REF.replace("native-bootstrap.yml", "ci.yml") }, workflow));
  for (const changed of [{ event: "workflow_dispatch" }, { workflowFileSha256: "9".repeat(64) }, { attempt: 2 },
    { sourceSha: "b".repeat(40) }, { workflowSha: "b".repeat(40) }, { id: "456" }]) assert.throws(() => validateNativeCiIdentity({ ...run, ...changed }, run));
});

test("CI identity rejects mismatched refs, unapproved events, repositories and modified capabilities", () => {
  for (const changed of [
    { GITHUB_REPOSITORY: "other/auto-world" }, { GITHUB_ACTIONS: "false" }, { GITHUB_EVENT_NAME: "pull_request_target" },
    { GITHUB_REF: "refs/heads/main" }, { GITHUB_RUN_ATTEMPT: "0" }, { GITHUB_RUN_ATTEMPT: "9007199254740992" },
    { GITHUB_WORKFLOW_REF: environment.GITHUB_WORKFLOW_REF.replace("/8/merge", "/8/head") },
  ]) assert.throws(() => createNativeCiIdentity({ ...environment, ...changed }, workflow));
  const privileged = Buffer.from(workflow.toString("utf8").replace("contents: read", "contents: write"));
  assert.throws(() => createNativeCiIdentity(environment, privileged));
  assert.throws(() => createNativeCiIdentity(environment, Buffer.alloc(64 * 1024 + 1)));
  assert.throws(() => createNativeCiIdentity(environment, Buffer.from([255])));
});
