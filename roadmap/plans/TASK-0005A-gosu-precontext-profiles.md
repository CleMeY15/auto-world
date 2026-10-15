# B1a corrective increment — retain the original pre-context profiles

Status: APPROVED_FOR_SOURCE_IMPLEMENTATION by a distinct Architect. Owner: Platform/SRE. One focused branch/PR from main `2ecf0a323daa5ec6f7bd462d5bb278e59881cc0b` (PR174). TASK-0005A/0005 remain IN_PROGRESS; TASK-0006 remains blocked.

## Goal and dependencies

The [B1a contract](TASK-0005A-gosu-image-build-observation.md) requires bounded original routing profiles before reading the accepted context. The client currently validates those bytes but discards them and most parsed fields. A later private caller cannot reconstruct the original observations through extra post-operation commands. Retain the first observations in the public operator's private result before authoring or launching that caller.

PR174 corrects ordinary-client headroom and implicit Buildx context selection. Its passing exact-head/main CI is evidence for those source corrections only. The unchanged accepted private context, original preparation, genuine Seaweed/A, daemon lease and all earlier receipts remain untouched. No actual image construction has taken place for B1a. No dependency, workflow, classification, lock, recipe, archive predicate or UI change belongs to this increment.

## Output contract and implementation

- Add `profiles`, with `stage: PRE_CONTEXT`, to the frozen observation result. It contains exactly `context`, `version`, `info` and `builder` observations. Each observation binds the fixed Docker binary and full routed argv, a closed representation and its parsed projection, plus private stdout/stderr envelopes `{encoding: base64, bytes, sha256, base64}`. These are the exact first successful ROUTING responses, including stderr, encoded and hashed immediately before any later callback can mutate the buffers. No raw Buffer remains exposed.
- Context projection: `name`, `endpoint`. Version: `serverVersion`. Info: `daemonId`, `dataRoot`, `os`, `arch`, `driver`, `containerdAddress`, `namespaces: {containers, plugins}`. Builder: top-level `name`, `nodeName`, `driver`, `endpoint`, `status`, `buildkit`, `platforms`, `representation`. Native text obtains both names from its parsed map. Synthetic JSON has no top-level name: retain `name: null` and the observed `nodeName`, without inferring a name or widening the accepted JSON shape. The null name occurs exactly for FORMAT_ONLY_JSON. Preserve the existing four-field `builder` result for callers.
- Reuse the existing bounded command results. Enforce BUFFER stdout at most 2 MiB and exact `stdoutBytes` accounting, and stderr at most 2 MiB, including injected runners. Four stdout/stderr pairs total at most 16 MiB of raw bytes; base64 expands the private JSON. No extra profiling command, source/archive/context read, daemon operation or timer extension is allowed. The 25-second stop reserve remains intact.
- Keep fixed command routing, runtime guards, context single-consumption, archive caps, recipe, image identities and all error codes/closed diagnostics unchanged. Raw profiles are private operational evidence: retain only in a caller-owned 0600 record, never public logs, diagnostics, PR artifacts or telemetry. Failure diagnostics must not expose these bytes. Added projections confer no build, runtime, vulnerability, provenance or admission guarantee.

## Acceptance criteria and tests

Before editing production, add regressions that fail against the baseline client. FORMAT_ONLY VM tests must prove byte/base64/SHA equality for nonempty stdout/stderr; complete projections agree with validated raw data; native and synthetic representations remain distinct; all four captures precede `contextReader`; each profile command occurs once; later mutation of injected buffers cannot rewrite retained evidence; caller input/result immutability and existing state boundaries remain intact. Oversized/mismatched metadata is rejected before context access with a closed diagnostic. No test may touch the real accepted context or operate Docker/WSL services.

Then run the targeted existing suites on pinned Node22.23.2, lint, typecheck, repository tests/build, secret scan and dependency audit. Existing platform exclusions remain explicit. Require independent code/security-boundary review, a protected-file/append-only documentation comparison, exact final-head CI, merged tree equality and main CI before source delivery. An injected positive is FORMAT_ONLY, never evidence of an actual image.

## Operational implications and rollback

There are no migrations or dependency changes. The result adds bounded private data; the future private caller must allow its base64-expanded size and fsync a 0600 record. Rollback is reverting this isolated source increment; doing so restores the known evidence gap and blocks the actual B1a caller. No cleanup, retry, rematerialization, activation or public registry operation follows from this plan. Support dates stay null and authority/admission stay NOT_AUTHORIZED.

## Delivery evidence

Baseline: `.omx/gosu-derivative-image-precontext-preedit-v1.json`, 992 tracked files. Implementation, five RED regressions, 37/37 GREEN VM cases, distinct independent code review, targeted Windows/Linux suites and six local gates pass. Exact final-head/main delivery gates remain pending. The [validation record](../../docs/validation/TASK-0005A-gosu-image-build-observation.md), [ADR0015](../../docs/decisions/ADR-0015-gosu-compiler-derivative.md) and [delivery log](../DELIVERY.md) are updated append-only. Actual B1a remains blocked until the corrected source is delivered and the separate private Root/UID caller is reviewed.
