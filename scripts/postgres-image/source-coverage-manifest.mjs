import { createHash } from "node:crypto";
import coverageJson from "../../infra/postgres-image/source-coverage.json" with { type: "json" };

// This independent pin binds the reviewed metadata associations, not admission.
export const postgresSourceCoveragePin = Object.freeze({
  bytes: 437498,
  sha256: "a6c5740d17ad12f492bed3a17a8c0778d578fd7c32d771eeb2b158e7c7f4e31b",
  canonicalSha256: "42d73c81a2b987a03aa19e0fb5f8edb51aff6e948b632737bcd97abf79325009",
});
const ERROR = "postgres_source_coverage_manifest_invalid";
const fail = () => { throw new Error(ERROR); };

// Copy only bounded JSON data descriptors. Never invoke getters or toJSON.
// The canonical hash closes every nested field and association to the review.
function snapshot(value, depth = 0, state = { nodes: 100000, chars: 1024 * 1024, seen: new WeakSet() }) {
  if (--state.nodes < 0 || depth > 24) fail();
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail();
    return value;
  }
  if (typeof value === "string") {
    state.chars -= value.length;
    if (value.length > 8192 || state.chars < 0) fail();
    return value;
  }
  if (typeof value !== "object" || state.seen.has(value)) fail();
  state.seen.add(value);
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  let result;
  if (array) {
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > 8192 || keys.length !== length + 1) fail();
    result = [];
    for (let index = 0; index < length; index++) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) fail();
      result.push(snapshot(descriptor.value, depth + 1, state));
    }
  } else {
    if (keys.length > 128 || keys.some(key => typeof key !== "string" || key.length > 128
      || ["__proto__", "prototype", "constructor"].includes(key))) fail();
    result = {};
    for (const key of keys.sort()) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail();
      result[key] = snapshot(descriptor.value, depth + 1, state);
    }
  }
  return Object.freeze(result);
}

// JSON.stringify on containers consults inherited toJSON before a replacer.
// Serialize our own frozen data directly, escaping only primitive strings.
function canonicalData(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const array = Array.isArray(value), entries = [];
  if (array) {
    for (let index = 0; index < value.length; index++) entries.push(canonicalData(value[index]));
  } else {
    for (const key of Object.keys(value)) entries.push(`${JSON.stringify(key)}:${canonicalData(value[key])}`);
  }
  return array ? `[${entries.join(",")}]` : `{${entries.join(",")}}`;
}

function checked(value) {
  try {
    const result = snapshot(value);
    const canonical = canonicalData(result);
    if (createHash("sha256").update(canonical).digest("hex") !== postgresSourceCoveragePin.canonicalSha256) fail();
    return result;
  } catch { fail(); }
}

const reviewed = checked(coverageJson);
export function loadPostgresSourceCoverageManifest() { return reviewed; }
export function validatePostgresSourceCoverageManifest(value) { return checked(value); }
