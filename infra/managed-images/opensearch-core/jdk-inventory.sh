#!/bin/bash
set -euo pipefail

test "$#" -eq 1
cd "$1"
test -f release
test -x bin/java
test -d legal
export LC_ALL=C TZ=UTC
# Only mtime is normalized. The stream retains contents, names, types, link
# targets, modes and numeric owners, and is never stored as an archive.
tar_arguments=(--create --sort=name --format=gnu --numeric-owner --mtime=@0 --file=- .)
printf '%s\n' 'JDK_TAR_METADATA_NUMERIC_OWNERS_MTIME_NORMALIZED'
tar "${tar_arguments[@]}" | tar --list --verbose --numeric-owner --full-time --quoting-style=escape --file=-
printf '%s\n' 'JDK_TREE_TAR_SHA256'
tar "${tar_arguments[@]}" | sha256sum
