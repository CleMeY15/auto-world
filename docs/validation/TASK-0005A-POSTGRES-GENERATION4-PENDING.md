# TASK-0005A — PostgreSQL generation 4 PENDING preparation

Status: **SOURCE AND PENDING INVENTORY VERIFIED — DELIVERY GATES PENDING**. [PR143](https://github.com/CleMeY15/auto-world/pull/143) repairs the supported broker's Docker inspection, lifecycle and cleanup predicates and prepares a new generation 4 `PENDING` candidate. It does not install or activate generation 4, mutate Root state or Task Scheduler, execute Docker, retry SQL, reuse runtime data or establish any P7 result.

## Historical boundary

PostgreSQL generation 3 remains delivered with its historical `ACTIVE` revision. Its support interval from 2026-10-07 through 2027-10-07 and archive retention through 2028-10-06 remain unchanged. Its sole supported `SQL_CHECK` remains `NOT_ACCEPTED_NO_RETRY` with the retained `CONTAINER_CREATE / postgres_admission_container_invalid` failure evidence. PR143 does not relabel that session, patch the installed generation 3 recipe, change its locator, health or maintenance input, reuse its empty failed data directory, or alter its archive-health scheduler duty.

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

## Frozen candidate and verification

Generation 4 contains exactly 74 sorted unique execution pins. The broker is 82,810 bytes with SHA-256 `265b21afb5c8affe044bb4aebe2932c9e524773eeddf8f7e3e9973c113c35161`; the other 73 pins are byte-for-byte identical to generation 3. Its canonical generation root is `e3ee73f6da32a258794a0dc21b6e4ef773b1294979b0450ba2f668d3d08c91e7` and revision one is `5cda8a56b4df41c8bdc615753f436ff8025ab857678cc104f2a6579e3f841ca9`. The public inventory is 23,883 bytes with SHA-256 `9d9ff38a8ebfcfa20cf71d1d0d9f7f7a8730900793b49a6e12ee28eeddcc4024`. Support, archive dates, current evidence and revocation reason remain null.

The distinct locator is 448,048 bytes with SHA-256 `1b390c716c705d7c15fd01a888bb97bb21a4cea84d7af866eca32eb679956ed7`. Changing only its generation back to three reproduces the exact original locator. No archive object was copied or modified. A tests-only fixture preserves all 28,241 original generation 3 inventory bytes with SHA-256 `f670627e0f20d3f5d8d4fb25522486831aa0582993d0c80fd350947c669baf05`, including both revision preimages, nanosecond audit timestamps and immutable support dates.

Fresh pinned Node 22 verification passes 38 session tests and 10 broker/inventory/closure tests. The closure gate launches four genuine file-URL imports from a tree containing only the 74 authenticated files, proves individual omission of each formerly missing resource fails, rejects changed execution pins and preserves the tree after loading. These imports call no authority or runtime operation.

Five tests-only VM wrappers now remove inherited `NODE_TEST_CONTEXT` before launching their inner tests, reject recursive-run suppression, require a nonzero TAP test count and require successful exit. The original wrapper falsely accepted a deliberately failing inner assertion; the corrected wrapper rejects it. All five corrected wrappers pass without ambient VM options, and their inner session suite runs all 38 cases. No production execution pin changes because of this test-runner correction.

All six repository gates pass in a fresh native Linux checkout as UID/GID 1000, with Node 22.23.2 and pnpm 10.15.0, at source `78ec5628d581520072ffed7f5d4c161465a8186e` / tree `f63015bbdf33c82df4fffbac33681c9eedaee23e`: 2,104 root tests, 2,062 passing, zero failing and 42 platform/fixture skips; 9 lint, 11 typecheck, 18 workspace test and 9 build tasks; secret scanning for 714 files; no known dependency vulnerabilities at the low threshold. The closed log is 604,862 bytes with SHA-256 `e093bf1efa052bcc2f1e22c76dd19153491c77f5150d27c60a7a8b74a6e17117`.

The enclosing quality scaffold returned one after the successful gates because its own private evidence directory appeared as untracked. Separate closed read-only verification proves the exact source tree unchanged while excluding only that directory; the original result remains preserved. The adjudication receipt is 1,008 bytes with SHA-256 `3f12a8033da717df4841b1121a1569409cffe4ae9bc3f5ece848aa4de2159758`. The earlier Windows diagnostic's three failures require a nonroot POSIX identity and do not establish Linux acceptance. Neither result was overwritten or hidden.

Independent architecture and security reviews accept the exact broker, corrected wrappers and generation 4 inventory/closure. Final documentation review, exact-head CI, identical reviewed merge tree and protected-main CI remain delivery gates. TASK-0005A and TASK-0005 stay `IN_PROGRESS`; TASK-0006 stays blocked.

## Operational handoff

Native installation and activation remain later operations. They require a distinct locator and immutable recipe, fresh current P2/P3, generation-bound FULL then FAST archive health, protected-main delivery, and explicit review of coexistence with generation 3 preservation and its current scheduler duty. No new supported session, migration, backup, restore, service runtime, admission or four-service acceptance is claimed by PR143.

## Rollback

Abandoning this PENDING preparation before generation 4 activation or high-water advancement leaves generation 3 and its retained failed SQL evidence unchanged. After generation 4 activation or high-water advancement, never restore generation 3 as current: preserve history, append `REVOKED` where applicable and advance using a greater generation. Do not copy the repaired broker into generation 3, remove the residual forensic evidence, reuse generation 3 data or change the scheduler as part of this source preparation. Preserve the source branch and any failed verification output for review.
