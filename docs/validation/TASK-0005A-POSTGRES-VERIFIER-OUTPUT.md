# TASK-0005A — PostgreSQL supplemental verifier-output controls

Status: ACTUAL_VERIFIER_OUTPUT_CONTROLS_ACCEPTED, 2026-10-06; PR134 DELIVERED after exact-head and identical reviewed merge/main quality CI. Independent actual/default-validator and distinct privacy/preservation reviews returned APPROVE/CLEAR. This closes only the missing verifier-output requirement of [ADR-0007](../decisions/ADR-0007-private-image-admission.md). It grants no image admission, supported runtime or support dates.

## Accepted input and narrow authority

The original [P4 receipt and five retained files](TASK-0005A-POSTGRES-ATTESTATION.md) remain unchanged. Protected-main run36858133579 signed the fixed PostgreSQL subject at source/signer `64778982b86faf17cb4ede9fd8027869049f6602`. Its genuine positives, six rejections and three malformed bundle-input errors do not establish missing or truncated verifier-output behavior.

The supplemental controller uses that same official bundle23607bytes/SHA256 `a09432b7020435699d911da1082537290880eec2db865b4d21cdf09dc0b969d1`, predicate9949/`d724d03784b62b5fface2f0241e18b203fbbc5702f23bc7de8296f5ffa0d301c`, and pre-sign receipt837/`983ebb489bdae61bef59ac3f389084c528fb20beecf5edd8ce4ecb46b078fe3e`. Access and original verification receipts also receive their fixed byte checks. No signature, registry access or candidate execution is repeated.

The local manifest is explicitly `RECONSTRUCTED_FROM_REVIEWED_DESCRIPTORS`, using the reviewed media type, config and twelve ordered layers. It contains exactly2824bytes and hashes to the signed subject `0045bdab5483336d93550ccae8a2cfb359fc62d0fb4e5617837e08bbb99f8c93`. The supplemental authority comes from these full bytes and the production statement validator's exact OCI name/digest checks. It is not an original retained manifest or a current registry observation.

## Official verifier and control sequence

The historical gh2.98.0 pin remains unchanged. This controller independently pins [official gh2.102.0](https://github.com/cli/cli/releases/tag/v2.102.0), release source `fc4b137cdef0a6bd28fd461b7cf9c84a5812a8cd`:

| Object | Bytes | SHA256 |
| --- | --- | --- |
| linux_amd64 archive | 15319960 | `bb766f710eef8ede859c18578c72c327597cd4c8a85b06001b1f3843c6019386` |
| official checksum list | 1971 | `afe49e9affa232faa8212aed035417166f6ade9b9470acb53d4dbd28c0504e8d` |
| extracted gh binary | 42086560 | `7469124f706944133d6a169691dd1c6c3511b12e85878d255e044e2948df4c9b` |

This release includes the official fixes for [source-ref matching](https://github.com/cli/cli/security/advisories/GHSA-4mq3-hpgx-9cx8) and [signer-workflow matching](https://github.com/cli/cli/security/advisories/GHSA-wjmr-j3rp-mh2g). The [official CLI](https://cli.github.com/manual/gh_attestation_verify) supports a local artifact file with a local bundle. Existing production OCI invocations remain unchanged when the internal artifact path is absent.

The official CLI initializes TUF caches even with a local bundle. A separately reviewed, tokenless `gh attestation trusted-root --hostname github.com` collection therefore retains the two public roots as exact JSONL bytes before the four verification calls. That collector requires bounded stdout, two complete JSON lines, empty stderr, code0, EOF and process closure. Its owned cache is validated before any unlink; unknown or substituted objects are preserved. Only after verified cleanup does it seal the root and collection receipt. The supplement authenticates this root alongside the manifest and passes `--custom-trusted-root`; neither option is a general override for the historical OCI verifier. Frozen roots do not evaluate later revocations; currentness and revocation remain NOT_EVALUATED. See [official offline verification](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline).

The accepted public-root collection completed at2026-10-06T12:03:05.502031Z. Its root JSONL is34634bytes/SHA256 `65ca537f6ed8a47fd0e560c421baa1f6c1efb8b25fc200d8c5c02c0e92eb2b9c`; the private collection receipt is6504/`7c785ccd596fbc5524b9b6498f2a705d1950f16fd4c6630255db0e586196a702`. The root-protected executed collector is11719/`1ed0c565e1d0ccbb1cb9f61b44630a8c261fc6f59a8ec844f53fb5ec59e94add`, independently APPROVED after five native cleanup/race fixtures. Code0, both stream EOFs, empty stderr, two complete roots, full tool/input seals, all descriptor closure and cache cleanup passed. The prior collector preserved a FAILED/INCOMPLETE attempt because official TUF metadata used0644 within private0700 ancestors; it published neither trusted root nor success receipt. V2 accepts only the eight exact public TUF metadata paths at0644 and retains0600 for every other file. It uses fresh storage and preserves the failed first attempt. This collection itself has not verified the bundle.

The sequence is fixed: genuine identity and workflow positives before controls; six transformed-output controls using those two successful stdout values; genuine identity and workflow positives afterward. Both policies independently validate the same complete statement, subject, predicate, certificate, source/ref, signer, runner and original run URI.

| Transformation of a real successful output | Required classifier outcome |
| --- | --- |
| MISSING: stdout property absent | ERROR / cli_process_error |
| TRUNCATED: remove the final non-whitespace structural byte and following whitespace | ERROR / cli_result_invalid |
| MALFORMED: deterministic invalid JSON corruption | ERROR / cli_result_invalid |

These are `ERROR_NOT_REJECTION`; a network, authentication, process or syntax failure cannot establish a policy rejection. Four genuine process outputs are retained privately with bounded byte counts, full hashes, exclusive0600 creation, fsync, complete readback and native path/FD checks. Public evidence contains only fixed basenames, sizes, hashes, statuses and codes.

## Execution and retention boundaries

Actual execution requires independent code review and an externally reviewed fixed launcher binding the exact executed recipe and all transitive code/input/tool identities. The launcher supplies no free paths, subject, credentials or dependency overrides. Linux actor1000 uses a fresh private HOME and no registry or GitHub token. Input, tool and sealed trusted-root identities are checked before and after execution; every descriptor must close before a successful receipt.

The receipt's authority is `LOCAL_SUPPLEMENTAL_VERIFIER_OUTPUT_CONTROL`. Registry reads are NOT_ATTEMPTED; currentness NOT_EVALUATED; P5 NOT_ESTABLISHED; runtime/admission NOT_AUTHORIZED; all three support/archive dates stay null. The expired original audit remains the historical signing-time proof. It must be refreshed before activation, without rewriting this bundle.

The architecture received independent APPROVE/CLEAR on2026-10-06. Targeted implementation gates passed: native output controls7/7, Windows plus historical regressions32tests/27passed/5native skips/0fail, targeted ESLint and diff checks. The first full native check passed lint/typecheck, then reported1987tests/1956passed/1failed/30expected skips; that old unchanged local-runtime-restore audit failure remains FAILED with exact historical causality UNESTABLISHED. A fresh probe observed WSL wall-clock regressions, while its62 isolated tests passed. Independent review cleared the historical supplemental quality gate using complete exact-head CI37461659497 on7dc3bd8ee35b6dad10cc7a76fe4003c5b04bbfc2, where lint/types/tests/build/secrets/audit all passed; production freshness guards remain unchanged.

The first fixed local invocation of that recipe remains FAILED. Its independently approved caller4969bytes/SHA256 `133a5cb4981ffc02493d336a739cfd5b520ad99048a5320664c48db5f9820606` and root supervisor36784/`cdd1894881a99156238b44bfcac60dfcb4f4de18a5fd059b118ee467873355d0` preserved actor stdout0bytes and stderr915/`b7c831fd2f2afb717d4c833d9181c13afe2dbafdd763bd48b769e2003ad37749`, with root stderr947/`b6492fbbc2b25984e91200fa77f33f33e5cbff8693f1ed40ab4e566f737ca637`. ESM module initialization failed before the caller body because the transitive host-loopback module requires retained `infra/seaweed-image/base-config.json`; the64-file ESM/source closure omitted this filesystem data resource. Outputs remained absent, both streams reached EOF, process code1 closed, no ACK was published and zero controller/gh verification calls occurred. Preserve that stage and failure; a fresh closure must retain the resource and pass an actor import-only smoke before production verification. Separate inspection also found a63-hex-character trusted-root literal; the fixed pin now matches all64 characters of the actual retained root above, with a shape and exact-pin regression. These preparation defects are not policy rejection or signature failure.

## Accepted actual supplemental execution

The fresh protected stage binds executed recipe ad873ea843a279eac2b674332164e72f487657b9/tree d25b23f3e3ac4dcb69837510ae046ca18b03da2b and all67 resources/1946157bytes/16 anchors. The second import-only preparation preserved a missing go.sum failure; the complete closure adds that file and required-tests.json alongside the base configuration. The first successful import probe is retained as an observed-only capture, without authority for enforced stream bounds. Its additive corrected probe enforces65536-byte limits while reading, monotonic timeout, partial preservation, real process closure and EOF. Its1743-byte receipt/SHA256 6fec169993743f34c59f8419b01b170fcece8434b71defe980686a7c2ed3f7eb proves IMPORTED_CLOSED with zero controller/verifier calls and absent outputs. Four harmless native capture fixtures pass; all earlier stages remain intact.

The fixed caller4972/f955689d9a73edba91da898f08511f115dd0024755c774dc5ab655f86e937e30 and root supervisor41235/4ca23a6c6fb350005e4555eeefd14f4ef8320c494c9dc5fd97537db0ef6d86c8 received final independent APPROVE before one actual invocation. Supervisor tests pass8/8 on Windows and native Linux. The separately reviewed staging/invocation helpers pass four harmless process fixtures; their exact pins and the866-byte root staging receipt are in the [public supplemental projection](../../infra/postgres-image/candidate-attestation-output-acceptance.json).

The invocation succeeded with code0, signal-null, both EOFs, actual process closure, no overflow/timeout and empty stderr. Root stdout415bytes/SHA256 8dc73cedb10b60ead76aa6744d84513867b1823d8401cc794dd35b04d30f05cd binds the4639-byte root ACK/SHA256 cb9becaf7f8bae0b34588b5e305cfe7d3c3dce3a476eaddf7bfc06181fa8d382. That ACK authenticates the10642-byte producer receipt/SHA256 1ee78421033ffd766dedd76f18de7b8b6c5b8d90f6cf3ec5461b3b5f6986ef92 and four genuine private outputs:

| Policy / phase | Bytes | SHA256 |
| --- | --- | --- |
| identity before and after, two files | 35855 each | 4e516a3aeddeec53c3ad8233d0e2ff31cce77e194e743b4e63649fe58dc7cd52 |
| workflow before and after, two files | 35885 each | 40cf60c2bc277622c85fe1ce82bfced671d0ecba8f88321c265d1b15f3446665 |

Independent actual review authenticated complete raw bytes/native seals and re-evaluated the real outputs in memory through the default production statement/policy validators, without another CLI or controller call. Exact subject/source/signer/workflow/ref/certificate/predicate/run checks pass; all four genuine outputs are VERIFIED and six transformations match ERROR_NOT_REJECTION. All67 source Git blobs, tools, public roots, provisioning and five original P4 inputs remain unchanged. A distinct privacy/preservation reviewer APPROVES the exact11086-byte projection/SHA256 9ccd9de349b1796bd3c5b31f3a1e1c1152a2a9e0c9dc905bc5ccaae38608ce9b, containing only public identifiers, basenames, sizes, hashes and bounded statuses. The original4744-byte P4 acceptance/d110b09c23fd70e95e6514a02b1124805265ae37a9a3363a12ec7418c40a114b remains unchanged with output controls NOT_ESTABLISHED; this separate supplement supplies that authority.

Fresh corrected native targeted tests22/22 and exact executed-head CI37466026822 pass, with independent code/spec/security APPROVE/CLEAR. PR134 is delivered: independently approved final head cad94f052832e0eb084057a585e045dd4aaa0296/tree e46c5edc2ae9614e1e8c23e4183fd99f180175c4 passed CI37470662145; identical merge e91d088a22af5ed73991a936079868ba1c2345fa passed main CI37471167565. No earlier failed native check is relabeled. P5 will retain every failed and successful control, the supplemental executed recipe, real outputs, reconstructed manifest and official tool alongside the original P1/P4 closure.

Rollback refuses the supplemental claim and admission, preserving original and failed evidence. Uncertain or foreign objects are preserved. No producer is redispatched and no volume, backup, registry object or source archive is deleted.
