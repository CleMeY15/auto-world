import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { postgresRuntimeDaemonConfiguration, createPostgresRuntimeDaemonHelper, validatePostgresRuntimeDaemonHelperSpec,
  validatePostgresRuntimeDaemonProcessProof } from "../scripts/docker-isolated/daemon-postgres-runtime-helper.mjs";

// These are synthetic process/transport contract records. They do not attest a live root process.
const hash = (v) => createHash("sha256").update(Buffer.from(`${JSON.stringify(v, null, 2)}\n`)).digest("hex");
const nonce = "1".repeat(24); const root = "/var/tmp/aw-pr-AbCd12";
function spec() {
  const result = { root, infrastructure: `${root}/infra`, endpointDirectory: `${root}/endpoint`, rootClient: `${root}/infra/client`,
    uid: 0, gid: 0, executable: "/usr/bin/dockerd", version: "28.0.4", nonce, configFile: `${root}/infra/daemon.json`,
    pidFile: `${root}/infra/daemon.pid`, logFile: `${root}/infra/daemon.log`, socket: `${root}/endpoint/docker.sock`,
    dataRoot: `${root}/infra/data`, execRoot: `${root}/infra/exec`, containerdAddress: "/run/containerd/containerd.sock",
    containersNamespace: `awpgsql-${nonce}`, pluginsNamespace: `plugins.awpgsql-${nonce}`, configSha256: "0".repeat(64) };
  result.args = ["--config-file", result.configFile, "--containerd-plugins-namespace", result.pluginsNamespace];
  result.argvSha256 = hash([result.executable, ...result.args]); result.configSha256 = hash(postgresRuntimeDaemonConfiguration(result));
  return result;
}
test("SQL restore helper permits only its dedicated exact paths, nonce namespaces and fixed daemon flags", () => {
  const s = spec(); assert.equal(validatePostgresRuntimeDaemonHelperSpec(s), s);
  const config = postgresRuntimeDaemonConfiguration(s);
  assert.equal(config["data-root"], s.dataRoot); assert.equal(config["exec-root"], s.execRoot);
  assert.deepEqual(config.hosts, [`unix://${s.socket}`]);
  for (const key of ["iptables", "ip6tables", "ip-forward", "ip-masq", "userland-proxy"]) assert.equal(config[key], false);
  assert.equal(config.bridge, "none"); assert.equal(config["storage-driver"], "overlay2");
  assert.equal(config["default-ipc-mode"], "private"); assert.equal(config["default-cgroupns-mode"], "private");
  assert.equal(Object.hasOwn(config, "containerd-plugins-namespace"), false);
  assert.equal(Object.hasOwn(config, "containerd-plugin-namespace"), false);
  assert.equal(Object.isFrozen(config), true);
});
test("helper and process schemas reject coercible paths, ticks, states and nonces before conversion", () => {
  let reads = 0; const object = { toString() { reads++; return nonce; } };
  for (const key of ["root", "nonce", "configSha256", "argvSha256", "pluginsNamespace"]) {
    assert.throws(() => validatePostgresRuntimeDaemonHelperSpec({ ...spec(), [key]: object }), /daemon_postgres_runtime_helper_invalid/u);
  }
  const s = spec(); const expected = { pid: 4242, startTicks: "123456", configFile: s.configFile, nonce };
  const proof = { pid: 4242, startTicks: expected.startTicks, state: "S", uid: [0, 0, 0, 0], gid: [0, 0, 0, 0],
    executable: s.executable, argv: [s.executable, ...s.args] };
  for (const key of ["startTicks", "state"]) assert.throws(() => validatePostgresRuntimeDaemonProcessProof({ ...proof, [key]: object }, expected), /daemon_postgres_runtime_helper_invalid/u);
  for (const key of ["startTicks", "configFile", "nonce"]) assert.throws(() => validatePostgresRuntimeDaemonProcessProof(proof, { ...expected, [key]: object }), /daemon_postgres_runtime_helper_invalid/u);
  assert.equal(reads, 0);
});
for (const [name, change] of [
  ["old probe path", { root: "/var/tmp/aw-dp-AbCd12" }], ["escaped root", { root: `${root}/../other` }],
  ["nonroot daemon", { uid: 1000 }], ["wrong group", { gid: 1000 }], ["new Docker version", { version: "28.0.5" }],
  ["principal socket", { socket: "/var/run/docker.sock" }], ["principal data", { dataRoot: "/var/lib/docker" }],
  ["public config", { configFile: "/etc/docker/daemon.json" }], ["alternate containerd", { containerdAddress: "/tmp/containerd.sock" }],
  ["principal namespace", { containersNamespace: "moby" }], ["principal plugin namespace", { pluginsNamespace: "plugins.moby" }],
  ["extra field", { command: "arbitrary" }], ["unknown executable", { executable: "/bin/sh" }],
  ["argv substitution", { args: ["--host", "unix:///var/run/docker.sock"] }], ["argv hash substitution", { argvSha256: "f".repeat(64) }],
]) test(`helper spec rejects ${name} before any native operation`, () => {
  assert.throws(() => validatePostgresRuntimeDaemonHelperSpec({ ...spec(), ...change }), /^Error: daemon_postgres_runtime_helper_invalid$/u);
});
test("root process proof binds PID/start ticks, all real/effective/saved/fs IDs and complete fixed argv", () => {
  const s = spec(); const expected = { pid: 4242, startTicks: "123456", configFile: s.configFile, nonce };
  const proof = { pid: 4242, startTicks: "123456", state: "S", uid: [0, 0, 0, 0], gid: [0, 0, 0, 0],
    executable: "/usr/bin/dockerd", argv: [s.executable, ...s.args] };
  assert.deepEqual(validatePostgresRuntimeDaemonProcessProof(proof, expected), { pid: 4242, startTicks: "123456" });
  for (const change of [{ pid: 1 }, { pid: 4243 }, { startTicks: "123457" }, { state: "Z" }, { state: "X" },
    { uid: [0, 0, 1000, 0] }, { gid: [0, 0, 0, 1000] }, { executable: "/usr/bin/dockerd (deleted)" },
    { argv: proof.argv.slice(0, -2) }, { argv: [...proof.argv, "--host", "unix:///var/run/docker.sock"] },
    { argv: [...proof.argv.slice(0, -1), "plugins.moby"] }]) {
    assert.throws(() => validatePostgresRuntimeDaemonProcessProof({ ...proof, ...change }, expected), /daemon_postgres_runtime_helper_invalid/u);
  }
});
test("native privileged factory rejects the actual unsupported actor before binary or daemon operations", () => {
  if (process.platform !== "linux" || process.getuid?.() !== 0 || process.getgid?.() !== 0) {
    assert.throws(() => createPostgresRuntimeDaemonHelper(), /^Error: daemon_postgres_runtime_helper_invalid$/u);
  } else {
    // Root test callers still exercise the closed pure rejection without starting any native helper.
    assert.throws(() => validatePostgresRuntimeDaemonHelperSpec({}), /daemon_postgres_runtime_helper_invalid/u);
  }
});
