# TASK-0005 — Correct the remaining OpenSearch Guava finding

Date: 2026-11-09. Status: ACCEPTED_FOR_DIAGNOSTIC_IMPLEMENTATION after the dependency recommendation, actual Architecture APPROVE and subsequent distinct Critic APPROVE on candidate SHA-256 `a58984f9d4d7ea8a42d0d698216b879c1eba8698093edd8fac988e4217a6b411`. This status note adds no capability. Implementation review and actual same-source validation remain required. This is a diagnostic source correction only.

## Actual blocker and selected correction

Managed run42585332269, source e2ab8c33ddb7f60044ffea1cbe23b1b27366d223, qualifies both builders and constructs all three existing candidates. Its complete OpenSearch report contains one remaining blocking HIGH: CVE-2026-102554, `com.google.guava:guava 33.2.1-jre`, in `modules/transport-grpc/guava-33.2.1-jre.jar`. The old132 upstream occurrences are not the rebuilt subject's result. PostgreSQL, Redis and AWS CLI pass; SeaweedFS is handled by its separately reviewed narrow Go correction.

The dependency review confirms that 33.7.2-jre fixes this finding but is itself affected by the newer CVE-2026-118042. Select official Guava33.8.0-jre with its required existing `failureaccess` dependency updated from1.0.2 to1.0.3. OpenSearch merged this same dependency pair and the matching internal-class audit changes in upstream commit `47b51a6ef038693a9cf6b62f7957e0b7c7c72cdf` on4November. Backport only its `modules/transport-grpc` changes onto the current3.9.0 source; do not upgrade OpenSearch or its global Guava catalogue entry. No dependency is newly introduced.

## Exact scope and material

Preserve source `4ee42a94e87f66fbf1e62a9871b1b87f91e02472`, the newly qualified UBI10 builder, current Jackson catalogue patch and its exact post-patch hash, runtime JDK/base, distribution profile, resources and admission policy.

Only `modules/transport-grpc/build.gradle` changes in the upstream source tree: explicitly select Guava33.8.0-jre and failureaccess1.0.3 in that module; remove the six obsolete `cache.Striped64*`/`hash.Striped64*` audit exclusions, replace the two obsolete `AbstractFuture$UnsafeAtomicHelper*` exclusions with the upstream `AbstractFutureState$UnsafeAtomicHelper`, and remove the obsolete `UnsignedBytes$...$UnsafeComparator$1` exclusion. These are the upstream library-internal class changes, not a disabled third-party audit. Preserve every unrelated exclusion and the audit itself.

Authenticate exact original module build file SHA-256 `c77756ad3c96ad3345df98b038bed1e9f1bfbb5947af2e055bd719a3ed0a3e71`; exact targeted patched result SHA-256 `c8312d409ea46ecc3407bcbd555ef2551177e554ebda2c5ce2419cfefccd4323`. Retain original fixture, readable patch, preparation output and final source. Changed original or already-patched source must be refused rather than silently repatched.

Dependency artifacts are Guava33.8.0-jre SHA-1 `bb3b79346325315062192205fa6636dd5873151f` / SHA-256 `97b79ec3f2c0a6313a0c2df51ce1abdf8907e6531803467b81efcaaf99b35161`, and failureaccess1.0.3 SHA-1 `aeaffd00d57023a2c947393ed251f0354f0985fc` / SHA-256 `cbfc3906b19b8f55dd7cfd6dfe0aa4532e834250d7f080bd8d211a3e246b59cb`. Use upstream Gradle resolution and its standard `:modules:transport-grpc:updateShas` task, retaining and verifying the expected two new SHA files and removing only the two superseded version files. Preserve existing LICENSE/NOTICE material and export that module's licence directory for independent review. No installed-JAR replacement, invented metadata, disabled signature/checksum/licence check or broad version rewrite.

## Execution and evidence

1. Extend the existing managed lock and its exact validator with the two module versions and guarded patch identities. Add the small pinned patch/material script to the existing OpenSearch recipe/context. Reuse its preparation failure capture and runtime refusal path.
2. Add the targeted updateShas task to preparation. Add `:modules:transport-grpc:dependencyLicenses`, `:modules:transport-grpc:thirdPartyAudit` and `:modules:transport-grpc:check` to the full native Gradle invocation before its existing server test selector. Keep all current tasks, controls, assertions, seeds, capture validators and resource limits. Do not invent a future test count from the upstream PR's aggregate.
3. Keep the existing16-report/1,736-test/minimum1,688-pass/maximum48-reviewed-skip gate intact for its original groups. Export the transport-grpc unit and internal-cluster JUnit groups separately; require both present, nonempty test counts, zero failures/errors, actual complete skip identities/reasons and no unreviewed skips. Preserve full module test output through standard Gradle JUnit/logs and the existing byte limits. Its added checks must not inflate the old group totals or allow missing old tests. A new resource/output issue remains a failure, without raising caps or suppressing output.
4. Bind the final exploded distribution's Guava and failureaccess JAR hashes to the expected artifacts and record their paths/identities; assert no superseded versions of these two artifacts remain in that module. Retain the same global distribution tests and full image audit/SBOM. Any remaining or newly observed blocking finding fails normally. No assumption that an upstream release or successful compilation is a clean final image.
5. Run targeted patch/refusal/evidence regressions, lint, types, root/workspace tests, build, secrets and dependency audit; obtain distinct implementation review before pushing changed diagnostic execution. Receive and independently verify the actual same-source CI reports before accepting this correction.

No publication, support activation, consumer admission, production, real data or prototype changes follow. Rollback abandons the unused candidate and preserves original failures and evidence. Final runtime/provenance/retention/protected-main gates remain open until separately satisfied.

## Primary references

[Guava advisory](https://github.com/google/guava/security/advisories/GHSA-xxph-c9ww-hj94), [Guava33.7.2](https://github.com/google/guava/releases/tag/v33.7.2), [Guava33.8.0](https://github.com/google/guava/releases/tag/v33.8.0), [OpenSearch PR23529](https://github.com/opensearch-project/OpenSearch/pull/23529), [merged source](https://github.com/opensearch-project/OpenSearch/commit/47b51a6ef038693a9cf6b62f7957e0b7c7c72cdf), [release compatibility policy](https://github.com/google/guava/wiki/ReleasePolicy).
