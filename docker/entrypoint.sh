#!/usr/bin/env bash
set -euo pipefail

# node_modules is a container-private volume: the host copy is resolved for
# Arch and npm would otherwise rewrite it.
if [ ! -x node_modules/.bin/tauri ]; then
  echo "==> npm ci"
  npm ci
fi

echo "==> tauri build $*"
npm run tauri -- build "$@"

echo "==> copying bundles to ./release"
mkdir -p release
rm -rf release/*
cp -r "$CARGO_TARGET_DIR"/release/bundle/* release/ 2>/dev/null || true
find release -maxdepth 2 -type f -printf '%p  %s bytes\n'

# The bind mount is owned by the host user; don't hand back root-owned files.
if [ -n "${HOST_UID:-}" ]; then
  chown -R "$HOST_UID:${HOST_GID:-$HOST_UID}" release dist src-tauri/gen 2>/dev/null || true
fi
