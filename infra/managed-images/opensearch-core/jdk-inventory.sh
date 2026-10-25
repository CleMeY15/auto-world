#!/bin/bash
set -euo pipefail

test "$#" -eq 1
cd "$1"
test -f release
test -x bin/java
test -d legal
export LC_ALL=C
printf '%s\n' 'JDK_METADATA_TYPE_MODE_UID_GID_PATH_LINK'
find . -printf '%y %m %U %G %p -> %l\n' | sort
printf '%s\n' 'JDK_REGULAR_FILE_SHA256'
find . -type f -exec sha256sum '{}' + | sort
