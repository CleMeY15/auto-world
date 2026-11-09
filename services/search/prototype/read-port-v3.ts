import "./guard.js";
import { randomBytes as systemRandomBytes } from "node:crypto";
import {
  DEMO_PAGE_SIZE,
  parseDemoCatalogResponseV2,
  parseDemoSearchQueryV3,
  resolveDemoSearchModels,
  type DemoCatalogResponseV2,
  type DemoKeywordReadPort,
  type DemoReadOutcomeV2,
  type DemoSearchQueryV3,
} from "@auto-world/demo-search-contract";
import { ProjectionRejected, type Publication } from "./model.js";
import type { OpenSearchTransport } from "./opensearch.js";
import { createCursorSession, invalidQueryFailure, publicationGeneration, queryBinding, readAborted, readFailure, validV2Publication, v2Response } from "./read-port-v2-common.js";

const CAPACITY = 1_024;

interface Options {
  readonly catalog: DemoCatalogResponseV2;
  readonly loadPublication: (signal: AbortSignal) => Promise<Publication | null>;
  readonly search: Pick<OpenSearchTransport, "searchKeyword">;
  readonly nowMs?: () => number;
  readonly randomBytes?: (size: number) => Uint8Array;
  readonly cursorCapacity?: number;
}

export function createSearchKeywordReadPort(options: Options): DemoKeywordReadPort {
  const parsedCatalog = parseDemoCatalogResponseV2(options.catalog);
  if (!parsedCatalog.success) throw new ProjectionRejected("search_unavailable");
  const catalog = parsedCatalog.data;
  const capacity = options.cursorCapacity ?? CAPACITY;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > CAPACITY) throw new ProjectionRejected("search_unavailable");
  const entropy = options.randomBytes ?? systemRandomBytes;
  const nowMs = options.nowMs ?? Date.now;
  const session = createCursorSession({ domain: "aw-search-cursor-v3\0", capacity, entropy });

  async function publication(signal: AbortSignal): Promise<Publication | null> {
    const value = await options.loadPublication(signal);
    if (value === null) return null;
    if (!validV2Publication(value, catalog)) throw new ProjectionRejected("search_unavailable");
    session.synchronize(value);
    return value;
  }

  async function search(input: DemoSearchQueryV3, context: { readonly signal: AbortSignal }): Promise<DemoReadOutcomeV2> {
    if (context.signal.aborted) return readFailure("cancelled");
    const parsed = parseDemoSearchQueryV3(input);
    if (!parsed.success) return invalidQueryFailure(input);
    try {
      const current = await publication(context.signal);
      if (current === null) return readFailure("read_unavailable");
      const requestState = session.snapshot(); const requestGeneration = publicationGeneration(current);
      const bind = queryBinding(current, parsed.data);
      const offset = session.offsetFor(parsed.data.cursor, bind);
      if (offset === null) return readFailure("invalid_cursor");
      const modelIds = parsed.data.text === undefined ? undefined : resolveDemoSearchModels(catalog.taxonomyRelease, parsed.data.text);
      const page = await options.search.searchKeyword(current.indexName, parsed.data, modelIds, offset, context.signal);
      if (context.signal.aborted) return readFailure("cancelled");
      const settledState = session.snapshot();
      if (settledState.active !== requestGeneration || settledState.epoch !== requestState.epoch || !Number.isSafeInteger(page.total)
        || page.total < page.results.length || page.total > current.documentCount
        || page.results.length !== Math.min(DEMO_PAGE_SIZE, Math.max(0, page.total - offset))) return readFailure("read_unavailable");
      const nextOffset = offset + page.results.length;
      const next = nextOffset < page.total && page.results.length > 0 ? session.continuation(bind, nextOffset) : undefined;
      return v2Response(current, catalog, page.results, page.total, nowMs(), next);
    } catch (error) { return readFailure(readAborted(error, context.signal) ? "cancelled" : "read_unavailable"); }
  }

  return Object.freeze({ search });
}
