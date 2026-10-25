#!/bin/bash
set -euo pipefail

cd /workspace/source
mkdir -p /evidence/junit /evidence/licenses
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

gradle_options=(--no-daemon --no-build-cache --max-workers=2
  '-Dorg.gradle.jvmargs=-Xms256m -Xmx1536m -XX:MaxMetaspaceSize=512m'
  -Dtests.jvms=1 -Dtests.heap.size=512m -Dbuild.snapshot=false)

# Captured nonzero statuses remain exportable by target evidence. Target
# runtime explicitly rejects them; an incomplete build never becomes an image.
preparation_status=0
bash ./gradlew "${gradle_options[@]}" \
  :libs:x-content:updateShas :modules:ingest-geoip:updateShas \
  > /evidence/update-shas.log 2>&1 || preparation_status=$?
printf '%s\n' "$preparation_status" > /evidence/preparation.exit-code
build_status=$preparation_status
if [ "$preparation_status" -eq 0 ]; then
  build_status=0
  bash ./gradlew "${gradle_options[@]}" --continue \
    :libs:x-content:dependencyLicenses :libs:x-content:thirdPartyAudit \
    :modules:ingest-geoip:dependencyLicenses :modules:ingest-geoip:thirdPartyAudit \
    :libs:x-content:test :modules:ingest-geoip:test \
    :modules:ingest-geoip:yamlRestTest \
    :rest-api-spec:yamlRestTest \
    :server:internalClusterTest \
      --tests org.opensearch.recovery.SimpleRecoveryIT \
      --tests org.opensearch.snapshots.RestoreSnapshotIT \
      --tests org.opensearch.snapshots.SharedClusterSnapshotRestoreIT \
    :distribution:archives:buildNoJdkLinux \
    :distribution:archives:no-jdk-linux-tar:assemble \
    > /evidence/core-build-and-tests.log 2>&1 || build_status=$?
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
if [ ! -d /workspace/source/distribution/archives/no-jdk-linux-tar/build/install/opensearch-3.9.0 ]; then
  printf '%s\n' 'Required exploded core distribution is absent' >> /evidence/core-build-and-tests.log
  build_status=1
fi
printf '%s\n' "$build_status" > /evidence/build.exit-code
printf 'OpenSearch diagnostic preparation=%s build=%s\n' "$preparation_status" "$build_status"
