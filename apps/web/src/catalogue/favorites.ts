import { isListingId } from "./listing-id.ts";

export const maxFavorites = 12;
export const favoritesPrefix = "autofindex.catalogue.favoris.v1.";
export function validScope(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
export function favoriteIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= maxFavorites
    && value.every(isListingId) && new Set(value).size === value.length;
}

export type FavoriteRow =
  | { status: "available"; label: string; price: string; year: number | null }
  | { status: "missing" | "failed" };
