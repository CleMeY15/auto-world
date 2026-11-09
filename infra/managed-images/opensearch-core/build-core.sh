#!/bin/bash
set -euo pipefail

cd /workspace/source
mkdir -p /evidence/junit /evidence/licenses /evidence/controls/unfixed /evidence/controls/seeded-fixed /evidence/controls/xcontent-string-boundary /evidence/test-output /evidence/test-output-validation /evidence/junit-transport-grpc
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
cp /recipe/patch-transport-grpc-guava.sh /evidence/patch-transport-grpc-guava.sh.txt
cp /recipe/transport-grpc-guava.patch /evidence/
preparation_status=0
bash /recipe/patch-transport-grpc-guava.sh "$PWD" /evidence > /evidence/transport-grpc-guava-preparation.txt 2>&1 \
  || preparation_status=$?
transport_grpc_licenses=modules/transport-grpc/licenses
if [ "$preparation_status" -eq 0 ]; then
  test -d "$transport_grpc_licenses"
  test -f "$transport_grpc_licenses/guava-33.2.1-jre.jar.sha1"
  test -f "$transport_grpc_licenses/failureaccess-1.0.2.jar.sha1"
  find "$transport_grpc_licenses" -maxdepth 1 -type f -printf '%f\n' | sort > /evidence/transport-grpc-license-files.before.txt
  sed \
    -e 's/^guava-33\.2\.1-jre\.jar\.sha1$/guava-33.8.0-jre.jar.sha1/' \
    -e 's/^failureaccess-1\.0\.2\.jar\.sha1$/failureaccess-1.0.3.jar.sha1/' \
    /evidence/transport-grpc-license-files.before.txt > /evidence/transport-grpc-license-files.expected-after.txt
  find "$transport_grpc_licenses" -maxdepth 1 -type f \
    ! -name 'guava-33.2.1-jre.jar.sha1' ! -name 'failureaccess-1.0.2.jar.sha1' \
    -exec sha256sum '{}' + | sort -k 2 > /evidence/transport-grpc-unrelated-licenses.before.sha256
fi
bash /recipe/patch-snapshot-scope-test.sh "$PWD" > /evidence/snapshot-scope-test-preparation.txt 2>&1
cp /recipe/patch-snapshot-scope-test.sh /evidence/patch-snapshot-scope-test.sh.txt
cp /recipe/patch-snapshot-mock-repository.sh /evidence/patch-snapshot-mock-repository.sh.txt
cp /recipe/patch-xcontent-yaml-string-boundary.sh /evidence/patch-xcontent-yaml-string-boundary.sh.txt
cp /recipe/test-output-capture.gradle /evidence/test-output-capture.gradle.txt
cp /recipe/verify-test-output-capture.sh /evidence/verify-test-output-capture.sh.txt
cp /recipe/verify-test-output-manifest.gradle /evidence/verify-test-output-manifest.gradle.txt
cp /recipe/snapshot-scope-test.patch /recipe/snapshot-scope-mock-repository.patch /evidence/
bash /recipe/patch-xcontent-yaml-string-boundary.sh "$PWD" /evidence \
  > /evidence/xcontent-yaml-string-boundary-preparation.txt 2>&1
cp /recipe/xcontent-yaml-string-boundary.patch /evidence/
sha256sum \
  server/src/internalClusterTest/java/org/opensearch/snapshots/SharedClusterSnapshotRestoreIT.java \
  test/framework/src/main/java/org/opensearch/snapshots/mockstore/MockRepository.java \
  > /evidence/snapshot-scope-sources-before-mock.sha256

gradle_options=(--no-daemon --no-build-cache --max-workers=2
  '-Dorg.gradle.jvmargs=-Xms256m -Xmx1536m -XX:MaxMetaspaceSize=512m'
  -Dtests.jvms=1 -Dtests.heap.size=512m -Dbuild.snapshot=false)
capture_options=(--no-configuration-cache -I /recipe/test-output-capture.gradle)

owned_regular_file() {
  local file=$1
  [ -f "$file" ] && [ ! -L "$file" ] && [ "$(stat -c '%u' "$file")" -eq "$(id -u)" ]
}

sentinel_absent() {
  local file=$1
  local sentinel=$2
  local grep_status=0
  owned_regular_file "$file" || return 1
  grep -Fq "$sentinel" "$file" || grep_status=$?
  [ "$grep_status" -eq 1 ]
}

capture_complete() {
  local phase=$1
  local invocation_log=$2
  sentinel_absent "$invocation_log" 'AUTO_WORLD_TEST_OUTPUT_INTEGRITY_ERROR' || return 1
  local validation=/evidence/test-output-validation/$phase
  local validation_status=0
  mkdir -p "$validation"
  bash /workspace/source/gradlew --no-daemon --no-build-cache --no-configuration-cache --max-workers=1 \
    -p /workspace/test-output-capture-fixture/direct \
    -I /recipe/verify-test-output-manifest.gradle \
    "-Dauto.world.verify.test.output.phase=$phase" autoWorldVerifyTestOutputManifest \
    > "$validation/gradle.log" 2>&1 || validation_status=$?
  printf '%s\n' "$validation_status" > "$validation/gradle.exit-code"
  owned_regular_file "$validation/gradle.log" || return 1
  owned_regular_file "$validation/gradle.exit-code" || return 1
  test "$validation_status" -eq 0 || return 1
  sentinel_absent "$validation/gradle.log" 'AUTO_WORLD_TEST_OUTPUT_MANIFEST_INVALID' || return 1
}

# Captured nonzero statuses remain exportable by target evidence. Target
# runtime explicitly rejects them; an incomplete build never becomes an image.
if [ "$preparation_status" -eq 0 ]; then
  bash ./gradlew "${gradle_options[@]}" \
    :libs:opensearch-x-content:updateShas :modules:ingest-geoip:updateShas :modules:transport-grpc:updateShas \
    > /evidence/update-shas.log 2>&1 || preparation_status=$?
else
  printf '%s\n' 'NOT_RUN_GUAVA_PATCH_FAILED' > /evidence/update-shas.log
fi
if [ "$preparation_status" -eq 0 ]; then
  find "$transport_grpc_licenses" -maxdepth 1 -type f -printf '%f\n' | sort > /evidence/transport-grpc-license-files.after.txt
  find "$transport_grpc_licenses" -maxdepth 1 -type f \
    ! -name 'guava-33.8.0-jre.jar.sha1' ! -name 'failureaccess-1.0.3.jar.sha1' \
    -exec sha256sum '{}' + | sort -k 2 > /evidence/transport-grpc-unrelated-licenses.after.sha256
  if ! cmp -s /evidence/transport-grpc-license-files.expected-after.txt /evidence/transport-grpc-license-files.after.txt \
    || ! cmp -s /evidence/transport-grpc-unrelated-licenses.before.sha256 /evidence/transport-grpc-unrelated-licenses.after.sha256 \
    || [ "$(cat "$transport_grpc_licenses/guava-33.8.0-jre.jar.sha1")" != bb3b79346325315062192205fa6636dd5873151f ] \
    || [ "$(cat "$transport_grpc_licenses/failureaccess-1.0.3.jar.sha1")" != aeaffd00d57023a2c947393ed251f0354f0985fc ] \
    || [ -e "$transport_grpc_licenses/guava-33.2.1-jre.jar.sha1" ] \
    || [ -e "$transport_grpc_licenses/failureaccess-1.0.2.jar.sha1" ]; then
    preparation_status=1
  fi
fi
printf '%s\n' "$preparation_status" > /evidence/preparation.exit-code
build_status=$preparation_status
fixture_status=1
fixture_ok=0
if [ "$preparation_status" -eq 0 ]; then
  fixture_status=0
  bash /recipe/verify-test-output-capture.sh \
    > /evidence/test-output-fixture.log 2>&1 || fixture_status=$?
  printf '%s\n' "$fixture_status" > /evidence/test-output-fixture.exit-code
  if [ "$fixture_status" -eq 0 ] \
    && owned_regular_file /evidence/test-output-fixture.log \
    && owned_regular_file /evidence/test-output-fixture.exit-code \
    && sentinel_absent /evidence/test-output-fixture.log 'AUTO_WORLD_TEST_OUTPUT_INTEGRITY_ERROR' \
    && [ -f /evidence/test-output-fixture/summary.txt ] \
    && owned_regular_file /evidence/test-output-fixture/summary.txt \
    && grep -Fxq 'direct=passed' /evidence/test-output-fixture/summary.txt \
    && grep -Fxq 'manifest-validator=passed negatives=malformed,hash,bytes,totals,aggregate-events,aggregate-bytes,path,missing,extra,file-count,symlink' /evidence/test-output-fixture/summary.txt \
    && grep -Fxq 'successful-test-task=passed capture=complete' /evidence/test-output-fixture/summary.txt \
    && grep -Fxq 'failing-test-task=expected-failure capture=complete' /evidence/test-output-fixture/summary.txt; then
    fixture_ok=1
  else
    build_status=1
  fi
else
  printf '%s\n' 'NOT_RUN_PREPARATION_FAILED' > /evidence/test-output-fixture.exit-code
  printf '%s\n' 'AUTO_WORLD_TEST_OUTPUT_CAPTURE_FIXTURE_NOT_RUN' > /evidence/test-output-fixture.log
fi
if [ "$preparation_status" -eq 0 ] && [ "$fixture_ok" -eq 1 ]; then
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
  bash ./gradlew "${gradle_options[@]}" "${capture_options[@]}" "${control_options[@]}" \
    -Dauto.world.test.output.phase=unfixed \
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
    && capture_complete unfixed /evidence/controls/unfixed/gradle.log \
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
    bash ./gradlew "${gradle_options[@]}" "${capture_options[@]}" "${control_options[@]}" \
      -Dauto.world.test.output.phase=seeded-fixed \
      :server:internalClusterTest --rerun \
      --tests org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.testSnapshotShardPathsListBlobsFaultScope \
      --tests org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.testSnapshotShardPathsAuxiliaryWriteFaultScope \
      --tests org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.testSnapshotFileFailureDuringSnapshot \
      > /evidence/controls/seeded-fixed/gradle.log 2>&1 || fixed_status=$?
    printf '%s\n' "$fixed_status" > /evidence/controls/seeded-fixed/gradle.exit-code
    if [ -f "$control_xml" ]; then cp "$control_xml" /evidence/controls/seeded-fixed/; fi

    fixed_control_ok=0
    if [ "$fixed_status" -eq 0 ] \
      && [ -f /evidence/controls/seeded-fixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml ] \
      && grep -Fq 'tests="3"' /evidence/controls/seeded-fixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml \
      && grep -Fq 'skipped="0"' /evidence/controls/seeded-fixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml \
      && grep -Fq 'failures="0"' /evidence/controls/seeded-fixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml \
      && grep -Fq 'errors="0"' /evidence/controls/seeded-fixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml \
      && [ "$(grep -Fo '<testcase ' /evidence/controls/seeded-fixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml | wc -l)" -eq 3 ] \
      && [ "$(grep -Fo 'name="testSnapshotShardPathsListBlobsFaultScope"' /evidence/controls/seeded-fixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml | wc -l)" -eq 1 ] \
      && [ "$(grep -Fo 'name="testSnapshotShardPathsAuxiliaryWriteFaultScope"' /evidence/controls/seeded-fixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml | wc -l)" -eq 1 ] \
      && [ "$(grep -Fo 'name="testSnapshotFileFailureDuringSnapshot"' /evidence/controls/seeded-fixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml | wc -l)" -eq 1 ] \
      && grep -Eq '<testcase name="testSnapshotShardPathsListBlobsFaultScope" classname="org\.opensearch\.snapshots\.SharedClusterSnapshotRestoreIT" time="[0-9.]+"/>' /evidence/controls/seeded-fixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml \
      && grep -Eq '<testcase name="testSnapshotShardPathsAuxiliaryWriteFaultScope" classname="org\.opensearch\.snapshots\.SharedClusterSnapshotRestoreIT" time="[0-9.]+"/>' /evidence/controls/seeded-fixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml \
      && grep -Eq '<testcase name="testSnapshotFileFailureDuringSnapshot" classname="org\.opensearch\.snapshots\.SharedClusterSnapshotRestoreIT" time="[0-9.]+"/>' /evidence/controls/seeded-fixed/TEST-org.opensearch.snapshots.SharedClusterSnapshotRestoreIT.xml \
      && capture_complete seeded-fixed /evidence/controls/seeded-fixed/gradle.log \
      && ! grep -Eq ':server:internalClusterTest (UP-TO-DATE|FROM-CACHE|SKIPPED|NO-SOURCE)' /evidence/controls/seeded-fixed/gradle.log; then
      fixed_control_ok=1
    fi
    printf '%s\n' "$fixed_control_ok" > /evidence/controls/seeded-fixed/success-verified.status
  else
    fixed_control_ok=0
    printf '%s\n' 'NOT_RUN_UNFIXED_CONTROL_INVALID' > /evidence/controls/seeded-fixed/gradle.exit-code
    printf '%s\n' "$fixed_control_ok" > /evidence/controls/seeded-fixed/success-verified.status
  fi

  xcontent_control_xml=libs/x-content/build/test-results/test/TEST-org.opensearch.common.xcontent.XContentParserTests.xml
  rm -rf libs/x-content/build/test-results/test
  xcontent_control_status=0
  bash ./gradlew "${gradle_options[@]}" \
    -Dtests.seed=E4705740DC35C4BA \
    -Dtests.security.manager=true \
    '-Dtests.jvm.argline=-XX:TieredStopAtLevel=1 -XX:ReservedCodeCacheSize=64m' \
    -Dtests.locale=nl-AW \
    -Dtests.timezone=Antarctica/McMurdo \
    -Druntime.java=25 \
    :libs:opensearch-x-content:test --rerun \
    --tests org.opensearch.common.xcontent.XContentParserTests.testString \
    --tests org.opensearch.common.xcontent.XContentParserTests.testStringOffLimit \
    > /evidence/controls/xcontent-string-boundary/gradle.log 2>&1 || xcontent_control_status=$?
  printf '%s\n' "$xcontent_control_status" > /evidence/controls/xcontent-string-boundary/gradle.exit-code
  if [ -f "$xcontent_control_xml" ]; then
    cp "$xcontent_control_xml" /evidence/controls/xcontent-string-boundary/
  fi

  xcontent_control_ok=0
  xcontent_control_evidence=/evidence/controls/xcontent-string-boundary/TEST-org.opensearch.common.xcontent.XContentParserTests.xml
  if [ "$xcontent_control_status" -eq 0 ] \
    && owned_regular_file /evidence/controls/xcontent-string-boundary/gradle.log \
    && owned_regular_file /evidence/controls/xcontent-string-boundary/gradle.exit-code \
    && owned_regular_file "$xcontent_control_evidence" \
    && grep -Fq 'tests="2"' "$xcontent_control_evidence" \
    && grep -Fq 'skipped="0"' "$xcontent_control_evidence" \
    && grep -Fq 'failures="0"' "$xcontent_control_evidence" \
    && grep -Fq 'errors="0"' "$xcontent_control_evidence" \
    && [ "$(grep -Fo '<testcase ' "$xcontent_control_evidence" | wc -l)" -eq 2 ] \
    && [ "$(grep -Fo 'name="testString"' "$xcontent_control_evidence" | wc -l)" -eq 1 ] \
    && [ "$(grep -Fo 'name="testStringOffLimit"' "$xcontent_control_evidence" | wc -l)" -eq 1 ] \
    && grep -Eq '<testcase name="testString" classname="org\.opensearch\.common\.xcontent\.XContentParserTests" time="[0-9.]+"/>' "$xcontent_control_evidence" \
    && grep -Eq '<testcase name="testStringOffLimit" classname="org\.opensearch\.common\.xcontent\.XContentParserTests" time="[0-9.]+"/>' "$xcontent_control_evidence" \
    && ! grep -Eq ':libs:opensearch-x-content:test (UP-TO-DATE|FROM-CACHE|SKIPPED|NO-SOURCE)' /evidence/controls/xcontent-string-boundary/gradle.log; then
    xcontent_control_ok=1
  fi
  printf '%s\n' "$xcontent_control_ok" > /evidence/controls/xcontent-string-boundary/success-verified.status

  rm -rf server/build/test-results/internalClusterTest libs/x-content/build/test-results/test
  if [ "$fixed_control_ok" -eq 1 ] && [ "$xcontent_control_ok" -eq 1 ]; then
    build_status=0
    bash ./gradlew "${gradle_options[@]}" "${capture_options[@]}" \
      -Dauto.world.test.output.phase=full --continue \
      :libs:opensearch-x-content:dependencyLicenses :libs:opensearch-x-content:thirdPartyAudit \
      :modules:ingest-geoip:dependencyLicenses :modules:ingest-geoip:thirdPartyAudit \
      :modules:transport-grpc:dependencyLicenses :modules:transport-grpc:thirdPartyAudit :modules:transport-grpc:check \
      :libs:opensearch-x-content:test --rerun :modules:ingest-geoip:test \
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
cp -a modules/transport-grpc/licenses /evidence/licenses/transport-grpc
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
for transport_group in test internalClusterTest; do
  transport_result="modules/transport-grpc/build/test-results/$transport_group"
  transport_evidence="/evidence/junit-transport-grpc/$transport_group"
  mkdir -p "$transport_evidence"
  transport_report_count=0
  if [ -d "$transport_result" ]; then
    transport_report_count=$(find "$transport_result" -maxdepth 1 -type f -name 'TEST-*.xml' | wc -l)
    find "$transport_result" -maxdepth 1 -type f -name 'TEST-*.xml' \
      -exec cp '{}' "$transport_evidence/" ';'
  fi
  transport_test_count=$({ find "$transport_evidence" -type f -name 'TEST-*.xml' -exec grep -ho 'tests="[0-9]*"' '{}' + 2>/dev/null || true; } \
    | cut -d '"' -f 2 | awk '{ total += $1 } END { print total + 0 }')
  transport_failure_count=$({ find "$transport_evidence" -type f -name 'TEST-*.xml' -exec grep -ho 'failures="[0-9]*"' '{}' + 2>/dev/null || true; } \
    | cut -d '"' -f 2 | awk '{ total += $1 } END { print total + 0 }')
  transport_error_count=$({ find "$transport_evidence" -type f -name 'TEST-*.xml' -exec grep -ho 'errors="[0-9]*"' '{}' + 2>/dev/null || true; } \
    | cut -d '"' -f 2 | awk '{ total += $1 } END { print total + 0 }')
  transport_skipped_count=$({ find "$transport_evidence" -type f -name 'TEST-*.xml' -exec grep -ho 'skipped="[0-9]*"' '{}' + 2>/dev/null || true; } \
    | cut -d '"' -f 2 | awk '{ total += $1 } END { print total + 0 }')
  printf '%s reports=%s tests=%s failures=%s errors=%s skipped=%s\n' \
    "$transport_group" "$transport_report_count" "$transport_test_count" "$transport_failure_count" "$transport_error_count" "$transport_skipped_count" \
    >> /evidence/transport-grpc-junit-groups.txt
  find "$transport_evidence" -type f -name 'TEST-*.xml' \
    -exec grep -H -B 1 -A 1 '<skipped' '{}' + >> /evidence/transport-grpc-skips.txt || true
  find "$transport_evidence" -type f -name 'TEST-*.xml' \
    -exec grep -H -E 'AssumptionViolatedException|got: <.*>, expected:' '{}' + \
    >> /evidence/transport-grpc-skip-reasons.txt 2>/dev/null || true
  if [ "$transport_report_count" -eq 0 ] || [ "$transport_test_count" -eq 0 ] \
    || [ "$transport_failure_count" -ne 0 ] || [ "$transport_error_count" -ne 0 ] \
    || [ "$transport_skipped_count" -ne 0 ]; then
    build_status=1
  fi
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
if [ "$full_report_count" -ne 16 ] || [ "$full_test_count" -lt 1736 ] \
  || [ "$full_failure_count" -ne 0 ] || [ "$full_error_count" -ne 0 ] \
  || [ "$full_skipped_count" -gt 48 ] || [ "$full_pass_count" -lt 1688 ] \
  || [ ! -f "$full_scope_xml" ] \
  || ! grep -Eq '<testcase name="testSnapshotShardPathsListBlobsFaultScope" classname="org\.opensearch\.snapshots\.SharedClusterSnapshotRestoreIT" time="[0-9.]+"/>' "$full_scope_xml" \
  || ! grep -Eq '<testcase name="testSnapshotShardPathsAuxiliaryWriteFaultScope" classname="org\.opensearch\.snapshots\.SharedClusterSnapshotRestoreIT" time="[0-9.]+"/>' "$full_scope_xml"; then
  build_status=1
fi
if grep -Eq ':server:internalClusterTest (UP-TO-DATE|FROM-CACHE|SKIPPED|NO-SOURCE)' /evidence/core-build-and-tests.log; then
  build_status=1
fi
if grep -Eq ':libs:opensearch-x-content:test (UP-TO-DATE|FROM-CACHE|SKIPPED|NO-SOURCE)' /evidence/core-build-and-tests.log; then
  build_status=1
fi
if ! capture_complete full /evidence/core-build-and-tests.log; then
  build_status=1
fi
if [ ! -d /workspace/source/distribution/archives/no-jdk-linux-tar/build/install/opensearch-3.9.0 ]; then
  printf '%s\n' 'Required exploded core distribution is absent' >> /evidence/core-build-and-tests.log
  build_status=1
fi
distribution_module=/workspace/source/distribution/archives/no-jdk-linux-tar/build/install/opensearch-3.9.0/modules/transport-grpc
distribution_jar_status=1
if [ -d "$distribution_module" ]; then
  shopt -s nullglob
  guava_jars=("$distribution_module"/guava-*.jar)
  failureaccess_jars=("$distribution_module"/failureaccess-*.jar)
  if [ "${#guava_jars[@]}" -eq 1 ] \
    && [ "$(basename "${guava_jars[0]}")" = guava-33.8.0-jre.jar ] \
    && [ "${#failureaccess_jars[@]}" -eq 1 ] \
    && [ "$(basename "${failureaccess_jars[0]}")" = failureaccess-1.0.3.jar ] \
    && [ ! -e "$distribution_module/guava-33.2.1-jre.jar" ] \
    && [ ! -e "$distribution_module/failureaccess-1.0.2.jar" ] \
    && printf '%s  %s\n%s  %s\n' \
      97b79ec3f2c0a6313a0c2df51ce1abdf8907e6531803467b81efcaaf99b35161 "${guava_jars[0]}" \
      cbfc3906b19b8f55dd7cfd6dfe0aa4532e834250d7f080bd8d211a3e246b59cb "${failureaccess_jars[0]}" \
      | sha256sum --check --strict; then
    sha256sum "${guava_jars[0]}" "${failureaccess_jars[0]}" > /evidence/transport-grpc-distribution-jars.sha256
    distribution_jar_status=0
  fi
  shopt -u nullglob
fi
printf '%s\n' "$distribution_jar_status" > /evidence/transport-grpc-distribution-jars.status
if [ "$distribution_jar_status" -ne 0 ]; then build_status=1; fi
printf '%s\n' "$build_status" > /evidence/build.exit-code
printf 'OpenSearch diagnostic preparation=%s build=%s\n' "$preparation_status" "$build_status"
