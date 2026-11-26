export const numericFilterLimits = {
  priceMin: [0, Math.floor(Number.MAX_SAFE_INTEGER / 100)],
  priceMax: [0, Math.floor(Number.MAX_SAFE_INTEGER / 100)],
  yearMin: [1886, 9999],
  yearMax: [1886, 9999],
  kmMax: [0, Number.MAX_SAFE_INTEGER],
} as const;
export type NumericFilter = keyof typeof numericFilterLimits;
