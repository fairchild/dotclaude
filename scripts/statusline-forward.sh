#!/usr/bin/env bash
#
# statusline-forward.sh — feed the WorkSpaces host and still render a status line.
#
# The app's own forwarder treats a live WORKSPACES_HOOKS_SOCKET as proof the host
# owns the footer, so it forwards and prints a space. In a plain terminal that the
# app spawned but does not draw a footer for, the row goes blank. This does both:
# forward when a socket is there, then always render locally.

set -u

body="$(cat)"

socket="${WORKSPACES_HOOKS_SOCKET:-}"
if [[ -n "$socket" && -S "$socket" ]]; then
    headers=(-H 'Content-Type: application/json')
    if [[ -n "${WORKSPACES_HOST_SESSION_ID:-}" ]]; then
        headers+=(-H "X-WorkSpaces-Host-Session-ID: ${WORKSPACES_HOST_SESSION_ID}")
    fi
    printf '%s' "$body" | /usr/bin/curl \
        --silent --show-error --max-time 1 \
        --unix-socket "$socket" \
        -X POST "${headers[@]}" \
        --data-binary @- \
        'http://localhost/statusline' >/dev/null 2>&1 || true
fi

renderer="$HOME/.claude/scripts/statusline.sh"
if [[ -x "$renderer" ]]; then
    printf '%s' "$body" | "$renderer" || printf ' '
else
    printf ' '
fi
exit 0
