#!/usr/bin/env bash
set -euo pipefail

# Detect likely-completed backlog items by cross-referencing git history and filesystem.
# Usage: ~/.claude/skills/backlog/scripts/groom.sh [path/to/backlog]

backlog_dir="${1:-backlog}"

if [[ ! -d "$backlog_dir" ]]; then
  echo "No backlog/ directory found at: $backlog_dir"
  exit 1
fi

likely_completed=()
still_pending=()
roadmap_notes=()

for f in "$backlog_dir"/*.md; do
  [[ "$(basename "$f")" == "AGENTS.md" ]] && continue
  [[ "$(basename "$f")" == "CLAUDE.md" ]] && continue
  [[ "$(basename "$f")" == "ROADMAP.md" ]] && continue
  [[ ! -f "$f" ]] && continue

  name=$(basename "$f")

  # Parse frontmatter (reuses status.sh pattern)
  first_line=$(head -1 "$f" 2>/dev/null)
  if [[ "$first_line" == "---" ]]; then
    fm=$(sed -n '2,/^---$/p' "$f" 2>/dev/null | sed '$d')
    status=$(echo "$fm" | grep '^status:' | cut -d: -f2 | tr -d ' ')
    pr=$(echo "$fm" | grep '^pr:' | cut -d: -f2 | tr -d ' ')
    branch=$(echo "$fm" | grep '^branch:' | cut -d: -f2 | tr -d ' ')
  else
    status=""
    pr=""
    branch=""
  fi

  [[ -z "$status" ]] && status="pending"
  [[ "$status" != "pending" ]] && continue

  signals=()

  # Strategy 1: PR number match
  if [[ -n "$pr" && "$pr" != "null" ]]; then
    if git log --oneline --all --grep="(#${pr})" 2>/dev/null | grep -q .; then
      signals+=("PR #${pr} found in git log")
    fi
  fi

  # Strategy 2: Branch match
  if [[ -n "$branch" && "$branch" != "null" ]]; then
    if git log --oneline main --all --grep="$branch" 2>/dev/null | grep -q . || \
       git branch --merged main 2>/dev/null | grep -q "$branch"; then
      signals+=("branch '$branch' merged to main")
    fi
  fi

  # Strategy 3: Keyword match from title
  title=$(grep -m1 '^# ' "$f" 2>/dev/null | sed 's/^# //' || true)
  if [[ -n "$title" ]]; then
    # Extract keywords: lowercase, split on spaces/hyphens, skip short words
    keywords=$(echo "$title" | tr '[:upper:]' '[:lower:]' | tr ' -' '\n' | \
      grep -E '^.{4,}$' | grep -vE '^(with|from|into|that|this|will|have|been|does|each|more|also|when|what|then)$' || true)
    for kw in $keywords; do
      if git log --oneline --since="60 days ago" 2>/dev/null | grep -qi "$kw"; then
        signals+=("keyword '$kw' in recent commits")
        break
      fi
    done
  fi

  # Strategy 4: File existence check ("Files to create" sections)
  while IFS= read -r filepath; do
    if [[ -e "$filepath" ]]; then
      signals+=("$filepath exists")
      break
    fi
  done < <(grep -A1 'Files to create' "$f" 2>/dev/null | grep '^\- `' | sed 's/.*`\([^`]*\)`.*/\1/' || true)

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
      # Extract keywords: 4+ chars, skip common verbs/articles
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

# Output
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
