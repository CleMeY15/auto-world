import assert from "node:assert/strict";
import test from "node:test";

import { resolveSuppliedReport } from "../.test-dist/src/demo/vehicle-reports.js";

test("a supplied reference resolves only a registered document of the same listing and provider", () => {
  const listingId = "lst_5696220ef97cf2af439e0279456ea36c70dd3df4e97b4455fc1577fa81aa8863";
  const reference = { listingId, provider: "histovec", suppliedBy: "titulaire", documentId: "b2-parcours" };
  assert.equal(resolveSuppliedReport(listingId, reference)?.href, `/demo/rapports/${listingId}/b2-parcours`);
  assert.equal(resolveSuppliedReport("another-listing", reference), undefined);
  for (const change of [
    { listingId: "another-listing" }, { provider: "carfax" }, { suppliedBy: "unknown" },
    { documentId: "b1-entretien" }, { documentId: "https://histovec.interieur.gouv.fr/histovec/accueil" },
    { documentId: "https://www.carfax.eu/pricing" }, { documentId: "/demo/rapports/b2-parcours?share=fixture" },
  ]) {
    assert.equal(resolveSuppliedReport(listingId, { ...reference, ...change }), undefined);
  }
});
