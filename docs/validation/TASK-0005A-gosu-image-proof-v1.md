# TASK-0005A — conditional Gosu image pair proof

Status: SOURCE_IMPLEMENTATION_VALIDATED. The [B1b.1 plan](../../roadmap/plans/TASK-0005A-gosu-image-proof-v1.md) received Architect CLEAR followed by distinct Critic OKAY on 2026-10-20, including its pinned Docker28 layout amendment. This document separates delivered format interpretation, accepted format observations, the new source proof and any later actual-image acceptance. Exact-head and merged-main delivery are separately verified in the associated PR. TASK-0005A and TASK-0005 remain IN_PROGRESS.

## Verified prerequisites

[PR182](https://github.com/CleMeY15/auto-world/pull/182) delivered the bounded image-layer hardlink correction on main `686fe4182dc33ddcb2b326ed341479cbdfbc5200`, tree `743ce094b04eecccb34402eb1e2851021494c5ec`. Exact source CI `39147730900` and merged-main CI `39149012725` succeeded. This source delivery resolved the TAR type1 blocker, without expanding outer/context archive semantics.

Two distinct reviewers independently accepted each current-only format observation after normal root/parent/child completion, full archive identity checks, closed original reports and postguards:

| Subject | Archive bytes / SHA-256 | Observed layers | Accepted scope |
| --- | --- | --- | --- |
| BASE | 300058112 / `6851bcdfcc72bccb8b8348798f47843620a14e66a63061025f3e7733d2c76812` | 10 USTAR, zero opaque | Current format only |
| CANDIDATE | 302052864 / `43455e26465259ef7abd7bed1c7e10a474aa3d86d604d9ac229eebd230955508` | 12 USTAR, zero opaque | Current format only |

The BASE acceptance identity is 1881 bytes / SHA-256 `5899735ea7e60b81d085c35fb863e3ab75e3a0476d1267427c3ae7a2f462868b`. The candidate actual V2 root index is 5280 / `7d380adce057e26e75b73c0fa2b355f5dd3e9699e9b0d84e3422fadfa76dfc3d`; its authoritative acceptance metadata V3 is 3325 / `acf3cca11ee71ce59dbfdf0f46f174dde7dc5a430ed1f835b5aec3f308fc2f7a`, reviewed on 2026-10-20. V3 corrects timestamp attribution only: the operation generation remains V2, observed on 2026-10-18; its one-shot record says `2026-10-18T18:59:46.628239+00:00`. No precise read-completion timestamp is claimed. Earlier candidate V1 failed and its raw bodies remain unread; no failed generation is converted to success.

The candidate full-config identity is `sha256:1dcf51ff6c1f198e520e13096b41c49d173e66743eb9a9deaed8d2788b459037`. Its provenance is ARCHIVE_SELF_DERIVED_CURRENT_ONLY. Neither accepted format observation provides the complete member paths/configuration/history or an independently authenticated build window required to accept a real pair under B1b.1. These native archives and consumed controls are not reread or replayed for this source increment.

## Source contract

The new pure module snapshots native input bytes before any asynchronous work and binds each archive to a complete-byte identity supplied by its caller. An opaque module-local handle retains parsed metadata, never archive bodies or a native path. The exact profile accepts raw USTAR Docker-save containers with a single linux/amd64 image, ten base layers, twelve candidate layers and the same first ten layer bytes/DiffIDs. Content-addressed `blobs/sha256` members follow the [pinned Moby28 exporter](https://github.com/moby/moby/blob/6430e49a55babd9b8f4d08e70ecb2b68900770fe/image/tarexport/save.go). The legacy manifest and direct single-image OCI index/manifest must select the same complete config and ordered raw layers, with exact descriptor sizes and hashes. Nested or multiple OCI image selections, alternate media types, outer archive links, compression, PAX, whiteouts, special files and unsupported link/ancestor semantics are refused. These limits do not assert that every Docker-produced archive has this supported shape.

Layer application preserves directory children on directory replacement and models hardlinks as shared inodes, so later replacement cannot redirect an old alias. The pair proof limits both added layers to the genuine candidate contract, compares full config and history relationships, checks nanosecond timestamps against the supplied bounded build window, and runs the existing genuine filesystem/runtime-config V2 predicates. The production caller cannot supply a contract or validator. Input/proof failures expose only three closed codes, with no untrusted parser content.

The deeply frozen result is explicitly CONDITIONAL_ON_AUTHENTICATED_ARCHIVES_AND_BUILD_WINDOW, with authority NOT_AUTHORIZED. Its nine fields identify the byte pair and report fixed profile/counts and the genuine V2 delta. Authentication of the supplied identities/window remains a separate caller obligation. No historical G2, source/build provenance, functionality, vulnerability clearance, publication, admission, activation or support conclusion follows.

## Validation and delivery

Before implementation, existing candidate/filesystem/shared-archive/admission regressions pass 46/46 on each pinned Node22.23.2 Windows and Linux actor; independent final review repeats those same regressions successfully. The workspace dry run resolves fourteen actual tasks for each requested lint/typecheck/test/build target; dependent gates resolve the additional tasks recorded below.

Fixtures are real small USTAR and Docker-save byte streams. The complete positive fixture is explicitly FORMAT_ONLY: its VM substitutes candidate-lock authenticity while the real archive scanner and filesystem/configuration predicates execute. This is synthetic source evidence and cannot accept a real image. The genuine public API and synthetic-content rejection remain tested separately.

The frozen module is 26967 bytes / SHA-256 `6818bf2d3cc192b7968f441f6d5a0e3fd38c1969ac78012489b55250bb6e9c35`; its independently authored test is 39293 / `cbd62d5d1f1083721b20e6ced628b6e9f37b34f322f187cf15ec491d6bda20d1`. Pinned Node22.23.2 Windows and Linux each pass 16/16 direct VM scenarios without skips. The ordinary wrapper on each OS executes and asserts the same sixteen cases, so standard CI does not silently skip VM coverage. Real-fixture hostile mutations cover OCI/legacy divergence, digest/size/order/media types, unsupported formats, inode aliases, directory/ancestor changes, byte views/handles, JSON/TAR budgets, runtime/full config/history and nanosecond boundaries. An explicitly test-only VM boundary probe calls the unchanged internal ancestor guard at live-node100001; no production hook or substitute validator is added.

Distinct architecture and code/security reviewers report CLEAR_CODE_CONTRACT_ONLY and CLEAR on those exact final module/test identities, with no material findings. Fresh syntax, strict lint, targeted VM/wrapper and 46-case dependent regressions support their reviews. The earlier test-reporter and inferred-ancestor coverage findings were fixed before final review. Neither review accepts a real image or a build window.

All six full local gates pass under Node22.23.2/pnpm10.15.0: lint14 tasks, typecheck21, tests28 and build14, plus Secretlint1031 tracked files and dependency audit with no known dependency vulnerabilities. Reported Turbo cache counts are 0/0/6/13 respectively. Root TAP reports2013 tests,1569 passes,444 explicit platform/actor exclusions and0 failures; the new wrapper executes all16 cases internally. Source/test hashes remain identical before/after every gate. The first lint attempt stopped at a global launcher pointing to a deleted temporary Corepack path; its original failed output remains retained. Activating shims only in the already owned persistent Node22 directory repaired that tooling, without code/test, global configuration or dependency changes; the complete second run passes. Dependency-audit TLS verification remains enabled with process-local system CAs.

These are local source results. Fresh exact-final-head CI, identical reviewed merge content and merged-main CI must be verified separately in the PR before source delivery; local checks do not imply that those steps have happened. No native archive/context read, build, publication or activation occurs in this increment. All three existing ADR/task prefixes and unrelated tracked source remain unchanged.

## Operations and rollback

This module has no filesystem, command, network, build, publication or activation entrypoint. A future actual caller needs separate review, authenticated archive identities and an independently retained build window; source tests cannot supply them. Revert only this unused module/test and the appended documentation through focused review. Preserve all existing originals, consumed controls, failed attempts and daemon ownership boundaries. No migration or dependency change is needed.

`currentEvidence` remains unchanged; support dates remain null. The agreed one-year support period with continuous security controls starts only at reviewed activation; archive retention extends at least 365 days beyond support end. The remaining PostgreSQL publication/audit/runtime/restore/source/attestation/second-copy/admission work and four-service foundation acceptance still block completion of TASK-0005 and its supported downstream dependencies.
