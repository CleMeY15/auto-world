import { parse, type DefaultTreeAdapterMap } from "parse5";
import { decodeJsonPage, type JsonObject, type JsonValue, type ObservationDraft } from "@auto-world/connector-sdk";

export type VehicleExtractionFailure =
  | "invalid_html"
  | "invalid_jsonld"
  | "unsupported_markup"
  | "ambiguous_vehicle"
  | "ambiguous_offer"
  | "invalid_value"
  | "limit_exceeded";

export type VehicleExtractionResult =
  | { readonly success: true; readonly observations: readonly ObservationDraft[] }
  | { readonly success: false; readonly code: VehicleExtractionFailure };

type HtmlNode = DefaultTreeAdapterMap["node"];
type SupportedCurrency = "EUR" | "USD" | "GBP" | "CHF" | "JPY" | "KRW";
type Failure = Extract<VehicleExtractionResult, { readonly success: false }>;

const MAX_BODY_BYTES = 512 * 1024;
const MAX_SCRIPTS = 32;
const MAX_HTML_NODES = 25_000;
const MAX_HTML_DEPTH = 128;
const MAX_JSON_NODES = 8_192;
const JSON_LIMITS = Object.freeze({ maxBytes: MAX_BODY_BYTES, maxDepth: 32, maxMembers: 20_000 });
const SCHEMA_CONTEXTS = new Set(["https://schema.org", "https://schema.org/", "http://schema.org", "http://schema.org/"]);
const MINOR_DIGITS: Readonly<Record<SupportedCurrency, number>> = Object.freeze({
  EUR: 2, USD: 2, GBP: 2, CHF: 2, JPY: 0, KRW: 0,
});

const fail = (code: VehicleExtractionFailure): Failure => Object.freeze({ success: false, code });
const record = (value: JsonValue | undefined): value is JsonObject => value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value);
const isType = (value: JsonValue | undefined, type: string): boolean => {
  const values = Array.isArray(value) ? value : [value];
  return values.some((entry) => entry === type || entry === `https://schema.org/${type}` || entry === `http://schema.org/${type}`);
};

// This is a bounded compact Schema.org profile, not a JSON-LD context processor.
// Local aliases, context reset/objects/arrays and remote vocabularies are refused.
function schemaContext(object: JsonObject, inherited: boolean): boolean | null {
  const context = object["@context"];
  if (context === undefined) return inherited;
  return typeof context === "string" && SCHEMA_CONTEXTS.has(context) ? true : null;
}

function scriptsIn(document: HtmlNode): { readonly success: true; readonly scripts: readonly string[] } | Failure {
  const scripts: string[] = [];
  const stack: { readonly node: HtmlNode; readonly depth: number }[] = [{ node: document, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (++nodes > MAX_HTML_NODES || current.depth > MAX_HTML_DEPTH) return fail("limit_exceeded");
    const node = current.node;
    if ("tagName" in node && node.tagName === "script" && node.namespaceURI === "http://www.w3.org/1999/xhtml") {
      const type = node.attrs.find((attribute) => attribute.name === "type")?.value.trim().toLowerCase();
      if (type === "application/ld+json") {
        if (node.attrs.some((attribute) => attribute.name === "src")) return fail("unsupported_markup");
        const text = node.childNodes.map((child) => child.nodeName === "#text" && "value" in child ? child.value : "").join("");
        scripts.push(text);
        if (scripts.length > MAX_SCRIPTS) return fail("limit_exceeded");
      }
    }
    // Template contents and scripting-disabled noscript fallbacks are deliberately
    // outside this profile; parse5 never executes a script or performs networking.
    if ("childNodes" in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
        stack.push({ node: node.childNodes[index]!, depth: current.depth + 1 });
      }
    }
  }
  return { success: true, scripts };
}

// The strict SDK decoder validates the original JSON first, but its numeric
// values are IEEE-754 numbers. Quote only price/value number tokens for a second
// bounded decode so decimal evidence is not rounded before unit conversion.
// This scanner never interprets markup or accepts JSON rejected by the SDK.
function preserveDecimalTokens(text: string): string {
  const chunks: string[] = [];
  let offset = 0;
  let copied = 0;
  while (offset < text.length) {
    if (text[offset] !== '"') { offset += 1; continue; }
    const start = offset++;
    while (offset < text.length) {
      if (text[offset] === "\\") { offset += 2; continue; }
      if (text[offset++] === '"') break;
    }
    const end = offset;
    while (/\s/u.test(text[offset] ?? "")) offset += 1;
    if (text[offset] !== ":") continue;
    const key: unknown = JSON.parse(text.slice(start, end));
    if (key !== "price" && key !== "value") continue;
    offset += 1;
    while (/\s/u.test(text[offset] ?? "")) offset += 1;
    if (!/[-0-9]/u.test(text[offset] ?? "")) continue;
    const numberStart = offset;
    while (/[-+0-9.eE]/u.test(text[offset] ?? "")) offset += 1;
    chunks.push(text.slice(copied, numberStart), '"', text.slice(numberStart, offset), '"');
    copied = offset;
  }
  if (chunks.length === 0) return text;
  chunks.push(text.slice(copied));
  return chunks.join("");
}

function vehicleIn(scripts: readonly string[]): { readonly success: true; readonly vehicle: JsonObject } | Failure {
  const vehicles: JsonObject[] = [];
  let visited = 0;
  for (const text of scripts) {
    let decoded = decodeJsonPage(new globalThis.TextEncoder().encode(text), JSON_LIMITS);
    if (!decoded.success) {
      const code = decoded.issues[0]?.code;
      return fail(code === "json_too_deep" || code === "json_too_large" || code === "payload_too_large" ? "limit_exceeded" : "invalid_jsonld");
    }
    const preciseText = preserveDecimalTokens(text);
    if (preciseText !== text) {
      // At most two bytes per member are added to an already bounded document.
      decoded = decodeJsonPage(new globalThis.TextEncoder().encode(preciseText), { ...JSON_LIMITS, maxBytes: MAX_BODY_BYTES + 2 * JSON_LIMITS.maxMembers });
      if (!decoded.success) return fail("invalid_jsonld");
    }
    const stack: { readonly value: JsonValue; readonly schema: boolean }[] = [{ value: decoded.data, schema: false }];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (++visited > MAX_JSON_NODES) return fail("limit_exceeded");
      if (Array.isArray(current.value)) {
        for (let index = current.value.length - 1; index >= 0; index -= 1) {
          stack.push({ value: current.value[index]!, schema: current.schema });
        }
        continue;
      }
      if (!record(current.value)) continue;
      const schema = schemaContext(current.value, current.schema);
      if (schema === null) return fail("unsupported_markup");
      if (isType(current.value["@type"], "Car") || isType(current.value["@type"], "Vehicle")) {
        if (!schema) return fail("unsupported_markup");
        vehicles.push(current.value);
        if (vehicles.length > 1) return fail("ambiguous_vehicle");
      }
      const graph = current.value["@graph"];
      if (graph !== undefined) {
        if (!record(graph) && !Array.isArray(graph)) return fail("invalid_jsonld");
        stack.push({ value: graph, schema });
      }
    }
  }
  return vehicles[0] === undefined ? fail("unsupported_markup") : { success: true, vehicle: vehicles[0] };
}

function currencyOf(value: JsonValue | undefined): SupportedCurrency | null {
  return typeof value === "string" && Object.hasOwn(MINOR_DIGITS, value) ? value as SupportedCurrency : null;
}

function exactMinorUnits(value: JsonValue, digits: number): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && (!Number.isFinite(value) || value < 0 || Object.is(value, -0))) return null;
  const text = typeof value === "string" ? value.trim() : String(value);
  if (text.length > 64 || !/^\d+(?:\.\d+)?$/u.test(text)) return null;
  const [whole = "", fraction = ""] = text.split(".");
  if (/[^0]/u.test(fraction.slice(digits))) return null;
  const amount = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.slice(0, digits).padEnd(digits, "0") || "0");
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null;
}

function priceObservation(vehicle: JsonObject): ObservationDraft | Failure | undefined {
  const offers = vehicle.offers;
  if (offers === undefined) return undefined;
  const list = Array.isArray(offers) ? offers : [offers];
  if (list.length > 1) return fail("ambiguous_offer");
  const offer = list[0];
  if (!record(offer)) return fail("invalid_value");
  if (schemaContext(offer, true) !== true) return fail("unsupported_markup");
  if (offer["@type"] !== undefined && !isType(offer["@type"], "Offer")) return fail("unsupported_markup");
  if (isType(offer["@type"], "AggregateOffer") || offer.lowPrice !== undefined || offer.highPrice !== undefined) return fail("unsupported_markup");
  if (offer.price === undefined) {
    // A reference-only Offer would require graph/context resolution, outside V1.
    return offer["@id"] !== undefined ? fail("unsupported_markup") : undefined;
  }
  const currency = currencyOf(offer.priceCurrency);
  if (currency === null) return fail("invalid_value");
  const amountMinor = exactMinorUnits(offer.price, MINOR_DIGITS[currency]);
  if (amountMinor === null) return fail("invalid_value");
  return Object.freeze({ field: "price", value: Object.freeze({ amountMinor, currency }), confidenceBps: 10_000 });
}

function mileageObservation(vehicle: JsonObject): ObservationDraft | Failure | undefined {
  const quantity = vehicle.mileageFromOdometer;
  if (quantity === undefined) return undefined;
  if (!record(quantity)) return fail("invalid_value");
  if (schemaContext(quantity, true) !== true) return fail("unsupported_markup");
  const unit = quantity.unitCode === "KMT" ? "km" : quantity.unitCode === "SMI" ? "mi" : null;
  if (quantity.value === undefined || unit === null) return fail("invalid_value");
  const amount = exactMinorUnits(quantity.value, 0);
  if (amount === null) return fail("invalid_value");
  return Object.freeze({ field: "mileage", value: Object.freeze({ amount, unit }), confidenceBps: 10_000 });
}

function vinObservation(vehicle: JsonObject): ObservationDraft | Failure | undefined {
  const vin = vehicle.vehicleIdentificationNumber;
  if (vin === undefined) return undefined;
  if (typeof vin !== "string" || !/^[A-HJ-NPR-Z0-9]{17}$/u.test(vin)) return fail("invalid_value");
  return Object.freeze({ field: "vin", value: Object.freeze({ status: "full", vin }), confidenceBps: 10_000 });
}

/**
 * Extracts stated values from one bounded compact Schema.org vehicle detail page.
 * confidenceBps describes exact extraction only, never independent verification of
 * seller claims or a resolved vehicle identity. Raw bytes/provenance belong to SDK.
 */
export function extractVehicleJsonLd(body: Uint8Array, fields: readonly string[]): VehicleExtractionResult {
  if (!(body instanceof Uint8Array) || body.byteLength === 0) return fail("invalid_html");
  if (body.byteLength > MAX_BODY_BYTES) return fail("limit_exceeded");
  if (!Array.isArray(fields) || fields.length > 10 || fields.some((field) => typeof field !== "string")) return fail("invalid_value");
  let html: string;
  try { html = new globalThis.TextDecoder("utf-8", { fatal: true }).decode(body); }
  catch { return fail("invalid_html"); }
  let scripts: ReturnType<typeof scriptsIn>;
  try { scripts = scriptsIn(parse(html)); }
  catch { return fail("invalid_html"); }
  if (!scripts.success) return scripts;
  const extracted = vehicleIn(scripts.scripts);
  if (!extracted.success) return extracted;
  const observations: ObservationDraft[] = [];
  const extractors = [
    ["price", priceObservation],
    ["mileage", mileageObservation],
    ["vin", vinObservation],
  ] as const;
  for (const [field, extract] of extractors) {
    if (!fields.includes(field)) continue;
    const observation = extract(extracted.vehicle);
    if (observation === undefined) continue;
    if ("success" in observation) return observation;
    observations.push(observation);
  }
  return Object.freeze({ success: true, observations: Object.freeze(observations) });
}
