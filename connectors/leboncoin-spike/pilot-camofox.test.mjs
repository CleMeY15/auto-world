import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PILOT_MANIFEST_SHA256, PILOT_PLAN, PILOT_SEEDS, assessPilotObservation, runPilot } from "./pilot-camofox.mjs";

const START = Date.parse("2026-11-22T18:00:00.000Z");
const EXPECTED_IDS = ["3305814470", "3312238672", "3308374007"];
const iso = (value) => new Date(value).toISOString();
const digest = (value) => createHash("sha256").update(value).digest("hex");
const context = (round = 1, ordinal = 1) => ({ round, ordinal, manifestSha: PILOT_MANIFEST_SHA256 });

// Historical DOM examples are reused as synthetic offline test input. These
// captures never enter a real collector and do not establish live access.
function capture(seed = PILOT_SEEDS[0], scope = context(), started = START, completed = started + 700) {
  const listing = JSON.parse(readFileSync(new URL(`./fixtures/${seed.id}.json`, import.meta.url), "utf8"));
  return {
    identity: {
      schema_version: "leboncoin-camofox-capture/v1",
      capture_id: String(scope.ordinal).padStart(32, "0"),
      target_url_sha256: digest(seed.url),
      pilot_round: scope.round,
      pilot_ordinal: scope.ordinal,
      pilot_manifest_sha256: scope.manifestSha,
    },
    started_at: iso(started), completed_at: iso(completed),
    record: {
      api_status: 200,
      navigation: { httpStatus: 200, url: seed.url, navigationOk: true },
      dom: { url: seed.url, title: listing.titles[0], text: "Annonce automobile de test",
        frames: [], listing },
      snapshot: { url: seed.url, snapshot: "Annonce automobile de test", truncated: false },
      stage: "observed",
    },
    cleanup: { established: true, remaining: 0 },
    process_exited: true,
  };
}

function harness({ mutate, throwAt, waitScale = 1, callback } = {}) {
  let current = START;
  let active = 0;
  const calls = [];
  const waits = [];
  const callbacks = [];
  const ports = {
    now: () => current,
    async observe(input) {
      assert.equal(active, 0, "observations must not overlap");
      active += 1;
      const started = current;
      calls.push({ ...input, dispatched_at: started });
      await Promise.resolve();
      current += 700;
      active -= 1;
      if (input.ordinal === throwAt) throw new Error("synthetic_observer_failure");
      const observation = capture(input.seed, input, started, current);
      mutate?.(observation, input);
      return { capture: observation, receipt: { outcome: "listing_page_observed" } };
    },
    async wait(milliseconds) {
      assert.equal(active, 0);
      waits.push(milliseconds);
      current += Math.floor(milliseconds * waitScale);
    },
    async onObservation(entry) {
      assert.equal(active, 0);
      await callback?.(entry);
      callbacks.push(entry);
    },
  };
  return { ports, calls, waits, callbacks };
}

test("the pilot fixes three known seeds, two rounds and bounded intervals", () => {
  assert.deepEqual(PILOT_SEEDS.map((seed) => seed.id), EXPECTED_IDS);
  for (const seed of PILOT_SEEDS) assert.equal(seed.url, `https://www.leboncoin.fr/ad/voitures/${seed.id}`);
  assert.equal(PILOT_PLAN.rounds, 2);
  assert.equal(PILOT_PLAN.between_observations_ms, 30_000);
  assert.equal(PILOT_PLAN.between_rounds_ms, 300_000);
  assert.match(PILOT_MANIFEST_SHA256, /^[a-f0-9]{64}$/u);
});

test("each seed is assessed against its own source ID and exact observed values", () => {
  const expected = [[14_699_000, 23_000, 2021], [11_990_000, 29_800, 2020], [6_200_000, 45_000, 2021]];
  for (const [index, seed] of PILOT_SEEDS.entries()) {
    const scope = context(1, index + 1);
    const result = assessPilotObservation(capture(seed, scope), seed, scope);
    assert.equal(result.outcome, "listing_observed");
    assert.equal(result.normalized.source.listing_id, seed.id);
    assert.equal(result.normalized.source.original_url, seed.url);
    assert.equal(result.normalized.fields.price.value.amountMinor, expected[index][0]);
    assert.equal(result.normalized.fields.mileage.value.amount, expected[index][1]);
    assert.equal(result.normalized.fields.model_year.value, expected[index][2]);
    assert.deepEqual(result.normalized.issues, []);
  }
});

test("an accessibility snapshot may be truncated when the independent DOM is complete and valid", () => {
  const observed = capture();
  observed.record.snapshot.truncated = true;
  const result = assessPilotObservation(observed, PILOT_SEEDS[0], context());
  assert.equal(result.outcome, "listing_observed");
  assert.equal(result.normalized.core_fields_observed, true);
});

test("403 and 429 override apparently complete DOM data and API 200", () => {
  for (const status of [403, 429]) {
    const observed = capture();
    observed.record.navigation.httpStatus = status;
    observed.record.dom.text = "Please verify you are human";
    assert.equal(assessPilotObservation(observed, PILOT_SEEDS[0], context()).outcome, "source_refused");
  }
});

test("unknown destination status and 404 are not successful access or a general source refusal", () => {
  for (const status of [null, 404]) {
    const observed = capture();
    observed.record.navigation.httpStatus = status;
    assert.equal(assessPilotObservation(observed, PILOT_SEEDS[0], context()).outcome, "partial_or_unknown");
  }
});

test("visible verification text or a visible verification frame stops qualification", () => {
  for (const change of [
    (record) => { record.dom.text = "Please verify you are human before continuing"; },
    (record) => { record.dom.frames = [{ title: "CAPTCHA", src: "https://geo.captcha-delivery.com/captcha/test", visible: true }]; },
  ]) {
    const observed = capture();
    change(observed.record);
    assert.equal(assessPilotObservation(observed, PILOT_SEEDS[0], context()).outcome, "verification_present");
  }
});

test("capture target, round, ordinal and manifest must match the requested observation", () => {
  for (const [field, value] of [
    ["target_url_sha256", digest(PILOT_SEEDS[1].url)],
    ["pilot_round", 2], ["pilot_ordinal", 2], ["pilot_manifest_sha256", "f".repeat(64)],
  ]) {
    const observed = capture();
    observed.identity[field] = value;
    assert.equal(assessPilotObservation(observed, PILOT_SEEDS[0], context()).outcome, "identity_mismatch", field);
  }
});

test("all three observed URLs must match the requested seed", () => {
  for (const field of ["navigation", "dom", "snapshot"]) {
    const observed = capture();
    observed.record[field].url = PILOT_SEEDS[1].url;
    assert.equal(assessPilotObservation(observed, PILOT_SEEDS[0], context()).outcome, "identity_mismatch", field);
  }
});

test("successful extraction cannot compensate for unestablished cleanup or a running process", () => {
  for (const change of [
    (observed) => { observed.cleanup.established = false; },
    (observed) => { observed.cleanup.remaining = 1; },
    (observed) => { observed.process_exited = false; },
  ]) {
    const observed = capture();
    change(observed);
    assert.equal(assessPilotObservation(observed, PILOT_SEEDS[0], context()).outcome, "cleanup_failed");
  }
});

test("missing brand, model, mileage or model year cannot be filled from the title", () => {
  for (const key of ["u_car_brand", "u_car_model", "mileage", "regdate"]) {
    const observed = capture();
    observed.record.dom.listing.criteria = observed.record.dom.listing.criteria.filter((criterion) => criterion.key !== key);
    assert.equal(assessPilotObservation(observed, PILOT_SEEDS[0], context()).outcome, "extraction_incomplete", key);
  }
});

test("absent, malformed or ambiguous listing data is not a complete extraction", () => {
  for (const change of [
    (record) => { record.dom.listing = null; },
    (record) => { record.dom.listing.titles = []; },
    (record) => { record.dom.listing.titles.push("Un autre titre"); },
    (record) => { record.dom.listing.prices = ["990 €/mois"]; },
    (record) => { record.dom.listing.prices.push("119 900 €"); },
    (record) => { record.dom.listing.criteria.push({ key: "mileage", label: "Kilométrage", value: "24000 km" }); },
  ]) {
    const observed = capture();
    change(observed.record);
    assert.equal(assessPilotObservation(observed, PILOT_SEEDS[0], context()).outcome, "extraction_incomplete");
  }
});

test("an environment failure before navigation is not attributed to the source", () => {
  const observed = capture();
  observed.record = { api_status: null, navigation: null, dom: null, snapshot: null, stage: "create", error: "operation_failed" };
  assert.equal(assessPilotObservation(observed, PILOT_SEEDS[0], context()).outcome, "environment_error");
});

test("the run is sequential, uses six distinct captures and measures each required interval", async () => {
  const { ports, calls, waits, callbacks } = harness();
  const result = await runPilot(ports);
  assert.equal(result.planned_observations, 6);
  assert.equal(result.attempted_observations, 6);
  assert.equal(result.successful_observations, 6);
  assert.equal(result.not_attempted, 0);
  assert.equal(result.stop_reason, null);
  assert.equal(calls.length, 6);
  assert.deepEqual(calls.map(({ seed }) => seed.id), [...EXPECTED_IDS, ...EXPECTED_IDS]);
  assert.deepEqual(calls.map(({ round }) => round), [1, 1, 1, 2, 2, 2]);
  assert.deepEqual(calls.map(({ ordinal }) => ordinal), [1, 2, 3, 4, 5, 6]);
  assert.ok(calls.every(({ manifestSha }) => manifestSha === PILOT_MANIFEST_SHA256));
  assert.deepEqual(waits, [30_000, 30_000, 300_000, 30_000, 30_000]);
  assert.equal(callbacks.length, 6);
  for (let index = 1; index < result.observations.length; index += 1) {
    const current = result.observations[index];
    const previous = result.observations[index - 1];
    const minimum = current.round === previous.round ? 30_000 : 300_000;
    const gap = Date.parse(current.started_at) - Date.parse(previous.completed_at);
    assert.ok(gap >= minimum);
    assert.equal(current.previous_observation_gap_ms, gap);
  }
  assert.equal(result.repeat_pairs.length, 3);
  assert.ok(result.repeat_pairs.every((pair) => pair.repeat_observed));
  assert.equal(result.small_sample_repeatability_observed, true);
});

test("a refusal stops the entire pilot without retrying or moving to another seed", async () => {
  const { ports, calls, waits } = harness({ mutate(observed, input) {
    if (input.ordinal === 2) observed.record.navigation.httpStatus = 403;
  } });
  const result = await runPilot(ports);
  assert.equal(calls.length, 2);
  assert.equal(result.attempted_observations, 2);
  assert.equal(result.successful_observations, 1);
  assert.equal(result.not_attempted, 4);
  assert.equal(result.stop_reason, "source_refused");
  assert.deepEqual(waits, [30_000]);
  assert.equal(result.small_sample_repeatability_observed, false);
});

test("incomplete extraction or cleanup stops globally after the first attempt", async () => {
  for (const change of [
    (observed) => { observed.record.dom.listing.prices = []; },
    (observed) => { observed.cleanup.established = false; },
  ]) {
    const { ports, calls, waits } = harness({ mutate: change });
    const result = await runPilot(ports);
    assert.equal(calls.length, 1);
    assert.equal(result.attempted_observations, 1);
    assert.equal(result.successful_observations, 0);
    assert.equal(result.not_attempted, 5);
    assert.deepEqual(waits, []);
    assert.equal(result.small_sample_repeatability_observed, false);
  }
});

test("an observer exception counts the attempted dispatch and stops without retry", async () => {
  const { ports, calls, waits } = harness({ throwAt: 2 });
  const result = await runPilot(ports);
  assert.equal(calls.length, 2);
  assert.equal(result.attempted_observations, 2);
  assert.equal(result.successful_observations, 1);
  assert.equal(result.not_attempted, 4);
  assert.equal(result.stop_reason, "environment_error");
  assert.deepEqual(waits, [30_000]);
  assert.equal(result.small_sample_repeatability_observed, false);
});

test("returning early from wait does not authorize an early second observation", async () => {
  const { ports, calls } = harness({ waitScale: 0.5 });
  const result = await runPilot(ports);
  assert.equal(calls.length, 1);
  assert.equal(result.attempted_observations, 1);
  assert.equal(result.stop_reason, "interval_not_met");
  assert.equal(result.small_sample_repeatability_observed, false);
});

test("capture timestamps must also establish the interval between observed listings", async () => {
  const { ports, calls } = harness({ mutate(observed, input) {
    if (input.ordinal === 2) {
      observed.started_at = iso(START + 700 + 15_000);
      observed.completed_at = iso(START + 700 + 15_700);
    }
  } });
  const result = await runPilot(ports);
  assert.equal(calls.length, 2);
  assert.equal(result.stop_reason, "interval_not_met");
  assert.equal(result.small_sample_repeatability_observed, false);
});

test("reused capture identity cannot stand in for a new observation", async () => {
  const { ports, calls } = harness({ mutate(observed) { observed.identity.capture_id = "0".repeat(31) + "1"; } });
  const result = await runPilot(ports);
  assert.equal(calls.length, 2);
  assert.equal(result.successful_observations, 1);
  assert.equal(result.stop_reason, "identity_mismatch");
  assert.equal(result.small_sample_repeatability_observed, false);
});

test("a failed wait stops before dispatching the next observation", async () => {
  const { ports, calls } = harness();
  ports.wait = async () => { throw new Error("synthetic_wait_failure"); };
  const result = await runPilot(ports);
  assert.equal(calls.length, 1);
  assert.equal(result.attempted_observations, 1);
  assert.equal(result.not_attempted, 5);
  assert.equal(result.stop_reason, "interval_failed");
  assert.equal(result.small_sample_repeatability_observed, false);
});

test("failed evidence publication stops without a further wait or observation", async () => {
  const { ports, calls, waits } = harness({ callback() { throw new Error("synthetic_evidence_failure"); } });
  const result = await runPilot(ports);
  assert.equal(calls.length, 1);
  assert.deepEqual(waits, []);
  assert.equal(result.not_attempted, 5);
  assert.equal(result.stop_reason, "evidence_output_failed");
  assert.equal(result.small_sample_repeatability_observed, false);
});

test("a changed price is recorded without rejecting successful repeat observations", async () => {
  const { ports } = harness({ mutate(observed, input) {
    if (input.round === 2 && input.seed.id === EXPECTED_IDS[0]) observed.record.dom.listing.prices = ["145 990 €"];
  } });
  const result = await runPilot(ports);
  assert.equal(result.successful_observations, 6);
  assert.equal(result.small_sample_repeatability_observed, true);
  const pair = result.repeat_pairs.find((entry) => entry.id === EXPECTED_IDS[0]);
  assert.equal(pair.repeat_observed, true);
  assert.ok(pair.changed_fields.includes("price"));
});

test("the observation callback is awaited before any subsequent wait or dispatch", async () => {
  let release;
  let announce;
  const gate = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { announce = resolve; });
  let callbacks = 0;
  const { ports, calls, waits } = harness({ async callback() {
    callbacks += 1;
    if (callbacks === 1) { announce(); await gate; }
  } });
  const pending = runPilot(ports);
  await entered;
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.deepEqual(waits, []);
  release();
  const result = await pending;
  assert.equal(result.successful_observations, 6);
  assert.equal(callbacks, 6);
});
