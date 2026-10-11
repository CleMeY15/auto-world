import type { ListingId } from "@auto-world/vehicle-schema";
import type {
  DemoReadContext,
  DemoReadOutcome,
  DemoReadPort,
  DemoResultV1,
  DemoSearchQueryV1,
  DemoSearchResponseV1,
} from "../src/index.js";

declare const listingId: ListingId;
declare const context: DemoReadContext;

const query: DemoSearchQueryV1 = {
  schemaVersion: 1,
  sort: "listing_asc",
  priceMaxMinor: 0,
  mileageMaxKm: 0.5,
};

const result: DemoResultV1 = {
  listingId,
  availability: "active",
  price: { status: "unavailable" },
  mileage: { status: "unavailable" },
  evidence: [],
};

const response: DemoSearchResponseV1 = {
  schemaVersion: 1,
  dataMode: "synthetic",
  fixtureVersion: "synthetic-search-v1",
  dataAsOf: "2026-09-06T12:00:00.000Z",
  state: "complete",
  results: [result],
  totalCount: 1,
};

const port: DemoReadPort = {
  async search(input, readContext) {
    const acceptedQuery: DemoSearchQueryV1 = input;
    const acceptedContext: DemoReadContext = readContext;
    void acceptedQuery;
    void acceptedContext;
    return { success: true, data: response };
  },
  async getListing(id, readContext) {
    const acceptedId: ListingId = id;
    const acceptedContext: DemoReadContext = readContext;
    void acceptedId;
    void acceptedContext;
    return { success: false, error: { code: "read_unavailable" } };
  },
};

const searchOutcome: Promise<DemoReadOutcome> = port.search(query, context);
const detailOutcome: Promise<DemoReadOutcome> = port.getListing(listingId, context);

// @ts-expect-error queries are readonly
query.sort = "price_desc";
// @ts-expect-error result collections are readonly
response.results.push(result);
// @ts-expect-error complete responses cannot carry a non-complete reason
const invalidComplete: DemoSearchResponseV1 = { ...response, reason: "projection_incomplete" };
// @ts-expect-error partial responses cannot expose a complete count
const invalidPartial: DemoSearchResponseV1 = { ...response, state: "partial", reason: "projection_incomplete", totalCount: 1 };
// @ts-expect-error arbitrary strings are not ListingIds
void port.getListing("lst_unbranded", context);

void searchOutcome;
void detailOutcome;
void invalidComplete;
void invalidPartial;
