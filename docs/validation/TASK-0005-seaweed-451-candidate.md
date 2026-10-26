# TASK-0005 — SeaweedFS 4.51 diagnostic candidate

Superseding checkpoint: [source9c's scoped audits pass but its runtime consumer rejects legitimate empty evidence](TASK-0005-runtime-empty-evidence.md). Quality40372965590 and the scanner/build/audit parts of40372965559 are independently reviewed; runtime cases/cleanup remain unestablished. The reviewed consumer repair needs fresh changed-source/main acceptance. This does not close the Rust or admission limitations below.

Status, 26 October 2026: CANDIDATE_SELECTED / FRESH_LINUX_ACCEPTANCE_PENDING. TASK-0005/0005A remain IN_PROGRESS. This record grants no publication, admission, support activation or final lifecycle acceptance.

## Why this candidate

The user authorised a corrected Auto World image with its additional maintenance. At17:37UTC, a dependency review found official Docker Hub4.51, absent at the earlier03:53 check. [ADR-0026](../decisions/ADR-0026-data-foundation-managed-tools.md) prefers a current official candidate before adding a derivative. Evaluate that exact subject first; the authorised derivative remains a fallback after a named rejection and bounded reviewed amendment.

Historical source `0c27325f14f60161bdfdc08648316a74b4198d45` passed [quality40265172724](https://github.com/CleMeY15/auto-world/actions/runs/40265172724). Independent review of [managed40265172717](https://github.com/CleMeY15/auto-world/actions/runs/40265172717) accepted its OpenSearch causal/full evidence: expected RED, seeded GREEN, full1,735 cases with47 known skips and no unexpected failure, complete native output and exact runtime JDK preservation. That managed run failed on two SeaweedFS4.50 HIGH curl/libcurl occurrences of [CVE-2026-92392](https://curl.se/docs/CVE-2026-92392.html). Four runtime cases were NOT_RUN/PENDING_NOT_ACCEPTED. These source-bound results do not transfer to changed source.

## Exact declarations and trust boundary

Only four SeaweedFS declarations change in the [selected input](../../infra/scanner/official-release.json):

| Field | Candidate |
| --- | --- |
| Repository/version | `chrislusf/seaweedfs:4.51` |
| OCI index | `sha256:f7a49e3f3972ebed5be2ed4befa4a0c68eb7bdddba6e692d42729ceb545134b8` |
| Linux/amd64 manifest | `sha256:3a522c379599e163433a636e75022630848b63a74f08ea37bf06f8d776e9a707` |
| Declared build revision | `ffa87c25fdf587178b1521ad87f2a4a72a02e584` |
| Observed config, independently compared later | `sha256:e9535759e270021cc18782c39e1dcc7977ad801edc4e3676a3d2f6c29bf598b6` |

The release tag points at `153ab668c99731a6d29492bf6c61d0b4fa701101`. The [official comparison](https://github.com/seaweedfs/seaweedfs/compare/153ab668c99731a6d29492bf6c61d0b4fa701101...ffa87c25fdf587178b1521ad87f2a4a72a02e584) shows one subsequent CI compilation correction. An exact48,502-byte BuildKit statement, SHA256 `b85d6c19b57fa08ffecb53d57f07cd7c46a4431400ba4ed5bcc5e40d2ef7b2be`, names the selected amd64 subject and declares that later revision. It names producer [40267629397 attempt1](https://github.com/seaweedfs/seaweedfs/actions/runs/40267629397/attempts/1); later attempt status does not authenticate these bytes. Dependency resolution is incomplete. This is unsigned metadata, not verified signer trust or source-to-image correspondence.

Only the amd64 manifest is scanned/executed by the existing diagnostic. Pure validation checks role/repository/platform/digest shape; it does not authenticate `image.source`. The diagnostic does not verify the index association or SeaweedFS SLSA. Full authenticated provenance remains pending at admission. Matching declared container fields and UID/GID history proves neither file contents nor functional equivalence. GHCR absence and an old `latest` do not authorise a mirror/tag fallback.

## Reviewed scope and evidence

Plan revision2, SHA256 `f54e01aad64c2a90b9c73dd9cf68e8166609b3104d699e0220960bc2d6574a9a`, received actual sequential Architect APPROVE then distinct Critic APPROVE before implementation. The first Architect pass required correcting source-validation/provenance overclaims; the approved revision preserves the boundaries above. The implementation plan was published and read back in [PR199](https://github.com/CleMeY15/auto-world/pull/199) before code edits. Local pinned Node22.23.2 affected config/workflow/managed suites pass37/37; no new test merely restates the JSON. Native Linux acceptance remains pending.

No managed recipe, lock, adapter, frozen gen5/shared policy, cap, runtime scenario, legacy Compose pin or Java-age rule changes. Existing package-coverage/qualification controls remain; no exhaustive Rust/source-to-binary assurance is inferred. Fresh complete source/merge quality and the Linux managed run must qualify the scanner, audit builders, rebuild the existing derivatives, audit all five exact roles, preserve JSON/SBOM identities, measure installed curl/libcurl and compare the actual Seaweed config independently. All CRITICAL and fixable HIGH remain blocking; vulnerability DB age stays at most48hours, Java DB age is recorded without a maximum.

All four existing runtime scenarios execute only after every role passes in the same job. Preserve non-root storage, loopback, private bootstrap/credentials, `/data`, S3 port8333, resource limits, raw `nocopy:true` and owned-resource cleanup. Unexecuted, partial, failed or cleanup-uncertain cases remain unaccepted. Independent source/original-artifact review, protected delivery and matching main CI remain required. Final seventeen phases on final admitted subjects, private retention/second-copy restore, B0, signing and admission are separate open milestones.

Support remains one year from actual reviewed activation with continuous security checks and at least365 further archive days; new dates stay null. Rollback reverts the unadmitted pin/source increment and preserves evidence, data, volumes and historical retention duties. Rejected4.50 is not an approved fallback runtime.
