#!/usr/bin/env bash
set -euo pipefail

# Bootstrap project lifecycle scripts in the current directory.
# Usage: bash bootstrap.sh [ecosystem]
# If ecosystem is omitted, detects from lockfile.

# --- template generators (produce lines for the generated scripts) ---

detect_ecosystem_from_lockfile() {
    if [[ -f bun.lock || -f bun.lockb ]]; then echo "bun"
    elif [[ -f pnpm-lock.yaml ]]; then echo "pnpm"
    elif [[ -f package-lock.json ]]; then echo "npm"
    elif [[ -f uv.lock ]]; then echo "uv"
    elif [[ -f Cargo.lock ]]; then echo "cargo"
    else echo "unknown"
    fi
}

install_command_for() {
    case "$1" in
        bun)   echo "bun install" ;;
        pnpm)  echo "pnpm install" ;;
        npm)   echo "npm install" ;;
        uv)    echo "uv sync" ;;
        cargo) echo "cargo build" ;;
        *)     echo "# TODO: add setup commands for your project" ;;
    esac
}

run_command_for() {
    case "$1" in
        bun)   echo "bun dev" ;;
        pnpm)  echo "pnpm dev" ;;
        npm)   echo "npm run dev" ;;
        uv)    echo "uv run dev" ;;
        cargo) echo "cargo run" ;;
        *)     echo "# TODO: add run command" ;;
    esac
}

archive_command_for() {
    case "$1" in
        bun|pnpm|npm) echo "rm -rf node_modules" ;;
        uv)           echo "rm -rf .venv" ;;
        cargo)        echo "cargo clean" ;;
        *)            echo "# TODO: add archive commands" ;;
    esac
}

mise_setup_line() {
    if [[ -f .mise.toml ]]; then
        echo "mise trust && mise install"
    fi
}

env_copy_line() {
    echo '[[ -n "${CONDUCTOR_ROOT_PATH:-}" && -f "$CONDUCTOR_ROOT_PATH/.env" ]] && cp "$CONDUCTOR_ROOT_PATH/.env" .env'
}

# --- actions ---

abort_if_scripts_exist() {
    for action in setup run stop archive; do
        if [[ -f "scripts/$action" || -f "scripts/$action.sh" ]]; then
            echo "Found existing scripts/$action. Aborting to avoid clobbering."
            exit 1
        fi
    done
}

write_script() {
    local name="$1" body="$2"
    cat > "scripts/$name" <<EOF
$body
EOF
}

offer_conductor_json() {
    if [[ -f conductor.json ]]; then return; fi
    read -r -p "Create conductor.json? [y/N] " response 2>/dev/null || response="n"
    if [[ "$response" =~ ^[Yy]$ ]]; then
        cat > conductor.json <<'JSON'
{
  "scripts": {
    "setup": "bash scripts/setup",
    "run": "bash scripts/run",
    "stop": "bash scripts/stop",
    "archive": "bash scripts/archive"
  }
}
JSON
        echo "Created conductor.json"
    fi
}

add_mise_task_includes() {
    if [[ ! -f mise.toml ]] && [[ ! -f .mise.toml ]]; then return; fi
    local mise_file
    if [[ -f mise.toml ]]; then mise_file="mise.toml"; else mise_file=".mise.toml"; fi

    if grep -q 'task_config' "$mise_file" 2>/dev/null; then return; fi

    read -r -p "Add task_config.includes to $mise_file? [y/N] " response 2>/dev/null || response="n"
    if [[ "$response" =~ ^[Yy]$ ]]; then
        printf '\n[task_config]\nincludes = ["scripts"]\n' >> "$mise_file"
        echo "Added task_config.includes to $mise_file"
    fi
}

write_readme() {
    local ecosystem="$1"
    cat > scripts/README.md <<EOF
# Scripts

Lifecycle scripts for this project ($ecosystem ecosystem).

## Usage

\`\`\`bash
# With mise (recommended)
mise run setup

# Direct
bash scripts/setup
\`\`\`

## Available Scripts

| Script | Description |
|--------|-------------|
| \`setup\` | Install deps, link env |
| \`run\` | Start dev server |
| \`stop\` | Stop processes |
| \`archive\` | Teardown workspace (runs stop first) |
EOF
}

print_summary() {
    local ecosystem="$1"
    echo ""
    echo "Created lifecycle scripts for $ecosystem:"
    echo "  scripts/setup    - install deps, link env"
    echo "  scripts/run      - start dev server"
    echo "  scripts/stop     - stop processes (stub)"
    echo "  scripts/archive  - clean up"
    echo ""
    echo "Run with mise (recommended):  mise run setup"
    echo "Run directly:                 bash scripts/setup"
    echo ""
    echo "See: references/adapters.md for wiring into other runtimes"
}

# --- main ---

ecosystem="${1:-$(detect_ecosystem_from_lockfile)}"

abort_if_scripts_exist
mkdir -p scripts

setup_body="#!/usr/bin/env bash
#MISE description=\"Install deps, link env\"
set -euo pipefail
$(mise_setup_line)
$(install_command_for "$ecosystem")
$(env_copy_line)"

run_body="#!/usr/bin/env bash
#MISE description=\"Start dev server\"
set -euo pipefail
$(run_command_for "$ecosystem")"

stop_body='#!/usr/bin/env bash
#MISE description="Stop processes"
set -euo pipefail
# TODO: stop processes, clean transient state (must be idempotent)
# Example: pkill -f "bun dev" 2>/dev/null || true'

archive_body="#!/usr/bin/env bash
#MISE description=\"Teardown workspace\"
#MISE depends=[\"stop\"]
set -euo pipefail
# Stop processes first (defensive fallback for non-mise callers)
[[ -x scripts/stop ]] && bash scripts/stop
$(archive_command_for "$ecosystem")"

write_script setup "$setup_body"
write_script run "$run_body"
write_script stop "$stop_body"
write_script archive "$archive_body"
write_readme "$ecosystem"

chmod +x scripts/setup scripts/run scripts/stop scripts/archive

add_mise_task_includes
offer_conductor_json
print_summary "$ecosystem"
