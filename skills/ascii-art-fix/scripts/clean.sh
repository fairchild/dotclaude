#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CASES_DIR="$(dirname "$SCRIPT_DIR")/assets/cases"

count=0
for f in "$CASES_DIR"/*/output.*; do
    [[ -e "$f" ]] || continue
    rm "$f"
    ((count++))
done

echo "Cleaned $count output file(s)"
