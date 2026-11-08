export type DemoStorageNamespace = "offline" | "prototype";

export interface DemoStorageKeys {
  readonly favorites: string;
  readonly savedSearches: string;
  readonly savedComparisons: string;
}

const KEYS: Readonly<Record<DemoStorageNamespace, DemoStorageKeys>> = Object.freeze({
  offline: Object.freeze({
    favorites: "auto-world.demo.favorites.v1",
    savedSearches: "auto-world.demo.saved-searches.v1",
    savedComparisons: "auto-world.demo.saved-comparisons.v1",
  }),
  prototype: Object.freeze({
    favorites: "auto-world.prototype.favorites.v1",
    savedSearches: "auto-world.prototype.saved-searches.v1",
    savedComparisons: "auto-world.prototype.saved-comparisons.v1",
  }),
});

export function demoStorageKeys(namespace: DemoStorageNamespace = "offline"): DemoStorageKeys {
  if (namespace === "offline" || namespace === "prototype") return KEYS[namespace];
  throw new TypeError("unsupported demo storage namespace");
}
