#!/usr/bin/env bash
set -euo pipefail

# End-to-end tests for git-worktree scripts
# Run from any git repository

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_BRANCH="worktree-test-$$"  # Unique per run
WORKTREES_ROOT="$HOME/.worktrees"
PASSED=0
FAILED=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

log() { echo -e "${YELLOW}▶${NC} $1"; }
pass() { echo -e "${GREEN}✓${NC} $1"; PASSED=$((PASSED + 1)); }
fail() { echo -e "${RED}✗${NC} $1"; FAILED=$((FAILED + 1)); }

cleanup() {
    log "Cleaning up test artifacts..."
    # Remove test worktree if it exists
    if [[ -d "$WORKTREES_ROOT/$(basename "$(git rev-parse --show-toplevel)")/$TEST_BRANCH" ]]; then
        "$SCRIPT_DIR/remove-worktree.sh" "$TEST_BRANCH" 2>/dev/null || true
    fi
    # Delete test branch if it exists
    git branch -D "$TEST_BRANCH" 2>/dev/null || true
}

trap cleanup EXIT

echo ""
echo "========================================"
echo "  Git Worktree Skill - E2E Tests"
echo "========================================"
echo "Test branch: $TEST_BRANCH"
echo ""

# Ensure we're in a git repo
if ! git rev-parse --git-dir &>/dev/null; then
    echo "Error: Must run from a git repository"
    exit 1
fi

REPO_NAME=$(basename "$(git remote get-url origin 2>/dev/null || git rev-parse --show-toplevel)" .git)
EXPECTED_PATH="$WORKTREES_ROOT/$REPO_NAME/$TEST_BRANCH"

# ------------------------------
# Test 1: --plan flag
# ------------------------------
log "Test 1: --plan outputs valid JSON"

PLAN_OUTPUT=$("$SCRIPT_DIR/create-worktree.sh" --plan "$TEST_BRANCH" 2>&1)

if echo "$PLAN_OUTPUT" | jq -e . &>/dev/null; then
    pass "--plan outputs valid JSON"
else
    fail "--plan did not output valid JSON: $PLAN_OUTPUT"
fi

# Verify plan contents
PLAN_PATH=$(echo "$PLAN_OUTPUT" | jq -r '.path // empty')
PLAN_BRANCH=$(echo "$PLAN_OUTPUT" | jq -r '.branch // empty')
PLAN_STATUS=$(echo "$PLAN_OUTPUT" | jq -r '.branch_status // empty')

if [[ -n "$PLAN_PATH" && -n "$PLAN_BRANCH" && -n "$PLAN_STATUS" ]]; then
    pass "--plan contains required fields"
else
    fail "--plan missing required fields"
fi

if [[ "$PLAN_BRANCH" == "$TEST_BRANCH" ]]; then
    pass "--plan shows correct branch name"
else
    fail "--plan shows wrong branch name"
fi

if [[ "$PLAN_STATUS" == "new" ]]; then
    pass "--plan correctly identifies new branch"
else
    fail "--plan did not identify branch as new"
fi

# ------------------------------
# Test 2: Create worktree
# ------------------------------
log "Test 2: Create worktree"

CREATE_OUTPUT=$("$SCRIPT_DIR/create-worktree.sh" --skip-setup "$TEST_BRANCH" 2>&1)

if [[ -d "$EXPECTED_PATH" ]]; then
    pass "Worktree directory created at $EXPECTED_PATH"
else
    fail "Worktree directory not created"
fi

if [[ -f "$EXPECTED_PATH/.git" ]]; then
    pass "Worktree has .git file (linked worktree)"
else
    fail "Worktree missing .git file"
fi

if (cd "$EXPECTED_PATH" && git rev-parse --is-inside-work-tree &>/dev/null); then
    pass "Worktree is valid git working tree"
else
    fail "Worktree is not a valid git working tree"
fi

CURRENT_BRANCH=$(cd "$EXPECTED_PATH" && git branch --show-current)
if [[ "$CURRENT_BRANCH" == "$TEST_BRANCH" ]]; then
    pass "Worktree is on correct branch: $TEST_BRANCH"
else
    fail "Worktree on wrong branch: $CURRENT_BRANCH (expected $TEST_BRANCH)"
fi

# ------------------------------
# Test 3: Duplicate detection
# ------------------------------
log "Test 3: Duplicate worktree detection"

DUP_OUTPUT=$("$SCRIPT_DIR/create-worktree.sh" --skip-setup "$TEST_BRANCH" 2>&1 || true)
if echo "$DUP_OUTPUT" | grep -q "already exists"; then
    pass "Detects existing worktree"
else
    fail "Did not detect existing worktree (got: $DUP_OUTPUT)"
fi

# ------------------------------
# Test 4: List worktrees
# ------------------------------
log "Test 4: List worktrees"

LIST_OUTPUT=$("$SCRIPT_DIR/list-worktrees.sh" 2>&1)

if echo "$LIST_OUTPUT" | grep -q "$TEST_BRANCH"; then
    pass "list-worktrees.sh shows test worktree"
else
    fail "list-worktrees.sh does not show test worktree"
fi

if echo "$LIST_OUTPUT" | grep -q "$REPO_NAME"; then
    pass "list-worktrees.sh shows repo name"
else
    fail "list-worktrees.sh does not show repo name"
fi

# ------------------------------
# Test 5: Remove worktree
# ------------------------------
log "Test 5: Remove worktree"

REMOVE_OUTPUT=$("$SCRIPT_DIR/remove-worktree.sh" "$TEST_BRANCH" 2>&1)

if [[ ! -d "$EXPECTED_PATH" ]]; then
    pass "Worktree directory removed"
else
    fail "Worktree directory still exists"
fi

if echo "$REMOVE_OUTPUT" | grep -q "removed successfully"; then
    pass "remove-worktree.sh reports success"
else
    fail "remove-worktree.sh did not report success"
fi

# Verify branch still exists (worktree removal shouldn't delete branch)
if git show-ref --verify --quiet "refs/heads/$TEST_BRANCH"; then
    pass "Branch preserved after worktree removal"
else
    fail "Branch was deleted with worktree"
fi

# ------------------------------
# Test 6: Remove non-existent worktree
# ------------------------------
log "Test 6: Error handling for non-existent worktree"

NOTFOUND_OUTPUT=$("$SCRIPT_DIR/remove-worktree.sh" "nonexistent-branch-xyz" 2>&1 || true)
if echo "$NOTFOUND_OUTPUT" | grep -qi "not found"; then
    pass "Handles non-existent worktree gracefully"
else
    fail "Did not handle non-existent worktree (got: $NOTFOUND_OUTPUT)"
fi

# ------------------------------
# Summary
# ------------------------------
echo ""
echo "========================================"
echo "  Results: $PASSED passed, $FAILED failed"
echo "========================================"
echo ""

if [[ $FAILED -gt 0 ]]; then
    exit 1
fi
