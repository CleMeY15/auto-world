import type { DemoEvidence, DemoPriceValue, DemoResultV2 } from "@auto-world/demo-search-contract";

export type ObservationField = "price" | "mileage";

export interface ObservationHistory {
  readonly selected: DemoEvidence | undefined;
  readonly other: readonly DemoEvidence[];
  readonly multipleRepresentations: boolean;
  readonly sameInstant: boolean;
}

export function formatObservedPrice(
  value: DemoPriceValue,
  currencyDisplay: "symbol" | "code" = "symbol",
): string {
  const resolved = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: value.currency,
    currencyDisplay,
  }).resolvedOptions();
  const digits = resolved.maximumFractionDigits ?? 2;
  const scale = 10n ** BigInt(digits);
  const exact = BigInt(value.amountMinor);
  const whole = exact / scale;
  const fraction = (exact % scale).toString().padStart(digits, "0");
  const formatter = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: value.currency,
    currencyDisplay,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

  return formatter.formatToParts(whole).map((part) => (
    part.type === "fraction" ? fraction : part.value
  )).join("");
}

export function formatExactNumber(value: number): string {
  const formatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 20 });
  const parts = formatter.formatToParts(value);
  const normalized = parts.map((part) => {
    if (part.type === "group") return "";
    if (part.type === "decimal") return ".";
    if (part.type === "minusSign") return "-";
    return part.type === "integer" || part.type === "fraction" ? part.value : "";
  }).join("");

  return Number(normalized) === value
    ? parts.map((part) => part.value).join("")
    : String(value);
}

export function formatObservationConfidence(confidenceBps: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(confidenceBps / 10_000);
}

export function formatObservationTimestamp(observedAt: string): string {
  const date = new Date(observedAt);
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    ...(date.getUTCMilliseconds() === 0 ? {} : { fractionalSecondDigits: 3 as const }),
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

export function observationHistory(
  result: DemoResultV2,
  field: ObservationField,
): ObservationHistory {
  const observations = result.evidence.filter((evidence) => evidence.field === field);
  const selectedId = result[field].status === "unavailable" ? undefined : result[field].evidenceId;
  const selected = selectedId === undefined
    ? undefined
    : observations.find((evidence) => evidence.evidenceId === selectedId);
  const other = Object.freeze(observations
    .filter((evidence) => evidence.evidenceId !== selectedId)
    .reverse());
  const representations = new Set(observations.map((evidence) => (
    evidence.field === "price" ? evidence.value.currency : evidence.value.unit
  )));
  const instants = new Set<string>();
  let sameInstant = false;
  for (const observation of observations) {
    if (instants.has(observation.observedAt)) sameInstant = true;
    instants.add(observation.observedAt);
  }

  return Object.freeze({
    selected,
    other,
    multipleRepresentations: representations.size > 1,
    sameInstant,
  });
}
