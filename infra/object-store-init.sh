#!/bin/sh
set -eu
umask 077

# The upstream entrypoint drops to UID/GID1000. Never make the host credential
# file world-readable or change its host ownership: use an ephemeral private copy.
mkdir -p /run/aw-private
cp /run/aw-input/s3.json /run/aw-private/s3.json
chown 1000:1000 /run/aw-private /run/aw-private/s3.json
chmod 0700 /run/aw-private
chmod 0600 /run/aw-private/s3.json
exec /entrypoint.sh "$@"
