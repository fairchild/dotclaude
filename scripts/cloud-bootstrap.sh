#!/usr/bin/env bash
# Layers this repo onto ~/.claude in a Claude Code cloud session's VM, where the machine's own
# ~/.claude never reaches; a cloud environment's setup script fetches and runs it as root. It
# installs the release bundle rather than cloning, because git has been seen to fail during setup,
# keeps only the settings that mean the same on a VM, and refuses to touch a real machine's
# runtime. DOTCLAUDE_SKILLS, names separated by spaces or commas, narrows the skills to those.
# Setup must exit 0, so every outcome lands in the status file instead.
set -u

bundle_url="${DOTCLAUDE_BUNDLE_URL:-https://github.com/fairchild/dotclaude/releases/download/cloud-latest/dotclaude-cloud.tar.gz}"
runtime="${DOTCLAUDE_RUNTIME:-$HOME/.claude}"
status="$runtime/cloud-bootstrap.status"
named_skills="${DOTCLAUDE_SKILLS:-}"
named_skills="${named_skills//,/ }"

main() {
  refuse_outside_a_cloud_vm

  work="$(mktemp -d)"
  trap 'rm -rf -- "$work"' EXIT
  mkdir "$work/bundle"

  or_report download download_bundle
  or_report unpack tar -xzf "$work/bundle.tar.gz" -C "$work/bundle"
  drop_machine_bound_skills
  keep_only_named_skills
  or_report copy install_bundle
  or_report settings merge_settings "$work/bundle/settings.example.json" "$runtime/settings.json"

  report "ok $(bundle_revision)$(unavailable_named_skills)"
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

install_bundle() {
  local entry
  mkdir -p "$runtime"
  for entry in CLAUDE.md agents commands hooks scripts skills; do
    cp -R "$work/bundle/$entry" "$runtime/" || return
  done
}

merge_settings() {
  local example="$1" target="$2"
  { cat "$target" 2>/dev/null || echo '{}'; } \
    | jq --slurpfile example "$example" '
        $example[0] as $carried
        | . + ($carried | {alwaysThinkingEnabled, effortLevel, skipWorkflowUsageWarning})
        | .env += ($carried.env | {CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS})
        | .permissions.deny = ((.permissions.deny // []) + $carried.permissions.deny | unique)
      ' >"$target.partial" \
    && mv "$target.partial" "$target" \
    || { rm -f "$target.partial"; return 1; }
}

bundle_revision() {
  cat "$work/bundle/REVISION" 2>/dev/null || echo unknown
}

unavailable_named_skills() {
  local name missing=""
  for name in $named_skills; do
    [[ -d "$work/bundle/skills/$name" ]] || missing+=" $name"
  done
  [[ -z "$missing" ]] || printf '; not installed:%s' "$missing"
}

main
