#!/usr/bin/env bash
# Behavior tests for claude-as: a throwaway HOME, and a stub claude that prints what it was given.
set -euo pipefail

script="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)/scripts/claude-as"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
tmp="$(cd "$tmp" && pwd -P)"
export HOME="$tmp/home" CLAUDE_PROFILES="$tmp/config"
unset CLAUDE_AS_PROFILE CLAUDE_CONFIG_DIR CLAUDE_PROFILE

mkdir -p "$HOME/.claude/skills" "$CLAUDE_PROFILES/work" "$tmp/bin"
echo '# shared' > "$HOME/.claude/CLAUDE.md"
echo '{"permissions": {"deny": ["Shared"]}}' > "$HOME/.claude/settings.local.json"
echo '# work rules' > "$CLAUDE_PROFILES/work/CLAUDE.md"
echo '{"permissions": {"deny": ["Artifact"]}, "env": {"WORK": "1"}}' > "$CLAUDE_PROFILES/work/settings.json"
cat > "$tmp/bin/claude" <<'EOF'
#!/usr/bin/env bash
printf 'dir=%s profile=%s args=%s\n' "${CLAUDE_CONFIG_DIR:-}" "${CLAUDE_PROFILE:-}" "$*"
EOF
chmod +x "$tmp/bin/claude"
export PATH="$tmp/bin:$PATH"

fails=0
expect() { [[ "$2" == *"$3"* ]] || { echo "FAIL $1: expected '$3' in: $2"; fails=$((fails + 1)); }; }
status() { set +e; "$@" >/dev/null 2>&1; echo $?; set -e; }

out="$("$script" Work -p hi)"
expect "named profile" "$out" "dir=$HOME/.claude-work profile=work args=--settings $HOME/.claude-work/settings.local.json -p hi"
expect "shared link" "$(readlink "$HOME/.claude-work/skills")" "$HOME/.claude/skills"
expect "CLAUDE.md layers" "$(cat "$HOME/.claude-work/CLAUDE.md")" "@~/.claude/CLAUDE.md
@$(dirname "$(dirname "$script")")/profile.md"
expect "CLAUDE.md own layer" "$(cat "$HOME/.claude-work/CLAUDE.md")" "@$CLAUDE_PROFILES/work/CLAUDE.md"
settings="$HOME/.claude-work/settings.local.json"
expect "settings merge deny" "$(jq -c .permissions.deny "$settings")" '["Artifact","Shared"]'
expect "settings env" "$(jq -c '.env | {WORK, CLAUDE_PROFILE}' "$settings")" '{"WORK":"1","CLAUDE_PROFILE":"work"}'

expect "default profile" "$(CLAUDE_AS_PROFILE=work "$script" -p hi)" "profile=work args=--settings"
expect "no default → plain" "$(CLAUDE_CONFIG_DIR="$HOME/.claude-work" CLAUDE_PROFILE=work "$script" -p hi)" "dir= profile= args=-p hi"
expect "-- ends the name" "$("$script" -- "a task")" "args=a task"
expect "list" "$("$script" --list)" "work"
expect "list marks default" "$(CLAUDE_AS_PROFILE=work "$script" --list)" "work *"

copy="$HOME/skillcopy/claude-as"
mkdir -p "$copy/scripts" && cp "$script" "$copy/scripts/" && echo '# how' > "$copy/profile.md"
"$copy/scripts/claude-as" work --link-only >/dev/null
expect "layer under HOME written with ~" "$(sed -n 3p "$HOME/.claude-work/CLAUDE.md")" "@~/skillcopy/claude-as/profile.md"

expect "install links" "$(PATH="$HOME/bin:$PATH" "$script" --install "$HOME/bin")" "$HOME/bin/claude-as → $script"
expect "install target" "$(readlink "$HOME/bin/claude-as")" "$script"
expect "install is idempotent" "$(status env PATH="$HOME/bin:$PATH" "$script" --install "$HOME/bin")" "0"
expect "install warns off PATH" "$("$script" --install "$HOME/elsewhere" 2>&1 || true)" "$HOME/elsewhere is not on PATH"
expect "install exits 1 off PATH" "$(status "$script" --install "$HOME/elsewhere")" "1"
mkdir -p "$HOME/realbin" && echo '# mine' > "$HOME/realbin/claude-as"
expect "install refuses a real file" "$(status "$script" --install "$HOME/realbin")" "1"
expect "install leaves it" "$(cat "$HOME/realbin/claude-as")" "# mine"

expect "link-only needs a name" "$(status "$script" --link-only)" "2"
expect "bad name" "$(status "$script" 'no/slash')" "2"

if [ "$fails" -ne 0 ]; then echo "claude-as: $fails failed"; exit 1; fi
echo "claude-as: all tests passed"
