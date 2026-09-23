import {
  close, closeSync, constants, fchmodSync, fstat, fsync, lstatSync, mkdirSync, openSync, realpathSync, write,
} from "node:fs";
import { createHash } from "node:crypto";
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
const MAX_LIVE_READ_BYTES = 512 * 1024 ** 2;
const MAX_MODULE_CLOSURE_BYTES = 64 * 1024 ** 2;
const MAX_NOTICE_BYTES = 1024 ** 2;
const MAX_NOTICES = 16_384;

function materializationError(code, details = {}) {
  return Object.assign(new Error(code), {
    code, state: "INCOMPLETE", stage: "SOURCE_MATERIALIZATION",
    authority: "PREPARATION_ONLY", candidateAuthorization: "NOT_AUTHORIZED", ...details,
  });
}

function boundedLowerCode(error) {
  for (const value of [error?.code, error?.message]) {
    if (typeof value === "string" && /^seaweed_[a-z0-9_]+$/u.test(value)) return value;
  }
  return undefined;
}

function normalizeFailure(error, timedOut, signal) {
  if (timedOut) return materializationError("seaweed_source_materialization_timeout");
  if (signal?.aborted === true) return materializationError("seaweed_source_materialization_aborted");
  const code = boundedLowerCode(error);
  if (code?.startsWith("seaweed_source_materialization_")) return error;
  if (code?.startsWith("seaweed_raw_zip_")) {
    return materializationError("seaweed_source_materialization_download_failed", { downloadCode: code });
  }
  if (code?.startsWith("seaweed_artifact_zip_")) {
    return materializationError("seaweed_source_materialization_zip_invalid", { scanCode: code });
  }
  if (code?.startsWith("seaweed_source_origin_")) {
    return materializationError("seaweed_source_materialization_origin_invalid", { originCode: code });
  }
  if (code !== undefined) {
    return materializationError("seaweed_source_materialization_validation_failed", { validationCode: code });
  }
  return materializationError("seaweed_source_materialization_failed");
}

function snapshotOptions(input, testOnly) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw materializationError("seaweed_source_materialization_options_invalid");
  }
  const fields = Object.getOwnPropertyDescriptors(input);
  const permitted = new Set(["parent", "signal", "timeoutMs", ...(testOnly ? [
    "download", "scanOne", "readOrigin", "expectedArtifacts", "validate", "compare", "platform", "uid", "now",
    "syncFile", "closeFile", "requireOrigin", "beforeRename", "afterRename",
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
    closeFile: value("closeFile") ?? close,
    requireOrigin: value("requireOrigin") ?? requireAuthenticatedSeaweedSource,
    beforeRename: value("beforeRename"), afterRename: value("afterRename"),
  };
  if (typeof parent !== "string" || !path.isAbsolute(parent) || path.normalize(parent) !== parent
    || signal !== undefined && !(signal instanceof globalThis.AbortSignal)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs <= FINAL_ORIGIN_RESERVE_MS || timeoutMs > MAX_TIMEOUT_MS
    || settings.platform !== "linux" || !Number.isSafeInteger(settings.uid) || settings.uid < 0
    || ![settings.download, settings.scanOne, settings.readOrigin, settings.validate, settings.compare, settings.now,
      settings.syncFile, settings.closeFile, settings.requireOrigin].every((item) => typeof item === "function")
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

function safeRelativePath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 4096
    && !value.includes("\\") && !value.startsWith("/") && !value.endsWith("/")
    && path.posix.normalize(value) === value
    && !value.split("/").some((part) => part === "" || part === "." || part === "..");
}

function comparedIdentities(compared) {
  if (!Array.isArray(compared?.compared) || compared.compared.length < 1) {
    throw materializationError("seaweed_source_materialization_comparison_invalid");
  }
  const identities = new Map();
  for (const entry of compared.compared) {
    if (!safeRelativePath(entry?.path) || !/^[a-f0-9]{64}$/u.test(entry?.sha256 ?? "")
      || !Number.isSafeInteger(entry?.size) || entry.size < 0 || entry.size > MAX_LIVE_READ_BYTES
      || identities.has(entry.path)) {
      throw materializationError("seaweed_source_materialization_comparison_invalid");
    }
    identities.set(entry.path, Object.freeze({ sha256: entry.sha256, size: entry.size }));
  }
  if (!identities.has("weed") || !identities.has("module-closure.json")) {
    throw materializationError("seaweed_source_materialization_comparison_invalid");
  }
  return identities;
}

async function requireSnapshotPath(authority, relativePath) {
  const parts = relativePath.split("/");
  for (let index = 0; index <= parts.length; index += 1) {
    const relative = index === 0 ? "seaweed-build-1" : path.join("seaweed-build-1", ...parts.slice(0, index));
    const expected = authority.tree.get(relative);
    if (expected === undefined || (index < parts.length && expected.type !== "directory")
      || (index === parts.length && expected.type !== "file")) {
      throw materializationError("seaweed_source_materialization_read_unauthorized");
    }
    let stat;
    try { stat = await lstat(path.join(authority.outputPath, relative), { bigint: true }); } catch {
      throw materializationError("seaweed_source_materialization_read_changed");
    }
    const observed = Object.freeze({ type: stat.isDirectory() && !stat.isSymbolicLink() ? "directory" : "file", identity: identity(stat) });
    if (stat.isSymbolicLink() || !sameRecord(expected, observed)) {
      throw materializationError("seaweed_source_materialization_read_changed");
    }
  }
}

async function readValidatedSourceFile(authority, relativePath) {
  if (!safeRelativePath(relativePath)) throw materializationError("seaweed_source_materialization_read_unauthorized");
  const expected = authority.compared.get(relativePath);
  if (expected === undefined || expected.size > MAX_LIVE_READ_BYTES) {
    throw materializationError("seaweed_source_materialization_read_unauthorized");
  }
  await requireSnapshotPath(authority, relativePath);
  const absolute = path.join(authority.outputPath, "seaweed-build-1", ...relativePath.split("/"));
  let handle; let detached; let closeFailed = false;
  try {
    handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = identity(await handle.stat({ bigint: true }));
    const snapshot = authority.tree.get(path.join("seaweed-build-1", ...relativePath.split("/"))).identity;
    if (!sameIdentity(snapshot, before) || before.nlink !== 1 || before.size !== expected.size) {
      throw materializationError("seaweed_source_materialization_read_changed");
    }
    const bytes = await handle.readFile();
    const after = identity(await handle.stat({ bigint: true }));
    if (!sameIdentity(before, after) || bytes.length !== expected.size
      || createHash("sha256").update(bytes).digest("hex") !== expected.sha256) {
      throw materializationError("seaweed_source_materialization_read_changed");
    }
    await requireSnapshotPath(authority, relativePath);
    detached = bytes;
  } catch (error) {
    if (error?.code?.startsWith?.("seaweed_source_materialization_")) throw error;
    throw materializationError("seaweed_source_materialization_read_changed");
  } finally {
    if (handle !== undefined) {
      try { await handle.close(); } catch { closeFailed = true; }
    }
  }
  if (closeFailed) throw materializationError("seaweed_source_materialization_read_changed");
  return detached;
}

async function liveSourceInputs(authority) {
  if (authority.compared.get("module-closure.json")?.size > MAX_MODULE_CLOSURE_BYTES) {
    throw materializationError("seaweed_source_materialization_read_unauthorized");
  }
  const moduleClosureBytes = await readValidatedSourceFile(authority, "module-closure.json");
  let modules;
  try { modules = JSON.parse(moduleClosureBytes.toString("utf8")); } catch {
    throw materializationError("seaweed_source_materialization_read_changed");
  }
  if (!Array.isArray(modules) || modules.length < 1 || modules.length > 2048) {
    throw materializationError("seaweed_source_materialization_read_changed");
  }
  const paths = new Set(["materials/DERIVATIVE-NOTICE.txt", "materials/upstream/LICENSE", "materials/upstream/weed/glog/LICENSE"]);
  let noticeCount = 0;
  for (const module of modules) {
    if (!/^[a-f0-9]{64}$/u.test(module?.id ?? "") || !Array.isArray(module?.notices) || module.notices.length > 64) {
      throw materializationError("seaweed_source_materialization_read_changed");
    }
    for (const notice of module.notices) {
      noticeCount += 1;
      const name = `materials/modules/${module.id}/${notice?.file}`;
      const compared = authority.compared.get(name);
      if (noticeCount > MAX_NOTICES || !/^notice-[0-9]{3}\.txt$/u.test(notice?.file ?? "")
        || !/^[a-f0-9]{64}$/u.test(notice?.sha256 ?? "") || !Number.isSafeInteger(notice?.size)
        || notice.size < 1 || notice.size > MAX_NOTICE_BYTES
        || compared?.sha256 !== notice.sha256 || compared.size !== notice.size) {
        throw materializationError("seaweed_source_materialization_read_changed");
      }
      paths.add(name);
    }
  }
  const materials = new Map();
  let total = 0;
  for (const name of paths) {
    const bytes = await readValidatedSourceFile(authority, name);
    total += bytes.length;
    if (total > MAX_LIVE_READ_BYTES) throw materializationError("seaweed_source_materialization_read_unauthorized");
    materials.set(name, bytes);
  }
  const binary = authority.compared.get("weed");
  return Object.freeze({
    sourceIdentity: Object.freeze({
      binary: Object.freeze({ sha256: binary.sha256, size: binary.size }),
      runId: String(authority.runId), attempt: authority.attempt,
      codeRevision: authority.sourceSha,
    }),
    moduleClosureBytes, materials,
  });
}

async function requirePrivateDirectory(directory, uid, expectedMode = 0o700) {
  const stat = await lstat(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== BigInt(uid)
    || (stat.mode & 0o777n) !== BigInt(expectedMode) || await realpath(directory) !== directory) {
    throw materializationError("seaweed_source_materialization_parent_invalid");
  }
  return identity(stat);
}

function exactArtifacts(observed, expected) {
  if (!Array.isArray(observed) || observed.length !== ZIP_NAMES.length) {
    throw materializationError("seaweed_source_materialization_origin_changed");
  }
  for (let index = 0; index < ZIP_NAMES.length; index += 1) {
    const current = observed[index]; const fixed = expected[index];
    if (current?.id !== fixed?.id || current?.name !== fixed?.name || current?.size !== fixed?.size
      || current?.digest !== fixed?.digest || current?.profile !== fixed?.profile) {
      throw materializationError("seaweed_source_materialization_origin_changed");
    }
  }
}

function exactDownloadedFiles(expected, downloaded) {
  if (!Array.isArray(downloaded) || downloaded.length !== ZIP_NAMES.length) {
    throw materializationError("seaweed_source_materialization_origin_changed");
  }
  for (let index = 0; index < ZIP_NAMES.length; index += 1) {
    const fixed = expected[index]; const file = downloaded[index];
    if (file?.id !== fixed?.id || file?.githubName !== fixed?.name || file?.name !== ZIP_NAMES[index]
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

function sinkFailure(originalCode) {
  return materializationError("seaweed_source_materialization_sink_failed", { originalCode });
}

function extractionSink(root, uid, owned, staging, syncFile, closeFile) {
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
      const finishClose = (error) => closeFile(fd, (closeError) => {
        closed = true;
        const finalError = error ?? (closeError === null || closeError === undefined
          ? undefined : sinkFailure("seaweed_source_materialization_sink_close_failed"));
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
      final(callback) {
        syncFile(fd, (error) => error
          ? recordAndClose(() => callback(sinkFailure("seaweed_source_materialization_sink_sync_failed")))
          : recordAndClose(callback));
      },
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
    validate, compare, uid, now, syncFile, closeFile, requireOrigin, beforeRename, afterRename } = settings;
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
    exactDownloadedFiles(expectedArtifacts, intake?.files);
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
        openEntrySink: extractionSink(index < 2 ? output : staging, uid, owned, staging, syncFile, closeFile), signal: operationSignal });
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
    requireOrigin(finalOrigin);
    exactOrigin(finalOrigin, intake);
    exactArtifacts(finalOrigin.artifacts, expectedArtifacts);
    exactDownloadedFiles(expectedArtifacts, intake.files);
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
    requireOrigin(finalOrigin);
    await rename(staging, outputPath);
    stagingCreated = false; outputCreated = true;
    if (afterRename !== undefined) await afterRename({ parent, outputPath });
    const tree = await snapshotTree(outputPath, uid);
    if (tree.size !== beforePromotion.size || [...beforePromotion].some(([name, record]) => !tree.has(name) || !sameRecord(record, tree.get(name)))) {
      throw materializationError("seaweed_source_materialization_output_changed");
    }
    checkBudget(false);
    requireOrigin(finalOrigin);
    result = Object.freeze({ kind: "SEAWEED_SOURCE_MATERIALIZATION_RECEIPT_V1", state: "MATERIALIZED",
      authority: "PREPARATION_ONLY", candidateAuthorization: "NOT_AUTHORIZED", outputPath,
      repository: finalOrigin.repository, workflowId: finalOrigin.workflowId, sourceSha: finalOrigin.sourceSha,
      runId: finalOrigin.runId, attempt: finalOrigin.attempt,
      buildBytes: Object.freeze([firstValidation.totalBytes, secondValidation.totalBytes]),
      comparedEntries: compared.compared.length });
    CLEANUP_AUTHORITIES.set(result, {
      parent, outputPath, uid, parentIdentity: parentBefore, tree,
      compared: comparedIdentities(compared), runId: finalOrigin.runId, attempt: finalOrigin.attempt,
      sourceSha: finalOrigin.sourceSha, borrowed: 0, cleaning: false,
    });
  } catch (error) {
    lowerCleanupUncertain = boundedLowerCode(error) === "seaweed_raw_zip_cleanup_failed";
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

export async function withMaterializedSeaweedSource(result, callback) {
  const authority = CLEANUP_AUTHORITIES.get(result);
  if (authority === undefined || result?.outputPath !== authority.outputPath || authority.cleaning
    || typeof callback !== "function") {
    throw materializationError("seaweed_source_materialization_read_unauthorized");
  }
  authority.borrowed += 1;
  let active = true; let reading = false; let binaryUsed = false; const pending = new Set();
  try {
    const inputs = await liveSourceInputs(authority);
    const readBinary = () => {
      if (!active) return Promise.reject(materializationError("seaweed_source_materialization_read_unauthorized"));
      if (reading) return Promise.reject(materializationError("seaweed_source_materialization_read_busy"));
      if (binaryUsed) return Promise.reject(materializationError("seaweed_source_materialization_read_replayed"));
      reading = true; binaryUsed = true;
      const operation = readValidatedSourceFile(authority, "weed");
      pending.add(operation);
      const settled = () => { pending.delete(operation); reading = false; };
      operation.then(settled, settled);
      return operation;
    };
    const capability = Object.freeze({
      sourceIdentity: inputs.sourceIdentity,
      moduleClosureBytes: inputs.moduleClosureBytes,
      materials: inputs.materials,
      readBinary,
    });
    return await callback(capability);
  } finally {
    active = false;
    await Promise.allSettled([...pending]);
    authority.borrowed -= 1;
  }
}

export async function cleanupMaterializedSeaweedSource(result) {
  const authority = CLEANUP_AUTHORITIES.get(result);
  if (authority === undefined || result?.outputPath !== authority.outputPath) {
    throw materializationError("seaweed_source_materialization_cleanup_unauthorized");
  }
  if (authority.borrowed !== 0 || authority.cleaning) {
    throw materializationError("seaweed_source_materialization_cleanup_borrowed");
  }
  authority.cleaning = true;
  try {
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
  } finally { authority.cleaning = false; }
}
