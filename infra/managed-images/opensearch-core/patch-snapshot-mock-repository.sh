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
    private final boolean skipExceptionOnSnapshotShardPathsListBlobs;\
\
    private final boolean skipExceptionOnSnapshotShardPathsWrite;' \
  -e '/^        skipExceptionOnListBlobs = metadata\.settings()\.getAsBoolean("skip_exception_on_list_blobs", false);$/a\
        skipExceptionOnSnapshotShardPathsListBlobs = metadata.settings()\
            .getAsBoolean("skip_exception_on_snapshot_shard_paths_list_blobs", false);\
        skipExceptionOnSnapshotShardPathsWrite = metadata.settings()\
            .getAsBoolean("skip_exception_on_snapshot_shard_paths_write", false);' \
  -e '/^                maybeIOExceptionOrBlock(DUMMY_FILE_NAME_LIST_BLOBS);$/c\
                if (skipExceptionOnSnapshotShardPathsListBlobs == false\
                    || path().equals(basePath().add(SnapshotShardPaths.DIR)) == false) {\
                    maybeIOExceptionOrBlock(DUMMY_FILE_NAME_LIST_BLOBS);\
                }' \
  -e '/^            public void writeBlob(String blobName, InputStream inputStream, long blobSize, boolean failIfAlreadyExists) throws IOException {$/,/^            }$/c\
            public void writeBlob(String blobName, InputStream inputStream, long blobSize, boolean failIfAlreadyExists) throws IOException {\
                final boolean skipSnapshotShardPathsWriteException = skipExceptionOnSnapshotShardPathsWrite\
                    && path().equals(basePath().add(SnapshotShardPaths.DIR))\
                    && blobName.startsWith("snapshot_path_")\
                    && blobName.length() > "snapshot_path_".length();\
                if (skipSnapshotShardPathsWriteException == false) {\
                    maybeIOExceptionOrBlock(blobName);\
                }\
                if (blockOnWriteShardLevelMeta\
                    && blobName.startsWith(BlobStoreRepository.SNAPSHOT_PREFIX)\
                    && path().equals(basePath()) == false) {\
                    blockExecutionAndMaybeWait(blobName);\
                }\
                super.writeBlob(blobName, inputStream, blobSize, failIfAlreadyExists);\
                final boolean failAfterWrite = RandomizedContext.current().getRandom().nextBoolean();\
                if (failAfterWrite && skipSnapshotShardPathsWriteException == false) {\
                    // for network based repositories, the blob may have been written but we may still\
                    // get an error with the client connection, so an IOException here simulates this\
                    maybeIOExceptionOrBlock(blobName);\
                }\
            }' \
  "$target"
printf '%s  %s\n' \
  0ca89767bccae4080fb62302ba927f0a076e9a50c5ebf49e5984efe26396938b \
  "$target" | sha256sum --check --strict
