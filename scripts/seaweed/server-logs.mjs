import {
  closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync,
} from "node:fs";
import path from "node:path";

const MiB = 1024 ** 2;
const WORK_NAME = "auto-world-seaweed-source-diagnostic";
const SERVER_DIRECTORY = /^seaweedfs_volume_server_it_[0-9]{1,128}$/u;
const SERVER_DIRECTORY_PREFIX = "seaweedfs_volume_server_it_";
const LOG_FILE = /^(?:master|volume[0-9]{1,128})\.log$/u;
const MAX_FILES = 64;
const MAX_FILE_BYTES = MiB;
const MAX_OUTPUT_BYTES = 8 * MiB;
const HEADER_RESERVE_BYTES = 512;
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

function trustedDirectory(directory) {
  const resolved = path.resolve(directory);
  const info = lstatSync(resolved);
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(resolved) !== resolved) {
    throw new Error("seaweed_server_logs_path_invalid");
  }
  return { path: resolved, info };
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size;
}

function openTrustedLog(file) {
  const before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || !Number.isSafeInteger(before.size) || before.size < 0) {
    throw new Error("seaweed_server_log_invalid");
  }
  const descriptor = openSync(file, constants.O_RDONLY | NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || !sameFile(before, opened)) throw new Error("seaweed_server_log_invalid");
    return { descriptor, size: opened.size, identity: opened };
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function readTail(entry, maximumBytes) {
  const length = Math.min(entry.size, maximumBytes);
  const value = Buffer.alloc(length);
  const position = entry.size - length;
  let offset = 0;
  while (offset < length) {
    const count = readSync(entry.descriptor, value, offset, length - offset, position + offset);
    if (count === 0) throw new Error("seaweed_server_log_invalid");
    offset += count;
  }
  const after = fstatSync(entry.descriptor);
  if (!after.isFile() || after.nlink !== 1 || !sameFile(entry.identity, after)) throw new Error("seaweed_server_log_invalid");
  return value;
}

function serverDirectories(tmp) {
  const names = readdirSync(tmp);
  for (const name of names) {
    if (name.startsWith(SERVER_DIRECTORY_PREFIX) && !SERVER_DIRECTORY.test(name)) throw new Error("seaweed_server_logs_entry_invalid");
  }
  return names.filter((name) => SERVER_DIRECTORY.test(name)).sort();
}

/**
 * Collects only bounded SeaweedFS integration-server logs after the caller has
 * proved that the monitored process group is absent. Oversized logs are kept as
 * deterministic tails. The returned buffer is suitable for the existing
 * aggregate log writer; this helper never writes or removes filesystem entries.
 */
export function collectServerLogs(workRoot, { groupAbsent, root = "/tmp" } = {}) {
  if (groupAbsent !== true) throw new Error("seaweed_server_logs_group_not_absent");
  if (typeof workRoot !== "string" || typeof root !== "string" || !path.isAbsolute(workRoot) || !path.isAbsolute(root)) {
    throw new Error("seaweed_server_logs_path_invalid");
  }

  const ownedRoot = trustedDirectory(root);
  const expectedWork = path.join(ownedRoot.path, WORK_NAME);
  if (workRoot !== path.resolve(workRoot) || path.resolve(workRoot) !== expectedWork) throw new Error("seaweed_server_logs_path_invalid");
  const work = trustedDirectory(workRoot);
  if (work.info.dev !== ownedRoot.info.dev) throw new Error("seaweed_server_logs_path_invalid");
  const tmp = trustedDirectory(path.join(work.path, "tmp"));
  if (tmp.info.dev !== work.info.dev) throw new Error("seaweed_server_logs_path_invalid");

  const candidates = [];
  for (const serverName of serverDirectories(tmp.path)) {
    const server = trustedDirectory(path.join(tmp.path, serverName));
    if (server.info.dev !== tmp.info.dev) throw new Error("seaweed_server_logs_path_invalid");
    const logsPath = path.join(server.path, "logs");
    let logs;
    try { logs = trustedDirectory(logsPath); }
    catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (logs.info.dev !== server.info.dev) throw new Error("seaweed_server_logs_path_invalid");
    const logNames = readdirSync(logs.path);
    for (const name of logNames) {
      if ((name.startsWith("master") || name.startsWith("volume")) && name.endsWith(".log") && !LOG_FILE.test(name)) {
        throw new Error("seaweed_server_logs_entry_invalid");
      }
    }
    for (const name of logNames.filter((entry) => LOG_FILE.test(entry)).sort()) {
      candidates.push({ relative: `${serverName}/logs/${name}`, path: path.join(logs.path, name) });
    }
  }
  if (candidates.length > MAX_FILES) throw new Error("seaweed_server_logs_file_limit_exceeded");

  const opened = [];
  try {
    for (const candidate of candidates) opened.push({ ...candidate, ...openTrustedLog(candidate.path) });
    const totalSourceBytes = opened.reduce((total, entry) => total + entry.size, 0);
    if (!Number.isSafeInteger(totalSourceBytes)) throw new Error("seaweed_server_logs_size_invalid");
    const prelude = Buffer.from(`seaweed-server-logs:v1\nfiles=${opened.length}\nsourceBytes=${totalSourceBytes}\n`, "utf8");
    if (opened.length === 0) return prelude;
    const availableDataBytes = MAX_OUTPUT_BYTES - prelude.length - opened.length * HEADER_RESERVE_BYTES;
    if (availableDataBytes < 0) throw new Error("seaweed_server_logs_output_limit_invalid");
    const perFileBytes = Math.min(MAX_FILE_BYTES, Math.floor(availableDataBytes / opened.length));
    const parts = [prelude];
    for (const entry of opened) {
      const retained = Math.min(entry.size, perFileBytes);
      parts.push(Buffer.from(`--- ${entry.relative} sourceBytes=${entry.size} retainedBytes=${retained} truncated=${retained < entry.size}\n`, "utf8"));
      parts.push(readTail(entry, retained));
      parts.push(Buffer.from("\n", "utf8"));
    }
    const result = Buffer.concat(parts);
    if (result.length > MAX_OUTPUT_BYTES) throw new Error("seaweed_server_logs_output_limit_invalid");
    return result;
  } finally {
    for (const entry of opened) closeSync(entry.descriptor);
  }
}

export const serverLogLimits = Object.freeze({ files: MAX_FILES, perFileBytes: MAX_FILE_BYTES, outputBytes: MAX_OUTPUT_BYTES });
