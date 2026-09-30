import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { authenticatePostgresRuntimeRestoreMaterial } from "../scripts/postgres-image/runtime-restore-input.mjs";
import { POSTGRES_RUNTIME_RESTORE_PIN } from "../scripts/postgres-image/runtime-restore-policy.mjs";
import { validatePostgresRuntimeRestoreWorkerStatus, runPostgresRuntimeRestoreWorker } from "../scripts/postgres-image/runtime-restore-worker.mjs";
import { postgresRuntimeRestoreClientIdentity, postgresRuntimeRestoreSupervisorFailureDiagnostic, publishPostgresRuntimeRestoreReceipt, runLocalPostgresRuntimeRestore,
  validatePostgresRuntimeRestoreRootAcknowledgement, validatePostgresRuntimeRestoreWorkerProcess } from "../scripts/postgres-image/local-runtime-restore-diagnostic.mjs";

const status = () => "Pid:\t4321\nPPid:\t42\nUid:\t1000\t1000\t1000\t1000\nGid:\t1000\t1000\t1000\t1000\n"
  + "Groups:\t\nNStgid:\t4321\nCapInh:\t0000000000000000\nCapPrm:\t0000000000000000\nCapEff:\t0000000000000000\n"
  + "CapAmb:\t0000000000000000\nNoNewPrivs:\t1\n";
test("privilege proof requires all four IDs, cleared groups, capabilities0 and NNP1", () => {
  assert.equal(validatePostgresRuntimeRestoreWorkerStatus(status(), 4321).noNewPrivileges, true);
  assert.equal(validatePostgresRuntimeRestoreWorkerStatus(status().replace("Groups:\t\n", "Groups:\t1000\n"), 4321).supplementalGroups, "CLEARED");
  for (const raw of [
    status().replace("Pid:\t4321", "Pid:\t4322"), status().replace("1000\t1000\t1000\t1000", "1000\t1000\t0\t1000"),
    status().replace("Gid:\t1000\t1000\t1000\t1000", "Gid:\t1000\t989\t1000\t1000"),
    status().replace("Groups:\t\n", "Groups:\t989 1000\n"), status().replace("NoNewPrivs:\t1", "NoNewPrivs:\t0"),
    ...["CapInh", "CapPrm", "CapEff", "CapAmb"].map((field) => status().replace(`${field}:\t0000000000000000`, `${field}:\t0000000000000001`)),
  ]) assert.throws(() => validatePostgresRuntimeRestoreWorkerStatus(raw, 4321), { message: "postgres_runtime_restore_control_invalid" });
});

test("worker process proof rejects reused PID start ticks, changed executable/argv and foreign parent", () => {
  const workerFile = path.resolve(import.meta.dirname, "../scripts/postgres-image/runtime-restore-worker.mjs");
  const proof = { startTicks: "1234", status: status(), executable: POSTGRES_RUNTIME_RESTORE_PIN.node, argv: [POSTGRES_RUNTIME_RESTORE_PIN.node, workerFile, ""] };
  assert.equal(validatePostgresRuntimeRestoreWorkerProcess(proof, 4321, "1234", 42).uid, 1000);
  for (const changed of [{ ...proof, startTicks: "1235" }, { ...proof, executable: "/usr/bin/sh" },
    { ...proof, argv: [...proof.argv, "override"] }, { ...proof, status: status().replace("PPid:\t42", "PPid:\t43") }]) {
    assert.throws(() => validatePostgresRuntimeRestoreWorkerProcess(changed, 4321, "1234", 42));
  }
});

test("root acknowledgement binds exact daemon/endpoint/PID, unchanged principal and closed fields", () => {
  const identity = { daemonId: "owned", endpoint: "unix:///var/tmp/aw-pr-ABC123/endpoint/docker.sock", pid: 1234 };
  const value = { state: "VERIFIED", purpose: "POSTGRES_RUNTIME_SQL_RESTORE", authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED",
    ...identity, principalImageCount: 2, principalSnapshotSha256: "c".repeat(64) };
  assert.deepEqual(validatePostgresRuntimeRestoreRootAcknowledgement(value, identity, "VERIFIED", "c".repeat(64)), value);
  for (const altered of [{ ...value, endpoint: "unix:///var/run/docker.sock" }, { ...value, pid: 4321 },
    { ...value, admission: "AUTHORIZED" }, { ...value, principalSnapshotSha256: "d".repeat(64) },
    { ...value, principalSnapshotSha256: ["c".repeat(64)] }, { ...value, command: "prune" }]) {
    assert.throws(() => validatePostgresRuntimeRestoreRootAcknowledgement(altered, identity, "VERIFIED", "c".repeat(64)));
  }
  assert.throws(() => validatePostgresRuntimeRestoreRootAcknowledgement({ ...value, principalSnapshotSha256: ["c".repeat(64)] }, identity, "VERIFIED"));
  const boundary = { ...value, state: "VERIFIED_IMAGE_ONLY", images: 1, containers: 0, volumes: 0 };
  assert.deepEqual(validatePostgresRuntimeRestoreRootAcknowledgement(boundary, identity, "VERIFIED_IMAGE_ONLY", "c".repeat(64)), boundary);
  for (const changed of [{ ...boundary, containers: 1 }, { ...boundary, volumes: 1 }, { ...boundary, images: 0 }]) {
    assert.throws(() => validatePostgresRuntimeRestoreRootAcknowledgement(changed, identity, "VERIFIED_IMAGE_ONLY", "c".repeat(64)));
  }
});

test("complete daemon receipt identity binds every path, namespace, nonce and scalar type", () => {
  const nonce = "a".repeat(24); const root = "/var/tmp/aw-pr-ABC123";
  const identity = { purpose: "POSTGRES_RUNTIME_SQL_RESTORE", authority: "LOCAL_DIAGNOSTIC", admission: "NOT_AUTHORIZED", root,
    socket: `${root}/endpoint/docker.sock`, endpoint: `unix://${root}/endpoint/docker.sock`, dockerConfig: `${root}/client`,
    contextName: `aw-pg-restore-${nonce}`, pid: 4321, startTicks: "1234", daemonId: "owned", version: "28.0.4",
    dataRoot: `${root}/infra/data`, execRoot: `${root}/infra/exec`, containerdAddress: "/run/containerd/containerd.sock",
    containersNamespace: `awpgsql-${nonce}`, pluginsNamespace: `plugins.awpgsql-${nonce}`, configSha256: "b".repeat(64), argvSha256: "c".repeat(64),
    rootActor: { uid: 0, gid: 0 }, clientActor: { uid: 1000, gid: 1000 }, socketProof: { dev: "123", ino: "456", uid: 0, gid: 1000, mode: 0o660 },
    socketDirectoryProof: { dev: "123", ino: "455", uid: 0, gid: 1000, mode: 0o710 } };
  assert.equal(postgresRuntimeRestoreClientIdentity(identity, nonce).endpoint, identity.endpoint);
  for (const change of [{ root: "/foreign" }, { root: [root] }, { socket: "/foreign/docker.sock" }, { dataRoot: "/foreign/data" },
    { execRoot: "/foreign/exec" }, { dockerConfig: "/foreign/client" }, { contextName: `aw-pg-restore-${"d".repeat(24)}` },
    { daemonId: ["owned"] }, { startTicks: ["1234"] }, { configSha256: ["b".repeat(64)] }, { socketProof: { ...identity.socketProof, ino: ["456"] } }]) {
    assert.throws(() => postgresRuntimeRestoreClientIdentity({ ...identity, ...change }, nonce), { message: "postgres_runtime_restore_context_invalid" });
  }
});

test("metadata authentication rejects size/hash substitution before interpreting a receipt", () => {
  const publicPolicy = readFileSync(new URL("../infra/postgres-image/candidate-remote.json", import.meta.url));
  for (const copy of [Buffer.from('{"command":"nonsensitive fixture"}'), Buffer.alloc(POSTGRES_RUNTIME_RESTORE_PIN.copyReceiptBytes)]) {
    assert.throws(() => authenticatePostgresRuntimeRestoreMaterial(publicPolicy, copy, readFileSync(new URL("../infra/postgres-image/candidate-runtime.json", import.meta.url))), { message: "postgres_runtime_restore_material_invalid" });
  }
});

test("entrypoints reject arguments on every platform before file or daemon access", async () => {
  await assert.rejects(runLocalPostgresRuntimeRestore(["override"]), { message: "postgres_runtime_restore_context_invalid" });
  await assert.rejects(runPostgresRuntimeRestoreWorker(["override"]), { message: "postgres_runtime_restore_control_invalid" });
});

test("supervisor diagnostics are bounded and read hostile getters once", () => {
  let reads = 0;
  assert.deepEqual(postgresRuntimeRestoreSupervisorFailureDiagnostic({ get message() { reads++; throw new Error("private fixture output"); } }),
    { code: "postgres_runtime_restore_context_invalid", phase: "CONTEXT" });
  assert.equal(reads, 1);
  assert.deepEqual(postgresRuntimeRestoreSupervisorFailureDiagnostic(new Error("postgres_runtime_restore_cleanup_uncertain"), "CLEANUP"),
    { code: "postgres_runtime_restore_cleanup_uncertain", phase: "CLEANUP" });
});

const linux = process.platform === "linux" && process.getuid?.() > 0;
function fixture(run) {
  const base = mkdtempSync(path.join(os.tmpdir(), "aw-pg-restore-receipt-")); const directory = path.join(base, "private");
  // A real non-root namespace tests the filesystem algorithm; no fixture claims a root actor.
  return Promise.resolve().then(async () => {
    mkdirSync(directory, { mode: 0o710 }); chmodSync(directory, 0o710);
    await run(path.join(directory, "receipt.json"));
  }).finally(() => rmSync(base, { recursive: true, force: true }));
}
test("native publication fsyncs and rereads the exact new exclusive0600 file", { skip: !linux }, () => fixture((file) => {
  const record = { state: "fixture", payload: "UTF-8 é" }; let reads = 0;
  const proof = publishPostgresRuntimeRestoreReceipt(file, record, (value) => { reads++; assert.deepEqual(value, record); });
  const content = readFileSync(file); const stat = lstatSync(file);
  assert.equal(proof.size, content.length); assert.equal(proof.sha256, createHash("sha256").update(content).digest("hex"));
  assert.equal(reads, 2); assert.equal(stat.uid, process.getuid()); assert.equal(stat.gid, process.getgid());
  assert.equal(stat.mode & 0o7777, 0o600); assert.equal(stat.nlink, 1);
}));
test("publication collision preserves the existing receipt", { skip: !linux }, () => fixture((file) => {
  writeFileSync(file, "existing fixture", { mode: 0o600 });
  assert.throws(() => publishPostgresRuntimeRestoreReceipt(file, { state: "fixture" }));
  assert.equal(readFileSync(file, "utf8"), "existing fixture");
}));
test("private receipt cap is128KiB and refuses overflow without creating a receipt", { skip: !linux }, () => fixture((file) => {
  assert.throws(() => publishPostgresRuntimeRestoreReceipt(file, { state: "fixture", payload: "x".repeat(128 * 1024) }));
  assert.equal(existsSync(file), false);
}));
test("late publication validation failure removes only its own proven new receipt", { skip: !linux }, () => fixture((file) => {
  let calls = 0;
  assert.throws(() => publishPostgresRuntimeRestoreReceipt(file, { state: "fixture" }, () => { if (++calls === 2) throw new Error("fixture"); }),
    { message: "postgres_runtime_restore_receipt_failed" });
  assert.equal(existsSync(file), false);
}));
test("late receipt replacement forbids cleanup of the foreign file", { skip: !linux }, () => fixture((file) => {
  let calls = 0;
  assert.throws(() => publishPostgresRuntimeRestoreReceipt(file, { state: "fixture" }, () => {
    if (++calls === 2) { renameSync(file, `${file}.owned`); writeFileSync(file, "foreign fixture", { mode: 0o600 }); throw new Error("fixture"); }
  }), { message: "postgres_runtime_restore_cleanup_uncertain" });
  assert.equal(readFileSync(file, "utf8"), "foreign fixture"); assert.equal(existsSync(`${file}.owned`), true);
}));
test("a substitution without validator exception cannot publish success", { skip: !linux }, () => fixture((file) => {
  let calls = 0;
  assert.throws(() => publishPostgresRuntimeRestoreReceipt(file, { state: "fixture" }, () => {
    if (++calls === 2) { renameSync(file, `${file}.owned`); writeFileSync(file, "foreign fixture", { mode: 0o600 }); }
  }), { message: "postgres_runtime_restore_cleanup_uncertain" });
  assert.equal(readFileSync(file, "utf8"), "foreign fixture"); assert.equal(existsSync(`${file}.owned`), true);
}));
test("symlink receipt destination never modifies its target", { skip: !linux }, () => fixture((file) => {
  const foreign = `${file}.foreign`; writeFileSync(foreign, "foreign fixture", { mode: 0o600 }); symlinkSync(foreign, file);
  assert.throws(() => publishPostgresRuntimeRestoreReceipt(file, { state: "fixture" })); assert.equal(readFileSync(foreign, "utf8"), "foreign fixture");
}));
