import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canObserveInterstitial, classifyCamofox, probeOnce } from "./probe-camofox.mjs";

const TARGET_URL = "https://www.leboncoin.fr/ad/voitures/3312238672";
const START = Date.parse("2026-11-22T19:00:00.000Z");
const iso = (time) => new Date(time).toISOString();
const clone = (value) => globalThis.structuredClone(value);

// Fabricated execution records use an existing DOM fixture; none is evidence of
// a live browser, a solved verification or permission to collect a source.
function initialRecord() {
  const listing = JSON.parse(readFileSync(new URL("./fixtures/3312238672.json", import.meta.url), "utf8"));
  return {
    api_status: 200,
    navigation: { httpStatus: 200, url: TARGET_URL, navigationOk: true },
    dom: {
      url: TARGET_URL, title: listing.titles[0], text: "Annonce automobile de test",
      listing,
      frames: [{ title: "Verification system", src: "https://geo.captcha-delivery.com/interstitial/?test=1", visible: true }],
    },
    snapshot: { url: TARGET_URL, snapshot: "Observation initiale de test", truncated: false },
    stage: "observed",
  };
}

function finalRecord() {
  const result = initialRecord();
  result.dom.frames = [];
  result.dom.text = "Observation finale de test";
  result.dom.listing.prices = ["118 900 €"];
  result.snapshot.snapshot = "Observation finale de test";
  return result;
}

function fakeSession({ initial = initialRecord(), final = finalRecord(), elapsed = 5000, failAt = null, abortOnWait = false } = {}) {
  let current = START;
  let snapshots = 0;
  let evaluations = 0;
  const calls = [];
  const waits = [];
  const controller = new globalThis.AbortController();
  const api = async (method, path, body, timeout) => {
    calls.push({ method, path, body, timeout });
    if (method === "POST" && path === "/tabs") {
      return { status: initial.api_status, data: { ok: true, tabId: "same-tab", ...initial.navigation } };
    }
    if (method === "GET" && path.startsWith("/tabs/same-tab/snapshot")) {
      snapshots += 1;
      if (snapshots === 2 && failAt === "snapshot") throw new Error("synthetic_snapshot_read_failure");
      return { status: 200, data: clone((snapshots === 1 ? initial : final).snapshot) };
    }
    if (method === "POST" && path === "/tabs/same-tab/evaluate") {
      evaluations += 1;
      if (evaluations === 2 && failAt === "evaluate") throw new Error("synthetic_dom_read_failure");
      return { status: 200, data: { ok: true, result: clone((evaluations === 1 ? initial : final).dom) } };
    }
    throw new Error("unexpected_test_api_operation");
  };
  const options = {
    settleMs: 5000,
    now: () => current,
    signal: controller.signal,
    async wait(milliseconds, value, waitOptions) {
      assert.equal(value, undefined);
      assert.equal(waitOptions.signal, controller.signal, "the wait must keep the original global signal");
      waits.push(milliseconds);
      current += elapsed;
      if (abortOnWait) controller.abort(new Error("synthetic_global_deadline"));
    },
  };
  return { api, options, calls, waits, controller };
}

function assertOneTabAndReadsOnly(calls) {
  assert.equal(calls.filter((call) => call.method === "POST" && call.path === "/tabs").length, 1);
  for (const call of calls) {
    assert.ok((call.method === "POST" && ["/tabs", "/tabs/same-tab/evaluate"].includes(call.path))
      || (call.method === "GET" && call.path.startsWith("/tabs/same-tab/snapshot")), call.path);
  }
}

test("only the exact visible interstitial with complete normalized listing data is eligible", () => {
  assert.equal(canObserveInterstitial(initialRecord(), TARGET_URL, iso(START)), true);
  const observed = initialRecord();
  observed.snapshot.truncated = true;
  assert.equal(canObserveInterstitial(observed, TARGET_URL, iso(START)), true);
});

test("a missing or hidden interstitial does not start a settling observation", () => {
  for (const frames of [[], [{ ...initialRecord().dom.frames[0], visible: false }]]) {
    const observed = initialRecord();
    observed.dom.frames = frames;
    assert.equal(canObserveInterstitial(observed, TARGET_URL, iso(START)), false);
  }
});

test("a lookalike host, another path, credentials, port or insecure scheme is ineligible", () => {
  for (const src of [
    "https://geo.captcha-delivery.com.example.invalid/interstitial/",
    "https://ct.captcha-delivery.com/interstitial/",
    "https://geo.captcha-delivery.com/captcha/",
    "https://geo.captcha-delivery.com/interstitial",
    "https://person@geo.captcha-delivery.com/interstitial/",
    "https://geo.captcha-delivery.com:8443/interstitial/",
    "http://geo.captcha-delivery.com/interstitial/",
    "not a URL",
  ]) {
    const observed = initialRecord();
    observed.dom.frames[0].src = src;
    assert.equal(canObserveInterstitial(observed, TARGET_URL, iso(START)), false, src);
  }
});

test("API success cannot compensate for a missing, refused or non-200 destination status", () => {
  for (const status of [null, 403, 429, 404]) {
    const observed = initialRecord();
    observed.navigation.httpStatus = status;
    assert.equal(canObserveInterstitial(observed, TARGET_URL, iso(START)), false);
  }
  const observed = initialRecord();
  observed.api_status = 500;
  assert.equal(canObserveInterstitial(observed, TARGET_URL, iso(START)), false);
});

test("navigation, DOM and snapshot URLs must all match the requested listing", () => {
  for (const field of ["navigation", "dom", "snapshot"]) {
    const observed = initialRecord();
    observed[field].url = "https://www.leboncoin.fr/ad/voitures/3305814470";
    assert.equal(canObserveInterstitial(observed, TARGET_URL, iso(START)), false, field);
  }
});

test("explicit refusal or human interaction in observed text prohibits passive settling", () => {
  for (const text of ["You have been blocked", "Access is temporarily restricted", "Press and hold to verify you are human",
    "Verify you are human", "I am not a robot", "Je ne suis pas un robot"]) {
    const observed = initialRecord();
    observed.dom.text = text;
    assert.equal(canObserveInterstitial(observed, TARGET_URL, iso(START)), false, text);
  }
});

test("another visible verification control is not covered by the interstitial exception", () => {
  for (const frame of [
    { title: "reCAPTCHA", src: "https://www.google.com/recaptcha/test", visible: true },
    { title: "Verify you are human", src: "https://verification.example.invalid/frame", visible: true },
    { title: "Verification system", src: "https://geo.captcha-delivery.com/captcha/test", visible: true },
  ]) {
    const observed = initialRecord();
    observed.dom.frames.push(frame);
    assert.equal(canObserveInterstitial(observed, TARGET_URL, iso(START)), false);
  }
});

test("missing core fields or model year cannot be inferred from an otherwise complete page", () => {
  for (const key of ["u_car_brand", "u_car_model", "mileage", "regdate"]) {
    const observed = initialRecord();
    observed.dom.listing.criteria = observed.dom.listing.criteria.filter((criterion) => criterion.key !== key);
    assert.equal(canObserveInterstitial(observed, TARGET_URL, iso(START)), false, key);
  }
});

test("malformed, missing or ambiguous listing values cannot unlock an extra observation", () => {
  for (const change of [
    (record) => { record.dom.listing = null; },
    (record) => { record.dom.listing.titles = []; },
    (record) => { record.dom.listing.titles.push("Autre annonce"); },
    (record) => { record.dom.listing.prices = ["990 €/mois"]; },
    (record) => { record.dom.listing.prices.push("120 000 €"); },
    (record) => { record.dom.listing.criteria.push({ key: "mileage", label: "Kilométrage", value: "30000 km" }); },
    (record) => { record.dom.listing.criteria.push({ key: "vin", label: "VIN", value: "INVALID" }); },
  ]) {
    const observed = initialRecord();
    change(observed);
    assert.equal(canObserveInterstitial(observed, TARGET_URL, iso(START)), false);
  }
});

test("probeOnce retains its original no-wait behavior when settling is not requested", async () => {
  const { api, calls, waits } = fakeSession();
  const observed = await probeOnce(api, TARGET_URL);
  assert.equal(classifyCamofox(observed, TARGET_URL), "verification_present");
  assert.deepEqual(waits, []);
  assert.equal(calls.length, 3);
  assertOneTabAndReadsOnly(calls);
});

test("one measured five-second wait can observe disappearance in the same tab", async () => {
  const initial = initialRecord();
  const final = finalRecord();
  const { api, options, calls, waits } = fakeSession({ initial, final });
  const observed = await probeOnce(api, TARGET_URL, options);
  assert.equal(classifyCamofox(observed, TARGET_URL), "listing_page_observed");
  assert.deepEqual(waits, [5000]);
  assert.equal(calls.length, 5);
  assertOneTabAndReadsOnly(calls);
  assert.deepEqual(observed.initial_observation.dom, initial.dom);
  assert.deepEqual(observed.initial_observation.snapshot, initial.snapshot);
  assert.deepEqual(observed.dom, final.dom);
  assert.deepEqual(observed.snapshot, final.snapshot);
  assert.notDeepEqual(observed.initial_observation.dom.listing.prices, observed.dom.listing.prices);
  assert.equal(observed.settling.attempted, true);
  assert.equal(observed.settling.wait_ms, 5000);
  assert.equal(observed.settling.waited_ms, 5000);
  assert.equal(observed.settling.started_at, iso(START));
  assert.equal(observed.settling.completed_at, iso(START + 5000));
});

test("a persisting interstitial remains verification and never receives a second wait", async () => {
  const { api, options, calls, waits } = fakeSession({ final: initialRecord() });
  const observed = await probeOnce(api, TARGET_URL, options);
  assert.equal(classifyCamofox(observed, TARGET_URL), "verification_present");
  assert.deepEqual(waits, [5000]);
  assert.equal(calls.length, 5);
  assertOneTabAndReadsOnly(calls);
});

test("403 or a human request in the first observation does not wait or reread", async () => {
  for (const change of [
    (record) => { record.navigation.httpStatus = 403; },
    (record) => { record.dom.text = "Press and hold to verify you are human"; },
  ]) {
    const initial = initialRecord();
    change(initial);
    const { api, options, calls, waits } = fakeSession({ initial });
    const observed = await probeOnce(api, TARGET_URL, options);
    assert.ok(["source_refused", "verification_present"].includes(classifyCamofox(observed, TARGET_URL)));
    assert.deepEqual(waits, []);
    assert.equal(calls.length, 3);
    assertOneTabAndReadsOnly(calls);
  }
});

test("an explicit refusal found in the final read is preserved as a refusal", async () => {
  const final = finalRecord();
  final.dom.text = "You have been blocked";
  const { api, options, calls, waits } = fakeSession({ final });
  const observed = await probeOnce(api, TARGET_URL, options);
  assert.equal(classifyCamofox(observed, TARGET_URL), "source_refused");
  assert.deepEqual(waits, [5000]);
  assert.equal(calls.length, 5);
  assertOneTabAndReadsOnly(calls);
});

test("an interstitial replaced by another verification stays unqualified after the one wait", async () => {
  const final = finalRecord();
  final.dom.frames = [{ title: "Verification system", src: "https://geo.captcha-delivery.com/captcha/test", visible: true }];
  const { api, options, calls, waits } = fakeSession({ final });
  const observed = await probeOnce(api, TARGET_URL, options);
  assert.equal(classifyCamofox(observed, TARGET_URL), "verification_present");
  assert.deepEqual(waits, [5000]);
  assert.equal(calls.length, 5);
  assertOneTabAndReadsOnly(calls);
});

test("a different final listing URL cannot reuse the initial listing identity", async () => {
  const final = finalRecord();
  final.dom.url = "https://www.leboncoin.fr/ad/voitures/3305814470";
  const { api, options, calls, waits } = fakeSession({ final });
  const observed = await probeOnce(api, TARGET_URL, options);
  assert.notEqual(classifyCamofox(observed, TARGET_URL), "listing_page_observed");
  assert.equal(observed.initial_observation.dom.url, TARGET_URL);
  assert.equal(observed.dom.url, final.dom.url);
  assert.deepEqual(waits, [5000]);
  assertOneTabAndReadsOnly(calls);
});

test("an early wait return is an error and does not trigger the second read", async () => {
  const { api, options, calls, waits } = fakeSession({ elapsed: 4999 });
  const observed = await probeOnce(api, TARGET_URL, options);
  assert.ok(observed.error);
  assert.notEqual(classifyCamofox(observed, TARGET_URL), "listing_page_observed");
  assert.deepEqual(waits, [5000]);
  assert.equal(calls.length, 3);
  assertOneTabAndReadsOnly(calls);
});

test("global abort during the wait prevents rereading and does not create a renewed budget", async () => {
  const { api, options, calls, waits, controller } = fakeSession({ abortOnWait: true });
  const observed = await probeOnce(api, TARGET_URL, options);
  assert.equal(controller.signal.aborted, true);
  assert.ok(observed.error);
  assert.notEqual(classifyCamofox(observed, TARGET_URL), "listing_page_observed");
  assert.deepEqual(waits, [5000]);
  assert.equal(calls.length, 3);
  assertOneTabAndReadsOnly(calls);
});

test("a failed snapshot or DOM reread is an error without fallback to the initial observation", async () => {
  for (const failAt of ["snapshot", "evaluate"]) {
    const { api, options, calls, waits } = fakeSession({ failAt });
    const observed = await probeOnce(api, TARGET_URL, options);
    assert.ok(observed.error, failAt);
    assert.ok(observed.initial_observation?.dom, failAt);
    assert.notDeepEqual(observed.dom, observed.initial_observation.dom, failAt);
    assert.notEqual(classifyCamofox(observed, TARGET_URL), "listing_page_observed", failAt);
    assert.deepEqual(waits, [5000]);
    assert.ok(calls.length <= 5);
    assertOneTabAndReadsOnly(calls);
  }
});

test("a wait rejected by the original abort signal cannot fall through to another read", async () => {
  const { api, options, calls, controller } = fakeSession();
  let waits = 0;
  options.wait = async (milliseconds, value, waitOptions) => {
    waits += 1;
    assert.equal(milliseconds, 5000);
    assert.equal(value, undefined);
    assert.equal(waitOptions.signal, controller.signal);
    controller.abort();
    const error = new Error("synthetic_aborted_wait");
    error.name = "AbortError";
    throw error;
  };
  const observed = await probeOnce(api, TARGET_URL, options);
  assert.equal(waits, 1);
  assert.ok(observed.error);
  assert.ok(observed.initial_observation?.dom);
  assert.notDeepEqual(observed.dom, observed.initial_observation.dom);
  assert.notEqual(classifyCamofox(observed, TARGET_URL), "listing_page_observed");
  assert.equal(calls.length, 3);
  assertOneTabAndReadsOnly(calls);
});
