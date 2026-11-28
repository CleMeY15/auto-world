import assert from "node:assert/strict";
import { test } from "node:test";
import { favoriteIds, validScope } from "../.test-dist/src/catalogue/favorites.js";

test("private favorites accept only bounded unique reader IDs", () => {
  assert(favoriteIds([]));
  assert(favoriteIds(Array.from({length:12}, (_, i) => String(i + 1))));
  for (const value of [null, {}, [0], ["01"], ["100", "100"], ["9".repeat(21)], [{id:"100"}],
    Array.from({length:13}, (_, i) => String(i + 1))]) assert.equal(favoriteIds(value), false);
});
test("private favorites need a complete gateway scope", () => {
  assert(validScope("ab".repeat(32)));
  for (const value of [null, "", "a".repeat(32), "x".repeat(64)]) assert.equal(validScope(value), false);
});
