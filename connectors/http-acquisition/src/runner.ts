import { parseConnectorRunRequest, runConnector } from "@auto-world/connector-sdk";
import type { ConnectorAdapterPort, ConnectorRunResult } from "@auto-world/connector-sdk";
import { parseSourceRegistry } from "@auto-world/source-registry";
import { decodeCapture, encodeCapture } from "./capture.js";
import { extractVehicleJsonLd } from "./extract.js";
import { freezeManifest, MAPPER_VERSION, plainRecord } from "./manifest.js";
import { createHttpsTransport } from "./transport.js";
import type { AcquisitionPorts, CaptureTransport, HttpSeedManifestV1, SeededAcquisitionResult, SeededRunRequest } from "./types.js";

const supportedFields = new Set(["source_listing_id", "url", "price", "mileage", "vin"]);
const invalid: ConnectorRunResult = Object.freeze({ status: "failed", runId: null, checkpointRevision: null,
  error: Object.freeze({ code: "invalid_request", phase: "authority", retryable: false, attempt: 0 }) });

function seedAdapter(manifest: HttpSeedManifestV1, sha256: string, transport: CaptureTransport): ConnectorAdapterPort {
  const cursor = (ordinal: number) => `seed:${sha256}:${ordinal}`;
  return {
    async fetchPage(input) {
      const entry = manifest.entries[input.pageOrdinal];
      if (input.sourceId !== manifest.sourceId || input.signal.aborted || !entry
        || input.cursor !== (input.pageOrdinal === 0 ? null : cursor(input.pageOrdinal))) {
        return { success: false, failure: { kind: "terminal" } };
      }
      // Base64 and metadata count toward the SDK raw-page limit. Reserve enough
      // bytes for the bodyLength field as it grows from zero to six digits.
      const overhead = encodeCapture(new Uint8Array(0), manifest, sha256, input.pageOrdinal).byteLength + 8;
      const maxBytes = Math.min(manifest.maxBodyBytes, Math.floor((input.maxResponseBytes - overhead) / 4) * 3);
      if (maxBytes < 1) return { success: false, failure: { kind: "terminal" } };
      const captured = await transport.capture({ url: entry.url, maxBytes, signal: input.signal });
      if (!captured.success) return { success: false, failure: {
        kind: captured.kind, ...(captured.retryAfterMs === undefined ? {} : { retryAfterMs: captured.retryAfterMs }),
      } };
      if (input.signal.aborted || captured.status !== 200 || captured.contentType !== "text/html"
        || !(captured.body instanceof Uint8Array) || captured.body.byteLength > maxBytes) {
        return { success: false, failure: { kind: "terminal" } };
      }
      const bytes = encodeCapture(captured.body, manifest, sha256, input.pageOrdinal);
      if (bytes.byteLength > input.maxResponseBytes) return { success: false, failure: { kind: "terminal" } };
      const complete = input.pageOrdinal === manifest.entries.length - 1;
      return { success: true, page: { pageIdentity: cursor(input.pageOrdinal), bytes,
        nextCursor: complete ? null : cursor(input.pageOrdinal + 1), complete } };
    },
    async mapPage(input) {
      if (input.sourceId !== manifest.sourceId || input.territory !== manifest.territory
        || input.acquisitionMethod !== "crawl" || input.signal.aborted) throw new Error("capture_scope_invalid");
      const capture = decodeCapture(input.decoded, manifest, sha256);
      if (!capture) throw new Error("capture_invalid");
      const extracted = extractVehicleJsonLd(capture.body, input.fields);
      if (!extracted.success) throw new Error(`extract_${extracted.code}`);
      const entry = manifest.entries[capture.ordinal]!;
      return { items: [{ sourceListingId: entry.sourceListingId, outcome: "active",
        ...(input.fields.includes("url") ? { url: entry.url } : {}), observations: extracted.observations }] };
    },
  };
}

// Internal test composition only. The public entry point below always supplies
// the bounded HTTPS implementation; no adapter or unrestricted fetch is exported.
export async function runWithTransport(requestInput: SeededRunRequest, manifestInput: HttpSeedManifestV1,
  ports: AcquisitionPorts, transport: CaptureTransport, signal?: AbortSignal): Promise<SeededAcquisitionResult> {
  const frozen = freezeManifest(manifestInput);
  const requestedPages = frozen?.manifest.entries.length ?? 0;
  const result = (value: ConnectorRunResult): SeededAcquisitionResult => ({ coverage: "seed_manifest_only", requestedPages, result: value });
  if (!frozen || !plainRecord(requestInput, ["schemaVersion", "audience", "fields", "mode", "invocationKey", "limits"])) return result(invalid);
  const { manifest, sha256 } = frozen;
  const parsed = parseConnectorRunRequest({ ...requestInput, sourceId: manifest.sourceId, territory: manifest.territory,
    acquisitionMethod: "crawl", adapterVersion: `http-seeds-v1.${sha256}`, mapperVersion: MAPPER_VERSION });
  if (!parsed.success || parsed.data.fields.some((field) => !supportedFields.has(field))
    || parsed.data.limits.maxPages < requestedPages || parsed.data.limits.maxItems < requestedPages) return result(invalid);
  const authority = {
    async loadVerifiedCurrent(input: Parameters<AcquisitionPorts["authority"]["loadVerifiedCurrent"]>[0]) {
      const verified = await ports.authority.loadVerifiedCurrent(input);
      const registry = parseSourceRegistry(verified.registry);
      if (!registry.success || registry.data.sourceId !== manifest.sourceId) throw new Error("seed_policy_invalid");
      const current = registry.data.revisions.at(-1)?.configuration;
      // A finite manifest is never evidence that every listing of a source was
      // seen. Check this at every SDK read, including resume and finalization.
      if (!current || current.credentials.kind !== "none" || !current.acquisitionMethods.includes("crawl")
        || !current.territories.includes(manifest.territory) || current.operations.deletionMode !== "explicit_tombstone") {
        throw new Error("seed_policy_invalid");
      }
      return verified;
    },
  };
  return result(await runConnector(parsed.data, { ...ports, authority, adapter: seedAdapter(manifest, sha256, transport) }, signal));
}

export function runSeededHttpConnector(request: SeededRunRequest, manifest: HttpSeedManifestV1,
  ports: AcquisitionPorts, signal?: AbortSignal): Promise<SeededAcquisitionResult> {
  return runWithTransport(request, manifest, ports, createHttpsTransport(), signal);
}
