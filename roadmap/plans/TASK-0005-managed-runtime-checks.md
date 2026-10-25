# TASK-0005 — Four produced-image runtime checks

Status: ACCEPTED_FOR_CONDITIONAL_DIAGNOSTIC_IMPLEMENTATION after actual Architecture
and distinct Critic CLEAR reviews of the9,083-byte candidate, SHA256
`161f301eeee12a84be47d8e27746b60fffd81522ba5a70b235f70feb36da2b89`.
Concrete follow-up to step4 of the [managed-image corrections
plan](TASK-0005-managed-image-corrections.md), within [ADR-0026](../../docs/decisions/ADR-0026-data-foundation-managed-tools.md).
The start condition below remains mandatory; this acceptance grants no admission.

The two-image preparation detail below subsequently received Architecture CLEAR
and distinct Critic CLEAR on the9,681-byte candidate, SHA256
`8f645899805b9032ccbc6723d624ad4b7b0ab7f6c06a270d6e1424ae1f476ee2`.
This records the already required runtime identity preparation, adding no role or
admission authority.

## Start condition and boundary

Run 40207844218 records core preparation=0/build=0, 16 JUnit reports and inspected
image `sha256:9134722e3f4aeada57542f0104924835e39283ad75019e05c30e97aac9306ac7`
with Docker Size=2,489,766,323 bytes after the locator correction. Complete five-role
eligibility is currently UNKNOWN: the 2 GiB archive-capture boundary rejects core
before its local subject is qualified or audited; PostgreSQL/AWS results cannot
establish the bundle. Docker Size is not the measured TAR-file bytecount.

Start only after the same Linux job has eligible builds/upstream tests and full
fresh diagnostic audits for PostgreSQL, OpenSearch core, Redis, SeaweedFS and AWS
CLI. Require their exact measured Linux/amd64 configIDs, source/material bindings
and original audit results. Bind unchanged Redis/SeaweedFS configIDs to their
audited registry subjects. Preserve the source-bound gosu coverage limitation.
Missing or rejected evidence fails this precondition; never substitute historical
images, mutable tags or a different AWS helper. Recheck IDs before and after use.

These checks exercise unadmitted images on disposable Linux CI, changing no
defaults, backup-v1 manifest, admission generation or support date. The unchanged
seventeen-phase integration must later run against final admitted registry
subjects. ADR-0011 authority is neither invoked nor satisfied; shared admission
remains a separate reviewed decision.

## Smallest implementation shape

One future `tests/managed-image-runtime.integration.mjs`, outside the package and
managed pure-test globs, is invoked directly by the job's pinned Node22 with
`node --test tests/managed-image-runtime.integration.mjs` only after all five
roles qualify. It requires four sequential PASS outcomes with no skip, then one
bounded cleanup. Use Node builtins and standard Docker/Compose only; no pnpm install,
workspace package build, new dependency, workflow or generic runtime profile.

Write a small Compose JSON manifest in a new private0700 RUNNER_TEMP directory.
Create distinct source and restore UUID projects with an unpredictable owner
token. Both use exactly the same four service configIDs, `pull_policy: never`,
Linux/amd64 and the same fifth AWS configID for every S3 helper. Verify actual
container image IDs, ownership labels, mounts and project network before effects.
After five diagnostic audits pass, prepare exactly Redis and SeaweedFS with standard Docker pulls of their already audited Linux/amd64 platform digests, then require each inspected configID to equal the audited JSON's `Metadata.ImageID`, never `ArtifactID`, before constructing the runtime input. The four tests perform no pulls, introduce no mutable tag or sixth helper image, and retain the existing start condition and read-only helper restrictions.

Reuse service commands, limits, health deadlines and loopback publication from
`infra/compose.json`, with fresh volumes and private credential files. Raw keeps
`nocopy:true`; the restore manifest sets it on all four volume mounts and creates
services stopped before checking emptiness. Keep PostgreSQL's normal entrypoint
to exercise gosu, with `tty: false` and `stdin_open: false` on every service.
Helpers receive no PTY or interactive stdin; gosu usage is bounded to this
noninteractive entrypoint. Core keeps its direct launcher, UID1000, heap and memory-lock
limits; omit obsolete `DISABLE_*` flags. Copy the existing AWS probes' non-root,
read-only, cap-drop ALL, no-new-privileges, resource/time/file-size bounds, private
input/output file binds and environment-name credential transport. Endpoints belong to the
generated manifest, never the default runtime state.

Host binds allow only the fixed regular, non-symlink bootstrap, credential, S3
input/output and archive files in this newly owned private directory. Copy any
required checked-in bootstrap into that directory before use and verify its
bytes. No other host path may be mounted.

Reuse `run` from `scripts/data-infra/runtime.mjs`, `sqlText` from `migrations.mjs`,
the pure raw-key/hash/conditional-write functions, `validateTarArchive` from
`backup.mjs`, cancellation protection and `removeOwnedHelper`. Their imports need
only Node builtins and checked-in files. Do not call the default Compose, AWS or
backup entrypoints: they deliberately bind historical image/manifest identities.
Do not extend their contracts. Use one fixed test-only SQL marker table, a small
fixed raw payload and deterministic expected document. This proves persistence,
not business-schema/migration acceptance or a bypass of `syntheticFixture`.

## Four sequential cases

| Case | Required real observations |
| --- | --- |
| 1. Start and refusal | Normal PostgreSQL startup initializes the fresh volume; inspect `/proc/1` to require postgres as PID1 with UID/GID70 and data ownership70. Require core Java PID1/UID1000, usable cluster health, authenticated Redis PING and AWS2.38.5 version. Through the exact AWS image perform signed bucket/put/get and compare raw bytes. A wrong key/signature must return an explicit service authentication error; a transport/timeout/general CLI failure does not count. An unsigned HTTP read must actually return401/403. |
| 2. SQL/raw/index | Store the marker, raw key, SHA256 and payload in SQL; use conditional signed raw writes plus readback. Read the document from SQL, index with refresh, then perform a real `_search` asserting exactly the expected hit, ID and source. Record an authenticated Redis marker too. Health or document GET alone is insufficient. |
| 3. Restart | Stop and start the source project's four services without replacing volumes. Revalidate identities/PIDs, SQL values, signed raw SHA256, Redis marker and the same `_search` result. No rewriting the fixture or reindexing to conceal persistence failure. |
| 4. Cold canonical restore | Stop all source writers and prove them stopped. Archive only PostgreSQL/raw volumes. Restore into a different UUID project with new verified-empty volumes and the same five-image bundle. Start it and verify restored SQL/raw bytes and ownership. Its search/cache volumes start empty. Read the restored target SQL, rebuild its index, and require the same real `_search` hit; never reuse the source SQL response/document. Redis is derived and may be repopulated from target SQL. This is canonical PostgreSQL/raw recovery, not a physical OpenSearch snapshot claim. |

## Cold archive helper

Use the audited produced core image's GNU tar with an explicit `/bin/bash`
entrypoint; no sixth image/package. Match the existing backup helper's owned
name/label, root0, read-only rootfs, network none, cap-drop ALL, no-new-privileges
and resource/deadline bounds. Require numeric owners, explicit ustar format,
strict `validateTarArchive` and full-file hash before extraction. Unsafe or
unsupported output stops the case.

Creation mounts exactly one cold source volume read-only and a private output
file. Precreate that file0600 exclusively under the job's0700 directory; retain
its host ownership/inode/mode across tar truncation and verify them afterward.
Creation requires only the existing DAC_OVERRIDE capability for source reads.
Extraction mounts exactly one newly owned, empty target volume read-write and
the validated archive read-only. Reuse only the existing backup extraction
allowlist DAC_OVERRIDE, CHOWN and FOWNER, justified by reading/traversing entries,
restoring numeric ownership and restoring modes. CHOWN alone is insufficient.
Check emptiness including hidden entries with Bash globbing; do not add findutils.
Preserve numeric owners/modes and verify PostgreSQL70 plus actual raw ownership
before startup. No privileged mode, SYS_ADMIN, other host bind or automatic capability
expansion is permitted; a permissions failure is a retained failure.

## Evidence, cleanup and stop conditions

Use explicit per-command deadlines, at most5minutes per startup,20minutes for
the four cases and an independent bounded cleanup window of120seconds. Stop on
identity/audit drift, incorrect PID/UID/data, auth refusal ambiguity, SQL/raw/search
mismatch, unsafe archive, active writer, nonempty/foreign target or timeout.
Later cases cannot turn an earlier failure into success.

Finally remove only recorded UUID/project/owner/identity-matched containers,
volumes, networks and helpers. Reuse targeted helper cleanup after verified
client closure; prove absence. Unverified command termination forbids further
Docker effects. Never prune, enumerate/delete global resources or touch history.
Foreign ownership, uncertain cleanup or cancellation preserves the primary error
and cannot produce success.

Public output contains four fixed outcomes, sanitized failure codes, image/source
bindings, expected/observed counts, UID checks, opaque hashes and cleanup status.
Credentials, raw/SQL contents, archives and unrestricted logs remain private to
the disposable runner and are not uploaded. This supplies no durable-retention
or second-copy-restoration claim. Review this small test shape before code;
acceptance then requires all four actual Linux cases and scoped cleanup to pass.
