#!/bin/bash
# Bootstrap a new AI teammate in ~/.ai-memory/<name>/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
TEMPLATE_DIR="$SKILL_DIR/templates"
MEMORY_DIR="${AI_MEMORY_DIR:-$HOME/.ai-memory}"
SETTINGS="$HOME/.claude/settings.json"

usage() {
  echo "Usage: $0 <teammate-name>"
  echo ""
  echo "Bootstrap a new AI teammate with persistent memory."
  echo "Creates ~/.ai-memory/<name>/ with personality, memory, and CLAUDE.md."
  exit 1
}

NAME="${1:-}"
[ -z "$NAME" ] && usage

# Validate name (alphanumeric + hyphens)
if [[ ! "$NAME" =~ ^[a-z][a-z0-9-]*$ ]]; then
  echo "Error: Name must be lowercase alphanumeric with hyphens (e.g., bertram, code-oracle)"
  exit 1
fi

PERSONA_DIR="$MEMORY_DIR/$NAME"

if [ -d "$PERSONA_DIR" ]; then
  echo "Error: Teammate '$NAME' already exists at $PERSONA_DIR"
  exit 1
fi

DATE=$(date +%Y-%m-%d)

# Template interpolation
interpolate() {
  sed -e "s/{{NAME}}/$NAME/g" -e "s/{{DATE}}/$DATE/g" "$1"
}

echo "Creating teammate: $NAME"

# Create directory structure
mkdir -p "$PERSONA_DIR/core" "$PERSONA_DIR/archival" "$PERSONA_DIR/recall"

# Copy and interpolate templates
interpolate "$TEMPLATE_DIR/CLAUDE.md.tmpl" > "$PERSONA_DIR/CLAUDE.md"
interpolate "$TEMPLATE_DIR/personality.md.tmpl" > "$PERSONA_DIR/personality.md"
interpolate "$TEMPLATE_DIR/relationship.md.tmpl" > "$PERSONA_DIR/relationship.md"

# Seed core/ with empty starter files
cat > "$PERSONA_DIR/core/decisions.md" << 'EOF'
---
type: decision
confidence: 1.0
source: system
created: DATEPLACEHOLDER
updated: DATEPLACEHOLDER
tags: [meta]
---

No decisions recorded yet. This file will be populated as the teammate
learns about key decisions and their rationale.
EOF
sed -i '' "s/DATEPLACEHOLDER/$DATE/g" "$PERSONA_DIR/core/decisions.md" 2>/dev/null || \
sed -i "s/DATEPLACEHOLDER/$DATE/g" "$PERSONA_DIR/core/decisions.md"

cat > "$PERSONA_DIR/core/patterns.md" << 'EOF'
---
type: pattern
confidence: 1.0
source: system
created: DATEPLACEHOLDER
updated: DATEPLACEHOLDER
tags: [meta]
---

No patterns recorded yet. This file will be populated as the teammate
discovers recurring patterns in projects and workflows.
EOF
sed -i '' "s/DATEPLACEHOLDER/$DATE/g" "$PERSONA_DIR/core/patterns.md" 2>/dev/null || \
sed -i "s/DATEPLACEHOLDER/$DATE/g" "$PERSONA_DIR/core/patterns.md"

# Create shared/ if it doesn't exist
if [ ! -d "$MEMORY_DIR/shared" ]; then
  echo "Creating shared knowledge directory..."
  mkdir -p "$MEMORY_DIR/shared"
  interpolate "$TEMPLATE_DIR/human.md.tmpl" > "$MEMORY_DIR/shared/human.md"

  cat > "$MEMORY_DIR/shared/projects.md" << 'EOF'
# Shared Project Context

Projects and context shared across all teammates.

(Add project notes here as you work together.)
EOF

  cat > "$MEMORY_DIR/shared/conventions.md" << 'EOF'
# Shared Conventions

Coding and workflow conventions shared across all teammates.

(Add conventions here as you discover them.)
EOF
fi

# Set active symlink if this is the first teammate
EXISTING=$(find "$MEMORY_DIR" -maxdepth 1 -mindepth 1 -type d ! -name shared 2>/dev/null | wc -l | tr -d ' ')
if [ "$EXISTING" -le 1 ] || [ ! -L "$MEMORY_DIR/active" ]; then
  echo "Setting $NAME as active teammate..."
  ln -sfn "$NAME" "$MEMORY_DIR/active"
fi

# Wire SessionEnd hook if not already present
if command -v jq &>/dev/null; then
  # Check if hook already exists
  if ! jq -e '.hooks.SessionEnd[]? | select(.hooks[]?.command | test("team-memory-sleep"))' "$SETTINGS" &>/dev/null; then
    echo "Wiring SessionEnd hook for sleep-time compute..."
    HOOK_JSON=$(mktemp)
    cat > "$HOOK_JSON" << 'HOOKEOF'
{"hooks":[{"type":"command","command":"[ -n \"$AI_MEMORY_PERSONA\" ] && CLAUDECODE= claude --agent team-memory-sleep --print \"Run sleep-time compute for persona $AI_MEMORY_PERSONA\" || true"}]}
HOOKEOF
    jq --slurpfile hook "$HOOK_JSON" '.hooks.SessionEnd += $hook' "$SETTINGS" > "${SETTINGS}.tmp"
    mv "${SETTINGS}.tmp" "$SETTINGS"
    rm -f "$HOOK_JSON"
  fi
else
  echo ""
  echo "Note: jq not found. Add this SessionEnd hook to ~/.claude/settings.json manually."
  echo "See ~/.claude/skills/team-memory/references/design.md for the hook configuration."
fi

echo ""
echo "Teammate '$NAME' created at $PERSONA_DIR"
echo ""
echo "Next steps:"
echo "  1. Edit $PERSONA_DIR/personality.md to define identity"
echo "  2. Edit $MEMORY_DIR/shared/human.md with your info"
echo "  3. Launch: ~/.claude/skills/team-memory/scripts/launch.sh --persona $NAME"
echo "  4. Or alias: alias claude-$NAME='~/.claude/skills/team-memory/scripts/launch.sh --persona $NAME'"
