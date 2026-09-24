import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";

import { streamGitHubArtifactZip } from "./download-artifact-zip.mjs";
import { collectAuthenticatedSeaweedSource, requireAuthenticatedSeaweedSource } from "./source-origin.mjs";
import { reviewedSeaweedSourcePolicy } from "./source-records.mjs";

const MAX_TIMEOUT_MS = 60 * 60_000;
const DEFAULT_TIMEOUT_MS = 45 * 60_000;
const FINAL_ORIGIN_RESERVE_MS = 120_000;
const CHUNK_BYTES = 1024 ** 2;
const NAMES = Object.freeze([
  "seaweed-build-1.zip", "seaweed-build-2.zip", "seaweed-artifact-gate-1.zip",
  "seaweed-artifact-gate-2.zip", "seaweed-comparison.zip",
]);

function intakeError(code) {
  return Object.assign(new Error(code), { code, state: "INCOMPLETE", stage: "RAW_ZIP_DOWNLOAD",
    candidateAuthorization: "NOT_AUTHORIZED" });
}

function normalizeFailure(error) {
  if (error?.code?.startsWith("seaweed_raw_zip_")) return error;
  if (error?.code === "seaweed_artifact_download_timeout") return intakeError("seaweed_raw_zip_timeout");
  if (error?.code === "seaweed_artifact_download_aborted") return intakeError("seaweed_raw_zip_aborted");
  if (error?.code?.startsWith("seaweed_artifact_download_")) {
    return Object.assign(intakeError("seaweed_raw_zip_download_failed"), { downloadCode: error.code });
  }
  return intakeError("seaweed_raw_zip_failed");
}

function cleanupFailure(original) {
  return Object.assign(intakeError("seaweed_raw_zip_cleanup_failed"), {
    originalCode: original?.code?.startsWith("seaweed_raw_zip_") ? original.code : "seaweed_raw_zip_failed",
  });
}

function options(input, testOnly) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw intakeError("seaweed_raw_zip_options_invalid");
  const properties = Object.getOwnPropertyDescriptors(input);
  const permitted = new Set(["root", "signal", "timeoutMs", ...(testOnly ? ["readOrigin", "streamOne", "expectedArtifacts", "now"] : [])]);
  if (Reflect.ownKeys(properties).some((key) => !permitted.has(key) || !("value" in properties[key]))) {
    throw intakeError("seaweed_raw_zip_options_invalid");
  }
  const value = (key) => properties[key]?.value;
  const root = value("root");
  const signal = value("signal");
  const timeoutMs = value("timeoutMs") ?? DEFAULT_TIMEOUT_MS;
  if (typeof root !== "string" || !path.isAbsolute(root) || path.normalize(root) !== root
    || signal !== undefined && !(signal instanceof globalThis.AbortSignal)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw intakeError("seaweed_raw_zip_options_invalid");
  }
  const readOrigin = value("readOrigin") ?? collectAuthenticatedSeaweedSource;
  const streamOne = value("streamOne") ?? streamGitHubArtifactZip;
  const expectedArtifacts = value("expectedArtifacts") ?? reviewedSeaweedSourcePolicy.artifacts;
  const now = value("now") ?? Date.now;
  if (typeof readOrigin !== "function" || typeof streamOne !== "function" || typeof now !== "function"
    || !Array.isArray(expectedArtifacts) || expectedArtifacts.length !== NAMES.length) {
    throw intakeError("seaweed_raw_zip_options_invalid");
  }
  return Object.freeze({ root, signal, timeoutMs, readOrigin, streamOne, expectedArtifacts, now, testOnly });
}

function sameIdentity(first, second) {
  return first.dev === second.dev && first.ino === second.ino && first.uid === second.uid
    && first.gid === second.gid && first.mode === second.mode && first.nlink === second.nlink;
}

function sameSavedFile(first, second) {
  return sameIdentity(first, second) && first.size === second.size
    && first.mtimeNs === second.mtimeNs && first.ctimeNs === second.ctimeNs;
}

function requireRoot(stat) {
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== BigInt(process.getuid())
    || (stat.mode & 0o777n) !== 0o700n) throw intakeError("seaweed_raw_zip_root_invalid");
}

function requireLeaf(stat, rootStat, initial) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== BigInt(process.getuid())
    || stat.dev !== rootStat.dev || stat.nlink !== 1n || (stat.mode & 0o777n) !== 0o600n
    || initial !== undefined && !sameIdentity(stat, initial)) {
    throw intakeError("seaweed_raw_zip_file_invalid");
  }
}

function exactArtifacts(observed, expected) {
  if (!Array.isArray(observed) || observed.length !== NAMES.length) throw intakeError("seaweed_raw_zip_source_changed");
  for (let index = 0; index < NAMES.length; index += 1) {
    const found = observed[index];
    const fixed = expected[index];
    if (found?.id !== fixed?.id || found?.name !== fixed?.name || found?.size !== fixed?.size
      || found?.digest !== fixed?.digest || found?.profile !== fixed?.profile) {
      throw intakeError("seaweed_raw_zip_source_changed");
    }
  }
}

async function verifySavedFile(record, rootStat, checkBudget) {
  checkBudget();
  const before = await record.handle.stat({ bigint: true });
  requireLeaf(before, rootStat, record.initial);
  if (before.size !== BigInt(record.artifact.size)) throw intakeError("seaweed_raw_zip_saved_bytes_invalid");
  await record.handle.sync();
  checkBudget();
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
  let position = 0;
  while (position < record.artifact.size) {
    checkBudget();
    const length = Math.min(buffer.length, record.artifact.size - position);
    const { bytesRead } = await record.handle.read(buffer, 0, length, position);
    if (bytesRead !== length) throw intakeError("seaweed_raw_zip_saved_bytes_invalid");
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
    checkBudget();
  }
  if (`sha256:${hash.digest("hex")}` !== record.artifact.digest) throw intakeError("seaweed_raw_zip_saved_bytes_invalid");
  const after = await record.handle.stat({ bigint: true });
  const named = await lstat(record.procPath, { bigint: true });
  requireLeaf(after, rootStat, record.initial);
  requireLeaf(named, rootStat, record.initial);
  if (!sameSavedFile(after, named) || after.size !== before.size) throw intakeError("seaweed_raw_zip_file_changed");
  checkBudget();
  return after;
}

async function run(settings) {
  if (process.platform !== "linux" || constants.O_NOFOLLOW === undefined || constants.O_DIRECTORY === undefined) {
    throw intakeError("seaweed_raw_zip_platform_invalid");
  }
  const { root, signal, timeoutMs, readOrigin, streamOne, expectedArtifacts, now, testOnly } = settings;
  if (signal?.aborted) throw intakeError("seaweed_raw_zip_aborted");
  const deadline = now() + timeoutMs;
  const remaining = () => Math.floor(deadline - now());
  const checkBudget = (reserve = true) => {
    if (signal?.aborted) throw intakeError("seaweed_raw_zip_aborted");
    if (remaining() <= (reserve ? FINAL_ORIGIN_RESERVE_MS : 0)) throw intakeError("seaweed_raw_zip_timeout");
  };
  if (remaining() <= 0) throw intakeError("seaweed_raw_zip_timeout");
  const source = await readOrigin({ signal, timeoutMs: Math.min(120_000, remaining()) });
  if (!testOnly) requireAuthenticatedSeaweedSource(source);
  exactArtifacts(source.artifacts, expectedArtifacts);
  checkBudget();

  let rootHandle;
  let rootStat;
  let finalSource;
  const created = [];
  let result;
  let failure;
  try {
    rootHandle = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    rootStat = await rootHandle.stat({ bigint: true });
    requireRoot(rootStat);
    if (await realpath(root) !== root || !sameIdentity(rootStat, await lstat(root, { bigint: true }))) {
      throw intakeError("seaweed_raw_zip_root_invalid");
    }
    const procRoot = `/proc/self/fd/${rootHandle.fd}`;
    if ((await readdir(procRoot)).length !== 0) throw intakeError("seaweed_raw_zip_root_not_empty");
    for (let index = 0; index < NAMES.length; index += 1) {
      const procPath = `${procRoot}/${NAMES[index]}`;
      const handle = await open(procPath, constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_RDWR, 0o600);
      const record = { artifact: source.artifacts[index], name: NAMES[index], procPath, handle, initial: undefined };
      created.push(record);
      const initial = await handle.stat({ bigint: true });
      record.initial = initial;
      requireLeaf(initial, rootStat);
      requireLeaf(await lstat(procPath, { bigint: true }), rootStat, initial);
    }
    for (const record of created) {
      checkBudget();
      const budget = remaining() - FINAL_ORIGIN_RESERVE_MS;
      await streamOne({ artifact: record.artifact, handle: record.handle, signal,
        timeoutMs: Math.min(MAX_TIMEOUT_MS, budget) });
      await verifySavedFile(record, rootStat, checkBudget);
    }
    const saved = [];
    for (const record of created) saved.push(await verifySavedFile(record, rootStat, checkBudget));
    checkBudget();
    finalSource = await readOrigin({ signal, timeoutMs: Math.min(120_000, remaining()) });
    exactArtifacts(finalSource.artifacts, expectedArtifacts);
    for (let index = 0; index < created.length; index += 1) {
      const record = created[index];
      if (!sameSavedFile(saved[index], await record.handle.stat({ bigint: true }))
        || !sameSavedFile(saved[index], await lstat(record.procPath, { bigint: true }))) {
        throw intakeError("seaweed_raw_zip_file_changed");
      }
    }
    if (!sameIdentity(rootStat, await rootHandle.stat({ bigint: true }))
      || !sameIdentity(rootStat, await lstat(root, { bigint: true })) || await realpath(root) !== root
      || JSON.stringify((await readdir(procRoot)).sort()) !== JSON.stringify([...NAMES].sort())) {
      throw intakeError("seaweed_raw_zip_root_changed");
    }
    checkBudget(false);
    if (!testOnly) requireAuthenticatedSeaweedSource(finalSource);
    result = Object.freeze({ kind: "SEAWEED_RAW_SOURCE_ZIPS_V1", state: "RAW_ZIPS_ONLY",
      authority: "PREPARATION_ONLY", zipValidation: "NOT_RUN", extraction: "NOT_RUN",
      candidateAuthorization: "NOT_AUTHORIZED", repository: finalSource.repository,
      workflowId: finalSource.workflowId, sourceSha: finalSource.sourceSha,
      runId: finalSource.runId, attempt: finalSource.attempt,
      originBefore: source.observedAt, originAfter: finalSource.observedAt,
      files: Object.freeze(created.map((record) => Object.freeze({ id: record.artifact.id,
        githubName: record.artifact.name, name: record.name, path: path.join(root, record.name),
        profile: record.artifact.profile, expiresAt: record.artifact.expiresAt,
        size: record.artifact.size, digest: record.artifact.digest,
        identity: Object.freeze({ dev: record.initial.dev.toString(), ino: record.initial.ino.toString(),
          uid: Number(record.initial.uid), mode: Number(record.initial.mode & 0o777n) }),
      }))) });
  } catch (error) {
    failure = normalizeFailure(error);
  }
  for (const record of created) {
    if (record.initial === undefined) {
      try { record.initial = await record.handle.stat({ bigint: true }); } catch { failure = cleanupFailure(failure); }
    }
    try { await record.handle.close(); } catch { failure = intakeError("seaweed_raw_zip_close_failed"); }
  }
  if (failure === undefined) {
    try {
      checkBudget(false);
      if (!testOnly) requireAuthenticatedSeaweedSource(finalSource);
    } catch (error) { failure = normalizeFailure(error); }
  }
  const cleanupCreated = async (useRootPath) => {
    let clean = true;
    if (useRootPath) {
      try {
        if (!sameIdentity(rootStat, await lstat(root, { bigint: true })) || await realpath(root) !== root) return false;
      } catch { return false; }
    }
    for (const record of created) {
      if (record.initial === undefined) { clean = false; continue; }
      const target = useRootPath ? path.join(root, record.name) : record.procPath;
      let current;
      try { current = await lstat(target, { bigint: true }); } catch (error) {
        if (error.code !== "ENOENT") clean = false;
        continue;
      }
      if (!sameIdentity(current, record.initial)) { clean = false; continue; }
      try {
        await unlink(target);
      } catch (error) { if (error.code !== "ENOENT") clean = false; }
      try { await lstat(target, { bigint: true }); clean = false; } catch (error) {
        if (error.code !== "ENOENT") clean = false;
      }
    }
    return clean;
  };
  if (failure !== undefined && rootHandle !== undefined && !await cleanupCreated(false)) failure = cleanupFailure(failure);
  if (rootHandle !== undefined) {
    try { await rootHandle.close(); } catch {
      failure = intakeError("seaweed_raw_zip_close_failed");
      if (!await cleanupCreated(true)) failure = cleanupFailure(failure);
    }
  }
  if (failure === undefined) {
    try {
      checkBudget(false);
      if (!testOnly) requireAuthenticatedSeaweedSource(finalSource);
    } catch (error) {
      failure = normalizeFailure(error);
      if (!await cleanupCreated(true)) failure = cleanupFailure(failure);
    }
  }
  if (failure !== undefined) throw failure;
  return result;
}

export async function downloadReviewedSeaweedZips(input) {
  return run(options(input, false));
}

export async function TEST_ONLY_downloadSeaweedZips(input) {
  return run(options(input, true));
}
