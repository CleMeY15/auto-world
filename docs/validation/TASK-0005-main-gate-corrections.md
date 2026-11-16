# TASK-0005 — post-merge gate corrections

Status, 16 November 2026: source984f2e2 delivery REQUEST_CHANGES;
correction LOCAL_VALIDATED / FINAL_SOURCE_AND_MAIN_PENDING.
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
That dependency correction changes no application UI code or audit policy.
The subsequent UI correction below is required by the actual source results.

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

## Source984f2e2: successful job, rejected delivery

[Quality43958361174](https://github.com/CleMeY15/auto-world/actions/runs/43958361174)
reports SUCCESS, but its original browser report contains 667 passes, one flaky
test and ten existing exclusions. The first WebKit attempt of the 200% text
rename-search flow fails because the editor never opens; retry1 passes. The
existing delivery requirement forbids accepting that retry as a clean result.
Root tests pass 3136 with 67 existing platform exclusions; package tests pass
776 and the dependency audit is clean. The original quality/Windows independent
review is REQUEST_CHANGES overall, SHA256
52606072e51ac1020325041ff8e66151ab94d5e63b289d0336bf2551540d24f1.
The browser artifact14275332350 is193675337bytes, SHA256
978633721cbec73bb238f461853f1d39b2a9da40f3b27b2f27ea927a8bf7fdc3.
The original failure, trace and successful retry are retained unchanged.

Source is984f2e2096525228accd06d8ccee5648e67e4be6; merge checkout
b0ac19e0017f7571e18a211727ec790237586c67 has parents main e3e8297 and that
source, with matching tree368cef11a526726d4b9e1890470603cdb087d477.
Windows43958361147 passes all ten native cases. Tool preparation43958361169
passes its 42 tests and native exercise on the Azure profile, restoring the
original six-image/zero-container inventory. Its independent review SHA256 is
2170644fd945d110b565ffbb08baa4a9b18dc3d5a438af8c1629499641092d4f.
This proves neither AWS execution nor the publisher's separate backend/readback.

All five affected prototype workflows also pass and are independently accepted
for this source only: store43958361237 (40 phases), search43958361156 (15),
persistent web43958361206 (10), recovery43958361167 (11), and integration
43958361152 (17). Review SHA256:
1e81d2db9450e9446cf9044fdde64031e1504cbf51e4b348759c65d09f1a6e75.
The integration evidence preserves four injected failures and four transient
recovery probes; all final phases pass. These successful subsystem results do
not override the rejected overall quality result.

Managed43958361321 also succeeds and receives independent APPROVE within its
historical diagnostic scope. All ten phases, four runtime cases and owned
cleanup pass; scanner, two builders and five produced images report zero
findings/blockers. OpenSearch passes1688/1736 with48 explicitly allowed
exclusions (47 REST API cases and one YAML depth-limit case); gRPC passes1427.
SeaweedFS passes14218 with148 reviewed exclusions and all three supplemental
cases; the two Rust suites pass all498 and590 tests respectively.
The original archive14274114356 is5113482bytes,689 members, SHA256
587624c0628bc17219fde832e8cbcdd3a6462b3a872b98aad9de680702ab3fa4.
The715-file evidence manifest verifies without divergence; review SHA256
234fc85dfa6a343462934f682d6fe85a379ca7d20a49707823c634eac5747cde.
This does not qualify images for admission or cure the UI delivery failure.

## Reduced-motion repair

Instrumented reproduction identifies an actual layout race. The universal
reduced-motion rule sets a nonzero transition duration even on elements whose
default transition property is all. After 200% root text sizing, the closed
criteria summary temporarily retains 16px text, then changes to32px and grows
from88px to144px between pointer-down and pointer-up. The rename button moves
56px with unchanged scroll position; pointer-up targets a DIV and no editor
opens. No application DOM mutation explains that interval.

The independent diagnosis retains all 264 files and controlled experiments,
SHA2560f793ea7aa8dd758f2c4fea2eb8003c352aa5278bb65ec494d785ec276cdd2cb.
The agent's unchanged instrumented sample fails two of ten cases. Each bounded
ablation (transition:none and duration:0s) passes ten of ten without retries;
the 0s sample shows32px text already at pointer-down and no button displacement.
These small samples establish the measured mechanism, not a statistical
guarantee for every browser or physical device.

The production fix changes only that duration from0.01ms to0s. The existing
200% regression now asserts immediate inherited text sizing in the same browser
evaluation that changes the root font. All original pointer, focus, storage,
screenshot and submission checks remain. Both Chromium and WebKit fail the new
assertion against the old built CSS (expected32px, actual16px), and both pass
against the corrected build with no retries. No sleep, forced click, enlarged
timeout, test removal or performance-budget relaxation is introduced.

Playwright's CI configuration now sets failOnFlakyTests, retaining the existing
single diagnostic retry while making any flaky test fail the job. This enforces
the existing delivery contract. A clean final-source and corresponding main
run remains necessary before merging/accepting this increment or publishing.

Local web build, lint, typecheck and all146 unit tests pass. The complete search
and comparison rename suites pass63 cases with one existing WebKit exclusion
for the Chromium CDP4x comparison measurement, no failure/flaky result and no
retry. Keyboard/focus, storage-conflict, offline, accessibility and target-size
checks remain intact. The44 original screenshots cover320/390/768/1440 widths,
light/dark, invalid input and both200% fonts on both engines. Five-sample maxima
are13.4ms for search on Chromium4x,11ms for the unthrottled WebKit baseline,
and11.8ms for comparison on Chromium4x, against the unchanged100ms limit.
These measure DOM feedback to an animation frame, not physical paint.

Independent code review APPROVE authenticates the three exact implementation
files, confirms no transition-delay or event-handler dependency, verifies the
red/green evidence and checks the installed Playwright failure semantics.
Its33-file manifest verifies; review SHA256:
98937650aba1fddc4889189d728b93f940e01a5380eb4cc0b58e6f3d2cac4d1b.

Separate visual review APPROVE inspects all44 original captures, verifies the
eight axe checks in the final valid/invalid desktop dark states and distinguishes
those checks from the fit assertions covering every capture. Its148-file
manifest verifies; review SHA256:
05043bfebdab57ead98087487bc0e1a3387616a75536a8193e704e7956941d64.

The broader 200% text/navigation-motion selection initially terminates with
SIGTERM (exit143), after39 logged successes out of46 scheduled cases and before
a final report. The signal's sender is not established. This incomplete
attempt and its artifacts remain retained, outside acceptance. Only its owned
orphaned3307/3310 servers are cleaned up after PID/command/cwd verification.
Separate complete executions of the unchanged selection then pass23 Chromium
and23 WebKit cases, with no exclusions, failures, flaky outcomes or retries.
They use new output paths; the incomplete attempt is not overwritten.
Secretlint passes1421 files. The other worktree and its four original service
processes on3100/3210/3111/3211 remain intact. These local targeted results do
not substitute for the complete final-source/main CI and infrastructure gates.

There is no data migration or new service. Rollback of this CSS change restores
the observed large-text click defect; reverting the CI flag would again allow
that kind of retry to produce a misleading green job. Original failed evidence
must remain retained in either case.
