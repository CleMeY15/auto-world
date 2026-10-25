#!/bin/bash
set -euo pipefail

test "$#" -eq 1
cd "$1"
printf '%s  %s\n' \
  fcd0e5b90015dbf8a14b3296d2eb84f049165f5a0c8b8918052ed063f2037187 \
  gradle/libs.versions.toml | sha256sum --check --strict

sed -i \
  -e 's/^\(jackson[[:space:]]*=[[:space:]]*\)"2\.22\.2"$/\1"2.22.3"/' \
  -e 's/^\(jackson_databind[[:space:]]*=[[:space:]]*\)"2\.22\.2"$/\1"2.22.3"/' \
  -e 's/^\(jackson3[[:space:]]*=[[:space:]]*\)"3\.2\.2"$/\1"3.2.3"/' \
  -e 's/^\(jackson3_databind[[:space:]]*=[[:space:]]*\)"3\.2\.2"$/\1"3.2.3"/' \
  gradle/libs.versions.toml

printf '%s  %s\n' \
  7f24009701658e9f6f856c7199587e6d934fadd8803f0b70a0ef5c94705159bb \
  gradle/libs.versions.toml | sha256sum --check --strict
