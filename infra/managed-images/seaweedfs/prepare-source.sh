#!/bin/sh
set -eu

source_root=${1:-/src/seaweedfs}
output_root=${2:-/out}
materials_root=${3:-/materials}
archive=${4:-/tmp/seaweedfs-source.tar.gz}
evidence="$output_root/evidence"
phase_evidence="$evidence/preparation"
first_failed_phase=NONE
preparation_status=0

mkdir -p "$source_root" "$phase_evidence"

archive_identity() {
  archive_bytes=$(wc -c < "$archive" | tr -d '[:space:]')
  printf 'archive-bytes=%s\n' "$archive_bytes"
  test "$archive_bytes" = 81881370
  printf '%s  %s\n' d650e7a8a2cbec8a1725386f87f5eb803c95aa84417530aec58c1925fd23a2c9 "$archive" | sha256sum -c -
  sha256sum "$archive" > "$evidence/source-sha256.txt"
}

extract_source() {
  tar -xzf "$archive" --strip-components=1 -C "$source_root"
}

verify_originals() {
  cd "$source_root"
  test ! -e .git
  cmp "$materials_root/original/go.mod" go.mod
  cmp "$materials_root/original/go.sum" go.sum
  cmp "$materials_root/licenses/seaweedfs-LICENSE" LICENSE
  sha256sum "$materials_root/original/go.mod" "$materials_root/original/go.sum" > "$evidence/original-module-sha256.txt"
}

apply_correction() {
  cd "$source_root"
  corrected_mod_bytes=$(wc -c < "$materials_root/corrected/go.mod" | tr -d '[:space:]')
  corrected_sum_bytes=$(wc -c < "$materials_root/corrected/go.sum" | tr -d '[:space:]')
  printf 'corrected-go-mod-bytes=%s\ncorrected-go-sum-bytes=%s\n' "$corrected_mod_bytes" "$corrected_sum_bytes"
  test "$corrected_mod_bytes" = 26652
  test "$corrected_sum_bytes" = 232835
  printf '%s  %s\n' 5b7892540b197eb5156333ffc9ae108084849db07d0dea57b7060339f840a1a9 "$materials_root/corrected/go.mod" | sha256sum -c -
  printf '%s  %s\n' abd0d0de5302a1a571dcff5527f8bc929380f9d80abd0593416e9129dde0e96a "$materials_root/corrected/go.sum" | sha256sum -c -
  cp "$materials_root/corrected/go.mod" "$materials_root/corrected/go.sum" .
  cmp "$materials_root/corrected/go.mod" go.mod
  cmp "$materials_root/corrected/go.sum" go.sum
  sha256sum go.mod go.sum > "$evidence/corrected-module-sha256.txt"
}

verify_compiler() {
  cd "$source_root"
  compiler_version=$(go version)
  printf 'compiler-version=%s\n' "$compiler_version"
  test "$compiler_version" = 'go version go1.27.3 linux/amd64'
  printf '%s\n' "$compiler_version" > "$evidence/compiler-version.txt"
}

download_modules() {
  cd "$source_root"
  go mod download -json all
}

verify_modules() {
  cd "$source_root"
  go mod verify
}

inventory_modules() {
  cd "$source_root"
  go list -m -json all
}

verify_final_material() {
  cd "$source_root"
  cmp "$materials_root/corrected/go.mod" go.mod
  cmp "$materials_root/corrected/go.sum" go.sum
}

record_not_run() {
  phase=$1
  stdout="$phase_evidence/$phase.stdout.txt"
  stderr="$phase_evidence/$phase.stderr.txt"
  status="$phase_evidence/$phase.exit-code"
  : > "$stdout"
  printf 'NOT_RUN_AFTER_PREPARATION_FAILURE first_failed_phase=%s\n' "$first_failed_phase" > "$stderr"
  printf '%s\n' 125 > "$status"
}

run_phase() {
  phase=$1
  function_name=$2
  stdout="$phase_evidence/$phase.stdout.txt"
  stderr="$phase_evidence/$phase.stderr.txt"
  status_file="$phase_evidence/$phase.exit-code"
  if [ "$preparation_status" -ne 0 ]; then
    record_not_run "$phase"
    return 0
  fi

  phase_status=0
  set +e
  (
    set -eu
    "$function_name"
  ) > "$stdout" 2> "$stderr"
  phase_status=$?
  set -e
  printf '%s\n' "$phase_status" > "$status_file"
  if [ "$phase_status" -ne 0 ]; then
    preparation_status=$phase_status
    first_failed_phase=$phase
  fi
}

run_phase archive-identity archive_identity
run_phase source-extract extract_source
run_phase original-material verify_originals
run_phase corrected-material apply_correction
run_phase compiler-identity verify_compiler
run_phase module-download download_modules
cp "$phase_evidence/module-download.stdout.txt" "$evidence/module-download.json"
run_phase module-verify verify_modules
cp "$phase_evidence/module-verify.stdout.txt" "$evidence/module-verify.txt"
run_phase module-inventory inventory_modules
cp "$phase_evidence/module-inventory.stdout.txt" "$evidence/module-inventory.json"
run_phase final-material verify_final_material

printf '%s\n' "$preparation_status" > "$evidence/preparation.exit-code"
printf '%s\n' "$first_failed_phase" > "$evidence/preparation-first-failed-phase.txt"
exit 0
