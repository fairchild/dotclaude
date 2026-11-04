#!/usr/bin/env bash
# Layers this repo onto ~/.claude in a Claude Code cloud session's VM, where the machine's own
# ~/.claude never reaches; a cloud environment's setup script fetches and runs it as root. It
# installs the release bundle rather than cloning, because git has been seen to fail during setup,
# keeps only the settings that mean the same on a VM, and refuses to touch a real machine's
# runtime. DOTCLAUDE_SKILLS, names separated by spaces or commas, narrows the skills to those;
# DOTCLAUDE_MODS does the same for the mods (mods/README.md) and DOTCLAUDE_PLUGINS for the
# multi-component plugins (.claude-plugin/plugins/); "none" installs none of that kind. Both kinds
# register as one directory marketplace named dotclaude, so they load from the first session and a
# plugin ID matches a machine that added this repository's marketplace from GitHub.
# DOTCLAUDE_COMPACT_WINDOW and DOTCLAUDE_COMPACT_PCT, when set, decide when sessions auto-compact,
# and the window is also the compaction mod's goal, so the thread's point and the engine's
# backstop follow one number.
# Setup must exit 0, so every outcome lands in the status file instead.
set -u

bundle_url="${DOTCLAUDE_BUNDLE_URL:-https://github.com/fairchild/dotclaude/releases/download/cloud-latest/dotclaude-cloud.tar.gz}"
runtime="${DOTCLAUDE_RUNTIME:-$HOME/.claude}"
status="$runtime/cloud-bootstrap.status"

main() {
  refuse_outside_a_cloud_vm
  named_skills="$(as_name_list "${DOTCLAUDE_SKILLS:-}")"
  named_mods="$(as_name_list "${DOTCLAUDE_MODS:-}")"
  named_plugins="$(as_name_list "${DOTCLAUDE_PLUGINS:-}")"

  work="$(mktemp -d)"
  trap 'rm -rf -- "$work"' EXIT
  mkdir "$work/bundle"

  or_report download download_bundle
  or_report unpack tar -xzf "$work/bundle.tar.gz" -C "$work/bundle"
  drop_machine_bound_skills
  keep_only_named_skills
  keep_only_named_mods
  keep_only_named_plugins
  or_report copy install_bundle
  or_report mods install_marketplace
  or_report settings merge_settings "$work/bundle/settings.example.json" "$runtime/settings.json"

  report "ok $(bundle_revision)$(unavailable_named_skills)$(mods_note)$(plugins_note)"
}

refuse_outside_a_cloud_vm() {
  if [[ -z "${DOTCLAUDE_RUNTIME:-}" && ( "$(uname -s)" != Linux || "$EUID" -ne 0 ) ]]; then
    echo "cloud-bootstrap: this is for a cloud session's VM; refusing to touch $runtime" >&2
    exit 1
  fi
  if [[ -e "$runtime/.git" ]]; then
    echo "cloud-bootstrap: $runtime is a git clone; refusing to layer over it" >&2
    exit 1
  fi
}

as_name_list() {
  local names
  names="$(tr ',\t\n' '   ' <<<"$1" | tr -s ' ')"
  names="${names# }"
  printf '%s' "${names% }"
}

or_report() {
  local what="$1"
  shift
  if ! "$@" 2>"$work/error"; then
    report "failed: $what: $(tail -n 1 "$work/error")"
    exit 0
  fi
}

report() {
  mkdir -p "$runtime"
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" | tee "$status"
}

download_bundle() {
  curl --fail --silent --show-error --location --retry 1 --max-time 40 \
    -o "$work/bundle.tar.gz" "$bundle_url"
}

drop_machine_bound_skills() {
  local skill
  for skill in "$work"/bundle/skills/*/; do
    if grep -q '^ *portability: machine-bound' "$skill/SKILL.md" 2>/dev/null; then
      rm -rf -- "$skill"
    fi
  done
}

keep_only_named_skills() {
  local skill
  [[ -n "$named_skills" ]] || return 0
  for skill in "$work"/bundle/skills/*/; do
    is_named "$(basename "$skill")" || rm -rf -- "$skill"
  done
}

is_named() {
  [[ " $named_skills " == *" $1 "* ]]
}

keep_only_named_mods() {
  local mod
  [[ -n "$named_mods" && -d "$work/bundle/mods" ]] || return 0
  for mod in "$work"/bundle/mods/*/; do
    [[ -f "$mod/.claude-plugin/plugin.json" ]] || continue
    [[ "$named_mods" != none && " $named_mods " == *" $(basename "$mod") "* ]] || rm -rf -- "$mod"
  done
}

keep_only_named_plugins() {
  local plugin
  [[ -n "$named_plugins" && -d "$work/bundle/.claude-plugin/plugins" ]] || return 0
  for plugin in "$work"/bundle/.claude-plugin/plugins/*/; do
    [[ -f "$plugin/.claude-plugin/plugin.json" ]] || continue
    [[ "$named_plugins" != none && " $named_plugins " == *" $(basename "$plugin") "* ]] \
      || rm -rf -- "$plugin"
  done
}

bundled_plugins() {
  local plugin
  for plugin in "$work"/bundle/.claude-plugin/plugins/*/; do
    [[ -f "$plugin/.claude-plugin/plugin.json" ]] && basename "$plugin"
  done
  return 0
}

bundled_mods() {
  local mod
  for mod in "$work"/bundle/mods/*/; do
    [[ -f "$mod/.claude-plugin/plugin.json" ]] && basename "$mod"
  done
  return 0
}

# One directory marketplace named dotclaude holds everything bundled, so a plugin ID here is the
# same as on a machine that adds this repository's marketplace from GitHub. Each plugin sits at the
# root of that directory whatever it was called in the source tree: a mod from mods/, a
# multi-component plugin from .claude-plugin/plugins/. The directory keeps the name "mods" because
# it is a deployed path and the README's standalone install writes the same one — it is the
# marketplace root, not a claim that everything in it is a mod.
install_marketplace() {
  local mods plugins name
  rm -rf -- "$runtime/mods"
  mods="$(bundled_mods | tr '\n' ' ')"
  plugins="$(bundled_plugins | tr '\n' ' ')"
  [[ -n "${mods// /}" || -n "${plugins// /}" ]] || return 0
  mkdir -p "$runtime/mods/.claude-plugin"
  for name in $mods; do cp -R "$work/bundle/mods/$name" "$runtime/mods/" || return; done
  for name in $plugins; do
    cp -R "$work/bundle/.claude-plugin/plugins/$name" "$runtime/mods/" || return
  done
  # The marketplace does not record which kind a plugin came from, and the status line is the
  # operator's only window into what happened, so keep the two lists for it.
  printf '%s' "$mods" >"$work/installed-mods"
  printf '%s' "$plugins" >"$work/installed-plugins"
  jq --arg keep "$mods $plugins" '
      ($keep | split(" ") | map(select(length > 0))) as $keep
      | {name, owner, plugins: [.plugins[]
          | select(.source | startswith("./mods/") or startswith("./.claude-plugin/plugins/"))
          | select(.name as $n | $keep | index($n))
          | .source = "./" + (.source | split("/") | last)]}
    ' "$work/bundle/.claude-plugin/marketplace.json" >"$runtime/mods/.claude-plugin/marketplace.json"
}

install_bundle() {
  local entry
  mkdir -p "$runtime"
  for entry in CLAUDE.md agents commands hooks scripts skills; do
    cp -R "$work/bundle/$entry" "$runtime/" || return
  done
}

merge_settings() {
  local example="$1" target="$2" mods=""
  [[ -f "$runtime/mods/.claude-plugin/marketplace.json" ]] \
    && mods="$(jq -r '[.plugins[].name] | join(" ")' "$runtime/mods/.claude-plugin/marketplace.json")"
  { cat "$target" 2>/dev/null || echo '{}'; } \
    | jq --slurpfile example "$example" --arg mods "$mods" --arg path "$runtime/mods" \
        --arg window "${DOTCLAUDE_COMPACT_WINDOW:-}" --arg pct "${DOTCLAUDE_COMPACT_PCT:-}" '
        $example[0] as $carried
        | . + ($carried | {alwaysThinkingEnabled, effortLevel, skipWorkflowUsageWarning})
        | .env += ($carried.env | {CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS})
        | .permissions.deny = ((.permissions.deny // []) + $carried.permissions.deny | unique)
        | ($mods | split(" ") | map(select(length > 0))) as $installed
        | if ($installed | length) > 0 then
            .extraKnownMarketplaces.dotclaude = {source: {source: "directory", path: $path}}
            | .enabledPlugins += ($installed | map({key: "\(.)@dotclaude", value: true}) | from_entries)
          else . end
        | if $window != "" then .env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = $window else . end
        | if $pct != "" then .env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = $pct else . end
        | if $window != "" and ($installed | index("compaction")) and ($window | test("^[0-9]+$"))
          then .pluginConfigs.compaction.goalTokens = ($window | tonumber)
          else . end
      ' >"$target.partial" \
    && mv "$target.partial" "$target" \
    || { rm -f "$target.partial"; return 1; }
}

bundle_revision() {
  cat "$work/bundle/REVISION" 2>/dev/null || echo unknown
}

# Each kind reports its own group — what went in, then what was named and could not — so a missing
# mod is read next to the mods rather than after the plugins. Marketplace order, not glob order,
# so the mods read the same as they always have.
installed_of_kind() {
  local kind=$1 recorded name out=""
  recorded=" $(as_name_list "$(cat "$work/installed-$kind" 2>/dev/null)") "
  for name in $(jq -r '.plugins[].name' "$runtime/mods/.claude-plugin/marketplace.json" 2>/dev/null); do
    [[ "$recorded" == *" $name "* ]] && out+=" $name"
  done
  printf '%s' "$out"
}

mods_note() {
  local installed missing="" name
  installed="$(installed_of_kind mods)"
  [[ -z "$installed" ]] || printf '; mods:%s' "$installed"
  [[ "$named_mods" != none ]] || return 0
  for name in $named_mods; do
    [[ -d "$runtime/mods/$name" ]] || missing+=" $name"
  done
  [[ -z "$missing" ]] || printf '; mods not installed:%s' "$missing"
}

plugins_note() {
  local installed missing="" name
  installed="$(installed_of_kind plugins)"
  [[ -z "$installed" ]] || printf '; plugins:%s' "$installed"
  [[ "$named_plugins" != none ]] || return 0
  for name in $named_plugins; do
    [[ -d "$runtime/mods/$name" ]] || missing+=" $name"
  done
  [[ -z "$missing" ]] || printf '; plugins not installed:%s' "$missing"
}

unavailable_named_skills() {
  local name missing=""
  for name in $named_skills; do
    [[ -d "$work/bundle/skills/$name" ]] || missing+=" $name"
  done
  [[ -z "$missing" ]] || printf '; not installed:%s' "$missing"
}

main
