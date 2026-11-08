import "./guard.js";
import { createHash } from "node:crypto";
import type { DemoCatalogResponseV2, DemoResultV1, DemoResultV2 } from "@auto-world/demo-search-contract";

// The composition is deliberately pinned, not a runtime source activation API.
export const PROFILE = Object.freeze({
  sourceId: "src_sdk_synthetic",
  scopeId: "scope_7d18dbe77c718e18cb036fbb21b1658a783498188d5b547ed5c5413a5c743414",
  territory: "FR",
  acquisitionMethod: "feed",
  fixtureVersion: "synthetic-search-v1",
  mappingVersion: 1,
  maxDocuments: 10_000,
  maxEvidence: 256,
  maxSnapshotBytes: 32 * 1024 * 1024,
});

export interface EventKey {
  readonly sourceId: string;
  readonly runId: string;
  readonly operationKey: string;
}

export interface PublicSnapshot {
  readonly schemaVersion: 1;
  readonly fixtureVersion: "synthetic-search-v1";
  readonly dataAsOf: string;
  readonly completeness: "complete" | "partial";
  readonly fingerprint: string;
  readonly documents: readonly DemoResultV1[];
}

export interface DescriptionProfileDescriptor {
  readonly name: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface VerifiedDescriptionVersion {
  readonly listingId: string;
  readonly sourceListingId: string;
  readonly listingVersionId: string;
  readonly runId: string;
  readonly snapshotId: string;
  readonly rawSha256: string;
  readonly capturedAt: string;
  readonly pageOrdinal: number;
  readonly pageIdentity: string;
  readonly latest: boolean;
  readonly rawBytes: Uint8Array;
}

export interface VerifiedDescriptionProjectionInput {
  readonly generationId: string;
  readonly revision: number;
  readonly dataAsOf: string;
  readonly versions: readonly VerifiedDescriptionVersion[];
}

export interface ProjectionV2Options {
  readonly fixtureVersion: string;
  readonly catalog: DemoCatalogResponseV2;
  readonly mapperVersion: string;
  readonly descriptors: readonly DescriptionProfileDescriptor[];
  readonly project: (
    input: VerifiedDescriptionProjectionInput,
    base: readonly DemoResultV1[],
  ) => readonly DemoResultV2[];
}

export interface PublicSnapshotV2 {
  readonly schemaVersion: 2;
  readonly fixtureVersion: string;
  readonly taxonomyRelease: Pick<DemoCatalogResponseV2["taxonomyRelease"], "catalogId" | "releaseId" | "revision">;
  readonly mapperVersion: string;
  readonly profileFingerprint: string;
  readonly dataAsOf: string;
  readonly completeness: "complete" | "partial";
  readonly fingerprint: string;
  readonly documents: readonly DemoResultV2[];
}

export type SearchSnapshot = PublicSnapshot | PublicSnapshotV2;

export interface Publication {
  readonly indexName: string;
  readonly revision: number;
  readonly mappingVersion?: 1 | 2;
  readonly snapshot: Omit<PublicSnapshot, "documents"> | Omit<PublicSnapshotV2, "documents">;
  readonly documentCount: number;
  readonly pendingRelevant: boolean;
}

function validatedDescriptors(descriptors: readonly DescriptionProfileDescriptor[]): readonly DescriptionProfileDescriptor[] {
  requireProjection(Array.isArray(descriptors) && descriptors.length >= 1 && descriptors.length <= 256);
  const names = new Set<string>();
  const hashes = new Set<string>();
  return descriptors.map((descriptor) => {
    requireProjection(Object.keys(descriptor).sort().join("\0") === "byteLength\0name\0sha256"
      && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(descriptor.name)
      && Number.isSafeInteger(descriptor.byteLength) && descriptor.byteLength >= 1 && descriptor.byteLength <= 64 * 1024
      && /^[a-f0-9]{64}$/u.test(descriptor.sha256)
      && !names.has(descriptor.name) && !hashes.has(descriptor.sha256));
    names.add(descriptor.name);
    hashes.add(descriptor.sha256);
    return Object.freeze({ ...descriptor });
  });
}

export function profileFingerprint(options: Pick<ProjectionV2Options, "fixtureVersion" | "catalog" | "mapperVersion" | "descriptors">): string {
  requireProjection(options.catalog.schemaVersion === 2 && options.catalog.dataMode === "synthetic"
    && options.catalog.fixtureVersion === options.fixtureVersion
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(options.fixtureVersion)
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(options.mapperVersion));
  return `prf_${createProfileHash(stable({
    fixtureVersion: options.fixtureVersion,
    taxonomyRelease: { catalogId: options.catalog.taxonomyRelease.catalogId, releaseId: options.catalog.taxonomyRelease.releaseId,
      revision: options.catalog.taxonomyRelease.revision },
    mapperVersion: options.mapperVersion,
    descriptors: validatedDescriptors(options.descriptors),
  }))}`;
}

export function assertStoredProfileRows(options: ProjectionV2Options,
  runs: readonly { readonly run_id: string; readonly checkpoint: unknown }[],
  rawPages: readonly { readonly run_id: string; readonly snapshot_id: string; readonly sha256: string; readonly pending: unknown }[]): void {
  profileFingerprint(options);
  const descriptors = new Map(validatedDescriptors(options.descriptors).map((descriptor) => [descriptor.sha256, descriptor]));
  const runIds = new Set<string>();
  for (const row of runs) {
    requireProjection(!runIds.has(row.run_id) && row.checkpoint !== null && typeof row.checkpoint === "object" && !Array.isArray(row.checkpoint));
    const checkpoint = row.checkpoint as Record<string, unknown>;
    const request = checkpoint.request;
    const scope = checkpoint.scope;
    requireProjection(checkpoint.runId === row.run_id && checkpoint.sourceId === PROFILE.sourceId
      && request !== null && typeof request === "object" && !Array.isArray(request)
      && (request as Record<string, unknown>).mapperVersion === options.mapperVersion
      && (request as Record<string, unknown>).sourceId === PROFILE.sourceId
      && scope !== null && typeof scope === "object" && !Array.isArray(scope)
      && (scope as Record<string, unknown>).scopeId === PROFILE.scopeId
      && (scope as Record<string, unknown>).territory === PROFILE.territory
      && (scope as Record<string, unknown>).acquisitionMethod === PROFILE.acquisitionMethod);
    runIds.add(row.run_id);
  }
  const references = new Set<string>();
  for (const row of rawPages) {
    requireProjection(runIds.has(row.run_id) && !references.has(`${row.run_id}\0${row.snapshot_id}`)
      && row.pending !== null && typeof row.pending === "object" && !Array.isArray(row.pending));
    const pending = row.pending as Record<string, unknown>;
    const descriptor = descriptors.get(row.sha256);
    requireProjection(descriptor !== undefined && pending.snapshotId === row.snapshot_id && pending.sha256 === row.sha256
      && pending.byteLength === descriptor.byteLength
      && pending.pageIdentity === `${options.fixtureVersion}:${descriptor.name}`);
    references.add(`${row.run_id}\0${row.snapshot_id}`);
  }
}

function createProfileHash(value: string): string {
  // Kept here to make profile identity independent from callback/process state.
  return createHash("sha256").update("aw-search-profile-v2\0").update(value).digest("hex");
}

export class ProjectionRejected extends Error {
  constructor(readonly code: "projection_invalid" | "projection_limit" | "search_unavailable" = "projection_invalid") {
    super(code);
    this.name = "ProjectionRejected";
  }
}

export function requireProjection(value: unknown): asserts value {
  if (!value) throw new ProjectionRejected();
}

export function exactUtc(value: unknown): number {
  requireProjection(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value));
  const ms = Date.parse(value);
  requireProjection(Number.isFinite(ms) && new Date(ms).toISOString() === value);
  return ms;
}

export const ascii = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

export function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
