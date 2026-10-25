import { createHash } from "node:crypto";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import { getPostgresCoreEvidenceRetrievalReferences, validateCompiledPostgresCoreEvidenceInventoryPolicy,
  validateLoadedPostgresCoreEvidenceInventoryPolicy } from "./core-evidence-inventory-policy.mjs";

const ERROR = "postgres_complete_private_copy_policy_invalid";
const KIND = "POSTGRES_COMPLETE_PRIVATE_COPY_POLICY_V1";
const COMPILED_KIND = "COMPILED_POSTGRES_COMPLETE_PRIVATE_COPY_POLICY_V1";
const SUBJECT = "ghcr.io/clemey15/auto-world-postgres-gosu@sha256:0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93";
const CORE_POLICY_SHA256 = "f4857beebba7df2f474e3385c38a69f7cfa0bec330d3d3f65ed7795255de871c";
const CORE_REFERENCE_DIGEST = "7f7b8a730723f148b04317e38cbdfc7e1e5145cf04a916bbaaf7b9cea0d191ed";
const CORE_REFERENCE_COUNT = 496;
const SUPPLEMENTAL_ACCEPTANCE = Object.freeze({ size: 11086,
  sha256: "9ccd9de349b1796bd3c5b31f3a1e1c1152a2a9e0c9dc905bc5ccaae38608ce9b" });
const REQUIRED_GROUP_IDS = Object.freeze([
  "CORE_AUTHORITY_CONTROLS", "P4_ATTESTATION_AND_FAILURE", "P4_OUTPUT_SUPPLEMENT_AND_FAILURES",
  "P4_VERIFIER_AND_TRUST_ROOTS", "PACKAGE_AUDIT_CONTROLS", "P4_SOURCE_RECIPE_BUNDLE",
  "P5_SOURCE_RECIPE_BUNDLE", "P4_SUPPLEMENTAL_SOURCE_CLOSURE",
]);
const SPEC_KEYS = ["kind", "subject", "corePolicySha256", "coreReferenceDigest", "coreReferenceCount",
  "supplementalAcceptance", "groups", "references"];
const ACCEPTANCE_KEYS = ["size", "sha256"];
const GROUP_KEYS = ["groupId", "referenceIds"];
const REFERENCE_KEYS = ["referenceId", "groupId", "role", "path", "size", "sha256", "sha512", "gitBlobSha1",
  "ownerProfile", "nativeIdentity", "parentIdentity"];
const NATIVE_KEYS = ["dev", "ino", "uid", "gid", "mode", "nlink", "size", "mtimeNs", "ctimeNs"];
const PARENT_KEYS = ["dev", "ino", "uid", "gid", "mode"];
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:+@-]{0,191}$/u;
const ROLE = /^[A-Z][A-Z0-9_]{0,191}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SHA512 = /^[a-f0-9]{128}$/u;
const SHA1 = /^[a-f0-9]{40}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]{0,29})$/u;
const MAX_POLICY_BYTES = 16 * 1024 * 1024;
const MAX_REFERENCES = 2048;
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const MAX_REFERENCE_BYTES = 12 * 1024 * 1024 * 1024;
const OWNER_PROFILES = new Map([
  ["ROOT_PRIVATE", { file: [0, 0, 0o600], parent: [0, 0, 0o700] }],
  ["ACTOR_PRIVATE", { file: [1000, 1000, 0o600], parent: [1000, 1000, 0o700] }],
  ["IMAGE_PRIVATE", { file: [1000, 989, 0o600], parent: [1000, 989, 0o700] }],
  ["ROOT_SHARED_PARENT", { file: [0, 0, 0o600], parent: [1000, 1000, 0o750] }],
  ["ROOT_PROTECTED_RECIPE", { file: [0, 0, 0o400], parent: [0, 0, 0o700] }],
  ["ROOT_ACTOR_PROTECTED_RECIPE", { file: [0, 1000, 0o440], parent: [0, 1000, 0o750] }],
  ["ROOT_TRAVERSABLE_CODE_PARENT", { file: [0, 0, 0o600], parent: [0, 1000, 0o750] }],
  ["ACTOR_EXECUTABLE_PRIVATE", { file: [1000, 1000, 0o700], parent: [1000, 1000, 0o700] }],
  ["ROOT_EXECUTABLE", { file: [0, 0, 0o755], parent: [0, 0, 0o755] }],
]);
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

function identity(value, keys) {
  const result = record(value, keys);
  if (![result.dev, result.ino].every(item => typeof item === "string" && DECIMAL.test(item))
    || ![result.uid, result.gid, result.mode].every(Number.isSafeInteger)
    || result.uid < 0 || result.gid < 0 || result.mode < 0 || result.mode > 0o7777) fail();
  return result;
}

function nativeIdentity(value, size) {
  const result = identity(value, NATIVE_KEYS);
  if (![result.mtimeNs, result.ctimeNs].every(item => typeof item === "string" && DECIMAL.test(item))
    || ![result.nlink, result.size].every(Number.isSafeInteger) || result.nlink !== 1 || result.size !== size) fail();
  return result;
}

function normalizedAbsolutePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096 || !value.startsWith("/") || value === "/"
    || value.includes("//") || /[\0\r\n\\]/u.test(value) || value.split("/").some(part => part === "." || part === "..")) fail();
  return value;
}

function supplementalReference(value) {
  const result = record(value, REFERENCE_KEYS);
  token(result.referenceId); token(result.groupId);
  if (typeof result.role !== "string" || !ROLE.test(result.role)) fail();
  result.path = normalizedAbsolutePath(result.path);
  if (!Number.isSafeInteger(result.size) || result.size < 0 || result.size > MAX_FILE_BYTES
    || typeof result.sha256 !== "string" || !SHA256.test(result.sha256)
    || result.sha512 !== null && (typeof result.sha512 !== "string" || !SHA512.test(result.sha512))
    || result.gitBlobSha1 !== null && (typeof result.gitBlobSha1 !== "string" || !SHA1.test(result.gitBlobSha1))) fail();
  const profile = OWNER_PROFILES.get(result.ownerProfile);
  if (!profile) fail();
  result.nativeIdentity = nativeIdentity(result.nativeIdentity, result.size);
  result.parentIdentity = identity(result.parentIdentity, PARENT_KEYS);
  if (!isDeepStrictEqual([result.nativeIdentity.uid, result.nativeIdentity.gid, result.nativeIdentity.mode], profile.file)
    || !isDeepStrictEqual([result.parentIdentity.uid, result.parentIdentity.gid, result.parentIdentity.mode], profile.parent)) fail();
  return result;
}

function supplementalGroup(value) {
  const result = record(value, GROUP_KEYS);
  token(result.groupId);
  result.referenceIds = array(result.referenceIds, MAX_REFERENCES);
  orderedUnique(result.referenceIds);
  if (result.referenceIds.length === 0) fail();
  return result;
}

function normalizeCoreReferences(corePolicy) {
  const local = getPostgresCoreEvidenceRetrievalReferences(corePolicy);
  const roles = new Map(corePolicy.references.map(item => [item.id, item.role]));
  return local.map(item => ({ referenceId: item.referenceId, groupId: "CORE", role: roles.get(item.referenceId), path: item.path,
    size: item.size, sha256: item.sha256, sha512: item.sha512, gitBlobSha1: item.gitBlobSha1,
    ownerProfile: item.ownerProfile, nativeIdentity: item.nativeIdentity, parentIdentity: item.parentIdentity }));
}

function validateCombinedReferences(references) {
  let totalBytes = 0;
  const objects = new Map();
  const paths = new Map();
  for (const item of references) {
    if (!Number.isSafeInteger(item.size) || item.size < 0 || item.size > MAX_FILE_BYTES) fail();
    totalBytes += item.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_REFERENCE_BYTES) fail();
    const priorObject = objects.get(item.sha256);
    if (priorObject) {
      if (priorObject.size !== item.size
        || priorObject.sha512 !== null && item.sha512 !== null && priorObject.sha512 !== item.sha512
        || priorObject.gitBlobSha1 !== null && item.gitBlobSha1 !== null && priorObject.gitBlobSha1 !== item.gitBlobSha1) fail();
      if (priorObject.sha512 === null && item.sha512 !== null) priorObject.sha512 = item.sha512;
      if (priorObject.gitBlobSha1 === null && item.gitBlobSha1 !== null) priorObject.gitBlobSha1 = item.gitBlobSha1;
    } else objects.set(item.sha256, { size: item.size, sha512: item.sha512, gitBlobSha1: item.gitBlobSha1 });
    const priorPath = paths.get(item.path);
    if (priorPath && (priorPath.sha256 !== item.sha256 || !isDeepStrictEqual(priorPath.nativeIdentity, item.nativeIdentity)
      || !isDeepStrictEqual(priorPath.parentIdentity, item.parentIdentity))) fail();
    if (!priorPath) paths.set(item.path, item);
  }
}

function validateCorePolicy(corePolicy, production) {
  const value = production ? validateLoadedPostgresCoreEvidenceInventoryPolicy(corePolicy)
    : validateCompiledPostgresCoreEvidenceInventoryPolicy(corePolicy);
  if (value.subject !== SUBJECT) fail();
  if (production && (value.policySha256 !== CORE_POLICY_SHA256 || value.references.length !== CORE_REFERENCE_COUNT)) fail();
  return value;
}

function snapshot(specification, corePolicy, production) {
  const result = record(specification, SPEC_KEYS);
  if (result.kind !== KIND || result.subject !== SUBJECT || result.corePolicySha256 !== CORE_POLICY_SHA256
    || result.coreReferenceDigest !== CORE_REFERENCE_DIGEST || result.coreReferenceCount !== CORE_REFERENCE_COUNT) fail();
  const acceptance = record(result.supplementalAcceptance, ACCEPTANCE_KEYS);
  if (!isDeepStrictEqual(acceptance, SUPPLEMENTAL_ACCEPTANCE)) fail();
  result.supplementalAcceptance = acceptance;
  result.groups = array(result.groups, REQUIRED_GROUP_IDS.length).map(supplementalGroup);
  if (!isDeepStrictEqual(result.groups.map(item => item.groupId), REQUIRED_GROUP_IDS)) fail();
  result.references = array(result.references, MAX_REFERENCES).map(supplementalReference);
  const supplementalIds = orderedUnique(result.references.map(item => item.referenceId));
  const core = validateCorePolicy(corePolicy, production);
  const coreReferences = normalizeCoreReferences(core);
  const coreIds = new Set(coreReferences.map(item => item.referenceId));
  if (result.references.some(item => coreIds.has(item.referenceId))) fail();
  const membership = new Set();
  for (const group of result.groups) {
    for (const referenceId of group.referenceIds) {
      const reference = result.references.find(item => item.referenceId === referenceId);
      if (!reference || reference.groupId !== group.groupId || membership.has(referenceId)) fail();
      membership.add(referenceId);
    }
  }
  if (membership.size !== supplementalIds.size) fail();
  validateCombinedReferences([...coreReferences, ...result.references]);
  return { ...result, corePolicy: core, references: [...coreReferences, ...result.references] };
}

function capability(value, authority, policySha256) {
  const result = freeze({ kind: COMPILED_KIND, authority, policySha256, subject: value.subject,
    corePolicySha256: value.corePolicySha256, coreReferenceDigest: value.coreReferenceDigest,
    coreReferenceCount: value.coreReferenceCount, supplementalAcceptance: value.supplementalAcceptance,
    corePolicy: value.corePolicy, groups: value.groups, references: value.references });
  (authority === "HASH_LOADED_PRODUCTION" ? loaded : authoring).add(result);
  return result;
}

export function loadPostgresCompletePrivateCopyPolicy(bytes, externallyReviewedSha256, authenticLoadedCorePolicy) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_POLICY_BYTES || bytes.at(-1) !== 10
      || typeof externallyReviewedSha256 !== "string" || !SHA256.test(externallyReviewedSha256)
      || createHash("sha256").update(bytes).digest("hex") !== externallyReviewedSha256) fail();
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const value = JSON.parse(text);
    if (!isDeepStrictEqual(bytes, Buffer.from(`${JSON.stringify(value)}\n`))) fail();
    return capability(snapshot(value, authenticLoadedCorePolicy, true), "HASH_LOADED_PRODUCTION", externallyReviewedSha256);
  } catch { fail(); }
}

export function validateLoadedPostgresCompletePrivateCopyPolicy(value) {
  if (!value || typeof value !== "object" || !loaded.has(value) || !Object.isFrozen(value)
    || value.kind !== COMPILED_KIND || value.authority !== "HASH_LOADED_PRODUCTION"
    || typeof value.policySha256 !== "string" || !SHA256.test(value.policySha256) || value.subject !== SUBJECT) fail();
  return value;
}

export function getPostgresCompletePrivateCopyReferences(policy) {
  return validateLoadedPostgresCompletePrivateCopyPolicy(policy).references;
}

export function getPostgresCompletePrivateCopyPolicySha256(policy) {
  return validateLoadedPostgresCompletePrivateCopyPolicy(policy).policySha256;
}

export function TEST_ONLY_compilePostgresCompletePrivateCopyPolicy(specification, compiledCorePolicy) {
  try { return capability(snapshot(specification, compiledCorePolicy, false), "AUTHORING_TEST_ONLY", null); } catch { fail(); }
}

export function TEST_ONLY_validateCompiledPostgresCompletePrivateCopyPolicy(value) {
  if (!value || typeof value !== "object" || !authoring.has(value) || !Object.isFrozen(value)
    || value.kind !== COMPILED_KIND || value.authority !== "AUTHORING_TEST_ONLY" || value.subject !== SUBJECT) fail();
  return value;
}

export const postgresCompletePrivateCopyPolicyContract = freeze({ kind: KIND, subject: SUBJECT,
  corePolicySha256: CORE_POLICY_SHA256, coreReferenceDigest: CORE_REFERENCE_DIGEST,
  coreReferenceCount: CORE_REFERENCE_COUNT, supplementalAcceptance: SUPPLEMENTAL_ACCEPTANCE,
  requiredGroupIds: REQUIRED_GROUP_IDS });

export const postgresCompletePrivateCopyPolicyLimits = Object.freeze({ policyBytes: MAX_POLICY_BYTES,
  references: MAX_REFERENCES, fileBytes: MAX_FILE_BYTES, referenceBytes: MAX_REFERENCE_BYTES });
