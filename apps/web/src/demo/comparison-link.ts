import type { DemoSearchResponseV2 } from "@auto-world/demo-search-contract";
import type { ListingId } from "@auto-world/vehicle-schema";

import type { SavedDetailResultV2 } from "./client.ts";
import type { ComparisonEntry } from "./comparison.ts";
import { buildDemoBaseUrl } from "./demo-link-origin.ts";
import { parsePublicListingId } from "./protocol.ts";
import { parseStrictJson } from "./strict-json.ts";

export const COMPARISON_LINK_PREFIX = "#comparison-link/";
export const COMPARISON_LINK_MAX_LENGTH = 1_024;

const COMPARISON_LINK_V1_PREFIX = `${COMPARISON_LINK_PREFIX}v1/`;
const versionPattern = /^v[1-9][0-9]*$/u;

export type ComparisonLinkDecodeResult =
  | { readonly status: "valid"; readonly listingIds: readonly ListingId[] }
  | { readonly status: "invalid" | "unsupported" };

export type ComparisonBundleResolution =
  | {
    readonly status: "ready";
    readonly entries: readonly ComparisonEntry[];
    readonly responses: readonly DemoSearchResponseV2[];
  }
  | { readonly status: "incomplete" | "incompatible" };

function parseListingIds(input: unknown): readonly ListingId[] | undefined {
  try {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const lengthDescriptor = Reflect.get(descriptors, "length") as PropertyDescriptor | undefined;
    if (lengthDescriptor === undefined || !("value" in lengthDescriptor) || typeof lengthDescriptor.value !== "number" || !Number.isInteger(lengthDescriptor.value) || lengthDescriptor.value < 2 || lengthDescriptor.value > 3) return undefined;
    const length = lengthDescriptor.value;
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== length + 1 || keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9][0-9]*)$/u.test(key)))) return undefined;

    const listingIds: ListingId[] = [];
    const distinct = new Set<string>();
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return undefined;
      const listingId = parsePublicListingId(descriptor.value);
      if (listingId === undefined || distinct.has(listingId)) return undefined;
      distinct.add(listingId);
      listingIds.push(listingId);
    }
    return Object.freeze(listingIds);
  } catch {
    return undefined;
  }
}

export function isComparisonLinkFragment(hash: string): boolean {
  return hash === "#comparison-link" || hash.startsWith(COMPARISON_LINK_PREFIX);
}

export function encodeComparisonLinkFragment(input: unknown): string | undefined {
  const listingIds = parseListingIds(input);
  if (listingIds === undefined) return undefined;
  const fragment = `${COMPARISON_LINK_V1_PREFIX}${encodeURIComponent(JSON.stringify(listingIds))}`;
  return fragment.length <= COMPARISON_LINK_MAX_LENGTH ? fragment : undefined;
}

export function decodeComparisonLinkFragment(input: unknown): ComparisonLinkDecodeResult {
  if (typeof input !== "string" || input.length > COMPARISON_LINK_MAX_LENGTH || !isComparisonLinkFragment(input)) return { status: "invalid" };
  if (!input.startsWith(COMPARISON_LINK_V1_PREFIX)) {
    const versionEnd = input.indexOf("/", COMPARISON_LINK_PREFIX.length);
    const version = versionEnd < 0 ? input.slice(COMPARISON_LINK_PREFIX.length) : input.slice(COMPARISON_LINK_PREFIX.length, versionEnd);
    return versionPattern.test(version) && version !== "v1" ? { status: "unsupported" } : { status: "invalid" };
  }
  const encoded = input.slice(COMPARISON_LINK_V1_PREFIX.length);
  if (encoded.length === 0) return { status: "invalid" };
  let source: string;
  try { source = decodeURIComponent(encoded); }
  catch { return { status: "invalid" }; }
  let decoded: unknown;
  try { decoded = parseStrictJson(source); }
  catch { return { status: "invalid" }; }
  const listingIds = parseListingIds(decoded);
  return listingIds === undefined ? { status: "invalid" } : { status: "valid", listingIds };
}

export function buildComparisonLink(listingIds: unknown, pageUrl: string): string | undefined {
  const fragment = encodeComparisonLinkFragment(listingIds);
  if (fragment === undefined) return undefined;
  const baseUrl = buildDemoBaseUrl(pageUrl);
  return baseUrl === undefined ? undefined : `${baseUrl}${fragment}`;
}

function sameResponseTuple(left: DemoSearchResponseV2, right: DemoSearchResponseV2): boolean {
  return left.fixtureVersion === right.fixtureVersion
    && left.taxonomyRelease.catalogId === right.taxonomyRelease.catalogId
    && left.taxonomyRelease.releaseId === right.taxonomyRelease.releaseId
    && left.taxonomyRelease.revision === right.taxonomyRelease.revision;
}

export function resolveComparisonBundle(
  requestedIds: readonly ListingId[],
  items: readonly SavedDetailResultV2[],
): ComparisonBundleResolution {
  const validatedIds = parseListingIds(requestedIds);
  if (validatedIds === undefined || !Array.isArray(items) || items.length !== validatedIds.length) return { status: "incomplete" };

  const responsesById = new Map<ListingId, DemoSearchResponseV2>();
  for (const item of items) {
    const listingId = parsePublicListingId(item.listingId);
    if (listingId === undefined || !validatedIds.includes(listingId) || responsesById.has(listingId) || !item.outcome.ok) return { status: "incomplete" };
    const response = item.outcome.data;
    const result = response.results[0];
    if (response.results.length !== 1 || result?.listingId !== listingId) return { status: "incomplete" };
    responsesById.set(listingId, response);
  }

  const responses = validatedIds.map((listingId) => responsesById.get(listingId));
  if (responses.some((response) => response === undefined)) return { status: "incomplete" };
  const orderedResponses = responses as DemoSearchResponseV2[];
  const first = orderedResponses[0]!;
  if (orderedResponses.some((response) => !sameResponseTuple(first, response))) return { status: "incompatible" };

  const entries = orderedResponses.map((response, index) => Object.freeze({ result: response.results[0]!, index }));
  return Object.freeze({
    status: "ready",
    entries: Object.freeze(entries),
    responses: Object.freeze([...orderedResponses]),
  });
}
