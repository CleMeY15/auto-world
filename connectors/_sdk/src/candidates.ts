import {
  parseListing,
  parseObservation,
  type Listing,
  type Observation,
  type RawReference,
  type ValidationIssue,
  type ValidationResult,
} from "@auto-world/vehicle-schema";
import type {
  CanonicalPageEffects,
  ConnectorRunRequest,
  ExplicitLifecycleTombstone,
  ListingVersionEvidence,
  MappedPageDraft,
  ObservationDraft,
  PendingRawPage,
  RunningConnectorCheckpoint,
} from "./types.js";
import {
  deriveExplicitTombstoneId,
  deriveListingId,
  deriveListingVersionId,
  deriveObservationId,
  digestConnectorRequest,
  encodeObservationValue,
} from "./keys.js";
import { parseConnectorRunRequest, parseMappedPageDraft } from "./validation.js";

export interface BuildCanonicalPageEffectsInput {
  readonly request: ConnectorRunRequest;
  readonly checkpoint: RunningConnectorCheckpoint;
  readonly pending: PendingRawPage;
  readonly draft: MappedPageDraft;
  readonly checkContinuation: () => void;
}

function invalid(path: string): ValidationResult<never> {
  const entry: ValidationIssue = Object.freeze({ code: "invalid_value", path });
  return Object.freeze({ success: false, issues: Object.freeze([entry]) });
}

function freeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freeze(nested);
  return Object.freeze(value);
}

function observationValue(draft: ObservationDraft, policyRef: string): Observation["value"] {
  if (draft.field !== "vin") return draft.value;
  if (draft.value.status !== "full") return draft.value;
  return Object.freeze({
    status: "full" as const,
    vin: draft.value.vin,
    accessPolicy: Object.freeze({ visibility: "internal" as const, policyRef }),
  });
}

async function sameBoundRun(input: BuildCanonicalPageEffectsInput): Promise<boolean> {
  const { request, checkpoint, pending } = input;
  return (
    checkpoint.status === "running" &&
    checkpoint.sourceId === request.sourceId &&
    checkpoint.request.sourceId === request.sourceId &&
    checkpoint.request.invocationKey === request.invocationKey &&
    checkpoint.request.mapperVersion === request.mapperVersion &&
    checkpoint.requestSha256 === await digestConnectorRequest(request) &&
    pending.pageOrdinal === checkpoint.nextPageOrdinal &&
    checkpoint.authorizationBasisRef === checkpoint.obligations.authorizationBasisRef &&
    pending.sha256.length === 64 &&
    /^[0-9a-f]{64}$/.test(pending.sha256)
  );
}

export async function buildCanonicalPageEffects(
  input: BuildCanonicalPageEffectsInput,
): Promise<ValidationResult<CanonicalPageEffects>> {
  const request = parseConnectorRunRequest(input.request);
  if (!request.success) return request;
  const draft = parseMappedPageDraft(input.draft);
  if (!draft.success) return draft;
  if (!(await sameBoundRun(input))) return invalid("$");

  const { checkpoint, pending } = input;
  input.checkContinuation();
  const raw: RawReference = Object.freeze({
    snapshotId: pending.snapshotId,
    connectorRunId: checkpoint.runId,
    sha256: pending.sha256,
  });
  const listings: Listing[] = [];
  const listingVersions: ListingVersionEvidence[] = [];
  const observations: Observation[] = [];
  const explicitTombstones: ExplicitLifecycleTombstone[] = [];
  const activeSourceListingIds: string[] = [];
  const endedSourceListingIds: string[] = [];

  for (const item of draft.data.items) {
    input.checkContinuation();
    const listingId = await deriveListingId(request.data.sourceId, item.sourceListingId);
    input.checkContinuation();
    if (item.outcome !== "active") {
      if (checkpoint.operations.deletionMode === "full_reconciliation") return invalid("$.draft.items");
      const tombstoneId = await deriveExplicitTombstoneId(
        checkpoint.scope.scopeId,
        item.sourceListingId,
        item.outcome,
        pending.capturedAt,
        checkpoint.runId,
        pending.snapshotId,
        pending.sha256,
      );
      input.checkContinuation();
      explicitTombstones.push(freeze({
        schemaVersion: 1 as const,
        tombstoneId,
        kind: "explicit" as const,
        outcome: item.outcome,
        scope: checkpoint.scope,
        listingId,
        sourceListingId: item.sourceListingId,
        runId: checkpoint.runId,
        capturedAt: pending.capturedAt,
        raw,
        deadlines: pending.deadlines,
      }));
      endedSourceListingIds.push(item.sourceListingId);
      continue;
    }

    if (item.url !== undefined && !request.data.fields.includes("url")) return invalid("$.draft.items");
    const itemObservations: Observation[] = [];
    const observationIds = [];
    const fingerprints = new Set<string>();
    for (const observationDraft of item.observations) {
      input.checkContinuation();
      if (!request.data.fields.includes(observationDraft.field)) return invalid("$.draft.items");
      const fingerprint = `${observationDraft.field}\0${encodeObservationValue(observationDraft)}\0${observationDraft.confidenceBps}`;
      if (fingerprints.has(fingerprint)) continue;
      fingerprints.add(fingerprint);
      const observationId = await deriveObservationId(
        listingId,
        observationDraft,
        pending.capturedAt,
        checkpoint.runId,
        pending.snapshotId,
        pending.sha256,
        request.data.mapperVersion,
      );
      input.checkContinuation();
      const candidate = freeze({
        schemaVersion: 1 as const,
        observationId,
        subject: Object.freeze({ kind: "listing" as const, listingId }),
        field: observationDraft.field,
        value: observationValue(observationDraft, checkpoint.authorizationBasisRef),
        provenance: Object.freeze({
          sourceId: request.data.sourceId,
          observedAt: pending.capturedAt,
          acquisitionMethod: request.data.acquisitionMethod,
          legalStatus: checkpoint.obligations.legalStatus,
          confidenceBps: observationDraft.confidenceBps,
          raw,
        }),
      }) as Observation;
      const parsed = parseObservation(candidate);
      if (!parsed.success) return invalid("$.draft.items");
      itemObservations.push(parsed.data);
      observationIds.push(parsed.data.observationId);
    }

    const listingCandidate = item.url === undefined
      ? { schemaVersion: 1 as const, listingId, sourceId: request.data.sourceId, sourceListingId: item.sourceListingId, identity: Object.freeze({ status: "unresolved" as const }), observationIds: Object.freeze(observationIds) }
      : { schemaVersion: 1 as const, listingId, sourceId: request.data.sourceId, sourceListingId: item.sourceListingId, identity: Object.freeze({ status: "unresolved" as const }), observationIds: Object.freeze(observationIds), url: item.url };
    const parsedListing = parseListing(freeze(listingCandidate));
    if (!parsedListing.success) return invalid("$.draft.items");
    const listingVersionId = await deriveListingVersionId(listingId, checkpoint.runId, pending.snapshotId, pending.sha256, request.data.mapperVersion);
    input.checkContinuation();
    const version = item.url === undefined
      ? { schemaVersion: 1 as const, listingVersionId, listingId, sourceId: request.data.sourceId, sourceListingId: item.sourceListingId, connectorRunId: checkpoint.runId, mapperVersion: request.data.mapperVersion, capturedAt: pending.capturedAt, observationIds: Object.freeze(observationIds), raw, deadlines: pending.deadlines }
      : { schemaVersion: 1 as const, listingVersionId, listingId, sourceId: request.data.sourceId, sourceListingId: item.sourceListingId, connectorRunId: checkpoint.runId, mapperVersion: request.data.mapperVersion, capturedAt: pending.capturedAt, url: item.url, observationIds: Object.freeze(observationIds), raw, deadlines: pending.deadlines };
    listings.push(parsedListing.data);
    listingVersions.push(freeze(version));
    observations.push(...itemObservations);
    activeSourceListingIds.push(item.sourceListingId);
  }

  return Object.freeze({
    success: true,
    data: freeze({
      listings,
      listingVersions,
      observations,
      explicitTombstones,
      activeSourceListingIds,
      endedSourceListingIds,
    }),
  });
}
