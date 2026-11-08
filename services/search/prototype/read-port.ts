import "./guard.js";
import { createHash, randomBytes as systemRandomBytes } from "node:crypto";
import {
  DEMO_FRESHNESS_MS,
  DEMO_PAGE_SIZE,
  parseDemoSearchQuery,
  parseDemoSearchResponse,
  type DemoReadOutcome,
  type DemoReadPort,
  type DemoResultV1,
  type DemoResultV2,
  type DemoSearchQueryV1,
} from "@auto-world/demo-search-contract";
import { parseListingId } from "@auto-world/vehicle-schema";
import type { Publication } from "./model.js";
import { PROFILE, ProjectionRejected, exactUtc, stable } from "./model.js";
import type { OpenSearchTransport } from "./opensearch.js";

const DEFAULT_CURSOR_CAPACITY = 1024;
const CURSOR = /^cur_[0-9a-f]{64}$/u;

interface CursorRecord {
  readonly binding: string;
  readonly offset: number;
}

interface Options {
  readonly loadPublication: (signal: AbortSignal) => Promise<Publication | null>;
  readonly search: Pick<OpenSearchTransport, "search" | "detail" | "searchV2" | "detailV2">;
  readonly nowMs?: () => number;
  readonly randomBytes?: (size: number) => Uint8Array;
  readonly cursorCapacity?: number;
}

const failure = (code: "invalid_cursor" | "read_unavailable" | "cancelled"): DemoReadOutcome =>
  Object.freeze({ success: false, error: Object.freeze({ code }) });

function queryBinding(publication: Publication, query: DemoSearchQueryV1): string {
  return stable({ revision: revisionOf(publication), indexName: publication.indexName, fingerprint: publication.snapshot.fingerprint, query: {
    schemaVersion: query.schemaVersion,
    sort: query.sort,
    ...(query.priceMaxMinor === undefined ? {} : { priceMaxMinor: query.priceMaxMinor }),
    ...(query.mileageMaxKm === undefined ? {} : { mileageMaxKm: query.mileageMaxKm }),
  } });
}

function revisionOf(publication: Publication): number {
  return publication.revision;
}

function generation(publication: Publication): string {
  return `${publication.indexName}\0${publication.snapshot.fingerprint}`;
}

function publicationValid(publication: Publication): boolean {
  const revision = publication.revision;
  const v1 = /^aw-v1-search-[a-f0-9]{32}$/u.test(publication.indexName)
    && (publication.mappingVersion === undefined || publication.mappingVersion === 1)
    && publication.snapshot.schemaVersion === 1
    && publication.snapshot.fixtureVersion === PROFILE.fixtureVersion;
  const v2 = /^aw-v2-search-[a-f0-9]{32}$/u.test(publication.indexName)
    && publication.mappingVersion === 2 && publication.snapshot.schemaVersion === 2
    && /^prf_[a-f0-9]{64}$/u.test(publication.snapshot.profileFingerprint);
  return (v1 || v2)
    && Number.isSafeInteger(revision)
    && revision >= 1
    && publication.documentCount >= 0
    && Number.isSafeInteger(publication.documentCount)
    && publication.documentCount <= PROFILE.maxDocuments
    && (publication.snapshot.completeness === "complete" || publication.snapshot.completeness === "partial")
    && typeof publication.pendingRelevant === "boolean"
    && /^[a-f0-9]{64}$/u.test(publication.snapshot.fingerprint)
    && Number.isFinite(exactUtc(publication.snapshot.dataAsOf));
}

function base(document: DemoResultV2): DemoResultV1 {
  return { listingId: document.listingId, availability: document.availability,
    price: document.price, mileage: document.mileage, evidence: document.evidence };
}

function responseFor(publication: Publication, results: readonly DemoResultV1[], total: number, nowMs: number, nextCursor?: string): DemoReadOutcome {
  const dataAsOfMs = exactUtc(publication.snapshot.dataAsOf);
  if (!Number.isFinite(nowMs) || nowMs < dataAsOfMs) return failure("read_unavailable");
  const common = {
    schemaVersion: 1 as const,
    dataMode: "synthetic" as const,
    fixtureVersion: publication.snapshot.fixtureVersion,
    dataAsOf: publication.snapshot.dataAsOf,
    results,
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
  const age = nowMs - dataAsOfMs;
  const candidate = age > DEMO_FRESHNESS_MS
    ? { ...common, state: "stale" as const, reason: "projection_stale" as const }
    : publication.snapshot.completeness === "partial" || publication.pendingRelevant
      ? { ...common, state: "partial" as const, reason: "projection_incomplete" as const }
      : { ...common, state: "complete" as const, totalCount: total };
  const parsed = parseDemoSearchResponse(candidate, new Date(nowMs).toISOString());
  return parsed.success ? Object.freeze({ success: true, data: parsed.data }) : failure("read_unavailable");
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || error instanceof DOMException && error.name === "AbortError";
}

export function createSearchReadPort(options: Options): DemoReadPort {
  const capacity = options.cursorCapacity ?? DEFAULT_CURSOR_CAPACITY;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > DEFAULT_CURSOR_CAPACITY) throw new ProjectionRejected("search_unavailable");
  const randomBytes = options.randomBytes ?? systemRandomBytes;
  const nowMs = options.nowMs ?? Date.now;
  const cursors = new Map<string, CursorRecord>();
  const memo = new Map<string, string>();
  let activeGeneration: string | undefined;
  let highestRevision = 0;
  let epoch = 0;

  function synchronize(publication: Publication): void {
    const nextGeneration = generation(publication);
    const nextRevision = revisionOf(publication);
    if (nextRevision < highestRevision) throw new ProjectionRejected("search_unavailable");
    if (nextRevision === highestRevision) {
      if (activeGeneration !== undefined && activeGeneration !== nextGeneration) throw new ProjectionRejected("search_unavailable");
      activeGeneration = nextGeneration;
      return;
    }
    if (activeGeneration !== undefined) {
      cursors.clear();
      memo.clear();
      epoch += 1;
    }
    highestRevision = nextRevision;
    activeGeneration = nextGeneration;
  }

  function continuation(binding: string, offset: number): string {
    const memoKey = `${binding}\0${offset}`;
    const existing = memo.get(memoKey);
    if (existing !== undefined) return existing;
    if (cursors.size >= capacity) throw new ProjectionRejected("search_unavailable");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const entropy = randomBytes(32);
      if (!(entropy instanceof Uint8Array) || entropy.byteLength !== 32) throw new ProjectionRejected("search_unavailable");
      const token = `cur_${createHash("sha256").update("aw-search-cursor-v1\0").update(String(epoch)).update("\0").update(binding).update("\0").update(String(offset)).update("\0").update(entropy).digest("hex")}`;
      if (!cursors.has(token)) {
        cursors.set(token, Object.freeze({ binding, offset }));
        memo.set(memoKey, token);
        return token;
      }
    }
    throw new ProjectionRejected("search_unavailable");
  }

  async function publication(signal: AbortSignal): Promise<Publication | null> {
    const value = await options.loadPublication(signal);
    if (value === null) return null;
    if (!publicationValid(value)) throw new ProjectionRejected("search_unavailable");
    synchronize(value);
    return value;
  }

  async function search(queryInput: DemoSearchQueryV1, context: { readonly signal: AbortSignal }): Promise<DemoReadOutcome> {
    if (context.signal.aborted) return failure("cancelled");
    try {
      const parsed = parseDemoSearchQuery(queryInput);
      if (!parsed.success) return queryInput?.cursor === undefined ? failure("read_unavailable") : failure("invalid_cursor");
      const current = await publication(context.signal);
      if (current === null) return failure("read_unavailable");
      const requestGeneration = generation(current);
      const requestEpoch = epoch;
      const binding = queryBinding(current, parsed.data);
      let offset = 0;
      if (parsed.data.cursor !== undefined) {
        if (!CURSOR.test(parsed.data.cursor)) return failure("invalid_cursor");
        const record = cursors.get(parsed.data.cursor);
        if (record === undefined || record.binding !== binding) return failure("invalid_cursor");
        offset = record.offset;
      }
      const page = current.snapshot.schemaVersion === 2
        ? await options.search.searchV2(current.indexName, { ...parsed.data, schemaVersion: 2 }, offset, context.signal)
        : await options.search.search(current.indexName, parsed.data, offset, context.signal);
      if (activeGeneration !== requestGeneration || epoch !== requestEpoch) return failure("read_unavailable");
      if (!Number.isSafeInteger(page.total)
        || page.total < page.results.length
        || page.total > current.documentCount
        || page.results.length !== Math.min(DEMO_PAGE_SIZE, Math.max(0, page.total - offset))) {
        return failure("read_unavailable");
      }
      const nextOffset = offset + page.results.length;
      const nextCursor = nextOffset < page.total && page.results.length > 0 ? continuation(binding, nextOffset) : undefined;
      return responseFor(current, page.results.map((item) => current.snapshot.schemaVersion === 2 ? base(item as DemoResultV2) : item), page.total, nowMs(), nextCursor);
    } catch (error) {
      return failure(isAbort(error, context.signal) ? "cancelled" : "read_unavailable");
    }
  }

  async function getListing(listingIdInput: Parameters<DemoReadPort["getListing"]>[0], context: { readonly signal: AbortSignal }): Promise<DemoReadOutcome> {
    if (context.signal.aborted) return failure("cancelled");
    try {
      const listingId = parseListingId(listingIdInput);
      if (!listingId.success) return failure("read_unavailable");
      const current = await publication(context.signal);
      if (current === null) return failure("read_unavailable");
      const requestGeneration = generation(current);
      const requestEpoch = epoch;
      const result = current.snapshot.schemaVersion === 2
        ? await options.search.detailV2(current.indexName, listingId.data, context.signal)
        : await options.search.detail(current.indexName, listingId.data, context.signal);
      if (activeGeneration !== requestGeneration || epoch !== requestEpoch) return failure("read_unavailable");
      const projected = result === null ? [] : [current.snapshot.schemaVersion === 2 ? base(result as DemoResultV2) : result];
      const outcome = responseFor(current, projected, result === null ? 0 : 1, nowMs());
      if (result === null && (!outcome.success || outcome.data.state !== "complete")) return failure("read_unavailable");
      return outcome;
    } catch (error) {
      return failure(isAbort(error, context.signal) ? "cancelled" : "read_unavailable");
    }
  }

  return Object.freeze({ search, getListing });
}

export const SEARCH_CURSOR_CAPACITY = DEFAULT_CURSOR_CAPACITY;
