import type {
  ValidationIssue,
  ValidationIssueCode,
  ValidationResult,
} from "./types.js";

export type InternalResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issue: ValidationIssue };

export function issue(code: ValidationIssueCode, path: string): InternalResult<never> {
  return { ok: false, issue: { code, path } };
}

export function valid<T>(value: T): InternalResult<T> {
  return { ok: true, value };
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
    if (Array.isArray(input)) {
      return issue("invalid_type", path);
    }
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) {
      return issue("invalid_object", path);
    }

    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    const allowed = new Set(allowedKeys);
    const values: Record<string, unknown> = {};

    for (const key of keys) {
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

export function required(
  object: Readonly<Record<string, unknown>>,
  key: string,
  path: string,
): InternalResult<unknown> {
  if (!Object.hasOwn(object, key)) {
    return issue("missing_field", `${path}.${key}`);
  }
  return valid(object[key]);
}

export function optional(
  object: Readonly<Record<string, unknown>>,
  key: string,
): { readonly present: false } | { readonly present: true; readonly value: unknown } {
  if (!Object.hasOwn(object, key)) {
    return { present: false };
  }
  return { present: true, value: object[key] };
}

export function stringValue(input: unknown, path: string): InternalResult<string> {
  return typeof input === "string" ? valid(input) : issue("invalid_type", path);
}

export function literalValue<T extends string>(
  input: unknown,
  values: readonly T[],
  path: string,
): InternalResult<T> {
  if (typeof input !== "string") {
    return issue("invalid_type", path);
  }
  return (values as readonly string[]).includes(input)
    ? valid(input as T)
    : issue("invalid_value", path);
}

export function schemaVersion(input: unknown, path: string): InternalResult<1> {
  if (typeof input !== "number") {
    return issue("invalid_type", path);
  }
  return input === 1 ? valid(1) : issue("unsupported_version", path);
}

export function inspectDenseArray(
  input: unknown,
  path: string,
): InternalResult<readonly unknown[]> {
  if (typeof input !== "object" || input === null) {
    return issue("invalid_type", path);
  }

  try {
    if (!Array.isArray(input)) {
      return issue("invalid_type", path);
    }
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
    if (length > 10_000) {
      return issue("invalid_value", path);
    }
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== length + 1) {
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

export function finiteNonnegativeNumber(
  input: unknown,
  path: string,
): InternalResult<number> {
  if (typeof input !== "number") {
    return issue("invalid_type", path);
  }
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

export function nonnegativeSafeInteger(
  input: unknown,
  path: string,
): InternalResult<number> {
  const number = finiteNonnegativeNumber(input, path);
  if (!number.ok) {
    return number;
  }
  return Number.isSafeInteger(number.value) ? number : issue("invalid_value", path);
}
