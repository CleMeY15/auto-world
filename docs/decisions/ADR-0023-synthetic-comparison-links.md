# ADR-0023 — Explicit local comparison pointers

Status: accepted for TASK0113 implementation after sequential Architect APPROVE/CLEAR and distinct Critic APPROVE, 2026-10-20. Delivery remains separately gated.

## Decision and alternatives
Extend ROADMAP Share with an ordered2–3-publication ID fragment and explicit current-detail loading. Reuse the accepted clipboard UI, V2 expected-ID GET parser, bounded loader, catalogue matching and comparison table. No new API, DTO, dependency, storage, source access or infrastructure.

Frozen values in the fragment would preserve one creation instant/offline rendering but duplicate automotive evidence and its validation, expose more information and invite false freshness. Hosted opaque records would offer cross-device persistence but require unready storage/retention/access policy. The local pointer is the smallest useful independent increment.

## Browser contract
Wire: #comparison-link/v1/<encodeURIComponent(JSON.stringify(ids))>. Maximum1024 raw fragment characters checked before decoding; exactly2–3 distinct validated public ListingIds in order. Reject non-plain/sparse/decorated/accessor arrays without coercion. Decode once, strict JSON, fixed invalid/unsupported recovery without echo. Build a fresh fixed /demo URL from current HTTP(S) origin, reject userinfo/invalid origin and discard inherited query/path/hash. Link IDs address the current runtime, not immutable cross-fixture vehicle identity.

Opening reviews the link count and limits without detail reads, search POST, clipboard or storage changes. Existing catalogue loading is unchanged. Explicit load launches at most3 concurrent existing detail GETs. Full expected-ID success and identical fixtureVersion/taxonomyRelease tuple are required before the table appears. Preserve every requested slot in loading/error outcomes; no silent subset comparison. Successful ended/missing DTO is valid and labelled; HTTP404 is an unavailable read, never inferred withdrawal.

Retain separate per-column dataAsOf/state, with UTC seconds and nonzero milliseconds. Do not synthesize a shared response, common instant or aggregate completeness. Catalogue incompatibility hides authored identity while accepted numeric observations remain usable. Keep observation/confidence/source timestamps distinct from authored declarations; no conversion/ranking/score or vehicle inference.

## Interaction, privacy and failure
Inline secondary creator in existing Compare, explicit copy/manual fallback and current-runtime/local-computer disclosure. Promise resolution alone announces copy success; selection/route replacement invalidates old UI completion. Received screen has explicit load/re-read/return; reload/back/forward never reloads details automatically.

All-or-nothing table acceptance sacrifices partial availability to prevent misleading subset comparisons. Retain numbered slot outcomes and retry-all. Re-read clears prior table, duplicate-click guard prevents duplicate batches, abort/generation/raw-hash checks suppress obsolete completion,15s deadline cleans up pending work. Offline accepted content is explicitly already-loaded, with no automatic network replay.

Closed no-op events comparison_link_created/copied(compare) and comparison_link_loaded(received-comparison), success/error only. No IDs/URL/payload/raw errors. Fragments remain readable by link holders/history/scripts/extensions, not confidentiality or authentication.

## Verification and rollback
The [task](../../roadmap/tasks/TASK-0113-synthetic-comparison-links.md) requires unit/real-browser/adversarial/visual/accessibility/performance evidence, full Windows/Linux gates, independent reviews and exact-source/main CI. Existing comparison behavior is regression-locked before extracting the shared table.

Disable demo or revert increment; no migration. Hosted sharing, durable comparisons, live inventory and all supported infrastructure remain separate gated work. No concurrent edits to shared ROADMAP/DELIVERY or the other infrastructure lane.
