import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, open, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { extractLeboncoinDomObservation } from "./extract.mjs";

export const TARGET_URL = "https://www.leboncoin.fr/ad/voitures/3305814470";
export const MIN_INTERVAL_MS = 300_000;
export const MAX_ATTEMPTS = 3;
const CHILD_TIMEOUT_MS = 45_000;
const MAX_FILE_BYTES = 1024 * 1024;
const PLAYWRIGHT_VERSION = "1.64.0";
const COLLECTOR = fileURLToPath(new URL("./collect-browser.mjs", import.meta.url));
const REPORT_STATUSES = new Set(["extracted", "access_blocked", "identity_mismatch", "unsupported_markup",
  "partial_capture", "environment_error", "navigation_error", "deadline_exceeded"]);
const REASON_CODES = new Set(["non_200_navigation", "expected_headline_not_visible", "snapshot_byte_limit", "global_30s_deadline",
  ...["launch", "context", "navigation", "headline", "capture", "extraction"].flatMap((stage) =>
    ["local_socket_permission_denied", "sandbox_unavailable", "playwright_version_mismatch", "operation_timeout", "operation_failed",
      "EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "net::ERR_NAME_NOT_RESOLVED", "net::ERR_CONNECTION_CLOSED",
      "net::ERR_CONNECTION_RESET", "net::ERR_CONNECTION_REFUSED", "net::ERR_NETWORK_CHANGED", "net::ERR_TIMED_OUT"]
      .map((code) => `${stage}:${code}`)),
]);
const version = (value) => typeof value === "string" && value.trim() === value && value.length <= 48
  && /^v?[0-9]{1,4}(?:\.[0-9]{1,8}){2,3}$/u.test(value) ? value.replace(/^v/u, "") : null;
const integer = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0) && value <= max ? value : null;
const utc = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? value : null;
const decode = (bytes) => JSON.parse(new globalThis.TextDecoder("utf-8", { fatal: true }).decode(bytes));
const boundedBytes = (value) => value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= MAX_FILE_BYTES;
const privateContext = (value) => value?.context === "fresh_nonpersistent" && value.headless === true
  && value.shared_profile === false && value.chromium_sandbox === true && value.playwright_version === PLAYWRIGHT_VERSION;

/** Only bounded runtime facts are copied; arbitrary environment values never leave the runner. */
export function safeRuntimeMetadata(env = {}, runtime = {}) {
  return {
    commit_sha: typeof env.GITHUB_SHA === "string" && env.GITHUB_SHA.length === 40 && /^[a-f0-9]{40}$/iu.test(env.GITHUB_SHA) ? env.GITHUB_SHA.toLowerCase() : null,
    github_run_id: typeof env.GITHUB_RUN_ID === "string" && env.GITHUB_RUN_ID.trim() === env.GITHUB_RUN_ID && /^[1-9][0-9]{0,19}$/u.test(env.GITHUB_RUN_ID) ? env.GITHUB_RUN_ID : null,
    github_run_attempt: typeof env.GITHUB_RUN_ATTEMPT === "string" && /^[1-9][0-9]{0,3}$/u.test(env.GITHUB_RUN_ATTEMPT) ? Number(env.GITHUB_RUN_ATTEMPT) : null,
    runtime: {
      node: version(runtime.node),
      platform: ["linux", "darwin", "win32"].includes(runtime.platform) ? runtime.platform : "unknown",
      arch: ["x64", "arm64", "ia32"].includes(runtime.arch) ? runtime.arch : "unknown",
      configured_playwright: PLAYWRIGHT_VERSION,
      chromium_sandbox: true,
    },
  };
}

/** Pure allowlist projection. Private strings, URLs, photos, VINs and errors are never copied. */
export function projectAttempt(input, { attempt, startedAt, completedAt }) {
  const report = input?.report;
  let status = input?.execution === "timeout" ? "collector_timeout"
    : input?.execution === "error" ? "collector_error"
      : REPORT_STATUSES.has(report?.status) ? report.status : "invalid_evidence";
  const start = utc(startedAt);
  const end = utc(completedAt);
  const validWindow = start !== null && end !== null && Date.parse(end) >= Date.parse(start)
    && Date.parse(end) - Date.parse(start) <= 60_000;
  const snapshotHash = boundedBytes(input?.snapshotBytes) ? createHash("sha256").update(input.snapshotBytes).digest("hex") : null;
  let fresh;
  let snapshot;
  let validEvidence = false;
  try {
    if (snapshotHash && boundedBytes(input?.normalizedBytes)) {
      snapshot = decode(input.snapshotBytes);
      const normalized = decode(input.normalizedBytes);
      fresh = extractLeboncoinDomObservation(input.snapshotBytes, { expectedUrl: TARGET_URL, expectedListingId: "3305814470" });
      validEvidence = validWindow && snapshot.acquisition === "own_playwright_dom"
        && snapshot.requested_url === TARGET_URL && snapshot.url === TARGET_URL
        && privateContext(snapshot.runtime) && snapshot.transport?.engine === "playwright_chromium"
        && snapshot.transport.navigation_status === 200 && utc(snapshot.captured_at) !== null
        && Date.parse(snapshot.captured_at) >= Date.parse(start) && Date.parse(snapshot.captured_at) <= Date.parse(end)
        && JSON.stringify(normalized) === JSON.stringify(fresh)
        && fresh.observation_sha256 === snapshotHash && fresh.provenance?.acquisition === "own_playwright_dom";
    }
  } catch { validEvidence = false; }
  const reportBound = report?.schema_version === "leboncoin-own-browser-attempt/v1"
    && report.acquisition === "own_playwright_dom" && report.requested_url === TARGET_URL
    && report.transport?.engine === "playwright_chromium" && report.transport.retries === 0
    && [0, 1].includes(report.transport.navigation_attempts);
  if (!validWindow || (input?.execution === "finished" && !reportBound)) status = "invalid_evidence";
  const complete = status === "extracted" && input?.execution === "finished" && input.exitCode === 0 && reportBound
    && report.url === TARGET_URL && report.navigation_status === 200 && report.transport.navigation_attempts === 1
    && report.transport.redirect_count === 0
    && privateContext(report.runtime) && version(report.runtime.chromium_version) !== null
    && report.extraction_status === "listing" && report.core_fields_observed === true && report.issue_count === 0
    && validEvidence && fresh.status === "listing" && fresh.core_fields_observed === true
    && fresh.issues.length === 0 && report.captured_at === snapshot.captured_at;
  if (status === "extracted" && !complete) status = "invalid_evidence";
  const facts = complete ? fresh.fields : null;
  return {
    attempt: integer(attempt, MAX_ATTEMPTS),
    started_at: start, completed_at: end,
    duration_ms: validWindow ? Date.parse(end) - Date.parse(start) : null,
    status, complete,
    reason_code: REASON_CODES.has(report?.reason) ? report.reason : null,
    navigation_status: Number.isInteger(report?.navigation_status) && report.navigation_status >= 100 && report.navigation_status <= 599 ? report.navigation_status : null,
    navigation_attempts: reportBound ? report.transport.navigation_attempts : null,
    core_fields_observed: validEvidence && fresh?.core_fields_observed === true,
    captured_at: validEvidence ? snapshot.captured_at : null,
    snapshot_sha256: snapshotHash,
    snapshot_bytes: snapshotHash === null ? null : input.snapshotBytes.byteLength,
    chromium_version: version(report?.runtime?.chromium_version),
    price_minor: facts?.price.status === "observed" && facts.price.value.currency === "EUR" ? integer(facts.price.value.amountMinor) : null,
    mileage_km: facts?.mileage.status === "observed" && facts.mileage.value.unit === "km" ? integer(facts.mileage.value.amount) : null,
    model_year: facts?.model_year.status === "observed" ? integer(facts.model_year.value, 9999) : null,
    criterion_count: validEvidence ? integer(snapshot.criteria.length, 100) : null,
    photo_reference_count: validEvidence ? integer(snapshot.photos.length, 100) : null,
  };
}

/** The injected run/wait/clock functions make sequencing testable without a browser or network. */
export async function runAutonomousSequence({ run, wait, clock, publish, metadata }) {
  const started = clock();
  if (!Number.isSafeInteger(started)) throw new Error("clock_invalid");
  let receipt = {
    schema_version: "leboncoin-autonomous-probe/v1", ...safeRuntimeMetadata(metadata?.env, metadata?.runtime),
    status: "running", started_at: new Date(started).toISOString(), completed_at: null,
    attempt_limit: MAX_ATTEMPTS, minimum_interval_ms: MIN_INTERVAL_MS,
    completed_observations: 0, attempts: [],
  };
  await publish(receipt);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      try { await wait(MIN_INTERVAL_MS); }
      catch {
        receipt = { ...receipt, status: "stopped", stop_reason: "wait_failed" };
        await publish(receipt);
        return receipt;
      }
    }
    const began = clock();
    const previousEnd = receipt.attempts.at(-1)?.completed_at;
    if (!Number.isSafeInteger(began) || began < started || (previousEnd && began - Date.parse(previousEnd) < MIN_INTERVAL_MS)) {
      receipt = { ...receipt, status: "stopped", stop_reason: "clock_invalid" };
      await publish(receipt);
      return receipt;
    }
    let input;
    try { input = await run(attempt, new Date(began).toISOString()); }
    catch { input = { execution: "error" }; }
    const ended = clock();
    const completedAt = Number.isSafeInteger(ended) ? new Date(ended).toISOString() : null;
    const item = projectAttempt(input, { attempt, startedAt: new Date(began).toISOString(), completedAt });
    const final = !item.complete || attempt === MAX_ATTEMPTS;
    receipt = {
      ...receipt, status: item.complete ? (final ? "completed" : "running") : "stopped",
      completed_at: final ? completedAt : null,
      completed_observations: receipt.completed_observations + (item.complete ? 1 : 0),
      attempts: [...receipt.attempts, item],
    };
    await publish(receipt);
    if (!item.complete) break;
  }
  return receipt;
}

async function readBounded(path) {
  const handle = await open(path, "r");
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < 1 || info.size > MAX_FILE_BYTES) throw new Error("file_limit");
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size < 1 || size > MAX_FILE_BYTES) throw new Error("file_limit");
    return buffer.subarray(0, size);
  } finally { await handle.close(); }
}

function executeCollector(directory) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, [COLLECTOR, "--url", TARGET_URL, "--out", directory], {
      detached: true, stdio: "ignore",
    });
    let settled = false;
    let timedOut = false;
    let hardKill;
    const terminate = (signal) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); } catch { /* Owned process group already exited. */ }
    };
    const finish = (exitCode) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(deadline);
      globalThis.clearTimeout(hardKill);
      process.removeListener("SIGTERM", interrupted);
      process.removeListener("SIGINT", interrupted);
      terminate("SIGKILL");
      resolveResult({ execution: timedOut ? "timeout" : exitCode === null ? "error" : "finished", exitCode });
    };
    const deadline = setTimeout(() => {
      timedOut = true;
      terminate("SIGTERM");
      hardKill = setTimeout(() => { terminate("SIGKILL"); finish(null); }, 2000);
    }, CHILD_TIMEOUT_MS);
    const interrupted = () => { terminate("SIGKILL"); finish(null); };
    process.once("SIGTERM", interrupted);
    process.once("SIGINT", interrupted);
    child.once("error", () => finish(null));
    child.once("close", (code) => finish(code));
  });
}

async function runOnDisk(directory) {
  const execution = await executeCollector(directory);
  if (execution.execution !== "finished") return execution;
  try {
    const report = decode(await readBounded(join(directory, "attempt.json")));
    const result = { ...execution, report };
    if (["extracted", "partial_capture"].includes(report.status)) {
      result.snapshotBytes = await readBounded(join(directory, "snapshot.json"));
      result.normalizedBytes = await readBounded(join(directory, "result.json"));
    }
    return result;
  } catch { return { ...execution, report: null }; }
}

async function main(args) {
  if (args.length !== 2 || args[0] !== "--out" || !args[1]) throw new Error("arguments_invalid");
  if (process.platform !== "linux") throw new Error("runtime_unsupported");
  const directory = resolve(args[1]);
  await mkdir(directory, { mode: 0o700 }); // Refuse reuse, including existing symlinks.
  let publication = 0;
  const receipt = await runAutonomousSequence({
    run: (attempt) => runOnDisk(join(directory, `attempt-${attempt}`)),
    wait: (milliseconds) => delay(milliseconds), clock: Date.now,
    metadata: { env: process.env, runtime: { node: process.versions.node, platform: process.platform, arch: process.arch } },
    publish: async (value) => {
      const bytes = `${JSON.stringify(value)}\n`;
      const temporary = join(directory, `.receipt-${publication++}.tmp`);
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      await rename(temporary, join(directory, "receipt.json"));
      process.stdout.write(`AUTO_FINDEX_RECEIPT ${JSON.stringify(value)}\n`);
    },
  });
  process.exitCode = receipt.status === "completed" && receipt.completed_observations === MAX_ATTEMPTS ? 0 : 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch {
    process.stderr.write("Autonomous probe setup or private receipt publication failed.\n");
    process.exitCode = 2;
  }
}
