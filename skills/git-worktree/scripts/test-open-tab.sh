#!/usr/bin/env bash
# Manual verification script for open_terminal_tab
# Run: bash skills/git-worktree/scripts/test-open-tab.sh
#
# Sources wt.sh in a subshell to get the real functions, then
# overrides main() to prevent wt from executing its CLI.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Source wt.sh but prevent it from running main()
# We override main to a no-op, source everything, then call our test
main() { :; }
source "$SCRIPT_DIR/wt.sh"

DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT

echo "Testing open_terminal_tab..."
echo "A new terminal tab should open and print two lines."
echo ""
open_terminal_tab "$DIR" "echo 'hello from wt test' && echo 'special chars: spaces & ampersand ok'"

echo ""
echo "Check the new terminal tab. Did both echo lines appear? (y/n)"
read -r answer
[[ "$answer" == "y" ]] && echo "PASS" || echo "FAIL"
