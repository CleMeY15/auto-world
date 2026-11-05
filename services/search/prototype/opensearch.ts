import "./guard.js";
import { createHash } from "node:crypto";
import {
  DEMO_PAGE_SIZE,
  parseDemoResult,
  type DemoResultV1,
  type DemoSearchQueryV1,
} from "@auto-world/demo-search-contract";
import { PROFILE, ProjectionRejected, ascii, stable } from "./model.js";

const INDEX_NAME = /^aw-v1-search-[a-f0-9]{32}$/u;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_BULK_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = PROFILE.maxSnapshotBytes + 1024 * 1024;

interface SearchResult {
  readonly results: readonly DemoResultV1[];
  readonly total: number;
}

export interface OpenSearchTransport {
  build(indexName: string, documents: readonly DemoResultV1[], signal: AbortSignal): Promise<void>;
  search(indexName: string, query: DemoSearchQueryV1, offset: number, signal: AbortSignal): Promise<SearchResult>;
  detail(indexName: string, listingId: string, signal: AbortSignal): Promise<DemoResultV1 | null>;
  verify(indexName: string, documents: readonly DemoResultV1[], signal: AbortSignal): Promise<boolean>;
  remove(indexName: string, signal: AbortSignal): Promise<void>;
}

interface JsonRequest {
  readonly method?: "GET" | "PUT" | "POST" | "DELETE";
  readonly body?: string;
  readonly contentType?: string;
  readonly maxBytes?: number;
}

class MissingIndex extends Error {
  constructor() {
    super("index_not_found");
    this.name = "MissingIndex";
  }
}

class ContentMismatch extends Error {
  constructor() {
    super("content_mismatch");
    this.name = "ContentMismatch";
  }
}

function reject(): never {
  throw new ProjectionRejected("search_unavailable");
}

function requireIndexName(indexName: string): void {
  if (!INDEX_NAME.test(indexName)) reject();
}

function derived(document: DemoResultV1): Record<string, unknown> {
  const parsed = parseDemoResult(document);
  if (!parsed.success) reject();
  const value = parsed.data;
  return {
    publicDto: value,
    listingId: value.listingId,
    availability: value.availability,
    ...(value.price.status === "observed" && value.price.value.currency === "EUR"
      ? { priceEUR: value.price.value.amountMinor }
      : {}),
    ...(value.mileage.status === "observed" && value.mileage.value.unit === "km"
      ? { mileageKm: value.mileage.value.amount }
      : {}),
  };
}

function checksum(documents: readonly DemoResultV1[]): string {
  const ordered = [...documents].sort((left, right) => ascii(left.listingId, right.listingId));
  return createHash("sha256").update(stable(ordered), "utf8").digest("hex");
}

function exactTotal(value: unknown): number {
  if (typeof value !== "object" || value === null) reject();
  const total = value as { value?: unknown; relation?: unknown };
  if (!Number.isSafeInteger(total.value) || (total.value as number) < 0 || (total.value as number) > PROFILE.maxDocuments) reject();
  if (total.relation !== "eq") reject();
  return total.value as number;
}

function inspectSearch(value: unknown, reconciliation = false): { readonly results: readonly DemoResultV1[]; readonly total: number } {
  if (typeof value !== "object" || value === null) reject();
  const response = value as {
    timed_out?: unknown;
    _shards?: { failed?: unknown };
    hits?: { total?: unknown; hits?: unknown };
  };
  if (response.timed_out !== false || response._shards?.failed !== 0 || !Array.isArray(response.hits?.hits)) reject();
  const total = exactTotal(response.hits.total);
  const results = response.hits.hits.map((hit) => {
    if (typeof hit !== "object" || hit === null) reject();
    const record = hit as { _id?: unknown; _source?: unknown };
    const source = record._source;
    if (typeof source !== "object" || source === null) reject();
    const parsed = parseDemoResult((source as { publicDto?: unknown }).publicDto);
    if (!parsed.success) {
      if (reconciliation) throw new ContentMismatch();
      reject();
    }
    if (record._id !== parsed.data.listingId || stable(source) !== stable(derived(parsed.data))) {
      if (reconciliation) throw new ContentMismatch();
      reject();
    }
    return parsed.data;
  });
  return { results, total };
}

function sortFor(query: DemoSearchQueryV1): readonly unknown[] {
  switch (query.sort) {
    case "listing_asc": return [{ listingId: { order: "asc" } }];
    case "price_asc": return [{ priceEUR: { order: "asc", missing: "_last" } }, { listingId: { order: "asc" } }];
    case "price_desc": return [{ priceEUR: { order: "desc", missing: "_last" } }, { listingId: { order: "asc" } }];
    case "mileage_asc": return [{ mileageKm: { order: "asc", missing: "_last" } }, { listingId: { order: "asc" } }];
    case "mileage_desc": return [{ mileageKm: { order: "desc", missing: "_last" } }, { listingId: { order: "asc" } }];
  }
}

function filtersFor(query: DemoSearchQueryV1): readonly unknown[] {
  return [
    { term: { availability: "active" } },
    ...(query.priceMaxMinor === undefined ? [] : [{ range: { priceEUR: { lte: query.priceMaxMinor } } }]),
    ...(query.mileageMaxKm === undefined ? [] : [{ range: { mileageKm: { lte: query.mileageMaxKm } } }]),
  ];
}

function bulkLines(documents: readonly DemoResultV1[]): readonly string[] {
  const lines: string[] = [];
  for (const document of documents) {
    lines.push(JSON.stringify({ index: { _id: document.listingId } }));
    lines.push(JSON.stringify(derived(document)));
  }
  return lines;
}

function bulkChunks(documents: readonly DemoResultV1[]): readonly { readonly body: string; readonly count: number }[] {
  const chunks: { body: string; count: number }[] = [];
  let current = "";
  let count = 0;
  const lines = bulkLines(documents);
  for (let index = 0; index < lines.length; index += 2) {
    const framed = `${lines[index]}\n${lines[index + 1]}\n`;
    const bytes = Buffer.byteLength(framed);
    if (bytes > MAX_BULK_BYTES) reject();
    if (current !== "" && Buffer.byteLength(current) + bytes > MAX_BULK_BYTES) {
      chunks.push({ body: current, count });
      current = "";
      count = 0;
    }
    current += framed;
    count += 1;
  }
  if (current !== "") chunks.push({ body: current, count });
  return chunks;
}

export function createOpenSearch(options: { readonly port: number }): OpenSearchTransport {
  if (!Number.isSafeInteger(options.port) || options.port < 1 || options.port > 65_535) reject();
  const origin = `http://127.0.0.1:${options.port}`;

  async function request(path: string, signal: AbortSignal, options: JsonRequest = {}): Promise<unknown> {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const combined = AbortSignal.any([signal, timeout]);
    let response: Response;
    try {
      response = await fetch(`${origin}${path}`, {
        method: options.method ?? "GET",
        body: options.body,
        headers: options.body === undefined ? undefined : { "content-type": options.contentType ?? "application/json" },
        redirect: "error",
        signal: combined,
      });
    } catch {
      reject();
    }
    if (response.body === null) reject();
    const reader = response.body.getReader();
    const pieces: Uint8Array[] = [];
    let length = 0;
    const maxBytes = options.maxBytes ?? 1024 * 1024;
    while (true) {
      const item = await reader.read().catch(() => reject());
      if (item.done) break;
      length += item.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel().catch(() => undefined);
        reject();
      }
      pieces.push(item.value);
    }
    const body = Buffer.concat(pieces, length).toString("utf8");
    let parsed: unknown;
    try {
      parsed = body === "" ? {} : JSON.parse(body);
    } catch {
      reject();
    }
    if (!response.ok) {
      if (response.status === 404
        && typeof parsed === "object"
        && parsed !== null
        && typeof (parsed as { error?: unknown }).error === "object"
        && (parsed as { error: { type?: unknown } }).error.type === "index_not_found_exception") {
        throw new MissingIndex();
      }
      reject();
    }
    return parsed;
  }

  async function sealed(indexName: string, signal: AbortSignal): Promise<boolean> {
    const response = await request(`/${indexName}/_settings?flat_settings=true`, signal);
    if (typeof response !== "object" || response === null || Array.isArray(response)) reject();
    const names = Object.keys(response);
    if (names.length !== 1 || names[0] !== indexName) reject();
    const settings = (response as Record<string, unknown>)[indexName];
    if (typeof settings !== "object" || settings === null) reject();
    const values = (settings as { settings?: unknown }).settings;
    if (typeof values !== "object" || values === null) reject();
    return (values as Record<string, unknown>)["index.blocks.write"] === "true";
  }

  async function search(indexName: string, query: DemoSearchQueryV1, offset: number, signal: AbortSignal): Promise<SearchResult> {
    requireIndexName(indexName);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + DEMO_PAGE_SIZE > PROFILE.maxDocuments) reject();
    const body = JSON.stringify({
      from: offset,
      size: DEMO_PAGE_SIZE,
      track_total_hits: true,
      timeout: `${REQUEST_TIMEOUT_MS - 250}ms`,
      query: { bool: { filter: filtersFor(query) } },
      sort: sortFor(query),
      _source: ["publicDto", "listingId", "availability", "priceEUR", "mileageKm"],
    });
    const result = inspectSearch(await request(`/${indexName}/_search?allow_partial_search_results=false`, signal, { method: "POST", body, maxBytes: MAX_RESPONSE_BYTES }));
    if (result.results.length !== Math.min(DEMO_PAGE_SIZE, Math.max(0, result.total - offset))) reject();
    return result;
  }

  async function detail(indexName: string, listingId: string, signal: AbortSignal): Promise<DemoResultV1 | null> {
    requireIndexName(indexName);
    const body = JSON.stringify({
      size: 1,
      track_total_hits: true,
      timeout: `${REQUEST_TIMEOUT_MS - 250}ms`,
      query: { term: { listingId } },
      _source: ["publicDto", "listingId", "availability", "priceEUR", "mileageKm"],
    });
    const result = inspectSearch(await request(`/${indexName}/_search?allow_partial_search_results=false`, signal, { method: "POST", body, maxBytes: MAX_RESPONSE_BYTES }));
    if (result.total > 1 || result.results.length !== result.total ||
        (result.results[0] !== undefined && result.results[0].listingId !== listingId)) reject();
    return result.results[0] ?? null;
  }

  async function verify(indexName: string, documents: readonly DemoResultV1[], signal: AbortSignal): Promise<boolean> {
    requireIndexName(indexName);
    if (documents.length > PROFILE.maxDocuments) reject();
    try {
      if (!await sealed(indexName, signal)) return false;
      const body = JSON.stringify({
        size: PROFILE.maxDocuments,
        track_total_hits: true,
        timeout: `${REQUEST_TIMEOUT_MS - 250}ms`,
        query: { match_all: {} },
        sort: [{ listingId: { order: "asc" } }],
        _source: ["publicDto", "listingId", "availability", "priceEUR", "mileageKm"],
      });
      const result = inspectSearch(await request(`/${indexName}/_search?allow_partial_search_results=false`, signal, { method: "POST", body, maxBytes: MAX_RESPONSE_BYTES }), true);
      return result.total === documents.length && result.results.length === documents.length && checksum(result.results) === checksum(documents);
    } catch (error) {
      if (error instanceof MissingIndex || error instanceof ContentMismatch) return false;
      throw error;
    }
  }

  async function build(indexName: string, documents: readonly DemoResultV1[], signal: AbortSignal): Promise<void> {
    requireIndexName(indexName);
    if (documents.length > PROFILE.maxDocuments) reject();
    const ids = new Set<string>();
    for (const document of documents) {
      if (ids.has(document.listingId)) reject();
      ids.add(document.listingId);
      derived(document);
    }
    const created = await request(`/${indexName}`, signal, {
      method: "PUT",
      body: JSON.stringify({
        settings: { number_of_shards: 1, number_of_replicas: 0 },
        mappings: {
          dynamic: "strict",
          _meta: {
            mappingVersion: PROFILE.mappingVersion,
            projectionProfile: PROFILE.fixtureVersion,
            generation: indexName,
          },
          properties: {
            publicDto: { type: "object", enabled: false },
            listingId: { type: "keyword" },
            availability: { type: "keyword" },
            priceEUR: { type: "long" },
            mileageKm: { type: "double" },
          },
        },
      }),
    });
    if (typeof created !== "object" || created === null || (created as { acknowledged?: unknown }).acknowledged !== true) reject();
    const chunks = bulkChunks(documents);
    if (chunks.reduce((total, chunk) => total + Buffer.byteLength(chunk.body), 0) > PROFILE.maxSnapshotBytes) reject();
    for (const chunk of chunks) {
      const response = await request(`/${indexName}/_bulk`, signal, { method: "POST", body: chunk.body, contentType: "application/x-ndjson", maxBytes: MAX_RESPONSE_BYTES });
      if (typeof response !== "object" || response === null || (response as { errors?: unknown }).errors !== false) reject();
      const items = (response as { items?: unknown }).items;
      if (!Array.isArray(items) || items.length !== chunk.count) reject();
      for (const item of items) {
        if (typeof item !== "object" || item === null) reject();
        const outcome = (item as { index?: { status?: unknown; error?: unknown } }).index;
        if (!outcome || typeof outcome.status !== "number" || outcome.status < 200 || outcome.status >= 300 || outcome.error !== undefined) reject();
      }
    }
    const refreshed = await request(`/${indexName}/_refresh`, signal, { method: "POST" });
    if (typeof refreshed !== "object" || refreshed === null || (refreshed as { _shards?: { failed?: unknown } })._shards?.failed !== 0) reject();
    const blocked = await request(`/${indexName}/_settings`, signal, { method: "PUT", body: JSON.stringify({ "index.blocks.write": true }) });
    if (typeof blocked !== "object" || blocked === null || (blocked as { acknowledged?: unknown }).acknowledged !== true) reject();
    if (!await verify(indexName, documents, signal)) reject();
  }

  async function remove(indexName: string, signal: AbortSignal): Promise<void> {
    requireIndexName(indexName);
    try {
      const mapping = await request(`/${indexName}/_mapping?filter_path=*.mappings._meta`, signal);
      if (typeof mapping !== "object" || mapping === null || Array.isArray(mapping)) reject();
      const names = Object.keys(mapping);
      if (names.length !== 1 || names[0] !== indexName) reject();
      const entry = (mapping as Record<string, unknown>)[indexName];
      if (typeof entry !== "object" || entry === null) reject();
      const mappings = (entry as { mappings?: unknown }).mappings;
      if (typeof mappings !== "object" || mappings === null) reject();
      const meta = (mappings as { _meta?: unknown })._meta;
      if (typeof meta !== "object" || meta === null || Array.isArray(meta)) reject();
      if (stable(meta) !== stable({ mappingVersion: PROFILE.mappingVersion, projectionProfile: PROFILE.fixtureVersion, generation: indexName })) reject();
      const removed = await request(`/${indexName}`, signal, { method: "DELETE" });
      if (typeof removed !== "object" || removed === null || (removed as { acknowledged?: unknown }).acknowledged !== true) reject();
    } catch (error) {
      if (!(error instanceof MissingIndex)) throw error;
    }
  }

  return Object.freeze({ build, search, detail, verify, remove });
}
