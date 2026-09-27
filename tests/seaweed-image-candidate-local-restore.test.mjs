import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, fstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync,
  renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  publicLocalRestoreFailure, restoreLocalSeaweedCandidate, validateLocalSeaweedRestoreReceipt,
} from "../scripts/seaweed-image/candidate-local-restore.mjs";
import {
  TEST_ONLY_expectedSeaweedRuntimePersistenceProof, TEST_ONLY_expectedSeaweedRuntimeProfileProof,
  TEST_ONLY_expectedSeaweedRuntimeStrictContentionProof,
} from "../scripts/seaweed-image/candidate-runtime.mjs";
import { TEST_ONLY_expectedSeaweedRuntimeBackupRestoreProof } from
  "../scripts/seaweed-image/backup-restore.mjs";
import { TEST_ONLY_expectedSeaweedRuntimeHostLoopbackProof } from
  "../scripts/seaweed-image/host-loopback.mjs";

const root = path.resolve(import.meta.dirname, "..");
const policy = JSON.parse(readFileSync(path.join(root, "infra/seaweed-image/candidate-remote.json"), "utf8"));
const runtimePolicy = JSON.parse(readFileSync(
  path.join(root, "infra/seaweed-image/candidate-remote-runtime.json"), "utf8"));
const priorRuntime = JSON.parse(readFileSync(
  path.join(root, "infra/seaweed-image/candidate-remote-runtime-receipt.json"), "utf8"));
const runId = "40000000041";
const recipeRevision = "a".repeat(40);
const archiveBytes = 1024;
const archiveSha256 = createHash("sha256").update(Buffer.alloc(archiveBytes, 7)).digest("hex");
const archiveTag = priorRuntime.material.alias;
const baseline = { Entrypoint: ["/entrypoint.sh"], Cmd: ["server"], Env: ["PATH=/usr/bin"],
  WorkingDir: "", Volumes: null, ExposedPorts: { "8333/tcp": {} } };

function fixture() {
  const temp = mkdtempSync(path.join(os.tmpdir(), "aw-local-restore-"));
  const parent = path.join(temp, "parent");
  const archiveFile = path.join(temp, "candidate.tar");
  mkdirSync(parent); writeFileSync(archiveFile, Buffer.alloc(archiveBytes, 7));
  if (process.platform === "linux") { chmodSync(parent, 0o700); chmodSync(archiveFile, 0o600); }
  return { temp, parent, archiveFile };
}

function input(paths) {
  return { parent: paths.parent, archiveFile: paths.archiveFile, archiveSha256, archiveBytes,
    archiveTag, policy, baseline, auditEvidence: { runtimePolicy, receiptBytes: Buffer.from("receipt"),
      vulnerabilityBytes: Buffer.from("vulnerability"), cyclonedxBytes: Buffer.from("cyclonedx"),
      databaseEvidenceBytes: Buffer.from("database"), databaseManifestBytes: {} }, runtimeReceipt: priorRuntime,
    runId, recipeRevision, signal: undefined };
}

function archiveProof(value = {}) {
  return { kind: "SEAWEED_SAVED_CANDIDATE_PROOF_V1", authority: "PREPARATION_ONLY",
    candidateAuthorization: "NOT_AUTHORIZED", imageId: policy.candidate.imageId,
    identityType: "CLASSIC_CONFIG_ID", tag: archiveTag, serverVersion: "28.0.4",
    archiveSha256, archiveBytes, archiveMembers: 7, configSha256: policy.source.configSha256,
    configBytes: policy.source.configBytes, layerSha256: policy.source.savedLayerSha256,
    layerBytes: policy.source.savedLayerBytes, diffId: policy.candidate.diffId,
    rawSize: policy.candidate.rawSize, memberCount: policy.candidate.memberCount, ...value };
}

function expected() { return { imageId: policy.candidate.imageId, runId, recipeRevision }; }
function suite() {
  return { basic: TEST_ONLY_expectedSeaweedRuntimeProfileProof(expected()),
    persistence: TEST_ONLY_expectedSeaweedRuntimePersistenceProof(expected()),
    strict: { runtimeProof: TEST_ONLY_expectedSeaweedRuntimeProfileProof(expected()),
      strictContentionProof: TEST_ONLY_expectedSeaweedRuntimeStrictContentionProof(expected()) },
    backup: TEST_ONLY_expectedSeaweedRuntimeBackupRestoreProof(expected()),
    hostLoopback: TEST_ONLY_expectedSeaweedRuntimeHostLoopbackProof(expected()) };
}

function dependencies(paths, order = [], behavior = {}) {
  let loaded = false; let archiveCalls = 0; let inspectCalls = 0; const proofs = suite();
  const inspect = { Id: policy.candidate.imageId, RepoTags: [archiveTag], RepoDigests: [], Os: "linux",
    Architecture: "amd64", Size: policy.candidate.rawSize,
    RootFS: { Type: "layers", Layers: [policy.candidate.diffId] }, Config: { User: "", ...baseline } };
  return { platform: "linux", uid: 1000, privateStorageValidator: () => true,
    openedArchiveValidator: (handle) => fstatSync(handle, { bigint: true }),
    validateAuditEvidence: (value) => { order.push("audit");
      if (behavior.auditFailure) throw new Error("seaweed_remote_runtime_audit_invalid");
      assert.deepEqual(value.candidatePolicy, policy); return { runtimePolicy }; },
    validateRuntimeReceipt: (receipt, candidatePolicy, binding) => { order.push("prior-runtime");
      assert.equal(receipt, priorRuntime); assert.deepEqual(candidatePolicy, policy);
      assert.equal(binding.runId, runtimePolicy.audit.runId); return receipt; },
    validateArchive: async () => { archiveCalls += 1; order.push(`archive-${archiveCalls}`);
      if (archiveCalls === 1 && behavior.swapArchive) {
        renameSync(paths.archiveFile, `${paths.archiveFile}.original`);
        writeFileSync(paths.archiveFile, Buffer.alloc(archiveBytes, 8));
      }
      return archiveCalls === 2 && behavior.changedArchive ? archiveProof({ archiveSha256: "c".repeat(64) })
        : archiveProof(); },
    docker: async (args, options) => {
      order.push(`docker:${args.join(" ")}`);
      if (args[0] === "version") return success(`${behavior.version ?? "28.0.4|28.0.4"}\n`);
      if (args[0] === "info") return success(`${JSON.stringify(behavior.info ?? { OSType: "linux",
        Architecture: "x86_64", Driver: "overlay2",
        DriverStatus: [["Backing Filesystem", "extfs"]] })}\n`);
      if (args[0] === "image" && args[1] === "load") {
        assert.equal(Number.isSafeInteger(options.inputFd), true);
        const comparison = openSync(paths.archiveFile, "r");
        try { assert.equal(fstatSync(options.inputFd).ino, fstatSync(comparison).ino); }
        finally { closeSync(comparison); }
        const byte = Buffer.alloc(1); assert.equal(readSync(options.inputFd, byte, 0, 1, null), 1);
        loaded = true;
        return behavior.loadFailure ? { status: 1, stdout: "", stderr: "load failed" }
          : success(`Loaded image: ${archiveTag}\n`);
      }
      if (args[0] === "image" && args[1] === "inspect") {
        inspectCalls += 1;
        if (behavior.malformedInspect) return success("{}\n");
        return success(`${JSON.stringify(behavior.foreignInspect && inspectCalls > 1
          ? { ...inspect, Id: `sha256:${"f".repeat(64)}` }
          : inspect)}\n`);
      }
      if (args[0] === "image" && args[1] === "rm") { loaded = false; return success(`${policy.candidate.imageId}\n`); }
      if (args[0] === "image" && args[1] === "ls") return success(loaded || behavior.initialImage
        ? `${behavior.initialImage ?? policy.candidate.imageId}\n` : "");
      if (args[0] === "container" && args[1] === "ls") return success(behavior.initialContainer
        ? `${behavior.initialContainer}\n` : "");
      if (args[0] === "volume" && args[1] === "ls") return success(behavior.initialVolume
        ? `${behavior.initialVolume}\n` : "");
      return success("");
    },
    verifyRuntime: async () => { order.push("basic"); return proofs.basic; },
    verifyPersistence: async () => { order.push("persistence"); return proofs.persistence; },
    verifyStrict: async () => { order.push("strict"); return proofs.strict; },
    verifyBackup: async () => { order.push("backup"); return proofs.backup; },
    verifyHostLoopback: async () => { order.push("host-loopback"); return proofs.hostLoopback; } };
}

function success(stdout) { return { status: 0, stdout, stderr: "" }; }

test("offline restore validates evidence and the same open archive before load, runs five profiles, then cleans", async (t) => {
  const paths = fixture(); t.after(() => rmSync(paths.temp, { recursive: true, force: true }));
  const order = []; const receipt = await restoreLocalSeaweedCandidate(input(paths), dependencies(paths, order));
  assert.equal(receipt.origin, "LOCAL_DIAGNOSTIC");
  assert.equal(receipt.executionId, `local-${runId}`); assert.equal(receipt.githubRunId, null);
  assert.equal(receipt.registryAccess, "NOT_ATTEMPTED"); assert.equal(receipt.registryFallback, "DISABLED");
  const receiptExpected = { imageId: policy.candidate.imageId,
    archiveSha256, archiveBytes, runId, recipeRevision, subject: policy.subject,
    auditBinding: receipt.priorEvidence.auditBinding,
    priorRuntimeRunId: priorRuntime.runId,
    priorRuntimeRecipeRevision: priorRuntime.recipeRevision };
  assert.deepEqual(validateLocalSeaweedRestoreReceipt(receipt, receiptExpected), receipt);
  assert.throws(() => validateLocalSeaweedRestoreReceipt({ ...receipt, priorEvidence: {
    ...receipt.priorEvidence, priorRuntimeRunId: "40000000099" } }, receiptExpected),
  /seaweed_local_restore_receipt_invalid/u);
  assert.deepEqual(receipt.phases.map(({ name, result }) => ({ name, result })), [
    "prior_evidence", "private_storage", "archive_validation_before_load", "engine_preflight",
    "archive_load", "archive_validation_after_load", "runtime_basic", "runtime_persistence",
    "runtime_strict", "runtime_backup", "runtime_host_loopback", "runtime_inventory",
    "owned_cleanup", "temporary_cleanup"].map((name) => ({ name, result: "PASSED" })));
  assert.deepEqual(order.slice(0, 4), ["audit", "prior-runtime", "archive-1",
    "docker:version --format {{.Client.Version}}|{{.Server.Version}}"]) ;
  assert.ok(order.indexOf("archive-2") < order.indexOf("basic"));
  assert.deepEqual(order.filter((value) => ["basic", "persistence", "strict", "backup", "host-loopback"]
    .includes(value)), ["basic", "persistence", "strict", "backup", "host-loopback"]);
  assert.ok(order.includes(`docker:image rm ${archiveTag}`));
});

test("invalid retained audit evidence fails before every Docker command", async (t) => {
  const paths = fixture(); t.after(() => rmSync(paths.temp, { recursive: true, force: true }));
  const order = [];
  await assert.rejects(restoreLocalSeaweedCandidate(input(paths), dependencies(paths, order,
    { auditFailure: true })), /seaweed_remote_runtime_audit_invalid/u);
  assert.deepEqual(order, ["audit"]);
});

test("a changed archive after load blocks runtime and removes only the loaded image", async (t) => {
  const paths = fixture(); t.after(() => rmSync(paths.temp, { recursive: true, force: true }));
  const order = [];
  await assert.rejects(restoreLocalSeaweedCandidate(input(paths), dependencies(paths, order,
    { changedArchive: true })), (error) => {
    assert.equal(error.code, "seaweed_local_restore_failed");
    assert.equal(error.primaryFailure, "seaweed_local_restore_archive_invalid");
    assert.equal(error.cleanupFailure, null); return true;
  });
  assert.equal(order.includes("basic"), false);
  assert.ok(order.includes(`docker:image rm ${archiveTag}`));
});

test("cleanup refuses to remove an image whose loaded identity no longer matches", async (t) => {
  const paths = fixture(); t.after(() => rmSync(paths.temp, { recursive: true, force: true }));
  const order = [];
  await assert.rejects(restoreLocalSeaweedCandidate(input(paths), dependencies(paths, order,
    { changedArchive: true, foreignInspect: true })), (error) => {
    assert.equal(error.code, "seaweed_local_restore_failed");
    assert.equal(error.cleanupFailure, "seaweed_local_restore_cleanup_failed"); return true;
  });
  assert.equal(order.some((value) => value.startsWith("docker:image rm ")), false);
});

test("an uninspectable exact loaded image reports cleanup uncertainty without deletion", async (t) => {
  const paths = fixture(); t.after(() => rmSync(paths.temp, { recursive: true, force: true }));
  const order = [];
  await assert.rejects(restoreLocalSeaweedCandidate(input(paths), dependencies(paths, order,
    { malformedInspect: true })), (error) => {
    assert.equal(error.primaryFailure, "seaweed_local_restore_image_invalid");
    assert.equal(error.cleanupFailure, "seaweed_local_restore_cleanup_failed"); return true;
  });
  assert.equal(order.some((value) => value.startsWith("docker:image rm ")), false);
});

test("archive path substitution after validation is rejected before Docker", async (t) => {
  const paths = fixture(); t.after(() => rmSync(paths.temp, { recursive: true, force: true }));
  const order = [];
  await assert.rejects(restoreLocalSeaweedCandidate(input(paths), dependencies(paths, order,
    { swapArchive: true })), (error) => error.primaryFailure === "seaweed_local_restore_archive_changed");
  assert.equal(order.some((value) => value.startsWith("docker:")), false);
});

test("public failure keeps only fixed local and runtime diagnostics", () => {
  const wrapped = Object.assign(new Error("private /tmp/path"), { code: "seaweed_local_restore_failed",
    phase: "RUNTIME_BASIC", primaryFailure: "seaweed_candidate_runtime_failed",
    cleanupFailure: null, diagnosticFailure: { code: "seaweed_candidate_runtime_failed",
      phase: "RUNTIME_PROBE", reason: "READBACK_MISMATCH" }, secret: "token" });
  const value = publicLocalRestoreFailure(wrapped);
  assert.deepEqual(value.diagnosticFailure, { code: "seaweed_candidate_runtime_failed",
    phase: "RUNTIME_PROBE", reason: "READBACK_MISMATCH" });
  assert.equal(value.phase, "RUNTIME_BASIC");
  assert.equal(JSON.stringify(value).includes("private"), false);
  assert.equal(publicLocalRestoreFailure(new Error("secret path")).code,
    "seaweed_local_restore_runtime_invalid");
  const forged = publicLocalRestoreFailure(Object.assign(new Error("outer"), {
    code: "seaweed_local_restore_failed", phase: "RUNTIME_BASIC", primaryFailure: "secret /tmp/path",
    cleanupFailure: null, diagnosticFailure: { code: "secret", phase: "private", reason: "token" } }));
  assert.equal(forged.primaryFailure, "seaweed_local_restore_runtime_invalid");
  assert.equal(forged.diagnosticFailure, null);
  assert.equal(JSON.stringify(forged).includes("secret"), false);
});

test("foreign global engine resources reject before load without deletion", async (t) => {
  for (const behavior of [{ initialImage: `sha256:${"e".repeat(64)}` },
    { initialContainer: "1".repeat(64) }, { initialVolume: "foreign-volume" }]) {
    const paths = fixture(); t.after(() => rmSync(paths.temp, { recursive: true, force: true }));
    const order = [];
    await assert.rejects(restoreLocalSeaweedCandidate(input(paths), dependencies(paths, order, behavior)),
      (error) => error.primaryFailure === "seaweed_local_restore_engine_not_empty");
    assert.equal(order.includes("basic"), false);
    assert.equal(order.some((value) => value === "docker:image load"), false);
    assert.equal(order.some((value) => value.startsWith("docker:image rm ")), false);
  }
});

test("failed load with the exact created image is cleaned and never executed", async (t) => {
  const paths = fixture(); t.after(() => rmSync(paths.temp, { recursive: true, force: true }));
  const order = [];
  await assert.rejects(restoreLocalSeaweedCandidate(input(paths), dependencies(paths, order,
    { loadFailure: true })), (error) => {
    assert.equal(error.primaryFailure, "seaweed_local_restore_docker_command_failed"); return true;
  });
  assert.equal(order.includes("basic"), false);
  assert.ok(order.includes(`docker:image rm ${archiveTag}`));
});

test("wrong Docker version and containerd image store reject before archive load", async (t) => {
  for (const behavior of [{ version: "28.0.4|29.0.0" }, { info: { OSType: "linux",
    Architecture: "x86_64", Driver: "overlay2",
    DriverStatus: [["driver-type", "io.containerd.snapshotter.v1"]] } }]) {
    const paths = fixture(); t.after(() => rmSync(paths.temp, { recursive: true, force: true }));
    const order = [];
    await assert.rejects(restoreLocalSeaweedCandidate(input(paths), dependencies(paths, order, behavior)),
      (error) => error.primaryFailure === "seaweed_local_restore_engine_invalid");
    assert.equal(order.some((value) => value === "docker:image load"), false);
  }
});

test("root-owned ext4 private paths pass the production storage validator", {
  skip: process.platform !== "linux" || process.getuid?.() !== 0,
}, async (t) => {
  const paths = fixture(); t.after(() => rmSync(paths.temp, { recursive: true, force: true }));
  const deps = dependencies(paths); delete deps.privateStorageValidator; deps.uid = 0;
  delete deps.openedArchiveValidator;
  const receipt = await restoreLocalSeaweedCandidate(input(paths), deps);
  assert.equal(receipt.state, "VERIFIED");
});
