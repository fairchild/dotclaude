#!/usr/bin/env bash
# Installs the dotclaude mods (usage-meter, compaction) into a cloud environment's user settings.
# An environment's setup script runs: bash /home/user/dotclaude/mods/install-cloud.sh
#
# It copies mods/ as origin/main holds it (never the branch checked out) into
# ~/.claude/dotclaude-mods/, then merges the marketplace and the two plugins into
# ~/.claude/settings.json, keeping every other key. Git's messages and each step go to
# ~/.claude/dotclaude-mods.log. A failed copy leaves the folder empty and the settings untouched,
# so no mod loads half-installed. Running it again replaces the copy and rewrites the same keys.
#
# DOTCLAUDE_MODS_REF picks another ref to copy from (default origin/main), e.g. to try a branch.
set -uo pipefail

repo="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel 2>/dev/null)" || {
  echo "dotclaude mods: $(dirname "${BASH_SOURCE[0]}") is not inside a git clone; nothing installed" >&2
  exit 0
}
ref="${DOTCLAUDE_MODS_REF:-origin/main}"
mods="$HOME/.claude/dotclaude-mods"
log="$HOME/.claude/dotclaude-mods.log"
settings="$HOME/.claude/settings.json"

mkdir -p "$HOME/.claude"
rm -rf "$mods" && mkdir -p "$mods"
{
  date -u +%Y-%m-%dT%H:%M:%SZ
  echo "clone: $repo"
  echo "ref: $ref"
  if [[ "$ref" == origin/main ]]; then
    git -C "$repo" fetch -q origin main \
      || echo "dotclaude mods: could not fetch main; copying origin/main as the clone left it"
  fi
  git -C "$repo" rev-parse --verify "$ref^{commit}"
} >"$log" 2>&1

if ! git -C "$repo" archive "$ref" mods 2>>"$log" | tar -x -C "$mods" 2>>"$log" \
  || [[ ! -f "$mods/mods/.claude-plugin/marketplace.json" ]]; then
  rm -rf "$mods" && mkdir -p "$mods"
  echo "dotclaude mods: could not copy mods/ from $ref; no dotclaude mod will load" | tee -a "$log" >&2
  exit 0
fi
echo "copied: $mods/mods" >>"$log"

# shellcheck disable=SC2016 # the single-quoted script is JavaScript, expanded by node
if ! SETTINGS="$settings" MARKETPLACE="$mods/mods" node -e '
const fs = require("node:fs");
const file = process.env.SETTINGS;
const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
settings.extraKnownMarketplaces = {
  ...settings.extraKnownMarketplaces,
  "dotclaude-mods": { source: { source: "directory", path: process.env.MARKETPLACE } },
};
settings.enabledPlugins = {
  ...settings.enabledPlugins,
  "usage-meter@dotclaude-mods": true,
  "compaction@dotclaude-mods": true,
};
fs.writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
' 2>>"$log"; then
  echo "dotclaude mods: could not update $settings; the mods are copied but not enabled" | tee -a "$log" >&2
  exit 0
fi
echo "settings: $settings" >>"$log"
