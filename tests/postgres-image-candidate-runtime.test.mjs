import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { executePostgresCandidateRuntime, validatePostgresCandidateRuntimeReceipt } from "../scripts/postgres-image/candidate-runtime.mjs";

const lock = JSON.parse(readFileSync(new URL("../infra/postgres-image/lock.json", import.meta.url), "utf8"));
const OWNER = "com.auto-world.postgres-runtime-nonce";
const nonce = "a".repeat(24);
const payload = "auto-world-postgres-gosu-diagnostic-v1";
const runnable = process.platform === "linux" && process.getuid?.() > 0;
const clone = (value) => globalThis.structuredClone(value);
const result = (status = 0, stdout = "", stderr = "") => ({ status, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) });
const expectation = (input) => Object.fromEntries(["subject", "imageId", "diffIds", "runId", "recipeRevision"]
  .map((key) => [key, input[key]]));

function snapshot(parent) {
  return { parent, dockerConfig: path.join(parent, "auth"), imageId: `sha256:${"c".repeat(64)}`,
    subject: `ghcr.io/clemey15/auto-world-postgres-gosu@sha256:${"d".repeat(64)}`,
    diffIds: Array.from({ length: 12 }, (_, index) => `sha256:${(index + 1).toString(16).padStart(64, "0")}`),
    config: { User: "", Entrypoint: ["docker-entrypoint.sh"], Cmd: ["postgres"], WorkingDir: "",
      Env: ["PATH=/usr/local/bin:/usr/bin:/bin", "PGDATA=/var/lib/postgresql/data"],
      Labels: { "source": "reviewed" }, Volumes: { "/var/lib/postgresql/data": {} } },
    archiveProof: { imageId: `sha256:${"c".repeat(64)}`,
      diffIds: Array.from({ length: 12 }, (_, index) => `sha256:${(index + 1).toString(16).padStart(64, "0")}`),
      archiveSha256: "e".repeat(64), archiveBytes: 305474048 }, runId: "1234", recipeRevision: "f".repeat(40),
    signal: new globalThis.AbortController().signal };
}

function harness(options = {}) {
  const parent = mkdtempSync(path.join(os.tmpdir(), "postgres-runtime-test-")); chmodSync(parent, 0o700);
  const input = snapshot(parent); mkdirSync(input.dockerConfig, { mode: 0o700 });
  const containers = new Map(); const calls = []; const checks = [];
  let volume; let saved; let created = 0; let clock = Date.parse("2026-09-30T18:00:00Z");
  const processCounts = new Map();
  const argument = (args, key) => args[args.indexOf(key) + 1];
  const flags = (args, key) => args.flatMap((item, index) => item === key ? [args[index + 1]] : []);
  const getContainer = (name) => containers.get(name) ?? [...containers.values()].find((item) => item.Id === name);
  const absent = (kind, name) => result(1, "", kind === "container"
    ? `Error: No such container: ${name}\n` : `Error response from daemon: get ${name}: no such volume\n`);
  const inspectProfile = (item) => {
    const observed = clone(item);
    if (options.mutateProfile && item.Name.endsWith(`-${options.profileRole ?? "probe"}`)) options.mutateProfile(observed);
    return observed;
  };
  const runner = (command, args, transport) => {
    calls.push({ command, args: [...args], options: transport });
    assert.equal(command, "/usr/bin/docker");
    assert.equal(transport.env.GITHUB_TOKEN, undefined); assert.equal(transport.env.GH_TOKEN, undefined);
    assert.equal(transport.env.POSTGRES_PASSWORD, undefined); assert.ok(transport.maxBuffer <= 1024 ** 2);
    if (args[0] === "ps") return result(0, [...containers.values()].map((item) => item.Id).join("\n"));
    if (args[0] === "volume" && args[1] === "ls") return result(0, volume && volume.Labels?.[OWNER] === nonce ? `${volume.Name}\n` : "");
    if (args[1] === "inspect") {
      if (args[0] === "volume") {
        if (options.foreignVolume && !volume) return result(0, JSON.stringify({ Name: args.at(-1), Labels: { foreign: "true" } }));
        return volume ? result(0, JSON.stringify(volume)) : absent("volume", args.at(-1));
      }
      const item = getContainer(args.at(-1));
      return item ? result(0, JSON.stringify(inspectProfile(item))) : absent("container", args.at(-1));
    }
    if (args[0] === "create") {
      created += 1;
      const name = argument(args, "--name"); const probe = name.endsWith("-probe");
      const index = args.indexOf(input.imageId); assert.ok(index > 0); assert.ok(args.includes("--pull=never"));
      const tmpfs = Object.fromEntries(flags(args, "--tmpfs").map((entry) => {
        const split = entry.indexOf(":"); return [entry.slice(0, split), entry.slice(split + 1)];
      }));
      const env = new Map(input.config.Env.map((item) => [item.slice(0, item.indexOf("=")), item.slice(item.indexOf("=") + 1)]));
      if (!probe) for (const line of readFileSync(argument(args, "--env-file"), "utf8").trim().split("\n")) {
        const split = line.indexOf("="); env.set(line.slice(0, split), line.slice(split + 1));
      }
      const id = options.sameId && created === 3 ? "2".repeat(64) : created.toString().repeat(64);
      const item = { Id: id, Name: `/${name}`, Image: input.imageId, State: { Status: "created", ExitCode: 0 },
        Config: { ...clone(input.config), Image: input.imageId, Env: [...env].map(([key, value]) => `${key}=${value}`),
          Labels: { ...input.config.Labels, ...Object.fromEntries(flags(args, "--label").map((entry) => entry.split("="))) },
          Entrypoint: probe ? [argument(args, "--entrypoint")] : input.config.Entrypoint,
          Cmd: probe ? args.slice(index + 1) : input.config.Cmd },
        HostConfig: { Privileged: false, NetworkMode: argument(args, "--network"), ReadonlyRootfs: args.includes("--read-only"),
          RestartPolicy: { Name: argument(args, "--restart"), MaximumRetryCount: 0 },
          CapDrop: flags(args, "--cap-drop"), CapAdd: flags(args, "--cap-add").map((cap) => `CAP_${cap}`),
          SecurityOpt: flags(args, "--security-opt"), Memory: Number(argument(args, "--memory")),
          MemorySwap: Number(argument(args, "--memory-swap")), NanoCpus: Number(argument(args, "--cpus")) * 1e9,
          PidsLimit: Number(argument(args, "--pids-limit")), ShmSize: Number(argument(args, "--shm-size")), Tmpfs: tmpfs,
          Binds: null, Devices: [], DeviceRequests: null, DeviceCgroupRules: null, VolumesFrom: null, Links: null,
          ExtraHosts: null, PortBindings: {}, PublishAllPorts: false, PidMode: "", IpcMode: "private", UTSMode: "",
          UsernsMode: "", CgroupnsMode: "private", ContainerIDFile: "", Runtime: "runc",
          Mounts: probe ? [] : [{ Type: "volume", Source: volume.Name, Target: "/var/lib/postgresql/data",
            VolumeOptions: { NoCopy: true } }] },
        Mounts: [...Object.keys(tmpfs).map((Destination) => ({ Type: "tmpfs", Destination, Source: "", RW: true })),
          ...(probe ? [] : [{ Type: "volume", Name: volume.Name, Destination: "/var/lib/postgresql/data", Source: volume.Mountpoint,
            Driver: "local", RW: true }])] };
      containers.set(name, item); return result(0, `${id}\n`);
    }
    if (args[0] === "volume" && args[1] === "create") {
      const name = args.at(-1); volume = { Name: name, Labels: Object.fromEntries(flags(args, "--label").map((entry) => entry.split("="))),
        Driver: "local", Scope: "local", Options: null, CreatedAt: new Date(clock).toISOString(),
        Mountpoint: `/var/lib/docker/volumes/${name}/_data` };
      if (options.foreignCreatedVolume) volume.Labels = { foreign: "true" };
      return result(0, `${name}\n`);
    }
    if (args[0] === "start") {
      const item = getContainer(args.at(-1)); assert.ok(item);
      item.State.Status = args.includes("--attach") ? "exited" : "running";
      if (args.includes("--attach")) return result(0, `${lock.apk.versionOutput}\nuid=70\ngid=70\nnnp=${options.probeNnp ?? 1}\n`);
      return result(0, `${item.Id}\n`);
    }
    if (args[0] === "exec") {
      if (args.includes("pg_isready")) return result(options.notReady ? 1 : 0);
      if (args.includes("/bin/sh")) {
        if (args.at(-1) === "readlink /proc/1/exe") return result(0, `${options.wrongExecutable ? "/bin/bash" : "/usr/local/bin/postgres"}\n`);
        const id = args.find((item) => /^[0-9]{64}$/u.test(item));
        const count = (processCounts.get(id) ?? 0) + 1; processCounts.set(id, count);
        if (options.rootInitializationForever || options.temporaryReady && count === 1) {
          return result(0, "uid=0 0 0 0\ngid=0 0 0 0\nnnp=1\n");
        }
        return result(0, `uid=70 ${options.wrongUid ? "0" : "70"} 70 70\ngid=70 70 70 70\nnnp=${options.processNnp ?? 1}\n`);
      }
      if (args.at(-1).startsWith("CREATE TABLE")) { saved = payload; return result(0, "CREATE TABLE\nINSERT 0 1\n"); }
      if (args.at(-1).startsWith("SELECT payload")) return result(0, `${options.wrongRead ? "wrong" : saved}\n`);
    }
    if (args[0] === "stop") {
      const item = getContainer(args.at(-1)); item.State = { Status: "exited", ExitCode: options.badExit ? 137 : 0 };
      return result(0, `${item.Id}\n`);
    }
    if (args[0] === "container" && args[1] === "rm") {
      if (options.cleanupFail) return result(1, "", "foreign private raw error");
      const item = getContainer(args.at(-1)); assert.ok(item); containers.delete(item.Name.slice(1)); return result(0, `${item.Id}\n`);
    }
    if (args[0] === "volume" && args[1] === "rm") {
      if (options.volumeCleanupFail) return result(1, "", "private volume error");
      assert.equal(containers.size, 0); volume = undefined; return result(0, `${args.at(-1)}\n`);
    }
    assert.fail(`Unhandled Docker command ${JSON.stringify(args)}`);
  };
  return { input, calls, checks, containers, get volume() { return volume; },
    controls: { beforeExecution: async () => { checks.push(calls.length);
      if (options.rejectBefore === checks.length) throw new Error("raw github_pat_must_never_escape"); } },
    dependencies: { runner, now: () => clock, sleep: async (ms) => { clock += ms; },
      randomBytes: (size) => Buffer.from((size === 12 ? "a" : "b").repeat(size * 2), "hex") },
    dispose: () => rmSync(parent, { recursive: true, force: true }) };
}

test("context rejects unbound identity, config, proof, callback and unsupported runtime", async () => {
  const input = snapshot(path.resolve("private-runtime"));
  for (const mutate of [
    (value) => { value.imageId = "postgres:latest"; }, (value) => { value.archiveProof.imageId = `sha256:${"0".repeat(64)}`; },
    (value) => { value.diffIds.pop(); }, (value) => { value.archiveProof.archiveBytes = 0; },
    (value) => { value.config.Cmd = ["/bin/sh"]; }, (value) => { value.config.User = "70"; },
    (value) => { value.config.Env.push("PGDATA=/foreign"); }, (value) => { value.config.Volumes["/foreign"] = {}; },
    (value) => { value.extra = "not allowed"; },
  ]) {
    const changed = { ...clone({ ...input, signal: undefined }), signal: input.signal }; mutate(changed);
    await assert.rejects(executePostgresCandidateRuntime(changed, { beforeExecution: async () => {} }), /postgres_runtime_(?:context|config)_invalid/u);
  }
  await assert.rejects(executePostgresCandidateRuntime(input, {}), /postgres_runtime_arguments_invalid/u);
  await assert.rejects(executePostgresCandidateRuntime(input, { beforeExecution: async () => {} }, { platform: "linux", uid: 0 }),
    /postgres_runtime_requires_nonroot_linux/u);
});

test("actual orchestration proves gosu, normal entrypoint and persistence in distinct owned containers", { skip: !runnable }, async () => {
  const value = harness();
  try {
    const receipt = await executePostgresCandidateRuntime(value.input, value.controls, value.dependencies);
    assert.equal(validatePostgresCandidateRuntimeReceipt(receipt, expectation(value.input)).state, "VERIFIED");
    assert.equal(receipt.gosu.version, "1.19 (go1.26.8 on linux/amd64; gc)");
    assert.equal(receipt.persistence.first.containerId, "2".repeat(64));
    assert.equal(receipt.persistence.second.containerId, "3".repeat(64));
    assert.equal(receipt.admission, "NOT_AUTHORIZED"); assert.equal(receipt.supportStartedAt, null);
    assert.equal(receipt.supportEndsAt, null); assert.equal(receipt.archiveUntil, null);
    assert.equal(value.checks.length, 7); assert.equal(value.containers.size, 0); assert.equal(value.volume, undefined);
    assert.deepEqual(readdirSync(value.input.parent), ["auth"]);
    const guarded = value.calls.filter(({ args }) => args[0] === "create" || args[0] === "start"
      || args[0] === "volume" && args[1] === "create");
    assert.equal(guarded.length, value.checks.length);
    for (const operation of guarded) assert.ok(value.checks.includes(value.calls.indexOf(operation)));
    const secondCreate = value.calls.findIndex(({ args }) => args[0] === "create" && args.includes(`aw-pg-runtime-${nonce}-two`));
    const firstRemoval = value.calls.findIndex(({ args }) => args[0] === "container" && args[1] === "rm" && args.at(-1) === "2".repeat(64));
    assert.ok(firstRemoval < secondCreate);
    const probe = value.calls.find(({ args }) => args[0] === "create" && args.includes(`aw-pg-runtime-${nonce}-probe`));
    assert.equal(spawnSync("/bin/sh", ["-n", "-c", probe.args.at(-1)]).status, 0);
    assert.equal(value.calls.filter(({ args }) => args.at(-1).startsWith("CREATE TABLE")).length, 1);
    assert.doesNotMatch(JSON.stringify(receipt), /POSTGRES_PASSWORD|github_pat_|bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/u);
    for (const mutate of [(entry) => { entry.admission = "AUTHORIZED"; }, (entry) => { entry.supportEndsAt = "2027-09-30"; },
      (entry) => { entry.persistence.second.containerId = entry.persistence.first.containerId; },
      (entry) => { entry.gosu.version = "1.19 (go1.26.5 on linux/amd64; gc)"; },
      (entry) => { entry.persistence.first.uid[2] = 0; }, (entry) => { entry.persistence.second.noNewPrivs = 0; },
      (entry) => { entry.cleanup.volume.name = "foreign"; }, (entry) => { entry.phases[0].extra = "leak"; }]) {
      const changed = clone(receipt); mutate(changed);
      assert.throws(() => validatePostgresCandidateRuntimeReceipt(changed, expectation(value.input)), /postgres_runtime_receipt_invalid/u);
    }
  } finally { value.dispose(); }
});

test("freshness callback rejection precedes each create/start and cleans earlier owned resources", { skip: !runnable }, async () => {
  for (const rejectBefore of [1, 2, 3, 4, 5, 6, 7]) {
    const value = harness({ rejectBefore });
    try {
      await assert.rejects(executePostgresCandidateRuntime(value.input, value.controls, value.dependencies),
        (error) => error.message === "postgres_runtime_before_execution_rejected");
      assert.equal(value.checks.length, rejectBefore); assert.equal(value.containers.size, 0); assert.equal(value.volume, undefined);
      assert.equal(value.calls.filter(({ args }) => args[0] === "create" || args[0] === "start"
        || args[0] === "volume" && args[1] === "create").length, rejectBefore - 1);
    } finally { value.dispose(); }
  }
});

test("complete Docker profiles reject extra authority and mounts before start", { skip: !runnable }, async () => {
  for (const [profileRole, mutateProfile] of [
    ["probe", (entry) => { entry.HostConfig.Privileged = true; }],
    ["probe", (entry) => { entry.HostConfig.Binds = ["/var/run/docker.sock:/docker.sock"]; }],
    ["probe", (entry) => { entry.HostConfig.Devices = [{ PathOnHost: "/dev/sda" }]; }],
    ["probe", (entry) => { entry.HostConfig.PidMode = "host"; }],
    ["probe", (entry) => { entry.HostConfig.CapAdd.push("CAP_SYS_ADMIN"); }],
    ["probe", (entry) => { entry.HostConfig.Tmpfs["/foreign"] = "rw"; }],
    ["probe", (entry) => { entry.Config.Cmd.push("ignored"); }],
    ["one", (entry) => { entry.Mounts.push({ Type: "volume", Name: "foreign", Destination: "/foreign", RW: true }); }],
    ["one", (entry) => { entry.HostConfig.Mounts[0].VolumeOptions.NoCopy = false; }],
    ["one", (entry) => { entry.HostConfig.PortBindings = { "5432/tcp": [{ HostPort: "5432" }] }; }],
    ["one", (entry) => { entry.Config.Env.push("AWS_SECRET_ACCESS_KEY=foreign"); }],
  ]) {
    const value = harness({ profileRole, mutateProfile });
    try {
      await assert.rejects(executePostgresCandidateRuntime(value.input, value.controls, value.dependencies), /postgres_runtime_profile_invalid/u);
      const id = profileRole === "probe" ? "1".repeat(64) : "2".repeat(64);
      assert.ok(!value.calls.some(({ args }) => args[0] === "start" && args.at(-1) === id));
      assert.equal(value.containers.size, 0); assert.equal(value.volume, undefined);
    } finally { value.dispose(); }
  }
});

test("real privilege, persistence, stop and readiness failures remain fixed diagnostics", { skip: !runnable }, async () => {
  for (const [options, code] of [[{ probeNnp: 0 }, "gosu_probe_invalid"], [{ wrongUid: true }, "process_invalid"],
    [{ processNnp: 0 }, "process_invalid"], [{ wrongExecutable: true }, "process_invalid"], [{ wrongRead: true }, "readback_invalid"],
    [{ badExit: true }, "stop_invalid"], [{ sameId: true }, "distinct_container_invalid"], [{ notReady: true }, "readiness_timeout"],
    [{ rootInitializationForever: true }, "readiness_timeout"]]) {
    const value = harness(options);
    try {
      await assert.rejects(executePostgresCandidateRuntime(value.input, value.controls, value.dependencies),
        (error) => error.message === `postgres_runtime_${code}`);
      assert.equal(value.containers.size, 0); assert.equal(value.volume, undefined);
      if (options.rootInitializationForever) assert.ok(!value.calls.some(({ args }) => args.at(-1) === "readlink /proc/1/exe"));
    } finally { value.dispose(); }
  }
});

test("temporary initialization readiness waits for the final postgres PID1 before SQL", { skip: !runnable }, async () => {
  const value = harness({ temporaryReady: true });
  try {
    const receipt = await executePostgresCandidateRuntime(value.input, value.controls, value.dependencies);
    assert.equal(receipt.state, "VERIFIED");
    for (const id of ["2".repeat(64), "3".repeat(64)]) {
      const observations = value.calls.filter(({ args }) => args[0] === "exec" && args.includes(id) && args.includes("/bin/sh"));
      assert.equal(observations.length, 3);
      assert.equal(observations[2].args.at(-1), "readlink /proc/1/exe");
      const sql = value.calls.findIndex(({ args }) => args[0] === "exec" && args.includes(id) && args.includes("psql"));
      assert.ok(sql > value.calls.indexOf(observations[2]));
    }
  } finally { value.dispose(); }
});

test("foreign volume collision is preserved and cleanup uncertainty overrides other failures", { skip: !runnable }, async () => {
  for (const [options, code] of [[{ foreignVolume: true }, "name_occupied"],
    [{ foreignCreatedVolume: true }, "cleanup_uncertain"], [{ wrongRead: true, cleanupFail: true }, "cleanup_uncertain"],
    [{ volumeCleanupFail: true }, "cleanup_uncertain"]]) {
    const value = harness(options);
    try {
      await assert.rejects(executePostgresCandidateRuntime(value.input, value.controls, value.dependencies),
        (error) => error.message === `postgres_runtime_${code}`);
      if (options.foreignVolume || options.foreignCreatedVolume) {
        assert.ok(!value.calls.some(({ args }) => args[0] === "volume" && args[1] === "rm"));
      }
    } finally { value.dispose(); }
  }
});
