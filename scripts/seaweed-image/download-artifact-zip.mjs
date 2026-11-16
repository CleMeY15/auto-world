import { spawn as nodeSpawn } from "node:child_process";
import { createHash } from "node:crypto";
import { types } from "node:util";

const GH_EXECUTABLE = process.platform === "win32" ? "C:\\Program Files\\GitHub CLI\\gh.exe"
  : process.platform === "linux" ? "/usr/bin/gh" : undefined;
const REPOSITORY = "CleMeY15/auto-world";
const MAX_ZIP_BYTES = 2 * 1024 ** 3;
const MAX_TIMEOUT_MS = 60 * 60_000;
const MAX_ENV_ENTRIES = 64;
const MAX_ENV_KEY_BYTES = 128;
const MAX_ENV_VALUE_BYTES = 8 * 1024;
const MAX_ENV_BYTES = 64 * 1024;
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

function downloadError(code) {
  return Object.assign(new Error(code), { code, state: "INCOMPLETE", stage: "DOWNLOAD" });
}

function snapshotEnvironment(candidate) {
  if (candidate === null || typeof candidate !== "object" || types.isProxy(candidate)) {
    throw downloadError("seaweed_artifact_download_environment_invalid");
  }
  let prototype;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(candidate);
    descriptors = Object.getOwnPropertyDescriptors(candidate);
  } catch {
    throw downloadError("seaweed_artifact_download_environment_invalid");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw downloadError("seaweed_artifact_download_environment_invalid");
  }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length > MAX_ENV_ENTRIES || keys.some((key) => typeof key !== "string")) {
    throw downloadError("seaweed_artifact_download_environment_invalid");
  }
  let totalBytes = 0;
  const copy = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    const value = descriptor?.value;
    const keyBytes = Buffer.byteLength(key, "utf8");
    if (!("value" in descriptor) || typeof value !== "string" || !ENV_KEY.test(key)
      || key.includes("\0") || value.includes("\0") || keyBytes > MAX_ENV_KEY_BYTES) {
      throw downloadError("seaweed_artifact_download_environment_invalid");
    }
    const valueBytes = Buffer.byteLength(value, "utf8");
    totalBytes += keyBytes + valueBytes;
    if (valueBytes > MAX_ENV_VALUE_BYTES || totalBytes > MAX_ENV_BYTES) {
      throw downloadError("seaweed_artifact_download_environment_invalid");
    }
    Object.defineProperty(copy, key, { value, enumerable: true, writable: false, configurable: false });
  }
  return Object.freeze(copy);
}

function snapshot(input, allowInjection) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw downloadError("seaweed_artifact_download_options_invalid");
  const properties = Object.getOwnPropertyDescriptors(input);
  const allowed = new Set(["artifact", "handle", "signal", "timeoutMs", "env",
    ...(allowInjection ? ["spawn", "now", "executable", "cleanupTimeoutMs"] : [])]);
  if (Reflect.ownKeys(properties).some((key) => !allowed.has(key) || !("value" in properties[key]))) {
    throw downloadError("seaweed_artifact_download_options_invalid");
  }
  const value = (key) => properties[key]?.value;
  const artifact = value("artifact");
  if (artifact === null || typeof artifact !== "object" || Array.isArray(artifact)) throw downloadError("seaweed_artifact_download_descriptor_invalid");
  const fields = Object.getOwnPropertyDescriptors(artifact);
  const field = (key) => Object.hasOwn(fields, key) && "value" in fields[key] ? fields[key].value : undefined;
  const id = field("id");
  const size = field("size");
  const digest = field("digest");
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(size) || size <= 0
    || size > MAX_ZIP_BYTES || !SHA256.test(digest ?? "")) throw downloadError("seaweed_artifact_download_descriptor_invalid");
  const handle = value("handle");
  if (handle === null || typeof handle !== "object" || typeof handle.write !== "function") {
    throw downloadError("seaweed_artifact_download_handle_invalid");
  }
  const signal = value("signal");
  const timeoutMs = value("timeoutMs") ?? MAX_TIMEOUT_MS;
  const cleanupTimeoutMs = value("cleanupTimeoutMs") ?? 5000;
  if (signal !== undefined && !(signal instanceof globalThis.AbortSignal)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS
    || !Number.isSafeInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 1 || cleanupTimeoutMs > 5000) {
    throw downloadError("seaweed_artifact_download_options_invalid");
  }
  const spawn = value("spawn") ?? nodeSpawn;
  const now = value("now") ?? Date.now;
  const executable = value("executable") ?? GH_EXECUTABLE;
  if (typeof spawn !== "function" || typeof now !== "function" || typeof executable !== "string" || executable.length < 1
    || (!allowInjection && GH_EXECUTABLE === undefined)) throw downloadError("seaweed_artifact_download_options_invalid");
  const env = value("env");
  return Object.freeze({ artifact: Object.freeze({ id, size, digest }), handle, signal, timeoutMs, cleanupTimeoutMs, spawn, now, executable,
    ...(env === undefined ? {} : { env: snapshotEnvironment(env) }) });
}

async function stream(options) {
  const { artifact, handle, signal, timeoutMs, cleanupTimeoutMs, spawn, now, executable, env } = options;
  if (signal?.aborted) throw downloadError("seaweed_artifact_download_aborted");
  const deadline = now() + timeoutMs;
  const endpoint = `repos/${REPOSITORY}/actions/artifacts/${artifact.id}/zip`;
  const args = ["api", "--method", "GET", "--hostname", "github.com",
    "--header", "Accept: application/vnd.github+json",
    "--header", "X-GitHub-Api-Version: 2022-11-28", endpoint];
  let child;
  try {
    child = spawn(executable, args, { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"],
      ...(env === undefined ? {} : { env }) });
  } catch {
    throw downloadError("seaweed_artifact_download_command_failed");
  }
  let spawnFailed = false;
  let stderrFailed = false;
  let timedOut = false;
  let aborted = false;
  let closed = false;
  const close = new Promise((resolve) => {
    child.once("error", () => { spawnFailed = true; });
    child.once("close", (code) => { closed = true; resolve(code); });
  });
  const stop = () => {
    if (!closed) {
      try { child.kill("SIGKILL"); } catch { /* the close event still determines completion */ }
    }
    child.stdout?.destroy();
    child.stderr?.destroy();
  };
  let rejectInterrupted;
  const interrupted = new Promise((_resolve, reject) => { rejectInterrupted = reject; });
  const onAbort = () => { aborted = true; stop(); rejectInterrupted(downloadError("seaweed_artifact_download_aborted")); };
  const timer = setTimeout(() => {
    timedOut = true; stop(); rejectInterrupted(downloadError("seaweed_artifact_download_timeout"));
  }, timeoutMs);
  signal?.addEventListener("abort", onAbort, { once: true });
  child.stderr?.on("error", () => { stderrFailed = true; stop(); });
  child.stderr?.resume();
  const hash = createHash("sha256");
  let bytes = 0;
  let failure;
  const transfer = async () => {
    if (child.stdout === null || child.stdout === undefined) throw downloadError("seaweed_artifact_download_command_failed");
    for await (const chunk of child.stdout) {
      if (aborted || signal?.aborted) throw downloadError("seaweed_artifact_download_aborted");
      if (timedOut || now() >= deadline) throw downloadError("seaweed_artifact_download_timeout");
      if (!(chunk instanceof Uint8Array) || bytes + chunk.length > artifact.size) {
        throw downloadError("seaweed_artifact_download_size_invalid");
      }
      let written = 0;
      while (written < chunk.length) {
        const result = await handle.write(chunk, written, chunk.length - written, null);
        if (!Number.isSafeInteger(result?.bytesWritten) || result.bytesWritten <= 0
          || result.bytesWritten > chunk.length - written) throw downloadError("seaweed_artifact_download_write_failed");
        written += result.bytesWritten;
      }
      bytes += chunk.length;
      hash.update(chunk);
    }
    const code = await close;
    if (aborted || signal?.aborted) throw downloadError("seaweed_artifact_download_aborted");
    if (timedOut || now() >= deadline) throw downloadError("seaweed_artifact_download_timeout");
    if (spawnFailed || stderrFailed || code !== 0) throw downloadError("seaweed_artifact_download_command_failed");
    if (bytes !== artifact.size) throw downloadError("seaweed_artifact_download_size_invalid");
    if (`sha256:${hash.digest("hex")}` !== artifact.digest) throw downloadError("seaweed_artifact_download_digest_invalid");
  };
  try {
    await Promise.race([transfer(), interrupted]);
  } catch (error) {
    failure = error?.code?.startsWith("seaweed_artifact_download_") ? error
      : downloadError("seaweed_artifact_download_stream_failed");
    stop();
  } finally {
    signal?.removeEventListener("abort", onAbort);
    globalThis.clearTimeout(timer);
    let cleanupTimer;
    try {
      await Promise.race([close, new Promise((_resolve, reject) => {
        cleanupTimer = setTimeout(() => reject(downloadError("seaweed_artifact_download_cleanup_uncertain")), cleanupTimeoutMs);
      })]);
    } finally { globalThis.clearTimeout(cleanupTimer); }
  }
  if (failure !== undefined) throw failure;
  return Object.freeze({ id: artifact.id, size: bytes, digest: artifact.digest,
    authority: "CALLER_DESCRIPTOR_ONLY", candidateAuthorization: "NOT_AUTHORIZED" });
}

export async function streamGitHubArtifactZip(options) {
  return stream(snapshot(options, false));
}

export async function TEST_ONLY_streamGitHubArtifactZip(options) {
  return stream(snapshot(options, true));
}
