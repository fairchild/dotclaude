#!/usr/bin/env bash
set -euo pipefail

AADC_SRC="$HOME/code/github/aadc"

usage() {
  cat <<EOF
Ensure aadc (ASCII Art Diagram Corrector) is installed.

Usage: $(basename "$0") [OPTIONS]

Options:
  --check   Exit 0 if installed, 1 if not (no build)
  --help    Show this help
EOF
}

case "${1:-}" in
  --help) usage; exit 0 ;;
  --check)
    if command -v aadc &>/dev/null; then
      aadc --version
      exit 0
    fi
    echo "aadc not found" >&2
    exit 1
    ;;
esac

if command -v aadc &>/dev/null; then
  echo "aadc already installed: $(aadc --version)"
  exit 0
fi

if [[ ! -d "$AADC_SRC" ]]; then
  echo "Error: aadc source not found at $AADC_SRC" >&2
  echo "Clone it: git clone https://github.com/Dicklesworthstone/aadc $AADC_SRC" >&2
  exit 1
fi

echo "Building aadc from $AADC_SRC..."
RUSTUP_TOOLCHAIN=nightly cargo install --path "$AADC_SRC"

echo "Installed: $(aadc --version)"
