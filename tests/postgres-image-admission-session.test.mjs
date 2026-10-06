import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const BROKER = new URL("../scripts/postgres-image/admission-broker.mjs", import.meta.url);
const ADMITTED = new URL("../scripts/postgres-image/admitted-postgres.mjs", import.meta.url);
const OBSERVABILITY = new URL("../scripts/postgres-image/admission-observability.mjs", import.meta.url);

if (typeof vm.SourceTextModule !== "function") {
  test("supported admission session VM tests", () => {
    const result = spawnSync(process.execPath, ["--experimental-vm-modules", "--test", SELF], {
      env: { ...process.env, AUTO_WORLD_ADMISSION_VM: "1" }, encoding: "utf8", timeout: 60_000,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  });
} else {
  const synthetic = (context, identifier, values) => {
    const names = Object.keys(values);
    return new vm.SyntheticModule(names, function initialize() {
      for (const name of names) this.setExport(name, values[name]);
    }, { context, identifier });
  };

  function stat(record) {
    return {
      dev: BigInt(record.dev ?? 1), ino: BigInt(record.ino), uid: BigInt(record.uid ?? 0), gid: BigInt(record.gid ?? 0),
      mode: BigInt(record.mode), nlink: BigInt(record.nlink ?? 1), size: BigInt(record.data?.length ?? 0),
      mtimeNs: BigInt(record.mtimeNs ?? 10), ctimeNs: BigInt(record.ctimeNs ?? 10),
      isFile: () => record.type === "file", isDirectory: () => record.type === "directory", isSymbolicLink: () => false,
      isSocket: () => record.type === "socket",
    };
  }

  function createFakeFs(archiveRaw, codeFiles, seedBackup = false) {
    let inode = 10;
    let descriptor = 100;
    const entries = new Map([
      ["/archive", { type: "directory", mode: 0o700, ino: inode++ }],
      ["/archive/image.tar", { type: "file", mode: 0o400, ino: inode++, data: Buffer.from(archiveRaw) }],
      ["/opt/auto-world/postgres-admission", { type: "directory", mode: 0o700, ino: inode++ }],
    ]);
    for (const [name, raw] of codeFiles) {
      entries.set(name, { type: "file", mode: 0o644, ino: inode++, data: Buffer.from(raw) });
    }
    if (seedBackup) {
      entries.set(path.join("/opt/auto-world/postgres-admission", "backups", "generation-7.dump"),
        { type: "file", mode: 0o600, ino: inode++, data: Buffer.from("PGDMP-restorable") });
    }
    const handles = new Map();
    const get = (name) => {
      const value = entries.get(name);
      if (!value) throw Object.assign(new Error(`missing:${name}`), { code: "ENOENT" });
      return value;
    };
    const api = {
      ...fs,
      chmodSync(name, mode) { get(name).mode = mode; },
      chownSync(name, uid, gid) { const item = get(name); item.uid = uid; item.gid = gid; },
      closeSync(fd) { if (!handles.delete(fd)) throw new Error("bad fd"); },
      fchmodSync(fd, mode) { handles.get(fd).record.mode = mode; },
      fstatSync(fd) { return stat(handles.get(fd).record); },
      fsyncSync() {},
      lstatSync(name) { return stat(get(name)); },
      linkSync(from, to) {
        if (entries.has(to)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
        const value = get(from); value.nlink = (value.nlink ?? 1) + 1; entries.set(to, value);
      },
      mkdirSync(name, options = {}) {
        if (entries.has(name)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
        entries.set(name, { type: "directory", mode: options.mode ?? 0o777, ino: inode++ });
      },
      openSync(name, flags, mode = 0o600) {
        let record = entries.get(name);
        if (!record && (flags & fs.constants.O_CREAT)) {
          record = { type: "file", mode, ino: inode++, data: Buffer.alloc(0) };
          entries.set(name, record);
        }
        if (!record) throw Object.assign(new Error("missing"), { code: "ENOENT" });
        if ((flags & fs.constants.O_EXCL) && (flags & fs.constants.O_CREAT) && record.data?.length) throw Object.assign(new Error("exists"), { code: "EEXIST" });
        const fd = descriptor++;
        handles.set(fd, { name, record, offset: 0 });
        return fd;
      },
      readFileSync(name, encoding) {
        const resolved = name instanceof URL ? fileURLToPath(name) : name;
        if (resolved === fileURLToPath(BROKER) || resolved === fileURLToPath(ADMITTED)) return fs.readFileSync(resolved, encoding);
        const data = Buffer.from(get(resolved).data ?? Buffer.alloc(0));
        return encoding ? data.toString(encoding) : data;
      },
      readSync(fd, buffer, offset, length, position) {
        const handle = handles.get(fd);
        const start = position === null ? handle.offset : position;
        const source = handle.record.data ?? Buffer.alloc(0);
        const count = Math.max(0, Math.min(length, source.length - start));
        source.copy(buffer, offset, start, start + count);
        if (position === null) handle.offset += count;
        return count;
      },
      readdirSync(name) {
        get(name);
        return [...entries.keys()].filter((item) => item !== name && path.dirname(item) === name).map((item) => path.basename(item));
      },
      realpathSync(name) { get(name); return name; },
      renameSync(from, to) { const value = get(from); entries.delete(from); entries.set(to, value); },
      unlinkSync(name) { const value = get(name); entries.delete(name); value.nlink = Math.max(0, (value.nlink ?? 1) - 1); },
      writeSync(fd, buffer, offset, length, position) {
        const handle = handles.get(fd);
        const start = position === null ? handle.offset : position;
        const required = start + length;
        if (handle.record.data.length < required) {
          const expanded = Buffer.alloc(required);
          handle.record.data.copy(expanded);
          handle.record.data = expanded;
        }
        buffer.copy(handle.record.data, start, offset, offset + length);
        if (position === null) handle.offset += length;
        return length;
      },
    };
    return { api, entries, readHandle: (fd) => Buffer.from(handles.get(fd).record.data),
      sourceStat: stat(entries.get("/archive/image.tar")), parentStat: stat(entries.get("/archive")) };
  }

  function nativeIdentity(value) {
    return {
      dev: String(value.dev), ino: String(value.ino), uid: Number(value.uid), gid: Number(value.gid),
      mode: Number(value.mode & 0o7777n), nlink: Number(value.nlink), size: Number(value.size),
      mtimeNs: String(value.mtimeNs), ctimeNs: String(value.ctimeNs),
    };
  }

  function fakeSpawn(observed, fakeFs) {
    return (command, args, options) => {
      observed.children.push({ command, args: [...args], env: { ...options.env } });
      const child = new EventEmitter();
      child.stdout = options.stdio?.[1] === "pipe" || !options.stdio ? new PassThrough() : undefined;
      child.stderr = options.stdio?.[2] === "pipe" || !options.stdio ? new PassThrough() : undefined;
      child.kill = () => {
        if (args.includes("psql") && (observed.forceChildTimeout || observed.childOverflowOnPsql)) {
          globalThis.setImmediate(() => child.emit("close", 0, null));
          return false;
        }
        return true;
      };
      const complete = () => {
        let output = Buffer.alloc(0);
        let errorOutput = Buffer.alloc(0);
        let exitCode = 0;
        if (args.includes("info")) output = Buffer.from(`${JSON.stringify({
          ID: "b".repeat(64), ServerVersion: "28.0.4", DockerRootDir: args.__dataRoot,
          Driver: "overlay2", OSType: "linux", Architecture: "x86_64",
          Containerd: { Address: "/run/containerd/containerd.sock", Namespaces: { Containers: args.__containers, Plugins: args.__plugins } },
        })}\n`);
        else if (args.includes("container") && args.includes("rm")) {
          if (observed.cleanupRmFailure) exitCode = 1;
          else (observed.removedContainers ??= new Set()).add(args.at(-1));
        }
        else if (args.includes("image") && args.includes("rm")) observed.imageRemoved = true;
        else if (args.includes("load")) { observed.imageRemoved = false; output = Buffer.from("Loaded image\n"); }
        else if (args.includes("inspect") && args.includes("image")) output = Buffer.from(`${JSON.stringify({
          Id: "sha256:" + "c".repeat(64), RootFS: { Layers: ["sha256:" + "d".repeat(64)] },
        })}\n`);
        else if (args.includes("inspect") && args.includes("container") && args.includes("{{json .State}}")) {
          output = Buffer.from(`${JSON.stringify({ Running: true, Dead: false })}\n`);
        }
        else if (args.includes("volume") && args.includes("create")) {
          const labels = {};
          for (let index = 0; index < args.length; index += 1) if (args[index] === "--label") {
            const [key, value] = args[index + 1].split("="); labels[key] = value;
          }
          const option = (name) => args.find((item) => item.startsWith(`${name}=`)).slice(name.length + 1);
          observed.volumeSpec = { Name: args.at(-1), Driver: "local", Scope: "local", Labels: labels,
            Options: { device: option("device"), o: option("o"), type: option("type") } };
          output = Buffer.from(`${args.at(-1)}\n`);
        }
        else if (args.includes("volume") && args.includes("inspect")) {
          const value = JSON.parse(JSON.stringify(observed.volumeSpec));
          if (observed.wrongVolumeLabels) value.Labels["com.auto-world.postgres-admission-generation"] = "999";
          output = Buffer.from(`${JSON.stringify(value)}\n`);
        }
        else if (args.includes("container") && args.includes("create")) {
          const labels = {};
          for (let index = 0; index < args.length; index += 1) if (args[index] === "--label") {
            const [key, value] = args[index + 1].split("="); labels[key] = value;
          }
          const mounts = args.filter((item) => item.startsWith("type="));
          const secret = Object.fromEntries(mounts[0].split(",").map((item) => item.includes("=") ? item.split("=") : [item, true]));
          const data = Object.fromEntries(mounts[1].split(",").map((item) => item.includes("=") ? item.split("=") : [item, true]));
          const containerId = (++observed.containerSequence).toString(16).padStart(64, "a");
          observed.removedContainers?.delete(containerId);
          observed.containerSpec = { Id: containerId, Image: args.at(-1), Labels: labels, Mounts: [
            { Type: "bind", Source: secret.src, Destination: secret.dst, RW: false },
            { Type: "volume", Name: data.src, Destination: data.dst, RW: true },
          ] };
          output = Buffer.from(`${containerId}\n`);
        }
        else if (args.includes("container") && args.includes("inspect")) {
          if (observed.removedContainers?.has(args.at(-1))) exitCode = 1;
          else {
            const value = JSON.parse(JSON.stringify(observed.containerSpec));
            if (observed.wrongContainerId) value.Id = "9".repeat(64);
            observed.containerInspects = (observed.containerInspects ?? 0) + 1;
            if (observed.mutateContainerInspectAfter !== undefined
              && observed.containerInspects >= observed.mutateContainerInspectAfter) value.Id = "8".repeat(64);
            output = Buffer.from(`${JSON.stringify(value)}\n`);
          }
        }
        else if (args.includes("/usr/bin/id")) output = Buffer.from("70\n");
        else if (args.includes("pg_isready") && observed.readinessFailures > 0) {
          observed.readinessFailures -= 1;
          exitCode = 1;
        }
        else if (args.includes("psql")) output = observed.childOverflowOnPsql
          ? Buffer.alloc(1024 * 1024 + 1, 0x61) : Buffer.from("auto-world-admission-v1\n");
        else if (args.includes("pg_dump")) {
          const dump = observed.largeDump ? Buffer.concat([Buffer.from("PGDMP"), Buffer.alloc(2 * 1024 * 1024, 0x62)])
            : Buffer.from("PGDMP-backup");
          fakeFs.api.writeSync(options.stdio[1], dump, 0, dump.length, 0);
        }
        else if (args.includes("pg_restore")) {
          observed.restoreInput = fakeFs.readHandle(options.stdio[0]);
          if (observed.swapRestoreAlias) {
            const source = [...fakeFs.entries.keys()].find((name) => name.endsWith("generation-7.dump"));
            fakeFs.entries.set(source, { type: "file", mode: 0o600, ino: 9999, data: Buffer.from("PGDMP-malicious") });
          }
        }
        if (observed.cleanupListTransportFailure && args.includes("ls") && args.includes("--quiet")) {
          exitCode = 1;
          errorOutput = Buffer.from("Cannot connect to the Docker daemon\n");
        }
        if (args.includes("inspect") && (observed.removedContainers?.has(args.at(-1))
          || args.includes("image") && observed.imageRemoved)) {
          output = Buffer.alloc(0);
          exitCode = 1;
        }
        child.stdout?.end(output);
        child.stderr?.end(errorOutput);
        child.emit("close", exitCode, null);
      };
      if (args.includes("psql") && observed.forceChildTimeout) { /* Timeout path owns completion. */ }
      else if (args.includes("psql")) globalThis.setTimeout(complete, 5);
      else globalThis.setImmediate(complete);
      return child;
    };
  }

  async function loadSession({ pending = false, corruptArchive = false, seedBackup = false, substituteSocket = false,
    renewalFailure = false, renewalFailureAfter = undefined, renewalRevokedAfter = undefined,
    renewalRevisionChange = false, observabilitySinkFailure = undefined,
    delayedHelperStart = false, readinessFailures = 0, largeArchive = false, largeDump = false,
    substituteSocketOnDrain = false, helperStopFailure = false, wrongVolumeLabels = false,
    wrongContainerId = false, mutateContainerInspectAfter = undefined, cleanupRmFailure = false,
    forceChildTimeout = false, childOverflowOnPsql = false, swapRestoreAlias = false,
    verifyRejectsAbortedSignal = false, cleanupListTransportFailure = false, sinkBackpressure = false,
    sinkAsyncErrorType = undefined, leaseDuration = 60_000, currentnessSeconds = undefined } = {}) {
    const archiveRaw = largeArchive ? Buffer.alloc(2 * 1024 * 1024 + 17, 0x61) : Buffer.from("fixed admitted archive bytes");
    const observed = { acquire: 0, renew: 0, close: 0, archiveFast: 0, children: [], events: [], helperStarts: 0,
      helperStops: 0, containerSequence: 0, readinessFailures, largeDump, wrongVolumeLabels, wrongContainerId, mutateContainerInspectAfter,
      cleanupRmFailure, forceChildTimeout, childOverflowOnPsql, swapRestoreAlias, cleanupListTransportFailure };
    const clock = { value: 0 };
    const signals = new EventEmitter();
    const sink = new EventEmitter();
    const processFacade = Object.freeze({
      argv: [process.execPath, "test-runner"],
      once: signals.once.bind(signals), off: signals.off.bind(signals),
      stderr: Object.freeze({ on: sink.on.bind(sink), off: sink.off.bind(sink), write: (line) => {
        const event = JSON.parse(line);
        if (observabilitySinkFailure?.type === event.type
          && (!observabilitySinkFailure.phase || observabilitySinkFailure.phase === event.phase)) {
          if (substituteSocketOnDrain) observed.substituteDuringDrain = true;
          throw new Error("fixture sink failure");
        }
        observed.events.push(event);
        if (sinkAsyncErrorType === event.type) globalThis.queueMicrotask(() => sink.emit("error", new Error("fixture async sink error")));
        return !sinkBackpressure;
      } }),
      stdout: Object.freeze({ write: () => true }),
    });
    const context = vm.createContext({
      AbortController: globalThis.AbortController, Buffer, clearTimeout: globalThis.clearTimeout, console, process: processFacade,
      setImmediate: globalThis.setImmediate,
      setTimeout: (callback, milliseconds, ...args) => forceChildTimeout && milliseconds >= 10_000
        ? globalThis.setImmediate(callback, ...args) : globalThis.setTimeout(callback, milliseconds, ...args),
      TextDecoder: globalThis.TextDecoder, TextEncoder: globalThis.TextEncoder, URL,
      performance: Object.freeze({ now: () => clock.value }),
    });
    const brokerRaw = fs.readFileSync(BROKER);
    const admittedRaw = fs.readFileSync(ADMITTED);
    const observabilityRaw = fs.readFileSync(OBSERVABILITY);
    const fakeFs = createFakeFs(archiveRaw,
      [[fileURLToPath(BROKER), brokerRaw], [fileURLToPath(ADMITTED), admittedRaw],
        [fileURLToPath(OBSERVABILITY), observabilityRaw]], seedBackup);
    const digest = (raw) => crypto.createHash("sha256").update(raw).digest("hex");
    const diffIds = ["sha256:" + "d".repeat(64)];
    context.fixtureGenerationRoot = JSON.stringify({
      executionFiles: [
        { path: "scripts/postgres-image/admission-broker.mjs", size: brokerRaw.length, sha256: digest(brokerRaw) },
        { path: "scripts/postgres-image/admission-observability.mjs", size: observabilityRaw.length, sha256: digest(observabilityRaw) },
        { path: "scripts/postgres-image/admitted-postgres.mjs", size: admittedRaw.length, sha256: digest(admittedRaw) },
      ],
    });
    context.fixtureDiffIdsSha256 = digest(Buffer.from(`${JSON.stringify(diffIds)}\n`));
    let authorityRevision = 3;
    let resolvedMainSha = "f".repeat(40);
    const validUntil = new Date(Date.now() + (currentnessSeconds ?? 30_000_000_000) * 1000).toISOString();
    const binding = () => {
      context.fixtureClock = clock.value;
      return vm.runInContext(`Object.freeze({
        admissionGeneration: 7, authorityRevision: ${authorityRevision}, revisionSha256: "${"e".repeat(64)}",
        resolvedMainSha: "${resolvedMainSha}", issuedMonotonic: fixtureClock, deadlineMonotonic: fixtureClock + ${leaseDuration},
        image: Object.freeze({ subject: "ghcr.io/example/postgres", manifestDigest: "sha256:${"b".repeat(64)}",
          configDigest: "sha256:${"c".repeat(64)}", diffIdsSha256: fixtureDiffIdsSha256 }),
        archiveSetId: "${"1".repeat(64)}", generationRoot: JSON.parse(fixtureGenerationRoot),
        currentness: Object.freeze({ p2ValidUntil: "${validUntil}", p3SettingsValidUntil: "${validUntil}",
          p3ManifestValidUntil: "${validUntil}", archiveValidUntil: "${validUntil}", supportValidUntil: "${validUntil}" })
      })`, context);
    };
    let current = binding();
    const authority = Object.freeze({
      acquire: async () => { observed.acquire += 1; if (pending) throw new Error("postgres_admission_authority_denied"); return Object.freeze({}); },
      renew: async () => {
        observed.renew += 1;
        observed.renewAtChildren = observed.children.length;
        if (renewalFailure || renewalFailureAfter !== undefined && observed.renew >= renewalFailureAfter) {
          throw new Error("postgres_admission_authority_denied");
        }
        if (renewalRevokedAfter !== undefined && observed.renew >= renewalRevokedAfter) {
          throw new Error("postgres_admission_authority_revoked");
        }
        if (renewalRevisionChange) {
          authorityRevision += 1;
          resolvedMainSha = authorityRevision.toString(16).padStart(40, "0");
        }
        current = binding(); return Object.freeze({});
      },
      assertCurrent: () => current,
      close: async () => { observed.close += 1; },
    });
    const parent = fakeFs.parentStat;
    const source = fakeFs.sourceStat;
    context.fixtureArchiveSource = JSON.stringify({
      path: "/archive/image.tar", size: archiveRaw.length,
      sha256: corruptArchive ? "0".repeat(64) : digest(archiveRaw), nativeIdentity: nativeIdentity(source),
      parentIdentity: { dev: String(parent.dev), ino: String(parent.ino), uid: Number(parent.uid),
        gid: Number(parent.gid), mode: Number(parent.mode & 0o7777n) },
    });
    const archiveSource = vm.runInContext("Object.freeze(JSON.parse(fixtureArchiveSource))", context);
    const modules = new Map();
    modules.set("./admission-authority.mjs", synthetic(context, "mock:authority", {
      openPostgresAdmissionAuthority: async () => authority,
    }));
    modules.set("./admission-archive-maintenance.mjs", synthetic(context, "mock:archive", {
      loadPostgresAdmissionArchiveContext: () => Object.freeze({}),
      verifyPostgresAdmissionArchiveFast: () => { observed.archiveFast += 1; },
      getPostgresAdmissionImageArchiveSource: () => archiveSource,
    }));
    const observability = new vm.SourceTextModule(observabilityRaw.toString("utf8"), {
      context, identifier: OBSERVABILITY.href, initializeImportMeta: (meta) => { meta.url = OBSERVABILITY.href; },
    });
    await observability.link(() => { throw new Error("observability has no imports"); });
    await observability.evaluate();
    modules.set("./admission-observability.mjs", observability);
    modules.set("../docker-isolated/daemon-postgres-runtime-helper.mjs", synthetic(context, "mock:helper", {
      postgresRuntimeDaemonConfiguration: (spec) => {
        // Bind values used by the fake Docker info response without creating a production seam.
        observed.dataRoot = spec.dataRoot; observed.containers = spec.containersNamespace; observed.plugins = spec.pluginsNamespace;
        return {};
      },
      createPostgresRuntimeDaemonHelper: () => Object.freeze({
        start: async (spec, signal) => {
          observed.helperStarts += 1;
          (observed.daemonRoots ??= []).push(spec.root);
          fakeFs.entries.set(spec.socket, { type: "socket", mode: 0o660, uid: 0, gid: 1000, nlink: 1, ino: 999 });
          if (delayedHelperStart) {
            for (let attempt = 0; attempt < 4; attempt += 1) {
              await new Promise((resolve) => globalThis.setImmediate(resolve));
              if (signal.aborted) throw new Error("daemon_postgres_runtime_cleanup_uncertain");
            }
          }
          return Object.freeze({ pid: 10, startTicks: "1", daemonId: "b".repeat(64), namespacesFresh: true });
        },
        verify: async (spec, _child, signal) => {
          observed.helperVerifies = (observed.helperVerifies ?? 0) + 1;
          if (verifyRejectsAbortedSignal && signal?.aborted) throw new Error("daemon_postgres_runtime_helper_invalid");
          if ((substituteSocket && observed.helperVerifies === 1) || observed.substituteDuringDrain) {
            fakeFs.entries.get(spec.socket).ino += 1;
            observed.substituteDuringDrain = false;
          }
          context.fixtureArgvSha256 = spec.argvSha256;
          context.fixtureConfigSha256 = spec.configSha256;
          return vm.runInContext(`Object.freeze({
            state: "RUNNING", pid: 10, startTicks: "1", uid: 0, gid: 0, executable: "/usr/bin/dockerd", version: "28.0.4",
            argvSha256: fixtureArgvSha256, configSha256: fixtureConfigSha256
          })`, context);
        },
        stop: async () => {
          observed.helperStops += 1;
          if (helperStopFailure) throw new Error("daemon_postgres_runtime_cleanup_uncertain");
          return Object.freeze({ state: "STOPPED", pid: 10, startTicks: "1", processGone: true });
        },
      }),
    }));
    modules.set("../docker-isolated/daemon-postgres-runtime.mjs", synthetic(context, "mock:guards", {
      validatePostgresRuntimeDaemonStartProof: (value) => value,
      validatePostgresRuntimeDaemonStopProof: (value) => value,
      validatePostgresRuntimeDaemonInfo: (value, expected) => {
        assert.equal(value.ID, expected.id);
        assert.equal(expected.root, observed.dataRoot);
        return value;
      },
    }));
    const spawn = (command, args, options) => {
      Object.defineProperties(args, {
        __dataRoot: { value: observed.dataRoot }, __containers: { value: observed.containers }, __plugins: { value: observed.plugins },
      });
      return fakeSpawn(observed, fakeFs)(command, args, options);
    };
    modules.set("node:child_process", synthetic(context, "mock:child_process", { spawn }));
    modules.set("node:perf_hooks", synthetic(context, "mock:perf_hooks", {
      performance: Object.freeze({ now: () => clock.value }),
    }));
    modules.set("node:fs", synthetic(context, "mock:fs", Object.fromEntries(
      Object.keys(fakeFs.api).filter((key) => key !== "default").map((key) => [key, fakeFs.api[key]]),
    )));
    modules.set("node:timers/promises", synthetic(context, "mock:timers", {
      setTimeout: (milliseconds, _value, options = {}) => new Promise((resolve, reject) => globalThis.setImmediate(() => {
        if (options.signal?.aborted) reject(Object.assign(new Error("aborted"), { name: "AbortError", code: "ABORT_ERR" }));
        else { clock.value += milliseconds === 0 ? 0 : 18_000; resolve(); }
      })),
    }));
    const module = new vm.SourceTextModule(brokerRaw.toString("utf8"), {
      context, identifier: BROKER.href, initializeImportMeta: (meta) => { meta.url = BROKER.href; },
    });
    await module.link(async (specifier) => {
      if (modules.has(specifier)) return modules.get(specifier);
      const namespace = await import(specifier);
      return synthetic(context, specifier, Object.fromEntries(Object.keys(namespace).map((key) => [key, namespace[key]])));
    });
    await module.evaluate();
    context.broker = module.namespace;
    const entrypoint = new vm.SourceTextModule(admittedRaw.toString("utf8"), {
      context, identifier: ADMITTED.href, initializeImportMeta: (meta) => { meta.url = ADMITTED.href; },
    });
    await entrypoint.link(async (specifier) => {
      if (specifier === "./admission-broker.mjs") return module;
      if (modules.has(specifier)) return modules.get(specifier);
      const namespace = await import(specifier);
      return synthetic(context, `entrypoint:${specifier}`, Object.fromEntries(Object.keys(namespace).map((key) => [key, namespace[key]])));
    });
    await entrypoint.evaluate();
    context.admitted = entrypoint.namespace;
    return { context, observed, fakeFs };
  }

  test("PENDING authority denies the actual supported route before daemon and child effects", async () => {
    const { context, observed } = await loadSession({ pending: true });
    await assert.rejects(vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
    })`, context),
      /postgres_admission_authority_denied/u);
    assert.equal(observed.acquire, 1);
    assert.equal(observed.helperStarts, 0);
    assert.equal(observed.children.length, 0);
    assert.equal(observed.close, 1);
  });

  test("typed MIGRATION is authority checked and denied before daemon effects until its reviewed contract exists", async () => {
    const { context, observed } = await loadSession();
    await assert.rejects(vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "MIGRATION"
    })`, context),
      /postgres_admission_migration_contract_unavailable/u);
    assert.equal(observed.acquire, 1);
    assert.equal(observed.archiveFast, 1);
    assert.equal(observed.helperStarts, 0);
    assert.equal(observed.children.length, 0);
    assert.equal(observed.close, 1);
  });

  test("ACTIVE SQL_CHECK follows the production composite, renews, and drains owned runtime", async () => {
    const { context, observed } = await loadSession();
    const result = await vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
    })`, context);
    assert.equal(result.state, "COMPLETED");
    assert.equal(result.intent, "SQL_CHECK");
    assert.ok(observed.renew >= 1);
    assert.equal(observed.helperStarts, 1);
    assert.equal(observed.helperStops, 1);
    assert.equal(observed.close, 1);
    assert.ok(observed.children.some(({ args }) => args.includes("pg_isready")));
    assert.ok(observed.children.some(({ args }) => args.includes("psql")));
    assert.ok(observed.children.some(({ args }) => args.includes("stop")));
    assert.ok(observed.events.some((event) => event.type === "AUTHORITY_CHECK" && event.result === "SUCCEEDED"));
    assert.ok(observed.events.some((event) => event.type === "RENEWAL" && event.result === "SUCCEEDED"));
    assert.ok(observed.events.some((event) => event.type === "SESSION" && event.intent === "SQL_CHECK"
      && event.result === "SUCCEEDED"));
    assert.ok(observed.events.some((event) => event.type === "DRAIN" && event.result === "SUCCEEDED"));
    assert.ok(observed.events.some((event) => event.type === "CURRENTNESS"
      && event.p2SecondsRemaining > 0 && event.archiveHealthSecondsRemaining > 0));
    assert.deepEqual(observed.events.filter((event) => event.type === "PHASE").map((event) => event.phase), [
      "AUTHORITY", "IMAGE_ACQUIRE", "DAEMON_START", "IMAGE_LOAD", "VOLUME_CREATE", "CONTAINER_CREATE",
      "CONTAINER_START", "READINESS", "SQL_CHECK", "STOP", "CLEANUP",
    ]);
    for (const child of observed.children) {
      assert.deepEqual(Object.keys(child.env).sort(), ["DOCKER_CONFIG", "HOME", "LANG", "LC_ALL", "PATH", "TZ"]);
      assert.equal(child.env.GH_TOKEN, undefined);
      assert.equal(child.env.GITHUB_TOKEN, undefined);
    }
  });

  test("archive substitution fails before Docker image load and still stops the owned daemon", async () => {
    const { context, observed } = await loadSession({ corruptArchive: true });
    await assert.rejects(vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
    })`, context),
      /postgres_admission_archive_invalid/u);
    assert.equal(observed.helperStarts, 1);
    assert.equal(observed.helperStops, 1);
    assert.equal(observed.children.some(({ args }) => args.includes("load")), false);
  });

  test("socket substitution is denied before the first Docker child effect", async () => {
    const { context, observed } = await loadSession({ substituteSocket: true });
    await assert.rejects(vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
    })`, context), /postgres_admission_daemon_invalid/u);
    assert.equal(observed.helperStarts, 1);
    assert.equal(observed.helperStops, 1);
    assert.equal(observed.children.length, 0);
  });

  test("the supported module admits only one foreground composite session at a time", async () => {
    const { context, observed } = await loadSession();
    const pair = vm.runInContext(`(() => {
      const input = { kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK" };
      return [admitted.runPostgresSupportedSession(input), admitted.runPostgresSupportedSession(input)];
    })()`, context);
    await assert.rejects(pair[1], /postgres_admission_operation_cancelled/u);
    assert.equal((await pair[0]).state, "COMPLETED");
    assert.equal(observed.acquire, 1);
  });

  test("SERVICE stays foreground and an authority renewal failure drains its owned runtime", async () => {
    const { context, observed } = await loadSession({ renewalFailureAfter: 30 });
    await assert.rejects(vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SERVICE"
    })`, context), /postgres_admission_authority_denied/u);
    assert.equal(observed.renew, 30);
    assert.equal(observed.helperStarts, 1);
    assert.equal(observed.helperStops, 1);
    assert.ok(observed.children.some(({ args }) => args.includes("inspect") && args.includes("container")));
    assert.ok(observed.children.some(({ args }) => args.includes("stop")));
    assert.ok(observed.events.some((event) => event.type === "ALERT" && event.alert === "RENEWAL_FAILURE"));
  });

  test("authenticated renewal revocation marks the lease and alerts only with an owned container", async () => {
    const { context, observed } = await loadSession({ renewalRevokedAfter: 30 });
    await assert.rejects(vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SERVICE"
    })`, context), /postgres_admission_authority_revoked/u);
    assert.ok(observed.events.some((event) => event.type === "LEASE_STATE" && event.state === "REVOKED"));
    assert.ok(observed.events.some((event) => event.type === "ALERT" && event.alert === "REVOKED_WITH_OWNED_SERVICE"));
    assert.equal(observed.helperStops, 1);
    assert.equal(observed.close, 1);
  });

  test("an observability sink failure denies the real route, starts no later operation, and still drains", async () => {
    const { context, observed } = await loadSession({
      observabilitySinkFailure: { type: "PHASE", phase: "DAEMON_START" },
    });
    await assert.rejects(vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
    })`, context), /postgres_admission_observability_sink_failed/u);
    assert.equal(observed.helperStarts, 1);
    assert.equal(observed.helperStops, 1);
    assert.equal(observed.close, 1);
    assert.equal(observed.children.some(({ args }) => args.includes("load")), false);
    assert.equal(observed.children.some(({ args }) => args.includes("volume") && args.includes("create")), false);
    assert.ok(observed.events.some((event) => event.type === "DRAIN" && event.result === "SUCCEEDED"));
  });

  test("observability backpressure and asynchronous stream failure both deny and drain", async () => {
    const pressured = await loadSession({ sinkBackpressure: true });
    await assert.rejects(vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
    })`, pressured.context), /postgres_admission_observability_sink_failed/u);
    assert.equal(pressured.observed.helperStarts, 0);
    const asynchronous = await loadSession({ sinkAsyncErrorType: "RENEWAL" });
    await assert.rejects(vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SERVICE"
    })`, asynchronous.context), /postgres_admission_observability_sink_failed/u);
    assert.equal(asynchronous.observed.helperStops, 1);
    assert.equal(asynchronous.observed.close, 1);
  });

  test("asynchronous sink failure before runtime is latched before filesystem or child effects", async () => {
    for (const type of ["LEASE_STATE", "AUTHORITY_CHECK"]) {
      const { context, observed } = await loadSession({ sinkAsyncErrorType: type });
      await assert.rejects(vm.runInContext(`admitted.runPostgresSupportedSession({
        kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
      })`, context), /postgres_admission_observability_sink_failed/u);
      assert.equal(observed.helperStarts, 0);
      assert.equal(observed.children.length, 0);
      assert.equal(observed.close, 1);
    }
  });

  test("valid currentness inside sixty seconds emits closed warnings", async () => {
    const { context, observed } = await loadSession({ currentnessSeconds: 55 });
    assert.equal((await vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
    })`, context)).state, "COMPLETED");
    assert.deepEqual(new Set(observed.events.filter((event) => event.type === "ALERT").map((event) => event.alert)),
      new Set(["P2_WARNING", "P3_SETTINGS_WARNING", "P3_MANIFEST_WARNING", "ARCHIVE_WARNING"]));
  });

  test("renewal accepts a newer ACTIVE authority revision and unrelated main for the same frozen generation", async () => {
    const { context, observed } = await loadSession({ renewalRevisionChange: true });
    const result = await vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
    })`, context);
    assert.ok(observed.renew >= 1);
    assert.ok(result.authorityRevision > 3);
    assert.notEqual(result.resolvedMainSha, "f".repeat(40));
  });

  test("a renewal denial during delayed daemon startup cancels before any Docker operation", async () => {
    const { context, observed } = await loadSession({ delayedHelperStart: true, renewalFailure: true });
    await assert.rejects(vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
    })`, context), /postgres_admission_authority_denied|postgres_admission_daemon_invalid/u);
    assert.equal(observed.renew, 1);
    assert.equal(observed.helperStarts, 1);
    assert.equal(observed.children.length, 0);
    assert.equal(observed.close, 1);
  });

  test("a short clamped lease renews before its renewal and drain reserve is consumed", async () => {
    const { context, observed } = await loadSession({ leaseDuration: 30_000, renewalFailure: true });
    await assert.rejects(vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
    })`, context), /postgres_admission_authority_denied/u);
    assert.equal(observed.renew, 1);
    assert.ok(observed.events.some((event) => event.type === "RENEWAL" && event.result === "FAILED"));
    assert.equal(observed.helperStops, observed.helperStarts);
  });

  test("long archive, readiness, and dump work yields across lease renewal boundaries", async () => {
    const { context, observed } = await loadSession({ largeArchive: true, readinessFailures: 2, largeDump: true });
    const result = await vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "BACKUP"
    })`, context);
    assert.equal(result.state, "COMPLETED");
    assert.ok(observed.renew >= 3);
    assert.equal(observed.readinessFailures, 0);
    assert.ok(observed.children.some(({ args }) => args.includes("pg_dump")));
  });

  test("drain attempts helper stop and authority close after cleanup substitution and sink failure", async () => {
    const { context, observed } = await loadSession({
      observabilitySinkFailure: { type: "PHASE", phase: "SQL_CHECK" },
      substituteSocketOnDrain: true, helperStopFailure: true,
    });
    await assert.rejects(vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
    })`, context), /postgres_admission_cleanup_uncertain/u);
    assert.equal(observed.helperStops, 1);
    assert.equal(observed.close, 1);
  });

  test("cleanup exit one is uncertain and still attempts helper stop and authority closure", async () => {
    const { context, observed } = await loadSession({ cleanupRmFailure: true });
    await assert.rejects(vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
    })`, context), /postgres_admission_cleanup_uncertain/u);
    assert.equal(observed.helperStops, 1);
    assert.equal(observed.close, 1);
  });

  test("cleanup uses a live independent guard signal and rejects transport failure as absence", async () => {
    const successful = await loadSession({ verifyRejectsAbortedSignal: true });
    assert.equal((await vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
    })`, successful.context)).state, "COMPLETED");
    assert.equal(successful.observed.helperStops, 1);
    const failed = await loadSession({ verifyRejectsAbortedSignal: true, cleanupListTransportFailure: true });
    await assert.rejects(vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
    })`, failed.context), /postgres_admission_cleanup_uncertain/u);
    assert.equal(failed.observed.helperStops, 1);
    assert.equal(failed.observed.close, 1);
  });

  test("timeout and output overflow stay failed when kill returns false and close reports zero", async () => {
    for (const fixture of [{ forceChildTimeout: true }, { childOverflowOnPsql: true }]) {
      const { context, observed } = await loadSession(fixture);
      await assert.rejects(vm.runInContext(`admitted.runPostgresSupportedSession({
        kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
      })`, context), /postgres_admission_sql_check_failed/u);
      assert.equal(observed.helperStops, 1);
      assert.equal(observed.close, 1);
    }
  });

  test("wrong volume labels and a substituted container ID deny before start", async () => {
    for (const fixture of [{ wrongVolumeLabels: true }, { wrongContainerId: true }]) {
      const { context, observed } = await loadSession(fixture);
      await assert.rejects(vm.runInContext(`admitted.runPostgresSupportedSession({
        kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
      })`, context), /postgres_admission_(?:volume|container)_invalid/u);
      assert.equal(observed.children.some(({ args }) => args.includes("container") && args.includes("start")), false);
      assert.equal(observed.helperStops, 1);
    }
  });

  test("container substitution is rechecked before start, readiness, SQL, backup, and restore effects", async () => {
    for (const [intent, seedBackup, threshold, effect] of [
      ["SQL_CHECK", false, 4, "start"],
      ["SQL_CHECK", false, 6, "pg_isready"],
      ["SQL_CHECK", false, 8, "psql"],
      ["BACKUP", false, 8, "pg_dump"],
      ["RESTORE_VERIFY", true, 8, "pg_restore"],
    ]) {
      const { context, observed } = await loadSession({ seedBackup, mutateContainerInspectAfter: threshold });
      await assert.rejects(vm.runInContext(`admitted.runPostgresSupportedSession({
        kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "${intent}"
      })`, context), /postgres_admission_container_invalid/u, `${intent} threshold ${threshold}`);
      assert.equal(observed.children.some(({ args }) => args.includes(effect)), false);
      assert.equal(observed.helperStops, 1);
    }
  });

  test("successive sessions reuse the sealed generation data identity across distinct daemon roots", async () => {
    const { context, observed } = await loadSession();
    const invoke = () => vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
    })`, context);
    assert.equal((await invoke()).state, "COMPLETED");
    assert.equal((await invoke()).state, "COMPLETED");
    assert.equal(new Set(observed.daemonRoots).size, 2);
    const devices = observed.children.filter(({ args }) => args.includes("volume") && args.includes("create"))
      .map(({ args }) => args.find((item) => item.startsWith("device=")));
    assert.equal(devices.length, 2);
    assert.equal(devices[0], devices[1]);
  });

  test("a substituted persistent data inode denies the next session before daemon or Docker effects", async () => {
    const { context, observed, fakeFs } = await loadSession();
    assert.equal((await vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
    })`, context)).state, "COMPLETED");
    const device = observed.children.find(({ args }) => args.includes("volume") && args.includes("create"))
      .args.find((item) => item.startsWith("device=")).slice("device=".length);
    fakeFs.entries.get(device).ino += 1;
    const childrenBefore = observed.children.length;
    const startsBefore = observed.helperStarts;
    await assert.rejects(vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
    })`, context), /postgres_admission_volume_invalid/u);
    assert.equal(observed.helperStarts, startsBefore);
    assert.equal(observed.children.length, childrenBefore);
  });

  test("a generation-root substitution in the sealed data binding denies before daemon effects", async () => {
    const { context, observed, fakeFs } = await loadSession();
    assert.equal((await vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
    })`, context)).state, "COMPLETED");
    const bindingEntry = [...fakeFs.entries].find(([name]) => name.endsWith("postgres-data-binding.json"))[1];
    const binding = JSON.parse(bindingEntry.data);
    binding.generationRootSha256 = "0".repeat(64);
    bindingEntry.data = Buffer.from(`${JSON.stringify(binding)}\n`);
    const startsBefore = observed.helperStarts;
    const childrenBefore = observed.children.length;
    await assert.rejects(vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "SQL_CHECK"
    })`, context), /postgres_admission_volume_invalid/u);
    assert.equal(observed.helperStarts, startsBefore);
    assert.equal(observed.children.length, childrenBefore);
  });

  test("BACKUP uses only the fixed pg_dump command and preserves the owned volume", async () => {
    const { context, observed } = await loadSession();
    const result = await vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "BACKUP"
    })`, context);
    assert.equal(result.intent, "BACKUP");
    const invocation = observed.children.find(({ args }) => args.includes("pg_dump"));
    assert.ok(invocation);
    assert.deepEqual(invocation.args.slice(invocation.args.indexOf("pg_dump")), [
      "pg_dump", "--host=/var/run/postgresql", "--port=5432", "--username=awapp", "--no-password",
      "--dbname=awapp", "--format=custom",
    ]);
    assert.equal(observed.children.some(({ args }) => args.includes("volume") && args.includes("rm")), false);
  });

  test("RESTORE_VERIFY uses the fixed pg_restore transaction and follows it with the fixed SQL check", async () => {
    const { context, observed } = await loadSession({ seedBackup: true });
    const result = await vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "RESTORE_VERIFY"
    })`, context);
    assert.equal(result.intent, "RESTORE_VERIFY");
    const restore = observed.children.find(({ args }) => args.includes("pg_restore"));
    assert.ok(restore);
    assert.deepEqual(restore.args.slice(restore.args.indexOf("pg_restore")), [
      "pg_restore", "--host=/var/run/postgresql", "--port=5432", "--username=awapp", "--no-password",
      "--dbname=awapp", "--single-transaction", "--no-owner", "--no-privileges",
    ]);
    assert.ok(observed.children.some(({ args }) => args.includes("psql") && args.at(-1).includes("CREATE TEMP TABLE")
      && args.at(-1).includes("INSERT INTO auto_world_admission_probe") && args.at(-1).endsWith("ROLLBACK;")));
  });

  test("restore keeps the authenticated descriptor and rejects a pathname swap after the effect", async () => {
    const { context, observed } = await loadSession({ seedBackup: true, swapRestoreAlias: true });
    await assert.rejects(vm.runInContext(`admitted.runPostgresSupportedSession({
      kind: "POSTGRES_SUPPORTED_SESSION_V1", intent: "RESTORE_VERIFY"
    })`, context), /postgres_admission_restore_failed/u);
    assert.equal(observed.restoreInput.toString(), "PGDMP-restorable");
    assert.equal(observed.children.some(({ args }) => args.includes("psql")), false);
    assert.equal(observed.helperStops, 1);
    assert.equal(observed.close, 1);
  });
}
