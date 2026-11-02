#!/usr/bin/env bash
#MISE description="Exercise the cloud bootstrap against a bundle built from this checkout"
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

bundle="$tmp/bundle.tar.gz"
git -C "$ROOT" archive --add-virtual-file=REVISION:test-revision --format=tar.gz -o "$bundle" \
  HEAD CLAUDE.md agents commands hooks scripts skills mods .claude-plugin settings.example.json

bootstrap() {
  DOTCLAUDE_BUNDLE_URL="$1" DOTCLAUDE_RUNTIME="$2" bash "$ROOT/scripts/cloud-bootstrap.sh" >/dev/null 2>&1
}

# A VM's runtime gets the bundle, keeps what is already there, and drops what can't work.
runtime="$tmp/vm/.claude"
mkdir -p "$runtime/projects"
echo keep > "$runtime/projects/session.jsonl"
printf '{"enabledPlugins": {"meter@local": true}, "env": {"KEEP": "1"}}\n' > "$runtime/settings.json"
bootstrap "file://$bundle" "$runtime"

grep -q ' ok test-revision; mods: usage-meter compaction$' "$runtime/cloud-bootstrap.status" \
  || fail "status: $(cat "$runtime/cloud-bootstrap.status")"
[[ -s "$runtime/CLAUDE.md" ]] || fail "CLAUDE.md missing"
[[ -f "$runtime/skills/tight-docs/SKILL.md" ]] || fail "a portable skill is missing"
[[ ! -e "$runtime/skills/signoz-log" ]] || fail "a machine-bound skill was installed"
[[ "$(cat "$runtime/projects/session.jsonl")" == keep ]] || fail "existing runtime state was disturbed"

settings="$runtime/settings.json"
expect() {
  local args=()
  while [[ "$1" == --arg ]]; do args+=("$1" "$2" "$3"); shift 3; done
  jq -e "${args[@]}" "$1" "$settings" >/dev/null || fail "$2"
}
expect '.enabledPlugins["meter@local"] == true' "existing keys must survive"
expect '.env.KEEP == "1"' "existing env must survive"
expect '.effortLevel | length > 0' "preferences must carry over"
expect '.permissions.deny | index("Read(.env)") != null' "deny rules must carry over"
expect '[has("hooks", "statusLine", "voice", "theme")] | any | not' \
  "a setting that assumes the local machine carried over"

# The mods install as a directory marketplace named dotclaude, every one enabled by default, and
# auto-compaction is left alone unless the environment names it.
expect --arg path "$runtime/mods" '.extraKnownMarketplaces == {"dotclaude": {"source": {"source": "directory", "path": $path}}}' \
  "the mods marketplace was not registered"
expect '.enabledPlugins["usage-meter@dotclaude"] and .enabledPlugins["compaction@dotclaude"]' "a mod was not enabled"
expect '.env | has("CLAUDE_CODE_AUTO_COMPACT_WINDOW", "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE") | not' \
  "auto-compaction was set without being asked for"
jq -e '[.plugins[] | {name, source}] == [{"name": "usage-meter", "source": "./usage-meter"}, {"name": "compaction", "source": "./compaction"}]' \
  "$runtime/mods/.claude-plugin/marketplace.json" >/dev/null || fail "the mods marketplace lists the wrong plugins"
if command -v claude >/dev/null; then
  for mod in usage-meter compaction; do
    claude plugin validate "$runtime/mods/$mod" >/dev/null 2>&1 || fail "the installed $mod does not validate"
  done
fi

# Running it again, as a rebuilt environment cache does, changes nothing about the result.
bootstrap "file://$bundle" "$runtime"
expect '.permissions.deny | length == (unique | length)' "a second run duplicated deny rules"

# Named mods narrow the install, "none" installs none, and a mod left out is no longer listed.
DOTCLAUDE_MODS="usage-meter not-a-mod" bootstrap "file://$bundle" "$runtime"
grep -q '; mods: usage-meter; mods not installed: not-a-mod$' "$runtime/cloud-bootstrap.status" \
  || fail "status: $(cat "$runtime/cloud-bootstrap.status")"
[[ ! -e "$runtime/mods/compaction" ]] || fail "a mod that wasn't named stayed installed"
none="$tmp/none/.claude"
DOTCLAUDE_MODS=none bootstrap "file://$bundle" "$none"
[[ ! -e "$none/mods" ]] || fail "DOTCLAUDE_MODS=none installed mods"
jq -e 'has("extraKnownMarketplaces") | not' "$none/settings.json" >/dev/null || fail "none still registered a marketplace"

# Auto-compaction is set only when the environment names it.
compact="$tmp/compact/.claude"
DOTCLAUDE_COMPACT_WINDOW=300000 DOTCLAUDE_COMPACT_PCT=100 bootstrap "file://$bundle" "$compact"
jq -e '.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW == "300000" and .env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE == "100"' \
  "$compact/settings.json" >/dev/null || fail "auto-compaction was not set"

# A bundle published before the mods joined it still installs everything else.
old_bundle="$tmp/old.tar.gz"
git -C "$ROOT" archive --add-virtual-file=REVISION:old-revision --format=tar.gz -o "$old_bundle" \
  HEAD CLAUDE.md agents commands hooks scripts skills settings.example.json
old="$tmp/old/.claude"
bootstrap "file://$old_bundle" "$old"
grep -q ' ok old-revision$' "$old/cloud-bootstrap.status" || fail "an older bundle: $(cat "$old/cloud-bootstrap.status")"

# A failed download still exits 0, so the session starts, and says what failed.
offline="$tmp/offline/.claude"
bootstrap "file://$tmp/missing.tar.gz" "$offline" || fail "a failed download must exit 0"
grep -q ' failed: download: ' "$offline/cloud-bootstrap.status" || fail "the download failure was not recorded"
[[ ! -e "$offline/CLAUDE.md" ]] || fail "a failed download left files behind"

# Named skills narrow the install to those alone, and a name it can't install is reported.
picked="$tmp/picked/.claude"
DOTCLAUDE_SKILLS="tight-docs, fable-session image-generator signoz-log" bootstrap "file://$bundle" "$picked"
[[ "$(ls "$picked/skills" | tr '\n' ' ')" == "fable-session tight-docs " ]] \
  || fail "named skills installed: $(ls "$picked/skills" | tr '\n' ' ')"
grep -q ' ok test-revision; not installed: image-generator signoz-log; mods: usage-meter compaction$' "$picked/cloud-bootstrap.status" \
  || fail "status: $(cat "$picked/cloud-bootstrap.status")"
[[ -s "$picked/CLAUDE.md" ]] || fail "naming skills dropped the rest of the bundle"

tabbed="$tmp/tabbed/.claude"
DOTCLAUDE_SKILLS=$'tight-docs\tfable-session\n' bootstrap "file://$bundle" "$tabbed"
[[ "$(ls "$tabbed/skills" | tr '\n' ' ')" == "fable-session tight-docs " ]] \
  || fail "tab and newline separated names installed: $(ls "$tabbed/skills" | tr '\n' ' ')"

separators="$tmp/separators/.claude"
DOTCLAUDE_SKILLS=" , " bootstrap "file://$bundle" "$separators"
[[ -f "$separators/skills/tight-docs/SKILL.md" ]] || fail "a list of only separators removed every skill"

# Settings it can't parse are left exactly as they were, with nothing half-written beside them.
broken="$tmp/broken/.claude"
mkdir -p "$broken"
printf 'not json\n' > "$broken/settings.json"
bootstrap "file://$bundle" "$broken" || fail "a settings failure must exit 0"
grep -q ' failed: settings: ' "$broken/cloud-bootstrap.status" || fail "the settings failure was not recorded"
[[ "$(cat "$broken/settings.json")" == "not json" ]] || fail "unparseable settings were rewritten"
[[ ! -e "$broken/settings.json.partial" ]] || fail "a failed merge left a partial file"

# A real machine's clone is never written into.
clone="$tmp/mac/.claude"
mkdir -p "$clone/.git"
printf 'mine\n' > "$clone/CLAUDE.md"
if bootstrap "file://$bundle" "$clone"; then fail "a refusal must say so"; fi
[[ "$(cat "$clone/CLAUDE.md")" == mine ]] || fail "a clone at the runtime path was overwritten"
[[ ! -e "$clone/cloud-bootstrap.status" ]] || fail "a clone at the runtime path was written to"

# With no runtime named, the real home directory is off limits outside a cloud VM. CI and laptops
# aren't root; as root on Linux this script can't tell that from a VM, so the case doesn't apply.
if [[ "$(uname -s)" != Linux || "$EUID" -ne 0 ]]; then
  local_home="$tmp/laptop"
  mkdir -p "$local_home/.claude"
  printf 'mine\n' > "$local_home/.claude/CLAUDE.md"
  if HOME="$local_home" DOTCLAUDE_BUNDLE_URL="file://$bundle" bash "$ROOT/scripts/cloud-bootstrap.sh" >/dev/null 2>&1; then
    fail "a local run must refuse"
  fi
  [[ "$(cat "$local_home/.claude/CLAUDE.md")" == mine ]] || fail "a local run overwrote the real runtime"
fi

echo "cloud bootstrap: ok"
