# wt - git worktree cleanup. `wt.sh install` adds a line sourcing this to ~/.zshrc.

WORKTREES_ROOT="${WORKTREES_ROOT:-$HOME/.worktrees}"
_WT_SCRIPT="${${(%):-%N}:A:h}/wt.sh"

wt() { "$_WT_SCRIPT" "$@" }

_wt() {
    _arguments '1:command:((clean\:"retire worktrees whose work has landed" prune\:"delete old archives" install\:"add wt to ~/.zshrc"))' '*:option:(--all --dry-run --delete-branch --yes)'
}

compdef _wt wt 2>/dev/null
