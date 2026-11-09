import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  TEST_ONLY_runScannerRetentionBootstrap,
  parseScannerRetentionArguments,
  validateScannerRetentionBootstrapContext,
} from "../scripts/scanner/retention-publish.mjs";
import { SCANNER_RETENTION, sha256 } from "../scripts/scanner/retention-policy.mjs";

const sourceSha = "a".repeat(40);
const sourceTree = "b".repeat(40);
const imageManifest = JSON.stringify({
  schemaVersion: 2,
  mediaType: "application/vnd.oci.image.manifest.v1+json",
  config: {
    mediaType: "application/vnd.oci.image.config.v1+json",
    digest: `sha256:${"c".repeat(64)}`,
    size: 512,
  },
  layers: [{
    mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
    digest: `sha256:${"d".repeat(64)}`,
    size: 1024,
  }],
});
const manifestDigest = `sha256:${sha256(Buffer.from(imageManifest))}`;

function fixture() {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), "aw-scanner-retention-bootstrap-"));
  const env = {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_JOB: SCANNER_RETENTION.bootstrap.job,
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: SCANNER_RETENTION.repository,
    GITHUB_RUN_ATTEMPT: String(SCANNER_RETENTION.bootstrap.runAttempt),
    GITHUB_RUN_ID: "42690000001",
    GITHUB_RUN_NUMBER: String(SCANNER_RETENTION.bootstrap.firstRunNumber),
    GITHUB_SHA: sourceSha,
    GITHUB_TOKEN: "test-token-never-retained",
    GITHUB_WORKFLOW_REF: `${SCANNER_RETENTION.repository}/${SCANNER_RETENTION.bootstrap.workflow}@refs/heads/main`,
    GITHUB_WORKFLOW_SHA: sourceSha,
    GITHUB_WORKSPACE: runnerTemp,
    RUNNER_ENVIRONMENT: "github-hosted",
    RUNNER_OS: "Linux",
    RUNNER_TEMP: runnerTemp,
    PATH: "/usr/local/bin:/usr/bin:/bin",
    DOCKER_HOST: "tcp://attacker.invalid:2375",
    HTTPS_PROXY: "https://attacker.invalid",
    HTTP_PROXY: "http://attacker.invalid",
    NO_PROXY: "*",
  };
  return {
    env,
    output: path.join(runnerTemp, SCANNER_RETENTION.bootstrap.outputDirectory),
    runnerTemp,
  };
}

function response(body, status = 200, headers = {}) {
  return new globalThis.Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

function fetchRouter(overrides = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (overrides[url]) return overrides[url](url, options);
    if (url.endsWith("/git/ref/heads/main")) return response({ object: { type: "commit", sha: sourceSha } });
    if (url.endsWith(`/git/commits/${sourceSha}`)) return response({ sha: sourceSha, tree: { sha: sourceTree } });
    if (url.endsWith("/packages/container/auto-world-scanner-closure")) return response({ message: "opaque" }, 404);
    throw new Error(`unexpected fetch: ${url}`);
  };
  return { calls, fetchImpl };
}

function commandHarness({ failBuild = false, dirty = false, retained = false, preexistingCollision = false } = {}) {
  const calls = [];
  let imageInspections = 0;
  const commandRunner = (command, args, options) => {
    calls.push({ command, args: [...args], cwd: options.cwd, env: { ...options.env }, input: options.input });
    if (command === "git") {
      if (args[0] === "rev-parse" && args[1] === "HEAD") return { status: 0, stdout: `${sourceSha}\n`, stderr: "" };
      if (args[0] === "rev-parse" && args[1] === "HEAD^{tree}") return { status: 0, stdout: `${sourceTree}\n`, stderr: "" };
      if (args[0] === "status") return { status: 0, stdout: dirty ? "?? hostile\n" : "", stderr: "" };
    }
    if (command === "docker" && args[0] === "version") return { status: 0, stdout: "28.0.4|28.0.4\n", stderr: "" };
    if (command === "docker" && args[0] === "buildx" && args[1] === "version") {
      return { status: 0, stdout: "github.com/docker/buildx v0.37.0\n", stderr: "" };
    }
    if (command === "docker" && args[0] === "buildx" && args[1] === "inspect" && args.length === 2) {
      return { status: 0, stdout: "Name: default\nBuildKit: v0.25.1\n", stderr: "" };
    }
    if (command === "docker" && args[0] === "image" && args[1] === "inspect") {
      imageInspections += 1;
      if (preexistingCollision) return { status: 0, stdout: "[]", stderr: "" };
      if (retained && imageInspections >= 2) return { status: 0, stdout: "[]", stderr: "" };
      return { status: 1, stdout: "", stderr: "Error: No such image" };
    }
    if (command === "docker" && args[0] === "image" && args[1] === "rm") {
      retained = false;
      return { status: 0, stdout: "removed\n", stderr: "" };
    }
    if (command === "docker" && args[0] === "login") return { status: 0, stdout: "Login Succeeded\n", stderr: "" };
    if (command === "docker" && args[0] === "buildx" && args[1] === "build") {
      if (failBuild) return { status: 1, stdout: "", stderr: "build failed" };
      const metadata = args[args.indexOf("--metadata-file") + 1];
      writeFileSync(metadata, JSON.stringify({ "containerimage.digest": manifestDigest }));
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "docker" && args[0] === "buildx" && args[1] === "imagetools") {
      return { status: 0, stdout: imageManifest, stderr: "" };
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };
  return { calls, commandRunner };
}

function options(item, commands, api, extras = {}) {
  return {
    output: item.output,
    commandRunner: commands.commandRunner,
    env: item.env,
    fetchImpl: api.fetchImpl,
    platform: "linux",
    statfs: () => ({ bavail: 128n, bsize: 1024n ** 2n }),
    ...extras,
  };
}

test("bootstrap material and closed one-shot interface match the approved policy", () => {
  const bootstrap = SCANNER_RETENTION.bootstrap;
  assert.deepEqual(parseScannerRetentionArguments(["bootstrap", "--output", path.resolve("scanner-retention-bootstrap")]), {
    mode: "bootstrap",
    output: path.resolve("scanner-retention-bootstrap"),
  });
  assert.throws(() => parseScannerRetentionArguments(["read-proof", "--output", path.resolve("x")]), /mode_not_implemented/u);
  assert.throws(() => parseScannerRetentionArguments(["publish", "--output", path.resolve("x")]), /mode_not_implemented/u);
  assert.throws(() => parseScannerRetentionArguments(["bootstrap", "--output", "relative"]), /arguments_invalid/u);
  assert.equal(Buffer.byteLength(bootstrap.payload.text), 48);
  assert.equal(Buffer.byteLength(bootstrap.recipe.text), 227);
  assert.equal(bootstrap.payload.bytes + bootstrap.recipe.bytes, 275);
  assert.equal(sha256(Buffer.from(bootstrap.payload.text)), bootstrap.payload.sha256);
  assert.equal(sha256(Buffer.from(bootstrap.recipe.text)), bootstrap.recipe.sha256);
  assert.match(bootstrap.recipe.text, /^FROM scratch\nCOPY bootstrap\.txt \/bootstrap\.txt\n/u);
  assert.doesNotMatch(bootstrap.recipe.text, /^(?:ADD|RUN)\s/mu);
});

test("context is protected-main, first-run, first-attempt and workflow-SHA bound", () => {
  const item = fixture();
  try {
    assert.equal(validateScannerRetentionBootstrapContext(item.env, "linux").sourceSha, sourceSha);
    for (const changed of [
      { GITHUB_RUN_NUMBER: "2" },
      { GITHUB_RUN_ATTEMPT: "2" },
      { GITHUB_WORKFLOW_SHA: "c".repeat(40) },
      { GITHUB_WORKFLOW_REF: item.env.GITHUB_WORKFLOW_REF.replace("package-bootstrap", "publish") },
      { GITHUB_JOB: "publish" },
      { GITHUB_REF: "refs/heads/feature" },
      { RUNNER_ENVIRONMENT: "self-hosted" },
      { GITHUB_TOKEN: "" },
      { PATH: "" },
    ]) assert.throws(() => validateScannerRetentionBootstrapContext({ ...item.env, ...changed }, "linux"), /scanner_retention_bootstrap_/u);
  } finally {
    rmSync(item.runnerTemp, { recursive: true, force: true });
  }
});

test("bootstrap performs the exact bounded write, digest readback and redacted cleanup", async (context) => {
  const item = fixture();
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const commands = commandHarness();
  const api = fetchRouter();
  const receipt = await TEST_ONLY_runScannerRetentionBootstrap(options(item, commands, api));

  assert.equal(receipt.state, "PUBLISHED_UNADMITTED");
  assert.equal(receipt.result, "PASSED");
  assert.equal(receipt.headTree, sourceTree);
  assert.equal(receipt.tag, `${SCANNER_RETENTION.package}:bootstrap-v1-run-${item.env.GITHUB_RUN_ID}`);
  assert.equal(receipt.subject, `${SCANNER_RETENTION.package}@${manifestDigest}`);
  assert.equal(receipt.access.packageLookup, "NOT_FOUND_OPAQUE");
  assert.equal(receipt.access.existingVersions, "NOT_VERIFIED");
  assert.equal(receipt.access.manifestDigest, manifestDigest);
  assert.equal(receipt.access.layerBytes, 1024);
  assert.deepEqual(receipt.phases.map(({ name, result }) => [name, result]), [
    ["runner_capacity", "PASSED"],
    ["checkout_identity", "PASSED"],
    ["protected_main_identity", "PASSED"],
    ["direct_package_prewrite_lookup", "PASSED"],
    ["managed_tool_identity", "PASSED"],
    ["local_collision_check", "PASSED"],
    ["fixed_scratch_materialization", "PASSED"],
    ["registry_login", "PASSED"],
    ["harmless_first_write", "PASSED"],
    ["authenticated_digest_readback", "PASSED"],
    ["no_local_image_retained", "PASSED"],
    ["owned_cleanup", "PASSED"],
  ]);
  assert.deepEqual(receipt.cleanup, { state: "PASSED", ownedPathRemoved: true, ownedLocalImage: "ABSENT" });
  assert.equal(receipt.claims.scannerExecuted, false);
  assert.equal(receipt.claims.admitted, false);

  const login = commands.calls.find(({ args }) => args[0] === "login");
  assert.equal(login.input, `${item.env.GITHUB_TOKEN}\n`);
  assert.equal(login.args.includes(item.env.GITHUB_TOKEN), false);
  for (const call of commands.calls) {
    assert.equal(call.env.GITHUB_TOKEN, undefined);
    assert.equal(call.env.DOCKER_HOST, undefined);
    assert.equal(call.env.HTTPS_PROXY, undefined);
    assert.equal(call.env.HTTP_PROXY, undefined);
    assert.equal(call.env.NO_PROXY, undefined);
  }
  const build = commands.calls.find(({ args }) => args[0] === "buildx" && args[1] === "build");
  assert.deepEqual(build.args.slice(0, 9), [
    "buildx", "build", "--platform", "linux/amd64", "--network=none", "--provenance=false", "--sbom=false", "--push", "--metadata-file",
  ]);
  assert.equal(build.args.includes(receipt.tag), true);
  assert.equal(build.args.at(-1).endsWith(`${path.sep}context`), true);
  assert.equal(existsSync(path.join(item.runnerTemp, `aw-scanner-retention-bootstrap-${item.env.GITHUB_RUN_ID}-attempt-1`)), false);

  const receiptBytes = readFileSync(path.join(item.output, "receipt.json"));
  assert.ok(receiptBytes.length <= SCANNER_RETENTION.bootstrap.receiptCapBytes);
  assert.equal(receiptBytes.at(-1), 0x0a);
  assert.equal(receiptBytes.toString("utf8").includes("\n", 0), true);
  assert.equal(receiptBytes.toString("utf8").split("\n").length, 2);
  assert.equal(receiptBytes.includes(Buffer.from(item.env.GITHUB_TOKEN)), false);
  assert.deepEqual(Object.keys(JSON.parse(receiptBytes)), [
    "schemaVersion", "state", "result", "repository", "workflow", "runId", "runAttempt", "headSha", "headTree", "package", "tag", "subject", "payload", "recipe", "access", "phases", "cleanup", "claims",
  ]);
  assert.equal(api.calls.length, 3);
  for (const call of api.calls) {
    assert.equal(call.options.redirect, "error");
    assert.equal(call.options.headers.Authorization, `Bearer ${item.env.GITHUB_TOKEN}`);
  }
});

test("an existing or ambiguous package version refuses before login or write", async (context) => {
  const item = fixture();
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const commands = commandHarness();
  const packageUrl = "https://api.github.com/users/CleMeY15/packages/container/auto-world-scanner-closure";
  const api = fetchRouter({
    [packageUrl]: () => response({
      id: 42,
      name: "auto-world-scanner-closure",
      package_type: "container",
      visibility: "private",
      url: packageUrl,
      owner: { login: "CleMeY15" },
      repository: { full_name: SCANNER_RETENTION.repository },
    }),
    [`${packageUrl}/versions?per_page=2&page=1`]: () => response([{ id: 99 }]),
  });
  await assert.rejects(TEST_ONLY_runScannerRetentionBootstrap(options(item, commands, api)), /existing_versions_ambiguous/u);
  assert.equal(commands.calls.some(({ args }) => args[0] === "login"), false);
  assert.equal(commands.calls.some(({ args }) => args[0] === "buildx" && args[1] === "build"), false);
  const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
  assert.equal(receipt.result, "FAILED");
  assert.equal(receipt.phases.find(({ name }) => name === "direct_package_prewrite_lookup").reason, "scanner_retention_bootstrap_existing_versions_ambiguous");
});

test("dirty checkout, redirected or oversized API bodies and insufficient headroom fail closed with receipts", async (context) => {
  const dirty = fixture();
  context.after(() => rmSync(dirty.runnerTemp, { recursive: true, force: true }));
  await assert.rejects(TEST_ONLY_runScannerRetentionBootstrap(options(dirty, commandHarness({ dirty: true }), fetchRouter())), /checkout_identity_invalid/u);
  assert.equal(JSON.parse(readFileSync(path.join(dirty.output, "receipt.json"), "utf8")).result, "FAILED");

  const redirected = fixture();
  context.after(() => rmSync(redirected.runnerTemp, { recursive: true, force: true }));
  const redirectApi = fetchRouter({
    "https://api.github.com/repos/CleMeY15/auto-world/git/ref/heads/main": () => response("redirect", 302, { location: "https://attacker.invalid" }),
  });
  await assert.rejects(TEST_ONLY_runScannerRetentionBootstrap(options(redirected, commandHarness(), redirectApi)), /api_status_ambiguous/u);

  const oversized = fixture();
  context.after(() => rmSync(oversized.runnerTemp, { recursive: true, force: true }));
  const oversizedApi = fetchRouter({
    "https://api.github.com/repos/CleMeY15/auto-world/git/ref/heads/main": () => response(
      { object: { type: "commit", sha: sourceSha } },
      200,
      { "content-length": String(SCANNER_RETENTION.bootstrap.commandOutputCapBytes + 1) },
    ),
  });
  await assert.rejects(TEST_ONLY_runScannerRetentionBootstrap(options(oversized, commandHarness(), oversizedApi)), /api_response_invalid/u);

  const capacity = fixture();
  context.after(() => rmSync(capacity.runnerTemp, { recursive: true, force: true }));
  await assert.rejects(TEST_ONLY_runScannerRetentionBootstrap(options(capacity, commandHarness(), fetchRouter(), {
    statfs: () => ({ bavail: 1n, bsize: 1n }),
  })), /capacity_insufficient/u);
  const capacityReceipt = JSON.parse(readFileSync(path.join(capacity.output, "receipt.json"), "utf8"));
  assert.equal(capacityReceipt.access.capacity.observedFreeBytes, 1);
});

test("failed write is outcome-unconfirmed, redacted and scoped-cleaned", async (context) => {
  const item = fixture();
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  await assert.rejects(TEST_ONLY_runScannerRetentionBootstrap(options(item, commandHarness({ failBuild: true }), fetchRouter())), /command_failed/u);
  const receiptText = readFileSync(path.join(item.output, "receipt.json"), "utf8");
  const receipt = JSON.parse(receiptText);
  assert.equal(receipt.state, "WRITE_STARTED_OUTCOME_UNCONFIRMED");
  assert.equal(receipt.access.write, "ATTEMPTED_OUTCOME_UNCONFIRMED");
  assert.equal(receipt.subject, null);
  assert.equal(receipt.cleanup.state, "PASSED");
  assert.equal(receiptText.includes(item.env.GITHUB_TOKEN), false);
});

test("a preexisting local collision is refused and never treated as an owned cleanup object", async (context) => {
  const item = fixture();
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const commands = commandHarness({ preexistingCollision: true });
  await assert.rejects(TEST_ONLY_runScannerRetentionBootstrap(options(item, commands, fetchRouter())), /local_collision/u);
  assert.equal(commands.calls.some(({ args }) => args[0] === "image" && args[1] === "rm"), false);
  const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
  assert.equal(receipt.cleanup.ownedLocalImage, "NOT_CREATED");
  assert.equal(receipt.cleanup.ownedPathRemoved, true);
});

test("a cleanup failure preserves the confirmed immutable subject in the bounded receipt", async (context) => {
  const item = fixture();
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  await assert.rejects(TEST_ONLY_runScannerRetentionBootstrap(options(item, commandHarness(), fetchRouter(), {
    removeOwnedPath: () => { throw new Error("simulated cleanup refusal"); },
  })), /command_failed/u);
  const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
  assert.equal(receipt.result, "FAILED");
  assert.equal(receipt.state, "PUBLISHED_UNADMITTED");
  assert.equal(receipt.subject, `${SCANNER_RETENTION.package}@${manifestDigest}`);
  assert.equal(receipt.access.manifestDigest, manifestDigest);
  assert.equal(receipt.cleanup.state, "FAILED");
  assert.equal(receipt.cleanup.ownedPathRemoved, false);
});
