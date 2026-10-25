import { parseSavedSearchCriteria, type SavedSearchCriteria } from "./saved-searches.ts";
import { buildDemoBaseUrl } from "./demo-link-origin.ts";
import { parseStrictJson } from "./strict-json.ts";

export const SEARCH_LINK_PREFIX = "#search-link/";
export const SEARCH_LINK_MAX_LENGTH = 4_096;

const SEARCH_LINK_V1_PREFIX = `${SEARCH_LINK_PREFIX}v1/`;
const versionPattern = /^v[1-9][0-9]*$/u;

export type SearchLinkDecodeResult =
  | { readonly status: "valid"; readonly criteria: SavedSearchCriteria }
  | { readonly status: "invalid" | "unsupported" };

export function isSearchLinkFragment(hash: string): boolean {
  return hash === "#search-link" || hash.startsWith(SEARCH_LINK_PREFIX);
}

export function encodeSearchLinkFragment(input: unknown): string | undefined {
  const criteria = parseSavedSearchCriteria(input);
  if (criteria === undefined) return undefined;
  const fragment = `${SEARCH_LINK_V1_PREFIX}${encodeURIComponent(JSON.stringify(criteria))}`;
  return fragment.length <= SEARCH_LINK_MAX_LENGTH ? fragment : undefined;
}

export function decodeSearchLinkFragment(input: unknown): SearchLinkDecodeResult {
  if (typeof input !== "string" || input.length > SEARCH_LINK_MAX_LENGTH || !isSearchLinkFragment(input)) return { status: "invalid" };
  if (!input.startsWith(SEARCH_LINK_V1_PREFIX)) {
    const versionEnd = input.indexOf("/", SEARCH_LINK_PREFIX.length);
    const version = versionEnd < 0 ? input.slice(SEARCH_LINK_PREFIX.length) : input.slice(SEARCH_LINK_PREFIX.length, versionEnd);
    return versionPattern.test(version) && version !== "v1" ? { status: "unsupported" } : { status: "invalid" };
  }
  const encoded = input.slice(SEARCH_LINK_V1_PREFIX.length);
  if (encoded.length === 0) return { status: "invalid" };
  let source: string;
  try { source = decodeURIComponent(encoded); }
  catch { return { status: "invalid" }; }
  let decoded: unknown;
  try { decoded = parseStrictJson(source); }
  catch { return { status: "invalid" }; }
  const criteria = parseSavedSearchCriteria(decoded);
  return criteria === undefined ? { status: "invalid" } : { status: "valid", criteria };
}

export function buildSearchLink(criteria: unknown, pageUrl: string): string | undefined {
  const fragment = encodeSearchLinkFragment(criteria);
  if (fragment === undefined) return undefined;
  const baseUrl = buildDemoBaseUrl(pageUrl);
  return baseUrl === undefined ? undefined : `${baseUrl}${fragment}`;
}
