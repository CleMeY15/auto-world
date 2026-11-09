import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { types } from "node:util";

const POLICY_BYTES = 25430;
const POLICY_SHA256 = "7a2dd384f864b4bb7fdf8eb7c32b103cab28e6610df57865c9bc46843b467959";
const fail = (code) => { throw new Error(`scanner_retention_${code}`); };

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// Receipts use ordered plain data, never getters, toJSON hooks or lossy numbers.
function assertJsonData(value, ancestors = new Set(), depth = 0) {
  if (depth > 32 || types.isProxy(value)) fail("json_invalid");
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail("json_invalid");
    return;
  }
  if (typeof value !== "object" || ancestors.has(value)) fail("json_invalid");
  const array = Array.isArray(value);
  if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) fail("json_invalid");
  const properties = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(properties);
  if (keys.some((key) => typeof key !== "string" || !("value" in properties[key])
    || ((!array || key !== "length") && !properties[key].enumerable))) fail("json_invalid");
  if (array && (keys.length !== value.length + 1 || keys.some((key, index) => key !== (index === value.length ? "length" : String(index))))) {
    fail("json_invalid");
  }
  ancestors.add(value);
  for (const key of keys) if (!array || key !== "length") assertJsonData(properties[key].value, ancestors, depth + 1);
  ancestors.delete(value);
}

export function canonicalJsonBytes(value, cap) {
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > 2 * 1024 ** 2) fail("json_cap_invalid");
  assertJsonData(value);
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  if (bytes.length > cap) fail("json_cap_exceeded");
  return bytes;
}

function freeze(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

// The reviewed repository fixes the policy, not a command-line file or claim.
export function validateRetentionPolicyBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== POLICY_BYTES || sha256(bytes) !== POLICY_SHA256) {
    fail("policy_identity_invalid");
  }
  const policy = JSON.parse(bytes.toString("utf8"));
  if (!canonicalJsonBytes(policy, POLICY_BYTES).equals(bytes)) fail("policy_encoding_invalid");
  return freeze(policy);
}

export const SCANNER_RETENTION = validateRetentionPolicyBytes(
  readFileSync(new URL("../../infra/scanner/retention.json", import.meta.url)),
);

const profileBytes = readFileSync(new URL(
  `../../infra/scanner/${SCANNER_RETENTION.qualification.zipProfile.file}`, import.meta.url,
));
if (profileBytes.length !== SCANNER_RETENTION.qualification.zipProfile.bytes
  || sha256(profileBytes) !== SCANNER_RETENTION.qualification.zipProfile.sha256) {
  fail("qualification_profile_identity_invalid");
}
