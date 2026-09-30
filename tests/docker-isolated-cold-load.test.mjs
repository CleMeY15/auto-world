import assert from "node:assert/strict";
import test from "node:test";
import { coldLoadDaemonFailureDiagnostic, coldLoadDaemonRemaining, startColdLoadDaemonLease,
  validateColdLoadDaemonInfo, validateColdLoadDaemonInventory, validateColdLoadDaemonLeaseInput,
  validateColdLoadDaemonRoutingEnvironment, validateColdLoadDaemonStartProof, validateColdLoadDaemonStopProof } from "../scripts/docker-isolated/daemon-cold-load.mjs";

const image = `sha256:${"1".repeat(64)}`; const candidate = { imageId: image, tag: `aw-postgres-gosu:${"a".repeat(24)}` };
const principal = { id: "principal-daemon", root: "/var/lib/docker", containerdAddress: "/run/containerd/containerd.sock",
  containersNamespace: "moby", pluginsNamespace: "plugins.moby", imageIds: [`sha256:${"b".repeat(64)}`, `sha256:${"c".repeat(64)}`] };
const input = () => ({ purpose: "COLD_LOAD_ONLY", parent: "/var/tmp/aw-cl-AbCd12", nonce: "1".repeat(24), principal, candidate });
const expected = { id: "owned-daemon", root: "/var/tmp/aw-cl-AbCd12/infra/data", containerdAddress: principal.containerdAddress,
  containersNamespace: `awcold-${"1".repeat(24)}`, pluginsNamespace: `plugins.awcold-${"1".repeat(24)}` };
const info = () => ({ ID: expected.id, ServerVersion: "28.0.4", DockerRootDir: expected.root, Driver: "overlay2", OSType: "linux",
  Architecture: "x86_64", Containerd: { Address: expected.containerdAddress,
    Namespaces: { Containers: expected.containersNamespace, Plugins: expected.pluginsNamespace } } });
test("cold lease input is fixed-purpose, scoped, disjoint from the principal and frozen", () => {
  const result = validateColdLoadDaemonLeaseInput(input()); assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.candidate), true); assert.deepEqual(result.principal.imageIds, principal.imageIds);
});
for (const [name, change] of [
  ["image execution purpose", { purpose: "RUNTIME" }], ["old probe purpose", { purpose: "EMPTY_DAEMON_PROBE" }],
  ["unknown argument", { command: "/bin/sh" }], ["escaped parent", { parent: "/var/tmp/aw-cl-AbCd12/../foreign" }],
  ["old root", { parent: "/var/tmp/aw-dp-AbCd12" }], ["invalid nonce", { nonce: "../foreign" }],
  ["principal candidate collision", { candidate: { ...candidate, imageId: principal.imageIds[0] } }],
  ["unknown principal namespace", { principal: { ...principal, pluginsNamespace: "other" } }],
  ["extra candidate property", { candidate: { ...candidate, force: true } }],
]) test(`lease input rejects ${name}`, () => assert.throws(() => validateColdLoadDaemonLeaseInput({ ...input(), ...change }), /daemon_cold_load_context_invalid/u));
test("native lease rejects actual nonroot/Windows before any helper invocation; a bad purpose always rejects", async () => {
  let starts = 0; const helper = { start: async () => { starts++; }, verify: async () => {}, stop: async () => {} };
  const value = input();
  if (process.platform === "linux" && process.getuid?.() === 0 && process.getgid?.() === 0) value.purpose = "RUNTIME";
  await assert.rejects(startColdLoadDaemonLease(value, { helper }), /daemon_cold_load_context_invalid/u); assert.equal(starts, 0);
});
test("root/helper start proof rejects missing/foreign ownership before a PID can be used", () => {
  const proof = { pid: 4242, startTicks: "12345", daemonId: "owned-daemon", namespacesFresh: true };
  assert.deepEqual(validateColdLoadDaemonStartProof(proof, principal.id), proof);
  for (const change of [{ pid: 1 }, { pid: "4242" }, { startTicks: "0" }, { daemonId: principal.id }, { namespacesFresh: false }, { extra: true }]) {
    assert.throws(() => validateColdLoadDaemonStartProof({ ...proof, ...change }, principal.id), /daemon_cold_load_helper_invalid/u);
  }
});
test("owned info proves version/profile/containerd and both namespaces with no fallback", () => {
  assert.deepEqual(validateColdLoadDaemonInfo(info(), expected), { daemonId: expected.id, version: "28.0.4" });
  for (const change of [{ ID: principal.id }, { ServerVersion: "28.0.5" }, { DockerRootDir: "/var/lib/docker" },
    { Driver: "vfs" }, { OSType: "windows" }, { Architecture: "arm64" },
    { Containerd: { ...info().Containerd, Address: "/tmp/foreign.sock" } },
    { Containerd: { ...info().Containerd, Namespaces: { Containers: expected.containersNamespace, Plugins: "plugins.moby" } } }]) {
    assert.throws(() => validateColdLoadDaemonInfo({ ...info(), ...change }, expected), /daemon_cold_load_identity_invalid/u);
  }
});
test("inventory accepts empty or sole pinned candidate/alias and never permits foreign/extra resources", () => {
  assert.deepEqual(validateColdLoadDaemonInventory({ images: [], containers: [], volumes: [] }, "EMPTY", candidate), { images: 0, containers: 0, volumes: 0 });
  const inventory = { images: [image], containers: [], volumes: [] }; const inspect = { Id: image, RepoTags: [candidate.tag] };
  assert.deepEqual(validateColdLoadDaemonInventory(inventory, "CANDIDATE", candidate, inspect), { images: 1, containers: 0, volumes: 0 });
  for (const [v, mode, observed] of [[inventory, "EMPTY", inspect], [{ ...inventory, containers: ["f".repeat(64)] }, "CANDIDATE", inspect],
    [{ ...inventory, volumes: ["foreign"] }, "CANDIDATE", inspect], [{ ...inventory, images: [image, ...principal.imageIds] }, "CANDIDATE", inspect],
    [inventory, "CANDIDATE", { ...inspect, RepoTags: [candidate.tag, "foreign:alias"] }],
    [inventory, "CANDIDATE", { ...inspect, RepoTags: [] }], [inventory, "CANDIDATE", { ...inspect, Id: principal.imageIds[0] }],
    [inventory, "UNKNOWN", inspect]]) assert.throws(() => validateColdLoadDaemonInventory(v, mode, candidate, observed), /daemon_cold_load_inventory_invalid/u);
});
test("cleanup accepts only the exact stopped owned PID/start ticks and confirmed process disappearance", () => {
  const child = { pid: 4242, startTicks: "12345" };
  const proof = { state: "STOPPED", ...child, processGone: true };
  assert.deepEqual(validateColdLoadDaemonStopProof(proof, child), proof);
  for (const change of [{ state: "RUNNING" }, { pid: 1 }, { pid: 4243 }, { startTicks: "12346" },
    { processGone: false }, { extra: "unknown" }]) {
    assert.throws(() => validateColdLoadDaemonStopProof({ ...proof, ...change }, child),
      (error) => error.message === "daemon_cold_load_cleanup_uncertain" && error.phase === "STOP");
  }
});
test("ambient endpoint, context and config attempts are rejected even for empty values", () => {
  validateColdLoadDaemonRoutingEnvironment({});
  for (const key of ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"]) for (const value of ["", "default", undefined]) {
    assert.throws(() => validateColdLoadDaemonRoutingEnvironment({ [key]: value }), /daemon_cold_load_context_invalid/u);
  }
});
test("deadline fails closed for elapsed or malformed clocks and allows separate finite cleanup grace", () => {
  assert.equal(coldLoadDaemonRemaining(301000, 1000, "START"), 300000);
  assert.equal(coldLoadDaemonRemaining(326000, 301000, "STOP"), 25000);
  for (const [deadline, now] of [[1000, 1000], [1000, 1001], [Number.NaN, 10], [100, Infinity]]) {
    assert.throws(() => coldLoadDaemonRemaining(deadline, now, "STOP"), (error) => error.message === "daemon_cold_load_deadline_exceeded" && error.phase === "STOP");
  }
});
test("closed diagnostics preserve cleanup uncertainty and never expose raw errors or hostile getters", () => {
  assert.deepEqual(coldLoadDaemonFailureDiagnostic({ message: "daemon_cold_load_cleanup_uncertain", phase: "STOP" }),
    { code: "daemon_cold_load_cleanup_uncertain", phase: "STOP" });
  let reads = 0; const hostile = { get message() { reads++; throw new Error("private token/output"); } };
  assert.deepEqual(coldLoadDaemonFailureDiagnostic(hostile), { code: "daemon_cold_load_context_invalid", phase: "VERIFY" }); assert.equal(reads, 1);
  assert.deepEqual(coldLoadDaemonFailureDiagnostic(new Error("private stdout")), { code: "daemon_cold_load_context_invalid", phase: "VERIFY" });
});
