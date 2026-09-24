import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

import { TEST_ONLY_expectedSeaweedRuntimeBackupRestoreProof,
  TEST_ONLY_seaweedBackupRestoreScripts, TEST_ONLY_verifyLocalSeaweedRuntimeBackupRestore,
  validateSeaweedRuntimeBackupRestoreProof } from
  "../scripts/seaweed-image/backup-restore.mjs";

const imageId = `sha256:${"a".repeat(64)}`;
const runId = "35999999999";
const recipeRevision = "b".repeat(40);
const parent = path.resolve("aw-backup-test");
const dockerConfig = path.resolve("aw-backup-test/docker-config");
const archiveSha256 = "c".repeat(64);
const archiveBytes = 10240;

function fixture({ preexistingVolume = false, restoredStatus = 0, foreignRestoreVolumeDuringCleanup = false,
  malformedBackupCreate = false, abortAtBackup = false, nullPortBindings = false,
  driftHelperTmpfs = false, backupHelperExitCode = 0, restoreHelperExitCode = 0,
  sourceStopExitCode = 0, privilegedHelper = false, restartedHelper = false,
  explicitRwReadOnly = false, missingRoReadOnly = false, wrongRwReadOnly = false } = {}) {
  const calls = []; const volumes = new Map(); const containers = new Map(); let nonce = ""; let nextId = 1;
  let restoredProbeFailed = false;
  const prefix = `aw-seaweed-backup-${runId}`;
  const controller = new globalThis.AbortController();
  if (preexistingVolume) volumes.set(`${prefix}-source`, {
    role: "foreign", nonce: "f".repeat(48), createdAt: new Date().toISOString(),
  });

  function mountFrom(value) {
    const parts = value.split(",");
    const fields = Object.fromEntries(parts.filter((part) => part.includes("=")).map((part) => part.split("=")));
    return { name: fields.src, destination: fields.dst, readOnly: parts.includes("readonly") };
  }

  function containerJson(record) {
    const helper = record.role.endsWith("helper"); const init = record.role.startsWith("init-");
    const service = record.role.startsWith("service-");
    const memory = service ? 768 * 1024 ** 2 : helper ? 256 * 1024 ** 2 : 128 * 1024 ** 2;
    const tmpfs = service ? {
      "/tmp": "rw,nosuid,nodev,noexec,size=16m,mode=0700,uid=1000,gid=1000",
      "/run/aw-private": "rw,nosuid,nodev,noexec,size=64k,mode=0700,uid=1000,gid=1000",
    } : helper ? {
      "/tmp": "rw,nosuid,nodev,noexec,size=8m,mode=0700",
      "/data": "rw,nosuid,nodev,noexec,size=4m,mode=0700,uid=1000,gid=1000",
    } : { "/tmp": "rw,nosuid,nodev,noexec,size=4m,mode=0700" };
    if (driftHelperTmpfs && helper) delete tmpfs["/data"];
    return [{ Id: record.id, Image: imageId, State: { Status: record.state, ExitCode: record.exitCode },
      Config: { User: init ? "0:0" : "1000:1000", Labels: {
        "com.auto-world.runtime-nonce": record.nonce,
        "com.auto-world.runtime-purpose": "backup-restore-v1",
        "com.auto-world.runtime-role": record.role,
      } },
      HostConfig: { NetworkMode: "none", ReadonlyRootfs: true,
        Privileged: helper && privilegedHelper, AutoRemove: false,
        RestartPolicy: { Name: helper && restartedHelper ? "always" : "no", MaximumRetryCount: 0 },
        PortBindings: nullPortBindings ? null : {}, PublishAllPorts: false,
        SecurityOpt: ["no-new-privileges=true"], CapDrop: ["ALL"], CapAdd: init ? ["CAP_CHOWN"] : null,
        Memory: memory, MemorySwap: memory, NanoCpus: service ? 750_000_000 : 250_000_000,
        PidsLimit: service ? 512 : 64, Tmpfs: tmpfs,
        Mounts: record.mounts.map((mount) => ({ Type: "volume", Source: mount.name,
          Target: mount.destination,
          ...(mount.readOnly ? missingRoReadOnly ? {} : { ReadOnly: true }
            : wrongRwReadOnly ? { ReadOnly: true }
              : explicitRwReadOnly ? { ReadOnly: false } : {}),
          VolumeOptions: { NoCopy: true } })) },
      Mounts: record.mounts.map((mount) => ({ Type: "volume", Name: mount.name,
        Destination: mount.destination, RW: !mount.readOnly })),
      NetworkSettings: { Ports: { "8333/tcp": null } } }];
  }

  const docker = async (args, options) => {
    calls.push(args);
    assert.equal(options.cwd, parent); assert.equal(options.env.DOCKER_CONFIG, dockerConfig);
    if (args[0] === "volume" && args[1] === "inspect") {
      const record = volumes.get(args[2]);
      if (record === undefined) return { status: 1, stdout: "[]\n", stderr: "not found\n" };
      const observedNonce = foreignRestoreVolumeDuringCleanup && restoredProbeFailed && record.role === "restore"
        ? "e".repeat(48) : record.nonce;
      return { status: 0, stdout: JSON.stringify([{ Name: args[2], Driver: "local", Scope: "local",
        CreatedAt: record.createdAt, Labels: {
          "com.auto-world.runtime-nonce": observedNonce,
          "com.auto-world.runtime-purpose": "backup-restore-v1",
          "com.auto-world.runtime-role": record.role,
        } }]), stderr: "" };
    }
    if (args[0] === "volume" && args[1] === "ls") {
      const name = args[args.indexOf("--filter") + 1].slice("name=^".length, -1);
      return { status: 0, stdout: volumes.has(name) ? `${name}\n` : "", stderr: "" };
    }
    if (args[0] === "volume" && args[1] === "create") {
      const name = args.at(-1); const role = name.slice(`${prefix}-`.length);
      const labels = args.filter((value, index) => args[index - 1] === "--label");
      nonce = labels.find((value) => value.startsWith("com.auto-world.runtime-nonce="))?.split("=")[1];
      assert.match(nonce, /^[0-9a-f]{48}$/u);
      assert.ok(labels.includes(`com.auto-world.runtime-role=${role}`));
      volumes.set(name, { role, nonce, createdAt: new Date().toISOString() });
      return { status: 0, stdout: `${name}\n`, stderr: "" };
    }
    if (args[0] === "volume" && args[1] === "rm") {
      volumes.delete(args[2]); return { status: 0, stdout: `${args[2]}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "inspect") {
      const record = containers.get(args[2]);
      return record === undefined ? { status: 1, stdout: "[]\n", stderr: "not found\n" }
        : { status: 0, stdout: JSON.stringify(containerJson(record)), stderr: "" };
    }
    if (args[0] === "container" && args[1] === "ls") {
      const match = args[args.indexOf("--filter") + 1].match(/name=\^\/(.+)\$$/u);
      const record = containers.get(match?.[1]);
      return { status: 0, stdout: record === undefined ? "" : `${record.id}|${match[1]}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "create") {
      const name = args[args.indexOf("--name") + 1]; const role = name.slice(`${prefix}-`.length);
      const labels = args.filter((value, index) => args[index - 1] === "--label");
      const actualNonce = labels.find((value) => value.startsWith("com.auto-world.runtime-nonce="))?.split("=")[1];
      const mounts = args.filter((value, index) => args[index - 1] === "--mount").map(mountFrom);
      assert.ok(args.includes("--network=none")); assert.ok(args.includes("--read-only"));
      assert.ok(args.includes("--cap-drop=ALL")); assert.ok(args.includes("--security-opt=no-new-privileges=true"));
      assert.equal(args.includes("--publish"), false); assert.equal(args.includes("--privileged"), false);
      for (const mount of mounts) assert.ok(args.includes(`type=volume,src=${mount.name},dst=${mount.destination},${mount.readOnly ? "readonly," : ""}volume-nocopy`));
      const id = String(nextId++ % 10).repeat(64);
      containers.set(name, { id, role, nonce: actualNonce, mounts, state: "created", exitCode: 0 });
      if (abortAtBackup && role === "backup-helper") controller.abort();
      if (malformedBackupCreate && role === "backup-helper") return { status: 0, stdout: "lost\n", stderr: "" };
      return { status: 0, stdout: `${id}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "start") {
      containers.get(args[2]).state = "running"; return { status: 0, stdout: `${args[2]}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "wait") {
      const record = containers.get(args[2]); record.state = "exited";
      record.exitCode = record.role === "backup-helper" ? backupHelperExitCode
        : record.role === "restore-helper" ? restoreHelperExitCode : 0;
      return { status: 0, stdout: `${record.exitCode}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "logs") {
      const role = containers.get(args[2]).role;
      const stdout = role.startsWith("init-") ? "SEAWEED_BACKUP_VOLUME_INITIALIZED\n"
        : role === "backup-helper" ? `SEAWEED_OFFLINE_BACKUP_VERIFIED|${archiveSha256}|${archiveBytes}\n`
          : "SEAWEED_OFFLINE_RESTORE_VERIFIED\n";
      return { status: 0, stdout, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "exec") {
      if (args.at(-1).includes("SEAWEED_BACKUP_SOURCE_WRITE_VERIFIED")) {
        return { status: 0, stdout: "SEAWEED_BACKUP_SOURCE_WRITE_VERIFIED\n", stderr: "" };
      }
      if (restoredStatus === 0) {
        return { status: 0, stdout: "SEAWEED_BACKUP_RESTORED_READ_VERIFIED\n", stderr: "" };
      }
      restoredProbeFailed = true;
      return { status: restoredStatus, stdout: "", stderr: "" };
    }
    if (args[0] === "container" && args[1] === "stop") {
      const record = containers.get(args.at(-1)); record.state = "exited";
      record.exitCode = record.role === "service-source" ? sourceStopExitCode : 0;
      return { status: 0, stdout: `${args.at(-1)}\n`, stderr: "" };
    }
    if (args[0] === "container" && args[1] === "rm") {
      containers.delete(args[2]); return { status: 0, stdout: `${args[2]}\n`, stderr: "" };
    }
    throw new Error(`unexpected Docker call: ${args.join(" ")}`);
  };
  return { calls, docker, volumes, containers, controller };
}

const input = (extra = {}) => ({ parent, dockerConfig, imageId, runId, recipeRevision, ...extra });

test("backup restore commands parse under the Linux shell", { skip: process.platform !== "linux" }, () => {
  for (const script of TEST_ONLY_seaweedBackupRestoreScripts()) {
    const parsed = spawnSync("/bin/sh", ["-n"], { input: script, encoding: "utf8" });
    assert.equal(parsed.status, 0, parsed.stderr);
  }
});

test("backup restore copies a stopped source through an owned archive into a fresh isolated volume", async () => {
  const value = fixture();
  const proof = await TEST_ONLY_verifyLocalSeaweedRuntimeBackupRestore(input(), { docker: value.docker });
  assert.deepEqual(proof, TEST_ONLY_expectedSeaweedRuntimeBackupRestoreProof(
    { imageId, runId, recipeRevision }, archiveSha256, archiveBytes));
  assert.deepEqual(validateSeaweedRuntimeBackupRestoreProof(proof, { imageId, runId, recipeRevision }), proof);
  assert.equal(value.volumes.size, 0); assert.equal(value.containers.size, 0);
  const sourceStop = value.calls.findIndex((args) => args[0] === "container" && args[1] === "stop"
    && args.at(-1).endsWith("service-source"));
  const backupCreate = value.calls.findIndex((args) => args[0] === "container" && args[1] === "create"
    && args.includes(`${`aw-seaweed-backup-${runId}`}-backup-helper`));
  const sourceRemove = value.calls.findIndex((args) => args[0] === "volume" && args[1] === "rm"
    && args[2].endsWith("-source"));
  const restoreCreate = value.calls.findIndex((args) => args[0] === "volume" && args[1] === "create"
    && args.at(-1).endsWith("-restore"));
  assert.ok(sourceStop < backupCreate); assert.ok(backupCreate < sourceRemove); assert.ok(sourceRemove < restoreCreate);
  const helperCreates = value.calls.filter((args) => args[0] === "container" && args[1] === "create"
    && args.some((part) => part.endsWith("helper")));
  assert.equal(helperCreates.length, 2);
  for (const args of helperCreates) {
    assert.ok(args.includes("--user=1000:1000")); assert.equal(args.includes("--cap-add=CHOWN"), false);
    assert.ok(args.includes("/data:rw,nosuid,nodev,noexec,size=4m,mode=0700,uid=1000,gid=1000"));
  }
  assert.match(helperCreates[0].at(-1), /umask 077/u);
  assert.match(helperCreates[0].at(-1), /awk '\/\^Uid:\/ \{print \$2\}' \/proc\/1\/status/u);
  assert.match(helperCreates[0].at(-1), /awk '\/\^Gid:\/ \{print \$2\}' \/proc\/1\/status/u);
  assert.match(helperCreates[0].at(-1), /stat -c '%u:%g:%a' \/backup\/data\.tar/u);
  assert.match(helperCreates[1].at(-1), /find \/restore -mindepth 1 ! -user 1000/u);
  assert.match(helperCreates[1].at(-1), /awk '\/\^Uid:\/ \{print \$2\}' \/proc\/1\/status/u);
  assert.match(helperCreates[1].at(-1), /awk '\/\^Gid:\/ \{print \$2\}' \/proc\/1\/status/u);
  assert.ok(helperCreates[0].includes(`type=volume,src=aw-seaweed-backup-${runId}-source,dst=/source,readonly,volume-nocopy`));
  assert.ok(helperCreates[0].includes(`type=volume,src=aw-seaweed-backup-${runId}-backup,dst=/backup,volume-nocopy`));
  assert.ok(helperCreates[1].includes(`type=volume,src=aw-seaweed-backup-${runId}-backup,dst=/backup,readonly,volume-nocopy`));
  assert.ok(helperCreates[1].includes(`type=volume,src=aw-seaweed-backup-${runId}-restore,dst=/restore,volume-nocopy`));
});

test("explicit false and Docker-omitted ReadOnly both prove a writable volume mount", async () => {
  const value = fixture({ explicitRwReadOnly: true });
  const proof = await TEST_ONLY_verifyLocalSeaweedRuntimeBackupRestore(input(), { docker: value.docker });
  assert.equal(proof.kind, "SEAWEED_LOCAL_RUNTIME_BACKUP_RESTORE_PROOF_V1");
  assert.equal(value.containers.size, 0); assert.equal(value.volumes.size, 0);
});

test("read-only backup mount must explicitly inspect as true", async () => {
  const value = fixture({ missingRoReadOnly: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeBackupRestore(input(), { docker: value.docker }),
    { code: "seaweed_candidate_runtime_backup_restore_failed", phase: "BACKUP_ARCHIVE",
      reason: "BACKUP_FAILED", runtimeCleanupFailure: {
        code: "seaweed_candidate_runtime_backup_restore_cleanup_failed",
        phase: "BACKUP_RESTORE_CLEANUP", reason: "CLEANUP_UNCERTAIN",
      } });
  assert.equal(value.calls.some((args) => args[0] === "container" && args[1] === "start"
    && args[2].endsWith("backup-helper")), false);
});

test("writable source mount is rejected when Docker reports it read-only", async () => {
  const value = fixture({ wrongRwReadOnly: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeBackupRestore(input(), { docker: value.docker }),
    { code: "seaweed_candidate_runtime_backup_restore_failed", phase: "BACKUP_SOURCE_VOLUME",
      reason: "CONTAINER_CREATE_INVALID", runtimeCleanupFailure: {
        code: "seaweed_candidate_runtime_backup_restore_cleanup_failed",
        phase: "BACKUP_RESTORE_CLEANUP", reason: "CLEANUP_UNCERTAIN",
      } });
  assert.equal(value.calls.some((args) => args[0] === "container" && args[1] === "start"), false);
});

test("Docker null PortBindings is accepted only with no published network bindings", async () => {
  const value = fixture({ nullPortBindings: true });
  const proof = await TEST_ONLY_verifyLocalSeaweedRuntimeBackupRestore(input(), { docker: value.docker });
  assert.equal(proof.kind, "SEAWEED_LOCAL_RUNTIME_BACKUP_RESTORE_PROOF_V1");
  assert.equal(value.volumes.size, 0); assert.equal(value.containers.size, 0);
});

test("pre-existing volume blocks all creation and deletion", async () => {
  const value = fixture({ preexistingVolume: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeBackupRestore(input(), { docker: value.docker }),
    { code: "seaweed_candidate_runtime_backup_restore_failed", phase: "BACKUP_RESTORE_PRECHECK",
      reason: "VOLUME_NAME_OCCUPIED" });
  assert.equal(value.calls.some((args) => args[1] === "create" || args[1] === "rm"), false);
});

test("missing helper data tmpfs fails before execution and cleans exact owned resources", async () => {
  const value = fixture({ driftHelperTmpfs: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeBackupRestore(input(), { docker: value.docker }),
    { code: "seaweed_candidate_runtime_backup_restore_failed", phase: "BACKUP_ARCHIVE",
      reason: "BACKUP_FAILED" });
  assert.equal(value.volumes.size, 0); assert.equal(value.containers.size, 0);
  assert.equal(value.calls.some((args) => args[0] === "container" && args[1] === "start"
    && args[2].endsWith("backup-helper")), false);
});

for (const [name, options] of [["privileged", { privilegedHelper: true }],
  ["restartable", { restartedHelper: true }]]) {
  test(`${name} backup helper is rejected before execution and exact owned resources are cleaned`, async () => {
    const value = fixture(options);
    await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeBackupRestore(input(), { docker: value.docker }),
      { code: "seaweed_candidate_runtime_backup_restore_failed", phase: "BACKUP_ARCHIVE",
        reason: "BACKUP_FAILED" });
    assert.equal(value.volumes.size, 0); assert.equal(value.containers.size, 0);
    assert.equal(value.calls.some((args) => args[0] === "container" && args[1] === "start"
      && args[2].endsWith("backup-helper")), false);
  });
}

test("nonzero helper exit preserves the primary failure and removes exact owned resources", async () => {
  const value = fixture({ backupHelperExitCode: 7 });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeBackupRestore(input(), { docker: value.docker }),
    { code: "seaweed_candidate_runtime_backup_restore_failed", phase: "BACKUP_ARCHIVE",
      reason: "BACKUP_FAILED" });
  assert.equal(value.volumes.size, 0); assert.equal(value.containers.size, 0);
  assert.ok(value.calls.some((args) => args[0] === "container" && args[1] === "rm"
    && args[2].endsWith("backup-helper")));
});

test("failed source shutdown never starts an offline backup", async () => {
  const value = fixture({ sourceStopExitCode: 7 });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeBackupRestore(input(), { docker: value.docker }),
    { code: "seaweed_candidate_runtime_backup_restore_failed", phase: "BACKUP_SOURCE_SERVICE",
      reason: "SOURCE_STOP_FAILED" });
  assert.equal(value.calls.some((args) => args[0] === "volume" && args[1] === "create"
    && args.at(-1).endsWith("-backup")), false);
  assert.equal(value.calls.some((args) => args[0] === "container" && args[1] === "create"
    && args.includes(`${`aw-seaweed-backup-${runId}`}-backup-helper`)), false);
  assert.equal(value.volumes.size, 0); assert.equal(value.containers.size, 0);
});

test("tampered backup is rejected before extraction or restored service startup", async () => {
  const value = fixture({ restoreHelperExitCode: 96 });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeBackupRestore(input(), { docker: value.docker }),
    { code: "seaweed_candidate_runtime_backup_restore_failed", phase: "BACKUP_RESTORE_COPY",
      reason: "RESTORE_FAILED" });
  const sourceRemoval = value.calls.findIndex((args) => args[0] === "volume" && args[1] === "rm"
    && args[2].endsWith("-source"));
  const restoreCreate = value.calls.findIndex((args) => args[0] === "container" && args[1] === "create"
    && args.includes(`${`aw-seaweed-backup-${runId}`}-restore-helper`));
  assert.ok(sourceRemoval >= 0 && sourceRemoval < restoreCreate);
  const script = value.calls[restoreCreate].at(-1);
  const hashCheck = script.indexOf("sha256sum /backup/data.tar");
  const byteCheck = script.indexOf("wc -c < /backup/data.tar");
  const extract = script.indexOf("tar -C /restore -xf /backup/data.tar");
  assert.ok(hashCheck >= 0 && byteCheck > hashCheck && extract > byteCheck);
  assert.ok(script.includes(archiveSha256)); assert.ok(script.includes(String(archiveBytes)));
  assert.equal(value.calls.some((args) => args[0] === "container" && args[1] === "create"
    && args.includes(`${`aw-seaweed-backup-${runId}`}-service-restored`)), false);
  assert.equal(value.volumes.size, 0); assert.equal(value.containers.size, 0);
});

for (const [status, reason] of [[85, "RESTORED_OBJECT_MISSING"], [86, "RESTORED_OBJECT_MISMATCH"],
  [89, "RESTORED_READ_FAILED"]]) {
  test(`restored service status ${status} fails as ${reason} and cleans owned resources`, async () => {
    const value = fixture({ restoredStatus: status });
    await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeBackupRestore(input(), { docker: value.docker }),
      { code: "seaweed_candidate_runtime_backup_restore_failed", phase: "BACKUP_RESTORED_SERVICE", reason });
    assert.equal(value.volumes.size, 0); assert.equal(value.containers.size, 0);
  });
}

test("lost helper create response is recovered only by exact identity and fully cleaned", async () => {
  const value = fixture({ malformedBackupCreate: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeBackupRestore(input(), { docker: value.docker }),
    { code: "seaweed_candidate_runtime_backup_restore_failed", phase: "BACKUP_ARCHIVE",
      reason: "BACKUP_FAILED" });
  assert.equal(value.volumes.size, 0); assert.equal(value.containers.size, 0);
});

test("foreign volume identity blocks deletion during cleanup", async () => {
  const value = fixture({ restoredStatus: 85, foreignRestoreVolumeDuringCleanup: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeBackupRestore(input(), { docker: value.docker }),
    (error) => {
      assert.deepEqual({ code: error.code, phase: error.phase, reason: error.reason,
        runtimeCleanupFailure: error.runtimeCleanupFailure }, {
        code: "seaweed_candidate_runtime_backup_restore_failed", phase: "BACKUP_RESTORED_SERVICE",
        reason: "RESTORED_OBJECT_MISSING",
        runtimeCleanupFailure: {
          code: "seaweed_candidate_runtime_backup_restore_cleanup_failed",
          phase: "BACKUP_RESTORE_CLEANUP", reason: "CLEANUP_UNCERTAIN",
        },
      });
      assert.equal(JSON.stringify(error).includes("private"), false);
      return true;
    });
  assert.equal(value.volumes.has(`aw-seaweed-backup-${runId}-restore`), true);
  assert.equal(value.calls.some((args) => args[0] === "volume" && args[1] === "rm"
    && args[2].endsWith("-restore")), false);
});

test("aborted operation still uses non-aborted cleanup and removes exact owned resources", async () => {
  const value = fixture({ abortAtBackup: true });
  await assert.rejects(TEST_ONLY_verifyLocalSeaweedRuntimeBackupRestore(
    input({ signal: value.controller.signal }), { docker: value.docker }),
  { code: "seaweed_candidate_runtime_backup_restore_failed" });
  assert.equal(value.volumes.size, 0); assert.equal(value.containers.size, 0);
});

test("proof validator rejects mutation, extra fields and invalid archive bounds", () => {
  const expected = { imageId, runId, recipeRevision };
  const proof = TEST_ONLY_expectedSeaweedRuntimeBackupRestoreProof(expected, archiveSha256, archiveBytes);
  assert.throws(() => validateSeaweedRuntimeBackupRestoreProof({ ...proof, cleanup: "NOT_ATTEMPTED" }, expected),
    { code: "seaweed_candidate_runtime_backup_restore_failed" });
  assert.throws(() => validateSeaweedRuntimeBackupRestoreProof({ ...proof, extra: true }, expected),
    { code: "seaweed_candidate_runtime_backup_restore_failed" });
  assert.throws(() => validateSeaweedRuntimeBackupRestoreProof({ ...proof, archiveBytes: 0 }, expected),
    { code: "seaweed_candidate_runtime_backup_restore_failed" });
});
