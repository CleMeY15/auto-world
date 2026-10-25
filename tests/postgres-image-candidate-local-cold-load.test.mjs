import assert from "node:assert/strict";
import childProcess, { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs, { chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createServer } from "node:net";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { coldLoadPostgresCandidate, postgresColdLoadFailureDiagnostic, validatePostgresCandidateColdLoadProof }
  from "../scripts/postgres-image/candidate-local-cold-load.mjs";
import { retainedFixture } from "./fixtures/postgres-private-retention.mjs";

const linux = process.platform === "linux" && process.getuid() > 0 && process.getgid() > 0;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));
const bytes = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
function statMetadata(stat) { return { dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid), gid: Number(stat.gid), mode: Number(stat.mode & 0o7777n) }; }
function descriptor(file, name) { const stat = lstatSync(file, { bigint: true }); return { name, size: Number(stat.size), sha256: hash(readFileSync(file)),
  identity: { ...statMetadata(stat), nlink: Number(stat.nlink), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) } }; }
function valueFor(fixture, directory, files, identity) {
  return { directory, files, archiveProof: fixture.proof, policy: fixture.policy, originalRecipeRevision: fixture.recipeRevision,
    originalExecutionId: `local-${fixture.runId}`, recipeRevision: "b".repeat(40), executionId: "local-cold-load-" + "d".repeat(24), identity };
}
function pureInput() {
  const fixture = retainedFixture(); const identity = { endpoint: "unix:///var/tmp/awcl-fixture/endpoint/docker.sock", daemonId: "owned-daemon",
    dataRoot: "/var/tmp/awcl-fixture/infra/data", containerdAddress: "/run/containerd/containerd.sock", containersNamespace: "awcl-fixture",
    pluginsNamespace: "plugins.awcl-fixture", dockerConfig: "/home/autoworld/owned-client", contextName: "aw-cold-fixture",
    socket: { dev: "1", ino: "3", uid: 0, gid: 1000, mode: 0o660 }, socketDirectory: { dev: "1", ino: "4", uid: 0, gid: 1000, mode: 0o710 } };
  const files = [{ name: "candidate.tar", size: fixture.archive.length, sha256: hash(fixture.archive) },
    { name: "retention-receipt.json", size: fixture.receiptBytes.length, sha256: hash(fixture.receiptBytes) }].map((v, index) => ({ ...v,
    identity: { dev: "1", ino: String(index + 10), uid: 1000, gid: 1000, mode: 0o600, nlink: 1, mtimeNs: "1", ctimeNs: "1" } }));
  return valueFor(fixture, "/home/autoworld/owned-import", files, identity);
}
function pureProof(input = pureInput()) {
  return { kind: "POSTGRES_CANDIDATE_COLD_LOAD_PROOF_V1", state: "COLD_LOADED_AND_REMOVED", authority: "LOCAL_DIAGNOSTIC",
    recipeRevision: input.recipeRevision, executionId: input.executionId, originalRecipeRevision: input.originalRecipeRevision,
    originalExecutionId: input.originalExecutionId, directory: input.directory, files: input.files, archiveProof: input.archiveProof,
    identity: input.identity, filesystem: "EXT4", subject: input.policy.subject, imageId: input.policy.candidate.imageId,
    diffIds: input.policy.candidate.diffIds, tag: input.archiveProof.tag, configurationComparison: "EXACT_ARCHIVE_CONFIGURATION",
    inventories: { initial: { images: 0, containers: 0, volumes: 0 }, loaded: { images: 1, containers: 0, volumes: 0 }, final: { images: 0, containers: 0, volumes: 0 } },
    cleanup: "OWNED_IMAGE_REMOVED", phases: ["archive_before_load", "engine_preflight", "archive_load", "loaded_image", "archive_after_load",
      "owned_image_remove", "final_seal"].map((name) => ({ name, result: "PASSED", durationMs: 0 })),
    imageExecution: "NOT_ATTEMPTED", serviceRestore: "NOT_ATTEMPTED", sqlRestore: "NOT_ATTEMPTED", registryRead: "NOT_ATTEMPTED",
    registryWrite: "NOT_ATTEMPTED", signing: "NOT_ATTEMPTED", admission: "NOT_AUTHORIZED", supportStartedAt: null, supportEndsAt: null, archiveUntil: null };
}
async function scope(t) {
  const root = mkdtempSync("/tmp/aw-pg-cold-load-"); chmodSync(root, 0o700);
  const directory = path.join(root, "imported"); const client = path.join(root, "client"); const socketDirectory = path.join(root, "endpoint");
  const contextName = "aw-cold-fixture"; const meta = path.join(client, "contexts", "meta", hash(Buffer.from(contextName)));
  for (const file of [directory, client, path.join(client, "contexts"), path.join(client, "contexts", "meta"), meta, socketDirectory]) mkdirSync(file, { mode: 0o700 });
  const socket = path.join(socketDirectory, "docker.sock"); const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(socket, resolve); });
  chmodSync(socket, 0o660); chmodSync(socketDirectory, 0o710); server.unref();
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); rmSync(root, { recursive: true }); });
  const fixture = retainedFixture();
  writeFileSync(path.join(directory, "candidate.tar"), fixture.archive, { mode: 0o600 });
  writeFileSync(path.join(directory, "retention-receipt.json"), fixture.receiptBytes, { mode: 0o600 });
  const endpoint = "unix://" + socket;
  writeFileSync(path.join(client, "config.json"), bytes({ currentContext: contextName }), { mode: 0o600 });
  writeFileSync(path.join(meta, "meta.json"), bytes({ Name: contextName, Metadata: {}, Endpoints: { docker: { Host: endpoint, SkipTLSVerify: false } } }), { mode: 0o600 });
  const identity = { endpoint, daemonId: "owned-daemon", dataRoot: path.join(root, "infra", "data"), containerdAddress: "/run/containerd/containerd.sock",
    containersNamespace: "awcl-fixture", pluginsNamespace: "plugins.awcl-fixture", dockerConfig: client, contextName,
    socket: statMetadata(lstatSync(socket, { bigint: true })), socketDirectory: statMetadata(lstatSync(socketDirectory, { bigint: true })) };
  const files = ["candidate.tar", "retention-receipt.json"].map((name) => descriptor(path.join(directory, name), name));
  const input = valueFor(fixture, directory, files, identity);
  return { root, input, fixture, client, meta, socket, socketDirectory, archive: path.join(directory, "candidate.tar") };
}
function harness(s, hooks = {}) {
  const h = { calls: [], authorizations: [], imageCount: 0, loadStdin: null };
  h.inspect = { Id: s.input.policy.candidate.imageId, Os: "linux", Architecture: "amd64", RepoTags: [s.input.archiveProof.tag], RepoDigests: [],
    Size: s.fixture.archive.length, RootFS: { Type: "layers", Layers: s.input.policy.candidate.diffIds },
    Config: { Entrypoint: ["docker-entrypoint.sh"], Cmd: ["postgres"], WorkingDir: "/" } };
  h.info = { ID: s.input.identity.daemonId, DockerRootDir: s.input.identity.dataRoot, ServerVersion: "28.0.4", Driver: "overlay2", OSType: "linux",
    Architecture: "x86_64", Containerd: { Address: s.input.identity.containerdAddress,
      Namespaces: { Containers: s.input.identity.containersNamespace, Plugins: s.input.identity.pluginsNamespace } } };
  h.authorize = async (phase) => {
    h.authorizations.push(phase); if (hooks.authorize) { const replacement = await hooks.authorize(phase, h); if (replacement !== undefined) return replacement; }
    return { state: "VERIFIED", purpose: "COLD_LOAD_ONLY", phase, daemonId: s.input.identity.daemonId, endpoint: s.input.identity.endpoint };
  };
  h.transport = async (command, rawArgs, options) => {
    assert.equal(command, "/usr/bin/docker"); assert.deepEqual(rawArgs.slice(0, 2), ["--host", s.input.identity.endpoint]);
    assert.equal(options.env.DOCKER_CONFIG, s.client); assert.equal(options.env.DOCKER_HOST, undefined); assert.equal(options.env.GITHUB_TOKEN, undefined);
    const args = rawArgs.slice(2); h.calls.push(args);
    if (hooks.transport) { const replacement = await hooks.transport(args, options, h); if (replacement !== undefined) return replacement; }
    let stdout = Buffer.alloc(0);
    if (args[0] === "version") stdout = Buffer.from("28.0.4|28.0.4\n");
    else if (args[0] === "info") stdout = bytes(h.info);
    else if (args[0] === "image" && args[1] === "ls") stdout = Buffer.from(h.imageCount ? s.input.policy.candidate.imageId + "\n" : "");
    else if (args[0] === "image" && args[1] === "load") {
      assert.ok(Number.isSafeInteger(options.inputFd));
      const child = spawnSync(process.execPath, ["--input-type=module", "-e",
        "import{readFileSync}from'node:fs';import{createHash}from'node:crypto';const b=readFileSync(0);process.stdout.write(JSON.stringify({size:b.length,sha256:createHash('sha256').update(b).digest('hex')}));"],
      { stdio: [options.inputFd, "pipe", "pipe"], timeout: 10_000, encoding: null, env: { PATH: "/usr/bin:/bin" } });
      assert.equal(child.status, 0); assert.equal(child.stderr.length, 0); h.loadStdin = JSON.parse(child.stdout.toString()); h.imageCount = 1;
      stdout = Buffer.from("Loaded image: " + s.input.archiveProof.tag + "\n");
    } else if (args[0] === "image" && args[1] === "inspect") stdout = bytes(h.inspect);
    else if (args[0] === "image" && args[1] === "rm") { assert.equal(args.length, 3); assert.equal(args[2], s.input.archiveProof.tag); h.imageCount = 0; }
    else assert.ok(["container", "volume"].includes(args[0]));
    return { status: 0, stdout, stderr: Buffer.alloc(0) };
  };
  return h;
}
const removed = (h) => h.calls.filter((v) => v[0] === "image" && v[1] === "rm");
const loaded = (h) => h.calls.filter((v) => v[0] === "image" && v[1] === "load");

test("pure cold-load proof is closed, bound and usable without claiming native execution", async (t) => {
  const input = pureInput(); const value = pureProof(input);
  assert.deepEqual(validatePostgresCandidateColdLoadProof(value, input), value);
  assert.ok(Object.isFrozen(validatePostgresCandidateColdLoadProof(value, input).files));
  for (const mutate of [
    (v) => { v.extra = "private"; }, (v) => { v.recipeRevision = "f".repeat(40); }, (v) => { v.tag = "different"; },
    (v) => { v.identity.endpoint = "unix:///var/run/docker.sock"; }, (v) => { v.diffIds.reverse(); },
    (v) => { v.configurationComparison = "PARTIAL"; }, (v) => { v.inventories.loaded.volumes = 1; },
    (v) => { v.cleanup = "UNVERIFIED"; }, (v) => { v.imageExecution = "VERIFIED"; }, (v) => { v.phases[0].result = "FAILED"; },
    (v) => { v.files[0].identity.ino = "99"; }, (v) => { v.archiveProof.rawLayers.pop(); },
    (v) => { v.archiveProof.extra = true; }, (v) => { v.supportStartedAt = "2026-09-30"; },
  ]) await t.test(String(mutate), () => { const changed = clone(value); mutate(changed); assert.throws(() =>
    validatePostgresCandidateColdLoadProof(changed, input), /postgres_local_cold_load_proof_invalid/u); });
});

test("failure diagnostics capture message once, close arbitrary errors and expose no raw properties", () => {
  let reads = 0; const changing = new Error(); Object.defineProperty(changing, "message", { get() { return ++reads === 1
    ? "postgres_local_cold_load_command_failed" : "private token"; } }); changing.phase = "BEFORE_LOAD";
  assert.deepEqual(postgresColdLoadFailureDiagnostic(changing), { code: "postgres_local_cold_load_command_failed", phase: "BEFORE_LOAD", cleanup: "UNVERIFIED" });
  assert.equal(reads, 1); const throwing = new Error(); Object.defineProperty(throwing, "message", { get() { throw new Error("private"); } });
  assert.deepEqual(postgresColdLoadFailureDiagnostic(throwing), { code: "postgres_local_cold_load_operation_failed", phase: "CONTEXT", cleanup: "UNVERIFIED" });
  assert.deepEqual(postgresColdLoadFailureDiagnostic(new Error("private stdout")), { code: "postgres_local_cold_load_operation_failed", phase: "CONTEXT", cleanup: "UNVERIFIED" });
});

test("native nonroot cold load consumes held FD from zero, fully verifies, removes its alias and seals", { skip: !linux }, async (t) => {
  const s = await scope(t); const h = harness(s); const before = readFileSync(s.archive);
  const proof = await coldLoadPostgresCandidate(s.input, { authorize: h.authorize, transport: h.transport });
  assert.deepEqual(h.loadStdin, { size: s.fixture.archive.length, sha256: hash(s.fixture.archive) });
  assert.equal(loaded(h).length, 1); assert.equal(removed(h).length, 1); assert.equal(h.authorizations.length, h.calls.length * 2);
  assert.deepEqual(proof, validatePostgresCandidateColdLoadProof(proof, s.input));
  assert.deepEqual(readFileSync(s.archive), before); assert.equal(proof.imageExecution, "NOT_ATTEMPTED");
  assert.deepEqual(fs.readdirSync(s.input.directory).sort(), ["candidate.tar", "retention-receipt.json"]);
});

test("the explicit authenticated DOCKER_CONFIG is accepted without a host/context fallback", { skip: !linux }, async (t) => {
  const s = await scope(t); const h = harness(s); const previous = process.env.DOCKER_CONFIG; process.env.DOCKER_CONFIG = s.client;
  try { assert.equal((await coldLoadPostgresCandidate(s.input, { authorize: h.authorize, transport: h.transport })).state, "COLD_LOADED_AND_REMOVED"); }
  finally { if (previous === undefined) delete process.env.DOCKER_CONFIG; else process.env.DOCKER_CONFIG = previous; }
});

test("failed, incomplete, overflowing, aborted or timed-out load never attempts image rm", { skip: !linux }, async (t) => {
  for (const outcome of [
    { status: 1 }, { status: null, error: true }, { status: 0, signal: "SIGKILL" }, { status: 0, error: true },
    { status: 0, stdout: Buffer.alloc(1024 ** 2 + 1) }, { status: 0, stdout: "raw" },
  ]) await t.test(String(outcome.status) + ":" + Object.keys(outcome), async (sub) => {
    const s = await scope(sub); const h = harness(s, { transport: (args) => args[1] === "load"
      ? { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), ...outcome } : undefined });
    await assert.rejects(coldLoadPostgresCandidate(s.input, { authorize: h.authorize, transport: h.transport }), /postgres_local_cold_load_command_failed/u);
    assert.equal(removed(h).length, 0); assert.equal(h.authorizations.length, h.calls.length * 2);
  });
  await t.test("abort pending load", async (sub) => {
    const s = await scope(sub); const controller = new globalThis.AbortController(); s.input.signal = controller.signal;
    const h = harness(s, { transport: (args) => { if (args[1] === "load") { setTimeout(() => controller.abort(), 5); return new Promise(() => {}); } } });
    await assert.rejects(coldLoadPostgresCandidate(s.input, { authorize: h.authorize, transport: h.transport }), /postgres_local_cold_load_aborted/u);
    assert.equal(removed(h).length, 0); assert.equal(h.authorizations.length, h.calls.length * 2);
  });
});

test("default transport closes spawn/pipe errors and bounds abort even when child close never arrives", { skip: !linux }, async (t) => {
  for (const scenario of ["spawn-error", "stdout-error", "stderr-error", "abort-no-close"]) await t.test(scenario, async (sub) => {
    const s = await scope(sub); const h = harness(s); const original = childProcess.spawn; const children = []; const controller = new globalThis.AbortController();
    s.input.signal = controller.signal;
    childProcess.spawn = (command, rawArgs, options) => {
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = null;
      child.signals = []; child.kill = (signal) => { child.signals.push(signal); if (scenario !== "abort-no-close") {
        Promise.resolve().then(() => child.emit("close", null, signal)); } return true; };
      children.push(child);
      Promise.resolve().then(async () => {
        if (rawArgs[3] === "load") {
          h.calls.push(rawArgs.slice(2));
          if (scenario === "spawn-error") child.emit("error", new Error("private spawn detail"));
          else if (scenario === "abort-no-close") controller.abort();
          else child[scenario === "stdout-error" ? "stdout" : "stderr"].emit("error", new Error("private pipe detail"));
          return;
        }
        const value = await h.transport(command, rawArgs, options); child.stdout.end(value.stdout); child.stderr.end(value.stderr); child.emit("close", value.status, null);
      });
      return child;
    };
    syncBuiltinESMExports();
    try { await assert.rejects(coldLoadPostgresCandidate(s.input, { authorize: h.authorize }), (error) => {
      assert.equal(error.cleanup, "UNVERIFIED"); assert.ok(!error.message.includes("private")); return true;
    }); } finally { childProcess.spawn = original; syncBuiltinESMExports(); }
    assert.equal(removed(h).length, 0); assert.equal(h.authorizations.length, h.calls.length * 2);
    const failed = children.at(-1);
    if (scenario !== "spawn-error") assert.ok(failed.signals.includes("SIGKILL"));
    await new Promise((resolve) => setTimeout(resolve, scenario === "abort-no-close" ? 1100 : 0));
    assert.ok(failed.stdout.destroyed); assert.ok(failed.stderr.destroyed);
  });
});

test("loaded image rejects substituted complete Config, ID, platform, layer order, aliases or RepoDigests", { skip: !linux }, async (t) => {
  for (const mutate of [
    (v) => { v.Config.WorkingDir = "/different"; }, (v) => { v.Config.Env = ["PRIVATE=not-allowed"]; },
    (v) => { v.Id = "sha256:" + "f".repeat(64); }, (v) => { v.Os = "windows"; }, (v) => { v.Architecture = "arm64"; },
    (v) => { v.RootFS.Layers = [...v.RootFS.Layers].reverse(); }, (v) => { v.RepoTags.push("foreign:tag"); },
    (v) => { v.RepoDigests = ["ghcr.io/other@sha256:" + "f".repeat(64)]; },
  ]) await t.test(String(mutate), async (sub) => { const s = await scope(sub); const h = harness(s); mutate(h.inspect);
    await assert.rejects(coldLoadPostgresCandidate(s.input, { authorize: h.authorize, transport: h.transport }), /postgres_local_cold_load_image_invalid/u);
    assert.equal(removed(h).length, 0); });
  for (const digests of [null, undefined]) await t.test("save RepoDigests " + String(digests), async (sub) => {
    const s = await scope(sub); const h = harness(s); h.inspect.RepoDigests = digests;
    assert.equal((await coldLoadPostgresCandidate(s.input, { authorize: h.authorize, transport: h.transport })).state, "COLD_LOADED_AND_REMOVED");
  });
});

test("native identity, inventory, configuration and authorization changes fail before mutations", { skip: !linux }, async (t) => {
  for (const change of [
    (s) => chmodSync(s.socket, 0o600), (s) => chmodSync(s.socketDirectory, 0o700),
    (s) => chmodSync(s.client, 0o755), (s) => writeFileSync(path.join(s.client, "config.json"), bytes({ currentContext: "default" })),
    (s) => writeFileSync(path.join(s.meta, "meta.json"), bytes({ Endpoints: { docker: { Host: "unix:///var/run/docker.sock" } } })),
  ]) await t.test(String(change), async (sub) => { const s = await scope(sub); const h = harness(s); change(s);
    await assert.rejects(coldLoadPostgresCandidate(s.input, { authorize: h.authorize, transport: h.transport }), /postgres_local_cold_load_/u);
    assert.equal(loaded(h).length, 0); assert.equal(removed(h).length, 0); });
  for (const change of [
    (h) => { h.imageCount = 1; }, (h) => { h.info.ID = "principal"; }, (h) => { h.info.ServerVersion = "28.0.3"; },
    (h) => { h.info.Containerd.Namespaces.Plugins = "plugins.moby"; },
  ]) await t.test(String(change), async (sub) => { const s = await scope(sub); const h = harness(s); change(h);
    await assert.rejects(coldLoadPostgresCandidate(s.input, { authorize: h.authorize, transport: h.transport }), /postgres_local_cold_load_/u);
    assert.equal(loaded(h).length, 0); assert.equal(removed(h).length, 0); });
  await t.test("closed authorization ack", async (sub) => { const s = await scope(sub); const h = harness(s, { authorize: () => ({ state: "VERIFIED", raw: "private" }) });
    await assert.rejects(coldLoadPostgresCandidate(s.input, { authorize: h.authorize, transport: h.transport }), /postgres_local_cold_load_authorization_invalid/u);
    assert.equal(h.calls.length, 0); });
});

test("native source hardlink, symlink, inode, bytes, mode and timed substitution are rejected", { skip: !linux }, async (t) => {
  for (const change of [
    (s) => linkSync(s.archive, path.join(s.root, "linked")), (s) => { renameSync(s.archive, s.archive + ".old"); symlinkSync(s.archive + ".old", s.archive); },
    (s) => { renameSync(s.archive, s.archive + ".old"); writeFileSync(s.archive, s.fixture.archive, { mode: 0o600 }); },
    (s) => writeFileSync(s.archive, Buffer.from("invalid")), (s) => chmodSync(s.archive, 0o644),
  ]) await t.test(String(change), async (sub) => { const s = await scope(sub); const h = harness(s); change(s);
    await assert.rejects(coldLoadPostgresCandidate(s.input, { authorize: h.authorize, transport: h.transport }), /postgres_local_cold_load_/u);
    assert.equal(loaded(h).length, 0); assert.equal(removed(h).length, 0); });
  for (const trigger of ["BEFORE_LOAD", "AFTER_LOAD", "BEFORE_REMOVE", "AFTER_REMOVE"]) await t.test("change during " + trigger, async (sub) => {
    const s = await scope(sub); let changed = false; const h = harness(s, { authorize: (phase) => {
      if (phase === trigger && !changed) { changed = true; chmodSync(s.archive, 0o644); }
    } });
    await assert.rejects(coldLoadPostgresCandidate(s.input, { authorize: h.authorize, transport: h.transport }), /postgres_local_cold_load_/u);
    assert.equal(removed(h).length, trigger === "AFTER_REMOVE" ? 1 : 0);
  });
});

test("fresh profile before removal, removal error and final inventory prevent successful proof", { skip: !linux }, async (t) => {
  for (const name of ["profile", "remove", "final"]) await t.test(name, async (sub) => {
    const s = await scope(sub); const h = harness(s, {
      authorize: (phase, state) => { if (name === "profile" && phase === "BEFORE_REMOVE") state.inspect.Config.Cmd = ["foreign"]; },
      transport: (args, _options, state) => {
        if (name === "remove" && args[1] === "rm") return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("private daemon log") };
        if (name === "final" && state.calls.some((v) => v[1] === "rm") && args[1] === "ls") {
          return { status: 0, stdout: Buffer.from(s.input.policy.candidate.imageId + "\n"), stderr: Buffer.alloc(0) };
        }
      },
    });
    await assert.rejects(coldLoadPostgresCandidate(s.input, { authorize: h.authorize, transport: h.transport }), (error) => {
      assert.deepEqual(Object.keys(error).sort(), ["cleanup", "phase"]); assert.equal(error.cleanup, "UNVERIFIED");
      assert.ok(!error.message.includes("private")); return true;
    });
    assert.equal(removed(h).length, name === "profile" ? 0 : 1);
  });
});

test("native malformed input and ambient routing never invoke Docker", { skip: !linux }, async (t) => {
  for (const change of [
    (v) => { v.extra = true; }, (v) => { v.files[0].identity.nlink = 2; }, (v) => { v.archiveProof.rawLayers.pop(); },
    (v) => { v.archiveProof.compatibilityRecords[0].rich = true; }, (v) => { v.archiveProof.configBytes++; },
    (v) => { v.identity.endpoint = "tcp://localhost:2375"; }, (v) => { v.policy.candidate.diffIds.pop(); },
  ]) await t.test(String(change), async (sub) => { const s = await scope(sub); const h = harness(s); const value = globalThis.structuredClone(s.input); change(value);
    await assert.rejects(coldLoadPostgresCandidate(value, { authorize: h.authorize, transport: h.transport }), /postgres_local_cold_load_/u);
    assert.equal(h.calls.length, 0); });
  for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"]) await t.test(key, async (sub) => {
    const s = await scope(sub); const h = harness(s); const previous = process.env[key]; process.env[key] = "foreign";
    try { await assert.rejects(coldLoadPostgresCandidate(s.input, { authorize: h.authorize, transport: h.transport }), /postgres_local_cold_load_context_invalid/u); }
    finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }
    assert.equal(h.calls.length, 0);
  });
});

test("descriptor cleanup failure has priority and discloses no raw filesystem error", { skip: !linux }, async (t) => {
  const s = await scope(t); const h = harness(s); const original = fs.closeSync; let changed = false;
  fs.closeSync = (fd) => { original(fd); if (!changed) { changed = true; throw new Error("private filesystem content"); } };
  syncBuiltinESMExports();
  try { await assert.rejects(coldLoadPostgresCandidate(s.input, { authorize: h.authorize, transport: h.transport }), (error) => {
    assert.deepEqual(postgresColdLoadFailureDiagnostic(error), { code: "postgres_local_cold_load_descriptor_cleanup_failed", phase: "CLEANUP", cleanup: "UNVERIFIED" }); return true;
  }); } finally { fs.closeSync = original; syncBuiltinESMExports(); }
});
