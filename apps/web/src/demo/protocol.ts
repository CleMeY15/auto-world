import {
  parseDemoCatalogResponseV2,
  parseDemoSearchResponse,
  parseDemoSearchResponseV2,
  type DemoCatalogResponseV2,
  type DemoSearchResponseV1,
  type DemoSearchResponseV2,
} from "@auto-world/demo-search-contract";
import { parseListingId, type ListingId } from "@auto-world/vehicle-schema";
import { parseStrictJson } from "./strict-json.ts";

export type DemoHttpErrorCode = "invalid_query" | "invalid_cursor" | "invalid_request" | "not_found" | "method_not_allowed" | "cancelled" | "request_too_large" | "unsupported_content_type" | "read_unavailable";
export type DemoHttpOutcome =
  | { readonly ok: true; readonly requestId: string; readonly data: DemoSearchResponseV1 }
  | { readonly ok: false; readonly requestId: string; readonly code: DemoHttpErrorCode };
export type DemoHttpOutcomeV2 =
  | { readonly ok: true; readonly requestId: string; readonly data: DemoSearchResponseV2 }
  | { readonly ok: false; readonly requestId: string; readonly code: DemoHttpErrorCode };
export type DemoCatalogHttpOutcomeV2 =
  | { readonly ok: true; readonly requestId: string; readonly data: DemoCatalogResponseV2 }
  | { readonly ok: false; readonly requestId: string; readonly code: DemoHttpErrorCode };

const requestIdPattern = /^req_[0-9a-f]{32}$/u;
const errorCodes = new Set<DemoHttpErrorCode>(["invalid_query", "invalid_cursor", "invalid_request", "not_found", "method_not_allowed", "cancelled", "request_too_large", "unsupported_content_type", "read_unavailable"]);
const catalogErrorCodes = new Set<DemoHttpErrorCode>(["invalid_request", "not_found", "method_not_allowed", "cancelled", "request_too_large", "unsupported_content_type", "read_unavailable"]);
const errorStatus: Readonly<Record<DemoHttpErrorCode, number>> = Object.freeze({ invalid_query: 400, invalid_cursor: 400, invalid_request: 400, not_found: 404, method_not_allowed: 405, cancelled: 408, request_too_large: 413, unsupported_content_type: 415, read_unavailable: 503 });

function plainExact(input: unknown, keys: readonly string[]): input is Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input) || Object.getPrototypeOf(input) !== null) return false;
  return Object.keys(input).sort().join() === [...keys].sort().join();
}

export function statusForDemoError(code: DemoHttpErrorCode): number { return errorStatus[code]; }

export function parseDemoHttpOutcome(source: string, status: number, asOf: string, expectedListingId?: ListingId): DemoHttpOutcome | undefined {
  let input: unknown;
  try { input = parseStrictJson(source); } catch { return undefined; }
  if (status === 200) {
    if (!plainExact(input, ["schemaVersion", "requestId", "data"]) || input.schemaVersion !== 1 || typeof input.requestId !== "string" || !requestIdPattern.test(input.requestId)) return undefined;
    const parsed = parseDemoSearchResponse(input.data, asOf);
    if (!parsed.success) return undefined;
    if (expectedListingId === undefined) {
      if (parsed.data.results.some((result) => result.availability !== "active")) return undefined;
    } else {
      const result = parsed.data.results[0];
      if (parsed.data.results.length !== 1 || parsed.data.nextCursor !== undefined || (parsed.data.state === "complete" && parsed.data.totalCount !== 1) || result?.listingId !== expectedListingId) return undefined;
    }
    return Object.freeze({ ok: true, requestId: input.requestId, data: parsed.data });
  }
  if (!plainExact(input, ["schemaVersion", "requestId", "error"]) || input.schemaVersion !== 1 || typeof input.requestId !== "string" || !requestIdPattern.test(input.requestId)) return undefined;
  if (!plainExact(input.error, ["code"]) || typeof input.error.code !== "string" || !errorCodes.has(input.error.code as DemoHttpErrorCode)) return undefined;
  const code = input.error.code as DemoHttpErrorCode;
  return errorStatus[code] === status ? Object.freeze({ ok: false, requestId: input.requestId, code }) : undefined;
}

function parseV2Error(input: unknown, status: number, allowedCodes: ReadonlySet<DemoHttpErrorCode> = errorCodes): Extract<DemoHttpOutcomeV2, { readonly ok: false }> | undefined {
  if (!plainExact(input, ["schemaVersion", "requestId", "error"]) || input.schemaVersion !== 2 || typeof input.requestId !== "string" || !requestIdPattern.test(input.requestId)) return undefined;
  if (!plainExact(input.error, ["code"]) || typeof input.error.code !== "string" || !allowedCodes.has(input.error.code as DemoHttpErrorCode)) return undefined;
  const code = input.error.code as DemoHttpErrorCode;
  return errorStatus[code] === status ? Object.freeze({ ok: false, requestId: input.requestId, code }) : undefined;
}

export function parseDemoHttpOutcomeV2(source: string, status: number, asOf: string, expectedListingId?: ListingId): DemoHttpOutcomeV2 | undefined {
  let input: unknown;
  try { input = parseStrictJson(source); } catch { return undefined; }
  if (status !== 200) return parseV2Error(input, status);
  if (!plainExact(input, ["schemaVersion", "requestId", "data"]) || input.schemaVersion !== 2 || typeof input.requestId !== "string" || !requestIdPattern.test(input.requestId)) return undefined;
  const parsed = parseDemoSearchResponseV2(input.data, asOf);
  if (!parsed.success) return undefined;
  if (expectedListingId === undefined) {
    if (parsed.data.results.some((result) => result.availability !== "active")) return undefined;
  } else {
    const result = parsed.data.results[0];
    if (parsed.data.results.length !== 1 || parsed.data.nextCursor !== undefined || (parsed.data.state === "complete" && parsed.data.totalCount !== 1) || result?.listingId !== expectedListingId) return undefined;
  }
  return Object.freeze({ ok: true, requestId: input.requestId, data: parsed.data });
}

export function parseDemoCatalogHttpOutcomeV2(source: string, status: number): DemoCatalogHttpOutcomeV2 | undefined {
  let input: unknown;
  try { input = parseStrictJson(source); } catch { return undefined; }
  if (status !== 200) return parseV2Error(input, status, catalogErrorCodes);
  if (!plainExact(input, ["schemaVersion", "requestId", "data"]) || input.schemaVersion !== 2 || typeof input.requestId !== "string" || !requestIdPattern.test(input.requestId)) return undefined;
  const parsed = parseDemoCatalogResponseV2(input.data);
  return parsed.success ? Object.freeze({ ok: true, requestId: input.requestId, data: parsed.data }) : undefined;
}

export function parsePublicListingId(input: unknown): ListingId | undefined {
  const parsed = parseListingId(input);
  return parsed.success ? parsed.data : undefined;
}

export function encodeListingPathSegment(input: unknown): string | undefined {
  const id = parsePublicListingId(input);
  return id === undefined ? undefined : encodeURIComponent(id);
}
