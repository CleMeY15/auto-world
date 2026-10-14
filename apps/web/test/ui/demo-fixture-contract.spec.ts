import { expect, test } from "@playwright/test";
import { parseDemoCatalogResponseV2, parseDemoSearchResponseV2 } from "@auto-world/demo-search-contract";
import { demoCatalog, descriptionFields, v2Response } from "./demo-v2-fixtures";

test("browser fixtures obey the real V2 contract including historical time bounds", () => {
  expect(parseDemoCatalogResponseV2(demoCatalog).success).toBe(true);
  for (const options of [{}, { unavailable: true }, { contradictory: true }]) {
    const result = { listingId: "lst_browser_fixture", availability: "active", price: { status: "unavailable" }, mileage: { status: "unavailable" }, evidence: [], ...descriptionFields(1, options) };
    const now = new Date().toISOString();
    const parsed = parseDemoSearchResponseV2(v2Response([result], { dataAsOf: now }), now);
    expect(parsed, JSON.stringify(parsed)).toMatchObject({ success: true });
  }
});
