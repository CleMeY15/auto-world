import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { parseSourceId } from "@auto-world/vehicle-schema";
import type { Territory } from "@auto-world/source-registry";
import type { HttpSeedManifestV1 } from "./types.js";

export const MAX_BODY_BYTES = 512 * 1024;
export const MAPPER_VERSION = "schema-vehicle-html-v1.parse5-8.1.1";
export const USER_AGENT = "AutoFindexBot/0.1 (+https://autofind.tech)";
const territories = new Set<Territory>(["FR", "DE", "KR", "GB", "US", "CH", "JP"]);
export const digest = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

export function plainRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(value).length === keys.length && keys.every((key) => {
    const entry = descriptors[key];
    return entry !== undefined && Object.hasOwn(entry, "value") && entry.enumerable;
  });
}

export function publicHttpsUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 32 || code === 127) return null;
  }
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.port !== "" || url.username || url.password || url.hash
      || host.endsWith(".") || host.includes(":") || isIP(host) !== 0 || !host.includes(".")
      || /(?:^|\.)(?:localhost|local|internal|home|lan)$/u.test(host)) return null;
    return url;
  } catch { return null; }
}

export function freezeManifest(input: unknown): { manifest: HttpSeedManifestV1; sha256: string } | null {
  if (!plainRecord(input, ["schemaVersion", "sourceId", "territory", "origin", "maxBodyBytes", "entries"])) return null;
  const source = parseSourceId(input.sourceId);
  const origin = publicHttpsUrl(input.origin);
  if (input.schemaVersion !== 1 || !source.success || !origin || origin.origin !== input.origin
    || !territories.has(input.territory as Territory) || !Number.isSafeInteger(input.maxBodyBytes)
    || (input.maxBodyBytes as number) < 1 || (input.maxBodyBytes as number) > MAX_BODY_BYTES
    || !Array.isArray(input.entries) || input.entries.length < 1 || input.entries.length > 100) return null;
  const ids = new Set<string>();
  const urls = new Set<string>();
  const entries: { readonly sourceListingId: string; readonly url: string }[] = [];
  for (const entry of input.entries) {
    if (!plainRecord(entry, ["sourceListingId", "url"]) || typeof entry.sourceListingId !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/u.test(entry.sourceListingId)) return null;
    const url = publicHttpsUrl(entry.url);
    if (!url || url.origin !== origin.origin || url.href !== entry.url || ids.has(entry.sourceListingId) || urls.has(url.href)) return null;
    ids.add(entry.sourceListingId); urls.add(url.href);
    entries.push(Object.freeze({ sourceListingId: entry.sourceListingId, url: url.href }));
  }
  const manifest: HttpSeedManifestV1 = Object.freeze({ schemaVersion: 1, sourceId: source.data,
    territory: input.territory as Territory, origin: origin.origin, maxBodyBytes: input.maxBodyBytes as number,
    entries: Object.freeze(entries) });
  return { manifest, sha256: digest(JSON.stringify(manifest)) };
}
