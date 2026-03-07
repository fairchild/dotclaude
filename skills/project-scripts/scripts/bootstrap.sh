#!/usr/bin/env bash
set -euo pipefail

# Bootstrap project lifecycle scripts in the current directory.
# Usage: bash bootstrap.sh [ecosystem]
# If ecosystem is omitted, detects from lockfile.

detect_ecosystem() {
    if [[ -f bun.lock || -f bun.lockb ]]; then echo "bun"
    elif [[ -f pnpm-lock.yaml ]]; then echo "pnpm"
    elif [[ -f package-lock.json ]]; then echo "npm"
    elif [[ -f uv.lock ]]; then echo "uv"
    elif [[ -f Cargo.lock ]]; then echo "cargo"
    else echo "unknown"
    fi
}

ECOSYSTEM="${1:-$(detect_ecosystem)}"

for action in setup run stop archive; do
    if [[ -f "scripts/$action" || -f "scripts/$action.sh" ]]; then
        echo "Found existing scripts/$action. Aborting to avoid clobbering."
        exit 1
    fi
done

mkdir -p scripts

has_mise() { [[ -f .mise.toml ]]; }
has_conductor_root() { echo '[[ -n "${CONDUCTOR_ROOT_PATH:-}" && -f "$CONDUCTOR_ROOT_PATH/.env" ]] && cp "$CONDUCTOR_ROOT_PATH/.env" .env'; }

# --- setup ---
setup_body=""
if has_mise; then
    setup_body+="mise trust && mise install"$'\n'
fi

case "$ECOSYSTEM" in
    bun)   setup_body+="bun install" ;;
    pnpm)  setup_body+="pnpm install" ;;
    npm)   setup_body+="npm install" ;;
    uv)    setup_body+="uv sync" ;;
    cargo) setup_body+="cargo build" ;;
    *)     setup_body+="# TODO: add setup commands for your project" ;;
esac

cat > scripts/setup <<EOF
#!/usr/bin/env bash
set -euo pipefail
$setup_body
$(has_conductor_root)
EOF

# --- run ---
case "$ECOSYSTEM" in
    bun)   run_cmd="bun dev" ;;
    pnpm)  run_cmd="pnpm dev" ;;
    npm)   run_cmd="npm run dev" ;;
    uv)    run_cmd="uv run dev" ;;
    cargo) run_cmd="cargo run" ;;
    *)     run_cmd="# TODO: add run command" ;;
esac

cat > scripts/run <<EOF
#!/usr/bin/env bash
set -euo pipefail
$run_cmd
EOF

# --- stop ---
cat > scripts/stop <<EOF
#!/usr/bin/env bash
set -euo pipefail
# TODO: stop processes, clean transient state
# Example: pkill -f "bun dev" 2>/dev/null || true
EOF

# --- archive ---
case "$ECOSYSTEM" in
    bun|pnpm|npm) archive_cmd="rm -rf node_modules" ;;
    uv)           archive_cmd="rm -rf .venv" ;;
    cargo)        archive_cmd="cargo clean" ;;
    *)            archive_cmd="# TODO: add archive commands" ;;
esac

cat > scripts/archive <<EOF
#!/usr/bin/env bash
set -euo pipefail
$archive_cmd
EOF

chmod +x scripts/setup scripts/run scripts/stop scripts/archive

# --- optional conductor.json ---
if [[ ! -f conductor.json ]]; then
    read -r -p "Create conductor.json? [y/N] " response 2>/dev/null || response="n"
    if [[ "$response" =~ ^[Yy]$ ]]; then
        cat > conductor.json <<'CONDUCTOR'
{
  "scripts": {
    "setup": "bash scripts/setup",
    "run": "bash scripts/run",
    "stop": "bash scripts/stop",
    "archive": "bash scripts/archive"
  }
}
CONDUCTOR
        echo "Created conductor.json"
    fi
fi

echo ""
echo "Created lifecycle scripts for $ECOSYSTEM:"
echo "  scripts/setup    - install deps, link env"
echo "  scripts/run      - start dev server"
echo "  scripts/stop     - stop processes (stub)"
echo "  scripts/archive  - clean up (stub)"
echo ""
echo "Review and customize each script, then wire into your runtime:"
echo "  See: references/adapters.md"
