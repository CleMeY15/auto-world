import type { ConnectorPorts, ConnectorRunRequest, ConnectorRunResult } from "@auto-world/connector-sdk";
import type { Territory } from "@auto-world/source-registry";
import type { SourceId } from "@auto-world/vehicle-schema";

export interface HttpSeedManifestV1 {
  readonly schemaVersion: 1;
  readonly sourceId: SourceId;
  readonly territory: Territory;
  readonly origin: string;
  readonly maxBodyBytes: number;
  readonly entries: readonly { readonly sourceListingId: string; readonly url: string }[];
}

export type SeededRunRequest = Omit<ConnectorRunRequest,
  "sourceId" | "territory" | "acquisitionMethod" | "adapterVersion" | "mapperVersion">;
export type AcquisitionPorts = Omit<ConnectorPorts, "adapter">;
export interface SeededAcquisitionResult {
  readonly coverage: "seed_manifest_only";
  readonly requestedPages: number;
  readonly result: ConnectorRunResult;
}

// Internal transport port. Normal exports expose the guarded SDK runner, not a
// raw URL-fetch capability. Tests inject an owned loopback transport here only.
export interface CaptureRequest {
  readonly url: string;
  readonly maxBytes: number;
  readonly signal: AbortSignal;
}
export type CaptureResponse =
  | { readonly success: true; readonly body: Uint8Array; readonly contentType: "text/html"; readonly status: 200 }
  | { readonly success: false; readonly kind: "rate_limited" | "transient" | "terminal"; readonly retryAfterMs?: number };
export interface CaptureTransport { capture(request: CaptureRequest): Promise<CaptureResponse> }

export interface CaptureEnvelopeV1 {
  readonly schemaVersion: 1;
  readonly kind: "autofindex_http_capture";
  readonly manifestSha256: string;
  readonly ordinal: number;
  readonly sourceListingId: string;
  readonly url: string;
  readonly status: 200;
  readonly contentType: "text/html";
  readonly bodyLength: number;
  readonly bodySha256: string;
  readonly bodyBase64: string;
}
