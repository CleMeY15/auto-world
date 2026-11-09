#!/bin/bash
set -euo pipefail

test "$#" -eq 2
source_root=$1
evidence_root=$2
target=modules/transport-grpc/build.gradle
cd "$source_root"

printf '%s  %s\n' \
  c77756ad3c96ad3345df98b038bed1e9f1bfbb5947af2e055bd719a3ed0a3e71 \
  "$target" | sha256sum --check --strict
mkdir -p "$evidence_root"
cp "$target" "$evidence_root/transport-grpc.build.gradle.original.txt"

sed -i \
  -e 's/runtimeOnly "com\.google\.guava:guava:${versions\.guava}"/runtimeOnly "com.google.guava:guava:33.8.0-jre"/' \
  -e 's/implementation "com\.google\.guava:failureaccess:1\.0\.2"/implementation "com.google.guava:failureaccess:1.0.3"/' \
  -e "/'com\.google\.common\.cache\.Striped64',/d" \
  -e "/'com\.google\.common\.cache\.Striped64\$1',/d" \
  -e "/'com\.google\.common\.cache\.Striped64\$Cell',/d" \
  -e "/'com\.google\.common\.hash\.Striped64',/d" \
  -e "/'com\.google\.common\.hash\.Striped64\$1',/d" \
  -e "/'com\.google\.common\.hash\.Striped64\$Cell',/d" \
  -e "s/'com\.google\.common\.util\.concurrent\.AbstractFuture\$UnsafeAtomicHelper',/'com.google.common.util.concurrent.AbstractFutureState\$UnsafeAtomicHelper',/" \
  -e "/'com\.google\.common\.util\.concurrent\.AbstractFuture\$UnsafeAtomicHelper\$1',/d" \
  -e "/'com\.google\.common\.primitives\.UnsignedBytes\$LexicographicalComparatorHolder\$UnsafeComparator\$1',/d" \
  "$target"

printf '%s  %s\n' \
  c8312d409ea46ecc3407bcbd555ef2551177e554ebda2c5ce2419cfefccd4323 \
  "$target" | sha256sum --check --strict
cp "$target" "$evidence_root/transport-grpc.build.gradle.patched.txt"
