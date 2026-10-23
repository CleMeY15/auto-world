# TASK-0005A — Private Docker context directory

Status: SOURCE_FIX_PLANNED / VALIDATION_PENDING. TASK-0005A and TASK-0005 remain IN_PROGRESS. This source increment does not establish image admission, archive validity, worker completion or daemon cleanup.

## Problem and intended behavior

The isolated daemon lease requires the ordinary client's context-store parent to be a directory owned by UID/GID 1000:1000 with mode 0700. Docker CLI 28.0.4 creates a missing context-store path using `os.MkdirAll(..., 0755)`, subject to umask. A context created during the worker can therefore leave a parent that the lease correctly rejects afterwards.

Precreate `client/contexts` in the lease's existing exclusive directory setup. That setup creates mode 0700, assigns UID/GID 1000:1000, checks directory identity and holds its descriptor. Docker's `MkdirAll` preserves an existing directory's permissions. The existing strict owner, mode, type, symlink and identity checks remain applicable throughout the lease.

The privacy guarantee concerns the context-store parent. Docker may create descendants with other modes; their modes are not claimed to be 0700.

## Implementation plan and validation

The focused change is limited to the daemon implementation, its tests and this document. Add the context parent to the same creation/guard loop as the client's existing private directories. No public lease fields, package versions, tool pins or admission rules change.

Before changing the implementation, reproduce the missing-parent failure through the real daemon module with simulated filesystem, process and CLI boundaries. Model Docker's `MkdirAll` behavior: create a missing parent with requested mode 0755 and preserve an existing parent's mode. Then verify that the precreated 0700 parent retains its owner and physical identity while the client creates context metadata.

Exercise the real lease's transition from EMPTY to BASE_AND_CANDIDATE with realistic image inspections, exact references and empty container/volume lists. Keep rejection coverage for changed permissions, wrong ownership, symlink substitution and missing image references. These tests simulate system boundaries; they do not execute Docker or a native image build.

Validation results, independent implementation review and exact final-head/main CI evidence will be recorded after implementation. Local passing tests alone do not establish delivery.

## Operations and rollback

Directory creation is exclusive and follows the existing fixed-parent ownership checks. An unexpected existing path fails closed. The increment does not repair or replay a consumed attempt.

Rollback reverts this focused source change. It does not remove retained archives, volumes, data or historical evidence. Another native generation requires its own current tool and execution approvals; the Node security refresh remains separate and precedes any future native attempt.

## Upstream references

- [Docker CLI 28.0.4 context-store creation](https://github.com/docker/cli/blob/b8034c0ed70494a90c133461d145cd072d920d7c/cli/context/store/metadatastore.go#L28-L42)
- [Go os.MkdirAll semantics](https://pkg.go.dev/os#MkdirAll)
