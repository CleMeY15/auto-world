const idPattern = /^[1-9][0-9]{0,19}$/u;
export function isListingId(value: unknown): value is string {
  return typeof value === "string" && idPattern.test(value);
}
