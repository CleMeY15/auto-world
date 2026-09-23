import { readSeaweedGitHubApi } from "./github-api-read.mjs";
import { reviewedSeaweedSourcePolicy, validateSeaweedSourceRecords } from "./source-records.mjs";

const AUTHENTICATED_SOURCES = new WeakMap();
const MAX_ORIGIN_AGE_NS = 60_000_000_000n;
const [owner, repo] = reviewedSeaweedSourcePolicy.repository.split("/");
const API_POLICY = Object.freeze({
  owner,
  repo,
  runId: reviewedSeaweedSourcePolicy.runId,
  workflowPath: reviewedSeaweedSourcePolicy.workflowPath,
  workflowId: reviewedSeaweedSourcePolicy.workflowId,
  commitSha: reviewedSeaweedSourcePolicy.sourceSha,
  artifactIds: Object.freeze(reviewedSeaweedSourcePolicy.artifacts.map((artifact) => artifact.id)),
});

function originError(code = "seaweed_source_origin_not_authenticated") {
  return Object.assign(new Error(code), { code });
}

function detachedReceipt(consistent, observedAt) {
  const artifacts = Object.freeze(consistent.artifacts.map((artifact) => Object.freeze({
    id: artifact.id,
    name: artifact.name,
    size: artifact.size,
    digest: artifact.digest,
    profile: artifact.profile,
    expiresAt: artifact.expiresAt,
  })));
  return Object.freeze({
    kind: "SEAWEED_SOURCE_ORIGIN_V1",
    schemaVersion: 1,
    state: "AUTHENTICATED",
    authority: "GITHUB_API_READ",
    candidateAuthorization: "NOT_AUTHORIZED",
    observedAt,
    repository: consistent.repository,
    repositoryId: consistent.repositoryId,
    workflowId: consistent.workflowId,
    workflowPath: consistent.workflowPath,
    workflowSha256: consistent.workflowSha256,
    sourceSha: consistent.sourceSha,
    runId: consistent.runId,
    attempt: consistent.attempt,
    artifacts,
  });
}

function snapshotOptions(options) {
  if (options === undefined) return Object.freeze({ signal: undefined, timeoutMs: undefined });
  if (options === null || typeof options !== "object" || Array.isArray(options)) throw originError("seaweed_source_origin_options_invalid");
  const fields = Object.getOwnPropertyDescriptors(options);
  if (Reflect.ownKeys(fields).some((key) => key !== "signal" && key !== "timeoutMs")) throw originError("seaweed_source_origin_options_invalid");
  for (const key of Reflect.ownKeys(fields)) {
    if (!Object.hasOwn(fields[key], "value")) throw originError("seaweed_source_origin_options_invalid");
  }
  return Object.freeze({ signal: fields.signal?.value, timeoutMs: fields.timeoutMs?.value });
}

export async function collectAuthenticatedSeaweedSource(options) {
  const { signal, timeoutMs } = snapshotOptions(options);
  const records = await readSeaweedGitHubApi(API_POLICY, { signal, timeoutMs });
  const observedAt = new Date().toISOString();
  const consistent = validateSeaweedSourceRecords({ ...records, observedAt });
  const receipt = detachedReceipt(consistent, observedAt);
  const expiresAtMs = Math.min(...receipt.artifacts.map((artifact) => Date.parse(artifact.expiresAt)));
  AUTHENTICATED_SOURCES.set(receipt, Object.freeze({ issuedAtNs: process.hrtime.bigint(), expiresAtMs }));
  return receipt;
}

function isFresh(mark, nowNs, nowMs) {
  return mark !== undefined && typeof nowNs === "bigint" && Number.isSafeInteger(nowMs)
    && nowNs >= mark.issuedAtNs && nowNs - mark.issuedAtNs <= MAX_ORIGIN_AGE_NS
    && nowMs < mark.expiresAtMs;
}

export function TEST_ONLY_isSourceOriginFresh(mark, nowNs, nowMs) {
  return isFresh(mark, nowNs, nowMs);
}

export function requireAuthenticatedSeaweedSource(value) {
  const mark = value !== null && typeof value === "object" ? AUTHENTICATED_SOURCES.get(value) : undefined;
  if (!isFresh(mark, process.hrtime.bigint(), Date.now())) throw originError();
  return value;
}
