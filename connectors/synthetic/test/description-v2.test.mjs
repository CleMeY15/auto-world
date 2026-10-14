import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  createSyntheticDescriptionHarness,
  parseSyntheticDescriptionPageV2,
  SYNTHETIC_DESCRIPTION_CORPUS_MANIFEST,
  SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE,
} from "@auto-world/synthetic-connector/demo";

const values = (map) => [...map.values()];

test("V2 corpus pins exact raw bytes and admits a parsed synthetic taxonomy release", async () => {
  assert.deepEqual(SYNTHETIC_DESCRIPTION_CORPUS_MANIFEST.taxonomyRelease, {
    catalogId: "taxcat_demo_description",
    releaseId: "taxrel_demo_description_1",
    revision: 1,
  });
  assert.equal(SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE.makes.length, 2);
  assert.equal(SYNTHETIC_DESCRIPTION_TAXONOMY_RELEASE.models.length, 4);
  for (const descriptor of Object.values(SYNTHETIC_DESCRIPTION_CORPUS_MANIFEST.files)) {
    const bytes = await readFile(new URL(`../demo/corpus/${descriptor.name}`, import.meta.url));
    assert.equal(bytes.byteLength, descriptor.byteLength, descriptor.name);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), descriptor.sha256, descriptor.name);
    const parsed = parseSyntheticDescriptionPageV2(JSON.parse(bytes));
    assert.equal(parsed.taxonomyRelease.releaseId, "taxrel_demo_description_1");
  }
});

test("V2 parser strips descriptions before the unchanged SDK mapper boundary", async () => {
  const bytes = await readFile(new URL("../demo/corpus/description-baseline.json", import.meta.url));
  const parsed = parseSyntheticDescriptionPageV2(JSON.parse(bytes));
  assert.deepEqual(Object.keys(parsed.sdkDraft), ["items"]);
  assert.equal(parsed.sdkDraft.items.length, 8);
  assert.equal(parsed.descriptions.length, 8);
  assert.equal(parsed.descriptions.filter((item) => item.description === undefined).length, 1);
  for (const item of parsed.sdkDraft.items) {
    assert.deepEqual(Object.keys(item).sort(), ["observations", "outcome", "sourceListingId"]);
    assert.equal(Object.hasOwn(item, "description"), false);
  }
});

test("V2 parser rejects partial, cross-parent, wrong-release and unadmitted attribution values", async () => {
  const bytes = await readFile(new URL("../demo/corpus/description-baseline.json", import.meta.url));
  const authentic = JSON.parse(bytes);
  const cases = [
    (value) => { delete value.items[0].description.firstRegistrationYear; },
    (value) => { value.items[0].description.modelId = "model_boreal_b1_fictif"; },
    (value) => { value.taxonomyRelease.revision = 2; },
    (value) => { value.items[0].description.attribution.fixtureRef = "fixtures/not-admitted"; },
    (value) => { value.items.push(globalThis.structuredClone(value.items[0])); },
  ];
  for (const mutate of cases) {
    const candidate = globalThis.structuredClone(authentic);
    mutate(candidate);
    assert.throws(() => parseSyntheticDescriptionPageV2(candidate), { message: "synthetic_description_shape_invalid" });
  }
});

test("V2 parser rejects hostile arrays without invoking accessors", async () => {
  const bytes = await readFile(new URL("../demo/corpus/description-baseline.json", import.meta.url));
  const authentic = JSON.parse(bytes);
  let getterCalls = 0;
  const accessor = [...authentic.items];
  Object.defineProperty(accessor, "0", {
    enumerable: true,
    get() { getterCalls += 1; return authentic.items[0]; },
  });
  const customPrototype = [...authentic.items];
  Object.setPrototypeOf(customPrototype, Object.create(Array.prototype));
  const sparse = new Array(2);
  sparse[1] = authentic.items[0];
  const augmented = [...authentic.items];
  augmented.extra = true;
  const symbol = [...authentic.items];
  symbol[Symbol("private")] = true;
  const revoked = Proxy.revocable([...authentic.items], {});
  revoked.revoke();
  for (const items of [accessor, customPrototype, sparse, augmented, symbol, revoked.proxy]) {
    assert.throws(() => parseSyntheticDescriptionPageV2({
      ...authentic,
      items,
    }), { message: "synthetic_description_shape_invalid" });
  }
  assert.equal(getterCalls, 0);
});

test("V2 harness retains raw bytes while canonical SDK records remain V1-only and unresolved", async () => {
  const harness = createSyntheticDescriptionHarness();
  const result = await harness.run("descriptionBaseline", { invocationKey: "description-baseline-test" });
  assert.equal(result.status, "completed", JSON.stringify(result));
  const state = harness.storage.snapshot();
  assert.equal(state.raw.size, 1);
  const raw = values(state.raw)[0];
  const disk = await readFile(new URL("../demo/corpus/description-baseline.json", import.meta.url));
  assert.deepEqual(Buffer.from(raw.bytes), disk);
  assert.equal(raw.pending.sha256, SYNTHETIC_DESCRIPTION_CORPUS_MANIFEST.files.descriptionBaseline.sha256);
  assert.equal(state.listings.size, 8);
  assert.equal(state.versions.size, 8);
  for (const listing of state.listings.values()) assert.deepEqual(listing.identity, { status: "unresolved" });
  for (const observation of state.observations.values()) assert.ok(["price", "mileage"].includes(observation.field));
  const serialized = JSON.stringify([values(state.listings), values(state.versions), values(state.observations)]);
  for (const forbidden of ["make_", "model_", "firstRegistrationYear", "taxonomyRelease"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("V2 incremental update retains contradictory authored raw history without canonical identity", async () => {
  const harness = createSyntheticDescriptionHarness();
  assert.equal((await harness.run("descriptionBaseline", { invocationKey: "description-history-base" })).status, "completed");
  const delta = await harness.run("descriptionDelta", { mode: "incremental", invocationKey: "description-history-delta" });
  assert.equal(delta.status, "completed", JSON.stringify(delta));
  const state = harness.storage.snapshot();
  const versions = values(state.versions).filter((item) => item.sourceListingId === "publication-description-history");
  assert.equal(versions.length, 2);
  assert.equal(new Set(versions.map((item) => item.raw.sha256)).size, 2);
  assert.equal(values(state.listings).every((item) => item.identity.status === "unresolved"), true);
});
