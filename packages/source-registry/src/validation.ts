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

export function issue(code: ValidationIssueCode, path: string): InternalResult<never> {
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
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export function inspectObject(
  input: unknown,
  allowedKeys: readonly string[],
  path: string,
): InternalResult<Readonly<Record<string, unknown>>> {
  if (typeof input !== "object" || input === null) return issue("invalid_type", path);
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
      if (typeof key !== "string" || !allowed.has(key)) return issue("unknown_key", path);
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
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
  minimum = 0,
): InternalResult<readonly unknown[]> {
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
      !Number.isSafeInteger(lengthDescriptor.value)
    ) {
      return issue("invalid_object", path);
    }
    const length = lengthDescriptor.value;
    if (length < minimum || length > maximum) return issue("invalid_value", path);
    if (Reflect.ownKeys(descriptors).length !== length + 1) return issue("invalid_object", path);
    const values: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
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

export function stringValue(input: unknown, path: string): InternalResult<string> {
  return typeof input === "string" ? valid(input) : issue("invalid_type", path);
}

export function booleanValue(input: unknown, path: string): InternalResult<boolean> {
  return typeof input === "boolean" ? valid(input) : issue("invalid_type", path);
}

export function literalValue<T extends string>(
  input: unknown,
  values: readonly T[],
  path: string,
): InternalResult<T> {
  if (typeof input !== "string") return issue("invalid_type", path);
  return (values as readonly string[]).includes(input)
    ? valid(input as T)
    : issue("invalid_value", path);
}

export function integerValue(
  input: unknown,
  path: string,
  minimum: number,
  maximum: number,
): InternalResult<number> {
  if (typeof input !== "number") return issue("invalid_type", path);
  if (!Number.isSafeInteger(input) || Object.is(input, -0) || input < minimum || input > maximum) {
    return issue("invalid_value", path);
  }
  return valid(input);
}

export function nullableInteger(
  input: unknown,
  path: string,
  minimum: number,
  maximum: number,
): InternalResult<number | null> {
  return input === null ? valid(null) : integerValue(input, path, minimum, maximum);
}

export function parseTimestamp(input: unknown, path: string): InternalResult<string> {
  const text = stringValue(input, path);
  if (!text.ok) return text;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/.exec(text.value);
  if (text.value.length !== 24 || match === null) return issue("invalid_value", path);
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  if (
    year === undefined || month === undefined || day === undefined || hour === undefined ||
    minute === undefined || second === undefined || year < 1 || month < 1 || month > 12 ||
    hour > 23 || minute > 59 || second > 59
  ) return issue("invalid_value", path);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maximumDay = days[month - 1];
  return maximumDay !== undefined && day >= 1 && day <= maximumDay
    ? text
    : issue("invalid_value", path);
}

export function prefixedReference(
  input: unknown,
  path: string,
  prefix: string,
  maximum = 64,
): InternalResult<string> {
  const text = stringValue(input, path);
  if (!text.ok) return text;
  if (!text.value.startsWith(prefix)) return issue("invalid_value", path);
  const suffix = text.value.slice(prefix.length);
  if (
    suffix.length < 1 || suffix.length > maximum ||
    !/[A-Za-z0-9]/.test(suffix[0] ?? "") || /[^A-Za-z0-9_-]/.test(suffix)
  ) return issue("invalid_value", path);
  return text;
}

export function uniqueLiteralArray<T extends string>(
  input: unknown,
  path: string,
  values: readonly T[],
  minimum = 1,
): InternalResult<readonly T[]> {
  const array = inspectArray(input, path, values.length, minimum);
  if (!array.ok) return array;
  const result: T[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < array.value.length; index += 1) {
    const item = literalValue(array.value[index], values, `${path}[${index}]`);
    if (!item.ok) return item;
    if (seen.has(item.value)) return issue("duplicate_id", `${path}[${index}]`);
    seen.add(item.value);
    result.push(item.value);
  }
  return valid(result);
}

export function milliseconds(timestamp: string): number {
  return Date.parse(timestamp);
}
