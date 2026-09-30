import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
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
  validatePostgresRemoteRuntimeMaterialReceipt,
  withVerifiedRemotePostgresCandidate,
  withVerifiedRemotePostgresRuntimeMaterial,
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
  candidateCollision = false, cleanupFailure = false, tagStatus = 0, pullMaterializes = true } = {}) {
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
      pulled = pullMaterializes;
      return { status: pullStatus, stdout: "", stderr: pullStatus ? "response lost" : "" };
    }
    if (args[0] === "image" && args[1] === "tag") {
      tagged = true;
      return { status: tagStatus, stdout: "", stderr: tagStatus ? "response lost after alias creation" : "" };
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

test("nonzero local tag response fails closed after cleaning the observed owned alias", { skip: !linux }, async () => {
  const value = harness({ tagStatus: 1 });
  try {
    await assert.rejects(withVerifiedRemotePostgresCandidate(value.input, value.inspectArchive, value.dependencies),
      /postgres_remote_candidate_alias_failed/u);
    assert.equal(value.calls.some(({ args }) => args[0] === "image" && args[1] === "save"), false);
    const removals = value.calls.filter(({ args }) => args[0] === "image" && args[1] === "rm");
    assert.deepEqual(removals.map(({ args }) => args[2]), [value.value.alias, value.value.policy.subject]);
    assert.deepEqual(readdirSync(value.parent), []);
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

test("runtime provider exposes detached owned material and returns a distinct diagnostic receipt",
  { skip: !linux }, async () => {
    const value = harness(); const runtime = { state: "VERIFIED", imageId: value.value.policy.candidate.imageId };
    try {
      const result = await withVerifiedRemotePostgresRuntimeMaterial(value.input, async (snapshot) => {
        assert.deepEqual(Object.keys(snapshot).sort(), ["archiveProof", "config", "diffIds", "dockerConfig",
          "imageId", "parent", "recipeRevision", "runId", "signal", "subject"]);
        assert.equal(snapshot.parent, path.join(value.parent, `remote-${remoteRunId}-attempt-1`));
        assert.equal(snapshot.dockerConfig, path.join(snapshot.parent, "docker-auth"));
        assert.equal(snapshot.imageId, value.value.policy.candidate.imageId);
        assert.equal(snapshot.subject, value.value.policy.subject);
        assert.equal(snapshot.runId, remoteRunId);
        assert.equal(snapshot.recipeRevision, remoteRevision);
        assert.deepEqual(snapshot.diffIds, value.input.policy.candidate.diffIds);
        assert.notEqual(snapshot.diffIds, value.input.policy.candidate.diffIds);
        assert.deepEqual(snapshot.config, { Entrypoint: ["docker-entrypoint.sh"], Cmd: ["postgres"] });
        assert.equal(Object.isFrozen(snapshot), true);
        assert.equal(Object.isFrozen(snapshot.diffIds), true);
        assert.equal(Object.isFrozen(snapshot.config), true);
        assert.equal(Object.isFrozen(snapshot.config.Entrypoint), true);
        assert.throws(() => { snapshot.config.Cmd[0] = "foreign"; }, TypeError);
        assert.throws(() => { snapshot.diffIds[0] = digest(Buffer.from("foreign")); }, TypeError);
        assert.equal(snapshot.archiveProof.archiveSha256, hash(value.value.local.archive));
        assert.equal(existsSync(path.join(snapshot.parent, "candidate.tar")), true);
        assert.equal(Object.hasOwn(snapshot, "file"), false);
        assert.equal(Object.hasOwn(snapshot, "policy"), false);
        return runtime;
      }, value.dependencies);
      const receipt = result.material;
      assert.equal(result.runtime, runtime);
      assert.equal(Object.isFrozen(result), true);
      assert.equal(validatePostgresRemoteRuntimeMaterialReceipt(receipt, value.value.policy).state, "VERIFIED");
      assert.equal(receipt.kind, "POSTGRES_REMOTE_RUNTIME_MATERIAL_RECEIPT_V1");
      assert.equal(receipt.authority, "DIAGNOSTIC_ONLY");
      assert.equal(receipt.imageExecution, "VERIFIED_DIAGNOSTIC");
      assert.equal(receipt.vulnerabilityAudit, "NOT_ATTEMPTED");
      assert.equal(receipt.admission, "NOT_AUTHORIZED");
      assert.equal(receipt.registryWrite, "NOT_ATTEMPTED");
      assert.equal(receipt.publication, "PUBLISHED_UNADMITTED");
      assert.equal(receipt.supportStartedAt, null);
      assert.equal(receipt.supportEndsAt, null);
      assert.equal(receipt.archiveUntil, null);
      assert.deepEqual(receipt.phases.map(({ name }) => name), phaseNames.map((name) =>
        name === "private_archive_callback" ? "runtime_diagnostics" : name));
      assert.equal(receipt.phases.every(({ result: outcome }) => outcome === "PASSED"), true);
      assert.deepEqual(receipt.image.diffIds, value.value.policy.candidate.diffIds);
      assert.equal(JSON.stringify(receipt).includes("docker-auth"), false);
      assert.equal(JSON.stringify(receipt).includes("private-test-token"), false);
      assert.throws(() => validatePostgresRemoteCandidateReceipt(receipt, value.value.policy), /candidate_receipt_invalid/u);
      for (const mutate of [
        (changed) => { changed.imageExecution = "NOT_ATTEMPTED"; },
        (changed) => { changed.authority = "REMOTE_READ_ONLY"; },
        (changed) => { changed.kind = "POSTGRES_REMOTE_CANDIDATE_RECEIPT_V1"; },
        (changed) => { changed.image.diffIds.reverse(); },
        (changed) => { changed.archive.diffIds.pop(); },
        (changed) => { changed.phases[11].name = "private_archive_callback"; },
        (changed) => { changed.supportStartedAt = "2026-09-30T00:00:00.000Z"; },
        (changed) => { changed.dockerConfig = "private"; },
      ]) {
        const changed = globalThis.structuredClone(receipt); mutate(changed);
        assert.throws(() => validatePostgresRemoteRuntimeMaterialReceipt(changed, value.value.policy),
          /runtime_material_receipt_invalid/u);
      }
      assert.deepEqual(readdirSync(value.parent), []);
    } finally { rmSync(value.parent, { recursive: true, force: true }); }
  });

test("read material cannot be relabeled as verified runtime", { skip: !linux }, async () => {
  const value = harness();
  try {
    const receipt = await withVerifiedRemotePostgresCandidate(value.input, value.inspectArchive, value.dependencies);
    assert.equal(receipt.kind, "POSTGRES_REMOTE_CANDIDATE_RECEIPT_V1");
    assert.equal(receipt.authority, "REMOTE_READ_ONLY");
    assert.equal(receipt.imageExecution, "NOT_ATTEMPTED");
    assert.deepEqual(receipt.phases.map(({ name }) => name), phaseNames);
    assert.throws(() => validatePostgresRemoteRuntimeMaterialReceipt(receipt, value.value.policy),
      /runtime_material_receipt_invalid/u);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("runtime callback errors are masked after confirmed image and temporary cleanup", { skip: !linux }, async () => {
  const value = harness();
  try {
    await assert.rejects(withVerifiedRemotePostgresRuntimeMaterial(value.input, async () => {
      throw new Error("private-test-token and private output");
    }, value.dependencies), (error) => {
      assert.equal(error.message, "postgres_remote_runtime_material_failed");
      assert.deepEqual(Object.keys(error).sort(), ["code", "imageCleanupFailure", "inspectionFailed",
        "primaryFailure", "runtimeCleanupFailure", "runtimeDiagnostic", "temporaryCleanupFailure"]);
      assert.equal(error.code, "postgres_remote_runtime_material_failed");
      assert.equal(error.inspectionFailed, true);
      assert.equal(error.primaryFailure, "postgres_remote_runtime_diagnostics_failed");
      assert.equal(error.runtimeCleanupFailure, null);
      assert.deepEqual(error.runtimeDiagnostic, { code: "postgres_runtime_failed", phase: "CONTEXT" });
      assert.equal(error.imageCleanupFailure, null);
      assert.equal(error.temporaryCleanupFailure, null);
      assert.equal(JSON.stringify(error).includes("private-test-token"), false);
      return true;
    });
    assert.deepEqual(readdirSync(value.parent), []);
    assert.equal(value.calls.filter(({ args }) => args[0] === "image" && args[1] === "rm").length, 2);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("runtime provider retains only exact runtime codes and bounded phases without subprocess details",
  { skip: !linux }, async () => {
    const cases = [
      ...["CONTEXT", "GOSU_PROBE", "VOLUME_CREATE", "SERVICE_ONE", "SERVICE_TWO", "CLEANUP"].map((phase) =>
        ["postgres_runtime_command_failed", phase, { code: "postgres_runtime_command_failed", phase }]),
      ["postgres_runtime_readiness_timeout", "SERVICE_ONE", { code: "postgres_runtime_readiness_timeout", phase: "SERVICE_ONE" }],
      ["postgres_runtime_readback_invalid", "SERVICE_TWO", { code: "postgres_runtime_readback_invalid", phase: "SERVICE_TWO" }],
      ["postgres_runtime_readback_invalid", "private-test-token", { code: "postgres_runtime_readback_invalid", phase: "CONTEXT" }],
      ["postgres_runtime_forged_private_test_token", undefined, { code: "postgres_runtime_failed", phase: "CONTEXT" }],
      ["postgres_runtime_forged_private_test_token", "SERVICE_TWO", { code: "postgres_runtime_failed", phase: "SERVICE_TWO" }],
      ["postgres_runtime_readiness_timeout private-test-token", undefined, { code: "postgres_runtime_failed", phase: "CONTEXT" }],
      ["private-test-token and private output", undefined, { code: "postgres_runtime_failed", phase: "CONTEXT" }],
    ];
    for (const [message, phase, expected] of cases) {
      const value = harness();
      try {
        await assert.rejects(withVerifiedRemotePostgresRuntimeMaterial(value.input, async () => {
          throw Object.assign(new Error(message), { phase, code: "postgres_runtime_readiness_timeout",
            stdout: "private-test-token", stderr: "private subprocess output", cause: new Error("private-test-token"),
            runtimeDiagnostic: { code: "private-test-token", phase: "private-test-token" } });
        }, value.dependencies), (error) => {
          assert.equal(error.code, "postgres_remote_runtime_material_failed");
          assert.equal(error.primaryFailure, "postgres_remote_runtime_diagnostics_failed");
          assert.equal(error.runtimeCleanupFailure, null);
          assert.deepEqual(error.runtimeDiagnostic, expected);
          assert.deepEqual(Object.keys(error.runtimeDiagnostic).sort(), ["code", "phase"]);
          assert.equal(Object.isFrozen(error.runtimeDiagnostic), true);
          assert.equal(JSON.stringify(error).includes("private-test-token"), false);
          assert.equal(JSON.stringify(error).includes("private subprocess output"), false);
          assert.equal(Object.hasOwn(error, "cause"), false);
          return true;
        });
        assert.deepEqual(readdirSync(value.parent), []);
      } finally { rmSync(value.parent, { recursive: true, force: true }); }
    }
  });

test("runtime cleanup uncertainty preserves the private residual regardless of image cleanup", { skip: !linux }, async () => {
  for (const cleanupFailure of [false, true]) {
    const value = harness({ cleanupFailure }); let retainedWork; let residual;
    try {
      await assert.rejects(withVerifiedRemotePostgresRuntimeMaterial(value.input, async (snapshot) => {
        retainedWork = snapshot.parent;
        const runtimeDirectory = path.join(snapshot.parent, "runtime-retained");
        mkdirSync(runtimeDirectory, { mode: 0o700 });
        residual = path.join(runtimeDirectory, "private-residual");
        writeFileSync(residual, "private runtime residual", { mode: 0o600 });
        throw Object.assign(new Error("postgres_runtime_cleanup_uncertain"), { phase: "CLEANUP", stdout: "private runtime residual" });
      }, value.dependencies), (error) => {
        assert.equal(error.code, "postgres_remote_runtime_cleanup_uncertain");
        assert.equal(error.inspectionFailed, true);
        assert.equal(error.primaryFailure, "postgres_remote_runtime_cleanup_uncertain");
        assert.equal(error.runtimeCleanupFailure, "postgres_remote_runtime_cleanup_uncertain");
        assert.deepEqual(error.runtimeDiagnostic, { code: "postgres_runtime_cleanup_uncertain", phase: "CLEANUP" });
        assert.equal(error.imageCleanupFailure, cleanupFailure ? "postgres_remote_candidate_image_cleanup_failed" : null);
        assert.equal(error.temporaryCleanupFailure, "postgres_remote_candidate_temporary_cleanup_failed");
        assert.equal(JSON.stringify(error).includes("private runtime residual"), false);
        return true;
      });
      assert.deepEqual(readdirSync(value.parent), [path.basename(retainedWork)]);
      assert.equal(readFileSync(residual, "utf8"), "private runtime residual");
      assert.equal(value.calls.filter(({ args }) => args[0] === "image" && args[1] === "rm").length,
        cleanupFailure ? 1 : 2);
    } finally { rmSync(value.parent, { recursive: true, force: true }); }
  }
});

test("runtime diagnostic, image and temporary failures remain separately bounded", { skip: !linux }, async () => {
  const value = harness({ cleanupFailure: true });
  try {
    await assert.rejects(withVerifiedRemotePostgresRuntimeMaterial(value.input, async (snapshot) => {
      renameSync(snapshot.parent, `${snapshot.parent}-moved`);
      throw new Error("private diagnostic output");
    }, value.dependencies), (error) => {
      assert.equal(error.code, "postgres_remote_runtime_cleanup_uncertain");
      assert.equal(error.inspectionFailed, true);
      assert.equal(error.primaryFailure, "postgres_remote_runtime_diagnostics_failed");
      assert.equal(error.runtimeCleanupFailure, null);
      assert.equal(error.imageCleanupFailure, "postgres_remote_candidate_image_cleanup_failed");
      assert.equal(error.temporaryCleanupFailure, "postgres_remote_candidate_temporary_cleanup_failed");
      assert.equal(JSON.stringify(error).includes("private diagnostic output"), false);
      return true;
    });
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("temporary cleanup failure forbids a runtime material result after successful diagnostics",
  { skip: !linux }, async () => {
    const value = harness();
    try {
      await assert.rejects(withVerifiedRemotePostgresRuntimeMaterial(value.input, async (snapshot) => {
        renameSync(snapshot.parent, `${snapshot.parent}-moved`);
        return { state: "VERIFIED" };
      }, value.dependencies), (error) => {
        assert.equal(error.code, "postgres_remote_runtime_cleanup_uncertain");
        assert.equal(error.inspectionFailed, false);
        assert.equal(error.primaryFailure, null);
        assert.equal(error.runtimeCleanupFailure, null);
        assert.equal(error.runtimeDiagnostic, null);
        assert.equal(error.imageCleanupFailure, null);
        assert.equal(error.temporaryCleanupFailure, "postgres_remote_candidate_temporary_cleanup_failed");
        return true;
      });
    } finally { rmSync(value.parent, { recursive: true, force: true }); }
  });

test("failed exact pull without material never reaches runtime or removes a foreign image", { skip: !linux }, async () => {
  const value = harness({ pullStatus: 1, pullMaterializes: false }); let callbacks = 0;
  try {
    await assert.rejects(withVerifiedRemotePostgresRuntimeMaterial(value.input, async () => { callbacks += 1; },
      value.dependencies), (error) => {
      assert.equal(error.code, "postgres_remote_runtime_material_failed");
      assert.equal(error.inspectionFailed, false);
      assert.equal(error.primaryFailure, "postgres_remote_candidate_pull_ownership_unverified");
      assert.equal(error.runtimeCleanupFailure, null);
      assert.equal(error.runtimeDiagnostic, null);
      assert.equal(error.imageCleanupFailure, null);
      assert.equal(error.temporaryCleanupFailure, null);
      return true;
    });
    assert.equal(callbacks, 0);
    assert.equal(value.calls.filter(({ args }) => args[0] === "pull").length, 1);
    assert.equal(value.calls.some(({ args }) => args[0] === "image" && args[1] === "tag"), false);
    assert.equal(value.calls.some(({ args }) => args[0] === "image" && args[1] === "rm"), false);
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("runtime refuses changed pull ownership and retains cleanup uncertainty", { skip: !linux }, async () => {
  const value = harness({ inventoryDrift: true }); let callbacks = 0;
  try {
    await assert.rejects(withVerifiedRemotePostgresRuntimeMaterial(value.input, async () => { callbacks += 1; },
      value.dependencies), (error) => {
      assert.equal(error.code, "postgres_remote_runtime_cleanup_uncertain");
      assert.equal(error.primaryFailure, "postgres_remote_candidate_pull_ownership_unverified");
      assert.equal(error.imageCleanupFailure, "postgres_remote_candidate_cleanup_ownership_unverified");
      return true;
    });
    assert.equal(callbacks, 0);
    assert.equal(value.calls.some(({ args }) => args[0] === "image" && args[1] === "rm"), false);
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("runtime rejects missing inspect config before callback while cleaning proven material", { skip: !linux }, async () => {
  const value = harness(); let callbacks = 0; const original = value.dependencies.commandRunner;
  value.dependencies.commandRunner = (command, args, options) => {
    const response = original(command, args, options);
    if (args[0] === "image" && args[1] === "inspect" && args[2] === "--format" && response.status === 0) {
      const image = JSON.parse(response.stdout); delete image.Config;
      return { ...response, stdout: JSON.stringify(image) };
    }
    return response;
  };
  try {
    await assert.rejects(withVerifiedRemotePostgresRuntimeMaterial(value.input, async () => { callbacks += 1; },
      value.dependencies), (error) => {
      assert.equal(error.code, "postgres_remote_runtime_material_failed");
      assert.equal(error.primaryFailure, "postgres_remote_candidate_image_invalid");
      assert.equal(error.imageCleanupFailure, null);
      return true;
    });
    assert.equal(callbacks, 0);
    assert.deepEqual(readdirSync(value.parent), []);
    assert.equal(value.calls.some(({ args }) => args[0] === "image" && args[1] === "rm"), true);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});
