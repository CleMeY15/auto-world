import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BOOTSTRAP, sha256 } from "../scripts/package-bootstrap/prepare.mjs";
import {
  REGISTRY_PROOF,
  classifyAnonymousRemoteRead,
  parsePublishedDigest,
  parseRegistryArguments,
  runRegistryProof,
  validateRegistryContext,
  validateRemoteManifest,
} from "../scripts/package-bootstrap/registry-proof.mjs";

const rawManifest = '{"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json","config":{"digest":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},"layers":[]}';
const digest = `sha256:${sha256(Buffer.from(rawManifest))}`;
const configId = `sha256:${"c".repeat(64)}`;
const sha = "a".repeat(40);

function fixture(mode) {
  const runnerTemp = mkdtempSync(path.join(os.tmpdir(), "aw-registry-proof-"));
  const githubOutput = path.join(runnerTemp, "github-output");
  writeFileSync(githubOutput, "");
  const env = {
    GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_JOB: mode,
    GITHUB_OUTPUT: githubOutput, GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: BOOTSTRAP.repository,
    GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: "123456789", GITHUB_SHA: sha, GITHUB_TOKEN: "secret-token-value",
    GITHUB_WORKSPACE: runnerTemp, RUNNER_OS: "Linux", RUNNER_TEMP: runnerTemp,
  };
  return { env, githubOutput, output: path.join(runnerTemp, REGISTRY_PROOF.outputDirectory), runnerTemp };
}

function response() {
  return new globalThis.Response(JSON.stringify({ object: { type: "commit", sha } }), { status: 200 });
}

test("arguments and Actions context reject arbitrary inputs", () => {
  assert.deepEqual(parseRegistryArguments(["publish", "--output", path.resolve("package-registry-proof")]).mode, "publish");
  assert.deepEqual(parseRegistryArguments(["verify", "--digest", digest, "--output", path.resolve("package-registry-proof")]).digest, digest);
  for (const argv of [[], ["publish", "--digest", digest, "--output", path.resolve("x")], ["verify", "--digest", "latest", "--output", path.resolve("x")]]) {
    assert.throws(() => parseRegistryArguments(argv), /package_registry_arguments_invalid/u);
  }
  const { env } = fixture("publish");
  assert.equal(validateRegistryContext(env, "publish", "linux").sourceSha, sha);
  for (const invalid of [
    { ...env, GITHUB_EVENT_NAME: "push" }, { ...env, GITHUB_REF: "refs/heads/feature" },
    { ...env, GITHUB_RUN_ATTEMPT: "2" }, { ...env, GITHUB_JOB: "verify" }, { ...env, GITHUB_TOKEN: "" },
  ]) assert.throws(() => validateRegistryContext(invalid, "publish", "linux"), /package_registry_/u);
  rmSync(env.RUNNER_TEMP, { recursive: true, force: true });
});

test("published metadata requires the registry manifest digest", () => {
  assert.equal(parsePublishedDigest({ "containerimage.digest": digest }), digest);
  assert.equal(parsePublishedDigest({ "containerimage.config.digest": configId, "containerimage.digest": digest }), digest);
  for (const metadata of [{}, { "containerimage.config.digest": configId }, { "containerimage.digest": "sha256:short" }, { "containerimage.digest": [digest] }]) {
    assert.throws(() => parsePublishedDigest(metadata), /package_registry_manifest/u);
  }
});

test("anonymous denial is distinct from network and successful access", () => {
  assert.equal(classifyAnonymousRemoteRead({ status: 1, stdout: "", stderr: "unauthorized: authentication required" }), "AUTHORIZATION_DENIED");
  assert.equal(classifyAnonymousRemoteRead({ status: 1, stdout: "", stderr: "denied: denied" }), "AUTHORIZATION_DENIED");
  assert.throws(() => classifyAnonymousRemoteRead({ status: 1, stdout: "", stderr: "dial tcp: no such host" }), /package_registry_anonymous_remote_read_error/u);
  assert.throws(() => classifyAnonymousRemoteRead({ status: 1, stdout: "unauthorized", stderr: "TLS handshake timeout" }), /package_registry_anonymous_remote_read_error/u);
  assert.throws(() => classifyAnonymousRemoteRead({ status: null, error: new Error("timeout"), stdout: "unauthorized", stderr: "" }), /package_registry_anonymous_remote_read_error/u);
  assert.throws(() => classifyAnonymousRemoteRead({ status: 0, stdout: rawManifest, stderr: "" }), /package_registry_anonymous_remote_read_succeeded/u);
});

test("remote manifest bytes must hash to the exact requested registry digest", () => {
  assert.deepEqual(validateRemoteManifest(rawManifest, digest), { sha256: digest, size: Buffer.byteLength(rawManifest) });
  for (const invalid of [`${rawManifest}\n`, "", Buffer.from(rawManifest)]) {
    assert.throws(() => validateRemoteManifest(invalid, digest), /package_registry_remote_manifest_invalid/u);
  }
});

function publishRunner({ calls, wrongMetadata = false, failBuild = false }) {
  return (command, args, options) => {
    calls.push({ command, args, cwd: options.cwd, env: options.env, input: options.input });
    if (command === "git") return { status: 0, stdout: `${sha}\n`, stderr: "" };
    if (args[0] === "version" && args[1] === "--format") return { status: 0, stdout: "28.0.4|28.0.4\n", stderr: "" };
    if (args[0] === "buildx" && args[1] === "version") return { status: 0, stdout: "github.com/docker/buildx v0.37.0\n", stderr: "" };
    if (args[0] === "buildx" && args[1] === "inspect" && args[2] !== REGISTRY_PROOF.image) return { status: 0, stdout: "BuildKit version: v0.20.2\n", stderr: "" };
    if (args[0] === "login") return { status: 0, stdout: "Login Succeeded", stderr: "" };
    if (args[0] === "buildx" && args[1] === "build") {
      if (failBuild) return { status: 1, stdout: "", stderr: "failed" };
      const metadataFile = args[args.indexOf("--metadata-file") + 1];
      writeFileSync(metadataFile, JSON.stringify(wrongMetadata ? { "containerimage.config.digest": configId } : { "containerimage.config.digest": configId, "containerimage.digest": digest }));
      return { status: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected:${command}:${args.join(" ")}`);
  };
}

test("publish uses isolated credentials, exact build controls, receipt, output, and cleanup", async (context) => {
  const item = fixture("publish");
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const calls = [];
  const receipt = await runRegistryProof({
    argv: ["publish", "--output", item.output], env: item.env, platform: "linux",
    commandRunner: publishRunner({ calls }), fetchImpl: async () => response(),
  });
  assert.equal(receipt.state, "PUBLISHED_UNADMITTED");
  assert.equal(receipt.packageConfiguration, "NOT_VERIFIED");
  assert.equal(receipt.forkAccessTest, "SKIPPED_BY_USER");
  assert.equal(receipt.forkIsolation, "NOT_VERIFIED");
  assert.equal(readFileSync(item.githubOutput, "utf8"), `digest=${digest}\n`);
  const login = calls.find(({ args }) => args[0] === "login");
  assert.equal(login.input, `${item.env.GITHUB_TOKEN}\n`);
  assert.equal(login.args.includes(item.env.GITHUB_TOKEN), false);
  assert.equal(login.env.GITHUB_TOKEN, undefined);
  assert.match(login.env.DOCKER_CONFIG, /docker-auth$/u);
  assert.equal(calls.find(({ command }) => command === "git").cwd, item.env.GITHUB_WORKSPACE);
  const build = calls.find(({ args }) => args[0] === "buildx" && args[1] === "build");
  assert.deepEqual(build.args.slice(0, 12), ["buildx", "build", "--platform", "linux/amd64", "--network=none", "--provenance=false", "--sbom=false", "--push", "--metadata-file", build.args[9], "--tag", `${REGISTRY_PROOF.image}:proof-123456789`]);
  assert.equal(JSON.stringify(receipt).includes(item.env.GITHUB_TOKEN), false);
  assert.equal(existsSync(path.join(item.runnerTemp, "aw-package-registry-publish-123456789-attempt-1")), false);
});

test("publish failure writes redacted receipt, cleans owned files, and emits no digest", async (context) => {
  const item = fixture("publish");
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  await assert.rejects(runRegistryProof({
    argv: ["publish", "--output", item.output], env: item.env, platform: "linux",
    commandRunner: publishRunner({ calls: [], failBuild: true }), fetchImpl: async () => response(),
  }), /package_registry_command_failed/u);
  const receipt = readFileSync(path.join(item.output, "receipt.json"), "utf8");
  assert.equal(receipt.includes(item.env.GITHUB_TOKEN), false);
  assert.match(receipt, /"publication": "ATTEMPTED_OUTCOME_UNCONFIRMED"/u);
  assert.equal(readFileSync(item.githubOutput, "utf8"), "");
  assert.equal(existsSync(path.join(item.runnerTemp, "aw-package-registry-publish-123456789-attempt-1")), false);
});

function verifyRunner({ calls, copiedPayload = BOOTSTRAP.payload, anonymousMessage = "unauthorized: authentication required", anonymousRemoteSuccess = false, mutatedAuthorizedRaw = false, repoDigests } ) {
  const subject = `${REGISTRY_PROOF.image}@${digest}`;
  return (command, args, options) => {
    calls.push({ command, args, buildxConfig: options.env.BUILDX_CONFIG, config: options.env.DOCKER_CONFIG, input: options.input });
    if (command === "git") return { status: 0, stdout: `${sha}\n`, stderr: "" };
    if (args[0] === "version" && args[1] === "--format") return { status: 0, stdout: "28.0.4|28.0.4\n", stderr: "" };
    if (args[0] === "buildx" && args[1] === "version") return { status: 0, stdout: "github.com/docker/buildx v0.37.0\n", stderr: "" };
    if (args[0] === "buildx" && args[1] === "inspect") return { status: 0, stdout: "BuildKit: v0.20.2\n", stderr: "" };
    if (args[0] === "buildx" && args[1] === "imagetools" && args[2] === "inspect") {
      if (options.env.DOCKER_CONFIG.endsWith("docker-anonymous")) {
        return anonymousRemoteSuccess ? { status: 0, stdout: rawManifest, stderr: "" } : { status: 1, stdout: "", stderr: anonymousMessage };
      }
      return { status: 0, stdout: mutatedAuthorizedRaw ? `${rawManifest} ` : rawManifest, stderr: "" };
    }
    if (args[0] === "login") return { status: 0, stdout: "", stderr: "" };
    if (args[0] === "image" && args[1] === "inspect" && args[2] === subject) return { status: 1, stdout: "", stderr: "Error: No such image" };
    if (args[0] === "pull") return { status: 0, stdout: "pulled from same-daemon cache", stderr: "" };
    if (args[0] === "image" && args[1] === "inspect" && args[2] === "--format") return { status: 0, stdout: JSON.stringify({ Id: configId, Os: "linux", Architecture: "amd64", Size: 4096, RepoDigests: repoDigests ?? [subject], Config: { Labels: { "org.opencontainers.image.source": BOOTSTRAP.sourceUrl } } }), stderr: "" };
    if (args[0] === "container" && args[1] === "inspect") return { status: 1, stdout: "", stderr: "Error: No such container" };
    if (args[0] === "create") return { status: 0, stdout: "container", stderr: "" };
    if (args[0] === "cp") { writeFileSync(args[2], copiedPayload); return { status: 0, stdout: "", stderr: "" }; }
    if (args[0] === "rm" || (args[0] === "image" && args[1] === "rm")) return { status: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected:${command}:${args.join(" ")}`);
  };
}

test("verify proves authorized-denied-authorized sequence and exact stopped-container payload", async (context) => {
  const item = fixture("verify");
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  const calls = [];
  const receipt = await runRegistryProof({ argv: ["verify", "--digest", digest, "--output", item.output], env: item.env, platform: "linux", commandRunner: verifyRunner({ calls }) });
  assert.equal(receipt.result, "PASSED");
  assert.equal(receipt.anonymousManifestDenied, "PASSED");
  assert.equal(receipt.authorizedImagePull, "PASSED");
  assert.deepEqual(receipt.remoteManifestBefore, { sha256: digest, size: Buffer.byteLength(rawManifest) });
  assert.deepEqual(receipt.remoteManifestAfter, receipt.remoteManifestBefore);
  assert.equal(receipt.image.localImageIdentity.value, configId);
  assert.notEqual(receipt.image.localImageIdentity.value, receipt.manifestDigest);
  assert.equal(receipt.copiedPayload.sha256, "d5e5e59eda3174b385ac04154621244178be55d1a7f69f6cc6f6dd1fda43355d");
  const remoteReads = calls.filter(({ args }) => args[0] === "buildx" && args[1] === "imagetools" && args[2] === "inspect");
  assert.equal(remoteReads.length, 3);
  assert.deepEqual(remoteReads.map(({ args }) => args.slice(0, 5)), Array(3).fill(["buildx", "imagetools", "inspect", "--raw", `${REGISTRY_PROOF.image}@${digest}`]));
  assert.notEqual(remoteReads[0].config, remoteReads[1].config);
  assert.equal(remoteReads[0].config, remoteReads[2].config);
  assert.notEqual(remoteReads[0].buildxConfig, remoteReads[1].buildxConfig);
  assert.match(remoteReads[0].buildxConfig, /docker-auth[\\/]buildx$/u);
  assert.match(remoteReads[1].buildxConfig, /docker-anonymous[\\/]buildx$/u);
  const pulls = calls.filter(({ args }) => args[0] === "pull");
  assert.equal(pulls.length, 1);
  assert.equal(pulls[0].config, remoteReads[0].config);
  assert.equal(remoteReads.every((remoteRead) => calls.indexOf(remoteRead) < calls.indexOf(pulls[0])), true);
  assert.equal(calls.some(({ args }) => args[0] === "start" || args[0] === "run"), false);
  assert.equal(calls.some(({ args }) => args[0] === "image" && args[1] === "rm"), true);
});

test("verify rejects remote manifest, repository, and payload substitution plus anonymous success/network errors while still cleaning", async (context) => {
  for (const variant of [
    { copiedPayload: "changed\n" },
    { anonymousMessage: "dial tcp: no such host" },
    { anonymousRemoteSuccess: true },
    { mutatedAuthorizedRaw: true },
    { repoDigests: [`ghcr.io/other/image@${digest}`] },
  ]) {
    const item = fixture("verify");
    context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
    const calls = [];
    await assert.rejects(runRegistryProof({ argv: ["verify", "--digest", digest, "--output", item.output], env: item.env, platform: "linux", commandRunner: verifyRunner({ calls, ...variant }) }), /package_registry_/u);
    const receipt = readFileSync(path.join(item.output, "receipt.json"), "utf8");
    assert.match(receipt, /"result": "FAILED"/u);
    assert.equal(receipt.includes(item.env.GITHUB_TOKEN), false);
    assert.equal(existsSync(path.join(item.runnerTemp, "aw-package-registry-verify-123456789-attempt-1")), false);
  }
});

test("invalid output paths and wrong main ref fail closed", async (context) => {
  const item = fixture("publish");
  context.after(() => rmSync(item.runnerTemp, { recursive: true, force: true }));
  await assert.rejects(runRegistryProof({ argv: ["publish", "--output", path.join(item.runnerTemp, "nested", REGISTRY_PROOF.outputDirectory)], env: item.env, platform: "linux", commandRunner: publishRunner({ calls: [] }), fetchImpl: async () => response() }), /package_registry_output_path_invalid/u);
  const second = fixture("publish");
  context.after(() => rmSync(second.runnerTemp, { recursive: true, force: true }));
  await assert.rejects(runRegistryProof({ argv: ["publish", "--output", second.output], env: second.env, platform: "linux", commandRunner: publishRunner({ calls: [] }), fetchImpl: async () => new globalThis.Response(JSON.stringify({ object: { type: "commit", sha: "b".repeat(40) } }), { status: 200 }) }), /package_registry_main_ref_mismatch/u);
  assert.equal(readFileSync(second.githubOutput, "utf8"), "");
});
