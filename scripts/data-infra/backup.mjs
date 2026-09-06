import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { TextDecoder } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { protectedRecovery } from "./cancellation.mjs";
import { discardTestProject } from "./ephemeral.mjs";
import {
  InfraError,
  S3_BUCKET,
  assertLocalDocker,
  compose,
  images,
  initProject,
  loadProject,
  ownedVolumes,
  reset,
  root,
  run,
  serviceStates,
  sql,
  start,
  stop,
  up,
  withProjectLock,
} from "./runtime.mjs";

const SERVICES = Object.freeze(["postgres", "opensearch", "redis", "object-store"]);
const VOLUME_BY_SERVICE = Object.freeze({
  postgres: "postgres-data",
  opensearch: "opensearch-data",
  redis: "redis-data",
  "object-store": "object-store-data",
});
const ARCHIVES = Object.freeze({
  postgres: "postgres.tar",
  "object-store": "object-store.tar",
});
const BACKUP_IMAGES = Object.freeze({ postgres: images.postgres, "object-store": images.seaweedfs });
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const PROJECT_PATTERN = /^aw-(?:local|test)-[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

const defaultRuntime = Object.freeze({
  assertLocalDocker,
  compose,
  initProject,
  loadProject,
  ownedVolumes,
  reset,
  serviceStates,
  sql,
  start,
  stop,
  up,
  withProjectLock,
});

export function createBackupRuntime(options = {}) {
  const runtime = options.runtime ?? defaultRuntime;
  const runProcess = options.runProcess ?? run;
  const checkout = path.resolve(options.checkout ?? root);
  const now = options.now ?? (() => new Date());
  const uuid = options.uuid ?? randomUUID;

  async function backup(state) {
    await assertCallerLock(state);
    await runtime.assertLocalDocker(state.deadlineAt);
    const initial = planServiceRecovery(await runtime.serviceStates(state));
    const volumes = await requireFoundationVolumes(state);
    await assertExclusiveWriters(state, volumes);
    const backupId = uuid();
    if (!UUID_PATTERN.test(backupId)) throw new InfraError("backup_id_invalid");
    const backupRoot = path.join(checkout, ".local-data", "backups");
    const backupDir = path.join(backupRoot, backupId);
    await mkdir(backupRoot, { recursive: true, mode: 0o700 });
    try {
      await mkdir(backupDir, { mode: 0o700 });
    } catch (cause) {
      throw new InfraError(cause?.code === "EEXIST" ? "backup_exists" : "backup_create_failed", { cause });
    }

    let primaryFailure;
    let manifest;
    try {
      if (initial.running.length > 0) await runtime.stop(state, initial.running);
      assertAllStopped(await runtime.serviceStates(state));
      await assertExclusiveWriters(state, volumes);
      await verifyBackupImages(state);

      const archiveEntries = {};
      const archiveState = phaseState(state, 120_000);
      for (const service of ["postgres", "object-store"]) {
        const filename = ARCHIVES[service];
        const volume = `${state.project}_${VOLUME_BY_SERVICE[service]}`;
        await archiveVolume(archiveState, volume, backupDir, filename);
        await chownArchive(archiveState, backupDir, filename);
        const archivePath = path.join(backupDir, filename);
        const metadata = await archiveMetadata(archivePath, archiveState);
        await validateTarArchive(archivePath, archiveState);
        archiveEntries[service] = { filename, ...metadata };
      }

      manifest = validateManifest({
        schemaVersion: 1,
        backupId,
        owner: state.ownerToken,
        sourceProject: state.project,
        createdAt: now().toISOString(),
        services: initial.states,
        images: Object.fromEntries(
          Object.entries(BACKUP_IMAGES).map(([service, image]) => [service, imageIdentity(image)]),
        ),
        archives: archiveEntries,
      });
      const manifestPath = path.join(backupDir, "manifest.json");
      checkDeadline(state);
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o400,
      });
      await chmodReadonly(manifestPath);
      for (const archive of Object.values(manifest.archives)) {
        await chmodReadonly(path.join(backupDir, archive.filename));
      }
    } catch (cause) {
      primaryFailure = cause;
    }

    let recoveryFailure;
    try {
      await protectedRecovery(async () => {
        const recoveryState = independentRecoveryState(state);
        if (initial.running.length > 0) await runtime.start(recoveryState, initial.running);
        await awaitRecovered(runtime, recoveryState, initial.states);
      });
    } catch (cause) {
      recoveryFailure = cause;
    }

    if (recoveryFailure !== undefined) {
      throw new InfraError("backup_recovery_failed", {
        cause: primaryFailure === undefined ? recoveryFailure : new AggregateError([primaryFailure, recoveryFailure]),
      });
    }
    if (primaryFailure !== undefined) {
      throw primaryFailure instanceof InfraError
        ? primaryFailure
        : new InfraError("backup_failed", { cause: primaryFailure });
    }
    return { backupId, manifest };
  }

  async function restoreCheck(sourceState, backupId, { verify } = {}) {
    await assertCallerLock(sourceState);
    if (!UUID_PATTERN.test(backupId)) throw new InfraError("backup_id_invalid");
    if (verify !== undefined && typeof verify !== "function") throw new InfraError("restore_verify_invalid");
    const backupDir = path.join(checkout, ".local-data", "backups", backupId);
    const manifest = await loadAndValidateManifest(backupDir, sourceState, backupId);
    await runtime.assertLocalDocker(sourceState.deadlineAt);
    await verifyBackupImages(sourceState);
    const validationState = phaseState(sourceState, 120_000);
    for (const archive of Object.values(manifest.archives)) {
      const archivePath = path.join(backupDir, archive.filename);
      const actual = await archiveMetadata(archivePath, validationState);
      if (actual.length !== archive.length || actual.sha256 !== archive.sha256) {
        throw new InfraError("backup_archive_tampered");
      }
      await validateTarArchive(archivePath, validationState);
    }

    const targetProject = `aw-test-${uuid()}`;
    let targetState;
    let verified = false;
    let primaryFailure;
    try {
      try {
        await runtime.loadProject(targetProject);
        throw new InfraError("restore_target_exists");
      } catch (cause) {
        if (!(cause instanceof InfraError) || cause.code !== "project_not_initialized") throw cause;
      }
      targetState = await runtime.initProject({
        project: targetProject,
        test: true,
        credentials: sourceState.credentials,
      });
      if (sourceState.deadlineAt !== undefined) {
        targetState = Object.freeze({ ...targetState, deadlineAt: sourceState.deadlineAt });
      }
      await runtime.withProjectLock(targetState, async () => {
        await runtime.compose(targetState, ["create"]);
        assertRestoreContainersStopped(await runtime.serviceStates(targetState));
        const targetVolumes = await requireFoundationVolumes(targetState);
        await assertExclusiveWriters(targetState, targetVolumes);
        const restoreArchiveState = phaseState(targetState, 120_000);
        for (const volume of targetVolumes) await assertEmptyVolume(restoreArchiveState, volume);
        for (const service of ["postgres", "object-store"]) {
          await extractVolume(
            restoreArchiveState,
            `${targetState.project}_${VOLUME_BY_SERVICE[service]}`,
            backupDir,
            manifest.archives[service].filename,
          );
        }
        const recoveryTarget = phaseState(targetState, 120_000);
        await runtime.up(recoveryTarget);
        if (verify === undefined) await minimalRestoreProbe(recoveryTarget);
        else if ((await verify(recoveryTarget)) === false) throw new InfraError("restore_verification_failed");
        verified = true;
      });
    } catch (cause) {
      primaryFailure = cause;
    }

    let cleanupFailure;
    if (targetState !== undefined) {
      try {
        await protectedRecovery(async () => {
          const cleanupState = independentRecoveryState(targetState);
          await runtime.withProjectLock(cleanupState, async () => {
            await runtime.reset(cleanupState);
            await discardTestProject(cleanupState);
          });
        });
      } catch (cause) {
        cleanupFailure = cause;
      }
    }
    if (cleanupFailure !== undefined) {
      throw new InfraError("restore_cleanup_failed", {
        cause: primaryFailure === undefined ? cleanupFailure : new AggregateError([primaryFailure, cleanupFailure]),
      });
    }
    if (primaryFailure !== undefined) {
      throw primaryFailure instanceof InfraError
        ? primaryFailure
        : new InfraError("restore_failed", { cause: primaryFailure });
    }
    return { project: targetProject, verified };
  }

  async function verifyBackupImages(state) {
    for (const image of Object.values(BACKUP_IMAGES)) {
      const reference = `${image.repository}@${image.manifestDigest}`;
      const result = await runDocker(
        state,
        ["image", "inspect", reference],
        15_000,
        "backup_image_unavailable",
      );
      let inspection;
      try {
        [inspection] = JSON.parse(result.stdout);
      } catch (cause) {
        throw new InfraError("backup_image_invalid", { cause });
      }
      const repoDigests = inspection?.RepoDigests;
      if (
        !Array.isArray(repoDigests) ||
        !repoDigests.some((digest) => digest.endsWith(`@${image.manifestDigest}`)) ||
        inspection.Os !== image.platform.os ||
        inspection.Architecture !== image.platform.architecture ||
        (inspection.Variant ?? null) !== image.platform.variant
      ) {
        throw new InfraError("backup_image_mismatch");
      }
    }
  }

  async function archiveVolume(state, volume, backupDir, filename) {
    await runHelper(
      state,
      [
        "--mount",
        `type=volume,src=${safeMountSource(volume)},dst=/source,readonly`,
        "--mount",
        `type=bind,src=${safeMountSource(backupDir)},dst=/backup`,
        `${images.postgres.repository}@${images.postgres.manifestDigest}`,
        "tar",
        "--numeric-owner",
        "-C",
        "/source",
        "-cf",
        `/backup/${filename}`,
        ".",
      ],
      120_000,
      { capabilities: ["DAC_OVERRIDE"] },
    );
  }

  async function chownArchive(state, backupDir, filename) {
    const owner = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
    await runHelper(
      state,
      [
        "--mount",
        `type=bind,src=${safeMountSource(backupDir)},dst=/backup`,
        `${images.postgres.repository}@${images.postgres.manifestDigest}`,
        "chown",
        owner,
        `/backup/${filename}`,
      ],
      15_000,
      { capabilities: ["DAC_OVERRIDE", "CHOWN"] },
    );
  }

  async function extractVolume(state, volume, backupDir, filename) {
    await runHelper(
      state,
      [
        "--mount",
        `type=volume,src=${safeMountSource(volume)},dst=/target`,
        "--mount",
        `type=bind,src=${safeMountSource(backupDir)},dst=/backup,readonly`,
        `${images.postgres.repository}@${images.postgres.manifestDigest}`,
        "tar",
        "--numeric-owner",
        "-C",
        "/target",
        "-xf",
        `/backup/${filename}`,
      ],
      120_000,
    );
  }

  async function assertEmptyVolume(state, volume) {
    const result = await runHelper(
      state,
      [
        "--mount",
        `type=volume,src=${safeMountSource(volume)},dst=/source,readonly`,
        `${images.postgres.repository}@${images.postgres.manifestDigest}`,
        "find",
        "/source",
        "-mindepth",
        "1",
        "-print",
        "-quit",
      ],
      15_000,
      { capabilities: ["DAC_OVERRIDE"] },
    );
    if (result.stdout.trim().length > 0) throw new InfraError("restore_target_nonempty");
  }

  async function runHelper(
    state,
    args,
    timeoutMs,
    {
      network = "none",
      code = "backup_helper_failed",
      capabilities = ["DAC_OVERRIDE", "CHOWN", "FOWNER"],
    } = {},
  ) {
    const helperName = `aw-helper-${uuid()}`;
    const base = [
      "run",
      "--name",
      helperName,
      "--rm",
      "--network",
      network,
      "--read-only",
      "--user",
      "0:0",
      "--platform",
      "linux/amd64",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--cpus",
      "0.5",
      "--memory",
      "256m",
      "--pids-limit",
      "128",
      "--log-driver",
      "none",
      "--label",
      `io.auto-world.owner=${state.ownerToken}`,
      ...capabilities.flatMap((capability) => ["--cap-add", capability]),
    ];
    let result;
    let failure;
    try {
      result = await runDocker(state, [...base, ...args], timeoutMs, code);
    } catch (cause) {
      failure = cause;
    }
    try {
      await protectedRecovery(() => cleanupHelper(state, helperName));
    } catch (cause) {
      throw new InfraError("backup_helper_cleanup_failed", {
        cause: failure === undefined ? cause : new AggregateError([failure, cause]),
      });
    }
    if (failure !== undefined) throw failure;
    return result;
  }

  async function cleanupHelper(state, helperName) {
    const cleanupState = independentRecoveryState(state);
    const listed = await runProcess(
      "docker",
      ["container", "ls", "-aq", "--filter", `name=^/${helperName}$`],
      { timeoutMs: clipped(cleanupState, 10_000) },
    );
    if (listed.code !== 0) throw new InfraError("backup_helper_cleanup_unverified", { stderr: listed.stderr });
    const identifiers = splitLines(listed.stdout);
    if (identifiers.length === 0) return;
    if (identifiers.length !== 1) throw new InfraError("backup_helper_cleanup_unverified");
    const inspected = await runProcess("docker", ["container", "inspect", identifiers[0]], {
      timeoutMs: clipped(cleanupState, 10_000),
    });
    if (inspected.code !== 0) throw new InfraError("backup_helper_cleanup_unverified", { stderr: inspected.stderr });
    let item;
    try {
      [item] = JSON.parse(inspected.stdout);
    } catch (cause) {
      throw new InfraError("backup_helper_invalid", { cause });
    }
    if (item?.Config?.Labels?.["io.auto-world.owner"] !== state.ownerToken) {
      throw new InfraError("backup_helper_ownership_mismatch");
    }
    await runDocker(
      cleanupState,
      ["container", "rm", "--force", identifiers[0]],
      120_000,
      "backup_helper_cleanup_failed",
    );
  }

  async function assertExclusiveWriters(state, volumes) {
    for (const volume of volumes) {
      const expectedService = Object.entries(VOLUME_BY_SERVICE)
        .find(([, name]) => volume === `${state.project}_${name}`)?.[0];
      if (expectedService === undefined) throw new InfraError("backup_volume_unexpected");
      const listed = await runDocker(
        state,
        ["ps", "--all", "--filter", `volume=${volume}`, "--format", "{{.ID}}"],
        15_000,
        "backup_writer_inspect_failed",
      );
      const identifiers = splitLines(listed.stdout);
      if (identifiers.length !== 1) throw new InfraError("backup_other_writer");
      const inspected = await runDocker(
        state,
        ["container", "inspect", identifiers[0]],
        15_000,
        "backup_writer_inspect_failed",
      );
      let item;
      try {
        [item] = JSON.parse(inspected.stdout);
      } catch (cause) {
        throw new InfraError("backup_writer_inspect_invalid", { cause });
      }
      const labels = item?.Config?.Labels;
      if (
        labels?.["io.auto-world.owner"] !== state.ownerToken ||
        labels?.["com.docker.compose.project"] !== state.project ||
        labels?.["com.docker.compose.service"] !== expectedService
      ) {
        throw new InfraError("backup_other_writer");
      }
    }
  }

  async function requireFoundationVolumes(state) {
    const actual = await runtime.ownedVolumes(state);
    const expected = Object.values(VOLUME_BY_SERVICE).map((name) => `${state.project}_${name}`).sort();
    if (JSON.stringify([...actual].sort()) !== JSON.stringify(expected)) {
      throw new InfraError("backup_volumes_incomplete");
    }
    return expected;
  }

  async function minimalRestoreProbe(state) {
    const [{ s3 }, { digestBytes }] = await Promise.all([
      import("./probes.mjs"),
      import("./raw-protocol.mjs"),
    ]);
    const rawReferences = await runtime.sql(
      state,
      `SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'bucket', bucket,
        'objectKey', object_key,
        'sha256', sha256,
        'byteLength', byte_length
      ) ORDER BY snapshot_id), '[]'::jsonb)::text
      FROM aw_foundation.raw_snapshot_reference;`,
      { role: "reader", timeoutMs: 15_000 },
    );
    let references;
    try {
      references = JSON.parse(rawReferences.trim());
    } catch (cause) {
      throw new InfraError("restore_sql_probe_failed", { cause });
    }
    if (!Array.isArray(references)) throw new InfraError("restore_sql_probe_failed");
    await s3(state, "head-bucket");
    for (const reference of references) {
      if (
        reference?.bucket !== S3_BUCKET ||
        typeof reference.objectKey !== "string" ||
        !/^[a-f0-9]{64}$/u.test(reference.sha256) ||
        !Number.isSafeInteger(reference.byteLength) ||
        reference.byteLength < 0
      ) {
        throw new InfraError("restore_sql_probe_failed");
      }
      const bytes = await s3(state, "get-object", { key: reference.objectKey });
      if (bytes.length !== reference.byteLength || digestBytes(bytes) !== reference.sha256) {
        throw new InfraError("restore_raw_probe_failed");
      }
    }
  }

  async function runDocker(state, args, timeoutMs, code) {
    const result = await runProcess("docker", args, { timeoutMs: clipped(state, timeoutMs) });
    if (result.code !== 0) throw new InfraError(code, { stderr: result.stderr });
    return result;
  }

  return Object.freeze({ backup, restoreCheck });
}

const defaultBackupRuntime = createBackupRuntime();
export const backup = defaultBackupRuntime.backup;
export const restoreCheck = defaultBackupRuntime.restoreCheck;

export function planServiceRecovery(states) {
  if (states === null || typeof states !== "object" || Array.isArray(states)) {
    throw new InfraError("backup_service_state_invalid");
  }
  const planned = {};
  for (const service of SERVICES) {
    const value = states[service]?.state;
    if (value !== "running" && value !== "exited") throw new InfraError("backup_service_state_invalid");
    planned[service] = value;
  }
  if (Object.keys(states).some((service) => !SERVICES.includes(service))) {
    throw new InfraError("backup_service_state_invalid");
  }
  return Object.freeze({
    states: Object.freeze(planned),
    running: Object.freeze(SERVICES.filter((service) => planned[service] === "running")),
  });
}

export function validateManifest(candidate) {
  const topKeys = ["schemaVersion", "backupId", "owner", "sourceProject", "createdAt", "services", "images", "archives"];
  if (!isRecord(candidate) || !sameKeys(candidate, topKeys)) throw new InfraError("backup_manifest_invalid");
  if (candidate.schemaVersion !== 1) throw new InfraError("backup_manifest_version");
  if (!UUID_PATTERN.test(candidate.backupId)) throw new InfraError("backup_manifest_invalid");
  if (typeof candidate.owner !== "string" || candidate.owner.length < 20 || !PROJECT_PATTERN.test(candidate.sourceProject)) {
    throw new InfraError("backup_manifest_invalid");
  }
  const created = new Date(candidate.createdAt);
  if (!Number.isFinite(created.getTime()) || created.toISOString() !== candidate.createdAt) {
    throw new InfraError("backup_manifest_invalid");
  }
  if (!sameKeys(candidate.services, SERVICES)) throw new InfraError("backup_manifest_invalid");
  planServiceRecovery(Object.fromEntries(
    Object.entries(candidate.services).map(([service, state]) => [service, { state }]),
  ));
  if (!sameKeys(candidate.images, ["postgres", "object-store"])) throw new InfraError("backup_manifest_invalid");
  for (const [service, expected] of Object.entries(BACKUP_IMAGES)) {
    if (JSON.stringify(candidate.images[service]) !== JSON.stringify(imageIdentity(expected))) {
      throw new InfraError("backup_manifest_image_mismatch");
    }
  }
  if (!sameKeys(candidate.archives, ["postgres", "object-store"])) throw new InfraError("backup_manifest_invalid");
  for (const [service, filename] of Object.entries(ARCHIVES)) {
    const archive = candidate.archives[service];
    if (
      !isRecord(archive) ||
      !sameKeys(archive, ["filename", "length", "sha256"]) ||
      archive.filename !== filename ||
      !Number.isSafeInteger(archive.length) ||
      archive.length < 1024 ||
      !DIGEST_PATTERN.test(archive.sha256)
    ) {
      throw new InfraError("backup_manifest_invalid");
    }
  }
  return deepFreeze(globalThis.structuredClone(candidate));
}

export async function validateTarArchive(file, deadlineState = {}) {
  checkDeadline(deadlineState);
  const handle = await open(file, "r");
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size < 1024 || details.size % 512 !== 0) {
      throw new InfraError("backup_tar_invalid");
    }
    let offset = 0;
    let zeroBlocks = 0;
    let entries = 0;
    const header = Buffer.alloc(512);
    while (offset < details.size) {
      checkDeadline(deadlineState);
      const { bytesRead } = await handle.read(header, 0, 512, offset);
      if (bytesRead !== 512) throw new InfraError("backup_tar_invalid");
      offset += 512;
      if (header.every((byte) => byte === 0)) {
        zeroBlocks += 1;
        if (zeroBlocks >= 2) break;
        continue;
      }
      if (zeroBlocks > 0) throw new InfraError("backup_tar_invalid");
      entries += 1;
      if (entries > 1_000_000) throw new InfraError("backup_tar_invalid");
      validateTarChecksum(header);
      const name = tarText(header, 0, 100);
      const prefix = tarText(header, 345, 155);
      const fullName = prefix.length === 0 ? name : `${prefix}/${name}`;
      assertSafeTarPath(fullName);
      const type = String.fromCharCode(header[156] || 48);
      if (!["0", "5"].includes(type)) throw new InfraError("backup_tar_type_unsafe");
      const size = tarNumber(header, 124, 12);
      const padded = Math.ceil(size / 512) * 512;
      if (!Number.isSafeInteger(padded) || offset + padded > details.size) throw new InfraError("backup_tar_invalid");
      offset += padded;
    }
    if (zeroBlocks < 2 || entries === 0) throw new InfraError("backup_tar_invalid");
    const trailer = Buffer.alloc(64 * 1024);
    while (offset < details.size) {
      checkDeadline(deadlineState);
      const bytes = Math.min(trailer.length, details.size - offset);
      const { bytesRead } = await handle.read(trailer, 0, bytes, offset);
      if (bytesRead !== bytes || trailer.subarray(0, bytes).some((byte) => byte !== 0)) {
        throw new InfraError("backup_tar_invalid");
      }
      offset += bytes;
    }
    return { entries };
  } finally {
    await handle.close();
  }
}

function imageIdentity(image) {
  return {
    repository: image.repository,
    manifestDigest: image.manifestDigest,
    platform: {
      os: image.platform.os,
      architecture: image.platform.architecture,
      variant: image.platform.variant,
      digest: image.platform.digest,
    },
  };
}

async function archiveMetadata(file, deadlineState = {}) {
  checkDeadline(deadlineState);
  const details = await stat(file);
  if (!details.isFile() || details.size < 1024) throw new InfraError("backup_archive_invalid");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) {
    checkDeadline(deadlineState);
    hash.update(chunk);
  }
  checkDeadline(deadlineState);
  return { length: details.size, sha256: `sha256:${hash.digest("hex")}` };
}

async function loadAndValidateManifest(backupDir, sourceState, backupId) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path.join(backupDir, "manifest.json"), "utf8"));
  } catch (cause) {
    throw new InfraError("backup_manifest_read_failed", { cause });
  }
  const manifest = validateManifest(parsed);
  if (
    manifest.backupId !== backupId ||
    manifest.owner !== sourceState.ownerToken ||
    manifest.sourceProject !== sourceState.project
  ) {
    throw new InfraError("backup_manifest_owner_mismatch");
  }
  return manifest;
}

async function assertCallerLock(state) {
  try {
    const owner = (await readFile(path.join(state.dir, "operation.lock"), "utf8")).trim();
    if (owner !== String(process.pid)) throw new InfraError("backup_lock_required");
  } catch (cause) {
    if (cause instanceof InfraError) throw cause;
    throw new InfraError("backup_lock_required", { cause });
  }
}

function assertAllStopped(states) {
  for (const service of SERVICES) {
    if (states[service]?.state !== "exited") throw new InfraError("backup_stop_failed");
  }
}

function assertRestoreContainersStopped(states) {
  for (const service of SERVICES) {
    if (!["created", "exited"].includes(states[service]?.state)) {
      throw new InfraError("restore_target_active");
    }
  }
}

async function awaitRecovered(runtime, state, expected) {
  while (true) {
    const actual = await runtime.serviceStates(state);
    let ready = true;
    for (const service of SERVICES) {
      if (expected[service] === "exited") {
        if (actual[service]?.state !== "exited") throw new InfraError("backup_recovery_state_mismatch");
        continue;
      }
      if (actual[service]?.state !== "running") throw new InfraError("backup_recovery_state_mismatch");
      if (actual[service]?.health !== "healthy") ready = false;
    }
    if (ready) return;
    const remaining = state.deadlineAt - Date.now();
    if (remaining < 1) throw new InfraError("backup_recovery_timeout");
    await delay(Math.min(250, remaining));
  }
}

function clipped(state, timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20 * 60 * 1000) {
    throw new InfraError("backup_timeout_invalid");
  }
  if (state.deadlineAt === undefined) return timeoutMs;
  const remaining = state.deadlineAt - Date.now();
  if (remaining < 1) throw new InfraError("deadline_exceeded");
  return Math.min(timeoutMs, remaining);
}

function safeMountSource(value) {
  if (typeof value !== "string" || value.length === 0 || /[,\r\n\0]/u.test(value)) {
    throw new InfraError("backup_mount_invalid");
  }
  return value;
}

function tarText(header, offset, length) {
  const field = header.subarray(offset, offset + length);
  const end = field.indexOf(0);
  try {
    return utf8Decoder.decode(field.subarray(0, end < 0 ? field.length : end));
  } catch (cause) {
    throw new InfraError("backup_tar_invalid", { cause });
  }
}

function tarNumber(header, offset, length) {
  const value = tarText(header, offset, length).trim();
  if (!/^[0-7]+$/u.test(value)) throw new InfraError("backup_tar_invalid");
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new InfraError("backup_tar_invalid");
  return parsed;
}

function validateTarChecksum(header) {
  const expected = tarNumber(header, 148, 8);
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : header[index];
  }
  if (actual !== expected) throw new InfraError("backup_tar_checksum");
}

function assertSafeTarPath(value) {
  if (
    value.length === 0 ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/u.test(value) ||
    value.split("/").includes("..") ||
    path.posix.normalize(value).startsWith("../") ||
    path.posix.normalize(value) === ".."
  ) {
    throw new InfraError("backup_tar_path_unsafe");
  }
}

function splitLines(value) {
  return value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

function sameKeys(value, expected) {
  return isRecord(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

async function chmodReadonly(file) {
  try {
    await chmod(file, 0o400);
  } catch (cause) {
    if (process.platform !== "win32") throw cause;
  }
}

function phaseState(state, timeoutMs) {
  const phaseDeadline = Date.now() + timeoutMs;
  return {
    ...state,
    deadlineAt: state.deadlineAt === undefined ? phaseDeadline : Math.min(state.deadlineAt, phaseDeadline),
  };
}

function independentRecoveryState(state) {
  const baseState = { ...state };
  delete baseState.deadlineAt;
  return Object.freeze({ ...baseState, deadlineAt: Date.now() + 120_000 });
}

function checkDeadline(state) {
  if (state.deadlineAt !== undefined && Date.now() >= state.deadlineAt) {
    throw new InfraError("deadline_exceeded");
  }
}
