import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants, fstatSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import test from "node:test";
import { postgresLocalRuntimeRestoreFailureDiagnostic, postgresLocalRuntimeRestorePhases, postgresLocalSqlCommands, postgresLocalSqlExpectedData,
  postgresLocalSqlExpectedSchema, postgresLocalSqlFixture, validatePostgresLocalRuntimeRestoreFailureDiagnostic, validatePostgresLocalRuntimeRestoreProof,
  verifyLocalPostgresRuntimeAndSqlRestore } from "../scripts/postgres-image/candidate-local-runtime-restore.mjs";
import { retainedFixture } from "./fixtures/postgres-private-retention.mjs";
import { postgresLocalRuntimeLabels } from "../scripts/postgres-image/candidate-runtime.mjs";

const linux = process.platform === "linux" && process.getuid() > 0 && process.getgid() > 0;
const hash = (v) => createHash("sha256").update(v).digest("hex"); const bytes = (v) => Buffer.from(JSON.stringify(v, null, 2) + "\n");
const clone = (v) => globalThis.structuredClone(v); const ok = (stdout = "", status = 0, stderr = "") => ({ status, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) });
const configuration = { User: "", Entrypoint: ["docker-entrypoint.sh"], Cmd: ["postgres"], WorkingDir: "/", Env: ["PATH=/usr/local/bin:/usr/bin:/bin", "PGDATA=/var/lib/postgresql/data"],
  Labels: { "com.auto-world.postgres-diagnostic": "94c2d4878c445bef8d51ff7c", "com.auto-world.postgres-diagnostic-purpose": "gosu-correction-runtime" }, Volumes: { "/var/lib/postgresql/data": {} } };
function meta(s) { return { dev: String(s.dev), ino: String(s.ino), uid: Number(s.uid), gid: Number(s.gid), mode: Number(s.mode & 0o7777n) }; }
function descriptor(file, name) { const s = lstatSync(file, { bigint: true }); return { name, size: Number(s.size), sha256: hash(readFileSync(file)), identity: { ...meta(s), nlink: Number(s.nlink), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) } }; }
function directoryFd(file) { const name = readdirSync("/proc/self/fd").find((entry) => {
  try { return readlinkSync(path.join("/proc/self/fd", entry)) === file; } catch { return false; } });
  assert.ok(name, "private directory descriptor is held"); return Number(name); }
async function scope(t, runtime = configuration) {
  const root = mkdtempSync("/tmp/aw-pgr-"); chmodSync(root, 0o700); const directory = path.join(root, "imported"); const client = path.join(root, "client"); const endpointDirectory = path.join(root, "endpoint");
  const workDirectory = path.join(root, "work"); const contextName = "aw-runtime-fixture"; const contextMeta = path.join(client, "contexts", "meta", hash(Buffer.from(contextName)));
  for (const d of [directory, client, path.join(client, "contexts"), path.join(client, "contexts", "meta"), contextMeta, endpointDirectory, workDirectory]) mkdirSync(d, { mode: 0o700 });
  const socket = path.join(endpointDirectory, "docker.sock"); const server = createServer(); await new Promise((yes, no) => { server.once("error", no); server.listen(socket, yes); }); server.unref();
  chmodSync(socket, 0o660); chmodSync(endpointDirectory, 0o710);
  t.after(async () => { await new Promise((yes) => server.close(yes)); rmSync(root, { recursive: true }); });
  const fixture = retainedFixture({ runtime }); const endpoint = "unix://" + socket;
  writeFileSync(path.join(directory, "candidate.tar"), fixture.archive, { mode: 0o600 }); writeFileSync(path.join(directory, "retention-receipt.json"), fixture.receiptBytes, { mode: 0o600 });
  writeFileSync(path.join(client, "config.json"), bytes({ currentContext: contextName }), { mode: 0o600 });
  writeFileSync(path.join(contextMeta, "meta.json"), bytes({ Name: contextName, Metadata: {}, Endpoints: { docker: { Host: endpoint, SkipTLSVerify: false } } }), { mode: 0o600 });
  const input = { directory, files: ["candidate.tar", "retention-receipt.json"].map((name) => descriptor(path.join(directory, name), name)), archiveProof: fixture.proof, policy: fixture.policy,
    originalRecipeRevision: fixture.recipeRevision, originalExecutionId: `local-${fixture.runId}`, recipeRevision: "f".repeat(40), executionId: "local-pg-restore-" + "a".repeat(24), workDirectory, auditReceiptSha256: "e".repeat(64),
    identity: { endpoint, daemonId: "owned-daemon", dataRoot: path.join(root, "infra", "data"), containerdAddress: "/run/containerd/containerd.sock", containersNamespace: "aw-runtime-fixture", pluginsNamespace: "plugins.aw-runtime-fixture",
      dockerConfig: client, contextName, socket: meta(lstatSync(socket, { bigint: true })), socketDirectory: meta(lstatSync(endpointDirectory, { bigint: true })) } };
  return { root, input, fixture, client, contextMeta, socket };
}
const arg = (args, name) => args[args.indexOf(name) + 1]; const flags = (args, name) => args.flatMap((v, i) => v === name ? [args[i + 1]] : []);
const absent = (kind, name) => ok("", 1, kind === "container" ? `Error: No such container: ${name}\n` : `Error response from daemon: get ${name}: no such volume\n`);
function harness(s, hooks = {}) {
  const h = { calls: [], grants: [], owners: [], containers: new Map(), volumes: new Map(), images: [], loadedBytes: null, sourcePresentAtRestore: null, sqlExecs: [], processCounts: new Map() };
  const get = (id) => h.containers.get(id) ?? [...h.containers.values()].find((v) => v.Id === id);
  h.authorize = async (phase) => { h.owners.push(phase); if (hooks.authorize) { const replacement = hooks.authorize(phase, h); if (replacement !== undefined) return replacement; }
    return { state: "VERIFIED", purpose: "POSTGRES_RUNTIME_SQL_RESTORE", phase, daemonId: s.input.identity.daemonId, endpoint: s.input.identity.endpoint }; };
  h.beforeExecution = async (phase) => { h.grants.push(phase); if (phase === "RESTORE_START" && h.sourcePresentAtRestore === null) h.sourcePresentAtRestore = { containers: h.containers.size, volumes: h.volumes.size };
    const ack = { state: "VERIFIED_CURRENT", purpose: "POSTGRES_RUNTIME_SQL_RESTORE", phase, daemonId: s.input.identity.daemonId, endpoint: s.input.identity.endpoint,
      auditReceiptSha256: s.input.auditReceiptSha256, checkedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 600_000).toISOString() };
    return hooks.grant ? hooks.grant(ack, h) ?? ack : ack; };
  h.transport = async (command, rawArgs, options) => {
    assert.equal(command, "/usr/bin/docker"); assert.deepEqual(rawArgs.slice(0, 2), ["--host", s.input.identity.endpoint]); assert.equal(options.env.DOCKER_CONFIG, s.client);
    assert.equal(options.env.DOCKER_HOST, undefined); assert.equal(options.env.GITHUB_TOKEN, undefined); assert.equal(options.env.POSTGRES_PASSWORD, undefined);
    const args = rawArgs.slice(2); options.beforeSpawn(); h.calls.push({ args, phase: h.owners.at(-1) });
    if (hooks.transport) { const replacement = await hooks.transport(args, options, h); if (replacement !== undefined) return replacement; }
    if (args[0] === "version") return ok("28.0.4|28.0.4\n");
    if (args[0] === "info") return ok(bytes({ ID: s.input.identity.daemonId, DockerRootDir: s.input.identity.dataRoot, ServerVersion: "28.0.4", Driver: "overlay2", OSType: "linux", Architecture: "x86_64",
      Containerd: { Address: s.input.identity.containerdAddress, Namespaces: { Containers: s.input.identity.containersNamespace, Plugins: s.input.identity.pluginsNamespace } } }));
    if (args[1] === "ls") return ok((args[0] === "image" ? h.images : args[0] === "container" ? [...h.containers.values()].map((v) => v.Id) : [...h.volumes.keys()]).map((v) => v + "\n").join(""));
    if (args[0] === "image" && args[1] === "load") {
      const child = spawnSync(process.execPath, ["-e", "const b=require('node:fs').readFileSync(0);process.stdout.write(JSON.stringify({size:b.length,sha256:require('node:crypto').createHash('sha256').update(b).digest('hex')}))"], { stdio: [options.inputFd, "pipe", "pipe"], timeout: 5000, env: { PATH: "/usr/bin:/bin" } });
      assert.equal(child.status, 0); h.loadedBytes = JSON.parse(child.stdout); h.images.push(s.input.policy.candidate.imageId); return ok("Loaded image: " + s.input.archiveProof.tag + "\n");
    }
    if (args[0] === "image" && args[1] === "inspect") return ok(bytes({ Id: s.input.policy.candidate.imageId, Os: "linux", Architecture: "amd64", Size: s.fixture.archive.length, RepoTags: [s.input.archiveProof.tag], RepoDigests: [], RootFS: { Type: "layers", Layers: s.input.policy.candidate.diffIds }, Config: configuration }));
    if (args[0] === "image" && args[1] === "rm") { h.images = []; return ok("Deleted\n"); }
    if (args[0] === "volume" && args[1] === "create") { const name = args.at(-1); h.volumes.set(name, { Name: name, Driver: "local", Scope: "local", Options: null,
      Labels: Object.fromEntries(flags(args, "--label").map((v) => v.split("="))), CreatedAt: new Date().toISOString().replace(/\.\d{3}Z$/u, "Z"), Mountpoint: `${s.input.identity.dataRoot}/volumes/${name}/_data` }); return ok(name + "\n"); }
    if (args[0] === "volume" && args[1] === "inspect") return h.volumes.has(args.at(-1)) ? ok(bytes(h.volumes.get(args.at(-1)))) : absent("volume", args.at(-1));
    if (args[0] === "volume" && args[1] === "rm") { assert.equal(h.containers.size, 0); h.volumes.delete(args.at(-1)); return ok(args.at(-1) + "\n"); }
    if (args[0] === "create") {
      const name = arg(args, "--name"); const probe = name.endsWith("-probe"); const id = String(h.calls.filter((c) => c.args[0] === "create").length).repeat(64); const imageIndex = args.indexOf(s.input.policy.candidate.imageId);
      assert.ok(args.includes("--pull=never")); assert.equal(arg(args, "--ipc"), "private"); assert.equal(arg(args, "--cgroupns"), "private"); assert.equal(arg(args, "--runtime"), "runc");
      const variables = new Map(configuration.Env.map((v) => v.split("=")));
      if (!probe) for (const v of readFileSync(arg(args, "--env-file"), "utf8").trimEnd().split("\n")) variables.set(...v.split("="));
      const tmpfs = Object.fromEntries(flags(args, "--tmpfs").map((v) => { const i = v.indexOf(":"); return [v.slice(0, i), v.slice(i + 1)]; }));
      const volume = probe ? undefined : h.volumes.get(arg(args, "--mount").split(",")[1].slice(4));
      const value = { Id: id, Name: "/" + name, Image: s.input.policy.candidate.imageId, State: { Status: "created", Running: false, Paused: false, Restarting: false, Dead: false, Pid: 0, ExitCode: 0 },
        Config: { ...clone(configuration), Image: s.input.policy.candidate.imageId, Env: [...variables].map(([k, v]) => k + "=" + v), Labels: { ...configuration.Labels, ...Object.fromEntries(flags(args, "--label").map((v) => v.split("="))) }, Entrypoint: probe ? ["/bin/sh"] : configuration.Entrypoint, Cmd: probe ? args.slice(imageIndex + 1) : configuration.Cmd },
        HostConfig: { Privileged: false, NetworkMode: "none", ReadonlyRootfs: true, RestartPolicy: { Name: "no", MaximumRetryCount: 0 }, CapDrop: flags(args, "--cap-drop"), CapAdd: flags(args, "--cap-add").map((v) => "CAP_" + v), SecurityOpt: flags(args, "--security-opt"),
          Memory: Number(arg(args, "--memory")), MemorySwap: Number(arg(args, "--memory-swap")), NanoCpus: Number(arg(args, "--cpus")) * 1e9, PidsLimit: Number(arg(args, "--pids-limit")), ShmSize: Number(arg(args, "--shm-size")), Tmpfs: tmpfs,
          Binds: null, Devices: [], DeviceRequests: null, DeviceCgroupRules: null, VolumesFrom: null, Links: null, ExtraHosts: null, PortBindings: {}, PublishAllPorts: false, PidMode: "", IpcMode: "private", UTSMode: "", UsernsMode: "", CgroupnsMode: "private", ContainerIDFile: "", Runtime: "runc",
          Mounts: probe ? [] : [{ Type: "volume", Source: volume.Name, Target: "/var/lib/postgresql/data", VolumeOptions: { NoCopy: true } }] },
        Mounts: [...Object.keys(tmpfs).map((Destination) => ({ Type: "tmpfs", Destination, Source: "", RW: true })), ...(probe ? [] : [{ Type: "volume", Name: volume.Name, Destination: "/var/lib/postgresql/data", Source: volume.Mountpoint, Driver: "local", RW: true }])] };
      h.containers.set(name, value); return ok(id + "\n");
    }
    if (args[0] === "container" && args[1] === "inspect") return get(args.at(-1)) ? ok(bytes(get(args.at(-1)))) : absent("container", args.at(-1));
    if (args[0] === "start") { const value = get(args.at(-1)); value.State = { ...value.State, Status: "running", Running: true, Pid: 100 };
      if (args.includes("--attach")) { value.State.Status = "exited"; value.State.Running = false; value.State.Pid = 0; return ok("1.19 (go1.26.8 on linux/amd64; gc)\nuid=70\ngid=70\nnnp=1\n"); } return ok(value.Id + "\n"); }
    if (args[0] === "stop") { const value = get(args.at(-1)); assert.ok(value); value.State = { ...value.State, Status: "exited", Running: false, Pid: 0 }; return ok(value.Id + "\n"); }
    if (args[0] === "container" && args[1] === "rm") { const value = get(args.at(-1)); assert.equal(value.State.Running, false); h.containers.delete(value.Name.slice(1)); return ok(value.Id + "\n"); }
    if (args[0] === "exec") {
      const value = args.map((v) => get(v)).find(Boolean); assert.equal(value.State.Running, true); assert.ok(args.includes("70:70"));
      if (args.includes("/bin/sh")) { h.processCounts.set(value.Id, (h.processCounts.get(value.Id) ?? 0) + 1); return ok("uid=70 70 70 70\ngid=70 70 70 70\nnnp=1\ncapinh=0000000000000000\ncapprm=0000000000000000\ncapeff=0000000000000000\ncapamb=0000000000000000\nexe=/usr/local/bin/postgres\n"); }
      if (args.includes("pg_isready")) return ok(); h.sqlExecs.push(args);
      assert.ok(h.processCounts.get(value.Id) > 0); assert.ok(args.includes("PGPASSFILE=/dev/null")); assert.ok(args.includes("PGOPTIONS="));
      if (args.includes("--version")) { const tool = args[args.length - 2]; return ok(tool + " (PostgreSQL) 17.11\n"); }
      if (args.includes("pg_dump")) { const binary = Buffer.concat([Buffer.from("PGDMP"), Buffer.from([0, 255]), Buffer.alloc(10000, 0xff)]); options.outputSink(binary); h.dump = binary; return { ...ok(), outputBytes: binary.length }; }
      if (args.includes("pg_restore")) { assert.ok(Number.isSafeInteger(options.inputFd)); const child = spawnSync(process.execPath, ["-e", "const b=require('node:fs').readFileSync(0);process.stdout.write(require('node:crypto').createHash('sha256').update(b).digest('hex'))"], { stdio: [options.inputFd, "pipe", "pipe"], timeout: 5000 });
        assert.equal(child.status, 0); assert.equal(child.stdout.toString(), hash(h.dump)); return { ...ok(args.includes("--list") ? "; Archive created by PostgreSQL 17.11\n1; 0 0 SCHEMA - aw_probe awdiag\n2; 0 0 TABLE aw_probe items awdiag\n" : ""), inputBytes: h.dump.length }; }
      if (args.includes("createdb")) return ok(); const sql = args.at(-1);
      if (sql === "SHOW server_version;") return ok("17.11\n"); if (sql === "SELECT count(*) FROM pg_catalog.pg_namespace WHERE nspname = 'aw_probe';") return ok("0\n"); if (sql.startsWith("SELECT json_object_agg")) return ok(bytes(postgresLocalSqlExpectedSchema));
      if (sql.startsWith("SELECT json_build_object")) return ok(bytes(postgresLocalSqlExpectedData)); return ok();
    }
    assert.fail("Unexpected fixed command: " + args[0]);
  };
  h.deps = { transport: h.transport, sqlTransport: h.transport }; h.controls = { authorize: h.authorize, beforeExecution: h.beforeExecution }; return h;
}
test("new engine metadata and resource labels reject coercive array scalars before native access", async () => {
  const input = { directory: "/home/not-accessed", files: [], archiveProof: {}, policy: {}, originalRecipeRevision: "a".repeat(40),
    originalExecutionId: "local-1", recipeRevision: "b".repeat(40), executionId: "local-pg-restore-" + "c".repeat(24),
    identity: {}, workDirectory: "/home/not-accessed-work", auditReceiptSha256: "d".repeat(64) };
  for (const key of ["recipeRevision", "executionId", "auditReceiptSha256"]) {
    await assert.rejects(verifyLocalPostgresRuntimeAndSqlRestore({ ...input, [key]: [input[key]] }, {}),
      { message: "postgres_local_runtime_restore_arguments_invalid" });
  }
  assert.throws(() => postgresLocalRuntimeLabels(["c".repeat(24)], "probe"), { message: "postgres_runtime_arguments_invalid" });
  assert.throws(() => postgresLocalRuntimeLabels("c".repeat(24), ["probe"]), { message: "postgres_runtime_arguments_invalid" });
});
test("SQL fixture and exact tool arguments cover binary, Unicode, nulls and rollback independently", () => {
  assert.deepEqual(postgresLocalSqlExpectedData.items.map((v) => [v.id, v.label, v.payload, v.note]), [[1, "ASCII", "00ff", null], [2, "é", "000102", "retained"], [3, "車", "ff00", ""]]);
  assert.deepEqual(postgresLocalSqlExpectedData.raw_refs, [{ id: 1, item_id: 1, sha256: hash(Buffer.from([0, 255])) }]); assert.equal(postgresLocalSqlExpectedData.rolled_back_count, 0);
  assert.ok(postgresLocalSqlFixture.includes("BEGIN; INSERT INTO aw_probe.items VALUES(99")); assert.ok(postgresLocalSqlFixture.includes("ROLLBACK;"));
  assert.deepEqual(postgresLocalSqlCommands.dump, ["pg_dump", "--host=/var/run/postgresql", "--port=5432", "--username=awdiag", "--no-password", "--dbname=awdiag", "--format=custom"]);
  assert.deepEqual(postgresLocalSqlCommands.restore.slice(-4), ["--dbname=awdiag", "--single-transaction", "--no-owner", "--no-privileges"]); assert.equal(postgresLocalSqlExpectedSchema.raw_refs.columns[2].length, 64);
  const legacy = retainedFixture(); assert.deepEqual(legacy.retention.archiveProof, retainedFixture({}).retention.archiveProof); assert.equal(legacy.policy.manifest.config.size, 1076);
});
test("runtime diagnostics are closed and capture untrusted error message only once", () => {
  let reads = 0; const error = new Error(); Object.defineProperty(error, "message", { get() { return ++reads === 1 ? "postgres_local_runtime_restore_sql_invalid" : "private password"; } });
  error.phase = "SOURCE_SQL"; error.cleanup = "CONFIRMED"; const proof = postgresLocalRuntimeRestoreFailureDiagnostic(error); assert.equal(reads, 1);
  assert.deepEqual(proof, { code: "postgres_local_runtime_restore_sql_invalid", phase: "SOURCE_SQL", cleanup: "CONFIRMED" }); assert.deepEqual(validatePostgresLocalRuntimeRestoreFailureDiagnostic(proof), proof);
  assert.throws(() => validatePostgresLocalRuntimeRestoreFailureDiagnostic({ ...proof, raw: "private" }), /proof_invalid/u);
  assert.equal(postgresLocalRuntimeRestoreFailureDiagnostic(new Error("private")).code, "postgres_local_runtime_restore_operation_failed");
});
test("native engine completes five distinct profiles, exact SQL, fresh volume restore, cleanup and seals", { skip: !linux }, async (t) => {
  const s = await scope(t); const h = harness(s); const proof = await verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps);
  assert.deepEqual(proof, validatePostgresLocalRuntimeRestoreProof(proof, s.input)); assert.deepEqual(h.loadedBytes, { size: s.fixture.archive.length, sha256: hash(s.fixture.archive) });
  assert.equal(h.owners.length, h.calls.length * 2 + 2); assert.deepEqual(h.owners.slice(-2), ["FINAL_SEAL", "FINAL_SEAL"]); assert.equal(proof.audit.count, h.grants.length); assert.deepEqual(h.sourcePresentAtRestore, { containers: 0, volumes: 0 });
  assert.deepEqual(proof.phases.map((v) => v.name), postgresLocalRuntimeRestorePhases); assert.equal(new Set([proof.gosu.containerId, ...proof.services.map((v) => v.containerId)]).size, 5);
  assert.equal(h.containers.size, 0); assert.equal(h.volumes.size, 0); assert.deepEqual(h.images, []); assert.deepEqual(readdirSync(s.input.workDirectory), ["backup"]);
  assert.deepEqual(readFileSync(path.join(s.input.directory, "candidate.tar")), s.fixture.archive); assert.ok(!JSON.stringify(proof).includes("POSTGRES_PASSWORD"));
  for (const change of [(v) => { v.extra = true; }, (v) => { v.audit.count = 0; }, (v) => { v.services[0].capabilities.effective = "0000000000000001"; },
    (v) => { v.sourceDisposed = "UNKNOWN"; }, (v) => { v.backup.file.interpretation = "FULL"; }, (v) => { v.services[1].containerId = v.services[0].containerId; }, (v) => { v.phases.pop(); },
    (v) => { v.gosu.containerId = [v.gosu.containerId]; v.cleanup.containers[0].id = v.gosu.containerId; },
    (v) => { v.services[0].containerId = [v.services[0].containerId]; v.cleanup.containers[1].id = v.services[0].containerId; },
    (v) => { v.backup.tocSha256 = [v.backup.tocSha256]; }]) {
    const changed = clone(proof); change(changed); assert.throws(() => validatePostgresLocalRuntimeRestoreProof(changed, s.input), /proof_invalid/u);
  }
});

test("native engine retains Docker RFC3339 volume creation timestamps without normalizing their offset", { skip: !linux }, async (t) => {
  // Moby v28.0.4 volumeToAPIType uses time.RFC3339, not fractional ISO/RFC3339Nano.
  for (const offset of ["Z", "+01:00"]) await t.test(offset, async (sub) => {
    const s = await scope(sub); const timestamps = new Map(); const h = harness(s, { transport: (args, _options, state) => {
      if (args[0] !== "volume" || args[1] !== "inspect" || !state.volumes.has(args.at(-1))) return;
      const name = args.at(-1); if (!timestamps.has(name)) timestamps.set(name, new Date(Date.now() + (offset === "Z" ? 0 : 3_600_000)).toISOString().slice(0, 19) + offset);
      state.volumes.get(name).CreatedAt = timestamps.get(name);
    } });
    const proof = await verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps);
    assert.deepEqual(proof, validatePostgresLocalRuntimeRestoreProof(proof, s.input));
    for (const volume of Object.values(proof.volumes)) assert.equal(volume.createdAt, timestamps.get(volume.name));
    assert.equal(h.containers.size, 0); assert.equal(h.volumes.size, 0); assert.deepEqual(h.images, []);
  });
});
test("native proof rejects malformed, normalized-calendar and out-of-audit-window volume timestamps", { skip: !linux }, async (t) => {
  const s = await scope(t); const h = harness(s); const proof = await verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps);
  const timestamp = proof.volumes.source.createdAt;
  for (const invalid of [timestamp + "\n", timestamp.replace("Z", ".000Z"), timestamp.replace("Z", ".123456789Z"), timestamp.replace("Z", "+00:00"),
    timestamp.replace("Z", "+24:00"), timestamp.replace("Z", "+01:60"), "2026-02-30T12:00:00Z", "2026-13-01T12:00:00Z", "2026-09-30T24:00:00Z",
    [timestamp], new Date(Date.parse(proof.audit.firstCheckedAt) - 60_000).toISOString().slice(0, 19) + "Z",
    new Date(Date.parse(proof.audit.lastCheckedAt) + 60_000).toISOString().slice(0, 19) + "Z"]) {
    const changed = clone(proof); changed.volumes.source.createdAt = invalid;
    assert.throws(() => validatePostgresLocalRuntimeRestoreProof(changed, s.input), /proof_invalid/u);
  }
  // Calendar normalization must be refused even if a forged audit interval encloses its parsed value.
  const changed = clone(proof); changed.volumes.source.createdAt = "2026-02-30T12:00:00Z";
  changed.volumes.restore.createdAt = "2026-03-02T12:00:00Z";
  changed.audit.firstCheckedAt = "2026-03-02T11:59:59.000Z"; changed.audit.lastCheckedAt = "2026-03-02T12:00:01.000Z";
  changed.audit.validUntil = "2026-03-02T12:01:00.000Z";
  assert.throws(() => validatePostgresLocalRuntimeRestoreProof(changed, s.input), /proof_invalid/u);
});

test("native volume reuse refuses a raw creation timestamp substitution representing the same instant", { skip: !linux }, async (t) => {
  const s = await scope(t); const inspections = new Map(); const h = harness(s, { transport: (args, _options, state) => {
    if (args[0] !== "volume" || args[1] !== "inspect" || !state.volumes.has(args.at(-1))) return;
    const name = args.at(-1); const count = (inspections.get(name) ?? 0) + 1; inspections.set(name, count);
    if (count === 2) state.volumes.get(name).CreatedAt = state.volumes.get(name).CreatedAt.replace("Z", "+00:00");
  } });
  await assert.rejects(verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps), (error) => {
    assert.equal(error.message, "postgres_local_runtime_restore_cleanup_uncertain"); assert.equal(error.cleanup, "UNVERIFIED"); return true;
  });
  assert.equal(h.calls.some((v) => v.args[0] === "volume" && v.args[1] === "rm"), false);
});

test("native engine preserves the preexisting private audit-evidence directory through the complete route", { skip: !linux }, async (t) => {
  const s = await scope(t); const evidence = path.join(s.input.workDirectory, "audit-evidence"); mkdirSync(evidence, { mode: 0o700 });
  const report = path.join(evidence, "supervisor-owned-report.json"); const reportBytes = Buffer.from("supervisor validates these bytes\n"); writeFileSync(report, reportBytes, { mode: 0o600 });
  const identity = meta(lstatSync(evidence, { bigint: true })); let auditFd;
  const h = harness(s, { transport: (args) => { if (args[0] !== "version") return; auditFd = directoryFd(evidence);
    assert.deepEqual(meta(fstatSync(auditFd, { bigint: true })), identity);
    const flags = Number.parseInt(/^flags:\s+([0-7]+)$/mu.exec(readFileSync(`/proc/self/fdinfo/${auditFd}`, "utf8"))[1], 8);
    assert.equal(flags & constants.O_DIRECTORY, constants.O_DIRECTORY); assert.equal(flags & constants.O_NOFOLLOW, constants.O_NOFOLLOW); } });
  const proof = await verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps);
  assert.deepEqual(proof, validatePostgresLocalRuntimeRestoreProof(proof, s.input));
  assert.deepEqual(meta(lstatSync(evidence, { bigint: true })), identity); assert.deepEqual(readFileSync(report), reportBytes);
  assert.throws(() => fstatSync(auditFd), { code: "EBADF" });
  assert.deepEqual(readdirSync(s.input.workDirectory).sort(), ["audit-evidence", "backup"]);
  assert.equal(h.containers.size, 0); assert.equal(h.volumes.size, 0); assert.deepEqual(h.images, []);
});

test("native engine refuses unowned audit-evidence shapes and unexpected initial work entries before transport", { skip: !linux }, async (t) => {
  for (const variant of ["file", "symlink", "mode", "extra"]) await t.test(variant, async (sub) => {
    const s = await scope(sub); const evidence = path.join(s.input.workDirectory, "audit-evidence");
    if (variant === "file") writeFileSync(evidence, "not a directory", { mode: 0o600 });
    else if (variant === "symlink") { const target = path.join(s.root, "other-audit"); mkdirSync(target, { mode: 0o700 }); symlinkSync(target, evidence); }
    else { mkdirSync(evidence, { mode: variant === "mode" ? 0o750 : 0o700 });
      if (variant === "mode") { chmodSync(evidence, 0o750); assert.equal(meta(lstatSync(evidence, { bigint: true })).mode, 0o750); }
      if (variant === "extra") writeFileSync(path.join(s.input.workDirectory, "unexpected"), "preserve", { mode: 0o600 }); }
    const h = harness(s);
    await assert.rejects(verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps), { message: "postgres_local_runtime_restore_storage_invalid" });
    assert.equal(h.calls.length, 0); assert.ok(lstatSync(evidence));
  });
});

test("native engine seals audit-evidence identity and work entries across transport without reading reports", { skip: !linux }, async (t) => {
  for (const variant of ["mode", "replacement", "extra"]) await t.test(variant, async (sub) => {
    const s = await scope(sub); const evidence = path.join(s.input.workDirectory, "audit-evidence"); mkdirSync(evidence, { mode: 0o700 });
    const original = meta(lstatSync(evidence, { bigint: true })); let changed = false;
    const h = harness(s, { transport: (args) => {
      if (changed || args[0] !== "version") return; changed = true;
      if (variant === "mode") chmodSync(evidence, 0o750);
      if (variant === "replacement") { renameSync(evidence, path.join(s.root, "retained-audit-evidence")); mkdirSync(evidence, { mode: 0o700 });
        assert.notEqual(meta(lstatSync(evidence, { bigint: true })).ino, original.ino); }
      if (variant === "extra") writeFileSync(path.join(s.input.workDirectory, "unexpected"), "preserve", { mode: 0o600 });
    } });
    await assert.rejects(verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps), { message: "postgres_local_runtime_restore_cleanup_uncertain" });
    assert.equal(changed, true); assert.equal(h.calls.length, 1); assert.equal(h.calls.some((v) => ["create", "start", "exec"].includes(v.args[0])), false);
    assert.ok(lstatSync(evidence)); assert.deepEqual(readFileSync(path.join(s.input.directory, "candidate.tar")), s.fixture.archive);
  });
});

test("native audit descriptor loss closes the work descriptor and reports cleanup uncertainty", { skip: !linux }, async (t) => {
  const s = await scope(t); const evidence = path.join(s.input.workDirectory, "audit-evidence"); mkdirSync(evidence, { mode: 0o700 }); let workFd;
  const h = harness(s, { transport: (args) => { if (args[0] !== "version") return; workFd = directoryFd(s.input.workDirectory); closeSync(directoryFd(evidence)); } });
  await assert.rejects(verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps), (error) => {
    assert.deepEqual(postgresLocalRuntimeRestoreFailureDiagnostic(error), { code: "postgres_local_runtime_restore_cleanup_uncertain", phase: "CLEANUP", cleanup: "UNVERIFIED" }); return true; });
  assert.equal(h.calls.length, 1); assert.throws(() => fstatSync(workFd), { code: "EBADF" }); assert.ok(lstatSync(evidence));
});

test("native readiness status one and two skip process and executable observation until ready", { skip: !linux }, async (t) => {
  const s = await scope(t); let readinessCalls = 0; const h = harness(s, { transport: (args, _options, state) => {
    if (state.owners.at(-1) !== "SOURCE_START" || args[0] !== "exec" || !args.includes("pg_isready")) return;
    readinessCalls += 1;
    if (readinessCalls <= 2) { assert.equal(state.processCounts.size, 0); return ok("", readinessCalls); }
  } });
  assert.equal((await verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps)).state, "VERIFIED");
  const commands = h.calls.filter((v) => v.phase === "SOURCE_START" && v.args[0] === "exec").map((v) => v.args.includes("pg_isready") ? "readiness" : "process");
  assert.deepEqual(commands, ["readiness", "readiness", "readiness", "process"]); assert.equal(readinessCalls, 3);
});

test("native command environment omits PGSERVICE while authenticated service inheritance stays absent", { skip: !linux }, async (t) => {
  const s = await scope(t); const observed = []; const h = harness(s, { transport: (args, _options, state) => {
    if (args[0] !== "exec") return; const environment = flags(args, "--env"); observed.push(environment);
    const container = [...state.containers.values()].find((value) => args.includes(value.Id));
    assert.equal(container.Config.Env.some((value) => value.startsWith("PGSERVICE=")), false);
    // REL_17_11 libpq treats present-but-empty PGSERVICE as a named service and
    // returns PQPING_NO_ATTEMPT (3) when that section is absent. This is a source
    // behavior model, not a native PostgreSQL client reproduction.
    if (args.includes("pg_isready") && environment.some((value) => value.startsWith("PGSERVICE="))) return ok("", 3);
  } });
  assert.equal((await verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps)).state, "VERIFIED");
  assert.ok(observed.length > 10);
  for (const environment of observed) assert.deepEqual(environment, ["PGSERVICEFILE=/dev/null", "PGSYSCONFDIR=/nonexistent", "PGPASSFILE=/dev/null", "PGPASSWORD=", "PGOPTIONS=", "PGHOSTADDR="]);
});

test("native material with inherited blank or named PGSERVICE is rejected before image loading", { skip: !linux }, async (t) => {
  for (const value of ["", "untrusted-service"]) await t.test(value === "" ? "blank" : "named", async (sub) => {
    const s = await scope(sub, { ...configuration, Env: [...configuration.Env, "PGSERVICE=" + value] }); const h = harness(s);
    await assert.rejects(verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps), { message: "postgres_local_runtime_restore_configuration_invalid" });
    assert.equal(h.calls.some((entry) => entry.args[0] === "image" && entry.args[1] === "load" || ["create", "start", "exec"].includes(entry.args[0])), false);
    assert.deepEqual(h.images, []); assert.equal(h.containers.size, 0); assert.equal(h.volumes.size, 0);
  });
});

test("native command failures identify only fixed source-start families without private output", { skip: !linux }, async (t) => {
  const families = [
    ["volume_create", (args) => args[0] === "volume" && args[1] === "create"],
    ["container_create", (args) => args[0] === "create"], ["start", (args) => args[0] === "start"],
    ["process", (args) => args[0] === "exec" && args.includes("/bin/sh")],
    ["readiness", (args) => args[0] === "exec" && args.includes("pg_isready")],
  ];
  for (const [family, matches] of families) await t.test(family, async (sub) => {
    const s = await scope(sub); const h = harness(s); const base = h.transport; let failed = false;
    h.deps.transport = async (command, args, options) => { const result = await base(command, args, options);
      if (!failed && h.owners.at(-1) === "SOURCE_START" && matches(args.slice(2))) { failed = true;
        return { ...result, status: family === "readiness" ? 3 : 1, stderr: Buffer.from("private password SQL and environment") }; } return result; };
    await assert.rejects(verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps), (error) => {
      const diagnostic = postgresLocalRuntimeRestoreFailureDiagnostic(error);
      assert.deepEqual(diagnostic, { code: `postgres_local_runtime_restore_command_${family}_failed`, phase: "SOURCE_START", cleanup: "CONFIRMED" });
      assert.deepEqual(validatePostgresLocalRuntimeRestoreFailureDiagnostic(diagnostic), diagnostic); assert.equal(JSON.stringify(diagnostic).includes("private"), false);
      assert.deepEqual(Object.keys(error).sort(), ["cleanup", "phase"]); return true; });
    assert.equal(failed, true); assert.equal(h.containers.size, 0); assert.equal(h.volumes.size, 0); assert.deepEqual(h.images, []);
  });
});

test("native family diagnostics preserve audit, ownership, timeout, abort and cleanup priorities", { skip: !linux }, async (t) => {
  for (const reason of ["audit_invalid", "authorization_invalid", "deadline_exceeded", "aborted", "cleanup_uncertain"]) await t.test(reason, async (sub) => {
    const s = await scope(sub); const h = harness(s); const base = h.transport; let failed = false;
    h.deps.transport = async (command, args, options) => {
      const fixed = args.slice(2);
      if (reason === "cleanup_uncertain" && failed && fixed[0] === "container" && fixed[1] === "rm") return { ...ok("", 1, "private cleanup output") };
      const result = await base(command, args, options);
      if (!failed && h.owners.at(-1) === "SOURCE_START" && fixed[0] === "start") { failed = true;
        if (reason === "cleanup_uncertain") return { ...result, status: 1 };
        throw new Error("postgres_local_runtime_restore_" + reason); } return result;
    };
    await assert.rejects(verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps), (error) => {
      assert.deepEqual(postgresLocalRuntimeRestoreFailureDiagnostic(error), { code: "postgres_local_runtime_restore_" + reason,
        phase: reason === "cleanup_uncertain" ? "CLEANUP" : "SOURCE_START", cleanup: reason === "cleanup_uncertain" ? "UNVERIFIED" : "CONFIRMED" }); return true; });
    assert.equal(failed, true);
  });
});

test("native audit stale/future/expired/extra grants refuse create at the actual spawn", { skip: !linux }, async (t) => {
  for (const variant of ["stale", "future", "expired", "extra"]) await t.test(variant, async (sub) => {
    const s = await scope(sub); const h = harness(s, { grant: (ack) => { if (variant === "stale") ack.checkedAt = new Date(Date.now() - 6000).toISOString();
      if (variant === "future") ack.checkedAt = new Date(Date.now() + 1000).toISOString(); if (variant === "expired") ack.validUntil = new Date(Date.now() - 1).toISOString(); if (variant === "extra") ack.raw = "private"; return ack; } });
    await assert.rejects(verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps)); assert.equal(h.calls.filter((v) => v.args[0] === "create").length, 0);
    assert.equal(h.sqlExecs.length, 0); assert.ok(h.images.length === 0 || h.images.length === 1);
  });
});
test("native incomplete load performs neither image removal nor candidate execution", { skip: !linux }, async (t) => {
  const s = await scope(t); const h = harness(s, { transport: (args) => args[1] === "load" ? { ...ok(), error: true } : undefined });
  await assert.rejects(verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps), (error) => { assert.equal(error.cleanup, "UNVERIFIED"); return true; });
  assert.equal(h.calls.filter((v) => ["create", "exec", "start"].includes(v.args[0]) || v.args[0] === "image" && v.args[1] === "rm").length, 0);
});
test("native failed SQL stops the held service before cleanup and never executes another candidate", { skip: !linux }, async (t) => {
  const s = await scope(t); let failed = false; const h = harness(s, { transport: (args) => { if (!failed && args[0] === "exec" && args.includes("createdb")) { failed = true; return { ...ok("private stdout", 1), error: true }; } } });
  await assert.rejects(verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps), (error) => { assert.equal(error.cleanup, "CONFIRMED"); assert.equal(error.phase, "SOURCE_SQL"); assert.ok(!error.message.includes("private")); return true; });
  const index = h.calls.findIndex((v) => v.args[0] === "exec" && v.args.includes("createdb")); assert.ok(h.calls.slice(index + 1).some((v) => v.args[0] === "stop"));
  assert.equal(h.calls.slice(index + 1).filter((v) => ["exec", "create", "start"].includes(v.args[0])).length, 0);
});
test("native profile, UID, capabilities, tools, SQL, cleanup and source mutations fail closed", { skip: !linux }, async (t) => {
  for (const variant of ["profile", "uid", "nnp", "caps", "exe", "tools", "sql", "cleanup", "source"]) await t.test(variant, async (sub) => {
    const s = await scope(sub); const h = harness(s, { transport: (args, _options, state) => {
      if (variant === "source" && args[0] === "image" && args[1] === "load") chmodSync(path.join(s.input.directory, "candidate.tar"), 0o644);
      if (variant === "profile" && args[0] === "container" && args[1] === "inspect" && state.containers.size) { const item = [...state.containers.values()][0]; item.HostConfig.Privileged = true; }
      if (["uid", "nnp", "caps", "exe"].includes(variant) && args[0] === "exec" && args.includes("/bin/sh")) return ok(`uid=${variant === "uid" ? "70 0 70 70" : "70 70 70 70"}\ngid=70 70 70 70\nnnp=${variant === "nnp" ? 0 : 1}\ncapinh=0000000000000000\ncapprm=0000000000000000\ncapeff=${variant === "caps" ? "0000000000000001" : "0000000000000000"}\ncapamb=0000000000000000\nexe=${variant === "exe" ? "/bin/sh" : "/usr/local/bin/postgres"}\n`);
      if (variant === "tools" && args.includes("--version")) return ok("pg_dump (PostgreSQL) 17.10\n");
      if (variant === "sql" && args.at(-1).startsWith("SELECT json_build_object")) return ok(bytes({ ...postgresLocalSqlExpectedData, rolled_back_count: 1 }));
      if (variant === "cleanup" && args[0] === "container" && args[1] === "rm") return ok("", 1, "private raw error");
    } });
    await assert.rejects(verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps), (error) => { assert.ok(!error.message.includes("private")); assert.equal(Object.keys(error).sort().join(","), "cleanup,phase"); return true; });
  });
});
test("native root/bash initialization waits for final PostgreSQL before all SQL", { skip: !linux }, async (t) => {
  const s = await scope(t); const counts = new Map(); const h = harness(s, { transport: (args) => {
    if (args[0] !== "exec" || !args.includes("/bin/sh")) return; const id = args.find((v) => /^[0-9]{64}$/u.test(v)); const count = (counts.get(id) ?? 0) + 1; counts.set(id, count);
    if (count < 3) return ok(`uid=${count === 1 ? "0 0 0 0" : "70 70 70 70"}\ngid=${count === 1 ? "0 0 0 0" : "70 70 70 70"}\nnnp=1\ncapinh=0000000000000000\ncapprm=0000000000000000\ncapeff=0000000000000000\ncapamb=0000000000000000\n${count === 1 ? "" : "exe=/bin/bash\n"}`);
  } });
  assert.equal((await verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps)).state, "VERIFIED");
  for (const count of counts.values()) assert.equal(count, 3);
});
test("native audit grant is checked again after transport delay immediately at spawn", { skip: !linux }, async (t) => {
  const s = await scope(t); const h = harness(s, { grant: (ack) => ({ ...ack, checkedAt: new Date(Date.now() - 4900).toISOString() }) });
  const guarded = h.transport;
  h.deps.transport = async (command, args, options) => { if (args[2] === "create") await new Promise((resolve) => setTimeout(resolve, 150)); return guarded(command, args, options); };
  await assert.rejects(verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps));
  assert.equal(h.calls.filter((v) => v.args[0] === "create").length, 0); assert.equal(h.sqlExecs.length, 0);
});
test("native owner acknowledgements remain closed before and after every operation", { skip: !linux }, async (t) => {
  for (const variant of ["before", "after"]) await t.test(variant, async (sub) => {
    const s = await scope(sub); const h = harness(s, { authorize: (_phase, state) => state.owners.length === (variant === "before" ? 1 : 2)
      ? { state: "VERIFIED", purpose: "COLD_LOAD_ONLY", raw: "private" } : undefined });
    await assert.rejects(verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps));
    assert.equal(h.calls.filter((v) => v.args[0] === "create").length, 0); assert.equal(h.sqlExecs.length, 0);
  });
});
test("native durable bash initialization aborts with two execs and three commands per poll", { skip: !linux }, async (t) => {
  const s = await scope(t); const controller = new globalThis.AbortController(); s.input.signal = controller.signal;
  const h = harness(s, { transport: (args) => { if (args[0] === "exec" && args.includes("/bin/sh")) { setTimeout(() => controller.abort(), 30);
    return ok("uid=70 70 70 70\ngid=70 70 70 70\nnnp=1\ncapinh=0000000000000000\ncapprm=0000000000000000\ncapeff=0000000000000000\ncapamb=0000000000000000\nexe=/bin/bash\n"); } } });
  await assert.rejects(verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps)); assert.equal(h.sqlExecs.length, 0);
  const process = h.calls.findIndex((v) => v.args[0] === "exec" && v.args.includes("/bin/sh"));
  assert.deepEqual(h.calls.slice(process - 2, process + 1).map((v) => v.args[0]), ["container", "exec", "exec"]);
  assert.ok(h.calls[process - 1].args.includes("pg_isready"));
  assert.equal(h.calls.filter((v) => v.args[0] === "exec").length, 2); assert.equal(h.containers.size, 0);
});
test("native interrupted restore is stopped before any subsequent candidate command", { skip: !linux }, async (t) => {
  const s = await scope(t); const h = harness(s, { transport: (args) => args[0] === "exec" && args.includes("--single-transaction") ? { ...ok("", 0), error: true } : undefined });
  await assert.rejects(verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps), (error) => { assert.equal(error.phase, "RESTORE_SQL"); assert.equal(error.cleanup, "CONFIRMED"); return true; });
  const failed = h.calls.findIndex((v) => v.args.includes("--single-transaction")); assert.equal(h.calls.slice(failed + 1).some((v) => ["exec", "start", "create"].includes(v.args[0])), false);
  assert.ok(h.calls.slice(failed + 1).some((v) => v.args[0] === "stop")); assert.deepEqual(readdirSync(s.input.workDirectory), ["backup"]);
});

test("native restore refuses a nonempty target schema before importing SQL", { skip: !linux }, async (t) => {
  const s = await scope(t); const h = harness(s, { transport: (args) => args.at(-1) === "SELECT count(*) FROM pg_catalog.pg_namespace WHERE nspname = 'aw_probe';" ? ok("1\n") : undefined });
  await assert.rejects(verifyLocalPostgresRuntimeAndSqlRestore(s.input, h.controls, h.deps), (error) => { assert.equal(error.phase, "RESTORE_SQL"); assert.equal(error.cleanup, "CONFIRMED"); return true; });
  assert.equal(h.calls.some((v) => v.args.includes("--single-transaction")), false);
});
