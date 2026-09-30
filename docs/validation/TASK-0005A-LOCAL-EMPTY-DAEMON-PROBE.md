# TASK-0005A — Local empty Docker daemon probe

Status: IMPLEMENTATION_IN_PROGRESS, LOCAL_DIAGNOSTIC, NO_IMAGE_EXECUTION, NOT_ADMITTED.

## Purpose and boundary

The independently accepted [native PostgreSQL runtime V2](TASK-0005A-POSTGRES-REMOTE-RUNTIME-DIAGNOSTIC.md) proves same-volume persistence across two containers. Cold restoration must additionally start from an empty engine. The existing WSL daemon contains two foreign images, which must remain intact. This increment probes a separate empty daemon without loading or executing any image.

The local input-free entrypoint uses the existing Linux Docker 28.0.4 and Node 22.23.2. It runs as UID/GID 0 to manage its own infrastructure process. This root infrastructure probe does not satisfy or replace the non-root candidate-execution contract. Its only Docker operations are version, info and image/container/volume inventories. No registry credential, pull, load, create, start, exec, prune or production service is involved.

## Isolation contract

The owned daemon has an exclusive private parent, data/exec roots, PID, socket and configuration. Its bridge, iptables, IPv6 iptables, forwarding, masquerading and userland proxy are disabled. It uses two fresh containerd namespaces, distinct from the primary daemon's namespaces. The existing containerd service is shared; no global service is stopped or reconfigured. This is operational isolation on the same kernel. Docker documents multiple daemons as experimental; it is not a virtual machine boundary.

The private client context is selected in a fresh `DOCKER_CONFIG`, and every command additionally specifies the exact owned Unix socket with `--host`. Invalid configuration cannot silently route a command to the principal engine. Configuration/context bytes, owners, modes, inodes, socket/PID identities and the daemon process are checked before operations. The daemon's ID, data root, version, driver and containerd namespaces must match. Ambient host/context overrides are rejected. The runner accepts a fixed read-only command allowlist.

The helper accepts only the reviewed private configuration and `/usr/bin/dockerd` 28.0.4. The root child is bound by PID, start ticks, all UID/GID fields, executable and exact arguments. Signals address only that proven process; containerd and the principal daemon are never signaled. The principal's two image identities and inspect hashes, and its empty container/volume inventories, must remain unchanged.

## Cleanup, evidence and rollback

The isolated engine must be empty before and after the probe. Stop requires current ownership evidence and confirmation that the original process, socket and PID file are gone. A late startup failure after complete empty-daemon verification must attempt a bounded stop of that already proven process. An ambiguous PID, daemon or inventory remains uncertain and preserves its private state for inspection. No guessed PID, recursive deletion or foreign-resource cleanup is permitted.

Daemon logs, metadata and private state are retained locally. Only a bounded technical receipt is summarized: local execution/source identities, installed daemon binary hash, verified empty inventories and stop result. It claims `LOCAL_DIAGNOSTIC`, image/registry execution `NOT_ATTEMPTED`, admission `NOT_AUTHORIZED` and null support/archive dates. It is not image restoration, SQL backup/restore, signing or supported startup.

The implementation must pass adversarial lease/process tests, lint/typechecks/build, independent review, a real default-helper/default-transport empty probe and exact final-head/main CI. Real evidence is pending. Rollback removes the diagnostic entrypoint and does not reset the main daemon, delete foreign images/volumes or affect deployed services. TASK-0005A/TASK-0005 remain IN_PROGRESS; TASK-0006 stays blocked.

## Primary references

- [Docker multiple-daemon guidance](https://docs.docker.com/reference/cli/dockerd/#run-multiple-daemons)
- [Moby 28.0.4 containerd selection](https://github.com/moby/moby/blob/v28.0.4/cmd/dockerd/daemon.go#L961)
- [Moby data-root modes](https://github.com/moby/moby/blob/v28.0.4/daemon/daemon_unix.go#L1297)
- [Docker CLI context configuration](https://github.com/docker/cli/blob/v28.0.4/cli/config/config.go#L155)
