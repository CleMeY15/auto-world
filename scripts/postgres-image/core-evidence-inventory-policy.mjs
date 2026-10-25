import { createHash } from "node:crypto";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { loadPostgresSourceClosureManifest, validatePostgresSourceClosureManifest } from "./source-closure-manifest.mjs";

const ERROR = "postgres_core_evidence_inventory_policy_invalid";
const KIND = "POSTGRES_CORE_EVIDENCE_INVENTORY_POLICY_V1";
const COMPILED_KIND = "COMPILED_POSTGRES_CORE_EVIDENCE_INVENTORY_POLICY_V1";
const SUBJECT = "ghcr.io/clemey15/auto-world-postgres-gosu@sha256:0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93";
const SOURCE_GROUP = Object.freeze({ id: "DECLARED_SOURCE_MATERIALS_323", role: "DECLARED_SOURCE_MATERIALS" });
const LATER_REQUIRED = Object.freeze(["OFFICIAL_ATTESTATION_BUNDLE", "SECOND_COMPLETE_PRIVATE_COPY"]);
const SPEC_KEYS = ["kind", "subject", "references", "groups", "history", "laterRequired", "retrieval"];
const REFERENCE_KEYS = ["id", "group", "role", "object", "materialId", "historical", "provenance"];
const OBJECT_KEYS = ["sha256", "size", "sha512", "gitBlobSha1"];
const PROVENANCE_KEYS = ["kind", "subject", "identifier", "state"];
const GROUP_KEYS = ["id", "role", "required", "referenceIds"];
const HISTORY_KEYS = ["id", "state", "referenceIds", "reason"];
const RETRIEVAL_KEYS = ["references", "sourceBundleReferenceId", "sourceBundleProof"];
const BUNDLE_PROOF_KEYS = ["kind", "review", "fsck", "references", "state", "receiptReferenceId", "receiptSha256", "recipeRevision"];
const LOCAL_REFERENCE_KEYS = ["referenceId", "path", "size", "sha256", "sha512", "gitBlobSha1", "ownerProfile", "nativeIdentity", "parentIdentity"];
const NATIVE_KEYS = ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"];
const PARENT_KEYS = ["dev", "ino", "uid", "gid", "mode"];
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:+@-]{0,191}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SHA512 = /^[a-f0-9]{128}$/u;
const SHA1 = /^[a-f0-9]{40}$/u;
const HISTORY_STATES = new Set(["INCOMPLETE", "FAILED", "SUPERSEDED"]);
const OWNER_PROFILES = new Map([
  ["ROOT_PRIVATE", { file: [0, 0, 0o600], parent: [0, 0, 0o700], alternateParent: [0, 1000, 0o710] }],
  ["ACTOR_PRIVATE", { file: [1000, 1000, 0o600], parent: [1000, 1000, 0o700] }],
  ["IMAGE_PRIVATE", { file: [1000, 989, 0o600], parent: [1000, 989, 0o700] }],
  ["ROOT_SHARED_PARENT", { file: [0, 0, 0o600], parent: [1000, 1000, 0o750] }],
  ["ROOT_PROTECTED_RECIPE", { file: [0, 0, 0o400], parent: [0, 0, 0o700] }],
  ["ROOT_ACTOR_PROTECTED_RECIPE", { file: [0, 1000, 0o440], parent: [0, 1000, 0o750] }],
  ["ROOT_TRAVERSABLE_CODE_PARENT", { file: [0, 0, 0o600], parent: [0, 1000, 0o750] }],
]);
const ROOT_ALTERNATE_PARENT_REFERENCES = new Map([
  ["historical-cold-receipt", "ROOT_COLD_LOAD_RECEIPT"],
  ["historical-sql-receipt", "ROOT_SQL_RESTORE_RECEIPT"],
]);
const ROOT_SHARED_PARENT_REFERENCES = new Map([
  ["pr124-ack", "SUPERVISOR_ACK"], ["pr125-ack", "SUPERVISOR_ACK"], ["pr126-ack", "SUPERVISOR_ACK"],
  ["pr127-ack", "SUPERVISOR_ACK"], ["pr128-ack", "SUPERVISOR_ACK"], ["source-collection-recovery-ack", "SUPERVISOR_ACK"],
  ["source-collection-first-ack", "HISTORICAL_FAILURE_ACK"], ["pr123-failed-context-ack", "HISTORICAL_FAILURE_ACK"],
  ["pr124-failed-context-ack", "HISTORICAL_FAILURE_ACK"], ["pr124-failed-finalize-ack", "HISTORICAL_FAILURE_ACK"],
  ["pr124-stderr", "DIAGNOSTIC_STDERR"], ["pr125-stderr", "DIAGNOSTIC_STDERR"], ["pr126-stderr", "DIAGNOSTIC_STDERR"],
  ["pr127-stderr", "DIAGNOSTIC_STDERR"], ["pr128-stderr", "DIAGNOSTIC_STDERR"],
  ["source-collection-first-stderr", "DIAGNOSTIC_STDERR"], ["source-collection-recovery-stderr", "DIAGNOSTIC_STDERR"],
]);
const EXECUTED_DIAGNOSTIC_RECIPE_REFERENCES = new Set([
  "pr129-layer-supervisor", "pr129-layer-worker", "pr129-notice-supervisor", "pr129-gcc-supervisor",
  "pr129-embedded-supervisor", "pr129-embedded-reader", "pr129-embedded-core", "pr129-apk-supervisor",
  "pr129-apk-reader", "pr129-source-supervisor",
]);
const DECIMAL = /^(?:0|[1-9][0-9]{0,29})$/u;
const MAX_POLICY_BYTES = 16 * 1024 * 1024;
const authoring = new WeakSet();
const loaded = new WeakSet();

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

function token(value) {
  if (typeof value !== "string" || !TOKEN.test(value)) fail();
  return value;
}

function orderedUnique(values) {
  let previous = "";
  const seen = new Set();
  for (const value of values) {
    token(value);
    if (value <= previous || seen.has(value)) fail();
    previous = value;
    seen.add(value);
  }
  return seen;
}

function objectIdentity(value) {
  const result = record(value, OBJECT_KEYS);
  if (typeof result.sha256 !== "string" || !SHA256.test(result.sha256)
    || !Number.isSafeInteger(result.size) || result.size < 0
    || result.sha512 !== null && (typeof result.sha512 !== "string" || !SHA512.test(result.sha512))
    || result.gitBlobSha1 !== null && (typeof result.gitBlobSha1 !== "string" || !SHA1.test(result.gitBlobSha1))) fail();
  return result;
}

function provenance(value) {
  const result = record(value, PROVENANCE_KEYS);
  token(result.kind); token(result.identifier); token(result.state);
  if (typeof result.subject !== "string" || result.subject.length === 0 || result.subject.length > 1024
    || /[\0\r\n\\]/u.test(result.subject)) fail();
  return result;
}

function reference(value) {
  const result = record(value, REFERENCE_KEYS);
  token(result.id); token(result.group); token(result.role);
  result.object = objectIdentity(result.object);
  if (result.materialId !== null) token(result.materialId);
  if (typeof result.historical !== "boolean") fail();
  result.provenance = provenance(result.provenance);
  return result;
}

function group(value) {
  const result = record(value, GROUP_KEYS);
  token(result.id); token(result.role);
  if (typeof result.required !== "boolean") fail();
  result.referenceIds = array(result.referenceIds, 4096);
  orderedUnique(result.referenceIds);
  if (result.referenceIds.length === 0) fail();
  return result;
}

function history(value) {
  const result = record(value, HISTORY_KEYS);
  token(result.id); token(result.reason);
  if (!HISTORY_STATES.has(result.state)) fail();
  result.referenceIds = array(result.referenceIds, 4096);
  orderedUnique(result.referenceIds);
  if (result.referenceIds.length === 0) fail();
  return result;
}

function nativeIdentity(value, object) {
  const result = record(value, NATIVE_KEYS);
  if (![result.dev, result.ino, result.mtimeNs, result.ctimeNs].every(item => typeof item === "string" && DECIMAL.test(item))
    || ![result.uid, result.gid, result.mode, result.nlink, result.size].every(Number.isSafeInteger)
    || result.uid < 0 || result.gid < 0 || result.mode < 0 || result.mode > 0o7777
    || result.nlink !== 1 || result.size !== object.size) fail();
  return result;
}

function parentIdentity(value) {
  const result = record(value, PARENT_KEYS);
  if (![result.dev, result.ino].every(item => typeof item === "string" && DECIMAL.test(item))
    || ![result.uid, result.gid, result.mode].every(Number.isSafeInteger)
    || result.uid < 0 || result.gid < 0 || result.mode < 0 || result.mode > 0o7777) fail();
  return result;
}

function localReference(value, references) {
  const result = record(value, LOCAL_REFERENCE_KEYS);
  token(result.referenceId);
  const referenceValue = references.find(item => item.id === result.referenceId);
  if (!referenceValue || typeof result.path !== "string" || result.path.length > 4096 || !result.path.startsWith("/")
    || result.path === "/" || result.path.includes("//") || /[\0\r\n\\]/u.test(result.path)
    || result.path.split("/").some(part => part === "." || part === "..")
    || result.size !== referenceValue.object.size || result.sha256 !== referenceValue.object.sha256
    || result.sha512 !== referenceValue.object.sha512 || result.gitBlobSha1 !== referenceValue.object.gitBlobSha1) fail();
  const profile = OWNER_PROFILES.get(result.ownerProfile);
  if (!profile) fail();
  result.nativeIdentity = nativeIdentity(result.nativeIdentity, referenceValue.object);
  result.parentIdentity = parentIdentity(result.parentIdentity);
  const fileProfile = [result.nativeIdentity.uid, result.nativeIdentity.gid, result.nativeIdentity.mode];
  const parentProfile = [result.parentIdentity.uid, result.parentIdentity.gid, result.parentIdentity.mode];
  const alternateParent = isDeepStrictEqual(parentProfile, profile.alternateParent)
    && ROOT_ALTERNATE_PARENT_REFERENCES.get(referenceValue.id) === referenceValue.role;
  if (!isDeepStrictEqual(fileProfile, profile.file)
    || !isDeepStrictEqual(parentProfile, profile.parent) && !alternateParent) fail();
  if (result.ownerProfile === "ROOT_TRAVERSABLE_CODE_PARENT"
    && (referenceValue.id !== "final-apk-provides-report" || referenceValue.role !== "COVERAGE_OBSERVATION")) fail();
  if (result.ownerProfile === "ROOT_SHARED_PARENT"
    && ROOT_SHARED_PARENT_REFERENCES.get(referenceValue.id) !== referenceValue.role) fail();
  if (["ROOT_PROTECTED_RECIPE", "ROOT_ACTOR_PROTECTED_RECIPE"].includes(result.ownerProfile)
    && (!EXECUTED_DIAGNOSTIC_RECIPE_REFERENCES.has(referenceValue.id)
      || referenceValue.role !== "EXECUTED_DIAGNOSTIC_RECIPE")) fail();
  return result;
}

function bundleProof(value, references, bundleReference) {
  const result = record(value, BUNDLE_PROOF_KEYS);
  if (result.kind !== "REVIEWED_SOURCE_BUNDLE_HELPER_PROOF" || result.review !== "INDEPENDENTLY_ACCEPTED"
    || result.fsck !== "STRICT_FULL" || result.references !== 8 || result.state !== "BUNDLE_VERIFIED"
    || typeof result.receiptSha256 !== "string" || !SHA256.test(result.receiptSha256)
    || typeof result.recipeRevision !== "string" || !SHA1.test(result.recipeRevision)
    || result.recipeRevision !== bundleReference.provenance.identifier) fail();
  token(result.receiptReferenceId);
  const receipt = references.find(item => item.id === result.receiptReferenceId);
  if (!receipt || receipt.historical || receipt.role !== "SOURCE_RECIPE_BUNDLE_HELPER_PROOF"
    || receipt.object.sha256 !== result.receiptSha256 || !isDeepStrictEqual(receipt.provenance, {
      kind: "VERIFIED_GIT_SOURCE_BUNDLE_HELPER_PROOF", subject: SUBJECT,
      identifier: result.recipeRevision, state: "BUNDLE_VERIFIED",
    })) fail();
  return result;
}

function retrieval(value, references, requireFullBundle) {
  const result = record(value, RETRIEVAL_KEYS);
  result.references = array(result.references, 4096).map(item => localReference(item, references));
  const ids = orderedUnique(result.references.map(item => item.referenceId));
  if (ids.size !== references.length || references.some(item => !ids.has(item.id))) fail();
  const paths = new Map();
  for (const item of result.references) {
    const prior = paths.get(item.path);
    if (prior && (!isDeepStrictEqual(prior.nativeIdentity, item.nativeIdentity) || prior.sha256 !== item.sha256)) fail();
    paths.set(item.path, item);
  }
  if (result.sourceBundleReferenceId !== null) {
    token(result.sourceBundleReferenceId);
    const referenceValue = references.find(item => item.id === result.sourceBundleReferenceId);
    if (!referenceValue || referenceValue.historical || referenceValue.role !== "SOURCE_RECIPE_BUNDLE"
      || referenceValue.provenance.kind !== "VERIFIED_GIT_SOURCE_BUNDLE" || referenceValue.provenance.subject !== SUBJECT
      || !/^[a-f0-9]{40}$/u.test(referenceValue.provenance.identifier)
      || referenceValue.provenance.state !== "BUNDLE_VERIFIED") fail();
    result.sourceBundleProof = bundleProof(result.sourceBundleProof, references, referenceValue);
  } else if (result.sourceBundleProof !== null) fail();
  if (requireFullBundle && (result.sourceBundleReferenceId === null || result.sourceBundleProof === null)) fail();
  return result;
}

function validateManifestReferences(references, groups, manifest) {
  const sourceGroup = groups.find(item => item.id === SOURCE_GROUP.id);
  if (!sourceGroup || sourceGroup.role !== SOURCE_GROUP.role || sourceGroup.required !== true) fail();
  const byMaterial = new Map();
  for (const item of references) {
    if (item.materialId === null) continue;
    if (item.group !== SOURCE_GROUP.id || item.historical || byMaterial.has(item.materialId)) fail();
    byMaterial.set(item.materialId, item);
  }
  if (byMaterial.size !== manifest.materials.length || sourceGroup.referenceIds.length !== manifest.materials.length) fail();
  for (const material of manifest.materials) {
    const item = byMaterial.get(material.id);
    if (!item || !sourceGroup.referenceIds.includes(item.id)) fail();
    if (item.role !== material.role || !isDeepStrictEqual(item.provenance, {
      kind: "COMPILED_SOURCE_MANIFEST", subject: manifest.subject, identifier: material.id, state: "BYTES_VERIFIED_UNADMITTED",
    })) fail();
    const expected = material.expected;
    if (expected.sha256 !== null && item.object.sha256 !== expected.sha256
      || expected.size !== null && item.object.size !== expected.size
      || expected.sha512 !== null && item.object.sha512 !== expected.sha512
      || expected.gitBlobSha1 !== null && item.object.gitBlobSha1 !== expected.gitBlobSha1) fail();
  }
}

function snapshot(specification, requireFullBundle) {
  const result = record(specification, SPEC_KEYS);
  if (result.kind !== KIND || result.subject !== SUBJECT) fail();
  result.references = array(result.references, 4096).map(reference);
  result.groups = array(result.groups, 64).map(group);
  result.history = array(result.history, 256).map(history);
  result.laterRequired = array(result.laterRequired, 2);
  if (!isDeepStrictEqual(result.laterRequired, LATER_REQUIRED)) fail();

  const referenceIds = orderedUnique(result.references.map(item => item.id));
  const groupIds = orderedUnique(result.groups.map(item => item.id));
  if (new Set(result.groups.map(item => item.role)).size !== result.groups.length) fail();
  orderedUnique(result.history.map(item => item.id));
  const objects = new Map();
  for (const item of result.references) {
    const prior = objects.get(item.object.sha256);
    if (prior && !isDeepStrictEqual(prior, item.object)) fail();
    objects.set(item.object.sha256, item.object);
  }
  const membership = new Set();
  for (const item of result.groups) {
    for (const id of item.referenceIds) {
      const referenceValue = result.references.find(referenceItem => referenceItem.id === id);
      if (!referenceIds.has(id) || membership.has(id) || referenceValue.group !== item.id
        || item.required && referenceValue.historical) fail();
      membership.add(id);
    }
  }
  if (membership.size !== result.references.length || result.references.some(item => !groupIds.has(item.group))) fail();

  const historicalMembership = new Set();
  for (const item of result.history) {
    for (const id of item.referenceIds) {
      const referenceValue = result.references.find(referenceItem => referenceItem.id === id);
      if (!referenceValue?.historical || historicalMembership.has(id)) fail();
      historicalMembership.add(id);
    }
  }
  if (result.references.some(item => item.historical !== historicalMembership.has(item.id))) fail();

  result.retrieval = retrieval(result.retrieval, result.references, requireFullBundle);

  const manifest = validatePostgresSourceClosureManifest(loadPostgresSourceClosureManifest());
  validateManifestReferences(result.references, result.groups, manifest);
  const canonical = JSON.stringify(manifest);
  result.manifest = {
    kind: manifest.kind,
    subject: manifest.subject,
    materialCount: manifest.materials.length,
    sha256: createHash("sha256").update(canonical).digest("hex"),
  };
  return result;
}

function capability(value, authority, policySha256) {
  const result = freeze({ kind: COMPILED_KIND, authority, policySha256, subject: value.subject, manifest: value.manifest,
    references: value.references, groups: value.groups, history: value.history, laterRequired: value.laterRequired,
    retrieval: value.retrieval });
  (authority === "HASH_LOADED_PRODUCTION" ? loaded : authoring).add(result);
  return result;
}

export function compilePostgresCoreEvidenceInventoryPolicy(specification) {
  try { return capability(snapshot(specification, false), "AUTHORING_TEST_ONLY", null); } catch { fail(); }
}

export function loadPostgresCoreEvidenceInventoryPolicy(bytes, expectedSha256) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_POLICY_BYTES || bytes.at(-1) !== 10
      || typeof expectedSha256 !== "string" || !SHA256.test(expectedSha256)
      || createHash("sha256").update(bytes).digest("hex") !== expectedSha256) fail();
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const value = JSON.parse(text);
    if (!isDeepStrictEqual(bytes, Buffer.from(`${JSON.stringify(value)}\n`))) fail();
    return capability(snapshot(value, true), "HASH_LOADED_PRODUCTION", expectedSha256);
  } catch { fail(); }
}

export function validateCompiledPostgresCoreEvidenceInventoryPolicy(value) {
  if (!value || typeof value !== "object" || !authoring.has(value) && !loaded.has(value) || !Object.isFrozen(value)
    || value.kind !== COMPILED_KIND || value.subject !== SUBJECT) fail();
  return value;
}

export function validateLoadedPostgresCoreEvidenceInventoryPolicy(value) {
  if (!value || typeof value !== "object" || !loaded.has(value) || !Object.isFrozen(value)
    || value.kind !== COMPILED_KIND || value.authority !== "HASH_LOADED_PRODUCTION"
    || typeof value.policySha256 !== "string" || !SHA256.test(value.policySha256) || value.subject !== SUBJECT) fail();
  return value;
}

export function getPostgresCoreEvidenceLoadedPolicySha256(policy) {
  return validateLoadedPostgresCoreEvidenceInventoryPolicy(policy).policySha256;
}

export function getPostgresCoreEvidenceRetrievalReferences(policy) {
  return validateCompiledPostgresCoreEvidenceInventoryPolicy(policy).retrieval.references;
}

export function getPostgresCoreEvidenceSourceBundleReference(policy) {
  const value = validateCompiledPostgresCoreEvidenceInventoryPolicy(policy);
  const referenceId = value.retrieval.sourceBundleReferenceId;
  if (referenceId === null) return null;
  const reference = value.references.find(item => item.id === referenceId);
  return freeze({ referenceId, role: reference.role, provenance: reference.provenance, proof: value.retrieval.sourceBundleProof });
}

export const postgresCoreEvidenceInventoryPolicyContract = freeze({
  kind: KIND,
  subject: SUBJECT,
  sourceGroup: SOURCE_GROUP,
  laterRequired: LATER_REQUIRED,
});

export const postgresCoreEvidenceInventoryPolicyLimits = Object.freeze({ policyBytes: MAX_POLICY_BYTES });
