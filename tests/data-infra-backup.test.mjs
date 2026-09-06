import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  createBackupRuntime,
  planServiceRecovery,
  validateManifest,
  validateTarArchive,
} from "../scripts/data-infra/backup.mjs";
import { InfraError, images } from "../scripts/data-infra/runtime.mjs";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

test("service recovery preserves only exact running and exited states", () => {
  const plan = planServiceRecovery({
    postgres: { state: "running" },
    opensearch: { state: "exited" },
    redis: { state: "running" },
    "object-store": { state: "exited" },
  });
  assert.deepEqual(plan.states, {
    postgres: "running",
    opensearch: "exited",
    redis: "running",
    "object-store": "exited",
  });
  assert.deepEqual(plan.running, ["postgres", "redis"]);
  for (const state of ["absent", "paused", "restarting", "created", "dead"]) {
    assert.throws(
      () => planServiceRecovery({
        postgres: { state },
        opensearch: { state: "exited" },
        redis: { state: "exited" },
        "object-store": { state: "exited" },
      }),
      hasCode("backup_service_state_invalid"),
    );
  }
});

test("manifest binds fixed archive names and exact manifest/platform digests without secrets", () => {
  const manifest = validateManifest(validManifest());
  assert.equal(Object.isFrozen(manifest), true);
  assert.equal(manifest.images.postgres.platform.digest, images.postgres.platform.digest);
  assert.equal(manifest.archives.postgres.filename, "postgres.tar");
  assert.doesNotMatch(JSON.stringify(manifest), /pgBootstrap|s3Secret|password/u);
});

test("manifest refuses version, platform, digest, service and archive drift", () => {
  for (const mutate of [
    (value) => { value.schemaVersion = 2; },
    (value) => { value.images.postgres.manifestDigest = `sha256:${"a".repeat(64)}`; },
    (value) => { value.images.postgres.platform.architecture = "arm64"; },
    (value) => { value.services.redis = "paused"; },
    (value) => { value.archives.postgres.filename = "../postgres.tar"; },
    (value) => { value.archives.postgres.sha256 = "sha256:bad"; },
  ]) {
    const candidate = validManifest();
    mutate(candidate);
    assert.throws(() => validateManifest(candidate), (error) => error instanceof InfraError);
  }
});

test("tar validator accepts a regular relative entry and rejects traversal and all links", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "aw-backup-test-"));
  try {
    const valid = path.join(directory, "valid.tar");
    await writeFile(valid, tar([{ name: "./base/PG_VERSION", data: Buffer.from("17\n") }]));
    assert.deepEqual(await validateTarArchive(valid), { entries: 1 });
    await assert.rejects(
      validateTarArchive(valid, { deadlineAt: Date.now() - 1 }),
      hasCode("deadline_exceeded"),
    );

    const traversal = path.join(directory, "traversal.tar");
    await writeFile(traversal, tar([{ name: "../../escape", data: Buffer.from("x") }]));
    await assert.rejects(validateTarArchive(traversal), hasCode("backup_tar_path_unsafe"));

    const link = path.join(directory, "link.tar");
    await writeFile(link, tar([{ name: "./base/link", type: "2", link: "../../../escape" }]));
    await assert.rejects(validateTarArchive(link), hasCode("backup_tar_type_unsafe"));
  } finally {
    assert.ok(directory.startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
});

test("tar validator rejects dangerous node types and checksum tampering", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "aw-backup-test-"));
  try {
    const device = path.join(directory, "device.tar");
    await writeFile(device, tar([{ name: "./device", type: "3" }]));
    await assert.rejects(validateTarArchive(device), hasCode("backup_tar_type_unsafe"));
    const changed = tar([{ name: "./safe", data: Buffer.from("x") }]);
    changed[0] ^= 1;
    const tampered = path.join(directory, "tampered.tar");
    await writeFile(tampered, changed);
    await assert.rejects(validateTarArchive(tampered), hasCode("backup_tar_checksum"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cold backup stops only running services, archives stopped volumes and restores prior state", async () => {
  const checkout = await mkdtemp(path.join(tmpdir(), "aw-backup-flow-"));
  const project = "aw-test-backup-flow";
  const state = {
    project,
    ownerToken: `0123456789abcdef-${UUID}`,
    dir: path.join(checkout, ".local-data", "projects", project),
  };
  const initial = {
    postgres: { state: "running", health: "healthy" },
    opensearch: { state: "exited" },
    redis: { state: "running", health: "healthy" },
    "object-store": { state: "running", health: "healthy" },
  };
  let phase = "initial";
  const calls = { stop: [], start: [] };
  try {
    await mkdir(state.dir, { recursive: true });
    await writeFile(path.join(state.dir, "operation.lock"), `${process.pid}\n`);
    const runtime = {
      assertLocalDocker: async () => undefined,
      serviceStates: async () => phase === "stopped"
        ? Object.fromEntries(Object.keys(initial).map((service) => [service, { state: "exited" }]))
        : initial,
      ownedVolumes: async () => Object.values({
        postgres: "postgres-data",
        opensearch: "opensearch-data",
        redis: "redis-data",
        object: "object-store-data",
      }).map((name) => `${project}_${name}`),
      stop: async (_state, services) => { calls.stop.push(services); phase = "stopped"; },
      start: async (recoveryState, services) => {
        assert.ok(recoveryState.deadlineAt > Date.now());
        calls.start.push(services);
        phase = "recovered";
      },
    };
    const backupRuntime = createBackupRuntime({
      checkout,
      runtime,
      uuid: () => UUID,
      now: () => new Date("2026-09-06T12:00:00.000Z"),
      runProcess: async (_command, args) => {
        if (args[0] === "image" && args[1] === "inspect") {
          const image = args[2].startsWith("postgres@") ? images.postgres : images.seaweedfs;
          return ok(JSON.stringify([{
            RepoDigests: [`${image.repository}@${image.manifestDigest}`],
            Os: image.platform.os,
            Architecture: image.platform.architecture,
            Variant: image.platform.variant,
          }]));
        }
        if (args[0] === "ps") {
          const volume = args.find((value) => value.startsWith("volume="));
          const service = Object.entries({
            "postgres-data": "postgres",
            "opensearch-data": "opensearch",
            "redis-data": "redis",
            "object-store-data": "object-store",
          }).find(([name]) => volume.endsWith(name))[1];
          return ok(`id-${service}\n`);
        }
        if (args[0] === "container" && args[1] === "inspect") {
          if (!args[2].startsWith("id-")) return { stdout: "", stderr: "not found", code: 1 };
          const service = args[2].slice(3);
          return ok(JSON.stringify([{ Config: { Labels: {
            "io.auto-world.owner": state.ownerToken,
            "com.docker.compose.project": project,
            "com.docker.compose.service": service,
          } } }]));
        }
        if (args[0] === "container" && args[1] === "ls") return ok("");
        if (args[0] === "run" && args.includes("-cf")) {
          assert.equal(args.includes("--privileged"), false);
          assert.deepEqual(
            args.flatMap((value, index) => args[index - 1] === "--cap-add" ? [value] : []),
            ["DAC_OVERRIDE"],
          );
          assert.equal(args.includes("none"), true);
          const mount = args.find((value) => value.includes("dst=/backup") && value.startsWith("type=bind"));
          const directory = mount.slice("type=bind,src=".length, mount.indexOf(",dst=/backup"));
          const filename = path.basename(args.at(-2));
          await writeFile(path.join(directory, filename), tar([{ name: "./data", data: Buffer.from("evidence") }]));
          return ok("");
        }
        if (args[0] === "run" && args.includes("chown")) return ok("");
        throw new Error(`unexpected command ${args.join(" ")}`);
      },
    });
    const result = await backupRuntime.backup(state);
    assert.equal(result.backupId, UUID);
    assert.deepEqual(calls.stop, [["postgres", "redis", "object-store"]]);
    assert.deepEqual(calls.start, [["postgres", "redis", "object-store"]]);
    assert.deepEqual(result.manifest.services, {
      postgres: "running",
      opensearch: "exited",
      redis: "running",
      "object-store": "running",
    });
  } finally {
    await rm(checkout, { recursive: true, force: true });
  }
});

function validManifest() {
  return {
    schemaVersion: 1,
    backupId: UUID,
    owner: `0123456789abcdef-${UUID}`,
    sourceProject: "aw-test-source",
    createdAt: "2026-09-06T12:00:00.000Z",
    services: {
      postgres: "running",
      opensearch: "exited",
      redis: "running",
      "object-store": "running",
    },
    images: {
      postgres: identity(images.postgres),
      "object-store": identity(images.seaweedfs),
    },
    archives: {
      postgres: { filename: "postgres.tar", length: 1024, sha256: `sha256:${"1".repeat(64)}` },
      "object-store": { filename: "object-store.tar", length: 1024, sha256: `sha256:${"2".repeat(64)}` },
    },
  };
}

function identity(image) {
  return {
    repository: image.repository,
    manifestDigest: image.manifestDigest,
    platform: { ...image.platform },
  };
}

function tar(entries) {
  const parts = [];
  for (const entry of entries) {
    const data = entry.data ?? Buffer.alloc(0);
    const header = Buffer.alloc(512);
    writeText(header, 0, 100, entry.name);
    writeOctal(header, 100, 8, 0o600);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, data.length);
    writeOctal(header, 136, 12, 0);
    header.fill(32, 148, 156);
    header[156] = (entry.type ?? "0").charCodeAt(0);
    if (entry.link !== undefined) writeText(header, 157, 100, entry.link);
    writeText(header, 257, 6, "ustar");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeOctal(header, 148, 8, checksum);
    parts.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  const value = Buffer.concat(parts);
  assert.match(createHash("sha256").update(value).digest("hex"), /^[a-f0-9]{64}$/u);
  return value;
}

function writeText(buffer, offset, length, value) {
  buffer.write(value, offset, Math.min(length, Buffer.byteLength(value)), "utf8");
}

function writeOctal(buffer, offset, length, value) {
  const rendered = value.toString(8).padStart(length - 1, "0");
  buffer.write(rendered, offset, length - 1, "ascii");
  buffer[offset + length - 1] = 0;
}

function hasCode(code) {
  return (error) => error instanceof InfraError && error.code === code;
}

function ok(stdout, stderr = "") {
  return { stdout, stderr, code: 0 };
}
