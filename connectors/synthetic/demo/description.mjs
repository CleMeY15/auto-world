import "./guard.mjs";

import { createHash } from "node:crypto";
import { findTaxonomyMake, findTaxonomyModel } from "@auto-world/vehicle-taxonomy";
import {
  SYNTHETIC_DESCRIPTION_TAXONOMY_REFERENCE,
  SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE,
} from "./taxonomy-release.mjs";

const allowedCurrencies = new Set(["EUR", "USD", "GBP", "CHF", "JPY", "KRW"]);
const allowedMileageUnits = new Set(["km", "mi"]);

function invalid() {
  throw new Error("synthetic_description_shape_invalid");
}

function recordOf(value) {
  if (value === null || typeof value !== "object") invalid();
  let isArray;
  let prototype;
  let descriptors;
  try {
    isArray = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    invalid();
  }
  if (isArray || (prototype !== Object.prototype && prototype !== null)) invalid();
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string")) invalid();
  const result = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) invalid();
    result[key] = descriptor.value;
  }
  return result;
}

function valuesOf(value, expected) {
  const result = recordOf(value);
  const keys = Object.keys(result);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) invalid();
  return result;
}

function denseArray(value, maximum) {
  let isArray;
  let prototype;
  let descriptors;
  try {
    isArray = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    invalid();
  }
  if (!isArray || prototype !== Array.prototype || !Number.isSafeInteger(value.length) || value.length > maximum) invalid();
  const result = [];
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || keys.some((key) => {
    if (key === "length") return false;
    return typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length;
  })) invalid();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[index];
    if (!descriptor?.enumerable || !("value" in descriptor)) invalid();
    result.push(descriptor.value);
  }
  return result;
}

function parseObservation(input) {
  const value = valuesOf(input, ["field", "value", "confidenceBps"]);
  if (!Number.isInteger(value.confidenceBps) || value.confidenceBps < 0 || value.confidenceBps > 10_000) invalid();
  if (value.field === "price") {
    const price = valuesOf(value.value, ["amountMinor", "currency"]);
    if (!Number.isSafeInteger(price.amountMinor) || price.amountMinor < 0 || !allowedCurrencies.has(price.currency)) invalid();
    return Object.freeze({ field: "price", value: Object.freeze(price), confidenceBps: value.confidenceBps });
  }
  if (value.field === "mileage") {
    const mileage = valuesOf(value.value, ["amount", "unit"]);
    if (!Number.isFinite(mileage.amount) || mileage.amount < 0 || mileage.amount > Number.MAX_SAFE_INTEGER ||
        !allowedMileageUnits.has(mileage.unit)) invalid();
    return Object.freeze({ field: "mileage", value: Object.freeze(mileage), confidenceBps: value.confidenceBps });
  }
  invalid();
}

function parseDescription(input) {
  const value = valuesOf(input, ["makeId", "modelId", "firstRegistrationYear", "attribution"]);
  const make = findTaxonomyMake(SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE, value.makeId);
  const model = findTaxonomyModel(SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE, value.modelId);
  if (make.status !== "found" || model.status !== "found" || model.data.makeId !== make.data.makeId ||
      !Number.isInteger(value.firstRegistrationYear) || value.firstRegistrationYear < 1886 ||
      value.firstRegistrationYear > 9999) invalid();
  const attribution = valuesOf(value.attribution, ["kind", "fixtureRef"]);
  const admitted = SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE.attributions.some((item) =>
    item.kind === attribution.kind && item.fixtureRef === attribution.fixtureRef);
  if (!admitted) invalid();
  return Object.freeze({
    makeId: make.data.makeId,
    modelId: model.data.modelId,
    firstRegistrationYear: value.firstRegistrationYear,
    attribution: Object.freeze({ kind: "synthetic_fixture", fixtureRef: attribution.fixtureRef }),
  });
}

export function parseSyntheticDescriptionPageV2(input) {
  const envelope = valuesOf(input, ["schemaVersion", "taxonomyRelease", "items"]);
  if (envelope.schemaVersion !== 2) invalid();
  const release = valuesOf(envelope.taxonomyRelease, ["catalogId", "releaseId", "revision"]);
  if (release.catalogId !== SYNTHETIC_DESCRIPTION_TAXONOMY_REFERENCE.catalogId ||
      release.releaseId !== SYNTHETIC_DESCRIPTION_TAXONOMY_REFERENCE.releaseId ||
      release.revision !== SYNTHETIC_DESCRIPTION_TAXONOMY_REFERENCE.revision) invalid();
  const sourceListingIds = new Set();
  const descriptions = [];
  const sdkItems = denseArray(envelope.items, 100).map((inputItem) => {
    const initial = recordOf(inputItem);
    if (initial.outcome === "active") {
      const keys = Object.hasOwn(initial, "description")
        ? ["sourceListingId", "outcome", "observations", "description"]
        : ["sourceListingId", "outcome", "observations"];
      const item = valuesOf(initial, keys);
      if (typeof item.sourceListingId !== "string" || !/^publication-[a-z0-9-]+$/.test(item.sourceListingId) ||
          sourceListingIds.has(item.sourceListingId)) invalid();
      sourceListingIds.add(item.sourceListingId);
      const observations = denseArray(item.observations, 16).map(parseObservation);
      const description = Object.hasOwn(item, "description") ? parseDescription(item.description) : undefined;
      descriptions.push(Object.freeze({ sourceListingId: item.sourceListingId, ...(description ? { description } : {}) }));
      return Object.freeze({ sourceListingId: item.sourceListingId, outcome: "active", observations: Object.freeze(observations) });
    }
    const item = valuesOf(inputItem, ["sourceListingId", "outcome"]);
    if (typeof item.sourceListingId !== "string" || !/^publication-[a-z0-9-]+$/.test(item.sourceListingId) ||
        !["withdrawn", "deleted"].includes(item.outcome) || sourceListingIds.has(item.sourceListingId)) invalid();
    sourceListingIds.add(item.sourceListingId);
    return Object.freeze({ sourceListingId: item.sourceListingId, outcome: item.outcome });
  });
  return Object.freeze({
    taxonomyRelease: SYNTHETIC_DESCRIPTION_TAXONOMY_REFERENCE,
    sdkDraft: Object.freeze({ items: Object.freeze(sdkItems) }),
    descriptions: Object.freeze(descriptions),
  });
}

export function inspectSyntheticDescriptionRaw(bytes, descriptor) {
  const metadata = valuesOf(descriptor, ["name", "byteLength", "sha256"]);
  if (!(bytes instanceof Uint8Array) || typeof metadata.name !== "string" ||
      !Number.isSafeInteger(metadata.byteLength) || typeof metadata.sha256 !== "string" ||
      bytes.byteLength !== metadata.byteLength || createHash("sha256").update(bytes).digest("hex") !== metadata.sha256) {
    throw new Error("synthetic_description_digest_mismatch");
  }
  let decoded;
  try {
    decoded = JSON.parse(new globalThis.TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("synthetic_description_json_invalid");
  }
  return parseSyntheticDescriptionPageV2(decoded);
}
