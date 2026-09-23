import { spawn as nodeSpawn } from "node:child_process";
import { createHash } from "node:crypto";

const GH_EXECUTABLE = process.platform === "win32" ? "C:\\Program Files\\GitHub CLI\\gh.exe"
  : process.platform === "linux" ? "/usr/bin/gh" : undefined;
const REPOSITORY = "CleMeY15/auto-world";
const MAX_ZIP_BYTES = 2 * 1024 ** 3;
const MAX_TIMEOUT_MS = 60 * 60_000;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;

function downloadError(code) {
  return Object.assign(new Error(code), { code, state: "INCOMPLETE", stage: "DOWNLOAD" });
}

function snapshot(input, allowInjection) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw downloadError("seaweed_artifact_download_options_invalid");
  const properties = Object.getOwnPropertyDescriptors(input);
  const allowed = new Set(["artifact", "handle", "signal", "timeoutMs", ...(allowInjection ? ["spawn", "now", "executable"] : [])]);
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
  if (signal !== undefined && !(signal instanceof globalThis.AbortSignal)
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw downloadError("seaweed_artifact_download_options_invalid");
  }
  const spawn = value("spawn") ?? nodeSpawn;
  const now = value("now") ?? Date.now;
  const executable = value("executable") ?? GH_EXECUTABLE;
  if (typeof spawn !== "function" || typeof now !== "function" || typeof executable !== "string" || executable.length < 1
    || (!allowInjection && GH_EXECUTABLE === undefined)) throw downloadError("seaweed_artifact_download_options_invalid");
  return Object.freeze({ artifact: Object.freeze({ id, size, digest }), handle, signal, timeoutMs, spawn, now, executable });
}

async function stream(options) {
  const { artifact, handle, signal, timeoutMs, spawn, now, executable } = options;
  if (signal?.aborted) throw downloadError("seaweed_artifact_download_aborted");
  const deadline = now() + timeoutMs;
  const endpoint = `repos/${REPOSITORY}/actions/artifacts/${artifact.id}/zip`;
  const args = ["api", "--method", "GET", "--hostname", "github.com",
    "--header", "Accept: application/vnd.github+json",
    "--header", "X-GitHub-Api-Version: 2022-11-28", endpoint];
  let child;
  try {
    child = spawn(executable, args, { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
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
  };
  const onAbort = () => { aborted = true; stop(); };
  const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
  signal?.addEventListener("abort", onAbort, { once: true });
  child.stderr?.on("error", () => { stderrFailed = true; stop(); });
  child.stderr?.resume();
  const hash = createHash("sha256");
  let bytes = 0;
  let failure;
  try {
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
  } catch (error) {
    failure = error?.code?.startsWith("seaweed_artifact_download_") ? error
      : downloadError("seaweed_artifact_download_stream_failed");
    stop();
  } finally {
    signal?.removeEventListener("abort", onAbort);
    globalThis.clearTimeout(timer);
    await close;
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
