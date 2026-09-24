import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { finished } from "node:stream/promises";
import test from "node:test";

import {
  candidateImportChanges, isPublicCandidateFailureCode, TEST_ONLY_materializeLocalSeaweedCandidate,
  TEST_ONLY_materializeAndVerifyLocalSeaweedRuntimeCandidate,
  TEST_ONLY_materializeAndVerifyLocalSeaweedRuntimeBackupRestoreCandidate,
  TEST_ONLY_materializeAndVerifyLocalSeaweedRuntimeHostLoopbackCandidate,
  TEST_ONLY_materializeAndVerifyLocalSeaweedRuntimePersistenceCandidate,
  TEST_ONLY_materializeAndVerifyLocalSeaweedRuntimeStrictContentionCandidate,
  TEST_ONLY_withVerifiedLocalSeaweedCandidate, validateCandidateImage, withVerifiedLocalSeaweedCandidate,
} from "../scripts/seaweed-image/materialize-candidate.mjs";
import { TEST_ONLY_expectedSeaweedRuntimeBackupRestoreProof } from
  "../scripts/seaweed-image/backup-restore.mjs";
import { TEST_ONLY_expectedSeaweedRuntimeHostLoopbackProof } from
  "../scripts/seaweed-image/host-loopback.mjs";
import { SEAWEED_CANDIDATE_IMPORT_MESSAGE } from "../scripts/seaweed-image/candidate-archive.mjs";
import { TEST_ONLY_expectedSeaweedRuntimePersistenceProof,
  TEST_ONLY_expectedSeaweedRuntimeProfileProof,
  TEST_ONLY_expectedSeaweedRuntimeStrictContentionProof } from "../scripts/seaweed-image/candidate-runtime.mjs";

const linux = process.platform === "linux";
const imageId = `sha256:${"b".repeat(64)}`;
const diffId = `sha256:${"c".repeat(64)}`;
const foreignImageId = `sha256:${"d".repeat(64)}`;
const extraImageId = `sha256:${"e".repeat(64)}`;
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
  return { Id: imageId, RepoTags: tag === undefined ? [] : [tag], Os: "linux", Architecture: "amd64", Size: raw.length,
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
  assert.deepEqual(validateCandidateImage({ ...image(undefined), RepoTags: null }, {
    imageId, repoTags: [], diffId, rawSize: raw.length, validateRuntimeConfig,
  }), { imageId, diffId });
});

function scope({ initialImage = false, existingImageId = false, unrelatedPriorImage = false,
  invalidImageList = false, extraImageAfterImport = false, archiveFailure = false,
  abortAfterOwnership = false, wrongInspectedId = false, configMismatch = false,
  foreignTagAfterImport = false, foreignTagBeforeCleanup = false, imageRemoveFailure = false } = {}) {
  const parent = mkdtempSync(path.join(os.tmpdir(), "aw-local-candidate-")); chmodSync(parent, 0o700);
  const runId = "35933797176"; const recipeRevision = "a".repeat(40);
  const abortController = new globalThis.AbortController();
  const config = importConfig(); const tag = `auto-world-seaweed-s3:run-${runId}-attempt-1`;
  const calls = []; const imageIds = new Set();
  if (existingImageId) imageIds.add(imageId);
  if (unrelatedPriorImage) imageIds.add(foreignImageId);
  let tagPresent = initialImage; let imported = false; let disposed = false;
  let piped = false; let archiveValidated = false; let cleanupDrift = false;
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
      if (foreignTagBeforeCleanup) cleanupDrift = true;
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
        return { status: 0, stdout: invalidImageList ? "<none>\n"
          : [...imageIds].map((value) => `${value}\n`).join(""),
          stderr: "" };
      }
      if (args[0] === "image" && args[1] === "inspect" && args[2] !== "--format") {
        const reference = args[2];
        const exists = reference === tag ? tagPresent : imageIds.has(reference);
        return exists
          ? { status: 0, stdout: "[]", stderr: "" }
          : { status: 1, stdout: "[]", stderr: `Error response from daemon: No such image: ${reference}\n` };
      }
      if (args[0] === "image" && args[1] === "inspect" && args[2] === "--format") {
        assert.equal(imageIds.has(imageId), true);
        const reference = args[3];
        const inspectedTag = reference === tag || tagPresent ? tag : undefined;
        const repoTags = cleanupDrift ? [tag, "foreign:latest"]
          : foreignTagAfterImport && imported && !tagPresent ? ["foreign:latest"]
            : inspectedTag === undefined ? [] : [inspectedTag];
        const inspectedConfig = configMismatch ? { ...config, Cmd: ["changed"] } : config;
        return { status: 0, stdout: JSON.stringify({ ...image(undefined, inspectedConfig), RepoTags: repoTags,
          Id: wrongInspectedId ? diffId : imageId }), stderr: "" };
      }
      if (args[0] === "image" && args[1] === "import") {
        assert.equal(args.at(-1), "-"); assert.equal(args.includes(tag), false);
        assert.ok(args.includes(SEAWEED_CANDIDATE_IMPORT_MESSAGE));
        assert.ok(args.includes("--platform"));
        const sink = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
        await options.stdinWriter(sink); imported = true;
        if (!existingImageId) imageIds.add(imageId);
        if (extraImageAfterImport) imageIds.add(extraImageId);
        return { status: 0, stdout: `${imageId}\n`, stderr: "" };
      }
      if (args[0] === "image" && args[1] === "tag") {
        assert.deepEqual(args, ["image", "tag", imageId, tag]); tagPresent = true;
        return { status: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "image" && args[1] === "save") {
        options.stdoutSink.end(Buffer.alloc(4096)); await finished(options.stdoutSink);
        return { status: 0, stdout: "", stderr: "" };
      }
      if (args[0] === "image" && args[1] === "rm") {
        assert.ok(args[2] === tag || args[2] === imageId);
        if (imageRemoveFailure) return { status: 1, stdout: "",
          stderr: "private Docker failure with /runner/private/path\n" };
        tagPresent = false; imageIds.delete(imageId);
        return { status: 0, stdout: `${imageId}\n`, stderr: "" };
      }
      throw new Error("unexpected docker command");
    },
  };
  return { parent, inputs, injected, calls, tag, imageIds, get disposed() { return disposed; },
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

test("verified archive callback runs once after validation and before cleanup with frozen bounded context",
  { skip: !linux }, async () => {
    const value = scope(); let callbackCalls = 0;
    try {
      const result = await TEST_ONLY_withVerifiedLocalSeaweedCandidate(value.inputs, async (context) => {
        callbackCalls += 1;
        assert.equal(value.archiveValidated, true);
        assert.equal(value.imageIds.has(imageId), true);
        assert.deepEqual(Object.keys(context).sort(),
          ["archiveProof", "diffId", "file", "imageId", "recipeRevision", "runId", "signal"].sort());
        assert.equal(Object.isFrozen(context), true);
        assert.equal(Object.isFrozen(context.archiveProof), true);
        assert.equal(context.file, path.join(value.parent, "work", "saved.tar"));
        assert.equal(context.imageId, imageId); assert.equal(context.diffId, diffId);
        assert.equal(context.runId, value.inputs.runId);
        assert.equal(context.recipeRevision, value.inputs.recipeRevision);
        assert.equal(context.signal, value.inputs.signal);
        assert.deepEqual(context.archiveProof, {
          kind: "SEAWEED_SAVED_CANDIDATE_PROOF_V1", identityType: "CLASSIC_CONFIG_ID",
          imageId, tag: value.tag, diffId, rawSize: raw.length, memberCount: 1,
          serverVersion: "28.0.4", archiveSha256: "5".repeat(64), archiveBytes: 4096,
        });
        value.calls.push(["inspection"]);
      }, value.injected);
      assert.equal(callbackCalls, 1);
      assert.equal(result.kind, "SEAWEED_LOCAL_CANDIDATE_RECEIPT_V1");
      assert.ok(value.calls.findIndex((args) => args[0] === "inspection")
        < value.calls.findIndex((args) => args[0] === "image" && args[1] === "rm"));
      assert.deepEqual(readdirSync(value.parent), []);
    } finally { rmSync(value.parent, { recursive: true, force: true }); }
  });

test("verified archive callback preserves the historical receipt", { skip: !linux }, async () => {
  const historical = scope(); const inspected = scope();
  try {
    const historicalReceipt = await TEST_ONLY_materializeLocalSeaweedCandidate(
      historical.inputs, historical.injected);
    const inspectedReceipt = await TEST_ONLY_withVerifiedLocalSeaweedCandidate(
      inspected.inputs, async () => {}, inspected.injected);
    assert.deepEqual(inspectedReceipt, historicalReceipt);
  } finally {
    rmSync(historical.parent, { recursive: true, force: true });
    rmSync(inspected.parent, { recursive: true, force: true });
  }
});

test("verified archive callback failure is bounded and still cleans owned resources", { skip: !linux }, async () => {
  const value = scope(); let callbackCalls = 0;
  try {
    await assert.rejects(TEST_ONLY_withVerifiedLocalSeaweedCandidate(value.inputs, async () => {
      callbackCalls += 1; throw new Error("private callback failure /runner/private/path");
    }, value.injected), (error) => {
      assert.equal(error.code, "seaweed_candidate_inspection_failed");
      assert.equal(JSON.stringify(error).includes("private"), false);
      return true;
    });
    assert.equal(callbackCalls, 1);
    assert.equal(value.calls.filter((args) => args[0] === "image" && args[1] === "rm").length, 1);
    assert.equal(value.disposed, true);
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("archive validation failure never invokes the verified archive callback", { skip: !linux }, async () => {
  const value = scope({ archiveFailure: true }); let callbackCalls = 0;
  try {
    await assert.rejects(TEST_ONLY_withVerifiedLocalSeaweedCandidate(value.inputs,
      async () => { callbackCalls += 1; }, value.injected), { code: "seaweed_candidate_archive_failed" });
    assert.equal(callbackCalls, 0);
    assert.equal(value.calls.filter((args) => args[0] === "image" && args[1] === "rm").length, 1);
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("verified archive callback API rejects non-functions with a public code", async () => {
  for (const callback of [undefined, null, {}, "inspect"]) {
    await assert.rejects(TEST_ONLY_withVerifiedLocalSeaweedCandidate({}, callback, {}),
      { code: "seaweed_candidate_arguments_invalid" });
    await assert.rejects(withVerifiedLocalSeaweedCandidate({}, callback),
      { code: "seaweed_candidate_arguments_invalid" });
  }
  assert.equal(isPublicCandidateFailureCode("seaweed_candidate_inspection_failed"), true);
});

test("unrelated prior image IDs are preserved through import, verification and cleanup", { skip: !linux }, async () => {
  const value = scope({ unrelatedPriorImage: true });
  try {
    const result = await TEST_ONLY_materializeLocalSeaweedCandidate(value.inputs, value.injected);
    assert.equal(result.state, "VERIFIED");
    assert.deepEqual([...value.imageIds], [foreignImageId]);
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
      { code: "seaweed_candidate_ownership_failed", detailCode: "id" });
    assert.equal(value.disposed, true); assert.deepEqual(readdirSync(value.parent), []);
    assert.equal(value.calls.some((args) => args[1] === "import"), true);
    assert.equal(value.calls.some((args) => args[1] === "tag"), false);
    assert.equal(value.calls.some((args) => args[1] === "rm"), false);
    assert.equal(value.calls.some((args) => args[1] === "save"), false);
    assert.deepEqual([...value.imageIds], [imageId]);
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

test("an ambiguous post-import image delta is never tagged or removed", { skip: !linux }, async () => {
  const value = scope({ unrelatedPriorImage: true, extraImageAfterImport: true });
  try {
    await assert.rejects(TEST_ONLY_materializeLocalSeaweedCandidate(value.inputs, value.injected),
      { code: "seaweed_candidate_ownership_failed", detailCode: "id" });
    assert.equal(value.calls.some((args) => args[1] === "tag" || args[1] === "rm"), false);
    assert.deepEqual(new Set(value.imageIds), new Set([foreignImageId, imageId, extraImageId]));
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("a config mismatch removes only the proven new untagged image", { skip: !linux }, async () => {
  const value = scope({ unrelatedPriorImage: true, configMismatch: true });
  try {
    await assert.rejects(TEST_ONLY_materializeLocalSeaweedCandidate(value.inputs, value.injected),
      { code: "seaweed_candidate_ownership_failed", detailCode: "config_Cmd" });
    assert.equal(value.calls.some((args) => args[1] === "tag"), false);
    const removals = value.calls.filter((args) => args[1] === "rm");
    assert.deepEqual(removals, [["image", "rm", imageId]]);
    assert.deepEqual([...value.imageIds], [foreignImageId]);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("a foreign tag on the new ID prevents ownership and removal", { skip: !linux }, async () => {
  const value = scope({ foreignTagAfterImport: true });
  try {
    await assert.rejects(TEST_ONLY_materializeLocalSeaweedCandidate(value.inputs, value.injected),
      { code: "seaweed_candidate_ownership_failed", detailCode: "tags" });
    assert.equal(value.calls.some((args) => args[1] === "tag" || args[1] === "rm"), false);
    assert.deepEqual([...value.imageIds], [imageId]);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("foreign tag drift before cleanup fails closed without image removal", { skip: !linux }, async () => {
  const value = scope({ foreignTagBeforeCleanup: true });
  try {
    await assert.rejects(TEST_ONLY_materializeLocalSeaweedCandidate(value.inputs, value.injected),
      { code: "seaweed_candidate_image_cleanup_failed", detailCode: "tags" });
    assert.equal(value.calls.some((args) => args[1] === "rm"), false);
    assert.deepEqual([...value.imageIds], [imageId]);
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

function injectRuntime(value, outcome = "verified") {
  value.injected.verifyRuntime = async (input) => {
    assert.equal(value.archiveValidated, true);
    assert.equal(value.imageIds.has(imageId), true);
    assert.equal(input.imageId, imageId);
    assert.equal(input.recipeRevision, value.inputs.recipeRevision);
    assert.equal(input.runId, value.inputs.runId);
    assert.equal(input.parent, path.join(value.parent, "work"));
    assert.equal(input.dockerConfig, path.join(value.parent, "work", "docker-config"));
    value.calls.push(["runtime"]);
    if (outcome === "failed") throw new Error("runtime probe failed");
    if (outcome === "diagnosed") {
      throw Object.assign(new Error("private runtime output"), { code: "seaweed_candidate_runtime_failed",
        phase: "RUNTIME_PROBE", reason: "READINESS_UNAVAILABLE", durationMs: 123 });
    }
    if (outcome === "cleanup_failed") {
      throw Object.assign(new Error("private path must not escape"),
        { code: "seaweed_candidate_runtime_cleanup_failed" });
    }
    const proof = TEST_ONLY_expectedSeaweedRuntimeProfileProof({ imageId,
      runId: value.inputs.runId, recipeRevision: value.inputs.recipeRevision });
    return outcome === "tampered" ? { ...proof, derivativeVersion: "unreviewed" } : proof;
  };
}

test("runtime wrapper verifies only after the saved archive and before image cleanup", { skip: !linux }, async () => {
  const value = scope({ unrelatedPriorImage: true });
  injectRuntime(value);
  try {
    const result = await TEST_ONLY_materializeAndVerifyLocalSeaweedRuntimeCandidate(value.inputs, value.injected);
    assert.equal(result.kind, "SEAWEED_LOCAL_RUNTIME_CANDIDATE_RECEIPT_V2");
    assert.equal(result.authority, "DIAGNOSTIC_ONLY");
    assert.equal(result.imageExecution, "VERIFIED_DIAGNOSTIC");
    assert.equal(result.candidateAuthorization, "NOT_AUTHORIZED");
    assert.equal(result.publication, "NOT_ATTEMPTED");
    assert.equal(result.vulnerabilityAudit, "NOT_ATTEMPTED");
    assert.equal(result.admission, "NOT_ATTEMPTED");
    assert.equal(result.runtimeProof.imageId, imageId);
    assert.deepEqual([...value.imageIds], [foreignImageId]);
    assert.ok(value.calls.findIndex((args) => args[0] === "runtime")
      < value.calls.findIndex((args) => args[0] === "image" && args[1] === "rm"));
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("historical candidate wrapper never invokes runtime verification", { skip: !linux }, async () => {
  const value = scope();
  injectRuntime(value);
  try {
    const result = await TEST_ONLY_materializeLocalSeaweedCandidate(value.inputs, value.injected);
    assert.equal(result.imageExecution, "NOT_ATTEMPTED");
    assert.equal(Object.hasOwn(result, "runtimeProof"), false);
    assert.equal(value.calls.some((args) => args[0] === "runtime"), false);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

for (const outcome of ["failed", "diagnosed", "tampered", "cleanup_failed"]) {
  test(`runtime ${outcome} cannot issue a verified receipt and still cleans the owned image`,
    { skip: !linux }, async () => {
      const value = scope();
      injectRuntime(value, outcome);
      try {
        await assert.rejects(TEST_ONLY_materializeAndVerifyLocalSeaweedRuntimeCandidate(value.inputs,
          value.injected), outcome === "diagnosed"
          ? { code: "seaweed_candidate_runtime_failed", phase: "RUNTIME_PROBE",
            reason: "READINESS_UNAVAILABLE", durationMs: 123, imageId }
          : { code: outcome === "cleanup_failed"
            ? "seaweed_candidate_runtime_cleanup_failed" : "seaweed_candidate_runtime_failed" });
        assert.equal(value.calls.filter((args) => args[0] === "runtime").length, 1);
        assert.equal(value.calls.filter((args) => args[0] === "image" && args[1] === "rm").length, 1);
        assert.deepEqual(readdirSync(value.parent), []);
      } finally { rmSync(value.parent, { recursive: true, force: true }); }
    });
}

test("archive failure never reaches runtime verification", { skip: !linux }, async () => {
  const value = scope({ archiveFailure: true });
  injectRuntime(value);
  try {
    await assert.rejects(TEST_ONLY_materializeAndVerifyLocalSeaweedRuntimeCandidate(value.inputs,
      value.injected), { code: "seaweed_candidate_archive_failed" });
    assert.equal(value.calls.some((args) => args[0] === "runtime"), false);
    assert.equal(value.calls.filter((args) => args[0] === "image" && args[1] === "rm").length, 1);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

function injectPersistence(value, outcome = "verified") {
  value.injected.verifyPersistence = async (input) => {
    assert.equal(value.archiveValidated, true);
    assert.equal(value.imageIds.has(imageId), true);
    assert.equal(input.imageId, imageId);
    assert.equal(input.recipeRevision, value.inputs.recipeRevision);
    assert.equal(input.runId, value.inputs.runId);
    assert.equal(input.parent, path.join(value.parent, "work"));
    assert.equal(input.dockerConfig, path.join(value.parent, "work", "docker-config"));
    value.calls.push(["persistence"]);
    if (outcome === "failed") throw new Error("persistence probe failed");
    if (outcome === "cleanup_failed") {
      throw Object.assign(new Error("private volume identity"),
        { code: "seaweed_candidate_runtime_persistence_cleanup_failed",
          phase: "PERSISTENCE_CLEANUP", reason: "CLEANUP_UNCERTAIN", durationMs: 12 });
    }
    const proof = TEST_ONLY_expectedSeaweedRuntimePersistenceProof({ imageId,
      runId: value.inputs.runId, recipeRevision: value.inputs.recipeRevision });
    return outcome === "tampered" ? { ...proof, objectPersistence: "NOT_VERIFIED" } : proof;
  };
}

test("persistence wrapper issues V3 only after archive, runtime and image cleanup", { skip: !linux }, async () => {
  const value = scope({ unrelatedPriorImage: true });
  injectPersistence(value);
  try {
    const result = await TEST_ONLY_materializeAndVerifyLocalSeaweedRuntimePersistenceCandidate(
      value.inputs, value.injected);
    assert.equal(result.kind, "SEAWEED_LOCAL_RUNTIME_CANDIDATE_RECEIPT_V3");
    assert.equal(result.authority, "DIAGNOSTIC_ONLY");
    assert.equal(result.imageExecution, "VERIFIED_DIAGNOSTIC");
    assert.equal(result.candidateAuthorization, "NOT_AUTHORIZED");
    assert.equal(result.publication, "NOT_ATTEMPTED");
    assert.equal(result.vulnerabilityAudit, "NOT_ATTEMPTED");
    assert.equal(result.admission, "NOT_ATTEMPTED");
    assert.equal(result.persistenceProof.imageId, imageId);
    assert.equal(Object.hasOwn(result, "runtimeProof"), false);
    assert.deepEqual([...value.imageIds], [foreignImageId]);
    assert.ok(value.calls.findIndex((args) => args[0] === "persistence")
      < value.calls.findIndex((args) => args[0] === "image" && args[1] === "rm"));
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("strict contention wrapper issues V4 only after both proofs and image cleanup", { skip: !linux }, async () => {
  const value = scope({ unrelatedPriorImage: true });
  value.injected.verifyStrict = async (input) => {
    assert.equal(value.archiveValidated, true);
    assert.equal(value.imageIds.has(imageId), true);
    value.calls.push(["strict"]);
    const expected = { imageId, runId: input.runId, recipeRevision: input.recipeRevision };
    return { runtimeProof: TEST_ONLY_expectedSeaweedRuntimeProfileProof(expected),
      strictContentionProof: TEST_ONLY_expectedSeaweedRuntimeStrictContentionProof(expected, "B") };
  };
  try {
    const result = await TEST_ONLY_materializeAndVerifyLocalSeaweedRuntimeStrictContentionCandidate(
      value.inputs, value.injected);
    assert.equal(result.kind, "SEAWEED_LOCAL_RUNTIME_CANDIDATE_RECEIPT_V4");
    assert.equal(result.strictContentionProof.winner, "B");
    assert.equal(result.runtimeProof.kind, "SEAWEED_LOCAL_RUNTIME_PROOF_V2");
    assert.equal(Object.hasOwn(result, "persistenceProof"), false);
    assert.deepEqual([...value.imageIds], [foreignImageId]);
    assert.ok(value.calls.findIndex((args) => args[0] === "strict")
      < value.calls.findIndex((args) => args[0] === "image" && args[1] === "rm"));
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("backup restore wrapper issues V5 only after proof and image cleanup", { skip: !linux }, async () => {
  const value = scope({ unrelatedPriorImage: true });
  value.injected.verifyBackupRestore = async (input) => {
    assert.equal(value.archiveValidated, true); assert.equal(value.imageIds.has(imageId), true);
    value.calls.push(["backup-restore"]);
    return TEST_ONLY_expectedSeaweedRuntimeBackupRestoreProof({ imageId,
      runId: input.runId, recipeRevision: input.recipeRevision }, "f".repeat(64), 10240);
  };
  try {
    const result = await TEST_ONLY_materializeAndVerifyLocalSeaweedRuntimeBackupRestoreCandidate(
      value.inputs, value.injected);
    assert.equal(result.kind, "SEAWEED_LOCAL_RUNTIME_CANDIDATE_RECEIPT_V5");
    assert.equal(result.backupRestoreProof.archiveBytes, 10240);
    assert.equal(result.authority, "DIAGNOSTIC_ONLY");
    assert.equal(result.publication, "NOT_ATTEMPTED");
    assert.equal(result.vulnerabilityAudit, "NOT_ATTEMPTED");
    assert.equal(result.admission, "NOT_ATTEMPTED");
    assert.equal(Object.hasOwn(result, "runtimeProof"), false);
    assert.deepEqual([...value.imageIds], [foreignImageId]);
    assert.ok(value.calls.findIndex((args) => args[0] === "backup-restore")
      < value.calls.findIndex((args) => args[0] === "image" && args[1] === "rm"));
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("host loopback wrapper issues V6 only after proof and image cleanup", { skip: !linux }, async () => {
  const value = scope({ unrelatedPriorImage: true });
  value.injected.verifyHostLoopback = async (input) => {
    assert.equal(value.archiveValidated, true); assert.equal(value.imageIds.has(imageId), true);
    value.calls.push(["host-loopback"]);
    return TEST_ONLY_expectedSeaweedRuntimeHostLoopbackProof({ imageId,
      runId: input.runId, recipeRevision: input.recipeRevision });
  };
  try {
    const result = await TEST_ONLY_materializeAndVerifyLocalSeaweedRuntimeHostLoopbackCandidate(
      value.inputs, value.injected);
    assert.equal(result.kind, "SEAWEED_LOCAL_RUNTIME_CANDIDATE_RECEIPT_V6");
    assert.equal(result.hostLoopbackProof.hostBinding, "127.0.0.1_EPHEMERAL_TO_8333_TCP");
    assert.equal(result.authority, "DIAGNOSTIC_ONLY");
    assert.equal(result.publication, "NOT_ATTEMPTED");
    assert.equal(result.vulnerabilityAudit, "NOT_ATTEMPTED");
    assert.equal(result.admission, "NOT_ATTEMPTED");
    assert.equal(Object.hasOwn(result, "backupRestoreProof"), false);
    assert.deepEqual([...value.imageIds], [foreignImageId]);
    assert.ok(value.calls.findIndex((args) => args[0] === "host-loopback")
      < value.calls.findIndex((args) => args[0] === "image" && args[1] === "rm"));
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("host loopback and image cleanup failures stay separate and bounded", { skip: !linux }, async () => {
  const value = scope({ imageRemoveFailure: true });
  value.injected.verifyHostLoopback = async () => {
    value.calls.push(["host-loopback"]);
    throw Object.assign(new Error("secret 127.0.0.1:49153 /runner/private/path"), {
      code: "seaweed_candidate_runtime_host_loopback_failed",
      phase: "HOST_LOOPBACK_HTTP", reason: "ANONYMOUS_ALLOWED", durationMs: 42,
      runtimeCleanupFailure: { code: "seaweed_candidate_runtime_host_loopback_cleanup_failed",
        phase: "HOST_LOOPBACK_CLEANUP", reason: "CLEANUP_UNCERTAIN" },
    });
  };
  try {
    await assert.rejects(TEST_ONLY_materializeAndVerifyLocalSeaweedRuntimeHostLoopbackCandidate(
      value.inputs, value.injected), (error) => {
      assert.deepEqual({ code: error.code, phase: error.phase, reason: error.reason,
        durationMs: error.durationMs, imageId: error.imageId,
        runtimeCleanupFailure: error.runtimeCleanupFailure,
        secondaryFailure: error.secondaryFailure }, {
        code: "seaweed_candidate_runtime_failed", phase: "HOST_LOOPBACK_HTTP",
        reason: "ANONYMOUS_ALLOWED", durationMs: 42, imageId,
        runtimeCleanupFailure: { code: "seaweed_candidate_runtime_host_loopback_cleanup_failed",
          phase: "HOST_LOOPBACK_CLEANUP", reason: "CLEANUP_UNCERTAIN" },
        secondaryFailure: { code: "seaweed_candidate_image_cleanup_failed",
          phase: "CANDIDATE_IMAGE_CLEANUP", reason: "IMAGE_REMOVE_FAILED" },
      });
      assert.equal(JSON.stringify(error).includes("private"), false);
      assert.equal(JSON.stringify(error).includes("49153"), false);
      return true;
    });
    assert.equal(value.calls.filter((args) => args[0] === "host-loopback").length, 1);
    assert.equal(value.calls.filter((args) => args[0] === "image" && args[1] === "rm").length, 1);
    assert.equal(value.imageIds.has(imageId), true);
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("backup and both cleanup failures remain separate and bounded", { skip: !linux }, async () => {
  const value = scope({ imageRemoveFailure: true });
  value.injected.verifyBackupRestore = async () => {
    value.calls.push(["backup-restore"]);
    throw Object.assign(new Error("private backup cleanup /runner/private/path"), {
      code: "seaweed_candidate_runtime_backup_restore_failed",
      phase: "BACKUP_RESTORED_SERVICE", reason: "RESTORED_OBJECT_MISSING", durationMs: 87,
      runtimeCleanupFailure: { code: "seaweed_candidate_runtime_backup_restore_cleanup_failed",
        phase: "BACKUP_RESTORE_CLEANUP", reason: "CLEANUP_UNCERTAIN" },
    });
  };
  try {
    await assert.rejects(TEST_ONLY_materializeAndVerifyLocalSeaweedRuntimeBackupRestoreCandidate(
      value.inputs, value.injected), (error) => {
      assert.deepEqual({ code: error.code, phase: error.phase, reason: error.reason,
        durationMs: error.durationMs, imageId: error.imageId,
        runtimeCleanupFailure: error.runtimeCleanupFailure,
        secondaryFailure: error.secondaryFailure }, {
        code: "seaweed_candidate_runtime_failed", phase: "BACKUP_RESTORED_SERVICE",
        reason: "RESTORED_OBJECT_MISSING", durationMs: 87, imageId,
        runtimeCleanupFailure: { code: "seaweed_candidate_runtime_backup_restore_cleanup_failed",
          phase: "BACKUP_RESTORE_CLEANUP", reason: "CLEANUP_UNCERTAIN" },
        secondaryFailure: { code: "seaweed_candidate_image_cleanup_failed",
          phase: "CANDIDATE_IMAGE_CLEANUP", reason: "IMAGE_REMOVE_FAILED" },
      });
      assert.equal(JSON.stringify(error).includes("private"), false);
      return true;
    });
    assert.equal(value.calls.filter((args) => args[0] === "backup-restore").length, 1);
    assert.equal(value.calls.filter((args) => args[0] === "image" && args[1] === "rm").length, 1);
    assert.equal(value.imageIds.has(imageId), true);
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

test("verified backup proof cannot issue V5 when owned image removal fails", { skip: !linux }, async () => {
  const value = scope({ imageRemoveFailure: true });
  value.injected.verifyBackupRestore = async (input) => TEST_ONLY_expectedSeaweedRuntimeBackupRestoreProof({
    imageId, runId: input.runId, recipeRevision: input.recipeRevision }, "f".repeat(64), 10240);
  try {
    await assert.rejects(TEST_ONLY_materializeAndVerifyLocalSeaweedRuntimeBackupRestoreCandidate(
      value.inputs, value.injected), { code: "seaweed_candidate_image_cleanup_failed",
      phase: "CANDIDATE_IMAGE_CLEANUP", reason: "IMAGE_REMOVE_FAILED", imageId });
    assert.equal(value.calls.filter((args) => args[0] === "image" && args[1] === "rm").length, 1);
    assert.equal(value.imageIds.has(imageId), true);
    assert.deepEqual(readdirSync(value.parent), []);
  } finally { rmSync(value.parent, { recursive: true, force: true }); }
});

for (const outcome of ["failed", "runtime_tampered", "strict_tampered", "cleanup_failed"]) {
  test(`strict contention ${outcome} cannot issue V4 and still cleans the image`,
    { skip: !linux }, async () => {
      const value = scope();
      value.injected.verifyStrict = async (input) => {
        value.calls.push(["strict"]);
        if (outcome === "failed") throw new Error("private strict failure");
        if (outcome === "cleanup_failed") throw Object.assign(new Error("private cleanup"),
          { code: "seaweed_candidate_runtime_cleanup_failed", phase: "RUNTIME_CLEANUP",
            reason: "OWNERSHIP_UNCERTAIN", durationMs: 12 });
        const expected = { imageId, runId: input.runId, recipeRevision: input.recipeRevision };
        const runtimeProof = TEST_ONLY_expectedSeaweedRuntimeProfileProof(expected);
        const strictContentionProof = TEST_ONLY_expectedSeaweedRuntimeStrictContentionProof(expected);
        return { runtimeProof: outcome === "runtime_tampered" ? { ...runtimeProof, uid: 0 } : runtimeProof,
          strictContentionProof: outcome === "strict_tampered"
            ? { ...strictContentionProof, winnerReadback: "UNVERIFIED" } : strictContentionProof };
      };
      try {
        await assert.rejects(TEST_ONLY_materializeAndVerifyLocalSeaweedRuntimeStrictContentionCandidate(
          value.inputs, value.injected), { code: outcome === "cleanup_failed"
          ? "seaweed_candidate_runtime_cleanup_failed" : "seaweed_candidate_runtime_failed" });
        assert.equal(value.calls.filter((args) => args[0] === "strict").length, 1);
        assert.equal(value.calls.filter((args) => args[0] === "image" && args[1] === "rm").length, 1);
        assert.deepEqual(readdirSync(value.parent), []);
      } finally { rmSync(value.parent, { recursive: true, force: true }); }
    });
}

for (const outcome of ["failed", "tampered", "cleanup_failed"]) {
  test(`persistence ${outcome} cannot issue a receipt and still cleans the image`,
    { skip: !linux }, async () => {
      const value = scope();
      injectPersistence(value, outcome);
      try {
        await assert.rejects(TEST_ONLY_materializeAndVerifyLocalSeaweedRuntimePersistenceCandidate(
          value.inputs, value.injected), outcome === "cleanup_failed"
          ? { code: "seaweed_candidate_runtime_cleanup_failed", phase: "PERSISTENCE_CLEANUP",
            reason: "CLEANUP_UNCERTAIN", durationMs: 12 }
          : { code: "seaweed_candidate_runtime_failed" });
        assert.equal(value.calls.filter((args) => args[0] === "persistence").length, 1);
        assert.equal(value.calls.filter((args) => args[0] === "image" && args[1] === "rm").length, 1);
        assert.deepEqual(readdirSync(value.parent), []);
      } finally { rmSync(value.parent, { recursive: true, force: true }); }
    });
}
