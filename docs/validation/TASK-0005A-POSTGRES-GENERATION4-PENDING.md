# TASK-0005A — PostgreSQL generation 4 PENDING preparation

Status: **IMPLEMENTATION IN PROGRESS — PENDING INTEGRATION VERIFICATION**. PR143 is limited to the supported broker's Docker inspection, lifecycle and cleanup predicates and the source representation of a new generation 4 `PENDING` candidate. It does not install or activate generation 4, mutate Root state or Task Scheduler, execute Docker, retry SQL, reuse runtime data or establish any P7 result.

## Historical boundary

PostgreSQL generation 3 remains delivered and `ACTIVE`. Its support interval from 2026-10-07 through 2027-10-07 and archive retention through 2028-10-06 remain unchanged. Its sole supported `SQL_CHECK` remains `NOT_ACCEPTED_NO_RETRY` with the retained `CONTAINER_CREATE / postgres_admission_container_invalid` failure evidence. PR143 does not relabel that session, patch the installed generation 3 recipe, change its locator, health or maintenance input, reuse its empty failed data directory, or alter its archive-health scheduler duty.

The repaired broker changes one immutable execution file. Generation 4 must therefore preserve the complete generation 1 through 3 history and all 73 unchanged generation 3 execution pins, while replacing only the broker pin in a new revision-one `PENDING` root. Its support and archive dates remain null until a later reviewed activation decision.

## Focused source correction

The broker-owned `docker container create` command adds fixed `--network none`; callers still cannot provide Docker arguments, network settings, labels, mounts, paths, images, callbacks or environment overrides. Before creation, the broker freezes a private intent with the generated name, nonce, three reserved admission labels, exact image identity and authenticated secret/data destinations. Intent assists discovery and cleanup but never proves ownership by itself.

Container inspection follows Docker 28 semantics:

- effective labels come from `Config.Labels`; exactly the three reserved `com.auto-world.postgres-admission-*` values must match, while unrelated inherited labels remain allowed;
- `HostConfig.NetworkMode` must be `none`;
- `HostConfig.Mounts` separately proves the fixed bind and volume declarations, read-only settings and `VolumeOptions.NoCopy === true`;
- full effective mounts are matched by their unique destinations rather than array order, with exact type, source, name, destination, driver, read/write, mode and propagation semantics;
- the data-volume source must equal the independently derived and authenticated volume `Mountpoint`; extra, duplicate, missing or mutated destinations fail closed.

Normalize only the omitted zero fields specified by the [pinned Docker inspection type](https://raw.githubusercontent.com/moby/moby/6430e49a55babd9b8f4d08e70ecb2b68900770fe/api/types/container/container.go) and [mount type](https://raw.githubusercontent.com/moby/moby/6430e49a55babd9b8f4d08e70ecb2b68900770fe/api/types/mount/mount.go): effective bind `Name` and `Driver` may be omitted or empty, and host-config volume `ReadOnly` may be omitted or false. Explicit null, wrong types or nonzero values are rejected. `Mode` and `Propagation` still require their exact known values.

The expected local-volume lifecycle follows the pinned Moby 28.0.4 sources at build commit `6430e49`: a protected placeholder exists before start and the mounted PostgreSQL identity is required after start. After authenticated stop, either the same mounted alias or the recorded placeholder is permitted; the recorded placeholder is mandatory after removal and proven container absence. Any unexplained state, symlink, writable ancestor, ownership drift or mount substitution fails closed.

Cleanup never trusts intent, a returned ID or a name alone. If create output is invalid or nonzero after a possible effect, the broker performs bounded same-daemon discovery. It may remove a candidate only after exact name, nonce, reserved labels, image, network and mount identity authenticate ownership. Ambiguity or foreign identity yields `CLEANUP_UNCERTAIN`, preserves the resource and forbids deletion.

The exact image config declares a PGDATA volume. Identity probes override that destination with a fixed read-only `tmpfs`, avoiding anonymous persistent-volume creation and automatic deletion. Cleanup authenticates the exact `HostConfig.Tmpfs` destination/options, empty effective mounts and zero alternate mount origins, in addition to the fixed probe image, labels, command, network and security settings. The [pinned Moby volume-creation path](https://raw.githubusercontent.com/moby/moby/6430e49a55babd9b8f4d08e70ecb2b68900770fe/daemon/create_unix.go) skips an image volume when a configured tmpfs already covers its destination.

The 30-second monotonic cleanup window applies to broker-owned Docker CLI commands. Daemon-helper shutdown has its own authenticated bounds; the reviewed outer controller establishes the overall process and EOF closure. A kill signal alone never proves closure. A bounded post-kill grace ends in `CLEANUP_UNCERTAIN` if closure remains unestablished, retains ownership of the child, blocks later Docker commands and preserves uncertain temporary resources. A late close cannot turn a failed session into success.

## Pending verification and handoff

The implementation and realistic Docker 28 fixtures are still being integrated. No broker hash, generation root, inventory revision, test count or passing gate is recorded here until the corresponding bytes and results are frozen and independently reviewed.

Before PR143 can claim a reviewed source candidate, affected tests and repository quality gates must pass and architecture/security reviews must accept the exact broker and fixture bytes. Root must separately construct and review the generation 4 inventory and prove the complete proposed pinned tree with the genuine Node 22 file-URL loader, including missing and altered resource rejection.

Native installation and activation remain later operations. They require a distinct locator and immutable recipe, fresh current P2/P3, generation-bound FULL then FAST archive health, protected-main delivery, and explicit review of coexistence with generation 3 preservation and its current scheduler duty. No new supported session, migration, backup, restore, service runtime, admission or four-service acceptance is claimed by PR143.

## Rollback

Abandoning this PENDING preparation before generation 4 activation or high-water advancement leaves generation 3 and its retained failed SQL evidence unchanged. After generation 4 activation or high-water advancement, never restore generation 3 as current: preserve history, append `REVOKED` where applicable and advance using a greater generation. Do not copy the repaired broker into generation 3, remove the residual forensic evidence, reuse generation 3 data or change the scheduler as part of this source preparation. Preserve the source branch and any failed verification output for review.
