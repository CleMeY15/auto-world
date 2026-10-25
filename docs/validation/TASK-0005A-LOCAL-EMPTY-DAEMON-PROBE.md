# TASK-0005A — Local empty Docker daemon probe

Status: REAL_LOCAL_PROBE_VERIFIED, LOCAL_DIAGNOSTIC, NO_IMAGE_EXECUTION, NOT_ADMITTED. Integration gates are recorded in [PR118](https://github.com/CleMeY15/auto-world/pull/118).

## Purpose and boundary

The independently accepted [native PostgreSQL runtime V2](TASK-0005A-POSTGRES-REMOTE-RUNTIME-DIAGNOSTIC.md) proves same-volume persistence across two containers. Cold restoration must additionally start from an empty engine. The existing WSL daemon contains two foreign images, which must remain intact. This increment probes a separate empty daemon without loading or executing any image.

The local input-free entrypoint uses the existing Linux Docker 28.0.4 and Node 22.23.2. It runs as UID/GID 0 to manage its own infrastructure process. This root infrastructure probe does not satisfy or replace the non-root candidate-execution contract. Its only Docker operations are version, info and image/container/volume inventories. No registry credential, pull, load, create, start, exec, prune or production service is involved.

## Isolation contract

The owned daemon has an exclusive private parent, data/exec roots, PID, socket and configuration. Its bridge, iptables, IPv6 iptables, forwarding, masquerading and userland proxy are disabled. It uses two fresh containerd namespaces, distinct from the primary daemon's namespaces. The existing containerd service is shared; no global service is stopped or reconfigured. This is operational isolation on the same kernel. Docker documents multiple daemons as experimental; it is not a virtual machine boundary.

The private client context is selected in a fresh `DOCKER_CONFIG`, and every command additionally specifies the exact owned Unix socket with `--host`. Invalid configuration cannot silently route a command to the principal engine. Configuration/context bytes, owners, modes, inodes, socket/PID identities and the daemon process are checked before operations. The daemon's ID, data root, version, driver and containerd namespaces must match. Ambient host/context overrides are rejected. The runner accepts a fixed read-only command allowlist.

The helper accepts only the reviewed private configuration and `/usr/bin/dockerd` 28.0.4. The root child is bound by PID, start ticks, all UID/GID fields, executable and exact arguments. The plugin namespace uses the exact nonce-bound CLI flag `--containerd-plugins-namespace`; no plugin namespace option is written to the JSON configuration. Both namespaces reported by `/info` must equal the owned values. Signals address only that proven process; containerd and the principal daemon are never signaled. The principal's two image identities and inspect hashes, and its empty container/volume inventories, must remain unchanged.

## Cleanup, evidence and rollback

The isolated engine must be empty before and after the probe. Stop requires current ownership evidence and confirmation that the original process, socket and PID file are gone. A late startup failure after complete empty-daemon verification must attempt a bounded stop of that already proven process. An ambiguous PID, daemon or inventory remains uncertain and preserves its private state for inspection. No guessed PID, recursive deletion or foreign-resource cleanup is permitted.

Daemon logs, metadata and private state are retained locally. Only a bounded technical receipt is summarized: local execution/source identities, installed daemon binary hash, verified empty inventories and stop result. It claims `LOCAL_DIAGNOSTIC`, image/registry execution `NOT_ATTEMPTED`, admission `NOT_AUTHORIZED` and null support/archive dates. It is not image restoration, SQL backup/restore, signing or supported startup.

The implementation must pass adversarial lease/process tests, lint/typechecks/build, independent review, a real default-helper/default-transport empty probe and exact final-head/main CI. Rollback removes the diagnostic entrypoint and does not reset the main daemon, delete foreign images/volumes or affect deployed services. TASK-0005A/TASK-0005 remain IN_PROGRESS; TASK-0006 stays blocked.

## Real local evidence, 2026-09-30

The input-free CLI was executed on clean source `3f55437720309a77031ceaacc8321a1f753a6675` with its production helper and transport, without dependency injection. Docker 28.0.4 binary identity: 83,666,424 bytes, SHA-256 `b8644399e73e2c9b32ea3983daf3a9856a483a79196bea10c01977d2b021fe71`. Node was 22.23.2; this infrastructure process ran as UID/GID0. No image was executed.

Execution `local-d9c801378853751a8a45c916` ran from `2026-09-30T08:59:50.160Z` to `2026-09-30T08:59:52.124Z`. The original private receipt is retained at `/var/tmp/aw-dp-WoIdAt/receipt.json`, root-owned mode0600 within a root-owned mode0700 parent: 2,155 bytes, SHA-256 `12f8992c497764b4ae264442d9521af73dfd6f81805add0e0478c23b36c6d575`.

The owned daemon `02cb8f1a-bd04-482f-930e-f3e2fba4d176`, PID940, had separate data/exec roots, context and socket, container namespace `awdiag-d9c801378853751a8a45c916` and plugin namespace `plugins.awdiag-d9c801378853751a8a45c916`. Verification passed with zero images, containers and volumes. Shutdown passed with the original process, socket and PID file gone; private state remains retained. The principal daemon's two foreign images and their inspect hashes remained unchanged, with zero containers/volumes; before/after snapshot SHA-256 `a1b07cb2bfa5e0e975f7c46b39c17f9bdb3d09900c465a91e8cb659a35450d73`.

The receipt has `failure: null`, `LOCAL_DIAGNOSTIC`, `NOT_AUTHORIZED`, image/registry execution `NOT_ATTEMPTED` and three null support/archive dates. This proves the empty engine infrastructure and its owned shutdown. It establishes no private image retention, cold image restoration, non-root image execution, SQL backup/restore, signing, admission or supported activation.

Fresh Linux UID1000 `pnpm run check` on that source passed 1,052 root tests without failures or skips, all package lint/typechecks/tests/builds, Secretlint for 517 files and a dependency audit without known vulnerabilities. The focused helper/lease suite passed 91 tests, independently replayed without Docker. Independent implementation review approved the exact PID/namespace correction. Independent original-receipt review also approved its bytes, private permissions, default launch, unchanged prior failures, absent process/socket/PID and an actual read-only principal replay matching the same two-image snapshot. Since the isolated daemon is stopped, its namespace proof is the original guarded execution and VERIFIED receipt, not another isolated `/info` after shutdown. Exact final-head/main CI are tracked in PR118.

### Earlier failed attempts remain failed

- Source `cd35c0f9c8a2e37761d9c42f3127cfdd138ceee7` stopped before spawning a daemon. Docker's successful configuration dry-run writes exactly `configuration OK\n` on stderr; the generic strict-empty stderr check rejected it. Its original 881-byte INCOMPLETE receipt remains at `/var/tmp/aw-dp-D8zc2I/receipt.json`, SHA-256 `b4dfa460569f7b18cdcdb93526f04a6406b04041bd8b769535142f9e2bb6f036`. A specialized validator now accepts only that exact acknowledgement, status0 and empty stdout; all other command checks remain strict.
- Source `54cee5a86bfad44e1f2cbebfdf491dab7810640c` started an owned daemon but failed startup verification. Its original 881-byte INCOMPLETE receipt remains at `/var/tmp/aw-dp-yTaLnX/receipt.json`, SHA-256 `409b7f027b3a2f540a641f0113c081e09f0d6ad27cf7fddb92510cfd3039bbbb`. The actual PID file contained digits without a newline. The JSON plugin option also passed the dry-run while leaving `/info` at the principal plugin namespace. The fix binds exact digit-only PID bytes and passes the nonce-bound plugin option through the CLI, preserving strict API checks.
- That second process was separately recovered only after two proofs of PID5602/startTicks6642, all root UID/GID fields, executable/arguments, private configuration and binary hashes, exact owned daemon ID/root and empty inventories. SIGTERM stopped only that process; socket/PID disappearance and unchanged principal image metadata were confirmed. Its separate 825-byte recovery receipt, SHA-256 `98882e264a5c1ada1221d8ffd190999dff57c2fdb12298320f961e19062702f8`, remains alongside the unchanged failed receipt. Recovery does not reclassify the failed probe as successful.

The retained private daemon directories have no automatic deletion policy. Future candidate restoration uses a separately reviewed non-root client and cannot obtain arbitrary mutating commands through this read-only probe runner.

## Primary references

- [Docker multiple-daemon guidance](https://docs.docker.com/reference/cli/dockerd/#run-multiple-daemons)
- [Moby 28.0.4 containerd selection](https://github.com/moby/moby/blob/v28.0.4/cmd/dockerd/daemon.go#L961)
- [Moby data-root modes](https://github.com/moby/moby/blob/v28.0.4/daemon/daemon_unix.go#L1297)
- [Docker CLI context configuration](https://github.com/docker/cli/blob/v28.0.4/cli/config/config.go#L155)
- [Moby exact PID file serialization](https://github.com/moby/moby/blob/v28.0.4/pkg/pidfile/pidfile.go#L48)
- [Moby JSON containerd namespace fields](https://github.com/moby/moby/blob/v28.0.4/daemon/config/config.go#L249-L250) and [flag-name configuration validation](https://github.com/moby/moby/blob/v28.0.4/daemon/config/config.go#L534-L557)
- [Moby plugin namespace CLI flag](https://github.com/moby/moby/blob/v28.0.4/cmd/dockerd/config.go#L60-L61) and [effective namespace reporting](https://github.com/moby/moby/blob/v28.0.4/daemon/info.go#L218-L226)
