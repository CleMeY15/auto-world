import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs, { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync,
  rmSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test from "node:test";
import { validatePostgresCandidateArchive } from "../scripts/postgres-image/candidate-proof.mjs";
import { retainLocalPostgresCandidate, validateLocalPostgresRetentionReceipt } from "../scripts/postgres-image/candidate-local-retention.mjs";

const runId = "36700000001"; const recipeRevision = "a".repeat(40);
const linux = process.platform === "linux" && process.getuid() > 0 && process.getgid() > 0;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digest = (bytes) => `sha256:${hash(bytes)}`;
const json = (value) => Buffer.from(JSON.stringify(value));
const clone = (value) => JSON.parse(JSON.stringify(value));
const phaseNames = ["managed_engine", "registry_login", "raw_tag_manifest", "anonymous_digest_denied", "raw_digest_manifest",
  "local_inventory_before", "local_collision_check", "exact_digest_pull", "simple_local_alias", "private_docker_save",
  "full_archive_validation", "private_archive_callback", "owned_docker_cleanup", "owned_temporary_cleanup"];

function tar(entries) {
  const parts = [];
  for (const entry of entries) {
    const content = entry.content ?? Buffer.alloc(0); const block = Buffer.alloc(512);
    Buffer.from(entry.name).copy(block);
    const octal = (offset, width, value) => Buffer.from(`${value.toString(8).padStart(width - 1, "0")}\0`).copy(block, offset);
    octal(100, 8, entry.type === "5" ? 0o755 : 0o644); octal(108, 8, 0); octal(116, 8, 0);
    octal(124, 12, content.length); octal(136, 12, 1_700_000_000);
    block.fill(0x20, 148, 156); block.write(entry.type ?? "0", 156);
    Buffer.from("ustar\0").copy(block, 257); Buffer.from("00").copy(block, 263);
    Buffer.from("root").copy(block, 265); Buffer.from("root").copy(block, 297);
    const checksum = block.reduce((total, byte) => total + byte, 0);
    Buffer.from(`${checksum.toString(8).padStart(6, "0")}\0 `).copy(block, 148);
    parts.push(block, content, Buffer.alloc((512 - content.length % 512) % 512));
  }
  return Buffer.concat([...parts, Buffer.alloc(1024)]);
}
function materialFixture() {
  const tag = `aw-postgres-gosu:${hash(Buffer.from(`${runId}:${recipeRevision}`)).slice(0, 24)}`;
  const layers = Array.from({ length: 12 }, (_, index) => {
    const buffer = Buffer.alloc(1024); Buffer.from(`raw-layer-${index}\n`).copy(buffer); return buffer;
  });
  const diffIds = layers.map(digest);
  const runtime = { Entrypoint: ["docker-entrypoint.sh"], Cmd: ["postgres"], WorkingDir: "/" };
  const config = json({ architecture: "amd64", os: "linux", docker_version: "28.0.4", config: runtime,
    rootfs: { type: "layers", diff_ids: diffIds } }); const imageId = digest(config);
  const rawLayers = layers.map((value, index) => ({ mediaType: "application/vnd.oci.image.layer.v1.tar", digest: diffIds[index], size: value.length }));
  const manifest = json({ schemaVersion: 2, mediaType: "application/vnd.oci.image.manifest.v1+json",
    config: { mediaType: "application/vnd.oci.image.config.v1+json", digest: imageId, size: config.length }, layers: rawLayers });
  const ids = Array.from({ length: 12 }, (_, index) => hash(Buffer.from(`legacy-${index}`)));
  const zero = { Hostname: "", Domainname: "", User: "", AttachStdin: false, AttachStdout: false,
    AttachStderr: false, Tty: false, OpenStdin: false, StdinOnce: false, Env: null, Cmd: null, Image: "",
    Volumes: null, WorkingDir: "", Entrypoint: null, OnBuild: null, Labels: null };
  const records = ids.map((id, index) => json(index === 11 ? { id, parent: ids[index - 1], created: "2026-09-30T10:00:00Z",
    container: "c".repeat(64), container_config: runtime, docker_version: "28.0.4", config: runtime, architecture: "amd64", os: "linux" }
    : { id, ...(index ? { parent: ids[index - 1] } : {}), created: "1970-01-01T01:00:00+01:00", container_config: zero, os: "linux" }));
  const archive = tar([
    { name: "blobs/", type: "5" }, { name: "blobs/sha256/", type: "5" },
    ...layers.map((content, index) => ({ name: `blobs/sha256/${diffIds[index].slice(7)}`, content })),
    ...records.map((content) => ({ name: `blobs/sha256/${hash(content)}`, content })),
    { name: `blobs/sha256/${imageId.slice(7)}`, content: config }, { name: `blobs/sha256/${hash(manifest)}`, content: manifest },
    { name: "index.json", content: json({ schemaVersion: 2, mediaType: "application/vnd.oci.image.index.v1+json", manifests: [{
      mediaType: "application/vnd.oci.image.manifest.v1+json", digest: digest(manifest), size: manifest.length,
      annotations: { "io.containerd.image.name": `docker.io/library/${tag}`, "org.opencontainers.image.ref.name": tag.split(":")[1] } }] }) },
    { name: "manifest.json", content: json([{ Config: `blobs/sha256/${imageId.slice(7)}`, RepoTags: [tag],
      Layers: diffIds.map((value) => `blobs/sha256/${value.slice(7)}`), LayerSources: Object.fromEntries(rawLayers.map((item) => [item.digest, item])) }]) },
    { name: "oci-layout", content: json({ imageLayoutVersion: "1.0.0" }) },
    { name: "repositories", content: json({ "aw-postgres-gosu": { [tag.split(":")[1]]: diffIds.at(-1).slice(7) } }) },
  ]);
  const compressed = layers.map((_, index) => ({ mediaType: "application/vnd.docker.image.rootfs.diff.tar.gzip",
    digest: digest(Buffer.from(`compressed-${index}`)), size: 1000 + index }));
  const configDescriptor = { digest: imageId, size: config.length, mediaType: "application/vnd.docker.container.image.v1+json" };
  const remoteManifest = json({ schemaVersion: 2, mediaType: "application/vnd.docker.distribution.manifest.v2+json", config: configDescriptor, layers: compressed });
  const policy = { kind: "POSTGRES_REMOTE_CANDIDATE_POLICY_V1", authority: "REVIEWED_MAIN_POLICY", repository: "CleMeY15/auto-world",
    owner: "CleMeY15", image: "ghcr.io/clemey15/auto-world-postgres-gosu", platform: "linux/amd64", publishedTag: "candidate-36361670116-attempt-1",
    subject: `ghcr.io/clemey15/auto-world-postgres-gosu@${digest(remoteManifest)}`,
    manifest: { digest: digest(remoteManifest), bytes: remoteManifest.length, mediaType: "application/vnd.docker.distribution.manifest.v2+json",
      config: configDescriptor, layers: compressed, baseLayerCount: 10, newLayerCount: 2 }, candidate: { imageId, diffIds },
    publisher: { workflowPath: ".github/workflows/postgres-candidate-publish-v4.yml", runId: "36361670116", runNumber: "1", runAttempt: "1",
      recipeRevision: "b".repeat(40), receiptSha256: "d".repeat(64), receiptBytes: 22970, result: "PASSED" } };
  const proof = validatePostgresCandidateArchive(archive, { imageId, tag, expectedDiffIds: diffIds, expectedLayers: 12 });
  const receipt = { kind: "POSTGRES_REMOTE_CANDIDATE_RECEIPT_V1", state: "VERIFIED", authority: "REMOTE_READ_ONLY", publication: "PUBLISHED_UNADMITTED",
    registryWrite: "NOT_ATTEMPTED", vulnerabilityAudit: "NOT_ATTEMPTED", imageExecution: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED",
    supportStartedAt: null, supportEndsAt: null, archiveUntil: null, runId, recipeRevision, subject: policy.subject, alias: tag,
    remoteManifest: { state: "RAW_MANIFEST_VERIFIED", ...policy.manifest },
    engine: { state: "ENGINE_VERIFIED", docker: "28.0.4|28.0.4", buildx: "test-buildx", serverVersion: "28.0.4", pullResponse: "SUCCESS",
      compressedDigestVerification: "MANAGED_MOBY_PULL", compressedSizeVerification: "RECORDED_ONLY" },
    image: { imageId, diffIds, platform: "linux/amd64" }, archive: { state: "ARCHIVE_VERIFIED", imageId, diffIds,
      archiveSha256: proof.archiveSha256, archiveBytes: proof.archiveBytes, saveResponse: "SUCCESS" },
    publisher: { result: policy.publisher.result, runId: policy.publisher.runId, recipeRevision: policy.publisher.recipeRevision,
      receiptSha256: policy.publisher.receiptSha256, receiptBytes: policy.publisher.receiptBytes },
    phases: phaseNames.map((name) => ({ name, result: "PASSED", durationMs: 0 })) };
  return { archive, policy, proof, receipt };
}
function scope(t, options = {}) {
  const root = mkdtempSync("/tmp/aw-pgr-"); chmodSync(root, 0o700);
  const parent = path.join(root, "temporary"); const destination = path.join(root, "retained");
  mkdirSync(parent, { mode: 0o700 }); mkdirSync(destination, { mode: 0o700 });
  const material = materialFixture(); const state = { providerCalls: 0, validations: 0, copiedBeforeCleanup: false };
  const input = { parent, destination, policy: material.policy, runId, recipeRevision };
  const remoteProvider = async (received, inspect, receivedDependencies) => {
    state.providerCalls++; const remoteInput = { ...input }; delete remoteInput.destination;
    assert.deepEqual(received, remoteInput);
    assert.equal(receivedDependencies, options.providerDependencies ?? dependencies.providerDependencies);
    const work = path.join(parent, `remote-${runId}-attempt-1`); mkdirSync(work, { mode: 0o700 });
    const file = path.join(work, "candidate.tar"); writeFileSync(file, material.archive, { mode: 0o600 });
    const snapshot = { file, archiveProof: material.proof, policy: clone(material.policy), subject: material.policy.subject,
      imageId: material.policy.candidate.imageId, diffIds: [...material.policy.candidate.diffIds], runId, recipeRevision, signal: received.signal };
    try {
      if (options.beforeCallback) options.beforeCallback({ file, snapshot, input, state });
      await inspect(snapshot);
      state.copiedBeforeCleanup = existsSync(path.join(destination, "candidate.tar"));
      assert.equal(existsSync(path.join(destination, "retention-receipt.json")), false);
      if (options.secondCallback) await inspect(snapshot);
    } finally { if (!options.preserveTemporary) rmSync(work, { recursive: true }); }
    if (options.afterCleanup) options.afterCleanup({ input, state });
    if (options.providerFailure) throw new Error("private provider output must never be public");
    return options.receipt ? options.receipt(clone(material.receipt)) : material.receipt;
  };
  const validateArchive = (bytes, expected) => {
    state.validations++; const proof = validatePostgresCandidateArchive(bytes, expected);
    if (options.afterValidation) options.afterValidation({ input, state });
    return options.proof ? options.proof(clone(proof)) : proof;
  };
  const dependencies = { remoteProvider, validateArchive, providerDependencies: { env: { GITHUB_TOKEN: "never-serialized" } } };
  t.after(() => { assert.ok(root.startsWith("/tmp/aw-pgr-")); rmSync(root, { recursive: true, force: true }); });
  return { root, parent, destination, material, state, input, dependencies,
    run: () => retainLocalPostgresCandidate(input, dependencies), archiveFile: path.join(destination, "candidate.tar"),
    receiptFile: path.join(destination, "retention-receipt.json") };
}

test("private PostgreSQL retention validates all twelve raw layers before and after remote cleanup", { skip: !linux }, async (t) => {
  const f = scope(t); const result = await f.run();
  assert.equal(f.state.validations, 2); assert.equal(f.state.copiedBeforeCleanup, true);
  assert.deepEqual(readFileSync(result.archiveFile), f.material.archive); assert.equal(lstatSync(result.archiveFile).mode & 0o7777, 0o600);
  assert.equal(lstatSync(result.archiveFile).nlink, 1); assert.equal(lstatSync(result.receiptFile).mode & 0o7777, 0o600);
  const receipt = JSON.parse(readFileSync(result.receiptFile)); assert.deepEqual(receipt, result.receipt);
  assert.equal(receipt.executionId, `local-${runId}`); assert.equal(receipt.githubRunId, null); assert.equal(receipt.admission, "NOT_AUTHORIZED");
  assert.equal(receipt.archiveProof.remoteLayerVerification, "NOT_ESTABLISHED_BY_DOCKER_SAVE");
  assert.equal(receipt.diffIds.length, 12); assert.equal(receipt.archiveProof.rawLayers.length, 12);
  assert.deepEqual(receipt.phases.map((item) => item.name), ["private_archive_copy", "retained_archive_validation", "remote_cleanup", "post_cleanup_archive_validation"]);
  assert.deepEqual(validateLocalPostgresRetentionReceipt(receipt, f.input.policy), receipt);
  assert.equal(readFileSync(result.receiptFile, "utf8").includes("never-serialized"), false);
  assert.equal(Object.isFrozen(result.receipt.archiveProof.rawLayers), true);
});

test("receipt rejects authority, identity, dates, twelve-layer proof and cleanup substitutions", { skip: !linux }, async (t) => {
  const f = scope(t); const { receipt } = await f.run();
  for (const mutate of [
    (v) => { v.extra = true; }, (v) => { v.authority = "ADMITTED"; }, (v) => { v.githubRunId = runId; },
    (v) => { v.signing = "SIGNED"; }, (v) => { v.supportStartedAt = "2026-09-30"; }, (v) => { v.archiveUntil = "2028-09-30"; },
    (v) => { v.diffIds.pop(); }, (v) => { v.archiveProof.rawLayers.pop(); }, (v) => { v.archiveProof.rawLayers[0].size = 1025; },
    (v) => { v.archiveProof.rawLayers[0].extra = true; }, (v) => { v.archiveProof.compatibilityRecords[1].parent = null; },
    (v) => { v.archiveProof.remoteLayerVerification = "VERIFIED"; }, (v) => { v.archiveProof.tag = "aw-postgres-gosu:000000000000000000000000"; },
    (v) => { v.remoteMaterialReceipt.phases[12].result = "FAILED"; }, (v) => { v.phases[3].result = "FAILED"; },
  ]) { const changed = clone(receipt); mutate(changed); assert.throws(() => validateLocalPostgresRetentionReceipt(changed, f.input.policy), /receipt_invalid/u); }
});

test("input, routing hooks and private roots fail before invoking the provider", { skip: !linux }, async (t) => {
  for (const mutate of [
    (f) => { f.input.runId = "0"; }, (f) => { f.input.extra = true; }, (f) => { f.dependencies.uid = 1000; },
    (f) => { f.dependencies.platform = "linux"; }, (f) => { chmodSync(f.destination, 0o755); },
    (f) => { writeFileSync(path.join(f.destination, "foreign"), "keep"); }, (f) => { f.input.destination = f.parent; },
    (f) => { const nested = path.join(f.parent, "nested"); mkdirSync(nested, { mode: 0o700 }); f.input.destination = nested; },
    (f) => { const alias = path.join(f.root, "alias"); symlinkSync(f.destination, alias); f.input.destination = alias; },
  ]) await t.test("reject unsafe input", async (child) => {
    const f = scope(child); mutate(f); await assert.rejects(f.run(), /postgres_local_retention_/u);
    assert.equal(f.state.providerCalls, 0); assert.equal(existsSync(f.receiptFile), false);
  });
});

test("abort before copy and provider error preserve privacy without a success receipt", { skip: !linux }, async (t) => {
  for (const stage of ["before", "callback", "cleanup", "provider"]) await t.test(stage, async (child) => {
    const controller = new globalThis.AbortController();
    const f = scope(child, { beforeCallback: stage === "callback" ? () => controller.abort() : undefined,
      afterCleanup: stage === "cleanup" ? () => controller.abort() : undefined, providerFailure: stage === "provider" });
    f.input.signal = controller.signal; if (stage === "before") controller.abort();
    await assert.rejects(f.run(), /postgres_local_retention_(?:aborted|remote_failed)/u);
    assert.equal(existsSync(f.receiptFile), false);
    assert.equal(existsSync(f.archiveFile), stage === "cleanup" || stage === "provider");
  });
});

test("source symlink, hardlink, mode, wrong scope and callback identity substitutions never produce a receipt", { skip: !linux }, async (t) => {
  for (const mutate of [
    ({ file }) => { renameSync(file, `${file}.old`); symlinkSync(`${file}.old`, file); },
    ({ file }) => linkSync(file, `${file}.hardlink`), ({ file }) => chmodSync(file, 0o644),
    ({ snapshot }) => { snapshot.file = "/tmp/foreign.tar"; }, ({ snapshot }) => { snapshot.diffIds.pop(); },
    ({ snapshot }) => { snapshot.archiveProof = { ...snapshot.archiveProof, imageId: `sha256:${"0".repeat(64)}` }; },
  ]) await t.test("reject substituted source", async (child) => {
    const f = scope(child, { beforeCallback: mutate }); await assert.rejects(f.run(), /postgres_local_retention_/u);
    assert.equal(existsSync(f.receiptFile), false);
  });
});

test("copy corruption or inode substitution during cleanup blocks post-cleanup publication", { skip: !linux }, async (t) => {
  for (const mutate of [
    (file) => { const bytes = readFileSync(file); bytes[1024] ^= 1; writeFileSync(file, bytes); },
    (file) => { const bytes = readFileSync(file); renameSync(file, `${file}.old`); writeFileSync(file, bytes, { flag: "wx", mode: 0o600 }); },
    (file) => chmodSync(file, 0o640),
  ]) await t.test("reject changed retained copy", async (child) => {
    const f = scope(child, { afterCleanup: ({ input }) => mutate(path.join(input.destination, "candidate.tar")) });
    await assert.rejects(f.run(), /postgres_local_retention_(?:file_changed|copy_changed|archive_invalid)/u);
    assert.equal(existsSync(f.archiveFile), true); assert.equal(existsSync(f.receiptFile), false);
  });
});

test("invalid remote cleanup receipt, retained temporary data and multiple callbacks preserve copy without success", { skip: !linux }, async (t) => {
  for (const options of [
    { receipt: (v) => ({ ...v, state: "FAILED" }) },
    { receipt: (v) => { v.phases[12].result = "FAILED"; return v; } },
    { receipt: (v) => { v.archive.archiveSha256 = "0".repeat(64); return v; } },
    { preserveTemporary: true }, { secondCallback: true },
  ]) await t.test("reject failed cleanup contract", async (child) => {
    const f = scope(child, options); await assert.rejects(f.run(), /postgres_local_retention_/u);
    assert.equal(existsSync(f.archiveFile), true); assert.equal(existsSync(f.receiptFile), false);
  });
});

test("validator cannot rewrite copy bytes and return an unchanged proof", { skip: !linux }, async (t) => {
  const f = scope(t, { afterValidation: ({ input }) => writeFileSync(path.join(input.destination, "candidate.tar"), "changed") });
  await assert.rejects(f.run(), /postgres_local_retention_file_changed/u); assert.equal(existsSync(f.receiptFile), false);
});

test("source byte mutation during the FD copy is rejected even if the provider returns its old proof", { skip: !linux }, async (t) => {
  const f = scope(t); const original = fs.readSync; let changed = false;
  try {
    fs.readSync = (...args) => {
      if (!changed) {
        changed = true; const file = path.join(f.parent, `remote-${runId}-attempt-1`, "candidate.tar");
        const bytes = readFileSync(file); bytes[1024] ^= 1; writeFileSync(file, bytes);
      }
      return original(...args);
    };
    syncBuiltinESMExports(); await assert.rejects(f.run(), /postgres_local_retention_(?:file_changed|source_invalid)/u);
    assert.equal(existsSync(f.receiptFile), false);
  } finally { fs.readSync = original; syncBuiltinESMExports(); }
});

test("existing private archive and receipt cannot be overwritten", { skip: !linux }, async (t) => {
  const f = scope(t); await f.run(); const archived = readFileSync(f.archiveFile); const received = readFileSync(f.receiptFile);
  await assert.rejects(f.run(), /postgres_local_retention_directory_invalid/u);
  assert.deepEqual(readFileSync(f.archiveFile), archived); assert.deepEqual(readFileSync(f.receiptFile), received);
});

test("pending receipt collision preserves foreign bytes without publishing success", { skip: !linux }, async (t) => {
  const f = scope(t, { afterCleanup: ({ input }) => writeFileSync(path.join(input.destination, ".retention-receipt.pending"), "foreign", { mode: 0o600 }) });
  await assert.rejects(f.run(), /postgres_local_retention_receipt_failed/u);
  assert.equal(readFileSync(path.join(f.destination, ".retention-receipt.pending"), "utf8"), "foreign");
  assert.equal(existsSync(f.receiptFile), false); assert.equal(existsSync(f.archiveFile), true);
});

test("copy mutation at receipt linking rolls back only the just-created owned receipt", { skip: !linux }, async (t) => {
  const f = scope(t); const original = fs.linkSync;
  try {
    fs.linkSync = (source, target) => { original(source, target); writeFileSync(f.archiveFile, "changed during receipt linking"); };
    syncBuiltinESMExports(); await assert.rejects(f.run(), /postgres_local_retention_receipt_failed/u);
    assert.equal(existsSync(f.receiptFile), false); assert.equal(existsSync(f.archiveFile), true);
  } finally { fs.linkSync = original; syncBuiltinESMExports(); }
});

test("same-size receipt byte corruption during publication is detected and owned receipt is withdrawn", { skip: !linux }, async (t) => {
  const f = scope(t); const original = fs.linkSync;
  try {
    fs.linkSync = (source, target) => {
      original(source, target); const bytes = readFileSync(target); bytes[0] = 0x20; writeFileSync(target, bytes);
    };
    syncBuiltinESMExports(); await assert.rejects(f.run(), /postgres_local_retention_receipt_failed/u);
    assert.equal(existsSync(f.receiptFile), false); assert.deepEqual(readFileSync(f.archiveFile), f.material.archive);
  } finally { fs.linkSync = original; syncBuiltinESMExports(); }
});

test("default provider argument contract rejects missing credentials before any external operation", { skip: !linux }, async (t) => {
  const f = scope(t);
  await assert.rejects(retainLocalPostgresCandidate(f.input, { providerDependencies: { env: {} } }), /postgres_local_retention_remote_failed/u);
  assert.equal(existsSync(f.archiveFile), false); assert.equal(existsSync(f.receiptFile), false);
});

test("unclosed validator proofs and forged dependency error codes stay rejected and private", { skip: !linux }, async (t) => {
  for (const options of [
    { proof: (v) => ({ ...v, extra: true }) },
    { proof: (v) => { v.rawLayers.pop(); return v; } },
    { proof: (v) => { v.compatibilityRecords[11].parent = null; return v; } },
  ]) await t.test("reject invalid proof", async (child) => {
    const f = scope(child, options); await assert.rejects(f.run(), /postgres_local_retention_proof_invalid/u);
    assert.equal(existsSync(f.receiptFile), false); assert.equal(existsSync(f.archiveFile), true);
  });
  const f = scope(t); f.dependencies.remoteProvider = () => { throw Object.assign(new Error("postgres_local_retention_secret_payload"), { secret: "private" }); };
  await assert.rejects(f.run(), (error) => {
    assert.equal(error.message, "postgres_local_retention_remote_failed"); assert.deepEqual(Object.keys(error), []); return true;
  });
});

test("dependency error message getters are read once and never disclose a second private value", { skip: !linux }, async (t) => {
  for (const mode of ["changes", "throws"]) await t.test(mode, async (child) => {
    const f = scope(child); let reads = 0;
    const hostile = Object.assign(new Error(), { privatePayload: "never-public" });
    Object.defineProperty(hostile, "message", { get() {
      reads++;
      if (mode === "throws") throw new Error("private getter failure");
      return reads === 1 ? "postgres_local_retention_proof_invalid" : "postgres_local_retention_private_payload_never_public";
    } });
    Object.defineProperty(f.dependencies, "remoteProvider", { get() { throw hostile; } });
    await assert.rejects(f.run(), (error) => {
      assert.equal(error.message, mode === "changes" ? "postgres_local_retention_proof_invalid" : "postgres_local_retention_operation_failed");
      assert.deepEqual(Object.keys(error), []); return true;
    });
    assert.equal(reads, 1); assert.equal(f.state.providerCalls, 0); assert.equal(existsSync(f.receiptFile), false);
  });
});
