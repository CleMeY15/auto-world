import assert from "node:assert/strict";
import test from "node:test";

import {
  parseMakeId,
  parseTaxonomyRelease,
  workspaceBoundary,
} from "@auto-world/vehicle-taxonomy";

test("exposes the built package root without a private subpath import", () => {
  assert.deepEqual(workspaceBoundary, {
    name: "@auto-world/vehicle-taxonomy",
    kind: "package",
    status: "active",
  });
  assert.equal(parseMakeId("make_consumer").success, true);
  assert.equal(parseTaxonomyRelease({}).success, false);
});
