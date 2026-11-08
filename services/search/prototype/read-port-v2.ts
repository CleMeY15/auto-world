import "./guard.js";
import { createHash, randomBytes as systemRandomBytes } from "node:crypto";
import {
  DEMO_FRESHNESS_MS,
  DEMO_PAGE_SIZE,
  parseDemoCatalogResponseV2,
  parseDemoSearchQueryV2,
  parseDemoSearchResponseV2,
  type DemoCatalogResponseV2,
  type DemoReadOutcomeV2,
  type DemoReadPortV2,
  type DemoResultV2,
  type DemoSearchQueryV2,
} from "@auto-world/demo-search-contract";
import { parseListingId } from "@auto-world/vehicle-schema";
import { PROFILE, ProjectionRejected, exactUtc, stable, type Publication } from "./model.js";
import type { OpenSearchTransport } from "./opensearch.js";

const CAPACITY = 1024;
const CURSOR = /^cur_[0-9a-f]{64}$/u;
type CursorRecord = { readonly binding: string; readonly offset: number };

interface Options {
  readonly catalog: DemoCatalogResponseV2;
  readonly loadPublication: (signal: AbortSignal) => Promise<Publication | null>;
  readonly search: Pick<OpenSearchTransport, "searchV2" | "detailV2">;
  readonly nowMs?: () => number;
  readonly randomBytes?: (size: number) => Uint8Array;
  readonly cursorCapacity?: number;
}

const failure = (code: "invalid_query" | "invalid_cursor" | "read_unavailable" | "cancelled"): DemoReadOutcomeV2 =>
  Object.freeze({ success: false, error: Object.freeze({ code }) });

function valid(publication: Publication, catalog: DemoCatalogResponseV2): boolean {
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

function binding(publication: Publication, query: DemoSearchQueryV2): string {
  return stable({ revision: publication.revision, indexName: publication.indexName, fingerprint: publication.snapshot.fingerprint,
    fixtureVersion: publication.snapshot.fixtureVersion,
    taxonomyRelease: publication.snapshot.schemaVersion === 2 ? publication.snapshot.taxonomyRelease : null,
    query: { ...query, cursor: undefined } });
}

function generation(publication: Publication): string {
  return `${publication.indexName}\0${publication.snapshot.fingerprint}`;
}

function response(publication: Publication, catalog: DemoCatalogResponseV2, results: readonly DemoResultV2[], total: number,
  nowMs: number, nextCursor?: string): DemoReadOutcomeV2 {
  const dataAsOfMs = exactUtc(publication.snapshot.dataAsOf);
  if (publication.snapshot.schemaVersion !== 2 || !Number.isFinite(nowMs) || nowMs < dataAsOfMs) return failure("read_unavailable");
  const common = { schemaVersion: 2 as const, dataMode: "synthetic" as const, fixtureVersion: catalog.fixtureVersion,
    taxonomyRelease: publication.snapshot.taxonomyRelease, dataAsOf: publication.snapshot.dataAsOf, results,
    ...(nextCursor === undefined ? {} : { nextCursor }) };
  const candidate = nowMs - dataAsOfMs > DEMO_FRESHNESS_MS
    ? { ...common, state: "stale" as const, reason: "projection_stale" as const }
    : publication.snapshot.completeness === "partial" || publication.pendingRelevant
      ? { ...common, state: "partial" as const, reason: "projection_incomplete" as const }
      : { ...common, state: "complete" as const, totalCount: total };
  const parsed = parseDemoSearchResponseV2(candidate, new Date(nowMs).toISOString());
  return parsed.success ? Object.freeze({ success: true, data: parsed.data }) : failure("read_unavailable");
}

function aborted(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || error instanceof DOMException && error.name === "AbortError";
}

export function createSearchReadPortV2(options: Options): DemoReadPortV2 {
  const parsedCatalog = parseDemoCatalogResponseV2(options.catalog);
  if (!parsedCatalog.success) throw new ProjectionRejected("search_unavailable");
  const catalog = parsedCatalog.data;
  const capacity = options.cursorCapacity ?? CAPACITY;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > CAPACITY) throw new ProjectionRejected("search_unavailable");
  const entropy = options.randomBytes ?? systemRandomBytes;
  const nowMs = options.nowMs ?? Date.now;
  const cursors = new Map<string, CursorRecord>();
  const memo = new Map<string, string>();
  let active: string | undefined;
  let highestRevision = 0;
  let epoch = 0;

  function synchronize(publication: Publication): void {
    const next = generation(publication);
    if (publication.revision < highestRevision || publication.revision === highestRevision && active !== undefined && active !== next) {
      throw new ProjectionRejected("search_unavailable");
    }
    if (publication.revision > highestRevision && active !== undefined) { cursors.clear(); memo.clear(); epoch += 1; }
    highestRevision = Math.max(highestRevision, publication.revision);
    active = next;
  }

  async function publication(signal: AbortSignal): Promise<Publication | null> {
    const value = await options.loadPublication(signal);
    if (value === null) return null;
    if (!valid(value, catalog)) throw new ProjectionRejected("search_unavailable");
    synchronize(value);
    return value;
  }

  function continuation(bind: string, offset: number): string {
    const key = `${bind}\0${offset}`;
    const found = memo.get(key);
    if (found) return found;
    if (cursors.size >= capacity) throw new ProjectionRejected("search_unavailable");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const bytes = entropy(32);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) throw new ProjectionRejected("search_unavailable");
      const token = `cur_${createHash("sha256").update("aw-search-cursor-v2\0").update(String(epoch)).update("\0").update(bind)
        .update("\0").update(String(offset)).update("\0").update(bytes).digest("hex")}`;
      if (!cursors.has(token)) { cursors.set(token, Object.freeze({ binding: bind, offset })); memo.set(key, token); return token; }
    }
    throw new ProjectionRejected("search_unavailable");
  }

  async function search(input: DemoSearchQueryV2, context: { readonly signal: AbortSignal }): Promise<DemoReadOutcomeV2> {
    if (context.signal.aborted) return failure("cancelled");
    const parsed = parseDemoSearchQueryV2(input);
    if (!parsed.success) return input?.cursor === undefined ? failure("invalid_query") : failure("invalid_cursor");
    try {
      const current = await publication(context.signal);
      if (current === null) return failure("read_unavailable");
      const requestGeneration = generation(current); const requestEpoch = epoch;
      const bind = binding(current, parsed.data);
      let offset = 0;
      if (parsed.data.cursor !== undefined) {
        const record = CURSOR.test(parsed.data.cursor) ? cursors.get(parsed.data.cursor) : undefined;
        if (!record || record.binding !== bind) return failure("invalid_cursor");
        offset = record.offset;
      }
      const page = await options.search.searchV2(current.indexName, parsed.data, offset, context.signal);
      if (active !== requestGeneration || epoch !== requestEpoch || !Number.isSafeInteger(page.total)
        || page.total < page.results.length || page.total > current.documentCount
        || page.results.length !== Math.min(DEMO_PAGE_SIZE, Math.max(0, page.total - offset))) return failure("read_unavailable");
      const nextOffset = offset + page.results.length;
      const next = nextOffset < page.total && page.results.length > 0 ? continuation(bind, nextOffset) : undefined;
      return response(current, catalog, page.results, page.total, nowMs(), next);
    } catch (error) { return failure(aborted(error, context.signal) ? "cancelled" : "read_unavailable"); }
  }

  async function getListing(input: Parameters<DemoReadPortV2["getListing"]>[0], context: { readonly signal: AbortSignal }): Promise<DemoReadOutcomeV2> {
    if (context.signal.aborted) return failure("cancelled");
    try {
      const listingId = parseListingId(input);
      if (!listingId.success) return failure("read_unavailable");
      const current = await publication(context.signal);
      if (current === null) return failure("read_unavailable");
      const requestGeneration = generation(current); const requestEpoch = epoch;
      const result = await options.search.detailV2(current.indexName, listingId.data, context.signal);
      if (active !== requestGeneration || epoch !== requestEpoch) return failure("read_unavailable");
      const outcome = response(current, catalog, result === null ? [] : [result], result === null ? 0 : 1, nowMs());
      return result === null && (!outcome.success || outcome.data.state !== "complete") ? failure("read_unavailable") : outcome;
    } catch (error) { return failure(aborted(error, context.signal) ? "cancelled" : "read_unavailable"); }
  }

  async function readCatalog(context: { readonly signal: AbortSignal }) {
    if (context.signal.aborted) return Object.freeze({ success: false as const, error: Object.freeze({ code: "cancelled" as const }) });
    try {
      const current = await publication(context.signal);
      return current === null
        ? Object.freeze({ success: false as const, error: Object.freeze({ code: "read_unavailable" as const }) })
        : Object.freeze({ success: true as const, data: catalog });
    } catch (error) {
      return Object.freeze({ success: false as const, error: Object.freeze({ code: aborted(error, context.signal) ? "cancelled" as const : "read_unavailable" as const }) });
    }
  }
  return Object.freeze({ catalog: readCatalog, search, getListing });
}
