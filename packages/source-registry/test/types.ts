import { parseSourceId } from "@auto-world/vehicle-schema";
import type { ListingId, SourceId } from "@auto-world/vehicle-schema";
import type {
  PolicyEligibility,
  SourceGrant,
  SourceRegistry,
  SourceRevision,
} from "../src/index.js";

declare const sourceId: SourceId;
declare const listingId: ListingId;
declare const registry: SourceRegistry;
declare const decision: PolicyEligibility;
declare const revision: SourceRevision;
declare const grant: SourceGrant;

const sharedSourceId: SourceId = registry.sourceId;
const parsedSourceId = parseSourceId("src_synthetic_consumer");
if (parsedSourceId.success) {
  const parsedPublicSourceId: SourceId = parsedSourceId.data;
  void parsedPublicSourceId;
}

// @ts-expect-error registry history is readonly
registry.revisions.push(revision);

// @ts-expect-error nested grants are readonly
grant.fields.push("price");

if (decision.eligible) {
  // @ts-expect-error eligibility policy is readonly
  decision.policy.retention.rawSeconds = 0;
  // @ts-expect-error eligibility is not an operational allow capability
  void decision.allowed;
}

// @ts-expect-error arbitrary strings are not branded source IDs
const invalidSourceId: SourceId = "src_unbranded";

// @ts-expect-error vehicle-schema ID brands cannot cross domains
const crossedSourceId: SourceId = listingId;

void sourceId;
void sharedSourceId;
void invalidSourceId;
void crossedSourceId;
