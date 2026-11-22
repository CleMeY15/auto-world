import { digest, plainRecord } from "./manifest.js";
import type { CaptureEnvelopeV1, HttpSeedManifestV1 } from "./types.js";

export function encodeCapture(body: Uint8Array, manifest: HttpSeedManifestV1, manifestSha256: string, ordinal: number): Uint8Array {
  const entry = manifest.entries[ordinal];
  if (!entry || body.byteLength > manifest.maxBodyBytes) throw new Error("capture_invalid");
  const envelope: CaptureEnvelopeV1 = { schemaVersion: 1, kind: "autofindex_http_capture", manifestSha256,
    ordinal, sourceListingId: entry.sourceListingId, url: entry.url, status: 200, contentType: "text/html",
    bodyLength: body.byteLength, bodySha256: digest(body), bodyBase64: Buffer.from(body).toString("base64") };
  return new globalThis.TextEncoder().encode(JSON.stringify(envelope));
}

export function decodeCapture(input: unknown, manifest: HttpSeedManifestV1, manifestSha256: string): { ordinal: number; body: Uint8Array } | null {
  if (!plainRecord(input, ["schemaVersion", "kind", "manifestSha256", "ordinal", "sourceListingId", "url", "status", "contentType", "bodyLength", "bodySha256", "bodyBase64"])) return null;
  if (input.schemaVersion !== 1 || input.kind !== "autofindex_http_capture" || input.manifestSha256 !== manifestSha256
    || !Number.isSafeInteger(input.ordinal) || (input.ordinal as number) < 0
    || input.status !== 200 || input.contentType !== "text/html" || !Number.isSafeInteger(input.bodyLength)
    || (input.bodyLength as number) < 0 || (input.bodyLength as number) > manifest.maxBodyBytes
    || typeof input.bodySha256 !== "string" || !/^[a-f0-9]{64}$/u.test(input.bodySha256)
    || typeof input.bodyBase64 !== "string" || input.bodyBase64.length > Math.ceil(manifest.maxBodyBytes / 3) * 4) return null;
  const entry = manifest.entries[input.ordinal as number];
  if (!entry || entry.sourceListingId !== input.sourceListingId || entry.url !== input.url) return null;
  const body = Buffer.from(input.bodyBase64, "base64");
  if (body.toString("base64") !== input.bodyBase64 || body.byteLength !== input.bodyLength || digest(body) !== input.bodySha256) return null;
  return { ordinal: input.ordinal as number, body: new Uint8Array(body) };
}
