import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  TEST_ONLY_defaultCommandRunner,
  TEST_ONLY_runScannerRetentionReadProof,
  validateScannerRetentionReadProofBinding,
} from "../scripts/scanner/retention-publish.mjs";
import { SCANNER_RETENTION, sha256 } from "../scripts/scanner/retention-policy.mjs";

const sourceSha = "a".repeat(40);
const sourceTree = "b".repeat(40);
const configDigest = `sha256:${"c".repeat(64)}`;
const layerDigest = `sha256:${"d".repeat(64)}`;
const containerId = "e".repeat(64);
const baselineImage = `sha256:${"f".repeat(64)}`;
const baselineContainer = "1".repeat(64);
const childManifest = JSON.stringify({
  schemaVersion: 2,
  mediaType: "application/vnd.oci.image.manifest.v1+json",
  config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: configDigest, size: 512 },
  layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", digest: layerDigest, size: 1024 }],
});
const childManifestDigest = `sha256:${sha256(Buffer.from(childManifest))}`;
const indexManifest = JSON.stringify({
  schemaVersion: 2,
  mediaType: "application/vnd.oci.image.index.v1+json",
  manifests: [{
    mediaType: "application/vnd.oci.image.manifest.v1+json",
    digest: childManifestDigest,
    size: Buffer.byteLength(childManifest),
    platform: { os: "linux", architecture: "amd64" },
  }],
});
const manifestDigest = `sha256:${sha256(Buffer.from(indexManifest))}`;

function binding({ direct = false } = {}) {
  const readProof = JSON.parse(JSON.stringify(SCANNER_RETENTION.readProof));
  const boundManifestDigest = direct ? childManifestDigest : manifestDigest;
  const boundManifestBytes = direct ? Buffer.byteLength(childManifest) : Buffer.byteLength(indexManifest);
  Object.assign(readProof.bootstrap, {
    runId: 42690000002,
    runAttempt: 1,
    headSha: "9".repeat(40),
    headTree: "8".repeat(40),
    artifactId: 13710000001,
    artifactName: "scanner-retention-bootstrap-42690000002-1",
    artifactDigest: `sha256:${"2".repeat(64)}`,
    receiptBytes: 4096,
    receiptSha256: "3".repeat(64),
    tag: `${SCANNER_RETENTION.package}:bootstrap-v1-run-42690000002`,
    subject: `${SCANNER_RETENTION.package}@${boundManifestDigest}`,
    manifestDigest: boundManifestDigest,
    manifestBytes: boundManifestBytes,
    childManifestDigest: direct ? null : childManifestDigest,
    childManifestBytes: direct ? null : Buffer.byteLength(childManifest),
    configBytes: 512,
    layerBytes: 1024,
  });
  Object.assign(readProof.packageSettings, {
    packageId: 15410001,
    visibility: "Private",
    repository: SCANNER_RETENTION.repository,
    inheritance: false,
    actionsGrant: "ADMIN",
    proofSha256: "4".repeat(64),
  });
  return readProof;
}

function fixture() {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), "aw-scanner-retention-read-"));
  const env = {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_JOB: SCANNER_RETENTION.readProof.job,
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: SCANNER_RETENTION.repository,
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_RUN_ID: "42690000003",
    GITHUB_RUN_NUMBER: "1",
    GITHUB_SHA: sourceSha,
    GITHUB_TOKEN: "test-token-never-retained",
    GITHUB_WORKFLOW_REF: `${SCANNER_RETENTION.repository}/${SCANNER_RETENTION.readProof.workflow}@refs/heads/main`,
    GITHUB_WORKFLOW_SHA: sourceSha,
    GITHUB_WORKSPACE: runnerTemp,
    RUNNER_ENVIRONMENT: "github-hosted",
    RUNNER_OS: "Linux",
    RUNNER_TEMP: runnerTemp,
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HTTPS_PROXY: "https://attacker.invalid",
  };
  return { env, output: path.join(runnerTemp, SCANNER_RETENTION.readProof.outputDirectory), runnerTemp };
}

function response(body) {
  return new globalThis.Response(JSON.stringify(body), { status: 200 });
}

function fetchImpl(url) {
  if (url.endsWith("/git/ref/heads/main")) return response({ object: { type: "commit", sha: sourceSha } });
  if (url.endsWith(`/git/commits/${sourceSha}`)) return response({ sha: sourceSha, tree: { sha: sourceTree } });
  throw new Error(`unexpected fetch: ${url}`);
}

function commandHarness({
  anonymousNetworkError = false,
  copiedPayload = SCANNER_RETENTION.bootstrap.payload.text,
  direct = false,
  duplicateBaselineImage = false,
  failPull = false,
  oversizedCommandOutput = false,
} = {}) {
  const calls = [];
  let imagePresent = false;
  let containerPresent = false;
  const subjectDigest = direct ? childManifestDigest : manifestDigest;
  const subject = `${SCANNER_RETENTION.package}@${subjectDigest}`;
  const imageJson = () => JSON.stringify({
    Id: configDigest,
    Os: "linux",
    Architecture: "amd64",
    Size: 2048,
    RepoTags: [],
    RepoDigests: [subject],
    Config: { Labels: {
      "org.opencontainers.image.source": "https://github.com/CleMeY15/auto-world",
      "org.opencontainers.image.description": "Harmless scanner closure package bootstrap; not runtime",
    } },
  });
  const containerJson = () => JSON.stringify({
    Id: containerId,
    Name: `/aw-scanner-retention-read-42690000003`,
    Image: configDigest,
    Config: {
      Image: subject,
      Cmd: ["/bootstrap.txt"],
      Labels: {
        "org.opencontainers.image.source": "https://github.com/CleMeY15/auto-world",
        "org.opencontainers.image.description": "Harmless scanner closure package bootstrap; not runtime",
        "org.auto-world.scanner-retention-read-owner": `${sourceSha}:42690000003:1`,
      },
    },
    State: { Running: false, Status: "created" },
    HostConfig: {
      NetworkMode: "none",
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges=true"],
    },
    Mounts: [],
  });
  const commandRunner = (command, args, options) => {
    calls.push({ command, args: [...args], cwd: options.cwd, env: { ...options.env }, input: options.input,
      timeout: options.timeout, failurePrefix: options.failurePrefix });
    if (command === "git") {
      if (args[0] === "rev-parse" && args[1] === "HEAD") return { status: 0, stdout: `${sourceSha}\n`, stderr: "" };
      if (args[0] === "rev-parse" && args[1] === "HEAD^{tree}") return { status: 0, stdout: `${sourceTree}\n`, stderr: "" };
      if (args[0] === "status") return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "docker" && args[0] === "version") return {
      status: 0,
      stdout: oversizedCommandOutput ? "x".repeat(SCANNER_RETENTION.readProof.commandOutputCapBytes + 1) : "28.0.4|28.0.4\n",
      stderr: "",
    };
    if (command === "docker" && args[0] === "buildx" && args[1] === "version") {
      return { status: 0, stdout: "github.com/docker/buildx v0.37.0\n", stderr: "" };
    }
    if (command === "docker" && args[0] === "login") return { status: 0, stdout: "Login Succeeded\n", stderr: "" };
    if (command === "docker" && args[0] === "buildx" && args[1] === "imagetools") {
      if (options.env.DOCKER_CONFIG.includes("anonymous")) {
        return anonymousNetworkError
          ? { status: 1, stdout: "", stderr: "dial tcp: network timeout" }
          : { status: 1, stdout: "", stderr: "unauthorized: authentication required" };
      }
      return { status: 0, stdout: direct || args.at(-1).endsWith(childManifestDigest) ? childManifest : indexManifest, stderr: "" };
    }
    if (command === "docker" && args[0] === "image" && args[1] === "ls") {
      const baseline = duplicateBaselineImage ? `${baselineImage}\n${baselineImage}` : baselineImage;
      return { status: 0, stdout: `${baseline}${imagePresent ? `\n${configDigest}` : ""}\n`, stderr: "" };
    }
    if (command === "docker" && args[0] === "container" && args[1] === "ls") {
      return { status: 0, stdout: `${baselineContainer}${containerPresent ? `\n${containerId}` : ""}\n`, stderr: "" };
    }
    if (command === "docker" && args[0] === "image" && args[1] === "inspect") {
      return imagePresent
        ? { status: 0, stdout: args.includes("--format") ? imageJson() : "[]", stderr: "" }
        : { status: 1, stdout: "", stderr: "Error: No such image" };
    }
    if (command === "docker" && args[0] === "container" && args[1] === "inspect") {
      return containerPresent
        ? { status: 0, stdout: args.includes("--format") ? containerJson() : "[]", stderr: "" }
        : { status: 1, stdout: "", stderr: "Error: No such container" };
    }
    if (command === "docker" && args[0] === "pull") {
      if (failPull) return { status: 1, stdout: "", stderr: "simulated command failure" };
      imagePresent = true;
      return { status: 0, stdout: "pulled\n", stderr: "" };
    }
    if (command === "docker" && args[0] === "create") {
      containerPresent = true;
      return { status: 0, stdout: `${containerId}\n`, stderr: "" };
    }
    if (command === "docker" && args[0] === "cp") {
      writeFileSync(args[2], copiedPayload);
      return { status: 0, stdout: "", stderr: "" };
    }
    if (command === "docker" && args[0] === "rm") {
      containerPresent = false;
      return { status: 0, stdout: `${containerId}\n`, stderr: "" };
    }
    if (command === "docker" && args[0] === "image" && args[1] === "rm") {
      imagePresent = false;
      return { status: 0, stdout: configDigest, stderr: "" };
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };
  return { calls, commandRunner };
}

test("the process adapter enforces the caller's bounded timeout", () => {
  const started = Date.now();
  const result = TEST_ONLY_defaultCommandRunner(process.execPath, ["-e", "setTimeout(() => {}, 2000)"], {
    cwd: process.cwd(), env: process.env, timeout: 50,
  });
  assert.equal(result.error?.code, "ETIMEDOUT");
  assert.ok(Date.now() - started < 1_500);
});

function options(item, commands, extras = {}) {
  const { bindingValue = binding(), ...rest } = extras;
  return {
    output: item.output,
    binding: bindingValue,
    commandRunner: commands.commandRunner,
    env: item.env,
    fetchImpl,
    platform: "linux",
    ...rest,
  };
}

test("production read proof is bound to the reviewed bootstrap and package settings evidence", () => {
  const validated = validateScannerRetentionReadProofBinding();
  assert.equal(validated.bootstrap.runId, "42712603501");
  assert.equal(validated.bootstrap.artifactId, 13717120609);
  assert.equal(validated.bootstrap.receiptSha256, "d80c35dec4b7938fdb57b1c3028f850431c0fc54768ff4f40b3a4218fed96e03");
  assert.equal(validated.bootstrap.manifestDigest, "sha256:4d3bbf4b6b397254a470193dadd6265989379a472e0508adb05ede68dca4786f");
  assert.deepEqual(validated.packageSettings, {
    packageId: 16732127,
    visibility: "Private",
    repository: "CleMeY15/auto-world",
    inheritance: true,
    actionsGrant: "ADMIN",
    proofSha256: "799071c5ed9453d11bf2a7df2195c584fbdd6cd8e46f54aabceee54b97493a84",
  });
});

test("one missing actual binding refuses before commands or output", async () => {
  const incomplete = JSON.parse(JSON.stringify(SCANNER_RETENTION.readProof));
  incomplete.bootstrap.receiptSha256 = null;
  assert.throws(() => validateScannerRetentionReadProofBinding(incomplete), /binding_unbound/u);
  const item = fixture();
  try {
    await assert.rejects(TEST_ONLY_runScannerRetentionReadProof({
      output: item.output, binding: incomplete, env: item.env, platform: "linux",
      commandRunner: () => assert.fail("must not run"), fetchImpl,
    }), /binding_unbound/u);
    assert.equal(existsSync(item.output), false);
  } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
});

test("invalid read directories use read-proof reasons before any side effect", async () => {
  for (const [key, reason] of [["GITHUB_WORKSPACE", "workspace_invalid"], ["RUNNER_TEMP", "runner_temp_invalid"]]) {
    const item = fixture();
    try {
      item.env[key] = path.join(item.runnerTemp, "missing");
      await assert.rejects(TEST_ONLY_runScannerRetentionReadProof(options(item, commandHarness(), {
        commandRunner: () => assert.fail("must not run"),
      })), { message: `scanner_retention_read_proof_${reason}` });
      assert.equal(existsSync(item.output), false);
    } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
  }
});

test("read proof accepts only the observed published failed-bootstrap recovery outcome", () => {
  const changed = [
    { failedPhase: "authenticated_digest_readback" },
    { publication: "WRITE_STARTED_OUTCOME_UNCONFIRMED" },
    { cleanup: "FAILED" },
  ];
  for (const outcome of changed) {
    const candidate = binding();
    Object.assign(candidate.bootstrapOutcome, outcome);
    assert.throws(() => validateScannerRetentionReadProofBinding(candidate), /binding_invalid/u);
  }
});

test("fixed read proof authenticates twice, denies anonymous access and copies from a never-started container", async () => {
  const item = fixture();
  const commands = commandHarness();
  try {
    const receipt = await TEST_ONLY_runScannerRetentionReadProof(options(item, commands));
    assert.equal(receipt.result, "PASSED");
    assert.equal(receipt.state, "PRIVATE_READ_PROOF");
    assert.equal(receipt.access.anonymousRead, "AUTHORIZATION_DENIED");
    assert.deepEqual(receipt.access.bootstrapOutcome, SCANNER_RETENTION.readProof.bootstrapOutcome);
    assert.deepEqual(receipt.access.copiedPayload, {
      path: "/bootstrap.txt", bytes: 48, sha256: SCANNER_RETENTION.bootstrap.payload.sha256,
    });
    assert.deepEqual(receipt.cleanup, { state: "PASSED", container: "REMOVED", image: "REMOVED", ownedPathRemoved: true });
    assert.equal(receipt.claims.scannerExecuted, false);
    assert.equal(receipt.claims.admitted, false);
    assert.equal(receipt.claims.forkAccessTest, "SKIPPED_BY_USER");
    assert.equal(receipt.claims.forkIsolation, "NOT_VERIFIED");
    const receiptBytes = readFileSync(path.join(item.output, "receipt.json"));
    assert.equal(receiptBytes.length <= 65536, true);
    assert.equal(receiptBytes.at(-1), 10);
    assert.equal(receiptBytes.toString("utf8").includes(item.env.GITHUB_TOKEN), false);
    assert.deepEqual(Object.keys(JSON.parse(receiptBytes)), [
      "schemaVersion", "state", "result", "repository", "workflow", "runId", "runAttempt", "headSha", "headTree",
      "package", "tag", "subject", "payload", "recipe", "access", "phases", "cleanup", "claims",
    ]);
    const logins = commands.calls.filter(({ args }) => args[0] === "login");
    assert.equal(logins.length, 1);
    assert.equal(logins[0].input, `${item.env.GITHUB_TOKEN}\n`);
    for (const call of commands.calls) {
      assert.equal("HTTPS_PROXY" in call.env, false);
      if (call.args[0] !== "login") assert.equal(call.input, undefined);
    }
    const configs = new Set(commands.calls.filter(({ command }) => command === "docker").map(({ env }) => env.DOCKER_CONFIG));
    assert.equal([...configs].some((value) => value.includes("authenticated")), true);
    assert.equal([...configs].some((value) => value.includes("anonymous")), true);
    assert.equal(commands.calls.some(({ args }) => args[0] === "start" || args[0] === "run"), false);
    assert.equal(commands.calls.some(({ args }) => args.includes("/bootstrap.txt") && args[0] === "cp"), false);
    assert.equal(commands.calls.some(({ args }) => args[0] === "cp" && args[1].endsWith(":/bootstrap.txt")), true);
  } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
});

test("a direct single-platform manifest is accepted with an explicit null child binding", async () => {
  const item = fixture();
  const commands = commandHarness({ direct: true });
  try {
    const receipt = await TEST_ONLY_runScannerRetentionReadProof(options(item, commands, {
      bindingValue: binding({ direct: true }),
    }));
    assert.equal(receipt.result, "PASSED");
    assert.equal(receipt.access.authorizedManifestBefore.childManifestDigest, null);
    assert.equal(receipt.access.authorizedManifestBefore.childManifestBytes, null);
    assert.equal(commands.calls.filter(({ args }) => args[0] === "buildx" && args[1] === "imagetools").length, 3);
  } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
});

test("duplicate image IDs from multiple local tags preserve the baseline inventory", async () => {
  const item = fixture();
  const commands = commandHarness({ duplicateBaselineImage: true });
  try {
    const receipt = await TEST_ONLY_runScannerRetentionReadProof(options(item, commands));
    assert.equal(receipt.result, "PASSED");
    assert.deepEqual(receipt.access.localInventoryBefore.images, {
      count: 1,
      sha256: sha256(Buffer.from(baselineImage)),
    });
    assert.deepEqual(receipt.access.localInventoryAfter.images, receipt.access.localInventoryBefore.images);
    const removals = commands.calls.filter(({ args }) => args[0] === "image" && args[1] === "rm");
    assert.deepEqual(removals.map(({ args }) => args[2]), [binding().bootstrap.subject]);
  } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
});

test("anonymous network ambiguity fails closed before pull and still removes owned paths", async () => {
  const item = fixture();
  const commands = commandHarness({ anonymousNetworkError: true });
  try {
    await assert.rejects(TEST_ONLY_runScannerRetentionReadProof(options(item, commands)), /anonymous_remote_read_error/u);
    assert.equal(commands.calls.some(({ args }) => args[0] === "pull"), false);
    const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
    assert.equal(receipt.result, "FAILED");
    assert.equal(receipt.cleanup.ownedPathRemoved, true);
    assert.equal(receipt.phases.find(({ name }) => name === "anonymous_manifest_denied").result, "FAILED");
  } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
});

test("a near-operation-deadline command stays bounded and owned cleanup still runs", async () => {
  const item = fixture();
  const commands = commandHarness({ failPull: true });
  let clock = 0;
  let fetchCalls = 0;
  let pathCleanupRan = false;
  const nearDeadlineFetch = async (url) => {
    const result = await fetchImpl(url);
    fetchCalls += 1;
    if (fetchCalls === 4) clock = SCANNER_RETENTION.readProof.operationTimeoutMs - 1_500;
    return result;
  };
  try {
    await assert.rejects(TEST_ONLY_runScannerRetentionReadProof(options(item, commands, {
      fetchImpl: nearDeadlineFetch,
      now: () => clock,
      removeOwnedPath: (target) => { pathCleanupRan = true; rmSync(target, { recursive: true, force: false }); },
    })), /scanner_retention_read_proof_command_failed/u);
    const pull = commands.calls.find(({ args }) => args[0] === "pull");
    assert.equal(pull.timeout, 1_500);
    assert.equal(pull.failurePrefix, "scanner_retention_read_proof");
    assert.equal(pathCleanupRan, true);
    const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
    assert.equal(receipt.phases.find(({ name }) => name === "authorized_pinned_pull").reason,
      "scanner_retention_read_proof_command_failed");
    assert.equal(receipt.cleanup.ownedPathRemoved, true);
  } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
});

test("cleanup removes the owned image after the operation deadline has elapsed", async () => {
  const item = fixture();
  const commands = commandHarness();
  let clock = 0;
  let fetchCalls = 0;
  try {
    await assert.rejects(TEST_ONLY_runScannerRetentionReadProof(options(item, commands, {
      fetchImpl: async (url) => {
        const result = await fetchImpl(url);
        if (++fetchCalls === 4) clock = SCANNER_RETENTION.readProof.operationTimeoutMs - 1_500;
        return result;
      },
      now: () => clock,
      commandRunner: (command, args, commandOptions) => {
        const result = commands.commandRunner(command, args, commandOptions);
        if (command === "docker" && args[0] === "pull") clock = SCANNER_RETENTION.readProof.operationTimeoutMs + 500;
        return result;
      },
    })), /scanner_retention_read_proof_job_timeout/u);
    const pullIndex = commands.calls.findIndex(({ args }) => args[0] === "pull");
    assert.equal(commands.calls[pullIndex].timeout, 1_500);
    const cleanupCalls = commands.calls.slice(pullIndex + 1).filter(({ command }) => command === "docker");
    assert.ok(cleanupCalls.some(({ args }) => args[0] === "image" && args[1] === "rm"));
    assert.ok(cleanupCalls.every(({ timeout }) => timeout === 59_500));
    const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
    assert.equal(receipt.result, "FAILED");
    assert.equal(receipt.phases.find(({ name }) => name === "exact_pulled_image").reason,
      "scanner_retention_read_proof_job_timeout");
    assert.deepEqual(receipt.cleanup, { state: "PASSED", container: "NOT_CREATED", image: "REMOVED", ownedPathRemoved: true });
    assert.deepEqual(receipt.access.localInventoryAfter, receipt.access.localInventoryBefore);
  } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
});

test("oversized read command output uses the read-proof reason and still cleans owned paths", async () => {
  const item = fixture();
  try {
    await assert.rejects(TEST_ONLY_runScannerRetentionReadProof(options(
      item, commandHarness({ oversizedCommandOutput: true }),
    )), /scanner_retention_read_proof_command_output_exceeded/u);
    const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
    assert.equal(receipt.phases.find(({ name }) => name === "managed_tool_identity").reason,
      "scanner_retention_read_proof_command_output_exceeded");
    assert.equal(receipt.cleanup.ownedPathRemoved, true);
  } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
});

test("an invalid managed tool identity has a read-proof reason", async () => {
  const item = fixture();
  const commands = commandHarness();
  try {
    await assert.rejects(TEST_ONLY_runScannerRetentionReadProof(options(item, commands, {
      commandRunner: (command, args, commandOptions) => command === "docker" && args[0] === "version"
        ? { status: 0, stdout: "\u0000", stderr: "" }
        : commands.commandRunner(command, args, commandOptions),
    })), { message: "scanner_retention_read_proof_tool_identity_invalid" });
    const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
    assert.equal(receipt.phases.find(({ name }) => name === "managed_tool_identity").reason,
      "scanner_retention_read_proof_tool_identity_invalid");
    assert.equal(receipt.cleanup.ownedPathRemoved, true);
  } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
});

test("an unexpected read-proof cleanup error uses the read-proof fallback", async () => {
  const item = fixture();
  try {
    await assert.rejects(TEST_ONLY_runScannerRetentionReadProof(options(item, commandHarness(), {
      removeOwnedPath: () => { throw new Error("simulated unexpected cleanup failure"); },
    })), /scanner_retention_read_proof_command_failed/u);
    const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
    assert.equal(receipt.phases.find(({ name }) => name === "owned_path_cleanup").reason,
      "scanner_retention_read_proof_command_failed");
    assert.equal(receipt.cleanup.state, "FAILED");
  } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
});

test("wrong copied bytes fail without retaining the owned container or image", async () => {
  const item = fixture();
  const commands = commandHarness({ copiedPayload: "tampered\n" });
  try {
    await assert.rejects(TEST_ONLY_runScannerRetentionReadProof(options(item, commands)), /payload_invalid/u);
    const receipt = JSON.parse(readFileSync(path.join(item.output, "receipt.json"), "utf8"));
    assert.equal(receipt.result, "FAILED");
    assert.equal(receipt.cleanup.container, "REMOVED");
    assert.equal(receipt.cleanup.image, "REMOVED");
    assert.equal(receipt.cleanup.ownedPathRemoved, true);
  } finally { rmSync(item.runnerTemp, { recursive: true, force: true }); }
});
