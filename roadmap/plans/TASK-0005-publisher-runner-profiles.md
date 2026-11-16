# TASK-0005 — bounded publisher runner profiles

Status: REVIEW_PENDING. This amendment requires actual Architecture approval,
then a distinct Critic approval of identical bytes, before implementation.
The user's existing instruction to finish TASK-0005 remains the authorization
for this work; it does not make pending evidence successful.

## Observed problem and scope

PR241 merged as e3e8297cfb68540c3af4703b552e16e19ed39d4a. Its main quality
run43946196457 failed on the newly indexed Next.js advisory
[GHSA-mfr8-8qww-v76h](https://github.com/advisories/GHSA-mfr8-8qww-v76h).
A separate bounded dependency correction advances16.4.2 to16.4.5 without
changing application code or the audit policy. This plan concerns the other
actual blocker: publisher tool compatibility.

Main tool run43946196435/job133576380583 passed its existing probe, but the
publisher's stricter full-Docker-JSON comparison would reject it. Its complete
1073-byte Docker line has SHA256
`7ee869527b3a74ef1321335fa757c180a4e4697a56a6cece56c3e6484dc4d9cd`.
The qualification's1077-byte line has SHA256
`f84a732dfdccfea6fe1ce0a1d40a45f6d9bde5a053a6b4ad35b19ad565fa7dc8`.
Counts and hashes exclude the final newline. The only parsed differences are
`Server.KernelVersion` and `Server.Components[0].Details.KernelVersion`:
`7.0.0-1017-azure` versus `7.0.0-1014-aws`. All other bytes, including Docker
client/server28.0.4, API, component versions, commits and build times, match.
Go1.24.13 and the authenticated Buildx0.38.1 identity also match qualification.

[GitHub documents automatic AWS/Azure allocation for standard Linux runners](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners#cloud-hosts-used-by-github-hosted-runners),
with unchanged labels. Their images are updated weekly. Selecting ubuntu24.04
does not select a fixed cloud or kernel. Retrying until Azure happens to be
allocated, silently dropping kernel fields, changing the old qualification,
or introducing a paid/self-hosted runner are not the selected remedies.

## Explicit identity amendment

Add exactly two complete measured Docker identities to a repository-owned
publisher-tool profile: the original qualified Azure line and the observed
main AWS line above. Preserve their exact UTF-8 bytes, lengths and SHA256
identities. Also bind the exact Go reader and Buildx identities. The profile
is authenticated by fixed bytes/hash in its consumer, with no caller-supplied
profile path, environment override, normalization or version-range fallback.

A shared pure validator requires an exact member of that two-line set, plus
the unchanged Go and Buildx pins. Unknown fields, ordering/encoding changes,
different component versions, a third kernel, mismatched kernel copies,
truncation or multiple lines refuse. Qualification intake still authenticates
the original PR237 runner-tools member and must confirm its original Docker,
Go and Buildx identities. The AWS profile is an explicit publisher-host
extension, never a rewritten historical qualification or a claim that those
two hosts are identical.

Use the same validator in the publisher and its existing read-only tool CI.
Publisher validates the current tools before registry login, repeats identity
validation immediately before the existing OCI push phase, and preserves the
observed full Docker line and selected profile identity in bounded job output.
Keep the original qualification member unchanged. No receipt schema or
50-member archive change is needed: source identity binds the new policy;
original public job logs retain the current runtime observation for review.

## Native compatibility evidence

Existing evidence is complementary, not an exact native cross-product proof:
the AWS main managed run43946196572 passes all image/build/runtime gates with
Buildx0.38.2, while its tool probe authenticates and executes Buildx0.38.1 but
does not build with it. Add one small native compatibility exercise to the
existing tool job using its installed0.38.1 and closed publisher environment.

Use the existing default Docker driver explicitly after verifying that its
driver is `docker`. Build a fixed tiny `FROM scratch` image containing only a
public fixed text fixture, with network disabled, no pull, no cache reuse,
no provenance/SBOM, and local load only. No login, push, registry package,
extra builder, downloaded base image, scanner execution or running container
is authorized by this probe. The local Docker-driver proof is explicitly not
the publisher's docker-container backend or registry readback proof; those
remain actual publisher postconditions. Do not claim exhaustive host or
kernel equivalence, or native evidence on a cloud not assigned to this job.

Bound the exercise to the existing ten-minute job, five minutes for the
native exercise, at most one minute per command, bounded stdout/stderr,
a tiny fixed build context and at most1MiB inspected image size. Materialize
only in an exclusively created runner-temp directory. Verify the pre-existing
image/container inventory and reject name collisions or uncertain absence.
Give owned image/container objects an exact unique run-bound label/name.
Capture and validate the immutable built image ID; create the container by
that ID with pull disabled and an inert explicit command, without starting it.
Inspect exact image/platform/labels/container ID, created state and zero start
and finish timestamps before copying its fixed file. Require a regular,
single-link copied file with exact bounded length/hash/content.

Cleanup only acquired identities: re-inspect ownership before removal, never
remove a pre-existing or foreign image/container, and never prune shared
Docker state or modify/remove the default builder. Prove owned objects absent
and require the image/container inventories to equal the baseline. Unknown
absence, failed cleanup or a surviving child fails the job; preserve the
original failure. The disposable default builder may retain its normal build
cache; no pristine-cache or zero-host-mutation claim is made.

Each observed native job is evidence for its own accepted profile only. Both
profile byte identities are independently reviewed from original evidence;
future runner assignment is not guaranteed. The live publisher must still
refuse any profile outside this exact set before registry login. Its unique
dispatch must not be used as a probe for an unrecognized environment.

## Files and invariants

Changes are limited to a new fixed publisher-tool profile and pure validator,
the publisher's current-tool checks, a bounded probe module if useful, the
existing tool workflow and directly coupled regression tests, plus this plan
and validation/task notes. Existing managed workflow `infra/scanner/**` and
`scripts/scanner/**` triggers already cover the change; do not broaden them.
Add the new profile to the existing tool-workflow path filters so profile-only
changes also exercise it. No new workflow or dispatch capability is added.

Preserve the original retention plan55554bytes/SHA256
`1cac817bd6ac4ab1bbb7b257e81e9be500bf6344a703149cdf4ce163c80d721e`,
retention.json, qualification ZIP/profile/50-member mapping, current receipt
schemas, all74 generation6 execution pins, private package/bootstrap proof,
owned cleanup rules and admission/support null dates. No scanner, image,
database, helper, Windows host or service policy changes are authorized.
The approved Buildx installer and its authenticated binary stay unchanged.

## Validation and delivery

1. Independently verify both full profiles against the original PR237 ZIP and
   main tool job, including the two-field difference and all other byte equality.
2. Obtain ordered Architecture then distinct Critic approval of this exact plan.
3. Add meaningful tests for both profiles and wrong/missing/substituted fields,
   profile tampering, original-qualification substitution, and publisher/probe
   reuse. The native probe's tests cover collisions, immutable identity/label
   mismatches, a previously started container, bad copied bytes, and cleanup
   failures/uncertain absence. No test may accept a missing native proof as pass.
4. Run affected retention/bootstrap regressions, lint, typecheck, tests, build,
   secrets/dependency audit as applicable; preserve explicit platform exclusions.
   Independently review implementation before normal protected-main delivery.
5. Require fresh final-source and corresponding main quality, managed, Windows
   and tool/native results with original-evidence review. Raw upstream failures
   remain separately retained/classified under ADR-0026, never waived.
6. Recheck the original PR237 qualification expiry, package/private access,
   current tool observations and absence of any publisher attempt before the
   one-shot main publisher. Its sole run_number1/attempt1 remains unused.

PR237 artifact13706967607 expires2026-11-23 at20:18:16UTC. No replacement by
new diagnostics, automatic retry, permission change, publication, real data,
image admission, support activation or TASK-0005 completion follows from this
amendment. Actual publication/readback, reviewed receipt tuple and real local
NexusLite copy/restoration remain required. Rollback removes the extra profile
and disables or reverts the new probe without changing stored data or archives;
the prior exact Azure-only policy then continues to reject AWS.
