#!/bin/bash
set -euo pipefail

test "$#" -eq 1
source_root=$1
target=test/framework/src/main/java/org/opensearch/snapshots/mockstore/MockRepository.java
cd "$source_root"
printf '%s  %s\n' \
  0d768d21a752111f940cccf096552c81b14ff38f3556e8f68b3156b16aa18029 \
  "$target" | sha256sum --check --strict
sed -i \
  -e '/^import org\.opensearch\.repositories\.fs\.FsRepository;$/a import org.opensearch.snapshots.SnapshotShardPaths;' \
  -e '/^    private final boolean skipExceptionOnListBlobs;$/a\
\
    private final boolean skipExceptionOnSnapshotShardPathsListBlobs;' \
  -e '/^        skipExceptionOnListBlobs = metadata\.settings()\.getAsBoolean("skip_exception_on_list_blobs", false);$/a\
        skipExceptionOnSnapshotShardPathsListBlobs = metadata.settings()\
            .getAsBoolean("skip_exception_on_snapshot_shard_paths_list_blobs", false);' \
  -e '/^                maybeIOExceptionOrBlock(DUMMY_FILE_NAME_LIST_BLOBS);$/c\
                if (skipExceptionOnSnapshotShardPathsListBlobs == false\
                    || path().equals(basePath().add(SnapshotShardPaths.DIR)) == false) {\
                    maybeIOExceptionOrBlock(DUMMY_FILE_NAME_LIST_BLOBS);\
                }' \
  "$target"
printf '%s  %s\n' \
  99cf760087f5045aaec4996a2cacb1f845964217e6dfa67759c379dbe7c0c2bb \
  "$target" | sha256sum --check --strict
