import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const repository = "CleMeY15/auto-world";
export const workflow = `${repository}/.github/workflows/attestation-canary.yml`;
export const mainRef = "refs/heads/main";
export const branchRef = "refs/heads/codex/task-0005-attestation-negative";
const wrongWorkflow = `${repository}/.github/workflows/not-the-canary.yml`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// This is a diagnostic wrapper around official gh, not an attestation validator.
export function verificationArgs({ file, bundle, sha, ref, mode, wrongIdentity = false }) {
  if (!/^[a-f0-9]{40}$/u.test(sha) || ![mainRef, branchRef].includes(ref) ||
      !["identity", "workflow"].includes(mode) || typeof wrongIdentity !== "boolean") {
    throw new Error("canary_policy_invalid");
  }
  const expectedWorkflow = wrongIdentity ? wrongWorkflow : workflow;
  return ["attestation", "verify", resolve(file),
    "--repo", repository, "--hostname", "github.com",
    ...(mode === "identity"
      ? ["--cert-identity", `https://github.com/${expectedWorkflow}@${ref}`]
      : ["--signer-workflow", expectedWorkflow]),
    "--cert-oidc-issuer", "https://token.actions.githubusercontent.com",
    "--source-ref", ref, "--source-digest", sha, "--signer-digest", sha,
    "--deny-self-hosted-runners", "--predicate-type", "https://slsa.dev/provenance/v1",
    "--bundle", resolve(bundle), "--format", "json"];
}

export function runGh(args) {
  const started = Date.now();
  return new Promise((resolveResult) => {
    execFile("gh", args, {
      encoding: "utf8", timeout: 60000, maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, GH_DEBUG: "", DEBUG: "", GH_PROMPT_DISABLED: "1", NO_COLOR: "1" },
    }, (error, stdout, stderr) => resolveResult({
      code: error ? (Number.isInteger(error.code) ? error.code : null) : 0,
      processError: Boolean(error && (error.killed || error.signal || !Number.isInteger(error.code))),
      stdout, stderr, durationMs: Date.now() - started,
    }));
  });
}

async function snapshot(file, maximum) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > maximum) {
    throw new Error("canary_input_invalid");
  }
  const bytes = await readFile(file);
  if (bytes.length !== stat.size) throw new Error("canary_input_changed");
  return { bytes, digest: sha256(bytes) };
}

export function classifyResult(result) {
  if (result.processError || !Number.isInteger(result.code)) return { status: "ERROR", code: "cli_process_error" };
  if (result.code !== 0) {
    if (/error creating|error getting trust|failed to create TUF|failed to get trusted root|no such host|network|connection |dial |TLS|timeout|deadline exceeded|x509:|unknown flag|no such file|unexpected end|unauthorized|forbidden|HTTP [45][0-9]{2}/iu.test(result.stderr)) {
      return { status: "ERROR", code: "cli_operational_error" };
    }
    // gh 2.98.0 emits this fixed phase only after local bundle loading and
    // verifier initialization. It does not expose the inner Sigstore mismatch.
    if (result.code === 1 && /Sigstore verification failed/u.test(result.stderr) &&
        /Error: verifying with issuer "sigstore\.dev"/u.test(result.stderr)) {
      return { status: "REJECTED", code: "sigstore_verification_failed" };
    }
    if (result.code === 1 && /Policy verification failed/u.test(result.stderr) &&
        /expected (?:BuildSignerDigest|SourceRepositoryDigest|SourceRepositoryRef) to be /u.test(result.stderr)) {
      return { status: "REJECTED", code: "certificate_source_mismatch" };
    }
    return { status: "ERROR", code: "cli_unexpected_error" };
  }
  try {
    const entries = JSON.parse(result.stdout);
    if (!Array.isArray(entries) || entries.length !== 1 ||
        !entries[0]?.attestation || !entries[0]?.verificationResult?.signature?.certificate ||
        !entries[0]?.verificationResult?.statement) {
      return { status: "ERROR", code: "cli_result_ambiguous" };
    }
    return { status: "VERIFIED", code: "official_verification_succeeded", entry: entries[0] };
  } catch {
    return { status: "ERROR", code: "cli_result_invalid" };
  }
}

export async function verifyPair(options, execute = runGh) {
  const fileBefore = await snapshot(options.file, 1024);
  const bundleBefore = await snapshot(options.bundle, 1024 * 1024);
  // Only one native bundle object is accepted, never a JSONL collection. This
  // shape guard performs no cryptographic or certificate interpretation.
  const bundle = JSON.parse(bundleBefore.bytes.toString("utf8"));
  if (!bundle || Array.isArray(bundle) || typeof bundle.mediaType !== "string" ||
      !bundle.mediaType.startsWith("application/vnd.dev.sigstore.bundle.")) {
    throw new Error("canary_bundle_ambiguous");
  }
  const invocations = [];
  for (const mode of ["identity", "workflow"]) {
    const args = verificationArgs({ ...options, mode });
    const processResult = await execute(args);
    const result = classifyResult(processResult);
    invocations.push({ mode, args, ...processResult, ...result });
    const currentFile = await snapshot(options.file, 1024);
    const currentBundle = await snapshot(options.bundle, 1024 * 1024);
    if (currentFile.digest !== fileBefore.digest || currentBundle.digest !== bundleBefore.digest) {
      throw new Error("canary_input_changed");
    }
  }
  const bothVerified = invocations.every((entry) => entry.status === "VERIFIED");
  if (bothVerified && JSON.stringify(invocations[0].entry) !== JSON.stringify(invocations[1].entry)) {
    throw new Error("canary_verification_disagrees");
  }
  return {
    fileSha256: fileBefore.digest, bundleSha256: bundleBefore.digest,
    policy: { sha: options.sha, ref: options.ref, wrongIdentity: options.wrongIdentity ?? false },
    status: bothVerified ? "VERIFIED" : invocations.some((entry) => entry.status === "ERROR") ? "ERROR" : "REJECTED",
    invocations,
  };
}

// A failed command alone is never an accepted security negative. The genuine
// bundle must first have passed BOTH policies under its own expected identity.
export function negativeProved(kind, control, result, mainControl) {
  if (mainControl?.status !== "VERIFIED" || mainControl.policy?.ref !== mainRef ||
      mainControl.policy?.wrongIdentity !== false || mainControl.invocations?.length !== 2 ||
      !mainControl.invocations.every((entry) => entry.status === "VERIFIED")) return false;
  if (control?.status !== "VERIFIED" || result?.status !== "REJECTED" ||
      control.bundleSha256 !== result.bundleSha256 ||
      control.fileSha256 !== mainControl.fileSha256 || result.policy?.sha !== mainControl.policy.sha ||
      control.policy?.wrongIdentity !== false || result.policy?.ref !== mainRef ||
      control.invocations?.length !== 2 || result.invocations?.length !== 2 ||
      !control.invocations.every((entry) => entry.status === "VERIFIED") ||
      !result.invocations.every((entry) => entry.status === "REJECTED")) return false;
  if (kind === "branch") {
    return control.fileSha256 === result.fileSha256 &&
      control.bundleSha256 !== mainControl.bundleSha256 &&
      control.policy.ref === branchRef && control.policy.sha !== result.policy.sha &&
      result.policy.wrongIdentity === false &&
      result.invocations[1].code === "certificate_source_mismatch";
  }
  if (control.policy.ref !== mainRef || control.policy.sha !== result.policy.sha ||
      control.bundleSha256 !== mainControl.bundleSha256) return false;
  if (kind === "tamper") return control.fileSha256 !== result.fileSha256 && !result.policy.wrongIdentity;
  if (kind === "wrong-workflow") return control.fileSha256 === result.fileSha256 && result.policy.wrongIdentity;
  return false;
}
