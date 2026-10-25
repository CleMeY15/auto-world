import assert from "node:assert/strict";
import { chmodSync, chownSync, lstatSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import test from "node:test";
import { startColdLoadDaemonLease } from "../scripts/docker-isolated/daemon-cold-load.mjs";

const nativeRoot = process.platform === "linux" && process.getuid?.() === 0 && process.getgid?.() === 0;
test("native root fixture stops the validated start handle when its return crosses the deadline", { skip: !nativeRoot }, async () => {
  // Real root-owned files/socket exercise lease cleanup, with fake process/CLI transports and no dockerd or images.
  const parent = mkdtempSync("/var/tmp/aw-cl-"); chownSync(parent, 0, 1000); chmodSync(parent, 0o710);
  const principal = { id: "fixture-principal", root: "/var/lib/docker", containerdAddress: "/run/containerd/containerd.sock",
    containersNamespace: "moby", pluginsNamespace: "plugins.moby", imageIds: [`sha256:${"a".repeat(64)}`, `sha256:${"b".repeat(64)}`] };
  const owned = { pid: 4321, startTicks: "12345", daemonId: "fixture-owned", namespacesFresh: true };
  let now = 1000; let stops = 0; let daemonSpec; let server;
  const helper = {
    start: async (spec) => {
      daemonSpec = spec; chmodSync(spec.dataRoot, 0o710);
      writeFileSync(spec.pidFile, String(owned.pid), { mode: 0o600 });
      server = createServer(); await new Promise((resolve, reject) => { server.once("error", reject); server.listen(spec.socket, resolve); });
      chownSync(spec.socket, 0, 1000); chmodSync(spec.socket, 0o660); now = 301001;
      return owned;
    },
    verify: async () => { throw new Error("unexpected verification after deadline"); },
    stop: async (spec, child) => {
      stops++; assert.equal(spec, daemonSpec); assert.deepEqual(child, owned);
      await new Promise((resolve) => server.close(resolve)); unlinkSync(spec.pidFile);
      return { state: "STOPPED", pid: owned.pid, startTicks: owned.startTicks, processGone: true };
    },
  };
  const transport = async (command, args) => {
    assert.equal(command, "/usr/bin/docker"); assert.equal(args[1], "unix:///var/run/docker.sock");
    const request = args.slice(2); let stdout;
    if (request[0] === "info") stdout = Buffer.from(JSON.stringify({ ID: principal.id, ServerVersion: "28.0.4",
      DockerRootDir: principal.root, Driver: "overlay2", OSType: "linux", Architecture: "x86_64", Containerd: {
        Address: principal.containerdAddress, Namespaces: { Containers: principal.containersNamespace, Plugins: principal.pluginsNamespace } } }));
    else if (request[0] === "image" && request[1] === "ls") stdout = Buffer.from(`${principal.imageIds.join("\n")}\n`);
    else if (request[0] === "image" && request[1] === "inspect") stdout = Buffer.from(JSON.stringify({ Id: request.at(-1), fixture: true }));
    else { assert.ok(["container", "volume"].includes(request[0])); stdout = Buffer.alloc(0); }
    return { status: 0, stdout, stderr: Buffer.alloc(0) };
  };
  try {
    await assert.rejects(startColdLoadDaemonLease({ purpose: "COLD_LOAD_ONLY", parent, nonce: "c".repeat(24), principal,
      candidate: { imageId: `sha256:${"d".repeat(64)}`, tag: `aw-postgres-gosu:${"e".repeat(24)}` } },
    { helper, transport, env: { PATH: "/usr/bin:/bin" }, now: () => now }), { message: "daemon_cold_load_deadline_exceeded" });
    assert.equal(stops, 1); assert.equal(lstatSync(parent).uid, 0);
  } finally {
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
    assert.match(parent, /^\/var\/tmp\/aw-cl-[A-Za-z0-9]{6}$/u); rmSync(parent, { recursive: true, force: true });
  }
});
