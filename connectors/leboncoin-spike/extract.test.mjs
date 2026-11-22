import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { extractLeboncoinDomObservation, MAX_SNAPSHOT_BYTES } from "./extract.mjs";

const originals = new Map(["3305814470", "3312238672", "3308374007"].map((id) => [id, readFileSync(new URL(`./fixtures/${id}.json`, import.meta.url))]));
const options = (id = "3305814470") => ({ expectedUrl: `https://www.leboncoin.fr/ad/voitures/${id}`, expectedListingId: id });
const fixture = (id = "3305814470") => JSON.parse(originals.get(id).toString("utf8"));
const replay = (value, id = "3305814470") => extractLeboncoinDomObservation(Buffer.from(JSON.stringify(value)), options(id));

for (const [id, cents, km, model, year] of [
  ["3305814470", 14699000, 23000, "911", 2021],
  ["3312238672", 11990000, 29800, "911", 2020],
  ["3308374007", 6200000, 45000, "Macan", 2021],
]) {
  test(`replays authentic observed advertisement ${id}`, () => {
    const body = originals.get(id);
    const result = extractLeboncoinDomObservation(body, options(id));
    assert.equal(result.status, "listing");
    assert.equal(result.core_fields_observed, true);
    assert.equal(result.observation_sha256, createHash("sha256").update(body).digest("hex"));
    assert.deepEqual(result.fields.price.value, { amountMinor: cents, currency: "EUR" });
    assert.deepEqual(result.fields.mileage.value, { amount: km, unit: "km" });
    assert.equal(result.fields.brand.value, "PORSCHE");
    assert.equal(result.fields.model.value, model);
    assert.equal(result.fields.model_year.value, year);
    assert.equal(result.source.original_url, options(id).expectedUrl);
    assert.equal(result.provenance.acquisition, "chatgpt_cloud_browser_dom");
    assert.equal(result.photos.values.length, 3);
    assert.equal(result.photos.coverage, "observed_references_only");
    assert.equal(result.photos.downloaded, false);
    assert.equal(result.fields.vin.status, "not_observed");
    assert.deepEqual(result.source_times, []);
    assert.deepEqual(result.issues, []);
  });
}

test("keeps the observed 2020 criterion despite 2021 in the title", () => {
  const result = replay(fixture("3312238672"), "3312238672");
  assert.match(result.fields.title.value, /2021/u);
  assert.equal(result.fields.model_year.value, 2020);
  assert.deepEqual(result.fields.issuance_date.value, { year: 2020, month: 8, precision: "month" });
  assert.equal(result.criteria.find((item) => item.key === "regdate").value, "2020");
});

test("retains contradictory title and criterion text without silently correcting them", () => {
  const result = replay(fixture());
  assert.match(result.fields.title.value, /CT Ok/u);
  assert.equal(result.criteria.find((item) => item.key === "vehicle_technical_inspection_valid").value, "Non");
});

test("hashes exact observation bytes rather than a reserialized object or HTTP body", () => {
  const original = originals.get("3305814470");
  const spaced = Buffer.concat([original, Buffer.from("\n")]);
  const left = extractLeboncoinDomObservation(original, options());
  const right = extractLeboncoinDomObservation(spaced, options());
  assert.notEqual(left.observation_sha256, right.observation_sha256);
  assert.deepEqual(left.fields.price.value, right.fields.price.value);
  assert.equal(left.fields.price.evidence[0].json_pointer, "/prices/0");
  assert.equal(left.fields.price.evidence[0].observation_sha256, left.observation_sha256);
  assert.equal(left.provenance.hash_identifies, "exact_observation_file_not_http_body");
});

test("preserves missing price and mileage as not observed, never zero", () => {
  const value = fixture(); value.prices = [];
  value.criteria = value.criteria.filter((item) => item.key !== "mileage");
  const result = replay(value);
  assert.equal(result.status, "listing");
  assert.equal(result.core_fields_observed, false);
  assert.deepEqual(result.fields.price, { status: "not_observed" });
  assert.deepEqual(result.fields.mileage, { status: "not_observed" });
});

test("refuses conflicting prices and monthly payment text", () => {
  const value = fixture(); value.prices.push("139 000 €");
  assert.equal(replay(value).fields.price.status, "ambiguous");
  for (const raw of ["999 € / mois", "Sur demande", "", "-5 €", "146990.999 €", "146990 USD", "14 6990 €"]) {
    value.prices = [raw];
    assert.equal(replay(value).fields.price.status, "invalid");
  }
});

test("converts decimal cents exactly and rejects unsafe amounts", () => {
  const value = fixture(); value.prices = ["123,45 €"];
  assert.equal(replay(value).fields.price.value.amountMinor, 12345);
  value.prices = ["90071992547409,92 €"];
  assert.equal(replay(value).fields.price.status, "invalid");
  value.prices = ["0 €"];
  assert.equal(replay(value).fields.price.value.amountMinor, 0);
});

test("retains every proof for identical repeated prices without choosing between conflicts", () => {
  const value = fixture(); value.prices.push("146 990 €");
  const result = replay(value);
  assert.equal(result.fields.price.status, "observed");
  assert.equal(result.fields.price.evidence.length, 2);
});

test("detects conflicting duplicate criteria and rejects a changed criterion label", () => {
  const value = fixture();
  value.criteria.push({ key: "mileage", label: "Kilométrage", value: "24000 km" });
  assert.equal(replay(value).fields.mileage.status, "ambiguous");
  value.criteria.pop();
  value.criteria.find((item) => item.key === "mileage").label = "Puissance";
  assert.equal(replay(value).fields.mileage.status, "invalid");
});

test("accepts identical duplicate criteria with their separate evidence", () => {
  const value = fixture();
  value.criteria.push({ ...value.criteria.find((item) => item.key === "mileage") });
  const result = replay(value);
  assert.equal(result.fields.mileage.value.amount, 23000);
  assert.equal(result.fields.mileage.evidence.length, 2);
});

test("requires explicit integral kilometres", () => {
  const value = fixture();
  for (const raw of ["23000", "23000 mi", "23.5 km", "-1 km", "23 00 km", "9007199254740992 km"]) {
    value.criteria.find((item) => item.key === "mileage").value = raw;
    assert.equal(replay(value).fields.mileage.status, "invalid");
  }
});

test("checks expected URL, source ID, requested URL and final URL together", () => {
  const body = originals.get("3305814470");
  assert.equal(extractLeboncoinDomObservation(body, { ...options(), expectedListingId: "1" }).status, "identity_mismatch");
  for (const key of ["requested_url", "url"]) {
    const value = fixture(); value[key] = "https://www.leboncoin.fr/ad/voitures/1";
    assert.equal(replay(value).status, "identity_mismatch");
  }
});

test("does not recognize a listing without the observed title or with conflicting titles", () => {
  const value = fixture(); value.titles = [];
  assert.equal(replay(value).status, "not_listing");
  value.titles = ["Vehicle A", "Vehicle B"];
  assert.equal(replay(value).status, "not_listing");
});

test("does not infer a VIN from title or a seller reference", () => {
  const value = fixture();
  value.titles[0] += " WVWZZZ1JZXW000001";
  value.criteria.find((item) => item.key === "custom_ref").value = "WVWZZZ1JZXW000001";
  assert.equal(replay(value).fields.vin.status, "not_observed");
});

test("an explicit VIN label is validated as supplied, without claiming a real positive fixture", () => {
  const value = fixture();
  value.criteria.push({ key: "test_explicit_identifier", label: "VIN", value: "WVWZZZ1JZXW000001" });
  assert.equal(replay(value).fields.vin.value, "WVWZZZ1JZXW000001");
  value.criteria.at(-1).value = "WVWZZZ1JZXW00000I";
  assert.equal(replay(value).fields.vin.status, "invalid");
});

test("keeps cloud and independently executed Playwright provenance distinct", () => {
  const value = fixture(); value.acquisition = "own_playwright_dom";
  assert.equal(replay(value).provenance.acquisition, "own_playwright_dom");
  value.acquisition = "autonomous_http";
  assert.equal(replay(value).status, "invalid_snapshot");
});

test("preserves captured time objects without inventing absent datetime or publication semantics", () => {
  const value = fixture();
  value.times = [{ text: "Hier", datetime: null }, { text: "22 novembre", datetime: "2026-11-22T10:00:00Z" }];
  const result = replay(value);
  assert.equal(result.source_times[0].datetime, null);
  assert.equal(result.source_times[0].evidence.length, 1);
  assert.equal(result.source_times[1].datetime, "2026-11-22T10:00:00Z");
  assert.equal(result.source_times[1].evidence[1].json_pointer, "/times/1/datetime");
  value.times = ["unstructured time"];
  assert.equal(replay(value).status, "invalid_snapshot");
});

test("limits photos to observed title/position/origin and detects position conflicts", () => {
  const value = fixture(); value.photos[0].url = "https://unrelated.invalid/image.jpg";
  assert.equal(replay(value).photos.status, "invalid");
  value.photos = fixture().photos;
  value.photos.push({ ...value.photos[0], url: value.photos[1].url });
  assert.equal(replay(value).photos.status, "ambiguous");
  value.photos = [];
  assert.equal(replay(value).photos.status, "not_observed");
});

test("rejects malformed, oversized and non-observation input", () => {
  for (const bytes of [Buffer.from("<html>verification</html>"), new Uint8Array([0xff]), new Uint8Array(MAX_SNAPSHOT_BYTES + 1)]) {
    assert.equal(extractLeboncoinDomObservation(bytes, options()).status, "invalid_snapshot");
  }
  const value = fixture(); value.schema_version = "unobserved_schema";
  assert.equal(replay(value).status, "invalid_snapshot");
  value.schema_version = "leboncoin-dom-observation/v1";
  value.prices = [null];
  assert.equal(replay(value).status, "invalid_snapshot");
});
