#!/usr/bin/env bash
# Layers this repo onto ~/.claude in a Claude Code cloud session's VM, where the machine's own
# ~/.claude never reaches. A cloud environment's setup script fetches and runs this.
#
# It installs the release bundle rather than cloning: a release download from a repo the session
# isn't attached to works during setup, and GitHub credentials arrive only after setup. Setup
# must exit 0 or the session fails to start, so every outcome lands in the status file instead.
set -u

bundle_url="${DOTCLAUDE_BUNDLE_URL:-https://github.com/fairchild/dotclaude/releases/download/cloud-latest/dotclaude-cloud.tar.gz}"
runtime="${DOTCLAUDE_RUNTIME:-$HOME/.claude}"
status="$runtime/cloud-bootstrap.status"

report() {
  mkdir -p "$runtime"
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" | tee "$status"
}

# Setup runs as root on Linux, which a machine with a real ~/.claude doesn't, and a clone at the
# runtime path is that machine's deploy. Neither is ever written into. The setup script's own
# exit 0 keeps a refusal from stopping a session.
if [[ -z "${DOTCLAUDE_RUNTIME:-}" && ( "$(uname -s)" != Linux || "$EUID" -ne 0 ) ]]; then
  echo "cloud-bootstrap: this is for a cloud session's VM; refusing to touch $runtime" >&2
  exit 1
fi
if [[ -e "$runtime/.git" ]]; then
  echo "cloud-bootstrap: $runtime is a git clone; refusing to layer over it" >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

if ! curl --fail --silent --show-error --location --retry 1 --max-time 40 \
  -o "$work/bundle.tar.gz" "$bundle_url" 2>"$work/error"; then
  report "failed: download: $(tail -n 1 "$work/error")"
  exit 0
fi
mkdir "$work/bundle"
if ! tar -xzf "$work/bundle.tar.gz" -C "$work/bundle" 2>"$work/error"; then
  report "failed: unpack: $(tail -n 1 "$work/error")"
  exit 0
fi

# A machine-bound skill needs state only its machine has, so it would only mislead here.
for skill in "$work"/bundle/skills/*/; do
  if grep -q '^ *portability: machine-bound' "$skill/SKILL.md" 2>/dev/null; then
    rm -rf -- "$skill"
  fi
done

mkdir -p "$runtime"
for entry in CLAUDE.md agents commands hooks scripts skills; do
  if ! cp -R "$work/bundle/$entry" "$runtime/" 2>"$work/error"; then
    report "failed: copy $entry: $(tail -n 1 "$work/error")"
    exit 0
  fi
done

# Only what means the same on a VM carries over. The hooks, status line and display settings all
# assume this machine's tools, paths and credentials.
if ! python3 - "$work/bundle/settings.example.json" "$runtime/settings.json" 2>"$work/error" <<'PY'
import json
import sys
from pathlib import Path

example = json.loads(Path(sys.argv[1]).read_text())
target = Path(sys.argv[2])
settings = json.loads(target.read_text()) if target.exists() else {}

for key in ("alwaysThinkingEnabled", "effortLevel", "skipWorkflowUsageWarning"):
    settings[key] = example[key]
env = settings.setdefault("env", {})
for key in ("CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY", "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"):
    env[key] = example["env"][key]
permissions = settings.setdefault("permissions", {})
permissions["deny"] = list(dict.fromkeys(permissions.get("deny", []) + example["permissions"]["deny"]))

partial = target.with_suffix(".json.partial")
partial.write_text(json.dumps(settings, indent=2) + "\n")
partial.replace(target)
PY
then
  report "failed: settings: $(tail -n 1 "$work/error")"
  exit 0
fi

report "ok $(cat "$work/bundle/REVISION" 2>/dev/null || echo unknown)"
