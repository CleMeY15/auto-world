import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { reviewDetailClaims } from "./detail-review.mjs";
import { extractLeboncoinDomObservation } from "./extract.mjs";

const first = "3305814470";
const second = "3312238672";
const third = "3308374007";
function replay(id, title = null, mutate = () => {}) {
  const path = new URL(`./fixtures/${id}.json`, import.meta.url);
  const input = JSON.parse(readFileSync(path, "utf8"));
  if (title !== null) input.titles = [title];
  mutate(input);
  return extractLeboncoinDomObservation(Buffer.from(JSON.stringify(input)), {
    expectedListingId: id, expectedUrl: input.requested_url,
  });
}

test("two independent claims in actual archived detail observations and a concordant third", () => {
  const cases = [[first, "vehicle_technical_inspection_valid"], [second, "model_year"], [third, null]];
  for (const [id, flagged] of cases) {
    const detail = replay(id);
    const before = JSON.stringify(detail);
    const notes = reviewDetailClaims(detail);
    assert.deepEqual(notes.map((item) => item.field), flagged ? [flagged] : []);
    assert.equal(JSON.stringify(detail), before);
    assert.deepEqual(detail.issues, []);
  }
});

test("generic dates, negated CT and qualified inspection claims are ignored", () => {
  for (const title of ["911 – révision 2020", "911, garantie 2020", "911 – 08/2020", "911, CT pas OK",
    "911, ancien CT OK", "911 – CT OK ?", "911 – pas de contrôle technique valide", "911, CT OK, CT à refaire",
    "Porsche 911, CT OK, mais expiré depuis", "Porsche 911 – CT OK – en 2018",
    "911, CT OK, garantie 1 an, puis périmé", "Porsche 911, en 2018, CT OK"]) {
    assert.deepEqual(reviewDetailClaims(replay(first, title)), [], title);
  }
  assert.deepEqual(reviewDetailClaims({ status: "not_listing" }), []);
});

test("ambiguous titles or missing or inconsistent criteria produce no automatic conclusion", () => {
  assert.deepEqual(reviewDetailClaims(replay(second, "millésime 2023, année modèle 2021")), []);
  assert.deepEqual(reviewDetailClaims(replay(second, "année modèle 2021", (input) => {
    input.criteria = input.criteria.filter((item) => item.key !== "issuance_date");
  })), []);
  assert.deepEqual(reviewDetailClaims(replay(first, "CT OK", (input) => {
    input.criteria.push({ key: "vehicle_technical_inspection_valid", label: "Contrôle technique valide", value: "Oui" });
  })), []);
});

test("CLI enables review only on request and preserves extraction status", () => {
  const cwd = fileURLToPath(new URL(".", import.meta.url));
  const args = ["replay.mjs", `fixtures/${first}.json`, "--expected-url",
    `https://www.leboncoin.fr/ad/voitures/${first}`, "--expected-id", first];
  for (const review of [false, true]) {
    const run = spawnSync(process.execPath, review ? [...args, "--review"] : args, { cwd, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(Object.hasOwn(result, "review_notes"), review);
    if (review) assert.equal(result.review_notes[0].field, "vehicle_technical_inspection_valid");
  }
});
