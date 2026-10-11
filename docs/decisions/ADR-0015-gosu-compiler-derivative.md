# ADR-0015 â€” Traceable gosu compiler derivative

Status: PROPOSED for the next bounded TASK-0005A source-preparation increment; independent architecture/security review and all implementation gates pending.

## Context

Current exact audit [38181226203](https://github.com/CleMeY15/auto-world/actions/runs/38181226203), attempt1 on protected main969dfb9317f49da8912646328d9155debf8a8e20, authenticates two identical corrected scanner builds and complete controls with zero scanner vulnerabilities. The unchanged PostgreSQL candidate digest0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93 remains COMPLETE/BLOCKED: usr/bin/gosu contains stdlibv1.26.8 and three HIGH findings, CVE-2026-78667/78669/97031, fixed1.26.9. Its16-role1773793-byte original ZIP/SHA2562fcf807f55dcd05d14293bc0f1a71016ad6af867525d27cfe5c0ffae97c511af is verified; cleanup CLEANED, no projection, support or activation follows.

The existing recipe installs the signed Alpine gosu1.19-r5 APK and verifies its Go1.26.8 binary. A separately compiled binary cannot reuse that APK identity/signature. Preserve every historical V1 recipe, receipt, archive, locator and generation duty; generation3's failed SQL stays NOT_ACCEPTED_NO_RETRY. The existing Java-age and external-fork-test user decisions remain unchanged.

## Decision and bounded first increment

Prepare an explicit internal component identity auto-world-gosu/1.19-go1.26.9-r1 from immutable upstream gosu1.19 commit6456aaa0f3c854d199d0f037f068eb97515b7513. It retains the real Go main module github.com/tianon/gosu; no Alpine package claim, fake Git metadata, source version or vulnerability exception is introduced.

The first increment adds only unused versioned source locks, a Linux/amd64 build preparer, strict build/control receipt validation, source/module/license evidence, tests and a manual read-only two-build workflow. It does not replace the current Dockerfile, remote candidate policy, publisher, current audit or admission consumer. No image construction/publication, registry write, Native extraction/installation, scheduler mutation, SQL retry, generation6 inventory or support date is part of this increment.

Pin distinct original material bytes: the commit archive https://codeload.github.com/tianon/gosu/tar.gz/6456aaa0f3c854d199d0f037f068eb97515b7513 is17631bytes/SHA25633d7537d588ea49458b9509bcf4554bdf5ceacc66da71e5caa1058ea3b689c3b. This is not the17622-byte historical Alpine tag archive. Pin official Go1.26.9 linux/amd64 compiler archive66935201bytes/SHA25642d158b4d8f7b61ac0a830567c940a86098fb7aac52e467a5ebec03ef5cc2f8d and official Go source archive34162146bytes/SHA2569735d7dcdb65b35d3fa577f04064737c03b89cf1a2b71e6e69fe2f3c6f9fd4ca. Module closure is exactly github.com/moby/sys/user v0.1.0 and golang.org/x/sys v0.1.0, with archive lengths/SHA256 and upstream go.sum h1/go.mod h1 pins. No new module dependency is authorized.

Download/authenticate only fixed public asset URLs before compilation. Preserve verified original compiler/source/module archives and required LICENSE/PATENTS texts. Enforce safe bounded archive structure, exact selected file hashes and the one declared gosu .dockerignoreâ†’.gitignore symlink without following it. Use a fresh ordinary-user workspace and independent compiler/module/build caches. Reject occupied targets, symbolic ancestors, source mutation, replacement/material mismatch and unexpected dependency/build metadata. No historical private-retention operator or Root profile participates.

Build from the authenticated archive without inventing a .git directory. Set GOTOOLCHAIN=local, GOWORK=off, CGO_ENABLED=0, GOOS=linux, GOARCH=amd64, bounded isolated caches and exact flags -mod=readonly -trimpath -buildvcs=false -ldflags='-d -w -buildid='. The receipt explicitly declares VCS stamping disabled and binds the upstream commit through the source archive identity; it must never claim embedded VCS authentication. Authenticate module downloads with Go sumdb and upstream go.sum during preparation, run go mod verify, then compile/test with network resolution disabled. Record actual upstream test outcomes, including zero test cases if applicable; compilation alone is not a test claim.

Retain the binary, SHA256/length, actual go version and go version -m, exact main/dependency/stdlib identities, flags, deterministic CycloneDX SBOM, license/notice closure and source/archive bindings. Use closed new kind POSTGRES_GOSU_DERIVATIVE_BUILD_RECEIPT_V1, state PREPARATION_ONLY, authority NOT_AUTHORIZED, with null support dates. Public output contains no host paths, identities, tokens or internal exception text. The validator detaches inputs, rejects unknown/malformed/duplicate fields and authenticates bytes rather than trusting a self-reported digest.

Two independent Linux jobs perform actual builds from the same locked materials. The comparison validates each receipt independently against its retained bytes, then compares binary, build-info, module closure, SBOM and license identities. No expected output hash is invented in advance. The resulting real hash is a preparation result only; a later separately reviewed candidate lock must pin it before installation/publication. The manual workflow has contents:read only, no secrets/packages/attestation authority and no automatic dispatch. Source delivery needs final-head CI, identical reviewed merge tree and matching main CI; real independent build evidence follows on that reviewed main.

## Later dependent phases and rollback

A separate candidate increment will add a distinct Dockerfile, exact filesystem-delta validator and V2 publisher/remote/audit contracts, while preserving V1. It will keep the APK database unchanged, replace only the agreed gosu executable path, and carry the derivative manifest/notices. Publication uses the existing private GHCR package under a new immutable digest and remains PUBLISHED_UNADMITTED.

Only actual new-subject remote read, zero-blocker audit, runtime/restore, source closure, attestation and second-copy evidence make a new generation6 PENDING inventory eligible. Its dates/currentEvidence remain null; activation requires a distinct reviewed Native recipe/locator/health/duty and checkpoint. The one-calendar-year support plus continuous security controls and at least365 elapsed archive days after support remain the accepted policy.

Rollback for this preparation removes/abandons only its unused new files and owned scratch outputs, retaining failures and evidence. It grants no right to revive the vulnerable candidate or retry generation3 SQL. Existing generation3 duties and generation4/5 history continue independently.

## Primary references

[gosu source commit](https://github.com/tianon/gosu/tree/6456aaa0f3c854d199d0f037f068eb97515b7513), [Go downloads](https://go.dev/dl/), [module authentication](https://go.dev/ref/mod#authenticating), [go build](https://pkg.go.dev/cmd/go#hdr-Compile_packages_and_dependencies), [go version -m](https://pkg.go.dev/cmd/go#hdr-Print_Go_version), [ADR-0007](ADR-0007-private-image-admission.md), [ADR-0011](ADR-0011-postgres-admission-runtime.md).
