#!/bin/bash
# Bootstrap a new AI teammate in ~/.ai-memory/<name>/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
TEMPLATE_DIR="$SKILL_DIR/templates"
MEMORY_DIR="${AI_MEMORY_DIR:-$HOME/.ai-memory}"
SETTINGS="$HOME/.claude/settings.json"
TEAM_MEMORY_HOOK_COMMAND="~/.claude/skills/team-memory/scripts/session-end.sh"
TEAM_MEMORY_AGENT_SOURCE="$SKILL_DIR/agents/team-memory-sleep.md"
TEAM_MEMORY_AGENT_DEST="$HOME/.claude/agents/team-memory-sleep.md"

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

# Generate default theme.json
cat > "$PERSONA_DIR/theme.json" << 'EOF'
{
  "icon": "🤖",
  "color": "#36B5A0",
  "tagline": ""
}
EOF

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
fi

if [ ! -f "$MEMORY_DIR/shared/human.md" ]; then
  interpolate "$TEMPLATE_DIR/human.md.tmpl" > "$MEMORY_DIR/shared/human.md"
fi

if [ ! -f "$MEMORY_DIR/shared/projects.md" ]; then
  cat > "$MEMORY_DIR/shared/projects.md" << 'EOF'
# Shared Project Context

Projects and context shared across all teammates.

(Add project notes here as you work together.)
EOF
fi

if [ ! -f "$MEMORY_DIR/shared/conventions.md" ]; then
  cat > "$MEMORY_DIR/shared/conventions.md" << 'EOF'
# Shared Conventions

Coding and workflow conventions shared across all teammates.

(Add conventions here as you discover them.)
EOF
fi

if [ ! -f "$MEMORY_DIR/shared/platform.md" ]; then
  cat > "$MEMORY_DIR/shared/platform.md" << 'EOF'
# Shared Platform Context

Platform-level details shared across all teammates.

- OS:
- Shell:
- Toolchain:
- Infrastructure:
EOF
fi

# Set active symlink if this is the first teammate
EXISTING=$(find "$MEMORY_DIR" -maxdepth 1 -mindepth 1 -type d ! -name shared 2>/dev/null | wc -l | tr -d ' ')
if [ "$EXISTING" -le 1 ] || [ ! -L "$MEMORY_DIR/active" ]; then
  echo "Setting $NAME as active teammate..."
  ln -sfn "$NAME" "$MEMORY_DIR/active"
fi

# Ensure settings file exists so hook wiring works in fresh environments
mkdir -p "$(dirname "$SETTINGS")"
if [ ! -f "$SETTINGS" ]; then
  cat > "$SETTINGS" << 'EOF'
{
  "hooks": {
    "SessionEnd": []
  }
}
EOF
fi

# Install/update the global sleep orchestrator from the skill-local copy.
if [ -f "$TEAM_MEMORY_AGENT_SOURCE" ]; then
  mkdir -p "$(dirname "$TEAM_MEMORY_AGENT_DEST")"
  if ! cmp -s "$TEAM_MEMORY_AGENT_SOURCE" "$TEAM_MEMORY_AGENT_DEST" 2>/dev/null; then
    cp "$TEAM_MEMORY_AGENT_SOURCE" "$TEAM_MEMORY_AGENT_DEST"
  fi
fi

# Wire SessionEnd hook if not already present
if command -v jq &>/dev/null; then
  # Check if hook already exists.
  if ! jq -e --arg cmd "$TEAM_MEMORY_HOOK_COMMAND" \
    '[.hooks.SessionEnd[]?.hooks[]? | (.command // empty)] | any(. == $cmd)' \
    "$SETTINGS" &>/dev/null; then
    echo "Wiring SessionEnd hook for sleep-time compute..."
    jq --arg cmd "$TEAM_MEMORY_HOOK_COMMAND" \
      '(.hooks //= {}) | (.hooks.SessionEnd //= []) | .hooks.SessionEnd += [{"hooks":[{"type":"command","command":$cmd}]}]' \
      "$SETTINGS" > "${SETTINGS}.tmp"
    mv "${SETTINGS}.tmp" "$SETTINGS"
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
echo "  1. Edit $PERSONA_DIR/theme.json to set icon, color, tagline"
echo "  2. Edit $PERSONA_DIR/personality.md to define identity"
echo "  3. Edit $MEMORY_DIR/shared/human.md with your info"
echo "  4. Launch: ~/.claude/skills/team-memory/scripts/launch.sh --persona $NAME"
echo "  5. Or alias: alias claude-$NAME='~/.claude/skills/team-memory/scripts/launch.sh --persona $NAME'"
