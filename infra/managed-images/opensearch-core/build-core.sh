#!/bin/bash
set -euo pipefail

cd /workspace/source
mkdir -p /evidence/junit /evidence/licenses /evidence/controls/unfixed /evidence/controls/seeded-fixed
printf '%s\n' 'DIAGNOSTIC_ONLY_NOT_ADMITTED' > /evidence/state.txt
test "$(cat .git/HEAD)" = 4ee42a94e87f66fbf1e62a9871b1b87f91e02472
cp .git/HEAD /evidence/source-commit.txt
test "$(id -u)" = 1000
test "$RUNTIME_JAVA_HOME" = /opt/java/openjdk
java --version > /evidence/builder-java-version.txt 2>&1

# Authenticate the executable wrapper before invoking it. Gradle itself checks
# the separately pinned distribution checksum in the upstream properties.
test "$(wc -c < gradle/wrapper/gradle-wrapper.jar)" -eq 47505
printf '%s  %s\n' \
  7a9ce74cff467ca1bf60a4fcd9f05185acceda4d0f382434d393e17864262c5d \
  gradle/wrapper/gradle-wrapper.jar | sha256sum --check --strict
grep -Fx 'distributionSha256Sum=92c1a136d76b5017732a66d2e0a648ebff00dd3687d8bff0d0047a1bd904fdf2' gradle/wrapper/gradle-wrapper.properties
grep -Fx 'distributionUrl=https\://services.gradle.org/distributions/gradle-9.7.1-all.zip' gradle/wrapper/gradle-wrapper.properties
cp gradle/wrapper/gradle-wrapper.properties /evidence/
sha256sum gradle/wrapper/gradle-wrapper.jar > /evidence/wrapper-jar.sha256
bash /recipe/patch-catalogue.sh "$PWD" > /evidence/catalogue-preparation.txt 2>&1
cp gradle/libs.versions.toml /evidence/libs.versions.toml
cp /recipe/jackson.patch /evidence/
bash /recipe/patch-snapshot-scope-test.sh "$PWD" > /evidence/snapshot-scope-test-preparation.txt 2>&1
cp /recipe/patch-snapshot-scope-test.sh /evidence/patch-snapshot-scope-test.sh.txt
cp /recipe/patch-snapshot-mock-repository.sh /evidence/patch-snapshot-mock-repository.sh.txt
cp /recipe/snapshot-scope-test.patch /recipe/snapshot-scope-mock-repository.patch /evidence/
sha256sum \
  server/src/internalClusterTest/java/org/opensearch/snapshots/SharedClusterSnapshotRestoreIT.java \
  test/framework/src/main/java/org/opensearch/snapshots/mockstore/MockRepository.java \
  > /evidence/snapshot-scope-sources-before-mock.sha256

gradle_options=(--no-daemon --no-build-cache --max-workers=2
  '-Dorg.gradle.jvmargs=-Xms256m -Xmx1536m -XX:MaxMetaspaceSize=512m'
  -Dtests.jvms=1 -Dtests.heap.size=512m -Dbuild.snapshot=false)

# Captured nonzero statuses remain exportable by target evidence. Target
# runtime explicitly rejects them; an incomplete build never becomes an image.
preparation_status=0
bash ./gradlew "${gradle_options[@]}" \
  :libs:opensearch-x-content:updateShas :modules:ingest-geoip:updateShas \
  > /evidence/update-shas.log 2>&1 || preparation_status=$?
printf '%s\n' "$preparation_status" > /evidence/preparation.exit-code
build_status=$preparation_status
if [ "$preparation_status" -eq 0 ]; then
  control_xml=server/build/test-results/internalClusterTest/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml
  control_options=(
    -Dtests.seed=730D258067002B91
    -Dtests.security.manager=true
    -Dtests.jvms=1
    -Dtests.heap.size=512m
    '-Dtests.jvm.argline=-XX:TieredStopAtLevel=1 -XX:ReservedCodeCacheSize=64m'
    -Dtests.locale=fr-LU
    -Dtests.timezone=America/Moncton
    -Druntime.java=25
  )

  rm -f "$control_xml"
  unfixed_status=0
  bash ./gradlew "${gradle_options[@]}" "${control_options[@]}" \
    :server:internalClusterTest --rerun \
    --tests org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.testSnapshotShardPathsListBlobsFaultScope \
    > /evidence/controls/unfixed/gradle.log 2>&1 || unfixed_status=$?
  printf '%s\n' "$unfixed_status" > /evidence/controls/unfixed/gradle.exit-code
  if [ -f "$control_xml" ]; then cp "$control_xml" /evidence/controls/unfixed/; fi

  unfixed_control_ok=0
  if [ "$unfixed_status" -ne 0 ] \
    && [ -f /evidence/controls/unfixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml ] \
    && grep -Fq 'tests="1"' /evidence/controls/unfixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml \
    && grep -Fq 'skipped="0"' /evidence/controls/unfixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml \
    && grep -Fq 'failures="1"' /evidence/controls/unfixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml \
    && grep -Fq 'errors="0"' /evidence/controls/unfixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml \
    && grep -Fq 'name="testSnapshotShardPathsListBlobsFaultScope"' /evidence/controls/unfixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml \
    && [ "$(grep -Fo '<failure ' /evidence/controls/unfixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml | wc -l)" -eq 1 ] \
    && grep -Fq '<failure message="java.lang.AssertionError: SNAPSHOT_SHARD_PATHS_LIST_BLOBS_SCOPE_CONTROL_UNFIXED failure-count-delta=1" type="java.lang.AssertionError">' /evidence/controls/unfixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml \
    && ! grep -Fq 'SNAPSHOT_SHARD_PATHS_LIST_BLOBS_SCOPE_CONTROL_UNEXPECTED_CAUSE' /evidence/controls/unfixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml \
    && ! grep -Fq 'index.latest' /evidence/controls/unfixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml \
    && grep -Fq 'Random IOException' /evidence/controls/unfixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml \
    && ! grep -Eq ':server:internalClusterTest (UP-TO-DATE|FROM-CACHE|SKIPPED|NO-SOURCE)' /evidence/controls/unfixed/gradle.log; then
    unfixed_control_ok=1
  fi
  printf '%s\n' "$unfixed_control_ok" > /evidence/controls/unfixed/expected-failure-verified.status

  if [ "$unfixed_control_ok" -eq 1 ]; then
    bash /recipe/patch-snapshot-mock-repository.sh "$PWD" > /evidence/snapshot-scope-mock-preparation.txt 2>&1
    sha256sum \
      server/src/internalClusterTest/java/org/opensearch/snapshots/SharedClusterSnapshotRestoreIT.java \
      test/framework/src/main/java/org/opensearch/snapshots/mockstore/MockRepository.java \
      > /evidence/snapshot-scope-sources-fixed.sha256

    rm -f "$control_xml"
    fixed_status=0
    bash ./gradlew "${gradle_options[@]}" "${control_options[@]}" \
      :server:internalClusterTest --rerun \
      --tests org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.testSnapshotShardPathsListBlobsFaultScope \
      --tests org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.testSnapshotFileFailureDuringSnapshot \
      > /evidence/controls/seeded-fixed/gradle.log 2>&1 || fixed_status=$?
    printf '%s\n' "$fixed_status" > /evidence/controls/seeded-fixed/gradle.exit-code
    if [ -f "$control_xml" ]; then cp "$control_xml" /evidence/controls/seeded-fixed/; fi

    fixed_control_ok=0
    if [ "$fixed_status" -eq 0 ] \
      && [ -f /evidence/controls/seeded-fixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml ] \
      && grep -Fq 'tests="2"' /evidence/controls/seeded-fixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml \
      && grep -Fq 'skipped="0"' /evidence/controls/seeded-fixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml \
      && grep -Fq 'failures="0"' /evidence/controls/seeded-fixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml \
      && grep -Fq 'errors="0"' /evidence/controls/seeded-fixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml \
      && grep -Fq 'name="testSnapshotShardPathsListBlobsFaultScope"' /evidence/controls/seeded-fixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml \
      && grep -Fq 'name="testSnapshotFileFailureDuringSnapshot"' /evidence/controls/seeded-fixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml \
      && ! grep -Eq ':server:internalClusterTest (UP-TO-DATE|FROM-CACHE|SKIPPED|NO-SOURCE)' /evidence/controls/seeded-fixed/gradle.log; then
      fixed_control_ok=1
    fi
    printf '%s\n' "$fixed_control_ok" > /evidence/controls/seeded-fixed/success-verified.status
  else
    fixed_control_ok=0
    printf '%s\n' 'NOT_RUN_UNFIXED_CONTROL_INVALID' > /evidence/controls/seeded-fixed/gradle.exit-code
    printf '%s\n' "$fixed_control_ok" > /evidence/controls/seeded-fixed/success-verified.status
  fi

  rm -rf server/build/test-results/internalClusterTest
  if [ "$fixed_control_ok" -eq 1 ]; then
    build_status=0
    bash ./gradlew "${gradle_options[@]}" --continue \
      :libs:opensearch-x-content:dependencyLicenses :libs:opensearch-x-content:thirdPartyAudit \
      :modules:ingest-geoip:dependencyLicenses :modules:ingest-geoip:thirdPartyAudit \
      :libs:opensearch-x-content:test :modules:ingest-geoip:test \
      :modules:ingest-geoip:yamlRestTest \
      :rest-api-spec:yamlRestTest \
      :server:internalClusterTest --rerun \
        --tests org.opensearch.recovery.SimpleRecoveryIT \
        --tests org.opensearch.snapshots.RestoreSnapshotIT \
        --tests org.opensearch.snapshots.SharedClusterSnapshotRestoreIT \
    :distribution:archives:buildNoJdkLinux \
      :distribution:archives:no-jdk-linux-tar:assemble \
      > /evidence/core-build-and-tests.log 2>&1 || build_status=$?
  else
    build_status=1
  fi
fi

for group in libs/x-content modules/ingest-geoip; do
  cp -a "$group/licenses" "/evidence/licenses/$(basename "$group")"
done
for result in \
  libs/x-content/build/test-results/test \
  modules/ingest-geoip/build/test-results/test \
  modules/ingest-geoip/build/test-results/yamlRestTest \
  rest-api-spec/build/test-results/yamlRestTest \
  server/build/test-results/internalClusterTest; do
  report_count=0
  if [ -d "$result" ]; then
    report_count=$(find "$result" -maxdepth 1 -type f -name 'TEST-*.xml' | wc -l)
    find "$result" -maxdepth 1 -type f -name 'TEST-*.xml' \
      -exec cp --parents '{}' /evidence/junit/ ';'
  fi
  printf '%s reports=%s\n' "$result" "$report_count" >> /evidence/junit-groups.txt
  if [ "$report_count" -eq 0 ]; then build_status=1; fi
done
find /evidence/junit -type f -name 'TEST-*.xml' \
  -exec grep -H '<testsuite ' '{}' + > /evidence/junit-counts.txt || build_status=1
full_report_count=$(find /evidence/junit -type f -name 'TEST-*.xml' | wc -l)
full_test_count=$({ find /evidence/junit -type f -name 'TEST-*.xml' -exec grep -ho 'tests="[0-9]*"' '{}' + 2>/dev/null || true; } \
  | cut -d '"' -f 2 | awk '{ total += $1 } END { print total + 0 }')
full_failure_count=$({ find /evidence/junit -type f -name 'TEST-*.xml' -exec grep -ho 'failures="[0-9]*"' '{}' + 2>/dev/null || true; } \
  | cut -d '"' -f 2 | awk '{ total += $1 } END { print total + 0 }')
full_error_count=$({ find /evidence/junit -type f -name 'TEST-*.xml' -exec grep -ho 'errors="[0-9]*"' '{}' + 2>/dev/null || true; } \
  | cut -d '"' -f 2 | awk '{ total += $1 } END { print total + 0 }')
full_skipped_count=$({ find /evidence/junit -type f -name 'TEST-*.xml' -exec grep -ho 'skipped="[0-9]*"' '{}' + 2>/dev/null || true; } \
  | cut -d '"' -f 2 | awk '{ total += $1 } END { print total + 0 }')
full_pass_count=$((full_test_count - full_failure_count - full_error_count - full_skipped_count))
printf 'reports=%s tests=%s passes=%s failures=%s errors=%s skipped=%s\n' \
  "$full_report_count" "$full_test_count" "$full_pass_count" "$full_failure_count" "$full_error_count" "$full_skipped_count" \
  > /evidence/full-suite-counts.txt
find /evidence/junit -type f -name 'TEST-*.xml' \
  -exec grep -H -B 1 -A 1 '<skipped' '{}' + > /evidence/full-suite-skips.txt || true
{
  find /evidence/junit -type f -name 'TEST-*.xml' \
    -exec grep -H -E 'AssumptionViolatedException|got: <.*>, expected:' '{}' +
  grep -H -E 'AssumptionViolatedException|got: <.*>, expected:' /evidence/core-build-and-tests.log
} > /evidence/full-suite-skip-reasons.txt 2>/dev/null || true
full_scope_xml=/evidence/junit/server/build/test-results/internalClusterTest/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml
# Source run 40238739604 retained 47 skips; main run 40240788182 retained 48
# because XContentParserTests.testWriteDepthOffLimit drew YAML and raised its
# explicit assumption. This conservative ceiling accepts both observed runs but
# does not approve any new skip identity or reason; those remain review inputs.
if [ "$full_report_count" -ne 16 ] || [ "$full_test_count" -lt 1735 ] \
  || [ "$full_failure_count" -ne 0 ] || [ "$full_error_count" -ne 0 ] \
  || [ "$full_skipped_count" -gt 48 ] || [ "$full_pass_count" -lt 1687 ] \
  || [ ! -f "$full_scope_xml" ] \
  || ! grep -Eq '<testcase name="testSnapshotShardPathsListBlobsFaultScope" classname="org\.opensearch\.snapshots\.SharedClusterSnapshotRestoreIT" time="[0-9.]+"/>' "$full_scope_xml"; then
  build_status=1
fi
if grep -Eq ':server:internalClusterTest (UP-TO-DATE|FROM-CACHE|SKIPPED|NO-SOURCE)' /evidence/core-build-and-tests.log; then
  build_status=1
fi
if [ ! -d /workspace/source/distribution/archives/no-jdk-linux-tar/build/install/opensearch-3.9.0 ]; then
  printf '%s\n' 'Required exploded core distribution is absent' >> /evidence/core-build-and-tests.log
  build_status=1
fi
printf '%s\n' "$build_status" > /evidence/build.exit-code
printf 'OpenSearch diagnostic preparation=%s build=%s\n' "$preparation_status" "$build_status"
