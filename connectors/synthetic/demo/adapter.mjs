import "./guard.mjs";
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";
import { SYNTHETIC_CORPUS_MANIFEST, SYNTHETIC_SCENARIOS } from "./manifest.mjs";

const allowedCurrencies = new Set(["EUR", "USD", "GBP", "CHF", "JPY", "KRW"]);
const allowedMileageUnits = new Set(["km", "mi"]);

function fixtureError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requireNotAborted(signal) {
  if (signal.aborted) throw fixtureError("synthetic_fixture_cancelled");
}

function exactKeys(value, expected) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) &&
    Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function denseArray(value) {
  return Array.isArray(value) && Object.keys(value).length === value.length;
}

function validObservation(value) {
  if (!exactKeys(value, ["field", "value", "confidenceBps"]) ||
      !Number.isInteger(value.confidenceBps) || value.confidenceBps < 0 || value.confidenceBps > 10000) return false;
  if (value.field === "price") {
    return exactKeys(value.value, ["amountMinor", "currency"]) &&
      Number.isSafeInteger(value.value.amountMinor) && value.value.amountMinor >= 0 &&
      allowedCurrencies.has(value.value.currency);
  }
  if (value.field === "mileage") {
    return exactKeys(value.value, ["amount", "unit"]) && Number.isFinite(value.value.amount) &&
      value.value.amount >= 0 && value.value.amount <= Number.MAX_SAFE_INTEGER &&
      allowedMileageUnits.has(value.value.unit);
  }
  return false;
}

function validItem(value) {
  if (value?.outcome === "active") {
    return exactKeys(value, ["sourceListingId", "outcome", "observations"]) &&
      typeof value.sourceListingId === "string" && /^publication-[a-z0-9-]+$/.test(value.sourceListingId) &&
      denseArray(value.observations) && value.observations.length <= 16 && value.observations.every(validObservation);
  }
  return exactKeys(value, ["sourceListingId", "outcome"]) &&
    typeof value.sourceListingId === "string" && /^publication-[a-z0-9-]+$/.test(value.sourceListingId) &&
    (value.outcome === "withdrawn" || value.outcome === "deleted");
}

function strictMap(decoded) {
  if (!exactKeys(decoded, ["items"]) || !denseArray(decoded.items) ||
      decoded.items.length > 100 || !decoded.items.every(validItem)) {
    throw fixtureError("synthetic_fixture_shape_invalid");
  }
  return globalThis.structuredClone(decoded);
}

export function createCorpusAdapter(scenarioName, trace = []) {
  if (!Object.hasOwn(SYNTHETIC_SCENARIOS, scenarioName)) throw fixtureError("synthetic_fixture_scenario_unknown");
  const scenario = SYNTHETIC_SCENARIOS[scenarioName];
  return {
    async fetchPage(input) {
      trace.push(`fixture.fetch:${scenarioName}:${input.pageOrdinal}:${input.attempt}`);
      requireNotAborted(input.signal);
      const step = scenario[input.pageOrdinal];
      if (!step) return { success: false, failure: { kind: "terminal" } };
      if (step.failure) return { success: false, failure: { kind: step.failure } };
      const descriptor = SYNTHETIC_CORPUS_MANIFEST.files[step.file];
      const url = new URL(`./corpus/${descriptor.name}`, import.meta.url);
      if (descriptor.byteLength > input.maxResponseBytes) {
        return { success: false, failure: { kind: "terminal" } };
      }
      const handle = openSync(url, "r");
      let bytes;
      try {
        const bounded = new Uint8Array(descriptor.byteLength + 1);
        let offset = 0;
        while (offset < bounded.byteLength) {
          requireNotAborted(input.signal);
          const bytesRead = readSync(handle, bounded, offset, bounded.byteLength - offset, offset);
          if (bytesRead === 0) break;
          offset += bytesRead;
        }
        bytes = bounded.subarray(0, offset);
      } finally {
        closeSync(handle);
      }
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (bytes.byteLength !== descriptor.byteLength || sha256 !== descriptor.sha256) {
        throw fixtureError("synthetic_fixture_digest_mismatch");
      }
      return { success: true, page: {
        pageIdentity: `${SYNTHETIC_CORPUS_MANIFEST.fixtureVersion}:${descriptor.name}`,
        bytes,
        nextCursor: step.nextCursor,
        complete: step.complete,
      } };
    },
    async mapPage(input) {
      trace.push(`fixture.map:${scenarioName}`);
      requireNotAborted(input.signal);
      const mapped = strictMap(input.decoded);
      requireNotAborted(input.signal);
      return mapped;
    },
  };
}
