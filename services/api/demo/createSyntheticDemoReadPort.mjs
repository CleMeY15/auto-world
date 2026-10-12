import "./guard.mjs";

import { createHash, randomBytes as systemRandomBytes } from "node:crypto";
import {
  DEMO_FRESHNESS_MS,
  DEMO_PAGE_SIZE,
  parseDemoSearchResponse,
} from "@auto-world/demo-search-contract";
import { parseConnectorCheckpoint } from "@auto-world/connector-sdk";
import { parseListingId } from "@auto-world/vehicle-schema";
import {
  createSyntheticHarness,
  SYNTHETIC_CORPUS_MANIFEST,
} from "@auto-world/synthetic-connector/demo";

const MAX_RESULTS = 10_000;
const MAX_EVIDENCE = 256;
const DEFAULT_CURSOR_CAPACITY = 1_024;
const CURSOR_ATTEMPTS = 4;
const SCOPE = SYNTHETIC_CORPUS_MANIFEST.source;

const failure = (code) => Object.freeze({ success: false, error: Object.freeze({ code }) });
const cancelled = (signal) => signal?.aborted ? failure("cancelled") : null;
const ascii = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sameScope = (scope) => scope?.scopeId === SCOPE.scopeId &&
  scope.sourceId === SCOPE.sourceId && scope.territory === SCOPE.territory &&
  scope.acquisitionMethod === SCOPE.acquisitionMethod;

function exactUtc(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) && new Date(epoch).toISOString() === value ? epoch : null;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value instanceof Map) return stable([...value.entries()].sort(([a], [b]) => ascii(String(a), String(b))));
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function evidenceId(listingId, observationId) {
  const frame = (value) => {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([Buffer.from(`${bytes.byteLength}:`, "ascii"), bytes, Buffer.from([0])]);
  };
  return `ev_${createHash("sha256").update(Buffer.concat([
    Buffer.from("aw-demo-evidence-v1\0", "utf8"), frame(listingId), frame(observationId),
  ])).digest("hex")}`;
}

function projectionFingerprint(snapshot, inventory, selected) {
  const projections = [...snapshot.projections.values()].filter((item) => sameScope(item.scope))
    .map((item) => [item.listingId, item.sourceListingId, item.state, item.latestVersionId,
      item.projectionRevision, item.updatedAt]).sort((a, b) => ascii(a[0], b[0]));
  const listingIds = new Set(projections.map(([listingId]) => listingId));
  const observations = [...snapshot.observations.values()]
    .filter((item) => item?.subject?.kind === "listing" && listingIds.has(item.subject.listingId))
    .map((item) => [item.observationId, item.subject.listingId, item.field, item.value,
      item.provenance?.observedAt, item.provenance?.confidenceBps])
    .sort((a, b) => ascii(a[0], b[0]));
  return createHash("sha256").update(stable({
    fixtureVersion: SYNTHETIC_CORPUS_MANIFEST.fixtureVersion,
    generationId: inventory.generationId,
    revision: inventory.revision,
    receipt: [selected.record.operationKey, selected.record.recordedAt],
    projections,
    observations,
  })).digest("hex");
}

function inspectSnapshot(snapshot, nowMs) {
  if (!snapshot || !(snapshot.inventories instanceof Map) || !(snapshot.runs instanceof Map) ||
      !(snapshot.ledger instanceof Map) || !(snapshot.projections instanceof Map) ||
      !(snapshot.observations instanceof Map) || !(snapshot.versions instanceof Map) ||
      !(snapshot.listings instanceof Map) || !(snapshot.tombstones instanceof Map) ||
      !(snapshot.raw instanceof Map)) throw new Error("snapshot_shape");
  const inventory = snapshot.inventories.get(SCOPE.scopeId);
  if (!inventory || !sameScope(inventory.scope) || !Number.isSafeInteger(inventory.revision) || inventory.revision < 0) {
    throw new Error("inventory_invalid");
  }
  const runs = new Map();
  for (const [runId, candidate] of snapshot.runs) {
    const parsed = parseConnectorCheckpoint(candidate);
    if (!parsed.success || parsed.data.runId !== runId) throw new Error("run_invalid");
    runs.set(runId, parsed.data);
  }
  const recognized = [];
  let previous = -Infinity;
  for (const receipt of snapshot.ledger.values()) {
    if (!receipt || !["page.committed", "full.finalized"].includes(receipt.kind)) continue;
    const { record } = receipt;
    const run = runs.get(record?.runId);
    if (!run) {
      if (record?.sourceId === SCOPE.sourceId) throw new Error("receipt_run_missing");
      continue;
    }
    const pinnedScopeId = run.scope?.scopeId === SCOPE.scopeId;
    if (!sameScope(run.scope)) {
      if (pinnedScopeId) throw new Error("receipt_scope_mismatch");
      continue;
    }
    if (record?.sourceId !== SCOPE.sourceId || run.sourceId !== SCOPE.sourceId) {
      throw new Error("receipt_source_mismatch");
    }
    if (receipt.operationKey !== record.operationKey || receipt.kind !== record.kind || receipt.data?.operationKey !== receipt.operationKey) {
      throw new Error("receipt_mismatch");
    }
    if (record.outcome !== "success" || record.errorCode !== null) throw new Error("receipt_outcome_invalid");
    const at = exactUtc(record.recordedAt);
    if (at === null || at < previous) throw new Error("receipt_time_regression");
    previous = at;
    recognized.push({ receipt, record, run, checkpoint: null, at, index: recognized.length });
  }
  if (recognized.length === 0) throw new Error("receipt_missing");
  for (const entry of recognized) {
    const { receipt, record, run } = entry;
    if (!["full", "incremental"].includes(run.request?.mode)) throw new Error("run_mode_invalid");
    if (receipt.kind === "full.finalized") {
      if (run.status !== "completed" || run.request?.mode !== "full" ||
          run.completionOperationKey !== receipt.operationKey ||
          run.finalInventoryGenerationId !== receipt.data.inventoryGenerationId ||
          run.finalInventoryRevision !== receipt.data.inventoryRevision ||
          run.checkpointRevision !== receipt.data.checkpointRevision ||
          record.checkpointRevision !== receipt.data.checkpointRevision ||
          stable(run.result) !== stable(receipt.data.result)) throw new Error("full_terminal_invalid");
      continue;
    }
    const parsedCheckpoint = parseConnectorCheckpoint(receipt.data?.checkpoint);
    if (!parsedCheckpoint.success) throw new Error("page_checkpoint_invalid");
    const checkpoint = parsedCheckpoint.data;
    entry.checkpoint = checkpoint;
    if (typeof receipt.data?.complete !== "boolean" ||
        checkpoint.runId !== record.runId || checkpoint.sourceId !== SCOPE.sourceId ||
        !sameScope(checkpoint.scope) ||
        (checkpoint.status === "running" && checkpoint.lastPageCommitKey !== receipt.operationKey) ||
        (checkpoint.status === "completed" && checkpoint.completionOperationKey !== receipt.operationKey) ||
        !["running", "completed"].includes(checkpoint.status) ||
        checkpoint.checkpointRevision !== receipt.data.checkpointRevision ||
        record.checkpointRevision !== receipt.data.checkpointRevision ||
        !Number.isSafeInteger(receipt.data.inventoryRevision) ||
        typeof receipt.data.inventoryGenerationId !== "string") throw new Error("page_receipt_invalid");
    if (run.request.mode === "full" && checkpoint.status !== "running") {
      throw new Error("full_page_terminal_invalid");
    }
    if (run.request.mode === "incremental") {
      const expectedCheckpointStatus = receipt.data.complete ? "completed" : "running";
      if (checkpoint.status !== expectedCheckpointStatus) throw new Error("incremental_marker_invalid");
      const terminalSignal = receipt.data.complete || checkpoint.status === "completed" ||
        run.completionOperationKey === receipt.operationKey;
      if (terminalSignal && (receipt.data.complete !== true || run.status !== "completed" ||
          checkpoint.status !== "completed" ||
          run.completionOperationKey !== receipt.operationKey ||
          checkpoint.completionOperationKey !== receipt.operationKey ||
          run.finalInventoryGenerationId !== receipt.data.inventoryGenerationId ||
          checkpoint.finalInventoryGenerationId !== receipt.data.inventoryGenerationId ||
          run.finalInventoryRevision !== receipt.data.inventoryRevision ||
          checkpoint.finalInventoryRevision !== receipt.data.inventoryRevision ||
          run.checkpointRevision !== receipt.data.checkpointRevision ||
          stable(checkpoint) !== stable(run))) {
        throw new Error("incremental_terminal_invalid");
      }
    }
  }
  for (const run of runs.values()) {
    if (run.scope?.scopeId !== SCOPE.scopeId) continue;
    if (!sameScope(run.scope) || run.sourceId !== SCOPE.sourceId ||
        !["full", "incremental"].includes(run.request?.mode)) throw new Error("pinned_run_invalid");
    if (run.status !== "completed") {
      continue;
    }
    const terminal = snapshot.ledger.get(run.completionOperationKey);
    const expectedKind = run.request.mode === "full" ? "full.finalized" : "page.committed";
    if (!terminal || terminal.kind !== expectedKind || terminal.record?.runId !== run.runId ||
        terminal.record.sourceId !== SCOPE.sourceId || terminal.operationKey !== run.completionOperationKey ||
        terminal.data?.operationKey !== run.completionOperationKey ||
        terminal.data.inventoryGenerationId !== run.finalInventoryGenerationId ||
        terminal.data.inventoryRevision !== run.finalInventoryRevision) throw new Error("run_terminal_missing");
    if (run.request.mode === "incremental") {
      const terminalEntry = recognized.find((entry) => entry.receipt === terminal);
      const checkpoint = terminalEntry?.checkpoint;
      if (terminal.data.complete !== true || checkpoint?.status !== "completed" ||
          checkpoint.runId !== run.runId || checkpoint.completionOperationKey !== run.completionOperationKey ||
          checkpoint.finalInventoryGenerationId !== run.finalInventoryGenerationId ||
          checkpoint.finalInventoryRevision !== run.finalInventoryRevision ||
          checkpoint.checkpointRevision !== run.checkpointRevision ||
          stable(checkpoint) !== stable(run)) throw new Error("run_terminal_checkpoint_invalid");
    }
  }
  const selected = recognized.at(-1);
  if (selected.at > nowMs) throw new Error("future_watermark");
  let completeness = "partial";
  if (selected.receipt.kind === "full.finalized") {
    const { run, receipt } = selected;
    if (run.status !== "completed" || run.request?.mode !== "full" ||
        run.completionOperationKey !== receipt.operationKey ||
        run.finalInventoryGenerationId !== inventory.generationId ||
        run.finalInventoryRevision !== inventory.revision ||
        receipt.data.inventoryGenerationId !== inventory.generationId ||
        receipt.data.inventoryRevision !== inventory.revision) throw new Error("full_association_invalid");
    completeness = "complete";
  } else if (selected.receipt.data?.complete === true && selected.run.request?.mode === "incremental") {
    const { run, receipt } = selected;
    if (run.status !== "completed" || run.completionOperationKey !== receipt.operationKey ||
        run.finalInventoryGenerationId !== inventory.generationId || run.finalInventoryRevision !== inventory.revision ||
        receipt.data.inventoryGenerationId !== inventory.generationId ||
        receipt.data.inventoryRevision !== inventory.revision ||
        selected.checkpoint?.status !== "completed" ||
        selected.checkpoint.completionOperationKey !== receipt.operationKey ||
        selected.checkpoint.finalInventoryGenerationId !== inventory.generationId ||
        selected.checkpoint.finalInventoryRevision !== inventory.revision ||
        run.baselineGenerationId === "empty" || run.baselineGenerationId !== inventory.generationId) {
      throw new Error("incremental_association_invalid");
    }
    const baseline = recognized.find((entry) => entry.receipt.kind === "full.finalized" &&
      entry.index < selected.index && entry.run.status === "completed" &&
      entry.run.request?.mode === "full" && entry.run.finalInventoryGenerationId === run.baselineGenerationId);
    if (!baseline || baseline.run.completionOperationKey !== baseline.receipt.operationKey ||
        baseline.receipt.data.inventoryGenerationId !== baseline.run.finalInventoryGenerationId ||
        baseline.receipt.data.inventoryRevision !== baseline.run.finalInventoryRevision ||
        baseline.run.finalInventoryRevision >= run.finalInventoryRevision ||
        exactUtc(baseline.run.completedAt) === null || exactUtc(run.startedAt) === null ||
        Date.parse(baseline.run.completedAt) > Date.parse(run.startedAt)) {
      throw new Error("incremental_baseline_invalid");
    }
    completeness = "complete";
  }
  if (completeness === "complete") {
    const active = new Set(inventory.activeSourceListingIds);
    const projected = [...snapshot.projections.values()].filter((item) => sameScope(item.scope) && item.state === "active")
      .map((item) => item.sourceListingId);
    if (projected.length !== active.size || projected.some((item) => !active.has(item))) {
      throw new Error("inventory_membership_invalid");
    }
  }
  return {
    inventory,
    runs,
    pageCheckpoints: new Map(recognized.filter((entry) => entry.checkpoint !== null)
      .map((entry) => [entry.receipt.operationKey, entry.checkpoint])),
    selected,
    state: nowMs - selected.at > DEMO_FRESHNESS_MS ? "stale" : completeness,
    snapshotIdentity: projectionFingerprint(snapshot, inventory, selected),
  };
}

function publicResult(snapshot, projection, runs, pageCheckpoints) {
  if (projection.sourceId !== SCOPE.sourceId || !parseListingId(projection.listingId).success ||
      typeof projection.sourceListingId !== "string" || !["active", "withdrawn", "deleted", "missing"].includes(projection.state)) {
    throw new Error("projection_invalid");
  }
  const versions = [...snapshot.versions.values()].filter((item) => item.listingId === projection.listingId);
  if (projection.latestVersionId !== null && !versions.some((item) => item.listingVersionId === projection.latestVersionId)) {
    throw new Error("projection_version_missing");
  }
  const observationIds = new Set();
  const observations = [];
  for (const version of versions) {
    const run = runs.get(version.connectorRunId);
    const listing = snapshot.listings.get(version.listingVersionId);
    const raw = snapshot.raw.get(version.raw?.snapshotId);
    const committed = [...snapshot.ledger.values()].find((entry) => entry.kind === "page.committed" &&
      entry.record?.runId === version.connectorRunId && entry.record.pageOrdinal === raw?.pending?.pageOrdinal);
    if (version.sourceId !== SCOPE.sourceId || version.sourceListingId !== projection.sourceListingId ||
        !run || !sameScope(run.scope) || !listing || listing.listingId !== projection.listingId ||
        listing.sourceId !== SCOPE.sourceId || listing.sourceListingId !== projection.sourceListingId ||
        listing.identity?.status !== "unresolved" || !Array.isArray(version.observationIds) ||
        !Array.isArray(listing.observationIds) || stable([...version.observationIds].sort()) !==
          stable([...listing.observationIds].sort()) || version.raw?.connectorRunId !== version.connectorRunId ||
        !raw || raw.pending?.snapshotId !== version.raw.snapshotId || raw.pending.sha256 !== version.raw.sha256 ||
        raw.pending.capturedAt !== version.capturedAt || !committed || committed.record.sourceId !== SCOPE.sourceId ||
        committed.record.outcome !== "success" || !pageCheckpoints.has(committed.operationKey) ||
        ![pageCheckpoints.get(committed.operationKey).lastPageCommitKey,
          pageCheckpoints.get(committed.operationKey).completionOperationKey]
          .includes(committed.operationKey)) {
      throw new Error("version_association_invalid");
    }
    for (const observationId of version.observationIds) {
      const observation = snapshot.observations.get(observationId);
      if (!observation || observation.observationId !== observationId ||
          observation.subject?.kind !== "listing" || observation.subject.listingId !== projection.listingId ||
          observation.provenance?.sourceId !== SCOPE.sourceId ||
          observation.provenance.acquisitionMethod !== SCOPE.acquisitionMethod ||
          observation.provenance.raw?.connectorRunId !== version.connectorRunId ||
          observation.provenance.raw.snapshotId !== version.raw?.snapshotId ||
          observation.provenance.raw.sha256 !== version.raw?.sha256 ||
          observation.provenance.observedAt !== version.capturedAt ||
          exactUtc(observation.provenance.observedAt) === null ||
          !["price", "mileage"].includes(observation.field)) throw new Error("observation_association_invalid");
      if (!observationIds.has(observationId)) observations.push(observation);
      observationIds.add(observationId);
    }
  }
  if (projection.state !== "active") {
    const ended = [...snapshot.tombstones.values()].some((item) => item.listingId === projection.listingId &&
      item.sourceListingId === projection.sourceListingId && sameScope(item.scope) &&
      (item.outcome === projection.state || (projection.state === "missing" && item.kind === "inferred_missing")));
    if (!ended) throw new Error("tombstone_association_missing");
  }
  if (observations.length > MAX_EVIDENCE) throw new Error("evidence_limit");
  observations.sort((left, right) => {
    const time = Date.parse(left.provenance.observedAt) - Date.parse(right.provenance.observedAt);
    return time || ascii(left.observationId, right.observationId);
  });
  const evidence = observations.map((item) => Object.freeze({
    evidenceId: evidenceId(projection.listingId, item.observationId),
    field: item.field,
    observedAt: item.provenance.observedAt,
    confidenceBps: item.provenance.confidenceBps,
    value: globalThis.structuredClone(item.value),
  }));
  const latest = (field) => observations.filter((item) => item.field === field).at(-1);
  const field = (name) => {
    const item = latest(name);
    return item ? Object.freeze({ status: "observed", value: globalThis.structuredClone(item.value),
      evidenceId: evidenceId(projection.listingId, item.observationId) }) : Object.freeze({ status: "unavailable" });
  };
  return Object.freeze({
    listingId: projection.listingId,
    availability: projection.state,
    price: field("price"),
    mileage: field("mileage"),
    evidence: Object.freeze(evidence),
  });
}

function filterAndSort(results, query) {
  const filtered = results.filter((item) =>
    (query.priceMaxMinor === undefined || (item.price.status === "observed" &&
      item.price.value.currency === "EUR" && item.price.value.amountMinor <= query.priceMaxMinor)) &&
    (query.mileageMaxKm === undefined || (item.mileage.status === "observed" &&
      item.mileage.value.unit === "km" && item.mileage.value.amount <= query.mileageMaxKm)));
  const numeric = (item, field) => {
    if (item[field].status !== "observed") return null;
    if (field === "price") return item.price.value.currency === "EUR" ? item.price.value.amountMinor : null;
    return item.mileage.value.unit === "km" ? item.mileage.value.amount : null;
  };
  const compare = (left, right, direction) => {
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return direction * (left - right);
  };
  filtered.sort((left, right) => {
    if (query.sort === "price_asc") return compare(numeric(left, "price"), numeric(right, "price"), 1) || ascii(left.listingId, right.listingId);
    if (query.sort === "price_desc") return compare(numeric(left, "price"), numeric(right, "price"), -1) || ascii(left.listingId, right.listingId);
    if (query.sort === "mileage_asc") return compare(numeric(left, "mileage"), numeric(right, "mileage"), 1) || ascii(left.listingId, right.listingId);
    if (query.sort === "mileage_desc") return compare(numeric(left, "mileage"), numeric(right, "mileage"), -1) || ascii(left.listingId, right.listingId);
    return ascii(left.listingId, right.listingId);
  });
  return filtered;
}

function responseFor(state, dataAsOf, results, totalCount, nextCursor) {
  const base = { schemaVersion: 1, dataMode: "synthetic", fixtureVersion: SYNTHETIC_CORPUS_MANIFEST.fixtureVersion,
    dataAsOf, results, ...(nextCursor ? { nextCursor } : {}) };
  if (state === "complete") return { ...base, state, totalCount };
  if (state === "stale") return { ...base, state, reason: "projection_stale" };
  return { ...base, state: "partial", reason: "projection_incomplete" };
}

export async function createSyntheticDemoReadPort(options = {}) {
  if (process.env.NODE_ENV === "production") throw new Error("demo_api_unavailable_in_production");
  const nowMs = options.nowMs ?? (() => Date.now());
  const randomBytes = options.randomBytes ?? systemRandomBytes;
  const cursorCapacity = options.cursorCapacity ?? DEFAULT_CURSOR_CAPACITY;
  if (!Number.isSafeInteger(cursorCapacity) || cursorCapacity < 1 || cursorCapacity > DEFAULT_CURSOR_CAPACITY) {
    throw new Error("demo_cursor_capacity_invalid");
  }
  let harness = options.harness;
  if (!harness && !options.snapshotProvider) {
    harness = createSyntheticHarness({ initialTime: nowMs() });
    const result = await harness.run("valid");
    if (result.status !== "completed") throw new Error("demo_fixture_unavailable");
  }
  const snapshotProvider = options.snapshotProvider ?? (() => harness.storage.snapshot());
  const cursors = new Map();
  const memo = new Map();
  let identity = null;
  let epoch = 0;

  function tokenFor(binding, position) {
    const key = `${binding}:${position}`;
    const old = memo.get(key);
    if (old) return old;
    if (cursors.size >= cursorCapacity) throw new Error("cursor_capacity");
    for (let attempt = 0; attempt < CURSOR_ATTEMPTS; attempt += 1) {
      const entropy = randomBytes(32);
      if (!(entropy instanceof Uint8Array) || entropy.byteLength !== 32) throw new Error("cursor_entropy");
      const token = `cur_${createHash("sha256").update("aw-demo-cursor-v1\0").update(entropy)
        .update(`\0${epoch}`).digest("hex")}`;
      if (!cursors.has(token)) {
        cursors.set(token, Object.freeze({ binding, position, epoch }));
        memo.set(key, token);
        return token;
      }
    }
    throw new Error("cursor_collision");
  }

  function capture() {
    const at = nowMs();
    if (!Number.isFinite(at)) throw new Error("clock_invalid");
    const snapshot = snapshotProvider();
    const inspection = inspectSnapshot(snapshot, at);
    if (identity !== null && identity !== inspection.snapshotIdentity) {
      cursors.clear(); memo.clear(); epoch += 1;
    }
    identity = inspection.snapshotIdentity;
    const results = [...snapshot.projections.values()].filter((item) => sameScope(item.scope))
      .map((item) => publicResult(snapshot, item, inspection.runs, inspection.pageCheckpoints));
    return { snapshot, inspection, at, results };
  }

  async function search(query, context) {
    if (cancelled(context.signal)) return failure("cancelled");
    try {
      const { inspection, at, results } = capture();
      const active = results.filter((item) => item.availability === "active");
      const matches = filterAndSort(active, query);
      if (matches.length > MAX_RESULTS) throw new Error("result_limit");
      const binding = createHash("sha256").update(stable({ epoch, snapshot: inspection.snapshotIdentity,
        fixtureVersion: SYNTHETIC_CORPUS_MANIFEST.fixtureVersion, sort: query.sort,
        priceMaxMinor: query.priceMaxMinor ?? null, mileageMaxKm: query.mileageMaxKm ?? null })).digest("hex");
      let position = 0;
      if (query.cursor !== undefined) {
        const continuation = cursors.get(query.cursor);
        if (!continuation || continuation.epoch !== epoch || continuation.binding !== binding ||
            !Number.isSafeInteger(continuation.position) || continuation.position < 1 || continuation.position >= matches.length) {
          return failure("invalid_cursor");
        }
        position = continuation.position;
      }
      const page = matches.slice(position, position + DEMO_PAGE_SIZE);
      const nextPosition = position + page.length;
      const nextCursor = nextPosition < matches.length ? tokenFor(binding, nextPosition) : undefined;
      if (cancelled(context.signal)) return failure("cancelled");
      const response = responseFor(inspection.state, inspection.selected.record.recordedAt,
        page, matches.length, nextCursor);
      const parsed = parseDemoSearchResponse(response, new Date(at).toISOString());
      return parsed.success ? Object.freeze({ success: true, data: parsed.data }) : failure("read_unavailable");
    } catch {
      return failure("read_unavailable");
    }
  }

  async function getListing(listingId, context) {
    if (cancelled(context.signal)) return failure("cancelled");
    try {
      if (!parseListingId(listingId).success) return failure("read_unavailable");
      const captured = capture();
      const { inspection, at } = captured;
      const results = captured.results.filter((item) => item.listingId === listingId);
      const response = responseFor(inspection.state, inspection.selected.record.recordedAt,
        results, results.length, undefined);
      const parsed = parseDemoSearchResponse(response, new Date(at).toISOString());
      return parsed.success ? Object.freeze({ success: true, data: parsed.data }) : failure("read_unavailable");
    } catch {
      return failure("read_unavailable");
    }
  }

  return Object.freeze({ search, getListing });
}

export const DEMO_CURSOR_CAPACITY = DEFAULT_CURSOR_CAPACITY;
