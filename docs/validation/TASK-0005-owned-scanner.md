# TASK-0005 — Auto World scanner qualification

Status: IMPLEMENTED_LOCAL_VALIDATION_PASS_LINUX_PENDING. No owned scanner binary or Linux qualification result exists yet. TASK-0005/0005A remain IN_PROGRESS, M2 NOT_ESTABLISHED and admission NOT_AUTHORIZED. Activation/support dates remain null.

## Cause and accepted scope

Fresh source `c80ec3a7fe24ff476874edc864ee0ffa396bd9e8`, tree `71c36b77cc552cca5bcfa715298ab1a2ca29bada`, passes [quality40652466507](https://github.com/CleMeY15/auto-world/actions/runs/40652466507): root2837PASS60knownSKIP, workspace624PASS, browser393PASS7knownSKIP and zero failures/flaky/retries. Lint14, typecheck21, build14, Secretlint1204 and dependency audit pass.

[Managed40652466474](https://github.com/CleMeY15/auto-world/actions/runs/40652466474) and [upstream40652466470](https://github.com/CleMeY15/auto-world/actions/runs/40652466470) stop correctly at `scanner_self_audit_blocked`: official Trivy0.76.1 contains HIGH CVE-2026-116587 in go-jose/v4v4.1.5, fixed4.1.6. Provenance, four refusal controls and JSON/CycloneDX conservation were independently verified. No new image, SeaweedFS qualification or Native result exists in those runs; older counts and Native verdicts do not transfer. Original receipts and archives are retained, not reacquired or rerun unchanged.

The user explicitly chose construction and maintenance of the bounded owned scanner. [ADR-0026](../decisions/ADR-0026-data-foundation-managed-tools.md) records this amendment. The official lock/validator and historical scanner material remain unchanged.

## Planning evidence

- Exact [plan](../../roadmap/plans/TASK-0005-autoworld-corrected-scanner.md): 41317 bytes, SHA256 `16efca0d298a2dd1424cf2b2aacd694ef00239d5281eefdee6c57be6ae2b726c`.
- Actual Dependency Expert facts: 22549 bytes, SHA256 `2df566c45e202217a2dfd005b4e512ebd83dd99c2e30dde1768ede9ad5aa7b41`. The complete patched go.sum is `a934abfc262a21a885c2c9b755f43397460996d67a07d1ab3fa52e8e66d94e84`; the earlier package-line-only draft was incomplete and is not used.
- Actual upstream test-source facts: 12157 bytes, SHA256 `667035b96b49482738702dd6541dc267abc692be0f45fed24aee16120a4e5934`.
- Initial actual Architect BLOCK was resolved: explicit CI deadlines, distinct memory/workspace accounting and sealed writable test copies. Actual Architect then returned CLEAR on the exact final plan; a distinct actual Critic returned OKAY / CLEAR on the same bytes.
- Full plan and both verdicts were published in [draft PR202](https://github.com/CleMeY15/auto-world/pull/202) and read back exactly, 50111 characters, while HEAD remained c80 and before any implementation dispatch. Private handoff is COMPLETE; native implementation has separate build, controls and root integration owners.

The network boundary forbids outbound acquisition after freezing. Loopback-only upstream httptest servers remain permitted within network-isolated containers; no new tracing tool or provider is required.

## Acceptance still required

The implementation adds an owned source lock, minimal three-substitution patch, retained notice, two separately prepared compiler/source/cache paths, complete upstream and go-jose tests, binary equality, four cross-self audits, the rejected official scanner control, six same-database comparison controls, two retained legacy baselines and the exact builder audit. Qualification transitions require private proof objects bound to the same run, source, binary and databases. The application version remains 0.76.1; the owned receipt identifies the derivative without inventing upstream VCS provenance.

The two diagnostic workflows select this fixed producer in one process with a shared 320-minute budget, a 360-minute job limit and a reserved cleanup interval. Outbound acquisition ends before the sealed offline stages. Public evidence is canonical, bounded and validated before copying; binaries, source trees, module/build caches and raw test logs remain private. Exact owned container/image identities are tracked for cleanup and absence proofs; cleanup is still attempted with a bounded emergency timeout when the normal deadline refuses it, while retaining the failure. Shared registry images are not pruned. Activation remains separate.

Fresh local validation uses Node 22.23.2 and pnpm 10.15.0: root tests 2261 PASS / 490 existing environment-dependent SKIP / 0 FAIL (2751 total); workspace tests 624 PASS / 0 FAIL across 28 dependency-ordered tasks; lint 14 tasks, typecheck 21 tasks and build 14 tasks pass with no Turbo cache hits. The Python archive suite passes 92 tests with one Windows exclusion (93 total). Secretlint passes for 1220 files and the dependency audit reports no known vulnerability. No browser/provider result is inferred from these Windows checks; the unchanged browser suites and all Linux-only cases remain required in fresh CI. The historical scanner lock, official release, managed lock and audit policy retain their exact prior hashes.

Independent final integration review returned APPROVE with zero findings on the frozen implementation; it freshly ran 89 targeted tests, ESLint and syntax checks. The separately reviewed build/cleanup implementation has no remaining material finding. The integration source `official-audit.mjs` has SHA256 `d76efaa0bba6eb281575647f576246132aa7ad1250b218efb1a8c202d7a64282`, now explicitly retained by the OpenSearch regression anchor. Missing local LSP diagnostics are covered by the available syntax/lint checks, not represented as an executed tool. These reviews authorize the diagnostic CI submission only, not qualification or admission.

Fresh source-bound Linux builds/tests, binary equality, self/cross-self controls, same-database detection/inventory comparison, current builder audits and every reached downstream image/SeaweedFS/Native/runtime gate remain to be measured. Any missing or failed gate remains explicit non-acceptance. Independent review of the implementation and original CI evidence precedes further promotion.

No publication, signature, admission, support activation or TASK completion is implied by this record. A finite new failure must retain its original evidence and prove owned cleanup before the next bounded correction.
