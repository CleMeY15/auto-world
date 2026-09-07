import { spawn } from "node:child_process";
import { lstat, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";

const allowedEnvironment = new Set([
  "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SYSTEMROOT", "WINDIR",
  "USERPROFILE", "LANG", "LC_ALL", "TZ", "SSL_CERT_FILE", "SSL_CERT_DIR",
  "GOPATH", "GOCACHE", "GOMODCACHE", "GOTOOLCHAIN", "GOPROXY", "GOSUMDB",
  "GOOS", "GOARCH", "CGO_ENABLED", "GOEXPERIMENT", "GOFLAGS", "SOURCE_DATE_EPOCH",
  "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL", "GIT_TERMINAL_PROMPT",
]);
const fixedEnvironment = { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
const ownedDirectories = new WeakSet();

export function policyError(code) {
  return Object.assign(new Error(code), { code });
}

export function cleanEnvironment(values = {}) {
  const output = Object.create(null);
  for (const [key, value] of Object.entries(values)) {
    if (!allowedEnvironment.has(key) || typeof value !== "string" || value.includes("\0") || value.length > 32768) {
      throw policyError("environment_refused");
    }
    if (Object.hasOwn(fixedEnvironment, key) && value !== fixedEnvironment[key]) throw policyError("environment_refused");
    output[key] = value;
  }
  return output;
}

// Caller must select a verified executable and fixed command contract. This utility
// never resolves executables through PATH or inherits the caller's credentials.
export async function runCommand(executable, args, {
  cwd, env = {}, timeoutMs = 60000, maxOutputBytes = 8 * 1024 * 1024,
} = {}) {
  if (typeof executable !== "string" || !path.isAbsolute(executable) || executable.includes("\0") ||
      typeof cwd !== "string" || !path.isAbsolute(cwd) ||
      !Array.isArray(args) || args.length > 1000 ||
      args.some((arg) => typeof arg !== "string" || arg.includes("\0") || arg.length > 32768) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 90 * 60 * 1000 ||
      !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 64 * 1024 * 1024) {
    throw policyError("command_refused");
  }
  const environment = cleanEnvironment(env);
  const started = Date.now();
  return new Promise((resolve, reject) => {
    let child;
    let failure;
    let bytes = 0;
    const stdout = [];
    const stderr = [];
    const stop = (code) => {
      failure ??= code;
      if (!child?.pid) return;
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch { /* A child that already exited needs no further cleanup. */ }
    };
    try {
      child = spawn(executable, args, {
        cwd, env: environment, shell: false, windowsHide: true,
        detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      reject(policyError("command_start_failed"));
      return;
    }
    const timer = setTimeout(() => stop("command_timeout"), timeoutMs);
    timer.unref();
    const capture = (chunks) => (chunk) => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) stop("command_output_limit");
      else if (!failure) chunks.push(chunk);
    };
    child.stdout.on("data", capture(stdout));
    child.stderr.on("data", capture(stderr));
    child.once("error", () => { failure ??= "command_start_failed"; });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      if (failure || exitCode !== 0) {
        reject(Object.assign(policyError(failure ?? "command_failed"), {
          exitCode: Number.isInteger(exitCode) ? exitCode : null,
          durationMs: Date.now() - started,
        }));
      } else {
        resolve(Object.freeze({
          stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr),
          exitCode, durationMs: Date.now() - started,
        }));
      }
    });
  });
}

export async function createOwnedDirectory(base = os.tmpdir()) {
  const parent = await realpath(base);
  const directory = await mkdtemp(path.join(parent, "auto-world-native-"));
  const handle = Object.freeze({ path: await realpath(directory), parent });
  ownedDirectories.add(handle);
  return handle;
}

export async function removeOwnedDirectory(handle) {
  if (!handle || !ownedDirectories.has(handle)) throw policyError("cleanup_not_owned");
  const info = await lstat(handle.path);
  if (!info.isDirectory() || info.isSymbolicLink() ||
      await realpath(handle.path) !== handle.path ||
      path.dirname(handle.path) !== handle.parent ||
      !path.basename(handle.path).startsWith("auto-world-native-")) {
    throw policyError("cleanup_path_changed");
  }
  // Ownership and canonical containment are checked before recursive removal.
  await rm(handle.path, { recursive: true, force: false, maxRetries: 2, retryDelay: 100 });
  ownedDirectories.delete(handle);
}
