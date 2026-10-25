import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { gzipSync } from "node:zlib";

const SELF = fileURLToPath(import.meta.url);
const SOURCE = new URL("../scripts/postgres-image/gosu-derivative-image-proof-v1.mjs", import.meta.url);
const CANDIDATE = new URL("../scripts/postgres-image/gosu-derivative-candidate-v2.mjs", import.meta.url);
const BLOCK = 512;
const WINDOW = Object.freeze({ startedAtMs: 200_000, completedAtMs: 205_999 });
const INPUT_ERROR = "gosu_derivative_image_proof_input_invalid";
const ARCHIVE_ERROR = "gosu_derivative_image_proof_archive_invalid";
const PAIR_ERROR = "gosu_derivative_image_proof_pair_invalid";
const OCI_INDEX = "application/vnd.oci.image.index.v1+json";
const OCI_MANIFEST = "application/vnd.oci.image.manifest.v1+json";
const OCI_CONFIG = "application/vnd.oci.image.config.v1+json";
const OCI_LAYER = "application/vnd.oci.image.layer.v1.tar";
const EVIDENCE_NAMES = Object.freeze([
  "gosu-LICENSE", "moby-user-LICENSE", "go-LICENSE", "go-PATENTS", "x-sys-LICENSE", "x-sys-PATENTS",
  "notices.json", "module-closure.json", "sbom.cdx.json", "version.txt", "build-info.txt",
  "derivative-manifest.json",
]);
const PARENTS = Object.freeze([
  "usr", "usr/local", "usr/local/bin", "usr/share", "usr/share/licenses", "usr/share/licenses/auto-world-gosu",
]);

const sha = (value) => createHash("sha256").update(value).digest("hex");
const digest = (value) => `sha256:${sha(value)}`;
const clone = (value) => JSON.parse(JSON.stringify(value));

function octal(header, offset, length, value) {
  Buffer.from(`${value.toString(8).padStart(length - 1, "0")}\0`).copy(header, offset);
}

function tarHeader(entry) {
  const type = entry.type ?? "0";
  const body = entry.bytes ?? Buffer.alloc(0);
  const header = Buffer.alloc(BLOCK);
  Buffer.from(entry.path).copy(header, 0);
  octal(header, 100, 8, entry.mode ?? (type === "5" ? 0o755 : type === "2" ? 0o777 : 0o644));
  octal(header, 108, 8, entry.uid ?? 0);
  octal(header, 116, 8, entry.gid ?? 0);
  octal(header, 124, 12, type === "0" ? body.length : 0);
  octal(header, 136, 12, entry.mtime ?? 100);
  header.fill(0x20, 148, 156);
  header.write(type, 156);
  Buffer.from(entry.linkname ?? "").copy(header, 157);
  Buffer.from("ustar\0").copy(header, 257);
  Buffer.from("00").copy(header, 263);
  Buffer.from(entry.owner ?? "root").copy(header, 265);
  Buffer.from("root").copy(header, 297);
  const checksum = header.reduce((total, byte) => total + byte, 0);
  Buffer.from(`${checksum.toString(8).padStart(6, "0")}\0 `).copy(header, 148);
  return header;
}

function tar(entries) {
  const parts = [];
  for (const entry of entries) {
    const body = entry.bytes ?? Buffer.alloc(0);
    parts.push(tarHeader(entry));
    if ((entry.type ?? "0") === "0") {
      parts.push(body, Buffer.alloc((BLOCK - body.length % BLOCK) % BLOCK));
    }
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

function strictRuntimeConfig() {
  return {
    AttachStderr: false,
    AttachStdin: false,
    AttachStdout: false,
    Cmd: ["postgres"],
    Domainname: "",
    Entrypoint: ["docker-entrypoint.sh"],
    Env: ["PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "PG_MAJOR=17"],
    ExposedPorts: { "5432/tcp": {} },
    Healthcheck: null,
    Hostname: "",
    Image: "sha256:FORMAT_ONLY-builder",
    Labels: { "org.opencontainers.image.base.name": "docker.io/library/postgres:17.11-alpine3.24" },
    NetworkDisabled: false,
    OnBuild: null,
    OpenStdin: false,
    StdinOnce: false,
    StopSignal: "SIGINT",
    Tty: false,
    User: "",
    Volumes: { "/var/lib/postgresql/data": {} },
    WorkingDir: "",
  };
}

function fileDescriptor(path, body, { mode = 0o644, mtime = 0 } = {}) {
  return { path, type: "file", mode, uid: 0, gid: 0, mtime, size: body.length, sha256: sha(body) };
}

function formatOnlyContract() {
  const oldGosu = Buffer.from("FORMAT_ONLY old Gosu executable\n");
  const newGosu = Buffer.from("FORMAT_ONLY replacement Gosu executable\n");
  const evidenceBodies = EVIDENCE_NAMES.map((name, index) => Buffer.from(`FORMAT_ONLY ${index} ${name}\n`));
  return {
    oldGosu,
    newGosu,
    evidenceBodies,
    contract: {
      schemaVersion: 2,
      authority: "NOT_AUTHORIZED",
      image: "UNBUILT",
      base: { configId: null },
      baseExecutable: fileDescriptor("usr/local/bin/gosu", oldGosu, { mode: 0o755, mtime: 100 }),
      replacement: fileDescriptor("usr/local/bin/gosu", newGosu, { mode: 0o755, mtime: 0 }),
      evidenceFiles: EVIDENCE_NAMES.map((name, index) =>
        fileDescriptor(`usr/share/licenses/auto-world-gosu/${name}`, evidenceBodies[index])),
      parentPaths: PARENTS.map((path, index) => ({
        path,
        creation: { mode: 0o755, uid: 0, gid: 0 },
        mtimePolicy: index === PARENTS.length - 1 ? "ZERO" : "BUILD_WINDOW",
      })),
    },
  };
}

function layer(entries, owner) {
  return tar(entries.map((entry) => ({ owner, ...entry })));
}

function buildLayers(material, options = {}) {
  const base0 = [
    { path: "usr/", type: "5", mtime: 100 },
    { path: "usr/local/", type: "5", mtime: 100 },
    { path: "usr/local/bin/", type: "5", mtime: 100 },
    { path: "usr/share/", type: "5", mtime: 100 },
    { path: "usr/share/licenses/", type: "5", mtime: 100 },
    { path: "usr/local/bin/gosu", bytes: material.oldGosu, mode: 0o755, mtime: 100 },
    ...(options.baseEntries ?? []),
  ];
  const base = [layer(base0, "base0")];
  for (let index = 1; index < 10; index += 1) {
    base.push(layer([
      { path: "usr/", type: "5", mtime: 100 },
      ...(options.baseLayerEntries?.[index] ?? []),
    ], `base${index}`));
  }
  const candidate = [...base];
  candidate.push(layer([
    { path: "usr/local/bin/", type: "5", mtime: 203 },
    { path: "usr/local/bin/gosu", bytes: material.newGosu, mode: 0o755, mtime: 0 },
    ...(options.addedLayerOne ?? []),
  ], "candidate10"));
  candidate.push(layer([
    { path: "usr/share/licenses/", type: "5", mtime: 204 },
    { path: "usr/share/licenses/auto-world-gosu/", type: "5", mtime: 0 },
    ...EVIDENCE_NAMES.map((name, index) => ({
      path: `usr/share/licenses/auto-world-gosu/${name}`,
      bytes: material.evidenceBodies[index],
      mode: 0o644,
      mtime: 0,
    })),
    ...(options.addedLayerTwo ?? []),
  ], "candidate11"));
  return { base, candidate };
}

function history(length, prefix = "base") {
  return Array.from({ length }, (_unused, index) => ({ created_by: `${prefix}-${index}`, comment: "FORMAT_ONLY" }));
}

function imageConfig(layers, role, changes = {}) {
  const baseHistory = history(10);
  const value = {
    architecture: "amd64",
    os: "linux",
    config: strictRuntimeConfig(),
    rootfs: { type: "layers", diff_ids: layers.map(digest) },
    history: role === "BASE" ? baseHistory : [
      ...baseHistory,
      { created: "1970-01-01T00:03:20.000000001Z", created_by: "FORMAT_ONLY COPY gosu" },
      { created: "1970-01-01T00:03:25.999000000Z", created_by: "FORMAT_ONLY COPY evidence" },
    ],
    variantMarker: "FORMAT_ONLY_SHARED",
    ...(role === "CANDIDATE" ? { created: "1970-01-01T00:03:21Z" } : {}),
  };
  for (const [key, child] of Object.entries(changes)) {
    Object.defineProperty(value, key, { value: child, enumerable: true, configurable: true, writable: true });
  }
  return value;
}

function dockerSave(layers, role, configChanges = {}, manifestChanges = {}, outerEntries = [], ociChanges = {}) {
  const configValue = imageConfig(layers, role, configChanges);
  const configBytes = Buffer.from(JSON.stringify(configValue));
  const configId = digest(configBytes);
  const configPath = `blobs/sha256/${configId.slice(7)}`;
  const layerPaths = layers.map((bytes) => `blobs/sha256/${sha(bytes)}`);
  const manifestEntry = {
    Config: configPath,
    RepoTags: role === "BASE" ? null : ["aw-postgres-gosu:format-only"],
    Layers: layerPaths,
    ...manifestChanges,
  };
  if (ociChanges.legacyRootConfig === true) manifestEntry.Config = `${configId.slice(7)}.json`;
  const configDescriptor = {
    mediaType: OCI_CONFIG,
    digest: configId,
    size: configBytes.length,
    ...(ociChanges.configDescriptorChanges ?? {}),
  };
  const layerDescriptors = layers.map((bytes, index) => ({
    mediaType: OCI_LAYER,
    digest: digest(bytes),
    size: bytes.length,
    ...(ociChanges.layerDescriptorChanges?.[index] ?? {}),
  }));
  const imageManifest = {
    schemaVersion: 2,
    mediaType: OCI_MANIFEST,
    config: configDescriptor,
    layers: ociChanges.reverseImageLayers === true ? [...layerDescriptors].reverse() : layerDescriptors,
    ...(ociChanges.imageManifestChanges ?? {}),
  };
  const imageManifestBytes = ociChanges.nestedIndex === true
    ? Buffer.from(JSON.stringify({ schemaVersion: 2, mediaType: OCI_INDEX, manifests: [] }))
    : Buffer.from(JSON.stringify(imageManifest));
  const imageManifestId = digest(imageManifestBytes);
  const indexDescriptor = {
    mediaType: ociChanges.nestedIndex === true ? OCI_INDEX : OCI_MANIFEST,
    digest: imageManifestId,
    size: imageManifestBytes.length,
    annotations: { "org.opencontainers.image.ref.name": role === "BASE" ? "format-only-base" : "format-only-candidate" },
    platform: { os: "linux", architecture: "amd64" },
    ...(ociChanges.indexDescriptorChanges ?? {}),
  };
  const index = {
    schemaVersion: 2,
    mediaType: OCI_INDEX,
    manifests: ociChanges.doubleIndex === true ? [indexDescriptor, indexDescriptor] : [indexDescriptor],
    ...(ociChanges.indexChanges ?? {}),
  };
  const entries = [
    { path: configPath, bytes: ociChanges.tamperConfigBlob === true ? Buffer.concat([configBytes, Buffer.from(" ")]) : configBytes },
    { path: "manifest.json", bytes: Buffer.from(JSON.stringify([manifestEntry])) },
    { path: "oci-layout", bytes: Buffer.from(JSON.stringify({
      imageLayoutVersion: "1.0.0",
      ...(ociChanges.ociLayoutChanges ?? {}),
    })) },
    { path: "index.json", bytes: Buffer.from(JSON.stringify(index)) },
    { path: `blobs/sha256/${imageManifestId.slice(7)}`,
      bytes: ociChanges.tamperImageManifestBlob === true
        ? Buffer.concat([imageManifestBytes, Buffer.from(" ")]) : imageManifestBytes },
    ...layers.map((bytes, index) => ({
      path: layerPaths[index],
      bytes: ociChanges.tamperLayerBlob === index ? Buffer.concat([bytes, Buffer.from(" ")]) : bytes,
    })),
    ...(ociChanges.legacyRootConfig === true ? [{ path: `${configId.slice(7)}.json`, bytes: configBytes }] : []),
    ...outerEntries,
  ];
  const omitted = new Set(ociChanges.omitPaths ?? []);
  if (ociChanges.omitConfigBlob === true) omitted.add(configPath);
  if (ociChanges.omitImageManifestBlob === true) omitted.add(`blobs/sha256/${imageManifestId.slice(7)}`);
  if (Number.isInteger(ociChanges.omitLayerBlob)) omitted.add(layerPaths[ociChanges.omitLayerBlob]);
  const archive = tar(entries.filter((entry) => !omitted.has(entry.path)));
  return {
    archive,
    configId,
    subject: { role, archive: { bytes: archive.length, sha256: sha(archive) }, configId },
  };
}

function makeFixture(options = {}) {
  const material = formatOnlyContract();
  const layers = buildLayers(material, options);
  const base = dockerSave(layers.base, "BASE", options.baseConfigChanges, options.baseManifestChanges,
    options.baseOuterEntries, options.baseOciChanges);
  const candidate = dockerSave(layers.candidate, "CANDIDATE", options.candidateConfigChanges,
    options.candidateManifestChanges, options.candidateOuterEntries, options.candidateOciChanges);
  material.contract.base.configId = base.configId;
  return { material, layers, base, candidate };
}

function synthetic(context, identifier, values) {
  return new vm.SyntheticModule(Object.keys(values), function initialize() {
    for (const [name, value] of Object.entries(values)) this.setExport(name, value);
  }, { context, identifier });
}

async function loadFormatOnly(fixture, { liveNodeProbe = false } = {}) {
  const context = vm.createContext({
    AbortController: globalThis.AbortController,
    AbortSignal: globalThis.AbortSignal,
    Buffer,
  });
  const cache = new Map();
  const candidateModule = new vm.SourceTextModule(`
    const handles = new WeakSet();
    const contract = ${JSON.stringify(fixture.material.contract)};
    export const authenticHandle = Object.freeze(Object.create(null));
    handles.add(authenticHandle);
    export function candidateContractV2(handle) {
      if (!handles.has(handle)) throw new Error("postgres_gosu_derivative_lock_invalid");
      return JSON.parse(JSON.stringify(contract));
    }
  `, { context, identifier: CANDIDATE.href });
  cache.set(CANDIDATE.href, candidateModule);

  async function load(url) {
    if (cache.has(url.href)) return cache.get(url.href);
    if (url.protocol === "node:") {
      const namespace = await import(url.href);
      const module = synthetic(context, url.href, namespace);
      cache.set(url.href, module);
      return module;
    }
    const boundaryProbe = url.href === SOURCE.href && liveNodeProbe ? `
      export function TEST_ONLY_exceedLiveNodeLimit() {
        const nodes = new Map();
        const children = new Map();
        for (let index = 0; index < LAYER_MEMBERS; index += 1) {
          const path = \`bulk/\${index}\`;
          nodes.set(path, Object.freeze({ path, type: "directory", mode: 0o755, uid: 0, gid: 0, mtime: 0, size: 0 }));
        }
        applyMember(nodes, children, { entry: {
          path: "new-parent/child", type: "directory", mode: 0o755, uid: 0, gid: 0, mtime: 0, size: 0,
        } });
      }
    ` : "";
    const module = new vm.SourceTextModule(`${fs.readFileSync(url, "utf8")}\n${boundaryProbe}`,
      { context, identifier: url.href });
    cache.set(url.href, module);
    await module.link(async (specifier, referencing) => load(new URL(specifier, referencing.identifier)));
    return module;
  }
  const proof = await load(SOURCE);
  await proof.evaluate();
  const realm = (value) => vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(value))})`, context);
  const open = (bytes, subject) => proof.namespace.openGosuDerivativeDockerSaveV1(bytes, realm(subject));
  const prove = (handle, saves, buildWindow, additions = {}) => {
    context.__baseSave = saves.baseSave;
    context.__candidateSave = saves.candidateSave;
    context.__buildWindow = realm(buildWindow);
    context.__additions = realm(additions);
    const input = vm.runInContext("Object.assign({ baseSave: __baseSave, candidateSave: __candidateSave, buildWindow: __buildWindow }, __additions)", context);
    delete context.__baseSave;
    delete context.__candidateSave;
    delete context.__buildWindow;
    delete context.__additions;
    return proof.namespace.proveGosuDerivativeImagePairV1(handle, input);
  };
  return { api: proof.namespace, authenticHandle: candidateModule.namespace.authenticHandle, context, realm, open, prove };
}

async function opened(loaded, fixture) {
  return {
    baseSave: await loaded.open(fixture.base.archive, fixture.base.subject),
    candidateSave: await loaded.open(fixture.candidate.archive, fixture.candidate.subject),
  };
}

function expectCode(operation, code) {
  return assert.rejects(async () => operation(), (error) => {
    assert.equal(error?.message, code);
    assert.equal(error?.cause, undefined);
    assert.deepEqual(Reflect.ownKeys(error), ["stack", "message"]);
    return true;
  });
}

function deeplyFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value) && Reflect.ownKeys(value).every((key) => deeplyFrozen(value[key], seen));
}

if (typeof vm.SourceTextModule !== "function") {
  test("the full FORMAT_ONLY proof suite runs in a bounded VM child", () => {
    const childEnv = { ...process.env, NODE_NO_WARNINGS: "1" };
    delete childEnv.NODE_TEST_CONTEXT;
    const result = childProcess.spawnSync(process.execPath,
      ["--experimental-vm-modules", "--test", "--test-reporter=tap", SELF], {
      encoding: "utf8",
      env: childEnv,
      maxBuffer: 16 * 1024 ** 2,
      timeout: 120_000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /# tests 16/u);
    assert.match(result.stdout, /# fail 0/u);
  });
} else {
  test("FORMAT_ONLY real USTAR pair runs the real codec, scanner and V2 predicates with a closed result", async () => {
    const manifestCompatibility = { Parent: "FORMAT_ONLY-parent", LayerSources: { FORMAT_ONLY: "opaque" } };
    const fixture = makeFixture({
      baseManifestChanges: manifestCompatibility,
      candidateManifestChanges: manifestCompatibility,
    });
    const loaded = await loadFormatOnly(fixture);
    const saves = await opened(loaded, fixture);
    const result = loaded.prove(loaded.authenticHandle, saves, WINDOW);
    assert.equal(typeof result?.then, "undefined");
    assert.deepEqual(Object.keys(result), [
      "scope", "authority", "profile", "base", "candidate", "inheritedLayers", "addedLayers", "configProfile", "delta",
    ]);
    assert.equal(result.scope, "CONDITIONAL_ON_AUTHENTICATED_ARCHIVES_AND_BUILD_WINDOW");
    assert.equal(result.authority, "NOT_AUTHORIZED");
    assert.equal(result.profile, "POSTGRES_GOSU_DERIVATIVE_DOCKER_SAVE_USTAR_V1");
    assert.deepEqual(clone(result.base), { archive: fixture.base.subject.archive, configId: fixture.base.configId, layers: 10 });
    assert.deepEqual(clone(result.candidate),
      { archive: fixture.candidate.subject.archive, configId: fixture.candidate.configId, layers: 12 });
    assert.equal(result.inheritedLayers, 10);
    assert.equal(result.addedLayers, 2);
    assert.equal(result.configProfile, "STRICT_INHERITED_CONFIG_V2");
    assert.equal(result.delta.scope, "CONDITIONAL_ON_AUTHENTICATED_OCI");
    assert.equal(result.delta.authority, "NOT_AUTHORIZED");
    assert.deepEqual([...result.delta.replaced], ["usr/local/bin/gosu"]);
    assert.equal(result.delta.addedFiles.length, 12);
    assert.ok(deeplyFrozen(result));
    const serialized = JSON.stringify(result);
    for (const privateText of ["FORMAT_ONLY old", "COPY gosu", "variantMarker", "layer.tar"]) {
      assert.doesNotMatch(serialized, new RegExp(privateText, "u"));
    }
  });

  test("archive bytes and exact subject are snapshotted before the first await", async () => {
    const fixture = makeFixture();
    const loaded = await loadFormatOnly(fixture);
    const bytes = Buffer.from(fixture.base.archive);
    const subject = loaded.realm(fixture.base.subject);
    const pending = loaded.api.openGosuDerivativeDockerSaveV1(bytes, subject);
    bytes.fill(0x41);
    subject.role = "CANDIDATE";
    subject.archive.sha256 = "0".repeat(64);
    const handle = await pending;
    assert.equal(Object.getPrototypeOf(handle), null);
    assert.ok(Object.isFrozen(handle));
    assert.deepEqual(Reflect.ownKeys(handle), []);
  });

  test("input records, byte views and handles reject hostile authority without invoking hooks", async () => {
    const fixture = makeFixture();
    const loaded = await loadFormatOnly(fixture);
    const { api, authenticHandle } = loaded;
    let hooks = 0;
    const trap = () => { hooks += 1; throw new Error("PRIVATE_SENTINEL"); };
    const proxy = new Proxy({}, { get: trap, getPrototypeOf: trap, getOwnPropertyDescriptor: trap, ownKeys: trap });
    const getter = {};
    Object.defineProperty(getter, "role", { enumerable: true, get: trap });
    for (const [bytes, subject] of [
      [fixture.base.archive, proxy],
      [fixture.base.archive, getter],
      [fixture.base.archive, { ...fixture.base.subject, extra: true }],
      [new Proxy(fixture.base.archive, { get: trap }), fixture.base.subject],
      [new Uint8Array(new SharedArrayBuffer(1024)), fixture.base.subject],
      ["bytes", fixture.base.subject],
    ]) {
      await expectCode(() => api.openGosuDerivativeDockerSaveV1(bytes, subject), INPUT_ERROR);
    }
    const saves = await opened(loaded, fixture);
    for (const handle of [{}, Object.freeze(Object.create(null)), new Proxy({}, { get: trap })]) {
      await expectCode(() => loaded.prove(handle, saves, WINDOW), PAIR_ERROR);
    }
    await expectCode(() => loaded.prove(authenticHandle, saves, { ...WINDOW, extra: true }), PAIR_ERROR);
    assert.equal(hooks, 0);
  });

  test("archive identity, config identity, manifest and inherited layer bindings fail closed", async () => {
    const fixture = makeFixture();
    const loadedFixture = await loadFormatOnly(fixture);
    const { authenticHandle } = loadedFixture;
    for (const mutate of [
      (value) => { value.subject.archive.bytes += 1; },
      (value) => { value.subject.archive.bytes = 1024 ** 3 + 1; },
      (value) => { value.subject.archive.sha256 = "A".repeat(64); },
      (value) => { value.subject.archive.sha256 = "0".repeat(64); },
      (value) => { value.subject.configId = `sha256:${"0".repeat(64)}`; },
      (value) => { value.subject.role = "UNKNOWN"; },
    ]) {
      const value = { archive: Buffer.from(fixture.base.archive), subject: clone(fixture.base.subject) };
      mutate(value);
      await expectCode(() => loadedFixture.open(value.archive, value.subject),
        value.subject.role === "UNKNOWN" || value.subject.archive.bytes !== value.archive.length
          || !/^[a-f0-9]{64}$/u.test(value.subject.archive.sha256) ? INPUT_ERROR : ARCHIVE_ERROR);
    }
    for (const options of [
      { candidateManifestChanges: { Config: fixture.base.configId.toUpperCase().replace("SHA256:", "") } },
      { candidateManifestChanges: { Layers: [] } },
      { candidateConfigChanges: { architecture: "arm64" } },
      { candidateConfigChanges: { rootfs: { type: "layers", diff_ids: [] } } },
    ]) {
      const broken = makeFixture(options);
      const loaded = await loadFormatOnly(broken);
      await expectCode(() => opened(loaded, broken), ARCHIVE_ERROR);
    }
    const changed = makeFixture();
    changed.candidate.archive = Buffer.from(changed.candidate.archive);
    changed.candidate.archive[0] ^= 1;
    changed.candidate.subject.archive.sha256 = sha(changed.candidate.archive);
    const baseSave = await loadedFixture.open(fixture.base.archive, fixture.base.subject);
    await expectCode(() => loadedFixture.open(changed.candidate.archive, changed.candidate.subject), ARCHIVE_ERROR);
    assert.ok(baseSave);
    assert.ok(authenticHandle);
  });

  test("legacy and OCI selectors must resolve the same exact hash-bound config and ordered raw layers", async () => {
    const mutations = [
      { candidateManifestChanges: { Config: "legacy-root-config.json" } },
      { candidateManifestChanges: { Layers: [] } },
      { candidateOciChanges: { legacyRootConfig: true } },
      { candidateOciChanges: { ociLayoutChanges: { imageLayoutVersion: "1.0.1" } } },
      { candidateOciChanges: { ociLayoutChanges: { extra: true } } },
      { candidateOciChanges: { indexChanges: { schemaVersion: 3 } } },
      { candidateOciChanges: { indexChanges: { mediaType: OCI_MANIFEST } } },
      { candidateOciChanges: { indexChanges: { extra: true } } },
      { candidateOciChanges: { doubleIndex: true } },
      { candidateOciChanges: { nestedIndex: true } },
      { candidateOciChanges: { indexDescriptorChanges: { mediaType: OCI_INDEX } } },
      { candidateOciChanges: { indexDescriptorChanges: { digest: `sha256:${"0".repeat(64)}` } } },
      { candidateOciChanges: { indexDescriptorChanges: { size: 1 } } },
      { candidateOciChanges: { indexDescriptorChanges: { annotations: { FORMAT_ONLY: 1 } } } },
      { candidateOciChanges: { indexDescriptorChanges: { platform: { os: "linux", architecture: "arm64" } } } },
      { candidateOciChanges: {
        indexDescriptorChanges: { platform: { os: "linux", architecture: "amd64", variant: "v8" } },
      } },
      { candidateOciChanges: { indexDescriptorChanges: { extra: true } } },
      { candidateOciChanges: { imageManifestChanges: { schemaVersion: 3 } } },
      { candidateOciChanges: { imageManifestChanges: { mediaType: OCI_INDEX } } },
      { candidateOciChanges: { imageManifestChanges: { extra: true } } },
      { candidateOciChanges: { configDescriptorChanges: { mediaType: OCI_LAYER } } },
      { candidateOciChanges: { configDescriptorChanges: { digest: `sha256:${"0".repeat(64)}` } } },
      { candidateOciChanges: { configDescriptorChanges: { size: 1 } } },
      { candidateOciChanges: { configDescriptorChanges: { extra: true } } },
      { candidateOciChanges: { layerDescriptorChanges: { 0: { mediaType: OCI_CONFIG } } } },
      { candidateOciChanges: { layerDescriptorChanges: { 0: { digest: `sha256:${"0".repeat(64)}` } } } },
      { candidateOciChanges: { layerDescriptorChanges: { 0: { size: 1 } } } },
      { candidateOciChanges: { layerDescriptorChanges: { 0: { extra: true } } } },
      { candidateOciChanges: { reverseImageLayers: true } },
      { candidateOciChanges: { tamperConfigBlob: true } },
      { candidateOciChanges: { tamperImageManifestBlob: true } },
      { candidateOciChanges: { tamperLayerBlob: 0 } },
      { candidateOciChanges: { omitConfigBlob: true } },
      { candidateOciChanges: { omitImageManifestBlob: true } },
      { candidateOciChanges: { omitLayerBlob: 0 } },
    ];
    for (const options of mutations) {
      const fixture = makeFixture(options);
      const loaded = await loadFormatOnly(fixture);
      await expectCode(() => opened(loaded, fixture), ARCHIVE_ERROR);
    }
  });

  test("full configuration, history, exact UTC nanoseconds and runtime V2 invariants all execute", async () => {
    const mutations = [
      { candidateConfigChanges: { config: { ...strictRuntimeConfig(), User: "70" } } },
      { candidateConfigChanges: { variantMarker: "changed" } },
      { candidateConfigChanges: { history: history(12, "changed") } },
      { candidateConfigChanges: { history: [...history(10), { empty_layer: true }, {}] } },
      { candidateConfigChanges: { created: "1970-01-01T00:03:19.999999999Z" } },
      { candidateConfigChanges: { created: "1970-01-01T00:03:26Z" } },
      { candidateConfigChanges: { created: "1970-01-01T00:03:25.999000001Z" } },
      { candidateConfigChanges: { created: "1970-01-01T00:03:20.0000000001Z" } },
      { candidateConfigChanges: { created: "1970-01-01t00:03:20z" } },
      { candidateConfigChanges: { created: "1970-02-30T00:03:20Z" } },
      { candidateConfigChanges: { created: "1970-01-01T00:03:60Z" } },
    ];
    for (const options of mutations) {
      const fixture = makeFixture(options);
      const loaded = await loadFormatOnly(fixture);
      const saves = await opened(loaded, fixture);
      await expectCode(() => loaded.prove(loaded.authenticHandle, saves, WINDOW), PAIR_ERROR);
    }
  });

  test("JSON own __proto__ extension keys are preserved and compared as data", async () => {
    const sameExtension = JSON.parse('{"__proto__":{"FORMAT_ONLY":"same"}}');
    const fixture = makeFixture({ baseConfigChanges: sameExtension, candidateConfigChanges: sameExtension });
    const loadedFixture = await loadFormatOnly(fixture);
    const saves = await opened(loadedFixture, fixture);
    const result = await loadedFixture.prove(loadedFixture.authenticHandle, saves, WINDOW);
    assert.equal(result.scope, "CONDITIONAL_ON_AUTHENTICATED_ARCHIVES_AND_BUILD_WINDOW");

    const different = makeFixture({
      baseConfigChanges: JSON.parse('{"__proto__":{"FORMAT_ONLY":"base"}}'),
      candidateConfigChanges: JSON.parse('{"__proto__":{"FORMAT_ONLY":"candidate"}}'),
    });
    const loaded = await loadFormatOnly(different);
    const differentSaves = await opened(loaded, different);
    await expectCode(() => loaded.prove(loaded.authenticHandle, differentSaves, WINDOW), PAIR_ERROR);
  });

  test("layer application retains directory children, detaches hardlink inodes and rejects unsafe ancestry", async () => {
    const target = Buffer.from("FORMAT_ONLY inode old\n");
    const fixture = makeFixture({
      baseEntries: [
        { path: "usr/lib/", type: "5", mtime: 77 },
        { path: "usr/lib/original", bytes: target, mode: 0o644, mtime: 77 },
        { path: "usr/lib/alias", type: "1", linkname: "usr/lib/original", mode: 0o644, mtime: 77 },
      ],
    });
    const loadedFixture = await loadFormatOnly(fixture);
    const saves = await opened(loadedFixture, fixture);
    const result = await loadedFixture.prove(loadedFixture.authenticHandle, saves, WINDOW);
    assert.equal(result.delta.baseMembers + 13, result.delta.candidateMembers);

    const gosuAlias = makeFixture({
      baseEntries: [{ path: "usr/local/bin/gosu-alias", type: "1", linkname: "usr/local/bin/gosu", mode: 0o755, mtime: 100 }],
    });
    const loadedAlias = await loadFormatOnly(gosuAlias);
    const aliasSaves = await opened(loadedAlias, gosuAlias);
    await expectCode(() => loadedAlias.prove(loadedAlias.authenticHandle, aliasSaves, WINDOW), PAIR_ERROR);

    for (const baseEntries of [
      [{ path: "opt/link", type: "2", linkname: "usr" }, { path: "opt/link/file", bytes: Buffer.from("x") }],
      [{ path: "opt/file", bytes: Buffer.from("x") }, { path: "opt/file/child", bytes: Buffer.from("y") }],
      [{ path: "missing/child", bytes: Buffer.from("x") }],
      [{ path: "usr/lib/original", bytes: target },
        { path: "usr/lib/alias", type: "1", linkname: "usr/lib/missing", mode: 0o644, mtime: 100 }],
    ]) {
      const broken = makeFixture({ baseEntries });
      const loaded = await loadFormatOnly(broken);
      await expectCode(() => opened(loaded, broken), ARCHIVE_ERROR);
    }
  });

  test("derived layers cannot add undeclared paths, links or altered evidence and pair windows are exact", async () => {
    for (const options of [
      { addedLayerOne: [{ path: "usr/local/bin/extra", bytes: Buffer.from("x") }] },
      { addedLayerTwo: [{ path: "usr/share/licenses/auto-world-gosu/alias", type: "2", linkname: "notices.json" }] },
    ]) {
      const fixture = makeFixture(options);
      const loaded = await loadFormatOnly(fixture);
      const saves = await opened(loaded, fixture);
      await expectCode(() => loaded.prove(loaded.authenticHandle, saves, WINDOW), PAIR_ERROR);
    }
    const fixture = makeFixture();
    const loaded = await loadFormatOnly(fixture);
    const saves = await opened(loaded, fixture);
    for (const buildWindow of [
      { startedAtMs: -1, completedAtMs: 1 },
      { startedAtMs: 2, completedAtMs: 1 },
      { startedAtMs: 0, completedAtMs: 600_001 },
      { startedAtMs: 200_000.5, completedAtMs: 205_999 },
      { startSeconds: 200, endSeconds: 205 },
    ]) {
      await expectCode(() => loaded.prove(loaded.authenticHandle, saves, buildWindow), PAIR_ERROR);
    }
    await expectCode(() => loaded.prove(loaded.authenticHandle,
      { baseSave: saves.baseSave, candidateSave: saves.baseSave }, WINDOW), PAIR_ERROR);
  });

  test("native byte views ignore overrides and reject detached, resizable and cross-instance authority", async () => {
    const fixture = makeFixture();
    const loaded = await loadFormatOnly(fixture);
    let hooks = 0;
    const trap = () => { hooks += 1; throw new Error("PRIVATE_SENTINEL"); };
    const overridden = Buffer.from(fixture.base.archive);
    for (const name of ["buffer", "byteLength", "byteOffset", "length", "set", "slice", "subarray"]) {
      Object.defineProperty(overridden, name, { configurable: true, get: trap });
    }
    Object.defineProperty(overridden, Symbol.iterator, { configurable: true, get: trap });
    assert.ok(await loaded.open(overridden, fixture.base.subject));
    assert.equal(hooks, 0);

    const detached = new Uint8Array(Buffer.from(fixture.base.archive));
    globalThis.structuredClone(detached.buffer, { transfer: [detached.buffer] });
    await expectCode(() => loaded.api.openGosuDerivativeDockerSaveV1(detached, loaded.realm(fixture.base.subject)),
      INPUT_ERROR);
    if (typeof ArrayBuffer.prototype.resize === "function") {
      const backing = new ArrayBuffer(fixture.base.archive.length, { maxByteLength: fixture.base.archive.length + 1 });
      const resizable = new Uint8Array(backing);
      resizable.set(fixture.base.archive);
      await expectCode(() => loaded.api.openGosuDerivativeDockerSaveV1(resizable, loaded.realm(fixture.base.subject)),
        INPUT_ERROR);
    }

    const foreign = await loadFormatOnly(fixture);
    const saves = await opened(loaded, fixture);
    await expectCode(() => foreign.prove(foreign.authenticHandle, saves, WINDOW), PAIR_ERROR);
  });

  test("later overwrites detach aliases, replace directory subtrees and reject invalid hardlink scopes", async () => {
    const material = formatOnlyContract();
    const fixture = makeFixture({
      baseEntries: [
        { path: "usr/local/bin/gosu-alias", type: "1", linkname: "usr/local/bin/gosu", mode: 0o755, mtime: 100 },
        { path: "var/", type: "5", mtime: 100 },
        { path: "var/swapdir/", type: "5", mtime: 100 },
        { path: "var/swapdir/removed", bytes: Buffer.from("FORMAT_ONLY removed subtree\n"), mtime: 100 },
        { path: "var/swapfile", bytes: Buffer.from("FORMAT_ONLY replaced file\n"), mtime: 100 },
      ],
      baseLayerEntries: { 1: [
        { path: "usr/local/bin/gosu", bytes: material.oldGosu, mode: 0o755, mtime: 100 },
        { path: "var/swapdir", bytes: Buffer.from("FORMAT_ONLY directory became file\n"), mtime: 100 },
        { path: "var/swapfile/", type: "5", mtime: 100 },
      ] },
    });
    const loadedFixture = await loadFormatOnly(fixture);
    const saves = await opened(loadedFixture, fixture);
    assert.equal((await loadedFixture.prove(loadedFixture.authenticHandle, saves, WINDOW)).scope,
      "CONDITIONAL_ON_AUTHENTICATED_ARCHIVES_AND_BUILD_WINDOW");

    for (const options of [
      { baseEntries: [
        { path: "usr/lib/forward", type: "1", linkname: "usr/lib/target", mode: 0o644, mtime: 100 },
        { path: "usr/lib/target", bytes: Buffer.from("target"), mode: 0o644, mtime: 100 },
      ] },
      { baseEntries: [
        { path: "usr/lib/target", bytes: Buffer.from("target"), mode: 0o644, mtime: 100 },
        { path: "usr/lib/first", type: "1", linkname: "usr/lib/target", mode: 0o644, mtime: 100 },
        { path: "usr/lib/second", type: "1", linkname: "usr/lib/first", mode: 0o644, mtime: 100 },
      ] },
      {
        baseEntries: [{ path: "usr/lib/target", bytes: Buffer.from("target"), mode: 0o644, mtime: 100 }],
        baseLayerEntries: { 1: [
          { path: "usr/lib/cross", type: "1", linkname: "usr/lib/target", mode: 0o644, mtime: 100 },
        ] },
      },
    ]) {
      const broken = makeFixture(options);
      const loaded = await loadFormatOnly(broken);
      await expectCode(() => opened(loaded, broken), ARCHIVE_ERROR);
    }
  });

  test("raw USTAR profile rejects compressed, extended, special and whiteout layer records", async () => {
    for (const baseEntries of [
      [{ path: "usr/pax", type: "x" }],
      [{ path: "usr/device", type: "3" }],
      [{ path: "usr/.wh.format-only", bytes: Buffer.alloc(0) }],
      [{ path: "usr/.wh..wh..opq", bytes: Buffer.alloc(0) }],
    ]) {
      const fixture = makeFixture({ baseEntries });
      const loaded = await loadFormatOnly(fixture);
      await expectCode(() => opened(loaded, fixture), ARCHIVE_ERROR);
    }
    const compressed = makeFixture();
    compressed.layers.base[0] = gzipSync(compressed.layers.base[0]);
    compressed.base = dockerSave(compressed.layers.base, "BASE");
    const loaded = await loadFormatOnly(compressed);
    await expectCode(() => loaded.open(compressed.base.archive, compressed.base.subject), ARCHIVE_ERROR);
  });

  test("outer TAR and selected JSON budgets reject one-over-bound real fixtures", async () => {
    const outer = makeFixture({
      baseOuterEntries: Array.from({ length: 4082 }, (_unused, index) => ({
        path: `ignored/${String(index).padStart(4, "0")}`,
        bytes: Buffer.alloc(0),
      })),
    });
    const loadedOuter = await loadFormatOnly(outer);
    await expectCode(() => loadedOuter.open(outer.base.archive, outer.base.subject), ARCHIVE_ERROR);

    const tooLarge = makeFixture({ baseConfigChanges: { padding: "x".repeat(4 * 1024 ** 2) } });
    const loadedLarge = await loadFormatOnly(tooLarge);
    await expectCode(() => loadedLarge.open(tooLarge.base.archive, tooLarge.base.subject), ARCHIVE_ERROR);

    let deep = null;
    for (let index = 0; index < 33; index += 1) deep = { child: deep };
    const tooDeep = makeFixture({ baseConfigChanges: { deep } });
    const loadedDeep = await loadFormatOnly(tooDeep);
    await expectCode(() => loadedDeep.open(tooDeep.base.archive, tooDeep.base.subject), ARCHIVE_ERROR);

    const tooMany = makeFixture({ baseConfigChanges: { nodes: Array(100_001).fill(null) } });
    const loadedMany = await loadFormatOnly(tooMany);
    await expectCode(() => loadedMany.open(tooMany.base.archive, tooMany.base.subject), ARCHIVE_ERROR);
  });

  test("the accepted pair enforces its aggregate 100000 layer-member budget", { timeout: 120_000 }, async () => {
    const bulk = [
      { path: "bulk/", type: "5", mtime: 100 },
      ...Array.from({ length: 49_977 }, (_unused, index) => ({
        path: `bulk/${String(index).padStart(5, "0")}/`,
        type: "5",
        mtime: 100,
      })),
    ];
    const fixture = makeFixture({ baseEntries: bulk });
    const loaded = await loadFormatOnly(fixture);
    const saves = await opened(loaded, fixture);
    await expectCode(() => loaded.prove(loaded.authenticHandle, saves, WINDOW), PAIR_ERROR);
  });

  test("the live filesystem node cap rejects the first inferred ancestor beyond 100000", async () => {
    const fixture = makeFixture();
    const loaded = await loadFormatOnly(fixture, { liveNodeProbe: true });
    await expectCode(() => loaded.api.TEST_ONLY_exceedLiveNodeLimit(), ARCHIVE_ERROR);
  });

  test("production module has only two exports and synthetic handles carry no authority there", async () => {
    const production = await import(SOURCE.href);
    assert.deepEqual(Object.keys(production), ["openGosuDerivativeDockerSaveV1", "proveGosuDerivativeImagePairV1"]);
    const fixture = makeFixture();
    const baseSave = await production.openGosuDerivativeDockerSaveV1(fixture.base.archive, fixture.base.subject);
    const candidateSave = await production.openGosuDerivativeDockerSaveV1(fixture.candidate.archive, fixture.candidate.subject);
    await expectCode(() => production.proveGosuDerivativeImagePairV1(Object.freeze(Object.create(null)), {
      baseSave,
      candidateSave,
      buildWindow: WINDOW,
    }), PAIR_ERROR);
    const realCandidate = await import(CANDIDATE.href);
    const realLock = realCandidate.openCandidateLockV2(fs.readFileSync(
      new URL("../infra/postgres-image/gosu-derivative-candidate-lock-v2.json", import.meta.url)));
    await expectCode(() => production.proveGosuDerivativeImagePairV1(realLock, {
      baseSave,
      candidateSave,
      buildWindow: WINDOW,
    }), PAIR_ERROR);
  });
}
