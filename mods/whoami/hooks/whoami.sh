#!/bin/sh
# Three lines for the whoami mod: the signed-in account's address, the claude-as profile (empty
# for plain claude), and the account this launch declares (CLAUDE_AS_ACCOUNT, empty when none).
printf '%s\n' "$(jq -r '.oauthAccount.emailAddress // ""' "${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json" 2>/dev/null)"
echo "${CLAUDE_PROFILE:-}"
echo "${CLAUDE_AS_ACCOUNT:-}"
