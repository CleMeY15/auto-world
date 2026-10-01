import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  POSTGRES_ATTESTATION_ACCESS, collectPostgresAttestationAccess,
  requirePostgresAttestationAccessContext, validatePostgresAttestationAccessReceipt,
  validatePostgresPackageControls, verifyPostgresAttestationAccessMain,
} from "../scripts/postgres-image/candidate-attestation-access.mjs";

const revision = "d".repeat(40);
const subject = POSTGRES_ATTESTATION_ACCESS.subject;
const digest = subject.split("@")[1];
const policyBytes = readFileSync(new URL("../infra/postgres-image/candidate-remote.json", import.meta.url));
const policy = Object.freeze(JSON.parse(policyBytes.toString("utf8")));
const controls = Object.freeze({ kind: "POSTGRES_PACKAGE_CONTROLS_V1", state: "OBSERVED",
  authority: "AUTHENTICATED_SETTINGS_UI_OBSERVATION", observedAt: "2026-10-01T10:06:00.000Z",
  observationSource: "AUTHENTICATED_GITHUB_SETTINGS_UI", observationPrecision: "MINUTE",
  liveApiAuthority: "NOT_ESTABLISHED",
  package: "ghcr.io/clemey15/auto-world-postgres-gosu", visibility: "Private",
  sourceRepository: "CleMeY15/auto-world", inheritSourcePermissions: true,
  actionsRepositories: [{ repository: "CleMeY15/auto-world", role: "Admin" }],
  codespacesRepositories: [], directMembers: [], forkAccessTest: "SKIPPED_BY_USER", forkIsolation: "NOT_VERIFIED" });
const rawManifest = "fixed-exact-remote-manifest";
const linuxOnly = process.platform === "linux" ? {} : { skip: "requires native Linux UID and filesystem semantics" };
const proof = Object.freeze({ digest, bytes: policy.manifest.bytes, state: "RAW_MANIFEST_VERIFIED",
  mediaType: policy.manifest.mediaType, config: policy.manifest.config, layers: policy.manifest.layers,
  baseLayerCount: policy.manifest.baseLayerCount, newLayerCount: policy.manifest.newLayerCount });

function fixture(runId = "50000000001") {
  const runnerTemp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "aw-pg-attest-access-")));
  const workspace = path.join(runnerTemp, "workspace"); mkdirSync(workspace, { mode: 0o700 });
  const env = { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_JOB: "access", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "CleMeY15/auto-world",
    GITHUB_WORKFLOW_REF: "CleMeY15/auto-world/.github/workflows/postgres-candidate-attest.yml@refs/heads/main",
    GITHUB_RUN_NUMBER: "1", GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: runId, GITHUB_SHA: revision,
    RUNNER_TEMP: runnerTemp, GITHUB_WORKSPACE: workspace, GITHUB_TOKEN: "test-secret", GH_TOKEN: "test-secret",
    PATH: "/usr/bin:/bin", HOME: runnerTemp };
  return { runnerTemp, workspace, env };
}

function response(sha = revision, protectedBranch = true) {
  return new globalThis.Response(JSON.stringify({ name: "main", protected: protectedBranch, commit: { sha } }),
    { status: 200, headers: { "content-type": "application/json" } });
}

function dependencies(item, options = {}) {
  const calls = []; let clock = Date.parse("2026-10-01T10:20:00.000Z");
  let manifestValidationCount = 0;
  const commandRunner = (command, args, commandOptions) => {
    calls.push({ command, args: [...args], env: commandOptions.env, input: commandOptions.input });
    if (command === "git") return { status: 0, stdout: args[0] === "status" ? "" : `${revision}\n`, stderr: "" };
    if (args[0] === "version") return { status: 0, stdout: "28.0.4|28.0.4\n", stderr: "" };
    if (args[0] === "buildx" && args[1] === "version") return { status: 0, stdout: "github.com/docker/buildx v0.25.0\n", stderr: "" };
    if (args[0] === "login") return { status: 0, stdout: "Login Succeeded\n", stderr: "" };
    if (args[0] === "buildx" && args[1] === "imagetools") {
      if (commandOptions.env.DOCKER_CONFIG.endsWith("docker-anonymous")) {
        return options.anonymous ?? { status: 1, stdout: "", stderr: "unauthorized: authentication required" };
      }
      return { status: 0, stdout: options.changedAfter && calls.filter((call) => call.args[1] === "imagetools").length > 2
        ? `${rawManifest}-changed` : rawManifest, stderr: "" };
    }
    throw new Error("unexpected_command");
  };
  return { calls, deps: { context: { platform: "linux", uid: process.getuid(), gid: process.getgid() },
    commandRunner, fetchImpl: async () => response(), now: () => new Date(clock += 1000),
    readCommitted: (relative) => relative.endsWith("package-controls.json")
      ? Buffer.from(JSON.stringify(options.controls ?? controls)) : policyBytes,
    policyValidator: (value) => value,
    manifestValidator: (raw) => {
      manifestValidationCount += 1;
      if (manifestValidationCount === 2 && options.poisonCleanup) {
        const work = path.join(item.runnerTemp, `postgres-attestation-access-${item.env.GITHUB_RUN_ID}-attempt-1`);
        symlinkSync(item.workspace, path.join(work, "docker-auth", "buildx", "foreign-link"), "dir");
      }
      if (raw !== rawManifest) throw new Error("postgres_remote_candidate_manifest_invalid");
      return proof;
    }, anonymousClassifier: options.anonymousClassifier ?? ((result) => {
      if (result.status === 1 && /unauthorized/u.test(result.stderr)) return "AUTHORIZATION_DENIED";
      throw new Error("package_registry_anonymous_remote_read_error");
    }) } };
}

test("context is fixed to the manual protected-main access job", linuxOnly, (context) => {
  const item = fixture(); context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const host = { platform: "linux", uid: process.getuid(), gid: process.getgid() };
  assert.equal(requirePostgresAttestationAccessContext(item.env, host).runId, item.env.GITHUB_RUN_ID);
  for (const change of [{ GITHUB_REPOSITORY: "attacker/fork" }, { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_JOB: "signer" }, { GITHUB_REF: "refs/heads/feature" }, { GITHUB_RUN_NUMBER: "2" },
    { GITHUB_RUN_ATTEMPT: "2" },
    { GITHUB_WORKFLOW_REF: "attacker/fork/.github/workflows/postgres-candidate-attest.yml@refs/heads/main" }]) {
    assert.throws(() => requirePostgresAttestationAccessContext({ ...item.env, ...change }, host), /context_invalid/u);
  }
  assert.throws(() => requirePostgresAttestationAccessContext(item.env, { ...host, uid: 0 }), /context_invalid/u);
});

test("main verification requires clean exact HEAD, protected current main and one token", linuxOnly, async (context) => {
  const item = fixture(); context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const selected = requirePostgresAttestationAccessContext(item.env,
    { platform: "linux", uid: process.getuid(), gid: process.getgid() });
  const runner = (_command, args) => ({ status: 0, stdout: args[0] === "status" ? "" : `${revision}\n`, stderr: "" });
  assert.equal(await verifyPostgresAttestationAccessMain(selected, item.env,
    { commandRunner: runner, fetchImpl: async () => response() }), true);
  await assert.rejects(verifyPostgresAttestationAccessMain(selected, item.env,
    { commandRunner: runner, fetchImpl: async () => response("e".repeat(40)) }), /main_invalid/u);
  const dirty = (_command, args) => ({ status: 0, stdout: args[0] === "status" ? "?? injected\n" : `${revision}\n`, stderr: "" });
  await assert.rejects(verifyPostgresAttestationAccessMain(selected, item.env,
    { commandRunner: dirty, fetchImpl: async () => response() }), /checkout_invalid/u);
  await assert.rejects(verifyPostgresAttestationAccessMain(selected, { ...item.env, GH_TOKEN: "other" },
    { commandRunner: runner, fetchImpl: async () => response() }), /environment_invalid/u);
});

test("collector reads only the fixed manifest around anonymous denial and removes credentials", linuxOnly, async (context) => {
  const item = fixture(); context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const selected = dependencies(item);
  const result = await collectPostgresAttestationAccess({ now: new Date("2026-10-01T10:19:59.000Z") },
    item.env, selected.deps);
  assert.equal(result.state, "VERIFIED");
  assert.equal(result.access.anonymous, "AUTHORIZATION_DENIED");
  assert.equal(result.access.manifestBytesIdentical, true);
  assert.equal(result.operations.imagePull, "NOT_ATTEMPTED");
  assert.equal(result.operations.signing, "NOT_ATTEMPTED");
  assert.equal(result.packageControls.observation.liveApiAuthority, "NOT_ESTABLISHED");
  const dockerCalls = selected.calls.filter((call) => call.command === "docker");
  assert.deepEqual(dockerCalls.filter((call) => call.args[0] === "buildx" && call.args[1] === "imagetools")
    .map((call) => call.env.DOCKER_CONFIG.endsWith("docker-anonymous") ? "anonymous" : "authorized"),
  ["authorized", "anonymous", "authorized"]);
  assert.equal(dockerCalls.some((call) => ["pull", "save", "run", "push"].includes(call.args[0])), false);
  assert.equal(existsSync(path.join(item.runnerTemp, `postgres-attestation-access-${item.env.GITHUB_RUN_ID}-attempt-1`)), false);
  const receipt = JSON.parse(readFileSync(path.join(item.runnerTemp,
    POSTGRES_ATTESTATION_ACCESS.outputDirectory, "access-receipt.json"), "utf8"));
  assert.deepEqual(validatePostgresAttestationAccessReceipt(receipt, policy,
    { runId: item.env.GITHUB_RUN_ID, recipeRevision: revision,
      controlsIdentity: { sha256: result.packageControls.sha256, bytes: result.packageControls.bytes } }), result);
  assert.doesNotMatch(JSON.stringify(receipt), /test-secret/u);
});

test("collector fails closed for public access, changed manifests and changed settings", linuxOnly, async (context) => {
  for (const [index, options, pattern] of [
    [0, { anonymous: { status: 0, stdout: rawManifest, stderr: "" } }, /anonymous_remote_read_error|privacy_invalid/u],
    [1, { changedAfter: true }, /manifest_invalid|manifest_changed/u],
    [2, { controls: { ...controls, visibility: "Public" } }, /controls_invalid/u],
  ]) {
    const item = fixture(`5000000001${index}`); context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
    const selected = dependencies(item, options);
    await assert.rejects(collectPostgresAttestationAccess({ now: new Date("2026-10-01T10:19:59.000Z") },
      item.env, selected.deps), pattern);
    assert.equal(existsSync(path.join(item.runnerTemp, `postgres-attestation-access-${item.env.GITHUB_RUN_ID}-attempt-1`)), false);
    assert.equal(existsSync(path.join(item.runnerTemp, POSTGRES_ATTESTATION_ACCESS.outputDirectory)), false);
  }
});

test("settings and receipt validators reject authority, fork and operation substitution", linuxOnly, async (context) => {
  for (const changed of [{ ...controls, liveApiAuthority: "VERIFIED" }, { ...controls, forkIsolation: "VERIFIED" },
    { ...controls, actionsRepositories: [] }, { ...controls, extra: true }]) {
    assert.throws(() => validatePostgresPackageControls(changed), /controls_invalid/u);
  }
  const item = fixture(); context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const selected = dependencies(item);
  const result = await collectPostgresAttestationAccess({ now: new Date("2026-10-01T10:19:59.000Z") },
    item.env, selected.deps);
  for (const changed of [
    { ...result, subject: `${subject}-changed` },
    { ...result, authority: "ADMISSION_AUTHORITY" },
    { ...result, operations: { ...result.operations, imagePull: "VERIFIED" } },
    { ...result, access: { ...result.access, forkIsolation: "VERIFIED" } },
    { ...result, packageControls: { ...result.packageControls,
      observation: { ...result.packageControls.observation, visibility: "Public" } } },
  ]) assert.throws(() => validatePostgresAttestationAccessReceipt(changed, policy,
    { runId: item.env.GITHUB_RUN_ID, recipeRevision: revision,
      controlsIdentity: { sha256: result.packageControls.sha256, bytes: result.packageControls.bytes } }),
  /receipt_invalid/u);

  const originalToJSON = Object.prototype.toJSON; let toJSONCalled = false;
  try {
    Object.prototype.toJSON = () => { toJSONCalled = true; throw new Error("inherited_toJSON_must_not_run"); };
    assert.throws(() => validatePostgresAttestationAccessReceipt(result, policy,
      { runId: item.env.GITHUB_RUN_ID, recipeRevision: revision,
        controlsIdentity: { sha256: result.packageControls.sha256, bytes: result.packageControls.bytes } }),
    /receipt_invalid/u);
    assert.equal(toJSONCalled, false);
  } finally {
    if (originalToJSON === undefined) delete Object.prototype.toJSON;
    else Object.prototype.toJSON = originalToJSON;
  }
  let getterCalled = false; const accessor = { ...result };
  Object.defineProperty(accessor, "subject", { enumerable: true, get() { getterCalled = true; return subject; } });
  assert.throws(() => validatePostgresAttestationAccessReceipt(accessor, policy,
    { runId: item.env.GITHUB_RUN_ID, recipeRevision: revision,
      controlsIdentity: { sha256: result.packageControls.sha256, bytes: result.packageControls.bytes } }),
  /receipt_invalid/u);
  assert.equal(getterCalled, false);
});

test("cleanup refuses a foreign replacement and reports primary plus cleanup failures", linuxOnly, async (context) => {
  const item = fixture("50000000020"); context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const selected = dependencies(item, { changedAfter: true, poisonCleanup: true });
  await assert.rejects(collectPostgresAttestationAccess({ now: new Date("2026-10-01T10:19:59.000Z") },
    item.env, selected.deps), (error) => {
    assert.equal(error.code, "postgres_attestation_access_cleanup_uncertain");
    assert.equal(error.primaryFailure, "postgres_remote_candidate_manifest_invalid");
    assert.equal(error.cleanupFailure, "postgres_attestation_access_cleanup_uncertain");
    return true;
  });
  const work = path.join(item.runnerTemp, `postgres-attestation-access-${item.env.GITHUB_RUN_ID}-attempt-1`);
  assert.equal(existsSync(path.join(work, "docker-auth", "buildx", "foreign-link")), true);
  assert.equal(existsSync(item.workspace), true);
});
