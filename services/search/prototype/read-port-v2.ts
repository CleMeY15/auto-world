import "./guard.js";
import { randomBytes as systemRandomBytes } from "node:crypto";
import {
  DEMO_PAGE_SIZE,
  parseDemoCatalogResponseV2,
  parseDemoSearchQueryV2,
  type DemoCatalogResponseV2,
  type DemoReadOutcomeV2,
  type DemoReadPortV2,
  type DemoSearchQueryV2,
} from "@auto-world/demo-search-contract";
import { parseListingId } from "@auto-world/vehicle-schema";
import { ProjectionRejected, type Publication } from "./model.js";
import type { OpenSearchTransport } from "./opensearch.js";
import { createCursorSession, invalidQueryFailure, publicationGeneration, queryBinding, readAborted, readFailure, validV2Publication, v2Response } from "./read-port-v2-common.js";

const CAPACITY = 1024;

interface Options {
  readonly catalog: DemoCatalogResponseV2;
  readonly loadPublication: (signal: AbortSignal) => Promise<Publication | null>;
  readonly search: Pick<OpenSearchTransport, "searchV2" | "detailV2">;
  readonly nowMs?: () => number;
  readonly randomBytes?: (size: number) => Uint8Array;
  readonly cursorCapacity?: number;
}

export function createSearchReadPortV2(options: Options): DemoReadPortV2 {
  const parsedCatalog = parseDemoCatalogResponseV2(options.catalog);
  if (!parsedCatalog.success) throw new ProjectionRejected("search_unavailable");
  const catalog = parsedCatalog.data;
  const capacity = options.cursorCapacity ?? CAPACITY;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > CAPACITY) throw new ProjectionRejected("search_unavailable");
  const entropy = options.randomBytes ?? systemRandomBytes;
  const nowMs = options.nowMs ?? Date.now;
  const session = createCursorSession({ domain: "aw-search-cursor-v2\0", capacity, entropy });

  async function publication(signal: AbortSignal): Promise<Publication | null> {
    const value = await options.loadPublication(signal);
    if (value === null) return null;
    if (!validV2Publication(value, catalog)) throw new ProjectionRejected("search_unavailable");
    session.synchronize(value);
    return value;
  }

  async function search(input: DemoSearchQueryV2, context: { readonly signal: AbortSignal }): Promise<DemoReadOutcomeV2> {
    if (context.signal.aborted) return readFailure("cancelled");
    const parsed = parseDemoSearchQueryV2(input);
    if (!parsed.success) return invalidQueryFailure(input);
    try {
      const current = await publication(context.signal);
      if (current === null) return readFailure("read_unavailable");
      const requestState = session.snapshot();
      const requestGeneration = publicationGeneration(current);
      const bind = queryBinding(current, parsed.data);
      const offset = session.offsetFor(parsed.data.cursor, bind);
      if (offset === null) return readFailure("invalid_cursor");
      const page = await options.search.searchV2(current.indexName, parsed.data, offset, context.signal);
      const settledState = session.snapshot();
      if (settledState.active !== requestGeneration || settledState.epoch !== requestState.epoch || !Number.isSafeInteger(page.total)
        || page.total < page.results.length || page.total > current.documentCount
        || page.results.length !== Math.min(DEMO_PAGE_SIZE, Math.max(0, page.total - offset))) return readFailure("read_unavailable");
      const nextOffset = offset + page.results.length;
      const next = nextOffset < page.total && page.results.length > 0 ? session.continuation(bind, nextOffset) : undefined;
      return v2Response(current, catalog, page.results, page.total, nowMs(), next);
    } catch (error) { return readFailure(readAborted(error, context.signal) ? "cancelled" : "read_unavailable"); }
  }

  async function getListing(input: Parameters<DemoReadPortV2["getListing"]>[0], context: { readonly signal: AbortSignal }): Promise<DemoReadOutcomeV2> {
    if (context.signal.aborted) return readFailure("cancelled");
    try {
      const listingId = parseListingId(input);
      if (!listingId.success) return readFailure("read_unavailable");
      const current = await publication(context.signal);
      if (current === null) return readFailure("read_unavailable");
      const requestState = session.snapshot(); const requestGeneration = publicationGeneration(current);
      const result = await options.search.detailV2(current.indexName, listingId.data, context.signal);
      const settledState = session.snapshot();
      if (settledState.active !== requestGeneration || settledState.epoch !== requestState.epoch) return readFailure("read_unavailable");
      const outcome = v2Response(current, catalog, result === null ? [] : [result], result === null ? 0 : 1, nowMs());
      return result === null && (!outcome.success || outcome.data.state !== "complete") ? readFailure("read_unavailable") : outcome;
    } catch (error) { return readFailure(readAborted(error, context.signal) ? "cancelled" : "read_unavailable"); }
  }

  async function readCatalog(context: { readonly signal: AbortSignal }) {
    if (context.signal.aborted) return Object.freeze({ success: false as const, error: Object.freeze({ code: "cancelled" as const }) });
    try {
      const current = await publication(context.signal);
      return current === null
        ? Object.freeze({ success: false as const, error: Object.freeze({ code: "read_unavailable" as const }) })
        : Object.freeze({ success: true as const, data: catalog });
    } catch (error) {
      return Object.freeze({ success: false as const, error: Object.freeze({ code: readAborted(error, context.signal) ? "cancelled" as const : "read_unavailable" as const }) });
    }
  }
  return Object.freeze({ catalog: readCatalog, search, getListing });
}
