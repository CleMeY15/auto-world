import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { validatePostgresCandidateArchive, validatePostgresCandidateArchiveMaterial, validatePostgresCandidateRemoteManifest }
  from "../scripts/postgres-image/candidate-proof.mjs";
import { validateBaseInspect, validateCandidateInspect } from "../scripts/postgres-image/diagnostic.mjs";

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

function refreshChecksum(value) {
  value.fill(0x20, 148, 156);
  const checksum = value.subarray(0, BLOCK).reduce((sum, byte) => sum + byte, 0);
  Buffer.from(`${checksum.toString(8).padStart(6, "0")}\0 `).copy(value, 148);
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

function fixture() {
  const tag = `aw-postgres-gosu:${"a".repeat(24)}`;
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

function archiveOptions(value) {
  return { imageId: value.imageId, tag: value.tag, expectedDiffIds: value.diffIds, expectedLayers: 12,
    maximumBytes: 1024 ** 2 };
}

test("archive material exposes the same proof and the complete authenticated frozen configuration", () => {
  const value = fixture(); const options = archiveOptions(value);
  const material = validatePostgresCandidateArchiveMaterial(value.archive, options);
  assert.deepEqual(Object.keys(material).sort(), ["archiveProof", "configuration"]);
  assert.deepEqual(material.archiveProof, validatePostgresCandidateArchive(value.archive, options));
  assert.deepEqual(material.configuration, JSON.parse(value.config.toString("utf8")));
  assert.ok(Object.isFrozen(material.configuration.config.Entrypoint));
  assert.ok(Object.isFrozen(material.configuration.rootfs.diff_ids));
  const config = Buffer.from(value.archive); config[config.indexOf(value.config) + 20] ^= 1;
  const layer = Buffer.from(value.archive); layer[layer.indexOf(Buffer.from("raw-layer-0"))] ^= 1;
  for (const substituted of [config, layer]) assert.throws(() =>
    validatePostgresCandidateArchiveMaterial(substituted, options), /postgres_candidate_proof_/u);
});

test("candidate archive proof binds the exact config, 12 DiffIDs and closed OCI/Docker inventory", () => {
  const value = fixture(); const proof = validatePostgresCandidateArchive(value.archive, archiveOptions(value));
  assert.equal(proof.archiveSha256, hash(value.archive));
  assert.equal(proof.imageId, value.imageId);
  assert.equal(proof.configDigest, value.imageId);
  assert.deepEqual(proof.diffIds, value.diffIds);
  assert.equal(proof.compatibilityRecords.length, 12);
  assert.equal(proof.remoteLayerVerification, "NOT_ESTABLISHED_BY_DOCKER_SAVE");
  assert.equal(proof.archiveMembers, 32);
});

test("candidate archive proof refuses traversal, duplicates, truncation, extras, oversize and invalid tar", () => {
  const value = fixture(); const options = archiveOptions(value);
  const attacks = [
    tar([{ name: "../escape", content: Buffer.from("x") }]),
    tar([...value.entries, value.entries[2]]),
    value.archive.subarray(0, value.archive.length - BLOCK),
    tar([...value.entries, { name: "extra", content: Buffer.from("x") }]),
  ];
  for (const archive of attacks) assert.throws(() => validatePostgresCandidateArchive(archive, options),
    /postgres_candidate_proof_/u);
  assert.throws(() => validatePostgresCandidateArchive(value.archive, { ...options,
    maximumBytes: value.archive.length - BLOCK }), /postgres_candidate_proof_archive_size_invalid/u);
  const invalid = Buffer.from(value.archive); invalid[257] = 0; refreshChecksum(invalid);
  assert.throws(() => validatePostgresCandidateArchive(invalid, options),
    /postgres_candidate_proof_tar_format_invalid/u);
});

test("candidate archive proof rejects tar extensions, links, unsafe prefixes and hidden trailing data", () => {
  const value = fixture(); const options = archiveOptions(value);
  for (const type of ["x", "g", "L", "K", "2", "1"]) {
    const changed = Buffer.from(value.archive); changed.write(type, 156); refreshChecksum(changed);
    assert.throws(() => validatePostgresCandidateArchive(changed, options),
      /postgres_candidate_proof_tar_type_invalid/u);
  }
  const prefix = Buffer.from(value.archive);
  Buffer.from("../escape").copy(prefix, 345); refreshChecksum(prefix);
  assert.throws(() => validatePostgresCandidateArchive(prefix, options),
    /postgres_candidate_proof_tar_name_invalid/u);
  const layout = value.entries.find((entry) => entry.name === "oci-layout");
  const padded = Buffer.from(value.archive); const contentOffset = padded.indexOf(layout.content);
  assert.ok(contentOffset > 0); padded[contentOffset + layout.content.length] = 1;
  assert.throws(() => validatePostgresCandidateArchive(padded, options),
    /postgres_candidate_proof_tar_padding_invalid/u);
  const trailing = Buffer.from(value.archive); trailing[trailing.length - 1] = 1;
  assert.throws(() => validatePostgresCandidateArchive(trailing, options),
    /postgres_candidate_proof_tar_eoa_invalid/u);
});

test("candidate archive proof rejects config, tag, DiffID, blob and manifest substitution", () => {
  const value = fixture(); const options = archiveOptions(value);
  assert.throws(() => validatePostgresCandidateArchive(value.archive, { ...options,
    imageId: `sha256:${"0".repeat(64)}` }), /postgres_candidate_proof_/u);
  assert.throws(() => validatePostgresCandidateArchive(value.archive, { ...options,
    tag: `aw-postgres-gosu:${"b".repeat(24)}` }), /postgres_candidate_proof_archive_manifest_invalid/u);
  assert.throws(() => validatePostgresCandidateArchive(value.archive, { ...options,
    expectedDiffIds: [`sha256:${"0".repeat(64)}`, ...value.diffIds.slice(1)] }), /postgres_candidate_proof_/u);
  const changed = Buffer.from(value.archive); const marker = Buffer.from("raw-layer-0\n");
  const offset = changed.indexOf(marker); assert.ok(offset > 0); changed[offset] ^= 1;
  assert.throws(() => validatePostgresCandidateArchive(changed, options),
    /postgres_candidate_proof_archive_layer_invalid/u);
});

test("candidate archive proof rejects a rehashed but broken legacy compatibility chain", () => {
  const value = fixture(); const entries = value.entries.map((entry) => ({ ...entry }));
  const target = 14; const changed = JSON.parse(entries[target].content.toString("utf8"));
  changed.parent = "f".repeat(64); entries[target].content = json(changed);
  entries[target].name = `blobs/sha256/${hash(entries[target].content)}`;
  assert.throws(() => validatePostgresCandidateArchive(tar(entries), archiveOptions(value)),
    /postgres_candidate_proof_archive_compatibility_invalid/u);
});

test("candidate archive proof rejects well-formed manifest and index substitutions", () => {
  const value = fixture();
  for (const [name, mutate] of [
    ["manifest.json", (document) => { document[0].LayerSources[value.diffIds[0]].size += 1; }],
    ["index.json", (document) => { document.manifests[0].digest = `sha256:${"f".repeat(64)}`; }],
    ["repositories", (document) => { document["aw-postgres-gosu"][value.tag.split(":")[1]] = "f".repeat(64); }],
  ]) {
    const entries = value.entries.map((entry) => ({ ...entry }));
    const target = entries.find((entry) => entry.name === name);
    const document = JSON.parse(target.content.toString("utf8")); mutate(document); target.content = json(document);
    assert.throws(() => validatePostgresCandidateArchive(tar(entries), archiveOptions(value)),
      /postgres_candidate_proof_/u);
  }
});

function remoteFixture() {
  const local = fixture();
  const compressed = Array.from({ length: 12 }, (_, index) => Buffer.from(`compressed-layer-${index}\n`));
  const remoteLayers = compressed.map((content) => ({ mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
    size: content.length, digest: digest(content) }));
  const manifest = { schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: local.imageId,
      size: local.config.length }, layers: remoteLayers };
  const raw = JSON.stringify(manifest);
  return { ...local, remoteLayers, manifest, raw, digest: digest(Buffer.from(raw)) };
}

test("remote proof binds digest, config and exact base descriptor prefix while leaving new layers pending read", () => {
  const value = remoteFixture(); const baseLayers = value.remoteLayers.slice(0, 10);
  const proof = validatePostgresCandidateRemoteManifest(value.raw, { digest: value.digest,
    configDigest: value.imageId, expectedLayers: 12, baseLayers });
  assert.equal(proof.sha256, value.digest);
  assert.equal(proof.configDigest, value.imageId);
  assert.equal(proof.baseLayerCount, 10);
  assert.equal(proof.newLayerCount, 2);
  assert.deepEqual(proof.layers, value.remoteLayers);
  assert.equal(proof.remoteLayerVerification, "PENDING_INDEPENDENT_READ");
});

test("remote proof accepts OCI base descriptors converted to Docker schema 2 without changing compressed bytes", () => {
  const value = remoteFixture(); const manifest = globalThis.structuredClone(value.manifest);
  manifest.mediaType = "application/vnd.docker.distribution.manifest.v2+json";
  manifest.config.mediaType = "application/vnd.docker.container.image.v1+json";
  for (const layer of manifest.layers) layer.mediaType = "application/vnd.docker.image.rootfs.diff.tar.gzip";
  const raw = JSON.stringify(manifest); const options = { digest: digest(Buffer.from(raw)),
    configDigest: value.imageId, expectedLayers: 12, baseLayers: value.remoteLayers.slice(0, 10) };
  const proof = validatePostgresCandidateRemoteManifest(raw, options);
  assert.equal(proof.mediaType, manifest.mediaType);
  assert.equal(proof.baseLayerCount, 10);
  assert.equal(proof.remoteLayerVerification, "PENDING_INDEPENDENT_READ");
  const substituted = globalThis.structuredClone(manifest);
  substituted.layers[0].size += 1;
  const substitutedRaw = JSON.stringify(substituted);
  assert.throws(() => validatePostgresCandidateRemoteManifest(substitutedRaw,
    { ...options, digest: digest(Buffer.from(substitutedRaw)) }), /postgres_candidate_proof_remote_manifest_invalid/u);
  const wrongType = globalThis.structuredClone(manifest);
  wrongType.layers[0].mediaType = "application/vnd.oci.image.layer.v1.tar+gzip";
  const wrongTypeRaw = JSON.stringify(wrongType);
  assert.throws(() => validatePostgresCandidateRemoteManifest(wrongTypeRaw,
    { ...options, digest: digest(Buffer.from(wrongTypeRaw)) }), /postgres_candidate_proof_remote_manifest_invalid/u);
  const mixedBase = options.baseLayers.map((layer) => ({ ...layer }));
  mixedBase[0].mediaType = "application/vnd.docker.image.rootfs.diff.tar.gzip";
  assert.throws(() => validatePostgresCandidateRemoteManifest(raw,
    { ...options, baseLayers: mixedBase }), /postgres_candidate_proof_options_invalid/u);
});

test("remote proof rejects digest, config, base prefix, descriptor, count and extra-field substitution", () => {
  const value = remoteFixture(); const options = { digest: value.digest, configDigest: value.imageId,
    expectedLayers: 12, baseLayers: value.remoteLayers.slice(0, 10) };
  assert.throws(() => validatePostgresCandidateRemoteManifest(value.raw,
    { ...options, digest: `sha256:${"0".repeat(64)}` }), /postgres_candidate_proof_remote_manifest_invalid/u);
  assert.throws(() => validatePostgresCandidateRemoteManifest(value.raw,
    { ...options, configDigest: `sha256:${"0".repeat(64)}` }), /postgres_candidate_proof_remote_manifest_invalid/u);
  const wrongBase = value.remoteLayers.slice(0, 10).map((entry) => ({ ...entry }));
  wrongBase[0].digest = `sha256:${"0".repeat(64)}`;
  assert.throws(() => validatePostgresCandidateRemoteManifest(value.raw,
    { ...options, baseLayers: wrongBase }), /postgres_candidate_proof_remote_manifest_invalid/u);
  assert.throws(() => validatePostgresCandidateRemoteManifest(value.raw,
    { ...options, baseLayers: value.remoteLayers.slice(0, 9) }), /postgres_candidate_proof_options_invalid/u);
  assert.throws(() => validatePostgresCandidateRemoteManifest(value.raw,
    { ...options, baseLayers: [] }), /postgres_candidate_proof_options_invalid/u);
  const withoutBase = { digest: options.digest, configDigest: options.configDigest,
    expectedLayers: options.expectedLayers };
  assert.throws(() => validatePostgresCandidateRemoteManifest(value.raw, withoutBase),
    /postgres_candidate_proof_options_invalid/u);
  for (const mutate of [
    (manifest) => { manifest.layers.pop(); },
    (manifest) => { manifest.layers[0].size = 0; },
    (manifest) => { manifest.layers[1].digest = manifest.layers[0].digest; },
    (manifest) => { manifest.layers[0].mediaType = "application/vnd.docker.image.rootfs.diff.tar.gzip"; },
    (manifest) => { manifest.layers[0].annotations = { unexpected: "value" }; },
  ]) {
    const manifest = globalThis.structuredClone(value.manifest); mutate(manifest); const raw = JSON.stringify(manifest);
    assert.throws(() => validatePostgresCandidateRemoteManifest(raw,
      { ...options, digest: digest(Buffer.from(raw)) }), /postgres_candidate_proof_remote_manifest_invalid/u);
  }
});

test("exported inspect validators preserve the native diagnostic identity contract", () => {
  const lock = JSON.parse(readFileSync(new URL("../infra/postgres-image/lock.json", import.meta.url), "utf8"));
  const nonce = "a".repeat(24); const base = { Id: lock.base.configId, Os: lock.base.os,
    Architecture: lock.base.architecture, RepoDigests: [`${lock.base.repository}@${lock.base.platformDigest}`],
    RootFS: { Layers: [`sha256:${"1".repeat(64)}`] }, Config: { Entrypoint: ["docker-entrypoint.sh"],
      Cmd: ["postgres"], User: "", ExposedPorts: { "5432/tcp": {} } } };
  assert.equal(validateBaseInspect([base], lock), base);
  const candidate = { ...globalThis.structuredClone(base), Id: `sha256:${"2".repeat(64)}`,
    RootFS: { Layers: [...base.RootFS.Layers, `sha256:${"3".repeat(64)}`] },
    Config: { ...globalThis.structuredClone(base.Config), Labels: { "com.auto-world.postgres-diagnostic": nonce,
      "com.auto-world.postgres-diagnostic-purpose": "gosu-correction-runtime" } } };
  assert.equal(validateCandidateInspect([candidate], lock, base, nonce), candidate);
  assert.throws(() => validateCandidateInspect([{ ...candidate,
    RootFS: { Layers: [...candidate.RootFS.Layers].reverse() } }], lock, base, nonce),
  /postgres_diagnostic_candidate_invalid/u);
});
