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

grep -q ' ok test-revision; mods: usage-meter compaction; plugins: shipyard$' "$runtime/cloud-bootstrap.status" \
  || fail "status: $(cat "$runtime/cloud-bootstrap.status")"
[[ -s "$runtime/CLAUDE.md" ]] || fail "CLAUDE.md missing"
[[ -f "$runtime/skills/tight-docs/SKILL.md" ]] || fail "a portable skill is missing"
[[ ! -e "$runtime/skills/signoz-log" ]] || fail "a machine-bound skill was installed"
[[ "$(cat "$runtime/projects/session.jsonl")" == keep ]] || fail "existing runtime state was disturbed"

settings="$runtime/settings.json"
expect() {
  local args=()
  while [[ "$1" == --arg ]]; do args+=("$1" "$2" "$3"); shift 3; done
  # ${args[@]+...} because bash 3.2 — macOS's /bin/bash — calls an empty array unbound under
  # set -u, and most calls here pass no --arg at all.
  jq -e ${args[@]+"${args[@]}"} "$1" "$settings" >/dev/null || fail "$2"
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
expect '.enabledPlugins["shipyard@dotclaude"]' "a bundled plugin was not enabled"
expect '.env | has("CLAUDE_CODE_AUTO_COMPACT_WINDOW", "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE") | not' \
  "auto-compaction was set without being asked for"
# One marketplace holds both kinds, each flattened to the directory root whatever it was called in
# the source tree, so a plugin ID here matches a machine that added the marketplace from GitHub.
jq -e '[.plugins[] | {name, source}] == [{"name": "usage-meter", "source": "./usage-meter"}, {"name": "compaction", "source": "./compaction"}, {"name": "shipyard", "source": "./shipyard"}]' \
  "$runtime/mods/.claude-plugin/marketplace.json" >/dev/null || fail "the marketplace lists the wrong plugins"
[[ -f "$runtime/mods/shipyard/skills/reviewer/SKILL.md" ]] || fail "a bundled plugin's skills are missing"
if command -v claude >/dev/null; then
  for plugin in usage-meter compaction shipyard; do
    claude plugin validate "$runtime/mods/$plugin" >/dev/null 2>&1 \
      || fail "the installed $plugin does not validate"
  done
fi

# Running it again, as a rebuilt environment cache does, changes nothing about the result.
bootstrap "file://$bundle" "$runtime"
expect '.permissions.deny | length == (unique | length)' "a second run duplicated deny rules"

# Named mods narrow the install, "none" installs none, and a mod left out is no longer listed.
DOTCLAUDE_MODS="usage-meter not-a-mod" bootstrap "file://$bundle" "$runtime"
grep -q '; mods: usage-meter; mods not installed: not-a-mod; plugins skipped: shipyard needs compaction$' "$runtime/cloud-bootstrap.status" \
  || fail "status: $(cat "$runtime/cloud-bootstrap.status")"
[[ ! -e "$runtime/mods/compaction" ]] || fail "a mod that wasn't named stayed installed"
# Named plugins narrow the same way, and a name the bundle does not carry is reported rather than
# silently dropped. DOTCLAUDE_MODS is unset here, so the mods are untouched.
picked_plugins="$tmp/picked-plugins/.claude"
DOTCLAUDE_PLUGINS="shipyard not-a-plugin" bootstrap "file://$bundle" "$picked_plugins"
grep -q '; plugins: shipyard; plugins not installed: not-a-plugin$' "$picked_plugins/cloud-bootstrap.status" \
  || fail "status: $(cat "$picked_plugins/cloud-bootstrap.status")"
[[ -d "$picked_plugins/mods/shipyard" ]] || fail "a named plugin was not installed"

# "none" leaves the plugins out without touching the mods, which is the point of two switches.
no_plugins="$tmp/no-plugins/.claude"
DOTCLAUDE_PLUGINS=none bootstrap "file://$bundle" "$no_plugins"
[[ ! -e "$no_plugins/mods/shipyard" ]] || fail "DOTCLAUDE_PLUGINS=none installed a plugin"
[[ -d "$no_plugins/mods/compaction" ]] || fail "DOTCLAUDE_PLUGINS=none took the mods with it"
grep -q '; mods: usage-meter compaction$' "$no_plugins/cloud-bootstrap.status" \
  || fail "status: $(cat "$no_plugins/cloud-bootstrap.status")"
jq -e '.enabledPlugins | has("shipyard@dotclaude") | not' "$no_plugins/settings.json" >/dev/null \
  || fail "a plugin that was not installed was still enabled"

# A plugin that declares dependencies does not load without them, so narrowing the mods away takes
# the plugin with it rather than leaving one installed and enabled that cannot start. The status
# line says which dependency was missing. "none" for the mods here leaves nothing at all, so there
# is no marketplace to register.
none="$tmp/none/.claude"
DOTCLAUDE_MODS=none bootstrap "file://$bundle" "$none"
grep -q '; plugins skipped: shipyard needs compaction usage-meter$' "$none/cloud-bootstrap.status" \
  || fail "status: $(cat "$none/cloud-bootstrap.status")"
[[ ! -e "$none/mods" ]] || fail "DOTCLAUDE_MODS=none installed something"
jq -e 'has("extraKnownMarketplaces") | not' "$none/settings.json" >/dev/null \
  || fail "none still registered a marketplace"
jq -e '.enabledPlugins | has("shipyard@dotclaude") | not' "$none/settings.json" >/dev/null \
  || fail "a plugin whose dependencies are absent was still enabled"

# One dependency short counts the same, and the status names only the one that is missing.
partial="$tmp/partial/.claude"
DOTCLAUDE_MODS=compaction bootstrap "file://$bundle" "$partial"
grep -q '; mods: compaction; plugins skipped: shipyard needs usage-meter$' "$partial/cloud-bootstrap.status" \
  || fail "status: $(cat "$partial/cloud-bootstrap.status")"
[[ ! -e "$partial/mods/shipyard" ]] || fail "a plugin kept a dependency it did not have"
jq -e '[.plugins[].name] == ["compaction"]' "$partial/mods/.claude-plugin/marketplace.json" >/dev/null \
  || fail "the marketplace lists a plugin that was not installed"

# Auto-compaction is set only when the environment names it. The mod's goal is a default target
# the thread may run past up to the engine's point: a window at or under 300,000 is the goal too,
# a wider one leaves the goal at 300,000 and the gap as room, and DOTCLAUDE_COMPACT_GOAL names it.
compact="$tmp/compact/.claude"
DOTCLAUDE_COMPACT_WINDOW=300000 DOTCLAUDE_COMPACT_PCT=100 bootstrap "file://$bundle" "$compact"
jq -e '.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW == "300000" and .env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE == "100"' \
  "$compact/settings.json" >/dev/null || fail "auto-compaction was not set"
jq -e '.pluginConfigs.compaction.goalTokens == 300000' \
  "$compact/settings.json" >/dev/null || fail "the compaction goal did not follow a 300,000 window"
roomy="$tmp/roomy/.claude"
DOTCLAUDE_COMPACT_WINDOW=700000 bootstrap "file://$bundle" "$roomy"
jq -e '.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW == "700000" and .pluginConfigs.compaction.goalTokens == 300000' \
  "$roomy/settings.json" >/dev/null || fail "a wide window moved the goal past its 300,000 default"
named="$tmp/named/.claude"
DOTCLAUDE_COMPACT_WINDOW=700000 DOTCLAUDE_COMPACT_GOAL=400000 bootstrap "file://$bundle" "$named"
jq -e '.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW == "700000" and .pluginConfigs.compaction.goalTokens == 400000' \
  "$named/settings.json" >/dev/null || fail "DOTCLAUDE_COMPACT_GOAL did not set the goal apart from the window"
jq -e 'has("pluginConfigs") | not' "$none/settings.json" >/dev/null \
  || fail "a goal was set for a run with no mods"

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
grep -q ' ok test-revision; not installed: image-generator signoz-log; mods: usage-meter compaction; plugins: shipyard$' "$picked/cloud-bootstrap.status" \
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
