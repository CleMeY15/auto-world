import { buildDemoBaseUrl } from "./demo-link-origin.ts";
import { encodeListingPathSegment } from "./protocol.ts";

export function buildPublicationLink(input: unknown, pageUrl: string): string | undefined {
  const listingSegment = encodeListingPathSegment(input);
  if (listingSegment === undefined) return undefined;
  const baseUrl = buildDemoBaseUrl(pageUrl);
  return baseUrl === undefined ? undefined : `${baseUrl}#detail/${listingSegment}`;
}
