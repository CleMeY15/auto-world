export const numericFilterLimits = {
  priceMin: [0, Math.floor(Number.MAX_SAFE_INTEGER / 100)],
  priceMax: [0, Math.floor(Number.MAX_SAFE_INTEGER / 100)],
  yearMin: [1886, 9999],
  yearMax: [1886, 9999],
  kmMin: [0, Number.MAX_SAFE_INTEGER],
  kmMax: [0, Number.MAX_SAFE_INTEGER],
  doors: [1, 9],
  seatsMin: [1, 9],
  seatsMax: [1, 9],
} as const;
export type NumericFilter = keyof typeof numericFilterLimits;

export const optionKeys = ["fuel", "gearbox", "body", "color", "upholstery"] as const;
export type OptionKey = typeof optionKeys[number];
export type FilterOptions = Readonly<Record<OptionKey, readonly string[]>>;
export const flagKeys = ["hasPrice", "hasPhotos", "firstOwner", "inspectionValid", "serviceBook"] as const;
export type FlagKey = typeof flagKeys[number];

export const sortLabels = {
  default: "Ordre du catalogue",
  "price-asc": "Prix croissant",
  "price-desc": "Prix décroissant",
  "km-asc": "Kilométrage croissant",
  "km-desc": "Kilométrage décroissant",
  "year-desc": "Année la plus récente",
  "year-asc": "Année la plus ancienne",
  "observed-desc": "Observées récemment",
  "observed-asc": "Observées en premier",
} as const;
export type CatalogSort = keyof typeof sortLabels;
