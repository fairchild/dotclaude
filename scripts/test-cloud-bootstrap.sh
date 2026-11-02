#!/usr/bin/env bash
#MISE description="Exercise the cloud bootstrap against a bundle built from this checkout"
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

bundle="$tmp/bundle.tar.gz"
git -C "$ROOT" archive --add-virtual-file=REVISION:test-revision --format=tar.gz -o "$bundle" \
  HEAD CLAUDE.md agents commands hooks scripts skills settings.example.json

bootstrap() {
  DOTCLAUDE_BUNDLE_URL="$1" DOTCLAUDE_RUNTIME="$2" bash "$ROOT/scripts/cloud-bootstrap.sh" >/dev/null 2>&1
}

# A VM's runtime gets the bundle, keeps what is already there, and drops what can't work.
runtime="$tmp/vm/.claude"
mkdir -p "$runtime/projects"
echo keep > "$runtime/projects/session.jsonl"
printf '{"enabledPlugins": {"meter@local": true}, "env": {"KEEP": "1"}}\n' > "$runtime/settings.json"
bootstrap "file://$bundle" "$runtime"

grep -q ' ok test-revision$' "$runtime/cloud-bootstrap.status" || fail "status: $(cat "$runtime/cloud-bootstrap.status")"
[[ -s "$runtime/CLAUDE.md" ]] || fail "CLAUDE.md missing"
[[ -f "$runtime/skills/tight-docs/SKILL.md" ]] || fail "a portable skill is missing"
[[ ! -e "$runtime/skills/signoz-log" ]] || fail "a machine-bound skill was installed"
[[ "$(cat "$runtime/projects/session.jsonl")" == keep ]] || fail "existing runtime state was disturbed"

python3 - "$runtime/settings.json" <<'PY'
import json
import sys

settings = json.load(open(sys.argv[1]))
assert settings["enabledPlugins"] == {"meter@local": True}, "existing keys must survive"
assert settings["env"]["KEEP"] == "1", "existing env must survive"
assert settings["effortLevel"], "preferences must carry over"
assert "Read(.env)" in settings["permissions"]["deny"], "deny rules must carry over"
for key in ("hooks", "statusLine", "voice", "theme", "extraKnownMarketplaces"):
    assert key not in settings, f"{key} assumes the local machine"
PY

# Running it again, as a rebuilt environment cache does, changes nothing about the result.
bootstrap "file://$bundle" "$runtime"
python3 -c 'import json, sys; d = json.load(open(sys.argv[1])); assert len(d["permissions"]["deny"]) == len(set(d["permissions"]["deny"]))' \
  "$runtime/settings.json" || fail "a second run duplicated deny rules"

# A failed download still exits 0, so the session starts, and says what failed.
offline="$tmp/offline/.claude"
bootstrap "file://$tmp/missing.tar.gz" "$offline" || fail "a failed download must exit 0"
grep -q ' failed: download: ' "$offline/cloud-bootstrap.status" || fail "the download failure was not recorded"
[[ ! -e "$offline/CLAUDE.md" ]] || fail "a failed download left files behind"

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
