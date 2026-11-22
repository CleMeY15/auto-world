import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { diagnosticIdentity, encodeSealedFragments, inspectSealedEnvelope, loadDiagnosticPublicKey, sealAccessCapture } from "./access-diagnostic.mjs";
import { assessBatchRecord, canonicalDiscoveryUrl, canonicalListingUrl } from "./batch-dom.mjs";
import { observeBatchPage, startBatchRuntime } from "./batch-runtime.mjs";
import { RESUME_CHECKPOINT } from "./batch-resume-checkpoint.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
export const BATCH_PLAN = Object.freeze({ schema_version: "leboncoin-batch-plan/v1", start_url: "https://www.leboncoin.fr/c/voitures",
  max_discovery_pages: 5, max_listing_pages: 100, max_candidates: 1000, min_gap_ms: 10_000,
  page_timeout_ms: 90_000, max_duration_ms: 45 * 60_000, retries: 0,
  recommendations: true, context: "single_temporary_session", photos: "references_only" });
export const BATCH_PLAN_SHA256 = hash(JSON.stringify(BATCH_PLAN));
export const DETAIL_BATCH_PLAN = Object.freeze({ ...BATCH_PLAN, schema_version: "leboncoin-detail-batch-plan/v1",
  start_url: null, max_discovery_pages: 0,
  seed_urls: Object.freeze(["3305814470", "3312238672", "3308374007"].map((id) => `https://www.leboncoin.fr/ad/voitures/${id}`)) });
export const DETAIL_BATCH_PLAN_SHA256 = hash(JSON.stringify(DETAIL_BATCH_PLAN));
export const RESUME_BATCH_PLAN = Object.freeze({ ...DETAIL_BATCH_PLAN, schema_version: "leboncoin-resume-batch-plan/v1",
  seed_urls: RESUME_CHECKPOINT.seed_urls, excluded_urls: RESUME_CHECKPOINT.previously_collected_urls,
  max_listing_pages: RESUME_CHECKPOINT.remaining_limit,
  resume_from: Object.freeze({ source_revision: RESUME_CHECKPOINT.source_revision, run_id: RESUME_CHECKPOINT.run_id,
    batch_id: RESUME_CHECKPOINT.batch_id, plan_sha256: RESUME_CHECKPOINT.plan_sha256, collected: RESUME_CHECKPOINT.collected }) });
export const RESUME_BATCH_PLAN_SHA256 = hash(JSON.stringify(RESUME_BATCH_PLAN));
const isoTime = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

/** Bounded frontier; every URL after the start is read from an observed page. */
export async function runBatch({ observe, onObservation = async () => {}, now = Date.now, wait = delay, plan = BATCH_PLAN }) {
  if (![BATCH_PLAN, DETAIL_BATCH_PLAN, RESUME_BATCH_PLAN].includes(plan)) throw new Error("invalid_batch_plan");
  const planSha = hash(JSON.stringify(plan));
  const excluded = new Set(plan.excluded_urls ?? []);
  const discovery = plan.start_url ? [plan.start_url] : [];
  const candidates = [...(plan.seed_urls ?? [])].filter((url) => !excluded.has(url));
  const discoveredPages = new Set(discovery); const discoveredListings = new Set(candidates);
  const opened = new Set(); const measurements = []; const entries = [];
  const started = now(); let previousEnd = null; let stopReason = null;
  let discoveryAttempts = 0; let listingAttempts = 0; let partial = 0; let rejected = 0; let signals = 0;
  while (discoveryAttempts + listingAttempts < plan.max_discovery_pages + plan.max_listing_pages) {
    if (now() - started >= plan.max_duration_ms) { stopReason = "duration_limit"; break; }
    const useDiscovery = discovery.length > 0 && discoveryAttempts < plan.max_discovery_pages
      && discoveredListings.size < plan.max_listing_pages;
    if (!useDiscovery && (listingAttempts >= plan.max_listing_pages || candidates.length === 0)) break;
    const kind = useDiscovery ? "discovery" : "listing";
    const url = useDiscovery ? discovery.shift() : candidates.shift();
    if (opened.has(url)) continue;
    if (previousEnd !== null) {
      // Timers may wake a millisecond early. Wait for the measured deadline,
      // keeping the same minimum gap and a bounded no-progress failure path.
      for (let wake = 0; wake < 3; wake += 1) {
        const needed = plan.min_gap_ms - (now() - previousEnd);
        if (needed <= 0) break;
        const before = now();
        try { await wait(Math.max(needed, 2)); } catch { stopReason = "interval_failed"; break; }
        if (now() <= before) { stopReason = "interval_not_met"; break; }
      }
      if (stopReason) break;
      if (now() - previousEnd < plan.min_gap_ms) { stopReason = "interval_not_met"; break; }
    }
    if (now() - started >= plan.max_duration_ms) { stopReason = "duration_limit"; break; }
    opened.add(url); if (kind === "listing") listingAttempts += 1; else discoveryAttempts += 1;
    const ordinal = measurements.length + 1;
    let capture;
    try { capture = await observe({ url, kind, ordinal }); }
    catch { if (kind === "listing") rejected += 1; stopReason = "environment_error"; break; }
    if (!isoTime(capture?.started_at) || !isoTime(capture?.completed_at)
      || Date.parse(capture.completed_at) < Date.parse(capture.started_at)
      || (previousEnd !== null && Date.parse(capture.started_at) - previousEnd < plan.min_gap_ms)) {
      if (kind === "listing") rejected += 1; stopReason = "capture_time_invalid"; break;
    }
    let assessment;
    try { assessment = assessBatchRecord(capture.record, url, kind, capture.completed_at); }
    catch { assessment = { outcome: "assessment_failed", stop: true, normalized: null }; }
    if (capture.record?.tab_closed !== true) { assessment.stop = true; assessment.outcome = "tab_cleanup_failed"; }
    const measurement = { ordinal, kind, target_url_sha256: hash(url), started_at: capture.started_at,
      completed_at: capture.completed_at, previous_gap_ms: previousEnd === null ? null : Date.parse(capture.started_at) - previousEnd,
      outcome: assessment.outcome, navigation_status: capture.record?.navigation?.httpStatus ?? null,
      api_status: capture.record?.api_status ?? null, control_signal: assessment.control?.signal_present === true,
      control_obstructing: assessment.control?.obstructing === true, core_fields_observed: assessment.normalized?.core_fields_observed === true,
      issues_count: assessment.normalized?.issues?.length ?? null, tab_closed: capture.record?.tab_closed === true };
    if (measurement.control_signal) signals += 1;
    measurements.push(measurement); previousEnd = Date.parse(capture.completed_at);
    let retained;
    try { retained = await onObservation({ url, kind, ordinal, capture, assessment, measurement }); }
    catch { if (kind === "listing") rejected += 1; stopReason = "evidence_output_failed"; break; }
    if (kind === "listing") {
      if (assessment.outcome === "listing_observed" && assessment.normalized?.status === "listing" && assessment.normalized.core_fields_observed === true
        && typeof assessment.observation_json === "string") {
        entries.push({ observation: assessment.observation, observation_json: assessment.observation_json,
          normalized: assessment.normalized, capture_sha256: retained?.capture_sha256 ?? hash(JSON.stringify(capture)) });
      } else if (assessment.normalized?.status === "listing") partial += 1;
      else rejected += 1;
    }
    if (assessment.stop) { stopReason = assessment.outcome; break; }
    for (const raw of assessment.listing_urls ?? []) {
      const link = canonicalListingUrl(raw);
      if (!link || excluded.has(link) || discoveredListings.has(link) || discoveredListings.size >= plan.max_candidates) continue;
      discoveredListings.add(link); if (!opened.has(link)) candidates.push(link);
    }
    for (const raw of assessment.discovery_urls ?? []) {
      const link = canonicalDiscoveryUrl(raw);
      if (!link || discoveredPages.has(link) || discoveredPages.size >= plan.max_discovery_pages) continue;
      discoveredPages.add(link); discovery.push(link);
    }
  }
  return { entries, measurements, summary: { schema_version: "leboncoin-batch-summary/v1", plan_sha256: planSha,
    started_at: new Date(started).toISOString(), completed_at: new Date(now()).toISOString(),
    status: stopReason ? "stopped" : entries.length === plan.max_listing_pages ? "target_reached" : "sample_exhausted", stop_reason: stopReason,
    discovered: discoveredListings.size, discovery_pages_attempted: discoveryAttempts, attempted: listingAttempts,
    complete: entries.length, partial, rejected, stored: 0, control_signals: signals,
    project_database_updated: false, photos_downloaded: false, recurring_collection_proven: false,
    catalog_coverage_proven: false, frame_body_coverage: "not_established", http_response_body: "not_captured" } };
}

async function main(args) {
  if (![4, 6].includes(args.length) || args[0] !== "--runtime" || args[2] !== "--out"
    || (args.length === 6 && (args[4] !== "--route" || !["known-details", "resume-known-details"].includes(args[5])))) throw new Error("invalid_arguments");
  const plan = args.length === 4 ? BATCH_PLAN : args[5] === "known-details" ? DETAIL_BATCH_PLAN : RESUME_BATCH_PLAN;
  const planSha = hash(JSON.stringify(plan));
  const out = resolve(args[3]); await mkdir(out, { mode: 0o700 });
  const key = await loadDiagnosticPublicKey();
  const batchId = randomBytes(16).toString("hex");
  const baseIdentity = diagnosticIdentity(process.env);
  const runtime = await startBatchRuntime({ runtime: args[1], out: join(out, "runtime") });
  let result; let cleanup;
  try {
    result = await runBatch({
      plan,
      observe: async ({ url }) => observeBatchPage(runtime.api, url),
      wait: (ms) => delay(ms, undefined, { signal: runtime.signal }),
      onObservation: async ({ url, kind, ordinal, capture, assessment, measurement }) => {
        const identity = { ...baseIdentity, schema_version: "leboncoin-batch-capture/v1", capture_id: randomBytes(16).toString("hex"),
          batch_id: batchId, batch_ordinal: ordinal, page_kind: kind, plan_sha256: planSha, target_url_sha256: hash(url) };
        const privateCapture = { identity, ...runtime.metadata, ...capture, target_url: url,
          observation_json: assessment.observation_json ?? null,
          normalized_sha256: assessment.normalized ? hash(JSON.stringify(assessment.normalized)) : null };
        const bytes = sealAccessCapture(privateCapture, key);
        const inspected = inspectSealedEnvelope(bytes, identity);
        const stem = `page-${String(ordinal).padStart(3, "0")}`;
        await writeFile(join(out, `${stem}.sealed.json`), bytes, { mode: 0o600, flag: "wx" });
        const receipt = { ...measurement, identity, sealed_sha256: inspected.sha256, sealed_bytes: inspected.bytes,
          dom_sha256: capture.record.dom ? hash(JSON.stringify(capture.record.dom)) : null,
          observation_sha256: assessment.normalized?.observation_sha256 ?? null };
        await writeFile(join(out, `${stem}.receipt.json`), `${JSON.stringify(receipt)}\n`, { mode: 0o600, flag: "wx" });
        process.stdout.write(`AUTO_FINDEX_BATCH_PAGE ${JSON.stringify(receipt)}\n`);
        for (const line of encodeSealedFragments(bytes)) process.stdout.write(`${line}\n`);
        return { capture_sha256: inspected.sha256 };
      },
    });
  } finally { cleanup = await runtime.stop(); }
  if (cleanup.established !== true || cleanup.remaining !== 0 || cleanup.process_exited !== true) {
    result.summary.status = "stopped"; result.summary.stop_reason = "runtime_cleanup_failed";
  }
  const summary = { ...result.summary, batch_id: batchId, source_revision: process.env.GITHUB_SHA,
    run_id: process.env.GITHUB_RUN_ID, cleanup };
  const bundleSummary = Object.fromEntries(["discovered", "attempted", "complete", "partial", "rejected", "stored", "status", "stop_reason"]
    .map((name) => [name, summary[name]]));
  const bundle = { schema_version: "leboncoin-batch-bundle/v1", batch_id: batchId, source_revision: process.env.GITHUB_SHA,
    run_id: process.env.GITHUB_RUN_ID, plan_sha256: planSha, created_at: summary.completed_at,
    summary: bundleSummary, entries: result.entries };
  await writeFile(join(out, "batch-bundle.private.json"), `${JSON.stringify(bundle)}\n`, { mode: 0o600, flag: "wx" });
  await writeFile(join(out, "batch-summary.json"), `${JSON.stringify(summary)}\n`, { mode: 0o600, flag: "wx" });
  process.stdout.write(`AUTO_FINDEX_BATCH_SUMMARY ${JSON.stringify(summary)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    const code = ["invalid_arguments", "runtime_mismatch", "runtime_unavailable", "public_key_invalid", "diagnostic_identity_invalid"]
      .includes(error?.message) ? error.message : "batch_setup_or_evidence_failed";
    process.stderr.write(`Batch stopped: ${code}.\n`); process.exitCode = 2;
  });
}
