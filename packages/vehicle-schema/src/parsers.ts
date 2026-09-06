import type {
  AcquisitionMethod,
  Co2Standard,
  ConnectorRunId,
  Currency,
  IdentityEvidence,
  LegalStatus,
  Listing,
  ListingId,
  ListingIdentity,
  MileageUnit,
  Observation,
  ObservationCollection,
  ObservationId,
  ObservationSubject,
  PowerUnit,
  Provenance,
  RawReference,
  RawSnapshotId,
  SourceId,
  ValidationResult,
  VehicleEntity,
  VehicleEntityId,
} from "./types.js";
import {
  deepFreeze,
  finiteNonnegativeNumber,
  inspectDenseArray,
  inspectObject,
  issue,
  literalValue,
  nonnegativeSafeInteger,
  optional,
  publicResult,
  required,
  schemaVersion,
  stringValue,
  valid,
  type InternalResult,
} from "./validation.js";

const acquisitionMethods = ["api", "feed", "crawl", "manual"] as const;
const legalStatuses = [
  "official_api",
  "licensed_partner",
  "dealer_feed",
  "permitted_crawl",
  "restricted",
  "blocked",
  "unknown",
] as const;
const permittedVinStatuses: ReadonlySet<LegalStatus> = new Set([
  "official_api",
  "licensed_partner",
  "dealer_feed",
  "permitted_crawl",
]);
const currencies = ["EUR", "USD", "GBP", "CHF", "JPY", "KRW"] as const;
const mileageUnits = ["km", "mi"] as const;
const powerUnits = ["kw", "metric_hp"] as const;
const co2Standards = ["wltp", "nedc"] as const;
const observationFields = ["price", "mileage", "power", "co2", "vin"] as const;

function parseId<T extends string>(
  input: unknown,
  prefix: string,
  path: string,
): InternalResult<T> {
  const parsed = stringValue(input, path);
  if (!parsed.ok) {
    return parsed;
  }
  const suffix = parsed.value.slice(prefix.length);
  if (
    !parsed.value.startsWith(prefix) ||
    suffix.length < 1 ||
    suffix.length > 64 ||
    !/[A-Za-z0-9]/.test(suffix[0] ?? "") ||
    /[^A-Za-z0-9_-]/.test(suffix)
  ) {
    return issue("invalid_value", path);
  }
  return valid(parsed.value as T);
}

/** Validate the shared source identity without constructing a vehicle record. */
export function parseSourceId(input: unknown): ValidationResult<SourceId> {
  return publicResult(parseId<SourceId>(input, "src_", "$"));
}

function parseVersionedObject(
  input: unknown,
  keys: readonly string[],
  path: string,
): InternalResult<Readonly<Record<string, unknown>>> {
  const object = inspectObject(input, keys, path);
  if (!object.ok) {
    return object;
  }
  const versionInput = required(object.value, "schemaVersion", path);
  if (!versionInput.ok) {
    return versionInput;
  }
  const version = schemaVersion(versionInput.value, `${path}.schemaVersion`);
  return version.ok ? object : version;
}

function parseObservationIds(input: unknown, path: string): InternalResult<readonly ObservationId[]> {
  const array = inspectDenseArray(input, path);
  if (!array.ok) {
    return array;
  }
  const result: ObservationId[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < array.value.length; index += 1) {
    const parsed = parseId<ObservationId>(array.value[index], "obs_", `${path}[${index}]`);
    if (!parsed.ok) {
      return parsed;
    }
    if (seen.has(parsed.value)) {
      return issue("duplicate_id", `${path}[${index}]`);
    }
    seen.add(parsed.value);
    result.push(parsed.value);
  }
  return valid(result);
}

function parseListingIdentity(input: unknown, path: string): InternalResult<ListingIdentity> {
  const initial = inspectObject(input, ["status", "vehicleId"], path);
  if (!initial.ok) {
    return initial;
  }
  const statusInput = required(initial.value, "status", path);
  if (!statusInput.ok) {
    return statusInput;
  }
  const status = literalValue(statusInput.value, ["unresolved", "candidate"] as const, `${path}.status`);
  if (!status.ok) {
    return status;
  }

  if (status.value === "unresolved") {
    const exact = inspectObject(input, ["status"], path);
    return exact.ok ? valid({ status: "unresolved" }) : exact;
  }

  const vehicleIdInput = required(initial.value, "vehicleId", path);
  if (!vehicleIdInput.ok) {
    return vehicleIdInput;
  }
  const vehicleId = parseId<VehicleEntityId>(vehicleIdInput.value, "veh_", `${path}.vehicleId`);
  return vehicleId.ok ? valid({ status: "candidate", vehicleId: vehicleId.value }) : vehicleId;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || (code >= 127 && code <= 159)) {
      return true;
    }
  }
  return false;
}

function parseSourceListingId(input: unknown, path: string): InternalResult<string> {
  const parsed = stringValue(input, path);
  if (!parsed.ok) {
    return parsed;
  }
  if (
    parsed.value.length < 1 ||
    parsed.value.length > 256 ||
    parsed.value.trim() !== parsed.value ||
    hasControlCharacter(parsed.value)
  ) {
    return issue("invalid_value", path);
  }
  return parsed;
}

function parseUrl(input: unknown, path: string): InternalResult<string> {
  const parsed = stringValue(input, path);
  if (!parsed.ok) {
    return parsed;
  }
  if (
    parsed.value.length > 2_048 ||
    /\s/.test(parsed.value) ||
    hasControlCharacter(parsed.value)
  ) {
    return issue("invalid_value", path);
  }
  try {
    const url = new URL(parsed.value);
    if (
      url.protocol !== "https:" ||
      url.hostname.length === 0 ||
      url.username.length !== 0 ||
      url.password.length !== 0
    ) {
      return issue("invalid_value", path);
    }
  } catch {
    return issue("invalid_value", path);
  }
  return parsed;
}

function parseSubject(input: unknown, path: string): InternalResult<ObservationSubject> {
  const initial = inspectObject(input, ["kind", "vehicleId", "listingId"], path);
  if (!initial.ok) {
    return initial;
  }
  const kindInput = required(initial.value, "kind", path);
  if (!kindInput.ok) {
    return kindInput;
  }
  const kind = literalValue(kindInput.value, ["vehicle", "listing"] as const, `${path}.kind`);
  if (!kind.ok) {
    return kind;
  }

  if (kind.value === "vehicle") {
    const exact = inspectObject(input, ["kind", "vehicleId"], path);
    if (!exact.ok) {
      return exact;
    }
    const idInput = required(exact.value, "vehicleId", path);
    if (!idInput.ok) {
      return idInput;
    }
    const vehicleId = parseId<VehicleEntityId>(idInput.value, "veh_", `${path}.vehicleId`);
    return vehicleId.ok ? valid({ kind: "vehicle", vehicleId: vehicleId.value }) : vehicleId;
  }

  const exact = inspectObject(input, ["kind", "listingId"], path);
  if (!exact.ok) {
    return exact;
  }
  const idInput = required(exact.value, "listingId", path);
  if (!idInput.ok) {
    return idInput;
  }
  const listingId = parseId<ListingId>(idInput.value, "lst_", `${path}.listingId`);
  return listingId.ok ? valid({ kind: "listing", listingId: listingId.value }) : listingId;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function parseObservedAt(input: unknown, path: string): InternalResult<string> {
  const parsed = stringValue(input, path);
  if (!parsed.ok) {
    return parsed;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/.exec(parsed.value);
  if (parsed.value.length !== 24 || match === null) {
    return issue("invalid_value", path);
  }
  const parts = match.slice(1).map(Number);
  const [year, month, day, hour, minute, second] = parts;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined ||
    year < 1 ||
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return issue("invalid_value", path);
  }
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maximumDay = days[month - 1];
  return maximumDay !== undefined && day >= 1 && day <= maximumDay
    ? parsed
    : issue("invalid_value", path);
}

function parseRawReference(input: unknown, path: string): InternalResult<RawReference> {
  const object = inspectObject(input, ["snapshotId", "connectorRunId", "sha256"], path);
  if (!object.ok) {
    return object;
  }
  const snapshotInput = required(object.value, "snapshotId", path);
  if (!snapshotInput.ok) return snapshotInput;
  const snapshotId = parseId<RawSnapshotId>(snapshotInput.value, "raw_", `${path}.snapshotId`);
  if (!snapshotId.ok) return snapshotId;
  const runInput = required(object.value, "connectorRunId", path);
  if (!runInput.ok) return runInput;
  const connectorRunId = parseId<ConnectorRunId>(runInput.value, "run_", `${path}.connectorRunId`);
  if (!connectorRunId.ok) return connectorRunId;
  const digestInput = required(object.value, "sha256", path);
  if (!digestInput.ok) return digestInput;
  const digest = stringValue(digestInput.value, `${path}.sha256`);
  if (!digest.ok) return digest;
  if (digest.value.length !== 64 || /[^0-9a-f]/.test(digest.value)) {
    return issue("invalid_value", `${path}.sha256`);
  }
  return valid({ snapshotId: snapshotId.value, connectorRunId: connectorRunId.value, sha256: digest.value });
}

function parseProvenance(input: unknown, path: string): InternalResult<Provenance> {
  const object = inspectObject(
    input,
    ["sourceId", "observedAt", "acquisitionMethod", "legalStatus", "confidenceBps", "raw"],
    path,
  );
  if (!object.ok) return object;

  const sourceInput = required(object.value, "sourceId", path);
  if (!sourceInput.ok) return sourceInput;
  const sourceId = parseId<SourceId>(sourceInput.value, "src_", `${path}.sourceId`);
  if (!sourceId.ok) return sourceId;
  const observedInput = required(object.value, "observedAt", path);
  if (!observedInput.ok) return observedInput;
  const observedAt = parseObservedAt(observedInput.value, `${path}.observedAt`);
  if (!observedAt.ok) return observedAt;
  const methodInput = required(object.value, "acquisitionMethod", path);
  if (!methodInput.ok) return methodInput;
  const acquisitionMethod = literalValue<AcquisitionMethod>(methodInput.value, acquisitionMethods, `${path}.acquisitionMethod`);
  if (!acquisitionMethod.ok) return acquisitionMethod;
  const legalInput = required(object.value, "legalStatus", path);
  if (!legalInput.ok) return legalInput;
  const legalStatus = literalValue<LegalStatus>(legalInput.value, legalStatuses, `${path}.legalStatus`);
  if (!legalStatus.ok) return legalStatus;
  const confidenceInput = required(object.value, "confidenceBps", path);
  if (!confidenceInput.ok) return confidenceInput;
  const confidenceBps = nonnegativeSafeInteger(confidenceInput.value, `${path}.confidenceBps`);
  if (!confidenceBps.ok) return confidenceBps;
  if (confidenceBps.value > 10_000) return issue("invalid_value", `${path}.confidenceBps`);
  const rawInput = required(object.value, "raw", path);
  if (!rawInput.ok) return rawInput;
  const raw = parseRawReference(rawInput.value, `${path}.raw`);
  if (!raw.ok) return raw;

  return valid({
    sourceId: sourceId.value,
    observedAt: observedAt.value,
    acquisitionMethod: acquisitionMethod.value,
    legalStatus: legalStatus.value,
    confidenceBps: confidenceBps.value,
    raw: raw.value,
  });
}

function parseIdentityEvidence(input: unknown, path: string): InternalResult<IdentityEvidence> {
  const initial = inspectObject(input, ["status", "vin", "accessPolicy"], path);
  if (!initial.ok) return initial;
  const statusInput = required(initial.value, "status", path);
  if (!statusInput.ok) return statusInput;
  const status = literalValue(statusInput.value, ["unavailable", "withheld", "full"] as const, `${path}.status`);
  if (!status.ok) return status;

  if (status.value !== "full") {
    const exact = inspectObject(input, ["status"], path);
    return exact.ok ? valid({ status: status.value }) : exact;
  }

  const exact = inspectObject(input, ["status", "vin", "accessPolicy"], path);
  if (!exact.ok) return exact;
  const vinInput = required(exact.value, "vin", path);
  if (!vinInput.ok) return vinInput;
  const vin = stringValue(vinInput.value, `${path}.vin`);
  if (!vin.ok) return vin;
  if (vin.value.length !== 17 || /[^A-HJ-NPR-Z0-9]/.test(vin.value)) {
    return issue("invalid_value", `${path}.vin`);
  }
  const policyInput = required(exact.value, "accessPolicy", path);
  if (!policyInput.ok) return policyInput;
  const policy = inspectObject(policyInput.value, ["visibility", "policyRef"], `${path}.accessPolicy`);
  if (!policy.ok) return policy;
  const visibilityInput = required(policy.value, "visibility", `${path}.accessPolicy`);
  if (!visibilityInput.ok) return visibilityInput;
  const visibility = literalValue(visibilityInput.value, ["internal"] as const, `${path}.accessPolicy.visibility`);
  if (!visibility.ok) return visibility;
  const policyRefInput = required(policy.value, "policyRef", `${path}.accessPolicy`);
  if (!policyRefInput.ok) return policyRefInput;
  const policyRef = stringValue(policyRefInput.value, `${path}.accessPolicy.policyRef`);
  if (!policyRef.ok) return policyRef;
  if (
    policyRef.value.length < 1 ||
    policyRef.value.length > 128 ||
    /[^A-Za-z0-9_-]/.test(policyRef.value)
  ) {
    return issue("invalid_value", `${path}.accessPolicy.policyRef`);
  }
  return valid({ status: "full", vin: vin.value, accessPolicy: { visibility: "internal", policyRef: policyRef.value } });
}

function parseValue(
  field: (typeof observationFields)[number],
  input: unknown,
  path: string,
): InternalResult<Observation["value"]> {
  if (field === "price") {
    const object = inspectObject(input, ["amountMinor", "currency"], path);
    if (!object.ok) return object;
    const amountInput = required(object.value, "amountMinor", path);
    if (!amountInput.ok) return amountInput;
    const amountMinor = nonnegativeSafeInteger(amountInput.value, `${path}.amountMinor`);
    if (!amountMinor.ok) return amountMinor;
    const currencyInput = required(object.value, "currency", path);
    if (!currencyInput.ok) return currencyInput;
    const currency = literalValue<Currency>(currencyInput.value, currencies, `${path}.currency`);
    return currency.ok ? valid({ amountMinor: amountMinor.value, currency: currency.value }) : currency;
  }
  if (field === "mileage" || field === "power") {
    const object = inspectObject(input, ["amount", "unit"], path);
    if (!object.ok) return object;
    const amountInput = required(object.value, "amount", path);
    if (!amountInput.ok) return amountInput;
    const amount = finiteNonnegativeNumber(amountInput.value, `${path}.amount`);
    if (!amount.ok) return amount;
    const unitInput = required(object.value, "unit", path);
    if (!unitInput.ok) return unitInput;
    if (field === "mileage") {
      const unit = literalValue<MileageUnit>(unitInput.value, mileageUnits, `${path}.unit`);
      return unit.ok ? valid({ amount: amount.value, unit: unit.value }) : unit;
    }
    const unit = literalValue<PowerUnit>(unitInput.value, powerUnits, `${path}.unit`);
    return unit.ok ? valid({ amount: amount.value, unit: unit.value }) : unit;
  }
  if (field === "co2") {
    const object = inspectObject(input, ["amount", "unit", "standard"], path);
    if (!object.ok) return object;
    const amountInput = required(object.value, "amount", path);
    if (!amountInput.ok) return amountInput;
    const amount = finiteNonnegativeNumber(amountInput.value, `${path}.amount`);
    if (!amount.ok) return amount;
    const unitInput = required(object.value, "unit", path);
    if (!unitInput.ok) return unitInput;
    const unit = literalValue(unitInput.value, ["g_per_km"] as const, `${path}.unit`);
    if (!unit.ok) return unit;
    const standardInput = required(object.value, "standard", path);
    if (!standardInput.ok) return standardInput;
    const standard = literalValue<Co2Standard>(standardInput.value, co2Standards, `${path}.standard`);
    return standard.ok
      ? valid({ amount: amount.value, unit: "g_per_km", standard: standard.value })
      : standard;
  }
  return parseIdentityEvidence(input, path);
}

function parseVehicleEntityInternal(input: unknown, path: string): InternalResult<VehicleEntity> {
  const object = parseVersionedObject(input, ["schemaVersion", "vehicleId", "identityStatus", "observationIds"], path);
  if (!object.ok) return object;
  const idInput = required(object.value, "vehicleId", path);
  if (!idInput.ok) return idInput;
  const vehicleId = parseId<VehicleEntityId>(idInput.value, "veh_", `${path}.vehicleId`);
  if (!vehicleId.ok) return vehicleId;
  const statusInput = required(object.value, "identityStatus", path);
  if (!statusInput.ok) return statusInput;
  const identityStatus = literalValue(statusInput.value, ["candidate"] as const, `${path}.identityStatus`);
  if (!identityStatus.ok) return identityStatus;
  const observationsInput = required(object.value, "observationIds", path);
  if (!observationsInput.ok) return observationsInput;
  const observationIds = parseObservationIds(observationsInput.value, `${path}.observationIds`);
  if (!observationIds.ok) return observationIds;
  return valid(deepFreeze({ schemaVersion: 1, vehicleId: vehicleId.value, identityStatus: "candidate", observationIds: [...observationIds.value] }));
}

function parseListingInternal(input: unknown, path: string): InternalResult<Listing> {
  const object = parseVersionedObject(input, ["schemaVersion", "listingId", "sourceId", "sourceListingId", "identity", "observationIds", "url"], path);
  if (!object.ok) return object;
  const listingInput = required(object.value, "listingId", path);
  if (!listingInput.ok) return listingInput;
  const listingId = parseId<ListingId>(listingInput.value, "lst_", `${path}.listingId`);
  if (!listingId.ok) return listingId;
  const sourceInput = required(object.value, "sourceId", path);
  if (!sourceInput.ok) return sourceInput;
  const sourceId = parseId<SourceId>(sourceInput.value, "src_", `${path}.sourceId`);
  if (!sourceId.ok) return sourceId;
  const publicationInput = required(object.value, "sourceListingId", path);
  if (!publicationInput.ok) return publicationInput;
  const sourceListingId = parseSourceListingId(publicationInput.value, `${path}.sourceListingId`);
  if (!sourceListingId.ok) return sourceListingId;
  const identityInput = required(object.value, "identity", path);
  if (!identityInput.ok) return identityInput;
  const identity = parseListingIdentity(identityInput.value, `${path}.identity`);
  if (!identity.ok) return identity;
  const observationsInput = required(object.value, "observationIds", path);
  if (!observationsInput.ok) return observationsInput;
  const observationIds = parseObservationIds(observationsInput.value, `${path}.observationIds`);
  if (!observationIds.ok) return observationIds;
  const urlInput = optional(object.value, "url");
  if (urlInput.present) {
    const url = parseUrl(urlInput.value, `${path}.url`);
    if (!url.ok) return url;
    return valid(deepFreeze({ schemaVersion: 1, listingId: listingId.value, sourceId: sourceId.value, sourceListingId: sourceListingId.value, identity: identity.value, observationIds: [...observationIds.value], url: url.value }));
  }
  return valid(deepFreeze({ schemaVersion: 1, listingId: listingId.value, sourceId: sourceId.value, sourceListingId: sourceListingId.value, identity: identity.value, observationIds: [...observationIds.value] }));
}

function parseObservationInternal(input: unknown, path: string): InternalResult<Observation> {
  const object = parseVersionedObject(input, ["schemaVersion", "observationId", "subject", "field", "value", "provenance"], path);
  if (!object.ok) return object;
  const idInput = required(object.value, "observationId", path);
  if (!idInput.ok) return idInput;
  const observationId = parseId<ObservationId>(idInput.value, "obs_", `${path}.observationId`);
  if (!observationId.ok) return observationId;
  const subjectInput = required(object.value, "subject", path);
  if (!subjectInput.ok) return subjectInput;
  const subject = parseSubject(subjectInput.value, `${path}.subject`);
  if (!subject.ok) return subject;
  const fieldInput = required(object.value, "field", path);
  if (!fieldInput.ok) return fieldInput;
  const field = literalValue(fieldInput.value, observationFields, `${path}.field`);
  if (!field.ok) return field;
  const valueInput = required(object.value, "value", path);
  if (!valueInput.ok) return valueInput;
  const value = parseValue(field.value, valueInput.value, `${path}.value`);
  if (!value.ok) return value;
  const provenanceInput = required(object.value, "provenance", path);
  if (!provenanceInput.ok) return provenanceInput;
  const provenance = parseProvenance(provenanceInput.value, `${path}.provenance`);
  if (!provenance.ok) return provenance;
  if (
    field.value === "vin" &&
    "status" in value.value &&
    value.value.status === "full" &&
    !permittedVinStatuses.has(provenance.value.legalStatus)
  ) {
    return issue("invalid_value", `${path}.provenance.legalStatus`);
  }

  const common = { schemaVersion: 1 as const, observationId: observationId.value, subject: subject.value, provenance: provenance.value };
  if (field.value === "price" && "amountMinor" in value.value) return valid(deepFreeze({ ...common, field: "price", value: value.value }));
  if (field.value === "mileage" && "amount" in value.value && "unit" in value.value && (value.value.unit === "km" || value.value.unit === "mi")) return valid(deepFreeze({ ...common, field: "mileage", value: value.value }));
  if (field.value === "power" && "amount" in value.value && "unit" in value.value && (value.value.unit === "kw" || value.value.unit === "metric_hp")) return valid(deepFreeze({ ...common, field: "power", value: value.value }));
  if (field.value === "co2" && "standard" in value.value) return valid(deepFreeze({ ...common, field: "co2", value: value.value }));
  if (field.value === "vin" && "status" in value.value) return valid(deepFreeze({ ...common, field: "vin", value: value.value }));
  return issue("invalid_value", `${path}.value`);
}

function parseObservationCollectionInternal(input: unknown, path: string): InternalResult<ObservationCollection> {
  const array = inspectDenseArray(input, path);
  if (!array.ok) return array;
  const result: Observation[] = [];
  const byId = new Map<string, string>();
  for (let index = 0; index < array.value.length; index += 1) {
    const observation = parseObservationInternal(array.value[index], `${path}[${index}]`);
    if (!observation.ok) return observation;
    const serialized = JSON.stringify(observation.value);
    const existing = byId.get(observation.value.observationId);
    if (existing !== undefined) {
      if (existing !== serialized) return issue("observation_conflict", `${path}[${index}]`);
      continue;
    }
    byId.set(observation.value.observationId, serialized);
    result.push(observation.value);
  }
  return valid(deepFreeze(result));
}

export function parseVehicleEntity(input: unknown): ValidationResult<VehicleEntity> {
  return publicResult(parseVehicleEntityInternal(input, "$"));
}

export function parseListing(input: unknown): ValidationResult<Listing> {
  return publicResult(parseListingInternal(input, "$"));
}

export function parseObservation(input: unknown): ValidationResult<Observation> {
  return publicResult(parseObservationInternal(input, "$"));
}

export function parseObservationCollection(input: unknown): ValidationResult<ObservationCollection> {
  return publicResult(parseObservationCollectionInternal(input, "$"));
}

export function appendObservations(existing: unknown, incoming: unknown): ValidationResult<ObservationCollection> {
  const current = parseObservationCollectionInternal(existing, "$.existing");
  if (!current.ok) return publicResult(current);

  const incomingArray = inspectDenseArray(incoming, "$.incoming");
  if (!incomingArray.ok) return publicResult(incomingArray);
  const additions: { readonly observation: Observation; readonly originalIndex: number }[] = [];
  const incomingById = new Map<string, string>();
  for (let index = 0; index < incomingArray.value.length; index += 1) {
    const observation = parseObservationInternal(
      incomingArray.value[index],
      `$.incoming[${index}]`,
    );
    if (!observation.ok) return publicResult(observation);
    const serialized = JSON.stringify(observation.value);
    const previous = incomingById.get(observation.value.observationId);
    if (previous !== undefined) {
      if (previous !== serialized) {
        return publicResult(issue("observation_conflict", `$.incoming[${index}]`));
      }
      continue;
    }
    incomingById.set(observation.value.observationId, serialized);
    additions.push({ observation: observation.value, originalIndex: index });
  }

  const combined: Observation[] = [...current.value];
  const byId = new Map(
    current.value.map((observation) => [
      observation.observationId,
      JSON.stringify(observation),
    ]),
  );
  for (const addition of additions) {
    const { observation, originalIndex } = addition;
    const serialized = JSON.stringify(observation);
    const existingContent = byId.get(observation.observationId);
    if (existingContent !== undefined) {
      if (existingContent !== serialized) {
        return publicResult(
          issue("observation_conflict", `$.incoming[${originalIndex}]`),
        );
      }
      continue;
    }
    if (combined.length === 10_000) {
      return publicResult(issue("invalid_value", "$"));
    }
    byId.set(observation.observationId, serialized);
    combined.push(observation);
  }
  return publicResult(valid(deepFreeze(combined)));
}
