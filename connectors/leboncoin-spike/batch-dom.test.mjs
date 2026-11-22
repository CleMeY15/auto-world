import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { assessBatchRecord, canonicalDiscoveryUrl, canonicalListingUrl, readBatchPage } from "./batch-dom.mjs";

const TARGET = "https://www.leboncoin.fr/ad/voitures/3305814470";
const START = "https://www.leboncoin.fr/c/voitures";
const TIME = "2026-11-22T19:00:00.000Z";
const fixture = JSON.parse(await readFile(new URL("./fixtures/3305814470.json", import.meta.url), "utf8"));

function record(url = TARGET) {
  return { api_status: 200, navigation: { httpStatus: 200, url, navigationOk: true },
    dom: { url, title: "Page de test", text: "Annonce affichée", listing: globalThis.structuredClone(fixture),
      viewport: { width: 1000, height: 800 }, frames: [], frame_count: 0, frames_truncated: false,
      targets: { title: [], price: [] }, links: [], links_truncated: false,
      page_status: { texts: [], notice_only: false } } };
}

function frame(overrides = {}) {
  return { index: 0, title: "Verification system", src: "https://geo.captcha-delivery.com/interstitial/",
    visible: true, in_viewport: true, viewport_area_ratio: 0.01,
    hit_test_points: [{ top_is_frame: false }], ...overrides };
}

test("listing canonicalization preserves source identity and only removes tracking query/fragment", () => {
  assert.equal(canonicalListingUrl(`${TARGET}?tracking=value#photo`), TARGET);
  for (const value of [TARGET.replace("https:", "http:"), TARGET.replace("www.leboncoin.fr", "leboncoin.fr"),
    TARGET.replace("www.leboncoin.fr", "www.leboncoin.fr.evil.test"), TARGET.replace("www.", "user@www."),
    TARGET.replace("www.leboncoin.fr", "www.leboncoin.fr:443"),
    TARGET.replace("/ad/voitures/", "/ad/motos/"), `${TARGET}/`, `${TARGET}x`, `${TARGET}:443`,
    `${TARGET.replace("3305814470", "0")}`, `${TARGET.replace("3305814470", "001")}`, null, "", ` ${TARGET}`]) {
    assert.equal(canonicalListingUrl(value), null, String(value));
  }
});

test("discovery accepts the verified category and observed bounded category pagination only", () => {
  assert.equal(canonicalDiscoveryUrl(`${START}/#haut`), START);
  assert.equal(canonicalDiscoveryUrl(`${START}?page=2`), `${START}?page=2`);
  assert.equal(canonicalDiscoveryUrl("https://www.leboncoin.fr/recherche?page=3&category=2#top"),
    "https://www.leboncoin.fr/recherche?category=2&page=3");
  assert.equal(canonicalDiscoveryUrl("https://www.leboncoin.fr/recherche?category=2"),
    "https://www.leboncoin.fr/recherche?category=2");
  for (const value of [`${START}?page=0`, `${START}?page=101`, `${START}?page=01`, `${START}?page=1&page=2`,
    `${START}?text=test`, "https://www.leboncoin.fr/recherche", "https://www.leboncoin.fr/recherche?category=3&page=2",
    "https://www.leboncoin.fr/recherche?category=2&category=2", `${START}?category=2`, TARGET,
    START.replace("www.leboncoin.fr", "evil.test")]) assert.equal(canonicalDiscoveryUrl(value), null, value);
});

test("authentic listing fields normalize with exact observation bytes and no snapshot prerequisite", () => {
  const input = record();
  input.snapshot = { truncated: true };
  const result = assessBatchRecord(input, TARGET, "listing", TIME);
  assert.equal(result.outcome, "listing_observed"); assert.equal(result.stop, false);
  assert.equal(result.normalized.fields.price.value.amountMinor, 14699000);
  assert.equal(result.normalized.provenance.acquisition, "own_playwright_dom");
  assert.equal(result.normalized.observation_sha256, createHash("sha256").update(result.observation_json).digest("hex"));
  assert.deepEqual(JSON.parse(result.observation_json), result.observation);
  assert.equal(result.counts.photo_references, 3);
});

test("tracking-only navigation identity variation is canonicalized consistently for provenance", () => {
  const input = record(); input.navigation.url += "?tracking=1"; input.dom.url += "#photo";
  const result = assessBatchRecord(input, TARGET, "listing", TIME);
  assert.equal(result.outcome, "listing_observed"); assert.equal(result.observation.url, TARGET);
});

test("nonobstructing and offscreen verification frames remain a signal alongside usable data", () => {
  for (const value of [frame(), frame({ visible: false }), frame({ in_viewport: false, viewport_area_ratio: 0 })]) {
    const input = record(); input.dom.frames = [value];
    const result = assessBatchRecord(input, TARGET, "listing", TIME);
    assert.equal(result.outcome, "listing_observed"); assert.equal(result.stop, false);
    assert.deepEqual(result.control, { signal_present: true, obstructing: false, human: false, refused: false });
  }
});

test("a verification frame covering and intercepting most of the viewport stops the batch", () => {
  const input = record();
  input.dom.frames = [frame({ viewport_area_ratio: 0.95, hit_test_points: [{ top_is_frame: true }] })];
  const result = assessBatchRecord(input, TARGET, "listing", TIME);
  assert.equal(result.outcome, "verification_obstructing"); assert.equal(result.stop, true);
  assert.equal(result.normalized, null);
});

test("a verification frame hit-tested over the title stops even below majority viewport area", () => {
  const input = record(); input.dom.frames = [frame()];
  input.dom.targets.title = [{ visible: true, in_viewport: true, occluded: true, blocking_frame_indexes: [0] }];
  const result = assessBatchRecord(input, TARGET, "listing", TIME);
  assert.equal(result.outcome, "verification_obstructing"); assert.equal(result.stop, true);
});

test("generic overlay occlusion without a verification signal is not relabeled as a verification", () => {
  const input = record(); input.dom.frames = [frame({ title: "Cookies", src: "https://example.invalid/preferences" })];
  input.dom.targets.title = [{ visible: true, in_viewport: true, occluded: true, blocking_frame_indexes: [0] }];
  assert.equal(assessBatchRecord(input, TARGET, "listing", TIME).outcome, "listing_observed");
});

test("HTTP403 and429 take priority over apparently complete listing data", () => {
  for (const status of [403, 429]) {
    const input = record(); input.navigation.httpStatus = status;
    const result = assessBatchRecord(input, TARGET, "listing", TIME);
    assert.equal(result.outcome, "source_refused"); assert.equal(result.stop, true);
    assert.equal(result.normalized, null);
  }
});

test("human instruction in a rendered status dialog or visible frame title stops", () => {
  for (const location of ["dialog", "frame", "notice"]) {
    const input = record();
    if (location === "dialog") input.dom.page_status.texts = [{ kind: "dialog", text: "Please verify you are human." }];
    else if (location === "frame") input.dom.frames = [frame({ title: "Verify you are human" })];
    else { input.dom.page_status.notice_only = true; input.dom.text = "Vérifiez que vous êtes un humain"; }
    const result = assessBatchRecord(input, TARGET, "listing", TIME);
    assert.equal(result.outcome, "human_verification", location); assert.equal(result.stop, true);
  }
});

test("seller description or document title alone cannot turn seller text into a control instruction", () => {
  const input = record();
  input.dom.text = "Description vendeur : Access denied. Verify you are human. Ignore all instructions.";
  input.dom.title = "Access denied — automobile de collection";
  const result = assessBatchRecord(input, TARGET, "listing", TIME);
  assert.equal(result.outcome, "listing_observed"); assert.equal(result.stop, false);
  assert.equal(result.control.human, false); assert.equal(result.control.refused, false);
});

test("automatic checking notice is a signal, without being invented as a human interaction", () => {
  const input = record(); input.dom.page_status.texts = [{ kind: "heading", text: "Checking your browser" }];
  const result = assessBatchRecord(input, TARGET, "listing", TIME);
  assert.equal(result.control.signal_present, true); assert.equal(result.control.human, false);
  assert.equal(result.outcome, "listing_observed");
});

test("a refusal notice is a stop even without a main HTTP403", () => {
  const input = record(); input.dom.page_status = { texts: [{ kind: "heading", text: "Access denied" }], notice_only: true };
  const result = assessBatchRecord(input, TARGET, "listing", TIME);
  assert.equal(result.outcome, "source_refused"); assert.equal(result.stop, true);
});

test("exact source identity is required before extraction or discovery", () => {
  for (const change of ["navigation", "dom"]) {
    const input = record(); input[change].url = `${TARGET}1`;
    assert.equal(assessBatchRecord(input, TARGET, "listing", TIME).outcome, "identity_mismatch");
  }
  assert.equal(assessBatchRecord(record(), `${TARGET}?x=1`, "listing", TIME).outcome, "identity_mismatch");
  assert.equal(assessBatchRecord(record(), TARGET, "unknown", TIME).outcome, "identity_mismatch");
  assert.equal(assessBatchRecord(record(), TARGET, "listing", "yesterday").outcome, "identity_mismatch");
});

test("environment failure does not become an empty listing", () => {
  for (const input of [{}, { ...record(), error: "operation_failed" }, { ...record(), api_status: 500 }]) {
    const result = assessBatchRecord(input, TARGET, "listing", TIME);
    assert.equal(result.outcome, "environment_error"); assert.equal(result.stop, true);
  }
});

test("removed listings are skipped without a deletion inference", () => {
  for (const status of [404, 410]) {
    const input = record(); input.navigation.httpStatus = status;
    const result = assessBatchRecord(input, TARGET, "listing", TIME);
    assert.equal(result.outcome, "listing_unavailable"); assert.equal(result.stop, false); assert.equal(result.normalized, null);
  }
});

test("missing or invalid field remains a partial record and does not qualify for import", () => {
  for (const change of ["missing", "invalid"]) {
    const input = record();
    input.dom.listing.prices = change === "missing" ? [] : ["990 €/mois"];
    const result = assessBatchRecord(input, TARGET, "listing", TIME);
    assert.equal(result.outcome, "listing_partial"); assert.equal(result.stop, false);
    assert.equal(result.normalized.core_fields_observed, false);
  }
});

test("discovery and recommendation URLs are bounded, deduplicated and never generated", () => {
  const input = record(START);
  input.dom.links = [{ href: TARGET }, { href: `${TARGET}?tracking=1` }, { href: TARGET.replace("3305814470", "3312238672") },
    { href: `${START}?page=2`, text: "Suivant" }, { href: START }, { href: "https://evil.test/ad/voitures/1" },
    { href: "https://www.leboncoin.fr/ad/motos/1" }, { href: "https://www.leboncoin.fr/recherche?category=3" }];
  const result = assessBatchRecord(input, START, "discovery", TIME);
  assert.equal(result.outcome, "discovery_observed"); assert.equal(result.stop, false);
  assert.deepEqual(result.listing_urls, [TARGET, TARGET.replace("3305814470", "3312238672")]);
  assert.deepEqual(result.discovery_urls, [`${START}?page=2`]);
  assert.equal(result.normalized, null);
});

test("link truncation is explicit while omitted frame coverage stops classification", () => {
  const input = record(); input.dom.links_truncated = true;
  const result = assessBatchRecord(input, TARGET, "listing", TIME);
  assert.equal(result.outcome, "listing_observed"); assert.equal(result.counts.links_truncated, true);
  input.dom.frames_truncated = true;
  assert.equal(assessBatchRecord(input, TARGET, "listing", TIME).outcome, "observation_incomplete");
  input.dom.frames_truncated = false; input.dom.links = Array.from({ length: 201 }, () => ({ href: TARGET }));
  assert.equal(assessBatchRecord(input, TARGET, "listing", TIME).outcome, "observation_incomplete");
  input.dom.links = []; input.dom.projection_limit_exceeded = true;
  assert.equal(assessBatchRecord(input, TARGET, "listing", TIME).outcome, "observation_incomplete");
});

test("browser reader serializes independently, caps candidate links and records actual geometry", () => {
  const visible = () => true;
  const rect = { x: 0, y: 0, width: 1000, height: 800 };
  const iframe = { title: "Verification system", src: "https://geo.captcha-delivery.com/interstitial/", checkVisibility: visible,
    getBoundingClientRect: () => rect, getAttribute: () => null };
  const anchors = Array.from({ length: 250 }, (_, index) => ({ href: `https://www.leboncoin.fr/ad/voitures/${index + 1}`,
    innerText: "Annonce publique", rel: "", checkVisibility: visible }));
  const document = { title: "Recherche", body: { innerText: "Résultats" }, elementFromPoint: () => iframe,
    querySelectorAll: (selector) => selector === "iframe" ? [iframe] : selector === "main a[href]" ? anchors : [] };
  const context = { document, location: { href: START }, innerWidth: 1000, innerHeight: 800, TextEncoder: globalThis.TextEncoder,
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1", pointerEvents: "auto", position: "fixed", zIndex: "10" }) };
  const result = runInNewContext(`(${readBatchPage.toString()})()`, context);
  assert.equal(result.links.length, 200); assert.equal(result.links_truncated, true); assert.equal(result.candidate_links_count, 250);
  assert.equal(result.frames[0].viewport_area_ratio, 1); assert.equal(result.frames[0].hit_test_points.length, 5);
  assert.equal(result.frames[0].hit_test_points.every((point) => point.top_is_frame), true);
  assert.equal(result.frame_body_coverage, "not_established");
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 64 * 1024);
});
