#!/bin/sh
set -u

source_root=${1:-/src/seaweedfs}
input_root=${2:-/input}
output_root=${3:-/out/supplemental}
materials_root=${4:-/materials}
work_root=${5:-/work}
go_root=${6:-/usr/local/go}

command_test="go test -json -count=1 -mod=readonly -trimpath -buildvcs=false -timeout=5m ./command -run '^TestParseScanTimeHonoursTimezone$'"
storage_test="go test -json -count=1 -mod=readonly -trimpath -buildvcs=false -timeout=5m ./storage -run '^(TestValidateEcVolume_TransientStatErrorKeeps|TestRebuildIdx_UnwritableIdxDirSkipsOnlyThisVolume)$'"
candidate="$input_root/weed"
normal_evidence="$input_root/evidence"
source_manifest="$materials_root/normal-skip-sources.tsv"
gocache="$work_root/go-cache"
gotmpdir="$work_root/go-tmp"
tmpdir="$work_root/tmp"
home="$work_root/home"
finalized=0

mkdir -p "$output_root"
for status_name in preflight command storage capture finalization; do
  printf '%s\n' 125 > "$output_root/$status_name.exit-code"
done
for stream_name in command.go-test.json command.stderr.txt storage.go-test.json storage.stderr.txt; do
  : > "$output_root/$stream_name"
done
: > "$output_root/materials-before.tsv"
: > "$output_root/materials-after.tsv"
: > "$output_root/capture-manifest.tsv"
: > "$output_root/source-sha256.txt"

{
  printf 'schema\t%s\n' NORMAL_LINUX_AMD64_SUPPLEMENTAL_V1
  printf 'uid\t%s\n' 10001
  printf 'gid\t%s\n' 10001
  printf 'go_version\t%s\n' go1.27.3
  printf 'goos\t%s\n' linux
  printf 'goarch\t%s\n' amd64
  printf 'cgo_enabled\t%s\n' 0
  printf 'build_tags\t\n'
  printf 'command_zoneinfo\t%s\n' /usr/local/go/lib/time/zoneinfo.zip
  printf 'command\t%s\n' "$command_test"
  printf 'storage_zoneinfo\t\n'
  printf 'storage\t%s\n' "$storage_test"
} > "$output_root/context.tsv"

cleanup_owned_work() {
  cleanup_status=0
  test "$work_root" = /work || cleanup_status=1
  test "$gocache" = /work/go-cache || cleanup_status=1
  test "$gotmpdir" = /work/go-tmp || cleanup_status=1
  test "$tmpdir" = /work/tmp || cleanup_status=1
  test "$home" = /work/home || cleanup_status=1
  test -d "$work_root" || cleanup_status=1
  test ! -L "$work_root" || cleanup_status=1
  for owned_path in "$gocache" "$gotmpdir" "$tmpdir" "$home"; do
    case "$owned_path" in
      "$work_root"/*) ;;
      *) cleanup_status=1 ;;
    esac
    test ! -L "$owned_path" || cleanup_status=1
  done
  if [ "$cleanup_status" -eq 0 ]; then
    rm -rf "$gocache" "$gotmpdir" "$tmpdir" "$home" || cleanup_status=1
  fi
  return "$cleanup_status"
}

finish_interrupted() {
  printf '%s\n' 1 > "$output_root/finalization.exit-code"
  cleanup_owned_work || true
  finalized=1
}

finish_exit() {
  if [ "$finalized" -eq 0 ]; then
    finish_interrupted
  fi
}

trap 'finish_interrupted; exit 0' HUP INT TERM
trap finish_exit EXIT

canonical_status_zero() {
  status_path=$1
  test -f "$status_path" || return 1
  test "$(wc -c < "$status_path" | tr -d '[:space:]')" = 2 || return 1
  test "$(cat "$status_path")" = 0
}

record_material() {
  canonical_path=$1
  actual_path=$2
  destination=$3
  test -f "$actual_path" || return 1
  test ! -L "$actual_path" || return 1
  test "$(stat -c '%h' "$actual_path")" = 1 || return 1
  material_bytes=$(wc -c < "$actual_path" | tr -d '[:space:]') || return 1
  material_sha256=$(sha256sum "$actual_path" | cut -d ' ' -f 1) || return 1
  printf '%s\t%s\t%s\n' "$canonical_path" "$material_bytes" "$material_sha256" >> "$destination"
}

record_materials() {
  destination=$1
  : > "$destination"
  record_material /usr/local/go/lib/time/zoneinfo.zip "$go_root/lib/time/zoneinfo.zip" "$destination" || return 1
  record_material /usr/local/go/src/time/zoneinfo.go "$go_root/src/time/zoneinfo.go" "$destination" || return 1
  record_material /usr/local/go/src/time/zoneinfo_read.go "$go_root/src/time/zoneinfo_read.go" "$destination" || return 1
  record_material /src/seaweedfs/go.mod "$source_root/go.mod" "$destination" || return 1
  record_material /src/seaweedfs/go.sum "$source_root/go.sum" "$destination" || return 1
  tab=$(printf '\t')
  while IFS="$tab" read -r source_path source_bytes source_sha256 unexpected; do
    test -z "$unexpected" || return 1
    record_material "/src/seaweedfs/$source_path" "$source_root/$source_path" "$destination" || return 1
  done < "$source_manifest"
  record_material /input/weed "$candidate" "$destination" || return 1
  record_material /input/evidence/source-sha256.txt "$normal_evidence/source-sha256.txt" "$destination" || return 1
  record_material /input/evidence/module-inventory.json "$normal_evidence/module-inventory.json" "$destination" || return 1
  record_material /input/evidence/module-verify.txt "$normal_evidence/module-verify.txt" "$destination" || return 1
  record_material /input/evidence/binary-sha256.txt "$normal_evidence/binary-sha256.txt" "$destination" || return 1
  test "$(wc -l < "$destination" | tr -d '[:space:]')" = 36
}

verify_source_manifest() {
  test -f "$source_manifest" || return 1
  test ! -L "$source_manifest" || return 1
  test "$(stat -c '%h' "$source_manifest")" = 1 || return 1
  test "$(sha256sum "$source_manifest" | cut -d ' ' -f 1)" = e6070047fca680c37d2da16c6af862c22f0261f2cb4f11e83b5a43e0215ed991 || return 1
  tab=$(printf '\t')
  source_count=0
  while IFS="$tab" read -r source_path expected_bytes expected_sha256 unexpected; do
    test -n "$source_path" || return 1
    test -z "$unexpected" || return 1
    actual_path="$source_root/$source_path"
    test -f "$actual_path" || return 1
    test ! -L "$actual_path" || return 1
    test "$(stat -c '%h' "$actual_path")" = 1 || return 1
    test ! -w "$actual_path" || return 1
    test "$(wc -c < "$actual_path" | tr -d '[:space:]')" = "$expected_bytes" || return 1
    test "$(sha256sum "$actual_path" | cut -d ' ' -f 1)" = "$expected_sha256" || return 1
    source_count=$((source_count + 1))
  done < "$source_manifest"
  test "$source_count" = 26
  cmp "$source_manifest" "$normal_evidence/normal-skip-sources.tsv"
}

preflight_status=0
for normal_status in preparation package-list go-test go-test-capture build build-validation; do
  canonical_status_zero "$normal_evidence/$normal_status.exit-code" || preflight_status=1
done

test "$(id -u)" = 10001 || preflight_status=1
test "$(id -g)" = 10001 || preflight_status=1
test "${GOENV-}" = off || preflight_status=1
test "${GOTOOLCHAIN-}" = local || preflight_status=1
test "${GOWORK-}" = off || preflight_status=1
test "${CGO_ENABLED-}" = 0 || preflight_status=1
test "${GOOS-}" = linux || preflight_status=1
test "${GOARCH-}" = amd64 || preflight_status=1
test "${GOPROXY-}" = https://proxy.golang.org || preflight_status=1
test "${GOSUMDB-}" = sum.golang.org || preflight_status=1
test "${GOPRIVATE-}" = '' || preflight_status=1
test "${GONOPROXY-}" = '' || preflight_status=1
test "${GONOSUMDB-}" = '' || preflight_status=1
test "${GOFLAGS-}" = '' || preflight_status=1
test "${GOMODCACHE-}" = /go/pkg/mod || preflight_status=1
test "${GOCACHE-}" = /work/go-cache || preflight_status=1
test "${GOTMPDIR-}" = /work/go-tmp || preflight_status=1
test "${TMPDIR-}" = /work/tmp || preflight_status=1
test "${HOME-}" = /work/home || preflight_status=1
test "${WEED_BINARY-}" = /input/weed || preflight_status=1
test -z "${ZONEINFO+x}" || preflight_status=1
test "$(go version)" = 'go version go1.27.3 linux/amd64' || preflight_status=1

for readonly_path in "$source_root" "$source_root/go.mod" "$source_root/go.sum" "$candidate" "$normal_evidence" "$GOMODCACHE"; do
  test -e "$readonly_path" || preflight_status=1
  test ! -w "$readonly_path" || preflight_status=1
done

for builder_path in "$go_root/lib/time/zoneinfo.zip" "$go_root/src/time/zoneinfo.go" "$go_root/src/time/zoneinfo_read.go"; do
  test -f "$builder_path" || preflight_status=1
  test ! -L "$builder_path" || preflight_status=1
  test "$(stat -c '%h' "$builder_path")" = 1 || preflight_status=1
done
for bound_path in "$source_root/go.mod" "$source_root/go.sum" "$candidate"; do
  test -f "$bound_path" || preflight_status=1
  test ! -L "$bound_path" || preflight_status=1
  test "$(stat -c '%h' "$bound_path")" = 1 || preflight_status=1
done
test "$(wc -c < "$go_root/lib/time/zoneinfo.zip" | tr -d '[:space:]')" = 408467 || preflight_status=1
test "$(sha256sum "$go_root/lib/time/zoneinfo.zip" | cut -d ' ' -f 1)" = b2d18a7c8fa8142097a48c99609fb3c92db5ee98bc740294e57eab8ae9f94779 || preflight_status=1
test "$(wc -c < "$go_root/src/time/zoneinfo.go" | tr -d '[:space:]')" = 18613 || preflight_status=1
test "$(sha256sum "$go_root/src/time/zoneinfo.go" | cut -d ' ' -f 1)" = 198928e8d2573d88d8743db57b86777a26506f17ef2b0283882a9f5c884979b7 || preflight_status=1
test "$(wc -c < "$go_root/src/time/zoneinfo_read.go" | tr -d '[:space:]')" = 14741 || preflight_status=1
test "$(sha256sum "$go_root/src/time/zoneinfo_read.go" | cut -d ' ' -f 1)" = 812b0025c6e4face22e709053183d59e03e71e3c1459187350f4088587f4a134 || preflight_status=1

verify_source_manifest || preflight_status=1
test "$(sha256sum "$source_root/go.mod" | cut -d ' ' -f 1)" = 5b7892540b197eb5156333ffc9ae108084849db07d0dea57b7060339f840a1a9 || preflight_status=1
test "$(sha256sum "$source_root/go.sum" | cut -d ' ' -f 1)" = abd0d0de5302a1a571dcff5527f8bc929380f9d80abd0593416e9129dde0e96a || preflight_status=1
test "$(sha256sum "$candidate" | cut -d ' ' -f 1)" = "$(cut -d ' ' -f 1 < "$normal_evidence/binary-sha256.txt")" || preflight_status=1
grep -F 'd650e7a8a2cbec8a1725386f87f5eb803c95aa84417530aec58c1925fd23a2c9' "$normal_evidence/source-sha256.txt" > /dev/null || preflight_status=1
test -s "$normal_evidence/module-inventory.json" || preflight_status=1
test -s "$normal_evidence/module-verify.txt" || preflight_status=1

if [ -f "$normal_evidence/source-sha256.txt" ]; then
  cp "$normal_evidence/source-sha256.txt" "$output_root/source-sha256.txt" || preflight_status=1
fi
record_materials "$output_root/materials-before.tsv" || preflight_status=1
printf '%s\n' "$preflight_status" > "$output_root/preflight.exit-code"

command_status=125
if [ "$preflight_status" -eq 0 ]; then
  command_status=0
  cd "$source_root/weed" || command_status=1
fi
if [ "$preflight_status" -eq 0 ] && [ "$command_status" -eq 0 ]; then
  ZONEINFO=/usr/local/go/lib/time/zoneinfo.zip go test -json -count=1 -mod=readonly -trimpath -buildvcs=false -timeout=5m ./command -run '^TestParseScanTimeHonoursTimezone$' \
    > "$output_root/command.go-test.json" 2> "$output_root/command.stderr.txt" || command_status=$?
fi
printf '%s\n' "$command_status" > "$output_root/command.exit-code"

storage_status=125
if [ "$preflight_status" -eq 0 ]; then
  storage_status=0
  test -z "${ZONEINFO+x}" || storage_status=1
fi
if [ "$preflight_status" -eq 0 ] && [ "$storage_status" -eq 0 ]; then
  go test -json -count=1 -mod=readonly -trimpath -buildvcs=false -timeout=5m ./storage -run '^(TestValidateEcVolume_TransientStatErrorKeeps|TestRebuildIdx_UnwritableIdxDirSkipsOnlyThisVolume)$' \
    > "$output_root/storage.go-test.json" 2> "$output_root/storage.stderr.txt" || storage_status=$?
fi
printf '%s\n' "$storage_status" > "$output_root/storage.exit-code"

capture_status=0
if [ "$preflight_status" -ne 0 ]; then capture_status=125; fi
total_bytes=0
: > "$output_root/capture-manifest.tsv"
for stream_name in command.go-test.json command.stderr.txt storage.go-test.json storage.stderr.txt; do
  stream_path="$output_root/$stream_name"
  stream_bytes=$(wc -c < "$stream_path" | tr -d '[:space:]') || capture_status=1
  stream_sha256=$(sha256sum "$stream_path" | cut -d ' ' -f 1) || capture_status=1
  case "$stream_bytes" in
    ''|*[!0-9]*) capture_status=1 ;;
    *)
      test "$stream_bytes" -le 4194304 || capture_status=1
      total_bytes=$((total_bytes + stream_bytes))
      ;;
  esac
  printf '%s\t%s\t%s\n' "$stream_name" "$stream_bytes" "$stream_sha256" >> "$output_root/capture-manifest.tsv"
done
test "$total_bytes" -le 67108864 || capture_status=1
test "$(wc -l < "$output_root/capture-manifest.tsv" | tr -d '[:space:]')" = 4 || capture_status=1
printf '%s\n' "$capture_status" > "$output_root/capture.exit-code"

finalization_status=0
if [ "$preflight_status" -ne 0 ]; then finalization_status=1; fi
printf '%s\n' 1 > "$output_root/finalization.exit-code"
record_materials "$output_root/materials-after.tsv" || finalization_status=1
cmp "$output_root/materials-before.tsv" "$output_root/materials-after.tsv" || finalization_status=1
cleanup_owned_work || finalization_status=1
printf '%s\n' "$finalization_status" > "$output_root/finalization.exit-code"
finalized=1
exit 0
