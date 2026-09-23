import assert from "node:assert/strict";
import test from "node:test";

import {
  readSeaweedGitHubApi,
  seaweedWorkflowSourceExpectation,
  TEST_ONLY_readSeaweedGitHubApi,
} from "../scripts/seaweed-image/github-api-read.mjs";

const policy = Object.freeze({
  owner: "CleMeY15",
  repo: "auto-world",
  runId: 35_884_717_093,
  workflowPath: ".github/workflows/seaweed-build.yml",
  workflowId: 358_072_544,
  commitSha: "6dbc6964e121e54dc5409f5e646f9ae25c01788f",
  artifactIds: Object.freeze([10_764_885_637, 10_764_820_767, 10_764_462_948, 10_764_417_203, 10_763_824_843]),
});

function successfulExecutor(calls, workflow = Buffer.alloc(seaweedWorkflowSourceExpectation.bytes, 0x61)) {
  return (command, args, options, callback) => {
    calls.push({ command, args, options });
    const endpoint = args.at(-1);
    const raw = args.includes("Accept: application/vnd.github.raw+json");
    globalThis.queueMicrotask(() => callback(null, raw ? workflow : Buffer.from(JSON.stringify({ endpoint })), Buffer.alloc(0)));
    return { pid: 1234 };
  };
}

test("reads the complete fixed GitHub evidence set with exact bounded gh arguments", async () => {
  const calls = [];
  const workflow = Buffer.alloc(seaweedWorkflowSourceExpectation.bytes, 0x5a);
  const result = await TEST_ONLY_readSeaweedGitHubApi(policy, { execFile: successfulExecutor(calls, workflow), timeoutMs: 10_000 });
  const root = "repos/CleMeY15/auto-world";
  const expectedEndpoints = [
    root,
    `${root}/commits/${policy.commitSha}`,
    `${root}/actions/runs/${policy.runId}`,
    `${root}/actions/runs/${policy.runId}/attempts/1`,
    `${root}/actions/workflows/${policy.workflowId}`,
    `${root}/contents/.github/workflows/seaweed-build.yml?ref=${policy.commitSha}`,
    `${root}/actions/runs/${policy.runId}/attempts/1/jobs?per_page=100`,
    `${root}/actions/runs/${policy.runId}/artifacts?per_page=100`,
    ...policy.artifactIds.map((id) => `${root}/actions/artifacts/${id}`),
    `${root}/actions/runs/${policy.runId}`,
    `${root}/actions/runs/${policy.runId}/attempts/1`,
  ];
  assert.deepEqual(calls.map(({ command }) => command), Array(expectedEndpoints.length).fill("TEST_ONLY_gh"));
  assert.deepEqual(calls.map(({ args }) => args.at(-1)), expectedEndpoints);
  for (const [index, call] of calls.entries()) {
    const accept = index === 5 ? "application/vnd.github.raw+json" : "application/vnd.github+json";
    assert.deepEqual(call.args.slice(0, -1), [
      "api", "--method", "GET", "--hostname", "github.com",
      "--header", `Accept: ${accept}`,
      "--header", "X-GitHub-Api-Version: 2022-11-28",
    ]);
    assert.equal(call.options.encoding, null);
    assert.equal(call.options.windowsHide, true);
    assert.equal(call.options.shell, false);
    assert.equal(call.options.timeout > 0 && call.options.timeout <= 10_000, true);
    assert.equal(call.options.signal instanceof globalThis.AbortSignal, true);
    assert.equal(JSON.stringify(call).includes("token"), false);
  }
  assert.deepEqual(result.workflowBytes, workflow);
  assert.equal(result.repository.endpoint, expectedEndpoints[0]);
  assert.equal(result.commit.endpoint, expectedEndpoints[1]);
  assert.equal(result.run.endpoint, expectedEndpoints[2]);
  assert.equal(result.runFinal.endpoint, expectedEndpoints.at(-2));
  assert.equal(result.attempt1Final.endpoint, expectedEndpoints.at(-1));
  assert.deepEqual(result.artifactRecords.map(({ endpoint }) => endpoint), expectedEndpoints.slice(8, 13));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.artifactRecords), true);
});

test("production entrypoint rejects command injection", async () => {
  await assert.rejects(readSeaweedGitHubApi(policy, { execFile() {} }), { code: "seaweed_github_api_options_invalid" });
});

test("rejects malformed or accessor-backed policies before invoking gh", async () => {
  let invoked = false;
  const execFile = () => { invoked = true; };
  const invalid = [
    { ...policy, owner: "github.com/CleMeY15" },
    { ...policy, workflowPath: "../workflow.yml" },
    { ...policy, commitSha: "main" },
    { ...policy, artifactIds: policy.artifactIds.slice(0, 4) },
    { ...policy, artifactIds: [1, 1, 2, 3, 4] },
  ];
  const accessor = { ...policy };
  Object.defineProperty(accessor, "owner", { get() { throw new Error("must_not_run"); } });
  invalid.push(accessor);
  for (const candidate of invalid) {
    await assert.rejects(TEST_ONLY_readSeaweedGitHubApi(candidate, { execFile }), { code: "seaweed_github_api_policy_invalid" });
  }
  assert.equal(invoked, false);
});

test("maps command failures without exposing stderr or credentials", async () => {
  const secret = "ghp_do_not_expose_this_value";
  const execFile = (_command, _args, _options, callback) => {
    const error = Object.assign(new Error(`remote failed ${secret}`), { code: 1 });
    globalThis.queueMicrotask(() => callback(error, Buffer.from(secret), Buffer.from(secret)));
    return {};
  };
  await assert.rejects(TEST_ONLY_readSeaweedGitHubApi(policy, { execFile }), (error) => {
    assert.equal(error.code, "seaweed_github_api_request_failed");
    assert.equal(String(error).includes(secret), false);
    return true;
  });
});

test("rejects invalid JSON with a fixed error", async () => {
  const execFile = (_command, _args, _options, callback) => {
    globalThis.queueMicrotask(() => callback(null, Buffer.from("not-json"), Buffer.alloc(0)));
    return {};
  };
  await assert.rejects(TEST_ONLY_readSeaweedGitHubApi(policy, { execFile }), { code: "seaweed_github_api_json_invalid" });
});

test("enforces the raw workflow output bound", async () => {
  const calls = [];
  const oversized = Buffer.alloc(64 * 1024 + 1);
  await assert.rejects(TEST_ONLY_readSeaweedGitHubApi(policy, {
    execFile: successfulExecutor(calls, oversized), timeoutMs: 10_000,
  }), { code: "seaweed_github_api_output_invalid" });
  assert.equal(calls.length, 6);
  assert.equal(calls.at(-1).options.maxBuffer, 64 * 1024);
});

test("aborts an active request without waiting for the command callback", async () => {
  const controller = new globalThis.AbortController();
  let childSignal;
  const execFile = (_command, _args, options) => {
    childSignal = options.signal;
    return {};
  };
  const pending = TEST_ONLY_readSeaweedGitHubApi(policy, { execFile, signal: controller.signal, timeoutMs: 10_000 });
  controller.abort(new Error("private abort reason"));
  await assert.rejects(pending, { code: "seaweed_github_api_aborted" });
  assert.equal(childSignal.aborted, true);
});

test("enforces one wall-clock timeout across the collection", async () => {
  let childSignal;
  const execFile = (_command, _args, options) => {
    childSignal = options.signal;
    return {};
  };
  await assert.rejects(TEST_ONLY_readSeaweedGitHubApi(policy, { execFile, timeoutMs: 10 }), {
    code: "seaweed_github_api_timeout",
  });
  assert.equal(childSignal.aborted, true);
});
