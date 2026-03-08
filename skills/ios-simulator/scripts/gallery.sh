#!/bin/bash
# Generate an HTML gallery from screenshots in a directory.
# Usage: gallery.sh <screens-dir> [title]
# Reads screen metadata from screens.yaml in the same directory.

set -euo pipefail

SCREENS_DIR="${1:?Usage: gallery.sh <screens-dir> [title]}"
TITLE="${2:-App Screen Flow}"
OUTPUT="$SCREENS_DIR/index.html"

YAML="$SCREENS_DIR/screens.yaml"
if [ ! -f "$YAML" ]; then
  echo "Error: $YAML not found. Create it with screen metadata." >&2
  echo "Example:" >&2
  cat >&2 <<'EXAMPLE'
screens:
  - file: 01-home.png
    label: Home
    desc: Main screen
    action: Tap item
  - file: 02-detail.png
    label: Detail
    desc: Detail view
EXAMPLE
  exit 1
fi

FILES=(); LABELS=(); DESCS=(); ACTIONS=()
cf=""; cl=""; cd=""; ca=""

flush() {
  if [ -n "$cf" ]; then
    FILES+=("$cf"); LABELS+=("$cl"); DESCS+=("$cd"); ACTIONS+=("$ca")
  fi
  cf=""; cl=""; cd=""; ca=""
}

while IFS= read -r line; do
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" =~ ^[[:space:]]*$ ]] && continue
  if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*file:[[:space:]]*(.*) ]]; then
    flush; cf="${BASH_REMATCH[1]}"
  elif [[ "$line" =~ ^[[:space:]]*label:[[:space:]]*(.*) ]]; then cl="${BASH_REMATCH[1]}"
  elif [[ "$line" =~ ^[[:space:]]*desc:[[:space:]]*(.*) ]]; then cd="${BASH_REMATCH[1]}"
  elif [[ "$line" =~ ^[[:space:]]*action:[[:space:]]*(.*) ]]; then ca="${BASH_REMATCH[1]}"
  fi
done < "$YAML"
flush

COUNT=${#FILES[@]}
[ "$COUNT" -eq 0 ] && { echo "No screens in $YAML" >&2; exit 1; }

DATE=$(date +"%B %-d, %Y")

cat > "$OUTPUT" <<HTML
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${TITLE}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'SF Pro',system-ui,sans-serif;background:#1a1a1a;color:#e0e0e0;min-height:100vh}
    header{text-align:center;padding:3rem 1rem 1rem}
    header h1{font-size:2rem;font-weight:700;letter-spacing:-0.02em}
    header p{color:#888;margin-top:.5rem;font-size:.95rem}
    .flow{display:flex;align-items:flex-start;padding:2rem 1rem 4rem;overflow-x:auto;justify-content:center;flex-wrap:wrap}
    .step{display:flex;align-items:flex-start;flex-shrink:0}
    .screen{display:flex;flex-direction:column;align-items:center;max-width:280px}
    .screen img{width:240px;border-radius:20px;box-shadow:0 8px 32px rgba(0,0,0,.5);border:1px solid #333;transition:transform .2s}
    .screen img:hover{transform:scale(1.03)}
    .screen .label{margin-top:1rem;font-size:.85rem;font-weight:600;color:#fff}
    .screen .desc{margin-top:.25rem;font-size:.75rem;color:#888;text-align:center;line-height:1.4;max-width:200px}
    .arrow{display:flex;align-items:center;padding:0 .5rem;margin-top:120px;color:#555;font-size:1.5rem;flex-shrink:0}
    .arrow .action{font-size:.65rem;color:#666;text-align:center;margin-top:.25rem;white-space:nowrap}
    .arrow-inner{display:flex;flex-direction:column;align-items:center}
    footer{text-align:center;padding:1rem;color:#555;font-size:.75rem;border-top:1px solid #2a2a2a}
    @media(max-width:900px){.flow{flex-direction:column;align-items:center}.arrow{margin-top:0;padding:1rem 0;transform:rotate(90deg)}}
  </style>
</head>
<body>
  <header>
    <h1>${TITLE}</h1>
    <p>Screen flow &mdash; captured ${DATE}</p>
  </header>
  <div class="flow">
HTML

for ((i=0; i<COUNT; i++)); do
  cat >> "$OUTPUT" <<SCREEN
    <div class="step">
      <div class="screen">
        <img src="${FILES[$i]}" alt="${LABELS[$i]}">
        <div class="label">${LABELS[$i]}</div>
        <div class="desc">${DESCS[$i]}</div>
      </div>
    </div>
SCREEN
  if [ -n "${ACTIONS[$i]}" ] && [ $((i+1)) -lt "$COUNT" ]; then
    cat >> "$OUTPUT" <<ARROW
    <div class="arrow"><div class="arrow-inner"><span>&rarr;</span><div class="action">${ACTIONS[$i]}</div></div></div>
ARROW
  fi
done

cat >> "$OUTPUT" <<FOOT
  </div>
  <footer>Captured ${DATE}</footer>
</body>
</html>
FOOT

echo "Generated: $OUTPUT"
