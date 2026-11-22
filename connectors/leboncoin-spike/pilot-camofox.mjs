import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { encodeSealedFragments } from "./access-diagnostic.mjs";
import { extractLeboncoinDomObservation } from "./extract.mjs";
import { captureCamofox, classifyCamofox } from "./probe-camofox.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
export const PILOT_SEEDS = Object.freeze(["3305814470", "3312238672", "3308374007"]
  .map((id) => Object.freeze({ id, url: `https://www.leboncoin.fr/ad/voitures/${id}` })));
export const PILOT_PLAN = Object.freeze({ schema_version: "leboncoin-camofox-pilot-plan/v2", seeds: PILOT_SEEDS,
  rounds: 2, between_observations_ms: 30_000, between_rounds_ms: 300_000,
  max_observations: 6, browser_context: "fresh_instance_per_observation", retries: 0, passive_settle_ms: 5000 });
export const PILOT_MANIFEST_SHA256 = hash(JSON.stringify(PILOT_PLAN));
const COMPARABLE_FIELDS = ["title", "brand", "model", "model_year", "price", "mileage", "issuance_date", "vin"];
const isoTime = (value) => typeof value === "string" && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;

/** A structured extraction verdict, separate from general snapshot completeness. */
export function assessPilotObservation(capture, seed, context) {
  const record = capture?.record;
  const legacy = classifyCamofox(record, seed.url);
  let outcome;
  let normalized = null;
  const identity = capture?.identity;
  const expectedSeed = PILOT_SEEDS[(context.ordinal - 1) % PILOT_SEEDS.length];
  if (!expectedSeed || expectedSeed.id !== seed.id || expectedSeed.url !== seed.url
    || context.round !== Math.floor((context.ordinal - 1) / PILOT_SEEDS.length) + 1
    || ![1, 2].includes(context.round) || !Number.isInteger(context.ordinal)
    || context.manifestSha !== PILOT_MANIFEST_SHA256
    || identity?.schema_version !== "leboncoin-camofox-capture/v1"
    || !/^[a-f0-9]{32}$/u.test(identity?.capture_id ?? "")
    || identity.target_url_sha256 !== hash(seed.url) || identity.pilot_round !== context.round
    || identity.pilot_ordinal !== context.ordinal || identity.pilot_manifest_sha256 !== PILOT_MANIFEST_SHA256
    || !isoTime(capture?.started_at) || !isoTime(capture?.completed_at)
    || Date.parse(capture.completed_at) < Date.parse(capture.started_at)) outcome = "identity_mismatch";
  else if (["source_refused", "verification_present"].includes(legacy)) outcome = legacy;
  else if (capture.cleanup?.established !== true || capture.cleanup.remaining !== 0 || capture.process_exited !== true) outcome = "cleanup_failed";
  else if (legacy === "environment_error") outcome = "environment_error";
  else if (record?.navigation?.url !== seed.url || record?.dom?.url !== seed.url || record?.snapshot?.url !== seed.url) outcome = "identity_mismatch";
  else if (record.api_status !== 200 || record.navigation.httpStatus !== 200 || record.error) outcome = "partial_or_unknown";
  else if (record.dom.listing?.titles?.length !== 1 || record.dom.listing?.prices?.length !== 1) outcome = "extraction_incomplete";
  else {
    const projection = { ...record.dom.listing, acquisition: "own_playwright_dom", captured_at: capture.completed_at,
      requested_url: seed.url, url: record.dom.url };
    normalized = extractLeboncoinDomObservation(Buffer.from(JSON.stringify(projection)), { expectedUrl: seed.url, expectedListingId: seed.id });
    outcome = normalized.status === "listing" && normalized.core_fields_observed === true
      && normalized.fields.model_year.status === "observed" && normalized.issues.length === 0
      ? "listing_observed" : "extraction_incomplete";
  }
  const values = normalized?.status === "listing" ? Object.fromEntries(COMPARABLE_FIELDS.map((name) => [name,
    { status: normalized.fields[name].status, ...(normalized.fields[name].status === "observed" ? { value: normalized.fields[name].value } : {}) }])) : null;
  return { outcome, normalized, values, summary: {
    navigation_status: record?.navigation?.httpStatus ?? null, api_status: record?.api_status ?? null,
    navigation_status_scope: "initial_goto_reported_by_camofox",
    general_snapshot_truncated: record?.snapshot?.truncated ?? null,
    passive_settling_observed: record?.settling?.attempted === true,
    passive_waited_ms: record?.settling?.waited_ms ?? null,
    initial_dom_sha256: record?.initial_observation?.dom ? hash(JSON.stringify(record.initial_observation.dom)) : null,
    initial_verification_observed: record?.initial_observation ? classifyCamofox(record.initial_observation, seed.url) === "verification_present" : false,
    final_verification_observed: legacy === "verification_present",
    core_fields_observed: normalized?.core_fields_observed === true,
    model_year_observed: normalized?.fields?.model_year?.status === "observed",
    issues_count: normalized?.issues?.length ?? null,
    criteria_count: normalized?.criteria?.length ?? 0,
    photo_references_count: normalized?.photos?.status === "observed" ? normalized.photos.values.length : 0,
    photos_downloaded: false, normalized_sha256: normalized ? hash(JSON.stringify(normalized)) : null,
    values_sha256: values ? hash(JSON.stringify(values)) : null,
    cleanup_established: capture?.cleanup?.established === true && capture.cleanup.remaining === 0,
    http_response_body: "not_captured", frame_body_coverage: "not_established",
  } };
}

function comparePairs(measurements) {
  return PILOT_SEEDS.map(({ id }) => {
    const first = measurements.find((item) => item.observation.id === id && item.observation.round === 1);
    const second = measurements.find((item) => item.observation.id === id && item.observation.round === 2);
    const both = first?.observation.outcome === "listing_observed" && second?.observation.outcome === "listing_observed";
    const gap = both ? Date.parse(second.observation.started_at) - Date.parse(first.observation.completed_at) : null;
    return { id, gap_ms: gap, repeat_observed: both && gap >= PILOT_PLAN.between_rounds_ms,
      changed_fields: both ? COMPARABLE_FIELDS.filter((name) => JSON.stringify(first.values[name]) !== JSON.stringify(second.values[name])) : null };
  });
}

/** Fixed six-observation campaign. Injection ports are for offline protocol tests. */
export async function runPilot({ observe, wait = delay, now = Date.now, onObservation = async () => {} }) {
  const measurements = [];
  const captureIds = new Set();
  let stopReason = null;
  const started = new Date(now()).toISOString();
  const pause = async (milliseconds) => {
    const before = now();
    await wait(milliseconds);
    return now() - before >= milliseconds;
  };
  for (let round = 1; round <= PILOT_PLAN.rounds && stopReason === null; round += 1) {
    for (let index = 0; index < PILOT_SEEDS.length && stopReason === null; index += 1) {
      const seed = PILOT_SEEDS[index];
      const ordinal = (round - 1) * PILOT_SEEDS.length + index + 1;
      const context = { round, ordinal, manifestSha: PILOT_MANIFEST_SHA256 };
      const waitMs = round > 1 && index === 0 ? PILOT_PLAN.between_rounds_ms : index > 0 ? PILOT_PLAN.between_observations_ms : 0;
      try {
        if (waitMs && !await pause(waitMs)) { stopReason = "interval_not_met"; break; }
      } catch { stopReason = "interval_failed"; break; }
      const attemptStarted = new Date(now()).toISOString();
      let result = null;
      let assessment;
      let previousGap = null;
      try {
        result = await observe({ seed, ...context });
        assessment = assessPilotObservation(result.capture, seed, context);
        const captureId = result.capture?.identity?.capture_id;
        if (captureIds.has(captureId)) assessment = { ...assessment, outcome: "identity_mismatch" };
        captureIds.add(captureId);
        const previous = measurements.at(-1)?.observation;
        if (previous && isoTime(result.capture?.started_at) && isoTime(previous.completed_at)) {
          previousGap = Date.parse(result.capture.started_at) - Date.parse(previous.completed_at);
          if (assessment.outcome === "listing_observed" && previousGap < waitMs) assessment = { ...assessment, outcome: "interval_not_met" };
        }
      } catch { assessment = { outcome: "environment_error", summary: {}, normalized: null, values: null }; }
      const observation = { id: seed.id, round, ordinal, outcome: assessment.outcome,
        started_at: result?.capture?.started_at ?? attemptStarted,
        completed_at: result?.capture?.completed_at ?? new Date(now()).toISOString(),
        identity: result?.capture?.identity ?? null,
        sealed_sha256: result?.receipt?.sealed_sha256 ?? null,
        sealed_bytes: result?.receipt?.sealed_bytes ?? null,
        dom_sha256: result?.receipt?.dom_sha256 ?? null,
        original_receipt_outcome: result?.receipt?.outcome ?? null,
        previous_observation_gap_ms: previousGap,
        ...assessment.summary };
      measurements.push({ observation, values: assessment.values });
      try { await onObservation({ result, assessment, observation }); }
      catch { stopReason = "evidence_output_failed"; }
      if (assessment.outcome !== "listing_observed") stopReason ??= assessment.outcome;
    }
  }
  const observations = measurements.map((item) => item.observation);
  const pairs = comparePairs(measurements);
  const firstLast = observations.find((item) => item.ordinal === 3);
  const secondFirst = observations.find((item) => item.ordinal === 4);
  const roundGap = firstLast && secondFirst ? Date.parse(secondFirst.started_at) - Date.parse(firstLast.completed_at) : null;
  return { schema_version: "leboncoin-camofox-pilot-summary/v2", manifest_sha256: PILOT_MANIFEST_SHA256,
    plan: PILOT_PLAN, started_at: started, completed_at: new Date(now()).toISOString(),
    planned_observations: PILOT_PLAN.max_observations, attempted_observations: observations.length,
    successful_observations: observations.filter((item) => item.outcome === "listing_observed").length,
    not_attempted: PILOT_PLAN.max_observations - observations.length, stop_reason: stopReason,
    round_gap_ms: roundGap, observations, repeat_pairs: pairs,
    small_sample_repeatability_observed: stopReason === null && observations.length === PILOT_PLAN.max_observations
      && pairs.every((item) => item.repeat_observed) && roundGap >= PILOT_PLAN.between_rounds_ms,
    recurring_collection_proven: false, catalog_coverage_proven: false, product_database_updated: false };
}

async function main(args) {
  if (args.length !== 4 || args[0] !== "--runtime" || args[2] !== "--out") throw new Error("invalid_arguments");
  const runtime = resolve(args[1]); const out = resolve(args[3]);
  await mkdir(out, { mode: 0o700 });
  const summary = await runPilot({
    observe: async ({ seed, round, ordinal, manifestSha }) => captureCamofox({ runtime,
      out: join(out, `observation-${ordinal}`), targetUrl: seed.url, pilotContext: { round, ordinal, manifestSha }, settleMs: PILOT_PLAN.passive_settle_ms }),
    onObservation: async ({ result, observation }) => {
      await writeFile(join(out, `observation-${observation.ordinal}.json`), `${JSON.stringify(observation)}\n`, { mode: 0o600, flag: "wx" });
      process.stdout.write(`AUTO_FINDEX_CAMOFOX_PILOT_OBSERVATION ${JSON.stringify(observation)}\n`);
      if (result?.sealed) for (const line of encodeSealedFragments(result.sealed)) process.stdout.write(`${line}\n`);
    },
  });
  await writeFile(join(out, "pilot-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  process.stdout.write(`AUTO_FINDEX_CAMOFOX_PILOT_SUMMARY ${JSON.stringify(summary)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => {
    process.stderr.write("Camofox pilot stopped: setup_or_evidence_failed.\n"); process.exitCode = 2;
  });
}
