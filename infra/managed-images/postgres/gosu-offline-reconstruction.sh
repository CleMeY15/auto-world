#!/bin/sh
# Fixed same-toolchain experiment. No caller-selected paths or network fallback.
set -eu
umask 077
export LC_ALL=C
test "$#" = 0
inputs=/offline-inputs
references=/offline-references
work=/gosu-offline
reference_binary=/reference-gosu
source_sha=2b70da8a5480fafedc16bb1fc91b572f064d03df736cbd91a616af2f1b66ab51
mod_sha=216dbdc31af7371e368b90a85837c6dcf8aa7139cb449ecceaa0526d91900c3a
sum_sha=3f4d244f09dc5009ad68d99b2d99815f48fddf693fad8e734bbe820b315f43e7
binary_sha=8c12961ed59dc9c662d5b5150a8f8e7ab66ef59d5796a0abdb8778b885247b8e
build_info_sha=cfcd70393ff2134469c019ff50de1396dfb7e5aca4290ef0baa3217869b723f5

fail() { printf '%s\n' "gosu_offline_$1" >&2; exit 1; }
hash() {
    hash_line=$(sha256sum "$1")
    hash_value=${hash_line%% *}
    test "$hash_line" = "$hash_value  $1"
    test "${#hash_value}" = 64
    case "$hash_value" in *[!0-9a-f]*) exit 1;; esac
    printf '%s\n' "$hash_value"
}
# Run in a subshell so observations cannot change the caller's state.
identity() (
    test ! -L "$1"
    before=$(stat -c '%F|%h|%d|%i|%s|%y|%z' "$1")
    test "${before%%|*}" = 'regular file'
    rest=${before#*|}; test "${rest%%|*}" = 1
    size=$(stat -c '%s' "$1")
    case "$size" in 0|*[!0-9]*) exit 1;; esac
    test "$size" -le "$2"
    digest=$(hash "$1")
    test "$(stat -c '%F|%h|%d|%i|%s|%y|%z' "$1")" = "$before"
    printf '%s|%s\n' "$before" "$digest"
)

test ! -e "$work" && test ! -L "$work" || fail dirty_root
mkdir "$work"
specs="$work/specs"
printf '%s\n' \
    'github.com/moby/sys/user|v0.4.1|info' \
    'github.com/moby/sys/user|v0.4.1|mod' \
    'github.com/moby/sys/user|v0.4.1|zip' \
    'golang.org/x/sys|v0.1.0|info' \
    'golang.org/x/sys|v0.1.0|mod' \
    'golang.org/x/sys|v0.1.0|zip' > "$specs"

# Derive the only permitted proxy tree, including directories, from fixed names.
printf '%s\n' . > "$work/proxy-paths.unsorted"
while IFS='|' read -r module version kind; do
    relative="$module/@v/$version.$kind"
    printf './%s\n' "$relative" >> "$work/proxy-paths.unsorted"
    relative=${relative%/*}
    while test "$relative" != .; do
        printf './%s\n' "$relative" >> "$work/proxy-paths.unsorted"
        case "$relative" in */*) relative=${relative%/*};; *) relative=.;; esac
    done
done < "$specs"
sort -u "$work/proxy-paths.unsorted" > "$work/proxy-paths"

validate_proxy() (
    proxy=$1; snapshot=$2
    test -d "$proxy" && test ! -L "$proxy"
    (cd "$proxy"; find . -print | sort) > "$snapshot.paths"
    cmp "$work/proxy-paths" "$snapshot.paths"
    # Every intermediate component must be a real directory, not a symlink.
    while IFS= read -r relative; do
        case "$relative" in *.info|*.mod|*.zip) continue;; esac
        test -d "$proxy/$relative" && test ! -L "$proxy/$relative"
    done < "$snapshot.paths"
    : > "$snapshot"; : > "$snapshot.tsv"
    total=0
    while IFS='|' read -r module version kind; do
        file="$proxy/$module/@v/$version.$kind"
        observed=$(identity "$file" 16777216)
        size=$(stat -c '%s' "$file")
        total=$((total + size)); test "$total" -le 33554432
        printf '%s\t%s\t%s\t%s\t%s\n' "$module" "$version" "$kind" "$size" "${observed##*|}" >> "$snapshot.tsv"
        printf '%s\t%s\n' "$module/@v/$version.$kind" "$observed" >> "$snapshot"
    done < "$specs"
    cmp "$references/module-proxy-payloads.tsv" "$snapshot.tsv"
)

snapshot_inputs() (
    snapshot=$1
    test -d "$inputs" && test ! -L "$inputs"
    test "$(find "$inputs" -mindepth 1 -maxdepth 1 -print | sort)" = "$(printf '%s\n' "$inputs/gosu-source.tar.gz" "$inputs/proxy" | sort)"
    identity "$inputs/gosu-source.tar.gz" 18160 > "$snapshot"
    test "$(stat -c '%s' "$inputs/gosu-source.tar.gz")" = 18160
    test "$(hash "$inputs/gosu-source.tar.gz")" = "$source_sha"
    identity "$references/go.mod" 1024 >> "$snapshot"
    identity "$references/go.sum" 1024 >> "$snapshot"
    identity "$references/module-proxy-payloads.tsv" 1024 >> "$snapshot"
    identity "$reference_binary" 16777216 >> "$snapshot"
    test "$(hash "$references/go.mod")" = "$mod_sha"
    test "$(hash "$references/go.sum")" = "$sum_sha"
    test "$(hash "$reference_binary")" = "$binary_sha"
    validate_proxy "$inputs/proxy" "$snapshot.proxy"
)
snapshot_inputs "$work/inputs.before"
export GOENV=off GOTOOLCHAIN=local GOWORK=off CGO_ENABLED=0 GOOS=linux GOARCH=amd64
export GOPRIVATE= GONOPROXY= GONOSUMDB= GOFLAGS= GOSUMDB=off
compiler_version=$(go version)
test "$compiler_version" = 'go version go1.27.3 linux/amd64'

prepare_case() (
    case_root=$1; omitted=$2
    test ! -e "$case_root" && test ! -L "$case_root"
    mkdir "$case_root"
    for directory in source modcache buildcache gopath home tmp proxy; do mkdir "$case_root/$directory"; done
    test -z "$(find "$case_root/modcache" "$case_root/buildcache" -mindepth 1 -print)"
    cp "$inputs/gosu-source.tar.gz" "$case_root/source.tar.gz"
    identity "$case_root/source.tar.gz" 18160 > "$case_root/archive.before"
    test "$(hash "$case_root/source.tar.gz")" = "$source_sha"
    tar -xzf "$case_root/source.tar.gz" --strip-components=1 -C "$case_root/source"
    cmp "$references/go.mod" "$case_root/source/go.mod"
    cmp "$references/go.sum" "$case_root/source/go.sum"
    test ! -e "$case_root/source/.git"
    while IFS='|' read -r module version kind; do
        relative="$module/@v/$version.$kind"
        test "$relative" != "$omitted" || continue
        mkdir -p "$case_root/proxy/$module/@v"
        cp "$inputs/proxy/$relative" "$case_root/proxy/$relative"
        cmp "$inputs/proxy/$relative" "$case_root/proxy/$relative"
        identity "$case_root/proxy/$relative" 16777216 > /dev/null
    done < "$specs"
)
set_case_environment() {
    export GOMODCACHE="$1/modcache" GOCACHE="$1/buildcache" GOPATH="$1/gopath"
    export HOME="$1/home" TMPDIR="$1/tmp" GOPROXY="file://$1/proxy"
}
check_case_source() {
    cmp "$references/go.mod" "$1/source/go.mod"
    cmp "$references/go.sum" "$1/source/go.sum"
    identity "$1/source.tar.gz" 18160 > "$1/archive.after"
    cmp "$1/archive.before" "$1/archive.after"
}

# Native acquisition refusals, not preflight errors or compiler test doubles.
for module in github.com/moby/sys/user golang.org/x/sys; do
    case "$module" in
        github.com/moby/sys/user) version=v0.4.1; case_root="$work/missing-moby";;
        golang.org/x/sys) version=v0.1.0; case_root="$work/missing-sys";;
    esac
    missing="$module/@v/$version.zip"
    prepare_case "$case_root" "$missing"
    test ! -e "$case_root/proxy/$missing"
    # Temporarily restore only for a full copied-input identity check, then
    # remove that owned copy before acquisition; never borrow a warm Go cache.
    cp "$inputs/proxy/$missing" "$case_root/proxy/$missing"
    validate_proxy "$case_root/proxy" "$case_root/proxy.before"
    rm "$case_root/proxy/$missing"
    (
        set_case_environment "$case_root"
        cd "$case_root/source"
        # Bound this fixed diagnostic while the outer solve retains its deadline.
        ulimit -f 32
        if go mod download -json "$module@$version" > "$case_root/download.log" 2>&1; then fail missing_zip_accepted; fi
        test "$(wc -c < "$case_root/download.log")" -le 16384
        grep -F "\"Path\": \"$module\"" "$case_root/download.log" > /dev/null
        grep -F "\"Version\": \"$version\"" "$case_root/download.log" > /dev/null
        grep -F "file://$case_root/proxy/$missing" "$case_root/download.log" > /dev/null
        grep -F 'no such file or directory' "$case_root/download.log" > /dev/null
        # The absent path must be the specific acquisition error, not incidental text.
        grep -F '"Error":' "$case_root/download.log" | grep -F "file://$case_root/proxy/$missing" | grep -F 'no such file or directory' > /dev/null
        test ! -e "$case_root/gosu"
    )
    check_case_source "$case_root"
    cp "$inputs/proxy/$missing" "$case_root/proxy/$missing"
    validate_proxy "$case_root/proxy" "$case_root/proxy.after"
    # Restoring the deliberately omitted ZIP changes its inode: compare contents.
    cmp "$case_root/proxy.before.tsv" "$case_root/proxy.after.tsv"
    grep -F -v "$(printf '%s\t' "$missing")" "$case_root/proxy.before" > "$case_root/unchanged.before"
    grep -F -v "$(printf '%s\t' "$missing")" "$case_root/proxy.after" > "$case_root/unchanged.after"
    cmp "$case_root/unchanged.before" "$case_root/unchanged.after"
    printf 'gosu_offline_missing_zip_refused:%s@%s\n' "$module" "$version"
done

positive="$work/positive"
prepare_case "$positive" ''
validate_proxy "$positive/proxy" "$positive/proxy.before"
(
    set_case_environment "$positive"
    cd "$positive/source"
    go mod download -json all > "$positive/module-download.json"
    go mod verify
    go test -mod=readonly -trimpath -buildvcs=false -json ./...
    test -z "$(find . -name '*_test.go' -print)"
    printf '%s\n' 'gosu_offline_upstream_go_test_cases=0'
    go build -mod=readonly -trimpath -buildvcs=false '-ldflags=-d -w -buildid=' -o "$positive/gosu" .
    test "$(hash "$positive/gosu")" = "$binary_sha"
    cmp "$reference_binary" "$positive/gosu"
    go version -m "$positive/gosu" > "$positive/build-info.txt"
    test "$(head -n 1 "$positive/build-info.txt")" = "$positive/gosu: go1.27.3"
    # Normalize only the explicitly checked filename, never intrinsic build facts.
    { printf '%s\n' '/out/gosu: go1.27.3'; tail -n +2 "$positive/build-info.txt"; } > "$positive/intrinsic-build-info.txt"
    test "$(hash "$positive/intrinsic-build-info.txt")" = "$build_info_sha"
)
check_case_source "$positive"
validate_proxy "$positive/proxy" "$positive/proxy.after"
cmp "$positive/proxy.before" "$positive/proxy.after"
snapshot_inputs "$work/inputs.after"
cmp "$work/inputs.before" "$work/inputs.after"
cmp "$work/inputs.before.proxy" "$work/inputs.after.proxy"

mkdir "$work/evidence"
printf '{"schemaVersion":1,"kind":"GOSU_OFFLINE_INPUTS_SAME_TOOLCHAIN_V1","sourceArchiveSha256":"%s","modulePayloadsSha256":"%s","goModSha256":"%s","goSumSha256":"%s","compilerVersion":"go1.27.3","referenceBinarySha256":"%s","reconstructedBinarySha256":"%s","freshSourceAndCaches":true,"network":"none","missingZipRefusals":["github.com/moby/sys/user@v0.4.1","golang.org/x/sys@v0.1.0"]}\n' \
    "$source_sha" "$(hash "$references/module-proxy-payloads.tsv")" "$mod_sha" "$sum_sha" "$binary_sha" "$binary_sha" > "$work/receipt.tmp"
test "$(wc -c < "$work/receipt.tmp")" -le 4096
mv "$work/receipt.tmp" "$work/evidence/offline-reconstruction.json"
printf '%s\n' 'gosu_offline_reconstruction_passed'
# The first runtime solve observes these bytes on the authenticated RUN vertex.
projection_file() (
    observed=$(identity "$1" "$2")
    size=$(printf '%s' "$observed" | cut -d '|' -f 5)
    printf '{"size":%s,"sha256":"%s"}' "$size" "${observed##*|}"
)
source_entry=$(projection_file "$inputs/gosu-source.tar.gz" 18160)
mod_entry=$(projection_file "$references/go.mod" 1024)
sum_entry=$(projection_file "$references/go.sum" 1024)
tsv_entry=$(projection_file "$references/module-proxy-payloads.tsv" 1024)
receipt_entry=$(projection_file "$work/evidence/offline-reconstruction.json" 4096)
binary_entry=$(projection_file "$reference_binary" 16777216)
printf 'gosu_material_input_v1:{"schemaVersion":1,"kind":"GOSU_MATERIAL_INPUT_PROJECTION_V1","source":%s,"goMod":%s,"goSum":%s,"moduleProxyTsv":%s,"offlineReceipt":%s,"referenceBinary":%s,"compilerVersion":"%s"}\n' \
    "$source_entry" "$mod_entry" "$sum_entry" "$tsv_entry" "$receipt_entry" "$binary_entry" "$compiler_version"
