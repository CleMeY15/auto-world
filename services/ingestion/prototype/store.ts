import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { parseListing, parseObservation } from "@auto-world/vehicle-schema";
import {
  reduceAttemptCompletion,
  reduceAttemptReservation,
  type AttemptCompletionReceipt,
  type AttemptReservation,
  type CanonicalPageEffects,
  type CommitPageRequest,
  type CompleteAttemptRequest,
  type ConnectorCheckpoint,
  type ConnectorMutationKind,
  type ConnectorMutationRecord,
  type ConnectorStorePort,
  type FinalizeFullRunRequest,
  type FullRunReceipt,
  type InventoryHead,
  type ListingProjection,
  type LoadStagedRawRequest,
  type MutationReceipt,
  type OpenRunRequest,
  type OpenRunResult,
  type OperationKey,
  type PageCommitReceipt,
  type RecordRunTerminalRequest,
  type ReserveAttemptRequest,
  type RunTerminalReceipt,
  type RunningConnectorCheckpoint,
  type Sha256Digest,
  type StageRawReceipt,
  type StageRawRequest,
  type StagedRawPage,
  type StoreFailureCode,
  type StoreResult,
} from "@auto-world/connector-sdk";
import { Rejected, requireState, sourceTransaction, type DatabaseClient, type SourceRow } from "./database.js";
import { referenceKey, sameSemantic, semanticCommand } from "./semantic.js";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MutableRunning = Mutable<RunningConnectorCheckpoint>;
type MutationEnvelope<T> = { readonly mutation: MutationReceipt; readonly data: T };
type MutationRow = { kind: ConnectorMutationKind; payload_sha256: string; semantic_command: string; receipt: unknown };
type RunRow = { status: "running" | "completed"; request_sha256: string; request: unknown; policy: unknown; checkpoint: unknown };
type InventoryRow = { generation_id: string; revision: number | string; head: unknown };

const ok = <T>(data: T): StoreResult<T> => ({ acknowledged: true, success: true, data });
const fail = <T>(code: StoreFailureCode): StoreResult<T> => ({ acknowledged: true, success: false, failure: { code, retryable: false } });
const json = <T>(value: unknown): T => value as T;
const number = (value: number | string): number => typeof value === "number" ? value : Number(value);
const iso = (milliseconds: number): string => new Date(milliseconds).toISOString();
const union = (...values: readonly (readonly string[])[]): string[] => [...new Set(values.flat())].sort();
const without = (values: readonly string[], excluded: readonly string[]): string[] => values.filter((value) => !excluded.includes(value));

function pinnedPolicy(input: OpenRunRequest): object {
  const authority = { trust: input.authority.trust, registry: input.authority.registry,
    authorityRevision: input.authority.authorityRevision, authorizationBasisRef: input.authority.authorizationBasisRef };
  return { authority, registryRevision: input.registryRevision, configurationSha256: input.configurationSha256,
    obligations: input.obligations, operations: input.operations, scope: input.scope };
}

function validateOpen(input: OpenRunRequest): void {
  const revisions = input.authority.registry.revisions;
  const head = revisions[revisions.length - 1];
  requireState(input.request.sourceId === input.sourceId && input.scope.sourceId === input.sourceId &&
    input.scope.territory === input.request.territory && input.scope.acquisitionMethod === input.request.acquisitionMethod &&
    input.authority.registry.sourceId === input.sourceId && head !== undefined &&
    head.revision === input.authority.authorityRevision && head.revision === input.registryRevision &&
    input.configurationSha256 === configurationDigest(head.configuration) &&
    input.obligations.authorizationBasisRef === input.authority.authorizationBasisRef &&
    input.obligations.grant.territory === input.request.territory &&
    input.obligations.grant.acquisitionMethod === input.request.acquisitionMethod &&
    input.obligations.grant.audience === input.request.audience &&
    input.request.fields.every((field) => input.obligations.grant.fields.includes(field)) &&
    sameSemantic(input.obligations.grant, { audience: "internal", territory: input.request.territory,
      acquisitionMethod: input.request.acquisitionMethod, fields: input.request.fields }) &&
    input.obligations.legalStatus === head.configuration.legalStatus &&
    sameSemantic(input.operations, head.configuration.operations), "invalid_state");
  const policy = head.configuration.policy;
  requireState(policy !== null && policy.authorization.basisRef === input.authority.authorizationBasisRef &&
    policy.authorization.validUntil === input.obligations.authorizationValidUntil &&
    sameSemantic(policy.caching, input.obligations.caching) && sameSemantic(policy.retention, input.obligations.retention) &&
    sameSemantic(policy.media, input.obligations.media) && sameSemantic(policy.pii, input.obligations.pii) &&
    sameSemantic(policy.takedown, input.obligations.takedown) &&
    policy.grants.some((grant) => grant.audience === input.request.audience && grant.territory === input.request.territory &&
      grant.acquisitionMethod === input.request.acquisitionMethod && input.request.fields.every((field) => grant.fields.includes(field))), "invalid_state");
}

function deadline(capturedAtMs: number, seconds: number, authorizationEndMs: number): string {
  const value = capturedAtMs + seconds * 1_000;
  requireState(Number.isSafeInteger(value), "invalid_state");
  return new Date(Math.min(value, authorizationEndMs)).toISOString();
}

function validateStage(run: RunningConnectorCheckpoint, input: StageRawRequest, bytes: Uint8Array, nowMs: number): void {
  const capturedAtMs = Date.parse(input.capturedAt);
  const authorizationEndMs = Date.parse(run.obligations.authorizationValidUntil);
  requireState(Number.isSafeInteger(capturedAtMs) && Number.isSafeInteger(authorizationEndMs) && capturedAtMs < authorizationEndMs, "retention_expired");
  let rawSeconds = run.obligations.retention.rawSeconds;
  if (run.obligations.grant.fields.includes("seller_pii")) rawSeconds = Math.min(rawSeconds, run.obligations.retention.piiSeconds);
  if (run.obligations.grant.fields.includes("media") && run.obligations.media.mode === "licensed_copy") {
    rawSeconds = Math.min(rawSeconds, run.obligations.retention.mediaSeconds);
  }
  requireState(rawSeconds > 0, "retention_expired");
  const normalizedRetainUntil = deadline(capturedAtMs, run.obligations.retention.normalizedSeconds, authorizationEndMs);
  const expected = {
    rawRetainUntil: deadline(capturedAtMs, rawSeconds, authorizationEndMs),
    normalizedRetainUntil,
    mediaRetainUntil: run.obligations.retention.mediaSeconds === 0 ? null : deadline(capturedAtMs, run.obligations.retention.mediaSeconds, authorizationEndMs),
    piiRetainUntil: run.obligations.retention.piiSeconds === 0 ? null : deadline(capturedAtMs, run.obligations.retention.piiSeconds, authorizationEndMs),
    cacheUntil: run.obligations.caching.allowed
      ? new Date(Math.min(capturedAtMs + run.obligations.caching.maxAgeSeconds * 1_000, Date.parse(normalizedRetainUntil))).toISOString()
      : null,
  };
  requireState(sameSemantic(input.deadlines, expected), "invalid_state");
  requireState(nowMs < Date.parse(expected.rawRetainUntil), "retention_expired");
  requireState(bytes.byteLength <= run.request.limits.maxPageBytes && input.pageOrdinal < run.request.limits.maxPages &&
    input.pageIdentity.length >= 1 && input.pageIdentity.length <= 256 &&
    (input.nextCursor === null || input.nextCursor.length <= 2_048) &&
    (input.complete || input.nextCursor !== null) &&
    (input.complete || input.nextCursor === null || !run.visitedCursors.includes(input.nextCursor)), "invalid_state");
}

function rawMatches(raw: { snapshotId: string; connectorRunId: string; sha256: string }, run: RunningConnectorCheckpoint,
  pending: CommitPageRequest["pending"]): boolean {
  return raw.snapshotId === pending.snapshotId && raw.connectorRunId === run.runId && raw.sha256 === pending.sha256;
}

function validateEffects(run: RunningConnectorCheckpoint, input: CommitPageRequest): void {
  for (const version of input.effects.listingVersions) {
    const listing = input.effects.listings.find((candidate) => candidate.listingId === version.listingId);
    requireState(version.schemaVersion === 1 && listing !== undefined && parseListing(listing).success &&
      listing.sourceId === run.sourceId && listing.sourceListingId === version.sourceListingId &&
      sameSemantic(listing.observationIds, version.observationIds) && listing.url === version.url &&
      version.sourceId === run.sourceId && version.connectorRunId === run.runId && version.mapperVersion === run.request.mapperVersion &&
      version.capturedAt === input.pending.capturedAt && rawMatches(version.raw, run, input.pending) &&
      sameSemantic(version.deadlines, input.pending.deadlines), "invalid_state");
  }
  for (const observation of input.effects.observations) {
    const version = input.effects.listingVersions.find((candidate) => candidate.observationIds.includes(observation.observationId));
    requireState(version !== undefined && parseObservation(observation).success && observation.subject.kind === "listing" &&
      observation.subject.listingId === version.listingId && observation.provenance.sourceId === run.sourceId &&
      observation.provenance.observedAt === input.pending.capturedAt &&
      observation.provenance.acquisitionMethod === run.scope.acquisitionMethod &&
      observation.provenance.legalStatus === run.obligations.legalStatus && rawMatches(observation.provenance.raw, run, input.pending), "invalid_state");
    if (observation.field === "vin" && observation.value.status === "full") {
      requireState(observation.value.accessPolicy.visibility === "internal" &&
        observation.value.accessPolicy.policyRef === run.authorizationBasisRef, "invalid_state");
    }
  }
  for (const tombstone of input.effects.explicitTombstones) {
    requireState(tombstone.schemaVersion === 1 && tombstone.kind === "explicit" &&
      (tombstone.outcome === "withdrawn" || tombstone.outcome === "deleted") &&
      sameSemantic(tombstone.scope, run.scope) && tombstone.runId === run.runId &&
      tombstone.capturedAt === input.pending.capturedAt && rawMatches(tombstone.raw, run, input.pending) &&
      sameSemantic(tombstone.deadlines, input.pending.deadlines), "invalid_state");
  }
}

function validateMissing(run: RunningConnectorCheckpoint, input: FinalizeFullRunRequest): void {
  for (const tombstone of input.inferredMissing) {
    requireState(tombstone.schemaVersion === 1 && tombstone.kind === "inferred_missing" &&
      sameSemantic(tombstone.scope, run.scope) && tombstone.runId === run.runId &&
      tombstone.listingId === referenceKey("lst_", "listing", run.sourceId, tombstone.sourceListingId) &&
      tombstone.baselineGenerationId === run.baselineGenerationId && tombstone.inventoryGenerationId === input.inventoryGenerationId &&
      tombstone.finalizationKey === input.finalizationKey && tombstone.completedAt === input.completedAt &&
      tombstone.tombstoneId === referenceKey("tmb_", "missing-tombstone", run.scope.scopeId, tombstone.sourceListingId,
        run.baselineGenerationId, input.inventoryGenerationId, input.finalizationKey), "invalid_state");
  }
}

function observationValue(observation: CanonicalPageEffects["observations"][number]): string {
  if (observation.field === "price") return `amountMinor=${observation.value.amountMinor};currency=${observation.value.currency}`;
  if (observation.field === "mileage" || observation.field === "power") return `amount=${String(observation.value.amount)};unit=${observation.value.unit}`;
  if (observation.field === "co2") return `amount=${String(observation.value.amount)};unit=g_per_km;standard=${observation.value.standard}`;
  return observation.value.status === "full" ? `status=full;vin=${observation.value.vin}` : `status=${observation.value.status}`;
}

function requestDigest(request: OpenRunRequest["request"]): string {
  return referenceKey("", "request",
    String(request.schemaVersion), request.sourceId, request.territory, request.acquisitionMethod,
    request.audience, String(request.fields.length), ...request.fields, request.mode,
    request.invocationKey, request.adapterVersion, request.mapperVersion,
    String(request.limits.maxPages), String(request.limits.maxItems), String(request.limits.maxRunMs),
    String(request.limits.maxEffectMs), String(request.limits.maxPageBytes),
    String(request.limits.maxJsonDepth), String(request.limits.maxJsonMembers));
}

function configurationDigest(configuration: OpenRunRequest["authority"]["registry"]["revisions"][number]["configuration"]): string {
  const policy = configuration.policy;
  const parts: string[] = [configuration.displayName, String(configuration.territories.length), ...configuration.territories,
    String(configuration.acquisitionMethods.length), ...configuration.acquisitionMethods, configuration.credentials.kind,
    configuration.credentials.kind === "secret_ref" ? configuration.credentials.ref : "none", configuration.legalStatus];
  if (policy === null) parts.push("no-policy");
  else {
    parts.push("policy", policy.authorization.basisRef, policy.authorization.reviewerRef, policy.authorization.reviewedAt,
      policy.authorization.validFrom, policy.authorization.validUntil, String(policy.grants.length));
    for (const grant of policy.grants) {
      parts.push(grant.territory, grant.acquisitionMethod, grant.audience, String(grant.fields.length), ...grant.fields);
    }
    parts.push(String(policy.caching.allowed), String(policy.caching.maxAgeSeconds), String(policy.retention.rawSeconds),
      String(policy.retention.normalizedSeconds), String(policy.retention.mediaSeconds), String(policy.retention.piiSeconds),
      policy.media.mode, String(policy.media.attributionRequired), policy.pii.mode, policy.pii.purposeRef ?? "none",
      policy.takedown.contactRef, policy.takedown.procedureRef, String(policy.takedown.maxResponseSeconds));
  }
  const operations = configuration.operations;
  parts.push(String(operations.incremental), String(operations.fullReconcileIntervalSeconds), operations.deletionMode,
    String(operations.deletionPropagationSeconds), String(operations.freshnessSeconds), String(operations.requestsPerMinute),
    String(operations.concurrency), String(operations.timeoutMs), String(operations.maxRetries));
  const health = configuration.healthPolicy;
  parts.push(String(health.maxSampleAgeSeconds), String(health.maxSuccessAgeSeconds), String(health.maxErrorBps),
    String(health.maxParseErrorBps), String(health.maxStaleBps), String(health.maxLatencyP95Ms));
  return referenceKey("", "source-configuration", ...parts);
}

function liveFence(source: SourceRow, runId: string, fence: number, nowMs: number, opening: boolean): void {
  requireState(source.lease_run_id === runId && source.lease_fence === fence && source.expires_at !== null && source.expires_at.getTime() > nowMs, "stale_fence");
  if (opening) requireState(source.installed_fence <= fence, "stale_fence");
  else requireState(source.installed_fence === fence, "stale_fence");
}

async function loadRun(client: DatabaseClient, sourceId: string, runId: string): Promise<RunRow> {
  const result = await client.query<RunRow>(
    "SELECT status, request_sha256, request, policy, checkpoint FROM aw_connector.runs WHERE source_id = $1 AND run_id = $2",
    [sourceId, runId],
  );
  requireState(result.rowCount === 1, "not_found");
  return result.rows[0]!;
}

async function inventory(client: DatabaseClient, sourceId: string, scope: RunningConnectorCheckpoint["scope"]): Promise<InventoryHead> {
  const found = await client.query<InventoryRow>(
    "SELECT generation_id, revision, head FROM aw_connector.inventories WHERE source_id = $1 AND scope_id = $2",
    [sourceId, scope.scopeId],
  );
  if (found.rowCount === 1) return json<InventoryHead>(found.rows[0]!.head);
  const head: InventoryHead = {
    schemaVersion: 1, scope, generationId: "empty", revision: 0,
    activeSourceListingIds: [], lastCompletedFullAt: null, incrementalCursor: null,
  };
  await client.query(
    "INSERT INTO aw_connector.inventories (source_id, scope_id, generation_id, revision, head) VALUES ($1, $2, 'empty', 0, $3::jsonb)",
    [sourceId, scope.scopeId, JSON.stringify(head)],
  );
  return head;
}

function completed(run: RunningConnectorCheckpoint, head: InventoryHead, operationKey: OperationKey, completedAt: string): Extract<ConnectorCheckpoint, { status: "completed" }> {
  const result = { status: "completed" as const, runId: run.runId, pages: run.committedPages, items: run.committedItems, checkpointRevision: run.checkpointRevision };
  return {
    schemaVersion: 1, status: "completed", checkpointRevision: run.checkpointRevision,
    sourceId: run.sourceId, runId: run.runId, leaseFence: run.leaseFence,
    request: run.request, requestSha256: run.requestSha256, startedAt: run.startedAt,
    completedAt, completionOperationKey: operationKey, authorityRevision: run.authorityRevision,
    registryRevision: run.registryRevision, configurationSha256: run.configurationSha256,
    authorizationBasisRef: run.authorizationBasisRef, obligations: run.obligations,
    scope: run.scope, baselineGenerationId: run.baselineGenerationId,
    finalInventoryGenerationId: head.generationId, finalInventoryRevision: head.revision,
    committedPages: run.committedPages, committedItems: run.committedItems, result,
  };
}

function mutationRecord(kind: ConnectorMutationKind, input: { sourceId: ConnectorMutationRecord["sourceId"]; runId: ConnectorMutationRecord["runId"]; operationKey: string; leaseFence: number },
  recordedAt: string, checkpointRevision: number | null, runtimeRevision: number | null,
  pageOrdinal: number | null = null, itemCount: number | null = null, byteCount: number | null = null,
  terminal?: RecordRunTerminalRequest): ConnectorMutationRecord {
  return {
    schemaVersion: 1, kind, operationKey: input.operationKey, sourceId: input.sourceId,
    runId: input.runId, leaseFence: input.leaseFence, recordedAt,
    checkpointRevision, runtimeRevision, pageOrdinal, itemCount, byteCount,
    outcome: terminal?.result.status ?? "success", errorCode: terminal?.result.error.code ?? null,
  };
}

async function saveMutation<T>(client: DatabaseClient, kind: ConnectorMutationKind,
  input: { sourceId: string; runId: string; operationKey: string }, command: { text: string; sha256: string },
  record: ConnectorMutationRecord, data: T): Promise<void> {
  const mutation: MutationReceipt = { operationKey: input.operationKey, kind, payloadSha256: command.sha256 as Sha256Digest, record };
  const envelope: MutationEnvelope<T> = { mutation, data };
  await client.query(
    `INSERT INTO aw_connector.mutations
      (source_id, run_id, operation_key, kind, payload_sha256, semantic_command, receipt, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [input.sourceId, input.runId, input.operationKey, kind, command.sha256, command.text, JSON.stringify(envelope), record.recordedAt],
  );
  await client.query(
    "INSERT INTO aw_connector.outbox (source_id, run_id, operation_key, enqueued_at) VALUES ($1, $2, $3, $4)",
    [input.sourceId, input.runId, input.operationKey, record.recordedAt],
  );
}

async function replay<T>(client: DatabaseClient, input: { sourceId: string; runId: string; operationKey: string },
  kind: ConnectorMutationKind, command: { text: string; sha256: string }): Promise<T | undefined> {
  const result = await client.query<MutationRow>(
    "SELECT kind, payload_sha256, semantic_command, receipt FROM aw_connector.mutations WHERE source_id=$1 AND run_id=$2 AND operation_key=$3",
    [input.sourceId, input.runId, input.operationKey],
  );
  if (result.rowCount === 0) return undefined;
  const row = result.rows[0]!;
  requireState(row.kind === kind && row.payload_sha256 === command.sha256 && row.semantic_command === command.text, "idempotency_conflict");
  return json<MutationEnvelope<T>>(row.receipt).data;
}

async function domain<T>(action: () => Promise<T>): Promise<StoreResult<T>> {
  try { return ok(await action()); }
  catch (error) { if (error instanceof Rejected) return fail(error.code); throw error; }
}

async function project(client: DatabaseClient, run: RunningConnectorCheckpoint, listingId: string, sourceListingId: string,
  state: ListingProjection["state"], at: string, latestVersionId: string | null = null): Promise<void> {
  const prior = await client.query<{ projection: unknown }>(
    "SELECT projection FROM aw_connector.projections WHERE source_id=$1 AND scope_id=$2 AND listing_id=$3",
    [run.sourceId, run.scope.scopeId, listingId],
  );
  const old = prior.rowCount === 1 ? json<ListingProjection>(prior.rows[0]!.projection) : null;
  requireState(old === null || old.sourceListingId === sourceListingId, "invalid_state");
  const projection: ListingProjection = {
    schemaVersion: 1, listingId: listingId as ListingProjection["listingId"], sourceId: run.sourceId,
    sourceListingId, scope: run.scope, latestVersionId: latestVersionId as ListingProjection["latestVersionId"] ?? old?.latestVersionId ?? null,
    state, projectionRevision: (old?.projectionRevision ?? 0) + 1, updatedAt: at,
  };
  await client.query(
    `INSERT INTO aw_connector.projections (source_id,scope_id,listing_id,source_listing_id,latest_version_id,state,revision,projection)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ON CONFLICT (source_id,scope_id,listing_id) DO UPDATE SET
       latest_version_id=EXCLUDED.latest_version_id,state=EXCLUDED.state,revision=EXCLUDED.revision,projection=EXCLUDED.projection`,
    [run.sourceId, run.scope.scopeId, listingId, sourceListingId, projection.latestVersionId, state, projection.projectionRevision, JSON.stringify(projection)],
  );
}

async function insertEffects(client: DatabaseClient, run: RunningConnectorCheckpoint, input: CommitPageRequest, effects: CanonicalPageEffects): Promise<void> {
  for (const version of effects.listingVersions) {
    requireState(version.sourceId === run.sourceId && version.connectorRunId === run.runId &&
      version.raw.snapshotId === input.pending.snapshotId && version.raw.sha256 === input.pending.sha256, "invalid_state");
    requireState(version.listingId === referenceKey("lst_", "listing", run.sourceId, version.sourceListingId) &&
      version.listingVersionId === referenceKey("lv_", "listing-version", version.listingId, run.runId,
        input.pending.snapshotId, input.pending.sha256, run.request.mapperVersion), "invalid_state");
    const listing = effects.listings.find((candidate) => candidate.listingId === version.listingId);
    requireState(listing !== undefined, "invalid_state");
    await client.query(
      `INSERT INTO aw_connector.listing_versions
       (source_id,run_id,listing_version_id,listing_id,source_listing_id,snapshot_id,raw_sha256,listing,evidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)`,
      [run.sourceId, run.runId, version.listingVersionId, version.listingId, version.sourceListingId,
        input.pending.snapshotId, input.pending.sha256, JSON.stringify(listing), JSON.stringify(version)],
    );
    await project(client, run, version.listingId, version.sourceListingId, "active", version.capturedAt, version.listingVersionId);
  }
  for (const observation of effects.observations) {
    const version = effects.listingVersions.find((candidate) => candidate.observationIds.includes(observation.observationId));
    requireState(version !== undefined && observation.subject.kind === "listing" &&
      observation.provenance.sourceId === run.sourceId && observation.provenance.raw.connectorRunId === run.runId &&
      observation.provenance.raw.snapshotId === input.pending.snapshotId && observation.provenance.raw.sha256 === input.pending.sha256, "invalid_state");
    requireState(observation.observationId === referenceKey("obs_", "observation", version.listingId, observation.field,
      observationValue(observation), String(observation.provenance.confidenceBps), observation.provenance.observedAt,
      run.runId, input.pending.snapshotId, input.pending.sha256, run.request.mapperVersion), "invalid_state");
    await client.query(
      `INSERT INTO aw_connector.observations
       (source_id,run_id,observation_id,listing_id,listing_version_id,snapshot_id,raw_sha256,observation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [run.sourceId, run.runId, observation.observationId, observation.subject.listingId, version.listingVersionId,
        input.pending.snapshotId, input.pending.sha256, JSON.stringify(observation)],
    );
  }
  for (const tombstone of effects.explicitTombstones) {
    requireState(run.operations.deletionMode !== "full_reconciliation" && tombstone.runId === run.runId &&
      tombstone.raw.snapshotId === input.pending.snapshotId && tombstone.raw.sha256 === input.pending.sha256, "invalid_state");
    requireState(tombstone.listingId === referenceKey("lst_", "listing", run.sourceId, tombstone.sourceListingId) &&
      tombstone.tombstoneId === referenceKey("tmb_", "explicit-tombstone", run.scope.scopeId, tombstone.sourceListingId,
        tombstone.outcome, tombstone.capturedAt, run.runId, input.pending.snapshotId, input.pending.sha256), "invalid_state");
    await client.query(
      `INSERT INTO aw_connector.tombstones
       (source_id,run_id,tombstone_id,scope_id,listing_id,source_listing_id,kind,snapshot_id,raw_sha256,evidence)
       VALUES ($1,$2,$3,$4,$5,$6,'explicit',$7,$8,$9::jsonb)`,
      [run.sourceId, run.runId, tombstone.tombstoneId, run.scope.scopeId, tombstone.listingId,
        tombstone.sourceListingId, input.pending.snapshotId, input.pending.sha256, JSON.stringify(tombstone)],
    );
    await project(client, run, tombstone.listingId, tombstone.sourceListingId, tombstone.outcome, tombstone.capturedAt);
  }
}

export function createStore(pool: Pool): ConnectorStorePort {
  return {
    openRun(input: OpenRunRequest): Promise<StoreResult<OpenRunResult>> {
      return domain(() => sourceTransaction(pool, input.signal, input.sourceId, async (client, source, nowMs) => {
        liveFence(source, input.runId, input.leaseFence, nowMs, true);
        validateOpen(input);
        requireState(input.runId === referenceKey("run_", "run", input.sourceId, input.request.invocationKey) &&
          input.operationKey === referenceKey("open_", "open", input.runId, input.leaseFence) &&
          input.scope.scopeId === referenceKey("scope_", "scope", input.sourceId, input.scope.territory, input.scope.acquisitionMethod) &&
          input.requestSha256 === requestDigest(input.request), "invalid_state");
        const command = semanticCommand(input);
        const prior = await replay<OpenRunResult>(client, input, "run.opened", command);
        if (prior !== undefined) return prior;
        await client.query("UPDATE aw_connector.sources SET installed_fence=$2 WHERE source_id=$1", [input.sourceId, input.leaseFence]);
        const head = await inventory(client, input.sourceId, input.scope as RunningConnectorCheckpoint["scope"]);
        const found = await client.query<RunRow>(
          "SELECT status,request_sha256,request,policy,checkpoint FROM aw_connector.runs WHERE source_id=$1 AND run_id=$2",
          [input.sourceId, input.runId],
        );
        let result: OpenRunResult;
        let checkpoint: ConnectorCheckpoint;
        if (found.rowCount === 1) {
          const old = json<ConnectorCheckpoint>(found.rows[0]!.checkpoint);
          requireState(found.rows[0]!.request_sha256 === input.requestSha256 &&
            sameSemantic(found.rows[0]!.request, input.request) && sameSemantic(found.rows[0]!.policy, pinnedPolicy(input)), "idempotency_conflict");
          if (old.status === "completed") {
            result = { status: "completed", oldFencesQuiesced: true, checkpoint: old, result: old.result };
          }
          else {
            requireState(old.authorityRevision === input.authority.authorityRevision && old.configurationSha256 === input.configurationSha256, "idempotency_conflict");
            requireState(old.expectedInventoryRevision === head.revision && old.expectedInventoryGenerationId === head.generationId, "inventory_conflict");
            const resumed: RunningConnectorCheckpoint = { ...old, leaseFence: input.leaseFence, checkpointRevision: old.checkpointRevision + 1 };
            await client.query("UPDATE aw_connector.runs SET lease_fence=$3,checkpoint_revision=$4,checkpoint=$5::jsonb WHERE source_id=$1 AND run_id=$2",
              [input.sourceId, input.runId, input.leaseFence, resumed.checkpointRevision, JSON.stringify(resumed)]);
            result = { status: "resumed", oldFencesQuiesced: true, checkpoint: resumed };
          }
          checkpoint = result.checkpoint;
        } else {
          if (input.request.mode === "incremental") requireState(input.operations.incremental && head.lastCompletedFullAt !== null &&
            nowMs < Date.parse(head.lastCompletedFullAt) + input.operations.fullReconcileIntervalSeconds * 1000, "full_reconciliation_required");
          const opened: RunningConnectorCheckpoint = {
            schemaVersion: 1, status: "running", checkpointRevision: 1, sourceId: input.sourceId, runId: input.runId,
            leaseFence: input.leaseFence, request: input.request, requestSha256: input.requestSha256, startedAt: input.openedAt,
            authorityRevision: input.authority.authorityRevision, registryRevision: input.registryRevision,
            configurationSha256: input.configurationSha256, authorizationBasisRef: input.obligations.authorizationBasisRef,
            obligations: input.obligations, operations: input.operations, scope: input.scope,
            baselineGenerationId: head.generationId, baselineActiveSourceListingIds: head.activeSourceListingIds,
            expectedInventoryGenerationId: head.generationId, expectedInventoryRevision: head.revision,
            lastCompletedFullAt: head.lastCompletedFullAt, nextPageOrdinal: 0,
            nextCursor: input.request.mode === "full" ? null : head.incrementalCursor,
            committedPages: 0, committedItems: 0, committedRawBytes: 0, visitedCursors: [], finalPageCommitKey: null,
            lastPageCommitKey: null, pendingRaw: null, stagedActiveSourceListingIds: [], stagedEndedSourceListingIds: [],
          };
          const policy = pinnedPolicy(input);
          await client.query(
            `INSERT INTO aw_connector.runs
             (source_id,run_id,scope_id,lease_fence,status,request_sha256,request,policy,checkpoint_revision,checkpoint,started_at)
             VALUES ($1,$2,$3,$4,'running',$5,$6::jsonb,$7::jsonb,1,$8::jsonb,$9)`,
            [input.sourceId, input.runId, input.scope.scopeId, input.leaseFence, input.requestSha256,
              JSON.stringify(input.request), JSON.stringify(policy), JSON.stringify(opened), input.openedAt],
          );
          result = { status: "opened", oldFencesQuiesced: true, checkpoint: opened };
          checkpoint = opened;
        }
        const record = mutationRecord("run.opened", input, iso(nowMs), checkpoint.checkpointRevision, source.runtime.revision);
        await saveMutation(client, "run.opened", input, command, record, result);
        return result;
      }));
    },

    reserveAttempt(input: ReserveAttemptRequest): Promise<StoreResult<AttemptReservation>> {
      return domain(() => sourceTransaction(pool, input.signal, input.sourceId, async (client, source, nowMs) => {
        liveFence(source, input.runId, input.leaseFence, nowMs, false);
        requireState(input.operationKey === referenceKey("reserve_", "attempt-reservation", input.runId, input.leaseFence,
          input.pageOrdinal, input.attempt), "invalid_state");
        const command = semanticCommand(input);
        const prior = await replay<AttemptReservation>(client, input, "attempt.reserved", command);
        if (prior !== undefined) return prior;
        await loadRun(client, input.sourceId, input.runId);
        const reduced = reduceAttemptReservation(source.runtime, input);
        requireState(reduced.success, reduced.success ? undefined : reduced.failure.code);
        await client.query("UPDATE aw_connector.sources SET runtime=$2::jsonb WHERE source_id=$1", [input.sourceId, JSON.stringify(reduced.nextState)]);
        await client.query(
          `INSERT INTO aw_connector.attempts
           (source_id,run_id,reservation_key,lease_fence,page_ordinal,attempt,runtime_revision,reservation)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          [input.sourceId, input.runId, input.operationKey, input.leaseFence, input.pageOrdinal, input.attempt,
            reduced.data.runtimeRevision, JSON.stringify(reduced.data)],
        );
        const run = await loadRun(client, input.sourceId, input.runId);
        const record = mutationRecord("attempt.reserved", input, iso(nowMs), json<ConnectorCheckpoint>(run.checkpoint).checkpointRevision, reduced.nextState.revision, input.pageOrdinal);
        await saveMutation(client, "attempt.reserved", input, command, record, reduced.data);
        return reduced.data;
      }));
    },

    completeAttempt(input: CompleteAttemptRequest): Promise<StoreResult<AttemptCompletionReceipt>> {
      return domain(() => sourceTransaction(pool, input.signal, input.sourceId, async (client, source, nowMs) => {
        liveFence(source, input.runId, input.leaseFence, nowMs, false);
        requireState(input.operationKey === referenceKey("attempt_", "attempt", input.runId, input.reservationKey), "invalid_state");
        const command = semanticCommand(input);
        const prior = await replay<AttemptCompletionReceipt>(client, input, "attempt.completed", command);
        if (prior !== undefined) return prior;
        const reserved = await client.query<{ lease_fence: number | string; reservation: unknown; completion_operation_key: string | null }>(
          "SELECT lease_fence,reservation,completion_operation_key FROM aw_connector.attempts WHERE source_id=$1 AND run_id=$2 AND reservation_key=$3",
          [input.sourceId, input.runId, input.reservationKey],
        );
        requireState(reserved.rowCount === 1, "not_found");
        requireState(number(reserved.rows[0]!.lease_fence) === input.leaseFence, "stale_fence");
        requireState(reserved.rows[0]!.completion_operation_key === null, "idempotency_conflict");
        const reduction = reduceAttemptCompletion(source.runtime, json<AttemptReservation>(reserved.rows[0]!.reservation), input);
        requireState(reduction.success, reduction.success ? undefined : reduction.failure.code);
        await client.query("UPDATE aw_connector.sources SET runtime=$2::jsonb WHERE source_id=$1", [input.sourceId, JSON.stringify(reduction.nextState)]);
        await client.query("UPDATE aw_connector.attempts SET completion_operation_key=$4,completion=$5::jsonb WHERE source_id=$1 AND run_id=$2 AND reservation_key=$3",
          [input.sourceId, input.runId, input.reservationKey, input.operationKey, JSON.stringify(reduction.data)]);
        const run = await loadRun(client, input.sourceId, input.runId);
        const record = mutationRecord("attempt.completed", input, iso(nowMs), json<ConnectorCheckpoint>(run.checkpoint).checkpointRevision, reduction.nextState.revision);
        await saveMutation(client, "attempt.completed", input, command, record, reduction.data);
        return reduction.data;
      }));
    },

    stageRaw(input: StageRawRequest): Promise<StoreResult<StageRawReceipt>> {
      const bytes = Uint8Array.prototype.slice.call(input.bytes);
      return domain(() => sourceTransaction(pool, input.signal, input.sourceId, async (client, source, nowMs) => {
        liveFence(source, input.runId, input.leaseFence, nowMs, false);
        const command = semanticCommand(input, true, bytes);
        const prior = await replay<StageRawReceipt>(client, input, "raw.staged", command);
        if (prior !== undefined) {
          const raw = await client.query<{ raw_bytes: Buffer; raw_retain_until: Date }>(
            "SELECT raw_bytes,raw_retain_until FROM aw_connector.raw_pages WHERE source_id=$1 AND run_id=$2 AND operation_key=$3",
            [input.sourceId, input.runId, input.operationKey],
          );
          requireState(raw.rowCount === 1 && Buffer.from(bytes).equals(raw.rows[0]!.raw_bytes), "idempotency_conflict");
          requireState(raw.rows[0]!.raw_retain_until.getTime() > nowMs, "retention_expired");
          return prior;
        }
        const row = await loadRun(client, input.sourceId, input.runId);
        requireState(row.status === "running", "invalid_state");
        const run = json<MutableRunning>(row.checkpoint);
        requireState(run.checkpointRevision === input.checkpointRevision, "checkpoint_conflict");
        requireState(run.pendingRaw === null && run.nextPageOrdinal === input.pageOrdinal, "invalid_state");
        requireState(sameSemantic(run.obligations, input.obligations), "invalid_state");
        validateStage(run, input, bytes, nowMs);
        const pageKey = referenceKey("page_", "page", input.runId, input.pageOrdinal, input.pageIdentity);
        requireState(input.snapshotId === referenceKey("raw_", "raw", input.sourceId, pageKey) &&
          input.operationKey === referenceKey("stage_", "stage", input.runId, input.snapshotId), "invalid_state");
        requireState(createHash("sha256").update(bytes).digest("hex") === input.sha256, "raw_conflict");
        const pending = { operationKey: input.operationKey, pageOrdinal: input.pageOrdinal, pageIdentity: input.pageIdentity,
          snapshotId: input.snapshotId, sha256: input.sha256, byteLength: bytes.byteLength, capturedAt: input.capturedAt,
          nextCursor: input.nextCursor, complete: input.complete, deadlines: input.deadlines };
        await client.query(
          `INSERT INTO aw_connector.raw_pages
           (source_id,run_id,snapshot_id,operation_key,page_ordinal,page_identity,raw_bytes,sha256,byte_length,captured_at,raw_retain_until,pending,obligations)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb)`,
          [input.sourceId, input.runId, input.snapshotId, input.operationKey, input.pageOrdinal, input.pageIdentity,
            Buffer.from(bytes), input.sha256, bytes.byteLength, input.capturedAt, input.deadlines.rawRetainUntil,
            JSON.stringify(pending), JSON.stringify(input.obligations)],
        );
        run.pendingRaw = pending;
        run.checkpointRevision += 1;
        await client.query("UPDATE aw_connector.runs SET checkpoint_revision=$3,checkpoint=$4::jsonb WHERE source_id=$1 AND run_id=$2",
          [input.sourceId, input.runId, run.checkpointRevision, JSON.stringify(run)]);
        const receipt: StageRawReceipt = { operationKey: input.operationKey, snapshotId: input.snapshotId, sha256: input.sha256,
          byteLength: bytes.byteLength, checkpointRevision: run.checkpointRevision };
        const record = mutationRecord("raw.staged", input, iso(nowMs), run.checkpointRevision, source.runtime.revision, input.pageOrdinal, null, bytes.byteLength);
        await saveMutation(client, "raw.staged", input, command, record, receipt);
        return receipt;
      }));
    },

    loadStagedRaw(input: LoadStagedRawRequest): Promise<StoreResult<StagedRawPage>> {
      return domain(() => sourceTransaction(pool, input.signal, input.sourceId, async (client, source, nowMs) => {
        liveFence(source, input.runId, input.leaseFence, nowMs, false);
        const raw = await client.query<{ pending: unknown; raw_bytes: Buffer; obligations: unknown; raw_retain_until: Date }>(
          "SELECT pending,raw_bytes,obligations,raw_retain_until FROM aw_connector.raw_pages WHERE source_id=$1 AND run_id=$2 AND snapshot_id=$3",
          [input.sourceId, input.runId, input.snapshotId],
        );
        requireState(raw.rowCount === 1, "not_found");
        const retained = raw.rows[0]!.raw_retain_until.getTime();
        requireState(Date.parse(input.asOf) < retained && nowMs < retained, "retention_expired");
        return { pending: json(raw.rows[0]!.pending), bytes: Uint8Array.from(raw.rows[0]!.raw_bytes), obligations: json(raw.rows[0]!.obligations) };
      }));
    },

    commitPage(input: CommitPageRequest): Promise<StoreResult<PageCommitReceipt>> {
      return domain(() => sourceTransaction(pool, input.signal, input.sourceId, async (client, source, nowMs) => {
        liveFence(source, input.runId, input.leaseFence, nowMs, false);
        const command = semanticCommand(input);
        const prior = await replay<PageCommitReceipt>(client, input, "page.committed", command);
        if (prior !== undefined) return prior;
        const row = await loadRun(client, input.sourceId, input.runId);
        requireState(row.status === "running", "invalid_state");
        const run = json<MutableRunning>(row.checkpoint);
        const head = await inventory(client, input.sourceId, run.scope);
        requireState(run.checkpointRevision === input.expectedCheckpointRevision, "checkpoint_conflict");
        requireState(head.revision === input.expectedInventoryRevision && head.generationId === input.expectedInventoryGenerationId, "inventory_conflict");
        requireState(sameSemantic(run.pendingRaw, input.pending) && input.authorityRevision === run.authorityRevision, "invalid_state");
        requireState(input.nextCursor === input.pending.nextCursor && input.complete === input.pending.complete, "invalid_state");
        requireState(nowMs < Date.parse(input.pending.deadlines.rawRetainUntil), "retention_expired");
        validateEffects(run, input);
        const raw = await client.query("SELECT 1 FROM aw_connector.raw_pages WHERE source_id=$1 AND run_id=$2 AND snapshot_id=$3 AND sha256=$4",
          [input.sourceId, input.runId, input.pending.snapshotId, input.pending.sha256]);
        requireState(raw.rowCount === 1, "raw_conflict");
        const allIds = [...input.effects.activeSourceListingIds, ...input.effects.endedSourceListingIds];
        requireState(new Set(allIds).size === allIds.length && allIds.length === input.pageItemCount && input.nextPageOrdinal === input.pending.pageOrdinal + 1, "invalid_state");
        requireState(sameSemantic([...input.effects.activeSourceListingIds].sort(), input.effects.listingVersions.map((item) => item.sourceListingId).sort()) &&
          sameSemantic([...input.effects.endedSourceListingIds].sort(), input.effects.explicitTombstones.map((item) => item.sourceListingId).sort()) &&
          input.effects.listings.length === input.effects.listingVersions.length &&
          input.effects.observations.every((item) => input.effects.listingVersions.filter((version) => version.observationIds.includes(item.observationId)).length === 1) &&
          input.effects.listingVersions.every((version) => version.observationIds.length === input.effects.observations.filter((item) => version.observationIds.includes(item.observationId)).length), "invalid_state");
        const pageKey = referenceKey("page_", "page", input.runId, input.pending.pageOrdinal, input.pending.pageIdentity);
        requireState(input.operationKey === referenceKey("commit_", "commit", pageKey, input.pending.sha256, run.request.mapperVersion), "invalid_state");
        if (run.request.mode === "full") {
          const seen = [...run.stagedActiveSourceListingIds, ...run.stagedEndedSourceListingIds];
          requireState(allIds.every((id) => !seen.includes(id)), "idempotency_conflict");
        }
        requireState(run.committedItems + allIds.length <= run.request.limits.maxItems, "invalid_state");
        await insertEffects(client, run, input, input.effects);
        const nextHead: InventoryHead = run.request.mode === "incremental" ? {
          ...head, activeSourceListingIds: without(union(head.activeSourceListingIds, input.effects.activeSourceListingIds), input.effects.endedSourceListingIds),
          revision: head.revision + 1, incrementalCursor: input.complete ? input.nextCursor : head.incrementalCursor,
        } : head;
        if (run.request.mode === "full") {
          run.stagedActiveSourceListingIds = union(run.stagedActiveSourceListingIds, input.effects.activeSourceListingIds);
          run.stagedEndedSourceListingIds = union(run.stagedEndedSourceListingIds, input.effects.endedSourceListingIds);
        } else {
          await client.query("UPDATE aw_connector.inventories SET revision=$3,head=$4::jsonb WHERE source_id=$1 AND scope_id=$2",
            [input.sourceId, run.scope.scopeId, nextHead.revision, JSON.stringify(nextHead)]);
        }
        run.expectedInventoryRevision = nextHead.revision;
        run.expectedInventoryGenerationId = nextHead.generationId;
        run.visitedCursors = [...run.visitedCursors, run.nextCursor];
        run.nextCursor = input.nextCursor;
        run.nextPageOrdinal = input.nextPageOrdinal;
        run.committedPages += 1;
        run.committedItems += input.pageItemCount;
        run.committedRawBytes += input.pending.byteLength;
        run.pendingRaw = null;
        run.lastPageCommitKey = input.operationKey;
        run.checkpointRevision += 1;
        if (input.complete) run.finalPageCommitKey = input.operationKey;
        const checkpoint: ConnectorCheckpoint = input.complete && run.request.mode === "incremental" ? completed(run, nextHead, input.operationKey, input.committedAt) : run;
        await client.query("UPDATE aw_connector.runs SET status=$3,checkpoint_revision=$4,checkpoint=$5::jsonb,completed_at=$6 WHERE source_id=$1 AND run_id=$2",
          [input.sourceId, input.runId, checkpoint.status, checkpoint.checkpointRevision, JSON.stringify(checkpoint), checkpoint.status === "completed" ? input.committedAt : null]);
        const receipt: PageCommitReceipt = { operationKey: input.operationKey, checkpointRevision: checkpoint.checkpointRevision,
          inventoryGenerationId: nextHead.generationId, inventoryRevision: nextHead.revision, committedPages: checkpoint.committedPages,
          committedItems: checkpoint.committedItems, complete: input.complete, checkpoint };
        const record = mutationRecord("page.committed", input, iso(nowMs), checkpoint.checkpointRevision, source.runtime.revision,
          input.pending.pageOrdinal, input.pageItemCount, input.pending.byteLength);
        await saveMutation(client, "page.committed", input, command, record, receipt);
        return receipt;
      }));
    },

    finalizeFullRun(input: FinalizeFullRunRequest): Promise<StoreResult<FullRunReceipt>> {
      return domain(() => sourceTransaction(pool, input.signal, input.sourceId, async (client, source, nowMs) => {
        liveFence(source, input.runId, input.leaseFence, nowMs, false);
        const command = semanticCommand(input);
        const prior = await replay<FullRunReceipt>(client, input, "full.finalized", command);
        if (prior !== undefined) return prior;
        const row = await loadRun(client, input.sourceId, input.runId);
        requireState(row.status === "running", "invalid_state");
        const run = json<MutableRunning>(row.checkpoint);
        const head = await inventory(client, input.sourceId, run.scope);
        requireState(run.request.mode === "full" && run.pendingRaw === null && run.finalPageCommitKey === input.finalPageCommitKey, "invalid_state");
        requireState(run.checkpointRevision === input.expectedCheckpointRevision, "checkpoint_conflict");
        requireState(head.revision === input.expectedInventoryRevision && head.generationId === input.expectedInventoryGenerationId, "inventory_conflict");
        requireState(input.baselineGenerationId === run.baselineGenerationId && input.authorityRevision === run.authorityRevision && sameSemantic(input.scope, run.scope), "invalid_state");
        requireState(input.deletionMode === run.operations.deletionMode, "invalid_state");
        requireState(input.inventoryGenerationId === referenceKey("inv_", "inventory", run.scope.scopeId, run.runId, run.baselineGenerationId) &&
          input.finalizationKey === referenceKey("final_", "finalization", run.scope.scopeId, run.runId, run.baselineGenerationId,
            input.inventoryGenerationId, input.finalPageCommitKey) && input.operationKey === input.finalizationKey, "invalid_state");
        validateMissing(run, input);
        const explicitOnly = input.deletionMode === "explicit_tombstone";
        const nextActive = explicitOnly ? without(union(run.baselineActiveSourceListingIds, run.stagedActiveSourceListingIds), run.stagedEndedSourceListingIds) : [...run.stagedActiveSourceListingIds];
        const absent = explicitOnly ? [] : without(without(run.baselineActiveSourceListingIds, run.stagedActiveSourceListingIds), run.stagedEndedSourceListingIds);
        requireState(sameSemantic([...input.nextActiveSourceListingIds].sort(), nextActive.sort()) &&
          sameSemantic(input.inferredMissing.map((item) => item.sourceListingId).sort(), absent.sort()), "invalid_state");
        for (const tombstone of input.inferredMissing) {
          requireState(tombstone.runId === run.runId && sameSemantic(tombstone.scope, run.scope) && tombstone.finalizationKey === input.finalizationKey &&
            tombstone.tombstoneId === referenceKey("tmb_", "missing-tombstone", run.scope.scopeId, tombstone.sourceListingId,
              run.baselineGenerationId, input.inventoryGenerationId, input.finalizationKey), "invalid_state");
          await client.query(
            `INSERT INTO aw_connector.tombstones
             (source_id,run_id,tombstone_id,scope_id,listing_id,source_listing_id,kind,snapshot_id,raw_sha256,evidence)
             VALUES ($1,$2,$3,$4,$5,$6,'inferred_missing',NULL,NULL,$7::jsonb)`,
            [input.sourceId, input.runId, tombstone.tombstoneId, run.scope.scopeId, tombstone.listingId, tombstone.sourceListingId, JSON.stringify(tombstone)],
          );
          await project(client, run, tombstone.listingId, tombstone.sourceListingId, "missing", input.completedAt);
        }
        const nextHead: InventoryHead = { ...head, activeSourceListingIds: nextActive, generationId: input.inventoryGenerationId,
          revision: head.revision + 1, lastCompletedFullAt: input.completedAt, incrementalCursor: run.nextCursor };
        await client.query("UPDATE aw_connector.inventories SET generation_id=$3,revision=$4,head=$5::jsonb WHERE source_id=$1 AND scope_id=$2",
          [input.sourceId, run.scope.scopeId, nextHead.generationId, nextHead.revision, JSON.stringify(nextHead)]);
        run.checkpointRevision += 1;
        const checkpoint = completed(run, nextHead, input.operationKey, input.completedAt);
        await client.query("UPDATE aw_connector.runs SET status='completed',checkpoint_revision=$3,checkpoint=$4::jsonb,completed_at=$5 WHERE source_id=$1 AND run_id=$2",
          [input.sourceId, input.runId, checkpoint.checkpointRevision, JSON.stringify(checkpoint), input.completedAt]);
        const receipt: FullRunReceipt = { operationKey: input.operationKey, finalizationKey: input.finalizationKey,
          checkpointRevision: checkpoint.checkpointRevision, inventoryGenerationId: input.inventoryGenerationId,
          inventoryRevision: nextHead.revision, inferredMissing: input.inferredMissing, result: checkpoint.result };
        const record = mutationRecord("full.finalized", input, iso(nowMs), checkpoint.checkpointRevision, source.runtime.revision);
        await saveMutation(client, "full.finalized", input, command, record, receipt);
        return receipt;
      }));
    },

    lookupMutation(input): Promise<StoreResult<MutationReceipt | null>> {
      return domain(() => sourceTransaction(pool, input.signal, input.sourceId, async (client, source, nowMs) => {
        liveFence(source, input.runId, input.leaseFence, nowMs, false);
        const found = await client.query<MutationRow>(
          "SELECT kind,payload_sha256,semantic_command,receipt FROM aw_connector.mutations WHERE source_id=$1 AND run_id=$2 AND operation_key=$3",
          [input.sourceId, input.runId, input.operationKey],
        );
        if (found.rowCount === 0) return null;
        const envelope = json<MutationEnvelope<unknown>>(found.rows[0]!.receipt);
        requireState(found.rows[0]!.kind === input.expectedKind && envelope.mutation.record.sourceId === input.sourceId && envelope.mutation.record.runId === input.runId, "idempotency_conflict");
        return envelope.mutation;
      }));
    },

    recordRunTerminal(input: RecordRunTerminalRequest): Promise<StoreResult<RunTerminalReceipt>> {
      return domain(() => sourceTransaction(pool, input.signal, input.sourceId, async (client, source, nowMs) => {
        liveFence(source, input.runId, input.leaseFence, nowMs, false);
        requireState(input.operationKey === referenceKey("terminal_", "terminal", input.runId, input.leaseFence,
          input.expectedCheckpointRevision === null ? "none" : input.expectedCheckpointRevision,
          input.result.status, input.result.error.code), "invalid_state");
        const command = semanticCommand(input);
        const prior = await replay<RunTerminalReceipt>(client, input, "run.terminal", command);
        if (prior !== undefined) return prior;
        if (input.expectedCheckpointRevision !== null) {
          const row = await loadRun(client, input.sourceId, input.runId);
          requireState(json<ConnectorCheckpoint>(row.checkpoint).checkpointRevision === input.expectedCheckpointRevision, "checkpoint_conflict");
        }
        const receipt: RunTerminalReceipt = { operationKey: input.operationKey, checkpointRevision: input.expectedCheckpointRevision, recorded: true };
        const record = mutationRecord("run.terminal", input, iso(nowMs), input.expectedCheckpointRevision, source.runtime.revision, null, null, null, input);
        await saveMutation(client, "run.terminal", input, command, record, receipt);
        return receipt;
      }));
    },
  };
}
