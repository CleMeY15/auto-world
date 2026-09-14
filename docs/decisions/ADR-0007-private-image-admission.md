# ADR-0007 — Private image admission with managed GitHub tooling

Status: Accepted for contract and scanner preparation only; activation remains BLOCKED.
Date: 2026-09-14
Scope: local development and CI data infrastructure, TASK-0005.

## Context and authority

The data foundation in draft PR7 passed real service integration but its container audit failed. PR10 corrects report identity binding; it does not resolve vulnerabilities. PR8's unmerged ADR5 prepared source-built ORAS, Cosign and Trivy while requiring absolute server-side publication isolation. It did not reach native-tool admission. Its private/unprotected repository assumptions are obsolete: the repository is now public and main protection is enabled.

On 2026-09-14 the user requested autonomous roadmap development and, after an explanation of private Docker images, public technical attestation metadata and strict consumer admission instead of absolute branch-scoped registry write isolation, delegated the choice: "Fait ce qu’il te semble le mieux". Adopt that model. This authorizes implementation of this bounded design, not vulnerability waivers, production deployment, new paid services/accounts or an expanded local token.

The completed [ADR-0006 canary](ADR-0006-public-attestation-canary.md) establishes only its recorded fixed-file verification behavior. Its two-run budget is exhausted and its producer retired. It is never image admission evidence and must not be restarted. The recurring roadmap heartbeat remains paused; current development is resumed by the user's instruction.

## Decision and alternatives

Use the existing GitHub repository and managed Linux Actions runners, Docker/BuildKit, official `actions/attest` and official `gh attestation verify`. Record actual runner/tool identities and pin action commits. These components are an explicit managed trust boundary, not independently reproduced Auto World binaries. Do not carry forward PR8's ORAS/Cosign source-build prerequisites or custom signing/registry implementation. A corrected, reviewed and actually tested scanner remains required.

This explicitly supersedes the corresponding proposals in unmerged ADR5/PR8. Preserve that branch and its evidence; no mass merge or historical success claim. Accepted source/data/security contracts and vulnerability thresholds remain unchanged.

Waiting for clean upstream images remains preferable when real fresh audits pass; test them first. Continuing the full native bootstrap would add maintenance without providing GHCR branch-level write isolation. A separate publisher or immutable archive service would need another authority/cost decision and is not selected.

## Integrity, privacy and capabilities

Registry presence is not admission. Same-repository branches may technically obtain package-writing rights; this design does not claim a server-enforced prohibition. Consumers accept only an exact reviewed admitted digest and complete valid evidence, regardless of who can store another object.

There are four separate stages:

1. Scanner preparation and diagnostic audits: `contents: read` only; no private inputs, package write, OIDC or signing capability. Candidate tools can run only in this disposable diagnostic context and cannot approve themselves for later privileged use.
2. Private candidate storage: only after a separate review of the concrete publication workflow and package controls. The reviewed main build job may write unadmitted candidates to private GHCR with `packages: write`, without OIDC/attestation authority. This permits private storage before the final audits; it never permits signing, admission or general use before they pass.
3. Independent audit and runtime jobs: package read only, no registry write or signing. Bind complete results to the exact candidate digest, source/recipe and run. Never execute a failed image outside the isolated diagnostic/runtime test scope.
4. A separate signer: accepts only the exact subject whose required gates pass, runs no candidate code and grants no admission by itself. A reviewed main inventory then records admission. The signing job must not accept arbitrary branch/run/digest parameters as trusted expectations.

Private image layers and private evidence archives must never be uploaded as Actions artifacts in this public repository. Public artifacts may contain only explicitly approved technical scanner/diagnostic material. No business data, listing payloads, credentials or user data belong in image preparation or public evidence.

GHCR's documented first-publication default is private, but actual privacy must be proven before candidate layers are written. The separate activation plan must establish a non-sensitive first-write/package-creation sequence, actual visibility/access checks and anonymous pull denial. If the API or package control cannot prove privacy, no candidate write is allowed. Use only the existing namespace and deterministic package names. Authorized read-only Actions pull must succeed; anonymous retrieval must fail. No local token expansion is assumed: current local authentication lacks `read:packages`.

Before the first registry write, actual Architect then distinct Critic must approve the exact workflow and package/credential/retention plan. Plan approval for scanner preparation cannot satisfy this gate. No publication workflow or permission is introduced by this ADR-only increment.

## Scanner and vulnerability gates

Pin source commit, compiler, patches, module checksums, build recipe and actual binary hash. Review the exact upstream-derived dependency fix rather than taking mutable main. Preserve upstream test assertions, run relevant upstream suites and record coverage gaps. Require full package inventory/SBOM, scanner self-audit, known-vulnerable detection controls, and a comparison using the same captured databases against the old scanner as a diagnostic only. Unexpected detection loss or missing inventory blocks acceptance.

Record complete reports and vulnerability/Java database byte identities. Database update times must be non-future and at most 48 hours old at scan. Historical scans remain historical. An unaudited scanner may generate diagnostic evidence in the isolated lane; it cannot be treated as an admitted tool or be its sole independent approval.

All CRITICAL findings and all HIGH findings with fixes block. An unfixed HIGH needs a finding-specific independent review/disposition expiring within 30 days; none is pre-approved. End-of-life OS, missing reports, wrong repository/digest or missing tool inventory block. Audit every executed runtime/helper image; removing a role from a list cannot hide its use.

The exact `repository@manifestDigest` or `repository@platformDigest` binding from PR10 is required. A digest suffix, tag, unrelated green CI job or substituted report cannot establish a passed image.

## Admission and consumption

Use official verification of the exact OCI subject, repository, certificate workflow/ref, source digest, signer digest, predicate and GitHub-hosted runner. Check all verified statements/subjects. Where CLI policy flags are mutually exclusive, verify both policies separately on the same immutable bundle; do not implement cryptography or rewrite signed contents. Preserve `VERIFIED`, `REJECTED` and `ERROR` distinctions with actual positive controls.

The admitted inventory on reviewed main binds image digest, reviewed build commit and workflow, run, source/recipe, SBOM/audit/runtime evidence and attestation bundle. The inventory merge can be later than the image build: the expected source SHA is the explicitly reviewed build SHA, not an assumption that current HEAD built it. Authentic reviewed policy and revocation/currentness must be established outside candidate-controlled JSON or CLI claims.

Every documented local and CI image execution entrypoint must check authenticated inventory, complete retained evidence, current vulnerability/admission state and exact downloaded digest before running a service/helper. Missing, expired, revoked or substituted evidence fails closed. There is no tag fallback or skip-verification option. Diagnostic execution is explicitly separate from supported startup.

Actual image proof must cover successful private read and official verification, anonymous denial, wrong subject/workflow/source/ref expectations, changed bytes and missing/truncated verifier output. Use paired positive controls and the actual image bundle. No additional branch attestations or rerun of the retired fixed-file canary is required to test wrong expectations.

## Retention, observability and rollback

Retain the complete private image/evidence/source/notices/SBOM/bundle closure for supported lifetime plus 365 days, with explicit support dates and no automatic deletion. GHCR/API objects are deletable; public Sigstore immutability proves cryptographic history, not private availability. Finite Actions artifacts are not the supported-runtime archive.

Before activation, establish a second verified private copy in existing ignored local storage and demonstrate complete retrieval/restore. No new storage service is assumed. Missing access, archive capacity or restoration proof blocks activation. Track a digest-addressed inventory and archive health; loss of required evidence prevents further use until restored. Administrator deletion, workstation loss and provider outage remain disclosed availability risks; this is an operational retention commitment, not immutable storage.

Use fixed phase/result/reason/duration and public hashes/run IDs in diagnostics; never raw credentials or unfiltered private subprocess output. Retain non-secret full scan reports separately from status summaries. Resource limits and owned-path cleanup remain mandatory for builds, scans and restore tests.

Rollback reverts admission to another fully valid supported digest or stops affected services. Never fall back to a revoked/vulnerable digest and never delete data volumes, backups or source history to undo tooling. Preserve PR7's ownership and foreign-volume restore safeguards.

## Delivery and acceptance

The supporting [TASK-0005A](../../roadmap/tasks/TASK-0005A-managed-image-tooling.md) first delivers the corrected scanner and real current audit evidence without publication rights. A later focused private-image workflow/activation increment requires the additional concrete review above. Only then integrate the admitted images and verifier into PR7's data lifecycle, incorporating PR10's report correction.

TASK-0005 remains incomplete until real readiness, migrations, transactions/outbox/raw integrity, restart persistence, isolated reset and backup/restore pass for all four services on exact admitted images. Required root checks, fresh clone, independent implementation review, final-head CI and exact merged-main CI remain mandatory. TASK-0006 waits for TASK-0005; no source rights or production topology is introduced here.

## Official references

- [GHCR publication and private default](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#pushing-container-images)
- [Actions package access](https://docs.github.com/en/enterprise-cloud@latest/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility#ensuring-workflow-access-to-your-package)
- [Official attestation action](https://github.com/actions/attest) and [official verification CLI](https://cli.github.com/manual/gh_attestation_verify)
- [Public attestation metadata](https://docs.github.com/en/actions/concepts/security/artifact-attestations)
- [Attestation deletion](https://docs.github.com/en/enterprise-cloud@latest/actions/how-tos/secure-your-work/use-artifact-attestations/manage-attestations) and [finite Actions artifact retention](https://docs.github.com/en/actions/tutorials/store-and-share-data#configuring-a-custom-artifact-retention-period)
