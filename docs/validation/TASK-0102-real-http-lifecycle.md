# TASK-0102 — Real HTTP lifecycle correction

Status: SOURCE_VALIDATED / DELIVERY_PENDING in [PR153](https://github.com/CleMeY15/auto-world/pull/153). The original API delivery through PR150/main03ac41ffbfe7ec157d4108f8da2741dc7b08079e and CI38186090262/38186475270 is preserved. Actual whole-flow web validation revealed a socket correctness gap; TASK-0103 acceptance waits for this focused repair.

## Trigger, diagnosis and plan

A normal POST on the actual loopback demo process can return200 with an empty body. Installed Fastify5.12.5 `lib/route.js` creates its handler-timeout signal and unconditionally aborts it on incoming request `close`. In Node22 that event also follows normal completion of an incoming message. The API trusts this signal as disconnect and abandons the read/returns undefined. Existing injection success tests and raw duplicate-header/disconnect tests did not cover a successful socket body; the existing stalled-read deadline test uses injection.

Preserve ADR0014's public protocol, five-second application deadline, true disconnect499 without writes and exactly-once terminal telemetry. Own the application deadline/abort signal using true incoming abort or unfinished outgoing response closure. Normal body completion remains eligible for a full validated response. Route handlers finish with explicit replies on success/failure/cancellation; late abandoned reads cannot publish.

First record failing actual socket success/detail/default-adapter/error/deadline regressions against the delivered source. Then repair only the API lifecycle and rerun API lint/typecheck/build/production-graph/unit/network tests. Independent API/security review, fresh quality/browser/secrets/audit gates, exact final-head CI, identical reviewed merge tree and protected-main CI precede closure. No dependency upgrade, SDK/public-schema change, remote source, real service, registry or Native action.

## Acceptance pending

Revision1 passed 37 API tests but independent review rejected two telemetry defects: an abandoned read was labeled read_unavailable rather than cancelled, and onSend recorded success before the response had actually finished. Its 787-byte source index/SHA256 f7c13079deaf0e5c853744b019a480ae3e31347bc49f8e4b9e8d420ec0f43352 and 11202-byte raw gate transcript/SHA256 43e9bab0fadf9dcb51a835ea764fd4028d6eb976355e7f544b5cfc1404f71dbb remain preserved as rejected evidence.

Revision2 closes both findings. Every application-owned abandonment is cancelled; the read span records 499 on disconnect and 408 on deadline. API success is recorded at ServerResponse.finish; a close before writableFinished records exactly one 499. A genuine successful read may truthfully keep its already-settled read span 200 while the later API transmission fails with 499. A delayed-onSend real TCP regression covers this distinction.

The frozen revision2 index is 787 bytes/SHA256 406df7dad965b1bb3fd049d5896dcace15870b879ec4159dc792673003cb8c68. It binds services/api/src/index.ts, 16052 bytes/SHA256 373665c7c208d788b6bd2cdd8afa7456a6c7a784a99423896173f4b7b20ffa80, and the existing network suite, 15665 bytes/SHA256 444994ee38cfa5bbf0f08efebb6c323f6d3855fb1d71b1fe45e6db1967d8dd66. Fresh pinned Node22 Windows lint, typecheck, build/production boundary and 38/38 API tests pass; the original raw transcript is 11454 bytes/SHA256 952c0431fe6ac07dffe8792e8f8edb9ebdfdfef0726243e37ac9543bb8e4cebc. Independent API/security review gives CLEAR/APPROVE after a fresh targeted build and 7/7 network tests, including the real five-second deadline. Index, sources and gate transcript match before/after review. These native-agent reviews are not GitHub Review objects. Final-head CI, identical merge tree and main CI remain pending.

An isolated delivered-base negative control reruns the newly frozen real search/typed-error regressions against compiled original API bytes, after verifying its source exactly matches main03ac41ff. Both fail: success has an empty200 body; typed invalid_cursor returns200 rather than400. Its raw2181-byte stdout/SHA25679ec5daeb6826d1ae9dcdc61b9eb668f92a856b2f7f36e924d1273213c698329 and empty stderr are retained with compiled/test identities. Only test imports change for this isolated control; frozen repair source and compiled current API are untouched.

Real positive POST and exact-detail JSON wrappers; default SDK-backed composition; closed typed/throw/malformed/missing errors; writable five-second socket deadline; true disconnect with aborted read/no write; ignored late read/once-only telemetry. Root quality/delivery evidence remains pending. Passing injected tests alone is insufficient.

Rollback restores the prior synthetic API implementation or disables the explicit demo process; canonical SDK evidence and all original delivery/failure records remain intact.
