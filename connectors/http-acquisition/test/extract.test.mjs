import assert from "node:assert/strict";
import { test } from "node:test";
import { extractVehicleJsonLd } from "../dist/extract.js";

const utf8 = (value) => new globalThis.TextEncoder().encode(value);
const script = (value) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;
const html = (value, extra = "") => utf8(`<!doctype html><html><head>${script(value)}${extra}</head><body>Vehicle fixture</body></html>`);
const car = (overrides = {}) => ({
  "@context": "https://schema.org", "@type": "Car",
  offers: { "@type": "Offer", price: "29990.95", priceCurrency: "EUR" },
  mileageFromOdometer: { "@type": "QuantitativeValue", value: 45000, unitCode: "KMT" },
  vehicleIdentificationNumber: "WVWZZZ1JZXW000001", ...overrides,
});
const extract = (value, fields = ["price", "mileage", "vin"]) => extractVehicleJsonLd(html(value), fields);
const failure = (result, code) => assert.deepEqual(result, { success: false, code });
const price = (value, currency = "EUR") => extract(car({ offers: { "@type": "Offer", price: value, priceCurrency: currency } }), ["price"]);

test("extracts exact stated price, distance and internal VIN without inventing identity", () => {
  const result = extract(car());
  assert.deepEqual(result, { success: true, observations: [
    { field: "price", value: { amountMinor: 2999095, currency: "EUR" }, confidenceBps: 10000 },
    { field: "mileage", value: { amount: 45000, unit: "km" }, confidenceBps: 10000 },
    { field: "vin", value: { status: "full", vin: "WVWZZZ1JZXW000001" }, confidenceBps: 10000 },
  ] });
  assert.equal(Object.isFrozen(result.observations), true);
  assert.equal(Object.isFrozen(result.observations[0].value), true);
});

test("supports a Schema.org context inherited through a graph and full type IRI", () => {
  const child = car({ "@type": ["https://schema.org/Product", "https://schema.org/Vehicle"] });
  delete child["@context"];
  const result = extract({ "@context": "https://schema.org/", "@graph": [{ "@type": "WebPage" }, child] });
  assert.equal(result.success, true);
  assert.equal(result.observations.length, 3);
});

test("supports root arrays and multiple harmless standard-vocabulary scripts", () => {
  const result = extractVehicleJsonLd(html([{ "@context": "https://schema.org", "@type": "WebSite" }, car()], script({ "@context": "https://schema.org", "@type": "BreadcrumbList" })), ["price"]);
  assert.equal(result.success, true);
  assert.equal(result.observations[0].value.amountMinor, 2999095);
});

test("refuses multiple vehicle candidates instead of selecting one arbitrarily", () => {
  failure(extract([car(), car({ vehicleIdentificationNumber: "WVWZZZ1JZXW000002" })]), "ambiguous_vehicle");
  failure(extractVehicleJsonLd(html(car(), script(car())), ["price"]), "ambiguous_vehicle");
});

test("refuses multiple offers and aggregate low prices", () => {
  failure(extract(car({ offers: [{ "@type": "Offer", price: "100", priceCurrency: "EUR" }, { "@type": "Offer", price: "200", priceCurrency: "EUR" }] })), "ambiguous_offer");
  failure(extract(car({ offers: { "@type": "AggregateOffer", lowPrice: "100", highPrice: "200", priceCurrency: "EUR" } })), "unsupported_markup");
  failure(extract(car({ offers: { "@type": ["Offer", "AggregateOffer"], price: "100", priceCurrency: "EUR" } })), "unsupported_markup");
});

test("does not resolve reference-only offers", () => {
  failure(extract({ "@context": "https://schema.org", "@graph": [car({ offers: { "@id": "#offer" } }), { "@id": "#offer", "@type": "Offer", price: 100, priceCurrency: "EUR" }] }), "unsupported_markup");
});

test("converts supported currency minor units exactly", () => {
  for (const currency of ["EUR", "USD", "GBP", "CHF"]) {
    assert.deepEqual(price("123.45", currency).observations[0].value, { amountMinor: 12345, currency });
    assert.equal(price(123.4, currency).observations[0].value.amountMinor, 12340);
  }
  for (const currency of ["JPY", "KRW"]) {
    assert.deepEqual(price("12345.00", currency).observations[0].value, { amountMinor: 12345, currency });
    failure(price("123.45", currency), "invalid_value");
  }
});

test("does not round excess price precision or floating point artefacts", () => {
  failure(price("123.456"), "invalid_value");
  failure(price(0.1 + 0.2), "invalid_value");
  assert.equal(price("123.4500").observations[0].value.amountMinor, 12345);
  assert.equal(price("0.29").observations[0].value.amountMinor, 29);
});

test("rejects negative, unsafe, formatted and exponent prices", () => {
  for (const value of ["-1", -1, "-0", "1,200", "1 200", "1e3", "Infinity", "90071992547409.92", {}, true]) {
    failure(price(value), "invalid_value");
  }
  assert.equal(price("90071992547409.91").observations[0].value.amountMinor, Number.MAX_SAFE_INTEGER);
});

test("preserves original numeric decimal tokens before any floating point rounding", () => {
  const numericPrice = (token, key = "price") => extractVehicleJsonLd(utf8(`<script type="application/ld+json">{"@context":"https://schema.org","@type":"Car","offers":{"@type":"Offer","${key}":${token},"priceCurrency":"EUR"}}</script>`), ["price"]);
  for (const token of ["0.10000000000000001", "90071992547409.911", "-0", "1e3"]) {
    failure(numericPrice(token), "invalid_value");
  }
  assert.equal(numericPrice("90071992547409.91").observations[0].value.amountMinor, Number.MAX_SAFE_INTEGER);
  assert.equal(numericPrice("123.4500", "\\u0070rice").observations[0].value.amountMinor, 12345);
  const roundedDistance = '{"@context":"https://schema.org","@type":"Car","mileageFromOdometer":{"value":100.000000000000001,"unitCode":"KMT"}}';
  failure(extractVehicleJsonLd(utf8(`<script type="application/ld+json">${roundedDistance}</script>`), ["mileage"]), "invalid_value");
});

test("never supplies a default currency", () => {
  for (const currency of [undefined, null, "eur", "AED", ""]) {
    failure(extract(car({ offers: { "@type": "Offer", price: "100", priceCurrency: currency } }), ["price"]), "invalid_value");
  }
});

test("keeps miles separate from kilometres and requires an explicit known unit", () => {
  assert.deepEqual(extract(car({ mileageFromOdometer: { value: "16000.0", unitCode: "SMI" } }), ["mileage"]).observations[0].value, { amount: 16000, unit: "mi" });
  for (const unitCode of [undefined, "MTR", "km", "mi"]) {
    failure(extract(car({ mileageFromOdometer: { value: 10, unitCode } }), ["mileage"]), "invalid_value");
  }
  failure(extract(car({ mileageFromOdometer: { value: "12.5", unitCode: "KMT" } }), ["mileage"]), "invalid_value");
  failure(extract(car({ mileageFromOdometer: { value: -10, unitCode: "KMT" } }), ["mileage"]), "invalid_value");
});

test("maps only requested fields and never releases an unrequested VIN", () => {
  const result = extract(car({ vehicleIdentificationNumber: "INVALID" }), ["price", "url", "source_listing_id"]);
  assert.equal(result.success, true);
  assert.deepEqual(result.observations.map((entry) => entry.field), ["price"]);
  assert.equal(JSON.stringify(result).includes("INVALID"), false);
});

test("rejects malformed requested VINs without including them in the error", () => {
  for (const value of ["WVWZZZ1JZXW00000I", "wvwzzz1jzxw000001", "WVWZZZ1JZXW000001 ", 123, "short"]) {
    const result = extract(car({ vehicleIdentificationNumber: value }), ["vin"]);
    failure(result, "invalid_value");
    assert.equal(JSON.stringify(result).includes(String(value)), false);
  }
});

test("leaves missing fields missing and does not reinterpret a model year", () => {
  assert.deepEqual(extract({ "@context": "https://schema.org", "@type": "Car", vehicleModelDate: "2022", dateVehicleFirstRegistered: "2023-01-01" }), { success: true, observations: [] });
});

test("rejects unknown, aliased and reset contexts without fetching them", () => {
  for (const context of ["https://context.example/vehicle.jsonld", { "@vocab": "https://schema.org/" }, ["https://schema.org"], null]) {
    failure(extract(car({ "@context": context })), "unsupported_markup");
  }
  const withoutContext = car();
  delete withoutContext["@context"];
  failure(extract(withoutContext), "unsupported_markup");
});

test("refuses context overrides inside quantities and offers", () => {
  failure(extract(car({ offers: { "@context": { price: "https://example.invalid/other" }, "@type": "Offer", price: 100, priceCurrency: "EUR" } })), "unsupported_markup");
  failure(extract(car({ mileageFromOdometer: { "@context": null, value: 100, unitCode: "KMT" } }), ["mileage"]), "unsupported_markup");
});

test("parses HTML inertly and ignores executable scripts", () => {
  assert.equal(globalThis.autofindexExtractionExecuted, undefined);
  const extra = "<script>globalThis.autofindexExtractionExecuted = true; throw new Error('execute');</script>";
  assert.equal(extractVehicleJsonLd(html(car(), extra), ["price"]).success, true);
  assert.equal(globalThis.autofindexExtractionExecuted, undefined);
});

test("does not use script src, template markup, arbitrary data scripts or remote images", () => {
  failure(extractVehicleJsonLd(utf8('<script type="application/ld+json" src="https://remote.example/car"></script>'), ["price"]), "unsupported_markup");
  failure(extractVehicleJsonLd(utf8(`<template>${script(car())}</template>`), ["price"]), "unsupported_markup");
  failure(extractVehicleJsonLd(utf8(`<script type="application/json">${JSON.stringify(car())}</script>`), ["price"]), "unsupported_markup");
  assert.equal(extractVehicleJsonLd(html(car(), '<img src="https://remote.example/image">'), ["price"]).success, true);
});

test("rejects malformed UTF-8 and malformed JSON-LD", () => {
  failure(extractVehicleJsonLd(new Uint8Array([0xff]), ["price"]), "invalid_html");
  failure(extractVehicleJsonLd(new Uint8Array(), ["price"]), "invalid_html");
  failure(extractVehicleJsonLd(utf8('<script type="application/ld+json">{"@type":"Car",</script>'), ["price"]), "invalid_jsonld");
});

test("rejects duplicate and prototype-related JSON members", () => {
  for (const text of [
    '{"@context":"https://schema.org","@type":"Car","offers":{"price":100,"price":200,"priceCurrency":"EUR"}}',
    '{"@context":"https://schema.org","@type":"Car","__proto__":{"polluted":true}}',
  ]) {
    failure(extractVehicleJsonLd(utf8(`<script type="application/ld+json">${text}</script>`), ["price"]), "invalid_jsonld");
  }
  assert.equal({}.polluted, undefined);
});

test("bounds body length, script count and HTML traversal depth", () => {
  failure(extractVehicleJsonLd(new Uint8Array(512 * 1024 + 1), ["price"]), "limit_exceeded");
  const breadcrumb = { "@context": "https://schema.org", "@type": "BreadcrumbList" };
  failure(extractVehicleJsonLd(utf8(script(car()) + script(breadcrumb).repeat(32)), ["price"]), "limit_exceeded");
  failure(extractVehicleJsonLd(utf8('<div>'.repeat(140) + script(car()) + '</div>'.repeat(140)), ["price"]), "limit_exceeded");
});

test("bounds JSON structure depth and rejects unsupported pages", () => {
  const deeplyNested = '['.repeat(40) + '0' + ']'.repeat(40);
  failure(extractVehicleJsonLd(utf8(`<script type="application/ld+json">${deeplyNested}</script>`), ["price"]), "limit_exceeded");
  failure(extractVehicleJsonLd(utf8('<html><body>No structured vehicle here</body></html>'), ["price"]), "unsupported_markup");
});
