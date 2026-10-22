# TASK-0005A — fresh Gosu retained-pair native controller V1 source plan

Status: `APPROVED_SOURCE_PLAN_ONLY`. The frozen private proposal V5 (89,855 bytes, SHA-256 `f270f410c3e934efe3c4ea8f5e2a7e561a62081734297f072fe2211662f7b0e4`) received Architect `CLEAR_SOURCE_PLAN_ONLY`, then a distinct Critic `OKAY_SOURCE_PLAN_ONLY`. PR188 delivery was independently confirmed. Only this focused source implementation is authorized. This plan grants no native Docker operation, archive read, retry, publication, image load, service start, admission or support activation.

The ordered planning reviews completed before source edits. This public document preserves the approved V5 contracts; only its title/status metadata changes from the frozen proposal. Implementation, source reviews, local quality checks and protected source delivery are recorded separately in [validation](../../docs/validation/TASK-0005A-gosu-retained-pair-native-controller-v1.md). Native execution remains a later separately reviewed gate.

## Outcome and hard prerequisites

Prepare the smallest reviewable controller that can perform one future genuine default call to `runGosuDerivativeImageRetainedBuildProofV1`, stop only its authenticated isolated daemon, revalidate the two retained archives after that stop, and publish a closed preservation receipt outside the export directory.

No implementation starts until all of the following are evidenced in order:

1. **Confirmed:** PR188 source `2435bce8068146c55fed06ddf7189b70ac8c7475`, tree `c47ed63d3ae51817035227e0b4977ac41ce0dfef`, has exact-head CI `39534149143` SUCCESS.
2. **Confirmed:** PR188 merged normally through strict protected `main` as `5497b9c6a23213010cd1446624bbe2dde7c662ad`, with the same source tree `c47ed63d3ae51817035227e0b4977ac41ce0dfef`, and merged-main CI `39535451364` succeeded. The delivery record is `.omx/evidence/gosu-retention-snapshot-delivery-v1.json`; it is evidence only and never part of the later deployment copy.
3. This plan is frozen to exact bytes and receives Architect CLEAR followed by a distinct Critic OKAY.

Product PR187 is now delivered: reviewed exact source head `2cf4c478bfe80116e091c82d8a201cd7063388ae`, exact-head CI `39536425201` SUCCESS, normal protected merge `81e9aee793820f543a12f27e4d5ba42d702f4cc8`, matching merged-main CI `39538031586` SUCCESS. The controller source branch starts from that delivered main and preserves PR187's two documentation changes. Its final freeze, source reviews, complete gates, exact-head CI and merge must use that baseline or a later independently delivered coordinated main. Main merges remain serialized because the workflow cancels an older run for the same ref.

The source increment and the later one-shot operation are separate gates. Source delivery cannot count as native evidence. Native execution cannot begin until its newly generated private actors, control and claim receive their own ordered pre-dispatch Architect then distinct Security/Critic acceptance.

## Corrected repository map

The earlier assertion that no compatible tracked daemon lease exists is incorrect. The delivered repository already has the exact reusable daemon lifecycle:

- `scripts/postgres-image/gosu-derivative-image-daemon-v2.mjs` exports `startGosuDerivativeImageDaemonLease`.
- Its identity uses purpose `GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION`, `/var/tmp/aw-cl-XXXXXX`, `aw-cold-${nonce}`, `awcold-${nonce}`, `plugins.awcold-${nonce}`, Docker 28.0.4, `client/output`, the root/client actor identities, deadline and socket proofs expected by the observation module.
- `verifyInventory("BASE_AND_CANDIDATE", subjects)` accepts exactly two image config IDs/references and requires zero containers and zero volumes.
- `stop({requireMode:"BASE_AND_CANDIDATE"})` re-verifies that same inventory, stops only the helper-proven PID/start-ticks pair, proves socket and pidfile disappearance, leaves daemon private state retained, and returns `privateState:"RETAINED"`.
- Stop has no broad cleanup primitive and does not delete or rewrite `root`, `client`, `output` or either archive, nor does its code chmod/chown those three directories. Process termination is expected to make only the daemon socket and pidfile disappear, which necessarily changes their containing `endpoint`/`infra` namespace metadata; that is part of the authenticated stop proof, not cleanup of retained data. Its held-directory guards deliberately bind directory identity/owner/mode rather than child-created mtime/ctime, so a valid `BASE_AND_CANDIDATE` state with exactly two images, zero containers and zero volumes remains acceptable after the build while `client/output` contains the producer's two TARs. The producer independently closes that output namespace to exactly the two final TAR names.

Therefore this plan must reuse daemon V2 unchanged. It must not introduce a new daemon, adapt the PostgreSQL runtime daemon, weaken daemon V2 input validation, remove either retained image, or add a generic lifecycle abstraction.

The compatible producer is `scripts/postgres-image/gosu-derivative-image-observation-v2.mjs` at the delivered PR188 pin: 86,949 bytes / SHA-256 `48c0beef5e4a6c674798c3764693980d996154bda92215945950585a99016183`. The future client worker calls only `runGosuDerivativeImageRetainedBuildProofV1(input)` with one argument. It never supplies `now`, runner, context reader, archive reader or any other dependency injection.

## Chosen delivery shape

Choose a focused public source increment before any actual attempt. A private one-off actor alone would have to invent and validate root/client IPC, result validation, stop ordering and receipt publication without ordinary CI. A public controller increment allows meaningful protocol, failure and real-filesystem coverage while reusing the already delivered daemon and producer without changing them.

This is not a new generic framework. The source increment is a Gosu-specific root supervisor, a Gosu-specific UID1000 worker, validators, tests and bounded documentation. After protected delivery, a separate fresh private control invokes that delivered controller exactly once.

The final source baseline is the exact protected `main` delivered after both PR188 and coordinated product PR187, including PR187's two reviewed documentation changes. The increment's closure must prove every baseline tracked blob unchanged except the three explicitly authorized append-only records below. For each of those three records, its complete baseline bytes must remain an exact prefix. Exactly the six listed new paths may be added; the source-manifest value is carried inside the later actual control and no seventh tracked manifest/wrapper path is implicit. The later actual attempt pins the PR188 prerequisite tree, that delivered baseline tree and the final delivered controller tree.

## Future source ownership and exact paths

Create only these new tracked implementation/test documents in the future source lane:

- Production owner: `scripts/postgres-image/gosu-retained-pair-controller-v1.mjs`.
- Distinct production owner: `scripts/postgres-image/gosu-retained-pair-worker-v1.mjs`.
- Independent test owner: `tests/postgres-gosu-retained-pair-controller-v1.test.mjs`.
- Independent test owner: `tests/postgres-gosu-retained-pair-worker-v1.test.mjs`.
- Root documentation: `roadmap/plans/TASK-0005A-gosu-retained-pair-native-controller-v1.md`.
- Root evidence/rollback: `docs/validation/TASK-0005A-gosu-retained-pair-native-controller-v1.md`.

Append only to these existing tracked records:

- `docs/decisions/ADR-0015-gosu-compiler-derivative.md`.
- `roadmap/tasks/TASK-0005A-managed-image-tooling.md`.
- `roadmap/tasks/TASK-0005-local-data-infra.md`.

Do not change daemon V2, observation V2, candidate V2, pair-proof V1, their existing tests, package dependencies, migrations, product files, `currentEvidence` or support dates unless a concrete defect is independently found. Any such defect is scope expansion and requires a new plan revision and reviews.

## Exact public APIs and wire contracts

No third production module is added. Freeze these exports before RED tests.

`scripts/postgres-image/gosu-retained-pair-controller-v1.mjs` exports exactly:

- `gosuRetainedPairControllerV1Contract`, a deeply frozen data object containing the fixed kinds, caps, Node/setpriv pins, environment, deadline schedule, receipt basename and failure-code allowlist below;
- `loadGosuRetainedPairControllerControlV1(bytes, expectedSha256)`, which accepts a real non-Proxy `Buffer`, a lowercase 64-hex SHA-256 supplied independently by the reviewed actual control, validates at most 16 MiB of strict UTF-8 bytes exactly equal to `Buffer.from(JSON.stringify(parsed,null,2)+"\n")`, and returns a frozen non-cloneable capability registered in a module-private `WeakSet`;
- `runGosuRetainedPairControllerV1(inputBytes, loadedControl, options = {})`, where `inputBytes` is a real non-Proxy `Buffer` capped at 64 KiB, strict UTF-8 without BOM/NUL/CR and exactly `Buffer.from(JSON.stringify(parsed)+"\n")`; `loadedControl` is that exact capability; and the only optional own data property is `signal`, a genuine `AbortSignal` used only by the supervisor;
- `gosuRetainedPairControllerV1FailureDiagnostic(error)`, which returns only the exact closed controller failure record defined below.

The controller run resolves only the success ACK. Every other branch rejects with an Error carrying only allowlisted `code`, `phase` and `cleanup` data properties; its diagnostic function closes that Error into the failure record. The worker run resolves only the genuine producer result and otherwise rejects the same way within its smaller allowlists; direct CLI mode catches it, writes the one closed failure envelope and exits with code `1`.

`scripts/postgres-image/gosu-retained-pair-worker-v1.mjs` imports production code only with the literal static import `runGosuDerivativeImageRetainedBuildProofV1` from `./gosu-derivative-image-observation-v2.mjs` and exports exactly:

- `gosuRetainedPairWorkerV1Contract`, a deeply frozen data object containing the fixed transport/result kinds, byte caps, exit codes and production import specifier;
- `validateGosuRetainedPairWorkerTransportV1(bytes)`, a pure canonical transport parser/validator;
- `validateGosuRetainedPairSourceClosureV1(sourceClosure)`, the shared pure shape/order/digest validator used by worker and controller before either performs filesystem comparison;
- `runGosuRetainedPairWorkerV1(transport)`, which revalidates environment and the read-only deployment copy, then calls `runGosuDerivativeImageRetainedBuildProofV1(transport.input)` exactly once with exactly one argument;
- `gosuRetainedPairWorkerV1FailureDiagnostic(error)`, which returns only the exact closed worker failure record below.

The canonical control JSON has exactly these top-level keys in order: `{kind,executionId,baselineRevision,baselineTree,controllerRevision,controllerTree,pr188Revision,pr188Tree,commitRaw,commitRawSha1,sourceManifest,sourceManifestSha256,acceptance,principal,deadlinePolicy}`. Kind is `GOSU_RETAINED_PAIR_CONTROLLER_CONTROL_V1`. `commitRaw` is exactly `{encoding:"base64",bytes,base64}` and decodes to at most 1 MiB. Its computed commit object ID must equal both `commitRawSha1` and `controllerRevision`; its first tree header and the computed manifest tree must equal `controllerTree`. `sourceManifestSha256` is the SHA-256 of `Buffer.from(JSON.stringify(sourceManifest,null,2)+"\n")`. `acceptance` is exactly `{path:".omx/gosu-derivative-context-private-acceptance-v1.json",bytes:11744,sha256:"82b1b1735d6e1063048fbade9d3c86e6b0819a90e54c54ec9898d4937721f5a3"}`. `deadlinePolicy` is exactly `{workerCutoffBeforeDaemonMs:90000,termMs:10000,killAndDrainMs:15000,bookkeepingMs:5000,stopEntryBeforeDaemonMs:60000,postStopMs:180000,controllerAfterDaemonMs:160000}`. No approval, reviewer identity or authority string inside this JSON substitutes for external review evidence.

When and only when the worker module is the direct Node entrypoint, its CLI requires `process.argv` to contain exactly the pinned Node executable and the worker module path, with no application arguments. It reads one stdin document capped at 16 MiB, requires EOF, decodes strict UTF-8 without BOM/NUL/CR, and requires bytes exactly equal to `Buffer.from(JSON.stringify(parsed)+"\n")`. It writes exactly one LF-terminated compact JSON envelope to stdout capped at 8 MiB and keeps stderr empty. Exit `0` means one validated success envelope; exit `1` means one closed failure envelope. Any extra bytes, second JSON value, missing LF/EOF, output overflow, stderr byte, signal, missing `close`, undrained pipe or other exit code is controller failure.

The worker stdin transport has exactly three own enumerable data keys in this order:

`{kind:"GOSU_RETAINED_PAIR_WORKER_TRANSPORT_V1",input,sourceClosure}`

`input` has exactly the producer's unchanged three keys and values: `{purpose:"GOSU_DERIVATIVE_IMAGE_RETAINED_BUILD_PROOF_V1",nonce,lease}`. `sourceClosure` has exactly `{kind,executionId,deploymentRoot,manifest,manifestSha256,calcTreeGitSha1,commitRawSha1,acceptance}`. Kind is `GOSU_RETAINED_PAIR_SOURCE_CLOSURE_V1`; `manifest` is the exact control manifest, enabling UID1000 to hash the same real files independently. It contains no dependency, clock, runner, reader, command, signal or producer option.

Worker success stdout has exactly `{kind,state,scope,result}` with kind `GOSU_RETAINED_PAIR_WORKER_RESULT_V1`, state `SUCCEEDED`, scope `GENUINE_DEFAULT_PRODUCER_ONCE`, and the genuine frozen producer result. Worker failure stdout has exactly `{kind,state,code,phase,cleanup,authority,preservation,dates}` with kind `GOSU_RETAINED_PAIR_WORKER_FAILURE_V1`, state `FAILED`, cleanup in `NOT_STARTED|CONFIRMED|UNCERTAIN`, authority `NOT_AUTHORIZED`, preservation `NOT_ESTABLISHED`, and `dates:null`.

Worker phase is exactly one of `INPUT|SOURCE|ENVIRONMENT|PRODUCER|RESULT|CLEANUP`.

The worker error-code allowlist is exactly:

- `gosu_retained_pair_worker_input_invalid`
- `gosu_retained_pair_worker_source_invalid`
- `gosu_retained_pair_worker_environment_invalid`
- `gosu_retained_pair_worker_producer_failed`
- `gosu_retained_pair_worker_result_invalid`
- `gosu_retained_pair_worker_cleanup_uncertain`

Controller input bytes have exactly `{kind,executionId,nonce,parent,principal}` in that order. Kind is `GOSU_RETAINED_PAIR_CONTROLLER_INPUT_V1`; execution ID is `gosu-retained-pair-` plus 24 lowercase hex; nonce is fresh 24 lowercase hex; parent is the fresh canonical `/var/tmp/aw-cl-XXXXXX`; and principal is the exact existing daemon V2 principal record also pinned by the loaded control. That principal has exactly `{id,root,containerdAddress,containersNamespace,pluginsNamespace,imageIds}`: `id` satisfies the daemon V2 identifier grammar, `root` is `/var/lib/docker`, `containerdAddress` is `/run/containerd/containerd.sock`, namespaces are `moby` and `plugins.moby`, and `imageIds` is a sorted two-element array of distinct daemon-V2-valid image IDs. No principal key or value is widened.

Controller success returns only the frozen ACK with exact keys `{kind,state,scope,executionId,nonce,receiptBasename,receiptBytes,receiptSha256,receiptPhysical,daemonStop,processSupervision,authority,image,admission,preservation,dates}`. Kind is `GOSU_RETAINED_PAIR_PRESERVATION_ACK_V1`, state `SUCCEEDED`, scope `PRIVATE_SOURCE_PAIR_RETAINED_REVIEW_PENDING`; authority/admission remain `NOT_AUTHORIZED`, image remains `BUILT_UNVALIDATED`, preservation remains `PRIVATE_SOURCE_PAIR_RETAINED_REVIEW_PENDING`, and dates is null. `receiptPhysical` has exactly `{dev,ino,uid,gid,mode,nlink,size,mtimeNs,ctimeNs}` as decimal strings except numeric mode; it is captured from the published file and named/held equality is re-proven before close.

Controller failure diagnostic has exactly `{kind,state,code,phase,cleanup,authority,preservation,dates}` with kind `GOSU_RETAINED_PAIR_CONTROLLER_FAILURE_V1`, state `FAILED`, cleanup in `NOT_STARTED|CONFIRMED|UNCERTAIN`, authority `NOT_AUTHORIZED`, preservation `NOT_ESTABLISHED`, and `dates:null`. Its exact error-code allowlist is:

- `gosu_retained_pair_controller_input_invalid`
- `gosu_retained_pair_controller_control_invalid`
- `gosu_retained_pair_controller_source_invalid`
- `gosu_retained_pair_controller_acceptance_invalid`
- `gosu_retained_pair_controller_tool_invalid`
- `gosu_retained_pair_controller_daemon_start_failed`
- `gosu_retained_pair_controller_worker_spawn_failed`
- `gosu_retained_pair_controller_worker_identity_invalid`
- `gosu_retained_pair_controller_worker_timeout`
- `gosu_retained_pair_controller_worker_result_invalid`
- `gosu_retained_pair_controller_worker_cleanup_uncertain`
- `gosu_retained_pair_controller_daemon_inventory_invalid`
- `gosu_retained_pair_controller_daemon_cleanup_uncertain`
- `gosu_retained_pair_controller_preservation_failed`
- `gosu_retained_pair_controller_cleanup_uncertain`

Controller phase is exactly one of `INPUT|CONTROL|SOURCE|PREFLIGHT|DAEMON_START|WORKER_START|WORKER_RUN|INVENTORY|STOP|PRESERVE|ACK|CLEANUP`.

The persisted receipt uses exact top-level keys `{kind,state,scope,executionId,source,worker,nonce,daemon,buildWindow,pairProof,retention,postStop,processSupervision,receiptBasename,authority,image,functional,vulnerabilities,admission,preservation,dates}` in that order and bytes exactly `Buffer.from(JSON.stringify(receipt,null,2)+"\n")`. New nested records are exact: `source` is `{baselineRevision,baselineTree,controllerRevision,controllerTree,pr188Revision,pr188Tree,manifestSha256,calcTreeGitSha1,commitRawSha1,acceptance}`; `worker` is `{kind,state,scope,exitCode,closed,stdoutEnded,stderrEnded}`; `daemon` is `{identity,stop}` using the exact path-free projections defined in the Architecture repair addendum below; the unchanged raw daemon objects are validated privately and are never serialized; `postStop` is `{outputDirectory,base,candidate}`; `outputDirectory` is exactly `{dev,ino,uid,gid,mode,nlink,mtimeNs,ctimeNs}` as decimal strings except numeric mode; each archive is exactly `{basename,bytes,sha256,physical}`, with `bytes` a safe positive integer, `sha256` lowercase 64-hex and `physical` exactly `{dev,ino,uid,gid,mode,nlink,size,mtimeNs,ctimeNs}` as decimal strings except numeric mode; `processSupervision` is `{groupSignalScope:"PROVEN_PROCESS_GROUP_ONLY",observationSignalRace:"RESIDUAL",allDescendantsGuaranteed:false,externalWatcher:"REQUIRED_FOR_ACTUAL"}`. Existing `buildWindow`, `pairProof` and `retention` retain their genuine producer exact shapes. The receipt contains only logical basename `retained-pair-receipt.json`, never its own bytes/hash/physical identity. Those appear only in the later ACK.

Create `${root}/preservation` as a real canonical root-owned directory, UID/GID0, mode0700, held with `O_RDONLY|O_DIRECTORY|O_NOFOLLOW`. Create the receipt once with `O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW`, mode0600; require a regular non-symlink root-owned UID/GID0 file with nlink1, exact size/bytes and named/held identity. Fsync the receipt and directory, re-read through a fresh no-follow held descriptor, revalidate directory/file identity, then close every descriptor once. The receipt writer is Root-exclusive; the worker has no writable ancestor or path into `preservation` and Root remains read-only against `client/output`.

## Controller contract

### Closed input and source binding

The exact API above separates canonical JSON input, a module-private reviewed-control capability and the trusted supervisor's runtime `AbortSignal`. Every object/array/Buffer accepted in-process must reuse the existing Gosu V2 validation pattern: reject `types.isProxy(value)`, require the exact built-in prototype, enumerate all own descriptors with `Reflect.ownKeys`, accept only the fixed enumerable data properties, reject accessors/symbols/surplus keys and freeze copied values. Node 22.23.2 officially provides `util.types.isProxy`; V4 removes the earlier incorrect claim that Proxy rejection was unavailable. The runtime signal is never serialized, passed to the producer, included in a receipt or treated as claim data.

Production executes from a dedicated ext4 deployment copy derived only from `import.meta.url` (`fileURLToPath` plus the fixed `../..` repository-root relation used by the genuine producer), never from a Windows worktree path. The canonical real deployment root is root-owned and read-only: directories UID/GID0 mode0555, Git mode100644 files regular UID/GID0 mode0444 nlink1, Git mode100755 files regular UID/GID0 mode0555 nlink1. Reject symlinks, special files, extra links, replacement, writable bits and any `.git` entry. Neither production controller nor worker invokes Git or depends on Git metadata.

The reviewed actual control embeds one public source-manifest value; it is control data, not a seventh tracked file. Its exact keys are `{kind,entries,calcTreeGitSha1}`. Kind is `GOSU_RETAINED_PAIR_SOURCE_MANIFEST_V1`. `entries` are strictly bytewise POSIX-path sorted, unique, canonical relative paths with exact records `{path,gitMode,bytes,sha256,gitBlobSha1}` and no directories. `gitMode` is only `100644` or `100755`; bytes is a safe nonnegative integer; SHA-256 and Git blob SHA-1 are lowercase hex. The controller and worker independently open each real file no-follow, hash its actual bytes, recompute Git blob object ID from those bytes and mode, reject missing/surplus paths, and recompute `calcTreeGitSha1` from the sorted hierarchy. Git SHA-1 values are compatibility object identifiers, not security authority.

The loaded control capability binds the canonical manifest SHA-256, `calcTreeGitSha1`, a bounded raw commit object and its reviewed commit SHA-1. Recompute Git object IDs as the hash of `type + " " + decimal byte length + NUL + raw bytes`. Require the raw commit's first header to be exactly `tree <calcTreeGitSha1>\n`, cap the raw commit at 1 MiB, and require its recomputed commit object SHA-1 to equal `commitRawSha1`. Build tree objects recursively from exact Git modes, basenames and raw 20-byte child OIDs; sort entries with Git's directory-aware order, comparing a directory as if its name ended in `/`. It also binds exact final controller revision/tree, future-main baseline revision/tree, PR188 prerequisite revision/tree, principal, acceptance identity and deadline policy. The commit raw SHA-1 is provenance metadata supplied by the trusted reviewed control; it is not derivable from the deployment copy and does not authorize execution by itself. Protected-main provenance and control authenticity come only from the distinct actual Architect/Security reviews, exact control hash, protected CI/merge evidence and one-shot dispatch. The JSON manifest or a matching Git SHA-1 alone grants no authority.

Official Git basis to cite in source documentation and tests: https://git-scm.com/docs/hash-function-transition.html for framed object IDs; https://git-scm.com/book/en/v2/Git-Internals-Git-Objects for blobs/trees/commits; https://git-scm.com/docs/git-commit-tree.html and https://git-scm.com/docs/git-mktree.html for commit/tree structure; and upstream Git v2.52.0 `fsck.c` `verify_ordered` at https://github.com/git/git/blob/v2.52.0/fsck.c for the directory-as-`/` ordering rule. These references remove the earlier Git-documentation gap but do not turn SHA-1 into the security trust root.

The only ignored file allowed inside the deployment copy is `.omx/gosu-derivative-context-private-acceptance-v1.json`, because the genuine producer derives that fixed `ACCEPTANCE_PATH` from its own `import.meta.url`. It must be a regular root-owned read-only nlink1 file of exactly 11,744 bytes and SHA-256 `82b1b1735d6e1063048fbade9d3c86e6b0819a90e54c54ec9898d4937721f5a3`. It is listed separately by the control/transport acceptance record, not represented as a tracked Git entry. No actor, control, claim, evidence, log, prior output or other ignored `.omx` path may enter the deployment copy. All private actors/controls/logs remain outside it.

The JSON controller input binds only the fresh execution ID, nonce, empty parent and exact principal described by the API contract. Reject any caller-selected deadline, source path, manifest, dependency, command or authority field. The controller derives source root from its module, source expectations from the loaded capability, and cutoffs from the authenticated lease deadline plus the fixed V1 schedule. Reject a nonempty parent, pre-existing preservation directory, insufficient capacity or any mismatch before daemon dispatch. Expose only the closed diagnostics allowlisted above.

### Root/client separation

The root supervisor:

1. Authenticates the reviewed control capability, read-only deployment-copy closure, unique acceptance file, exact controller/worker bytes and tool pins before starting anything.
2. Creates the daemon only through `startGosuDerivativeImageDaemonLease` with its existing genuine helper and transport; no injected daemon helper is accepted in the actual path.
3. Confirms `EMPTY`, then uses Node 22.23.2 asynchronous `spawn` with `detached:true` on Linux to launch `/usr/bin/setpriv` with the literal argv `--reuid=1000 --regid=1000 --clear-groups --no-new-privs --inh-caps=-all --ambient-caps=-all --bounding-set=-all /opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node <canonical-worker-path>`. The exact environment is `{PATH:"/usr/bin:/bin",LANG:"C.UTF-8",LC_ALL:"C.UTF-8",TZ:"UTC",HOME:lease.dockerConfig}`; `NODE_OPTIONS`, `NODE_PATH`, shell and inherited environment entries are absent. Stdin/stdout/stderr are bounded pipes.
4. Sends only the exact worker transport `{kind,input,sourceClosure}`. `input` remains exactly `{purpose:"GOSU_DERIVATIVE_IMAGE_RETAINED_BUILD_PROOF_V1",nonce,lease}`; `sourceClosure` carries the already authenticated public closure record so UID1000 can independently revalidate the same read-only bytes. No dependency hook, clock, runner, reader, token, alternate path selector or command is supplied.
5. Validates one canonical closed worker result. Raw stderr, stack traces, arbitrary child objects and private paths never enter the receipt or acknowledgement.

Write authority is directional and exclusive. Delivered source is read-only for both principals. Root alone creates and writes infrastructure, endpoint, control state and the sibling `preservation` directory, and Root never writes into `client/output` after the lease is issued. UID1000 alone may write the ordinary client-owned `client` subtree required by the genuine producer, including Buildx/context metadata and the two final TARs in `client/output`; it cannot write `infra`, `endpoint`, `preservation`, controls or source. The daemon may create and retire only its authenticated socket/pidfile and mutate its isolated data/log state under its existing contract. Any crossed-principal write is failure.

The UID1000 worker reproduces the genuine producer's existing runtime guard exactly: Linux, Node v22.23.2, UID/EUID/GID/EGID1000, `process.getgroups()` exactly `[1000]`, `/proc/self/status` `Groups:` empty, `NoNewPrivs: 1`, and `CapInh/CapPrm/CapEff/CapBnd/CapAmb` each exactly 16 hexadecimal zeroes; `NODE_OPTIONS` and `NODE_PATH` are absent. New validation must not reject an actor already accepted by that guard or reinterpret the primary GID as a supplementary kernel group. It then invokes exactly `runGosuDerivativeImageRetainedBuildProofV1(transport.input)` and serializes its result once. Any explicit producer dependency, alternate production import, retry or second call is forbidden. Cancellation remains a supervisor concern and is not injected into that genuine producer call.

### Official process model, deadline and owned-process boundary

Before spawn and again before accepting the worker result, verify `/usr/bin/setpriv` by canonical no-follow regular-file observation: root-owned UID/GID0, mode0755, nlink1, 39,304 bytes, SHA-256 `62ec0120791f3afcfb689fed52384ec2b0accc6e118a6b9a1d6fcfa7450aaf37`, and matching named/held bytes. The frozen contract labels those bytes `setpriv from util-linux 2.39.3`; production need not launch a second `--version` process because the byte pin is authoritative for the tool identity. Dev/inode/timestamps are observed for replacement within one attempt but are not portable constants. The metadata evidence `.omx/evidence/gosu-retained-controller-setpriv-tool-metadata-v1.json` records the read-only readiness observation; it is not part of the deployment copy or runtime authority.

On Unix, Node 22.23.2 `spawn(...,{detached:true})` makes the immediate child leader of a new process group and session. Root initially spawns the pinned setpriv executable, but does not freeze ownership until setpriv has successfully `exec`'d the expected pinned Node worker. Observe transition for at most 2,000 ms at bounded 25 ms intervals. `/proc/<pid>/stat` parsing must handle the parenthesized command, then bind non-zombie state, pgrp field, session field and starttime field; `/proc/<pid>/status` must bind all four UID/GID columns to 1000 plus empty supplementary `Groups`, NNP and capability lines; `/proc/<pid>/exe` and NUL-delimited cmdline must match the pinned Node/worker argv. Accept the Node phase only after two identical complete samples separated by at least 10 ms. That exec preserves PID/session/process-group identity. The frozen immediate-leader proof requires the returned PID and start ticks, UID/GID1000, expected Node executable/worker argv, and `PGID = SID = PID`. Only a fresh match of that complete proof authorizes a signal to process group `-PID`. A positive PID, name match, stale `ChildProcess` object, `subprocess.killed`, or an earlier proof is insufficient because PID reuse and observation-to-signal races remain possible. Failure before this proof yields no group-signal authority and is closed as worker cleanup uncertain unless the child reaches `close` with all pipes drained without intervention.

The UID1000 worker's genuine producer normally spawns Docker directly with `detached:false`, so those direct children ordinarily remain in the worker process group. That is useful containment, not a guarantee that every descendant remains there: a child can create another session/process group or otherwise outlive its parent. Node also documents that killing a child alone does not terminate child-of-child processes on Linux. This controller therefore claims bounded best-effort signalling of the proven group under a trusted, quiescent host and pinned-tool assumption; it never claims discovery or termination of every possible descendant.

Group termination is allowed only after re-reading and matching the immediate leader proof immediately before the signal. Send one `SIGTERM` to `-PID`; allow at most 10,000 ms for cooperative termination and drain. If the same leader still exists and its complete PID/start-ticks/UID/GID/PGID/SID/executable/argv proof still matches, send one `SIGKILL` to `-PID`; allow at most 15,000 ms more for closure and bounded drains. If the leader disappeared, changed, cannot be re-proven, the signal result is ambiguous, or streams do not settle, send no blind follow-up and classify worker cleanup `CLEANUP_UNCERTAIN`. There is no guessed PID, name scan, retry loop or signal outside that one proven process group.

An `exit` event or exit code alone is never completion: Node documents that stdio can remain open after `exit`. The worker phase settles only after the child `close` event and bounded stdin/stdout/stderr drains/closures have all been observed, with output caps intact. A successful signal call proves at most delivery to at least one process in the group; it does not prove termination. Daemon shutdown is a separate operation through the authenticated lease and is never inferred from worker/group state.

Daemon V2 owns a fixed 600,000 ms window. Its `remaining()` guard is `deadlineAtMs - 25,000` and is checked again after its authenticated stop, so merely beginning worker cancellation at `T-25,000` is invalid. The 25,000 ms bound applies only to the helper's internal `stop` race. A full `lease.stop` also re-runs inventory Docker `spawnSync` calls (each independently bounded up to 15,000 ms), file/tool guards, hashes and the principal snapshot before and after helper stop. Daemon V2 remains unchanged and there is no valid 25,000 ms upper bound for the whole synchronous `lease.stop` call. Let `T = lease.deadlineAtMs`. The controller uses these exact conservative decision bounds:

- stop accepting a worker success and begin worker cancellation no later than `T-90,000` (510 seconds after daemon start at the latest);
- spend at most 10,000 ms on `SIGTERM`, 15,000 ms on a re-proven optional `SIGKILL` plus close/drains, and 5,000 ms on closed bookkeeping;
- success is eligible only when `lease.stop({requireMode:lastConfirmedMode})` is entered no later than `T-60,000` and returns spontaneously with its complete authenticated stop proof before its own final `T-25,000` guard. A lease still gets at most one authenticated cleanup-only stop attempt if that entry threshold has already passed; such a late branch can never publish a receipt or success ACK;
- make no `T-35,000` return promise and no claim that in-process timers contain the synchronous inventory/tool/principal/stop sequence;
- after an accepted authenticated daemon stop, allow at most 180,000 ms for both post-stop rehash passes, descriptor guards/closes, receipt fsync/publication/reread and final acknowledgement, with an absolute controller success cutoff of `T+160,000`. Even a stop returning just before `T-25,000` gives a planned 180,000 ms post-stop phase ending by `T+155,000`, leaving a 5,000 ms decision margin.

Every phase samples non-injected `Date.now()` before and after each await or synchronous operation, requires safe finite nondecreasing values, and suppresses success on rollback or if the relevant deadline passed. This establishes a strict success decision cutoff, not in-process preemption: synchronous lease inventory/stop, Root rehash/fsync/close or OS I/O may block beyond timers. The future actual phase therefore requires a distinct Root-owned external watcher, frozen and reviewed with the private actors, to bound observation of the controller and record `CLEANUP_UNCERTAIN` when the controller does not settle. The watcher gains no guessed-PID, direct daemon-stop, cleanup, archive-read or success authority; it cannot transform a timeout into containment. Its exact process ownership, record path and interruption policy remain an actual-phase Architect/Security gap. This public source increment promises no total synchronous containment and exposes no injectable clock.

No pidfd, cgroup, systemd unit/scope, shell wrapper or new dependency is introduced. The residual observation-to-signal race and possible escaped descendants are recorded explicitly in the receipt/ACK limitations. If reviewers cannot accept those limits under the pinned-tools/trusted-host model, implementation stops and the boundary must be replanned rather than silently strengthened.

Official basis for this contract:

- Node 22.23.2 Proxy detection used by existing Gosu validators: https://nodejs.org/download/release/v22.23.2/docs/api/util.html#utiltypesisproxyvalue
- Node 22.23.2 detached process/session semantics: https://nodejs.org/download/release/v22.23.2/docs/api/child_process.html#optionsdetached
- Node 22.23.2 `close` versus `exit`: https://nodejs.org/download/release/v22.23.2/docs/api/child_process.html#event-close
- Node 22.23.2 signal/PID-reuse/descendant limits: https://nodejs.org/download/release/v22.23.2/docs/api/child_process.html#subprocesskillsignal
- Linux process-group signalling: https://man7.org/linux/man-pages/man2/kill.2.html
- Linux session/process-group creation: https://man7.org/linux/man-pages/man2/setsid.2.html
- Linux setpriv privilege controls: https://man7.org/linux/man-pages/man1/setpriv.1.html

### Successful stop ordering

On a valid producer result, the root controller constructs the exact daemon subjects without reading an archive:

- BASE reference remains the existing fixed PostgreSQL digest, with `imageId=configId=result.retention.base.configId`.
- CANDIDATE reference is `aw-postgres-gosu:${nonce}`, with `imageId=configId=result.retention.candidate.configId`.
- Both platforms are exactly Linux/amd64.

It calls `verifyInventory("BASE_AND_CANDIDATE", subjects)` and only then `stop({requireMode:"BASE_AND_CANDIDATE"})`. The verified inventory must be two images, zero containers and zero volumes. No image remove, tag, load, run, export replay, prune or data-root cleanup is allowed. Stop must prove its exact process/socket/pidfile gone and `privateState:"RETAINED"` while the principal-daemon snapshot remains unchanged.

### Post-stop archive revalidation

Only after the owned daemon is proven stopped, the root controller reopens the output directory and the two fixed final components `base-image.tar` and `candidate-image.tar` with no-follow/type/owner/mode/link/count/identity guards. It must:

- require the namespace to be exactly those two names and no partial, proof, log, claim or receipt file;
- compare both archive SHA-256/size values to `result.retention` and `result.pairProof`;
- compare file and directory dev/inode/uid/gid/mode/nlink/size/mtimeNs/ctimeNs/birthtimeNs snapshots to the producer record;
- keep newly opened descriptors through each rehash and named/held/canonical-path guard;
- reread neither TAR format nor image contents and perform no copy, chmod, move, extraction or new Docker command;
- attempt each owned close once, record the attempt before calling close, never retry a failed Linux close, and fail closed on any stability or close uncertainty.

This revalidation establishes only observed post-stop byte/physical continuity under the documented trusted-host/quiescent-writer assumptions. It does not establish OS immutability, crash/power-loss durability or defense from a malicious same-UID/root process.

### Sibling preservation receipt and root acknowledgement

The export directory remains byte-for-byte and namespace-stable after producer return. The controller creates `${root}/preservation` only after daemon stop and post-stop archive validation. The directory is a sibling outside `lease.outputDirectory`; no receipt, proof, log, control or claim is ever written into `client/output`.

Publish exactly `${root}/preservation/retained-pair-receipt.json` by exclusive no-follow creation with fixed root ownership/mode, canonical JSON, file fsync, directory fsync and same-descriptor/named guards. Revalidate the export namespace and both archives again after receipt publication, then close all owned descriptors once.

The receipt binds only closed metadata: kind/state/scope, execution ID, delivered source revision/tree, PR188 prerequisite revision/tree, controller/worker identities, nonce, daemon identity and stop proof, principal snapshot hash, build window, pair proof, retention snapshot, post-stop archive/directory snapshots, the fixed logical basename `retained-pair-receipt.json`, closed process-supervision limitations recording the residual observation/signal race and absence of an all-descendant guarantee, authority `NOT_AUTHORIZED`, image `BUILT_UNVALIDATED`, functional/vulnerabilities `NOT_ESTABLISHED`, admission `NOT_AUTHORIZED`, preservation `PRIVATE_SOURCE_PAIR_RETAINED_REVIEW_PENDING`, and `dates:null`. It contains no hash, byte length or physical identity of itself, avoiding any circular/self-referential claim. It also contains no absolute path, raw subprocess output, buffer, descriptor, credential, environment, stack or registry identity.

Only after publication, rereading the exact receipt bytes and proving every descriptor closed may the root controller emit one closed acknowledgement `GOSU_RETAINED_PAIR_PRESERVATION_ACK_V1`. That acknowledgement, rather than the receipt payload, binds the receipt SHA-256, byte length, physical identity and stop proof but grants no read, publication or cleanup authority.

## Failure, cancellation and no-retry contract

- Record the native dispatch before spawning the UID1000 worker. One fresh execution ID has one attempt; no automatic or manual re-entry is permitted after dispatch.
- Track `lastConfirmedMode` only from a successful lease `verifyInventory` result. Once a lease is returned, initial daemon setup has already confirmed `EMPTY`, so `lastConfirmedMode` begins as `EMPTY`; update it to `BASE_AND_CANDIDATE` only after that exact verification succeeds. Never infer a mode from worker output, error timing, image names or partial files.
- Any rejection from `startGosuDerivativeImageDaemonLease` without a returned lease is controller failure with `cleanup:"UNCERTAIN"`, regardless of the daemon error code. The daemon does not expose enough state to prove whether it failed before startup or after internal cleanup. The controller has no stop capability and must not guess a PID or invoke a helper directly. Failures before calling the daemon remain `cleanup:"NOT_STARTED"`. Publish no receipt or success acknowledgement; daemon V2 internal start-failure cleanup remains its own contract.
- If a lease exists and worker/IPC/result validation fails, attempt `lease.stop({requireMode:lastConfirmedMode})` exactly once. A stale confirmed mode may make final inventory validation fail, but daemon V2 still attempts to terminate only its helper-proven process and then reports cleanup uncertainty. Do not substitute an inferred `BASE_ONLY` or `BASE_AND_CANDIDATE` mode.
- If lease acquisition never completed, do not claim that stop was attempted or that cleanup succeeded. If the lease exists, the eligibility threshold does not cancel its single cleanup-only stop obligation. A late authenticated STOPPED result gives `cleanup:"CONFIRMED"` but remains a deadline failure with no receipt/ACK. A rejected or unsettled stop gives no containment claim and remains `cleanup:"UNCERTAIN"`, without retry; the external actual watcher records any non-settlement rather than fabricating a settled source result.
- If the worker fails after a build may have started, preserve the entire root and any partial/final archives as unaccepted evidence. Do not infer the image mode, inspect arbitrary images, delete files or retry.
- If success result validation, `BASE_AND_CANDIDATE` inventory, stop, post-stop rehash, receipt publication, any guard/fsync or close fails, publish no successful acknowledgement. Preserve root, output and any pending/complete receipt as failed evidence; record whether cleanup is confirmed or uncertain.
- Never convert `MAY_HAVE_BEEN_BUILT`, `retentionFailure`, protocol simulation, a stopped daemon alone or a receipt-write attempt into successful preservation.
- The controller owns no deletion. Cleanup, controlled archive read, load, publication and later image use require a separate plan and authority.

## Test-first source implementation

Use independent RED before implementation for missing controller/worker exports and for each closed result/receipt validator. Lock daemon V2 and producer V1 behavior unchanged.

Required controller protocol tests include:

- exact controller/control/transport/result/receipt/ACK keys, canonical encodings, byte caps, exit codes, source-closure validation and rejection of every extra authority field;
- fixed call order: source/authentication -> EMPTY -> one setpriv worker -> closed result -> BASE_AND_CANDIDATE -> owned stop -> post-stop revalidation -> sibling receipt -> final acknowledgement;
- no producer dependency argument in the worker and exactly one producer call;
- strict clean setpriv argv/environment, `detached:true` leader proof with `PGID=SID=PID`, bounded IPC, timeout/abort/output-limit and owned child close behavior;
- canonical JSON data separated from the runtime `AbortSignal`, existing exact descriptor/prototype checks and `types.isProxy` rejection for every accepted object/array/Buffer;
- exact setpriv path/bytes/hash/version/owner/mode/link and literal argv/environment, bounded setpriv-to-Node transition observations, exact `/proc` grammar, two stable Node samples and signal-ownership gates;
- exact `T-90,000` worker cutoff, TERM/KILL/drain bounds, `T-60,000` daemon-stop entry, no whole-lease-stop bound, 180,000 ms post-stop phase and `T+160,000` success cutoff;
- immediate full leader re-proof before each group signal, no blind retry after leader loss/change, `close` plus drains required beyond `exit`, and uncertainty for escaped descendants or observation/signal races;
- setpriv-to-Node exec transition before ownership freeze, no group-signal authority before the expected Node leader is proven, and uncertainty if early failure does not settle cleanly;
- synchronous Root blocking documented as non-preemptible in-process and external-supervisor enforcement left as an explicit pre-implementation review gap;
- exact subject projection from the successful retention result;
- two images/zero containers/zero volumes accepted, every other inventory refused;
- stop with only `lastConfirmedMode` after worker/result/inventory failure, no guessed mode/PID, never retried, and no success after uncertain stop or lease-less start failure;
- exact two-name output namespace and rejection of partial/extra/symlink/hardlink/special/wrong-owner/wrong-mode/replaced/drifting archives or parent;
- post-stop rehash/snapshot equality, guard ordering, file/directory fsync, every close failure, deadline rollback and close-once bookkeeping;
- receipt exclusively in the sibling directory; output namespace unchanged before and after publication;
- receipt/acknowledgement closed shapes, null dates and absence of paths/buffers/handles/raw errors/private text;
- read-only ext4 deployment root derived from `import.meta.url`, no `.git`, exact public manifest ordering/modes/bytes/SHA-256/Git blob/tree/commit calculations, real-byte comparison, one separately bound acceptance file, and rejection of every other ignored/private file;
- preservation of both historical producer entrypoints and all consumed artifacts by non-access.

VM module replacement may exercise controller/worker protocol branches, but every such result is labelled `PROTOCOL_SIMULATION`. The worker test may use a test-only VM linker that maps only the exact literal producer specifier to a counting stub. That stub must prove one invocation, exactly one argument, and referential equality with `transport.input`. Production source retains the exact static genuine import and exposes no producer dependency parameter. A textual search alone is insufficient proof; combine the VM call-count test with a production-module import/export assertion and a negative test showing dependencies/surplus arguments are structurally impossible. Controller protocol tests may replace daemon/spawn/filesystem boundaries, but never classify those branches as native evidence. Small genuine Linux UID1000/root filesystem tests cover the deployment closure, unique acceptance file, exclusive sibling receipt creation, no-follow/type/link/identity guards, stable post-stop-like rehash, fsync and close behavior without Docker. They prove local filesystem mechanics only.

The two exact new test files are both ordinary tests and their own mandatory VM bootstrap; no third wrapper file is added. At file start, if `--experimental-vm-modules` is absent and the file-specific `GOSU_RETAINED_PAIR_SELF_WRAPPED=1` sentinel is absent, define one outer test that synchronously spawns the current test `process.execPath` after proving Node v22.23.2 and the platform-specific binary pin, with `--experimental-vm-modules --test <this-exact-test-file>`, a clean environment plus that sentinel, bounded stdout/stderr and timeout, then requires status0, no signal, expected named positive cases and exact pass/fail/skip/cancel counts. In the child, the sentinel prevents recursion and all VM cases run normally. If the flag is already present, run them directly. The existing root test command must discover both files and cannot pass unless each self-wrapper child completed its mandatory VM cases. No Windows skip may hide a required Linux/root positive counterpart.

## Reviews, gates and source delivery

After disjoint implementation and tests exist, delivery proceeds only in this order:

1. Product PR187 completes its own exact-head review/CI, protected merge and merged-main CI. Refresh the controller branch onto that exact `main`; do not carry unrelated changes.
2. Freeze controller/worker/tests/docs and all source/control schema pins against that baseline.
3. Root independently runs targeted pinned Node22.23.2 Windows and Linux UID1000/root matrices and records source-before/source-after pins.
4. Architect reviews controller lifecycle, genuine-default call boundary, stop ordering and exact compatibility with unchanged daemon V2/producer V1.
5. A distinct Security/Critic reviews root/client isolation, IPC, private-data projection, process-group proof/signalling races, escaped-descendant limitation, deadline arithmetic, synchronous-Root liveness gap, filesystem/receipt preservation, failure/no-retry semantics and evidence limits.
6. Root proves the exact future-main baseline unchanged except the three authorized append-only records, proves each baseline document is a byte-for-byte prefix of its result, and proves exactly the six approved new paths were added.
7. Run lint, typecheck, tests, build, secrets scan, dependency audit and real Turbo graph checks on pinned Node22.23.2/pnpm10.15.0.
8. Deliver through exact-head CI, normal strict protected merge with the reviewed tree unchanged, then matching merged-main CI. Do not merge another main PR until that main CI completes.

The source validation record must continue to say: no native operation, no retained real archives, no registry digest, no functional/CVE result, no admission and no support activation.

## Separate future one-shot native phase

Only after the controller source is delivered on main may Root create these new private, versioned artifacts; names are reserved here but files do not exist in this draft:

- `.omx/actors/gosu-retained-pair-native-v1-root.mjs`
- `.omx/actors/gosu-retained-pair-native-v1-client.mjs`
- `.omx/controls/gosu-retained-pair-native-v1-control.json`
- `.omx/claims/gosu-retained-pair-native-v1-claim.json`
- `.omx/evidence/gosu-retained-pair-native-v1-predispatch-architect.json`
- `.omx/evidence/gosu-retained-pair-native-v1-predispatch-security.json`
- `.omx/gosu-retained-pair-native-v1/index.json`

The private root/client actors should be thin launch/freeze surfaces over the delivered public controller/worker, not alternative implementations. The root actor also supplies the separately reviewed external watcher required to record a controller that fails to settle; it gains none of the controller's lease or archive authority. Generate a fresh nonce, root, execution ID, actors, control and claim. Pin the delivered source, binaries and all actor/control bytes. Do not read, modify, copy, reopen or reference any consumed V1/V2 actor, claim, control, archive or output.

Architect must first accept the exact new actor/control/default-module path and one-attempt budget. A distinct Security/Critic must then accept the same frozen bytes, principal/read boundaries, no-retry behavior and receipt projection. Dispatch exactly once only after both approvals.

After the attempt, preserve all outputs unchanged. Two fresh independent postread reviews occur in order: Architect verifies lifecycle/default call/inventory/owned stop/receipt binding; then Security verifies private-data projection, byte/snapshot preservation, non-authority and cleanup uncertainty. Only both reviews may classify `PRIVATE_SOURCE_PAIR_RETAINED_REVIEW_PENDING`. Failure remains failure and is never retried.

## Acceptance criteria

The source controller increment is complete only when all of these are true:

- unchanged daemon V2 produces the exact lease and accepts successful two-image/zero-container/zero-volume stop;
- the worker calls the genuine retained producer exactly once with no dependencies;
- success requires stopped owned daemon, unchanged principal, exact post-stop archive hashes/snapshots and a sibling authenticated receipt;
- no successful result can escape any partial, simulated, failed, uncertain or unclosed branch;
- targeted protocol and genuine filesystem tests, ordered reviews, six local gates, exact-head CI, protected merge and merged-main CI pass on unchanged pins;
- the exact future-main baseline remains unchanged except the three prefix-preserving append-only records, exactly six approved paths are added, and all consumed evidence remains untouched;
- tracked documentation states source-only authority and rollback.

The later native phase is accepted only as private retention evidence when one fresh attempt completes, both postread reviews clear it and the receipt/acknowledgement remain `NOT_AUTHORIZED`. It still does not complete TASK-0005A/0005.

## Explicitly excluded follow-ups

This plan does not authorize Docker load, image entrypoint/runtime, registry tag/push/readback, manifest digest assignment, ORAS, scanner/SBOM refresh, signing/attestation, second private copy, service/SQL restore, PostgreSQL/OpenSearch/Redis/S3-compatible startup, admission, `currentEvidence` change or support activation. Those remain later separately reviewed roadmap gates. Configuration IDs are never called registry manifest digests.

Rollback of the source increment removes only the unused new controller/worker/tests/docs through focused review, preserving unchanged daemon V2, producer V1, the two historical producer entrypoints and every prior actual/failure record. A dispatched private native attempt is immutable evidence and is preserved, not rolled back or replayed.

## Project decisions and non-questions

No user choice is required to draft or implement this bounded controller after its prerequisites and ordered reviews. Technical choices fixed by existing contracts are: reuse daemon V2 unchanged; source increment before actual dispatch; exact two-file export; sibling receipt after stop; no retry; no cleanup/publication/admission.

The future publication credential/package workflow, package visibility and first registry write are genuine later project decisions under ADR-0007, but they do not branch this controller and must not be pulled into its scope. The location `${root}/preservation` is deliberately private and root-owned for this increment; a later controlled reader may consume it only through a separately reviewed contract.

## Root integration constraints before ordered plan approval

The control loader must copy accepted input bytes before hashing and parsing, then retain the exact parsed immutable control privately. The returned opaque capability carries no mutable input reference. Structured clones, JSON projections and counterfeit objects do not retain its module-private WeakMap/WeakSet identity and must be rejected; "non-cloneable" means non-transferable authority, not a claim that JavaScript cannot clone an object's visible fields.

Each loaded control capability is one-use. After the input, capability and runtime options have passed their pure validation, reserve the capability and execution ID synchronously before the first filesystem/native side effect or await. A second concurrent or sequential run with that capability is rejected. Reloading identical control bytes must not permit another run of that execution ID in the same module instance. This in-process reservation does not establish cross-process persistence: the later separately reviewed actual supervisor must own the persistent one-dispatch ledger and exact input/control hashes before launch. It must never create a second parent or reload/re-enter an attempted execution ID to bypass a failure. Tests must distinguish these guarantees explicitly and must never claim global at-most-once behavior from a WeakSet alone.

The control's pr188Revision is the exact prerequisite source revision 2435bce8068146c55fed06ddf7189b70ac8c7475 and pr188Tree is c47ed63d3ae51817035227e0b4977ac41ce0dfef. The protected merge 5497b9c6a23213010cd1446624bbe2dde7c662ad and both successful CI runs remain independent external prerequisite evidence, rather than extra caller-selected authority fields.

The existing genuine producer intentionally rereads its fixed authenticated candidate-context material and the context claim/success references pinned by its fixed acceptance record. Those persistent input materials are distinct from all consumed B1b V1/V2 image-attempt actors/controls/claims/archives/outputs, which remain prohibited. This source increment adds no new private path selector or broader input reader; the later actual pre-dispatch review must enumerate the fixed context input boundary without copying or replaying old image-attempt evidence.

## Architecture repair addendum — exact daemon projections and late cleanup

This addendum resolves the three ITERATE findings on proposal V1; it does not modify either reused production module or expand native authority.

`daemon.identity` is exactly `{purpose,authority,admission,nonce,pid,startTicks,daemonId,version,configSha256,argvSha256,rootActor,clientActor,socketProof,socketDirectoryProof}`. Each value is copied explicitly from the validated lease identity. Require the existing diagnostic purpose, LOCAL_DIAGNOSTIC authority, NOT_AUTHORIZED admission, Docker28.0.4, the exact requested nonce, safe PID/startTicks and fixed actor/socket-proof shapes already validated by daemon/producer V2. No root, endpoint, socket path, config/output/data/exec directory, containerd address or other raw lease field enters this record.

`daemon.stop` and `ACK.daemonStop` have the identical exact shape `{state,purpose,authority,admission,nonce,pid,startTicks,daemonId,principalImageCount,principalSnapshotSha256,isolatedFinalInventory,processGone,socketGone,pidFileGone,privateState}`. Validate the complete raw stop object against the unchanged daemon V2 contract before projecting: require state STOPPED, purpose GOSU_DERIVATIVE_IMAGE_BUILD_OBSERVATION, authority LOCAL_DIAGNOSTIC, admission NOT_AUTHORIZED, PID/daemonId/endpoint equal to the held lease, principalImageCount2, the lowercase64-hex principal snapshot equal to the one captured from the initial successful EMPTY verification, isolatedFinalInventory BASE_AND_CANDIDATE on the success path, processGone/socketGone/pidFileGone all true and privateState RETAINED. `nonce` and `startTicks` are copied from that original validated lease; daemon V2 does not repeat them in its raw stop object. The raw endpoint is checked privately but omitted. The initial inventory acknowledgement's snapshot hash is retained privately for comparison and never replaced by a value inferred from control JSON.

The three states NOT_STARTED, CONFIRMED and UNCERTAIN remain the complete closed cleanup vocabulary. UNKNOWN is not a serialized cleanup value. After a daemon call rejects without a lease, only UNCERTAIN is allowed. Before any daemon call, only NOT_STARTED is justified. After a lease exists, CONFIRMED requires its complete authenticated STOPPED result; an error code, a disappeared worker or an elapsed timeout cannot substitute for that result.

The T-60000 entry rule is a success-eligibility condition, not an instruction to abandon the owned daemon. On crossing it with a lease and no previous stop attempt, call the exact lease stop once for cleanup only. If that late call returns an accepted STOPPED proof, report deadline failure with cleanup CONFIRMED and no receipt creation or ACK. If it rejects, report failure with cleanup UNCERTAIN. If it never settles or synchronously blocks, no source return or bounded-stop guarantee is invented: the separately reviewed actual external watcher may record non-settlement and UNCERTAIN only. A started stop is never retried, including from finally/error branches.

Required independent protocol cases now include: pure pre-daemon rejection -> NOT_STARTED; daemon rejection before a lease regardless of error code -> UNCERTAIN; timely accepted stop -> eligible for remaining preservation gates; late accepted stop -> deadline failure/CONFIRMED/no receipt; late rejected stop -> UNCERTAIN/no receipt; and an unsettled stop -> no ACK/no false settled cleanup (the test may observe a controlled pending promise and release it afterwards). Projection tests must start from genuine-shaped raw daemon objects containing every private path and prove that receipt/ACK contain none, while rejecting mismatched PID/startTicks bindings, snapshot hashes or gone flags.

## Critic schema repair addendum — receipt identity, public constants and producer IPC

This addendum closes only the three deterministic schema omissions identified on plan V2. It leaves the nine authorized paths, every reused producer/daemon and all source/native authority boundaries unchanged. In an overlap, these explicit schemas refine the earlier descriptions.

The persisted receipt identity is exactly `kind:"GOSU_RETAINED_PAIR_PRESERVATION_RECEIPT_V1"`, `state:"SUCCEEDED"`, `scope:"PRIVATE_SOURCE_PAIR_RETAINED_REVIEW_PENDING"`. Its authority/admission are `NOT_AUTHORIZED`, image is `BUILT_UNVALIDATED`, functional/vulnerabilities are `NOT_ESTABLISHED`, preservation is `PRIVATE_SOURCE_PAIR_RETAINED_REVIEW_PENDING`, and dates is null. No other receipt kind/state/scope is accepted or written.

The two exported contract data objects have exactly the following own enumerable keys, order, nested keys and literal values, and are deeply frozen. Numeric mode493 means octal0755. `environment.HOME` is the literal descriptive sentinel `LEASE_DOCKER_CONFIG` in the public data object only: the actual spawn environment substitutes the exact held `lease.dockerConfig`; the sentinel is never a filesystem path or caller option. Contract objects grant no operation authority.

Controller contract:
```json
{
  "kind": "GOSU_RETAINED_PAIR_CONTROLLER_V1_CONTRACT",
  "kinds": {
    "input": "GOSU_RETAINED_PAIR_CONTROLLER_INPUT_V1",
    "control": "GOSU_RETAINED_PAIR_CONTROLLER_CONTROL_V1",
    "receipt": "GOSU_RETAINED_PAIR_PRESERVATION_RECEIPT_V1",
    "ack": "GOSU_RETAINED_PAIR_PRESERVATION_ACK_V1",
    "failure": "GOSU_RETAINED_PAIR_CONTROLLER_FAILURE_V1"
  },
  "node": {
    "path": "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node",
    "version": "v22.23.2",
    "bytes": 124836408,
    "sha256": "3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327"
  },
  "setpriv": {
    "path": "/usr/bin/setpriv",
    "version": "setpriv from util-linux 2.39.3",
    "bytes": 39304,
    "sha256": "62ec0120791f3afcfb689fed52384ec2b0accc6e118a6b9a1d6fcfa7450aaf37",
    "uid": 0,
    "gid": 0,
    "mode": 493,
    "nlink": 1
  },
  "environment": {
    "PATH": "/usr/bin:/bin",
    "LANG": "C.UTF-8",
    "LC_ALL": "C.UTF-8",
    "TZ": "UTC",
    "HOME": "LEASE_DOCKER_CONFIG"
  },
  "caps": {
    "inputBytes": 65536,
    "controlBytes": 16777216,
    "transportBytes": 16777216,
    "stdoutBytes": 8388608,
    "stderrBytes": 0,
    "commitRawBytes": 1048576
  },
  "deadlinePolicy": {
    "workerCutoffBeforeDaemonMs": 90000,
    "termMs": 10000,
    "killAndDrainMs": 15000,
    "bookkeepingMs": 5000,
    "stopEntryBeforeDaemonMs": 60000,
    "postStopMs": 180000,
    "controllerAfterDaemonMs": 160000
  },
  "receiptBasename": "retained-pair-receipt.json",
  "phases": [
    "INPUT",
    "CONTROL",
    "SOURCE",
    "PREFLIGHT",
    "DAEMON_START",
    "WORKER_START",
    "WORKER_RUN",
    "INVENTORY",
    "STOP",
    "PRESERVE",
    "ACK",
    "CLEANUP"
  ],
  "errorCodes": [
    "gosu_retained_pair_controller_input_invalid",
    "gosu_retained_pair_controller_control_invalid",
    "gosu_retained_pair_controller_source_invalid",
    "gosu_retained_pair_controller_acceptance_invalid",
    "gosu_retained_pair_controller_tool_invalid",
    "gosu_retained_pair_controller_daemon_start_failed",
    "gosu_retained_pair_controller_worker_spawn_failed",
    "gosu_retained_pair_controller_worker_identity_invalid",
    "gosu_retained_pair_controller_worker_timeout",
    "gosu_retained_pair_controller_worker_result_invalid",
    "gosu_retained_pair_controller_worker_cleanup_uncertain",
    "gosu_retained_pair_controller_daemon_inventory_invalid",
    "gosu_retained_pair_controller_daemon_cleanup_uncertain",
    "gosu_retained_pair_controller_preservation_failed",
    "gosu_retained_pair_controller_cleanup_uncertain"
  ]
}
```

Worker contract:
```json
{
  "kind": "GOSU_RETAINED_PAIR_WORKER_V1_CONTRACT",
  "kinds": {
    "transport": "GOSU_RETAINED_PAIR_WORKER_TRANSPORT_V1",
    "sourceClosure": "GOSU_RETAINED_PAIR_SOURCE_CLOSURE_V1",
    "manifest": "GOSU_RETAINED_PAIR_SOURCE_MANIFEST_V1",
    "result": "GOSU_RETAINED_PAIR_WORKER_RESULT_V1",
    "failure": "GOSU_RETAINED_PAIR_WORKER_FAILURE_V1"
  },
  "node": {
    "path": "/opt/auto-world/toolchains/node-v22.23.2-linux-x64/bin/node",
    "version": "v22.23.2",
    "bytes": 124836408,
    "sha256": "3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327"
  },
  "caps": {
    "transportBytes": 16777216,
    "stdoutBytes": 8388608,
    "stderrBytes": 0,
    "commitRawBytes": 1048576
  },
  "exitCodes": {
    "success": 0,
    "failure": 1
  },
  "productionImport": "./gosu-derivative-image-observation-v2.mjs",
  "phases": [
    "INPUT",
    "SOURCE",
    "ENVIRONMENT",
    "PRODUCER",
    "RESULT",
    "CLEANUP"
  ],
  "errorCodes": [
    "gosu_retained_pair_worker_input_invalid",
    "gosu_retained_pair_worker_source_invalid",
    "gosu_retained_pair_worker_environment_invalid",
    "gosu_retained_pair_worker_producer_failed",
    "gosu_retained_pair_worker_result_invalid",
    "gosu_retained_pair_worker_cleanup_uncertain"
  ]
}
```

The ordinary Windows self-wrapper bootstrap first verifies its real process executable has version v22.23.2, 86,997,320 bytes and SHA-256 `0d0f5e39f9f3d9587bc19f73eab3c2c9c4903fd02d6dbf9c853dd81b3d95fad4`; its recorded location is `C:\Users\Administrator\.codex\toolchains\auto-world\node-v22.23.2-win-x64\node-v22.23.2-win-x64\node.exe`. Linux tests verify the production Node pin in the literal contracts above. The Windows pin is test-bootstrap-only and never a permitted production actor. Neither platform trusts a version string alone. Test-only environment inheritance required by the host test runner must not widen the separately fixed production spawn environment.

Before inventory or publication, both worker and controller validate that the producer result has exactly these top-level keys in this order: `{state,authority,image,candidateAdmission,functional,vulnerabilities,nonce,lease,builder,profiles,preflight,context,buildWindow,pairProof,retention,dates}`. Constants are exactly state `IMAGE_PAIR_RETENTION_SNAPSHOT_OBSERVED_REVIEW_PENDING`, authority/candidateAdmission `NOT_AUTHORIZED`, image `BUILT_UNVALIDATED`, functional/vulnerabilities `NOT_ESTABLISHED`, dates null. A scope key or simulation/proof-only state is rejected. `result.nonce` must equal the input nonce. `result.lease` is exactly `{daemonId,pid,startTicks}` and must equal the held input lease tuple, field by field and by type. All copied accepted data is recursively closed/frozen; surplus properties, proxies, accessors, symbols and invalid built-in prototypes are rejected before side effects using a result field.

`buildWindow` is exactly `{startedAtMs,completedAtMs}`, both safe nonnegative integers, start <= end, difference <=600000, startedAtMs >= held lease.deadlineAtMs-600000 and completedAtMs <= held lease.deadlineAtMs-25000. These bounds derive from the unchanged daemon/producer windows; the lease exposes deadlineAtMs and no separate start field. `retention.buildWindow` must be structurally and type-exactly equal to this result buildWindow. `pairProof` has no buildWindow property; adding one is surplus and rejected rather than inventing a duplication.

`pairProof` is exactly `{scope,authority,profile,base,candidate,inheritedLayers,addedLayers,configProfile,delta}`. Fixed values are scope `CONDITIONAL_ON_AUTHENTICATED_ARCHIVES_AND_BUILD_WINDOW`, authority `NOT_AUTHORIZED`, profile `POSTGRES_GOSU_DERIVATIVE_DOCKER_SAVE_USTAR_V1`, inheritedLayers10, addedLayers2, configProfile `STRICT_INHERITED_CONFIG_V2`. `base` and `candidate` are exactly `{archive,configId,layers}`, layers10 and12 respectively. Each `archive` is exactly `{bytes,sha256}`, safe positive integer bytes and lowercase64-hex SHA256. Each configId is lowercase `sha256:` +64hex, base equals the fixed existing producer BASE_CONFIG_ID, candidate differs from base. Aggregate archive bytes <=2147483648. The archive identities and configIds must equal their respective retention records exactly before constructing inventory subjects. These hashes/config IDs bind private archive identities, never registry manifest digests.

`retention` is exactly `{state,preservation,authority,admission,directory,buildWindow,base,candidate}`. Constants: state `SEALED_SNAPSHOT_REVIEW_PENDING`, preservation `FUTURE_CONTROLLER_REQUIRED`, authority/admission `NOT_AUTHORIZED`. Its base/candidate are exactly `{name,archive,configId,physical}`, names `base-image.tar` and `candidate-image.tar` respectively, archive/configId equal the corresponding pairProof values, and physical is the complete genuine producer snapshot. The directory snapshot and both physical snapshots are validated against the fixed held lease output directory and later real held/named observations, never accepted merely from worker strings. The genuine producer snapshot's exact physical keys are `{dev,ino,mode,nlink,size,uid,gid,mtimeNs,ctimeNs,birthtimeNs}`; dev/ino and all nanosecond timestamps are decimal strings, and mode/nlink/size/uid/gid are safe nonnegative integers. Physical file sizes must equal the corresponding archive bytes, ownership UID/GID1000, regular mode0100600, nlink1; directory mode0040700 with the producer's existing owner/link semantics. Keep the complete original snapshots in retention; postStop's intentionally smaller projection does not silently replace or weaken original equality checks.

The remaining genuine nested records and delta schema are fixed by the appended tracked-source schema note below. Private profiles/preflight/context are validated in memory only, then omitted from receipt/ACK; receipt serializes only the explicitly listed producer buildWindow/pairProof/retention projections. Negative RED cases must independently exercise mismatched nonce, lease tuple, constants, added top/nested key, duplicate window, archive digest/length, configId, physical size/owner/mode and simulation state. No malformed worker result reaches BASE_AND_CANDIDATE verification or receipt creation; the owned daemon still receives its single cleanup-only stop using lastConfirmedMode.

## Tracked-source genuine retained producer result schema V3

Status: `NORMATIVE_SCHEMA_WITHIN_THIS_REVIEW_GATED_SOURCE_PLAN`. This addendum describes the success value returned by the unchanged tracked `runGosuDerivativeImageRetainedBuildProofV1`. Implementation remains gated by the ordered reviews of this complete plan. The schema grants no native operation, archive read, replay, publication, cleanup or admission.

## Sources and validation boundary

The schema below is derived only from the delivered tracked implementation and its direct schema dependencies:

- `scripts/postgres-image/gosu-derivative-image-observation-v2.mjs`: genuine retained result construction, profiles, preflight, context observation, build window, retention snapshot and physical snapshot representation.
- `scripts/postgres-image/gosu-derivative-image-proof-v1.mjs`: `pairProof` construction and archive/build-window bounds.
- `scripts/postgres-image/gosu-derivative-candidate-v2.mjs`: authenticated context contract and fixed file set.
- `scripts/postgres-image/gosu-derivative-filesystem-v2.mjs`: the transitive `pairProof.delta` schema.
- `scripts/seaweed-image/archive.mjs`: TAR member descriptor fields and file-only SHA-256 behavior.

The worker result crosses IPC as parsed canonical JSON. Validate every record as a non-Proxy exact built-in plain object with only enumerable own data properties, every array as a dense built-in array, every integer as a safe integer, and every digest against its stated lowercase grammar. Reject accessors, symbols, holes, surplus keys, wrong key order, non-finite numbers and prototype substitutions. This is a closed validator for the producer's successful genuine result, not a new producer API.

## Exact top-level result

The genuine default retained producer success has exactly these keys in this order:

`{state,authority,image,candidateAdmission,functional,vulnerabilities,nonce,lease,builder,profiles,preflight,context,buildWindow,pairProof,retention,dates}`

Required constants and types:

- `state === "IMAGE_PAIR_RETENTION_SNAPSHOT_OBSERVED_REVIEW_PENDING"`.
- `authority === "NOT_AUTHORIZED"`.
- `image === "BUILT_UNVALIDATED"`.
- `candidateAdmission === "NOT_AUTHORIZED"`.
- `functional === "NOT_ESTABLISHED"`.
- `vulnerabilities === "NOT_ESTABLISHED"`.
- `nonce` is exactly the input nonce and matches `/^[0-9a-f]{24}$/u`.
- `lease` has exactly `{daemonId,pid,startTicks}` in that order. It is value-equal to those fields of the validated input lease: `daemonId` is a nonempty string, `pid` is a safe integer at least 2, and `startTicks` matches `/^[1-9][0-9]{0,19}$/u`.
- `dates === null`.
- A genuine result has no top-level `scope`. `scope` belongs to injected simulation results and must be rejected here.

## Builder and private routing profiles

`builder` has exactly `{driver,endpoint,platforms,representation}`:

- `driver === "docker"`.
- `endpoint` equals `profiles.builder.parsed.endpoint` and is either the validated lease endpoint or lease context name as permitted by the producer parser.
- `platforms` is the same string as `profiles.builder.parsed.platforms` and its comma-separated platform list, after removal of a terminal `*`, contains `linux/amd64`.
- `representation` equals `profiles.builder.parsed.representation` and is `"FORMAT_ONLY_JSON"` or `"NATIVE_TEXT"`.

`profiles` has exactly `{stage,context,version,info,builder}` and `stage === "PRE_CONTEXT"`. Each of the four profile records has exactly `{command,representation,parsed,stdout,stderr}`.

Every `command` has exactly `{binary,args}`, with `binary === "/usr/bin/docker"` and a dense string `args` array. Against the validated lease, the arrays are exactly:

- context: `['--config',dockerConfig,'--context',contextName,'context','inspect',contextName]`;
- version: `['--config',dockerConfig,'--context',contextName,'version','--format','{{json .}}']`;
- info: `['--config',dockerConfig,'--context',contextName,'info','--format','{{json .}}']`;
- builder: `['--config',dockerConfig,'--context',contextName,'buildx','inspect']`.

Each `stdout` and `stderr` has exactly `{encoding,bytes,sha256,base64}`. Require `encoding === "base64"`, `bytes` a safe nonnegative integer at most 2 MiB, lowercase 64-hex `sha256`, canonical base64, decoded length equal to `bytes`, and SHA-256 of decoded bytes equal to `sha256`. The controller must also enforce the worker envelope's smaller aggregate stdout cap. These private bytes may cross this one root/client IPC for validation but must not enter the receipt, ACK, diagnostics or logs.

Profile-specific fields are:

- `profiles.context.representation === "JSON"`; `parsed` is exactly `{name,endpoint}`, equal to validated `lease.contextName` and `lease.endpoint`.
- `profiles.version.representation === "JSON"`; `parsed` is exactly `{serverVersion}` with `serverVersion === "28.0.4"`.
- `profiles.info.representation === "JSON"`; `parsed` is exactly `{daemonId,dataRoot,os,arch,driver,containerdAddress,namespaces}`. Values equal the validated lease and fixed runtime: daemon ID and data root equal the lease, `os === "linux"`, `arch === "x86_64"`, `driver === "overlay2"`, containerd address equals the lease, and `namespaces` is exactly `{containers,plugins}` equal to the lease namespaces.
- `profiles.builder.representation` equals `profiles.builder.parsed.representation`; `parsed` is exactly `{name,nodeName,driver,endpoint,status,buildkit,platforms,representation}`. `name` is null for `FORMAT_ONLY_JSON`, otherwise the lease context name; `nodeName === lease.contextName`; `driver === "docker"`; endpoint is the permitted lease endpoint/context-name value; `status` is a string whose lowercase value is `"running"`; `buildkit` is a nonempty string; platforms contains `linux/amd64`; representation uses the two-value set above.

## Preflight and authenticated context observation

`preflight` has exactly `{acceptance,source,context}`:

- `acceptance` is exactly `{bytes:11744,sha256:"82b1b1735d6e1063048fbade9d3c86e6b0819a90e54c54ec9898d4937721f5a3"}`.
- `source` is exactly `{head:"582fb97e88cf5a498e6ae34ec76eb5736ada2a47",main:"e4fa47cbe66758a5b56f5347c2c27e61bdae1ed0",tree:"7292e98e7ee23e45ebccff075577af41f271dbf9"}`. These are producer-embedded source identity values; do not replace them with controller or PR188 revisions.
- `context` is exactly `{bytes:1986560,sha256:"d29f612378a01c0ec6cd61c9482da96c99868695b3e526622dc38659e22567cb"}`.

The top-level `context` has exactly `{bytes,sha256,entries,physical}`. Its first two fields are value-equal to `preflight.context`. `entries` is a dense array of exactly 15 descriptors, with ordinals exactly `0..14` in array order. Every descriptor has keys in this order:

`{ordinal,headerOffset,dataOffset,path,type,mode,uid,gid,mtime,size}` plus final `sha256` exactly for files.

Descriptor constraints are: offsets and metadata are safe nonnegative integers; `headerOffset` is 512-byte aligned; `dataOffset === headerOffset + 512`; paths are unique; type is `file` or `directory`; file SHA-256 is lowercase 64-hex; directory size is zero and has no `sha256`. The entries are exactly fourteen files and one directory matching the candidate V2 context contract:

- `Dockerfile` file, mode `0o644`, UID/GID0, mtime0;
- `gosu` file, mode `0o755`, UID/GID0, mtime0;
- `auto-world-gosu` directory, mode `0o755`, UID/GID0, mtime0;
- twelve mode-`0o644`, UID/GID0, mtime0 files below `auto-world-gosu/`: `gosu-LICENSE`, `moby-user-LICENSE`, `go-LICENSE`, `go-PATENTS`, `x-sys-LICENSE`, `x-sys-PATENTS`, `notices.json`, `module-closure.json`, `sbom.cdx.json`, `version.txt`, `build-info.txt`, `derivative-manifest.json`.

For every entry, type/mode/UID/GID/mtime and file size/SHA-256 must equal the delivered `candidateContractV2` expectation. The IPC validator need not assert a guessed archive member order beyond ordinal consistency; the authenticated fixed context identity and exact path set bind the bytes.

## Original physical snapshot schema

Every producer physical snapshot — context file, output directory, base archive and candidate archive — has exactly these keys in this order:

`{dev,ino,mode,nlink,size,uid,gid,mtimeNs,ctimeNs,birthtimeNs}`

Types are exact:

- `dev`, `ino`, `mtimeNs`, `ctimeNs`, and `birthtimeNs` are decimal strings produced with `String(bigint)`;
- `mode`, `nlink`, `size`, `uid`, and `gid` are safe nonnegative Numbers produced with `Number(bigint)`;
- `mode` is the complete platform `st_mode`, not permission bits alone. Test permissions with `mode & 0o7777`.

The context physical snapshot requires regular-file complete mode `0o100600`, UID/GID1000, nlink1 and size1986560. Retention archive physical snapshots require regular-file complete mode `0o100600`, UID/GID1000, nlink1, positive size at most 1 GiB and `size === archive.bytes`. The retention directory snapshot requires directory complete mode `0o40700`, UID/GID1000 and nlink2. Permission masks alone never establish the original file/directory type.

The controller must retain and compare this complete original ten-field snapshot when proving post-stop stability. A later smaller `postStop` receipt projection may be separately defined, but it must be derived only after equality against the complete original; it must not be confused with or used to weaken the producer snapshot validator.

## Build window

`buildWindow` has exactly `{startedAtMs,completedAtMs}`. Both are safe nonnegative integers, `startedAtMs <= completedAtMs`, and `completedAtMs - startedAtMs <= 600000`. Under the genuine producer, both lie before or at its effective deadline `lease.deadlineAtMs - 25000`; the completed value is the post-build sample plus one. The same two values must be deeply equal in top-level `buildWindow`, `retention.buildWindow`, and the window whose seconds projection controls `pairProof.delta` filesystem mtimes.

## Pair proof and filesystem delta

`pairProof` has exactly these keys in order:

`{scope,authority,profile,base,candidate,inheritedLayers,addedLayers,configProfile,delta}`

Constants:

- `scope === "CONDITIONAL_ON_AUTHENTICATED_ARCHIVES_AND_BUILD_WINDOW"`;
- `authority === "NOT_AUTHORIZED"`;
- `profile === "POSTGRES_GOSU_DERIVATIVE_DOCKER_SAVE_USTAR_V1"`;
- `inheritedLayers === 10`;
- `addedLayers === 2`;
- `configProfile === "STRICT_INHERITED_CONFIG_V2"`.

`base` and `candidate` each have exactly `{archive,configId,layers}`. Each `archive` has exactly `{bytes,sha256}` with positive safe integer bytes at most 1 GiB and lowercase 64-hex SHA-256; their combined bytes are at most 2 GiB. Each `configId` matches `/^sha256:[0-9a-f]{64}$/u`. Base is fixed to config ID `sha256:79bd7c99e923138f136f8009d6bffa66e21e9d4fda5c0c561b00fc9c90cfe537` and layers10; candidate has layers12.

`delta` has exactly these keys in order:

`{scope,authority,baseMembers,candidateMembers,replaced,addedFiles,addedDirectories,mtimeChangedDirectories}`

Required values and relations:

- `scope === "CONDITIONAL_ON_AUTHENTICATED_OCI"` and `authority === "NOT_AUTHORIZED"`.
- Member counts are safe positive integers.
- `replaced` is exactly `['usr/local/bin/gosu']`.
- `addedFiles` is the bytewise sorted exact twelve-path set under `usr/share/licenses/auto-world-gosu/`: `build-info.txt`, `derivative-manifest.json`, `go-LICENSE`, `go-PATENTS`, `gosu-LICENSE`, `moby-user-LICENSE`, `module-closure.json`, `notices.json`, `sbom.cdx.json`, `version.txt`, `x-sys-LICENSE`, `x-sys-PATENTS`.
- `addedDirectories` is exactly one of the four bytewise-sorted suffixes: `[]`, `['usr/share/licenses/auto-world-gosu']`, `['usr/share/licenses','usr/share/licenses/auto-world-gosu']`, or `['usr/share','usr/share/licenses','usr/share/licenses/auto-world-gosu']`. The unchanged filesystem predicate requires usr/usr-local/usr-local-bin already present; genuine proof also rejects unmaterialized ancestor placeholders, so no other added parent set can arise.
- `mtimeChangedDirectories` is sorted and unique and may contain `usr/local/bin`. It may additionally contain only the one nearest existing parent affected by an added directory: `usr/share/licenses` only for the one-element added suffix, `usr/share` only for the two-element added suffix, or `usr` only for the three-element added suffix. For the empty added suffix, none of those three may appear. Each eligible change remains optional; the array is disjoint from addedDirectories and never contains usr/local or usr/share/licenses/auto-world-gosu. This derives from directChanges and ZERO policy in compareFilesystemInventoriesV2, not from a guessed native delta.
- `candidateMembers === baseMembers + 12 + addedDirectories.length`.

The delta is predicate evidence only. It adds no admission, functional or vulnerability authority.

## Retention snapshot and mandatory equalities

`retention` has exactly these keys in order:

`{state,preservation,authority,admission,directory,buildWindow,base,candidate}`

Constants are:

- `state === "SEALED_SNAPSHOT_REVIEW_PENDING"`;
- `preservation === "FUTURE_CONTROLLER_REQUIRED"`;
- `authority === "NOT_AUTHORIZED"`;
- `admission === "NOT_AUTHORIZED"`.

`directory` is the complete physical snapshot above. `base` and `candidate` each have exactly `{name,archive,configId,physical}`. Names are respectively `base-image.tar` and `candidate-image.tar`; `archive` is the exact two-key archive identity; `configId` is a Docker config digest; and `physical` is the complete ten-key snapshot.

The IPC validator must enforce all of these cross-record equalities before accepting success:

1. Top-level nonce and lease projection equal validated transport input values.
2. `context.bytes/sha256 === preflight.context.bytes/sha256`.
3. Builder summary fields equal the corresponding `profiles.builder.parsed` fields.
4. `retention.buildWindow` deeply equals top-level `buildWindow`.
5. `retention.base.archive` deeply equals `pairProof.base.archive`; base config IDs also equal.
6. `retention.candidate.archive` deeply equals `pairProof.candidate.archive`; candidate config IDs also equal.
7. Each archive physical `size` equals its archive identity `bytes`.
8. Base and candidate archive basenames are fixed and distinct; directory permissions/ownership and both archive permissions/ownership/link counts match the genuine constants above.
9. All top-level, pair-proof, delta and retention authority/admission/functional/vulnerability fields retain their exact non-authorizing constants.

Accept only this genuine branch. Reject `RETAINED_PAIR_PROOF_SIMULATION`, `SIMULATED_NOT_RETAINED`, any `retentionFailure`, missing/extra fields, any partial equality, or a producer failure carrying preserved diagnostic data as a success result.

## Minimal controller use

The worker validates this complete source result before emitting its success envelope. The root controller parses and independently validates the same closed schema and equality bindings. It may then use only the minimal projections needed for inventory subjects and preservation: the fixed base config ID, candidate config ID, archive identities, complete original physical snapshots, output directory snapshot and build window. Raw profiles and context entry detail are validation-only private IPC material and are omitted from durable receipt/ACK projections.

## Final readiness clarification — worker failures and acceptance-test fidelity

These two bounded clarifications close independent pre-implementation questions. They do not expand the nine paths or any source/native authority. They refine the earlier test/cleanup descriptions wherever those were incomplete.

Worker failure cleanup is deterministic. Before invoking the producer, validation/environment/source failures are `cleanup:"NOT_STARTED"` when every worker-owned descriptor was released normally. A failed or unestablished close of a worker-owned descriptor is instead code `gosu_retained_pair_worker_cleanup_uncertain`, phase `CLEANUP`, cleanup `UNCERTAIN`, even if the producer was never invoked. Reserve the invocation immediately before the single call. Once invocation began, any rejection or malformed returned result is `cleanup:"UNCERTAIN"`: a producer error, return value or diagnostic alone does not independently prove cleanup. Producer rejection keeps code `gosu_retained_pair_worker_producer_failed`/phase `PRODUCER`; invalid returned result keeps `gosu_retained_pair_worker_result_invalid`/phase `RESULT`. The worker emits no failure with cleanup `CONFIRMED`; that vocabulary remains permitted for compatibility in the closed schema but is not inferred by this implementation. Only a valid result may proceed to the CLI success envelope, and the Root still requires process close/drains and its own authenticated daemon stop. Root must not erase a worker-reported cleanup uncertainty merely because its daemon stop succeeded.

CLI framing/write/drain/close failure is code `gosu_retained_pair_worker_cleanup_uncertain`, phase `CLEANUP`, cleanup `UNCERTAIN`. If no stdout bytes have been written and stdout is still usable, the CLI may emit the one closed failure envelope and exit1. If any success/failure bytes were already written, never append a second envelope or raw error; set exit1, keep stderr empty and let the Root reject the partial/invalid frame or unclosed pipes. No worker error changes daemon ownership or authorizes worker-side stop, signal, retry, archive cleanup or publication.

The exact private acceptance file is intentionally absent from tracked CI inputs. No tracked blob supplies or reconstructs its authenticated11744 bytes/SHA25682b1b1735d6e1063048fbade9d3c86e6b0819a90e54c54ec9898d4937721f5a3. The existing synthetic acceptance fixture and test-only hash substitutions are `PROTOCOL_SIMULATION`, never genuine authentication. Do not read, copy, embed, publish or add that private file while authoring/running source tests. Do not relax the production pin, add a private-fixture path selector, or skip a required case while claiming it passed.

Source-test evidence is therefore split precisely: (1) VM protocol tests exercise positive full closure/acceptance/result/orchestration with synthetic fixtures and explicitly report `PROTOCOL_SIMULATION`; (2) actual small harmless temporary files on Windows and Linux UID1000/root prove only filesystem mechanics (no-follow, regular type, single link, stable held/named identity, hashing, exclusive sibling create/fsync/readback/close), and genuine production validation refuses an incorrect private acceptance pin; (3) a positive genuine default full deployment/acceptance closure is not available in public CI or this source-only local matrix and remains an explicit validation gap. Root records that gap in validation/PR evidence; real mechanism tests and VM replacements never substitute for it. The first positive genuine acceptance closure belongs only to the separately frozen/reviewed future native gate using its already authorized persistent acceptance input. No Docker/image operation or old consumed artifact is accessed during source tests. No Windows exclusion is treated as Linux/root evidence. This refinement leaves meaningful source completion possible with the stated gap, while actual retention/admission remain blocked on their own authentic evidence.


## Approved V6 source integration amendment — complete diagnostic classification

The complete local source gate found one integration omission: the existing exhaustive PostgreSQL process/image-route test detects this controller's genuine `node:child_process` import, while `infra/postgres-image/admission-consumers.json` did not list the new route. Lint and typecheck passed; the root test gate failed this existing invariant. An independent unchanged-test RED reproduced exactly the missing controller entry before repair. The failed attempts remain immutable.

The frozen V6 plan amendment (4,790 bytes, SHA-256 `22373bf766c78d22563e31a0b49aa21608be64e08cbf36be76bcfd1f078f030a`) received Architect `CLEAR_SOURCE_PLAN_AMENDMENT_ONLY`, then distinct Critic `OKAY_SOURCE_PLAN_AMENDMENT_ONLY`, before metadata edits. It supersedes every earlier statement that closes the complete increment to only the six original new paths and three appendices (nine changed paths). Those same six new paths and three prefix-preserving appendices remain; the complete source closure is now exactly ten changed paths, including the pre-existing classification JSON.

The only allowed JSON byte change is one sorted `"gosu-retained-pair-controller-v1.mjs"` line in `diagnosticOnly`, between observation-v2 and source-retention. All remaining bytes, supported/private/offline entrypoints, topology and non-authoritative claims remain unchanged. The worker does not match the unchanged effect-route scanner and is not added. No production module, code/test pin, pre-existing test, dependency, product file, currentEvidence or support date changes under this amendment. The three original document prefixes remain exact. The two newly introduced public documents preserve their earlier narrative as historical V5 scope and append this clarification.

The existing test remains strict and unchanged. Its GREEN, exact ten-path closure/single-line JSON delta, fresh ordered code Architect then distinct Security/Critic reviews, four executable Turbo graphs, all six final local gates, exact-head CI, normal protected merge and matching main CI are still required. The unchanged four code/test pins keep targeted matrix V11 as source-code evidence; metadata/docs alone do not require another six-mode matrix. The earlier nine-path source reviews alone do not approve this revised closure.

Diagnostic classification grants no execution or admission authority. This amendment grants no native attempt, acceptance read, consumed control/claim/archive access, image operation, publication, activation or dates. All V5 runtime contracts and the separately reviewed future one-shot boundary remain intact. Rollback removes only the added diagnostic line alongside this unused increment through focused review, retaining the exhaustive classification check and all historical evidence.
