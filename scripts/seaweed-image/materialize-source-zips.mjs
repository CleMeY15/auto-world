import {
  close, closeSync, constants, fchmodSync, fstat, fsync, lstatSync, mkdirSync, openSync, realpathSync, write,
} from "node:fs";
import {
  lstat, mkdir, open, readdir, realpath, rename, rmdir, unlink,
} from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";

import { validateArtifactDirectory } from "../seaweed/build.mjs";
import { compareBuilds, comparisonReceiptBytes } from "../seaweed/compare.mjs";
import { downloadReviewedSeaweedZips } from "./download-source-zips.mjs";
import { scanOwnedGitHubArtifactZip } from "./read-artifact-zip.mjs";
import { collectAuthenticatedSeaweedSource, requireAuthenticatedSeaweedSource } from "./source-origin.mjs";
import { reviewedSeaweedSourcePolicy } from "./source-records.mjs";

const DEFAULT_TIMEOUT_MS = 60 * 60_000;
const MAX_TIMEOUT_MS = 90 * 60_000;
const FINAL_ORIGIN_RESERVE_MS = 120_000;
const STAGING_NAME = ".seaweed-source-materialization-staging";
const OUTPUT_NAME = "seaweed-source-materialized";
const RAW_NAME = ".raw";
const ZIP_NAMES = Object.freeze([
  "seaweed-build-1.zip", "seaweed-build-2.zip", "seaweed-artifact-gate-1.zip",
  "seaweed-artifact-gate-2.zip", "seaweed-comparison.zip",
]);
const OUTPUT_NAMES = Object.freeze([
  "seaweed-build-1", "seaweed-build-2", "seaweed-artifact-gate-1.json",
  "seaweed-artifact-gate-2.json", "seaweed-comparison.json",
]);
const CLEANUP_AUTHORITIES = new WeakMap();

function materializationError(code, details = {}) {
  return Object.assign(new Error(code), {
    code, state: "INCOMPLETE", stage: "SOURCE_MATERIALIZATION",
    authority: "PREPARATION_ONLY", candidateAuthorization: "NOT_AUTHORIZED", ...details,
  });
}

function normalizeFailure(error, timedOut, signal) {
  if (timedOut) return materializationError("seaweed_source_materialization_timeout");
  if (signal?.aborted === true) return materializationError("seaweed_source_materialization_aborted");
  if (error?.code?.startsWith("seaweed_source_materialization_")) return error;
  if (error?.code?.startsWith("seaweed_raw_zip_")) return materializationError("seaweed_source_materialization_download_failed");
  if (error?.code?.startsWith("seaweed_artifact_zip_")) return materializationError("seaweed_source_materialization_zip_invalid");
  if (error?.message?.startsWith("seaweed_")) return materializationError("seaweed_source_materialization_validation_failed");
  return materializationError("seaweed_source_materialization_failed");
}

function snapshotOptions(input, testOnly) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw materializationError("seaweed_source_materialization_options_invalid");
  }
  const fields = Object.getOwnPropertyDescriptors(input);
  const permitted = new Set(["parent", "signal", "timeoutMs", ...(testOnly ? [
    "download", "scanOne", "readOrigin", "expectedArtifacts", "validate", "compare", "platform", "uid", "now",
    "syncFile", "beforeRename", "afterRename",
  ] : [])]);
  if (Reflect.ownKeys(fields).some((key) => !permitted.has(key) || !("value" in fields[key]))) {
    throw materializationError("seaweed_source_materialization_options_invalid");
  }
  const value = (key) => fields[key]?.value;
  const parent = value("parent");
  const signal = value("signal");
  const timeoutMs = value("timeoutMs") ?? DEFAULT_TIMEOUT_MS;
  const settings = {
    parent, signal, timeoutMs, testOnly,
    download: value("download") ?? downloadReviewedSeaweedZips,
    scanOne: value("scanOne") ?? scanOwnedGitHubArtifactZip,
    readOrigin: value("readOrigin") ?? collectAuthenticatedSeaweedSource,
    expectedArtifacts: value("expectedArtifacts") ?? reviewedSeaweedSourcePolicy.artifacts,
    validate: value("validate") ?? validateArtifactDirectory,
    compare: value("compare") ?? compareBuilds,
    platform: value("platform") ?? process.platform,
    uid: value("uid") ?? (typeof process.getuid === "function" ? process.getuid() : undefined),
    now: value("now") ?? Date.now,
    syncFile: value("syncFile") ?? fsync,
    beforeRename: value("beforeRename"), afterRename: value("afterRename"),
  };
  if (typeof parent !== "string" || !path.isAbsolute(parent) || path.normalize(parent) !== parent
    || signal !== undefined && !(signal instanceof globalThis.AbortSignal)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs <= FINAL_ORIGIN_RESERVE_MS || timeoutMs > MAX_TIMEOUT_MS
    || settings.platform !== "linux" || !Number.isSafeInteger(settings.uid) || settings.uid < 0
    || ![settings.download, settings.scanOne, settings.readOrigin, settings.validate, settings.compare, settings.now, settings.syncFile].every((item) => typeof item === "function")
    || settings.beforeRename !== undefined && typeof settings.beforeRename !== "function"
    || settings.afterRename !== undefined && typeof settings.afterRename !== "function"
    || !Array.isArray(settings.expectedArtifacts) || settings.expectedArtifacts.length !== ZIP_NAMES.length) {
    throw materializationError("seaweed_source_materialization_options_invalid");
  }
  return Object.freeze(settings);
}

function identity(stat) {
  return Object.freeze({
    dev: stat.dev.toString(10), ino: stat.ino.toString(10), uid: Number(stat.uid), gid: Number(stat.gid),
    mode: Number(stat.mode), nlink: Number(stat.nlink), size: Number(stat.size),
    mtimeNs: stat.mtimeNs.toString(10), ctimeNs: stat.ctimeNs.toString(10),
  });
}

function sameIdentity(left, right) {
  return Object.keys(left).every((key) => left[key] === right[key]);
}

function sameNode(left, right) {
  return ["dev", "ino", "uid", "gid", "mode"].every((key) => left[key] === right[key]);
}

async function requirePrivateDirectory(directory, uid, expectedMode = 0o700) {
  const stat = await lstat(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== BigInt(uid)
    || (stat.mode & 0o777n) !== BigInt(expectedMode) || await realpath(directory) !== directory) {
    throw materializationError("seaweed_source_materialization_parent_invalid");
  }
  return identity(stat);
}

function exactArtifacts(observed, expected, downloaded) {
  if (!Array.isArray(observed) || observed.length !== ZIP_NAMES.length
    || !Array.isArray(downloaded) || downloaded.length !== ZIP_NAMES.length) {
    throw materializationError("seaweed_source_materialization_origin_changed");
  }
  for (let index = 0; index < ZIP_NAMES.length; index += 1) {
    const current = observed[index]; const fixed = expected[index]; const file = downloaded[index];
    if (current?.id !== fixed?.id || current?.name !== fixed?.name || current?.size !== fixed?.size
      || current?.digest !== fixed?.digest || current?.profile !== fixed?.profile
      || file?.id !== fixed?.id || file?.githubName !== fixed?.name || file?.name !== ZIP_NAMES[index]
      || file?.size !== fixed?.size || file?.digest !== fixed?.digest || file?.profile !== fixed?.profile) {
      throw materializationError("seaweed_source_materialization_origin_changed");
    }
  }
}

function exactOrigin(observed, intake) {
  if (observed?.repository !== intake?.repository || observed?.workflowId !== intake?.workflowId
    || observed?.sourceSha !== intake?.sourceSha || observed?.runId !== intake?.runId || observed?.attempt !== intake?.attempt) {
    throw materializationError("seaweed_source_materialization_origin_changed");
  }
}

function ensureOutputParent(root, entryPath, uid, owned, staging) {
  const parts = entryPath.split("/").slice(0, -1);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    let created = false;
    try { mkdirSync(current, { mode: 0o700 }); created = true; } catch (error) { if (error.code !== "EEXIST") throw error; }
    const stat = lstatSync(current, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== BigInt(uid)
      || (stat.mode & 0o777n) !== 0o700n || realpathSync(current) !== current) {
      throw materializationError("seaweed_source_materialization_output_invalid");
    }
    if (created) owned.set(path.relative(staging, current), Object.freeze({ type: "directory", identity: identity(stat) }));
  }
}

function writeAll(fd, chunk, offset, callback) {
  write(fd, chunk, offset, chunk.length - offset, null, (error, written) => {
    if (error) callback(error);
    else if (written < 1) callback(materializationError("seaweed_source_materialization_output_invalid"));
    else if (offset + written === chunk.length) callback();
    else writeAll(fd, chunk, offset + written, callback);
  });
}

function extractionSink(root, uid, owned, staging, syncFile) {
  return (entry) => {
    const target = path.join(root, ...entry.path.split("/"));
    ensureOutputParent(root, entry.path, uid, owned, staging);
    const mode = entry.mode & 0o777;
    const fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
    try { fchmodSync(fd, mode); } catch (error) { closeSync(fd); throw error; }
    let closed = false; let closing = false; const closeWaiters = [];
    const recordAndClose = (callback) => {
      if (closed) { callback(); return; }
      closeWaiters.push(callback);
      if (closing) return;
      closing = true;
      const finishClose = (error) => close(fd, (closeError) => {
        closed = true;
        const finalError = error ?? closeError;
        for (const waiter of closeWaiters.splice(0)) waiter(finalError);
      });
      fstat(fd, { bigint: true }, (statError, stat) => {
        if (statError) { finishClose(statError); return; }
        let pathStat;
        try { pathStat = lstatSync(target, { bigint: true }); } catch (error) { finishClose(error); return; }
        if (!stat.isFile() || stat.nlink !== 1n || stat.uid !== BigInt(uid)
          || (stat.mode & 0o777n) !== BigInt(mode) || !sameIdentity(identity(stat), identity(pathStat))) {
          finishClose(materializationError("seaweed_source_materialization_output_invalid")); return;
        }
        owned.set(path.relative(staging, target), Object.freeze({ type: "file", identity: identity(stat) }));
        finishClose();
      });
    };
    return new Writable({
      write(chunk, _encoding, callback) { writeAll(fd, chunk, 0, callback); },
      final(callback) { syncFile(fd, (error) => error ? recordAndClose(() => callback(error)) : recordAndClose(callback)); },
      destroy(error, callback) {
        if (closed) return callback(error);
        recordAndClose((closeError) => callback(error ?? closeError));
      },
    });
  };
}

function expectedGate(repeat, validation) {
  return { schemaVersion: 1, state: "DIAGNOSTIC_ONLY", result: "PASSED", repeat,
    buildResult: "PASSED", totalBytes: validation.totalBytes };
}

async function fileBytes(file, limit) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.size < 1n || stat.size > BigInt(limit)) {
      throw materializationError("seaweed_source_materialization_receipt_invalid");
    }
    return await handle.readFile();
  } finally { await handle.close(); }
}

async function snapshotTree(root, uid) {
  const records = new Map();
  const walk = async (current, relative = "") => {
    const names = await readdir(current);
    names.sort();
    for (const name of names) {
      const absolute = path.join(current, name); const childRelative = path.join(relative, name);
      const stat = await lstat(absolute, { bigint: true });
      if (stat.isSymbolicLink() || stat.uid !== BigInt(uid) || (!stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1n))) {
        throw materializationError("seaweed_source_materialization_ownership_invalid");
      }
      records.set(childRelative, Object.freeze({ type: stat.isDirectory() ? "directory" : "file", identity: identity(stat) }));
      if (stat.isDirectory()) await walk(absolute, childRelative);
    }
  };
  const rootStat = await lstat(root, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || rootStat.uid !== BigInt(uid) || await realpath(root) !== root) {
    throw materializationError("seaweed_source_materialization_ownership_invalid");
  }
  records.set("", Object.freeze({ type: "directory", identity: identity(rootStat) }));
  await walk(root);
  return records;
}

function sameRecord(expected, observed) {
  return expected.type === observed.type && (expected.type === "directory"
    ? sameNode(expected.identity, observed.identity) : sameIdentity(expected.identity, observed.identity));
}

async function removeVerifiedTree(root, parent, uid, expectedSnapshot) {
  const parentBefore = await requirePrivateDirectory(parent, uid);
  if (path.dirname(root) !== parent || ![path.join(parent, STAGING_NAME), path.join(parent, OUTPUT_NAME)].includes(root)) return false;
  let observed;
  try { observed = await snapshotTree(root, uid); } catch { return false; }
  if (expectedSnapshot !== undefined) {
    if (observed.size !== expectedSnapshot.size) return false;
    for (const [name, expected] of expectedSnapshot) {
      if (!observed.has(name) || !sameRecord(expected, observed.get(name))) return false;
    }
  }
  const names = [...observed.keys()].filter(Boolean).sort((a, b) => b.split(path.sep).length - a.split(path.sep).length || b.localeCompare(a));
  try {
    for (const name of names) {
      const target = path.join(root, name); const stat = await lstat(target, { bigint: true });
      const current = Object.freeze({ type: stat.isDirectory() && !stat.isSymbolicLink() ? "directory" : "file", identity: identity(stat) });
      if (!sameRecord(expectedSnapshot.get(name), current)) return false;
      if (stat.isDirectory() && !stat.isSymbolicLink()) await rmdir(target);
      else await unlink(target);
    }
    const rootStat = await lstat(root, { bigint: true });
    if (!sameRecord(expectedSnapshot.get(""), Object.freeze({ type: "directory", identity: identity(rootStat) }))) return false;
    await rmdir(root);
  } catch { return false; }
  return sameNode(parentBefore, identity(await lstat(parent, { bigint: true }))) && (await readdir(parent)).length === 0;
}

async function run(settings) {
  const { parent, signal, timeoutMs, download, scanOne, readOrigin, expectedArtifacts,
    validate, compare, uid, now, testOnly, syncFile, beforeRename, afterRename } = settings;
  const startedAt = now(); const deadline = startedAt + timeoutMs;
  let timedOut = false;
  const timeoutController = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => { timedOut = true; timeoutController.abort(); }, timeoutMs);
  timer.unref?.();
  const operationSignal = signal === undefined ? timeoutController.signal : globalThis.AbortSignal.any([signal, timeoutController.signal]);
  const remaining = () => Math.floor(deadline - now());
  const checkBudget = (reserve = false) => {
    if (timedOut || remaining() <= (reserve ? FINAL_ORIGIN_RESERVE_MS : 0)) throw materializationError("seaweed_source_materialization_timeout");
    if (signal?.aborted === true || operationSignal.aborted) throw materializationError("seaweed_source_materialization_aborted");
  };
  const staging = path.join(parent, STAGING_NAME); const outputPath = path.join(parent, OUTPUT_NAME); const raw = path.join(staging, RAW_NAME);
  let parentBefore; let stagingIdentity; let intake; let result; let failure; let lowerCleanupUncertain = false;
  let stagingCreated = false; let outputCreated = false;
  const owned = new Map();
  try {
    checkBudget(true);
    parentBefore = await requirePrivateDirectory(parent, uid);
    if ((await readdir(parent)).length !== 0) throw materializationError("seaweed_source_materialization_parent_not_empty");
    await mkdir(staging, { mode: 0o700 }); stagingCreated = true;
    stagingIdentity = identity(await lstat(staging, { bigint: true }));
    await mkdir(raw, { mode: 0o700 });
    owned.set(RAW_NAME, Object.freeze({ type: "directory", identity: identity(await lstat(raw, { bigint: true })) }));
    intake = await download({ root: raw, signal: operationSignal, timeoutMs: remaining() - FINAL_ORIGIN_RESERVE_MS });
    exactArtifacts(expectedArtifacts, expectedArtifacts, intake?.files);
    for (let index = 0; index < ZIP_NAMES.length; index += 1) {
      const stat = await lstat(path.join(raw, ZIP_NAMES[index]), { bigint: true });
      const reported = intake.files[index].identity;
      const current = identity(stat);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || stat.uid !== BigInt(uid)
        || current.dev !== reported.dev || current.ino !== reported.ino || current.uid !== reported.uid
        || Number(stat.mode & 0o777n) !== reported.mode || current.size !== intake.files[index].size) {
        throw materializationError("seaweed_source_materialization_ownership_invalid");
      }
      owned.set(path.join(RAW_NAME, ZIP_NAMES[index]), Object.freeze({ type: "file", identity: current }));
    }

    for (let index = 0; index < ZIP_NAMES.length; index += 1) {
      checkBudget(true);
      const file = intake.files[index]; const output = path.join(staging, OUTPUT_NAMES[index]);
      if (index < 2) {
        await mkdir(output, { mode: 0o700 });
        owned.set(OUTPUT_NAMES[index], Object.freeze({ type: "directory", identity: identity(await lstat(output, { bigint: true })) }));
      }
      await scanOne({ file: file.path, root: raw, descriptor: file, profile: file.profile,
        openEntrySink: extractionSink(index < 2 ? output : staging, uid, owned, staging, syncFile), signal: operationSignal });
    }

    const first = path.join(staging, OUTPUT_NAMES[0]); const second = path.join(staging, OUTPUT_NAMES[1]);
    checkBudget(true);
    const firstValidation = validate(first);
    checkBudget(true);
    const secondValidation = validate(second);
    checkBudget(true);
    if (firstValidation?.result !== "PASSED" || secondValidation?.result !== "PASSED") {
      throw materializationError("seaweed_source_materialization_build_invalid");
    }
    for (const [repeat, validation] of [[1, firstValidation], [2, secondValidation]]) {
      const bytes = await fileBytes(path.join(staging, `seaweed-artifact-gate-${repeat}.json`), 1024 ** 2);
      const expectedBytes = Buffer.from(`${JSON.stringify(expectedGate(repeat, validation), null, 2)}\n`);
      if (!bytes.equals(expectedBytes)) {
        throw materializationError("seaweed_source_materialization_gate_invalid");
      }
    }
    const expectedRun = { repository: intake.repository, ref: "refs/heads/main", codeSha: intake.sourceSha,
      runId: String(intake.runId), attempt: String(intake.attempt) };
    const compared = compare(first, second, expectedRun);
    checkBudget(true);
    const nativeComparison = await fileBytes(path.join(staging, "seaweed-comparison.json"), 1024 ** 2);
    if (!nativeComparison.equals(comparisonReceiptBytes(compared))) {
      throw materializationError("seaweed_source_materialization_comparison_invalid");
    }

    const finalOrigin = await readOrigin({ signal: operationSignal, timeoutMs: Math.min(FINAL_ORIGIN_RESERVE_MS, remaining()) });
    if (!testOnly) requireAuthenticatedSeaweedSource(finalOrigin);
    exactOrigin(finalOrigin, intake);
    exactArtifacts(finalOrigin.artifacts, expectedArtifacts, intake.files);
    checkBudget(false);
    if (!sameNode(parentBefore, identity(await lstat(parent, { bigint: true }))) || await realpath(parent) !== parent) {
      throw materializationError("seaweed_source_materialization_parent_changed");
    }
    const beforePromotion = await snapshotTree(staging, uid);
    if (beforePromotion.size !== owned.size + 1 || [...owned].some(([name, record]) => !beforePromotion.has(name) || !sameRecord(record, beforePromotion.get(name)))) {
      throw materializationError("seaweed_source_materialization_ownership_invalid");
    }
    if (beforeRename !== undefined) await beforeRename({ parent, staging, outputPath });
    if (JSON.stringify((await readdir(parent)).sort()) !== JSON.stringify([STAGING_NAME])) {
      throw materializationError("seaweed_source_materialization_parent_changed");
    }
    try {
      await lstat(outputPath);
      throw materializationError("seaweed_source_materialization_output_exists");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    checkBudget(false);
    await rename(staging, outputPath);
    stagingCreated = false; outputCreated = true;
    if (afterRename !== undefined) await afterRename({ parent, outputPath });
    const tree = await snapshotTree(outputPath, uid);
    if (tree.size !== beforePromotion.size || [...beforePromotion].some(([name, record]) => !tree.has(name) || !sameRecord(record, tree.get(name)))) {
      throw materializationError("seaweed_source_materialization_output_changed");
    }
    checkBudget(false);
    result = Object.freeze({ kind: "SEAWEED_SOURCE_MATERIALIZATION_RECEIPT_V1", state: "MATERIALIZED",
      authority: "PREPARATION_ONLY", candidateAuthorization: "NOT_AUTHORIZED", outputPath,
      repository: finalOrigin.repository, workflowId: finalOrigin.workflowId, sourceSha: finalOrigin.sourceSha,
      runId: finalOrigin.runId, attempt: finalOrigin.attempt,
      buildBytes: Object.freeze([firstValidation.totalBytes, secondValidation.totalBytes]),
      comparedEntries: compared.compared.length });
    CLEANUP_AUTHORITIES.set(result, Object.freeze({ parent, outputPath, uid, parentIdentity: parentBefore, tree }));
  } catch (error) {
    lowerCleanupUncertain = error?.code === "seaweed_raw_zip_cleanup_failed";
    failure = normalizeFailure(error, timedOut, signal);
  }
  globalThis.clearTimeout(timer);
  if (failure !== undefined) {
    if (lowerCleanupUncertain) {
      throw materializationError("seaweed_source_materialization_cleanup_failed", { originalCode: "seaweed_raw_zip_cleanup_failed" });
    }
    const cleanupTarget = outputCreated ? outputPath : stagingCreated ? staging : undefined;
    const expectedCleanup = stagingIdentity === undefined ? undefined : new Map([
      ["", Object.freeze({ type: "directory", identity: stagingIdentity })], ...owned,
    ]);
    if (cleanupTarget !== undefined && (expectedCleanup === undefined
      || !await removeVerifiedTree(cleanupTarget, parent, uid, expectedCleanup))) {
      throw materializationError("seaweed_source_materialization_cleanup_failed", { originalCode: failure.code });
    }
    throw failure;
  }
  return result;
}

export async function materializeReviewedSeaweedSource(input) { return run(snapshotOptions(input, false)); }
export async function TEST_ONLY_materializeSeaweedSource(input) { return run(snapshotOptions(input, true)); }

export async function cleanupMaterializedSeaweedSource(result) {
  const authority = CLEANUP_AUTHORITIES.get(result);
  if (authority === undefined || result?.outputPath !== authority.outputPath) {
    throw materializationError("seaweed_source_materialization_cleanup_unauthorized");
  }
  let parentNow;
  try { parentNow = identity(await lstat(authority.parent, { bigint: true })); } catch {
    throw materializationError("seaweed_source_materialization_cleanup_failed");
  }
  if (!sameNode(authority.parentIdentity, parentNow)
    || !await removeVerifiedTree(authority.outputPath, authority.parent, authority.uid, authority.tree)) {
    throw materializationError("seaweed_source_materialization_cleanup_failed");
  }
  CLEANUP_AUTHORITIES.delete(result);
  return Object.freeze({ state: "CLEANED", outputPath: authority.outputPath });
}
