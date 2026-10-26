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

# The outer build log intentionally contains no private fixture paths or raw
# command errors. Fixed diagnostics and original subprocess logs are published
# below under /evidence/test-output-fixture.
exec >/dev/null 2>&1

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

owned_directory() {
  local directory=$1
  [ -d "$directory" ] && [ ! -L "$directory" ] \
    && [ "$(stat -c '%u' "$directory")" -eq "$(id -u)" ]
}

diagnostic_subcase=initialized
diagnostic_status=initialized
record_diagnostic() {
  local subcase=$1
  local status=$2
  case "$subcase" in
    initialized|direct-process|direct-exit|direct-summary|direct-sentinel \
      |scope-process|scope-exit|scope-sentinel|scope-included-marker \
      |scope-root-marker|scope-capture-absent \
      |manifest-valid|manifest-malformed|manifest-hash|manifest-bytes \
      |manifest-totals|manifest-aggregate-events|manifest-aggregate-bytes \
      |manifest-path|manifest-missing|manifest-extra|manifest-file-count \
      |manifest-symlink|success-process|success-exit|success-manifest \
      |success-complete|success-invalid-absent|success-temp-absent \
      |success-sentinel|success-capture|failure-process|failure-exit \
      |failure-expected-sentinel|failure-manifest|failure-complete \
      |failure-invalid-absent|failure-temp-absent|failure-sentinel \
      |failure-capture|summary|complete) ;;
    *) return 1 ;;
  esac
  case "$status" in
    initialized|running|passed|failed) ;;
    *) return 1 ;;
  esac
  printf 'subcase=%s\nstatus=%s\n' "$subcase" "$status" \
    > "$public_root/last-subcase.status.tmp"
  mv "$public_root/last-subcase.status.tmp" "$public_root/last-subcase.status"
  diagnostic_subcase=$subcase
  diagnostic_status=$status
}

run_check() {
  local subcase=$1
  shift
  record_diagnostic "$subcase" running
  if "$@"; then
    record_diagnostic "$subcase" passed
  else
    record_diagnostic "$subcase" failed
    return 1
  fi
}

publish_process() {
  local destination=$1
  local log=$2
  local exit_code=$3
  owned_regular_file "$log" || return 1
  owned_regular_file "$exit_code" || return 1
  cp "$log" "$destination/gradle.log"
  cp "$exit_code" "$destination/gradle.exit-code"
  owned_regular_file "$destination/gradle.log"
  owned_regular_file "$destination/gradle.exit-code"
}

manifest_capture_owned=0
remove_manifest_capture() {
  if [ "$manifest_capture_owned" -eq 1 ]; then
    owned_directory "$(dirname "$manifest_capture")" || return 1
    owned_directory "$manifest_capture" || return 1
    rm -rf "$manifest_capture"
    manifest_capture_owned=0
  fi
}

cleanup_fixture() {
  local original_status=$?
  trap - EXIT
  set +e
  remove_manifest_capture >/dev/null 2>&1
  if [ "$original_status" -ne 0 ] && [ "$diagnostic_status" = running ] \
    && owned_directory "$public_root"; then
    record_diagnostic "$diagnostic_subcase" failed >/dev/null 2>&1
  fi
  exit "$original_status"
}

trap cleanup_fixture EXIT

path_absent "$fixture_root"
path_absent "$public_root"
mkdir "$fixture_root" "$public_root"
record_diagnostic initialized running
mkdir "$public_root/scope" "$public_root/direct" "$public_root/success" "$public_root/failure" "$public_root/manifest"
for manifest_case in valid malformed hash bytes totals aggregate-events aggregate-bytes path missing extra file-count symlink; do
  mkdir "$public_root/manifest/$manifest_case"
done
for process_directory in "$public_root/scope" "$public_root/direct" "$public_root/success" "$public_root/failure" "$public_root"/manifest/*; do
  : > "$process_directory/gradle.log"
  printf '%s\n' NOT_RUN > "$process_directory/gradle.exit-code"
done
test -d "$source_root"
test -f "$source_root/gradlew"
test -f "$init_source"
test -f "$fixture_tail"
test -f "$manifest_verifier"
record_diagnostic initialized passed

prepare_fixture() {
  local mode=$1
  local destination="$fixture_root/$mode"
  path_absent "$destination"
  mkdir "$destination"
  owned_directory "$destination"
  path_absent "$destination/build"
  mkdir "$destination/build"
  owned_directory "$destination/build"
  cp "$fixture_source/settings.gradle" "$fixture_source/build.gradle" "$destination/"
  cp -R "$fixture_source/server" "$destination/"
  cp -R "$fixture_source/missing-doclet" "$destination/"
  cat "$init_source" "$fixture_tail" > "$destination/combined.init.gradle"
  printf '%s  %s\n' "$(sha256sum "$init_source" | cut -d ' ' -f 1)" "$init_source" \
    > "$destination/init-source.sha256"
  head -c "$(wc -c < "$init_source")" "$destination/combined.init.gradle" \
    | sha256sum | cut -d ' ' -f 1 \
    | grep -Fxq "$(sha256sum "$init_source" | cut -d ' ' -f 1)"
}

record_diagnostic scope-process running
prepare_fixture scope
scope_status=0
bash "$source_root/gradlew" --no-daemon --no-build-cache --no-configuration-cache --max-workers=1 \
  -p "$fixture_root/scope" -I "$fixture_root/scope/combined.init.gradle" \
  -Dauto.world.test.output.phase=full autoWorldCompositeScopeFixture \
  > "$fixture_root/scope/gradle.log" 2>&1 || scope_status=$?
printf '%s\n' "$scope_status" > "$fixture_root/scope/gradle.exit-code"
if publish_process "$public_root/scope" "$fixture_root/scope/gradle.log" "$fixture_root/scope/gradle.exit-code"; then
  record_diagnostic scope-process passed
else
  record_diagnostic scope-process failed
  exit 1
fi
run_check scope-exit test "$scope_status" -eq 0
run_check scope-sentinel sentinel_absent "$fixture_root/scope/gradle.log" "$sentinel"
run_check scope-included-marker sentinel_present "$fixture_root/scope/gradle.log" 'AUTO_WORLD_COMPOSITE_SCOPE_INCLUDED_PASS'
run_check scope-root-marker sentinel_present "$fixture_root/scope/gradle.log" 'AUTO_WORLD_COMPOSITE_SCOPE_ROOT_PASS'
run_check scope-capture-absent path_absent /evidence/test-output/full

record_diagnostic direct-process running
prepare_fixture direct
direct_status=0
bash "$source_root/gradlew" --no-daemon --no-build-cache --no-configuration-cache --max-workers=1 \
  -p "$fixture_root/direct" -I "$fixture_root/direct/combined.init.gradle" \
  -Dauto.world.fixture.mode=direct autoWorldCaptureFixture \
  > "$fixture_root/direct/gradle.log" 2>&1 || direct_status=$?
printf '%s\n' "$direct_status" > "$fixture_root/direct/gradle.exit-code"
if publish_process "$public_root/direct" "$fixture_root/direct/gradle.log" "$fixture_root/direct/gradle.exit-code"; then
  record_diagnostic direct-process passed
else
  record_diagnostic direct-process failed
  exit 1
fi
run_check direct-exit test "$direct_status" -eq 0
record_diagnostic direct-summary running
owned_regular_file "$fixture_root/direct/build/direct-summary.txt"
grep -Fxq 'AUTO_WORLD_TEST_OUTPUT_CAPTURE_FIXTURE_DIRECT_PASS' "$fixture_root/direct/build/direct-summary.txt"
run_check direct-sentinel sentinel_absent "$fixture_root/direct/gradle.log" "$sentinel"
record_diagnostic direct-summary running
cp "$fixture_root/direct/build/direct-summary.txt" "$public_root/direct/"
record_diagnostic direct-summary passed

manifest_capture=/evidence/test-output/full
manifest_golden="$fixture_root/direct/manifest-golden"
record_diagnostic manifest-valid running
owned_directory "$(dirname "$manifest_capture")"
path_absent "$manifest_capture"
path_absent "$manifest_golden"
cp -R "$fixture_root/direct/build/direct-cases/success" "$manifest_golden"

run_manifest_verifier() {
  local name=$1
  local expected=$2
  local status=0
  record_diagnostic "manifest-$name" running
  bash "$source_root/gradlew" --no-daemon --no-build-cache --no-configuration-cache --max-workers=1 \
    -p "$fixture_root/direct" -I "$manifest_verifier" \
    -Dauto.world.verify.test.output.phase=full autoWorldVerifyTestOutputManifest \
    > "$fixture_root/direct/manifest-$name.log" 2>&1 || status=$?
  printf '%s\n' "$status" > "$fixture_root/direct/manifest-$name.exit-code"
  if ! publish_process "$public_root/manifest/$name" \
    "$fixture_root/direct/manifest-$name.log" "$fixture_root/direct/manifest-$name.exit-code"; then
    record_diagnostic "manifest-$name" failed
    return 1
  fi
  if [ "$expected" = pass ]; then
    if test "$status" -eq 0 \
      && sentinel_absent "$fixture_root/direct/manifest-$name.log" "$manifest_sentinel"; then
      record_diagnostic "manifest-$name" passed
    else
      record_diagnostic "manifest-$name" failed
      return 1
    fi
  else
    if test "$status" -ne 0 \
      && sentinel_present "$fixture_root/direct/manifest-$name.log" "$manifest_sentinel"; then
      record_diagnostic "manifest-$name" passed
    else
      record_diagnostic "manifest-$name" failed
      return 1
    fi
  fi
}

reset_manifest_capture() {
  remove_manifest_capture
  path_absent "$manifest_capture"
  mkdir "$manifest_capture"
  owned_directory "$manifest_capture"
  manifest_capture_owned=1
  cp -R "$manifest_golden/." "$manifest_capture/"
}

reset_manifest_capture
run_manifest_verifier valid pass
record_diagnostic manifest-malformed running
printf '%s\n' '{' > "$manifest_capture/manifest.json"
run_manifest_verifier malformed fail
record_diagnostic manifest-hash running
reset_manifest_capture
first_stream=
for candidate in "$manifest_capture"/descriptor-*.log; do first_stream=$candidate; break; done
test -n "$first_stream"
printf 'X' | dd of="$first_stream" bs=1 count=1 conv=notrunc status=none
run_manifest_verifier hash fail
record_diagnostic manifest-bytes running
reset_manifest_capture
sed -i '0,/"bytes":[0-9][0-9]*/s//"bytes":999999/' "$manifest_capture/manifest.json"
run_manifest_verifier bytes fail
record_diagnostic manifest-totals running
reset_manifest_capture
sed -i 's/"captureErrors":0/"captureErrors":1/' "$manifest_capture/manifest.json"
run_manifest_verifier totals fail
record_diagnostic manifest-aggregate-events running
reset_manifest_capture
sed -i 's/"events":[0-9][0-9]*/"events":1000000/g' "$manifest_capture/manifest.json"
run_manifest_verifier aggregate-events fail
record_diagnostic manifest-aggregate-bytes running
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
record_diagnostic manifest-path running
reset_manifest_capture
sed -i '0,/"path":"[^"]*"/s//"path":"wrong.log"/' "$manifest_capture/manifest.json"
run_manifest_verifier path fail
record_diagnostic manifest-missing running
reset_manifest_capture
first_stream=
for candidate in "$manifest_capture"/descriptor-*.log; do first_stream=$candidate; break; done
rm "$first_stream"
run_manifest_verifier missing fail
record_diagnostic manifest-extra running
reset_manifest_capture
printf '%s\n' 'extra' > "$manifest_capture/extra.log"
run_manifest_verifier extra fail
record_diagnostic manifest-file-count running
reset_manifest_capture
extra_index=0
while [ "$extra_index" -lt 4096 ]; do
  : > "$manifest_capture/extra-$extra_index.log"
  extra_index=$((extra_index + 1))
done
run_manifest_verifier file-count fail
record_diagnostic manifest-symlink running
reset_manifest_capture
first_stream=
for candidate in "$manifest_capture"/descriptor-*.log; do first_stream=$candidate; break; done
stream_name=$(basename "$first_stream")
rm "$first_stream"
ln -s "$manifest_golden/$stream_name" "$first_stream"
run_manifest_verifier symlink fail
record_diagnostic manifest-symlink running
remove_manifest_capture
record_diagnostic manifest-symlink passed

record_diagnostic success-process running
prepare_fixture success
success_status=0
bash "$source_root/gradlew" --no-daemon --no-build-cache --no-configuration-cache --max-workers=1 \
  -p "$fixture_root/success" -I "$fixture_root/success/combined.init.gradle" \
  -Dauto.world.fixture.mode=success :server:internalClusterTest --rerun \
  > "$fixture_root/success/gradle.log" 2>&1 || success_status=$?
printf '%s\n' "$success_status" > "$fixture_root/success/gradle.exit-code"
if publish_process "$public_root/success" "$fixture_root/success/gradle.log" "$fixture_root/success/gradle.exit-code"; then
  record_diagnostic success-process passed
else
  record_diagnostic success-process failed
  exit 1
fi
run_check success-exit test "$success_status" -eq 0
run_check success-manifest owned_regular_file "$fixture_root/success/build/integration-success/manifest.json"
run_check success-complete owned_regular_file "$fixture_root/success/build/integration-success/complete.status"
run_check success-invalid-absent path_absent "$fixture_root/success/build/integration-success/capture-invalid.status"
run_check success-temp-absent path_absent "$fixture_root/success/build/integration-success/.complete.status.tmp"
run_check success-sentinel sentinel_absent "$fixture_root/success/gradle.log" "$sentinel"
record_diagnostic success-capture running
if cp -R "$fixture_root/success/build/integration-success" "$public_root/success/capture"; then
  record_diagnostic success-capture passed
else
  record_diagnostic success-capture failed
  exit 1
fi

record_diagnostic failure-process running
prepare_fixture failure
failure_status=0
bash "$source_root/gradlew" --no-daemon --no-build-cache --no-configuration-cache --max-workers=1 \
  -p "$fixture_root/failure" -I "$fixture_root/failure/combined.init.gradle" \
  -Dauto.world.fixture.mode=failure -Dauto.world.fixture.taskFailure=true \
  :server:internalClusterTest --rerun \
  > "$fixture_root/failure/gradle.log" 2>&1 || failure_status=$?
printf '%s\n' "$failure_status" > "$fixture_root/failure/gradle.exit-code"
if publish_process "$public_root/failure" "$fixture_root/failure/gradle.log" "$fixture_root/failure/gradle.exit-code"; then
  record_diagnostic failure-process passed
else
  record_diagnostic failure-process failed
  exit 1
fi
run_check failure-exit test "$failure_status" -ne 0
run_check failure-expected-sentinel sentinel_present "$fixture_root/failure/gradle.log" 'AUTO_WORLD_FIXTURE_EXPECTED_TASK_FAILURE'
run_check failure-manifest owned_regular_file "$fixture_root/failure/build/integration-failure/manifest.json"
run_check failure-complete owned_regular_file "$fixture_root/failure/build/integration-failure/complete.status"
run_check failure-invalid-absent path_absent "$fixture_root/failure/build/integration-failure/capture-invalid.status"
run_check failure-temp-absent path_absent "$fixture_root/failure/build/integration-failure/.complete.status.tmp"
run_check failure-sentinel sentinel_absent "$fixture_root/failure/gradle.log" "$sentinel"
record_diagnostic failure-capture running
if cp -R "$fixture_root/failure/build/integration-failure" "$public_root/failure/capture"; then
  record_diagnostic failure-capture passed
else
  record_diagnostic failure-capture failed
  exit 1
fi
record_diagnostic summary running
printf '%s\n' \
  'schema=auto-world-test-output-capture-fixture-v1' \
  'composite-scope=passed capture=not-started' \
  'direct=passed' \
  'manifest-validator=passed negatives=malformed,hash,bytes,totals,aggregate-events,aggregate-bytes,path,missing,extra,file-count,symlink' \
  'successful-test-task=passed capture=complete' \
  'failing-test-task=expected-failure capture=complete' \
  > "$public_root/summary.txt"
record_diagnostic summary passed
record_diagnostic complete passed
