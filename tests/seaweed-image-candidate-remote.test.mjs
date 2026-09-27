import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  remoteCandidateCleanupOptions,
  validateRemoteCandidateImage,
  validateRemoteCandidateRawManifest,
  validateRemoteSeaweedCandidatePolicy,
  validateRemoteSeaweedCandidateReceipt,
  withVerifiedRemoteSeaweedCandidate,
} from "../scripts/seaweed-image/candidate-remote.mjs";

const linux = process.platform === "linux";
const imageId = `sha256:${"a".repeat(64)}`;
const diffId = `sha256:${"b".repeat(64)}`;
const layerDigest = `sha256:${"c".repeat(64)}`;
const publisherRunId = "40000000001";
const auditRunId = "40000000002";
const publisherRevision = "1".repeat(40);
const auditRevision = "2".repeat(40);
const config = Object.freeze({ Entrypoint: ["/entrypoint.sh"], Cmd: ["mini", "-dir=/data"] });

function rawManifest() {
  return JSON.stringify({ schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: imageId, size: 321 },
    layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar+gzip", digest: layerDigest, size: 777 }] });
}

function policy(changes = {}) {
  const raw = rawManifest(); const manifestDigest = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
  const base = { kind: "SEAWEED_REMOTE_CANDIDATE_POLICY_V1", authority: "REVIEWED_MAIN_POLICY",
    repository: "CleMeY15/auto-world", owner: "CleMeY15", image: "ghcr.io/clemey15/auto-world-seaweedfs-s3",
    platform: "linux/amd64", publishedTag: `candidate-${publisherRunId}-attempt-1`,
    subject: `ghcr.io/clemey15/auto-world-seaweedfs-s3@${manifestDigest}`,
    manifest: { digest: manifestDigest, bytes: Buffer.byteLength(raw), mediaType: "application/vnd.oci.image.manifest.v1+json",
      config: { digest: imageId, size: 321, mediaType: "application/vnd.oci.image.config.v1+json" },
      layer: { digest: layerDigest, size: 777, mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
        compressedSizeVerification: "RECORDED_ONLY" } },
    candidate: { imageId, diffId, rawSize: 1024, memberCount: 1 },
    publisher: { workflowPath: ".github/workflows/seaweed-candidate-publish.yml", runId: publisherRunId,
      runNumber: "1", runAttempt: "1", recipeRevision: publisherRevision, receiptSha256: "d".repeat(64),
      result: "PASSED" },
    source: { runId: "35875100636", codeRevision: "3".repeat(40), binaryDigest: `sha256:${"4".repeat(64)}`,
      baseManifestDigest: `sha256:${"5".repeat(64)}`, archiveSha256: "6".repeat(64), archiveBytes: 4096,
      configSha256: "a".repeat(64), configBytes: 321, savedLayerSha256: "7".repeat(64), savedLayerBytes: 1024 } };
  return { ...base, ...changes };
}

function imageMetadata(policyValue, alias) {
  return JSON.stringify({ Id: imageId, RepoTags: alias === undefined ? null : [alias],
    RepoDigests: [policyValue.subject], Os: "linux", Architecture: "amd64", Size: 900,
    RootFS: { Type: "layers", Layers: [diffId] }, Config: config });
}

test("reviewed remote policy is exact, cross-bound and deeply frozen", () => {
  const value = validateRemoteSeaweedCandidatePolicy(policy());
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.manifest.layer), true);
  for (const changed of [
    policy({ extra: true }),
    policy({ subject: `ghcr.io/clemey15/auto-world-seaweedfs-s3@sha256:${"e".repeat(64)}` }),
    policy({ candidate: { ...policy().candidate, imageId: `sha256:${"e".repeat(64)}` } }),
    policy({ source: { ...policy().source, savedLayerBytes: 2048 } }),
    policy({ manifest: { ...policy().manifest, layer: { ...policy().manifest.layer,
      compressedSizeVerification: "VERIFIED" } } }),
  ]) assert.throws(() => validateRemoteSeaweedCandidatePolicy(changed), /policy_invalid/u);
  assert.throws(() => validateRemoteSeaweedCandidatePolicy(policy({
    publisher: { ...policy().publisher, result: "FAILED" },
  })), /policy_invalid/u);
});

test("raw manifest requires exact bytes, descriptors and no descriptor URLs", () => {
  const value = policy(); const proof = validateRemoteCandidateRawManifest(rawManifest(), value);
  assert.equal(proof.state, "RAW_MANIFEST_VERIFIED");
  assert.equal(proof.layer.compressedSizeVerification, "RECORDED_ONLY");
  assert.throws(() => validateRemoteCandidateRawManifest(`${rawManifest()}\n`, value), /manifest_invalid/u);
  const parsed = JSON.parse(rawManifest()); parsed.layers[0].urls = ["https://example.invalid"];
  const bytes = JSON.stringify(parsed); const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const changed = policy({ subject: `ghcr.io/clemey15/auto-world-seaweedfs-s3@${digest}`,
    manifest: { ...policy().manifest, digest, bytes: Buffer.byteLength(bytes) } });
  assert.throws(() => validateRemoteCandidateRawManifest(bytes, changed), /manifest_invalid/u);
});

test("local image requires exact config ID, DiffID, platform, alias and RepoDigest", () => {
  const value = policy(); const alias = `auto-world-seaweed-s3:remote-${auditRunId}-attempt-1`;
  assert.deepEqual(validateRemoteCandidateImage(imageMetadata(value, alias), value, alias).config, config);
  for (const changed of [
    { ...JSON.parse(imageMetadata(value, alias)), RepoTags: [alias, "foreign:latest"] },
    { ...JSON.parse(imageMetadata(value, alias)), RepoDigests: [] },
    { ...JSON.parse(imageMetadata(value, alias)), Architecture: "arm64" },
    { ...JSON.parse(imageMetadata(value, alias)), RootFS: { Type: "layers", Layers: [imageId] } },
  ]) assert.throws(() => validateRemoteCandidateImage(JSON.stringify(changed), value, alias), /image_invalid/u);
});

test("cleanup commands are clipped to the independent ten-minute reserve", () => {
  assert.equal(remoteCandidateCleanupOptions({}, 100, () => 100).timeoutMs, 240_000);
  assert.equal(remoteCandidateCleanupOptions({}, 100, () => 500_100).timeoutMs, 100_000);
  assert.throws(() => remoteCandidateCleanupOptions({}, 100, () => 600_100), /cleanup_timeout/u);
});

test("remote receipt validator rejects local-receipt substitution and failed phases", () => {
  const value = policy(); const alias = `auto-world-seaweed-s3:remote-${auditRunId}-attempt-1`;
  const receipt = { kind: "SEAWEED_REMOTE_CANDIDATE_RECEIPT_V1", state: "VERIFIED", authority: "REMOTE_READ_ONLY",
    candidateAuthorization: "NOT_AUTHORIZED", publication: "PUBLISHED_UNADMITTED", execution: "NOT_ATTEMPTED",
    registryWrite: "NOT_ATTEMPTED", runId: auditRunId, recipeRevision: auditRevision, subject: value.subject, alias,
    remoteManifest: { state: "RAW_MANIFEST_VERIFIED", digest: value.manifest.digest, bytes: value.manifest.bytes,
      config: value.manifest.config, layer: value.manifest.layer },
    engine: { state: "ENGINE_VERIFIED", docker: "28.0.4|28.0.4", buildx: "buildx 0.37.1",
      serverVersion: "28.0.4", pullResponse: "SUCCESS", compressedDigestVerification: "MANAGED_MOBY_PULL",
      compressedSizeVerification: "RECORDED_ONLY" }, image: { imageId, diffId, platform: "linux/amd64" },
    archive: { state: "ARCHIVE_VERIFIED", imageId, diffId, archiveSha256: "e".repeat(64), archiveBytes: 4096,
      saveResponse: "SUCCESS" },
    publisher: { result: value.publisher.result, runId: publisherRunId, recipeRevision: publisherRevision,
      receiptSha256: value.publisher.receiptSha256 },
    provenance: { publisherRunId, publisherRecipeRevision: publisherRevision,
      publisherReceiptSha256: value.publisher.receiptSha256, sourceRunId: value.source.runId,
      sourceCodeRevision: value.source.codeRevision }, phases: [{ name: "x", result: "PASSED", durationMs: 1 }] };
  assert.equal(validateRemoteSeaweedCandidateReceipt(receipt, value).kind, receipt.kind);
  assert.throws(() => validateRemoteSeaweedCandidateReceipt({ ...receipt,
    kind: "SEAWEED_LOCAL_CANDIDATE_RECEIPT_V1" }, value), /receipt_invalid/u);
  assert.throws(() => validateRemoteSeaweedCandidateReceipt({ ...receipt,
    phases: [{ name: "x", result: "FAILED", durationMs: 1 }] }, value), /receipt_invalid/u);
});

function harness({ pullStatus = 0, saveStatus = 0, inventoryDrift = false, callbackFailure = false,
  candidateCollision = false, aliasRemovalDeletesImage = false, aliasRemovalStatus = 0 } = {}) {
  const parent = mkdtempSync(path.join(os.tmpdir(), "aw-remote-candidate-")); chmodSync(parent, 0o700);
  const value = policy(); const alias = `auto-world-seaweed-s3:remote-${auditRunId}-attempt-1`;
  const foreign = `sha256:${"f".repeat(64)}`; const calls = [];
  let pulled = false; let tagged = false;
  const commandRunner = (command, args, options) => {
    assert.equal(Object.hasOwn(options.env, "GITHUB_TOKEN"), false);
    calls.push({ command, args: [...args], anonymous: options.env.DOCKER_CONFIG.endsWith("docker-anonymous") });
    if (args[0] === "version") return { status: 0, stdout: "28.0.4|28.0.4\n", stderr: "" };
    if (args[0] === "buildx" && args[1] === "version") return { status: 0, stdout: "github.com/docker/buildx v0.37.1\n", stderr: "" };
    if (args[0] === "login") {
      assert.equal(options.input, "private-test-token\n"); return { status: 0, stdout: "Login Succeeded\n", stderr: "" };
    }
    if (args[0] === "buildx" && args[1] === "imagetools") {
      if (options.env.DOCKER_CONFIG.endsWith("docker-anonymous")) {
        return { status: 1, stdout: "", stderr: "unauthorized: authentication required\n" };
      }
      return { status: 0, stdout: rawManifest(), stderr: "" };
    }
    if (args[0] === "image" && args[1] === "ls") {
      const drift = pulled && inventoryDrift ? `sha256:${"8".repeat(64)}\n` : "";
      return { status: 0, stdout: pulled || candidateCollision
        ? `${foreign}\n${imageId}\n${imageId}\n${drift}` : `${foreign}\n${foreign}\n`, stderr: "" };
    }
    if (args[0] === "image" && args[1] === "inspect") {
      const reference = args.at(-1);
      const present = reference === alias ? tagged
        : reference === value.subject ? pulled : reference === imageId ? pulled || candidateCollision : false;
      if (!present) {
        return { status: 1, stdout: "", stderr: "Error response from daemon: No such image\n" };
      }
      if (args[2] === "--format") return { status: 0, stdout: imageMetadata(value, tagged ? alias : undefined), stderr: "" };
      return { status: 0, stdout: "[]", stderr: "" };
    }
    if (args[0] === "pull") { pulled = true; return { status: pullStatus, stdout: "", stderr: pullStatus ? "lost response" : "" }; }
    if (args[0] === "image" && args[1] === "tag") { tagged = true; return { status: 0, stdout: "", stderr: "" }; }
    if (args[0] === "image" && args[1] === "rm") {
      if (args[2] === alias) {
        tagged = false;
        if (aliasRemovalDeletesImage) pulled = false;
        return { status: aliasRemovalStatus, stdout: "", stderr: aliasRemovalStatus ? "No such image" : "" };
      }
      if (args[2] === value.subject) pulled = false;
      return { status: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };
  const saveRunner = async (_command, args, options) => {
    assert.deepEqual(args, ["image", "save", alias]);
    assert.equal(Object.hasOwn(options.env, "GITHUB_TOKEN"), false);
    writeSync(options.handle, Buffer.alloc(1024, 9));
    calls.push({ command: "docker", args: [...args], anonymous: false });
    return { status: saveStatus, stdout: "", stderr: saveStatus ? "lost response" : "" };
  };
  const validateArchive = async (options) => {
    assert.equal(options.tag, alias); assert.equal(options.imageId, imageId); assert.equal(options.diffId, diffId);
    await options.validateFilesystem([{ path: "verified" }]); options.validateRuntimeConfig(config);
    return { kind: "SEAWEED_SAVED_CANDIDATE_PROOF_V1", authority: "PREPARATION_ONLY",
      candidateAuthorization: "NOT_AUTHORIZED", imageId, identityType: "CLASSIC_CONFIG_ID", tag: alias,
      serverVersion: "28.0.4", archiveSha256: "9".repeat(64), archiveBytes: 1024, archiveMembers: 8,
      configSha256: "a".repeat(64), configBytes: 321, layerSha256: "7".repeat(64), layerBytes: 1024,
      diffId, rawSize: 1024, memberCount: 1 };
  };
  const input = { parent, policy: value, runId: auditRunId, recipeRevision: auditRevision,
    signal: undefined, validateFilesystem(entries) { assert.deepEqual(entries, [{ path: "verified" }]); },
    validateRuntimeConfig(actual) { assert.deepEqual(actual, config); } };
  const inspectArchive = async (snapshot) => {
    assert.equal(snapshot.recipeRevision, auditRevision); assert.equal(snapshot.runId, auditRunId);
    assert.equal(snapshot.subject, value.subject); assert.equal(statSync(snapshot.file).size, 1024);
    if (callbackFailure) throw new Error("consumer failure");
  };
  return { parent, calls, input, inspectArchive, dependencies: { commandRunner, saveRunner, validateArchive,
    platform: "linux", env: { PATH: process.env.PATH ?? "", HOME: parent, GITHUB_TOKEN: "private-test-token" } } };
}

test("remote provider verifies immutable bytes, saves through a simple alias and leaves parent empty",
  { skip: !linux }, async () => {
  const value = harness();
  try {
    const receipt = await withVerifiedRemoteSeaweedCandidate(value.input, value.inspectArchive, value.dependencies);
    assert.equal(receipt.kind, "SEAWEED_REMOTE_CANDIDATE_RECEIPT_V1");
    assert.equal(receipt.remoteManifest.state, "RAW_MANIFEST_VERIFIED");
    assert.equal(receipt.engine.state, "ENGINE_VERIFIED");
    assert.equal(receipt.archive.state, "ARCHIVE_VERIFIED");
    assert.equal(receipt.engine.compressedSizeVerification, "RECORDED_ONLY");
    assert.equal(value.calls.filter((call) => call.args[0] === "pull").length, 1);
    assert.equal(value.calls.some((call) => ["run", "create", "start"].includes(call.args[0])), false);
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("lost pull and save responses remain honest when exact states are independently confirmed",
  { skip: !linux }, async () => {
  const value = harness({ pullStatus: 1, saveStatus: 1 });
  try {
    const receipt = await withVerifiedRemoteSeaweedCandidate(value.input, value.inspectArchive, value.dependencies);
    assert.equal(receipt.engine.pullResponse, "FAILED_BUT_EXACT_STATE_CONFIRMED");
    assert.equal(receipt.archive.saveResponse, "FAILED_BUT_EXACT_ARCHIVE_CONFIRMED");
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("ambiguous pull inventory is never removed as owned", { skip: !linux }, async () => {
  const value = harness({ inventoryDrift: true });
  try {
    await assert.rejects(withVerifiedRemoteSeaweedCandidate(value.input, value.inspectArchive, value.dependencies),
      /pull_ownership_unverified/u);
    assert.equal(value.calls.some((call) => call.args[0] === "image" && call.args[1] === "rm"), false);
    assert.deepEqual(statSync(value.parent).isDirectory(), true);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("a pre-existing candidate config ID blocks the pull before ownership can be claimed", { skip: !linux }, async () => {
  const value = harness({ candidateCollision: true });
  try {
    await assert.rejects(withVerifiedRemoteSeaweedCandidate(value.input, value.inspectArchive, value.dependencies),
      /local_collision/u);
    assert.equal(value.calls.some((call) => call.args[0] === "pull"), false);
    assert.equal(value.calls.some((call) => call.args[0] === "image" && call.args[1] === "rm"), false);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("cleanup accepts a nonzero alias removal when final exact absence proves cleanup", { skip: !linux }, async () => {
  const value = harness({ aliasRemovalDeletesImage: true, aliasRemovalStatus: 1 });
  try {
    const receipt = await withVerifiedRemoteSeaweedCandidate(value.input, value.inspectArchive, value.dependencies);
    assert.equal(receipt.phases.find((phase) => phase.name === "owned_docker_cleanup")?.result, "PASSED");
    const removals = value.calls.filter((call) => call.args[0] === "image" && call.args[1] === "rm");
    assert.deepEqual(removals.map((call) => call.args[2]),
      [`auto-world-seaweed-s3:remote-${auditRunId}-attempt-1`]);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("consumer failure still removes the verified owned image and private archive", { skip: !linux }, async () => {
  const value = harness({ callbackFailure: true });
  try {
    await assert.rejects(withVerifiedRemoteSeaweedCandidate(value.input, value.inspectArchive, value.dependencies),
      /command_failed/u);
    assert.equal(value.calls.some((call) => call.args[0] === "image" && call.args[1] === "rm"), true);
    assert.equal(existsSync(value.parent), true);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});
