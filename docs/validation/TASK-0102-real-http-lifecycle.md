# TASK-0102 — Real HTTP lifecycle correction

Status: IMPLEMENTATION_IN_PROGRESS. The original API delivery through PR150/main03ac41ffbfe7ec157d4108f8da2741dc7b08079e and CI38186090262/38186475270 is preserved. Actual whole-flow web validation revealed a socket correctness gap; TASK-0103 acceptance waits for this focused repair.

## Trigger, diagnosis and plan

A normal POST on the actual loopback demo process can return200 with an empty body. Installed Fastify5.12.5 `lib/route.js` creates its handler-timeout signal and unconditionally aborts it on incoming request `close`. In Node22 that event also follows normal completion of an incoming message. The API trusts this signal as disconnect and abandons the read/returns undefined. Existing injection success tests and raw duplicate-header/disconnect tests did not cover a successful socket body; the existing stalled-read deadline test uses injection.

Preserve ADR0014's public protocol, five-second application deadline, true disconnect499 without writes and exactly-once terminal telemetry. Own the application deadline/abort signal using true incoming abort or unfinished outgoing response closure. Normal body completion remains eligible for a full validated response. Route handlers finish with explicit replies on success/failure/cancellation; late abandoned reads cannot publish.

First record failing actual socket success/detail/default-adapter/error/deadline regressions against the delivered source. Then repair only the API lifecycle and rerun API lint/typecheck/build/production-graph/unit/network tests. Independent API/security review, fresh quality/browser/secrets/audit gates, exact final-head CI, identical reviewed merge tree and protected-main CI precede closure. No dependency upgrade, SDK/public-schema change, remote source, real service, registry or Native action.

## Acceptance pending

Real positive POST and exact-detail JSON wrappers; default SDK-backed composition; closed typed/throw/malformed/missing errors; writable five-second socket deadline; true disconnect with aborted read/no write; ignored late read/once-only telemetry. Root quality/delivery evidence remains pending. Passing injected tests alone is insufficient.

Rollback restores the prior synthetic API implementation or disables the explicit demo process; canonical SDK evidence and all original delivery/failure records remain intact.
