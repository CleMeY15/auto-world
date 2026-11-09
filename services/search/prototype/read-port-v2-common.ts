import { createHash } from "node:crypto";
import {
  DEMO_FRESHNESS_MS,
  parseDemoSearchResponseV2,
  type DemoCatalogResponseV2,
  type DemoReadOutcomeV2,
  type DemoResultV2,
  type DemoSearchQueryV2,
  type DemoSearchQueryV3,
} from "@auto-world/demo-search-contract";
import { PROFILE, ProjectionRejected, exactUtc, stable, type Publication } from "./model.js";

const CURSOR = /^cur_[0-9a-f]{64}$/u;
type CursorRecord = { readonly binding: string; readonly offset: number };

export const readFailure = (code: "invalid_query" | "invalid_cursor" | "read_unavailable" | "cancelled"): DemoReadOutcomeV2 =>
  Object.freeze({ success: false, error: Object.freeze({ code }) });

export function invalidQueryFailure(input: unknown): DemoReadOutcomeV2 {
  try {
    if (typeof input === "object" && input !== null) {
      const descriptor = Object.getOwnPropertyDescriptor(input, "cursor");
      if (descriptor !== undefined && "value" in descriptor && descriptor.value !== undefined) return readFailure("invalid_cursor");
    }
  } catch { /* Hostile proxies are invalid queries, never executable input. */ }
  return readFailure("invalid_query");
}

export function validV2Publication(publication: Publication, catalog: DemoCatalogResponseV2): boolean {
  const snapshot = publication.snapshot;
  const catalogReference = { catalogId: catalog.taxonomyRelease.catalogId, releaseId: catalog.taxonomyRelease.releaseId,
    revision: catalog.taxonomyRelease.revision };
  return publication.mappingVersion === 2 && /^aw-v2-search-[a-f0-9]{32}$/u.test(publication.indexName)
    && Number.isSafeInteger(publication.revision) && publication.revision >= 1
    && Number.isSafeInteger(publication.documentCount) && publication.documentCount >= 0 && publication.documentCount <= PROFILE.maxDocuments
    && snapshot.schemaVersion === 2 && snapshot.fixtureVersion === catalog.fixtureVersion
    && stable(snapshot.taxonomyRelease) === stable(catalogReference)
    && /^prf_[a-f0-9]{64}$/u.test(snapshot.profileFingerprint)
    && /^[a-f0-9]{64}$/u.test(snapshot.fingerprint)
    && Number.isFinite(exactUtc(snapshot.dataAsOf))
    && (snapshot.completeness === "complete" || snapshot.completeness === "partial")
    && typeof publication.pendingRelevant === "boolean";
}

export function queryBinding(publication: Publication, query: DemoSearchQueryV2 | DemoSearchQueryV3): string {
  return stable({ revision: publication.revision, indexName: publication.indexName, fingerprint: publication.snapshot.fingerprint,
    fixtureVersion: publication.snapshot.fixtureVersion,
    taxonomyRelease: publication.snapshot.schemaVersion === 2 ? publication.snapshot.taxonomyRelease : null,
    query: { ...query, cursor: undefined } });
}

export const publicationGeneration = (publication: Publication): string =>
  `${publication.indexName}\0${publication.snapshot.fingerprint}`;

export function v2Response(publication: Publication, catalog: DemoCatalogResponseV2, results: readonly DemoResultV2[], total: number,
  nowMs: number, nextCursor?: string): DemoReadOutcomeV2 {
  const dataAsOfMs = exactUtc(publication.snapshot.dataAsOf);
  if (publication.snapshot.schemaVersion !== 2 || !Number.isFinite(nowMs) || nowMs < dataAsOfMs) return readFailure("read_unavailable");
  const common = { schemaVersion: 2 as const, dataMode: "synthetic" as const, fixtureVersion: catalog.fixtureVersion,
    taxonomyRelease: publication.snapshot.taxonomyRelease, dataAsOf: publication.snapshot.dataAsOf, results,
    ...(nextCursor === undefined ? {} : { nextCursor }) };
  const candidate = nowMs - dataAsOfMs > DEMO_FRESHNESS_MS
    ? { ...common, state: "stale" as const, reason: "projection_stale" as const }
    : publication.snapshot.completeness === "partial" || publication.pendingRelevant
      ? { ...common, state: "partial" as const, reason: "projection_incomplete" as const }
      : { ...common, state: "complete" as const, totalCount: total };
  const parsed = parseDemoSearchResponseV2(candidate, new Date(nowMs).toISOString());
  return parsed.success ? Object.freeze({ success: true, data: parsed.data }) : readFailure("read_unavailable");
}

export const readAborted = (error: unknown, signal: AbortSignal): boolean =>
  signal.aborted || error instanceof DOMException && error.name === "AbortError";

export function createCursorSession(options: {
  readonly domain: "aw-search-cursor-v2\0" | "aw-search-cursor-v3\0";
  readonly capacity: number;
  readonly entropy: (size: number) => Uint8Array;
}) {
  const cursors = new Map<string, CursorRecord>();
  const memo = new Map<string, string>();
  let active: string | undefined;
  let highestRevision = 0;
  let epoch = 0;

  function synchronize(publication: Publication): void {
    const next = publicationGeneration(publication);
    if (publication.revision < highestRevision || publication.revision === highestRevision && active !== undefined && active !== next) {
      throw new ProjectionRejected("search_unavailable");
    }
    if (publication.revision > highestRevision && active !== undefined) { cursors.clear(); memo.clear(); epoch += 1; }
    highestRevision = Math.max(highestRevision, publication.revision);
    active = next;
  }

  function offsetFor(token: string | undefined, binding: string): number | null {
    if (token === undefined) return 0;
    const record = CURSOR.test(token) ? cursors.get(token) : undefined;
    return record?.binding === binding ? record.offset : null;
  }

  function continuation(binding: string, offset: number): string {
    const key = `${binding}\0${offset}`;
    const found = memo.get(key);
    if (found) return found;
    if (cursors.size >= options.capacity) throw new ProjectionRejected("search_unavailable");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const bytes = options.entropy(32);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) throw new ProjectionRejected("search_unavailable");
      const token = `cur_${createHash("sha256").update(options.domain).update(String(epoch)).update("\0").update(binding)
        .update("\0").update(String(offset)).update("\0").update(bytes).digest("hex")}`;
      if (!cursors.has(token)) { cursors.set(token, Object.freeze({ binding, offset })); memo.set(key, token); return token; }
    }
    throw new ProjectionRejected("search_unavailable");
  }

  return Object.freeze({ synchronize, offsetFor, continuation,
    snapshot: () => Object.freeze({ active, epoch }) });
}
