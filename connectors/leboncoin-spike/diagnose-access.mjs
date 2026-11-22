import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { executeCollector, readBounded, safeRuntimeMetadata } from "./autonomous-probe.mjs";
import { ACCESS_TARGET_URL, KEY_FINGERPRINT, MAX_BODY_BYTES, MAX_ENVELOPE_BYTES, diagnosticIdentity,
  encodeSealedFragments, inspectSealedEnvelope, loadDiagnosticPublicKey } from "./access-diagnostic.mjs";

const decode = (bytes) => JSON.parse(new globalThis.TextDecoder("utf8", { fatal: true }).decode(bytes));
const iso = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? value : null;
const count = (value, maximum = 10_000) => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0) && value <= maximum ? value : null;
const statusCode = (value) => Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
const hash = (value) => typeof value === "string" && value.length === 64 && /^[a-f0-9]{64}$/u.test(value) ? value : null;
const allowed = (value, values, fallback = null) => values.includes(value) ? value : fallback;
const COLLECTOR_STATUSES = ["diagnostic_only", "access_blocked", "identity_mismatch", "unsupported_markup", "environment_error", "navigation_error", "deadline_exceeded"];
const BODY_STATUSES = ["captured", "unavailable", "evicted", "limit_exceeded", "timeout", "identity_rejected", "no_response", "loading_failed"];
const COUNTERS = ["document_requests_observed", "main_document_requests_observed", "iframe_document_requests_observed", "redirects_observed", "goto_calls", "navigation_requests_allowed", "additional_navigations_blocked"];

/** A fresh projection, never a spread of private reports or source-controlled values. */
export function projectAccessDiagnostic(input, { env, runtime, startedAt, completedAt }, expectedFingerprint = KEY_FINGERPRINT) {
  const metadata = safeRuntimeMetadata(env, runtime);
  const report = input?.report;
  const summary = input?.summary;
  const start = iso(startedAt);
  const end = iso(completedAt);
  const validWindow = start && end && Date.parse(end) >= Date.parse(start) && Date.parse(end) - Date.parse(start) <= 60_000;
  const result = { schema_version: "leboncoin-access-diagnostic/v1", ...metadata,
    status: input?.execution === "timeout" ? "collector_timeout" : input?.execution === "error" ? "collector_error" : "invalid_evidence",
    started_at: start, completed_at: end, duration_ms: validWindow ? Date.parse(end) - Date.parse(start) : null,
    collector_status: allowed(report?.status, COLLECTOR_STATUSES), navigation_status: statusCode(report?.navigation_status),
    chromium_version: typeof report?.runtime?.chromium_version === "string"
      && report.runtime.chromium_version.trim() === report.runtime.chromium_version
      && /^[0-9]{1,4}(?:\.[0-9]{1,8}){3}$/u.test(report.runtime.chromium_version) ? report.runtime.chromium_version : null,
    capture_id: null, captured_at: null, identity_status: null, body_status: null, body_representation: null,
    response_status: null, classification: "unknown", signals: { javascript_required: false, human_verification: false, access_denied: false, rate_limit: false },
    cdp_body_bytes: null, cdp_body_sha256: null, content_type: null, content_encoding: null,
    retry_after_present: false, headers_limited: false, key_fingerprint_sha256: hash(expectedFingerprint),
    sealed_response_bytes: null, sealed_response_sha256: null,
    ...Object.fromEntries(COUNTERS.map((key) => [key, null])),
  };
  try {
    if (!validWindow || hash(expectedFingerprint) === null || input?.execution !== "finished" || ![0, 2].includes(input.exitCode)
      || report?.schema_version !== "leboncoin-own-browser-attempt/v1" || report.acquisition !== "own_playwright_dom"
      || report.requested_url !== ACCESS_TARGET_URL || report.transport?.engine !== "playwright_chromium"
      || report.transport.retries !== 0 || count(report.transport.navigation_attempts, 1) === null
      || report.runtime?.context !== "fresh_nonpersistent" || report.runtime.headless !== true
      || report.runtime.chromium_sandbox !== true || report.runtime.shared_profile !== false
      || ![null, "1.64.0"].includes(report.runtime.playwright_version) || !COLLECTOR_STATUSES.includes(report.status)
      || report.diagnostic_status !== "sealed" || summary?.schema_version !== "leboncoin-access-summary/v1") throw new Error();
    const identity = diagnosticIdentity(env, summary.capture_id);
    const sealed = inspectSealedEnvelope(input.sealedBytes, identity, expectedFingerprint);
    const capturedAt = iso(summary.captured_at);
    if (!capturedAt || Date.parse(capturedAt) < Date.parse(start) || Date.parse(capturedAt) > Date.parse(end)
      || !["matched", "missing", "ambiguous"].includes(summary.identity_status) || !BODY_STATUSES.includes(summary.body_status)
      || COUNTERS.some((key) => count(summary[key]) === null) || summary.goto_calls !== report.transport.navigation_attempts
      || summary.goto_calls > 1 || summary.navigation_requests_allowed > 1
      || !["verification_markers_observed", "refusal_markers_observed", "generic_access_denied", "rate_limited", "no_refusal_observed", "unknown"].includes(summary.classification)
      || Object.keys(result.signals).some((key) => typeof summary.signals?.[key] !== "boolean")) throw new Error();
    const captured = summary.body_status === "captured";
    if (captured && (summary.identity_status !== "matched" || summary.main_document_requests_observed !== 1
      || summary.redirects_observed !== 0 || count(summary.cdp_body_bytes, MAX_BODY_BYTES) === null
      || hash(summary.cdp_body_sha256) === null || !["cdp_base64", "cdp_text_utf8"].includes(summary.body_representation))) throw new Error();
    result.status = captured ? "response_captured" : "diagnostic_recorded";
    result.capture_id = identity.capture_id;
    result.captured_at = capturedAt;
    result.identity_status = summary.identity_status;
    result.body_status = summary.body_status;
    result.body_representation = captured ? summary.body_representation : null;
    result.response_status = statusCode(summary.navigation_status);
    result.classification = summary.classification;
    for (const key of Object.keys(result.signals)) result.signals[key] = summary.signals[key];
    result.cdp_body_bytes = captured ? summary.cdp_body_bytes : null;
    result.cdp_body_sha256 = captured ? summary.cdp_body_sha256 : null;
    result.content_type = allowed(summary.content_type, ["text/html", "text/plain", "application/json", "other"]);
    result.content_encoding = allowed(summary.content_encoding, ["gzip", "br", "identity", "deflate", "unknown"]);
    result.retry_after_present = summary.retry_after_present === true;
    result.headers_limited = summary.headers_limited === true;
    result.sealed_response_bytes = sealed.bytes;
    result.sealed_response_sha256 = sealed.sha256;
    for (const key of COUNTERS) result[key] = summary[key];
  } catch { /* The fixed invalid_evidence projection contains no private content. */ }
  return result;
}

export async function runAccessDiagnostic({ run, clock, env, runtime, prepare = loadDiagnosticPublicKey }) {
  await prepare();
  diagnosticIdentity(env); // Both checks precede the single browser child invocation.
  const began = clock();
  let input;
  try { input = await run(); } catch { input = { execution: "error" }; }
  return { receipt: projectAccessDiagnostic(input, { env, runtime, startedAt: new Date(began).toISOString(), completedAt: new Date(clock()).toISOString() }),
    sealedBytes: input?.sealedBytes };
}

async function main(args) {
  if (args.length !== 2 || args[0] !== "--out" || !args[1] || process.platform !== "linux") throw new Error("setup_failed");
  const directory = resolve(args[1]);
  await mkdir(directory, { mode: 0o700 });
  const runtime = { node: process.versions.node, platform: process.platform, arch: process.arch };
  let receipt;
  let sealedBytes;
  try {
    const outcome = await runAccessDiagnostic({ clock: Date.now, env: process.env, runtime,
      run: async () => {
        const childDirectory = join(directory, "attempt-1");
        const execution = await executeCollector(childDirectory, { accessDiagnostic: true });
        if (execution.execution !== "finished") return execution;
        try {
          return { ...execution, report: decode(await readBounded(join(childDirectory, "attempt.json"), 32 * 1024)),
            summary: decode(await readBounded(join(childDirectory, "access-summary.json"), 8192)),
            sealedBytes: await readBounded(join(childDirectory, "sealed-response.json"), MAX_ENVELOPE_BYTES) };
        } catch { return { ...execution, report: null }; }
      },
    });
    receipt = outcome.receipt;
    sealedBytes = outcome.sealedBytes;
  } catch {
    receipt = { schema_version: "leboncoin-access-diagnostic/v1", ...safeRuntimeMetadata(process.env, runtime), status: "setup_failed" };
  }
  const recorded = ["response_captured", "diagnostic_recorded"].includes(receipt.status);
  if (recorded) await writeFile(join(directory, "sealed-response.json"), sealedBytes, { mode: 0o600, flag: "wx" });
  const temporary = join(directory, ".public-diagnostic.tmp");
  await writeFile(temporary, `${JSON.stringify(receipt)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, join(directory, "public-diagnostic.json"));
  process.stdout.write(`AUTO_FINDEX_ACCESS_DIAGNOSTIC ${JSON.stringify(receipt)}\n`);
  if (recorded) for (const line of encodeSealedFragments(sealedBytes)) process.stdout.write(`${line}\n`);
  // Success here means a recorded diagnostic, including an explicit refusal;
  // it does not report successful listing acquisition.
  process.exitCode = recorded ? 0 : 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch { process.stderr.write("Access diagnostic setup or publication failed.\n"); process.exitCode = 2; }
}
