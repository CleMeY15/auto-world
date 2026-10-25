import type { ListingId } from "@auto-world/vehicle-schema";
import type {
  DemoCatalogResponseV2,
  DemoReadContext,
  DemoReadOutcome,
  DemoReadPort,
  DemoReadPortV2,
  DemoResultV1,
  DemoSearchQueryV1,
  DemoSearchResponseV1,
  DemoSearchQueryV2,
  DemoSearchResponseV2,
} from "../src/index.js";
import type { MakeId, ModelId } from "../src/index.js";

declare const listingId: ListingId;
declare const context: DemoReadContext;
declare const makeId: MakeId;
declare const modelId: ModelId;

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

const queryV2: DemoSearchQueryV2 = {
  schemaVersion: 2,
  sort: "listing_asc",
  makeId,
  modelId,
  firstRegistrationYear: 2024,
};

const catalogV2: DemoCatalogResponseV2 = {
  schemaVersion: 2,
  dataMode: "synthetic",
  fixtureVersion: "synthetic-description-v2",
  taxonomyRelease: {
    schemaVersion: 1,
    catalogId: "taxcat_demo" as DemoCatalogResponseV2["taxonomyRelease"]["catalogId"],
    releaseId: "taxrel_demo" as DemoCatalogResponseV2["taxonomyRelease"]["releaseId"],
    revision: 1,
    releasedAt: "2026-10-14T00:00:00.000Z",
    dataMode: "synthetic",
    attributions: [],
    makes: [],
    models: [],
  },
};

declare const responseV2: DemoSearchResponseV2;
const portV2: DemoReadPortV2 = {
  async catalog(readContext) {
    void readContext;
    return { success: true, data: catalogV2 };
  },
  async search(input, readContext) {
    const acceptedQuery: DemoSearchQueryV2 = input;
    void acceptedQuery;
    void readContext;
    return { success: true, data: responseV2 };
  },
  async getListing(id, readContext) {
    void id;
    void readContext;
    return { success: false, error: { code: "invalid_query" } };
  },
};

void portV2.catalog(context);
void portV2.search(queryV2, context);
// @ts-expect-error V1 ports do not accept V2 queries
void port.search(queryV2, context);
