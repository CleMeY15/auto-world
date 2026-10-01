import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { validatePostgresCandidateArchive, validatePostgresCandidateArchiveLayerRanges,
  validatePostgresCandidateArchiveMaterial } from "../scripts/postgres-image/candidate-proof.mjs";
import { inspectPostgresRetainedLayerSources, validatePostgresRetainedLayerSourceInventory,
  postgresRetainedLayerSourceInventoryLimits as limits } from "../scripts/postgres-image/candidate-layer-source-inventory.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digest = (bytes) => `sha256:${hash(bytes)}`;
const json = (value) => Buffer.from(JSON.stringify(value));
function checksum(block) {
  block.fill(32, 148, 156); const sum = block.reduce((value, byte) => value + byte, 0);
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
}
function tar(entries) {
  const pieces = [];
  for (const entry of entries) {
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content ?? "");
    const header = Buffer.alloc(512);
    header.write(entry.name, 0, 100);
    const octal = (at, width, value) => header.write(`${value.toString(8).padStart(width - 1, "0")}\0`, at, width);
    octal(100, 8, entry.mode ?? 0o644); octal(108, 8, entry.uid ?? 0); octal(116, 8, entry.gid ?? 0);
    octal(124, 12, content.length); octal(136, 12, entry.mtime ?? 1700000000);
    header.write(entry.type ?? "0", 156); header.write(entry.linkname ?? "", 157, 100);
    header.write("ustar\0", 257); header.write("00", 263); header.write("root", 265); header.write("root", 297);
    octal(329, 8, entry.major ?? 0); octal(337, 8, entry.minor ?? 0);
    entry.mutate?.(header); checksum(header);
    pieces.push(header, content, Buffer.alloc((512 - content.length % 512) % 512));
  }
  return Buffer.concat([...pieces, Buffer.alloc(1024)]);
}
function fixture(changes = [], override = null) {
  const tag = `aw-postgres-gosu:${"a".repeat(24)}`;
  const raw = Array.from({ length: 12 }, (_, index) => override?.(index) ?? tar([
    { name: "./", type: "5", mode: 0o755, mtime: 1700000000 + index }, ...(changes[index] ?? []),
  ]));
  const diffIds = raw.map(digest); const runtime = { Entrypoint: ["docker-entrypoint.sh"], Cmd: ["postgres"] };
  const config = json({ architecture: "amd64", os: "linux", docker_version: "28.0.4", config: runtime,
    rootfs: { type: "layers", diff_ids: diffIds } }); const imageId = digest(config);
  const descriptors = raw.map((bytes, index) => ({ digest: diffIds[index], size: bytes.length,
    mediaType: "application/vnd.oci.image.layer.v1.tar" }));
  const manifest = json({ schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { digest: imageId, size: config.length, mediaType: "application/vnd.oci.image.config.v1+json" }, layers: descriptors });
  const zero = { Hostname: "", Domainname: "", User: "", AttachStdin: false, AttachStdout: false,
    AttachStderr: false, Tty: false, OpenStdin: false, StdinOnce: false, Env: null, Cmd: null, Image: "",
    Volumes: null, WorkingDir: "", Entrypoint: null, OnBuild: null, Labels: null };
  const ids = raw.map((_, index) => hash(Buffer.from(`legacy-${index}`)));
  const legacy = ids.map((id, index) => json(index === 11 ? { id, parent: ids[index - 1],
    created: "2026-10-01T12:00:00Z", container: "c".repeat(64), container_config: runtime,
    docker_version: "28.0.4", config: runtime, architecture: "amd64", os: "linux" }
    : { id, ...(index ? { parent: ids[index - 1] } : {}), created: "1970-01-01T00:00:00Z", container_config: zero, os: "linux" }));
  const archive = tar([
    { name: "blobs/", type: "5" }, { name: "blobs/sha256/", type: "5" },
    ...raw.map((content, index) => ({ name: `blobs/sha256/${diffIds[index].slice(7)}`, content })),
    ...legacy.map((content) => ({ name: `blobs/sha256/${hash(content)}`, content })),
    { name: `blobs/sha256/${imageId.slice(7)}`, content: config }, { name: `blobs/sha256/${hash(manifest)}`, content: manifest },
    { name: "oci-layout", content: json({ imageLayoutVersion: "1.0.0" }) },
    { name: "manifest.json", content: json([{ Config: `blobs/sha256/${imageId.slice(7)}`, RepoTags: [tag],
      Layers: diffIds.map((value) => `blobs/sha256/${value.slice(7)}`),
      LayerSources: Object.fromEntries(descriptors.map((value) => [value.digest, value])) }]) },
    { name: "index.json", content: json({ schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json", manifests: [{
      digest: digest(manifest), size: manifest.length, mediaType: "application/vnd.oci.image.manifest.v1+json",
      annotations: { "io.containerd.image.name": `docker.io/library/${tag}`, "org.opencontainers.image.ref.name": tag.split(":")[1] } }] }) },
    { name: "repositories", content: json({ "aw-postgres-gosu": { [tag.split(":")[1]]: diffIds.at(-1).slice(7) } }) },
  ]);
  return { archive, raw, options: { imageId, tag, expectedDiffIds: diffIds, expectedLayers: 12 } };
}
const inspect = (value) => inspectPostgresRetainedLayerSources(value.archive, value.options);
const entry = (proof, path) => proof.finalEntries.find((value) => value.path === path);
const apk = (name, version = "1-r0", extra = "") => `P:${name}\nV:${version}\no:${name}\nL:MIT\n${extra}\n`;
function pax(values) {
  return Object.entries(values).map(([key, value]) => {
    const suffix = ` ${key}=${value}\n`; let length = Buffer.byteLength(suffix) + 1;
    while (String(length).length + Buffer.byteLength(suffix) !== length) length = String(length).length + Buffer.byteLength(suffix);
    return `${length}${suffix}`;
  }).join("");
}

test("additive layer ranges bind all 12 exact blobs and preserve every old public proof result", () => {
  const value = fixture([[{ name: "file", content: "data" }]]);
  const before = Buffer.from(value.archive); const proof = validatePostgresCandidateArchive(value.archive, value.options);
  const material = validatePostgresCandidateArchiveMaterial(value.archive, value.options);
  const ranged = validatePostgresCandidateArchiveLayerRanges(value.archive, value.options);
  assert.deepEqual(Object.keys(ranged).sort(), ["archiveProof", "layers"]);
  assert.deepEqual(ranged.archiveProof, proof); assert.deepEqual(material.archiveProof, proof);
  assert.deepEqual(Object.keys(material).sort(), ["archiveProof", "configuration"]);
  assert.equal(proof.archiveMembers, 32); assert.equal(proof.rawLayers.length, 12); assert.equal(proof.compatibilityRecords.length, 12);
  for (const range of ranged.layers) {
    assert.deepEqual(Object.keys(range).sort(), ["diffId", "index", "offset", "size"]);
    assert.deepEqual(value.archive.subarray(range.offset, range.offset + range.size), value.raw[range.index]);
    assert.equal(digest(value.raw[range.index]), range.diffId); assert.ok(Object.isFrozen(range));
  }
  assert.ok(Object.isFrozen(ranged.layers)); assert.deepEqual(value.archive, before);
  const invalid = fixture([], (index) => index === 0 ? Buffer.alloc(1024, 1) : null);
  assert.doesNotThrow(() => validatePostgresCandidateArchive(invalid.archive, invalid.options));
  assert.throws(() => inspect(invalid), /postgres_layer_source_inventory_tar_/u);
  const changed = Buffer.from(value.archive); changed[ranged.layers[0].offset + 512] ^= 1;
  assert.throws(() => validatePostgresCandidateArchiveLayerRanges(changed, value.options), /postgres_candidate_proof_archive_layer_invalid/u);
});

test("APK history retains removed/replaced records, raw identities, missing declarations and virtual dependencies", () => {
  const original = apk("library") + apk("removed") + apk(".postgresql-rundeps", "20260917.213131", "D:so:libc.musl-x86_64.so.1 library=1-r0\n");
  const replacement = apk("library", "2-r0") + "P:gosu\nL:Apache-2.0\n\n";
  const value = fixture([
    [{ name: "lib/apk/db/installed", content: original }, { name: "usr/share/licenses/removed/LICENSE", content: "old notice" }],
    [{ name: "lib/apk/db/installed", content: replacement }, { name: "usr/share/licenses/removed/.wh.LICENSE" }],
  ]);
  const proof = inspect(value);
  assert.equal(proof.state, "RETAINED_LAYER_INVENTORY_VERIFIED"); assert.equal(proof.apkHistory.length, 2);
  assert.equal(proof.apkHistory[0].sha256, hash(Buffer.from(original)));
  assert.deepEqual(proof.apkHistory[0].packages.map((value) => value.name), ["library", "removed", ".postgresql-rundeps"]);
  assert.deepEqual(proof.finalApk.packages.map((value) => value.name), ["library", "gosu"]);
  assert.equal(proof.finalApk.packages[0].version, "2-r0");
  const virtual = proof.apkHistory[0].packages[2];
  assert.equal(virtual.assessment, "SYNTHETIC_VIRTUAL_DEPENDENCIES_ONLY");
  assert.deepEqual(virtual.dependencies, ["so:libc.musl-x86_64.so.1", "library=1-r0"]);
  assert.equal(virtual.sourceBinding, "NOT_ESTABLISHED");
  assert.equal(proof.finalApk.packages[1].versionPresent, false); assert.equal(proof.finalApk.packages[1].version, null);
  assert.equal(proof.finalApk.packages[1].originPresent, false); assert.equal(proof.notices[0].visibility, "REMOVED_OR_REPLACED");
  assert.equal(proof.sourceClosure, "NOT_ESTABLISHED"); assert.equal(proof.noticeClosure, "NOT_ESTABLISHED");
  assert.equal(proof.closure, "INCOMPLETE"); assert.equal(proof.admission, "NOT_AUTHORIZED");
  assert.equal(proof.currentness, "NOT_EVALUATED"); assert.equal(proof.runtimePermission, "NOT_GRANTED");
  assert.deepEqual([proof.supportStartedAt, proof.supportEndsAt, proof.archiveUntil], [null, null, null]);
  assert.ok(Object.isFrozen(virtual.dependencies));
  assert.deepEqual(validatePostgresRetainedLayerSourceInventory(proof, value.archive, value.options), proof);
});

test("whiteouts only erase lower resources, regardless of TAR order, and later layers can reintroduce them", () => {
  for (const reversed of [false, true]) {
    const changes = [{ name: "a/.wh.b" }, { name: "a/b", content: "same layer" }];
    const proof = inspect(fixture([[{ name: "a/b", content: "lower" }, { name: "a/retained", content: "keep" }],
      reversed ? changes.reverse() : changes, [{ name: "a/.wh.retained" }], [{ name: "a/retained", content: "later" }]]));
    assert.equal(entry(proof, "a/b").sha256, hash(Buffer.from("same layer")));
    assert.equal(entry(proof, "a/retained").sha256, hash(Buffer.from("later")));
    assert.equal(entry(proof, "a/.wh.b"), undefined); assert.equal(proof.layers[0].entries[1].sha256, hash(Buffer.from("lower")));
  }
});

test("opaque directories erase every lower descendant, preserve same-layer additions and keep directory metadata", () => {
  for (const reversed of [false, true]) {
    const additions = [{ name: "d/.wh..wh..opq" }, { name: "d/new", content: "new" }];
    const proof = inspect(fixture([[{ name: "d/", type: "5", mode: 0o700 }, { name: "d/old/nested", content: "lower" }],
      reversed ? additions.reverse() : additions, [{ name: "d/", type: "5", mode: 0o755 }]]));
    assert.equal(entry(proof, "d/old/nested"), undefined); assert.equal(entry(proof, "d/new").sha256, hash(Buffer.from("new")));
    assert.equal(entry(proof, "d").mode, 0o755); assert.equal(proof.layers[0].entries.find((v) => v.path === "d/old/nested").size, 5);
  }
});

test("whiteout parents refuse lower files/links unless explicitly replaced with same-layer directories", () => {
  for (const lower of [{ name: "a", content: "file" }, { name: "a", type: "2", linkname: "target" }]) {
    for (const marker of ["a/.wh.x", "a/.wh..wh..opq"]) {
      assert.throws(() => inspect(fixture([[lower], [{ name: marker }]])), /postgres_layer_source_inventory_overlay_parent_invalid/u);
      for (const reverse of [false, true]) {
        const replacements = [{ name: marker }, { name: "a/", type: "5" }, { name: "a/new", content: "new" }];
        const proof = inspect(fixture([[lower], reverse ? [replacements[1], replacements[0], replacements[2]] : replacements]));
        assert.equal(entry(proof, "a").type, "directory"); assert.equal(entry(proof, "a/new").sha256, hash(Buffer.from("new")));
      }
    }
  }
  assert.throws(() => inspect(fixture([[{ name: "a", type: "2", linkname: "target" }],
    [{ name: "a/b/.wh.x" }, { name: "a/b/", type: "5" }]])), /postgres_layer_source_inventory_overlay_parent_invalid/u);
});

test("type replacement removes descendants while explicit/root directory metadata updates preserve implicit children", () => {
  const proof = inspect(fixture([[{ name: "implicit/child", content: "keep" }, { name: "replace/sub/file", content: "remove" }],
    [{ name: "implicit/", type: "5", mode: 0o700 }, { name: "replace", content: "file" }],
    [{ name: "replace/", type: "5" }, { name: "replace/fresh", content: "fresh" }]]));
  assert.ok(entry(proof, "implicit/child")); assert.equal(entry(proof, "implicit").mode, 0o700);
  assert.equal(entry(proof, "replace/sub/file"), undefined); assert.ok(entry(proof, "replace/fresh"));
  assert.equal(entry(proof, "").type, "directory");
});

test("links/devices are passive metadata; broken hardlinks and children beneath links refuse", () => {
  const proof = inspect(fixture([[{ name: "data", content: "content" }, { name: "alias", type: "1", linkname: "data" },
    { name: "dangling", type: "2", linkname: "/unavailable" }, { name: "device", type: "3", major: 1, minor: 3 },
    { name: "pipe", type: "6" }]]));
  assert.equal(entry(proof, "alias").type, "hardlink"); assert.equal(entry(proof, "alias").sha256, null);
  assert.equal(entry(proof, "dangling").linkname, "/unavailable"); assert.equal(proof.linkHandling, "METADATA_ONLY_NO_FOLLOW");
  assert.equal(entry(proof, "device").deviceMinor, 3); assert.equal(entry(proof, "pipe").type, "fifo");
  for (const attacks of [
    [{ name: "alias", type: "1", linkname: "missing" }], [{ name: "alias", type: "1", linkname: "alias" }],
    [{ name: "link", type: "2", linkname: "../../escape" }],
    [{ name: "link", type: "2", linkname: "target" }, { name: "link/child", content: "x" }],
    [{ name: "lib/apk/db/installed", type: "2", linkname: "unknown" }],
  ]) assert.throws(() => inspect(fixture([attacks])), /postgres_layer_source_inventory_(?:tar_link|overlay_parent|apk_database)_invalid/u);
});

test("PAX local paths/timestamps are authenticated without extraction; unknown/global/GNU/sparse formats refuse", () => {
  const longPath = `usr/share/licenses/${"x".repeat(120)}/LICENSE`;
  const value = fixture([[{ name: "PaxHeader", type: "x", content: pax({ path: longPath, mtime: "1700000000.123456789" }) },
    { name: "placeholder", content: "notice" }]]);
  const proof = inspect(value); assert.equal(entry(proof, longPath).mtime, "1700000000.123456789");
  assert.equal(proof.notices[0].path, longPath); assert.equal(proof.notices[0].sha256, hash(Buffer.from("notice")));
  const attacks = [
    [{ name: "Pax", type: "x", content: pax({ "GNU.sparse.map": "0,1" }) }, { name: "file" }],
    [{ name: "Pax", type: "x", content: "999 path=bad\n" }, { name: "file" }],
    [{ name: "Pax", type: "x", content: pax({ path: "../escape" }) }, { name: "file" }],
    [{ name: "Pax", type: "x", content: pax({ path: "unused" }) }],
    [{ name: "Pax", type: "g", content: pax({ comment: "global" }) }],
    [{ name: "GNU", type: "L", content: "long name" }], [{ name: "sparse", type: "S" }],
    [{ name: "GNU", mutate: (header) => { header.write("ustar ", 257); header.write(" \0", 263); } }],
  ];
  for (const attack of attacks) assert.throws(() => inspect(fixture([attack])), /postgres_layer_source_inventory_tar_/u);
});

test("duplicates, traversal, malformed whiteouts, numbers, padding and EOF refuse even with valid layer SHA", () => {
  const attacks = [
    [{ name: "dup", content: "a" }, { name: "./dup", content: "b" }], [{ name: "../escape" }], [{ name: "/absolute" }],
    [{ name: "a//b" }], [{ name: "a/.wh.hidden/child" }], [{ name: ".wh." }],
    [{ name: ".wh.file", content: "not empty" }], [{ name: ".wh.file", type: "2", linkname: "other" }],
    [{ name: "file", mutate: (header) => { header[100] = 128; } }],
  ];
  for (const attack of attacks) assert.throws(() => inspect(fixture([attack])), /postgres_layer_source_inventory_/u);
  for (const mutate of [
    (bytes) => { bytes[512 + 1] = 1; },
    (bytes) => { bytes[0] ^= 1; },
    (bytes) => { bytes[bytes.length - 1] = 1; },
  ]) {
    const raw = tar([{ name: "file", content: "x" }]); mutate(raw);
    assert.throws(() => inspect(fixture([], (index) => index === 0 ? raw : null)), /postgres_layer_source_inventory_tar_/u);
  }
});

test("APK malformed records, duplicate identities, unknown fields and unsupported binary database block", () => {
  for (const content of ["P:test\nP:second\n\n", "V:1\n\n", apk("test") + apk("test"), "P:test\nY:unknown\n\n",
    "P:test\nV:1", Buffer.from([0, 255]), "P:test\nV:1\r\n\n"]) {
    assert.throws(() => inspect(fixture([[{ name: "lib/apk/db/installed", content }]])), /postgres_layer_source_inventory_apk_database_invalid/u);
  }
  const proof = inspect(fixture([[{ name: "lib/apk/db/installed", content: apk("test") }], [{ name: "lib/apk/db/.wh.installed" }]]));
  assert.equal(proof.finalApk.state, "ABSENT"); assert.equal(proof.apkHistory.length, 1);
});

test("notice discovery retains each byte identity and never promotes filenames to source/legal closure", () => {
  const proof = inspect(fixture([[{ name: "LICENSE", content: "first" }, { name: "README", content: "not a notice candidate" }],
    [{ name: "LICENSE", content: "second" }, { name: "nested/COPYRIGHT.txt", content: "copyright" }]]));
  assert.deepEqual(proof.notices.map((v) => [v.path, v.visibility]), [["LICENSE", "REMOVED_OR_REPLACED"],
    ["LICENSE", "FINAL"], ["nested/COPYRIGHT.txt", "FINAL"]]);
  assert.equal(proof.noticeDiscovery, "FILENAME_CANDIDATES_ONLY"); assert.equal(proof.notices[0].sha256, hash(Buffer.from("first")));
});

test("notice-name links remain explicit unresolved candidates with final/removed visibility", () => {
  const proof = inspect(fixture([[{ name: "data", content: "data" }, { name: "LICENSE", type: "2", linkname: "data" }],
    [{ name: ".wh.LICENSE" }, { name: "NOTICE", type: "1", linkname: "data" }, { name: "COPYING/", type: "5" }]]));
  assert.deepEqual(proof.notices.map((v) => [v.path, v.type, v.sha256, v.linkname, v.visibility]), [
    ["LICENSE", "symlink", null, "data", "REMOVED_OR_REPLACED"], ["NOTICE", "hardlink", null, "data", "FINAL"],
    ["COPYING", "directory", null, null, "FINAL"],
  ]);
  assert.equal(proof.notices[0].resolution, "UNRESOLVED_NO_FOLLOW");
  assert.equal(proof.notices[1].resolution, "UNRESOLVED_NO_FOLLOW");
  assert.equal(proof.notices[2].resolution, "NON_REGULAR_NO_CONTENT");
});

test("bounded notice/database/extension readers refuse oversized content without changing old archive limits", () => {
  for (const [name, content, type, code] of [
    ["LICENSE", Buffer.alloc(limits.noticeBytes + 1), "0", "notice_limit"],
    ["lib/apk/db/installed", Buffer.alloc(limits.apkDatabaseBytes + 1), "0", "apk_database_limit"],
    ["Pax", Buffer.alloc(limits.extensionBytes + 1), "x", "tar_extension_invalid"],
  ]) assert.throws(() => inspect(fixture([[{ name, content, type }]])), new RegExp(`postgres_layer_source_inventory_${code}`, "u"));
  assert.throws(() => inspect(fixture([[{ name: "Pax", type: "x", content: pax({ path: "a".repeat(limits.pathBytes + 1) }) },
    { name: "placeholder" }]])), /postgres_layer_source_inventory_tar_path_invalid/u);
  assert.throws(() => inspect(fixture([[{ name: "lib/apk/db/installed", content: `P:test\nT:${"a".repeat(limits.apkLineBytes)}\n\n` }]])),
    /postgres_layer_source_inventory_apk_database_invalid/u);
  const tooMany = Array.from({ length: limits.apkRecords + 1 }, (_, index) => apk(`pkg${index}`)).join("");
  assert.throws(() => inspect(fixture([[{ name: "lib/apk/db/installed", content: tooMany }]])), /postgres_layer_source_inventory_apk_database_limit/u);
});

test("TAR header/member budget blocks an authenticated layer with excessive empty entries", () => {
  const entries = Array.from({ length: limits.membersPerLayer + 1 }, (_, index) => ({ name: `file${index}` }));
  const value = fixture([entries]);
  assert.throws(() => inspect(value), /postgres_layer_source_inventory_member_limit/u);
});

test("proof replay refuses promotion, altered identities, extras/accessors/Symbols without reading getters", () => {
  const value = fixture([[{ name: "LICENSE", content: "notice" }]]); const proof = inspect(value);
  for (const mutate of [
    (v) => { v.sourceClosure = "VERIFIED"; }, (v) => { v.admission = "AUTHORIZED"; },
    (v) => { v.finalEntries[1].sha256 = "0".repeat(64); }, (v) => { v.layers[0].diffId = `sha256:${"0".repeat(64)}`; },
    (v) => { v.extra = true; }, (v) => { v.notices[0].visibility = "REMOVED_OR_REPLACED"; },
    (v) => { Object.defineProperty(v.layers[0], "hidden", { value: true }); }, (v) => { v.layers[0][Symbol("extra")] = true; },
  ]) { const altered = globalThis.structuredClone(proof); mutate(altered);
    assert.throws(() => validatePostgresRetainedLayerSourceInventory(altered, value.archive, value.options), /postgres_layer_source_inventory_proof_invalid/u); }
  let reads = 0; const altered = globalThis.structuredClone(proof);
  Object.defineProperty(altered.finalEntries[0], "type", { get() { reads += 1; return "directory"; }, enumerable: true });
  assert.throws(() => validatePostgresRetainedLayerSourceInventory(altered, value.archive, value.options), /proof_invalid/u);
  const unknown = new Error(); Object.defineProperty(unknown, "message", { get() { reads += 1; return "private"; } });
  const proxy = new Proxy({}, { getPrototypeOf() { throw unknown; } });
  assert.throws(() => validatePostgresRetainedLayerSourceInventory(proxy, value.archive, value.options), /input_invalid/u);
  assert.equal(reads, 0);
});
