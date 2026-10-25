#!/bin/bash
set -euo pipefail

test "$#" -eq 1
source_root=$1
target=server/src/internalClusterTest/java/org/opensearch/snapshots/SharedClusterSnapshotRestoreIT.java
cd "$source_root"
printf '%s  %s\n' \
  e6822f420d0ccb174911dc6631af5ab74ab193c52f88d702082038ee0ec638bd \
  "$target" | sha256sum --check --strict
method_fragment=$(mktemp)
trap 'rm -f "$method_fragment"' EXIT
cat > "$method_fragment" <<'JAVA'
    public void testSnapshotShardPathsListBlobsFaultScope() throws Exception {
        for (boolean skipSnapshotShardPathsListBlobs : List.of(false, true)) {
            final String repoName = "scope-control-" + skipSnapshotShardPathsListBlobs;
            final Settings.Builder repositorySettings = Settings.builder()
                .put("location", randomRepoPath())
                .put("random", "snapshot-scope-control");
            if (skipSnapshotShardPathsListBlobs) {
                repositorySettings.put("skip_exception_on_snapshot_shard_paths_list_blobs", true);
            }
            createRepository(
                repoName,
                "mock",
                repositorySettings
            );
            final MockRepository repository = (MockRepository) internalCluster().getCurrentClusterManagerNodeInstance(RepositoriesService.class)
                .repository(repoName);
            final BlobContainer snapshotShardPaths = repository.blobStore()
                .blobContainer(repository.basePath().add(SnapshotShardPaths.DIR));
            final BlobContainer nestedSnapshotShardPaths = repository.blobStore()
                .blobContainer(repository.basePath().add(SnapshotShardPaths.DIR).add("nested"));
            final BlobContainer root = repository.blobStore().blobContainer(repository.basePath());
            final BlobContainer other = repository.blobStore().blobContainer(repository.basePath().add("scope-control-other"));
            long expectedFailures = repository.getFailureCount();

            repository.setRandomControlIOExceptionRate(1.0);
            try {
                if (skipSnapshotShardPathsListBlobs) {
                    try {
                        snapshotShardPaths.listBlobs();
                    } catch (IOException exception) {
                        if ("Random IOException".equals(exception.getMessage()) == false
                            || repository.getFailureCount() != expectedFailures + 1) {
                            throw new AssertionError("SNAPSHOT_SHARD_PATHS_LIST_BLOBS_SCOPE_CONTROL_UNEXPECTED_CAUSE", exception);
                        }
                        throw new AssertionError(
                            "SNAPSHOT_SHARD_PATHS_LIST_BLOBS_SCOPE_CONTROL_UNFIXED failure-count-delta=1",
                            exception
                        );
                    }
                    assertThat(repository.getFailureCount(), equalTo(expectedFailures));
                } else {
                    final IOException exception = expectThrows(IOException.class, snapshotShardPaths::listBlobs);
                    assertThat(exception.getMessage(), containsString("Random IOException"));
                    assertThat(repository.getFailureCount(), equalTo(++expectedFailures));
                }

                IOException exception = expectThrows(IOException.class, () -> snapshotShardPaths.listBlobsByPrefix("scope-prefix"));
                assertThat(exception.getMessage(), containsString("Random IOException"));
                assertThat(repository.getFailureCount(), equalTo(++expectedFailures));

                exception = expectThrows(IOException.class, () -> snapshotShardPaths.readBlob("scope-read"));
                assertThat(exception.getMessage(), containsString("Random IOException"));
                assertThat(repository.getFailureCount(), equalTo(++expectedFailures));

                exception = expectThrows(
                    IOException.class,
                    () -> snapshotShardPaths.writeBlob("scope-write", new ByteArrayInputStream(new byte[] { 1 }), 1L, true)
                );
                assertThat(exception.getMessage(), containsString("Random IOException"));
                assertThat(repository.getFailureCount(), equalTo(++expectedFailures));

                exception = expectThrows(IOException.class, nestedSnapshotShardPaths::listBlobs);
                assertThat(exception.getMessage(), containsString("Random IOException"));
                assertThat(repository.getFailureCount(), equalTo(++expectedFailures));

                exception = expectThrows(IOException.class, root::listBlobs);
                assertThat(exception.getMessage(), containsString("Random IOException"));
                assertThat(repository.getFailureCount(), equalTo(++expectedFailures));

                exception = expectThrows(IOException.class, other::listBlobs);
                assertThat(exception.getMessage(), containsString("Random IOException"));
                assertThat(repository.getFailureCount(), equalTo(++expectedFailures));
            } finally {
                repository.setRandomControlIOExceptionRate(0.0);
            }
        }
    }

    public void testDataFileFailureDuringSnapshot() throws Exception {
JAVA

sed -i \
  -e '/^import org\.opensearch\.common\.action\.ActionFuture;$/a import org.opensearch.common.blobstore.BlobContainer;' \
  -e '/^import java\.nio\.channels\.SeekableByteChannel;$/i import java.io.ByteArrayInputStream;\
import java.io.IOException;' \
  -e '/^            \.put("random_control_io_exception_rate", 0\.2);$/c\
            .put("random_control_io_exception_rate", 0.2)\
            .put("skip_exception_on_snapshot_shard_paths_list_blobs", true);' \
  -e "/^    public void testDataFileFailureDuringSnapshot() throws Exception {/ {\
    r $method_fragment
    d
  }" \
  "$target"
printf '%s  %s\n' \
  69510fbc5d65f756f33cddd5fd9d20ae5b4983bfabfa64c06a861939da54efb5 \
  "$target" | sha256sum --check --strict
