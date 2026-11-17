# TASK-0005 — accepted scanner publication observation

17 November 2026. Publication evidence: `APPROVE / PUBLISHED_UNADMITTED`.
Observation delivery: `IN_PROGRESS / DELIVERY_PENDING`. TASK-0005 and
TASK-0005A remain `IN_PROGRESS`. This record does not establish a NexusLite
copy, restoration, image admission or supported operation.

## Scope and delivery plan

Owner: the TASK-0005 infrastructure coordinator. Branch:
`codex/task-0005-publisher-observation`, based on accepted main
`9b8996413fbc32bdd9a9bbafdce57e8c38da0cff`. Coordinator, implementation and
independent review use separate Codex contexts, inherited `gpt-6-astra` /
`ultra`. One writer per assigned file; quality commands are serialized in
the infrastructure checkout. Other worktrees and running services are untouched.
Cost is unknown; this infrastructure continuation is not a product-pilot entry.

The [approved recovery amendment](../../roadmap/plans/TASK-0005-publisher-inventory-recovery.md)
requires an authentic successful publication and independent review before
recording its observation. Those prerequisites now pass. This increment:

1. Copies the eleven reviewed public identity fields into
   `infra/scanner/retention.json` at `observations.publisher`.
2. Updates the canonical policy byte/hash binding and affected assertions;
   preserves all qualification, execution, recovery and admission rules.
3. Validates the default observation against original receipt/API evidence,
   runs applicable checks, obtains independent source review and delivers
   through normal PR/main gates before any real NexusLite operation.

`localCopy` and `localRestore` remain null. The policy's retained/restored/
admitted claims remain false and support dates null. UI, package API, database
migrations and new service observability are not applicable: this binds an
existing operation's public evidence, without changing execution code.

## Accepted publication

[Run 44009258503](https://github.com/CleMeY15/auto-world/actions/runs/44009258503),
workflow420550475, number2/attempt1, job133792027987, completed SUCCESS on
main `9b8996413fbc32bdd9a9bbafdce57e8c38da0cff`, tree
`a72ae1e1f406f2d4c1ba6ce2472233e96b7b73bc`. All14 phases pass in order,
including actual docker-container publication, fresh authenticated digest
readback, owned Docker cleanup and owned path removal. The scanner was not
executed by the publisher.

| Public identity | Accepted value |
| --- | --- |
| Artifact | `14296495446`, `scanner-retention-publisher-44009258503-1` |
| ZIP | 1478bytes, SHA256 `a69744c9c8a75c9d676fbfeeb0b2cee3f442a852b30129d604f3804e805e1197` |
| Artifact expiry | `2026-12-01T03:20:04Z` |
| Receipt | 3294bytes, SHA256 `d38e27d05f221935a9a45ee0221d0b2ec984e7c19ba59629df2cee130c87a237` |
| OCI manifest | `sha256:f864d4703f42ec6f675f63e03201584ebfe61941cb1ce4374f753f1f300b4eea` |
| Inner tar / readback | 234696704bytes, SHA256 `a35e46af174ef948f6c886fd78805d740065222e6502b188d5197912a250e13c` |

The stopped readback container was never started. Closed artifact ZIP,
canonical success receipt, publication identity, copy intake and sidecar
validators pass. The actual tar hash differs from the earlier offline
rehearsal; the accepted value above comes from this actual publication and
its matching readback, not from the rehearsal's injected control-plane data.

Independent original-evidence review:35291bytes, SHA256
`e4ec6a63248db8c4d712ed8db4ed15f2f1ec641da3c6322be621fa4378483d67`.
Private originals are retained under
`.local-data/task0005-recovery-independent-dtjbtmz0/`.
Its complete manifest covers213files/6590785bytes; manifest39738bytes,
SHA256 `2fd0cf0853013714fbc7755282be1ec14b722addd2837405cbb61de47c2894ee`.
The reviewer and parent verified coverage and hashes without divergence.
Manifest and verification envelope exclude themselves explicitly.

Evidence limits: private staging, package checks and Docker operations are
substantiated by authenticated execution, bound source and the receipt.
Raw private payloads, Docker command outputs, baseline inventories and the
exact backend BuildKit version are not publicly retained or independently
retrieved by this review. No broader byte-level payload inspection is claimed.

## Delivery prerequisites and preserved history

PR244's implementation main `c38c9c1a0e64f80c2170c00f4e87286e349b60c6`
has four successful attempt1 quality/managed/Windows/tools runs and independent
original-evidence acceptance, review SHA256
`2bbd370bf33f5c243b1cf6a3654156eaaa8cca516dd3b0f036ba22d995535102`.
The subsequent ten-document overlay on9b has its own accepted
[CI44005832112](https://github.com/CleMeY15/auto-world/actions/runs/44005832112)
and source reconciliation:1426 tracked files unchanged,205 local links valid.
The four infrastructure proofs remain attributed to c38. Tip reconciliation
and fresh preflight review SHA256:
`d940d3d5f6b7dc6842b3b7c73af6f5e76e6d2dc207a1f2e0710bf84ea99ed668`.

The parent recorded exclusive durable intent before one dispatch POST;
GitHub returned HTTP204 and the exact new run was authenticated. History
contains exactly two runs. Original43988267108 remains FAILED before push,
cleanup UNKNOWN, and its original receipt is unchanged. Success of run2
does not retroactively qualify run1. No run3, rerun or replacement workflow
is authorized. Publication is consumed and must not be repeated.

The original PR237 qualification remains run42684309304/artifact13706967607,
5119275bytes, SHA256
`063bcda8a6e60bbe9f419663d5c4a634f342506df66d325fe57582f4e5dc7551`,
689entries/11mappings, expires2026-11-23T20:18:16Z. New diagnostics cannot
substitute for it. Rust498/590 remain source-lock package counts; complete
binary inventory and source/binary equivalence remain NOT_ESTABLISHED.

## Validation and remaining gates

Publication approval above is distinct from acceptance of this new policy
revision. Final policy:31163bytes, SHA256
`7e1f3e7708c2cce06e6a475a3f891d14be9b36ad11667095e5cd828542078201`.
Its only semantic change is the reviewed eleven-field publisher observation.

Scoped retention tests:154pass/seven existing Windows-only exclusions/zero
failures. A private replay of authentic saved API responses and the3294-byte
receipt passes using the production default observation, with no binding
override; changed receipt, predecessor identity, changed artifact digest and
null observation are refused. No real copy is performed. Implementation
report SHA256 `00629c836c2e8d01dd68869f05eec5dd1da2c10c4fb587aa57388cecde834bb3`.

On frozen source, Node22.23.2/pnpm10.15.0: `pnpm lint`14tasks and
`pnpm typecheck`23tasks pass without cache. Separate workspace tests
(`pnpm exec turbo run test --concurrency=1`) pass776 tests,28tasks/eight cached;
`pnpm build`14tasks/13cached, secrets1437files and low-threshold dependency
audit pass. Source bytes remained unchanged during these serialized checks.

Complete local `pnpm test` is **FAILED**, not locally accepted. First run under
inherited umask0002:2991pass/161fail/123skip; unchanged native guards rejected
group-writable fixture files. A representative15-test attestation suite passes
with process umask0022. The complete rerun with0022 remains FAILED:
3006pass/146fail/123skip. `/tmp` is tmpfs, while native fixtures hardcode `/tmp`
and the unchanged storage guard requires ext4. This VPS limitation was already
recorded in the restoration handoff; no assertion, fixture or filesystem guard
was weakened, and no further root-suite retry was made. Both failures and the
diagnostic are retained under `.local-data/task0005-publisher-observation-hk67mbup/`.
These local failures are not relabeled as successes or as the hosted CI skips.

### PR245 quality failure and fixture correction

The first [quality run44012416449](https://github.com/CleMeY15/auto-world/actions/runs/44012416449)
on source `98a536cf063a2dc08eeaaeead3e74b3f6b0035f5`, attempt1,
failed at root tests:3160pass/one failure/67 existing skips. The failure was
the admission-session VM wrapper: its cleanup-without-close scenario never
reached the expected hanging Docker child (`hanging === -1`). Its fixture
started a real5ms compressed drain timer before asynchronous volume inspection.
Expiration there correctly makes production cleanup uncertain, but prevents
the test from exercising the intended missing-close path. The original CI
log does not expose the precise scheduling interleaving.

A private controlled reproduction delayed that preliminary inspection by20ms
and produced the identical assertion failure. The corrected fixture passes
the same delay. Both adjacent hanging-cleanup tests now use Node's test-scoped
mock timers and wait for the intended child before advancing the existing
compressed deadline. The missing-close case then advances post-kill grace
separately and drives late closure explicitly. All previous ownership,
no-later-child, preserved-secret, helper-stop and authority-close assertions
remain; a late close also demonstrably cannot authorize a new session.
Production code, policy, deadlines and admission generation pins are unchanged.

Validation on Node22.23.2: both targeted cleanup cases pass; the complete VM
session suite passes38tests with zero failures, exclusions or cancellations;
its ordinary root-runner wrapper passes; scoped ESLint and diff checks pass.
These are simulated session tests, not native lifecycle acceptance. The earlier
full local root failures remain recorded above; that suite was not retried.
The failed run/API/job/log ZIP, intentional red reproduction and corrected
checks are retained under `.local-data/task0005-pr245-ci-fix-jrrle479/`.
Failed log ZIP:485488bytes, SHA256
`68f582ff73e34ad843e0f0b5eb0bc27702197faa298c9a4a66f94b32644f6f17`.
The original failed run remains attempt1; the corrected commit requires fresh
source checks and review before delivery. No publisher was rerun.

### Delivery gates

Independent source review and fresh exact-source quality, managed, Windows
and tools original-evidence acceptance remain required before normal merge.
After merge, the corresponding protected-main checks and original-evidence
review must pass before observation delivery is accepted or NexusLite runs.
This is eligible for draft delivery, not a claim of
full local validation. Full browser/root/native evidence will come from those
actual CI runs; no local browser rerun is claimed for this non-UI change.

Rollback before copy restores the previous null observation and its policy
hash through normal review; it does not undo publication, erase the receipt,
delete a registry object or authorize another run. Keep the immutable actual
publication evidence. No service data migration or destructive cleanup is needed.

After observation delivery, the real second copy and manifest-first restore
must run on NexusLite's physical C:/NTFS under the approved contract. No
incoming VPS-to-NexusLite SSH exists; hosted Windows or Linux tests are not
that proof. The user's eventual VPS-transfer preference does not silently
replace this acceptance target.243 upstream blockers remain unwaived;
service-image closure/admission, support and the final17 real lifecycle
phases remain open.
