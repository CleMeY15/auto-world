#!/bin/bash
set -euo pipefail

test "$#" -eq 2
source_root=$1
evidence_root=$2
target=libs/x-content/src/test/java/org/opensearch/common/xcontent/XContentParserTests.java
cd "$source_root"
printf '%s  %s\n' \
  e45a76b389275584674a9458d573d2e13f19c65f36fdc00f6300d9a911f822e7 \
  "$target" | sha256sum --check --strict
test -d "$evidence_root"
test ! -L "$evidence_root"
cp "$target" "$evidence_root/xcontent-parser-tests.original.java.txt"
sed -i \
  -e '/^        \/\* use 50% of the limit, difficult to get the exact size of the content right \*\/$/,+1c\
        // Leave room for YAML syntax and allow up to two UTF-16 code units per Unicode code point.\
        () -> randomRealisticUnicodeOfCodepointLengthBetween(\
            1,\
            Math.min(YamlXContent.DEFAULT_CODEPOINT_LIMIT / 2, YamlXContent.DEFAULT_MAX_STRING_LEN / 2)\
        )' \
  "$target"
printf '%s  %s\n' \
  2b0c7153b492ac3a701fe51d21ac2f6f3af79421abc5f3477e002ceb790a6f52 \
  "$target" | sha256sum --check --strict
cp "$target" "$evidence_root/xcontent-parser-tests.patched.java.txt"
