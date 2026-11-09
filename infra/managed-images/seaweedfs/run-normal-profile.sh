#!/bin/sh
set -euo pipefail

source_root=${1:-/src/seaweedfs}
output_root=${2:-/out}
materials_root=${3:-/materials}
module_root=${4:-/go/pkg/mod}
compiler_root=${5:-/usr/local/go}
evidence="$output_root/evidence"
event_directory="$evidence/go-test-events"
work_directory=$(mktemp -d "${TMPDIR:-/tmp}/auto-world-seaweedfs.XXXXXX")
trap 'rm -rf "$work_directory"' EXIT HUP INT TERM
mkdir -p "$output_root" "$event_directory" "$evidence/licenses"
printf '%s\n' 'DIAGNOSTIC_ONLY_NOT_ADMITTED' > "$evidence/state.txt"

copy_notices() {
  mode=$1
  if [ "$mode" = strict ]; then
    cp "$source_root/LICENSE" "$evidence/licenses/seaweedfs-LICENSE"
  elif [ -f "$source_root/LICENSE" ]; then
    cp "$source_root/LICENSE" "$evidence/licenses/seaweedfs-LICENSE"
  else
    cp "$materials_root/licenses/seaweedfs-LICENSE" "$evidence/licenses/seaweedfs-LICENSE"
  fi
  cp "$compiler_root/LICENSE" "$evidence/licenses/go-LICENSE"
  cp "$compiler_root/PATENTS" "$evidence/licenses/go-PATENTS"
  if [ "$mode" = strict ]; then
    cp "$module_root/github.com/go-jose/go-jose/v4@v4.1.6/LICENSE" "$evidence/licenses/go-jose-LICENSE"
    cp "$module_root/golang.org/x/net@v0.62.0/LICENSE" "$evidence/licenses/x-net-LICENSE"
    cp "$module_root/golang.org/x/net@v0.62.0/PATENTS" "$evidence/licenses/x-net-PATENTS"
  else
    if [ -f "$module_root/github.com/go-jose/go-jose/v4@v4.1.6/LICENSE" ]; then
      cp "$module_root/github.com/go-jose/go-jose/v4@v4.1.6/LICENSE" "$evidence/licenses/go-jose-LICENSE"
    fi
    if [ -f "$module_root/golang.org/x/net@v0.62.0/LICENSE" ]; then
      cp "$module_root/golang.org/x/net@v0.62.0/LICENSE" "$evidence/licenses/x-net-LICENSE"
    fi
    if [ -f "$module_root/golang.org/x/net@v0.62.0/PATENTS" ]; then
      cp "$module_root/golang.org/x/net@v0.62.0/PATENTS" "$evidence/licenses/x-net-PATENTS"
    fi
  fi
  cp "$materials_root/DERIVATIVE-NOTICE.txt" "$evidence/"
}

preparation_status=1
preparation_status_bytes=0
if [ -f "$evidence/preparation.exit-code" ]; then
  preparation_status=$(cat "$evidence/preparation.exit-code")
  preparation_status_bytes=$(wc -c < "$evidence/preparation.exit-code" | tr -d '[:space:]')
fi
if [ "$preparation_status_bytes" != 2 ] || [ "$preparation_status" != 0 ]; then
  printf 'NOT_RUN_PREPARATION_FAILED status=%s\n' "$preparation_status" > "$evidence/preparation-runner-status.txt"
  : > "$output_root/weed"
  : > "$evidence/package-list.txt"
  printf '%s\n' 'NOT_RUN_PREPARATION_FAILED' > "$evidence/package-list.stderr.txt"
  printf '%s\n' 125 > "$evidence/package-list.exit-code"
  : > "$evidence/go-test.stderr.txt"
  : > "$evidence/go-test-manifest.tsv"
  printf '%s\n' 0 > "$evidence/go-test-manifest-bytes.txt"
  (
    cd "$evidence" || exit 1
    sha256sum go-test-manifest.tsv > go-test-manifest.sha256
  )
  : > "$work_directory/go-test-empty.json"
  empty_sha256=$(sha256sum "$work_directory/go-test-empty.json" | cut -d ' ' -f 1)
  printf '0\t%s\n' "$empty_sha256" > "$evidence/go-test-stream.tsv"
  cp "$evidence/go-test-stream.tsv" "$evidence/go-test-concat.tsv"
  printf '%s\n' 125 > "$evidence/go-test.exit-code"
  printf '%s\n' 125 > "$evidence/go-test-capture.exit-code"
  : > "$evidence/build.stdout.txt"
  printf '%s\n' 'NOT_RUN_PREPARATION_FAILED' > "$evidence/build.stderr.txt"
  printf '%s\n' 125 > "$evidence/build.exit-code"
  printf '%s\n' 125 > "$evidence/build-validation.exit-code"
  copy_notices available
  exit 0
fi

cd "$source_root/weed" || exit 1

package_status=0
go list -mod=readonly ./... > "$evidence/package-list.txt" 2> "$evidence/package-list.stderr.txt" || package_status=$?
printf '%s\n' "$package_status" > "$evidence/package-list.exit-code"

test_status=0
go test -json -count=1 -mod=readonly -trimpath -buildvcs=false -timeout=5m ./... \
  > "$work_directory/go-test-stream.json" 2> "$evidence/go-test.stderr.txt" || test_status=$?
printf '%s\n' "$test_status" > "$evidence/go-test.exit-code"

stream_bytes=$(wc -c < "$work_directory/go-test-stream.json" | tr -d ' ')
stream_sha256=$(sha256sum "$work_directory/go-test-stream.json" | cut -d ' ' -f 1)
printf '%s\t%s\n' "$stream_bytes" "$stream_sha256" > "$evidence/go-test-stream.tsv"

awk -v output="$event_directory" '
  BEGIN { chunk = 0 }
  {
    filename = sprintf("%s/chunk-%04d.json", output, chunk)
    print $0 >> filename
    if (NR % 2000 == 0) {
      close(filename)
      chunk++
    }
  }
' "$work_directory/go-test-stream.json"

: > "$evidence/go-test-manifest.tsv"
capture_status=0
chunk_count=0
for chunk in "$event_directory"/chunk-*.json; do
  if [ ! -f "$chunk" ]; then
    continue
  fi
  chunk_name=${chunk##*/}
  chunk_bytes=$(wc -c < "$chunk" | tr -d ' ')
  chunk_sha256=$(sha256sum "$chunk" | cut -d ' ' -f 1)
  printf '%s\t%s\t%s\n' "$chunk_name" "$chunk_bytes" "$chunk_sha256" >> "$evidence/go-test-manifest.tsv"
  chunk_count=$((chunk_count + 1))
done

if [ "$chunk_count" -eq 0 ] || [ ! -s "$evidence/go-test-manifest.tsv" ]; then
  capture_status=1
fi
wc -c < "$evidence/go-test-manifest.tsv" | tr -d ' ' > "$evidence/go-test-manifest-bytes.txt"
(
  cd "$evidence" || exit 1
  sha256sum go-test-manifest.tsv > go-test-manifest.sha256
)
: > "$work_directory/go-test-concat.json"
for chunk in "$event_directory"/chunk-*.json; do
  if [ ! -f "$chunk" ]; then
    continue
  fi
  cat "$chunk" >> "$work_directory/go-test-concat.json" || capture_status=1
done
concat_bytes=$(wc -c < "$work_directory/go-test-concat.json" | tr -d ' ')
concat_sha256=$(sha256sum "$work_directory/go-test-concat.json" | cut -d ' ' -f 1)
printf '%s\t%s\n' "$concat_bytes" "$concat_sha256" > "$evidence/go-test-concat.tsv"
if ! cmp "$work_directory/go-test-stream.json" "$work_directory/go-test-concat.json"; then
  capture_status=1
fi
printf '%s\n' "$capture_status" > "$evidence/go-test-capture.exit-code"

: > "$output_root/weed"
build_status=0
go build -mod=readonly -trimpath -buildvcs=false \
  -ldflags '-extldflags -static -X github.com/seaweedfs/seaweedfs/weed/util/version.COMMIT=ffa87c2-aw-go-5b789254' \
  -o "$work_directory/weed" . > "$evidence/build.stdout.txt" 2> "$evidence/build.stderr.txt" || build_status=$?
printf '%s\n' "$build_status" > "$evidence/build.exit-code"
build_validation_status=1
if [ "$build_status" -eq 0 ]; then
  build_validation_status=0
  mv "$work_directory/weed" "$output_root/weed"
  go version -m "$output_root/weed" > "$evidence/build-info.txt" || build_validation_status=$?
  "$output_root/weed" version > "$evidence/weed-version.txt" 2> "$evidence/weed-version.stderr.txt" || build_validation_status=$?
  grep -F '4.51' "$evidence/weed-version.txt" > /dev/null || build_validation_status=1
  grep -F 'ffa87c2-aw-go-5b789254' "$evidence/weed-version.txt" > /dev/null || build_validation_status=1
  sha256sum "$output_root/weed" > "$evidence/binary-sha256.txt" || build_validation_status=$?
fi
printf '%s\n' "$build_validation_status" > "$evidence/build-validation.exit-code"

cmp "$materials_root/corrected/go.mod" "$source_root/go.mod"
cmp "$materials_root/corrected/go.sum" "$source_root/go.sum"
cp "$source_root/go.mod" "$source_root/go.sum" "$evidence/"
copy_notices strict

exit 0
