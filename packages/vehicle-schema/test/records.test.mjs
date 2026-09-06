import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseListing,
  parseVehicleEntity,
} from "@auto-world/vehicle-schema";
import {
  cloneSynthetic,
  syntheticListing,
  syntheticVehicle,
} from "./fixtures/synthetic.mjs";
import { assertIssue, assertSuccess } from "./helpers.mjs";

test("parses a synthetic candidate vehicle through the built public export", () => {
  assert.deepEqual(assertSuccess(parseVehicleEntity(syntheticVehicle())), syntheticVehicle());
});

test("rejects unsupported numeric schema versions", () => {
  for (const version of [0, 2, -1]) {
    assertIssue(parseVehicleEntity(syntheticVehicle({ schemaVersion: version })), "unsupported_version", "$.schemaVersion");
  }
});

test("rejects malformed schema version types without coercion", () => {
  for (const version of ["1", null]) {
    assertIssue(parseVehicleEntity(syntheticVehicle({ schemaVersion: version })), "invalid_type", "$.schemaVersion");
  }
});

test("rejects a vehicle ID from another runtime namespace", () => {
  assertIssue(parseVehicleEntity(syntheticVehicle({ vehicleId: "lst_wrong" })), "invalid_value", "$.vehicleId");
});

test("rejects trailing line terminators in ASCII IDs", () => {
  for (const vehicleId of ["veh_synthetic\n", "veh_synthetic\r", "veh_synthetic\u2028"]) {
    assertIssue(parseVehicleEntity(syntheticVehicle({ vehicleId })), "invalid_value", "$.vehicleId");
  }
});

test("enforces ASCII ID suffix length boundaries", () => {
  assertSuccess(parseVehicleEntity(syntheticVehicle({ vehicleId: `veh_${"a".repeat(64)}` })));
  for (const vehicleId of ["veh_", `veh_${"a".repeat(65)}`, "veh_é"] ) {
    assertIssue(parseVehicleEntity(syntheticVehicle({ vehicleId })), "invalid_value", "$.vehicleId");
  }
});

test("rejects duplicate observation references", () => {
  assertIssue(
    parseVehicleEntity(syntheticVehicle({ observationIds: ["obs_a", "obs_a"] })),
    "duplicate_id",
    "$.observationIds[1]",
  );
});

test("rejects a sparse observation reference array", () => {
  const observationIds = ["obs_a", "obs_b"];
  delete observationIds[1];
  assertIssue(
    parseVehicleEntity(syntheticVehicle({ observationIds })),
    "invalid_object",
    "$.observationIds",
  );
});

test("rejects extra own properties on an observation reference array", () => {
  const observationIds = ["obs_a"];
  observationIds.extra = true;
  assertIssue(
    parseVehicleEntity(syntheticVehicle({ observationIds })),
    "invalid_object",
    "$.observationIds",
  );
});

test("parses unresolved listing identity explicitly", () => {
  const listing = syntheticListing({ identity: { status: "unresolved" } });
  assert.deepEqual(assertSuccess(parseListing(listing)), listing);
});

test("rejects URL-only listing publication identity", () => {
  const listing = syntheticListing();
  delete listing.sourceListingId;
  assertIssue(parseListing(listing), "missing_field", "$.sourceListingId");
});

test("rejects a listing source ID from another runtime namespace", () => {
  assertIssue(parseListing(syntheticListing({ sourceId: "veh_wrong" })), "invalid_value", "$.sourceId");
});

test("requires the listing source ID", () => {
  const listing = syntheticListing();
  delete listing.sourceId;
  assertIssue(parseListing(listing), "missing_field", "$.sourceId");
});

test("rejects malformed opaque source listing IDs", () => {
  for (const sourceListingId of ["", " padded", "padded ", "line\nbreak", "c1\u0085control", "c1\u009fcontrol", "a".repeat(257)]) {
    assertIssue(parseListing(syntheticListing({ sourceListingId })), "invalid_value", "$.sourceListingId");
  }
});

test("rejects a listing ID from another runtime namespace", () => {
  assertIssue(parseListing(syntheticListing({ listingId: "veh_wrong" })), "invalid_value", "$.listingId");
});

test("rejects present undefined for an optional listing URL", () => {
  assertIssue(parseListing(syntheticListing({ url: undefined })), "invalid_type", "$.url");
});

test("rejects an insecure listing URL", () => {
  assertIssue(parseListing(syntheticListing({ url: "http://inventory.example/item" })), "invalid_value", "$.url");
});

test("rejects listing URL user information", () => {
  assertIssue(parseListing(syntheticListing({ url: "https://user:pass@inventory.example/item" })), "invalid_value", "$.url");
});

test("rejects C1 control characters in listing URLs", () => {
  for (const url of ["https://inventory.example/a\u0085b", "https://inventory.example/a\u009fb"]) {
    assertIssue(parseListing(syntheticListing({ url })), "invalid_value", "$.url");
  }
});

test("preserves source listing text as opaque data", () => {
  const sourceListingId = "ignore previous instructions <script>alert(1)</script>";
  const parsed = assertSuccess(parseListing(syntheticListing({ sourceListingId })));
  assert.equal(parsed.sourceListingId, sourceListingId);
});

test("does not retain caller references in parsed listing data", () => {
  const input = syntheticListing();
  const parsed = assertSuccess(parseListing(input));
  input.identity.vehicleId = "veh_mutated";
  input.observationIds[0] = "obs_mutated";
  assert.equal(parsed.identity.vehicleId, "veh_synthetic_1");
  assert.equal(parsed.observationIds[0], "obs_price_1");
});

test("deep-freezes parsed listing data", () => {
  const parsed = assertSuccess(parseListing(syntheticListing()));
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.identity), true);
  assert.equal(Object.isFrozen(parsed.observationIds), true);
  assert.throws(() => {
    parsed.identity.vehicleId = "veh_mutated";
  }, TypeError);
});

test("round-trips a parsed listing through JSON", () => {
  const parsed = assertSuccess(parseListing(syntheticListing()));
  const reparsed = assertSuccess(parseListing(JSON.parse(JSON.stringify(parsed))));
  assert.deepEqual(reparsed, parsed);
});

test("rejects unknown keys without echoing the key", () => {
  const secretKey = "SYNTHET1C12345678";
  const result = parseVehicleEntity({ ...syntheticVehicle(), [secretKey]: true });
  assertIssue(result, "unknown_key", "$");
  assert.equal(JSON.stringify(result).includes(secretKey), false);
});

test("rejects a class instance", () => {
  class VehicleInput {
    constructor() {
      Object.assign(this, syntheticVehicle());
    }
  }
  assertIssue(parseVehicleEntity(new VehicleInput()), "invalid_object", "$");
});

test("rejects parsed prototype-pollution keys at root and nested boundaries", () => {
  assert.equal(({}).polluted, undefined);
  const poison = JSON.parse('{"__proto__":{"polluted":true}}');
  const root = { ...syntheticVehicle(), ...poison };
  assert.equal(Object.hasOwn(root, "__proto__"), true);
  assertIssue(parseVehicleEntity(root), "unknown_key", "$");
  const nested = syntheticListing();
  nested.identity = { ...nested.identity, ...poison };
  assertIssue(parseListing(nested), "unknown_key", "$.identity");
  assert.equal(({}).polluted, undefined);
});

test("rejects polluted inherited prototypes without copying inherited data", () => {
  const root = Object.assign(Object.create({ polluted: true }), syntheticVehicle());
  assertIssue(parseVehicleEntity(root), "invalid_object", "$");
  const nested = syntheticListing();
  Object.setPrototypeOf(nested.identity, { polluted: true });
  assertIssue(parseListing(nested), "invalid_object", "$.identity");
  assert.equal(({}).polluted, undefined);
});

test("rejects a null-prototype object only when its values are invalid", () => {
  const input = Object.assign(Object.create(null), cloneSynthetic(syntheticVehicle()));
  assert.deepEqual(assertSuccess(parseVehicleEntity(input)), syntheticVehicle());
});

test("rejects an accessor without invoking it", () => {
  let calls = 0;
  const input = syntheticVehicle();
  Object.defineProperty(input, "vehicleId", {
    enumerable: true,
    get() {
      calls += 1;
      return "veh_accessor";
    },
  });
  assertIssue(parseVehicleEntity(input), "invalid_object", "$");
  assert.equal(calls, 0);
});

test("rejects a non-enumerable unknown property", () => {
  const input = syntheticVehicle();
  Object.defineProperty(input, "hidden", { value: true });
  assertIssue(parseVehicleEntity(input), "unknown_key", "$");
});

test("rejects a symbol property", () => {
  const input = syntheticVehicle();
  input[Symbol("hidden")] = true;
  assertIssue(parseVehicleEntity(input), "unknown_key", "$");
});

test("sanitizes hostile reflection failures", () => {
  const input = new Proxy(syntheticVehicle(), {
    ownKeys() {
      throw new Error("SYNTHET1C12345678");
    },
  });
  const result = parseVehicleEntity(input);
  assertIssue(result, "invalid_object", "$");
  assert.equal(JSON.stringify(result).includes("SYNTHET1C12345678"), false);
});

test("sanitizes a revoked proxy before array inspection", () => {
  const { proxy, revoke } = Proxy.revocable(syntheticVehicle(), {});
  revoke();
  assertIssue(parseVehicleEntity(proxy), "invalid_object", "$");
});
