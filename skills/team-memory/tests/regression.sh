#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$SKILL_DIR/../.." && pwd)"

INIT_SCRIPT="$SKILL_DIR/scripts/init.sh"
SESSION_END_SCRIPT="$SKILL_DIR/scripts/session-end.sh"
SKILL_DOC="$SKILL_DIR/SKILL.md"
TEMPLATE="$SKILL_DIR/templates/CLAUDE.md.tmpl"
ORCHESTRATOR="$REPO_ROOT/agents/team-memory-sleep.md"

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

echo "[1/3] bootstrap migrates and wires dedicated team-memory session-end hook"
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
            "command": "TRANSCRIPT=$(ls -t ~/.claude/projects/*/*.jsonl 2>/dev/null | head -1); PERSONA=\"$AI_MEMORY_PERSONA\"; [ -n \"$PERSONA\" ] && [ -n \"$TRANSCRIPT\" ] && CLAUDECODE= AI_MEMORY_PERSONA= AI_MEMORY_TRANSCRIPT=\"$TRANSCRIPT\" claude --agent team-memory-sleep --model haiku --print \"Run sleep-time compute for persona $PERSONA\" || true"
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
assert_file_not_contains "$commands" "team-memory-sleep"

echo "[2/3] session-end uses hook transcript_path and explicit persona vars"
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

echo "[3/3] prompts are memory-root agnostic"
assert_file_contains "$ORCHESTRATOR" "Memory dir: <MEMORY_DIR>."
assert_file_not_contains "$ORCHESTRATOR" "Memory dir: ~/.ai-memory/<PERSONA>"
assert_file_contains "$TEMPLATE" 'MEMORY_DIR = ${AI_MEMORY_DIR:-$HOME/.ai-memory}/'
assert_file_contains "$TEMPLATE" "Memory dir: <MEMORY_DIR>."
assert_file_contains "$SKILL_DOC" "Memory dir: <MEMORY_DIR>/<name>"

echo "PASS: team-memory regression checks"
