import type { ValidationResult } from "@auto-world/vehicle-schema";
import type { ModelId, TaxonomyReleaseV1 } from "@auto-world/vehicle-taxonomy";
import { parseDemoSearchQueryV2 } from "./parsers-v2.js";
import type { DemoSearchQueryV3 } from "./types.js";
import {
  inspectObject,
  issue,
  optional,
  publicResult,
  required,
  valid,
  type InternalResult,
} from "./validation.js";

const queryKeys = [
  "schemaVersion", "sort", "priceMaxMinor", "mileageMaxKm", "makeId", "modelId",
  "firstRegistrationYear", "cursor", "text",
] as const;
const encoder = new TextEncoder();

function withinTextBounds(text: string): boolean {
  return text.length <= 240 && [...text].length <= 120 && encoder.encode(text).length <= 480;
}

function words(text: string): string[] {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
}

function normalizeInternal(input: unknown): InternalResult<string> {
  if (typeof input !== "string") return issue("invalid_type", "$.text");
  if (!withinTextBounds(input) || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(input)) {
    return issue("invalid_value", "$.text");
  }
  const tokens = [...new Set(words(input))].sort();
  const canonical = tokens.join(" ");
  if (
    tokens.length === 0 || tokens.length > 8 ||
    tokens.some((token) => [...token].length > 32) || !withinTextBounds(canonical)
  ) {
    return issue("invalid_value", "$.text");
  }
  return valid(canonical);
}

export function normalizeDemoSearchText(input: unknown): ValidationResult<string> {
  return publicResult(normalizeInternal(input));
}

function parseQueryInternal(input: unknown): InternalResult<DemoSearchQueryV3> {
  // Inspect descriptors before copying any values: accessors must never run.
  const object = inspectObject(input, queryKeys, "$");
  if (!object.ok) return object;
  const version = required(object.value, "schemaVersion", "$");
  if (!version.ok) return version;
  if (typeof version.value !== "number") return issue("invalid_type", "$.schemaVersion");
  if (version.value !== 3) return issue("unsupported_version", "$.schemaVersion");
  const baseInput: Record<string, unknown> = { schemaVersion: 2 };
  for (const key of queryKeys) {
    if (key !== "schemaVersion" && key !== "text" && Object.hasOwn(object.value, key)) {
      baseInput[key] = object.value[key];
    }
  }
  const base = parseDemoSearchQueryV2(baseInput);
  if (!base.success) return { ok: false, issue: base.issues[0]! };
  const text = optional(object.value, "text");
  if (!text.present) return valid(Object.freeze({ ...base.data, schemaVersion: 3 }));
  const normalized = normalizeInternal(text.value);
  if (!normalized.ok) return normalized;
  return valid(Object.freeze({ ...base.data, schemaVersion: 3, text: normalized.value }));
}

export function parseDemoSearchQueryV3(input: unknown): ValidationResult<DemoSearchQueryV3> {
  return publicResult(parseQueryInternal(input));
}

/** Internal resolution on a parsed catalog; empty output is an explicit no-match filter. */
export function resolveDemoSearchModels(
  catalog: TaxonomyReleaseV1,
  text: string,
): readonly ModelId[] {
  const normalized = normalizeInternal(text);
  if (!normalized.ok) throw new TypeError("invalid_keyword_text");
  if (catalog.models.length > 16_384) throw new RangeError("keyword_catalog_limit");
  const wanted = normalized.value.split(" ");
  const makes = new Map(catalog.makes.map((make) => [make.makeId, words(make.primaryName.value)]));
  const matches = new Set<ModelId>();
  for (const model of catalog.models) {
    const makeWords = makes.get(model.makeId);
    if (makeWords === undefined) continue;
    const labels = new Set([...makeWords, ...words(model.primaryName.value)]);
    if (wanted.every((word) => labels.has(word))) matches.add(model.modelId);
  }
  return Object.freeze([...matches].sort());
}
