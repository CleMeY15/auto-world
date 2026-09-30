import assert from "node:assert/strict";
import { chownSync, chmodSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import test from "node:test";
import { postgresRuntimeDaemonFailureDiagnostic, postgresRuntimeDaemonRemaining, startPostgresRuntimeDaemonLease,
  validatePostgresRuntimeDaemonInfo, validatePostgresRuntimeDaemonInventory, validatePostgresRuntimeDaemonLeaseInput,
  validatePostgresRuntimeDaemonRoutingEnvironment, validatePostgresRuntimeDaemonStartProof, validatePostgresRuntimeDaemonStopProof } from "../scripts/docker-isolated/daemon-postgres-runtime.mjs";

const image = "sha256:8453b2e3ea76734a5c5df6cd8bf17799880c4ed974e2e136dbf849254f96cdda";
const candidate = { imageId: image, tag: "aw-postgres-gosu:b68df0be74e29101c808d0ab" };
const inherited = { "com.auto-world.postgres-diagnostic": "94c2d4878c445bef8d51ff7c",
  "com.auto-world.postgres-diagnostic-purpose": "gosu-correction-runtime" };
const principal = { id: "principal-daemon", root: "/var/lib/docker", containerdAddress: "/run/containerd/containerd.sock",
  containersNamespace: "moby", pluginsNamespace: "plugins.moby", imageIds: [`sha256:${"b".repeat(64)}`, `sha256:${"c".repeat(64)}`] };
const input = () => ({ purpose: "POSTGRES_RUNTIME_SQL_RESTORE", parent: "/var/tmp/aw-pr-AbCd12", nonce: "1".repeat(24), principal, candidate });
const expected = { id: "owned-daemon", root: "/var/tmp/aw-pr-AbCd12/infra/data", containerdAddress: principal.containerdAddress,
  containersNamespace: `awpgsql-${"1".repeat(24)}`, pluginsNamespace: `plugins.awpgsql-${"1".repeat(24)}` };
const info = () => ({ ID: expected.id, ServerVersion: "28.0.4", DockerRootDir: expected.root, Driver: "overlay2", OSType: "linux",
  Architecture: "x86_64", Containerd: { Address: expected.containerdAddress,
    Namespaces: { Containers: expected.containersNamespace, Plugins: expected.pluginsNamespace } } });
test("SQL restore lease input is fixed-purpose, scoped, disjoint from the principal and frozen", () => {
  const result = validatePostgresRuntimeDaemonLeaseInput(input()); assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.candidate), true); assert.deepEqual(result.principal.imageIds, principal.imageIds);
});
for (const [name, change] of [
  ["image execution purpose", { purpose: "RUNTIME" }], ["old probe purpose", { purpose: "EMPTY_DAEMON_PROBE" }],
  ["unknown argument", { command: "/bin/sh" }], ["escaped parent", { parent: "/var/tmp/aw-pr-AbCd12/../foreign" }],
  ["old root", { parent: "/var/tmp/aw-dp-AbCd12" }], ["invalid nonce", { nonce: "../foreign" }],
  ["principal candidate collision", { candidate: { ...candidate, imageId: principal.imageIds[0] } }],
  ["unknown principal namespace", { principal: { ...principal, pluginsNamespace: "other" } }],
  ["extra candidate property", { candidate: { ...candidate, force: true } }],
  ["another valid candidate ID", { candidate: { ...candidate, imageId: `sha256:${"1".repeat(64)}` } }],
  ["another valid candidate alias", { candidate: { ...candidate, tag: `aw-postgres-gosu:${"a".repeat(24)}` } }],
  ["cold-load purpose", { purpose: "COLD_LOAD_ONLY" }],
]) test(`lease input rejects ${name}`, () => assert.throws(() => validatePostgresRuntimeDaemonLeaseInput({ ...input(), ...change }), /daemon_postgres_runtime_context_invalid/u));
test("native lease rejects actual nonroot/Windows before any helper invocation; a bad purpose always rejects", async () => {
  let starts = 0; const helper = { start: async () => { starts++; }, verify: async () => {}, stop: async () => {} };
  const value = input();
  if (process.platform === "linux" && process.getuid?.() === 0 && process.getgid?.() === 0) value.purpose = "RUNTIME";
  await assert.rejects(startPostgresRuntimeDaemonLease(value, { helper }), /daemon_postgres_runtime_context_invalid/u); assert.equal(starts, 0);
});
test("root/helper start proof rejects missing/foreign ownership before a PID can be used", () => {
  const proof = { pid: 4242, startTicks: "12345", daemonId: "owned-daemon", namespacesFresh: true };
  assert.deepEqual(validatePostgresRuntimeDaemonStartProof(proof, principal.id), proof);
  for (const change of [{ pid: 1 }, { pid: "4242" }, { startTicks: "0" }, { daemonId: principal.id }, { namespacesFresh: false }, { extra: true }]) {
    assert.throws(() => validatePostgresRuntimeDaemonStartProof({ ...proof, ...change }, principal.id), /daemon_postgres_runtime_helper_invalid/u);
  }
});
test("owned info proves version/profile/containerd and both namespaces with no fallback", () => {
  assert.deepEqual(validatePostgresRuntimeDaemonInfo(info(), expected), { daemonId: expected.id, version: "28.0.4" });
  for (const change of [{ ID: principal.id }, { ServerVersion: "28.0.5" }, { DockerRootDir: "/var/lib/docker" },
    { Driver: "vfs" }, { OSType: "windows" }, { Architecture: "arm64" },
    { Containerd: { ...info().Containerd, Address: "/tmp/foreign.sock" } },
    { Containerd: { ...info().Containerd, Namespaces: { Containers: expected.containersNamespace, Plugins: "plugins.moby" } } }]) {
    assert.throws(() => validatePostgresRuntimeDaemonInfo({ ...info(), ...change }, expected), /daemon_postgres_runtime_identity_invalid/u);
  }
});
test("inventory accepts empty or image-only with exact authenticated labels and sole alias", () => {
  assert.deepEqual(validatePostgresRuntimeDaemonInventory({ images: [], containers: [], volumes: [] }, "EMPTY", candidate), { images: 0, containers: 0, volumes: 0 });
  const inventory = { images: [image], containers: [], volumes: [] }; const inspect = { Id: image, RepoTags: [candidate.tag], Config: { Labels: inherited } };
  assert.deepEqual(validatePostgresRuntimeDaemonInventory(inventory, "IMAGE_ONLY", candidate, inspect), { images: 1, containers: 0, volumes: 0 });
  for (const [v, mode, observed] of [[inventory, "EMPTY", inspect], [{ ...inventory, containers: ["f".repeat(64)] }, "IMAGE_ONLY", inspect],
    [{ ...inventory, volumes: ["foreign"] }, "IMAGE_ONLY", inspect], [{ ...inventory, images: [image, ...principal.imageIds] }, "IMAGE_ONLY", inspect],
    [inventory, "IMAGE_ONLY", { ...inspect, RepoTags: [candidate.tag, "foreign:alias"] }],
    [inventory, "IMAGE_ONLY", { ...inspect, RepoTags: [] }], [inventory, "IMAGE_ONLY", { ...inspect, Id: principal.imageIds[0] }],
    [inventory, "IMAGE_ONLY", { ...inspect, Config: { Labels: { ...inherited, arbitrary: "label" } } }],
    [inventory, "IMAGE_ONLY", { ...inspect, Config: { Labels: null } }], [inventory, "CANDIDATE", inspect],
    [inventory, "UNKNOWN", inspect]]) assert.throws(() => validatePostgresRuntimeDaemonInventory(v, mode, candidate, observed), /daemon_postgres_runtime_inventory_invalid/u);
});
const labels = (role, container = false) => ({ ...(container ? inherited : {}), "com.auto-world.postgres-runtime-nonce": input().nonce,
  "com.auto-world.postgres-runtime-purpose": "local-sql-restore", "com.auto-world.postgres-runtime-role": role });
function runtime() {
  const prefix = `aw-pg-restore-${input().nonce}-`;
  const containers = ["source1", "restore1"].map((role, index) => ({ Id: String(index + 1).repeat(64), Name: `/${prefix}${role}`,
    Image: image, Config: { Image: image, Labels: labels(role, true) } }));
  const volumes = ["source-data", "restore-data"].map((role) => ({ Name: `${prefix}${role}`, Driver: "local", Scope: "local",
    Options: null, Mountpoint: `${expected.root}/volumes/${prefix}${role}/_data`, Labels: labels(role) }));
  return { inventory: { images: [image], containers: containers.map((item) => item.Id), volumes: volumes.map((item) => item.Name) },
    inspected: { Id: image, RepoTags: [candidate.tag], Config: { Labels: inherited } },
    owned: { nonce: input().nonce, dataRoot: expected.root, containers, volumes } };
}
test("owned runtime proves exact bounded resource identities, inherited labels and diagnostic ownership", () => {
  const v = runtime(); assert.deepEqual(validatePostgresRuntimeDaemonInventory(v.inventory, "OWNED_RUNTIME", candidate, v.inspected, v.owned),
    { images: 1, containers: 2, volumes: 2 });
  assert.deepEqual(validatePostgresRuntimeDaemonInventory({ images: [], containers: [], volumes: [] }, "OWNED_RUNTIME", candidate, undefined,
    { ...v.owned, containers: [], volumes: [] }), { images: 0, containers: 0, volumes: 0 });
  for (const role of ["probe", "source2", "restore2"]) {
    const c = { ...v.owned.containers[0], Name: `/aw-pg-restore-${input().nonce}-${role}`, Config: { Image: image, Labels: labels(role, true) } };
    assert.deepEqual(validatePostgresRuntimeDaemonInventory({ images: [image], containers: [c.Id], volumes: [] }, "OWNED_RUNTIME", candidate, v.inspected,
      { ...v.owned, containers: [c], volumes: [] }), { images: 1, containers: 1, volumes: 0 });
  }
});
for (const [name, modify] of [
  ["foreign image", (v) => { v.owned.containers[0].Image = principal.imageIds[0]; }],
  ["tag as container source", (v) => { v.owned.containers[0].Config.Image = candidate.tag; }],
  ["foreign container name", (v) => { v.owned.containers[0].Name = "/foreign-source1"; }],
  ["unknown role", (v) => { v.owned.containers[0].Name = `/aw-pg-restore-${input().nonce}-shell`; }],
  ["duplicate role", (v) => { v.owned.containers[1].Name = v.owned.containers[0].Name; v.owned.containers[1].Config.Labels = v.owned.containers[0].Config.Labels; }],
  ["container ID swap", (v) => { v.owned.containers[0].Id = "f".repeat(64); }],
  ["extra container label", (v) => { v.owned.containers[0].Config.Labels.extra = "foreign"; }],
  ["missing inherited label", (v) => { delete v.owned.containers[0].Config.Labels["com.auto-world.postgres-diagnostic"]; }],
  ["foreign nonce", (v) => { v.owned.containers[0].Config.Labels["com.auto-world.postgres-runtime-nonce"] = "f".repeat(24); }],
  ["wrong purpose", (v) => { v.owned.volumes[0].Labels["com.auto-world.postgres-runtime-purpose"] = "other"; }],
  ["extra volume label", (v) => { v.owned.volumes[0].Labels.extra = "foreign"; }],
  ["inherited volume labels", (v) => { Object.assign(v.owned.volumes[0].Labels, inherited); }],
  ["foreign mountpoint", (v) => { v.owned.volumes[0].Mountpoint = "/var/lib/docker/volumes/foreign/_data"; }],
  ["nonlocal driver", (v) => { v.owned.volumes[0].Driver = "nfs"; }],
  ["nonlocal scope", (v) => { v.owned.volumes[0].Scope = "global"; }],
  ["volume driver options", (v) => { v.owned.volumes[0].Options = { device: "/foreign" }; }],
  ["third container", (v) => { v.inventory.containers.push("3".repeat(64)); }],
  ["third volume", (v) => { v.inventory.volumes.push("foreign"); }],
  ["duplicate container ID", (v) => { v.inventory.containers[1] = v.inventory.containers[0]; }],
  ["duplicate volume", (v) => { v.inventory.volumes[1] = v.inventory.volumes[0]; }],
  ["containers without image", (v) => { v.inventory.images = []; }],
  ["inventory without matching inspect", (v) => { v.owned.containers.pop(); }],
  ["unclosed ownership", (v) => { v.owned.command = "arbitrary"; }],
]) test(`owned runtime rejects ${name}`, () => {
  const v = runtime(); modify(v);
  assert.throws(() => validatePostgresRuntimeDaemonInventory(v.inventory, "OWNED_RUNTIME", candidate, v.inspected, v.owned), /daemon_postgres_runtime_inventory_invalid/u);
});
test("closed validators reject coercible objects without invoking their conversion hooks", () => {
  let reads = 0; const object = { toString() { reads++; return input().nonce; } };
  for (const change of [{ nonce: object }, { parent: object }, { principal: { ...principal, id: object } },
    { principal: { ...principal, imageIds: [object, principal.imageIds[1]] } }]) {
    assert.throws(() => validatePostgresRuntimeDaemonLeaseInput({ ...input(), ...change }), /daemon_postgres_runtime_context_invalid/u);
  }
  assert.throws(() => validatePostgresRuntimeDaemonStartProof({ pid: 4242, startTicks: object, daemonId: "owned", namespacesFresh: true }, principal.id), /daemon_postgres_runtime_helper_invalid/u);
  const v = runtime(); v.owned.nonce = object;
  assert.throws(() => validatePostgresRuntimeDaemonInventory(v.inventory, "OWNED_RUNTIME", candidate, v.inspected, v.owned), /daemon_postgres_runtime_inventory_invalid/u);
  assert.equal(reads, 0);
});
test("actual root captures a valid late helper PID before deadline failure and stops only that proof", async () => {
  if (process.platform !== "linux" || process.getuid?.() !== 0 || process.getgid?.() !== 0) {
    await assert.rejects(startPostgresRuntimeDaemonLease(input(), { env: {} }), /daemon_postgres_runtime_context_invalid/u); return;
  }
  const parent = mkdtempSync("/var/tmp/aw-pr-"); chmodSync(parent, 0o710); chownSync(parent, 0, 1000);
  let clock = 0; let stopped = 0; const proof = { pid: 4242, startTicks: "12345", daemonId: "owned-daemon", namespacesFresh: true };
  const helper = { start: async (spec) => { assert.equal(spec.root, parent); clock = 20 * 60_000; return proof; },
    verify: async () => { throw new Error("must not verify late startup"); },
    stop: async (spec, child) => { assert.equal(spec.root, parent); assert.deepEqual(child, proof); stopped++;
      return { state: "STOPPED", pid: child.pid, startTicks: child.startTicks, processGone: true }; } };
  const transport = async (command, args) => {
    assert.equal(command, "/usr/bin/docker"); assert.deepEqual(args.slice(0, 2), ["--host", "unix:///var/run/docker.sock"]);
    const request = args.slice(2); let value;
    if (request[0] === "info") value = JSON.stringify({ ...info(), ID: principal.id, DockerRootDir: principal.root,
      Containerd: { Address: principal.containerdAddress, Namespaces: { Containers: "moby", Plugins: "plugins.moby" } } });
    else if (request[0] === "image" && request[1] === "ls") value = principal.imageIds.join("\n");
    else if (["container", "volume"].includes(request[0])) value = "";
    else if (request[0] === "image" && request[1] === "inspect") value = JSON.stringify({ Id: request.at(-1) });
    else assert.fail("unexpected privileged request");
    return { status: 0, stdout: Buffer.from(value), stderr: Buffer.alloc(0) };
  };
  try {
    await assert.rejects(startPostgresRuntimeDaemonLease({ ...input(), parent }, { helper, transport, env: {}, now: () => clock }),
      (error) => error.message === "daemon_postgres_runtime_deadline_exceeded" && error.phase === "START");
    assert.equal(stopped, 1); assert.equal(existsSync(`${parent}/infra/daemon.json`), true);
    assert.equal(existsSync(`${parent}/endpoint/docker.sock`), false);
  } finally { assert.match(parent, /^\/var\/tmp\/aw-pr-[A-Za-z0-9]{6}$/u); rmSync(parent, { recursive: true }); }
});
test("cleanup accepts only the exact stopped owned PID/start ticks and confirmed process disappearance", () => {
  const child = { pid: 4242, startTicks: "12345" };
  const proof = { state: "STOPPED", ...child, processGone: true };
  assert.deepEqual(validatePostgresRuntimeDaemonStopProof(proof, child), proof);
  for (const change of [{ state: "RUNNING" }, { pid: 1 }, { pid: 4243 }, { startTicks: "12346" },
    { processGone: false }, { extra: "unknown" }]) {
    assert.throws(() => validatePostgresRuntimeDaemonStopProof({ ...proof, ...change }, child),
      (error) => error.message === "daemon_postgres_runtime_cleanup_uncertain" && error.phase === "STOP");
  }
});
test("ambient endpoint, context and config attempts are rejected even for empty values", () => {
  validatePostgresRuntimeDaemonRoutingEnvironment({});
  for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"]) for (const value of ["", "default", undefined]) {
    assert.throws(() => validatePostgresRuntimeDaemonRoutingEnvironment({ [key]: value }), /daemon_postgres_runtime_context_invalid/u);
  }
});
test("deadline fails closed for elapsed or malformed clocks and allows separate finite cleanup grace", () => {
  assert.equal(postgresRuntimeDaemonRemaining(301000, 1000, "START"), 300000);
  assert.equal(postgresRuntimeDaemonRemaining(326000, 301000, "STOP"), 25000);
  for (const [deadline, now] of [[1000, 1000], [1000, 1001], [Number.NaN, 10], [100, Infinity]]) {
    assert.throws(() => postgresRuntimeDaemonRemaining(deadline, now, "STOP"), (error) => error.message === "daemon_postgres_runtime_deadline_exceeded" && error.phase === "STOP");
  }
});
test("closed diagnostics preserve cleanup uncertainty and never expose raw errors or hostile getters", () => {
  assert.deepEqual(postgresRuntimeDaemonFailureDiagnostic({ message: "daemon_postgres_runtime_cleanup_uncertain", phase: "STOP" }),
    { code: "daemon_postgres_runtime_cleanup_uncertain", phase: "STOP" });
  let reads = 0; const hostile = { get message() { reads++; throw new Error("private token/output"); } };
  assert.deepEqual(postgresRuntimeDaemonFailureDiagnostic(hostile), { code: "daemon_postgres_runtime_context_invalid", phase: "VERIFY" }); assert.equal(reads, 1);
  assert.deepEqual(postgresRuntimeDaemonFailureDiagnostic(new Error("private stdout")), { code: "daemon_postgres_runtime_context_invalid", phase: "VERIFY" });
});
