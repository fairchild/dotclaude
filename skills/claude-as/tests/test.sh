#!/usr/bin/env bash
# Behavior tests for claude-as: a throwaway HOME, and a stub claude that prints what it was given.
set -euo pipefail

script="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)/scripts/claude-as"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
tmp="$(cd "$tmp" && pwd -P)"
export HOME="$tmp/home" CLAUDE_PROFILES="$tmp/config"
unset CLAUDE_AS_PROFILE CLAUDE_CONFIG_DIR CLAUDE_PROFILE CLAUDE_AS_ACCOUNT

mkdir -p "$HOME/.claude/skills" "$CLAUDE_PROFILES/work" "$tmp/bin"
echo '# shared' > "$HOME/.claude/CLAUDE.md"
echo '{"permissions": {"deny": ["Shared"]}, "env": {"CLAUDE_AS_ACCOUNT": "dave"}}' > "$HOME/.claude/settings.local.json"
echo '{"env": {"CLAUDE_AS_ACCOUNT": "dave@example.com"}}' > "$HOME/.claude/settings.json"
echo '{"oauthAccount": {"emailAddress": "dave@example.com"}}' > "$HOME/.claude.json"
mkdir -p "$HOME/.claude-work"
echo '{"oauthAccount": {"emailAddress": "Alice.Dev@example.com"}}' > "$HOME/.claude-work/.claude.json"
echo '# work rules' > "$CLAUDE_PROFILES/work/CLAUDE.md"
echo '{"permissions": {"deny": ["Artifact"]}, "env": {"WORK": "1", "CLAUDE_AS_ACCOUNT": "alice"}}' > "$CLAUDE_PROFILES/work/settings.json"
cat > "$tmp/bin/claude" <<'EOF'
#!/usr/bin/env bash
printf 'dir=%s profile=%s args=%s account=%s\n' "${CLAUDE_CONFIG_DIR:-}" "${CLAUDE_PROFILE:-}" "$*" "${CLAUDE_AS_ACCOUNT-unset}"
EOF
chmod +x "$tmp/bin/claude"
export PATH="$tmp/bin:$PATH"

fails=0
expect() { [[ "$2" == *"$3"* ]] || { echo "FAIL $1: expected '$3' in: $2"; fails=$((fails + 1)); }; }
refute() { [[ "$2" != *"$3"* ]] || { echo "FAIL $1: unexpected '$3' in: $2"; fails=$((fails + 1)); }; }
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

echo '{"oauthAccount": {"emailAddress": "erin@example.com"}}' > "$HOME/.claude.json"
mkdir -p "$CLAUDE_PROFILES/play"
echo '{"env": {"CLAUDE_AS_ACCOUNT": "bob@example.com"}}' > "$CLAUDE_PROFILES/play/settings.json"
"$script" play --link-only >/dev/null 2>&1
echo '{"oauthAccount": {"emailAddress": "carol@example.com"}}' > "$HOME/.claude-play/.claude.json"
"$script" solo --link-only >/dev/null 2>&1
list="$("$script" --list)"
row() { printf '%s\n' "$list" | grep "^$1" || true; }
expect "list shows the login" "$(row work)" "alice.dev"
refute "a dotted login matches its declared account" "$(row work)" "⚠"
expect "list flags a wrong login" "$(row play)" "carol  ⚠ expected bob"
expect "list shows a profile not signed in" "$(row solo)" "(not signed in)"
refute "no declaration, no flag" "$(row solo)" "⚠"
expect "list has plain claude" "$(row '(plain claude)')" "erin  ⚠ expected dave"
expect "declared account reaches the session" "$(jq -r .env.CLAUDE_AS_ACCOUNT "$HOME/.claude-work/settings.local.json")" "alice"
expect "plain claude's declaration stays out of a profile" "$(jq -c .env.CLAUDE_AS_ACCOUNT "$HOME/.claude-solo/settings.local.json")" '""'
launch="$("$script" play -p hi 2>&1)"
expect "launch warns on a wrong login" "$launch" "claude-as play is signed in as carol, not bob"
expect "launch still starts" "$launch" "profile=play args=--settings"
refute "a matching login launches quietly" "$("$script" work -p hi 2>&1)" "claude-as:"
mkdir -p "$CLAUDE_PROFILES/solo" && echo '{"env": {"CLAUDE_AS_ACCOUNT": "frank"}}' > "$CLAUDE_PROFILES/solo/settings.json"
expect "launch names a profile not signed in" "$("$script" solo -p hi 2>&1 >/dev/null)" "claude-as solo isn't signed in; /login as frank"
plain="$(CLAUDE_AS_ACCOUNT=bob "$script" -- hi 2>&1)"
expect "plain launch warns" "$plain" "plain claude is signed in as erin, not dave"
expect "plain launch drops an inherited account" "$plain" "account=unset"

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
