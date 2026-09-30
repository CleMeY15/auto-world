import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { coldLoadDaemonConfiguration, createColdLoadDaemonHelper, validateColdLoadDaemonHelperSpec,
  validateColdLoadDaemonProcessProof } from "../scripts/docker-isolated/daemon-cold-load-helper.mjs";

// These are synthetic process/transport contract records. They do not attest a live root process.
const hash = (v) => createHash("sha256").update(Buffer.from(`${JSON.stringify(v, null, 2)}\n`)).digest("hex");
const nonce = "1".repeat(24); const root = "/var/tmp/aw-cl-AbCd12";
function spec() {
  const result = { root, infrastructure: `${root}/infra`, endpointDirectory: `${root}/endpoint`, rootClient: `${root}/infra/client`,
    uid: 0, gid: 0, executable: "/usr/bin/dockerd", version: "28.0.4", nonce, configFile: `${root}/infra/daemon.json`,
    pidFile: `${root}/infra/daemon.pid`, logFile: `${root}/infra/daemon.log`, socket: `${root}/endpoint/docker.sock`,
    dataRoot: `${root}/infra/data`, execRoot: `${root}/infra/exec`, containerdAddress: "/run/containerd/containerd.sock",
    containersNamespace: `awcold-${nonce}`, pluginsNamespace: `plugins.awcold-${nonce}`, configSha256: "0".repeat(64) };
  result.args = ["--config-file", result.configFile, "--containerd-plugins-namespace", result.pluginsNamespace];
  result.argvSha256 = hash([result.executable, ...result.args]); result.configSha256 = hash(coldLoadDaemonConfiguration(result));
  return result;
}
test("cold helper permits only its dedicated exact paths, nonce namespaces and fixed daemon flags", () => {
  const s = spec(); assert.equal(validateColdLoadDaemonHelperSpec(s), s);
  const config = coldLoadDaemonConfiguration(s);
  assert.equal(config["data-root"], s.dataRoot); assert.equal(config["exec-root"], s.execRoot);
  assert.deepEqual(config.hosts, [`unix://${s.socket}`]);
  for (const key of ["iptables", "ip6tables", "ip-forward", "ip-masq", "userland-proxy"]) assert.equal(config[key], false);
  assert.equal(config.bridge, "none"); assert.equal(config["storage-driver"], "overlay2");
  assert.equal(config["default-ipc-mode"], "private"); assert.equal(config["default-cgroupns-mode"], "private");
  assert.equal(Object.hasOwn(config, "containerd-plugins-namespace"), false);
  assert.equal(Object.hasOwn(config, "containerd-plugin-namespace"), false);
  assert.equal(Object.isFrozen(config), true);
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
  assert.throws(() => validateColdLoadDaemonHelperSpec({ ...spec(), ...change }), /^Error: daemon_cold_load_helper_invalid$/u);
});
test("root process proof binds PID/start ticks, all real/effective/saved/fs IDs and complete fixed argv", () => {
  const s = spec(); const expected = { pid: 4242, startTicks: "123456", configFile: s.configFile, nonce };
  const proof = { pid: 4242, startTicks: "123456", state: "S", uid: [0, 0, 0, 0], gid: [0, 0, 0, 0],
    executable: "/usr/bin/dockerd", argv: [s.executable, ...s.args] };
  assert.deepEqual(validateColdLoadDaemonProcessProof(proof, expected), { pid: 4242, startTicks: "123456" });
  for (const change of [{ pid: 1 }, { pid: 4243 }, { startTicks: "123457" }, { state: "Z" }, { state: "X" },
    { uid: [0, 0, 1000, 0] }, { gid: [0, 0, 0, 1000] }, { executable: "/usr/bin/dockerd (deleted)" },
    { argv: proof.argv.slice(0, -2) }, { argv: [...proof.argv, "--host", "unix:///var/run/docker.sock"] },
    { argv: [...proof.argv.slice(0, -1), "plugins.moby"] }]) {
    assert.throws(() => validateColdLoadDaemonProcessProof({ ...proof, ...change }, expected), /daemon_cold_load_helper_invalid/u);
  }
});
test("native privileged factory rejects the actual unsupported actor before binary or daemon operations", () => {
  if (process.platform !== "linux" || process.getuid?.() !== 0 || process.getgid?.() !== 0) {
    assert.throws(() => createColdLoadDaemonHelper(), /^Error: daemon_cold_load_helper_invalid$/u);
  } else {
    // Root test callers still exercise the closed pure rejection without starting any native helper.
    assert.throws(() => validateColdLoadDaemonHelperSpec({}), /daemon_cold_load_helper_invalid/u);
  }
});
