#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
CASES_DIR="$SKILL_DIR/assets/cases"

pass=0
fail=0
skip=0
errors=""

for case_dir in "$CASES_DIR"/*/; do
    case_name="$(basename "$case_dir")"
    expected_file="$(find "$case_dir" -name 'expected.*' | head -1)"
    output_file="$(find "$case_dir" -name 'output.*' 2>/dev/null | head -1)"

    if [[ -z "$expected_file" ]]; then
        echo "SKIP  $case_name (missing expected)"
        ((skip++))
        continue
    fi

    if [[ -z "$output_file" ]]; then
        echo "SKIP  $case_name (no output yet — agent hasn't processed this case)"
        ((skip++))
        continue
    fi

    if diff "$output_file" "$expected_file" > /dev/null 2>&1; then
        echo "PASS  $case_name"
        ((pass++))
    else
        echo "FAIL  $case_name"
        echo "--- diff (output vs expected) ---"
        diff "$output_file" "$expected_file" || true
        echo "--- end diff ---"
        echo
        ((fail++))
        errors="$errors  $case_name\n"
    fi
done

total=$((pass + fail))
echo
echo "Results: $pass/$total passed ($skip skipped)"

if [[ $fail -gt 0 ]]; then
    echo "Failures:"
    printf "$errors"
fi

exit "$fail"
