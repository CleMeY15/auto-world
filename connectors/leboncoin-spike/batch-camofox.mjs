import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { diagnosticIdentity, encodeSealedFragments, inspectSealedEnvelope, loadDiagnosticPublicKey, sealAccessCapture } from "./access-diagnostic.mjs";
import { assessBatchRecord, canonicalDiscoveryUrl, canonicalListingUrl } from "./batch-dom.mjs";
import { observeBatchPage, startBatchRuntime } from "./batch-runtime.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
export const BATCH_PLAN = Object.freeze({ schema_version: "leboncoin-batch-plan/v1", start_url: "https://www.leboncoin.fr/c/voitures",
  max_discovery_pages: 5, max_listing_pages: 100, max_candidates: 1000, min_gap_ms: 10_000,
  page_timeout_ms: 90_000, max_duration_ms: 45 * 60_000, retries: 0,
  recommendations: true, context: "single_temporary_session", photos: "references_only" });
export const BATCH_PLAN_SHA256 = hash(JSON.stringify(BATCH_PLAN));
const isoTime = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

/** Bounded frontier; every URL after the start is read from an observed page. */
export async function runBatch({ observe, onObservation = async () => {}, now = Date.now, wait = delay }) {
  const discovery = [BATCH_PLAN.start_url]; const candidates = [];
  const discoveredPages = new Set(discovery); const discoveredListings = new Set();
  const opened = new Set(); const measurements = []; const entries = [];
  const started = now(); let previousEnd = null; let stopReason = null;
  let discoveryAttempts = 0; let listingAttempts = 0; let partial = 0; let rejected = 0; let signals = 0;
  while (discoveryAttempts + listingAttempts < BATCH_PLAN.max_discovery_pages + BATCH_PLAN.max_listing_pages) {
    if (now() - started >= BATCH_PLAN.max_duration_ms) { stopReason = "duration_limit"; break; }
    const useDiscovery = discovery.length > 0 && discoveryAttempts < BATCH_PLAN.max_discovery_pages
      && discoveredListings.size < BATCH_PLAN.max_listing_pages;
    if (!useDiscovery && (listingAttempts >= BATCH_PLAN.max_listing_pages || candidates.length === 0)) break;
    const kind = useDiscovery ? "discovery" : "listing";
    const url = useDiscovery ? discovery.shift() : candidates.shift();
    if (opened.has(url)) continue;
    if (previousEnd !== null) {
      const needed = Math.max(0, BATCH_PLAN.min_gap_ms - (now() - previousEnd));
      if (needed) { try { await wait(needed); } catch { stopReason = "interval_failed"; break; } }
      if (now() - previousEnd < BATCH_PLAN.min_gap_ms) { stopReason = "interval_not_met"; break; }
    }
    if (now() - started >= BATCH_PLAN.max_duration_ms) { stopReason = "duration_limit"; break; }
    opened.add(url); if (kind === "listing") listingAttempts += 1; else discoveryAttempts += 1;
    const ordinal = measurements.length + 1;
    let capture;
    try { capture = await observe({ url, kind, ordinal }); }
    catch { if (kind === "listing") rejected += 1; stopReason = "environment_error"; break; }
    if (!isoTime(capture?.started_at) || !isoTime(capture?.completed_at)
      || Date.parse(capture.completed_at) < Date.parse(capture.started_at)
      || (previousEnd !== null && Date.parse(capture.started_at) - previousEnd < BATCH_PLAN.min_gap_ms)) {
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
      if (!link || discoveredListings.has(link) || discoveredListings.size >= BATCH_PLAN.max_candidates) continue;
      discoveredListings.add(link); if (!opened.has(link)) candidates.push(link);
    }
    for (const raw of assessment.discovery_urls ?? []) {
      const link = canonicalDiscoveryUrl(raw);
      if (!link || discoveredPages.has(link) || discoveredPages.size >= BATCH_PLAN.max_discovery_pages) continue;
      discoveredPages.add(link); discovery.push(link);
    }
  }
  return { entries, measurements, summary: { schema_version: "leboncoin-batch-summary/v1", plan_sha256: BATCH_PLAN_SHA256,
    started_at: new Date(started).toISOString(), completed_at: new Date(now()).toISOString(),
    status: stopReason ? "stopped" : entries.length === 100 ? "target_reached" : "sample_exhausted", stop_reason: stopReason,
    discovered: discoveredListings.size, discovery_pages_attempted: discoveryAttempts, attempted: listingAttempts,
    complete: entries.length, partial, rejected, stored: 0, control_signals: signals,
    project_database_updated: false, photos_downloaded: false, recurring_collection_proven: false,
    catalog_coverage_proven: false, frame_body_coverage: "not_established", http_response_body: "not_captured" } };
}

async function main(args) {
  if (args.length !== 4 || args[0] !== "--runtime" || args[2] !== "--out") throw new Error("invalid_arguments");
  const out = resolve(args[3]); await mkdir(out, { mode: 0o700 });
  const key = await loadDiagnosticPublicKey();
  const batchId = randomBytes(16).toString("hex");
  const baseIdentity = diagnosticIdentity(process.env);
  const runtime = await startBatchRuntime({ runtime: args[1], out: join(out, "runtime") });
  let result; let cleanup;
  try {
    result = await runBatch({
      observe: async ({ url }) => observeBatchPage(runtime.api, url),
      wait: (ms) => delay(ms, undefined, { signal: runtime.signal }),
      onObservation: async ({ url, kind, ordinal, capture, assessment, measurement }) => {
        const identity = { ...baseIdentity, schema_version: "leboncoin-batch-capture/v1", capture_id: randomBytes(16).toString("hex"),
          batch_id: batchId, batch_ordinal: ordinal, page_kind: kind, plan_sha256: BATCH_PLAN_SHA256, target_url_sha256: hash(url) };
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
    run_id: process.env.GITHUB_RUN_ID, plan_sha256: BATCH_PLAN_SHA256, created_at: summary.completed_at,
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
