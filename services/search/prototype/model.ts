import "./guard.js";
import type { DemoResultV1 } from "@auto-world/demo-search-contract";

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

export interface Publication {
  readonly indexName: string;
  readonly revision: number;
  readonly snapshot: Omit<PublicSnapshot, "documents">;
  readonly documentCount: number;
  readonly pendingRelevant: boolean;
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
