import { createHash } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { parseConnectorCheckpoint, type ConnectorCheckpoint, type InventoryHead, type ListingProjection } from "@auto-world/connector-sdk";
import { parseDemoResult, type DemoResultV1 } from "@auto-world/demo-search-contract";
import { parseListing, parseListingId, parseObservation, type Listing, type Observation } from "@auto-world/vehicle-schema";
import { PROFILE, ProjectionRejected, ascii, exactUtc, stable, type PublicSnapshot } from "./model.js";

const MAX_ROWS = 100_000;
const ROW_SENTINEL = MAX_ROWS + 1;

interface InventoryRow extends QueryResultRow { generation_id: string; revision: number | string; head: unknown }
interface RunRow extends QueryResultRow { run_id: string; checkpoint: unknown }
interface EventRow extends QueryResultRow { run_id: string; operation_key: string; kind: string; receipt: unknown }
interface ProjectionRow extends QueryResultRow { listing_id: string; source_listing_id: string; latest_version_id: string | null; state: string; revision: number | string; projection: unknown }
interface VersionRow extends QueryResultRow { run_id: string; listing_version_id: string; listing_id: string; source_listing_id: string; snapshot_id: string; raw_sha256: string; listing: unknown; evidence: unknown }
interface ObservationRow extends QueryResultRow { run_id: string; observation_id: string; listing_id: string; listing_version_id: string; snapshot_id: string; raw_sha256: string; observation: unknown }
interface TombstoneRow extends QueryResultRow { run_id: string; tombstone_id: string; listing_id: string; source_listing_id: string; kind: string; snapshot_id: string | null; raw_sha256: string | null; evidence: unknown }
interface RawRow extends QueryResultRow { run_id: string; snapshot_id: string; sha256: string; pending: unknown }

export interface CanonicalSnapshotInput {
  readonly inventory: InventoryRow;
  readonly runs: readonly RunRow[];
  readonly events: readonly EventRow[];
  readonly projections: readonly ProjectionRow[];
  readonly versions: readonly VersionRow[];
  readonly observations: readonly ObservationRow[];
  readonly tombstones: readonly TombstoneRow[];
  readonly rawPages: readonly RawRow[];
}

type Receipt = {
  readonly mutation: { readonly operationKey: string; readonly kind: string; readonly record: Record<string, unknown> };
  readonly data: Record<string, unknown>;
};

type Recognized = {
  readonly row: EventRow;
  readonly receipt: Receipt;
  readonly record: Record<string, unknown>;
  readonly run: ConnectorCheckpoint;
  readonly checkpoint: ConnectorCheckpoint | null;
  readonly at: number;
  readonly fence: number;
  readonly revision: number;
};

interface SnapshotIndexes {
  readonly versionsByListing: ReadonlyMap<string, readonly VersionRow[]>;
  readonly rawByReference: ReadonlyMap<string, RawRow>;
  readonly observationByVersion: ReadonlyMap<string, ObservationRow>;
  readonly pageCommitByOrdinal: ReadonlyMap<string, { readonly operationKey: string; readonly checkpoint: ConnectorCheckpoint }>;
  readonly tombstonesByListing: ReadonlyMap<string, readonly TombstoneRow[]>;
}

function reject(code: "projection_invalid" | "projection_limit" = "projection_invalid"): never {
  throw new ProjectionRejected(code);
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) reject();
  return value as Record<string, unknown>;
}

function safeInteger(value: unknown): number {
  const number = typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(number) || (number as number) < 0) reject();
  return number as number;
}

function sameScope(value: unknown): boolean {
  const scope = object(value);
  return scope.sourceId === PROFILE.sourceId && scope.scopeId === PROFILE.scopeId &&
    scope.territory === PROFILE.territory && scope.acquisitionMethod === PROFILE.acquisitionMethod;
}

function frame(value: string): Buffer {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xdc00 && code <= 0xdfff) reject();
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || low < 0xdc00 || low > 0xdfff) reject();
      index += 1;
    }
  }
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([Buffer.from(`${bytes.byteLength}:`, "utf8"), bytes, Buffer.from([0])]);
}

function evidenceId(listingId: string, observationId: string): string {
  return `ev_${createHash("sha256").update(Buffer.concat([
    Buffer.from("aw-demo-evidence-v1\0", "utf8"), frame(listingId), frame(observationId),
  ])).digest("hex")}`;
}

function parseReceipt(row: EventRow): Receipt {
  const envelope = object(row.receipt);
  const mutation = object(envelope.mutation);
  const record = object(mutation.record);
  const data = object(envelope.data);
  if (mutation.operationKey !== row.operation_key || mutation.kind !== row.kind ||
      record.operationKey !== row.operation_key || record.kind !== row.kind ||
      record.sourceId !== PROFILE.sourceId || record.runId !== row.run_id ||
      record.outcome !== "success" || record.errorCode !== null || data.operationKey !== row.operation_key) reject();
  return { mutation: { operationKey: row.operation_key, kind: row.kind, record }, data };
}

const rawKey = (runId: string, snapshotId: string): string => `${runId}\0${snapshotId}`;
const observationKey = (runId: string, versionId: string, observationId: string): string => `${runId}\0${versionId}\0${observationId}`;
const pageKey = (runId: string, pageOrdinal: number): string => `${runId}\0${pageOrdinal}`;

function addUnique<T>(target: Map<string, T>, key: string, value: T): void {
  if (target.has(key)) reject();
  target.set(key, value);
}

function addGrouped<T>(target: Map<string, T[]>, key: string, value: T): void {
  const values = target.get(key);
  if (values) values.push(value);
  else target.set(key, [value]);
}

function indexSnapshot(input: CanonicalSnapshotInput, recognized: readonly Recognized[]): SnapshotIndexes {
  const versionsByListing = new Map<string, VersionRow[]>();
  const versionIds = new Map<string, true>();
  for (const row of input.versions) {
    addUnique(versionIds, row.listing_version_id, true);
    addGrouped(versionsByListing, row.listing_id, row);
  }
  const rawByReference = new Map<string, RawRow>();
  for (const row of input.rawPages) addUnique(rawByReference, rawKey(row.run_id, row.snapshot_id), row);
  const observationByVersion = new Map<string, ObservationRow>();
  const observationIds = new Map<string, true>();
  for (const row of input.observations) {
    addUnique(observationIds, `${row.run_id}\0${row.observation_id}`, true);
    addUnique(observationByVersion, observationKey(row.run_id, row.listing_version_id, row.observation_id), row);
  }
  const pageCommitByOrdinal = new Map<string, { operationKey: string; checkpoint: ConnectorCheckpoint }>();
  for (const entry of recognized) {
    if (entry.row.kind !== "page.committed" || entry.checkpoint === null) continue;
    const ordinal = safeInteger(entry.record.pageOrdinal);
    addUnique(pageCommitByOrdinal, pageKey(entry.row.run_id, ordinal), { operationKey: entry.row.operation_key, checkpoint: entry.checkpoint });
  }
  const tombstonesByListing = new Map<string, TombstoneRow[]>();
  const tombstoneIds = new Map<string, true>();
  for (const row of input.tombstones) {
    addUnique(tombstoneIds, `${row.run_id}\0${row.tombstone_id}`, true);
    addGrouped(tombstonesByListing, row.listing_id, row);
  }
  return { versionsByListing, rawByReference, observationByVersion, pageCommitByOrdinal, tombstonesByListing };
}

function publicResult(projection: ListingProjection, runs: ReadonlyMap<string, ConnectorCheckpoint>, indexes: SnapshotIndexes): DemoResultV1 {
  if (projection.sourceId !== PROFILE.sourceId || !sameScope(projection.scope) || !parseListingId(projection.listingId).success ||
      !["active", "withdrawn", "deleted", "missing"].includes(projection.state)) reject();
  const versions = indexes.versionsByListing.get(projection.listingId) ?? [];
  if (projection.latestVersionId !== null && !versions.some((row) => row.listing_version_id === projection.latestVersionId)) reject();
  const observations: Observation[] = [];
  const seen = new Set<string>();
  for (const row of versions) {
    const evidence = object(row.evidence);
    const listingParsed = parseListing(row.listing);
    if (!listingParsed.success) reject();
    const listing: Listing = listingParsed.data;
    const run = runs.get(row.run_id);
    const raw = indexes.rawByReference.get(rawKey(row.run_id, row.snapshot_id));
    if (!run || !sameScope(run.scope) || row.source_listing_id !== projection.sourceListingId ||
        evidence.schemaVersion !== 1 || evidence.listingVersionId !== row.listing_version_id || evidence.listingId !== row.listing_id ||
        evidence.sourceId !== PROFILE.sourceId || evidence.sourceListingId !== row.source_listing_id ||
        evidence.connectorRunId !== row.run_id || object(evidence.raw).connectorRunId !== row.run_id ||
        object(evidence.raw).snapshotId !== row.snapshot_id || object(evidence.raw).sha256 !== row.raw_sha256 ||
        !raw || raw.sha256 !== row.raw_sha256 || typeof evidence.capturedAt !== "string" ||
        exactUtc(evidence.capturedAt) !== exactUtc(object(raw.pending).capturedAt) ||
        listing.listingId !== projection.listingId ||
        listing.sourceId !== PROFILE.sourceId || listing.sourceListingId !== projection.sourceListingId ||
        listing.identity.status !== "unresolved" || stable(listing.observationIds) !== stable(evidence.observationIds)) reject();
    const pending = object(raw.pending);
    if (pending.snapshotId !== row.snapshot_id || pending.sha256 !== row.raw_sha256 || pending.capturedAt !== evidence.capturedAt) reject();
    const committed = indexes.pageCommitByOrdinal.get(pageKey(row.run_id, safeInteger(pending.pageOrdinal)));
    if (!committed || (committed.checkpoint.status === "running" ? committed.checkpoint.lastPageCommitKey :
      committed.checkpoint.completionOperationKey) !== committed.operationKey) reject();
    const ids = Array.isArray(evidence.observationIds) ? evidence.observationIds : reject();
    for (const observationId of ids) {
      if (typeof observationId !== "string") reject();
      const observationRow = indexes.observationByVersion.get(observationKey(row.run_id, row.listing_version_id, observationId));
      if (!observationRow || observationRow.listing_id !== projection.listingId ||
          observationRow.snapshot_id !== row.snapshot_id || observationRow.raw_sha256 !== row.raw_sha256) reject();
      const parsed = parseObservation(observationRow.observation);
      if (!parsed.success) reject();
      const observation = parsed.data;
      if (observation.subject.kind !== "listing" || observation.subject.listingId !== projection.listingId ||
          observation.provenance.sourceId !== PROFILE.sourceId || observation.provenance.acquisitionMethod !== PROFILE.acquisitionMethod ||
          observation.provenance.raw.connectorRunId !== row.run_id || observation.provenance.raw.snapshotId !== row.snapshot_id ||
          observation.provenance.raw.sha256 !== row.raw_sha256 || observation.provenance.observedAt !== evidence.capturedAt ||
          !["price", "mileage"].includes(observation.field)) reject();
      exactUtc(observation.provenance.observedAt);
      if (!seen.has(observationId)) observations.push(observation);
      seen.add(observationId);
    }
  }
  if (projection.state !== "active") {
    const ended = (indexes.tombstonesByListing.get(projection.listingId) ?? []).some((row) => {
      if (row.listing_id !== projection.listingId || row.source_listing_id !== projection.sourceListingId) return false;
      const evidence = object(row.evidence);
      if (evidence.schemaVersion !== 1 || evidence.tombstoneId !== row.tombstone_id || evidence.kind !== row.kind ||
          evidence.listingId !== row.listing_id || evidence.sourceListingId !== row.source_listing_id ||
          evidence.runId !== row.run_id || !sameScope(evidence.scope) || !runs.has(row.run_id)) return false;
      if (row.kind === "inferred_missing") {
        return row.snapshot_id === null && row.raw_sha256 === null && projection.state === "missing" &&
          typeof evidence.completedAt === "string" && Number.isFinite(exactUtc(evidence.completedAt));
      }
      if (row.kind !== "explicit" || row.snapshot_id === null || row.raw_sha256 === null ||
          evidence.outcome !== projection.state || typeof evidence.capturedAt !== "string") return false;
      const raw = object(evidence.raw);
      return raw.connectorRunId === row.run_id && raw.snapshotId === row.snapshot_id && raw.sha256 === row.raw_sha256 &&
        indexes.rawByReference.get(rawKey(row.run_id, row.snapshot_id))?.sha256 === row.raw_sha256 &&
        Number.isFinite(exactUtc(evidence.capturedAt));
    });
    if (!ended) reject();
  }
  if (observations.length > PROFILE.maxEvidence) reject("projection_limit");
  observations.sort((left, right) => exactUtc(left.provenance.observedAt) - exactUtc(right.provenance.observedAt) || ascii(left.observationId, right.observationId));
  const evidence = observations.map((item) => ({ evidenceId: evidenceId(projection.listingId, item.observationId), field: item.field,
    observedAt: item.provenance.observedAt, confidenceBps: item.provenance.confidenceBps, value: structuredClone(item.value) }));
  const latest = (field: "price" | "mileage") => observations.filter((item) => item.field === field).at(-1);
  const price = latest("price");
  const mileage = latest("mileage");
  const candidate = {
    listingId: projection.listingId,
    availability: projection.state,
    price: price?.field === "price" ? { status: "observed" as const, value: structuredClone(price.value), evidenceId: evidenceId(projection.listingId, price.observationId) } : { status: "unavailable" as const },
    mileage: mileage?.field === "mileage" ? { status: "observed" as const, value: structuredClone(mileage.value), evidenceId: evidenceId(projection.listingId, mileage.observationId) } : { status: "unavailable" as const },
    evidence,
  };
  const parsed = parseDemoResult(candidate);
  if (!parsed.success) reject();
  return parsed.data;
}

export function projectCanonicalSnapshot(input: CanonicalSnapshotInput, nowMs: number): PublicSnapshot {
  if (!Number.isSafeInteger(nowMs)) reject();
  for (const rows of [input.runs, input.events, input.versions, input.observations, input.tombstones, input.rawPages]) {
    if (rows.length > MAX_ROWS) reject("projection_limit");
  }
  if (input.projections.length > PROFILE.maxDocuments) reject("projection_limit");
  const inventory = object(input.inventory.head) as unknown as InventoryHead;
  if (input.inventory.generation_id !== inventory.generationId || safeInteger(input.inventory.revision) !== inventory.revision ||
      inventory.schemaVersion !== 1 || !sameScope(inventory.scope) ||
      !(inventory.generationId === "empty" || /^inv_[a-f0-9]{64}$/u.test(inventory.generationId)) ||
      !Array.isArray(inventory.activeSourceListingIds) || inventory.activeSourceListingIds.length > PROFILE.maxDocuments ||
      inventory.activeSourceListingIds.some((value) => typeof value !== "string" || value.length < 1 || value.length > 256) ||
      new Set(inventory.activeSourceListingIds).size !== inventory.activeSourceListingIds.length ||
      (inventory.lastCompletedFullAt !== null && typeof inventory.lastCompletedFullAt !== "string") ||
      (inventory.incrementalCursor !== null && typeof inventory.incrementalCursor !== "string")) reject();
  if (inventory.lastCompletedFullAt !== null) exactUtc(inventory.lastCompletedFullAt);
  const runs = new Map<string, ConnectorCheckpoint>();
  for (const row of input.runs) {
    const parsed = parseConnectorCheckpoint(row.checkpoint);
    if (!parsed.success || parsed.data.runId !== row.run_id || parsed.data.sourceId !== PROFILE.sourceId || !sameScope(parsed.data.scope)) reject();
    addUnique(runs, row.run_id, parsed.data);
  }
  const recognized: Recognized[] = input.events.map((row) => {
    if (!['page.committed', 'full.finalized'].includes(row.kind)) reject();
    const receipt = parseReceipt(row);
    const record = receipt.mutation.record;
    const run = runs.get(row.run_id);
    if (!run) reject();
    const revision = safeInteger(record.checkpointRevision);
    const fence = safeInteger(record.leaseFence);
    const at = exactUtc(record.recordedAt);
    if (fence > run.leaseFence || run.checkpointRevision < revision || !["full", "incremental"].includes(run.request.mode)) reject();
    let checkpoint: ConnectorCheckpoint | null = null;
    if (row.kind === "page.committed") {
      const parsed = parseConnectorCheckpoint(receipt.data.checkpoint);
      if (!parsed.success) reject();
      checkpoint = parsed.data;
      if (checkpoint.runId !== row.run_id || checkpoint.leaseFence !== fence || checkpoint.checkpointRevision !== revision ||
          receipt.data.checkpointRevision !== revision || !sameScope(checkpoint.scope) ||
          typeof receipt.data.complete !== "boolean" || !Number.isSafeInteger(receipt.data.inventoryRevision) ||
          typeof receipt.data.inventoryGenerationId !== "string" ||
          (checkpoint.status === "running" && checkpoint.lastPageCommitKey !== row.operation_key) ||
          (checkpoint.status === "completed" && checkpoint.completionOperationKey !== row.operation_key) ||
          (run.request.mode === "full" && checkpoint.status !== "running") ||
          (run.request.mode === "incremental" && checkpoint.status !== (receipt.data.complete ? "completed" : "running"))) reject();
      if (run.request.mode === "incremental" && receipt.data.complete === true &&
          (run.status !== "completed" || run.completionOperationKey !== row.operation_key ||
           run.finalInventoryGenerationId !== receipt.data.inventoryGenerationId ||
           run.finalInventoryRevision !== receipt.data.inventoryRevision || stable(run) !== stable(checkpoint))) reject();
    } else {
      if (run.status !== "completed" || run.leaseFence !== fence || run.request.mode !== "full" || run.completionOperationKey !== row.operation_key ||
          run.checkpointRevision !== revision || receipt.data.checkpointRevision !== revision ||
          run.finalInventoryGenerationId !== receipt.data.inventoryGenerationId ||
          run.finalInventoryRevision !== receipt.data.inventoryRevision || stable(run.result) !== stable(receipt.data.result)) reject();
    }
    return { row, receipt, record, run, checkpoint, at, fence, revision };
  }).sort((left, right) => left.fence - right.fence || left.revision - right.revision);
  if (recognized.length === 0) reject();
  for (let index = 1; index < recognized.length; index += 1) {
    const previous = recognized[index - 1]!;
    const current = recognized[index]!;
    if ((current.fence === previous.fence && current.revision === previous.revision) || current.at < previous.at) reject();
  }
  const selected = recognized.at(-1)!;
  if (selected.at > nowMs) reject();
  const receiptsByOperation = new Map<string, Recognized>();
  for (const entry of recognized) {
    addUnique(receiptsByOperation, stable([entry.row.run_id, entry.row.operation_key]), entry);
  }
  for (const run of runs.values()) {
    if (run.status !== "completed") continue;
    const terminal = receiptsByOperation.get(stable([run.runId, run.completionOperationKey]));
    const expectedKind = run.request.mode === "full" ? "full.finalized" : "page.committed";
    if (!terminal || terminal.row.kind !== expectedKind || terminal.row.run_id !== run.runId) reject();
  }
  let completeness: "complete" | "partial" = "partial";
  const selectedData = selected.receipt.data;
  if (selected.row.kind === "full.finalized") {
    if (selected.run.status !== "completed" || selected.run.request.mode !== "full" ||
        selected.run.completionOperationKey !== selected.row.operation_key ||
        selected.run.finalInventoryGenerationId !== inventory.generationId || selected.run.finalInventoryRevision !== inventory.revision ||
        selectedData.inventoryGenerationId !== inventory.generationId || selectedData.inventoryRevision !== inventory.revision) reject();
    completeness = "complete";
  } else if (selectedData.complete === true && selected.run.request.mode === "incremental") {
    if (selected.run.status !== "completed" || selected.run.completionOperationKey !== selected.row.operation_key ||
        selected.run.finalInventoryGenerationId !== inventory.generationId || selected.run.finalInventoryRevision !== inventory.revision ||
        selected.run.baselineGenerationId === "empty" || selected.run.baselineGenerationId !== inventory.generationId ||
        selected.checkpoint?.status !== "completed") reject();
    const baseline = recognized.find((entry) => entry.row.kind === "full.finalized" && entry.fence < selected.fence &&
      entry.run.status === "completed" && entry.run.finalInventoryGenerationId === selected.run.baselineGenerationId);
    if (!baseline || baseline.run.status !== "completed" || baseline.run.finalInventoryRevision >= selected.run.finalInventoryRevision ||
        exactUtc(baseline.run.completedAt) > exactUtc(selected.run.startedAt)) reject();
    completeness = "complete";
  }
  const indexes = indexSnapshot(input, recognized);
  const projectionIds = new Map<string, true>();
  const projectionPublications = new Map<string, true>();
  const projections = input.projections.map((row) => {
    addUnique(projectionIds, row.listing_id, true);
    addUnique(projectionPublications, row.source_listing_id, true);
    const projection = object(row.projection) as unknown as ListingProjection;
    if (projection.schemaVersion !== 1 || projection.sourceId !== PROFILE.sourceId || !sameScope(projection.scope) ||
        projection.listingId !== row.listing_id || projection.sourceListingId !== row.source_listing_id ||
        projection.latestVersionId !== row.latest_version_id || projection.state !== row.state ||
        projection.projectionRevision !== safeInteger(row.revision) || typeof projection.updatedAt !== "string") reject();
    exactUtc(projection.updatedAt);
    return projection;
  });
  if (completeness === "complete") {
    const active = new Set(inventory.activeSourceListingIds);
    const projected = projections.filter((projection) => projection.state === "active").map((projection) => projection.sourceListingId);
    if (projected.length !== active.size || projected.some((value) => !active.has(value))) reject();
  }
  const documents = projections.map((projection) => publicResult(projection, runs, indexes))
    .sort((left, right) => ascii(left.listingId, right.listingId));
  const fingerprint = createHash("sha256").update(stable({ fixtureVersion: PROFILE.fixtureVersion,
    generationId: inventory.generationId, revision: inventory.revision,
    receipt: [selected.row.run_id, selected.row.operation_key, selected.record.recordedAt], documents })).digest("hex");
  const snapshot: PublicSnapshot = { schemaVersion: 1, fixtureVersion: PROFILE.fixtureVersion,
    dataAsOf: selected.record.recordedAt as string, completeness, fingerprint, documents };
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > PROFILE.maxSnapshotBytes) reject("projection_limit");
  return Object.freeze(snapshot);
}

async function bounded<T extends QueryResultRow>(client: Pick<PoolClient, "query">, text: string, values: readonly unknown[], limit: number): Promise<readonly T[]> {
  const result = await client.query<T>(text, [...values]);
  if (result.rows.length > limit) reject("projection_limit");
  return result.rows;
}

export async function captureSnapshot(client: Pick<PoolClient, "query">, nowMs: number): Promise<PublicSnapshot> {
  const inventory = await bounded<InventoryRow>(client,
    "SELECT generation_id, revision, head FROM aw_connector.inventories WHERE source_id=$1 AND scope_id=$2 LIMIT 2",
    [PROFILE.sourceId, PROFILE.scopeId], 1);
  if (inventory.length !== 1) reject();
  const runs = await bounded<RunRow>(client,
    `SELECT run_id, checkpoint FROM aw_connector.runs WHERE source_id=$1 AND scope_id=$2 ORDER BY lease_fence, run_id LIMIT ${ROW_SENTINEL}`,
    [PROFILE.sourceId, PROFILE.scopeId], MAX_ROWS);
  const events = await bounded<EventRow>(client,
    `SELECT m.run_id, m.operation_key, m.kind, m.receipt FROM aw_connector.outbox o JOIN aw_connector.mutations m USING (source_id,run_id,operation_key)
     JOIN aw_connector.runs r USING (source_id,run_id) WHERE m.source_id=$1 AND r.scope_id=$2 AND m.kind IN ('page.committed','full.finalized')
     ORDER BY r.lease_fence, m.recorded_at, m.operation_key LIMIT ${ROW_SENTINEL}`,
    [PROFILE.sourceId, PROFILE.scopeId], MAX_ROWS);
  const projections = await bounded<ProjectionRow>(client,
    `SELECT listing_id, source_listing_id, latest_version_id, state, revision, projection FROM aw_connector.projections
     WHERE source_id=$1 AND scope_id=$2 ORDER BY listing_id LIMIT ${PROFILE.maxDocuments + 1}`,
    [PROFILE.sourceId, PROFILE.scopeId], PROFILE.maxDocuments);
  const versions = await bounded<VersionRow>(client,
    `SELECT v.run_id, v.listing_version_id, v.listing_id, v.source_listing_id, v.snapshot_id, v.raw_sha256, v.listing, v.evidence
     FROM aw_connector.listing_versions v JOIN aw_connector.runs r USING (source_id,run_id)
     WHERE v.source_id=$1 AND r.scope_id=$2 ORDER BY v.listing_id, v.listing_version_id LIMIT ${ROW_SENTINEL}`,
    [PROFILE.sourceId, PROFILE.scopeId], MAX_ROWS);
  const observations = await bounded<ObservationRow>(client,
    `SELECT o.run_id, o.observation_id, o.listing_id, o.listing_version_id, o.snapshot_id, o.raw_sha256, o.observation
     FROM aw_connector.observations o JOIN aw_connector.runs r USING (source_id,run_id)
     WHERE o.source_id=$1 AND r.scope_id=$2 ORDER BY o.listing_id, o.observation_id LIMIT ${ROW_SENTINEL}`,
    [PROFILE.sourceId, PROFILE.scopeId], MAX_ROWS);
  const tombstones = await bounded<TombstoneRow>(client,
    `SELECT run_id, tombstone_id, listing_id, source_listing_id, kind, snapshot_id, raw_sha256, evidence FROM aw_connector.tombstones
     WHERE source_id=$1 AND scope_id=$2 ORDER BY listing_id, tombstone_id LIMIT ${ROW_SENTINEL}`,
    [PROFILE.sourceId, PROFILE.scopeId], MAX_ROWS);
  const rawPages = await bounded<RawRow>(client,
    `SELECT p.run_id, p.snapshot_id, p.sha256, p.pending FROM aw_connector.raw_pages p JOIN aw_connector.runs r USING (source_id,run_id)
     WHERE p.source_id=$1 AND r.scope_id=$2 ORDER BY p.run_id, p.snapshot_id LIMIT ${ROW_SENTINEL}`,
    [PROFILE.sourceId, PROFILE.scopeId], MAX_ROWS);
  return projectCanonicalSnapshot({ inventory: inventory[0]!, runs, events, projections, versions, observations, tombstones, rawPages }, nowMs);
}
