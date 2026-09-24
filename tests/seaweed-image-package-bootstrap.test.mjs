import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SEAWEED_PACKAGE_BOOTSTRAP,
  parseBootstrapArguments,
  parsePublishedDigest,
  runSeaweedPackageBootstrap,
  sha256,
  validateBootstrapContext,
} from "../scripts/seaweed-image/package-bootstrap.mjs";

const sourceSha = "a".repeat(40);
const manifestDigest = `sha256:${"d".repeat(64)}`;

function fixture() {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), "aw-seaweed-package-bootstrap-"));
  const env = {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_JOB: "publish",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: SEAWEED_PACKAGE_BOOTSTRAP.repository,
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_RUN_ID: "35990000001",
    GITHUB_RUN_NUMBER: "1",
    GITHUB_SHA: sourceSha,
    GITHUB_TOKEN: "secret-token-value",
    GITHUB_WORKFLOW_REF: `${SEAWEED_PACKAGE_BOOTSTRAP.repository}/${SEAWEED_PACKAGE_BOOTSTRAP.workflowPath}@refs/heads/main`,
    GITHUB_WORKSPACE: runnerTemp,
    RUNNER_ENVIRONMENT: "github-hosted",
    RUNNER_OS: "Linux",
    RUNNER_TEMP: runnerTemp,
  };
  return { env, output: path.join(runnerTemp, SEAWEED_PACKAGE_BOOTSTRAP.outputDirectory), runnerTemp };
}

function mainResponse(sha = sourceSha) {
  return new globalThis.Response(JSON.stringify({ object: { type: "commit", sha } }), { status: 200 });
}

function commandRunner({ calls, failBuild = false } = { calls: [] }) {
  return (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd, env: options.env, input: options.input });
    if (command === "git") return { status: 0, stdout: `${sourceSha}\n`, stderr: "" };
    if (args[0] === "version") return { status: 0, stdout: "28.0.4|28.0.4\n", stderr: "" };
    if (args[0] === "buildx" && args[1] === "version") {
      return { status: 0, stdout: "github.com/docker/buildx v0.37.0\n", stderr: "" };
    }
    if (args[0] === "image" && args[1] === "inspect") {
      return { status: 1, stdout: "", stderr: "Error: No such image" };
    }
    if (args[0] === "login") return { status: 0, stdout: "Login Succeeded", stderr: "" };
    if (args[0] === "buildx" && args[1] === "build") {
      if (failBuild) return { status: 1, stdout: "", stderr: "build failed" };
      const metadataPath = args[args.indexOf("--metadata-file") + 1];
      writeFileSync(metadataPath, JSON.stringify({ "containerimage.digest": manifestDigest }));
      return { status: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected:${command}:${args.join(" ")}`);
  };
}

test("fixed bootstrap material is harmless, scratch-only and stable", () => {
  assert.equal(SEAWEED_PACKAGE_BOOTSTRAP.image, "ghcr.io/clemey15/auto-world-seaweedfs-s3");
  assert.equal(SEAWEED_PACKAGE_BOOTSTRAP.payload, "auto-world-seaweedfs-s3-package-bootstrap-v1\n");
  assert.match(SEAWEED_PACKAGE_BOOTSTRAP.dockerfile, /^FROM scratch\n/u);
  assert.doesNotMatch(SEAWEED_PACKAGE_BOOTSTRAP.dockerfile, /^(?:ADD|RUN)\s/mu);
  assert.doesNotMatch(SEAWEED_PACKAGE_BOOTSTRAP.dockerfile, /candidate/u);
  assert.equal(sha256(Buffer.from(SEAWEED_PACKAGE_BOOTSTRAP.payload)), "fc310f41ea257c6abcb9313460088793eba96809ce666d611952da16e6f54f66");
  assert.equal(sha256(Buffer.from(SEAWEED_PACKAGE_BOOTSTRAP.dockerfile)), "b73ebec2ccbc37e6a2c8e2354d3527a2eeb6a25ecf1ba6384f08d36bbaf603fd");
});

test("arguments, context and metadata reject alternate executions", () => {
  const item = fixture();
  try {
    assert.deepEqual(parseBootstrapArguments(["--output", item.output]), { output: item.output });
    assert.throws(() => parseBootstrapArguments(["--output", "relative"]), /arguments_invalid/u);
    assert.equal(validateBootstrapContext(item.env, "linux").sourceSha, sourceSha);
    for (const invalid of [
      { ...item.env, GITHUB_REF: "refs/heads/feature" },
      { ...item.env, GITHUB_RUN_NUMBER: "2" },
      { ...item.env, GITHUB_RUN_ATTEMPT: "2" },
      { ...item.env, GITHUB_WORKFLOW_REF: item.env.GITHUB_WORKFLOW_REF.replace("package-bootstrap", "other") },
      { ...item.env, RUNNER_ENVIRONMENT: "self-hosted" },
      { ...item.env, GITHUB_TOKEN: "" },
    ]) assert.throws(() => validateBootstrapContext(invalid, "linux"), /seaweed_package_bootstrap_/u);
    assert.equal(parsePublishedDigest({ "containerimage.digest": manifestDigest }), manifestDigest);
    for (const metadata of [{}, [], { "containerimage.digest": "sha256:short" }]) {
      assert.throws(() => parsePublishedDigest(metadata), /seaweed_package_bootstrap_/u);
    }
  } finally {
    rmSync(item.runnerTemp, { recursive: true, force: true });
  }
});

test("one-shot publisher uses fixed no-network scratch build and emits only a bounded receipt", async (context) => {
  const item = fixture();
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const calls = [];
  const receipt = await runSeaweedPackageBootstrap({
    argv: ["--output", item.output],
    commandRunner: commandRunner({ calls }),
    env: item.env,
    fetchImpl: async () => mainResponse(),
    platform: "linux",
  });
  assert.equal(receipt.state, "PUBLISHED_UNADMITTED");
  assert.equal(receipt.publication, "PUBLISHED_UNADMITTED");
  assert.equal(receipt.packageConfiguration, "NOT_VERIFIED");
  assert.equal(receipt.admission, "NOT_AUTHORIZED");
  assert.equal(receipt.forkAccessTest, "SKIPPED_BY_USER");
  assert.equal(receipt.manifestDigest, manifestDigest);
  assert.equal(receipt.subject, `${SEAWEED_PACKAGE_BOOTSTRAP.image}@${manifestDigest}`);
  assert.deepEqual(
    receipt.phases.map(({ name, result }) => [name, result]),
    [
      ["managed_tool_identity", "PASSED"],
      ["checkout_identity", "PASSED"],
      ["protected_main_identity", "PASSED"],
      ["local_collision_check", "PASSED"],
      ["fixed_scratch_materialization", "PASSED"],
      ["registry_login", "PASSED"],
      ["harmless_first_write", "PASSED"],
      ["no_local_image_retained", "PASSED"],
      ["owned_temporary_cleanup", "PASSED"],
    ],
  );
  const login = calls.find(({ args }) => args[0] === "login");
  assert.equal(login.input, `${item.env.GITHUB_TOKEN}\n`);
  assert.equal(login.args.includes(item.env.GITHUB_TOKEN), false);
  assert.equal(login.env.GITHUB_TOKEN, undefined);
  const build = calls.find(({ args }) => args[0] === "buildx" && args[1] === "build");
  assert.deepEqual(build.args.slice(0, 9), [
    "buildx", "build", "--platform", "linux/amd64", "--network=none", "--provenance=false", "--sbom=false", "--push", "--metadata-file",
  ]);
  assert.equal(build.args.includes(`${SEAWEED_PACKAGE_BOOTSTRAP.image}:bootstrap-${item.env.GITHUB_RUN_ID}`), true);
  assert.equal(existsSync(path.join(item.runnerTemp, `aw-seaweed-package-bootstrap-${item.env.GITHUB_RUN_ID}-attempt-1`)), false);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"))).sort(), Object.keys(receipt).sort());
  assert.equal(readFileSync(path.join(item.output, "receipt.json"), "utf8").includes(item.env.GITHUB_TOKEN), false);
});

test("failed or stale publication stays failed, redacted and cleaned", async (context) => {
  const failed = fixture();
  context.after(() => rmSync(failed.runnerTemp, { recursive: true, force: true }));
  await assert.rejects(runSeaweedPackageBootstrap({
    argv: ["--output", failed.output],
    commandRunner: commandRunner({ calls: [], failBuild: true }),
    env: failed.env,
    fetchImpl: async () => mainResponse(),
    platform: "linux",
  }), /command_failed/u);
  const receipt = readFileSync(path.join(failed.output, "receipt.json"), "utf8");
  assert.match(receipt, /"publication": "ATTEMPTED_OUTCOME_UNCONFIRMED"/u);
  assert.match(receipt, /"result": "FAILED"/u);
  assert.equal(receipt.includes(failed.env.GITHUB_TOKEN), false);
  assert.equal(existsSync(path.join(failed.runnerTemp, `aw-seaweed-package-bootstrap-${failed.env.GITHUB_RUN_ID}-attempt-1`)), false);

  const stale = fixture();
  context.after(() => rmSync(stale.runnerTemp, { recursive: true, force: true }));
  await assert.rejects(runSeaweedPackageBootstrap({
    argv: ["--output", stale.output],
    commandRunner: commandRunner({ calls: [] }),
    env: stale.env,
    fetchImpl: async () => mainResponse("b".repeat(40)),
    platform: "linux",
  }), /main_ref_mismatch/u);
  assert.equal(readFileSync(path.join(stale.output, "receipt.json"), "utf8").includes(stale.env.GITHUB_TOKEN), false);
});
