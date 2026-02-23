#!/usr/bin/env bash
set -euo pipefail

# Detect likely-completed pending backlog items by cross-referencing
# git history, in-file references, and filesystem signals.
# Usage: ~/.claude/skills/backlog/scripts/groom.sh [path/to/backlog]

backlog_dir="${1:-backlog}"

if [[ ! -d "$backlog_dir" ]]; then
  echo "No backlog/ directory found at: $backlog_dir"
  exit 1
fi

likely_completed=()
still_pending=()
roadmap_notes=()

extract_files_to_create() {
  local file="$1"
  awk '
    /\*\*Files to create:\*\*/ { in_block=1; next }
    in_block && /^\s*$/ { in_block=0 }
    in_block && /^- `/ {
      line=$0
      gsub(/^.*`/, "", line)
      gsub(/`.*$/, "", line)
      print line
    }
  ' "$file" 2>/dev/null || true
}

for f in "$backlog_dir"/*.md; do
  [[ ! -f "$f" ]] && continue

  name=$(basename "$f")
  [[ "$name" == "AGENTS.md" || "$name" == "CLAUDE.md" || "$name" == "ROADMAP.md" ]] && continue

  signals=()

  # Strategy 1: Explicit PR refs in file content (e.g., #123)
  prs=$(grep -Eo '#[0-9]+' "$f" 2>/dev/null | tr -d '#' | sort -u || true)
  for pr in $prs; do
    if git log --oneline --all --grep="(#${pr})" 2>/dev/null | grep -q .; then
      signals+=("PR #${pr} found in git log")
      break
    fi
  done

  # Strategy 2: Explicit branch refs in file content (e.g., feat/x, fix/x)
  branches=$(grep -Eo '\b(feat|fix|chore|docs|refactor|test|perf)/[a-z0-9._/-]+' "$f" 2>/dev/null | sort -u || true)
  for br in $branches; do
    if git log --oneline --all --grep="$br" 2>/dev/null | grep -q . || \
       git branch --merged main 2>/dev/null | grep -q "$br"; then
      signals+=("branch '$br' merged or referenced")
      break
    fi
  done

  # Strategy 3: Keyword match from title
  title=$(grep -m1 '^# ' "$f" 2>/dev/null | sed 's/^# //' || true)
  if [[ -n "$title" ]]; then
    keywords=$(echo "$title" | tr '[:upper:]' '[:lower:]' | tr ' -' '\n' | \
      grep -E '^.{4,}$' | grep -vE '^(with|from|into|that|this|will|have|been|does|each|more|also|when|what|then)$' || true)
    for kw in $keywords; do
      if git log --oneline --since="60 days ago" 2>/dev/null | grep -qi "$kw"; then
        signals+=("keyword '$kw' in recent commits")
        break
      fi
    done
  fi

  # Strategy 4: File existence check from "Files to create"
  while IFS= read -r filepath; do
    [[ -z "$filepath" ]] && continue
    if [[ -e "$filepath" ]]; then
      signals+=("$filepath exists")
      break
    fi
  done < <(extract_files_to_create "$f")

  if [[ ${#signals[@]} -gt 0 ]]; then
    reason=$(IFS='; '; echo "${signals[*]}")
    likely_completed+=("$(printf "  %-35s - %s" "$name" "$reason")")
  else
    still_pending+=("$(printf "  %-35s - no matching commits or files" "$name")")
  fi
done

# Check ROADMAP.md for stale active items
if [[ -f "$backlog_dir/ROADMAP.md" ]]; then
  in_active=false
  while IFS= read -r line; do
    if echo "$line" | grep -qi '## active\|## in.progress\|### active'; then
      in_active=true
      continue
    fi
    if echo "$line" | grep -q '^## \|^### ' && [[ "$in_active" == true ]]; then
      in_active=false
      continue
    fi
    if [[ "$in_active" == true ]] && echo "$line" | grep -qE '^\s*-\s+\S'; then
      item=$(echo "$line" | sed 's/^\s*-\s*//')
      kws=$(echo "$item" | tr '[:upper:]' '[:lower:]' | tr ' -' '\n' | \
        grep -E '^.{4,}$' | grep -vE '^(with|from|into|that|this|will|have|been|does|each|more|also|when|what|then|adds?)$' | head -3 || true)
      matched=false
      for kw in $kws; do
        if git log --oneline --since="30 days ago" 2>/dev/null | grep -qi "$kw"; then
          matched=true
          break
        fi
      done
      if [[ "$matched" == false && -n "$kws" ]]; then
        roadmap_notes+=("  ROADMAP.md active: \"$item\" - no recent commits")
      fi
    fi
  done < "$backlog_dir/ROADMAP.md"
fi

echo "Backlog Grooming Report"
echo "======================="
echo ""

if [[ ${#likely_completed[@]} -gt 0 ]]; then
  echo "Likely completed (needs review):"
  printf '%s\n' "${likely_completed[@]}"
else
  echo "Likely completed: (none detected)"
fi

echo ""

if [[ ${#still_pending[@]} -gt 0 ]]; then
  echo "Still pending (no signals):"
  printf '%s\n' "${still_pending[@]}"
else
  echo "Still pending: (none)"
fi

if [[ ${#roadmap_notes[@]} -gt 0 ]]; then
  echo ""
  echo "Roadmap sync:"
  printf '%s\n' "${roadmap_notes[@]}"
fi
