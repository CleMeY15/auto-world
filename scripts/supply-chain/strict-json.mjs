import { createHash } from "node:crypto";
import { TextDecoder } from "node:util";

export class StrictDataError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "StrictDataError";
  }
}

const fail = (code) => {
  throw new StrictDataError(code);
};

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const sha256 = (bytes) =>
  createHash("sha256").update(Buffer.from(bytes)).digest("hex");

export function parseBoundedJson(
  bytes,
  { maxBytes = 8 * 1024 * 1024, maxDepth = 32, maxMembers = 100_000 } = {},
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) fail("JSON_LIMIT_INVALID");
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) fail("JSON_LIMIT_INVALID");
  if (!Number.isSafeInteger(maxMembers) || maxMembers < 0) fail("JSON_LIMIT_INVALID");

  let input;
  try {
    input = Buffer.from(bytes);
  } catch {
    fail("JSON_INPUT_INVALID");
  }
  if (input.byteLength > maxBytes) fail("JSON_TOO_LARGE");

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(input);
  } catch {
    fail("JSON_UTF8_INVALID");
  }

  let position = 0;
  let members = 0;
  const bumpMember = () => {
    members += 1;
    if (members > maxMembers) fail("JSON_MEMBERS_EXCEEDED");
  };
  const whitespace = () => {
    while (["\t", "\n", "\r", " "].includes(text[position])) {
      position += 1;
    }
  };
  const string = () => {
    if (text[position] !== '"') fail("JSON_SYNTAX_INVALID");
    const start = position;
    position += 1;
    while (position < text.length) {
      const code = text.charCodeAt(position);
      if (code === 0x22) {
        position += 1;
        try {
          return JSON.parse(text.slice(start, position));
        } catch {
          fail("JSON_STRING_INVALID");
        }
      }
      if (code < 0x20) fail("JSON_STRING_INVALID");
      if (code === 0x5c) {
        position += 1;
        if (position >= text.length) fail("JSON_STRING_INVALID");
        if (text[position] === "u") {
          if (!/^[0-9a-fA-F]{4}$/u.test(text.slice(position + 1, position + 5))) {
            fail("JSON_STRING_INVALID");
          }
          position += 5;
          continue;
        }
        if (!'"\\/bfnrt'.includes(text[position])) fail("JSON_STRING_INVALID");
      }
      position += 1;
    }
    fail("JSON_STRING_INVALID");
  };
  const number = () => {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(
      text.slice(position),
    );
    if (!match) fail("JSON_NUMBER_INVALID");
    position += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) fail("JSON_NUMBER_INVALID");
    return value;
  };
  const value = (depth = 0) => {
    whitespace();
    const token = text[position];
    if (token === '"') return string();
    if (token === "t" && text.slice(position, position + 4) === "true") {
      position += 4;
      return true;
    }
    if (token === "f" && text.slice(position, position + 5) === "false") {
      position += 5;
      return false;
    }
    if (token === "n" && text.slice(position, position + 4) === "null") {
      position += 4;
      return null;
    }
    if (token === "-" || /[0-9]/u.test(token ?? "")) return number();
    if (token !== "[" && token !== "{") fail("JSON_SYNTAX_INVALID");
    if (depth >= maxDepth) fail("JSON_DEPTH_EXCEEDED");

    if (token === "[") {
      const result = [];
      position += 1;
      whitespace();
      if (text[position] === "]") {
        position += 1;
        return result;
      }
      while (true) {
        bumpMember();
        result.push(value(depth + 1));
        whitespace();
        if (text[position] === "]") {
          position += 1;
          return result;
        }
        if (text[position] !== ",") fail("JSON_SYNTAX_INVALID");
        position += 1;
      }
    }

    const result = {};
    const keys = new Set();
    position += 1;
    whitespace();
    if (text[position] === "}") {
      position += 1;
      return result;
    }
    while (true) {
      whitespace();
      const key = string();
      if (keys.has(key)) fail("JSON_DUPLICATE_KEY");
      keys.add(key);
      whitespace();
      if (text[position] !== ":") fail("JSON_SYNTAX_INVALID");
      position += 1;
      bumpMember();
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: value(depth + 1),
        writable: true,
      });
      whitespace();
      if (text[position] === "}") {
        position += 1;
        return result;
      }
      if (text[position] !== ",") fail("JSON_SYNTAX_INVALID");
      position += 1;
    }
  };

  whitespace();
  const result = value();
  whitespace();
  if (position !== text.length) fail("JSON_TRAILING_DATA");
  return result;
}

const canonicalize = (value, seen) => {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("JSON_VALUE_INVALID");
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") fail("JSON_VALUE_INVALID");
  if (seen.has(value)) fail("JSON_VALUE_CYCLIC");
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== value.length + 1 ||
      keys.some(
        (key) =>
          typeof key !== "string" ||
          (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)),
      )
    ) {
      fail("JSON_VALUE_INVALID");
    }
    result = [];
    for (let index = 0; index < value.length; index += 1) {
      const property = Object.getOwnPropertyDescriptor(value, String(index));
      if (!property || !("value" in property) || property.enumerable !== true) {
        fail("JSON_VALUE_INVALID");
      }
      result.push(canonicalize(property.value, seen));
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail("JSON_VALUE_INVALID");
    result = {};
    const properties = Reflect.ownKeys(value);
    if (properties.some((key) => typeof key !== "string")) fail("JSON_VALUE_INVALID");
    for (const key of properties.sort()) {
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (!property || !("value" in property) || property.enumerable !== true) {
        fail("JSON_VALUE_INVALID");
      }
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: canonicalize(property.value, seen),
        writable: true,
      });
    }
  }
  seen.delete(value);
  return result;
};

export const canonicalJsonBuffer = (value) =>
  Buffer.from(JSON.stringify(canonicalize(value, new Set())), "utf8");

export function assertClosedObject(value, requiredKeys, optionalKeys = []) {
  if (!isRecord(value)) fail("SCHEMA_OBJECT_REQUIRED");
  if (!Array.isArray(requiredKeys) || !Array.isArray(optionalKeys)) {
    fail("SCHEMA_KEYS_INVALID");
  }
  const required = new Set(requiredKeys);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (required.size !== requiredKeys.length || allowed.size !== requiredKeys.length + optionalKeys.length) {
    fail("SCHEMA_KEYS_INVALID");
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail("SCHEMA_FIELD_MISSING");
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail("SCHEMA_FIELD_UNKNOWN");
  }
  return value;
}
