import { randomBytes } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import {
  parseDemoResult,
  parseDemoSearchQuery,
  parseDemoSearchResponse,
  parseDemoCatalogResponseV2,
  parseDemoSearchQueryV2,
  parseDemoSearchResponseV2,
  type DemoReadPort,
  type DemoReadPortV2,
  type DemoSearchQueryV1,
} from "@auto-world/demo-search-contract";
import { parseListingId, type ValidationResult } from "@auto-world/vehicle-schema";
import { parseStrictJson } from "./strict-json.js";

export const workspaceBoundary = { name: "@auto-world/api", kind: "service", status: "active" } as const;

const REQUEST_ID = /^req_[0-9a-f]{32}$/u;
const SEARCH_ROUTE = "/v1/demo/search";
const DETAIL_ROUTE = "/v1/demo/listings/:listingId";
const SEARCH_ROUTE_V2 = "/v2/demo/search";
const DETAIL_ROUTE_V2 = "/v2/demo/listings/:listingId";
const CATALOG_ROUTE_V2 = "/v2/demo/catalog";
const READ_FAILURES = ["invalid_cursor", "read_unavailable", "cancelled"] as const;
const READ_FAILURES_V2 = ["invalid_query", ...READ_FAILURES] as const;
const CATALOG_FAILURES = ["read_unavailable", "cancelled"] as const;
type ApiErrorCode = "invalid_query" | "invalid_cursor" | "invalid_request" | "not_found" | "method_not_allowed" | "unsupported_content_type" | "request_too_large" | "read_unavailable" | "cancelled";

export interface DemoApiMetric { readonly name: "api_requests_total" | "api_errors_total" | "api_request_duration_ms"; readonly labels: Readonly<Record<string, string>>; readonly value: number }
export interface DemoApiLog { readonly name: "api.request"; readonly requestId: string; readonly route: string; readonly status: number; readonly durationMs: number; readonly code?: ApiErrorCode }
export interface DemoApiSpan { readonly name: "api.search" | "read_port.query"; readonly requestId: string; readonly route: string; readonly status: number; readonly durationMs: number; readonly code?: ApiErrorCode }
export interface DemoApiAlert { readonly name: "api.failure"; readonly route: string; readonly status: number; readonly code: ApiErrorCode }
export interface DemoApiTelemetrySink { metric?(event: DemoApiMetric): void; log?(event: DemoApiLog): void; span?(event: DemoApiSpan): void; alert?(event: DemoApiAlert): void }
export interface LoopbackPolicy { readonly boundPort?: number }
export interface DemoApiOptions { readonly readPort: DemoReadPort; readonly readPortV2?: DemoReadPortV2; readonly clock?: () => Date; readonly requestIds?: () => string; readonly telemetry?: DemoApiTelemetrySink; readonly loopbackPolicy?: LoopbackPolicy }

interface RequestState {
  readonly requestId: string;
  readonly route: string;
  readonly startedAt: number;
  readonly controller: AbortController;
  deadline?: ReturnType<typeof setTimeout>;
  disconnected: boolean;
  recorded: boolean;
  code?: ApiErrorCode;
  status?: number;
}

type PortValidation<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly code: ApiErrorCode };

const ABORTED = Symbol("aborted");

function safe(call: (() => void) | undefined): void { try { call?.(); } catch { /* telemetry is best effort */ } }
function newRequestId(generator: (() => string) | undefined): string {
  try { const value = generator?.(); if (value !== undefined && REQUEST_ID.test(value)) return value; } catch { /* use crypto */ }
  return `req_${randomBytes(16).toString("hex")}`;
}
function rawValues(request: FastifyRequest, name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < request.raw.rawHeaders.length; index += 2) {
    if (request.raw.rawHeaders[index]?.toLowerCase() === name) {
      const value = request.raw.rawHeaders[index + 1];
      if (value !== undefined) values.push(value);
    }
  }
  return values;
}
function routeLabel(request: FastifyRequest): string {
  const route = request.routeOptions.url;
  return route === SEARCH_ROUTE || route === DETAIL_ROUTE || route === SEARCH_ROUTE_V2 || route === DETAIL_ROUTE_V2 || route === CATALOG_ROUTE_V2 ? route : "unknown";
}
function statusFor(code: ApiErrorCode): number {
  if (code === "invalid_query" || code === "invalid_cursor" || code === "invalid_request") return 400;
  if (code === "not_found") return 404;
  if (code === "method_not_allowed") return 405;
  if (code === "cancelled") return 408;
  if (code === "request_too_large") return 413;
  if (code === "unsupported_content_type") return 415;
  return 503;
}
function readFailure(outcome: unknown, allowed: readonly ApiErrorCode[]): ApiErrorCode | undefined {
  if (typeof outcome !== "object" || outcome === null || Array.isArray(outcome)) return undefined;
  const candidate = outcome as { success?: unknown; error?: unknown };
  if (Object.keys(candidate).sort().join() !== "error,success" || candidate.success !== false || typeof candidate.error !== "object" || candidate.error === null || Array.isArray(candidate.error)) return undefined;
  if (Object.keys(candidate.error).join() !== "code") return undefined;
  const code = (candidate.error as { code?: unknown }).code;
  return typeof code === "string" && allowed.includes(code as ApiErrorCode) ? code as ApiErrorCode : undefined;
}
function readData(outcome: unknown): unknown | undefined {
  if (typeof outcome !== "object" || outcome === null || Array.isArray(outcome)) return undefined;
  const candidate = outcome as { success?: unknown; data?: unknown };
  return Object.keys(candidate).sort().join() === "data,success" && candidate.success === true ? candidate.data : undefined;
}

export function createDemoApi(options: DemoApiOptions): FastifyInstance {
  const port = options.loopbackPolicy?.boundPort ?? 3_210;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new RangeError("invalid boundPort");
  const clock = options.clock ?? (() => new Date());
  const states = new WeakMap<FastifyRequest, RequestState>();
  const app = Fastify({ logger: false, trustProxy: false, exposeHeadRoutes: false, bodyLimit: 8_192, requestTimeout: 5_000, connectionTimeout: 5_500, keepAliveTimeout: 5_000, maxRequestsPerSocket: 100, routerOptions: { maxParamLength: 128 }, http: { maxHeaderSize: 8_192 }, genReqId: () => newRequestId(options.requestIds) });
  app.server.maxHeadersCount = 64;
  app.server.headersTimeout = 5_000;
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: 8_192 }, (_request, body, done) => {
    try { done(null, parseStrictJson(typeof body === "string" ? body : body.toString("utf8"))); } catch (error) { done(error as Error); }
  });

  const record = (state: RequestState, status: number, code?: ApiErrorCode): void => {
    if (state.recorded) return;
    state.recorded = true;
    if (state.deadline !== undefined) clearTimeout(state.deadline);
    const durationMs = Math.max(0, clock().getTime() - state.startedAt);
    const sink = options.telemetry;
    safe(sink?.metric === undefined ? undefined : () => sink.metric?.({ name: "api_requests_total", labels: { route: state.route, status: String(status) }, value: 1 }));
    safe(sink?.metric === undefined ? undefined : () => sink.metric?.({ name: "api_request_duration_ms", labels: { route: state.route, status: String(status) }, value: durationMs }));
    if (code !== undefined) safe(sink?.metric === undefined ? undefined : () => sink.metric?.({ name: "api_errors_total", labels: { code }, value: 1 }));
    safe(sink?.log === undefined ? undefined : () => sink.log?.({ name: "api.request", requestId: state.requestId, route: state.route, status, durationMs, ...(code === undefined ? {} : { code }) }));
    if (state.route === SEARCH_ROUTE || state.route === SEARCH_ROUTE_V2) safe(sink?.span === undefined ? undefined : () => sink.span?.({ name: "api.search", requestId: state.requestId, route: state.route, status, durationMs, ...(code === undefined ? {} : { code }) }));
    if (code !== undefined && status >= 500) safe(sink?.alert === undefined ? undefined : () => sink.alert?.({ name: "api.failure", route: state.route, status, code }));
  };
  const writable = (reply: FastifyReply, state: RequestState): boolean => !state.disconnected && !reply.raw.destroyed && !reply.raw.writableEnded;
  const fail = (request: FastifyRequest, reply: FastifyReply, code: ApiErrorCode): FastifyReply | undefined => {
    const state = states.get(request); if (state === undefined) return undefined;
    state.code = code; state.status = statusFor(code);
    if (!writable(reply, state)) { record(state, 499, "cancelled"); return undefined; }
    return reply.code(state.status).send({ schemaVersion: state.route.startsWith("/v2/") ? 2 : 1, requestId: state.requestId, error: { code } });
  };

  app.addHook("onRequest", async (request, reply) => {
    const supplied = rawValues(request, "x-request-id");
    const accepted = supplied.length === 1 && REQUEST_ID.test(supplied[0] ?? "") ? supplied[0] : undefined;
    const state: RequestState = { requestId: accepted ?? newRequestId(options.requestIds), route: routeLabel(request), startedAt: clock().getTime(), controller: new AbortController(), disconnected: false, recorded: false };
    states.set(request, state);
    const disconnect = (): void => { if (!state.recorded && !reply.raw.writableFinished) { state.disconnected = true; state.controller.abort(); record(state, 499, "cancelled"); } };
    const incompleteRequest = (): void => { if (!request.raw.complete) disconnect(); };
    const finish = (): void => record(state, state.status ?? reply.statusCode, state.code);
    request.raw.once("aborted", incompleteRequest); reply.raw.once("close", disconnect);
    reply.raw.once("finish", finish);
    state.deadline = setTimeout(() => {
      if (!state.recorded && !state.disconnected && !reply.sent && !reply.raw.writableEnded) {
        state.controller.abort();
      }
    }, 5_000);
    if (Buffer.byteLength(request.raw.url ?? "", "utf8") > 2_048 || supplied.length > 1 || (supplied.length === 1 && accepted === undefined)) return fail(request, reply, "invalid_request");
    if (request.raw.rawHeaders.some((value, index) => index % 2 === 0 && (value.toLowerCase() === "forwarded" || value.toLowerCase().startsWith("x-forwarded-")))) return fail(request, reply, "invalid_request");
    const hosts = rawValues(request, "host");
    if (hosts.length !== 1 || hosts[0] !== `127.0.0.1:${port}`) return fail(request, reply, "invalid_request");
    const origins = rawValues(request, "origin");
    if (origins.length > 1 || (origins.length === 1 && origins[0] !== `http://127.0.0.1:${port}`)) return fail(request, reply, "invalid_request");
    if (origins.length === 1) { reply.header("access-control-allow-origin", origins[0]); reply.header("vary", "Origin"); }
  });
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("content-type", "application/json; charset=utf-8").header("cache-control", "no-store").header("x-content-type-options", "nosniff");
    const state = states.get(request);
    if (state !== undefined) {
      if (state.deadline !== undefined) clearTimeout(state.deadline);
    }
    return payload;
  });

  const callPort = async <T>(
    request: FastifyRequest,
    reply: FastifyReply,
    operation: (context: { requestId: string; signal: AbortSignal }) => Promise<unknown>,
    parse: (input: unknown, asOf: string) => ValidationResult<T>,
    validate: (data: T) => PortValidation<T>,
    failureCodes: readonly ApiErrorCode[] = READ_FAILURES,
  ): Promise<T | undefined> => {
    const state = states.get(request); if (state === undefined) return undefined;
    const started = clock().getTime();
    const pending = (() => {
      try {
        return Promise.resolve(operation({ requestId: state.requestId, signal: state.controller.signal }))
          .then((outcome): { readonly settled: true; readonly outcome: unknown } => ({ settled: true, outcome }), (): { readonly settled: false } => ({ settled: false }));
      } catch {
        return Promise.resolve({ settled: false } as const);
      }
    })();
    const aborted = new Promise<typeof ABORTED>((resolve) => {
      if (state.controller.signal.aborted) resolve(ABORTED);
      else state.controller.signal.addEventListener("abort", () => resolve(ABORTED), { once: true });
    });
    const settled = await Promise.race([pending, aborted]);
    let validation: PortValidation<T>;
    if (settled === ABORTED) {
      validation = { success: false, code: "cancelled" };
    } else {
      try {
        if (!settled.settled) validation = { success: false, code: "read_unavailable" };
        else {
          const failure = readFailure(settled.outcome, failureCodes);
          if (failure !== undefined) validation = { success: false, code: failure };
          else {
            const data = readData(settled.outcome);
            if (data === undefined) validation = { success: false, code: "read_unavailable" };
            else {
              const parsed = parse(data, clock().toISOString());
              validation = parsed.success ? validate(parsed.data) : { success: false, code: "read_unavailable" };
            }
          }
        }
      } catch {
        validation = { success: false, code: "read_unavailable" };
      }
    }
    const readCode = validation.success ? undefined : validation.code;
    const readStatus = state.disconnected ? 499 : readCode === undefined ? 200 : statusFor(readCode);
    safe(options.telemetry?.span === undefined ? undefined : () => options.telemetry?.span?.({ name: "read_port.query", requestId: state.requestId, route: state.route, status: readStatus, durationMs: Math.max(0, clock().getTime() - started), ...(readCode === undefined ? {} : { code: readCode }) }));
    if (state.disconnected) return undefined;
    if (settled === ABORTED) { fail(request, reply, "cancelled"); return undefined; }
    if (!validation.success) { fail(request, reply, validation.code); return undefined; }
    return validation.data;
  };

  app.post(SEARCH_ROUTE, async (request, reply) => {
    if (request.raw.url?.includes("?")) return fail(request, reply, "invalid_request");
    if (!/^application\/json(?:;\s*charset=utf-8)?$/iu.test(request.headers["content-type"] ?? "")) return fail(request, reply, "unsupported_content_type");
    const query = parseDemoSearchQuery(request.body); if (!query.success) return fail(request, reply, "invalid_query");
    const data = await callPort(request, reply, (context) => options.readPort.search(query.data, context), parseDemoSearchResponse, (candidate) => candidate.results.some((result) => result.availability !== "active") ? { success: false, code: "read_unavailable" } : { success: true, data: candidate }); if (data === undefined) return reply;
    return reply.code(200).send({ schemaVersion: 1, requestId: states.get(request)?.requestId, data });
  });
  app.get<{ Params: { listingId: string } }>(DETAIL_ROUTE, async (request, reply) => {
    if (request.raw.url?.includes("?")) return fail(request, reply, "invalid_request");
    const listing = parseListingId(request.params.listingId); if (!listing.success) return fail(request, reply, "invalid_request");
    const data = await callPort(request, reply, (context) => options.readPort.getListing(listing.data, context), parseDemoSearchResponse, (candidate) => {
      if (candidate.results.length === 0) return { success: false, code: "not_found" };
      if (candidate.results.length !== 1 || candidate.nextCursor !== undefined || (candidate.state === "complete" && candidate.totalCount !== 1) || candidate.results[0]?.listingId !== listing.data || !parseDemoResult(candidate.results[0]).success) return { success: false, code: "read_unavailable" };
      return { success: true, data: candidate };
    }); if (data === undefined) return reply;
    return reply.code(200).send({ schemaVersion: 1, requestId: states.get(request)?.requestId, data });
  });
  app.route({ method: ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"], url: SEARCH_ROUTE, handler: async (request, reply) => fail(request, reply, "method_not_allowed") });
  app.route({ method: ["POST", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"], url: DETAIL_ROUTE, handler: async (request, reply) => fail(request, reply, "method_not_allowed") });
  const readPortV2 = options.readPortV2;
  if (readPortV2 !== undefined) {
    app.get(CATALOG_ROUTE_V2, async (request, reply) => {
      if (request.raw.url?.includes("?")) return fail(request, reply, "invalid_request");
      const data = await callPort(request, reply, (context) => readPortV2.catalog(context), parseDemoCatalogResponseV2,
        (candidate) => ({ success: true, data: candidate }), CATALOG_FAILURES);
      if (data === undefined) return reply;
      return reply.code(200).send({ schemaVersion: 2, requestId: states.get(request)?.requestId, data });
    });
    app.post(SEARCH_ROUTE_V2, async (request, reply) => {
      if (request.raw.url?.includes("?")) return fail(request, reply, "invalid_request");
      if (!/^application\/json(?:;\s*charset=utf-8)?$/iu.test(request.headers["content-type"] ?? "")) return fail(request, reply, "unsupported_content_type");
      const query = parseDemoSearchQueryV2(request.body); if (!query.success) return fail(request, reply, "invalid_query");
      const data = await callPort(request, reply, (context) => readPortV2.search(query.data, context), parseDemoSearchResponseV2,
        (candidate) => candidate.results.some((item) => item.availability !== "active") ? { success: false, code: "read_unavailable" } : { success: true, data: candidate }, READ_FAILURES_V2);
      if (data === undefined) return reply;
      return reply.code(200).send({ schemaVersion: 2, requestId: states.get(request)?.requestId, data });
    });
    app.get<{ Params: { listingId: string } }>(DETAIL_ROUTE_V2, async (request, reply) => {
      if (request.raw.url?.includes("?")) return fail(request, reply, "invalid_request");
      const listing = parseListingId(request.params.listingId); if (!listing.success) return fail(request, reply, "invalid_request");
      const data = await callPort(request, reply, (context) => readPortV2.getListing(listing.data, context), parseDemoSearchResponseV2, (candidate) => {
        if (candidate.results.length === 0) return { success: false, code: "not_found" };
        if (candidate.results.length !== 1 || candidate.nextCursor !== undefined || (candidate.state === "complete" && candidate.totalCount !== 1) || candidate.results[0]?.listingId !== listing.data) return { success: false, code: "read_unavailable" };
        return { success: true, data: candidate };
      }, READ_FAILURES_V2);
      if (data === undefined) return reply;
      return reply.code(200).send({ schemaVersion: 2, requestId: states.get(request)?.requestId, data });
    });
    app.route({ method: ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"], url: SEARCH_ROUTE_V2, handler: async (request, reply) => fail(request, reply, "method_not_allowed") });
    for (const url of [DETAIL_ROUTE_V2, CATALOG_ROUTE_V2]) {
      app.route({ method: ["POST", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"], url, handler: async (request, reply) => fail(request, reply, "method_not_allowed") });
    }
  }
  app.setNotFoundHandler(async (request, reply) => fail(request, reply, "not_found"));
  app.setErrorHandler(async (error, request, reply) => {
    if ((error as { code?: string }).code === "FST_ERR_HANDLER_TIMEOUT") return fail(request, reply, "cancelled");
    const status = (error as { statusCode?: number }).statusCode;
    return fail(request, reply, status === 413 ? "request_too_large" : status === 415 ? "unsupported_content_type" : "invalid_request");
  });
  return app;
}

export type { DemoReadPort, DemoSearchQueryV1 };
