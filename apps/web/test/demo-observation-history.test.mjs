import assert from "node:assert/strict";
import test from "node:test";

import {
  formatExactNumber,
  formatObservationConfidence,
  formatObservationTimestamp,
  formatObservedPrice,
  observationHistory,
} from "../.test-dist/src/demo/observation-history.js";

const NOW = "2026-10-15T08:00:00.000Z";

function priceEvidence(index, overrides = {}) {
  return {
    evidenceId: `ev_price_${index}`,
    field: "price",
    observedAt: new Date(Date.parse(NOW) + index * 1000).toISOString(),
    confidenceBps: 9000,
    value: { amountMinor: 10_000 + index, currency: "EUR" },
    ...overrides,
  };
}

function mileageEvidence(index, overrides = {}) {
  return {
    evidenceId: `ev_mileage_${index}`,
    field: "mileage",
    observedAt: new Date(Date.parse(NOW) + index * 1000).toISOString(),
    confidenceBps: 9000,
    value: { amount: index, unit: "km" },
    ...overrides,
  };
}

function result(evidence = [], overrides = {}) {
  return {
    listingId: "lst_demo_history",
    availability: "active",
    price: { status: "unavailable" },
    mileage: { status: "unavailable" },
    evidence,
    description: { status: "unavailable" },
    descriptionEvidence: [],
    ...overrides,
  };
}

function legacyComparisonPrice(value) {
  const resolved = new Intl.NumberFormat("fr-FR", { style: "currency", currency: value.currency }).resolvedOptions();
  const digits = resolved.maximumFractionDigits ?? 2;
  const scale = 10n ** BigInt(digits);
  const exact = BigInt(value.amountMinor);
  const whole = exact / scale;
  const fraction = (exact % scale).toString().padStart(digits, "0");
  const formatter = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: value.currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return formatter.formatToParts(whole).map((part) => part.type === "fraction" ? fraction : part.value).join("");
}

function legacyComparisonNumber(value) {
  const formatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 20 });
  const parts = formatter.formatToParts(value);
  const normalized = parts.map((part) => {
    if (part.type === "group") return "";
    if (part.type === "decimal") return ".";
    if (part.type === "minusSign") return "-";
    return part.type === "integer" || part.type === "fraction" ? part.value : "";
  }).join("");
  return Number(normalized) === value ? parts.map((part) => part.value).join("") : String(value);
}

test("price formatting is exact for every supported currency and preserves comparison symbol output", () => {
  for (const currency of ["EUR", "USD", "GBP", "CHF", "JPY", "KRW"]) {
    for (const amountMinor of [0, 1, 10_001, Number.MAX_SAFE_INTEGER]) {
      const value = { amountMinor, currency };
      assert.equal(formatObservedPrice(value), legacyComparisonPrice(value));
      assert.match(formatObservedPrice(value, "code"), new RegExp(currency));
    }
  }

  assert.notEqual(
    formatObservedPrice({ amountMinor: Number.MAX_SAFE_INTEGER, currency: "EUR" }),
    new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(Number.MAX_SAFE_INTEGER / 100),
    "the exact formatter must not reintroduce the previous rounded Number division",
  );
});

test("number formatting round-trips exact zero, tiny, subnormal and maximum-safe values", () => {
  for (const value of [0, 1e-7, 10_000.001, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER]) {
    assert.equal(formatExactNumber(value), legacyComparisonNumber(value));
    const normalized = formatExactNumber(value).replaceAll("\u202f", "").replaceAll("\u00a0", "").replace(",", ".");
    assert.equal(Number(normalized), value);
  }
});

test("confidence keeps basis-point distinctions with at most two percentage decimals", () => {
  assert.equal(formatObservationConfidence(0), "0\u00a0%");
  assert.equal(formatObservationConfidence(1), "0,01\u00a0%");
  assert.equal(formatObservationConfidence(9999), "99,99\u00a0%");
  assert.equal(formatObservationConfidence(10_000), "100\u00a0%");
});

test("timestamps are explicitly UTC and keep seconds plus nonzero milliseconds", () => {
  const wholeSecond = formatObservationTimestamp("2026-10-15T08:00:01.000Z");
  const milliseconds = formatObservationTimestamp("2026-10-15T08:00:01.123Z");
  assert.match(wholeSecond, /08:00:01/);
  assert.match(wholeSecond, /UTC/);
  assert.doesNotMatch(wholeSecond, /[.,]000/);
  assert.match(milliseconds, /08:00:01[,.]123/);
  assert.match(milliseconds, /UTC/);
});

test("history selects by exact ID and reverses every other accepted row including timestamp ties", () => {
  const tiedAt = "2026-10-15T08:00:03.000Z";
  const first = priceEvidence(0);
  const selected = priceEvidence(1, { observedAt: tiedAt, value: { amountMinor: 20_001, currency: "EUR" } });
  const tiedFirst = priceEvidence(2, { observedAt: tiedAt, value: { amountMinor: 20_001, currency: "EUR" } });
  const tiedLast = priceEvidence(3, { observedAt: tiedAt, value: { amountMinor: 20_002, currency: "EUR" } });
  const mileage = mileageEvidence(4);
  const input = result([first, selected, tiedFirst, mileage, tiedLast], {
    price: { status: "observed", value: selected.value, evidenceId: selected.evidenceId },
    mileage: { status: "observed", value: mileage.value, evidenceId: mileage.evidenceId },
  });
  const before = globalThis.structuredClone(input);

  const history = observationHistory(input, "price");
  assert.equal(history.selected, selected);
  assert.deepEqual(history.other.map(({ evidenceId }) => evidenceId), [tiedLast.evidenceId, tiedFirst.evidenceId, first.evidenceId]);
  assert.equal(history.sameInstant, true);
  assert.equal(history.multipleRepresentations, false);
  assert.equal(Object.isFrozen(history), true);
  assert.equal(Object.isFrozen(history.other), true);
  assert.deepEqual(input, before);
});

test("history handles empty, unavailable, single and duplicate-value records without inference", () => {
  assert.deepEqual(observationHistory(result(), "price"), {
    selected: undefined,
    other: [],
    multipleRepresentations: false,
    sameInstant: false,
  });

  const duplicateA = mileageEvidence(0, { value: { amount: 0, unit: "km" } });
  const duplicateB = mileageEvidence(1, { value: { amount: 0, unit: "km" } });
  const unavailable = observationHistory(result([duplicateA, duplicateB]), "mileage");
  assert.equal(unavailable.selected, undefined);
  assert.deepEqual(unavailable.other, [duplicateB, duplicateA]);
  assert.equal(unavailable.sameInstant, false);

  const singleInput = result([duplicateA], {
    mileage: { status: "observed", value: duplicateA.value, evidenceId: duplicateA.evidenceId },
  });
  assert.deepEqual(observationHistory(singleInput, "mileage"), {
    selected: duplicateA,
    other: [],
    multipleRepresentations: false,
    sameInstant: false,
  });
});

test("mixed currencies and units are reported only within their requested field", () => {
  const eur = priceEvidence(0);
  const usd = priceEvidence(1, { value: { amountMinor: 100, currency: "USD" } });
  const km = mileageEvidence(2);
  const miles = mileageEvidence(3, { value: { amount: 1, unit: "mi" } });
  const input = result([eur, km, usd, miles], {
    price: { status: "observed", value: usd.value, evidenceId: usd.evidenceId },
    mileage: { status: "observed", value: miles.value, evidenceId: miles.evidenceId },
  });
  assert.equal(observationHistory(input, "price").multipleRepresentations, true);
  assert.equal(observationHistory(input, "mileage").multipleRepresentations, true);
});

test("the existing 256-evidence contract bound is preserved without truncation or mutation", () => {
  const evidence = Array.from({ length: 256 }, (_, index) => priceEvidence(index));
  const selected = evidence[127];
  const input = result(evidence, {
    price: { status: "observed", value: selected.value, evidenceId: selected.evidenceId },
  });
  const before = globalThis.structuredClone(input);
  const history = observationHistory(input, "price");
  assert.equal(history.selected.evidenceId, selected.evidenceId);
  assert.equal(history.other.length, 255);
  assert.equal(history.other[0].evidenceId, evidence[255].evidenceId);
  assert.equal(history.other.at(-1).evidenceId, evidence[0].evidenceId);
  assert.deepEqual(input, before);
});
