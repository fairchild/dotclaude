#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$SKILL_DIR/../.." && pwd)"

INIT_SCRIPT="$SKILL_DIR/scripts/init.sh"
SESSION_END_SCRIPT="$SKILL_DIR/scripts/session-end.sh"
LAUNCH_SCRIPT="$SKILL_DIR/scripts/launch.sh"
SKILL_DOC="$SKILL_DIR/SKILL.md"
TEMPLATE="$SKILL_DIR/templates/CLAUDE.md.tmpl"
ORCHESTRATOR="$REPO_ROOT/agents/team-memory-sleep.md"
SKILL_ORCHESTRATOR="$SKILL_DIR/agents/team-memory-sleep.md"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_file_contains() {
  local file=$1
  local pattern=$2
  if ! grep -Fq -- "$pattern" "$file"; then
    fail "Expected '$pattern' in $file"
  fi
}

assert_file_not_contains() {
  local file=$1
  local pattern=$2
  if grep -Fq -- "$pattern" "$file"; then
    fail "Did not expect '$pattern' in $file"
  fi
}

command -v jq >/dev/null 2>&1 || fail "jq is required for regression checks"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "[1/5] bootstrap wires dedicated team-memory session-end hook"
home_init="$tmp/home-init"
mkdir -p "$home_init/.claude"
cat > "$home_init/.claude/settings.json" <<'JSON'
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/session-end.sh"
          }
        ]
      }
    ]
  }
}
JSON

HOME="$home_init" AI_MEMORY_DIR="$home_init/.ai-memory" bash "$INIT_SCRIPT" scout >/dev/null
commands="$tmp/sessionend-commands.txt"
jq -r '.hooks.SessionEnd[]?.hooks[]?.command // empty' "$home_init/.claude/settings.json" > "$commands"
assert_file_contains "$commands" "~/.claude/skills/team-memory/scripts/session-end.sh"
hook_count=$(jq -r '.hooks.SessionEnd[]?.hooks[]?.command // empty' "$home_init/.claude/settings.json" | grep -F -c "~/.claude/skills/team-memory/scripts/session-end.sh" || true)
[ "$hook_count" -eq 1 ] || fail "Expected exactly one team-memory SessionEnd hook after first init"

# Second init should not duplicate the team-memory hook.
HOME="$home_init" AI_MEMORY_DIR="$home_init/.ai-memory" bash "$INIT_SCRIPT" oracle >/dev/null
hook_count=$(jq -r '.hooks.SessionEnd[]?.hooks[]?.command // empty' "$home_init/.claude/settings.json" | grep -F -c "~/.claude/skills/team-memory/scripts/session-end.sh" || true)
[ "$hook_count" -eq 1 ] || fail "Expected exactly one team-memory SessionEnd hook after repeated init"

# Reordered SessionEnd entries should still be detected as already wired.
cat > "$home_init/.claude/settings.json" <<'JSON'
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/skills/team-memory/scripts/session-end.sh"
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "~/.claude/hooks/other-session-end.sh"
          }
        ]
      }
    ]
  }
}
JSON
HOME="$home_init" AI_MEMORY_DIR="$home_init/.ai-memory" bash "$INIT_SCRIPT" atlas >/dev/null
hook_count=$(jq -r '.hooks.SessionEnd[]?.hooks[]?.command // empty' "$home_init/.claude/settings.json" | grep -F -c "~/.claude/skills/team-memory/scripts/session-end.sh" || true)
[ "$hook_count" -eq 1 ] || fail "Expected exactly one team-memory SessionEnd hook when existing hook is not the last SessionEnd entry"
if ! cmp -s "$SKILL_ORCHESTRATOR" "$home_init/.claude/agents/team-memory-sleep.md"; then
  fail "Expected init.sh to install synced global team-memory-sleep agent"
fi

echo "[2/5] session-end uses hook transcript_path and explicit persona vars"
home_hook="$tmp/home-hook"
mkdir -p "$home_hook/.claude/projects/demo" "$tmp/bin"
touch "$home_hook/.claude/projects/demo/fallback.jsonl"
hook_transcript="$tmp/hook-transcript.jsonl"
touch "$hook_transcript"

cat > "$tmp/bin/claude" <<'SH'
#!/bin/bash
{
  echo "ARGS:$*"
  if [[ "${AI_MEMORY_PERSONA+x}" ]]; then
    echo "AI_MEMORY_PERSONA_VALUE:${AI_MEMORY_PERSONA}"
  else
    echo "AI_MEMORY_PERSONA_UNSET:1"
  fi
  echo "AI_MEMORY_TARGET_PERSONA:${AI_MEMORY_TARGET_PERSONA:-}"
  echo "AI_MEMORY_TRANSCRIPT:${AI_MEMORY_TRANSCRIPT:-}"
  echo "AI_MEMORY_DIR:${AI_MEMORY_DIR:-}"
} > "$TEAM_MEMORY_TEST_CAPTURE"
SH
chmod +x "$tmp/bin/claude"

capture="$tmp/session-end-capture.txt"
TEAM_MEMORY_TEST_CAPTURE="$capture" \
HOME="$home_hook" \
PATH="$tmp/bin:$PATH" \
AI_MEMORY_PERSONA="smoky" \
AI_MEMORY_DIR="$tmp/custom-memory-root" \
bash "$SESSION_END_SCRIPT" <<JSON
{"session_id":"abc123","cwd":"$home_hook","transcript_path":"$hook_transcript"}
JSON

assert_file_contains "$capture" "ARGS:--agent team-memory-sleep --model haiku --print Run sleep-time compute for persona smoky"
assert_file_contains "$capture" "AI_MEMORY_TARGET_PERSONA:smoky"
assert_file_contains "$capture" "AI_MEMORY_TRANSCRIPT:$hook_transcript"
assert_file_contains "$capture" "AI_MEMORY_DIR:$tmp/custom-memory-root"
assert_file_contains "$capture" "AI_MEMORY_PERSONA_VALUE:"
assert_file_not_contains "$capture" "AI_MEMORY_PERSONA_VALUE:smoky"
if ! cmp -s "$SKILL_ORCHESTRATOR" "$home_hook/.claude/agents/team-memory-sleep.md"; then
  fail "Expected session-end.sh to sync global team-memory-sleep agent"
fi

echo "[3/5] transcript fallback is opt-in"
capture_fallback="$tmp/session-end-fallback-capture.txt"
HOME="$home_hook" \
PATH="$tmp/bin:$PATH" \
AI_MEMORY_PERSONA="smoky" \
TEAM_MEMORY_TEST_CAPTURE="$capture_fallback" \
bash "$SESSION_END_SCRIPT" <<JSON
{"session_id":"no-transcript","cwd":"$home_hook"}
JSON

if [ -f "$capture_fallback" ]; then
  fail "Did not expect claude call when transcript_path is missing and fallback is disabled"
fi

HOME="$home_hook" \
PATH="$tmp/bin:$PATH" \
AI_MEMORY_PERSONA="smoky" \
AI_MEMORY_ALLOW_TRANSCRIPT_FALLBACK="1" \
TEAM_MEMORY_TEST_CAPTURE="$capture_fallback" \
bash "$SESSION_END_SCRIPT" <<JSON
{"session_id":"with-fallback","cwd":"$home_hook"}
JSON

assert_file_contains "$capture_fallback" "AI_MEMORY_TRANSCRIPT:$home_hook/.claude/projects/demo/fallback.jsonl"

echo "[4/5] no-arg launch does not inject a synthetic prompt"
home_launch="$tmp/home-launch"
mkdir -p "$home_launch/.ai-memory/scout" "$tmp/bin-launch"
ln -sfn scout "$home_launch/.ai-memory/active"

cat > "$tmp/bin-launch/claude" <<'SH'
#!/bin/bash
{
  echo "ARGS:$*"
  echo "CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD:${CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD:-}"
} > "$TEAM_MEMORY_LAUNCH_CAPTURE"
SH
chmod +x "$tmp/bin-launch/claude"

launch_capture="$tmp/launch-capture.txt"
TEAM_MEMORY_LAUNCH_CAPTURE="$launch_capture" \
HOME="$home_launch" \
PATH="$tmp/bin-launch:$PATH" \
bash "$LAUNCH_SCRIPT"

assert_file_contains "$launch_capture" "ARGS:--add-dir $home_launch/.ai-memory/scout --dangerously-skip-permissions"
assert_file_not_contains "$launch_capture" "hi, how's it goin"
assert_file_contains "$launch_capture" "CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD:1"

echo "[5/5] prompts are memory-root agnostic"
assert_file_contains "$ORCHESTRATOR" "Memory dir: <MEMORY_DIR>."
assert_file_not_contains "$ORCHESTRATOR" "Memory dir: ~/.ai-memory/<PERSONA>"
if ! cmp -s "$SKILL_ORCHESTRATOR" "$ORCHESTRATOR"; then
  fail "Expected root and skill team-memory-sleep agents to stay in sync"
fi
assert_file_contains "$TEMPLATE" 'MEMORY_DIR = ${AI_MEMORY_DIR:-$HOME/.ai-memory}/'
assert_file_contains "$TEMPLATE" "Memory dir: <MEMORY_DIR>."
assert_file_contains "$SKILL_DOC" "Memory dir: <MEMORY_DIR>/<name>"

echo "PASS: team-memory regression checks"
