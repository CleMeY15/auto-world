import type { DemoSearchQueryV1, DemoSearchResponseV1 } from "@auto-world/demo-search-contract";
import type { ListingId } from "@auto-world/vehicle-schema";
import { encodeListingPathSegment, parseDemoHttpOutcome, type DemoHttpErrorCode } from "./protocol.ts";

export type DemoClientErrorCode = DemoHttpErrorCode | "offline" | "invalid_response";
export type DemoClientOutcome =
  | { readonly ok: true; readonly requestId: string; readonly data: DemoSearchResponseV1 }
  | { readonly ok: false; readonly code: DemoClientErrorCode };
export interface DemoClient {
  search(query: DemoSearchQueryV1, options?: { readonly signal?: AbortSignal }): Promise<DemoClientOutcome>;
  listing(listingId: ListingId, options?: { readonly signal?: AbortSignal }): Promise<DemoClientOutcome>;
}

export function createDemoClient(options: { readonly fetchImpl?: typeof fetch; readonly clock?: () => Date } = {}): DemoClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const clock = options.clock ?? (() => new Date());
  const request = async (url: string, init: RequestInit, listingId?: ListingId): Promise<DemoClientOutcome> => {
    try {
      const response = await fetchImpl(url, { ...init, cache: "no-store", redirect: "error" });
      const text = await response.text();
      const parsed = parseDemoHttpOutcome(text, response.status, clock().toISOString(), listingId);
      if (parsed === undefined) return { ok: false, code: "invalid_response" };
      return parsed.ok ? parsed : { ok: false, code: parsed.code };
    } catch (error) {
      if (init.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) return { ok: false, code: "cancelled" };
      return { ok: false, code: "offline" };
    }
  };
  const client: DemoClient = {
    search(query: DemoSearchQueryV1, callOptions: { readonly signal?: AbortSignal } = {}) {
      return request("/api/demo/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(query), signal: callOptions.signal });
    },
    listing(listingId: ListingId, callOptions: { readonly signal?: AbortSignal } = {}) {
      const segment = encodeListingPathSegment(listingId);
      if (segment === undefined) return Promise.resolve({ ok: false as const, code: "invalid_request" as const });
      return request(`/api/demo/listings/${segment}`, { method: "GET", signal: callOptions.signal }, listingId);
    },
  };
  return Object.freeze(client);
}

export interface SavedDetailResult { readonly listingId: ListingId; readonly outcome: DemoClientOutcome }

export async function loadSavedDetails(client: DemoClient, listingIds: readonly ListingId[], options: { readonly signal?: AbortSignal; readonly onItem?: (item: SavedDetailResult, index: number) => void } = {}): Promise<readonly SavedDetailResult[]> {
  const results = new Array<SavedDetailResult>(listingIds.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < listingIds.length && !options.signal?.aborted) {
      const index = next;
      next += 1;
      const listingId = listingIds[index];
      if (listingId === undefined) continue;
      const outcome = await client.listing(listingId, { signal: options.signal });
      if (options.signal?.aborted) return;
      const item = Object.freeze({ listingId, outcome });
      results[index] = item;
      options.onItem?.(item, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, listingIds.length) }, worker));
  return Object.freeze(results.filter((item): item is SavedDetailResult => item !== undefined));
}

export type SearchPageAppendResult =
  | { readonly ok: true; readonly data: DemoSearchResponseV1 }
  | { readonly ok: false; readonly code: "changed_snapshot" | "changed_state" | "duplicate_result" | "inconsistent_page" | "projection_overflow" };

export function appendSearchPage(current: DemoSearchResponseV1, page: DemoSearchResponseV1): SearchPageAppendResult {
  if (current.nextCursor === undefined) return { ok: false, code: "inconsistent_page" };
  if (current.fixtureVersion !== page.fixtureVersion || current.dataAsOf !== page.dataAsOf) return { ok: false, code: "changed_snapshot" };
  if (current.state !== page.state && page.state !== "stale") return { ok: false, code: "changed_state" };
  if (current.state === "complete" && page.state === "complete" && current.totalCount !== page.totalCount) return { ok: false, code: "changed_snapshot" };
  const listings = new Set(current.results.map((item) => item.listingId));
  const evidence = new Set(current.results.flatMap((item) => item.evidence.map((entry) => entry.evidenceId)));
  for (const item of page.results) {
    if (listings.has(item.listingId) || item.evidence.some((entry) => evidence.has(entry.evidenceId))) return { ok: false, code: "duplicate_result" };
    listings.add(item.listingId);
    for (const entry of item.evidence) evidence.add(entry.evidenceId);
  }
  const results = [...current.results, ...page.results];
  if (results.length > 10_000 || (page.nextCursor !== undefined && results.length >= 10_000)) return { ok: false, code: "projection_overflow" };
  if (page.state === "complete" && ((page.nextCursor === undefined && page.totalCount !== results.length) || (page.nextCursor !== undefined && page.totalCount <= results.length))) return { ok: false, code: "inconsistent_page" };
  const common = { schemaVersion: 1 as const, dataMode: "synthetic" as const, fixtureVersion: page.fixtureVersion, dataAsOf: page.dataAsOf, results, ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) };
  const data: DemoSearchResponseV1 = page.state === "complete" ? { ...common, state: "complete", totalCount: page.totalCount } : page.state === "partial" ? { ...common, state: "partial", reason: "projection_incomplete" } : { ...common, state: "stale", reason: "projection_stale" };
  return { ok: true, data };
}

export interface SearchPageToken { readonly generation: number; readonly cursor?: string }
export interface SearchPaginationSnapshot { readonly generation: number; readonly data?: DemoSearchResponseV1 }
export type SearchPageAcceptance = SearchPageAppendResult | { readonly ok: false; readonly code: "late_page" };
export interface SearchPagination {
  beginSearch(): SearchPageToken;
  acceptFirst(token: SearchPageToken, page: DemoSearchResponseV1): SearchPageAcceptance;
  beginNext(): SearchPageToken | undefined;
  acceptNext(token: SearchPageToken, page: DemoSearchResponseV1): SearchPageAcceptance;
  getSnapshot(): SearchPaginationSnapshot;
}

export function createSearchPagination(): SearchPagination {
  let generation = 0;
  let data: DemoSearchResponseV1 | undefined;
  let snapshot: SearchPaginationSnapshot = Object.freeze({ generation });
  const update = (next: DemoSearchResponseV1 | undefined): void => {
    data = next;
    snapshot = Object.freeze({ generation, ...(data === undefined ? {} : { data }) });
  };
  return Object.freeze({
    beginSearch() { generation += 1; update(undefined); return Object.freeze({ generation }); },
    acceptFirst(token, page) {
      if (token.generation !== generation || token.cursor !== undefined || data !== undefined) return { ok: false, code: "late_page" };
      update(page);
      return { ok: true, data: page };
    },
    beginNext() {
      const cursor = data?.nextCursor;
      return cursor === undefined ? undefined : Object.freeze({ generation, cursor });
    },
    acceptNext(token, page) {
      if (token.generation !== generation || token.cursor === undefined || data?.nextCursor !== token.cursor) return { ok: false, code: "late_page" };
      const accepted = appendSearchPage(data, page);
      if (accepted.ok) update(accepted.data);
      return accepted;
    },
    getSnapshot: () => snapshot,
  } satisfies SearchPagination);
}
