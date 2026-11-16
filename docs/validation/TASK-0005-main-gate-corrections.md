# TASK-0005 — post-merge gate corrections

Status,16November2026: NEXT_PATCH_LOCAL_VERIFIED / RUNNER_PLAN_REVIEW_PENDING.
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
Architecture approval followed by a distinct Critic approval of identical
plan bytes is required before implementation. Those reviews are pending at
this checkpoint; this document does not claim they occurred.

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
