import { randomBytes } from "node:crypto";
import { parseDemoHttpOutcome, parsePublicListingId, statusForDemoError, type DemoHttpErrorCode } from "./protocol.ts";

const upstreamOrigin = "http://127.0.0.1:3210";
const requestLimit = 8_192;
const responseLimit = 1_048_576;

export interface DemoProxyTelemetryEvent { readonly route: "search" | "detail"; readonly status: number; readonly durationMs: number; readonly code?: DemoHttpErrorCode }
export type DemoProxyTelemetrySink = (event: DemoProxyTelemetryEvent) => void;
export interface DemoProxyOptions {
  readonly route: "search" | "detail";
  readonly fetchImpl?: typeof fetch;
  readonly clock?: () => Date;
  readonly telemetry?: DemoProxyTelemetrySink;
  readonly isEnabled?: () => boolean;
}

export function formatDemoProxyTelemetry(event: DemoProxyTelemetryEvent): string {
  const record = { name: "web.demo_proxy", route: event.route, status: event.status, durationMs: event.durationMs, ...(event.code === undefined ? {} : { code: event.code }) };
  return JSON.stringify(record);
}

export function writeDemoProxyTelemetry(event: DemoProxyTelemetryEvent): void {
  console.info(formatDemoProxyTelemetry(event));
}

function localRequestId(): string { return `req_${randomBytes(16).toString("hex")}`; }
function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function localError(code: DemoHttpErrorCode): Response {
  return jsonResponse({ schemaVersion: 1, requestId: localRequestId(), error: { code } }, statusForDemoError(code));
}
function validInbound(request: Request): boolean {
  const host = request.headers.get("host");
  if (host === null || !/^127\.0\.0\.1:(?:[1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/u.test(host)) return false;
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== `http://${host}`) return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  return true;
}
async function readBounded(stream: ReadableStream<Uint8Array> | null, limit: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (stream === null) return new Uint8Array();
  const reader = stream.getReader();
  const abort = (): void => { void reader.cancel().catch(() => {}); };
  if (signal?.aborted) { await reader.cancel(); throw new DOMException("aborted", "AbortError"); }
  signal?.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > limit) throw new RangeError("body too large");
      chunks.push(chunk.value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch { /* the bounded failure remains authoritative */ }
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
function decodeUtf8(bytes: Uint8Array): string { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }

export function createDemoProxyHandler(options: DemoProxyOptions): (request: Request, listingId?: string) => Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const clock = options.clock ?? (() => new Date());
  const enabled = options.isEnabled ?? (() => process.env.AUTO_WORLD_DEMO === "1");
  return async (request, listingIdInput) => {
    const startedAt = clock().getTime();
    let recorded = false;
    const finish = (response: Response, code?: DemoHttpErrorCode): Response => {
      if (!recorded) {
        recorded = true;
        try {
          const elapsed = clock().getTime() - startedAt;
          const durationMs = Number.isFinite(elapsed) ? Math.min(60_000, Math.max(0, Math.round(elapsed))) : 0;
          options.telemetry?.({ route: options.route, status: response.status, durationMs, ...(code === undefined ? {} : { code }) });
        } catch { /* telemetry is best effort */ }
      }
      return response;
    };
    if (!enabled()) return finish(localError("not_found"), "not_found");
    const expectedMethod = options.route === "search" ? "POST" : "GET";
    if (request.method !== expectedMethod) return finish(localError("method_not_allowed"), "method_not_allowed");
    if (!validInbound(request)) return finish(localError("invalid_request"), "invalid_request");
    const incomingUrl = new URL(request.url);
    if (incomingUrl.search !== "") return finish(localError("invalid_request"), "invalid_request");

    let path: string;
    let expectedListingId: ReturnType<typeof parsePublicListingId> = undefined;
    let body: Uint8Array | undefined;
    if (options.route === "search") {
      if (!/^application\/json(?:;\s*charset=utf-8)?$/iu.test(request.headers.get("content-type") ?? "")) return finish(localError("unsupported_content_type"), "unsupported_content_type");
      const declared = request.headers.get("content-length");
      if (declared !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(declared) || Number(declared) > requestLimit)) return finish(localError("request_too_large"), "request_too_large");
      try { body = await readBounded(request.body, requestLimit, request.signal); }
      catch {
        const code: DemoHttpErrorCode = request.signal.aborted ? "cancelled" : "request_too_large";
        return finish(localError(code), code);
      }
      try { decodeUtf8(body); }
      catch { return finish(localError("invalid_request"), "invalid_request"); }
      path = "/v1/demo/search";
    } else {
      expectedListingId = parsePublicListingId(listingIdInput);
      if (expectedListingId === undefined) return finish(localError("invalid_request"), "invalid_request");
      path = `/v1/demo/listings/${encodeURIComponent(expectedListingId)}`;
    }

    const controller = new AbortController();
    let timedOut = false;
    const abort = (): void => controller.abort();
    if (request.signal.aborted) abort();
    else request.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 7_000);
    try {
      const upstream = await fetchImpl(`${upstreamOrigin}${path}`, {
        method: expectedMethod,
        headers: options.route === "search" ? { "content-type": "application/json" } : undefined,
        body: body === undefined ? undefined : Uint8Array.from(body).buffer,
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
      if (controller.signal.aborted) return finish(localError("cancelled"), "cancelled");
      if (!/^application\/json(?:;\s*charset=utf-8)?$/iu.test(upstream.headers.get("content-type") ?? "")) return finish(localError("read_unavailable"), "read_unavailable");
      const declared = upstream.headers.get("content-length");
      if (declared !== null && (!/^(?:0|[1-9][0-9]*)$/u.test(declared) || Number(declared) > responseLimit)) return finish(localError("read_unavailable"), "read_unavailable");
      let source: string;
      try { source = decodeUtf8(await readBounded(upstream.body, responseLimit, controller.signal)); }
      catch {
        const code: DemoHttpErrorCode = controller.signal.aborted ? "cancelled" : "read_unavailable";
        return finish(localError(code), code);
      }
      if (controller.signal.aborted) return finish(localError("cancelled"), "cancelled");
      const parsed = parseDemoHttpOutcome(source, upstream.status, clock().toISOString(), expectedListingId);
      if (parsed === undefined) return finish(localError("read_unavailable"), "read_unavailable");
      if (parsed.ok) return finish(jsonResponse({ schemaVersion: 1, requestId: parsed.requestId, data: parsed.data }, 200));
      return finish(jsonResponse({ schemaVersion: 1, requestId: parsed.requestId, error: { code: parsed.code } }, statusForDemoError(parsed.code)), parsed.code);
    } catch {
      const code: DemoHttpErrorCode = timedOut || request.signal.aborted ? "cancelled" : "read_unavailable";
      return finish(localError(code), code);
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", abort);
    }
  };
}
