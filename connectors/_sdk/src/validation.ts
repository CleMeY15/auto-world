import {
  parseSourceId,
  type Currency,
  type MileageUnit,
  type PowerUnit,
  type ValidationIssue,
  type ValidationIssueCode,
  type ValidationResult,
} from "@auto-world/vehicle-schema";
import type { SourceField, Territory } from "@auto-world/source-registry";
import type {
  AcquiredPage,
  AdapterFetchResult,
  ConnectorRunLimits,
  ConnectorRunRequest,
  MappedItemDraft,
  MappedPageDraft,
  ObservationDraft,
  StoreFailureCode,
  StoreResult,
} from "./types.js";

type InternalResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issue: ValidationIssue };

const TERRITORIES = ["FR", "DE", "KR", "GB", "US", "CH", "JP"] as const;
const METHODS = ["api", "feed", "crawl", "manual"] as const;
const SOURCE_FIELDS = [
  "source_listing_id",
  "url",
  "price",
  "mileage",
  "power",
  "co2",
  "vin",
  "description",
  "media",
  "seller_pii",
] as const;
const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "JPY", "KRW"] as const;
const MILEAGE_UNITS = ["km", "mi"] as const;
const POWER_UNITS = ["kw", "metric_hp"] as const;

function issue(code: ValidationIssueCode, path: string): InternalResult<never> {
  return { ok: false, issue: Object.freeze({ code, path }) };
}

function valid<T>(value: T): InternalResult<T> {
  return { ok: true, value };
}

function publish<T>(result: InternalResult<T>): ValidationResult<T> {
  return result.ok
    ? Object.freeze({ success: true as const, data: result.value })
    : Object.freeze({ success: false as const, issues: Object.freeze([result.issue]) });
}

function inspectRecord(
  input: unknown,
  allowedKeys: readonly string[],
  path: string,
): InternalResult<Readonly<Record<string, unknown>>> {
  if (typeof input !== "object" || input === null) {
    return issue("invalid_type", path);
  }
  try {
    if (Array.isArray(input)) return issue("invalid_type", path);
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return issue("invalid_object", path);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const allowed = new Set(allowedKeys);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string" || !allowed.has(key)) return issue("unknown_key", path);
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
        return issue("invalid_object", path);
      }
      output[key] = descriptor.value;
    }
    return valid(output);
  } catch {
    return issue("invalid_object", path);
  }
}

function inspectArray(input: unknown, maximum: number, path: string): InternalResult<readonly unknown[]> {
  if (typeof input !== "object" || input === null) return issue("invalid_type", path);
  try {
    if (!Array.isArray(input)) return issue("invalid_type", path);
    if (Object.getPrototypeOf(input) !== Array.prototype) return issue("invalid_object", path);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      typeof lengthDescriptor.value !== "number" ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      lengthDescriptor.value > maximum ||
      Reflect.ownKeys(descriptors).length !== lengthDescriptor.value + 1
    ) {
      return issue("invalid_object", path);
    }
    const length = lengthDescriptor.value;
    const output: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
        return issue("invalid_object", path);
      }
      output.push(descriptor.value);
    }
    return valid(output);
  } catch {
    return issue("invalid_object", path);
  }
}

function required(
  object: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
): InternalResult<unknown> {
  return Object.hasOwn(object, key) ? valid(object[key]) : issue("missing_field", `${path}.${key}`);
}

function literal<T extends string>(input: unknown, values: readonly T[], path: string): InternalResult<T> {
  if (typeof input !== "string") return issue("invalid_type", path);
  return (values as readonly string[]).includes(input) ? valid(input as T) : issue("invalid_value", path);
}

function boundedInteger(input: unknown, minimum: number, maximum: number, path: string): InternalResult<number> {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= minimum && input <= maximum
    ? valid(input)
    : issue(typeof input === "number" ? "invalid_value" : "invalid_type", path);
}

function finiteNonnegative(input: unknown, path: string): InternalResult<number> {
  return typeof input === "number" && Number.isFinite(input) && input >= 0 && input <= Number.MAX_SAFE_INTEGER && !Object.is(input, -0)
    ? valid(input)
    : issue(typeof input === "number" ? "invalid_value" : "invalid_type", path);
}

function boundedOpaque(input: unknown, maximum: number, path: string): InternalResult<string> {
  if (typeof input !== "string") return issue("invalid_type", path);
  if (input.length < 1 || input.length > maximum || input.trim() !== input) return issue("invalid_value", path);
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code <= 31 || (code >= 127 && code <= 159)) return issue("invalid_value", path);
    if (code >= 0xdc00 && code <= 0xdfff) return issue("invalid_value", path);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = input.charCodeAt(index + 1);
      if (index + 1 >= input.length || low < 0xdc00 || low > 0xdfff) return issue("invalid_value", path);
      index += 1;
    }
  }
  return valid(input);
}

function token(input: unknown, path: string): InternalResult<string> {
  return typeof input === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input)
    ? valid(input)
    : issue(typeof input === "string" ? "invalid_value" : "invalid_type", path);
}

function booleanValue(input: unknown, path: string): InternalResult<boolean> {
  return typeof input === "boolean" ? valid(input) : issue("invalid_type", path);
}

function nullableString(input: unknown, maximum: number, path: string): InternalResult<string | null> {
  if (input === null) return valid(null);
  if (typeof input !== "string") return issue("invalid_type", path);
  return input.length <= maximum ? valid(input) : issue("invalid_value", path);
}

function parseUrl(input: unknown, path: string): InternalResult<string> {
  if (typeof input !== "string") return issue("invalid_type", path);
  if (input.length < 1 || input.length > 2_048 || /\s/.test(input)) return issue("invalid_value", path);
  try {
    const url = new URL(input);
    return url.protocol === "https:" && url.hostname.length > 0 && url.username === "" && url.password === ""
      ? valid(input)
      : issue("invalid_value", path);
  } catch {
    return issue("invalid_value", path);
  }
}

function parseLimits(input: unknown, path: string): InternalResult<ConnectorRunLimits> {
  const object = inspectRecord(input, ["maxPages", "maxItems", "maxRunMs", "maxEffectMs", "maxPageBytes", "maxJsonDepth", "maxJsonMembers"], path);
  if (!object.ok) return object;
  const bounds = {
    maxPages: 1_000,
    maxItems: 100_000,
    maxRunMs: 86_400_000,
    maxEffectMs: 300_000,
    maxPageBytes: 1_048_576,
    maxJsonDepth: 64,
    maxJsonMembers: 100_000,
  } as const;
  const parsed: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const [key, maximum] of Object.entries(bounds)) {
    const raw = required(object.value, key, path);
    if (!raw.ok) return raw;
    const value = boundedInteger(raw.value, 1, maximum, `${path}.${key}`);
    if (!value.ok) return value;
    parsed[key] = value.value;
  }
  return valid(Object.freeze(parsed as unknown as ConnectorRunLimits));
}

function parseFields(input: unknown, path: string): InternalResult<readonly SourceField[]> {
  const array = inspectArray(input, SOURCE_FIELDS.length, path);
  if (!array.ok) return array;
  const fields: SourceField[] = [];
  const seen = new Set<SourceField>();
  for (let index = 0; index < array.value.length; index += 1) {
    const field = literal(array.value[index], SOURCE_FIELDS, `${path}[${index}]`);
    if (!field.ok) return field;
    if (seen.has(field.value)) return issue("duplicate_id", `${path}[${index}]`);
    seen.add(field.value);
    fields.push(field.value);
  }
  return fields.includes("source_listing_id")
    ? valid(Object.freeze(fields.sort()))
    : issue("invalid_value", path);
}

export function parseConnectorRunRequest(input: unknown): ValidationResult<ConnectorRunRequest> {
  const path = "$";
  const object = inspectRecord(input, ["schemaVersion", "sourceId", "territory", "acquisitionMethod", "audience", "fields", "mode", "invocationKey", "adapterVersion", "mapperVersion", "limits"], path);
  if (!object.ok) return publish(object);
  const versionRaw = required(object.value, "schemaVersion", path);
  if (!versionRaw.ok) return publish(versionRaw);
  if (versionRaw.value !== 1) return publish(issue(typeof versionRaw.value === "number" ? "unsupported_version" : "invalid_type", "$.schemaVersion"));
  const sourceRaw = required(object.value, "sourceId", path);
  if (!sourceRaw.ok) return publish(sourceRaw);
  const source = parseSourceId(sourceRaw.value);
  if (!source.success) return Object.freeze({ success: false, issues: Object.freeze([Object.freeze({ code: source.issues[0]?.code ?? "invalid_value", path: "$.sourceId" })]) });
  const territoryRaw = required(object.value, "territory", path);
  if (!territoryRaw.ok) return publish(territoryRaw);
  const territory = literal<Territory>(territoryRaw.value, TERRITORIES, "$.territory");
  if (!territory.ok) return publish(territory);
  const methodRaw = required(object.value, "acquisitionMethod", path);
  if (!methodRaw.ok) return publish(methodRaw);
  const method = literal(methodRaw.value, METHODS, "$.acquisitionMethod");
  if (!method.ok) return publish(method);
  const audienceRaw = required(object.value, "audience", path);
  if (!audienceRaw.ok) return publish(audienceRaw);
  const audience = literal(audienceRaw.value, ["internal"] as const, "$.audience");
  if (!audience.ok) return publish(audience);
  const fieldsRaw = required(object.value, "fields", path);
  if (!fieldsRaw.ok) return publish(fieldsRaw);
  const fields = parseFields(fieldsRaw.value, "$.fields");
  if (!fields.ok) return publish(fields);
  const modeRaw = required(object.value, "mode", path);
  if (!modeRaw.ok) return publish(modeRaw);
  const mode = literal(modeRaw.value, ["incremental", "full"] as const, "$.mode");
  if (!mode.ok) return publish(mode);
  const invocationRaw = required(object.value, "invocationKey", path);
  if (!invocationRaw.ok) return publish(invocationRaw);
  const invocation = token(invocationRaw.value, "$.invocationKey");
  if (!invocation.ok) return publish(invocation);
  const adapterRaw = required(object.value, "adapterVersion", path);
  if (!adapterRaw.ok) return publish(adapterRaw);
  const adapter = token(adapterRaw.value, "$.adapterVersion");
  if (!adapter.ok) return publish(adapter);
  const mapperRaw = required(object.value, "mapperVersion", path);
  if (!mapperRaw.ok) return publish(mapperRaw);
  const mapper = token(mapperRaw.value, "$.mapperVersion");
  if (!mapper.ok) return publish(mapper);
  const limitsRaw = required(object.value, "limits", path);
  if (!limitsRaw.ok) return publish(limitsRaw);
  const limits = parseLimits(limitsRaw.value, "$.limits");
  if (!limits.ok) return publish(limits);
  return publish(valid(Object.freeze({ schemaVersion: 1, sourceId: source.data, territory: territory.value, acquisitionMethod: method.value, audience: audience.value, fields: fields.value, mode: mode.value, invocationKey: invocation.value, adapterVersion: adapter.value, mapperVersion: mapper.value, limits: limits.value })));
}

function parseAcquiredPage(input: unknown, path: string): InternalResult<AcquiredPage> {
  const object = inspectRecord(input, ["pageIdentity", "bytes", "nextCursor", "complete"], path);
  if (!object.ok) return object;
  const identityRaw = required(object.value, "pageIdentity", path);
  if (!identityRaw.ok) return identityRaw;
  const identity = boundedOpaque(identityRaw.value, 256, `${path}.pageIdentity`);
  if (!identity.ok) return identity;
  const bytesRaw = required(object.value, "bytes", path);
  if (!bytesRaw.ok) return bytesRaw;
  try {
    if (!(bytesRaw.value instanceof Uint8Array) || Object.getPrototypeOf(bytesRaw.value) !== Uint8Array.prototype) return issue("invalid_type", `${path}.bytes`);
    if (bytesRaw.value.byteLength > 1_048_576) return issue("invalid_value", `${path}.bytes`);
  } catch {
    return issue("invalid_object", `${path}.bytes`);
  }
  const cursorRaw = required(object.value, "nextCursor", path);
  if (!cursorRaw.ok) return cursorRaw;
  const cursor = nullableString(cursorRaw.value, 2_048, `${path}.nextCursor`);
  if (!cursor.ok) return cursor;
  const completeRaw = required(object.value, "complete", path);
  if (!completeRaw.ok) return completeRaw;
  const complete = booleanValue(completeRaw.value, `${path}.complete`);
  if (!complete.ok) return complete;
  if (!complete.value && cursor.value === null) return issue("invalid_value", `${path}.nextCursor`);
  return valid(Object.freeze({ pageIdentity: identity.value, bytes: bytesRaw.value.slice(), nextCursor: cursor.value, complete: complete.value }));
}

export function parseAdapterFetchResult(input: unknown): ValidationResult<AdapterFetchResult> {
  const initial = inspectRecord(input, ["success", "page", "failure"], "$");
  if (!initial.ok) return publish(initial);
  const successRaw = required(initial.value, "success", "$");
  if (!successRaw.ok) return publish(successRaw);
  const success = booleanValue(successRaw.value, "$.success");
  if (!success.ok) return publish(success);
  if (success.value) {
    const exact = inspectRecord(input, ["success", "page"], "$");
    if (!exact.ok) return publish(exact);
    const pageRaw = required(exact.value, "page", "$");
    if (!pageRaw.ok) return publish(pageRaw);
    const page = parseAcquiredPage(pageRaw.value, "$.page");
    return page.ok ? publish(valid(Object.freeze({ success: true as const, page: page.value }))) : publish(page);
  }
  const exact = inspectRecord(input, ["success", "failure"], "$");
  if (!exact.ok) return publish(exact);
  const failureRaw = required(exact.value, "failure", "$");
  if (!failureRaw.ok) return publish(failureRaw);
  const failure = inspectRecord(failureRaw.value, ["kind", "retryAfterMs"], "$.failure");
  if (!failure.ok) return publish(failure);
  const kindRaw = required(failure.value, "kind", "$.failure");
  if (!kindRaw.ok) return publish(kindRaw);
  const kind = literal(kindRaw.value, ["rate_limited", "transient", "terminal"] as const, "$.failure.kind");
  if (!kind.ok) return publish(kind);
  if (!Object.hasOwn(failure.value, "retryAfterMs")) return publish(valid(Object.freeze({ success: false as const, failure: Object.freeze({ kind: kind.value }) })));
  const retry = boundedInteger(failure.value.retryAfterMs, 0, 300_000, "$.failure.retryAfterMs");
  return retry.ok
    ? publish(valid(Object.freeze({ success: false as const, failure: Object.freeze({ kind: kind.value, retryAfterMs: retry.value }) })))
    : publish(retry);
}

function parseObservationValue(field: string, input: unknown, path: string): InternalResult<ObservationDraft["value"]> {
  if (field === "price") {
    const object = inspectRecord(input, ["amountMinor", "currency"], path);
    if (!object.ok) return object;
    const amountRaw = required(object.value, "amountMinor", path); if (!amountRaw.ok) return amountRaw;
    const amount = boundedInteger(amountRaw.value, 0, Number.MAX_SAFE_INTEGER, `${path}.amountMinor`); if (!amount.ok) return amount;
    const currencyRaw = required(object.value, "currency", path); if (!currencyRaw.ok) return currencyRaw;
    const currency = literal<Currency>(currencyRaw.value, CURRENCIES, `${path}.currency`); if (!currency.ok) return currency;
    return valid(Object.freeze({ amountMinor: amount.value, currency: currency.value }));
  }
  if (field === "mileage" || field === "power") {
    const object = inspectRecord(input, ["amount", "unit"], path); if (!object.ok) return object;
    const amountRaw = required(object.value, "amount", path); if (!amountRaw.ok) return amountRaw;
    const amount = finiteNonnegative(amountRaw.value, `${path}.amount`); if (!amount.ok) return amount;
    const unitRaw = required(object.value, "unit", path); if (!unitRaw.ok) return unitRaw;
    if (field === "mileage") {
      const unit = literal<MileageUnit>(unitRaw.value, MILEAGE_UNITS, `${path}.unit`);
      return unit.ok ? valid(Object.freeze({ amount: amount.value, unit: unit.value })) : unit;
    }
    const unit = literal<PowerUnit>(unitRaw.value, POWER_UNITS, `${path}.unit`);
    return unit.ok ? valid(Object.freeze({ amount: amount.value, unit: unit.value })) : unit;
  }
  if (field === "co2") {
    const object = inspectRecord(input, ["amount", "unit", "standard"], path); if (!object.ok) return object;
    const amountRaw = required(object.value, "amount", path); if (!amountRaw.ok) return amountRaw;
    const amount = finiteNonnegative(amountRaw.value, `${path}.amount`); if (!amount.ok) return amount;
    const unitRaw = required(object.value, "unit", path); if (!unitRaw.ok) return unitRaw;
    const unit = literal(unitRaw.value, ["g_per_km"] as const, `${path}.unit`); if (!unit.ok) return unit;
    const standardRaw = required(object.value, "standard", path); if (!standardRaw.ok) return standardRaw;
    const standard = literal(standardRaw.value, ["wltp", "nedc"] as const, `${path}.standard`); if (!standard.ok) return standard;
    return valid(Object.freeze({ amount: amount.value, unit: unit.value, standard: standard.value }));
  }
  const object = inspectRecord(input, ["status", "vin"], path); if (!object.ok) return object;
  const statusRaw = required(object.value, "status", path); if (!statusRaw.ok) return statusRaw;
  const status = literal(statusRaw.value, ["unavailable", "withheld", "full"] as const, `${path}.status`); if (!status.ok) return status;
  if (status.value !== "full") {
    const exact = inspectRecord(input, ["status"], path);
    return exact.ok ? valid(Object.freeze({ status: status.value })) : exact;
  }
  const vinRaw = required(object.value, "vin", path); if (!vinRaw.ok) return vinRaw;
  return typeof vinRaw.value === "string" && /^[A-HJ-NPR-Z0-9]{17}$/.test(vinRaw.value)
    ? valid(Object.freeze({ status: "full" as const, vin: vinRaw.value }))
    : issue(typeof vinRaw.value === "string" ? "invalid_value" : "invalid_type", `${path}.vin`);
}

function observationFingerprint(draft: ObservationDraft): string {
  const value = draft.value;
  if (draft.field === "price" && "amountMinor" in value) return `price:${value.amountMinor}:${value.currency}:${draft.confidenceBps}`;
  if ((draft.field === "mileage" || draft.field === "power") && "amount" in value && "unit" in value) return `${draft.field}:${value.amount}:${value.unit}:${draft.confidenceBps}`;
  if (draft.field === "co2" && "standard" in value) return `co2:${value.amount}:${value.standard}:${draft.confidenceBps}`;
  if (draft.field === "vin" && "status" in value) return value.status === "full" ? `vin:full:${value.vin}:${draft.confidenceBps}` : `vin:${value.status}:${draft.confidenceBps}`;
  return "invalid";
}

function parseObservationDraft(input: unknown, path: string): InternalResult<ObservationDraft> {
  const object = inspectRecord(input, ["field", "value", "confidenceBps"], path); if (!object.ok) return object;
  const fieldRaw = required(object.value, "field", path); if (!fieldRaw.ok) return fieldRaw;
  const field = literal(fieldRaw.value, ["price", "mileage", "power", "co2", "vin"] as const, `${path}.field`); if (!field.ok) return field;
  const confidenceRaw = required(object.value, "confidenceBps", path); if (!confidenceRaw.ok) return confidenceRaw;
  const confidence = boundedInteger(confidenceRaw.value, 0, 10_000, `${path}.confidenceBps`); if (!confidence.ok) return confidence;
  const valueRaw = required(object.value, "value", path); if (!valueRaw.ok) return valueRaw;
  const value = parseObservationValue(field.value, valueRaw.value, `${path}.value`); if (!value.ok) return value;
  return valid(Object.freeze({ field: field.value, value: value.value, confidenceBps: confidence.value }) as ObservationDraft);
}

function parseMappedItem(input: unknown, path: string): InternalResult<MappedItemDraft> {
  const initial = inspectRecord(input, ["sourceListingId", "outcome", "url", "observations"], path); if (!initial.ok) return initial;
  const idRaw = required(initial.value, "sourceListingId", path); if (!idRaw.ok) return idRaw;
  const id = boundedOpaque(idRaw.value, 256, `${path}.sourceListingId`); if (!id.ok) return id;
  const outcomeRaw = required(initial.value, "outcome", path); if (!outcomeRaw.ok) return outcomeRaw;
  const outcome = literal(outcomeRaw.value, ["active", "withdrawn", "deleted"] as const, `${path}.outcome`); if (!outcome.ok) return outcome;
  if (outcome.value !== "active") {
    const exact = inspectRecord(input, ["sourceListingId", "outcome"], path);
    return exact.ok ? valid(Object.freeze({ sourceListingId: id.value, outcome: outcome.value })) : exact;
  }
  const exact = inspectRecord(input, ["sourceListingId", "outcome", "url", "observations"], path); if (!exact.ok) return exact;
  const observationsRaw = required(exact.value, "observations", path); if (!observationsRaw.ok) return observationsRaw;
  const observationsArray = inspectArray(observationsRaw.value, 16, `${path}.observations`); if (!observationsArray.ok) return observationsArray;
  const observations: ObservationDraft[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < observationsArray.value.length; index += 1) {
    const parsed = parseObservationDraft(observationsArray.value[index], `${path}.observations[${index}]`); if (!parsed.ok) return parsed;
    const fingerprint = observationFingerprint(parsed.value);
    if (!seen.has(fingerprint)) { seen.add(fingerprint); observations.push(parsed.value); }
  }
  const urlRaw = Object.hasOwn(exact.value, "url") ? parseUrl(exact.value.url, `${path}.url`) : valid<string | undefined>(undefined);
  if (!urlRaw.ok) return urlRaw;
  const result = urlRaw.value === undefined
    ? { sourceListingId: id.value, outcome: "active" as const, observations: Object.freeze(observations) }
    : { sourceListingId: id.value, outcome: "active" as const, url: urlRaw.value, observations: Object.freeze(observations) };
  return valid(Object.freeze(result));
}

export function parseMappedPageDraft(input: unknown): ValidationResult<MappedPageDraft> {
  const object = inspectRecord(input, ["items"], "$"); if (!object.ok) return publish(object);
  const itemsRaw = required(object.value, "items", "$"); if (!itemsRaw.ok) return publish(itemsRaw);
  const array = inspectArray(itemsRaw.value, 100_000, "$.items"); if (!array.ok) return publish(array);
  const items: MappedItemDraft[] = [];
  const publications = new Set<string>();
  let observationCount = 0;
  for (let index = 0; index < array.value.length; index += 1) {
    const item = parseMappedItem(array.value[index], `$.items[${index}]`); if (!item.ok) return publish(item);
    if (publications.has(item.value.sourceListingId)) return publish(issue("duplicate_id", `$.items[${index}]`));
    publications.add(item.value.sourceListingId);
    if (item.value.outcome === "active") observationCount += item.value.observations.length;
    if (observationCount > 100_000) return publish(issue("invalid_value", "$.items"));
    items.push(item.value);
  }
  return publish(valid(Object.freeze({ items: Object.freeze(items) })));
}

const STORE_FAILURE_CODES = [
  "stale_fence",
  "fence_not_quiesced",
  "idempotency_conflict",
  "checkpoint_conflict",
  "inventory_conflict",
  "runtime_conflict",
  "raw_conflict",
  "retention_expired",
  "full_reconciliation_required",
  "circuit_open",
  "not_found",
  "invalid_state",
] as const;

export function parseStoreResult<T>(
  input: unknown,
  parseData: (input: unknown) => ValidationResult<T>,
): ValidationResult<StoreResult<T>> {
  const initial = inspectRecord(input, ["acknowledged", "success", "data", "failure"], "$");
  if (!initial.ok) return publish(initial);
  const acknowledgedRaw = required(initial.value, "acknowledged", "$");
  if (!acknowledgedRaw.ok) return publish(acknowledgedRaw);
  if (acknowledgedRaw.value !== true) return publish(issue("invalid_value", "$.acknowledged"));
  const successRaw = required(initial.value, "success", "$");
  if (!successRaw.ok) return publish(successRaw);
  const success = booleanValue(successRaw.value, "$.success");
  if (!success.ok) return publish(success);
  if (success.value) {
    const exact = inspectRecord(input, ["acknowledged", "success", "data"], "$");
    if (!exact.ok) return publish(exact);
    const dataRaw = required(exact.value, "data", "$");
    if (!dataRaw.ok) return publish(dataRaw);
    try {
      const parsed = parseData(dataRaw.value);
      return parsed.success
        ? publish(valid(Object.freeze({ acknowledged: true as const, success: true as const, data: parsed.data })))
        : Object.freeze({ success: false as const, issues: Object.freeze(parsed.issues.map((entry) => Object.freeze({ ...entry }))) });
    } catch {
      return publish(issue("invalid_object", "$.data"));
    }
  }
  const exact = inspectRecord(input, ["acknowledged", "success", "failure"], "$");
  if (!exact.ok) return publish(exact);
  const failureRaw = required(exact.value, "failure", "$");
  if (!failureRaw.ok) return publish(failureRaw);
  const failure = inspectRecord(failureRaw.value, ["code", "retryable"], "$.failure");
  if (!failure.ok) return publish(failure);
  const codeRaw = required(failure.value, "code", "$.failure");
  if (!codeRaw.ok) return publish(codeRaw);
  const code = literal<StoreFailureCode>(codeRaw.value, STORE_FAILURE_CODES, "$.failure.code");
  if (!code.ok) return publish(code);
  const retryableRaw = required(failure.value, "retryable", "$.failure");
  if (!retryableRaw.ok) return publish(retryableRaw);
  if (retryableRaw.value !== false) return publish(issue("invalid_value", "$.failure.retryable"));
  return publish(valid(Object.freeze({ acknowledged: true as const, success: false as const, failure: Object.freeze({ code: code.value, retryable: false as const }) })));
}
