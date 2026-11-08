import assert from "node:assert/strict";
import test from "node:test";
import { createWebSeedAdapter, createWebDeltaAdapter, projectWebDescriptions, WEB_DESCRIPTORS, WEB_CATALOG,
  WEB_FIXTURE_VERSION, WEB_PROJECTION } from "./profile.mjs";
import { inspectSyntheticDescriptionRaw } from "../../connectors/synthetic/demo/index.mjs";
import { parseAdapterFetchResult } from "../../connectors/_sdk/dist/index.js";

const signal = new globalThis.AbortController().signal;
const input = (pageOrdinal = 0) => ({ pageOrdinal, signal, maxResponseBytes: 64 * 1024 });
const base = { listingId: "lst_prototype-test", availability: "active", price: { status: "unavailable" },
  mileage: { status: "unavailable" }, evidence: [] };

async function version(adapter, sourceListingId = "publication-prototype-web-0001", overrides = {}) {
  const { page } = await adapter.fetchPage(input());
  const descriptor = WEB_DESCRIPTORS.find((item) => page.pageIdentity === `${WEB_FIXTURE_VERSION}:${item.name}`);
  return { listingId: base.listingId, sourceListingId, listingVersionId: "lv_test-first", runId: "run_test-first",
    snapshotId: "raw_test-first", rawSha256: descriptor.sha256, capturedAt: "2026-11-08T12:00:00.000Z",
    pageOrdinal: 0, rawBytes: page.bytes, latest: true, ...overrides };
}

test("seed produces exactly1000 deterministic raw-backed publications through the existing parser", async () => {
  const adapter = createWebSeedAdapter();
  const ids = new Set();
  let missing = 0;
  for (let ordinal = 0; ordinal < 20; ordinal += 1) {
    const first = await adapter.fetchPage(input(ordinal));
    const repeated = await createWebSeedAdapter().fetchPage(input(ordinal));
    assert.deepEqual(first, repeated);
    assert.equal(parseAdapterFetchResult(first).success, true);
    assert.equal(first.page.complete, ordinal === 19);
    const descriptor = WEB_DESCRIPTORS[ordinal];
    assert.ok(descriptor.byteLength < 64 * 1024);
    const parsed = inspectSyntheticDescriptionRaw(first.page.bytes, descriptor);
    const mapped = await adapter.mapPage({ decoded: JSON.parse(Buffer.from(first.page.bytes).toString("utf8")), signal });
    assert.deepEqual(mapped, parsed.sdkDraft);
    for (const item of parsed.descriptions) {
      assert.match(item.sourceListingId, /^publication-prototype-web-\d{4}$/u);
      assert.equal(ids.has(item.sourceListingId), false);
      ids.add(item.sourceListingId);
      if (!item.description) missing += 1;
    }
  }
  assert.equal(ids.size, 1000);
  assert.equal(missing, 100);
  assert.equal((await adapter.fetchPage(input(20))).success, false);
  assert.equal(WEB_CATALOG.fixtureVersion, WEB_FIXTURE_VERSION);
  assert.equal(WEB_PROJECTION.descriptors.length, 23);
  for (const name of ["history", "omitted", "withdrawn"]) {
    assert.equal(parseAdapterFetchResult(await createWebDeltaAdapter(name).fetchPage(input())).success, true);
  }
});

test("projection preserves V1 fields and exposes only public authored evidence", async () => {
  const verified = await version(createWebSeedAdapter());
  const [result] = projectWebDescriptions({ versions: [verified] }, [base]);
  const { description, descriptionEvidence, ...v1 } = result;
  assert.deepEqual(v1, base);
  assert.equal(description.status, "authored_synthetic");
  assert.match(description.evidenceId, /^de_[a-f0-9]{64}$/u);
  assert.equal(descriptionEvidence.length, 1);
  assert.equal(descriptionEvidence[0].capturedAt, verified.capturedAt);
  assert.equal(description.value.makeId, "make_aurora_fictive");
  assert.equal(JSON.stringify(result).includes(verified.rawSha256), false);
  assert.equal(JSON.stringify(result).includes(verified.runId), false);
  assert.equal(JSON.stringify(result).includes("rawBytes"), false);
  assert.deepEqual(projectWebDescriptions({ versions: [verified] }, [base]), [result]);
});

test("latest omitted description stays unavailable while repeated/historical evidence survives", async () => {
  const original = await version(createWebSeedAdapter(), undefined, { latest: false });
  const updated = await version(createWebDeltaAdapter("history"), undefined, {
    listingVersionId: "lv_test-updated", runId: "run_test-updated", snapshotId: "raw_test-updated",
    capturedAt: "2026-11-08T12:01:00.000Z", latest: false });
  const omitted = await version(createWebDeltaAdapter("omitted"), undefined, {
    listingVersionId: "lv_test-omitted", runId: "run_test-omitted", snapshotId: "raw_test-omitted",
    capturedAt: "2026-11-08T12:02:00.000Z" });
  const [result] = projectWebDescriptions({ versions: [omitted, original, updated] }, [base]);
  assert.deepEqual(result.description, { status: "unavailable" });
  assert.equal(result.descriptionEvidence.length, 2);
  assert.notEqual(result.descriptionEvidence[0].evidenceId, result.descriptionEvidence[1].evidenceId);
  assert.equal(result.descriptionEvidence[1].value.firstRegistrationYear, 2024);
});

test("projector refuses unknown profile, bad bytes, missing association and ambiguous latest", async () => {
  const verified = await version(createWebSeedAdapter());
  for (const mutation of [{ rawSha256: "0".repeat(64) }, { rawBytes: Buffer.from("changed") },
    { sourceListingId: "publication-absent" }, { latest: false }]) {
    assert.throws(() => projectWebDescriptions({ versions: [{ ...verified, ...mutation }] }, [base]));
  }
  assert.throws(() => projectWebDescriptions({ versions: [verified, verified] }, [base]));
  assert.throws(() => createWebDeltaAdapter("arbitrary"));
});

test("adapter cancellation and response-size limit remain enforced", async () => {
  const adapter = createWebSeedAdapter();
  assert.equal((await adapter.fetchPage({ ...input(), maxResponseBytes: 1 })).success, false);
  const controller = new globalThis.AbortController(); controller.abort();
  assert.equal((await adapter.fetchPage({ ...input(), signal: controller.signal })).failure.kind, "cancelled");
  await assert.rejects(adapter.mapPage({ signal: controller.signal }), /prototype_web_seed_cancelled/u);
});
