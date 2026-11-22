import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { inspectSealedEnvelope, loadDiagnosticPublicKey, sealAccessCapture } from "./access-diagnostic.mjs";
import { extractLeboncoinDomObservation } from "./extract.mjs";
import { FLOW_BUDGET_MS, MAX_FLOW_BYTES, nativeFlowIdentity, projectNativeFlow, readInitialBody, trackNativeFlow, visibleFlowStop } from "./native-flow.mjs";
import { runNativeFlowProbe } from "./probe-native-flow.mjs";

const TARGET_URL = "https://www.leboncoin.fr/ad/voitures/3305814470";
const START = Date.parse("2026-11-22T15:00:00.000Z");
const ENV = { GITHUB_SHA: "a".repeat(40), GITHUB_RUN_ID: "123456789", GITHUB_RUN_ATTEMPT: "1" };
const RUNTIME = { node: "22.23.2", platform: "linux", arch: "x64" };
const iso = (ms) => new Date(ms).toISOString();
const request = (index, url = TARGET_URL, frameId = "main") => ({ type: "Document", frameId,
  requestId: `request-${index}`, loaderId: `loader-${index}`, request: { url, method: "GET" } });
const response = (index, status, url = TARGET_URL, frameId = "main") => ({ type: "Document", frameId,
  requestId: `request-${index}`, loaderId: `loader-${index}`, response: { url, status, headers: { "Content-Type": "text/html", "Set-Cookie": "PRIVATE_COOKIE" } } });
const frame = (text, overrides = {}) => ({ role: "verification", state: "observed", url: "https://geo.captcha-delivery.com/PRIVATE_QUERY",
  title: "", text, visible_control: false, visible_checkbox: false, visible_slider: false, visible_canvas: false,
  listing_title_visible: false, ...overrides });

function flow() {
  let now = START;
  const state = trackNativeFlow({ frameId: "main", now: () => now, started: START });
  return { state, setNow: (value) => { now = value; } };
}

// Synthetic execution assembled from a historical DOM fixture. It is only a
// deterministic contract test and never supplied to the actual CLI/browser.
function fixture() {
  const { state, setNow } = flow();
  assert.equal(state.permitNavigation(TARGET_URL), true);
  state.request(request(1)); state.response(response(1, 403)); state.finished({ requestId: "request-1" });
  state.request(request("iframe", "https://geo.captcha-delivery.com/PRIVATE_QUERY", "child"));
  setNow(START + 3000);
  assert.equal(state.permitNavigation(TARGET_URL), true);
  state.request(request(2)); state.response(response(2, 200)); state.finished({ requestId: "request-2" });
  const runtime = { playwright_version: "1.64.0", chromium_version: "156.0.8078.4", headless: true, chromium_sandbox: true,
    context: "fresh_nonpersistent", shared_profile: false };
  const snapshot = JSON.parse(readFileSync(new URL("./fixtures/3305814470.json", import.meta.url), "utf8"));
  snapshot.acquisition = "own_playwright_dom"; snapshot.runtime = runtime; snapshot.captured_at = iso(START + 3500);
  snapshot.transport = { engine: "playwright_chromium", navigation_status: 200 };
  const snapshotJson = `${JSON.stringify(snapshot)}\n`;
  const normalized = extractLeboncoinDomObservation(Buffer.from(snapshotJson), { expectedUrl: TARGET_URL, expectedListingId: "3305814470" });
  return { state, setNow, record: { schema_version: "leboncoin-native-flow-capture/v1", identity: nativeFlowIdentity(ENV, "b".repeat(32)),
    started_at: iso(START), completed_at: iso(START + 4000), outcome: "extracted", runtime, goto_calls: 1,
    documents: state.documents(), counts: state.counts(), verification_frame_observed: state.verificationSeen(),
    initial_body: { status: "unavailable" }, extraction_status: "listing", snapshot_json: snapshotJson, normalized,
    capture_document_token: state.token(), dom_sample: { kind: "rendered_dom_sample", sampled_at: iso(START + 3400),
      frames: [frame("PRIVATE_TITLE", { role: "main", url: TARGET_URL, listing_title_visible: true })],
      omitted_frames: 0, inaccessible_frames: 0, coverage_complete: true } } };
}

test("403 then native verification and one exact automatic return preserve both documents and allow a valid extraction", () => {
  const { record } = fixture();
  const receipt = projectNativeFlow(record, { env: ENV, runtime: RUNTIME });
  assert.equal(receipt.collection_success, true);
  assert.equal(receipt.initial_status, 403);
  assert.equal(receipt.return_status, 200);
  assert.notEqual(receipt.initial_requested_at, receipt.return_requested_at);
  assert.equal(receipt.goto_calls, 1);
  assert.equal(receipt.main_documents_observed, 2);
  assert.equal(receipt.verification_frame_observed, true);
  assert.equal(JSON.stringify(receipt).includes("PRIVATE_"), false);
  assert.equal(JSON.stringify(record.documents).includes("PRIVATE_COOKIE"), false);
});

test("ordinary automatic verification text and a captcha hostname alone do not require interaction", () => {
  assert.equal(visibleFlowStop([frame("Please wait while we verify your browser.")]), null);
  assert.equal(visibleFlowStop([frame("Please hold on while we verify your browser.")]), null);
  assert.equal(visibleFlowStop([frame("", { url: "https://geo.captcha-delivery.com/captcha/?PRIVATE_QUERY" })]), null);
  assert.equal(visibleFlowStop([frame("Captcha", { state: "unavailable" })]), null);
});

test("visible human requests, checkbox and slider puzzle stop without any action", () => {
  for (const observed of [
    frame("Drag the slider to complete the puzzle"),
    frame("Verify you are human", { visible_control: true }),
    frame("Press and hold to verify you are human"),
    frame("Maintenez le bouton appuyé pour vérifier que vous êtes humain"),
    frame("I am not a robot", { visible_checkbox: true }),
    frame("Je ne suis pas un robot", { visible_checkbox: true }),
    frame("", { visible_slider: true, visible_canvas: true }),
  ]) assert.equal(visibleFlowStop([observed]), "interaction_required");
  assert.equal(visibleFlowStop([frame("You have been blocked")]), "explicit_refusal");
});

test("429 on the main document or the observed verification origin stops immediately", () => {
  for (const verification of [false, true]) {
    const { state } = flow(); state.request(request(1));
    state.response(verification ? response("iframe", 429, "https://ct.captcha-delivery.com/PRIVATE_QUERY", "child") : response(1, 429));
    assert.equal(state.outcome(), "rate_limited");
    assert.equal(state.permitNavigation(TARGET_URL), false);
  }
});

test("an unexpected destination, redirect, reused identity or second return invalidates the flow", () => {
  const cases = [
    (state) => state.request(request(3)),
    (state) => state.request(request(3, "https://invalid.example/PRIVATE_QUERY")),
    (state) => state.request({ ...request(3), redirectResponse: { status: 302 } }),
    (state) => state.request(request(2, TARGET_URL, "child")),
  ];
  for (const change of cases) {
    const { state, record } = fixture(); const token = state.token(); change(state);
    assert.equal(state.unchanged(token), false);
    record.outcome = state.outcome(); record.counts = state.counts();
    assert.equal(projectNativeFlow(record, { env: ENV, runtime: RUNTIME }).collection_success, false);
  }
  const { state } = fixture();
  assert.equal(state.permitNavigation(TARGET_URL), false);
  assert.equal(state.outcome(), "unexpected_navigation");
});

test("popup and loader mismatch stop and cannot be counted as extraction", () => {
  const { state } = flow(); state.request(request(1));
  state.response({ ...response(1, 200), loaderId: "wrong-loader" });
  assert.equal(state.outcome(), "identity_mismatch");
  const second = flow().state; second.popup();
  assert.equal(second.outcome(), "unexpected_popup");
});

test("initial body is not fetched after a redirect reuses its request id", async () => {
  const { state } = flow(); state.request(request(1)); state.response(response(1, 403)); state.finished({ requestId: "request-1" });
  state.request({ ...request(1), redirectResponse: { status: 302 } });
  const result = await readInitialBody({ send: () => assert.fail("ambiguous body must not be read") }, state, () => 1000);
  assert.deepEqual(result, { status: "identity_rejected" });
});

test("a redirect during the passive body read discards bytes, but a distinct native return preserves attribution", async () => {
  for (const redirected of [true, false]) {
    const { state } = flow(); state.request(request(1)); state.response(response(1, 403)); state.finished({ requestId: "request-1" });
    let finish;
    const promise = readInitialBody({ send: () => new Promise((resolve) => { finish = resolve; }) }, state, () => 1000);
    if (redirected) state.request({ ...request(1), redirectResponse: { status: 302 } });
    else { state.request(request(2)); state.response(response(2, 200)); }
    finish({ body: "INITIAL_PRIVATE_BODY", base64Encoded: false });
    const result = await promise;
    assert.equal(result.status, redirected ? "identity_rejected" : "captured");
    if (redirected) assert.equal(result.base64, undefined);
    else assert.equal(Buffer.from(result.base64, "base64").toString("utf8"), "INITIAL_PRIVATE_BODY");
  }
});

test("the automatic return never resets the global thirty-second budget", () => {
  const { state, setNow } = fixture();
  setNow(START + 29_000);
  assert.equal(state.remaining(), 1000);
  setNow(START + FLOW_BUDGET_MS);
  assert.equal(state.remaining(), 0);
  assert.equal(state.permitNavigation(TARGET_URL), false);
  assert.equal(state.outcome(), "verification_timeout");
});

test("late navigation changes after DOM extraction invalidate the success token", () => {
  const { record, state } = fixture();
  const token = record.capture_document_token;
  state.request(request(3));
  assert.equal(state.unchanged(token), false);
  record.outcome = state.outcome(); record.counts = state.counts();
  assert.equal(projectNativeFlow(record, { env: ENV, runtime: RUNTIME }).collection_success, false);
});

test("200 alone, missing fields, incomplete DOM coverage or an old cloud fixture do not qualify", () => {
  const mutations = [
    (record) => { record.snapshot_json = null; record.normalized = null; },
    (record) => { record.dom_sample.coverage_complete = false; record.dom_sample.omitted_frames = 1; },
    (record) => { record.dom_sample.coverage_complete = false; record.dom_sample.inaccessible_frames = 1; },
    (record) => { record.dom_sample.frames[0].listing_title_visible = false; },
    (record) => { record.capture_document_token = "wrong-token"; },
    (record) => { record.documents[1].frame_id = "different-frame"; },
    (record) => { const snapshot = JSON.parse(record.snapshot_json); snapshot.prices = []; record.snapshot_json = JSON.stringify(snapshot); },
    (record) => { record.snapshot_json = readFileSync(new URL("./fixtures/3305814470.json", import.meta.url), "utf8"); },
  ];
  for (const change of mutations) {
    const { record } = fixture(); change(record);
    assert.equal(projectNativeFlow(record, { env: ENV, runtime: RUNTIME }).collection_success, false);
  }
});

test("private size includes actual JSON escaping and cannot be silently accepted above128KiB", async () => {
  const { record } = fixture();
  record.extra = "\"".repeat(MAX_FLOW_BYTES / 2);
  assert.ok(Buffer.byteLength(JSON.stringify(record)) > MAX_FLOW_BYTES);
  assert.equal(projectNativeFlow(record, { env: ENV, runtime: RUNTIME }).outcome, "invalid_evidence");
  assert.throws(() => sealAccessCapture(record, { key: {}, fingerprint: "a".repeat(64) }), /seal_failed/u);
});

test("public receipt omits source text, frame URLs, arbitrary headers and source fields", () => {
  const { record } = fixture();
  record.private_token = "PRIVATE_TOKEN"; record.runtime.extra = "PRIVATE_RUNTIME";
  record.documents[0].headers = { values: { server: "PRIVATE_HEADER" }, limited: false };
  const receipt = projectNativeFlow(record, { env: ENV, runtime: RUNTIME });
  assert.equal(receipt.collection_success, true);
  for (const value of ["PRIVATE_", "Porsche", "leboncoin.fr", "captcha-delivery", "Tourcoing", "14699000"]) {
    assert.equal(JSON.stringify(receipt).includes(value), false);
  }
});

test("one encrypted evidence record is bound to the native purpose and actual run window", async () => {
  const { record } = fixture();
  const sealedBytes = sealAccessCapture(record, await loadDiagnosticPublicKey());
  assert.equal(inspectSealedEnvelope(sealedBytes, nativeFlowIdentity(ENV, record.identity.capture_id)).bytes, sealedBytes.length);
  let calls = 0; let now = START;
  const result = await runNativeFlowProbe({ env: ENV, runtime: RUNTIME, clock: () => now, prepare: async () => undefined,
    run: async () => { calls += 1; now += 4000; return { execution: "finished", exitCode: 0, record, sealedBytes }; } });
  assert.equal(calls, 1);
  assert.equal(result.receipt.evidence_status, "sealed");
  assert.equal(result.receipt.collection_success, true);
});

test("refusal, timeout or child error never dispatches another browser", async () => {
  for (const execution of ["timeout", "error", "finished"]) {
    let calls = 0; let now = START;
    const result = await runNativeFlowProbe({ env: ENV, runtime: RUNTIME, clock: () => now, prepare: async () => undefined,
      run: async () => { calls += 1; now += 100; return { execution, exitCode: 2 }; } });
    assert.equal(calls, 1);
    assert.equal(result.receipt.collection_success, false);
  }
});
