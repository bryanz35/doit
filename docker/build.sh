#!/usr/bin/env bash
# Build the Linux bundles in an Ubuntu 22.04 container.
#   docker/build.sh                  # all targets (deb, rpm, appimage)
#   docker/build.sh --bundles deb    # just one
# Bundles land in ./release/.
set -euo pipefail
cd "$(dirname "$0")"
export HOST_UID="$(id -u)" HOST_GID="$(id -g)"
docker compose -f compose.yml run --rm --build build "$@"
