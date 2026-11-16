# TASK-0005 — post-merge gate corrections

Status,16November2026: LOCAL_VALIDATED / SOURCE_AND_MAIN_VALIDATION_PENDING.
TASK-0005/0005A remain IN_PROGRESS; publication, second copy and admission are
not established.

## Original main results

PR241 merged normally as e3e8297cfb68540c3af4703b552e16e19ed39d4a, with the
same treebc54584f3e11cca4919e3124a9aa6583a460831b as reviewed source836d760e.
Independent review of all five push-main jobs returned REQUEST_CHANGES:

- [Quality43946196457](https://github.com/CleMeY15/auto-world/actions/runs/43946196457)
  failed the dependency audit. Earlier tests/build passed, including668 browser
  tests and10 explicit exclusions. The newly indexed advisory
  [GHSA-mfr8-8qww-v76h](https://github.com/advisories/GHSA-mfr8-8qww-v76h)
  affects Next16.4.2; the first patched version is16.4.5. The source quality
  job ended before this advisory was added to the GitHub advisory database.
- [Managed43946196572](https://github.com/CleMeY15/auto-world/actions/runs/43946196572),
  [Windows43946196613](https://github.com/CleMeY15/auto-world/actions/runs/43946196613)
  and [tools43946196435](https://github.com/CleMeY15/auto-world/actions/runs/43946196435)
  succeeded. Original managed reports, native tests, four runtime cases and
  cleanup were independently accepted only within their diagnostic scopes.
- [Upstream43946196512](https://github.com/CleMeY15/auto-world/actions/runs/43946196512)
  remains FAILED with243 actual raw-upstream blockers, separately classified
  under ADR-0026. No finding is waived.
- Publisher preflight is blocked despite the successful tool job: the actual
  Docker JSON changes only two kernel fields from7.0.0-1017-azure to
  7.0.0-1014-aws. The existing publisher requires complete qualified identity
  equality. Its first run remains unused.

The original main review and860-file manifest are retained privately. Review
SHA256:8708f13bf8adf91564fd7b31fb9ed486e1ecd84120dcffa1b6a0ef643e4a284a.
The successful managed artifact14267823553 is5136490bytes, SHA256
99f52e884bf50d46fbec269ce98c542e6721f9366f8851aed2d00d8ad7b4f4ab.
These observations do not make the failed overall main delivery accepted.

## Next.js correction

Only apps/web/package.json and pnpm-lock.yaml change for the dependency fix:
Next16.4.2 becomes16.4.5, with matching env and eight SWC packages. The other
dependency resolutions are preserved. The initial resolver also refreshed
four unrelated compatible dependencies; that intermediate lock is retained
privately, the original unrelated resolutions were restored, and the final
frozen install passes.

Actual local checks: frozen install with scripts disabled; dependency audit
at the unchanged low threshold with zero known vulnerabilities; web lint,
typecheck, build and146 unit tests all pass, with no unit exclusions.
Independent review APPROVE rechecked all ten upstream npm integrity records,
confirmed that normalizing just these changes reproduces the old lock bytes,
and rehashed the19 original evidence files. Review SHA256:
d616141961f911c90ceb9980ce890a3ef4c0a890ed56151a485712744f7accc8.
Full final-source and corresponding main CI/browser validation remain pending.
No application UI code, running service, other worktree or audit policy changed.

## Publisher runner amendment

The [separate runner-profile plan](../../roadmap/plans/TASK-0005-publisher-runner-profiles.md)
preserves the original retention plan and proposes two exact complete measured
Docker profiles, one shared CI/publisher validator, and a small local native
compatibility probe. No field normalization, historical rewrite, retry until
a preferred cloud appears, new paid runner or publisher dispatch is proposed.
Architecture approval followed by a distinct Critic approval was obtained
before implementation for exactly9373bytes, SHA256
5055b2b8ffcfec4495d947977e8a1b12435172f1bf40a04b690c2e2617cc91d5.
The unchanged plan retains its historical REVIEW_PENDING label; these actual
review records supersede that label without rewriting the reviewed bytes.
Architecture review SHA256:
b1f2963720ebe550ae9143a40b9c345c503db39b4fe56295549b0d541d2472b0.
Distinct Critic review SHA256:
14085342d1b87fae06752e046257fcf3ef8adf53277dcf6f80f56f873057a065.
Both independently matched the complete profiles to original PR237 and main
evidence, verified unchanged Go/Buildx and the exact two kernel differences.
The implementation is locally validated and independently reviewed in PR242.

The new repository-owned profile is3070bytes, SHA256
63ade7c710fe29cedb2a6f558935d0fe8533451b48bc23e6bbc7a4b337ea606a.
Its consumer authenticates those exact bytes. Command framing permits only
one optional final LF; Docker JSON is never parsed and reserialized for
acceptance. Qualification intake authenticates the unchanged1306-byte original
runner-tools member. Both current-tool checks use the same pure validator:
before registry login and immediately before push. A change between those
observations also refuses. Bounded public logs preserve both complete identities.

The existing read-only tool workflow now installs the unchanged authenticated
Buildx and exercises the pre-existing default Docker driver with a tiny scratch
image, an explicitly never-started container and exact copied bytes. Commands,
output, time, object identities and ownership are bounded; partial-creation
cleanup and before/after inventories are checked. No registry authority,
downloaded base, new builder or scanner execution is added. The default builder
may retain normal cache. This evidence is limited to the assigned host and
Docker driver; publisher backend and registry readback remain postconditions.
Review against official Docker28 source corrected the mock's initial absence
framing assumption: template inspection emits one LF for a missing object.
Only that exact framing with the identity-specific absence error is accepted.

Actual local validation:151 affected retention/bootstrap tests pass,7 existing
Windows exclusions;23 typecheck tasks,28 package test/build tasks (8 cached),
14 build tasks and14 lint tasks pass. Secretlint passes1421 repository files;
dependency audit at the unchanged low threshold reports no known vulnerability.
The full root native suite and browser suite remain final-source CI gates:
this VPS's tmpfs and privilege limitations are not equivalent to the dedicated
Linux and Windows runners. No native Docker exercise ran on the VPS.

Two separate implementation reviews APPROVE their complementary scopes:
identity/publisher review32 tests without exclusions, SHA256
4696ab0ef7e9b92d57b7e56e3e4e9c284982b76d71793d0eef66b73f8f9b0148;
native-probe/workflow review42 tests without exclusions, SHA256
49d766e1612a01b8cf1dbed9c22dc22a2976ea86120ec46ce74ab4584d79a20d.
Original local logs/manifests and both reviews are retained privately. All74
generation6 execution files were rehashed successfully; the original retention
plan, retention policy, qualification profile and Buildx installer are unchanged.

After implementation and independent review, obtain all applicable final-source
and protected-main proofs before preflighting the unique publisher. The fixed
PR237 qualification expires23November2026 at20:18:16UTC. Publishing its archive,
reviewing/committing the authentic publisher tuple and actual NexusLiteC:
copy/restoration remain separate required operations. No source or evidence
change grants image admission or support activation.

Rollback reverts the new implementation while preserving failed attempts,
stored data, private archives and historical qualification. Reverting Next
would restore a known vulnerable dependency and does not make that version
eligible for delivery.
