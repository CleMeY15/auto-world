import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";


const BLOCK = 512;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const digest = (value) => `sha256:${hash(value)}`;
const json = (value) => Buffer.from(JSON.stringify(value));

function writeOctal(header, offset, length, value) {
  Buffer.from(`${value.toString(8).padStart(length - 1, "0")}\0`).copy(header, offset);
}

function header(name, size, type = "0") {
  const value = Buffer.alloc(BLOCK); Buffer.from(name).copy(value);
  writeOctal(value, 100, 8, type === "5" ? 0o755 : 0o644); writeOctal(value, 108, 8, 0);
  writeOctal(value, 116, 8, 0); writeOctal(value, 124, 12, size); writeOctal(value, 136, 12, 1_700_000_000);
  value.fill(0x20, 148, 156); value.write(type, 156); Buffer.from("ustar\0").copy(value, 257);
  Buffer.from("00").copy(value, 263); Buffer.from("root").copy(value, 265); Buffer.from("root").copy(value, 297);
  const checksum = value.reduce((sum, byte) => sum + byte, 0);
  Buffer.from(`${checksum.toString(8).padStart(6, "0")}\0 `).copy(value, 148);
  return value;
}

function tar(entries, { end = true } = {}) {
  const parts = [];
  for (const entry of entries) {
    const content = entry.content ?? Buffer.alloc(0); parts.push(header(entry.name, content.length, entry.type ?? "0"));
    if (content.length > 0) parts.push(content, Buffer.alloc((BLOCK - content.length % BLOCK) % BLOCK));
  }
  if (end) parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

function archiveFixture(tag) {
  const raw = Array.from({ length: 12 }, (_, index) => {
    const content = Buffer.alloc(BLOCK * 2); Buffer.from(`raw-layer-${index}\n`).copy(content); return content;
  });
  const diffIds = raw.map(digest);
  const zero = { Hostname: "", Domainname: "", User: "", AttachStdin: false, AttachStdout: false,
    AttachStderr: false, Tty: false, OpenStdin: false, StdinOnce: false, Env: null, Cmd: null, Image: "",
    Volumes: null, WorkingDir: "", Entrypoint: null, OnBuild: null, Labels: null };
  const runtime = { Entrypoint: ["docker-entrypoint.sh"], Cmd: ["postgres"] };
  const config = json({ architecture: "amd64", os: "linux", docker_version: "28.0.4", config: runtime,
    rootfs: { type: "layers", diff_ids: diffIds } });
  const imageId = digest(config);
  const ociManifest = json({ schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: imageId, size: config.length },
    layers: diffIds.map((value, index) => ({ mediaType: "application/vnd.oci.image.layer.v1.tar",
      size: raw[index].length, digest: value })) });
  const ociManifestDigest = digest(ociManifest);
  const manifest = json([{ Config: `blobs/sha256/${imageId.slice(7)}`, RepoTags: [tag],
    Layers: diffIds.map((value) => `blobs/sha256/${value.slice(7)}`),
    LayerSources: Object.fromEntries(diffIds.map((value, index) => [value,
      { mediaType: "application/vnd.oci.image.layer.v1.tar", size: raw[index].length, digest: value }])) }]);
  const index = json({ schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json", manifests: [{
    mediaType: "application/vnd.oci.image.manifest.v1+json", digest: ociManifestDigest, size: ociManifest.length,
    annotations: { "io.containerd.image.name": `docker.io/library/${tag}`,
      "org.opencontainers.image.ref.name": tag.split(":")[1] } }] });
  const repositories = json({ "aw-postgres-gosu": { [tag.split(":")[1]]: diffIds.at(-1).slice(7) } });
  const ids = Array.from({ length: 12 }, (_, index) => hash(Buffer.from(`legacy-id-${index}`)));
  const legacy = ids.map((id, index) => json(index === ids.length - 1
    ? { id, parent: ids[index - 1], created: "2026-09-27T20:25:21.85346592Z", container: "c".repeat(64),
      container_config: runtime, docker_version: "28.0.4", config: runtime, architecture: "amd64", os: "linux" }
    : { id, ...(index > 0 ? { parent: ids[index - 1] } : {}), created: "1970-01-01T01:00:00+01:00",
      container_config: zero, os: "linux" }));
  const entries = [
    { name: "blobs/", type: "5" }, { name: "blobs/sha256/", type: "5" },
    ...raw.map((content, index) => ({ name: `blobs/sha256/${diffIds[index].slice(7)}`, content })),
    ...legacy.map((content) => ({ name: `blobs/sha256/${hash(content)}`, content })),
    { name: `blobs/sha256/${imageId.slice(7)}`, content: config },
    { name: `blobs/sha256/${ociManifestDigest.slice(7)}`, content: ociManifest },
    { name: "index.json", content: index }, { name: "manifest.json", content: manifest },
    { name: "oci-layout", content: json({ imageLayoutVersion: "1.0.0" }) },
    { name: "repositories", content: repositories },
  ];
  return { archive: tar(entries), entries, tag, diffIds, imageId, config, ociManifest,
    ociManifestDigest };
}


import {
  postgresRemoteCleanupOptions,
  validatePostgresRemoteCandidateReceipt,
  validatePostgresRemoteImage,
  validatePostgresRemotePolicy,
  validatePostgresRemotePublicationReceipt,
  validatePostgresRemoteRawManifest,
  withVerifiedRemotePostgresCandidate,
} from "../scripts/postgres-image/candidate-remote.mjs";
import { validatePostgresCandidateArchive } from "../scripts/postgres-image/candidate-proof.mjs";

const linux = process.platform === "linux";
const publisherRunId = "36361670116";
const remoteRunId = "40000000002";
const publisherRevision = "b93b0c76ec76abe283d66a17fa62eab7e580e679";
const remoteRevision = "2".repeat(40);
const receiptPath = new URL("../infra/postgres-image/candidate-publication-receipt.json", import.meta.url);
const policyPath = new URL("../infra/postgres-image/candidate-remote.json", import.meta.url);
const publicationReceipt = JSON.parse(readFileSync(receiptPath, "utf8"));
const committedPolicy = JSON.parse(readFileSync(policyPath, "utf8"));
const phaseNames = [
  "managed_engine", "registry_login", "raw_tag_manifest", "anonymous_digest_denied", "raw_digest_manifest",
  "local_inventory_before", "local_collision_check", "exact_digest_pull", "simple_local_alias",
  "private_docker_save", "full_archive_validation", "private_archive_callback", "owned_docker_cleanup",
  "owned_temporary_cleanup",
];

function remoteMaterial() {
  const alias = `aw-postgres-gosu:${hash(Buffer.from(`${remoteRunId}:${remoteRevision}`)).slice(0, 24)}`;
  const local = archiveFixture(alias);
  const layers = Array.from({ length: 12 }, (_, index) => ({
    mediaType: "application/vnd.docker.image.rootfs.diff.tar.gzip",
    digest: digest(Buffer.from(`compressed-${index}`)),
    size: Buffer.byteLength(`compressed-${index}`),
  }));
  const manifest = {
    schemaVersion: 2,
    mediaType: "application/vnd.docker.distribution.manifest.v2+json",
    config: {
      mediaType: "application/vnd.docker.container.image.v1+json",
      digest: local.imageId,
      size: local.config.length,
    },
    layers,
  };
  const raw = JSON.stringify(manifest);
  const manifestDigest = digest(Buffer.from(raw));
  const policy = {
    kind: "POSTGRES_REMOTE_CANDIDATE_POLICY_V1",
    authority: "REVIEWED_MAIN_POLICY",
    repository: "CleMeY15/auto-world",
    owner: "CleMeY15",
    image: "ghcr.io/clemey15/auto-world-postgres-gosu",
    platform: "linux/amd64",
    publishedTag: `candidate-${publisherRunId}-attempt-1`,
    subject: `ghcr.io/clemey15/auto-world-postgres-gosu@${manifestDigest}`,
    manifest: {
      digest: manifestDigest,
      bytes: Buffer.byteLength(raw),
      mediaType: manifest.mediaType,
      config: { digest: local.imageId, size: local.config.length, mediaType: manifest.config.mediaType },
      layers,
      baseLayerCount: 10,
      newLayerCount: 2,
    },
    candidate: { imageId: local.imageId, diffIds: local.diffIds },
    publisher: {
      workflowPath: ".github/workflows/postgres-candidate-publish-v4.yml",
      runId: publisherRunId,
      runNumber: "1",
      runAttempt: "1",
      recipeRevision: publisherRevision,
      receiptSha256: "d".repeat(64),
      receiptBytes: 22_970,
      result: "PASSED",
    },
  };
  return { alias, local, manifest, raw, policy };
}

function imageMetadata(value, alias) {
  return JSON.stringify({
    Id: value.policy.candidate.imageId,
    RepoTags: alias === undefined ? null : [alias],
    RepoDigests: [value.policy.subject],
    Os: "linux",
    Architecture: "amd64",
    Size: 305_000_000,
    RootFS: { Type: "layers", Layers: value.policy.candidate.diffIds },
    Config: { Entrypoint: ["docker-entrypoint.sh"], Cmd: ["postgres"] },
  });
}

test("committed policy and exact V4 publication receipt are closed and deeply frozen", () => {
  const policy = validatePostgresRemotePolicy(committedPolicy);
  const receipt = validatePostgresRemotePublicationReceipt(publicationReceipt, policy);
  assert.equal(Object.isFrozen(policy.manifest.layers), true);
  assert.equal(receipt.subject, policy.subject);
  assert.equal(receipt.remote.layers.length, 12);
  for (const mutate of [
    (value) => { value.subject = `${value.image}@sha256:${"0".repeat(64)}`; },
    (value) => { value.candidate.remoteTag = "candidate-1-attempt-1"; },
    (value) => { value.packageId = 1; },
    (value) => { value.runId = "1"; },
    (value) => { value.sourceSha = "0".repeat(40); },
    (value) => { value.candidate.configDigest = `sha256:${"0".repeat(64)}`; },
    (value) => { value.candidate.diffIds[0] = `sha256:${"0".repeat(64)}`; },
    (value) => { value.phases[0].name = "substituted"; },
  ]) {
    const changed = globalThis.structuredClone(publicationReceipt);
    mutate(changed);
    assert.throws(() => validatePostgresRemotePublicationReceipt(changed, policy), /publication_receipt_invalid/u);
  }
  const changedPackage = globalThis.structuredClone(publicationReceipt);
  changedPackage.packageId = 99_999_999;
  const changedBytes = `${JSON.stringify(changedPackage, null, 2)}\n`;
  const changedPolicy = globalThis.structuredClone(committedPolicy);
  changedPolicy.publisher.receiptBytes = Buffer.byteLength(changedBytes);
  changedPolicy.publisher.receiptSha256 = hash(Buffer.from(changedBytes));
  assert.throws(() => validatePostgresRemotePublicationReceipt(changedPackage,
    validatePostgresRemotePolicy(changedPolicy)), /publication_receipt_invalid/u);
});

test("remote policy, raw manifest and image inspect bind all twelve layers", () => {
  const value = remoteMaterial();
  const policy = validatePostgresRemotePolicy(value.policy);
  const manifest = validatePostgresRemoteRawManifest(value.raw, policy);
  const archive = validatePostgresCandidateArchive(value.local.archive, {
    imageId: policy.candidate.imageId, tag: value.alias, expectedDiffIds: policy.candidate.diffIds,
    expectedLayers: 12,
  });
  assert.equal(archive.imageId, policy.candidate.imageId);
  assert.equal(manifest.layers.length, 12);
  assert.equal(manifest.baseLayerCount, 10);
  assert.throws(() => validatePostgresRemoteRawManifest(`${value.raw}\n`, policy), /manifest_invalid/u);
  const image = validatePostgresRemoteImage(imageMetadata(value, value.alias), policy, value.alias);
  assert.deepEqual(image.diffIds, policy.candidate.diffIds);
  for (const changed of [
    { ...JSON.parse(imageMetadata(value, value.alias)), RepoDigests: [] },
    { ...JSON.parse(imageMetadata(value, value.alias)), RepoTags: [value.alias, "foreign:latest"] },
    { ...JSON.parse(imageMetadata(value, value.alias)), Architecture: "arm64" },
    { ...JSON.parse(imageMetadata(value, value.alias)),
      RootFS: { Type: "layers", Layers: policy.candidate.diffIds.slice(0, 11) } },
  ]) assert.throws(() => validatePostgresRemoteImage(JSON.stringify(changed), policy, value.alias), /image_invalid/u);
});

test("cleanup reserve is independent and bounded", () => {
  assert.equal(postgresRemoteCleanupOptions({}, 100, () => 100).timeoutMs, 240_000);
  assert.equal(postgresRemoteCleanupOptions({}, 100, () => 500_100).timeoutMs, 100_000);
  assert.throws(() => postgresRemoteCleanupOptions({}, 100, () => 600_100), /cleanup_timeout/u);
});

function harness({ pullStatus = 0, saveStatus = 0, inventoryDrift = false, callbackFailure = false,
  candidateCollision = false, cleanupFailure = false } = {}) {
  const parent = mkdtempSync(path.join(os.tmpdir(), "aw-postgres-remote-"));
  chmodSync(parent, 0o700);
  const value = remoteMaterial();
  const foreign = `sha256:${"f".repeat(64)}`;
  const calls = [];
  let pulled = false;
  let tagged = false;
  const commandRunner = (command, args, options) => {
    assert.equal(command, "docker");
    assert.equal(Object.hasOwn(options.env, "GITHUB_TOKEN"), false);
    calls.push({ args: [...args], anonymous: options.env.DOCKER_CONFIG.endsWith("docker-anonymous") });
    if (args[0] === "version") return { status: 0, stdout: "28.0.4|28.0.4\n", stderr: "" };
    if (args[0] === "buildx" && args[1] === "version") {
      return { status: 0, stdout: "github.com/docker/buildx v0.37.1\n", stderr: "" };
    }
    if (args[0] === "login") {
      assert.equal(options.input, "private-test-token\n");
      return { status: 0, stdout: "Login Succeeded\n", stderr: "" };
    }
    if (args[0] === "buildx" && args[1] === "imagetools") {
      if (options.env.DOCKER_CONFIG.endsWith("docker-anonymous")) {
        return { status: 1, stdout: "", stderr: "unauthorized: authentication required\n" };
      }
      return { status: 0, stdout: value.raw, stderr: "" };
    }
    if (args[0] === "image" && args[1] === "ls") {
      const extra = pulled && inventoryDrift ? `sha256:${"8".repeat(64)}\n` : "";
      return { status: 0, stdout: pulled || candidateCollision
        ? `${foreign}\n${value.policy.candidate.imageId}\n${extra}`
        : `${foreign}\n`, stderr: "" };
    }
    if (args[0] === "image" && args[1] === "inspect") {
      const reference = args.at(-1);
      const present = reference === value.alias ? tagged
        : reference === value.policy.subject ? pulled
          : reference === value.policy.candidate.imageId ? pulled || candidateCollision : false;
      if (!present) return { status: 1, stdout: "", stderr: "Error response from daemon: No such image\n" };
      if (args[2] === "--format") {
        return { status: 0, stdout: imageMetadata(value, tagged ? value.alias : undefined), stderr: "" };
      }
      return { status: 0, stdout: "[]", stderr: "" };
    }
    if (args[0] === "pull") {
      pulled = true;
      return { status: pullStatus, stdout: "", stderr: pullStatus ? "response lost" : "" };
    }
    if (args[0] === "image" && args[1] === "tag") {
      tagged = true;
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "image" && args[1] === "rm") {
      if (cleanupFailure) return { status: 1, stdout: "", stderr: "removal failed" };
      if (args[2] === value.alias) tagged = false;
      if (args[2] === value.policy.subject) pulled = false;
      return { status: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected command: ${args.join(" ")}`);
  };
  const saveRunner = async (_command, args, options) => {
    assert.deepEqual(args, ["image", "save", value.alias]);
    writeSync(options.handle, value.local.archive);
    calls.push({ args: [...args], anonymous: false });
    return { status: saveStatus, stdout: "", stderr: saveStatus ? "response lost" : "" };
  };
  const input = { parent, policy: value.policy, runId: remoteRunId, recipeRevision: remoteRevision };
  const inspectArchive = async (snapshot) => {
    assert.deepEqual(Object.keys(snapshot).sort(),
      ["archiveProof", "diffIds", "file", "imageId", "policy", "recipeRevision", "runId", "signal", "subject"]);
    assert.equal(snapshot.file, path.join(parent, `remote-${remoteRunId}-attempt-1`, "candidate.tar"));
    assert.equal(statSync(snapshot.file).size, value.local.archive.length);
    assert.equal(snapshot.archiveProof.archiveSha256, hash(value.local.archive));
    assert.deepEqual(snapshot.diffIds, value.policy.candidate.diffIds);
    if (callbackFailure) throw new Error("private callback failure");
  };
  return {
    parent, value, calls, input, inspectArchive,
    dependencies: {
      commandRunner,
      saveRunner,
      platform: "linux",
      env: { PATH: process.env.PATH ?? "", HOME: parent, GITHUB_TOKEN: "private-test-token" },
    },
  };
}

test("remote provider composes with the real PostgreSQL archive validator and leaves no private bytes",
  { skip: !linux }, async () => {
    const value = harness();
    try {
      const receipt = await withVerifiedRemotePostgresCandidate(value.input, value.inspectArchive, value.dependencies);
      assert.equal(validatePostgresRemoteCandidateReceipt(receipt, value.value.policy).state, "VERIFIED");
      assert.equal(receipt.authority, "REMOTE_READ_ONLY");
      assert.equal(receipt.vulnerabilityAudit, "NOT_ATTEMPTED");
      assert.equal(receipt.imageExecution, "NOT_ATTEMPTED");
      assert.equal(receipt.admission, "NOT_AUTHORIZED");
      assert.equal(receipt.supportStartedAt, null);
      assert.equal(receipt.supportEndsAt, null);
      assert.equal(receipt.archiveUntil, null);
      assert.equal(receipt.engine.compressedDigestVerification, "MANAGED_MOBY_PULL");
      assert.equal(receipt.engine.compressedSizeVerification, "RECORDED_ONLY");
      assert.deepEqual(receipt.phases.map(({ name }) => name), phaseNames);
      assert.equal(value.calls.filter(({ args }) => args[0] === "pull").length, 1);
      assert.equal(value.calls.some(({ args }) => ["run", "create", "start", "exec", "scan", "push"].includes(args[0])), false);
      assert.deepEqual(readdirSync(value.parent), []);
    } finally {
      rmSync(value.parent, { recursive: true, force: true });
    }
  });

test("lost pull and save responses remain honest only after exact independent state checks",
  { skip: !linux }, async () => {
    const value = harness({ pullStatus: 1, saveStatus: 1 });
    try {
      const receipt = await withVerifiedRemotePostgresCandidate(value.input, value.inspectArchive, value.dependencies);
      assert.equal(receipt.engine.pullResponse, "FAILED_BUT_EXACT_STATE_CONFIRMED");
      assert.equal(receipt.archive.saveResponse, "FAILED_BUT_EXACT_ARCHIVE_CONFIRMED");
    } finally {
      rmSync(value.parent, { recursive: true, force: true });
    }
  });

test("callback failure still removes the owned image and private archive", { skip: !linux }, async () => {
  const value = harness({ callbackFailure: true });
  try {
    await assert.rejects(withVerifiedRemotePostgresCandidate(value.input, value.inspectArchive, value.dependencies),
      (error) => error.message === "postgres_candidate_inspection_failed"
        && error.authority === "PREPARATION_ONLY" && error.candidateAuthorization === "NOT_AUTHORIZED");
    assert.equal(value.calls.some(({ args }) => args[0] === "image" && args[1] === "rm"), true);
    assert.deepEqual(readdirSync(value.parent), []);
  } finally {
    rmSync(value.parent, { recursive: true, force: true });
  }
});

test("ambiguous ownership never deletes a pulled or foreign image", { skip: !linux }, async () => {
  const value = harness({ inventoryDrift: true });
  try {
    await assert.rejects(withVerifiedRemotePostgresCandidate(value.input, value.inspectArchive, value.dependencies),
      /cleanup_ownership_unverified/u);
    assert.equal(value.calls.some(({ args }) => args[0] === "image" && args[1] === "rm"), false);
  } finally {
    rmSync(value.parent, { recursive: true, force: true });
  }
});

test("pre-existing candidate config blocks pull and cleanup", { skip: !linux }, async () => {
  const value = harness({ candidateCollision: true });
  try {
    await assert.rejects(withVerifiedRemotePostgresCandidate(value.input, value.inspectArchive, value.dependencies),
      /local_collision/u);
    assert.equal(value.calls.some(({ args }) => args[0] === "pull"), false);
    assert.equal(value.calls.some(({ args }) => args[0] === "image" && args[1] === "rm"), false);
  } finally {
    rmSync(value.parent, { recursive: true, force: true });
  }
});

test("cleanup failure takes precedence over successful inspection", { skip: !linux }, async () => {
  const value = harness({ cleanupFailure: true });
  try {
    await assert.rejects(withVerifiedRemotePostgresCandidate(value.input, value.inspectArchive, value.dependencies),
      /image_cleanup_failed/u);
  } finally {
    rmSync(value.parent, { recursive: true, force: true });
  }
});
