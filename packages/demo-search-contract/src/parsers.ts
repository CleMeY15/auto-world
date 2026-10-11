import {
  parseListingId,
  type Currency,
  type ListingId,
  type MileageUnit,
  type ValidationResult,
} from "@auto-world/vehicle-schema";
import type {
  DemoEvidence,
  DemoMileageField,
  DemoMileageValue,
  DemoPriceField,
  DemoPriceValue,
  DemoResultV1,
  DemoSearchQueryV1,
  DemoSearchResponseV1,
  DemoSearchSort,
} from "./types.js";
import {
  deepFreeze,
  exactTimestamp,
  inspectArray,
  inspectObject,
  issue,
  literal,
  nonnegativeNumber,
  optional,
  publicResult,
  required,
  safeInteger,
  valid,
  type InternalResult,
} from "./validation.js";

export const DEMO_PAGE_SIZE = 20;
export const DEMO_FRESHNESS_MS = 60_000;

const sorts = [
  "listing_asc",
  "price_asc",
  "price_desc",
  "mileage_asc",
  "mileage_desc",
] as const;
const currencies = ["EUR", "USD", "GBP", "CHF", "JPY", "KRW"] as const;
const mileageUnits = ["km", "mi"] as const;
const availabilities = ["active", "withdrawn", "deleted", "missing"] as const;
const cursorPattern = /^cur_[0-9a-f]{64}$/;
const evidenceIdPattern = /^ev_[0-9a-f]{64}$/;
const fixtureVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function schemaVersion(input: unknown, path: string): InternalResult<1> {
  if (typeof input !== "number") return issue("invalid_type", path);
  return input === 1
    ? valid(1)
    : issue("unsupported_version", path);
}

function parsePattern(
  input: unknown,
  pattern: RegExp,
  path: string,
): InternalResult<string> {
  if (typeof input !== "string") return issue("invalid_type", path);
  return pattern.test(input) ? valid(input) : issue("invalid_value", path);
}

function parseListingReference(input: unknown, path: string): InternalResult<ListingId> {
  const parsed = parseListingId(input);
  if (parsed.success) return valid(parsed.data);
  const code = parsed.issues[0]?.code === "invalid_type" ? "invalid_type" : "invalid_value";
  return issue(code, path);
}

function parsePriceValue(input: unknown, path: string): InternalResult<DemoPriceValue> {
  const object = inspectObject(input, ["amountMinor", "currency"], path);
  if (!object.ok) return object;
  const amountInput = required(object.value, "amountMinor", path);
  if (!amountInput.ok) return amountInput;
  const amountMinor = safeInteger(amountInput.value, `${path}.amountMinor`);
  if (!amountMinor.ok) return amountMinor;
  const currencyInput = required(object.value, "currency", path);
  if (!currencyInput.ok) return currencyInput;
  const currency = literal<Currency>(currencyInput.value, currencies, `${path}.currency`);
  return currency.ok
    ? valid({ amountMinor: amountMinor.value, currency: currency.value })
    : currency;
}

function parseMileageValue(input: unknown, path: string): InternalResult<DemoMileageValue> {
  const object = inspectObject(input, ["amount", "unit"], path);
  if (!object.ok) return object;
  const amountInput = required(object.value, "amount", path);
  if (!amountInput.ok) return amountInput;
  const amount = nonnegativeNumber(amountInput.value, `${path}.amount`);
  if (!amount.ok) return amount;
  const unitInput = required(object.value, "unit", path);
  if (!unitInput.ok) return unitInput;
  const unit = literal<MileageUnit>(unitInput.value, mileageUnits, `${path}.unit`);
  return unit.ok ? valid({ amount: amount.value, unit: unit.value }) : unit;
}

function equalPrice(left: DemoPriceValue, right: DemoPriceValue): boolean {
  return left.amountMinor === right.amountMinor && left.currency === right.currency;
}

function equalMileage(left: DemoMileageValue, right: DemoMileageValue): boolean {
  return left.amount === right.amount && left.unit === right.unit;
}

function parseEvidence(input: unknown, path: string): InternalResult<DemoEvidence> {
  const object = inspectObject(
    input,
    ["evidenceId", "field", "observedAt", "confidenceBps", "value"],
    path,
  );
  if (!object.ok) return object;
  const idInput = required(object.value, "evidenceId", path);
  if (!idInput.ok) return idInput;
  const evidenceId = parsePattern(idInput.value, evidenceIdPattern, `${path}.evidenceId`);
  if (!evidenceId.ok) return evidenceId;
  const fieldInput = required(object.value, "field", path);
  if (!fieldInput.ok) return fieldInput;
  const field = literal(fieldInput.value, ["price", "mileage"] as const, `${path}.field`);
  if (!field.ok) return field;
  const observedInput = required(object.value, "observedAt", path);
  if (!observedInput.ok) return observedInput;
  const observedAt = exactTimestamp(observedInput.value, `${path}.observedAt`);
  if (!observedAt.ok) return observedAt;
  const confidenceInput = required(object.value, "confidenceBps", path);
  if (!confidenceInput.ok) return confidenceInput;
  const confidenceBps = safeInteger(confidenceInput.value, `${path}.confidenceBps`, 10_000);
  if (!confidenceBps.ok) return confidenceBps;
  const valueInput = required(object.value, "value", path);
  if (!valueInput.ok) return valueInput;
  if (field.value === "price") {
    const value = parsePriceValue(valueInput.value, `${path}.value`);
    return value.ok
      ? valid({ evidenceId: evidenceId.value, field: "price", observedAt: observedAt.value, confidenceBps: confidenceBps.value, value: value.value })
      : value;
  }
  const value = parseMileageValue(valueInput.value, `${path}.value`);
  return value.ok
    ? valid({ evidenceId: evidenceId.value, field: "mileage", observedAt: observedAt.value, confidenceBps: confidenceBps.value, value: value.value })
    : value;
}

function parseEvidenceCollection(
  input: unknown,
  path: string,
): InternalResult<readonly DemoEvidence[]> {
  const array = inspectArray(input, path, 256);
  if (!array.ok) return array;
  const evidence: DemoEvidence[] = [];
  const ids = new Set<string>();
  let previousTime: string | undefined;
  for (let index = 0; index < array.value.length; index += 1) {
    const parsed = parseEvidence(array.value[index], `${path}[${index}]`);
    if (!parsed.ok) return parsed;
    if (ids.has(parsed.value.evidenceId)) {
      return issue("duplicate_id", `${path}[${index}].evidenceId`);
    }
    if (previousTime !== undefined && parsed.value.observedAt < previousTime) {
      return issue("invalid_value", `${path}[${index}].observedAt`);
    }
    ids.add(parsed.value.evidenceId);
    previousTime = parsed.value.observedAt;
    evidence.push(parsed.value);
  }
  return valid(evidence);
}

function parsePriceField(input: unknown, path: string): InternalResult<DemoPriceField> {
  const initial = inspectObject(input, ["status", "value", "evidenceId"], path);
  if (!initial.ok) return initial;
  const statusInput = required(initial.value, "status", path);
  if (!statusInput.ok) return statusInput;
  const status = literal(statusInput.value, ["unavailable", "observed"] as const, `${path}.status`);
  if (!status.ok) return status;
  if (status.value === "unavailable") {
    const exact = inspectObject(input, ["status"], path);
    return exact.ok ? valid({ status: "unavailable" }) : exact;
  }
  const valueInput = required(initial.value, "value", path);
  if (!valueInput.ok) return valueInput;
  const value = parsePriceValue(valueInput.value, `${path}.value`);
  if (!value.ok) return value;
  const idInput = required(initial.value, "evidenceId", path);
  if (!idInput.ok) return idInput;
  const evidenceId = parsePattern(idInput.value, evidenceIdPattern, `${path}.evidenceId`);
  return evidenceId.ok
    ? valid({ status: "observed", value: value.value, evidenceId: evidenceId.value })
    : evidenceId;
}

function parseMileageField(input: unknown, path: string): InternalResult<DemoMileageField> {
  const initial = inspectObject(input, ["status", "value", "evidenceId"], path);
  if (!initial.ok) return initial;
  const statusInput = required(initial.value, "status", path);
  if (!statusInput.ok) return statusInput;
  const status = literal(statusInput.value, ["unavailable", "observed"] as const, `${path}.status`);
  if (!status.ok) return status;
  if (status.value === "unavailable") {
    const exact = inspectObject(input, ["status"], path);
    return exact.ok ? valid({ status: "unavailable" }) : exact;
  }
  const valueInput = required(initial.value, "value", path);
  if (!valueInput.ok) return valueInput;
  const value = parseMileageValue(valueInput.value, `${path}.value`);
  if (!value.ok) return value;
  const idInput = required(initial.value, "evidenceId", path);
  if (!idInput.ok) return idInput;
  const evidenceId = parsePattern(idInput.value, evidenceIdPattern, `${path}.evidenceId`);
  return evidenceId.ok
    ? valid({ status: "observed", value: value.value, evidenceId: evidenceId.value })
    : evidenceId;
}

function verifySelectedFields(
  price: DemoPriceField,
  mileage: DemoMileageField,
  evidence: readonly DemoEvidence[],
  path: string,
): InternalResult<true> {
  const priceEvidence = evidence.filter((item) => item.field === "price");
  const mileageEvidence = evidence.filter((item) => item.field === "mileage");
  const latestPrice = priceEvidence[priceEvidence.length - 1];
  const latestMileage = mileageEvidence[mileageEvidence.length - 1];
  if (latestPrice === undefined) {
    if (price.status !== "unavailable") return issue("invalid_value", `${path}.price`);
  } else if (
    price.status !== "observed" ||
    price.evidenceId !== latestPrice.evidenceId ||
    !equalPrice(price.value, latestPrice.value)
  ) {
    return issue("invalid_value", `${path}.price`);
  }
  if (latestMileage === undefined) {
    if (mileage.status !== "unavailable") return issue("invalid_value", `${path}.mileage`);
  } else if (
    mileage.status !== "observed" ||
    mileage.evidenceId !== latestMileage.evidenceId ||
    !equalMileage(mileage.value, latestMileage.value)
  ) {
    return issue("invalid_value", `${path}.mileage`);
  }
  return valid(true);
}

function parseResultInternal(input: unknown, path: string): InternalResult<DemoResultV1> {
  const object = inspectObject(
    input,
    ["listingId", "availability", "price", "mileage", "evidence"],
    path,
  );
  if (!object.ok) return object;
  const listingInput = required(object.value, "listingId", path);
  if (!listingInput.ok) return listingInput;
  const listingId = parseListingReference(listingInput.value, `${path}.listingId`);
  if (!listingId.ok) return listingId;
  const availabilityInput = required(object.value, "availability", path);
  if (!availabilityInput.ok) return availabilityInput;
  const availability = literal(availabilityInput.value, availabilities, `${path}.availability`);
  if (!availability.ok) return availability;
  const priceInput = required(object.value, "price", path);
  if (!priceInput.ok) return priceInput;
  const price = parsePriceField(priceInput.value, `${path}.price`);
  if (!price.ok) return price;
  const mileageInput = required(object.value, "mileage", path);
  if (!mileageInput.ok) return mileageInput;
  const mileage = parseMileageField(mileageInput.value, `${path}.mileage`);
  if (!mileage.ok) return mileage;
  const evidenceInput = required(object.value, "evidence", path);
  if (!evidenceInput.ok) return evidenceInput;
  const evidence = parseEvidenceCollection(evidenceInput.value, `${path}.evidence`);
  if (!evidence.ok) return evidence;
  const selected = verifySelectedFields(price.value, mileage.value, evidence.value, path);
  if (!selected.ok) return selected;
  return valid(deepFreeze({
    listingId: listingId.value,
    availability: availability.value,
    price: price.value,
    mileage: mileage.value,
    evidence: [...evidence.value],
  }));
}

function parseQueryInternal(input: unknown): InternalResult<DemoSearchQueryV1> {
  const object = inspectObject(
    input,
    ["schemaVersion", "sort", "priceMaxMinor", "mileageMaxKm", "cursor"],
    "$",
  );
  if (!object.ok) return object;
  const versionInput = required(object.value, "schemaVersion", "$");
  if (!versionInput.ok) return versionInput;
  const version = schemaVersion(versionInput.value, "$.schemaVersion");
  if (!version.ok) return version;
  const sortInput = required(object.value, "sort", "$");
  if (!sortInput.ok) return sortInput;
  const sort = literal<DemoSearchSort>(sortInput.value, sorts, "$.sort");
  if (!sort.ok) return sort;
  const result: {
    schemaVersion: 1;
    sort: DemoSearchSort;
    priceMaxMinor?: number;
    mileageMaxKm?: number;
    cursor?: string;
  } = { schemaVersion: 1, sort: sort.value };
  const priceInput = optional(object.value, "priceMaxMinor");
  if (priceInput.present) {
    const price = safeInteger(priceInput.value, "$.priceMaxMinor");
    if (!price.ok) return price;
    result.priceMaxMinor = price.value;
  }
  const mileageInput = optional(object.value, "mileageMaxKm");
  if (mileageInput.present) {
    const mileage = nonnegativeNumber(mileageInput.value, "$.mileageMaxKm");
    if (!mileage.ok) return mileage;
    result.mileageMaxKm = mileage.value;
  }
  const cursorInput = optional(object.value, "cursor");
  if (cursorInput.present) {
    const cursor = parsePattern(cursorInput.value, cursorPattern, "$.cursor");
    if (!cursor.ok) return cursor;
    result.cursor = cursor.value;
  }
  return valid(deepFreeze(result));
}

function parseResponseInternal(input: unknown, asOfInput: unknown): InternalResult<DemoSearchResponseV1> {
  const asOf = exactTimestamp(asOfInput, "$.asOf");
  if (!asOf.ok) return asOf;
  const object = inspectObject(
    input,
    ["schemaVersion", "dataMode", "fixtureVersion", "dataAsOf", "state", "results", "nextCursor", "totalCount", "reason"],
    "$",
  );
  if (!object.ok) return object;
  const versionInput = required(object.value, "schemaVersion", "$");
  if (!versionInput.ok) return versionInput;
  const version = schemaVersion(versionInput.value, "$.schemaVersion");
  if (!version.ok) return version;
  const modeInput = required(object.value, "dataMode", "$");
  if (!modeInput.ok) return modeInput;
  const mode = literal(modeInput.value, ["synthetic"] as const, "$.dataMode");
  if (!mode.ok) return mode;
  const fixtureInput = required(object.value, "fixtureVersion", "$");
  if (!fixtureInput.ok) return fixtureInput;
  const fixtureVersion = parsePattern(fixtureInput.value, fixtureVersionPattern, "$.fixtureVersion");
  if (!fixtureVersion.ok) return fixtureVersion;
  const dataAsOfInput = required(object.value, "dataAsOf", "$");
  if (!dataAsOfInput.ok) return dataAsOfInput;
  const dataAsOf = exactTimestamp(dataAsOfInput.value, "$.dataAsOf");
  if (!dataAsOf.ok) return dataAsOf;
  const age = Date.parse(asOf.value) - Date.parse(dataAsOf.value);
  if (age < 0) return issue("invalid_value", "$.dataAsOf");
  const stateInput = required(object.value, "state", "$");
  if (!stateInput.ok) return stateInput;
  const state = literal(stateInput.value, ["complete", "partial", "stale"] as const, "$.state");
  if (!state.ok) return state;
  const resultsInput = required(object.value, "results", "$");
  if (!resultsInput.ok) return resultsInput;
  const resultsArray = inspectArray(resultsInput.value, "$.results", DEMO_PAGE_SIZE);
  if (!resultsArray.ok) return resultsArray;
  const results: DemoResultV1[] = [];
  const listingIds = new Set<string>();
  const evidenceIds = new Set<string>();
  for (let index = 0; index < resultsArray.value.length; index += 1) {
    const result = parseResultInternal(resultsArray.value[index], `$.results[${index}]`);
    if (!result.ok) return result;
    if (listingIds.has(result.value.listingId)) {
      return issue("duplicate_id", `$.results[${index}].listingId`);
    }
    for (let evidenceIndex = 0; evidenceIndex < result.value.evidence.length; evidenceIndex += 1) {
      const evidence = result.value.evidence[evidenceIndex];
      if (evidence === undefined) continue;
      if (evidenceIds.has(evidence.evidenceId)) {
        return issue("duplicate_id", `$.results[${index}].evidence[${evidenceIndex}].evidenceId`);
      }
      if (evidence.observedAt > dataAsOf.value) {
        return issue("invalid_value", `$.results[${index}].evidence[${evidenceIndex}].observedAt`);
      }
      evidenceIds.add(evidence.evidenceId);
    }
    listingIds.add(result.value.listingId);
    results.push(result.value);
  }
  const cursorInput = optional(object.value, "nextCursor");
  let nextCursor: string | undefined;
  if (cursorInput.present) {
    const cursor = parsePattern(cursorInput.value, cursorPattern, "$.nextCursor");
    if (!cursor.ok) return cursor;
    if (results.length === 0) return issue("invalid_value", "$.nextCursor");
    nextCursor = cursor.value;
  }
  const totalInput = optional(object.value, "totalCount");
  const reasonInput = optional(object.value, "reason");
  const common = {
    schemaVersion: 1 as const,
    dataMode: "synthetic" as const,
    fixtureVersion: fixtureVersion.value,
    dataAsOf: dataAsOf.value,
    results: [...results],
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
  if (state.value === "complete") {
    if (age > DEMO_FRESHNESS_MS) return issue("invalid_value", "$.state");
    if (reasonInput.present) return issue("unknown_key", "$");
    if (!totalInput.present) return issue("missing_field", "$.totalCount");
    const totalCount = safeInteger(totalInput.value, "$.totalCount", 10_000);
    if (!totalCount.ok) return totalCount;
    if (totalCount.value < results.length) return issue("invalid_value", "$.totalCount");
    if (nextCursor !== undefined && totalCount.value <= results.length) {
      return issue("invalid_value", "$.nextCursor");
    }
    return valid(deepFreeze({ ...common, state: "complete", totalCount: totalCount.value }));
  }
  if (totalInput.present) return issue("unknown_key", "$");
  if (!reasonInput.present) return issue("missing_field", "$.reason");
  if (state.value === "partial") {
    if (age > DEMO_FRESHNESS_MS) return issue("invalid_value", "$.state");
    const reason = literal(reasonInput.value, ["projection_incomplete"] as const, "$.reason");
    return reason.ok
      ? valid(deepFreeze({ ...common, state: "partial", reason: reason.value }))
      : reason;
  }
  if (age <= DEMO_FRESHNESS_MS) return issue("invalid_value", "$.state");
  const reason = literal(reasonInput.value, ["projection_stale"] as const, "$.reason");
  return reason.ok
    ? valid(deepFreeze({ ...common, state: "stale", reason: reason.value }))
    : reason;
}

export function parseDemoSearchQuery(
  input: unknown,
): ValidationResult<DemoSearchQueryV1> {
  return publicResult(parseQueryInternal(input));
}

export function parseDemoResult(input: unknown): ValidationResult<DemoResultV1> {
  return publicResult(parseResultInternal(input, "$"));
}

export function parseDemoSearchResponse(
  input: unknown,
  asOf: unknown,
): ValidationResult<DemoSearchResponseV1> {
  return publicResult(parseResponseInternal(input, asOf));
}
