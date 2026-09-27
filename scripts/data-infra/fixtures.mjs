import { createHash } from "node:crypto";
import { sqlText } from "./migrations.mjs";

// Entirely fabricated internal evidence. It grants no source access and never runs a connector.
export async function syntheticFixture() {
  const { parseSourceRegistry } = await import("@auto-world/source-registry");
  const { parseListing, parseObservation, parseVehicleEntity } = await import("@auto-world/vehicle-schema");
  const sourceId = "src_infra_synthetic";
  const runId = "run_infra_synthetic";
  const snapshotId = "raw_infra_synthetic";
  const listingId = "lst_infra_synthetic";
  const vehicleId = "veh_infra_synthetic";
  const capturedAt = "2026-09-06T00:00:00.000Z";
  const rawUntil = "2026-09-07T00:00:00.000Z";
  const normalizedUntil = "2026-09-08T00:00:00.000Z";
  const bytes = Buffer.from('{"synthetic":true,"publication":"fixture-001","priceMinor":2400000}\n');
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const versionId = `lv_${createHash("sha256").update("infra synthetic version, not SDK-derived").digest("hex")}`;
  const registry = {
    schemaVersion: 1, sourceId,
    revisions: [{
      revision: 1, state: "disabled",
      configuration: {
        displayName: "Synthetic infrastructure fixture", territories: ["FR"], acquisitionMethods: ["feed"],
        credentials: { kind: "secret_ref", ref: "secret://auto-world/infra-synthetic" }, legalStatus: "dealer_feed",
        policy: {
          authorization: { basisRef: "evidence_infra_synthetic", reviewerRef: "actor_infra_synthetic", reviewedAt: capturedAt, validFrom: capturedAt, validUntil: "2027-01-01T00:00:00.000Z" },
          grants: [{ territory: "FR", acquisitionMethod: "feed", audience: "internal", fields: ["source_listing_id", "price", "mileage"] }],
          caching: { allowed: false, maxAgeSeconds: 0 },
          retention: { rawSeconds: 86400, normalizedSeconds: 172800, mediaSeconds: 0, piiSeconds: 0 },
          media: { mode: "none", attributionRequired: false }, pii: { mode: "none", purposeRef: null },
          takedown: { contactRef: "contact_infra_synthetic", procedureRef: "procedure_infra_synthetic", maxResponseSeconds: 86400 },
        },
        operations: { incremental: true, fullReconcileIntervalSeconds: 86400, deletionMode: "both", deletionPropagationSeconds: 3600, freshnessSeconds: 7200, requestsPerMinute: 120, concurrency: 4, timeoutMs: 10000, maxRetries: 3 },
        healthPolicy: { maxSampleAgeSeconds: 900, maxSuccessAgeSeconds: 1800, maxErrorBps: 100, maxParseErrorBps: 100, maxStaleBps: 500, maxLatencyP95Ms: 2000 },
      },
      event: { eventId: "aud_infra_create", kind: "create", actorRef: "actor_infra_synthetic", at: capturedAt, reasonRef: "reason_infra_bootstrap" },
    }],
  };
  const observations = [2400000, 2450000].map((amountMinor, index) => ({
    schemaVersion: 1, observationId: `obs_infra_price_${index}`, subject: { kind: "listing", listingId },
    field: "price", value: { amountMinor, currency: "EUR" },
    provenance: { sourceId, observedAt: capturedAt, acquisitionMethod: "feed", legalStatus: "dealer_feed", confidenceBps: 9000, raw: { snapshotId, connectorRunId: runId, sha256 } },
  }));
  const listing = { schemaVersion: 1, listingId, sourceId, sourceListingId: "fixture-001", identity: { status: "candidate", vehicleId }, observationIds: observations.map((o) => o.observationId), url: "https://example.invalid/synthetic/fixture-001" };
  const vehicle = { schemaVersion: 1, vehicleId, identityStatus: "candidate", observationIds: [] };
  for (const result of [parseSourceRegistry(registry), parseListing(listing), parseVehicleEntity(vehicle), ...observations.map(parseObservation)]) {
    if (!result.success) throw new Error("infra_synthetic_fixture_invalid");
  }
  const raw = { snapshot_id: snapshotId, run_id: runId, source_id: sourceId, sha256, bucket: "aw-raw", object_key: `v1/raw/${sourceId}/${runId}/${snapshotId}`, byte_length: bytes.length, captured_at: capturedAt, raw_retain_until: rawUntil, normalized_retain_until: normalizedUntil, media_retain_until: null, pii_retain_until: null, cache_retain_until: null, policy_metadata: registry };
  const rows = [
    ["source_reference", { source_id: sourceId }, ["source_id"]],
    ["connector_run_reference", { run_id: runId, source_id: sourceId }, ["run_id"]],
    ["raw_snapshot_reference", raw, ["snapshot_id"]],
    ["vehicle_candidate", { vehicle_id: vehicleId, identity_status: "candidate" }, ["vehicle_id"]],
    ["listing", { listing_id: listingId, source_id: sourceId, source_listing_id: listing.sourceListingId, candidate_vehicle_id: vehicleId }, ["listing_id"]],
    ["listing_version", { version_id: versionId, listing_id: listingId, source_id: sourceId, run_id: runId, snapshot_id: snapshotId, sha256, mapper_version: "infra-fixture-v1", captured_at: capturedAt, url: listing.url, normalized_retain_until: normalizedUntil, media_retain_until: null, pii_retain_until: null, cache_retain_until: null }, ["version_id"]],
    ...observations.map((o) => ["observation", { observation_id: o.observationId, subject_kind: "listing", listing_id: listingId, vehicle_id: null, source_id: sourceId, run_id: runId, snapshot_id: snapshotId, sha256, field: o.field, value_json: o.value, observed_at: capturedAt, method: "feed", legal_status: "dealer_feed", confidence_bps: 9000 }, ["observation_id"]]),
    ...observations.map((o) => ["listing_version_observation", { version_id: versionId, listing_id: listingId, observation_id: o.observationId }, ["version_id", "observation_id"]]),
    ["outbox_event", { operation_key: "commit_infra_synthetic", event_name: "source.listing.seen", source_id: sourceId, run_id: runId, listing_id: listingId, recorded_at: capturedAt, schema_version: 1 }, ["operation_key"]],
    ["outbox_delivery", { operation_key: "commit_infra_synthetic", available_at: capturedAt, delivered_at: null, attempts: 0 }, ["operation_key"]],
  ];
  return { sourceId, runId, snapshotId, listingId, vehicleId, versionId, registry, listing, vehicle, observations, bytes, sha256, raw, rows };
}

const tables = new Set(["source_reference", "connector_run_reference", "raw_snapshot_reference", "vehicle_candidate", "listing", "listing_version", "observation", "listing_version_observation", "outbox_event", "outbox_delivery"]);

export function fixtureTransaction(rows, { injectFailure = false } = {}) {
  const inserts = rows.map(([table, value, primary]) => {
    if (!tables.has(table) || !Array.isArray(primary) || primary.length === 0 || primary.some((key) => !/^[a-z_]+$/u.test(key) || !Object.hasOwn(value, key))) throw new Error("infra_invalid_fixture_table");
    const predicate = primary.map((key) => `stored.${key} = proposed.${key}`).join(" AND ");
    return `DO $fixture$
DECLARE proposed aw_foundation.${table}; prior aw_foundation.${table};
BEGIN
  SELECT * INTO proposed FROM jsonb_populate_record(NULL::aw_foundation.${table}, ${sqlText(JSON.stringify(value))}::jsonb);
  SELECT stored.* INTO prior FROM aw_foundation.${table} stored WHERE ${predicate};
  IF FOUND THEN
    IF to_jsonb(prior) IS DISTINCT FROM to_jsonb(proposed) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'fixture_replay_conflict';
    END IF;
  ELSE
    INSERT INTO aw_foundation.${table} SELECT proposed.*;
  END IF;
END
$fixture$;`;
  });
  return `BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(109624, 2);
${inserts.join("\n")}
${injectFailure ? "SELECT 1 / 0;" : ""}
COMMIT;`;
}
