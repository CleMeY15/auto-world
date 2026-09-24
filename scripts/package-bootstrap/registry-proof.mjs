import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { BOOTSTRAP, assertPayloadIntegrity, parseBuildKitVersions, sha256, validateImageMetadata } from "./prepare.mjs";

const MiB = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 120_000;
const JOB_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT = MiB;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export const REGISTRY_PROOF = Object.freeze({
  image: "ghcr.io/clemey15/auto-world-infra-proof",
  owner: "CleMeY15",
  outputDirectory: "package-registry-proof",
  mainRefUrl: "https://api.github.com/repos/CleMeY15/auto-world/git/ref/heads/main",
});

function fixedReason(error) {
  const message = error instanceof Error ? error.message : "package_registry_unknown_failure";
  return /^package_registry_[a-z0-9_]+$/u.test(message) ? message : "package_registry_command_failed";
}

export function parseRegistryArguments(argv) {
  if (argv[0] === "publish" && argv.length === 3 && argv[1] === "--output" && path.isAbsolute(argv[2])) {
    return { mode: "publish", output: path.resolve(argv[2]) };
  }
  if (argv[0] === "verify" && argv.length === 5 && argv[1] === "--digest" && DIGEST_PATTERN.test(argv[2]) && argv[3] === "--output" && path.isAbsolute(argv[4])) {
    return { mode: "verify", digest: argv[2], output: path.resolve(argv[4]) };
  }
  throw new Error("package_registry_arguments_invalid");
}

export function validateRegistryContext(env, mode, platform = process.platform) {
  if (platform !== "linux" || env.GITHUB_ACTIONS !== "true" || env.RUNNER_OS !== "Linux") throw new Error("package_registry_requires_linux_actions");
  if (env.GITHUB_REPOSITORY !== BOOTSTRAP.repository || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/main") {
    throw new Error("package_registry_context_invalid");
  }
  if (env.GITHUB_RUN_ATTEMPT !== "1" || !/^\d+$/u.test(env.GITHUB_RUN_ID ?? "") || !/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? "")) {
    throw new Error("package_registry_identity_invalid");
  }
  if (!path.isAbsolute(env.RUNNER_TEMP ?? "") || typeof env.GITHUB_TOKEN !== "string" || env.GITHUB_TOKEN.length < 1) {
    throw new Error("package_registry_environment_invalid");
  }
  if (!path.isAbsolute(env.GITHUB_WORKSPACE ?? "") || !existsSync(env.GITHUB_WORKSPACE)) throw new Error("package_registry_workspace_invalid");
  const workspace = path.resolve(env.GITHUB_WORKSPACE);
  const workspaceInfo = lstatSync(workspace);
  if (!workspaceInfo.isDirectory() || workspaceInfo.isSymbolicLink() || realpathSync(workspace) !== workspace) throw new Error("package_registry_workspace_invalid");
  if (mode === "publish" && env.GITHUB_JOB !== "publish") throw new Error("package_registry_job_invalid");
  if (mode === "verify" && env.GITHUB_JOB !== "verify") throw new Error("package_registry_job_invalid");
  return {
    eventName: env.GITHUB_EVENT_NAME,
    ref: env.GITHUB_REF,
    repository: env.GITHUB_REPOSITORY,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    runId: env.GITHUB_RUN_ID,
    runnerTemp: path.resolve(env.RUNNER_TEMP),
    sourceSha: env.GITHUB_SHA,
    token: env.GITHUB_TOKEN,
    workspace,
  };
}

function validateOwnedPaths(output, context, env) {
  const root = context.runnerTemp;
  if (!existsSync(root) || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink() || realpathSync(root) !== root) {
    throw new Error("package_registry_runner_temp_invalid");
  }
  if (path.basename(output) !== REGISTRY_PROOF.outputDirectory || path.dirname(output) !== root || existsSync(output)) {
    throw new Error("package_registry_output_path_invalid");
  }
  const githubOutput = path.resolve(env.GITHUB_OUTPUT ?? "");
  const relative = path.relative(root, githubOutput);
  if (!path.isAbsolute(env.GITHUB_OUTPUT ?? "") || relative.startsWith("..") || path.isAbsolute(relative) || !existsSync(githubOutput)) {
    throw new Error("package_registry_github_output_invalid");
  }
  const info = lstatSync(githubOutput);
  if (!info.isFile() || info.isSymbolicLink() || realpathSync(githubOutput) !== githubOutput) throw new Error("package_registry_github_output_invalid");
  return githubOutput;
}

function commandEnvironment(env, dockerConfig, temporaryDirectory) {
  const clean = { BUILDX_CONFIG: path.join(dockerConfig, "buildx"), DOCKER_CONFIG: dockerConfig, LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TMPDIR: temporaryDirectory, TZ: "UTC" };
  for (const name of ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "XDG_CONFIG_HOME"]) {
    if (typeof env[name] === "string") clean[name] = env[name];
  }
  return clean;
}

function defaultCommandRunner(command, args, options) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env,
    input: options.input,
    maxBuffer: MAX_OUTPUT,
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true,
  });
}

function observeCommand(commandRunner, command, args, options) {
  const result = commandRunner(command, args, options);
  const stdout = typeof result?.stdout === "string" ? result.stdout : "";
  const stderr = typeof result?.stderr === "string" ? result.stderr : "";
  if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > MAX_OUTPUT) throw new Error("package_registry_command_output_exceeded");
  return { error: result?.error, status: result?.status, stdout, stderr };
}

function run(commandRunner, command, args, options, expectedStatuses = [0]) {
  const result = observeCommand(commandRunner, command, args, options);
  if (result.error || !expectedStatuses.includes(result.status)) throw new Error("package_registry_command_failed");
  return result;
}

function boundedVersion(value) {
  const version = value.trim();
  if (version.length < 1 || version.length > 512 || /[^\x20-\x7e]/u.test(version)) throw new Error("package_registry_tool_identity_invalid");
  return version;
}

function validateDigest(value) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) throw new Error("package_registry_manifest_digest_invalid");
  return value;
}

export function parsePublishedDigest(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("package_registry_manifest_metadata_invalid");
  if ("containerimage.config.digest" in metadata) validateDigest(metadata["containerimage.config.digest"]);
  return validateDigest(metadata["containerimage.digest"]);
}

export function classifyAnonymousRemoteRead(result) {
  const stdout = typeof result?.stdout === "string" ? result.stdout : "";
  const stderr = typeof result?.stderr === "string" ? result.stderr : "";
  const combined = `${stdout}\n${stderr}`.toLowerCase();
  if (Buffer.byteLength(combined) > MAX_OUTPUT) throw new Error("package_registry_anonymous_remote_read_error");
  if (result?.status === 0) throw new Error("package_registry_anonymous_remote_read_succeeded");
  if (result?.error || result?.status !== 1 || /(dial tcp|no such host|network|timed? out|timeout|tls|certificate|connection refused|connection reset|temporary failure)/u.test(combined)) {
    throw new Error("package_registry_anonymous_remote_read_error");
  }
  if (/(unauthorized|authentication required|requested access.*denied|denied:\s*(?:denied|.*permission))/u.test(combined)) return "AUTHORIZATION_DENIED";
  throw new Error("package_registry_anonymous_remote_read_error");
}

export function validateRemoteManifest(raw, digest) {
  if (typeof raw !== "string") throw new Error("package_registry_remote_manifest_invalid");
  const bytes = Buffer.from(raw, "utf8");
  if (bytes.length < 1 || bytes.length > MAX_OUTPUT || `sha256:${sha256(bytes)}` !== digest) {
    throw new Error("package_registry_remote_manifest_invalid");
  }
  return { sha256: digest, size: bytes.length };
}

async function verifyMainRef(fetchImpl, context) {
  const controller = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), 15_000);
  let response;
  try {
    response = await fetchImpl(REGISTRY_PROOF.mainRefUrl, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${context.token}`, "User-Agent": "auto-world-package-registry-proof" },
      redirect: "error",
      signal: controller.signal,
    });
  } catch {
    globalThis.clearTimeout(timer);
    throw new Error("package_registry_main_ref_request_failed");
  }
  try {
    if (!response?.ok) throw new Error("package_registry_main_ref_request_failed");
    const contentLength = response.headers?.get?.("content-length");
    if (contentLength !== null && contentLength !== undefined && (!/^\d+$/u.test(contentLength) || Number(contentLength) > MAX_OUTPUT)) {
      throw new Error("package_registry_main_ref_response_invalid");
    }
    const chunks = [];
    let bytes = 0;
    if (!response.body?.getReader) throw new Error("package_registry_main_ref_response_invalid");
    const reader = response.body.getReader();
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      const chunk = Buffer.from(item.value);
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT) {
        await reader.cancel();
        throw new Error("package_registry_main_ref_response_invalid");
      }
      chunks.push(chunk);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new Error("package_registry_main_ref_response_invalid"); }
    if (body?.object?.type !== "commit" || body?.object?.sha !== context.sourceSha) throw new Error("package_registry_main_ref_mismatch");
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function validateInspection(raw, subject, digest) {
  let metadata;
  try { metadata = JSON.parse(raw); } catch { throw new Error("package_registry_image_metadata_invalid"); }
  const validated = validateImageMetadata(metadata);
  if (!Array.isArray(metadata.RepoDigests) || !metadata.RepoDigests.includes(subject)) throw new Error("package_registry_repo_digest_invalid");
  if (validated.localImageIdentity.value === digest) throw new Error("package_registry_identity_type_confusion");
  return { ...validated, repoDigest: subject };
}

function inspectAbsent(result, type) {
  if (result.status === 0) return false;
  const pattern = type === "image" ? /no such (?:image|object)/iu : /no such container/iu;
  if (result.status === 1 && pattern.test(`${result.stdout}\n${result.stderr}`)) return true;
  throw new Error("package_registry_local_inspect_failed");
}

function receiptBytes(receipt) {
  const bytes = Buffer.byteLength(`${JSON.stringify(receipt, null, 2)}\n`);
  if (bytes > MAX_OUTPUT) throw new Error("package_registry_receipt_too_large");
  return bytes;
}

export async function runRegistryProof({
  argv = process.argv.slice(2),
  commandRunner = defaultCommandRunner,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  platform = process.platform,
} = {}) {
  const started = now();
  const parsed = parseRegistryArguments(argv);
  const context = validateRegistryContext(env, parsed.mode, platform);
  const githubOutput = validateOwnedPaths(parsed.output, context, env);
  const work = path.join(context.runnerTemp, `aw-package-registry-${parsed.mode}-${context.runId}-attempt-1`);
  if (existsSync(work)) throw new Error("package_registry_owned_path_exists");
  mkdirSync(parsed.output, { mode: 0o700 });
  mkdirSync(work, { mode: 0o700 });
  const authConfig = path.join(work, "docker-auth");
  const anonymousConfig = path.join(work, "docker-anonymous");
  mkdirSync(authConfig, { mode: 0o700 });
  mkdirSync(anonymousConfig, { mode: 0o700 });
  mkdirSync(path.join(authConfig, "buildx"), { mode: 0o700 });
  mkdirSync(path.join(anonymousConfig, "buildx"), { mode: 0o700 });
  const tag = `${REGISTRY_PROOF.image}:proof-${context.runId}`;
  const digest = parsed.digest;
  const subject = digest ? `${REGISTRY_PROOF.image}@${digest}` : undefined;
  const container = `aw-package-registry-proof-${context.runId}`;
  const receipt = {
    schemaVersion: 1,
    state: parsed.mode === "publish" ? "PREPARING" : "VERIFYING_PRIVATE_READ",
    result: "FAILED",
    publication: "NOT_ATTEMPTED",
    packageConfiguration: "NOT_VERIFIED",
    forkAccessTest: "SKIPPED_BY_USER",
    forkIsolation: "NOT_VERIFIED",
    repository: context.repository,
    image: REGISTRY_PROOF.image,
    sourceSha: context.sourceSha,
    sourceRef: context.ref,
    runId: context.runId,
    runAttempt: context.runAttempt,
    payload: { sha256: sha256(Buffer.from(BOOTSTRAP.payload)), size: Buffer.byteLength(BOOTSTRAP.payload) },
    recipe: { sha256: sha256(Buffer.from(BOOTSTRAP.dockerfile)), size: Buffer.byteLength(BOOTSTRAP.dockerfile) },
    phases: [],
  };
  const ensureBudget = () => { if (now() - started > JOB_TIMEOUT_MS) throw new Error("package_registry_job_timeout"); };
  const phase = async (name, operation) => {
    ensureBudget();
    const phaseStarted = now();
    try {
      const value = await operation();
      receipt.phases.push({ name, result: "PASSED", durationMs: now() - phaseStarted });
      return value;
    } catch (error) {
      receipt.phases.push({ name, result: "FAILED", reason: fixedReason(error), durationMs: now() - phaseStarted });
      throw error;
    }
  };
  const authOptions = { cwd: work, env: commandEnvironment(env, authConfig, work) };
  const anonymousOptions = { cwd: work, env: commandEnvironment(env, anonymousConfig, work) };
  const gitOptions = { ...authOptions, cwd: context.workspace };
  let ownedContainer = false;
  let ownedImage = false;
  let primaryFailure;
  try {
    receipt.tools = await phase("managed_tool_identity", () => {
      const docker = boundedVersion(run(commandRunner, "docker", ["version", "--format", "{{.Client.Version}}|{{.Server.Version}}"], authOptions).stdout);
      const buildx = boundedVersion(run(commandRunner, "docker", ["buildx", "version"], authOptions).stdout);
      const buildKitBackendVersions = parseBuildKitVersions(run(commandRunner, "docker", ["buildx", "inspect"], authOptions).stdout);
      return { docker, buildx, buildKitBackendVersions, trustBoundary: "MANAGED_DOCKER_BUILDKIT" };
    });
    await phase("checkout_identity", () => {
      const head = run(commandRunner, "git", ["rev-parse", "HEAD"], gitOptions).stdout.trim();
      if (head !== context.sourceSha) throw new Error("package_registry_checkout_mismatch");
    });
    if (parsed.mode === "publish") {
      await phase("source_main_verification", async () => {
        await verifyMainRef(fetchImpl, context);
      });
    }
    await phase("authorized_registry_login", () => {
      run(commandRunner, "docker", ["login", "ghcr.io", "--username", REGISTRY_PROOF.owner, "--password-stdin"], { ...authOptions, input: `${context.token}\n` });
    });
    if (parsed.mode === "publish") {
      const buildContext = path.join(work, "context");
      const dockerfile = path.join(work, "Dockerfile");
      const metadataFile = path.join(work, "metadata.json");
      await phase("context_materialization", () => {
        mkdirSync(buildContext);
        writeFileSync(path.join(buildContext, "proof.txt"), BOOTSTRAP.payload, { flag: "wx" });
        writeFileSync(dockerfile, BOOTSTRAP.dockerfile, { flag: "wx" });
      });
      const publishedDigest = await phase("private_image_publish", () => {
        receipt.publication = "ATTEMPTED_OUTCOME_UNCONFIRMED";
        run(commandRunner, "docker", ["buildx", "build", "--platform", BOOTSTRAP.platform, "--network=none", "--provenance=false", "--sbom=false", "--push", "--metadata-file", metadataFile, "--tag", tag, "--file", dockerfile, buildContext], authOptions);
        if (!existsSync(metadataFile)) throw new Error("package_registry_manifest_metadata_invalid");
        const metadataInfo = lstatSync(metadataFile);
        if (!metadataInfo.isFile() || metadataInfo.isSymbolicLink() || metadataInfo.size > MAX_OUTPUT) throw new Error("package_registry_manifest_metadata_invalid");
        let metadata;
        try { metadata = JSON.parse(readFileSync(metadataFile, "utf8")); } catch { throw new Error("package_registry_manifest_metadata_invalid"); }
        return parsePublishedDigest(metadata);
      });
      receipt.manifestDigest = publishedDigest;
      receipt.subject = `${REGISTRY_PROOF.image}@${publishedDigest}`;
      receipt.state = "PUBLISHED_UNADMITTED";
      receipt.publication = "PUBLISHED_UNADMITTED";
      receipt.result = "PASSED";
    } else {
      receipt.manifestDigest = digest;
      receipt.subject = subject;
      receipt.remoteManifestBefore = await phase("remote_manifest_before", () => {
        const remote = run(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", subject], authOptions);
        return validateRemoteManifest(remote.stdout, digest);
      });
      await phase("anonymous_manifest_denied", () => {
        const remote = observeCommand(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", subject], anonymousOptions);
        return classifyAnonymousRemoteRead(remote);
      });
      receipt.remoteManifestAfter = await phase("remote_manifest_after", () => {
        const remote = run(commandRunner, "docker", ["buildx", "imagetools", "inspect", "--raw", subject], authOptions);
        return validateRemoteManifest(remote.stdout, digest);
      });
      const existing = await phase("local_collision_check", () => !inspectAbsent(run(commandRunner, "docker", ["image", "inspect", subject], authOptions, [0, 1]), "image"));
      await phase("authorized_image_pull", () => run(commandRunner, "docker", ["pull", "--platform", BOOTSTRAP.platform, subject], authOptions));
      ownedImage = !existing;
      receipt.image = await phase("exact_image_inspection", () => validateInspection(run(commandRunner, "docker", ["image", "inspect", "--format", "{{json .}}", subject], authOptions).stdout, subject, digest));
      await phase("stopped_container_create", () => {
        const collision = run(commandRunner, "docker", ["container", "inspect", container], authOptions, [0, 1]);
        if (!inspectAbsent(collision, "container")) throw new Error("package_registry_container_collision");
        run(commandRunner, "docker", ["create", "--name", container, "--pull=never", subject, "/proof.txt"], authOptions);
        ownedContainer = true;
      });
      receipt.copiedPayload = await phase("stopped_container_copy", () => {
        const copied = path.join(work, "copied-proof.txt");
        run(commandRunner, "docker", ["cp", `${container}:/proof.txt`, copied], authOptions);
        const info = lstatSync(copied);
        if (!info.isFile() || info.isSymbolicLink() || info.size > BOOTSTRAP.payloadSizeLimit) throw new Error("package_registry_payload_integrity_failed");
        try { return assertPayloadIntegrity(readFileSync(copied), Buffer.from(BOOTSTRAP.payload)); } catch { throw new Error("package_registry_payload_integrity_failed"); }
      });
      receipt.anonymousManifestDenied = "PASSED";
      receipt.authorizedImagePull = "PASSED";
      receipt.state = "PRIVATE_READ_PROOF";
      receipt.result = "PASSED";
    }
  } catch (error) {
    primaryFailure = error;
  }

  const cleanupStarted = now();
  const cleanupFailures = [];
  if (ownedContainer) {
    try { run(commandRunner, "docker", ["rm", container], authOptions); } catch (error) { cleanupFailures.push(fixedReason(error)); }
  }
  if (ownedImage) {
    try { run(commandRunner, "docker", ["image", "rm", subject], authOptions); } catch (error) { cleanupFailures.push(fixedReason(error)); }
  }
  try {
    if (!existsSync(work) || lstatSync(work).isSymbolicLink() || realpathSync(work) !== work || path.dirname(work) !== context.runnerTemp || path.isAbsolute(path.relative(context.runnerTemp, work)) || path.relative(context.runnerTemp, work).startsWith("..")) {
      throw new Error("package_registry_cleanup_path_invalid");
    }
    rmSync(work, { recursive: true, force: false });
  } catch (error) { cleanupFailures.push(fixedReason(error)); }
  receipt.phases.push({ name: "cleanup", result: cleanupFailures.length === 0 ? "PASSED" : "FAILED", ...(cleanupFailures.length ? { reason: cleanupFailures[0] } : {}), durationMs: now() - cleanupStarted });
  if (cleanupFailures.length) receipt.result = "FAILED";
  if (!primaryFailure && !cleanupFailures.length && parsed.mode === "publish") {
    try {
      await phase("github_output", () => writeFileSync(githubOutput, `digest=${receipt.manifestDigest}\n`, { flag: "a" }));
    } catch (error) {
      primaryFailure = error;
      receipt.result = "FAILED";
    }
  }
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  receiptBytes(receipt);
  writeFileSync(path.join(parsed.output, "receipt.json"), serialized, { flag: "wx" });
  if (primaryFailure) throw new Error(fixedReason(primaryFailure));
  if (cleanupFailures.length) throw new Error(cleanupFailures[0]);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try { await runRegistryProof(); } catch (error) {
    console.error(`package_registry_failed:${fixedReason(error)}`);
    process.exitCode = 1;
  }
}
