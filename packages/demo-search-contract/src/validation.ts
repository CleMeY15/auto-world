import type {
  ValidationIssue,
  ValidationIssueCode,
  ValidationResult,
} from "@auto-world/vehicle-schema";

export type InternalResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issue: ValidationIssue };

export function valid<T>(value: T): InternalResult<T> {
  return { ok: true, value };
}

export function issue(
  code: ValidationIssueCode,
  path: string,
): InternalResult<never> {
  return { ok: false, issue: { code, path } };
}

export function publicResult<T>(result: InternalResult<T>): ValidationResult<T> {
  if (!result.ok) {
    return Object.freeze({
      success: false as const,
      issues: Object.freeze([Object.freeze({ ...result.issue })]),
    });
  }
  return Object.freeze({ success: true as const, data: result.value });
}

export function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

export function inspectObject(
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

export function inspectArray(
  input: unknown,
  path: string,
  maximum: number,
): InternalResult<readonly unknown[]> {
  if (typeof input !== "object" || input === null) {
    return issue("invalid_type", path);
  }
  try {
    if (!Array.isArray(input)) return issue("invalid_type", path);
    if (Object.getPrototypeOf(input) !== Array.prototype) {
      return issue("invalid_object", path);
    }
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(input, "length");
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      typeof lengthDescriptor.value !== "number" ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0
    ) {
      return issue("invalid_object", path);
    }
    const length = lengthDescriptor.value;
    if (length > maximum) return issue("invalid_value", path);
    if (Reflect.ownKeys(descriptors).length !== length + 1) {
      return issue("invalid_object", path);
    }
    const values: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      ) {
        return issue("invalid_object", path);
      }
      values.push(descriptor.value);
    }
    return valid(values);
  } catch {
    return issue("invalid_object", path);
  }
}

export function required(
  object: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
): InternalResult<unknown> {
  return Object.hasOwn(object, key)
    ? valid(object[key])
    : issue("missing_field", `${path}.${key}`);
}

export function optional(
  object: Readonly<Record<string, unknown>>,
  key: string,
): { readonly present: false } | { readonly present: true; readonly value: unknown } {
  return Object.hasOwn(object, key)
    ? { present: true, value: object[key] }
    : { present: false };
}

export function literal<T extends string>(
  input: unknown,
  values: readonly T[],
  path: string,
): InternalResult<T> {
  if (typeof input !== "string") return issue("invalid_type", path);
  return (values as readonly string[]).includes(input)
    ? valid(input as T)
    : issue("invalid_value", path);
}

export function nonnegativeNumber(
  input: unknown,
  path: string,
): InternalResult<number> {
  if (typeof input !== "number") return issue("invalid_type", path);
  if (
    !Number.isFinite(input) ||
    input < 0 ||
    input > Number.MAX_SAFE_INTEGER ||
    Object.is(input, -0)
  ) {
    return issue("invalid_value", path);
  }
  return valid(input);
}

export function safeInteger(
  input: unknown,
  path: string,
  maximum = Number.MAX_SAFE_INTEGER,
): InternalResult<number> {
  const number = nonnegativeNumber(input, path);
  if (!number.ok) return number;
  return Number.isSafeInteger(number.value) && number.value <= maximum
    ? number
    : issue("invalid_value", path);
}

export function exactTimestamp(
  input: unknown,
  path: string,
): InternalResult<string> {
  if (typeof input !== "string") return issue("invalid_type", path);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/.exec(input);
  if (input.length !== 24 || match === null) return issue("invalid_value", path);
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  if (
    year === undefined || month === undefined || day === undefined ||
    hour === undefined || minute === undefined || second === undefined ||
    year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59
  ) {
    return issue("invalid_value", path);
  }
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maximumDay = days[month - 1];
  return maximumDay !== undefined && day >= 1 && day <= maximumDay
    ? valid(input)
    : issue("invalid_value", path);
}
