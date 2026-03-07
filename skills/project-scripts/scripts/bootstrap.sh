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
#!/usr/bin/env bash
set -euo pipefail
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

print_summary() {
    local ecosystem="$1"
    echo ""
    echo "Created lifecycle scripts for $ecosystem:"
    echo "  scripts/setup    - install deps, link env"
    echo "  scripts/run      - start dev server"
    echo "  scripts/stop     - stop processes (stub)"
    echo "  scripts/archive  - clean up (stub)"
    echo ""
    echo "Review and customize each script, then wire into your runtime:"
    echo "  See: references/adapters.md"
}

# --- main ---

ecosystem="${1:-$(detect_ecosystem_from_lockfile)}"

abort_if_scripts_exist
mkdir -p scripts

setup_body="$(mise_setup_line)
$(install_command_for "$ecosystem")
$(env_copy_line)"

write_script setup "$setup_body"
write_script run "$(run_command_for "$ecosystem")"
write_script stop "# TODO: stop processes, clean transient state (must be idempotent)
# Example: pkill -f \"bun dev\" 2>/dev/null || true"
write_script archive "# Stop processes first (stop is idempotent, safe to call always)
[[ -x scripts/stop ]] && bash scripts/stop
$(archive_command_for "$ecosystem")"

chmod +x scripts/setup scripts/run scripts/stop scripts/archive

offer_conductor_json
print_summary "$ecosystem"
