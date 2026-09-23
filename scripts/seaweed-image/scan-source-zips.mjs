import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";

import { downloadReviewedSeaweedZips } from "./download-source-zips.mjs";
import { scanOwnedGitHubArtifactZip } from "./read-artifact-zip.mjs";
import { collectAuthenticatedSeaweedSource, requireAuthenticatedSeaweedSource } from "./source-origin.mjs";
import { reviewedSeaweedSourcePolicy } from "./source-records.mjs";

const DEFAULT_TIMEOUT_MS = 45 * 60_000;
const MAX_TIMEOUT_MS = 60 * 60_000;
const FINAL_ORIGIN_RESERVE_MS = 120_000;
const NAMES = Object.freeze([
  "seaweed-build-1.zip", "seaweed-build-2.zip", "seaweed-artifact-gate-1.zip",
  "seaweed-artifact-gate-2.zip", "seaweed-comparison.zip",
]);

function scanError(code, details = {}) {
  return Object.assign(new Error(code), {
    code, state: "INCOMPLETE", stage: "ZIP_STRUCTURAL_SCAN",
    materialValidation: "NOT_RUN", candidateAuthorization: "NOT_AUTHORIZED", ...details,
  });
}

function normalizeFailure(error, timedOut, signal) {
  if (timedOut) return scanError("seaweed_source_zip_scan_timeout");
  if (signal?.aborted === true) return scanError("seaweed_source_zip_scan_aborted");
  if (error?.code?.startsWith("seaweed_source_zip_scan_")) return error;
  if (error?.code?.startsWith("seaweed_raw_zip_")) {
    return scanError("seaweed_source_zip_scan_download_failed", { downloadCode: error.code });
  }
  if (error?.code?.startsWith("seaweed_artifact_zip_")) {
    return scanError("seaweed_source_zip_scan_structural_invalid", { scanCode: error.code });
  }
  if (error?.code?.startsWith("seaweed_source_")) return scanError("seaweed_source_zip_scan_origin_invalid");
  return scanError("seaweed_source_zip_scan_failed");
}

function cleanupFailure(original) {
  return scanError("seaweed_source_zip_scan_cleanup_failed", {
    originalCode: original?.code?.startsWith("seaweed_source_zip_scan_")
      ? original.code : "seaweed_source_zip_scan_failed",
  });
}

function snapshotOptions(input, testOnly) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw scanError("seaweed_source_zip_scan_options_invalid");
  }
  const fields = Object.getOwnPropertyDescriptors(input);
  const permitted = new Set(["root", "signal", "timeoutMs",
    ...(testOnly ? ["download", "scanOne", "readOrigin", "expectedArtifacts", "now"] : [])]);
  if (Reflect.ownKeys(fields).some((key) => !permitted.has(key) || !("value" in fields[key]))) {
    throw scanError("seaweed_source_zip_scan_options_invalid");
  }
  const value = (key) => fields[key]?.value;
  const root = value("root");
  const signal = value("signal");
  const timeoutMs = value("timeoutMs") ?? DEFAULT_TIMEOUT_MS;
  const download = value("download") ?? downloadReviewedSeaweedZips;
  const scanOne = value("scanOne") ?? scanOwnedGitHubArtifactZip;
  const readOrigin = value("readOrigin") ?? collectAuthenticatedSeaweedSource;
  const expectedArtifacts = value("expectedArtifacts") ?? reviewedSeaweedSourcePolicy.artifacts;
  const now = value("now") ?? Date.now;
  if (typeof root !== "string" || !path.isAbsolute(root) || path.normalize(root) !== root
    || signal !== undefined && !(signal instanceof globalThis.AbortSignal)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs <= FINAL_ORIGIN_RESERVE_MS || timeoutMs > MAX_TIMEOUT_MS
    || typeof download !== "function" || typeof scanOne !== "function" || typeof readOrigin !== "function"
    || typeof now !== "function" || !Array.isArray(expectedArtifacts) || expectedArtifacts.length !== NAMES.length) {
    throw scanError("seaweed_source_zip_scan_options_invalid");
  }
  return Object.freeze({ root, signal, timeoutMs, download, scanOne, readOrigin,
    expectedArtifacts, now, testOnly });
}

function identity(stat) {
  return Object.freeze({
    dev: stat.dev.toString(10), ino: stat.ino.toString(10), uid: Number(stat.uid), gid: Number(stat.gid),
    mode: Number(stat.mode), nlink: Number(stat.nlink), size: Number(stat.size),
    mtimeNs: stat.mtimeNs.toString(10), ctimeNs: stat.ctimeNs.toString(10),
  });
}

function sameIdentity(first, second) {
  return Object.keys(first).every((key) => first[key] === second[key]);
}

function sameNode(first, second) {
  return ["dev", "ino", "uid", "gid", "mode", "nlink"].every((key) => first[key] === second[key]);
}

function requireRoot(stat) {
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== BigInt(process.getuid())
    || (stat.mode & 0o777n) !== 0o700n) throw scanError("seaweed_source_zip_scan_root_invalid");
}

function exactArtifacts(observed, expected, downloaded) {
  if (!Array.isArray(observed) || observed.length !== NAMES.length
    || !Array.isArray(downloaded) || downloaded.length !== NAMES.length) {
    throw scanError("seaweed_source_zip_scan_origin_changed");
  }
  for (let index = 0; index < NAMES.length; index += 1) {
    const current = observed[index];
    const fixed = expected[index];
    const file = downloaded[index];
    if (current?.id !== fixed?.id || current?.name !== fixed?.name || current?.size !== fixed?.size
      || current?.digest !== fixed?.digest || current?.profile !== fixed?.profile
      || file?.id !== fixed?.id || file?.githubName !== fixed?.name || file?.name !== NAMES[index]
      || file?.size !== fixed?.size || file?.digest !== fixed?.digest || file?.profile !== fixed?.profile) {
      throw scanError("seaweed_source_zip_scan_origin_changed");
    }
  }
}

function entryManifestDigest(receipt) {
  const hash = createHash("sha256");
  for (const entry of receipt.entries) {
    hash.update(JSON.stringify({ ordinal: entry.ordinal, path: entry.path, mode: entry.mode,
      method: entry.method, crc32: entry.crc32, compressedSize: entry.compressedSize,
      rawSize: entry.rawSize, sha256: entry.sha256 }));
    hash.update("\n");
  }
  return `sha256:${hash.digest("hex")}`;
}

function discardSink() {
  return new Writable({ write(_chunk, _encoding, callback) { callback(); } });
}

async function run(settings) {
  if (process.platform !== "linux" || constants.O_NOFOLLOW === undefined || constants.O_DIRECTORY === undefined) {
    throw scanError("seaweed_source_zip_scan_platform_invalid");
  }
  const { root, signal, timeoutMs, download, scanOne, readOrigin, expectedArtifacts, now, testOnly } = settings;
  const startedAt = now();
  const deadline = startedAt + timeoutMs;
  let timedOut = false;
  const timeoutController = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => { timedOut = true; timeoutController.abort(); }, timeoutMs);
  timer.unref?.();
  const operationSignal = signal === undefined
    ? timeoutController.signal : globalThis.AbortSignal.any([signal, timeoutController.signal]);
  const remaining = () => Math.floor(deadline - now());
  const checkBudget = (reserve = false) => {
    if (timedOut || remaining() <= (reserve ? FINAL_ORIGIN_RESERVE_MS : 0)) {
      throw scanError("seaweed_source_zip_scan_timeout");
    }
    if (signal?.aborted === true || operationSignal.aborted) throw scanError("seaweed_source_zip_scan_aborted");
  };

  let rootHandle;
  let rootBefore;
  let intake;
  let finalOrigin;
  let result;
  let failure;
  const owned = [];
  try {
    checkBudget(true);
    rootHandle = await open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const rootStat = await rootHandle.stat({ bigint: true });
    requireRoot(rootStat);
    rootBefore = identity(rootStat);
    if ((await realpath(root)) !== root || !sameNode(rootBefore, identity(await lstat(root, { bigint: true })))) {
      throw scanError("seaweed_source_zip_scan_root_invalid");
    }
    if ((await readdir(`/proc/self/fd/${rootHandle.fd}`)).length !== 0) {
      throw scanError("seaweed_source_zip_scan_root_not_empty");
    }

    const downloadBudget = remaining() - FINAL_ORIGIN_RESERVE_MS;
    intake = await download({ root, signal: operationSignal, timeoutMs: downloadBudget });
    exactArtifacts(expectedArtifacts, expectedArtifacts, intake?.files);
    let downloadedFilesValid = true;
    for (let index = 0; index < NAMES.length; index += 1) {
      const procPath = `/proc/self/fd/${rootHandle.fd}/${NAMES[index]}`;
      let current;
      try { current = await lstat(procPath, { bigint: true }); } catch {
        downloadedFilesValid = false;
        continue;
      }
      const currentIdentity = identity(current);
      const reported = intake.files[index].identity;
      owned.push(Object.freeze({ name: NAMES[index], identity: currentIdentity }));
      if (!current.isFile() || current.isSymbolicLink() || current.uid !== BigInt(process.getuid())
        || current.nlink !== 1n || (current.mode & 0o777n) !== 0o600n
        || currentIdentity.dev !== reported.dev || currentIdentity.ino !== reported.ino
        || currentIdentity.uid !== reported.uid || Number(current.mode & 0o777n) !== reported.mode
        || current.size !== BigInt(intake.files[index].size)
        || intake.files[index].path !== path.join(root, NAMES[index])) downloadedFilesValid = false;
    }
    if (!downloadedFilesValid) throw scanError("seaweed_source_zip_scan_file_invalid");

    const scans = [];
    for (let index = 0; index < NAMES.length; index += 1) {
      checkBudget(true);
      const file = intake.files[index];
      const receipt = await scanOne({ file: file.path, root, descriptor: file,
        profile: file.profile, openEntrySink: discardSink, signal: operationSignal });
      checkBudget(true);
      scans.push(Object.freeze({ id: file.id, githubName: file.githubName, profile: file.profile,
        zipSize: receipt.zipSize, zipDigest: receipt.zipDigest, entryCount: receipt.entryCount,
        rawSize: receipt.rawSize, entryManifestDigest: entryManifestDigest(receipt) }));
    }

    finalOrigin = await readOrigin({ signal: operationSignal, timeoutMs: Math.min(120_000, remaining()) });
    if (!testOnly) requireAuthenticatedSeaweedSource(finalOrigin);
    exactArtifacts(finalOrigin.artifacts, expectedArtifacts, intake.files);
    checkBudget(false);
    if (!sameNode(rootBefore, identity(await lstat(root, { bigint: true }))) || (await realpath(root)) !== root) {
      throw scanError("seaweed_source_zip_scan_root_changed");
    }
    for (const record of owned) {
      const current = identity(await lstat(`/proc/self/fd/${rootHandle.fd}/${record.name}`, { bigint: true }));
      if (!sameIdentity(record.identity, current)) throw scanError("seaweed_source_zip_scan_file_changed");
    }
    result = Object.freeze({ kind: "SEAWEED_SOURCE_ZIP_STRUCTURAL_RECEIPT_V1", state: "ZIP_STRUCTURAL_ONLY",
      authority: "PREPARATION_ONLY", materialValidation: "NOT_RUN", extraction: "NOT_RUN",
      candidateAuthorization: "NOT_AUTHORIZED", repository: finalOrigin.repository,
      workflowId: finalOrigin.workflowId, sourceSha: finalOrigin.sourceSha,
      runId: finalOrigin.runId, attempt: finalOrigin.attempt,
      originBefore: intake.originBefore, originAfter: finalOrigin.observedAt,
      artifacts: Object.freeze(scans) });
  } catch (error) {
    failure = normalizeFailure(error, timedOut, signal);
  }

  const cleanup = async () => {
    if (rootHandle === undefined || intake === undefined) return true;
    let clean = true;
    const procRoot = `/proc/self/fd/${rootHandle.fd}`;
    for (const record of owned) {
      const target = `${procRoot}/${record.name}`;
      let current;
      try { current = identity(await lstat(target, { bigint: true })); } catch (error) {
        if (error.code !== "ENOENT") clean = false;
        continue;
      }
      if (!sameIdentity(record.identity, current)) { clean = false; continue; }
      try { await unlink(target); } catch (error) { if (error.code !== "ENOENT") clean = false; }
    }
    try { if ((await readdir(procRoot)).length !== 0) clean = false; } catch { clean = false; }
    return clean;
  };
  if (!await cleanup()) failure = cleanupFailure(failure);
  if (rootHandle !== undefined) {
    try { await rootHandle.close(); } catch {
      if (failure === undefined) failure = scanError("seaweed_source_zip_scan_close_failed");
    }
  }
  globalThis.clearTimeout(timer);
  if (failure === undefined) {
    try {
      checkBudget(false);
      if (!testOnly) requireAuthenticatedSeaweedSource(finalOrigin);
    } catch (error) { failure = normalizeFailure(error, timedOut, signal); }
  }
  if (failure !== undefined) throw failure;
  return result;
}

export async function scanReviewedSeaweedSourceZips(input) {
  return run(snapshotOptions(input, false));
}

export async function TEST_ONLY_scanReviewedSeaweedSourceZips(input) {
  return run(snapshotOptions(input, true));
}
