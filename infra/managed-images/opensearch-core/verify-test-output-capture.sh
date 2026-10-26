#!/bin/bash
set -euo pipefail

source_root=/workspace/source
fixture_source=/recipe/test-output-capture-fixture
fixture_root=/workspace/test-output-capture-fixture
public_root=/evidence/test-output-fixture
init_source=/recipe/test-output-capture.gradle
fixture_tail="$fixture_source/fixture-tail.gradle"
manifest_verifier=/recipe/verify-test-output-manifest.gradle
sentinel=AUTO_WORLD_TEST_OUTPUT_INTEGRITY_ERROR
manifest_sentinel=AUTO_WORLD_TEST_OUTPUT_MANIFEST_INVALID

owned_regular_file() {
  local file=$1
  [ -f "$file" ] && [ ! -L "$file" ] && [ "$(stat -c '%u' "$file")" -eq "$(id -u)" ]
}

sentinel_absent() {
  local file=$1
  local value=$2
  local grep_status=0
  owned_regular_file "$file" || return 1
  grep -Fq "$value" "$file" || grep_status=$?
  [ "$grep_status" -eq 1 ]
}

sentinel_present() {
  local file=$1
  local value=$2
  owned_regular_file "$file" || return 1
  grep -Fq "$value" "$file"
}

path_absent() {
  local path=$1
  [ ! -e "$path" ] && [ ! -L "$path" ]
}

test -d "$source_root"
test -f "$source_root/gradlew"
test -f "$init_source"
test -f "$fixture_tail"
test -f "$manifest_verifier"
test ! -e "$fixture_root"
test ! -e "$public_root"
mkdir "$fixture_root" "$public_root"

prepare_fixture() {
  local mode=$1
  local destination="$fixture_root/$mode"
  test ! -e "$destination"
  mkdir "$destination"
  cp "$fixture_source/settings.gradle" "$fixture_source/build.gradle" "$destination/"
  cp -R "$fixture_source/server" "$destination/"
  cat "$init_source" "$fixture_tail" > "$destination/combined.init.gradle"
  printf '%s  %s\n' "$(sha256sum "$init_source" | cut -d ' ' -f 1)" "$init_source" \
    > "$destination/init-source.sha256"
  head -c "$(wc -c < "$init_source")" "$destination/combined.init.gradle" \
    | sha256sum | cut -d ' ' -f 1 \
    | grep -Fx "$(sha256sum "$init_source" | cut -d ' ' -f 1)"
}

prepare_fixture direct
direct_status=0
bash "$source_root/gradlew" --no-daemon --no-build-cache --no-configuration-cache --max-workers=1 \
  -p "$fixture_root/direct" -I "$fixture_root/direct/combined.init.gradle" \
  -Dauto.world.fixture.mode=direct autoWorldCaptureFixture \
  > "$fixture_root/direct/gradle.log" 2>&1 || direct_status=$?
printf '%s\n' "$direct_status" > "$fixture_root/direct/gradle.exit-code"
owned_regular_file "$fixture_root/direct/gradle.log"
owned_regular_file "$fixture_root/direct/gradle.exit-code"
test "$direct_status" -eq 0
owned_regular_file "$fixture_root/direct/build/direct-summary.txt"
grep -Fx 'AUTO_WORLD_TEST_OUTPUT_CAPTURE_FIXTURE_DIRECT_PASS' "$fixture_root/direct/build/direct-summary.txt"
sentinel_absent "$fixture_root/direct/gradle.log" "$sentinel"

manifest_capture=/evidence/test-output/full
manifest_golden="$fixture_root/direct/manifest-golden"
test ! -e "$manifest_capture"
cp -R "$fixture_root/direct/build/direct-cases/success" "$manifest_golden"

run_manifest_verifier() {
  local name=$1
  local expected=$2
  local status=0
  bash "$source_root/gradlew" --no-daemon --no-build-cache --no-configuration-cache --max-workers=1 \
    -p "$fixture_root/direct" -I "$manifest_verifier" \
    -Dauto.world.verify.test.output.phase=full autoWorldVerifyTestOutputManifest \
    > "$fixture_root/direct/manifest-$name.log" 2>&1 || status=$?
  if [ "$expected" = pass ]; then
    test "$status" -eq 0
    sentinel_absent "$fixture_root/direct/manifest-$name.log" "$manifest_sentinel"
  else
    test "$status" -ne 0
    sentinel_present "$fixture_root/direct/manifest-$name.log" "$manifest_sentinel"
  fi
}

reset_manifest_capture() {
  rm -rf "$manifest_capture"
  cp -R "$manifest_golden" "$manifest_capture"
}

reset_manifest_capture
run_manifest_verifier valid pass
printf '%s\n' '{' > "$manifest_capture/manifest.json"
run_manifest_verifier malformed fail
reset_manifest_capture
first_stream=
for candidate in "$manifest_capture"/descriptor-*.log; do first_stream=$candidate; break; done
test -n "$first_stream"
printf 'X' | dd of="$first_stream" bs=1 count=1 conv=notrunc status=none
run_manifest_verifier hash fail
reset_manifest_capture
sed -i '0,/"bytes":[0-9][0-9]*/s//"bytes":999999/' "$manifest_capture/manifest.json"
run_manifest_verifier bytes fail
reset_manifest_capture
sed -i 's/"captureErrors":0/"captureErrors":1/' "$manifest_capture/manifest.json"
run_manifest_verifier totals fail
reset_manifest_capture
sed -i 's/"events":[0-9][0-9]*/"events":1000000/g' "$manifest_capture/manifest.json"
run_manifest_verifier aggregate-events fail
reset_manifest_capture
aggregate_stream='{"descriptorId":0,"destination":"stdout","path":"unused.log","events":1,"bytes":4194304,"sha256":"0000000000000000000000000000000000000000000000000000000000000000"}'
aggregate_streams=$aggregate_stream
aggregate_index=1
while [ "$aggregate_index" -lt 17 ]; do
  aggregate_streams="$aggregate_streams,$aggregate_stream"
  aggregate_index=$((aggregate_index + 1))
done
awk -v replacement="$aggregate_streams" \
  '{ sub(/"streams":\[.*\],"totals":/, "\"streams\":[" replacement "],\"totals\":"); print }' \
  "$manifest_capture/manifest.json" > "$manifest_capture/manifest.json.tmp"
mv "$manifest_capture/manifest.json.tmp" "$manifest_capture/manifest.json"
run_manifest_verifier aggregate-bytes fail
reset_manifest_capture
sed -i '0,/"path":"[^"]*"/s//"path":"wrong.log"/' "$manifest_capture/manifest.json"
run_manifest_verifier path fail
reset_manifest_capture
first_stream=
for candidate in "$manifest_capture"/descriptor-*.log; do first_stream=$candidate; break; done
rm "$first_stream"
run_manifest_verifier missing fail
reset_manifest_capture
printf '%s\n' 'extra' > "$manifest_capture/extra.log"
run_manifest_verifier extra fail
reset_manifest_capture
extra_index=0
while [ "$extra_index" -lt 4096 ]; do
  : > "$manifest_capture/extra-$extra_index.log"
  extra_index=$((extra_index + 1))
done
run_manifest_verifier file-count fail
reset_manifest_capture
first_stream=
for candidate in "$manifest_capture"/descriptor-*.log; do first_stream=$candidate; break; done
stream_name=$(basename "$first_stream")
rm "$first_stream"
ln -s "$manifest_golden/$stream_name" "$first_stream"
run_manifest_verifier symlink fail
rm -rf "$manifest_capture"

prepare_fixture success
success_status=0
bash "$source_root/gradlew" --no-daemon --no-build-cache --no-configuration-cache --max-workers=1 \
  -p "$fixture_root/success" -I "$fixture_root/success/combined.init.gradle" \
  -Dauto.world.fixture.mode=success :server:internalClusterTest --rerun \
  > "$fixture_root/success/gradle.log" 2>&1 || success_status=$?
printf '%s\n' "$success_status" > "$fixture_root/success/gradle.exit-code"
owned_regular_file "$fixture_root/success/gradle.log"
owned_regular_file "$fixture_root/success/gradle.exit-code"
test "$success_status" -eq 0
owned_regular_file "$fixture_root/success/build/integration-success/manifest.json"
owned_regular_file "$fixture_root/success/build/integration-success/complete.status"
path_absent "$fixture_root/success/build/integration-success/capture-invalid.status"
path_absent "$fixture_root/success/build/integration-success/.complete.status.tmp"
sentinel_absent "$fixture_root/success/gradle.log" "$sentinel"

prepare_fixture failure
failure_status=0
bash "$source_root/gradlew" --no-daemon --no-build-cache --no-configuration-cache --max-workers=1 \
  -p "$fixture_root/failure" -I "$fixture_root/failure/combined.init.gradle" \
  -Dauto.world.fixture.mode=failure -Dauto.world.fixture.taskFailure=true \
  :server:internalClusterTest --rerun \
  > "$fixture_root/failure/gradle.log" 2>&1 || failure_status=$?
printf '%s\n' "$failure_status" > "$fixture_root/failure/gradle.exit-code"
owned_regular_file "$fixture_root/failure/gradle.log"
owned_regular_file "$fixture_root/failure/gradle.exit-code"
test "$failure_status" -ne 0
sentinel_present "$fixture_root/failure/gradle.log" 'AUTO_WORLD_FIXTURE_EXPECTED_TASK_FAILURE'
owned_regular_file "$fixture_root/failure/build/integration-failure/manifest.json"
owned_regular_file "$fixture_root/failure/build/integration-failure/complete.status"
path_absent "$fixture_root/failure/build/integration-failure/capture-invalid.status"
path_absent "$fixture_root/failure/build/integration-failure/.complete.status.tmp"
sentinel_absent "$fixture_root/failure/gradle.log" "$sentinel"

mkdir "$public_root/direct" "$public_root/success" "$public_root/failure"
cp "$fixture_root/direct/gradle.log" "$fixture_root/direct/gradle.exit-code" \
  "$fixture_root/direct/build/direct-summary.txt" "$public_root/direct/"
cp "$fixture_root/success/gradle.log" "$fixture_root/success/gradle.exit-code" "$public_root/success/"
cp -R "$fixture_root/success/build/integration-success" "$public_root/success/capture"
cp "$fixture_root/failure/gradle.log" "$fixture_root/failure/gradle.exit-code" "$public_root/failure/"
cp -R "$fixture_root/failure/build/integration-failure" "$public_root/failure/capture"
printf '%s\n' \
  'schema=auto-world-test-output-capture-fixture-v1' \
  'direct=passed' \
  'manifest-validator=passed negatives=malformed,hash,bytes,totals,aggregate-events,aggregate-bytes,path,missing,extra,file-count,symlink' \
  'successful-test-task=passed capture=complete' \
  'failing-test-task=expected-failure capture=complete' \
  > "$public_root/summary.txt"
