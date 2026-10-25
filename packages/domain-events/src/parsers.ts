import {
  parseListingId,
  parseObservation,
  parseObservationId,
  type Observation,
  type ValidationIssue,
  type ValidationIssueCode,
  type ValidationResult,
} from "@auto-world/vehicle-schema";

import type {
  DomainEventId,
  ObservationChangeEventV1,
  ObservationChangeEvidenceV1,
} from "./types.js";

type InternalResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issue: ValidationIssue };

const eventKeys = [
  "schemaVersion",
  "eventId",
  "type",
  "listingId",
  "previousObservationId",
  "currentObservationId",
  "observedAt",
  "occurredAt",
] as const;

function valid<T>(value: T): InternalResult<T> {
  return { ok: true, value };
}

function issue(code: ValidationIssueCode, path: string): InternalResult<never> {
  return { ok: false, issue: { code, path } };
}

function publicResult<T>(result: InternalResult<T>): ValidationResult<T> {
  if (!result.ok) {
    return Object.freeze({
      success: false as const,
      issues: Object.freeze([Object.freeze({ ...result.issue })]),
    });
  }
  return Object.freeze({ success: true as const, data: result.value });
}

function publicFailure<T>(failure: ValidationResult<unknown>, prefix: string): ValidationResult<T> {
  if (failure.success) {
    return publicResult(issue("invalid_value", prefix));
  }
  return Object.freeze({
    success: false as const,
    issues: Object.freeze(failure.issues.map((entry) => Object.freeze({
      code: entry.code,
      path: entry.path === "$" ? prefix : `${prefix}${entry.path.slice(1)}`,
    }))),
  });
}

function fromPublic<T>(result: ValidationResult<T>, path: string): InternalResult<T> {
  if (result.success) {
    return valid(result.data);
  }
  const first = result.issues[0];
  return first === undefined ? issue("invalid_value", path) : issue(first.code, path);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function inspectObject(
  input: unknown,
  allowedKeys: readonly string[],
  path: string,
): InternalResult<Readonly<Record<string, unknown>>> {
  if (typeof input !== "object" || input === null) {
    return issue("invalid_type", path);
  }
  try {
    if (Array.isArray(input)) {
      return issue("invalid_type", path);
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      return issue("invalid_object", path);
    }
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const allowed = new Set(allowedKeys);
    const values: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== "string" || !allowed.has(key)) {
        return issue("unknown_key", path);
      }
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) {
        return issue("invalid_object", path);
      }
      values[key] = descriptor.value;
    }
    return valid(values);
  } catch {
    return issue("invalid_object", path);
  }
}

function required(
  object: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
): InternalResult<unknown> {
  return Object.hasOwn(object, key)
    ? valid(object[key])
    : issue("missing_field", `${path}.${key}`);
}

function parseVersion(input: unknown, path: string): InternalResult<1> {
  if (typeof input !== "number") {
    return issue("invalid_type", path);
  }
  return input === 1 ? valid(1) : issue("unsupported_version", path);
}

function parseEventType(
  input: unknown,
  path: string,
): InternalResult<ObservationChangeEventV1["type"]> {
  if (typeof input !== "string") {
    return issue("invalid_type", path);
  }
  return input === "price.changed" || input === "mileage.changed"
    ? valid(input)
    : issue("invalid_value", path);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function parseTimestamp(input: unknown, path: string): InternalResult<string> {
  if (typeof input !== "string") {
    return issue("invalid_type", path);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/.exec(input);
  if (input.length !== 24 || match === null) {
    return issue("invalid_value", path);
  }
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (
    year === undefined || year < 1 ||
    month === undefined || month < 1 || month > 12 ||
    day === undefined ||
    hour === undefined || hour > 23 ||
    minute === undefined || minute > 59 ||
    second === undefined || second > 59
  ) {
    return issue("invalid_value", path);
  }
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maximumDay = days[month - 1];
  return maximumDay !== undefined && day >= 1 && day <= maximumDay
    ? valid(input)
    : issue("invalid_value", path);
}

function parseDomainEventIdInternal(input: unknown, path: string): InternalResult<DomainEventId> {
  if (typeof input !== "string") {
    return issue("invalid_type", path);
  }
  const suffix = input.slice(4);
  if (
    !input.startsWith("evt_") ||
    suffix.length < 1 ||
    suffix.length > 64 ||
    !/[A-Za-z0-9]/.test(suffix[0] ?? "") ||
    /[^A-Za-z0-9_-]/.test(suffix)
  ) {
    return issue("invalid_value", path);
  }
  return valid(input as DomainEventId);
}

function parseObservationChangeEventInternal(
  input: unknown,
  path: string,
): InternalResult<ObservationChangeEventV1> {
  const object = inspectObject(input, eventKeys, path);
  if (!object.ok) return object;

  const versionInput = required(object.value, "schemaVersion", path);
  if (!versionInput.ok) return versionInput;
  const version = parseVersion(versionInput.value, `${path}.schemaVersion`);
  if (!version.ok) return version;

  const eventIdInput = required(object.value, "eventId", path);
  if (!eventIdInput.ok) return eventIdInput;
  const eventId = parseDomainEventIdInternal(eventIdInput.value, `${path}.eventId`);
  if (!eventId.ok) return eventId;

  const typeInput = required(object.value, "type", path);
  if (!typeInput.ok) return typeInput;
  const type = parseEventType(typeInput.value, `${path}.type`);
  if (!type.ok) return type;

  const listingInput = required(object.value, "listingId", path);
  if (!listingInput.ok) return listingInput;
  const listingId = fromPublic(parseListingId(listingInput.value), `${path}.listingId`);
  if (!listingId.ok) return listingId;

  const previousInput = required(object.value, "previousObservationId", path);
  if (!previousInput.ok) return previousInput;
  const previousObservationId = fromPublic(
    parseObservationId(previousInput.value),
    `${path}.previousObservationId`,
  );
  if (!previousObservationId.ok) return previousObservationId;

  const currentInput = required(object.value, "currentObservationId", path);
  if (!currentInput.ok) return currentInput;
  const currentObservationId = fromPublic(
    parseObservationId(currentInput.value),
    `${path}.currentObservationId`,
  );
  if (!currentObservationId.ok) return currentObservationId;
  if (previousObservationId.value === currentObservationId.value) {
    return issue("invalid_value", `${path}.currentObservationId`);
  }

  const observedInput = required(object.value, "observedAt", path);
  if (!observedInput.ok) return observedInput;
  const observedAt = parseTimestamp(observedInput.value, `${path}.observedAt`);
  if (!observedAt.ok) return observedAt;

  const occurredInput = required(object.value, "occurredAt", path);
  if (!occurredInput.ok) return occurredInput;
  const occurredAt = parseTimestamp(occurredInput.value, `${path}.occurredAt`);
  if (!occurredAt.ok) return occurredAt;
  if (occurredAt.value < observedAt.value) {
    return issue("invalid_value", `${path}.occurredAt`);
  }

  const common = {
    schemaVersion: 1 as const,
    eventId: eventId.value,
    listingId: listingId.value,
    previousObservationId: previousObservationId.value,
    currentObservationId: currentObservationId.value,
    observedAt: observedAt.value,
    occurredAt: occurredAt.value,
  };
  return type.value === "price.changed"
    ? valid(deepFreeze({ ...common, type: "price.changed" }))
    : valid(deepFreeze({ ...common, type: "mileage.changed" }));
}

function rebasedObservation(input: unknown, prefix: string): ValidationResult<Observation> {
  const result = parseObservation(input);
  return result.success ? result : publicFailure(result, prefix);
}

function inconsistent<T>(path: string): ValidationResult<T> {
  return publicResult(issue("invalid_value", path));
}

function exactValueDiffers(
  field: "price" | "mileage",
  previousObservation: Observation,
  currentObservation: Observation,
): boolean {
  if (field === "price" && previousObservation.field === "price" && currentObservation.field === "price") {
    return previousObservation.value.amountMinor !== currentObservation.value.amountMinor ||
      previousObservation.value.currency !== currentObservation.value.currency;
  }
  if (field === "mileage" && previousObservation.field === "mileage" && currentObservation.field === "mileage") {
    return previousObservation.value.amount !== currentObservation.value.amount ||
      previousObservation.value.unit !== currentObservation.value.unit;
  }
  return false;
}

export function parseDomainEventId(input: unknown): ValidationResult<DomainEventId> {
  return publicResult(parseDomainEventIdInternal(input, "$"));
}

export function parseObservationChangeEvent(
  input: unknown,
): ValidationResult<ObservationChangeEventV1> {
  return publicResult(parseObservationChangeEventInternal(input, "$"));
}

export function checkObservationChangeEvidence(
  eventInput: unknown,
  previousInput: unknown,
  currentInput: unknown,
): ValidationResult<ObservationChangeEvidenceV1> {
  const eventResult = parseObservationChangeEvent(eventInput);
  if (!eventResult.success) {
    return publicFailure(eventResult, "$.event");
  }
  const previousResult = rebasedObservation(previousInput, "$.previousObservation");
  if (!previousResult.success) {
    return previousResult;
  }
  const currentResult = rebasedObservation(currentInput, "$.currentObservation");
  if (!currentResult.success) {
    return currentResult;
  }

  const event = eventResult.data;
  const previousObservation = previousResult.data;
  const currentObservation = currentResult.data;

  if (previousObservation.observationId !== event.previousObservationId) {
    return inconsistent("$.previousObservation.observationId");
  }
  if (currentObservation.observationId !== event.currentObservationId) {
    return inconsistent("$.currentObservation.observationId");
  }
  if (previousObservation.subject.kind !== "listing") {
    return inconsistent("$.previousObservation.subject");
  }
  if (currentObservation.subject.kind !== "listing") {
    return inconsistent("$.currentObservation.subject");
  }
  if (previousObservation.subject.listingId !== event.listingId) {
    return inconsistent("$.previousObservation.subject.listingId");
  }
  if (currentObservation.subject.listingId !== event.listingId) {
    return inconsistent("$.currentObservation.subject.listingId");
  }

  const expectedField = event.type === "price.changed" ? "price" : "mileage";
  if (previousObservation.field !== expectedField) {
    return inconsistent("$.previousObservation.field");
  }
  if (currentObservation.field !== expectedField) {
    return inconsistent("$.currentObservation.field");
  }
  if (previousObservation.provenance.sourceId !== currentObservation.provenance.sourceId) {
    return inconsistent("$.currentObservation.provenance.sourceId");
  }
  if (currentObservation.provenance.observedAt <= previousObservation.provenance.observedAt) {
    return inconsistent("$.currentObservation.provenance.observedAt");
  }
  if (event.observedAt !== currentObservation.provenance.observedAt) {
    return inconsistent("$.event.observedAt");
  }
  if (!exactValueDiffers(expectedField, previousObservation, currentObservation)) {
    return inconsistent("$.currentObservation.value");
  }

  if (
    event.type === "price.changed" &&
    previousObservation.field === "price" &&
    currentObservation.field === "price"
  ) {
    return publicResult(valid(Object.freeze({ event, previousObservation, currentObservation })));
  }
  if (
    event.type === "mileage.changed" &&
    previousObservation.field === "mileage" &&
    currentObservation.field === "mileage"
  ) {
    return publicResult(valid(Object.freeze({ event, previousObservation, currentObservation })));
  }
  return inconsistent("$.currentObservation.field");
}
