import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, realpath, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { ATTESTATION, validateCandidateAttestationPredicate } from "./candidate-attestation.mjs";

export const MAIN_REF = "refs/heads/main";
export const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const BOOTSTRAP_DIGEST = "sha256:9ee2f2da7187b0d0ecd3cbab83b7356f9ef032650b33604ff13e711e3462e408";
export const GH_BINARY = Object.freeze({ version: "2.98.0", releasedAt: "2026-08-20",
  bytes: 41_377_954, sha256: "62885b97de6a0cd85e616cdd94bcda908bf5cf1018094385892b05cea3537163" });
export const RECONSTRUCTED_SUBJECT_ARTIFACT = Object.freeze({
  origin: "RECONSTRUCTED_FROM_REVIEWED_DESCRIPTORS",
  bytes: 2_824,
  sha256: "0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93",
});
export const CUSTOM_TRUSTED_ROOT = Object.freeze({
  bytes: 34_634,
  sha256: "65ca537f6ed8a47fd0e560c421baa1f6c1efb8b25fc200d8c5c02c0e92eb2b9",
});

const SHA = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_BUNDLE_BYTES = 2 * 1024 * 1024;
const MAX_JSON_BYTES = 512 * 1024;
const MAX_PROCESS_BYTES = 2 * 1024 * 1024;
const PUBLIC_FAILURES = new Set([
  "postgres_candidate_attestation_verification_invalid",
  "postgres_candidate_attestation_input_invalid",
  "postgres_candidate_attestation_input_changed",
  "postgres_candidate_attestation_pre_sign_receipt_invalid",
  "postgres_candidate_attestation_bundle_invalid",
  "postgres_candidate_attestation_statement_invalid",
  "postgres_candidate_attestation_predicate_invalid",
  "postgres_candidate_attestation_predicate_changed",
  "postgres_candidate_attestation_verification_disagrees",
  "postgres_candidate_attestation_context_invalid",
  "postgres_candidate_attestation_tool_invalid",
  "postgres_candidate_attestation_receipt_invalid",
  "postgres_candidate_attestation_positive_control_failed",
  "postgres_candidate_attestation_negative_control_failed",
  "postgres_candidate_attestation_input_cleanup_failed",
]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonClone = (value) => JSON.parse(JSON.stringify(value));

function fail(reason = "postgres_candidate_attestation_verification_invalid") {
  throw new Error(reason);
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && isDeepStrictEqual(Object.keys(value).sort(), [...keys].sort());
}

function workflowIdentity(workflowPath, ref) {
  return `https://github.com/${ATTESTATION.repository}/${workflowPath}@${ref}`;
}

export function verificationArgs({ bundle, sourceSha, signerSha, mode,
  subjectName = ATTESTATION.subjectName, subjectDigest = ATTESTATION.subjectDigest,
  workflowPath = ATTESTATION.workflowPath, ref = MAIN_REF, artifactPath, artifactExpected,
  trustedRootPath, trustedRootExpected }) {
  const localArtifact = [artifactPath, artifactExpected, trustedRootPath, trustedRootExpected]
    .some((value) => value !== undefined);
  if (typeof bundle !== "string" || !path.isAbsolute(bundle) || !SHA.test(sourceSha)
    || !SHA.test(signerSha) || !["identity", "workflow"].includes(mode)
    || typeof subjectName !== "string" || subjectName !== ATTESTATION.subjectName
    || !DIGEST.test(subjectDigest) || typeof workflowPath !== "string"
    || !workflowPath.startsWith(".github/workflows/") || !workflowPath.endsWith(".yml")
    || typeof ref !== "string" || !ref.startsWith("refs/heads/")
    || (localArtifact && (typeof artifactPath !== "string" || !path.isAbsolute(artifactPath)
      || !isDeepStrictEqual(artifactExpected, RECONSTRUCTED_SUBJECT_ARTIFACT)
      || typeof trustedRootPath !== "string" || !path.isAbsolute(trustedRootPath)
      || !isDeepStrictEqual(trustedRootExpected, CUSTOM_TRUSTED_ROOT)))) fail();
  const workflow = `${ATTESTATION.repository}/${workflowPath}`;
  return ["attestation", "verify", localArtifact ? path.resolve(artifactPath)
    : `oci://${subjectName}@${subjectDigest}`,
    "--repo", ATTESTATION.repository, "--hostname", "github.com",
    ...(localArtifact ? ["--custom-trusted-root", path.resolve(trustedRootPath)] : []),
    ...(mode === "identity"
      ? ["--cert-identity", workflowIdentity(workflowPath, ref)]
      : ["--signer-workflow", workflow]),
    "--cert-oidc-issuer", GITHUB_OIDC_ISSUER,
    "--source-ref", ref, "--source-digest", sourceSha, "--signer-digest", signerSha,
    "--deny-self-hosted-runners", "--predicate-type", ATTESTATION.predicateType,
    "--bundle", path.resolve(bundle), "--format", "json"];
}

export function runGh(args, executable = "gh", isolation) {
  if (isolation !== undefined && (!exactKeys(isolation, ["home"])
    || typeof isolation.home !== "string" || !path.isAbsolute(isolation.home))) fail();
  const started = Date.now();
  const environment = isolation === undefined ? {
    PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", LANG: "C.UTF-8", LC_ALL: "C.UTF-8",
    GH_TOKEN: process.env.GH_TOKEN ?? "", DOCKER_CONFIG: process.env.DOCKER_CONFIG ?? "",
    GH_DEBUG: "", DEBUG: "", GH_PROMPT_DISABLED: "1", NO_COLOR: "1",
  } : {
    PATH: path.dirname(executable), HOME: isolation.home, XDG_CONFIG_HOME: isolation.home,
    XDG_CACHE_HOME: isolation.home, XDG_STATE_HOME: isolation.home, GH_CONFIG_DIR: isolation.home,
    LANG: "C.UTF-8", LC_ALL: "C.UTF-8", DO_NOT_TRACK: "true",
    GH_DEBUG: "", DEBUG: "", GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1",
    GH_TELEMETRY: "false", NO_COLOR: "1",
  };
  return new Promise((resolve) => {
    execFile(executable, args, {
      encoding: "utf8", timeout: 60_000, maxBuffer: MAX_PROCESS_BYTES, windowsHide: true,
      env: environment,
    }, (error, stdout, stderr) => resolve({
      code: error ? (Number.isInteger(error.code) ? error.code : null) : 0,
      processError: Boolean(error && (error.killed || error.signal || !Number.isInteger(error.code))),
      signal: error?.signal ?? null, killed: Boolean(error?.killed),
      processClosed: true, stdoutClosed: true, stderrClosed: true,
      stdout, stderr, durationMs: Date.now() - started,
    }));
  });
}

function sameIdentity(left, right) {
  return ["dev", "ino", "mode", "nlink", "uid", "gid", "size", "mtimeNs", "ctimeNs"]
    .every((key) => left[key] === right[key]);
}

async function snapshot(file, maximum) {
  if (typeof file !== "string" || !path.isAbsolute(file)) fail("postgres_candidate_attestation_input_invalid");
  let handle;
  try {
    const beforePath = await lstat(file, { bigint: true });
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
      | (constants.O_NONBLOCK ?? 0));
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n
      || before.size < 2n || before.size > BigInt(maximum) || !sameIdentity(beforePath, before)) {
      fail("postgres_candidate_attestation_input_invalid");
    }
    if (process.platform === "linux" && ((before.mode & 0o022n) !== 0n
      || before.uid !== BigInt(process.getuid()))) fail("postgres_candidate_attestation_input_invalid");
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const afterPath = await lstat(file, { bigint: true });
    if (BigInt(bytes.length) !== before.size || !sameIdentity(before, after) || !sameIdentity(before, afterPath)) {
      fail("postgres_candidate_attestation_input_changed");
    }
    return { bytes, digest: sha256(bytes), identity: before };
  } catch (error) {
    if (error?.message?.startsWith("postgres_candidate_attestation_")) throw error;
    fail("postgres_candidate_attestation_input_invalid");
  } finally {
    await handle?.close();
  }
}

function json(bytes, reason = "postgres_candidate_attestation_input_invalid") {
  try { return JSON.parse(bytes.toString("utf8")); } catch { fail(reason); }
}

export function validatePreSignReceipt(receipt, predicateBytes, expected = {}) {
  if (!exactKeys(receipt, ["kind", "state", "authority", "candidateAuthorization", "admission",
    "signing", "repository", "workflowPath", "sourceRef", "runId", "runNumber", "runAttempt",
    "recipeRevision", "subject", "predicate"])
    || receipt.kind !== "POSTGRES_CANDIDATE_PRE_SIGN_RECEIPT_V1"
    || receipt.state !== "EVIDENCE_VERIFIED" || receipt.authority !== "REVIEWED_MAIN_SIGNER"
    || receipt.candidateAuthorization !== "NOT_AUTHORIZED" || receipt.admission !== "NOT_AUTHORIZED"
    || receipt.signing !== "PENDING_OFFICIAL_ACTION" || receipt.repository !== ATTESTATION.repository
    || receipt.workflowPath !== ATTESTATION.workflowPath || receipt.sourceRef !== MAIN_REF
    || !/^[1-9][0-9]{0,19}$/u.test(receipt.runId) || receipt.runNumber !== "1"
    || receipt.runAttempt !== "1" || !SHA.test(receipt.recipeRevision)
    || !exactKeys(receipt.subject, ["name", "digest"])
    || receipt.subject.name !== ATTESTATION.subjectName
    || receipt.subject.digest !== ATTESTATION.subjectDigest
    || !exactKeys(receipt.predicate, ["type", "sha256", "bytes", "file"])
    || receipt.predicate.type !== ATTESTATION.predicateType
    || receipt.predicate.sha256 !== sha256(predicateBytes)
    || receipt.predicate.bytes !== predicateBytes.length || receipt.predicate.file !== "predicate.json"
    || (expected.runId !== undefined && receipt.runId !== expected.runId)
    || (expected.recipeRevision !== undefined && receipt.recipeRevision !== expected.recipeRevision)) {
    fail("postgres_candidate_attestation_pre_sign_receipt_invalid");
  }
  return receipt;
}

function validateBundle(bytes) {
  const bundle = json(bytes, "postgres_candidate_attestation_bundle_invalid");
  if (!exactKeys(bundle, ["mediaType", "verificationMaterial", "dsseEnvelope"])
    || typeof bundle.mediaType !== "string"
    || !bundle.mediaType.startsWith("application/vnd.dev.sigstore.bundle.")) {
    fail("postgres_candidate_attestation_bundle_invalid");
  }
  return bundle;
}

const OPERATIONAL = /error creating|error getting trust|failed to create TUF|failed to get trusted root|no such host|network|connection |dial |TLS|timeout|deadline exceeded|x509:|unknown flag|no such file|unexpected end|unauthorized|forbidden|HTTP [45][0-9]{2}|MANIFEST_UNKNOWN|DENIED|TOOMANYREQUESTS/iu;
const SIGSTORE_REJECTION = /^(?:Sigstore verification failed\s+)?Error: verifying with issuer "sigstore\.dev"$/u;
const POLICY_REJECTION = /^(?:Policy verification failed\s+)?Error: expected (BuildSignerDigest|SourceRepositoryDigest|SourceRepositoryRef) to be ([^\r\n]+), got ([^\r\n]+)$/u;

export function classifyVerification(result) {
  if (!result || result.processError || !Number.isInteger(result.code)
    || typeof result.stdout !== "string" || typeof result.stderr !== "string"
    || Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) > MAX_PROCESS_BYTES) {
    return { status: "ERROR", code: "cli_process_error" };
  }
  if (result.code !== 0) {
    if (OPERATIONAL.test(result.stderr)) return { status: "ERROR", code: "cli_operational_error" };
    const diagnostic = result.stderr.trim();
    if (result.code === 1 && SIGSTORE_REJECTION.test(diagnostic)) {
      return { status: "REJECTED", code: "official_policy_rejected",
        rejection: { kind: "SIGSTORE_VERIFICATION_FAILED" } };
    }
    const policy = diagnostic.match(POLICY_REJECTION);
    if (result.code === 1 && policy) {
      return { status: "REJECTED", code: "official_policy_rejected",
        rejection: { kind: "CERTIFICATE_POLICY_MISMATCH", field: policy[1],
          expected: policy[2], actual: policy[3] } };
    }
    return { status: "ERROR", code: "cli_unexpected_error" };
  }
  try {
    const entries = JSON.parse(result.stdout);
    if (!Array.isArray(entries) || entries.length !== 1
      || !entries[0]?.attestation || !entries[0]?.verificationResult?.signature?.certificate
      || !entries[0]?.verificationResult?.statement) {
      return { status: "ERROR", code: "cli_result_ambiguous" };
    }
    return { status: "VERIFIED", code: "official_verification_succeeded", entry: entries[0] };
  } catch {
    return { status: "ERROR", code: "cli_result_invalid" };
  }
}

function validateStatement(entry, expectedPredicate, runId) {
  const statement = entry?.verificationResult?.statement;
  const certificate = entry?.verificationResult?.signature?.certificate;
  if (!exactKeys(statement, ["_type", "subject", "predicateType", "predicate"])
    || statement._type !== "https://in-toto.io/Statement/v1"
    || statement.predicateType !== ATTESTATION.predicateType
    || !Array.isArray(statement.subject) || statement.subject.length !== 1
    || !exactKeys(statement.subject[0], ["name", "digest"])
    || statement.subject[0].name !== ATTESTATION.subjectName
    || !exactKeys(statement.subject[0].digest, ["sha256"])
    || `sha256:${statement.subject[0].digest.sha256}` !== ATTESTATION.subjectDigest
    || certificate?.githubWorkflowTrigger !== "workflow_dispatch"
    || certificate?.buildTrigger !== "workflow_dispatch"
    || certificate?.runInvocationURI !== `https://github.com/${ATTESTATION.repository}/actions/runs/${runId}/attempts/1`) {
    fail("postgres_candidate_attestation_statement_invalid");
  }
  validateCandidateAttestationPredicate(statement.predicate, expectedPredicate);
}

function comparableEntry(entry) {
  const copy = jsonClone(entry);
  delete copy.verificationResult.verifiedIdentity;
  return copy;
}

function publicInvocation(mode, args, processResult, classified) {
  const publicArgs = [...args];
  if (path.isAbsolute(publicArgs[2])) publicArgs[2] = path.basename(publicArgs[2]);
  const bundle = publicArgs.indexOf("--bundle");
  if (bundle >= 0) publicArgs[bundle + 1] = path.basename(publicArgs[bundle + 1]);
  const trustedRoot = publicArgs.indexOf("--custom-trusted-root");
  if (trustedRoot >= 0) publicArgs[trustedRoot + 1] = path.basename(publicArgs[trustedRoot + 1]);
  return {
    mode, args: publicArgs, exitCode: processResult.code,
    stdoutBytes: Buffer.byteLength(processResult.stdout ?? ""),
    stdoutSha256: sha256(Buffer.from(processResult.stdout ?? "")),
    stderrBytes: Buffer.byteLength(processResult.stderr ?? ""),
    stderrSha256: sha256(Buffer.from(processResult.stderr ?? "")),
    durationMs: Number.isSafeInteger(processResult.durationMs) && processResult.durationMs >= 0
      ? processResult.durationMs : null,
    status: classified.status, code: classified.code,
    ...(classified.rejection ? { rejection: classified.rejection } : {}),
  };
}

export function TEST_ONLY_publicInvocation(mode, args, processResult, classified) {
  return publicInvocation(mode, args, processResult, classified);
}

export async function verifyCandidateAttestationPair(options, execute = runGh) {
  if (!options || typeof options !== "object" || typeof execute !== "function"
    || !SHA.test(options.sourceSha) || !SHA.test(options.signerSha)) fail();
  const paths = [[options.bundle, MAX_BUNDLE_BYTES], [options.predicate, MAX_JSON_BYTES],
    [options.preSignReceipt, MAX_JSON_BYTES],
    ...(options.artifactPath === undefined ? [] : [[options.artifactPath, MAX_JSON_BYTES],
      [options.trustedRootPath, MAX_JSON_BYTES]])];
  const initial = await Promise.all(paths.map(([file, cap]) => snapshot(file, cap)));
  if (options.artifactPath !== undefined && (!isDeepStrictEqual(options.artifactExpected,
    RECONSTRUCTED_SUBJECT_ARTIFACT) || initial[3].bytes.length !== RECONSTRUCTED_SUBJECT_ARTIFACT.bytes
    || initial[3].digest !== RECONSTRUCTED_SUBJECT_ARTIFACT.sha256)) {
    fail("postgres_candidate_attestation_input_invalid");
  }
  if (options.artifactPath !== undefined && (!isDeepStrictEqual(options.trustedRootExpected,
    CUSTOM_TRUSTED_ROOT) || initial[4].bytes.length !== CUSTOM_TRUSTED_ROOT.bytes
    || initial[4].digest !== CUSTOM_TRUSTED_ROOT.sha256)) {
    fail("postgres_candidate_attestation_input_invalid");
  }
  validateBundle(initial[0].bytes);
  const predicate = json(initial[1].bytes);
  if (!isDeepStrictEqual(predicate, options.expectedPredicate)) fail("postgres_candidate_attestation_predicate_changed");
  validateCandidateAttestationPredicate(predicate, options.expectedPredicate);
  const preSign = validatePreSignReceipt(json(initial[2].bytes), initial[1].bytes,
    options.preSignExpected ?? {});
  if (predicate.signer?.runId !== preSign.runId
    || predicate.signer?.recipeRevision !== preSign.recipeRevision) {
    fail("postgres_candidate_attestation_pre_sign_receipt_invalid");
  }

  const internal = [];
  const invocations = [];
  for (const mode of ["identity", "workflow"]) {
    const args = verificationArgs({ ...options, mode });
    const processResult = await execute(args);
    const classified = classifyVerification(processResult);
    if (classified.status === "VERIFIED") {
      validateStatement(classified.entry, options.expectedPredicate, preSign.runId);
    }
    internal.push(classified);
    invocations.push(publicInvocation(mode, args, processResult, classified));
    const current = await Promise.all(paths.map(([file, cap]) => snapshot(file, cap)));
    if (current.some((value, index) => value.digest !== initial[index].digest
      || !sameIdentity(value.identity, initial[index].identity))) {
      fail("postgres_candidate_attestation_input_changed");
    }
  }
  const bothVerified = internal.every((entry) => entry.status === "VERIFIED");
  if (bothVerified && !isDeepStrictEqual(comparableEntry(internal[0].entry), comparableEntry(internal[1].entry))) {
    fail("postgres_candidate_attestation_verification_disagrees");
  }
  return {
    kind: "POSTGRES_CANDIDATE_ATTESTATION_VERIFICATION_V1",
    state: bothVerified ? "VERIFIED" : internal.some((entry) => entry.status === "ERROR") ? "ERROR" : "REJECTED",
    subject: `${ATTESTATION.subjectName}@${ATTESTATION.subjectDigest}`,
    bundleSha256: initial[0].digest, predicateSha256: initial[1].digest,
    preSignReceiptSha256: initial[2].digest,
    policy: {
      sourceSha: options.sourceSha, signerSha: options.signerSha,
      subjectName: options.subjectName ?? ATTESTATION.subjectName,
      subjectDigest: options.subjectDigest ?? ATTESTATION.subjectDigest,
      workflowPath: options.workflowPath ?? ATTESTATION.workflowPath,
      ref: options.ref ?? MAIN_REF,
    },
    invocations,
  };
}

function genuinePositive(result) {
  return result?.state === "VERIFIED" && result.invocations?.length === 2
    && result.invocations.every((entry) => entry.status === "VERIFIED")
    && result.policy?.subjectName === ATTESTATION.subjectName
    && result.policy?.subjectDigest === ATTESTATION.subjectDigest
    && result.policy?.workflowPath === ATTESTATION.workflowPath
    && result.policy?.ref === MAIN_REF;
}

export function negativeProved(kind, control, result, mainControl = control) {
  if (!genuinePositive(mainControl) || !genuinePositive(control)
    || control.bundleSha256 !== mainControl.bundleSha256
    || control.predicateSha256 !== mainControl.predicateSha256
    || control.preSignReceiptSha256 !== mainControl.preSignReceiptSha256
    || !result || (kind !== "tampered-payload" && result.bundleSha256 !== control.bundleSha256)
    || result.predicateSha256 !== control.predicateSha256
    || result.preSignReceiptSha256 !== control.preSignReceiptSha256
    || result.invocations?.length !== 2 || !result.invocations.every((entry) => entry.status === "REJECTED")) return false;
  const unchanged = (...names) => names.every((name) => result.policy?.[name] === control.policy[name]);
  if (kind === "wrong-subject") return result.policy.subjectDigest === BOOTSTRAP_DIGEST
    && unchanged("subjectName", "workflowPath", "ref", "sourceSha", "signerSha")
    && result.invocations.every((entry) => entry.rejection?.kind === "SIGSTORE_VERIFICATION_FAILED");
  if (kind === "wrong-workflow") return result.policy.workflowPath !== ATTESTATION.workflowPath
    && unchanged("subjectName", "subjectDigest", "ref", "sourceSha", "signerSha")
    && result.invocations.every((entry) => entry.rejection?.kind === "SIGSTORE_VERIFICATION_FAILED");
  if (kind === "wrong-ref") return result.policy.ref !== MAIN_REF
    && unchanged("subjectName", "subjectDigest", "workflowPath", "sourceSha", "signerSha")
    && result.invocations[0].mode === "identity"
    && result.invocations[0].rejection?.kind === "SIGSTORE_VERIFICATION_FAILED"
    && result.invocations[1].mode === "workflow"
    && isDeepStrictEqual(result.invocations[1].rejection,
      { kind: "CERTIFICATE_POLICY_MISMATCH", field: "SourceRepositoryRef",
        expected: result.policy.ref, actual: MAIN_REF });
  if (kind === "wrong-source") return result.policy.sourceSha !== mainControl.policy.sourceSha
    && unchanged("subjectName", "subjectDigest", "workflowPath", "ref", "signerSha")
    && result.invocations.every((entry) => isDeepStrictEqual(entry.rejection,
      { kind: "CERTIFICATE_POLICY_MISMATCH", field: "SourceRepositoryDigest",
        expected: result.policy.sourceSha, actual: mainControl.policy.sourceSha }));
  if (kind === "wrong-signer") return result.policy.signerSha !== mainControl.policy.signerSha
    && unchanged("subjectName", "subjectDigest", "workflowPath", "ref", "sourceSha")
    && result.invocations.every((entry) => isDeepStrictEqual(entry.rejection,
      { kind: "CERTIFICATE_POLICY_MISMATCH", field: "BuildSignerDigest",
        expected: result.policy.signerSha, actual: mainControl.policy.signerSha }));
  if (kind === "tampered-payload") return result.bundleSha256 !== control.bundleSha256
    && unchanged("subjectName", "subjectDigest", "workflowPath", "ref", "sourceSha", "signerSha")
    && result.invocations.every((entry) => entry.rejection?.kind === "SIGSTORE_VERIFICATION_FAILED");
  return false;
}

function alternateSha(value) { return `${value[0] === "0" ? "1" : "0"}${value.slice(1)}`; }

async function requireDirectory(directory, mode, uid) {
  const info = await lstat(directory, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory
    || (process.platform === "linux" && (info.uid !== BigInt(uid) || (info.mode & 0o777n) !== BigInt(mode)))) {
    fail("postgres_candidate_attestation_context_invalid");
  }
}

async function requireCliContext(argv, env) {
  if (!Array.isArray(argv) || argv.length !== 1 || argv[0] !== "verify"
    || process.platform !== "linux" || env.GITHUB_ACTIONS !== "true"
    || env.RUNNER_ENVIRONMENT !== "github-hosted" || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_JOB !== "verifier" || env.GITHUB_REPOSITORY !== ATTESTATION.repository
    || env.GITHUB_REF !== MAIN_REF
    || env.GITHUB_WORKFLOW_REF !== `${ATTESTATION.repository}/${ATTESTATION.workflowPath}@${MAIN_REF}`
    || env.GITHUB_RUN_NUMBER !== "1" || env.GITHUB_RUN_ATTEMPT !== "1"
    || !/^[1-9][0-9]{0,19}$/u.test(env.GITHUB_RUN_ID ?? "") || !SHA.test(env.GITHUB_SHA ?? "")
    || typeof env.RUNNER_TEMP !== "string" || !path.isAbsolute(env.RUNNER_TEMP)
    || path.normalize(env.RUNNER_TEMP) !== env.RUNNER_TEMP || !env.GH_TOKEN
    || env.GH_TOKEN.length > 8192 || /\s/u.test(env.GH_TOKEN)) {
    fail("postgres_candidate_attestation_context_invalid");
  }
  const uid = process.getuid();
  const temporary = await lstat(env.RUNNER_TEMP, { bigint: true });
  if (!temporary.isDirectory() || temporary.isSymbolicLink()
    || await realpath(env.RUNNER_TEMP) !== env.RUNNER_TEMP || temporary.uid !== BigInt(uid)
    || (temporary.mode & 0o022n) !== 0n) fail("postgres_candidate_attestation_context_invalid");
  const input = path.join(env.RUNNER_TEMP, "postgres-candidate-attestation-input");
  const auth = path.join(env.RUNNER_TEMP, "postgres-ghcr-auth");
  if (env.DOCKER_CONFIG !== auth) fail("postgres_candidate_attestation_context_invalid");
  await requireDirectory(input, 0o755, uid).catch(async () => {
    const info = await lstat(input, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(input) !== input
      || info.uid !== BigInt(uid) || (info.mode & 0o022n) !== 0n) fail("postgres_candidate_attestation_context_invalid");
  });
  await requireDirectory(auth, 0o700, uid);
  if (!isDeepStrictEqual((await readdir(auth)).sort(), ["config.json"])) fail("postgres_candidate_attestation_context_invalid");
  const config = await lstat(path.join(auth, "config.json"), { bigint: true });
  if (!config.isFile() || config.isSymbolicLink() || config.nlink !== 1n
    || config.uid !== BigInt(uid) || (config.mode & 0o777n) !== 0o600n
    || config.size < 2n || config.size > 16_384n) fail("postgres_candidate_attestation_context_invalid");
  const names = (await readdir(input)).sort();
  if (!isDeepStrictEqual(names, ["bundle.json", "pre-sign-receipt.json", "predicate.json"])) {
    fail("postgres_candidate_attestation_context_invalid");
  }
  return {
    input, output: path.join(env.RUNNER_TEMP, "postgres-candidate-attestation-verification"),
    bundle: path.join(input, "bundle.json"), predicate: path.join(input, "predicate.json"),
    preSignReceipt: path.join(input, "pre-sign-receipt.json"), uid,
  };
}

async function officialToolIdentity(context, execute = runGh) {
  const executable = path.join(process.env.RUNNER_TEMP, "postgres-attestation-gh",
    "gh_2.98.0_linux_amd64", "bin", "gh");
  if (await realpath(executable) !== executable) fail("postgres_candidate_attestation_tool_invalid");
  const binary = await snapshot(executable, 128 * 1024 * 1024);
  if ((binary.identity.mode & 0o111n) === 0n || Number(binary.identity.size) !== GH_BINARY.bytes
    || binary.digest !== GH_BINARY.sha256) fail("postgres_candidate_attestation_tool_invalid");
  const version = await execute(["version"], executable);
  const help = await execute(["attestation", "verify", "--help"], executable);
  if (version.processError || version.code !== 0 || help.processError || help.code !== 0
    || (version.stdout.split(/\r?\n/u)[0] ?? "") !== `gh version ${GH_BINARY.version} (${GH_BINARY.releasedAt})`
    || !help.stdout.includes("gh attestation verify")) fail("postgres_candidate_attestation_tool_invalid");
  return {
    executable, version: GH_BINARY.version, binarySha256: binary.digest,
    binaryBytes: Number(binary.identity.size), helpSha256: sha256(Buffer.from(help.stdout)),
  };
}

async function publishReceipt(output, receipt) {
  try { await mkdir(output, { mode: 0o700 }); }
  catch (error) {
    if (error?.code !== "EEXIST") throw error;
    await requireDirectory(output, 0o700, process.getuid());
    if ((await readdir(output)).length !== 0) fail("postgres_candidate_attestation_receipt_invalid");
  }
  if (process.platform === "linux") await chmod(output, 0o700);
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  if (bytes.length > MAX_JSON_BYTES) fail("postgres_candidate_attestation_receipt_invalid");
  const file = path.join(output, "verification-receipt.json");
  await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
  if (process.platform === "linux") await chmod(file, 0o600);
  const written = await snapshot(file, MAX_JSON_BYTES);
  if (!written.bytes.equals(bytes)) fail("postgres_candidate_attestation_receipt_invalid");
  return file;
}

function publicFailure(error) {
  return PUBLIC_FAILURES.has(error?.message) ? error.message
    : "postgres_candidate_attestation_verification_failed";
}

async function attemptedPair(options, verifyPair) {
  try { return await verifyPair(options); }
  catch (error) { return { state: "ERROR", code: publicFailure(error) }; }
}

export async function exerciseCandidateAttestationBundleControls(context, base, verifyPair, positiveControl) {
  await mkdir(context.output, { mode: 0o700 });
  if (process.platform === "linux") await chmod(context.output, 0o700);
  const original = await snapshot(context.bundle, MAX_BUNDLE_BYTES);
  const controls = {
    missingBundle: path.join(context.output, "missing-bundle.json"),
    truncatedBundle: path.join(context.output, "truncated-bundle.json"),
    corruptBundle: path.join(context.output, "corrupt-bundle.json"),
    tamperedPayload: path.join(context.output, "tampered-payload-bundle.json"),
  };
  await writeFile(controls.truncatedBundle, original.bytes.subarray(0, Math.max(2, Math.floor(original.bytes.length / 2))),
    { flag: "wx", mode: 0o600 });
  await writeFile(controls.corruptBundle, "{}", { flag: "wx", mode: 0o600 });
  const originalBundle = validateBundle(original.bytes);
  if (typeof originalBundle.dsseEnvelope?.payload !== "string"
    || !/^[A-Za-z0-9+/]+={0,2}$/u.test(originalBundle.dsseEnvelope.payload)) {
    fail("postgres_candidate_attestation_bundle_invalid");
  }
  const decoded = Buffer.from(originalBundle.dsseEnvelope.payload, "base64");
  const marker = Buffer.from("NOT_AUTHORIZED"); const location = decoded.indexOf(marker);
  if (location < 0) fail("postgres_candidate_attestation_bundle_invalid");
  const changed = Buffer.from(decoded); changed[location + marker.length - 1] = "E".charCodeAt(0);
  const tamperedBundle = jsonClone(originalBundle);
  tamperedBundle.dsseEnvelope.payload = changed.toString("base64");
  const restored = jsonClone(tamperedBundle);
  restored.dsseEnvelope.payload = originalBundle.dsseEnvelope.payload;
  if (!isDeepStrictEqual(restored, originalBundle)) fail("postgres_candidate_attestation_bundle_invalid");
  await writeFile(controls.tamperedPayload, JSON.stringify(tamperedBundle), { flag: "wx", mode: 0o600 });
  const results = {}; let tamperedPayload;
  try {
    const tampered = await attemptedPair({ ...base, bundle: controls.tamperedPayload }, verifyPair);
    if (!negativeProved("tampered-payload", positiveControl, tampered, positiveControl)) {
      fail("postgres_candidate_attestation_negative_control_failed");
    }
    tamperedPayload = { proof: "SIGNATURE_REJECTION_PROVED", originalBundleSha256: original.digest,
      tamperedBundleSha256: tampered.bundleSha256, originalPayloadSha256: sha256(decoded),
      tamperedPayloadSha256: sha256(changed), result: tampered };
    for (const [name, bundle] of Object.entries(controls).filter(([name]) => name !== "tamperedPayload")) {
      const result = await attemptedPair({ ...base, bundle }, verifyPair);
      if (result.state !== "ERROR") fail("postgres_candidate_attestation_negative_control_failed");
      results[name] = { proof: "ERROR_NOT_REJECTION", result };
    }
  } finally {
    await Promise.all([controls.truncatedBundle, controls.corruptBundle, controls.tamperedPayload]
      .map((file) => unlink(file).catch(() => undefined)));
  }
  if ((await readdir(context.output)).length !== 0) fail("postgres_candidate_attestation_input_cleanup_failed");
  return { tamperedPayload, malformedInputControls: results };
}

async function executeCandidateAttestationVerification(argv = process.argv.slice(2), env = process.env,
  dependencies = {}) {
  const progress = dependencies.onProgress ?? (() => undefined);
  const context = await (dependencies.requireContext ?? requireCliContext)(argv, env);
  progress("inputs", { output: context.output });
  const predicateSnapshot = await snapshot(context.predicate, MAX_JSON_BYTES);
  const receiptSnapshot = await snapshot(context.preSignReceipt, MAX_JSON_BYTES);
  const expectedPredicate = json(predicateSnapshot.bytes);
  validateCandidateAttestationPredicate(expectedPredicate, expectedPredicate);
  const preSign = validatePreSignReceipt(json(receiptSnapshot.bytes), predicateSnapshot.bytes,
    { runId: env.GITHUB_RUN_ID, recipeRevision: env.GITHUB_SHA });
  const tool = await (dependencies.toolIdentity ?? officialToolIdentity)(context, dependencies.toolExecute ?? runGh);
  progress("tool", { output: context.output });
  const execute = dependencies.execute ?? ((args) => runGh(args, tool.executable));
  const verifyPair = dependencies.verifyPair ?? ((options) => verifyCandidateAttestationPair(options, execute));
  const base = { bundle: context.bundle, predicate: context.predicate,
    preSignReceipt: context.preSignReceipt, expectedPredicate,
    preSignExpected: { runId: env.GITHUB_RUN_ID, recipeRevision: env.GITHUB_SHA },
    sourceSha: env.GITHUB_SHA, signerSha: env.GITHUB_SHA };
  progress("positive-before", { output: context.output, status: "STARTED" });
  const positiveBefore = await verifyPair(base);
  if (!genuinePositive(positiveBefore)) fail("postgres_candidate_attestation_positive_control_failed");
  progress("positive-before", { output: context.output, status: "COMPLETED" });
  const changes = {
    "wrong-subject": { subjectDigest: BOOTSTRAP_DIGEST },
    "wrong-workflow": { workflowPath: ".github/workflows/not-postgres-candidate-attest-v2.yml" },
    "wrong-ref": { ref: "refs/heads/not-main" },
    "wrong-source": { sourceSha: alternateSha(env.GITHUB_SHA) },
    "wrong-signer": { signerSha: alternateSha(env.GITHUB_SHA) },
  };
  const negatives = {};
  for (const [kind, change] of Object.entries(changes)) {
    progress(kind, { output: context.output, status: "STARTED" });
    const result = await verifyPair({ ...base, ...change });
    if (!negativeProved(kind, positiveBefore, result, positiveBefore)) {
      fail("postgres_candidate_attestation_negative_control_failed");
    }
    negatives[kind] = result;
    progress(kind, { output: context.output, status: "COMPLETED" });
  }
  progress("tampered-payload", { output: context.output, status: "STARTED" });
  const bundleControls = await (dependencies.exerciseMalformedInputs ?? exerciseCandidateAttestationBundleControls)(
    context, base, verifyPair, positiveBefore);
  negatives["tampered-payload"] = bundleControls.tamperedPayload.result;
  progress("tampered-payload", { output: context.output, status: "COMPLETED" });
  progress("positive-after", { output: context.output, status: "STARTED" });
  const positiveAfter = await verifyPair(base);
  if (!genuinePositive(positiveAfter)
    || positiveAfter.bundleSha256 !== positiveBefore.bundleSha256
    || positiveAfter.predicateSha256 !== positiveBefore.predicateSha256
    || positiveAfter.preSignReceiptSha256 !== positiveBefore.preSignReceiptSha256) {
    fail("postgres_candidate_attestation_positive_control_failed");
  }
  progress("positive-after", { output: context.output, status: "COMPLETED" });
  const receipt = {
    kind: "POSTGRES_CANDIDATE_ATTESTATION_VERIFICATION_RECEIPT_V1", state: "VERIFIED",
    authority: "OFFICIAL_GITHUB_ATTESTATION_VERIFIER", candidateAuthorization: "NOT_AUTHORIZED",
    admission: "NOT_AUTHORIZED", verdict: "ATTESTED_UNADMITTED",
    repository: ATTESTATION.repository, workflowPath: ATTESTATION.workflowPath,
    sourceRef: MAIN_REF, runId: env.GITHUB_RUN_ID, runNumber: "1", runAttempt: "1",
    recipeRevision: env.GITHUB_SHA,
    subject: { name: ATTESTATION.subjectName, digest: ATTESTATION.subjectDigest },
    predicate: { type: ATTESTATION.predicateType, sha256: predicateSnapshot.digest,
      bytes: predicateSnapshot.bytes.length },
    preSignReceipt: { sha256: receiptSnapshot.digest, bytes: receiptSnapshot.bytes.length,
      runId: preSign.runId },
    tool: { version: tool.version, binarySha256: tool.binarySha256,
      binaryBytes: tool.binaryBytes, helpSha256: tool.helpSha256 },
    registryAccess: { method: "ISOLATED_DOCKER_CONFIG_DEFAULT_KEYCHAIN", scope: "READ_ONLY" },
    positiveControls: { before: positiveBefore, after: positiveAfter },
    negativeControls: Object.fromEntries(Object.entries(negatives)
      .map(([kind, value]) => [kind, kind === "tampered-payload"
        ? bundleControls.tamperedPayload : { proof: "REJECTION_PROVED", result: value }])),
    malformedInputControls: bundleControls.malformedInputControls,
  };
  const receiptFile = await (dependencies.publishReceipt ?? publishReceipt)(context.output, receipt);
  progress("receipt", { output: context.output });
  return { receipt, receiptFile };
}

export async function runCandidateAttestationVerification(argv = process.argv.slice(2), env = process.env,
  dependencies = {}) {
  const completedControls = [];
  let phase = "context"; let output;
  const onProgress = (next, details) => {
    phase = next; output = details?.output ?? output;
    if (details?.status === "COMPLETED"
      && (next.startsWith("positive-") || next.startsWith("wrong-") || next === "tampered-payload")) {
      completedControls.push(next);
    }
    dependencies.onProgress?.(next, details);
  };
  try { return await executeCandidateAttestationVerification(argv, env, { ...dependencies, onProgress }); }
  catch (error) {
    if (output) {
      const failure = { kind: "POSTGRES_CANDIDATE_ATTESTATION_VERIFICATION_RECEIPT_V1",
        state: "FAILED", authority: "OFFICIAL_GITHUB_ATTESTATION_VERIFIER",
        candidateAuthorization: "NOT_AUTHORIZED", admission: "NOT_AUTHORIZED",
        verdict: "INCOMPLETE", phase, completedControls, reason: publicFailure(error) };
      try {
        const receiptFile = await (dependencies.publishReceipt ?? publishReceipt)(output, failure);
        if (error && typeof error === "object") Object.defineProperty(error, "receiptFile", { value: receiptFile });
      } catch { /* the original fail-closed reason remains authoritative */ }
    }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCandidateAttestationVerification().then(({ receiptFile }) => console.log(JSON.stringify({
    state: "VERIFIED", verdict: "ATTESTED_UNADMITTED", receiptFile,
    candidateAuthorization: "NOT_AUTHORIZED", admission: "NOT_AUTHORIZED",
  }))).catch((error) => {
    console.error(JSON.stringify({ state: "FAILED", code: publicFailure(error),
      candidateAuthorization: "NOT_AUTHORIZED", admission: "NOT_AUTHORIZED" }));
    process.exitCode = 1;
  });
}
