# ADR-0003 — Connector SDK V1 lifecycle and persistence boundary

Status: Accepted architecture — independent Architect and Critic plan reviews approved, 2026-09-06.
Task: TASK-0004. Exact public declarations are frozen in the companion contract appendix before implementation. This ADR is not production source authorization.

## Outcome and boundary

Activate `@auto-world/connector-sdk` as an executable source-agnostic TypeScript SDK. Synthetic ports must prove this complete lifecycle: trusted-current Source Registry read, exact policy pin, bounded/rate-reserved acquisition, atomic immutable raw staging, strict JSON decode, deterministic mapping to append-only listing/observation evidence, atomic page/checkpoint commit, safe incremental resume, and scoped full reconciliation.

No real source adapter, credential resolver, endpoint, database vendor, service, UI, identity resolver, legal approval, source activation, dashboard or production alert is added. Successful structural parsing, fake ports and synthetic fixtures never prove source rights or production readiness.

Resolved design: a bounded lifecycle engine over injected trusted ports. A types-only contract cannot prove failure semantics; a vendor-backed ingestion service exceeds this task. There are no remaining implementation alternatives in this draft.

## Invariants

1. Only a trusted authority port can supply the exact current registry head; health and structural validity never authorize acquisition.
2. One run pins one registry revision, authorization basis, request digest, reconciliation scope and mapper version. Any policy revision change terminates it.
3. Raw bytes, raw metadata, pending checkpoint and mutation-ledger/outbox record are staged atomically before decode or mapping.
4. Page effects and checkpoint progress commit atomically. Full absence is inferred only by successful finalization of a complete frozen baseline.
5. Stable listing identity is separate from immutable listing-version evidence; observations and tombstones append and never rewrite history.
6. Source text/bytes, URLs, cursors, publication IDs, VIN, PII, secret/legal references and thrown messages never enter errors or telemetry.

## Package and build boundary

- `connectors/_sdk` depends only on public `@auto-world/vehicle-schema` and `@auto-world/source-registry` exports. Dependency direction remains `connector-sdk -> source-registry -> vehicle-schema`; no inverse/private imports.
- Add no external package. Use Node 22 `globalThis.crypto.subtle.digest("SHA-256", ...)` and fatal `TextDecoder`. Export a small default scheduler using `setTimeout/clearTimeout`; lifecycle tests inject a fake scheduler/clock/random source.
- Additive vehicle-schema exports may expose `parseListingId`, `parseObservationId`, `parseConnectorRunId` and `parseRawSnapshotId`; no generic private validator becomes public and no ID-domain cast is allowed.
- Add connector test config/scripts and workspace dependencies/lockfile. Root inventory remains nine packages, becomes three active/six placeholder. Turbo dependency builds must precede SDK typecheck/test.

## Public engine and request

```ts
function runConnector(request: ConnectorRunRequest, ports: ConnectorPorts, signal?: AbortSignal): Promise<ConnectorRunResult>;

interface ConnectorRunRequest {
  readonly schemaVersion: 1;
  readonly sourceId: SourceId;
  readonly territory: Territory;
  readonly acquisitionMethod: AcquisitionMethod;
  readonly audience: "internal";
  readonly fields: readonly SourceField[];
  readonly mode: "incremental" | "full";
  readonly invocationKey: string;
  readonly adapterVersion: string;
  readonly mapperVersion: string;
  readonly limits: {
    readonly maxPages: number;       // 1..1_000
    readonly maxItems: number;       // 1..100_000
    readonly maxRunMs: number;       // 1..86_400_000
    readonly maxEffectMs: number;    // 1..300_000
    readonly maxPageBytes: number;   // 1..1_048_576
    readonly maxJsonDepth: number;   // 1..64
    readonly maxJsonMembers: number; // 1..100_000 per page
  };
}
```

Fields are unique, canonically sorted, and must include `source_listing_id`. Opaque request/version tokens are trimmed ASCII `[A-Za-z0-9][A-Za-z0-9._-]*`, 1..128. The request SHA-256 uses a fixed-order encoding of every validated field and limit. `runId = "run_" + hash("run", sourceId, invocationKey)`; `openRun` permanently binds that pair to the request digest, so changed reuse fails.

V1 executes one page at a time. `mode:"incremental"` is rejected when Source Registry says `incremental:false`, when no completed full baseline exists, or when `now >= lastCompletedFullAt + fullReconcileIntervalSeconds`. Equality is overdue. The first full run opens against an explicit empty baseline and cannot infer pre-existing missing listings.

## Trusted and effect ports

```ts
interface ConnectorPorts {
  readonly authority: AuthoritativeRegistryPort;
  readonly lease: ConnectorLeasePort;
  readonly store: ConnectorStorePort;
  readonly adapter: ConnectorAdapterPort;
  readonly clock: ClockPort;
  readonly scheduler: SchedulerPort;
  readonly random: RandomPort;
  readonly telemetry: TelemetryPort;
}
interface AuthoritativeRegistryPort {
  loadVerifiedCurrent(input: {sourceId:SourceId; asOf:string; signal:AbortSignal}): Promise<VerifiedSourceHead>;
}
interface VerifiedSourceHead {
  readonly trust: "authenticated_current";
  readonly registry: SourceRegistry;
  readonly authorityRevision: number;
  readonly verifiedAsOf: string;
  readonly authorizationBasisRef: string;
}
interface ConnectorLeasePort {
  acquire(input:{sourceId:SourceId; runId:ConnectorRunId; ttlMs:number; signal:AbortSignal}):Promise<SourceLease>;
  renew(input:{lease:SourceLease; signal:AbortSignal}):Promise<SourceLease>;
  release(input:{lease:SourceLease; signal:AbortSignal}):Promise<void>;
}
interface SourceLease { readonly leaseId:string; readonly leaseFence:number; readonly expiresAtMs:number }
interface ClockPort { nowMs(): number }
interface SchedulerPort { schedule(ms:number, onElapsed:()=>void): {cancel():void} }
interface RandomPort { next(): number }
interface TelemetryPort { emit(event:ConnectorTelemetryEvent): void }
```

The SDK validates that authority source/head revision/basis matches the registry/requested time, then calls `evaluatePolicyEligibility` for the exact territory, method, internal audience and fields. TypeScript cannot authenticate this port: production must authenticate operators/current history, verify evidence, and make `authenticated_current` truthful.

The lease is exclusive per `sourceId`, not method, because rate/circuit policy is source-wide. TTL is `max(30_000, 2 * source timeoutMs + 5_000)` (maximum 605,000 ms), renewed by half-life before the next effect. `openRun` installs its fence in store state; all old-fence mutations must be rejected and quiesced before a new-fence caller may interpret an absent receipt as permission to resend. If the store cannot prove quiescence, state remains indeterminate and no resend/removal occurs.

`ClockPort.nowMs` returns a nonnegative safe-integer epoch millisecond converted to exact ADR UTC. The SDK implements deadline races, cancellable sleeps and listener/timer cleanup itself. Every async port call is deadline-bounded and receives a child signal.

## Adapter contract

```ts
interface ConnectorAdapterPort {
  fetchPage(input:FetchPageRequest):Promise<AdapterFetchResult>;
  mapPage(input:MapPageRequest):Promise<MappedPageDraft>;
}
interface FetchPageRequest {
  readonly sourceId:SourceId; readonly runId:ConnectorRunId; readonly pageOrdinal:number;
  readonly cursor:string|null; readonly mode:"incremental"|"full";
  readonly maxResponseBytes:number; readonly attempt:number; readonly signal:AbortSignal;
}
type AdapterFetchResult =
  | {readonly success:true; readonly page:AcquiredPage}
  | {readonly success:false; readonly failure:{readonly kind:"rate_limited"|"transient"|"terminal"; readonly retryAfterMs?:number}};
interface AcquiredPage { readonly pageIdentity:string; readonly bytes:Uint8Array; readonly nextCursor:string|null; readonly complete:boolean }
interface MapPageRequest {
  readonly sourceId:SourceId; readonly runId:ConnectorRunId; readonly territory:Territory;
  readonly acquisitionMethod:AcquisitionMethod; readonly fields:readonly SourceField[];
  readonly raw:RawReference; readonly decoded:JsonValue; readonly signal:AbortSignal;
}
interface MappedPageDraft { readonly items:readonly MappedItemDraft[] }
```

The adapter must enforce `maxResponseBytes` while reading/streaming and honor abort; the SDK rechecks returned length before hashing/storage. A post-return check alone does not bound network download. The engine runtime-validates all outputs. Only typed rate-limit/transient failures can retry; arbitrary throws/terminal results do not.

`pageIdentity` (1..256), cursor (0..2048) and source publication ID (1..256 per ADR-0001) are bounded opaque data, never URL authority or error/log values. Every active item requires `sourceListingId`, optional URL, `outcome:"active"`, and 0..16 exhaustive V1 observation drafts; every withdrawn/deleted item requires `sourceListingId`, no URL/observations and explicit outcome. An empty final page is valid; every nonempty item has `sourceListingId`. Total observations/page <=100,000.

The mapper cannot supply canonical IDs, source/run/raw/digest provenance, `observedAt`, vehicle identity or arbitrary fields. The SDK captures `capturedAt` on first accepted acquisition, stores/reuses it with raw, and applies it to observations/explicit tombstones. Source-native dates remain raw. A full VIN draft supplies only status/VIN; SDK binds internal visibility and pinned authorization basis.

Exact duplicate drafts collapse. Same-field different values/confidence become distinct immutable observations. Duplicate publication IDs within one page or across any pages of the same full run are terminal adapter-output conflicts, including active/ended duplicates. The full run's durable staged publication set detects these before page commit. Different invocations may append new evidence for the same stable publication.

## Strict JSON profile

Implement a bounded scanner/parser, not `JSON.parse` alone.

- Reject >1 MiB before decode, UTF-8 BOM, malformed UTF-8, malformed/trailing JSON, non-JSON/overflow numbers, lone escaped surrogates, depth/member overflow and keys `__proto__|prototype|constructor`.
- Compare member names after escape decoding, so `"a"` and `"\u0061"` conflict. Do not Unicode-normalize otherwise.
- Construct dense arrays/null-prototype objects; bound total members plus array elements.
- Errors expose only stable code and location class/offset, never bytes, text, keys or thrown messages.

## Storage primitives and atomicity

```ts
interface ConnectorStorePort {
  openRun(input:OpenRunRequest):Promise<OpenRunResult>;
  reserveAttempt(input:ReserveAttemptRequest):Promise<AttemptReservation>;
  completeAttempt(input:CompleteAttemptRequest):Promise<SourceRuntimeState>;
  stageRaw(input:StageRawRequest):Promise<StageRawReceipt>;
  loadStagedRaw(input:LoadStagedRawRequest):Promise<StagedRawPage>;
  commitPage(input:CommitPageRequest):Promise<PageCommitReceipt>;
  finalizeFullRun(input:FinalizeFullRunRequest):Promise<FullRunReceipt>;
  lookupMutation(input:LookupMutationRequest):Promise<MutationReceipt|null>;
  recordRunTerminal(input:RecordRunTerminalRequest):Promise<void>;
}
```

All mutation inputs include `schemaVersion:1`, source/run ID, stable operation key, current lease fence and child signal. Each successful mutation atomically appends a versioned immutable `ConnectorMutationRecord` plus outbox-ready sanitized event. Ledger is recovery/audit evidence; telemetry is best-effort and never substitutes for it.

### `openRun`

Under the new fence, atomically: quiesce/invalidate old fences; claim invocation/request SHA; load identical running/completed checkpoint or create one; pin request/start, registry revision/config SHA/basis and immutable `PolicyObligations`; pin full scope/prior active baseline/last full time or validate incremental capability/baseline/cadence.

Completed exact replay returns the stored result without adapter and without comparing a newer inventory baseline. For an existing running checkpoint, request/policy must match, and the current inventory must still be the checkpoint's expected inventory head: it never silently rebases to a later generation. The expected head includes this run's own previously committed incremental changes. Any other writer's inventory change conflicts. First full baseline is explicit empty.

`PolicyObligations` stores the exact contextual grant, authorization expiry, takedown references and retention/access rules. Effective raw TTL is the minimum of `rawSeconds`, `piiSeconds` when `seller_pii` is requested, and `mediaSeconds` when requested media has `licensed_copy` mode. Media `reference` permits references only, not copied assets; its zero asset retention does not prohibit retaining reference metadata under the raw rule. No generic decoder proves minimization; adapter onboarding must enforce that distinction. Reject a nonpositive applicable TTL. Raw `retainUntil=min(capturedAt+effectiveRawTTL,authorization.validUntil)`. Normalized/media/PII deadlines use matching retention and the same authorization ceiling; normalized VIN is internal under the pinned basis, not an implicit public projection. Cache has separate `cacheUntil=min(capturedAt+maxAgeSeconds,normalizedRetainUntil)` when allowed; caching false means null. These immutable rules/deadlines enter raw/page commands and are never rewritten. Retention expiration blocks loading or mapping staged raw, even on exact replay; records of prior effects remain audit metadata, not permission to retain or process expired bytes.

Checkpoint binds request SHA/start/territory/method/fields/mode/versions/limits, authority revision/config SHA/basis/obligations, scope/baseline/last full time, next page/cursor/counts, `pendingRaw`, fence and running/completed status. Failed/cancelled attempts are separate ledger records and identical running checkpoint may resume.

### Source-wide attempt reservation

`reserveAttempt` is one fenced source-wide CAS over `{revision,nextRequestAtMs,circuit:{state,consecutiveTransientFailures,openedAtMs,probeOwnerFence,probeExpiresAtMs}}`. It advances `nextRequestAtMs` by `ceil(60_000/requestsPerMinute)` before fetch. Engine sleeps to reservation, renews lease and rechecks pinned authority.

Reservation key is `reserve_` + hash(`attempt-reservation`, runId, leaseFence, pageOrdinal, attempt). CAS returns this key, runtime revision, `notBeforeMs=max(now,nextRequestAtMs)` and whether it owns the half-open probe. The new next-request time is `notBeforeMs+ceil(60_000/requestsPerMinute)`. `completeAttempt` binds exactly this reservation key and fence and can apply its outcome once only; changed duplicate completion conflicts. Lost reservation acknowledgement is not retried in place: a new fence uses a new key and consumes a fresh rate slot. A consumed or expired old-fence reservation never authorizes a new fetch.

Five typed transient failures open circuit for 60,000 ms; rate limits do not count. Half-open admits one probe owner fence. Ownership expires after source timeout and takeover requires fenced CAS. Late stale owner cannot update state. Successful acquisition closes/reset circuit even if decode later fails.

### `stageRaw`

After acquisition and authority recheck, one fenced transaction immutable-create-or-confirms exact copied bytes/metadata/retention obligations, sets checkpoint `pendingRaw` with page identity/ordinal, snapshot/digest/length/capturedAt, next cursor/finality and operation key, and appends ledger/outbox. It does not advance page/cursor/items/inventory.

Same operation/key/bytes returns same receipt; changed reuse conflicts. `loadStagedRaw` returns exact defensive bytes plus pending metadata after restart, so decode/map resumes without source fetch. There is no intent without durable bytes.

Lost stage/commit/finalize acknowledgement is indeterminate. A new lease uses `openRun` to prove old-fence quiescence, then `lookupMutation`: matching receipt resumes; explicit absence permits identical resend; mismatch conflicts. Without both proofs, no resend/removal.

### `commitPage`

One fenced transaction verifies pending raw/digest, appends observations and immutable `ListingVersionEvidence`, CAS-updates stable `ListingProjection`, appends explicit lifecycle tombstones, stages full active membership, clears pending raw, advances checkpoint/cursor/counters, and appends ledger/outbox. Raw/normalized commands carry immutable obligations/deadlines.

`listingId=hash(sourceId,sourceListingId)` is stable projection identity. `listingVersionId=hash(listingId,connectorRunId,snapshotId,SHA-256,mapperVersion)` is append-only evidence containing URL, observation IDs, raw reference and capturedAt. Projection points to latest evidence; old versions remain. Withdrawn/deleted items are excluded from active staged inventory and retain full raw provenance.

Explicit withdrawn/deleted outcomes are valid only for `deletionMode:"explicit_tombstone"|"both"`; otherwise mapper validation fails before page commit. Incremental page commits add active publications and remove explicitly ended publications from the current scoped active inventory atomically, updating the checkpoint's expected inventory revision. This ensures the next full run sees incremental changes in its baseline.

### `finalizeFullRun`

Require contiguous committed pages, final marker, unchanged authority/scope/baseline and valid fence. For `deletionMode:"full_reconciliation"|"both"`, compare staged active-only membership with pinned prior active inventory, excluding explicit ended from inferred missing; atomically append scoped missing tombstones for other absences and replace active inventory with the staged actives. For `explicit_tombstone` only, never infer missing: the new active inventory is prior actives union staged actives minus explicit ended, so unseen prior actives remain. Both branches swap generation and record full cadence/checkpoint completion and ledger/outbox. This operational-capability gate does not establish legal rights.

Missing means absent from completed `(source,territory,method)` membership, not global deletion. Evidence references run/scope/baseline/new generation/finalization key/completedAt, never final-page raw. Partial/failed/cancelled/revoked/indeterminate runs cannot infer absence or change current inventory.

## Keys and provenance

All hashes use SHA-256 over UTF-8 `aw-connector-v1\0`, then the key kind and each scalar part encoded as ASCII decimal UTF-8 byte length, `:`, exact UTF-8 bytes, `\0`. The kind is framed as another length-prefixed part, so boundaries are unambiguous. Output is 64 lowercase hex characters. No URL, locale conversion, Unicode normalization or generic object serialization participates. Golden vectors freeze:

- page = run+ordinal+page identity; raw = source+page;
- scope = source+territory+method; listing = source+publication;
- listing version = listing + **run+snapshot+SHA** + mapper version;
- observation = listing+field+fixed value+confidence+capturedAt+**run+snapshot+SHA**+mapper version;
- explicit tombstone = scope+publication+outcome+capturedAt+**run+snapshot+SHA**;
- full generation = hash(`inventory`, scope, runId, pinned baseline generation or the fixed `empty` token);
- finalization = hash(`finalization`, scope, runId, pinned baseline generation or `empty`, new generation, final page commit key);
- inferred missing tombstone = hash(`missing-tombstone`, scope, sourceListingId, pinned baseline generation or `empty`, new generation, finalization key). These formulas are acyclic and distinguish every absent publication.

Every branded ID passes its public parser. Mapper version is immutable per claimed run; future raw reprocessing is a separate contract.

## Errors, retry, deadline and cancellation

```ts
type ConnectorRunResult =
  | {status:"completed";runId:ConnectorRunId;pages:number;items:number;checkpointRevision:number}
  | {status:"failed"|"cancelled";runId:ConnectorRunId|null;error:ConnectorError;checkpointRevision:number|null};
interface ConnectorError {
  readonly code: ConnectorErrorCode;
  readonly phase:"authority"|"lease"|"open"|"reserve"|"acquire"|"stage_raw"|"decode"|"map"|"commit"|"finalize"|"runtime";
  readonly retryable:boolean; readonly attempt:number;
}
type ConnectorErrorCode =
  | "invalid_request" | "runtime_capability" | "cancelled" | "deadline"
  | "authority_untrusted" | "authority_regression" | "policy_revision_changed"
  | "policy_ineligible" | "policy_revoked" | "full_reconciliation_required"
  | "lease_unavailable" | "lease_lost" | "fence_not_quiesced"
  | "circuit_open" | "rate_limited" | "acquisition_failed" | "payload_too_large"
  | "invalid_utf8" | "invalid_json" | "json_too_deep" | "json_too_large" | "duplicate_member"
  | "adapter_output_invalid" | "idempotency_conflict" | "checkpoint_conflict"
  | "mutation_indeterminate" | "raw_conflict" | "cursor_cycle" | "limit_exceeded"
  | "retention_expired" | "store_failed" | "finalize_failed";
```

`runId:null` only before valid derivation. Attempt is 0 before acquisition, 1..21 afterward. Only acknowledged rate-limit/typed transient results retry, at most `maxRetries+1`; other stop gates may end earlier. Full jitter `floor(random*(min(30_000,250*2^retryIndex)+1))`; valid Retry-After 0..300,000 uses max.

Staged raw expiry is terminal `retention_expired` in phase `stage_raw` before load/decode/map. Equality with retainUntil is expired; this also applies to resumed runs. Never refetch under an already bound raw key to hide expiry.

Unacknowledged adapter deadline is terminal: request abort, ignore late result, never overlap retry because arbitrary code cannot be preempted. Read/map deadline is terminal. Lease/store mutation deadline is indeterminate and needs new-fence+receipt recovery. Every settlement cancels timer/listeners.

Cancellation starts no new effect, advances no uncommitted checkpoint and never finalizes partial full. Staged raw/page evidence remains. Late old-fence results cannot mutate after `openRun` establishes new fence; otherwise production store is invalid.

## Durable events, telemetry and operations

Atomic ledger/outbox kinds: `run.opened`, `attempt.reserved`, `raw.staged`, `page.committed`, `full.finalized`, `circuit.changed`, `run.terminal`. Payloads contain versions, opaque IDs, revisions/fences, timestamps, bounded counts/bytes, outcome and stable code only.

Telemetry mirrors sanitized signals best-effort; sink failure cannot affect rights/state. Neither ledger nor telemetry proves deployed exporter/dashboard/alert. Dashboard/alert is not applicable to this generic library and remains a blocking prerequisite for first real source, recorded explicitly rather than fabricated.

## Execution and gates

1. After Architect/Critic approval, branch `codex/task-0004-connector-sdk` from verified main. Commit ADR-0003 first, then task IN_PROGRESS and draft PR.
2. Main integrator owns ADR/API freeze/lower ID parsers/build graph/integration/evidence/CI/merge. Executor owns SDK implementation. Test engineer owns independent fixtures after freeze. Final code/security reviewer and architect are independent.
3. Run connector/dependency lint, typecheck, tests, build; forced root `pnpm check`; secrets/audit; fresh HTTPS clone frozen install/direct tests without `dist`.
4. Resolve reviews. After implementation review/CI green, commit validation/operational/security/rollback evidence and DONE; rerun final-head CI, merge, verify main, then TASK-0005.

## Pre-mortem

1. Old timed-out write wins after takeover: prevent with source lease, `openRun` quiescence, fenced mutations and no resend without receipt absence.
2. Partial full sync withdraws inventory: prevent with pinned active baseline, finalization-only comparison and fail-closed indeterminate state.
3. Stable listing overwrites evidence: prevent with full-provenance append-only version plus atomic projection CAS.

## Stop rules

TASK-0004 finishes only after executable synthetic criteria, targeted/root/fresh-clone/final-head CI, independent approvals, committed evidence, merge and verified main. Real activation remains blocked without authentic authority/evidence, credentials, source-specific minimization/fixtures, durable fenced store/lease, encryption/retention/takedown workers, telemetry backend/dashboard/alerts and operations review.
