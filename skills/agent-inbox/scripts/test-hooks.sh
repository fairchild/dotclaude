#!/usr/bin/env bash
# Regression coverage for legacy identities and non-consuming notification hooks.
set -euo pipefail
scripts="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
export AGENT_INBOX_ROOT="$fixture/inbox"
unset AGENT_INBOX_NAME CLAUDE_SESSION_NAME
mkdir -p "$AGENT_INBOX_ROOT"

for name in Session1 session_1 'Session 1'; do
  export CLAUDE_SESSION_NAME="$name"
  for hook in check-inbox-hook.sh inbox-startup.sh; do
    bash "$scripts/$hook" > "$fixture/out" 2> "$fixture/err"
    [[ ! -s "$fixture/out" && ! -s "$fixture/err" ]]
  done
  mkdir -p "$AGENT_INBOX_ROOT/$name/new"
  printf '%s\n' '---' 'from: peer' '---' 'Please review.' > "$AGENT_INBOX_ROOT/$name/new/message.md"
  [[ $(bash "$scripts/check-inbox-hook.sh") == *'1 unread'* ]]
  [[ $(bash "$scripts/inbox-startup.sh") == *'Please review.'* ]]
  [[ -f "$AGENT_INBOX_ROOT/$name/new/message.md" ]]
done
printf 'PASS: legacy uppercase, underscore, and space names stay silent when empty and retain mailbox summaries\n'

for name in ../outside . .. 'title/with/slash'; do
  export CLAUDE_SESSION_NAME="$name"
  for hook in check-inbox-hook.sh inbox-startup.sh; do
    bash "$scripts/$hook" > "$fixture/out" 2> "$fixture/err"
    [[ ! -s "$fixture/err" ]]
    [[ $(cat "$fixture/out") == *'3 unread'* ]]
    [[ $(cat "$fixture/out") != *'Please review.'* ]]
  done
done
export AGENT_INBOX_NAME=explicit-agent
[[ -z $(bash "$scripts/check-inbox-hook.sh") ]]
export AGENT_INBOX_NAME=../outside
if bash "$scripts/check-inbox-hook.sh" > "$fixture/out" 2> "$fixture/err"; then
  echo 'FAIL: invalid explicit identity accepted' >&2
  exit 1
fi
printf 'PASS: unsafe legacy names become anonymous; explicit identity takes precedence and rejects traversal\n'
