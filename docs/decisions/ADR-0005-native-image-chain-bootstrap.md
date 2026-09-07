# ADR-0005 — Prepare native image tooling without publication capability

Status: Accepted for secret-free preparation only; privileged activation BLOCKED.
Date: 2026-09-07
Scope: TASK-0005A preparation from accepted main, before TASK-0005B.

## Problem and decision

TASK-0005's draft PR #7 passes service integration but fails its six-image audit. The user authorized an owned, corrected, signed private image chain, retaining every CRITICAL and fixable HIGH blocker. Upstream alternatives tested so far also fail. Preparing native tooling is useful independently of enabling publication.

The repository is private, main is unprotected, and GitHub returned HTTP 403 for both repository rulesets and main branch protection on 2026-09-07: `Upgrade to GitHub Pro or make this repository public to enable this feature.` No environments or repository secrets exist. Repository secrets and read-only default token permissions do not isolate hostile same-repository workflows: another job can request broader permissions. Environment policy would protect its secrets, not another job's token.

Implement only source/material locking, secret-free native builds/tests/audits, bounded evidence/OCI validation and a capability-free dormant workflow. No durable keys, secrets, environments, packages permission, registry writes, publisher/component dispatch, or activation toggle exist in this milestone. A later privileged design requires actual server-side main/publication protection and a new independent Architect then Critic review. Do not purchase services, make the repository public, broaden a PAT, create a publisher repository or use the workstation as publisher.

## Material and build contract

- ORAS 1.3.4: source `db9e29505c3059f2b8fde34ae8cae266c5c765e9`. Its annotated tag `2f11c9ec2d4816bf0a7a709f7a51ed5ca5d2d5c5` has a GitHub-verified SSH signature, distinct from the source commit's web-flow PGP signature and ORAS release GPG key. Release checksum signature key fingerprint: `C6FC42F0DE84A345FAADB742F44418110791EF37`. The reference Linux archive hash is `f27adb935022d94df8dc77719c322dda592c78a0d57a6f7dcdd8d900b248c454`; its Go 1.25.14 executable is not adopted.
- Cosign 3.1.3: source `11926fa5bbbbde47e88fc006b625a17769b743b2`, native Linux/amd64 and Windows/amd64 outputs. Prior Windows proxy-denial probes are semantic diagnostics, not native admission or airgap proof.
- Trivy 0.74.0: source `e1fd17a0ea4a8cf24bc4b4dd7e2cfbf4bb31b994`, explicit gRPC 1.82.1 to 1.83.1 correction. Preserve upstream assertions while locking mutable Git/RPM/Mage/WASM test prerequisites. Any further dependency patch requires exact-diff dependency/security review.
- Compiler: Go 1.26.8. Linux archive SHA256 `d0f743b33e8d8945e6b1f432edd15785c70507121d6e2a723b21285eddf8b57b`; Windows archive SHA256 `b92c3b2adae85a11ba71fe7216daf0d84e82af4c8ab6c5625807f28622043a59`.

Lock-update is an explicit secret-free operation that produces a reviewable proposal. Eligible builds consume committed source/compiler/archive/module ZIP/checksum/test fixture/patch/recipe identities, verify bytes, disable toolchain switching and refuse resolution or lock drift. Candidate code and upstream tests run only on secret-free Linux CI. No new npm dependency or hidden tool container is introduced. Record the managed ubuntu-24.04 runner image and utility identities as an explicit managed-service trust boundary.

The actual GitHub source archive uses PAX metadata, which the OCI archive boundary intentionally refuses. Acquire the exact source Git commit without inherited credentials/hooks/filters/submodules, verify its tree and safe entry inventory, then create a deterministic USTAR source archive using managed Git/tar. Lock the tree, archive SHA256/size and canonical recipe; each eligible build repeats this acquisition and refuses drift. Do not enable PAX in the OCI validator to accommodate a source-download format. Compiler archives retain their official byte hashes and strict pre-extraction validation.

Two independent fresh builds must yield identical bytes for every native executable. Native audit is a separate schema from image audit: bind exact binary hash/size/platform, Go build-info/module graph, SBOM, source/material/recipe, scanner binary/version, exact vulnerability and Java database hashes/timestamps, and full findings. Both database UpdatedAt values must be non-future and at most 48 hours old. CRITICAL and fixable HIGH block; unfixed HIGH requires exact independent disposition for at most 30 days, with none granted. Missing inventory, scanner self-exclusion or unexpected detection loss blocks.

States: selected → material_locked → built_candidate → independently_reproduced → audited_candidate → reviewed_admission_proposal. The current scope cannot reach admitted_on_trusted_main or usable_for_privileged_execution.

## OCI and signature contract

The deterministic fixture is an outer named transport `index.json` pointing to a stored inner OCI image index, then a linux/amd64 manifest and canonical zero-layer config. The inner index is the registry/signature parent. Validate the entire graph, exact digest/size/media/platform, no orphan files/blobs, and strict archive paths/types/counts/padding. Never unpack opaque service image layers in a privileged job.

Future ORAS transport is whole-index `cp --from-oci-layout <layout>:bootstrap <fixed-private-target> --to-registry-config <owned-file>`, without platform/recursive/preview/force/debug/header/resolve/insecure flags or credential arguments. Current tests use local fixtures only; there is no private registry write.

The Architect clarified the applicable ORAS gate against pinned upstream tests: full `make test` with unchanged module files and verified HTTP integration test passes, plus actual rebuilt CLI fixture-to-layout and fixture-to-minimal-local-Node-registry positives, and local cross-origin/auth/log negatives. Verify every received blob and the inner parent index independently. This is the upstream unit/HTTP suite plus Auto World integration of the selected `cp` subset. The extended upstream Docker/Ginkgo/three-registry E2E suite is unprepared, unexecuted and not claimed. A Node test server does not prove GHCR interoperability; that remains blocked activation work.

Disposable Cosign tests use explicit keys, `--use-signing-config=false --tlog-upload=false` when signing and `--insecure-ignore-tlog` when verifying. Prove valid, wrong-key and tampered inputs in an actual network-disabled Linux namespace. Remove only owned temporary private keys. Blob proof does not replace future image signing/export/registry proof.

## Limits and operational behavior

| Input or operation | Maximum |
| --- | --- |
| Fixture JSON / layout / synthetic asset | 4 KiB / 32 KiB / 256 KiB |
| Native executable | 512 MiB |
| Source/module/notice archive | 2 GiB |
| Source closure per tool | 4 GiB and 200,000 entries |
| SBOM or full scan | 64 MiB |
| Receipt/provenance JSON | 8 MiB, 100,000 members, depth 32 |
| Native CI artifact / job consumption | 6 GiB / 8 GiB |
| ORAS / Cosign / Trivy build and upstream tests | 30 / 60 / 90 minutes |
| Audit job / individual scan | 45 / 10 minutes |
| Root / fixture job | 20 / 10 minutes |
| Policy subprocess / owned cleanup | 60 / 120 seconds |

Reject overflow before allocation; use streaming hashes for large bytes. Diagnostics use fixed phase/status/code/duration and public identities, never raw source values, private environment or unsanitized subprocess errors. Timeouts, partial artifacts and missing matrices are failures. Cleanup verifies owned canonical paths and preserves unrelated files.

## Alternatives and consequences

Waiting for conforming upstream releases remains the smallest-maintenance exit but has no current passing evidence. Cosign load requires Cosign-specific annotations and is unsuitable as the generic layout uploader; ORAS's stable whole-index subset was independently selected. Repository secrets, actor/ref checks and mutable activation flags do not establish the required server boundary. Paid/public/expanded-token/external-publisher alternatives are outside present authority.

This bounded preparation may merge only after every preparation acceptance criterion and independent implementation review passes. It then remains `merged_pending_activation`; TASK-0005A and TASK-0005 are incomplete, 5B and TASK-0006 blocked. Future activation needs a protected control plane, disposable environment canary, separate reviewed public-key/custody/admission PR, real private synthetic activation, and a committed activation receipt before 5B. None is approved here.

Diagnostic CI/local artifacts are proposals, not the future supported-runtime retention archive. If they expire before admission, rebuild. Future accepted source/notices/SBOM/provenance/signatures need private digest-addressed retention for supported lifetime plus 365 days; deletion or missing closure blocks use. Roll back preparation by reviewed code revert, retaining evidence. Do not alter volumes, backups or existing PR #7 restore safeguards.

## Review and evidence

Actual native dependency-expert selected ORAS; actual Architect then distinct Critic approved preparation plan revision 5 on 2026-09-07. PRD SHA256 `e7f8fb7b5b81ee51fdef6b78b2fc138c0ce527dd04f0e63327a1d9713d34de9d`; test specification SHA256 `d4d0c4de2fd3a868c3dbe6fb33a8e421d2435edc40c62a2221a2fa804e968ad3`. These are plan approvals only. Implementation acceptance is tracked in [TASK-0005A](../../roadmap/tasks/TASK-0005A-native-bootstrap.md) and [validation](../validation/TASK-0005A.md).

Official references: [GitHub environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments), [workflow permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [OCI image layout](https://github.com/opencontainers/image-spec/blob/main/image-layout.md), [ORAS cp](https://oras.land/docs/commands/oras_cp/), [Go module controls](https://go.dev/ref/mod).
