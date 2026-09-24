import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildFixtureTar, fixtureConfig } from "../scripts/image-import-fixture/archive.mjs";
import {
  SEAWEED_CANDIDATE_IMPORT_MESSAGE, validateSavedSeaweedCandidate,
} from "../scripts/seaweed-image/candidate-archive.mjs";

const BLOCK = 512;
const TAG = "auto-world-seaweed-candidate:test";
const VERSION = "28.0.4";
const CREATED = "2026-09-24T00:00:00Z";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const json = (value) => Buffer.from(JSON.stringify(value));
const neutral = { Hostname: "", Domainname: "", User: "", AttachStdin: false, AttachStdout: false,
  AttachStderr: false, Tty: false, OpenStdin: false, StdinOnce: false, Env: null, Cmd: null, Image: "",
  Volumes: null, WorkingDir: "", Entrypoint: null, OnBuild: null, Labels: null };

function octal(header, offset, length, value) {
  Buffer.from(`${value.toString(8).padStart(length - 1, "0")}\0`, "ascii").copy(header, offset);
}

function header(name, content, type = "0") {
  const result = Buffer.alloc(BLOCK); Buffer.from(name).copy(result, 0);
  octal(result, 100, 8, type === "5" ? 0o755 : 0o644); octal(result, 108, 8, 0); octal(result, 116, 8, 0);
  octal(result, 124, 12, content.length); octal(result, 136, 12, 1); result.fill(0x20, 148, 156);
  result[156] = type.charCodeAt(0); Buffer.from("ustar\0").copy(result, 257); Buffer.from("00").copy(result, 263);
  const checksum = result.reduce((sum, byte) => sum + byte, 0);
  Buffer.from(`${checksum.toString(8).padStart(6, "0")}\0 `).copy(result, 148); return result;
}

function tar(entries, trailing = Buffer.alloc(0)) {
  const blocks = [];
  for (const entry of entries) {
    const content = entry.content ?? Buffer.alloc(0); blocks.push(header(entry.name, content, entry.type), content);
    const padding = (BLOCK - content.length % BLOCK) % BLOCK; if (padding) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(BLOCK * 2), trailing); return Buffer.concat(blocks);
}

function candidate({ configChange, manifestChange, legacyChange, repositoriesChange, extra = [], trailing } = {}) {
  const layer = buildFixtureTar(); const diffId = `sha256:${sha(layer)}`; const layerDigest = `sha256:${sha(layer)}`;
  const runtime = fixtureConfig("test");
  const config = { architecture: "amd64", comment: SEAWEED_CANDIDATE_IMPORT_MESSAGE, config: runtime,
    container_config: { ...neutral }, created: CREATED, docker_version: VERSION,
    history: [{ created: CREATED, comment: SEAWEED_CANDIDATE_IMPORT_MESSAGE }], os: "linux",
    rootfs: { type: "layers", diff_ids: [diffId] } };
  configChange?.(config);
  const configBytes = json(config); const configDigest = `sha256:${sha(configBytes)}`;
  const oci = { schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: configDigest, size: configBytes.length },
    layers: [{ mediaType: "application/vnd.oci.image.layer.v1.tar", digest: layerDigest, size: layer.length }] };
  manifestChange?.(oci);
  const ociBytes = json(oci); const ociDigest = `sha256:${sha(ociBytes)}`;
  const index = json({ schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json", manifests: [{
    mediaType: "application/vnd.oci.image.manifest.v1+json", digest: ociDigest, size: ociBytes.length,
    annotations: { "io.containerd.image.name": `docker.io/library/${TAG}`, "org.opencontainers.image.ref.name": "test" },
  }] });
  const item = { Config: `blobs/sha256/${configDigest.slice(7)}`, RepoTags: [TAG],
    Layers: [`blobs/sha256/${layerDigest.slice(7)}`], LayerSources: { [diffId]: {
      mediaType: "application/vnd.oci.image.layer.v1.tar", size: layer.length, digest: layerDigest } } };
  const legacy = { architecture: "amd64", comment: SEAWEED_CANDIDATE_IMPORT_MESSAGE, config: runtime,
    container_config: { ...neutral }, created: CREATED, docker_version: VERSION, id: "b".repeat(64), os: "linux" };
  legacyChange?.(legacy); const legacyBytes = json(legacy);
  const repositories = { "auto-world-seaweed-candidate": { test: diffId.slice(7) } }; repositoriesChange?.(repositories);
  const archive = tar([{ name: "blobs/", type: "5" }, { name: "blobs/sha256/", type: "5" },
    { name: "oci-layout", content: json({ imageLayoutVersion: "1.0.0" }) }, { name: "index.json", content: index },
    { name: "manifest.json", content: json([item]) }, { name: `blobs/sha256/${ociDigest.slice(7)}`, content: ociBytes },
    { name: `blobs/sha256/${configDigest.slice(7)}`, content: configBytes },
    { name: `blobs/sha256/${layerDigest.slice(7)}`, content: layer },
    { name: `blobs/sha256/${sha(legacyBytes)}`, content: legacyBytes },
    { name: "repositories", content: json(repositories) }, ...extra], trailing);
  return { archive, configDigest, diffId, layer, memberCount: 9, runtime };
}

function scope(mutations) {
  const root = mkdtempSync(path.join(os.tmpdir(), "aw-candidate-archive-")); const file = path.join(root, "candidate.tar");
  const fixture = candidate(mutations); writeFileSync(file, fixture.archive);
  return { root, file, fixture, options: { file, imageId: fixture.configDigest, tag: TAG, diffId: fixture.diffId,
    rawSize: fixture.layer.length, memberCount: fixture.memberCount, serverVersion: VERSION,
    validateFilesystem: () => {}, validateRuntimeConfig: () => {} } };
}

test("streams and validates one complete classic Moby candidate", async () => {
  const value = scope(); let filesystem; let runtime;
  value.options.validateFilesystem = (entries) => { filesystem = entries; };
  value.options.validateRuntimeConfig = (config) => { runtime = config; };
  try {
    const proof = await validateSavedSeaweedCandidate(value.options);
    assert.equal(proof.kind, "SEAWEED_SAVED_CANDIDATE_PROOF_V1");
    assert.equal(proof.authority, "PREPARATION_ONLY"); assert.equal(proof.candidateAuthorization, "NOT_AUTHORIZED");
    assert.equal(proof.identityType, "CLASSIC_CONFIG_ID");
    assert.equal(proof.imageId, value.fixture.configDigest); assert.equal(proof.diffId, value.fixture.diffId);
    assert.equal(proof.rawSize, value.fixture.layer.length); assert.equal(proof.memberCount, 9);
    assert.equal(filesystem.length, 9); assert.deepEqual(runtime, value.fixture.runtime);
    assert.equal(proof.archiveSha256, sha(readFileSync(value.file)));
  } finally { rmSync(value.root, { recursive: true, force: true }); }
});

for (const [label, mutation, pattern] of [
  ["a second layer", { manifestChange: (manifest) => { manifest.layers.push({ ...manifest.layers[0] }); } }, /oci_invalid/u],
  ["a changed import message", { configChange: (config) => { config.comment = "other"; } }, /config_invalid/u],
  ["changed legacy metadata", { legacyChange: (legacy) => { legacy.docker_version = "28.0.3"; } }, /classic_invalid/u],
  ["changed repositories", { repositoriesChange: (repositories) => { repositories["auto-world-seaweed-candidate"].test = "0".repeat(64); } }, /classic_invalid/u],
  ["an unknown outer member", { extra: [{ name: "unknown", content: Buffer.from("x") }] }, /member_invalid/u],
  ["nonzero trailing bytes", { trailing: Buffer.concat([Buffer.alloc(BLOCK - 1), Buffer.from([1])]) }, /tar_eoa_invalid/u],
]) test(`rejects ${label}`, async () => {
  const value = scope(mutation);
  try { await assert.rejects(validateSavedSeaweedCandidate(value.options), pattern); }
  finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("rejects caller identity drift and callback failures with bounded codes", async () => {
  for (const field of ["imageId", "diffId"]) {
    const value = scope(); value.options[field] = `sha256:${"0".repeat(64)}`;
    try { await assert.rejects(validateSavedSeaweedCandidate(value.options), new RegExp(field === "imageId" ? "image_id_invalid" : "config_invalid", "u")); }
    finally { rmSync(value.root, { recursive: true, force: true }); }
  }
  for (const [callback, pattern] of [["validateRuntimeConfig", /runtime_invalid/u], ["validateFilesystem", /filesystem_invalid/u]]) {
    const value = scope(); value.options[callback] = () => { throw new Error("sensitive callback detail"); };
    try { await assert.rejects(validateSavedSeaweedCandidate(value.options), pattern); }
    finally { rmSync(value.root, { recursive: true, force: true }); }
  }
});

test("rejects outer-header and retained-layer byte corruption", async () => {
  for (const [mutate, pattern] of [
    [(archive) => { archive[0] ^= 1; }, /tar_checksum_invalid/u],
    [(archive) => {
      const marker = Buffer.from("AUTO WORLD PUBLIC SYNTHETIC FIXTURE\n"); const offset = archive.indexOf(marker);
      assert.notEqual(offset, -1); archive[offset] ^= 1;
    }, /blob_invalid/u],
  ]) {
    const value = scope(); const archive = Buffer.from(value.fixture.archive); mutate(archive); writeFileSync(value.file, archive);
    try { await assert.rejects(validateSavedSeaweedCandidate(value.options), pattern); }
    finally { rmSync(value.root, { recursive: true, force: true }); }
  }
});

test("detects replacement or mutation before returning a proof", async () => {
  const value = scope();
  value.options.validateFilesystem = () => { writeFileSync(value.file, Buffer.alloc(value.fixture.archive.length)); };
  try { await assert.rejects(validateSavedSeaweedCandidate(value.options), /file_changed|tar_/u); }
  finally { rmSync(value.root, { recursive: true, force: true }); }
});

test("honors a pre-aborted caller without opening the archive", async () => {
  const value = scope(); const controller = new globalThis.AbortController(); controller.abort(); value.options.signal = controller.signal;
  try { await assert.rejects(validateSavedSeaweedCandidate(value.options), /candidate_archive_aborted/u); }
  finally { rmSync(value.root, { recursive: true, force: true }); }
});
