#!/usr/bin/env bash
# Runner preparation only. This does not create a builder or access a registry.
set -euo pipefail
fail() { printf '%s\n' "scanner_retention_buildx_$1" >&2; exit 1; }

# Refuse local/self-hosted execution before invoking any external command.
[[ $# == 0 && ${GITHUB_ACTIONS-} == true && ${RUNNER_ENVIRONMENT-} == github-hosted \
  && ${RUNNER_OS-} == Linux && ${RUNNER_TEMP-} == /home/runner/work/_temp \
  && ${GITHUB_REPOSITORY-} == CleMeY15/auto-world ]] || fail context_invalid
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
[[ $(uname -sm) == 'Linux x86_64' && $(id -un) == runner ]] || fail host_invalid
grep -Fxq 'ID=ubuntu' /etc/os-release || fail host_invalid
grep -Fxq 'VERSION_ID="24.04"' /etc/os-release || fail host_invalid

expected_bytes=68366498
expected_sha=e25d5cd675092bb5d1d03632fdc46cdf3fede7b514dc5f023a105e00d3ce5ad4
plugin_parent=/usr/local/lib/docker/cli-plugins
destination=$plugin_parent/docker-buildx

private_root_directory() {
  [[ -d $1 && ! -L $1 && $(stat -c %u -- "$1") == 0 ]] || fail directory_invalid
  local mode
  mode=$(stat -c %a -- "$1")
  (( (8#$mode & 0022) == 0 )) || fail directory_invalid
}
for directory in / /usr /usr/local /usr/local/lib; do private_root_directory "$directory"; done
for directory in /usr/local/lib/docker "$plugin_parent"; do
  if [[ ! -e $directory && ! -L $directory ]]; then sudo -n mkdir -m 0755 -- "$directory"; fi
  private_root_directory "$directory"
done
[[ ! -e $destination && ! -L $destination ]] || fail destination_exists
[[ -d $RUNNER_TEMP && ! -L $RUNNER_TEMP && $(stat -c %u -- "$RUNNER_TEMP") == "$(id -u)" ]] \
  || fail temporary_root_invalid

umask 077
download_root=$(mktemp -d "$RUNNER_TEMP/scanner-retention-buildx.XXXXXXXX")
archive=$download_root/buildx-v0.38.1.linux-amd64
# Failed downloads remain in this owned runner directory until job disposal.
env -i PATH="$PATH" LANG=C.UTF-8 LC_ALL=C.UTF-8 \
  curl --disable --fail --silent --show-error --location --max-redirs 3 \
  --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 180 \
  --max-filesize "$expected_bytes" --output "$archive" \
  https://github.com/docker/buildx/releases/download/v0.38.1/buildx-v0.38.1.linux-amd64
[[ -f $archive && ! -L $archive && $(stat -c %s -- "$archive") == "$expected_bytes" ]] \
  || fail download_size_invalid
printf '%s  %s\n' "$expected_sha" "$archive" | sha256sum --check --strict -

# Stage under root-owned parents, revalidate the copied bytes, then publish with
# link(2)'s exclusive destination semantics. Existing files/symlinks are preserved.
install_part=$(sudo -n mktemp "$plugin_parent/.scanner-retention-buildx.XXXXXXXX")
cleanup_part() { sudo -n rm -- "$install_part"; }
trap cleanup_part EXIT
sudo -n install -o root -g root -m 0755 -- "$archive" "$install_part"
[[ -f $install_part && ! -L $install_part && $(stat -c %s -- "$install_part") == "$expected_bytes" ]] \
  || fail installed_size_invalid
printf '%s  %s\n' "$expected_sha" "$install_part" | sha256sum --check --strict -
private_root_directory "$plugin_parent"
sudo -n ln -T -- "$install_part" "$destination"
cleanup_part
trap - EXIT
[[ $(stat -c '%u:%g:%a:%h' -- "$destination") == '0:0:755:1' ]] || fail installed_metadata_invalid
printf '%s  %s\n' "$expected_sha" "$destination" | sha256sum --check --strict -
printf '%s\n' 'scanner_retention_buildx_installed v0.38.1'
