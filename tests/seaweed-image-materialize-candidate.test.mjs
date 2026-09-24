import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { finished } from "node:stream/promises";
import test from "node:test";

import {
  candidateImportChanges, isPublicCandidateFailureCode, TEST_ONLY_materializeLocalSeaweedCandidate,
  validateCandidateImage,
} from "../scripts/seaweed-image/materialize-candidate.mjs";
import { SEAWEED_CANDIDATE_IMPORT_MESSAGE } from "../scripts/seaweed-image/candidate-archive.mjs";

const linux = process.platform === "linux";
const imageId = `sha256:${"b".repeat(64)}`;
const diffId = `sha256:${"c".repeat(64)}`;
const raw = Buffer.alloc(2048, 0x51);

function importConfig() {
  return { Hostname: "", Domainname: "", AttachStdin: false, AttachStdout: false,
    AttachStderr: false, Tty: false, OpenStdin: false, StdinOnce: false, Image: "", OnBuild: null,
    Entrypoint: ["/entrypoint.sh"], Cmd: ["mini", "-dir=/data"],
    Env: ["PATH=/usr/local/bin:/usr/bin"], WorkingDir: "/data", Volumes: { "/data": {} },
    ExposedPorts: { "8333/tcp": {} }, User: "",
    Labels: { "com.auto-world.profile": "SeaweedFS S3 derivative" } };
}

function image(tag, config = importConfig()) {
  return { Id: imageId, RepoTags: [tag], Os: "linux", Architecture: "amd64", Size: raw.length,
    RootFS: { Type: "layers", Layers: [diffId] }, Config: config };
}

test("candidate import changes preserve the reviewed runtime fields without USER or ArgsEscaped", () => {
  const changes = candidateImportChanges(importConfig());
  assert.deepEqual(changes.slice(0, 5), [
    'ENTRYPOINT ["/entrypoint.sh"]', 'CMD ["mini","-dir=/data"]',
    "ENV PATH=/usr/local/bin:/usr/bin", "WORKDIR /data", 'VOLUME ["/data"]',
  ]);
  assert.ok(changes.includes("EXPOSE 8333/tcp"));
  assert.ok(changes.includes('LABEL com.auto-world.profile="SeaweedFS S3 derivative"'));
  assert.ok(changes.every((change) => !/^(?:USER|ArgsEscaped)\b/u.test(change)));
  assert.equal(SEAWEED_CANDIDATE_IMPORT_MESSAGE, "Auto World SeaweedFS S3 derivative v1");
  assert.throws(() => candidateImportChanges({ ...importConfig(), User: "1000" }), /arguments_invalid/u);
  assert.throws(() => candidateImportChanges({ ...importConfig(), Injected: true }), /arguments_invalid/u);
});

test("candidate image ownership requires the exact ID, tag, platform, one layer and config", () => {
  const tag = "auto-world-seaweed-s3:run-123-attempt-1";
  const validateRuntimeConfig = (value) => assert.deepEqual(value, importConfig());
  assert.deepEqual(validateCandidateImage(image(tag), { imageId, tag, diffId, rawSize: raw.length,
    validateRuntimeConfig }), { imageId, diffId });
  for (const altered of [
    { ...image(tag), RepoTags: [tag, "foreign:latest"] },
    { ...image(tag), RootFS: { Type: "layers", Layers: [diffId, diffId] } },
    { ...image(tag), Architecture: "arm64" },
    { ...image(tag), Config: { ...importConfig(), User: "root" } },
  ]) {
    assert.throws(() => validateCandidateImage(altered, { imageId, tag, diffId, rawSize: raw.length,
      validateRuntimeConfig }), /ownership_failed/u);
  }
  assert.equal(isPublicCandidateFailureCode("seaweed_candidate_archive_failed"), true);
  assert.equal(isPublicCandidateFailureCode("seaweed_candidate_arbitrary_secret"), false);
  assert.throws(() => validateCandidateImage(image(tag, { ...importConfig(), Cmd: ["changed"] }), {
    imageId, tag, diffId, rawSize: raw.length, validateRuntimeConfig, expectedConfig: importConfig(),
  }), { code: "seaweed_candidate_ownership_failed", detailCode: "config_Cmd" });
  for (const [changed, detailCode] of [
    [{ ...image(tag), Id: diffId }, "id"],
    [{ ...image(tag), RepoTags: ["foreign:latest"] }, "tags"],
    [{ ...image(tag), Os: "windows" }, "platform"],
    [{ ...image(tag), Size: 0 }, "size"],
    [{ ...image(tag), RootFS: { Type: "layers", Layers: [imageId] } }, "rootfs"],
    [{ ...image(tag), Config: { ...importConfig(), Injected: true } }, "config_keys"],
  ]) {
    assert.throws(() => validateCandidateImage(changed, { imageId, tag, diffId, rawSize: raw.length,
      validateRuntimeConfig, expectedConfig: importConfig() }),
    { code: "seaweed_candidate_ownership_failed", detailCode });
  }
});

function scope({ initialImage = false, existingImageId = false, invalidImageList = false,
  archiveFailure = false, abortAfterOwnership = false,
  wrongInspectedId = false } = {}) {
  const parent = mkdtempSync(path.join(os.tmpdir(), "aw-local-candidate-")); chmodSync(parent, 0o700);
  const runId = "35933797176"; const recipeRevision = "a".repeat(40);
  const abortController = new globalThis.AbortController();
  const config = importConfig(); const tag = `auto-world-seaweed-s3:run-${runId}-attempt-1`;
  const calls = []; let exists = initialImage; let disposed = false; let piped = false; let archiveValidated = false;
  const inputs = { parent, recipeRevision, createdAt: "2026-09-23T23:28:54.052Z", runId,
    signal: abortController.signal };
  const receipt = Object.freeze({ kind: "SEAWEED_ROOTFS_MATERIALIZATION_RECEIPT_V1", state: "MATERIALIZED",
    authority: "PREPARATION_ONLY", candidateAuthorization: "NOT_AUTHORIZED", recipeRevision,
    createdAt: inputs.createdAt, sourceRunId: "35884717093", sourceCodeRevision: "2".repeat(40),
    sourceBinaryDigest: `sha256:${"3".repeat(64)}`, baseManifestDigest: `sha256:${"4".repeat(64)}`,
    rawSize: raw.length, diffId, memberCount: 1 });
  const injected = {
    materializeRootfs: async () => receipt,
    withRootfs: async (candidate, callback) => {
      assert.equal(candidate, receipt);
      return callback({ rawSize: raw.length, diffId, memberCount: 1, importConfig: config,
        validateRuntimeConfig(value) { assert.deepEqual(value, config); },
        validateFilesystem() { throw new Error("archive validator owns this call"); },
        async pipeArchiveTo(writable) { piped = true; writable.end(raw); await finished(writable);
          return { rawSize: raw.length, diffId }; } });
    },
    cleanupRootfs: async (candidate) => { assert.equal(candidate, receipt); disposed = true; return { state: "CLEANED" }; },
    validateArchive: async (options) => {
      archiveValidated = true;
      assert.equal(options.imageId, imageId); assert.equal(options.diffId, diffId);
      assert.equal(options.rawSize, raw.length); assert.equal(options.serverVersion, "28.0.4");
      if (abortAfterOwnership) abortController.abort();
      if (archiveFailure) throw new Error("private archive failure");
      return { kind: "SEAWEED_SAVED_CANDIDATE_PROOF_V1", identityType: "CLASSIC_CONFIG_ID",
        imageId, tag, diffId, rawSize: raw.length, memberCount: 1, serverVersion: "28.0.4",
        archiveSha256: "5".repeat(64), archiveBytes: 4096 };
    },
    docker: async (args, options) => {
      if (options.signal?.aborted) throw new Error("aborted Docker operation");
      calls.push(args);
      if (args[0] === "version") return { status: 0, stdout: "28.0.4|28.0.4\n", stderr: "" };
      if (args[0] === "image" && args[1] === "ls") {
        assert.deepEqual(args, ["image", "ls", "--all", "--no-trunc", "--format", "{{.ID}}"]);
        return { status: 0, stdout: invalidImageList ? "<none>\n" : existingImageId ? `${imageId}\n` : "",
          stderr: "" };
      }
      if (args[0] === "image" && args[1] === "inspect" && args[2] !== "--format") {
        const reference = args[2];
        return exists && reference === tag
          ? { status: 0, stdout: "[]", stderr: "" }
          : { status: 1, stdout: "[]", stderr: `Error response from daemon: No such image: ${reference}\n` };
      }
      if (args[0] === "image" && args[1] === "inspect" && args[2] === "--format") {
        assert.equal(exists, true);
        return { status: 0, stdout: JSON.stringify({ ...image(tag, config), Id: wrongInspectedId ? diffId : imageId }), stderr: "" };
      }
      if (args[0] === "image" && args[1] === "import") {
        assert.equal(args.at(-2), "-"); assert.equal(args.at(-1), tag);
        assert.ok(args.includes(SEAWEED_CANDIDATE_IMPORT_MESSAGE));
        assert.ok(args.includes("--platform"));
        const sink = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
        await options.stdinWriter(sink); exists = true;
        return { status: 0, stdout: `${imageId}\n`, stderr: "" };
      }
      if (args[0] === "image" && args[1] === "save") {
        options.stdoutSink.end(Buffer.alloc(4096)); await finished(options.stdoutSink);
        return { status: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "image" && args[1] === "rm") {
        assert.equal(args[2], tag); exists = false; return { status: 0, stdout: `${imageId}\n`, stderr: "" };
      }
      throw new Error("unexpected docker command");
    },
  };
  return { parent, inputs, injected, calls, tag, get disposed() { return disposed; },
    get piped() { return piped; }, get archiveValidated() { return archiveValidated; } };
}

test("local candidate imports by verified stdin, validates export, removes owned image and all files", { skip: !linux }, async () => {
  const value = scope();
  try {
    const result = await TEST_ONLY_materializeLocalSeaweedCandidate(value.inputs, value.injected);
    assert.equal(result.kind, "SEAWEED_LOCAL_CANDIDATE_RECEIPT_V1");
    assert.equal(result.state, "VERIFIED"); assert.equal(result.candidateAuthorization, "NOT_AUTHORIZED");
    assert.equal(result.imageId, imageId); assert.equal(result.archiveIdentityType, "CLASSIC_CONFIG_ID");
    assert.equal(value.piped, true); assert.equal(value.archiveValidated, true); assert.equal(value.disposed, true);
    assert.deepEqual(readdirSync(value.parent), []);
    assert.equal(value.calls.filter((args) => args[1] === "rm").length, 1);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("a foreign pre-existing tag blocks import and never authorizes image removal", { skip: !linux }, async () => {
  const value = scope({ initialImage: true });
  try {
    await assert.rejects(TEST_ONLY_materializeLocalSeaweedCandidate(value.inputs, value.injected),
      { code: "seaweed_candidate_tag_failed" });
    assert.equal(value.disposed, true); assert.deepEqual(readdirSync(value.parent), []);
    assert.equal(value.calls.some((args) => args[1] === "import" || args[1] === "rm"), false);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("a pre-existing untagged matching image ID never becomes cleanup-owned", { skip: !linux }, async () => {
  const value = scope({ existingImageId: true });
  try {
    await assert.rejects(TEST_ONLY_materializeLocalSeaweedCandidate(value.inputs, value.injected),
      { code: "seaweed_candidate_store_not_empty" });
    assert.equal(value.disposed, true); assert.deepEqual(readdirSync(value.parent), []);
    assert.equal(value.calls.some((args) => args[1] === "import"), false);
    assert.equal(value.calls.some((args) => args[1] === "rm"), false);
    assert.equal(value.calls.some((args) => args[1] === "save"), false);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("an ambiguous Docker image inventory fails before import", { skip: !linux }, async () => {
  const value = scope({ invalidImageList: true });
  try {
    await assert.rejects(TEST_ONLY_materializeLocalSeaweedCandidate(value.inputs, value.injected),
      { code: "seaweed_candidate_store_failed" });
    assert.equal(value.disposed, true); assert.deepEqual(readdirSync(value.parent), []);
    assert.equal(value.calls.some((args) => args[1] === "import" || args[1] === "rm"), false);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("archive verification failure still removes a proven owned image and rootfs", { skip: !linux }, async () => {
  const value = scope({ archiveFailure: true });
  try {
    await assert.rejects(TEST_ONLY_materializeLocalSeaweedCandidate(value.inputs, value.injected),
      { code: "seaweed_candidate_archive_failed" });
    assert.equal(value.disposed, true); assert.deepEqual(readdirSync(value.parent), []);
    assert.equal(value.calls.filter((args) => args[1] === "rm").length, 1);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("caller abort after ownership still removes the proved image", { skip: !linux }, async () => {
  const value = scope({ abortAfterOwnership: true, archiveFailure: true });
  try {
    await assert.rejects(TEST_ONLY_materializeLocalSeaweedCandidate(value.inputs, value.injected),
      { code: "seaweed_candidate_archive_failed" });
    assert.equal(value.disposed, true); assert.deepEqual(readdirSync(value.parent), []);
    assert.equal(value.calls.filter((args) => args[1] === "rm").length, 1);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("ambiguous inspected ID does not authorize removal of an unknown image", { skip: !linux }, async () => {
  const value = scope({ wrongInspectedId: true });
  try {
    await assert.rejects(TEST_ONLY_materializeLocalSeaweedCandidate(value.inputs, value.injected),
      { code: "seaweed_candidate_ownership_failed", detailCode: "id" });
    assert.equal(value.disposed, true); assert.deepEqual(readdirSync(value.parent), []);
    assert.equal(value.calls.some((args) => args[1] === "rm"), false);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});
