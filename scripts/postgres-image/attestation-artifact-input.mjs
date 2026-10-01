import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync,
  realpathSync, readdirSync, writeSync } from "node:fs";
import { mkdir, open, realpath, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { streamGitHubArtifactZip } from "../seaweed-image/download-artifact-zip.mjs";
import { githubArtifactZipProfiles, scanOwnedGitHubArtifactZip } from "../seaweed-image/read-artifact-zip.mjs";
import { authenticatePostgresRemoteRuntimeSource,
  verifyPostgresRuntimeAuditApi } from "./candidate-remote-runtime-diagnostic.mjs";

const REPOSITORY = "CleMeY15/auto-world";
const WORKFLOW = ".github/workflows/postgres-candidate-attest.yml";
const WORKFLOW_REF = `${REPOSITORY}/${WORKFLOW}@refs/heads/main`;
const MAX_ARTIFACT_BYTES = 8 * 1024 ** 2;
const MAX_API_BYTES = 512 * 1024;
const SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;

export const POSTGRES_ATTESTATION_ARTIFACTS = Object.freeze({
  access: Object.freeze({ name: "postgres-candidate-attestation-access",
    profile: githubArtifactZipProfiles.postgresAttestationAccess,
    output: "postgres-candidate-attestation-access-input", job: "signer",
    idEnv: "POSTGRES_ATTESTATION_ACCESS_ARTIFACT_ID" }),
  audit: Object.freeze({ name: "postgres-candidate-remote-audit",
    profile: githubArtifactZipProfiles.postgresAttestationAudit,
    output: "postgres-candidate-attestation-audit-input", job: "signer", idEnv: null }),
  signed: Object.freeze({ name: "postgres-candidate-attestation-signed",
    profile: githubArtifactZipProfiles.postgresAttestationSigned,
    output: "postgres-candidate-attestation-input", job: "verifier",
    idEnv: "POSTGRES_ATTESTATION_SIGNED_ARTIFACT_ID" }),
});

const EXPECTED_PATHS = Object.freeze({
  access: Object.freeze(["access-receipt.json"]),
  audit: Object.freeze(["audit-receipt.json", "candidate-sbom.cdx.json", "candidate-vulnerabilities.json",
    "database-evidence.json", "database-java-after-manifest.json", "database-java-before-manifest.json",
    "database-vulnerability-after-manifest.json", "database-vulnerability-before-manifest.json",
    "fixture-gomod-vulnerable-baseline.json", "fixture-gomod-vulnerable-candidate.json",
    "fixture-java-jar-clean-candidate-candidate.json", "fixture-java-war-vulnerable-baseline.json",
    "fixture-java-war-vulnerable-candidate.json", "scanner-self.cdx.json", "scanner-self.json",
    "scanner-version-probe.json"]),
  signed: Object.freeze(["bundle.json", "pre-sign-receipt.json", "predicate.json"]),
});

function fail(code = "postgres_attestation_artifact_input_invalid") { throw new Error(code); }
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function apiJson(response) {
  if (response?.status !== 200 || !response.body) fail("postgres_attestation_artifact_api_invalid");
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!(value instanceof Uint8Array) || (size += value.byteLength) > MAX_API_BYTES) {
      await reader.cancel(); fail("postgres_attestation_artifact_api_invalid");
    }
    chunks.push(Buffer.from(value));
  }
  try { return JSON.parse(Buffer.concat(chunks, size).toString("utf8")); }
  catch { fail("postgres_attestation_artifact_api_invalid"); }
}

export async function verifyCurrentRunArtifactApi(mode, artifactId, env, {
  fetchImpl = globalThis.fetch, now = () => new Date(), timeoutMs = 60_000,
} = {}) {
  const contract = POSTGRES_ATTESTATION_ARTIFACTS[mode];
  const token = env.GITHUB_TOKEN; const at = now();
  if (!contract || mode === "audit" || !Number.isSafeInteger(artifactId) || artifactId < 1
    || typeof token !== "string" || token.length < 1 || token.length > 8192 || env.GH_TOKEN !== token
    || !(at instanceof Date) || !Number.isFinite(at.getTime()) || typeof fetchImpl !== "function"
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    fail("postgres_attestation_artifact_api_invalid");
  }
  const controller = new globalThis.AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  const get = async (endpoint) => apiJson(await fetchImpl(`https://api.github.com/repos/${REPOSITORY}/${endpoint}`, {
    redirect: "error", signal: controller.signal, headers: { Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`, "User-Agent": "auto-world-postgres-attestation",
      "X-GitHub-Api-Version": "2022-11-28" },
  }));
  try {
    const run = await get(`actions/runs/${env.GITHUB_RUN_ID}`);
    const artifact = await get(`actions/artifacts/${artifactId}`);
    const expiresAt = Date.parse(artifact?.expires_at ?? "");
    if (run?.id !== Number(env.GITHUB_RUN_ID) || run.run_number !== 1 || run.run_attempt !== 1
      || run.path !== WORKFLOW || run.event !== "workflow_dispatch" || run.status !== "in_progress"
      || run.conclusion !== null || run.head_branch !== "main" || run.head_sha !== env.GITHUB_SHA
      || run.repository?.full_name !== REPOSITORY || artifact?.id !== artifactId
      || artifact.name !== contract.name || artifact.expired !== false
      || !Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes < 2
      || artifact.size_in_bytes > MAX_ARTIFACT_BYTES || !SHA256.test(artifact.digest ?? "")
      || artifact.url !== `https://api.github.com/repos/${REPOSITORY}/actions/artifacts/${artifactId}`
      || artifact.archive_download_url !== `https://api.github.com/repos/${REPOSITORY}/actions/artifacts/${artifactId}/zip`
      || !Number.isFinite(expiresAt) || expiresAt <= at.getTime()
      || artifact.workflow_run?.id !== Number(env.GITHUB_RUN_ID)
      || artifact.workflow_run?.head_sha !== env.GITHUB_SHA) {
      fail("postgres_attestation_artifact_api_invalid");
    }
    return Object.freeze({ id: artifactId, name: contract.name, size: artifact.size_in_bytes,
      digest: artifact.digest, runId: env.GITHUB_RUN_ID, headSha: env.GITHUB_SHA,
      expiresAt: new Date(expiresAt).toISOString() });
  } catch { fail("postgres_attestation_artifact_api_invalid"); }
  finally { globalThis.clearTimeout(timer); }
}

function requireContext(mode, env) {
  const contract = POSTGRES_ATTESTATION_ARTIFACTS[mode];
  if (!contract || process.platform !== "linux" || env.GITHUB_ACTIONS !== "true"
    || env.RUNNER_ENVIRONMENT !== "github-hosted" || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_JOB !== contract.job || env.GITHUB_REPOSITORY !== REPOSITORY
    || env.GITHUB_REF !== "refs/heads/main" || env.GITHUB_WORKFLOW_REF !== WORKFLOW_REF
    || env.GITHUB_RUN_NUMBER !== "1" || env.GITHUB_RUN_ATTEMPT !== "1"
    || !RUN_ID.test(env.GITHUB_RUN_ID ?? "") || !SHA.test(env.GITHUB_SHA ?? "")
    || typeof env.RUNNER_TEMP !== "string" || !path.isAbsolute(env.RUNNER_TEMP)
    || path.normalize(env.RUNNER_TEMP) !== env.RUNNER_TEMP || typeof env.GITHUB_WORKSPACE !== "string"
    || !path.isAbsolute(env.GITHUB_WORKSPACE) || path.normalize(env.GITHUB_WORKSPACE) !== env.GITHUB_WORKSPACE
    || !env.GITHUB_TOKEN || env.GITHUB_TOKEN !== env.GH_TOKEN || env.GITHUB_TOKEN.length > 8192
    || /\s/u.test(env.GITHUB_TOKEN)) fail("postgres_attestation_artifact_context_invalid");
  const uid = process.getuid();
  try {
    const temp = lstatSync(env.RUNNER_TEMP); const workspace = lstatSync(env.GITHUB_WORKSPACE);
    if (!temp.isDirectory() || temp.isSymbolicLink() || temp.uid !== uid || (temp.mode & 0o022) !== 0
      || realpathSync(env.RUNNER_TEMP) !== env.RUNNER_TEMP || !workspace.isDirectory()
      || workspace.isSymbolicLink() || workspace.uid !== uid || (workspace.mode & 0o022) !== 0
      || realpathSync(env.GITHUB_WORKSPACE) !== env.GITHUB_WORKSPACE) {
      fail("postgres_attestation_artifact_context_invalid");
    }
  } catch { fail("postgres_attestation_artifact_context_invalid"); }
  let artifactId = null;
  if (contract.idEnv !== null) {
    const raw = env[contract.idEnv];
    if (!RUN_ID.test(raw ?? "") || !Number.isSafeInteger(Number(raw))) {
      fail("postgres_attestation_artifact_context_invalid");
    }
    artifactId = Number(raw);
  }
  return Object.freeze({ mode, contract, uid, artifactId, workspace: env.GITHUB_WORKSPACE,
    output: path.join(env.RUNNER_TEMP, contract.output),
    downloadRoot: path.join(env.RUNNER_TEMP, `postgres-candidate-attestation-${mode}-download`) });
}

function secureDirectory(directory, uid) {
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== uid || (info.mode & 0o777) !== 0o700
    || realpathSync(directory) !== directory) fail("postgres_attestation_artifact_output_invalid");
}

function entrySink(output, uid) {
  return (entry) => {
    const file = path.join(output, entry.path); let descriptor;
    try {
      descriptor = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
        | constants.O_NOFOLLOW, 0o600);
      const opened = fstatSync(descriptor);
      if (!opened.isFile() || opened.nlink !== 1 || opened.uid !== uid || (opened.mode & 0o777) !== 0o600) {
        fail("postgres_attestation_artifact_output_invalid");
      }
    } catch { if (descriptor !== undefined) closeSync(descriptor); fail("postgres_attestation_artifact_output_invalid"); }
    return new Writable({
      write(chunk, _encoding, callback) {
        try {
          let offset = 0;
          while (offset < chunk.length) {
            const written = writeSync(descriptor, chunk, offset, chunk.length - offset);
            if (!Number.isSafeInteger(written) || written < 1) fail("postgres_attestation_artifact_output_invalid");
            offset += written;
          }
          callback();
        } catch (error) { callback(error); }
      },
      final(callback) {
        try { fsyncSync(descriptor); closeSync(descriptor); descriptor = undefined; callback(); }
        catch (error) { callback(error); }
      },
      destroy(error, callback) {
        try { if (descriptor !== undefined) closeSync(descriptor); descriptor = undefined; callback(error); }
        catch (closeError) { callback(error ? new AggregateError([error, closeError]) : closeError); }
      },
    });
  };
}

function verifyOutput(context, receipt) {
  const fields = ["dev", "ino", "mode", "nlink", "uid", "gid", "size", "mtimeNs", "ctimeNs"];
  const same = (left, right) => fields.every((field) => left[field] === right[field]);
  let rootDescriptor;
  try {
    secureDirectory(context.output, context.uid);
    const rootNamed = lstatSync(context.output, { bigint: true });
    rootDescriptor = openSync(context.output, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const rootBefore = fstatSync(rootDescriptor, { bigint: true });
    if (!same(rootBefore, rootNamed)
      || !isDeepStrictEqual(readdirSync(context.output).sort(), EXPECTED_PATHS[context.mode])) {
      fail("postgres_attestation_artifact_output_invalid");
    }
    for (const entry of receipt.entries) {
      const file = path.join(context.output, entry.path); let descriptor;
      try {
        const namedBefore = lstatSync(file, { bigint: true });
        descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        const before = fstatSync(descriptor, { bigint: true }); const bytes = readFileSync(descriptor);
        const after = fstatSync(descriptor, { bigint: true }); const namedAfter = lstatSync(file, { bigint: true });
        if (!before.isFile() || before.nlink !== 1n || before.uid !== BigInt(context.uid)
          || (before.mode & 0o777n) !== 0o600n || !same(before, namedBefore) || !same(before, after)
          || !same(before, namedAfter) || BigInt(bytes.length) !== before.size
          || bytes.length !== entry.rawSize || sha256(bytes) !== entry.sha256) {
          fail("postgres_attestation_artifact_output_invalid");
        }
      } finally { if (descriptor !== undefined) closeSync(descriptor); }
    }
    if (!same(rootBefore, fstatSync(rootDescriptor, { bigint: true }))
      || !same(rootBefore, lstatSync(context.output, { bigint: true }))
      || !isDeepStrictEqual(readdirSync(context.output).sort(), EXPECTED_PATHS[context.mode])) {
      fail("postgres_attestation_artifact_output_invalid");
    }
  } catch { fail("postgres_attestation_artifact_output_invalid"); }
  finally { if (rootDescriptor !== undefined) closeSync(rootDescriptor); }
}

async function auditDescriptor(context, env, dependencies) {
  const source = (dependencies.authenticateRuntimeSource ?? authenticatePostgresRemoteRuntimeSource)(
    { workspace: context.workspace, uid: context.uid }, dependencies.runtimeSourceDependencies);
  await (dependencies.verifyAuditApi ?? verifyPostgresRuntimeAuditApi)(source.runtimePolicy, env,
    dependencies.auditApiDependencies);
  const artifact = source.runtimePolicy.audit.artifact;
  if (artifact.name !== context.contract.name || artifact.size > MAX_ARTIFACT_BYTES) {
    fail("postgres_attestation_artifact_api_invalid");
  }
  return Object.freeze({ id: artifact.id, name: artifact.name, size: artifact.size,
    digest: `sha256:${artifact.sha256}`, runId: source.runtimePolicy.audit.runId,
    headSha: source.runtimePolicy.audit.recipeRevision });
}

async function cleanDownload(context, zip) {
  await unlink(zip).catch((error) => { if (error?.code !== "ENOENT") throw error; });
  await rmdir(context.downloadRoot).catch((error) => { if (error?.code !== "ENOENT") throw error; });
}

export async function preparePostgresAttestationArtifactInput(mode, env = process.env, dependencies = {}) {
  const context = (dependencies.requireContext ?? requireContext)(mode, env);
  const descriptor = mode === "audit" ? await auditDescriptor(context, env, dependencies)
    : await (dependencies.verifyCurrentArtifact ?? verifyCurrentRunArtifactApi)(mode, context.artifactId, env,
      dependencies.currentApiDependencies);
  let zipHandle; const zip = path.join(context.downloadRoot, "artifact.zip");
  try {
    await mkdir(context.downloadRoot, { mode: 0o700 }); secureDirectory(context.downloadRoot, context.uid);
    if (await realpath(context.downloadRoot) !== context.downloadRoot) fail("postgres_attestation_artifact_output_invalid");
    zipHandle = await open(zip, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      | constants.O_NOFOLLOW, 0o600);
    await (dependencies.download ?? streamGitHubArtifactZip)({ artifact: descriptor, handle: zipHandle });
    await zipHandle.sync(); const written = await zipHandle.stat(); await zipHandle.close(); zipHandle = undefined;
    if (!written.isFile() || written.nlink !== 1 || written.uid !== context.uid
      || (written.mode & 0o777) !== 0o600 || Number(written.size) !== descriptor.size) {
      fail("postgres_attestation_artifact_download_invalid");
    }
    await mkdir(context.output, { mode: 0o700 }); secureDirectory(context.output, context.uid);
    const receipt = await (dependencies.scan ?? scanOwnedGitHubArtifactZip)({ file: zip,
      root: context.downloadRoot, descriptor, profile: context.contract.profile,
      openEntrySink: entrySink(context.output, context.uid) });
    verifyOutput(context, receipt);
    await cleanDownload(context, zip);
    return Object.freeze({ kind: "POSTGRES_ATTESTATION_ARTIFACT_INPUT_V1", state: "COMPLETE",
      mode, artifact: descriptor, output: context.output, scan: receipt,
      candidateAuthorization: "NOT_AUTHORIZED", admission: "NOT_AUTHORIZED" });
  } catch (error) {
    try { await zipHandle?.close(); } catch { /* original failure remains authoritative */ }
    try { await cleanDownload(context, zip); } catch { /* retained private partial output is fail closed */ }
    if (/^(?:postgres_attestation|seaweed_artifact)_[a-z0-9_]+$/u.test(error?.message ?? "")) throw error;
    fail("postgres_attestation_artifact_input_failed");
  }
}

function publicFailure(error) {
  return /^(?:postgres_attestation|seaweed_artifact)_[a-z0-9_]+$/u.test(error?.message ?? "")
    ? error.message : "postgres_attestation_artifact_input_failed";
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode] = process.argv.slice(2);
  if (process.argv.length !== 3 || !Object.hasOwn(POSTGRES_ATTESTATION_ARTIFACTS, mode)) {
    console.error(JSON.stringify({ state: "FAILED", code: "postgres_attestation_artifact_arguments_invalid",
      candidateAuthorization: "NOT_AUTHORIZED", admission: "NOT_AUTHORIZED" })); process.exitCode = 1;
  } else {
    preparePostgresAttestationArtifactInput(mode).then((result) => console.log(JSON.stringify({
      state: result.state, mode: result.mode, artifactId: result.artifact.id,
      artifactDigest: result.artifact.digest, files: result.scan.entryCount,
      candidateAuthorization: "NOT_AUTHORIZED", admission: "NOT_AUTHORIZED",
    }))).catch((error) => { console.error(JSON.stringify({ state: "FAILED", code: publicFailure(error),
      candidateAuthorization: "NOT_AUTHORIZED", admission: "NOT_AUTHORIZED" })); process.exitCode = 1; });
  }
}
