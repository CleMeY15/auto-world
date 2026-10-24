# TASK-0005A — Private Docker context directory

Status: SOURCE_IMPLEMENTATION_REVIEWED / DELIVERY_PENDING. TASK-0005A and TASK-0005 remain IN_PROGRESS. This source increment does not establish image admission, archive validity, worker completion or daemon cleanup.

## Problem and intended behavior

The isolated daemon lease requires the ordinary client's context-store parent to be a directory owned by UID/GID 1000:1000 with mode 0700. Docker CLI 28.0.4 creates a missing context-store path using `os.MkdirAll(..., 0755)`, subject to umask. A context created during the worker can therefore leave a parent that the lease correctly rejects afterwards.

Precreate `client/contexts` in the lease's existing exclusive directory setup. That setup creates mode 0700, assigns UID/GID 1000:1000, checks directory identity and holds its descriptor. Docker's `MkdirAll` preserves an existing directory's permissions. The existing strict owner, mode, type, symlink and identity checks remain applicable throughout the lease.

The privacy guarantee concerns the context-store parent. Docker may create descendants with other modes; their modes are not claimed to be 0700.

## Implementation plan and validation

The focused change is limited to the daemon implementation, its tests and this document. Add the context parent to the same creation/guard loop as the client's existing private directories. No public lease fields, package versions, tool pins or admission rules change.

Before changing the implementation, reproduce the missing-parent failure through the real daemon module with simulated filesystem, process and CLI boundaries. Model Docker's `MkdirAll` behavior: create a missing parent with requested mode 0755 and preserve an existing parent's mode. Then verify that the precreated 0700 parent retains its owner and physical identity while the client creates context metadata.

Exercise the real lease's transition from EMPTY to BASE_AND_CANDIDATE with realistic image inspections, exact references and empty container/volume lists. Keep rejection coverage for changed permissions, wrong ownership, symlink substitution and missing image references. These tests simulate system boundaries; they do not execute Docker or a native image build.

The regression was observed before the production change: 16 tests, 15 passing and the MkdirAll scenario failing with the existing `files_changed` guard. With the focused directory precreation, the daemon suite passes 16/16 and the controller suite passes 90/90 under the pinned Node 22.23.2 VM test lane. Both syntax checks, targeted ESLint and whitespace checks pass.

The tests model the context parent's creation, image list/inspection responses and hostile filesystem changes. They do not execute the Docker CLI, a Linux daemon or archive validation. Independent implementation review approves the three-file source increment and confirms the RED, daemon/controller tests, syntax and targeted lint results.

Initial local quality snapshot on the accepted base preceding the shared dependency fix:

| Gate | Observed result |
| --- | --- |
| Lint and typecheck | Passed |
| Repository tests | Passed, including 28 workspace tasks |
| Build | Passed |
| Secret scan | Passed |
| Browser tests | First gate did not start because a fixed loopback port was occupied; after its owning session released the port, the unchanged suite passed 375 tests with 7 existing exclusions |
| Dependency audit | Initial certificate validation error; retry using system certificates with verification enabled found the existing transitive Zod HIGH advisory below |

The dependency finding is [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), affecting the existing ESLint React-hooks dependency's Zod 4.6.5. The exact shared 4.6.6 correction was delivered separately in [PR195](https://github.com/CleMeY15/auto-world/pull/195), together with the deterministic Seaweed test repair. Its [source CI](https://github.com/CleMeY15/auto-world/actions/runs/40035982395) and [merged-main CI](https://github.com/CleMeY15/auto-world/actions/runs/40037876520) both passed, with the reviewed source tree preserved at merge `c99c75eb8623cf28cdaef63e41bdb0f7e3d32447`. At that integration checkpoint, the focused permissions increment left the lockfile identical to that accepted base and did not waive the audit.

After that first accepted-base integration, the daemon and controller suites passed 106/106 again. Both syntax checks, focused lint and the dependency audit passed; the audit reported no known vulnerabilities at that observation. The daemon/test identities remained exactly those approved by the implementation review. The first integration matrix SHA256 is `467cd8b449aa175e9f267d2dd439a0670e9c153338440f6d106a981406f29a85`. The original failed gate attempts remain preserved. These checks exercised simulated daemon boundaries; no new Docker or Native operation was executed.

The subsequent [exact-head CI 40040103783](https://github.com/CleMeY15/auto-world/actions/runs/40040103783), at source `25638edee146bab815a2f48bd315cadb274a3188`, passed lint, types, root/workspace tests, build, 375 browser tests with seven existing exclusions and a secret scan of 1,061 files, but its final audit failed on eight fast-uri findings across two existing dependency lines. That genuine failure remains preserved; it is not replaced by the earlier passing audit.

The minimal fast-uri 3.1.9/4.2.3 correction was delivered separately in [PR196 and its final checkpoint](https://github.com/CleMeY15/auto-world/pull/196#issuecomment-6377700789). Its [source CI 40043409067](https://github.com/CleMeY15/auto-world/actions/runs/40043409067) and [merged-main CI 40044929913](https://github.com/CleMeY15/auto-world/actions/runs/40044929913) both passed on the identical reviewed tree; independent delivery review accepts merge `a21d72e2dd385e44dc7be19ae3ff2348a5929af2`. The current permissions increment leaves the lockfile identical to this accepted base. No dependency or audit-policy change is part of its focused delta.

After integrating that second accepted base, frozen offline installation, both syntax checks, all 106 daemon/controller VM tests, focused lint and a fresh dependency audit pass. The tests have zero failures or exclusions; the audit reports no known vulnerabilities. Source and test pins remain exactly those approved originally, and the new lock matches the accepted shared security fix. The new integration matrix SHA256 is `a3da357228ccfc1a6a2844881a19ee8b010216707a9c771275b8429e3ec3dfe1`, with stable subjects and original per-command logs. These are simulated-boundary source checks; no new Docker or Native operation was executed.

This is a pre-delivery snapshot. Remaining checks, exact final-head CI and protected merged-main CI must pass before acceptance; the final PR delivery checkpoint governs that acceptance. Local passing tests alone do not establish delivery.

## Operations and rollback

Directory creation is exclusive and follows the existing fixed-parent ownership checks. An unexpected existing path fails closed. The increment does not repair or replay a consumed attempt.

Rollback reverts this focused source change. It does not remove retained archives, volumes, data or historical evidence. Another native generation requires its own current tool and execution approvals; the Node security refresh remains separate and precedes any future native attempt.

## Upstream references

- [Docker CLI 28.0.4 context-store creation](https://github.com/docker/cli/blob/b8034c0ed70494a90c133461d145cd072d920d7c/cli/context/store/metadatastore.go#L28-L42)
- [Go os.MkdirAll semantics](https://pkg.go.dev/os#MkdirAll)
