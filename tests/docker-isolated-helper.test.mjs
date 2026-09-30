import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalDaemonHelper, validateLocalDaemonProcessProof } from "../scripts/docker-isolated/daemon-helper.mjs";

const expected = { pid: 98765, startTicks: "123456789", configFile: "/var/tmp/aw-dp-AbCd12/daemon-" + "a".repeat(24) + "/daemon.json" };
const proof = { pid: expected.pid, startTicks: expected.startTicks, state: "S",
  uid: [0, 0, 0, 0], gid: [0, 0, 0, 0], executable: "/usr/bin/dockerd",
  argv: ["/usr/bin/dockerd", "--config-file", expected.configFile] };

test("process proof binds the owned root child, start ticks and exact reviewed command", () => {
  const verified = validateLocalDaemonProcessProof(proof, expected);
  assert.deepEqual(verified, { pid: expected.pid, startTicks: expected.startTicks });
  assert.equal(Object.isFrozen(verified), true);
});
test("process proof rejects PID reuse, foreign processes and altered root command", () => {
  for (const change of [
    { pid: 1 }, { pid: 12345 }, { startTicks: "999999999" }, { startTicks: "" },
    { uid: [0, 1000, 0, 0] }, { gid: [0, 0, 1000, 0] },
    { executable: "/usr/bin/containerd" }, { executable: "/usr/bin/dockerd (deleted)" },
    { argv: ["/usr/bin/dockerd", "--config-file", "/etc/docker/daemon.json"] },
    { argv: [...proof.argv, "--host", "unix:///var/run/docker.sock"] },
    { state: "Z" }, { state: "X" }, { state: undefined }, { state: "unknown" },
  ]) assert.throws(() => validateLocalDaemonProcessProof({ ...proof, ...change }, expected),
    /daemon_local_helper_invalid/u);
});
test("default privileged helper refuses the non-root test caller before any privileged operation",
  { skip: process.platform === "linux" && process.getuid?.() === 0 }, () => {
    assert.throws(() => createLocalDaemonHelper(), /daemon_local_helper_invalid/u);
  });
