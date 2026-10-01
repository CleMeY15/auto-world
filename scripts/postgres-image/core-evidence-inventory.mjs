import { createHash } from "node:crypto";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { validateCompiledPostgresCoreEvidenceInventoryPolicy } from "./core-evidence-inventory-policy.mjs";

const ERROR = "postgres_core_evidence_inventory_invalid";
const KIND = "POSTGRES_CORE_EVIDENCE_INVENTORY_V1";
const MAX_BYTES = 16 * 1024 * 1024;
const TOP_KEYS = ["kind", "subject", "objects", "references", "groups", "history", "claims"];
const OBJECT_KEYS = ["sha256", "size", "sha512", "gitBlobSha1"];
const REFERENCE_KEYS = ["id", "group", "role", "objectSha256", "materialId", "historical", "provenance"];
const GROUP_KEYS = ["id", "role", "required", "counts", "referenceBytes", "uniqueBytes", "digest", "referenceIds"];
const COUNT_KEYS = ["references", "objects"];
const HISTORY_KEYS = ["id", "state", "referenceIds", "reason"];
const CLAIM_KEYS = ["closure", "acceptanceRequiresClosedRetrieverAck", "historicalIntegrity", "legalCompliance", "currentness", "runtimePermission", "signing",
  "admission", "laterRequired", "supportStartedAt", "supportEndsAt", "archiveUntil"];
const FORBIDDEN_KEYS = new Set(["path", "directory", "identity", "dev", "ino", "uid", "gid", "mode", "nlink", "mtimeNs", "ctimeNs"]);

const fail = () => { throw new Error(ERROR); };
const freeze = value => {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

function record(value, keys) {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== "string" || !keys.includes(key))) fail();
  const result = {};
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) fail();
    result[key] = descriptor.value;
  }
  return result;
}

function array(value, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1 || descriptors.length?.value !== value.length) fail();
  return Array.from({ length: value.length }, (_unused, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || descriptor.enumerable !== true) fail();
    return descriptor.value;
  });
}

function rejectLocalMetadata(value, depth = 0, budget = { remaining: 1_000_000 }) {
  if (--budget.remaining < 0 || depth > 32) fail();
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
  if (typeof value !== "object") fail();
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length" && Array.isArray(value)) continue;
    if (typeof key !== "string" || FORBIDDEN_KEYS.has(key)) fail();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail();
    rejectLocalMetadata(descriptor.value, depth + 1, budget);
  }
}

const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function expectedInventory(policy) {
  validateCompiledPostgresCoreEvidenceInventoryPolicy(policy);
  const objectMap = new Map();
  const references = policy.references.map(item => {
    const prior = objectMap.get(item.object.sha256);
    if (prior && !isDeepStrictEqual(prior, item.object)) fail();
    objectMap.set(item.object.sha256, item.object);
    return {
      id: item.id, group: item.group, role: item.role, objectSha256: item.object.sha256,
      materialId: item.materialId, historical: item.historical, provenance: item.provenance,
    };
  });
  const objects = [...objectMap.values()].sort((left, right) => left.sha256.localeCompare(right.sha256));
  const byReference = new Map(references.map(item => [item.id, item]));
  const byObject = new Map(objects.map(item => [item.sha256, item]));
  const groups = policy.groups.map(item => {
    const groupReferences = item.referenceIds.map(id => byReference.get(id));
    const objectIds = [...new Set(groupReferences.map(reference => reference.objectSha256))];
    const groupIdentity = { id: item.id, role: item.role, required: item.required, references: groupReferences };
    const referenceBytes = groupReferences.reduce((total, reference) => total + byObject.get(reference.objectSha256).size, 0);
    const uniqueBytes = objectIds.reduce((total, id) => total + byObject.get(id).size, 0);
    if (!Number.isSafeInteger(referenceBytes) || !Number.isSafeInteger(uniqueBytes)) fail();
    return {
      id: item.id, role: item.role, required: item.required,
      counts: { references: groupReferences.length, objects: objectIds.length },
      referenceBytes,
      uniqueBytes,
      digest: digest(groupIdentity), referenceIds: item.referenceIds,
    };
  });
  return {
    kind: KIND,
    subject: policy.subject,
    objects,
    references,
    groups,
    history: policy.history,
    claims: {
      closure: "CATALOG_COMPLETE_RETRIEVAL_REQUIRED",
      acceptanceRequiresClosedRetrieverAck: true,
      historicalIntegrity: "PRESERVED_WITHOUT_PROMOTION",
      legalCompliance: "NOT_EVALUATED",
      currentness: "NOT_EVALUATED",
      runtimePermission: "NOT_GRANTED",
      signing: "NOT_ATTEMPTED",
      admission: "NOT_AUTHORIZED",
      laterRequired: policy.laterRequired,
      supportStartedAt: null,
      supportEndsAt: null,
      archiveUntil: null,
    },
  };
}

function snapshot(value) {
  rejectLocalMetadata(value);
  const result = record(value, TOP_KEYS);
  result.objects = array(result.objects, 4096).map(item => record(item, OBJECT_KEYS));
  result.references = array(result.references, 4096).map(item => record(item, REFERENCE_KEYS));
  result.groups = array(result.groups, 64).map(item => {
    const group = record(item, GROUP_KEYS);
    group.counts = record(group.counts, COUNT_KEYS);
    group.referenceIds = array(group.referenceIds, 4096);
    return group;
  });
  result.history = array(result.history, 256).map(item => {
    const history = record(item, HISTORY_KEYS);
    history.referenceIds = array(history.referenceIds, 4096);
    return history;
  });
  result.claims = record(result.claims, CLAIM_KEYS);
  result.claims.laterRequired = array(result.claims.laterRequired, 2);
  return result;
}

export function createPostgresCoreEvidenceInventory(policy) {
  try { return freeze(expectedInventory(policy)); } catch { fail(); }
}

export function validatePostgresCoreEvidenceInventory(value, policy) {
  try {
    const result = snapshot(value);
    if (!isDeepStrictEqual(result, expectedInventory(policy))) fail();
    return freeze(result);
  } catch { fail(); }
}

export function loadPostgresCoreEvidenceInventory(bytes, policy) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_BYTES || bytes.at(-1) !== 10) fail();
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const value = JSON.parse(text);
    if (!isDeepStrictEqual(bytes, Buffer.from(`${JSON.stringify(value)}\n`))) fail();
    return validatePostgresCoreEvidenceInventory(value, policy);
  } catch { fail(); }
}

export function serializePostgresCoreEvidenceInventory(value, policy) {
  const inventory = validatePostgresCoreEvidenceInventory(value, policy);
  const bytes = Buffer.from(`${JSON.stringify(inventory)}\n`);
  if (bytes.length > MAX_BYTES) fail();
  return bytes;
}

export const postgresCoreEvidenceInventoryLimits = Object.freeze({ inventoryBytes: MAX_BYTES });
