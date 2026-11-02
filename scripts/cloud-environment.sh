#!/bin/bash
# The baseline setup script for a claude.ai cloud environment, as pasted whole into the
# environment's settings (Setup script). This file is the copy of record: a change lands here by
# pull request first, then each environment's copy is updated by pasting it again. A cached
# environment does not rerun its setup script, so a change takes effect once the environment is
# rebuilt.
#
# It provisions the user level only: the dotclaude mods from the repository's GitHub marketplace,
# and the auto-compaction settings their thresholds assume (mods/README.md). A repository's own
# setup belongs in its SessionStart hook, and an environment's own tools go in the last section.
#
# Parameters: edit the defaults below in the pasted copy, or set the variable when running it
# (`AUTO_COMPACT_WINDOW= AUTO_COMPACT_PCT= bash scripts/cloud-environment.sh` installs only the
# mods, as on a laptop). An empty value skips its step.
set -u

# The marketplace and the ref it tracks: a branch, tag or commit; main is what has been reviewed.
DOTCLAUDE_REPO="${DOTCLAUDE_REPO-fairchild/dotclaude}"
DOTCLAUDE_REF="${DOTCLAUDE_REF-main}"
# Plugins from that marketplace, by name; append one to enable it in every session here.
DOTCLAUDE_PLUGINS="${DOTCLAUDE_PLUGINS-usage-meter compaction}"
# Compaction lands at min((W - 20000) * P / 100, W - 33000): 267k for these values.
AUTO_COMPACT_WINDOW="${AUTO_COMPACT_WINDOW-300000}"
AUTO_COMPACT_PCT="${AUTO_COMPACT_PCT-100}"

# The cloud image's install folders, after whatever the Setup step's PATH already holds.
PATH="$PATH:/opt/claude-code/bin:/opt/node22/bin"

log="$HOME/.claude/dotclaude-setup.log"
mkdir -p "$HOME/.claude"
date -u +%Y-%m-%dT%H:%M:%SZ >>"$log"

# Mods. The CLI merges the marketplace and each plugin into ~/.claude/settings.json and installs
# each plugin whole or not at all; running before any session, they load from the first one.
if [[ -n "$DOTCLAUDE_PLUGINS" ]]; then
  source_ref="$DOTCLAUDE_REPO"
  [[ "$DOTCLAUDE_REF" != main ]] && source_ref="$DOTCLAUDE_REPO@$DOTCLAUDE_REF"
  installed=true
  claude plugin marketplace add "$source_ref" </dev/null >>"$log" 2>&1 || installed=false
  for plugin in $DOTCLAUDE_PLUGINS; do
    $installed || break
    claude plugin install "$plugin@dotclaude" </dev/null >>"$log" 2>&1 || installed=false
  done
  $installed || echo "dotclaude setup: mods not installed; see $log" | tee -a "$log" >&2
fi

# Auto-compaction, merged into the user settings' env. A repository's .claude/settings.json can
# still set its own values, which take precedence over these.
if [[ -n "$AUTO_COMPACT_WINDOW$AUTO_COMPACT_PCT" ]]; then
  # shellcheck disable=SC2016 # the single-quoted script is JavaScript, expanded by node
  WINDOW="$AUTO_COMPACT_WINDOW" PCT="$AUTO_COMPACT_PCT" node -e '
const fs = require("node:fs");
const file = `${process.env.HOME}/.claude/settings.json`;
const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
const env = { ...settings.env };
if (process.env.WINDOW) env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = process.env.WINDOW;
if (process.env.PCT) env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = process.env.PCT;
fs.writeFileSync(file, `${JSON.stringify({ ...settings, env }, null, 2)}\n`);
' >>"$log" 2>&1 || echo "dotclaude setup: auto-compaction not set; see $log" | tee -a "$log" >&2
fi

# Environment-specific steps go below this line: toolchains, images, browsers. Keep each one
# idempotent and let it fail without stopping the rest; start long ones with `&`.

wait
exit 0
