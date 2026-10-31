#!/usr/bin/env bash
# Build the guest: a Docker image supplies the rootfs, gondolin wraps it around an Alpine
# kernel. Rerun after any change to image/Dockerfile. Takes about seven minutes and writes the
# 8.1 GB guest to $GONDOLIN_ASSETS, by default the user cache, so every worktree shares one build.
# It needs about 20 GB free while it runs. Do not run it while a VM is up: it replaces the guest a
# running VM is booted from.
set -euo pipefail

here=$(cd -- "$(dirname -- "$0")" && pwd)
assets=${GONDOLIN_ASSETS:-${XDG_CACHE_HOME:-$HOME/.cache}/gondolin-runner/assets}
mkdir -p "$(dirname -- "$assets")"

# Pinned and checksum-verified. RUNNER_SHA256 comes from the release body's
# "<!-- BEGIN SHA linux-arm64 -->" marker; NODE_SHA256 from nodejs.org's SHASUMS256.txt.
RUNNER_VERSION=${RUNNER_VERSION:-2.337.0}
RUNNER_SHA256=${RUNNER_SHA256:-9b1dc70626422526e3c94767cf024896beb15da5342a3f4819bf2feac13e0393}
NODE_VERSION=${NODE_VERSION:-24.21.0}
NODE_SHA256=${NODE_SHA256:-6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2}
# The Playwright versions whose Chromium the image carries, to match what the suites pin. A version
# missing here costs only the download.
PLAYWRIGHT_VERSIONS=${PLAYWRIGHT_VERSIONS:-1.59.1 1.62.1}
# The bun a job pins, which setup-bun then finds already installed. BUN_SHA256 is bun-linux-aarch64.zip's line in that release's
# SHASUMS256.txt.
BUN_VERSION=${BUN_VERSION:-1.4.0}
BUN_SHA256=${BUN_SHA256:-4b1a332ee861983eb93bcfe6f770fff94e3e31b2c388bdaea3c8ed35e58eed0e}

# gondolin shells out to Homebrew's mke2fs to make the rootfs image.
[ -x /opt/homebrew/opt/e2fsprogs/sbin/mke2fs ] || {
  echo "missing mke2fs: brew install e2fsprogs" >&2
  exit 1
}

docker build --platform linux/arm64 \
  --build-arg "RUNNER_VERSION=${RUNNER_VERSION}" \
  --build-arg "RUNNER_SHA256=${RUNNER_SHA256}" \
  --build-arg "NODE_VERSION=${NODE_VERSION}" \
  --build-arg "NODE_SHA256=${NODE_SHA256}" \
  --build-arg "PLAYWRIGHT_VERSIONS=${PLAYWRIGHT_VERSIONS}" \
  --build-arg "BUN_VERSION=${BUN_VERSION}" \
  --build-arg "BUN_SHA256=${BUN_SHA256}" \
  -t gondolin-runner-rootfs:local "${here}/image"

# Not `gondolin build`: that also copies the 8 GB guest into gondolin's own image store, which
# the lane never reads. See build-guest.mjs.
node "${here}/build-guest.mjs" "${here}/build.json" "$assets"
