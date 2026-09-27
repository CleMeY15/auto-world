import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  SEAWEED_CANDIDATE_PUBLISH,
  candidateCleanupCommandOptions,
  classifyRemoteTagAbsence,
  copyValidatedCandidateArchive,
  parseCandidateImageIds,
  parseCandidatePublishArguments,
  runSeaweedCandidatePublish,
  validateCandidateLocalImage,
  validateCandidatePublishContext,
  validateCandidateRemoteManifest,
} from "../scripts/seaweed-image/candidate-publish.mjs";

const sourceSha = "1".repeat(40);
const runId = "40000000001";
const imageId = `sha256:${"a".repeat(64)}`;
const diffId = `sha256:${"b".repeat(64)}`;
const layerDigest = `sha256:${"d".repeat(64)}`;
const originalTag = `auto-world-seaweed-s3:run-${runId}-attempt-1`;
const archive = Buffer.alloc(1024, 7);
const archiveSha256 = createHash("sha256").update(archive).digest("hex");
const linux = process.platform === "linux";

function environment(root) {
  const workspace = path.join(root, "workspace"); mkdirSync(workspace);
  return {
    GITHUB_ACTIONS: "true", RUNNER_OS: "Linux", RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_REPOSITORY: SEAWEED_CANDIDATE_PUBLISH.repository, GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_WORKFLOW_REF: `${SEAWEED_CANDIDATE_PUBLISH.repository}/${SEAWEED_CANDIDATE_PUBLISH.workflowPath}@refs/heads/main`,
    GITHUB_JOB: "publish", GITHUB_RUN_NUMBER: "1", GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_ID: runId,
    GITHUB_SHA: sourceSha, GITHUB_TOKEN: "test-token-not-for-subprocesses", RUNNER_TEMP: root,
    GITHUB_WORKSPACE: workspace, PATH: process.env.PATH ?? "", HOME: root,
  };
}

function archiveSnapshot(file, changes = {}) {
  return {
    file, imageId, diffId, runId, recipeRevision: sourceSha,
    archiveProof: {
      kind: "SEAWEED_SAVED_CANDIDATE_PROOF_V1", authority: "PREPARATION_ONLY",
      candidateAuthorization: "NOT_AUTHORIZED", identityType: "CLASSIC_CONFIG_ID",
      imageId, diffId, tag: originalTag, serverVersion: "28.0.4",
      archiveSha256, archiveBytes: archive.length, configSha256: "a".repeat(64), configBytes: 123,
      layerSha256: "c".repeat(64), layerBytes: archive.length, rawSize: archive.length, memberCount: 1,
      ...changes,
    },
  };
}

function localMetadata(tags, repoDigests = [], size = archive.length - 37) {
  return JSON.stringify({ Id: imageId, RepoTags: tags, RepoDigests: repoDigests,
    Os: "linux", Architecture: "amd64", Size: size,
    RootFS: { Type: "layers", Layers: [diffId] } });
}

function candidateManifest(changes = {}) {
  return JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: imageId, size: 123 },
    layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", digest: layerDigest, size: 700 }],
    ...changes });
}

test("publisher arguments and guarded GitHub context remain exact", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-publish-context-"));
  try {
    const env = environment(root); const output = path.join(root, SEAWEED_CANDIDATE_PUBLISH.outputDirectory);
    assert.deepEqual(parseCandidatePublishArguments(["--output", output]), { output });
    assert.equal(validateCandidatePublishContext(env, "linux").runNumber, "1");
    for (const argv of [[], ["--output", "relative"], ["--other", output], ["--output", output, "extra"]]) {
      assert.throws(() => parseCandidatePublishArguments(argv), /arguments_invalid/u);
    }
    assert.throws(() => validateCandidatePublishContext({ ...env, GITHUB_RUN_ATTEMPT: "2" }, "linux"), /identity_invalid/u);
    assert.throws(() => validateCandidatePublishContext(env, "win32"), /requires_github_linux/u);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("missing tag classification accepts exact Buildx and structured absence only", () => {
  const tag = "ghcr.io/owner/image:candidate-1-attempt-1";
  assert.equal(classifyRemoteTagAbsence({ status: 1, stdout: "", stderr: `${tag}: not found\n` }, tag), "ABSENT");
  assert.equal(classifyRemoteTagAbsence({ status: 1, stdout: "", stderr: "manifest unknown\n" }, tag), "ABSENT");
  for (const result of [
    { status: 0, stdout: "{}", stderr: "" },
    { status: 1, stdout: "", stderr: "other: not found" },
    { status: 1, stdout: "", stderr: "unauthorized" },
    { status: 1, stdout: "", stderr: "TLS handshake timeout" },
  ]) assert.throws(() => classifyRemoteTagAbsence(result, tag));
});

test("image inventory deduplicates legitimate repeated IDs but rejects placeholders", () => {
  assert.deepEqual(parseCandidateImageIds(`${imageId}\n${imageId}\n`), [imageId]);
  assert.throws(() => parseCandidateImageIds("<none>\n"), /local_inventory_invalid/u);
});

test("cleanup commands are clipped to a ten-minute aggregate reserve", () => {
  assert.equal(candidateCleanupCommandOptions({ marker: true }, 1_000, () => 1_000).timeoutMs, 240_000);
  assert.equal(candidateCleanupCommandOptions({}, 1_000, () => 500_001).timeoutMs, 100_999);
  assert.throws(() => candidateCleanupCommandOptions({}, 1_000, () => 601_000), /cleanup_timeout/u);
});

test("local image validation binds ID, complete tag set, size, platform and DiffID", () => {
  const expected = { imageId, diffId, rawSize: archive.length };
  assert.equal(validateCandidateLocalImage(localMetadata([originalTag]), expected, [originalTag]).imageId, imageId);
  for (const raw of [
    localMetadata([originalTag, "foreign:latest"]),
    JSON.stringify({ ...JSON.parse(localMetadata([originalTag])), Size: 0 }),
    JSON.stringify({ ...JSON.parse(localMetadata([originalTag])), Architecture: "arm64" }),
    JSON.stringify({ ...JSON.parse(localMetadata([originalTag])), RootFS: { Type: "layers", Layers: [imageId] } }),
  ]) assert.throws(() => validateCandidateLocalImage(raw, expected, [originalTag]), /local_image_invalid/u);
});

test("remote manifest binds exact config bytes and one compressed descriptor", () => {
  const expected = { imageId, configSha256: "a".repeat(64), configBytes: 123 };
  const result = validateCandidateRemoteManifest(candidateManifest(), expected);
  assert.equal(result.configDigest, imageId);
  assert.equal(result.remoteLayerVerification, "PENDING_INDEPENDENT_READ");
  const base = JSON.parse(candidateManifest());
  for (const changed of [
    { ...base, config: { ...base.config, size: 124 } },
    { ...base, config: { ...base.config, urls: ["https://example.invalid"] } },
    { ...base, layers: [...base.layers, base.layers[0]] },
    { ...base, layers: [{ ...base.layers[0], mediaType: "application/vnd.oci.image.layer.v1.tar" }] },
    { ...base, annotations: { unsafe: "extra" } },
  ]) assert.throws(() => validateCandidateRemoteManifest(JSON.stringify(changed), expected), /remote_manifest_invalid/u);
});

test("archive copy uses a private exclusive regular file and exact bounded hash", { skip: !linux }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-publish-copy-"));
  try {
    const source = path.join(root, "saved.tar"); const destination = path.join(root, "copy.tar");
    writeFileSync(source, archive, { mode: 0o600 }); chmodSync(source, 0o600);
    const result = copyValidatedCandidateArchive(archiveSnapshot(source), destination);
    assert.equal(result.archiveSha256, archiveSha256);
    assert.deepEqual(readFileSync(destination), archive);
    writeFileSync(destination, "pre-existing-object");
    assert.throws(() => copyValidatedCandidateArchive(archiveSnapshot(source), destination), /archive_copy_invalid/u);
    assert.equal(readFileSync(destination, "utf8"), "pre-existing-object");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("archive copy rejects a changed digest and removes its partial destination", { skip: !linux }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-publish-copy-bad-"));
  try {
    const source = path.join(root, "saved.tar"); const destination = path.join(root, "copy.tar");
    writeFileSync(source, archive, { mode: 0o600 }); chmodSync(source, 0o600);
    assert.throws(() => copyValidatedCandidateArchive(archiveSnapshot(source,
      { archiveSha256: "f".repeat(64) }), destination), /archive_copy_invalid/u);
    assert.equal(existsSync(destination), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function successfulHarness({ candidateAnonymous = "DENIED", pushStatus = 0, loadInventoryDrift = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-publish-run-")); const env = environment(root);
  const output = path.join(root, SEAWEED_CANDIDATE_PUBLISH.outputDirectory);
  const tag = `${SEAWEED_CANDIDATE_PUBLISH.image}:candidate-${runId}-attempt-1`;
  const rawManifest = candidateManifest();
  const subject = `${SEAWEED_CANDIDATE_PUBLISH.image}@sha256:${createHash("sha256").update(rawManifest).digest("hex")}`;
  const foreignId = `sha256:${"e".repeat(64)}`; const calls = [];
  let loaded = false; let tagged = false; let pushed = false;
  const materialize = async (input, inspect) => {
    assert.equal(input.signal instanceof globalThis.AbortSignal, true);
    const saved = path.join(input.parent, "saved.tar"); writeFileSync(saved, archive, { mode: 0o600 }); chmodSync(saved, 0o600);
    await inspect(archiveSnapshot(saved)); rmSync(saved);
    return { kind: "SEAWEED_LOCAL_CANDIDATE_RECEIPT_V1", state: "VERIFIED", authority: "PREPARATION_ONLY",
      candidateAuthorization: "NOT_AUTHORIZED", publication: "NOT_ATTEMPTED", imageId, diffId,
      archiveSha256, archiveBytes: archive.length, recipeRevision: sourceSha, runId,
      sourceRunId: "35875100636", sourceCodeRevision: "2".repeat(40),
      sourceBinaryDigest: `sha256:${"3".repeat(64)}`, baseManifestDigest: `sha256:${"4".repeat(64)}` };
  };
  const commandRunner = (command, args, options) => {
    assert.equal(Object.hasOwn(options.env, "GITHUB_TOKEN"), false);
    calls.push({ command, args: [...args], anonymous: options.env.DOCKER_CONFIG.endsWith("docker-anonymous") });
    if (command === "git") return { status: 0, stdout: `${sourceSha}\n`, stderr: "" };
    if (args[0] === "version") return { status: 0, stdout: "28.0.4|28.0.4\n", stderr: "" };
    if (args[0] === "buildx" && args[1] === "version") return { status: 0, stdout: "github.com/docker/buildx v0.37.1\n", stderr: "" };
    if (args[0] === "login") return { status: 0, stdout: "Login Succeeded\n", stderr: "" };
    if (args[0] === "image" && args[1] === "ls") {
      const drift = loadInventoryDrift && loaded ? `sha256:${"f".repeat(64)}\n` : "";
      const ids = loaded ? `${foreignId}\n${imageId}\n${imageId}\n${drift}` : `${foreignId}\n${foreignId}\n`;
      return { status: 0, stdout: ids, stderr: "" };
    }
    if (args[0] === "image" && args[1] === "inspect") {
      if (!loaded) return { status: 1, stdout: "", stderr: "Error response from daemon: No such image\n" };
      if (args[2] === "--format") return { status: 0,
        stdout: localMetadata(tagged ? [originalTag, tag] : [originalTag], pushed ? [subject] : []), stderr: "" };
      return { status: 0, stdout: "[]", stderr: "" };
    }
    if (args[0] === "image" && args[1] === "load") { loaded = true; return { status: 0, stdout: `Loaded image: ${originalTag}\n`, stderr: "" }; }
    if (args[0] === "image" && args[1] === "tag") { tagged = true; return { status: 0, stdout: "", stderr: "" }; }
    if (args[0] === "image" && args[1] === "rm") { loaded = false; tagged = false; return { status: 0, stdout: "", stderr: "" }; }
    if (args[0] === "push") { pushed = true; return { status: pushStatus, stdout: "", stderr: pushStatus ? "lost response" : "" }; }
    if (args[0] === "buildx" && args[1] === "imagetools") {
      const reference = args.at(-1); const anonymous = options.env.DOCKER_CONFIG.endsWith("docker-anonymous");
      if (anonymous) {
        if (reference === subject && candidateAnonymous === "PUBLIC") return { status: 0, stdout: rawManifest, stderr: "" };
        return { status: 1, stdout: "", stderr: "unauthorized: authentication required\n" };
      }
      if (reference.includes("@sha256:2ac4")) return { status: 0, stdout: "bootstrap", stderr: "" };
      if (reference === tag && !pushed) return { status: 1, stdout: "", stderr: `${tag}: not found\n` };
      if (reference === tag || reference === subject) return { status: 0, stdout: rawManifest, stderr: "" };
    }
    throw new Error(`unexpected command ${command} ${args.join(" ")}`);
  };
  const fetchImpl = async () => new globalThis.Response(JSON.stringify({ object: { type: "commit", sha: sourceSha } }));
  return { root, output, calls, subject, run: () => runSeaweedCandidatePublish({
    argv: ["--output", output], commandRunner, env, fetchImpl, materialize, platform: "linux",
    validateBootstrapManifest: (raw) => ({ sha256: `sha256:${"9".repeat(64)}`, size: Buffer.byteLength(raw) }),
  }) };
}

test("publisher performs one guarded write, proves private digest denial and cleans exact owned image",
  { skip: !linux }, async () => {
  const harness = successfulHarness();
  try {
    const receipt = await harness.run();
    assert.equal(receipt.result, "PASSED");
    assert.equal(receipt.publication, "PUBLISHED_UNADMITTED");
    assert.equal(receipt.admission, "NOT_AUTHORIZED");
    assert.equal(receipt.candidateAnonymousRead, "AUTHORIZATION_DENIED");
    assert.equal(receipt.remote.remoteLayerVerification, "PENDING_INDEPENDENT_READ");
    assert.equal(receipt.retention.secondaryPrivateCopy, "PENDING");
    assert.equal(harness.calls.filter((call) => call.args[0] === "push").length, 1);
    const mainPhase = receipt.phases.findIndex((phase) => phase.name === "protected_main_immediately_before_write");
    const tagPhase = receipt.phases.findIndex((phase) => phase.name === "fixed_unique_candidate_tag");
    assert.ok(mainPhase >= 0 && mainPhase < tagPhase);
    assert.equal(existsSync(path.join(harness.output, "receipt.json")), true);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(harness.output, "receipt.json"), "utf8"))).includes("token"), false);
  } finally { rmSync(harness.root, { recursive: true, force: true }); }
});

test("confirmed remote subject survives a lost push response", { skip: !linux }, async () => {
  const harness = successfulHarness({ pushStatus: 1 });
  try {
    const receipt = await harness.run();
    assert.equal(receipt.result, "PASSED");
    assert.equal(receipt.pushResponse, "FAILED_BUT_REMOTE_EXACT_SUBJECT_CONFIRMED");
    assert.equal(receipt.subject, harness.subject);
  } finally { rmSync(harness.root, { recursive: true, force: true }); }
});

test("public candidate digest fails overall while preserving confirmed PUBLISHED_UNADMITTED state",
  { skip: !linux }, async () => {
  const harness = successfulHarness({ candidateAnonymous: "PUBLIC" });
  try {
    await assert.rejects(harness.run(), /candidate_privacy_invalid/u);
    const receipt = JSON.parse(readFileSync(path.join(harness.output, "receipt.json"), "utf8"));
    assert.equal(receipt.result, "FAILED");
    assert.equal(receipt.publication, "PUBLISHED_UNADMITTED");
    assert.equal(receipt.state, "PUBLISHED_UNADMITTED");
    assert.equal(receipt.subject, harness.subject);
    assert.equal(receipt.phases.at(-2).name, "owned_docker_cleanup");
    assert.equal(receipt.phases.at(-2).result, "PASSED");
  } finally { rmSync(harness.root, { recursive: true, force: true }); }
});

test("ambiguous post-load inventory is never deleted and cleanup is explicitly unverified",
  { skip: !linux }, async () => {
  const harness = successfulHarness({ loadInventoryDrift: true });
  try {
    await assert.rejects(harness.run(), /load_failed/u);
    const receipt = JSON.parse(readFileSync(path.join(harness.output, "receipt.json"), "utf8"));
    const cleanup = receipt.phases.find((phase) => phase.name === "owned_docker_cleanup");
    assert.equal(cleanup.result, "FAILED");
    assert.deepEqual(cleanup.reasons, ["seaweed_candidate_publish_image_cleanup_ownership_unverified"]);
    assert.equal(harness.calls.some((call) => call.args[0] === "image" && call.args[1] === "rm"), false);
  } finally { rmSync(harness.root, { recursive: true, force: true }); }
});
