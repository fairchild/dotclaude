#!/usr/bin/env bash
#MISE description="Exercise dotclaude's independent-clone runtime contract"
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fixture_home="$tmp/home"
seed="$tmp/seed"
origin="$tmp/origin.git"
runtime="$fixture_home/.claude"
mkdir -p "$fixture_home" "$seed"

if python3 -c 'import tomllib' >/dev/null 2>&1; then
	PYTHON=(python3)
elif command -v uv >/dev/null 2>&1; then
	PYTHON=(uv run --no-project --python 3.13 python)
else
	echo "FAIL: Python 3.11+ or uv is required" >&2
	exit 1
fi

while IFS= read -r -d '' path; do
	mkdir -p "$seed/$(dirname "$path")"
	cp -pR "$ROOT/$path" "$seed/$path"
done < <(git -C "$ROOT" ls-files --cached --others --exclude-standard -z)
git -C "$seed" init -q -b main
git -C "$seed" config user.name fixture
git -C "$seed" config user.email fixture@example.com
git -C "$seed" add .
git -C "$seed" commit -qm fixture
git clone -q --bare "$seed" "$origin"
git -C "$seed" remote add origin "$origin"

run_cli() {
	HOME="$fixture_home" \
	DOTCLAUDE_SOURCE_REPO="$seed" \
	DOTCLAUDE_RUNTIME="$runtime" \
		"${PYTHON[@]}" "$ROOT/scripts/dotclaude.py" "$@"
}

mkdir -p "$runtime"
printf 'preserve me\n' > "$runtime/local.txt"
run_cli bootstrap
find "$fixture_home/.local/share/dotclaude/migration-backups" -name local.txt \
	-exec grep -l 'preserve me' {} \; | grep -q .
[[ -d "$runtime/.git" && ! -L "$runtime" ]]
[[ "$(git -C "$runtime" branch --show-current)" == main ]]

mkdir -p "$runtime/sessions"
printf '{"private": "not printed"}\n' > "$runtime/sessions/current.json"
printf 'LOCAL_ONLY=not-printed\n' > "$runtime/.env"

HOME="$fixture_home" "${PYTHON[@]}" - "$runtime" <<'PY'
import os, pathlib, tomllib, sys
runtime = pathlib.Path(sys.argv[1])
agents = pathlib.Path.home() / ".agents" / "skills"
manifest = tomllib.loads((runtime / "dotagents.toml").read_text())
agents.mkdir(parents=True, exist_ok=True)
for name, enabled in manifest.get("link-to-claude", {}).items():
    if enabled is not True:
        continue
    target = agents / name
    target.mkdir(parents=True, exist_ok=True)
    link = runtime / "skills" / name
    link.parent.mkdir(parents=True, exist_ok=True)
    link.symlink_to(target)
for name, enabled in manifest.get("share-to-agents", {}).items():
    if enabled is not True:
        continue
    target = runtime / "skills" / name
    assert target.exists(), f"tracked skill missing: {name}"
    link = agents / name
    link.symlink_to(target)
PY

before_doctor="$(git -C "$runtime" status --porcelain=v1 --ignored=matching)"
doctor_output="$(run_cli doctor)"
after_doctor="$(git -C "$runtime" status --porcelain=v1 --ignored=matching)"
[[ "$before_doctor" == "$after_doctor" ]]
grep -q 'doctor: OK' <<< "$doctor_output"
grep -q 'runtime policy accepts' <<< "$doctor_output"

printf 'unknown\n' > "$runtime/unknown-public.txt"
if run_cli doctor > "$tmp/unknown.log"; then
	echo "FAIL: doctor accepted unknown unignored drift" >&2
	exit 1
fi
grep -q 'unknown unignored runtime drift: 1 path' "$tmp/unknown.log"
rm "$runtime/unknown-public.txt"

printf '\ntracked drift\n' >> "$runtime/README.md"
if run_cli doctor > "$tmp/tracked.log"; then
	echo "FAIL: doctor accepted tracked source drift" >&2
	exit 1
fi
grep -q 'tracked source drift: 1 path' "$tmp/tracked.log"
git -C "$runtime" checkout -- README.md

printf '\nfixture sync\n' >> "$seed/CHANGELOG.md"
git -C "$seed" add CHANGELOG.md
git -C "$seed" commit -qm 'fixture: advance main'
git -C "$seed" push -q origin main
before="$(git -C "$runtime" rev-parse HEAD)"
run_cli sync
after="$(git -C "$runtime" rev-parse HEAD)"
[[ "$before" != "$after" ]]
[[ -f "$runtime/sessions/current.json" && -f "$runtime/.env" ]]
run_cli doctor >/dev/null

run_cli bootstrap >/dev/null
[[ "$(find "$fixture_home/.local/share/dotclaude/migration-backups" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')" == 1 ]]

worktree_runtime="$tmp/worktree-runtime"
mkdir -p "$worktree_runtime"
printf 'gitdir: elsewhere\n' > "$worktree_runtime/.git"
if HOME="$fixture_home" DOTCLAUDE_SOURCE_REPO="$seed" DOTCLAUDE_RUNTIME="$worktree_runtime" \
	"${PYTHON[@]}" "$ROOT/scripts/dotclaude.py" bootstrap > "$tmp/worktree.log"; then
	echo "FAIL: bootstrap accepted a worktree runtime" >&2
	exit 1
fi
grep -q 'refusing to move a registered Git worktree' "$tmp/worktree.log"
[[ -f "$worktree_runtime/.git" ]]

printf 'OK: dotclaude participant contract passed\n'
