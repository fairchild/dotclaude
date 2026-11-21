#!/usr/bin/env bash
set -euo pipefail

# wt - retire git worktrees once their work has landed.
# Worktrees are made by the harness (claude -w, EnterWorktree, isolation:
# "worktree") or by `git worktree add`; wt clean sweeps up after all of them.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

WORKTREES_ROOT="${WORKTREES_ROOT:-$HOME/.worktrees}"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()  { echo -e "${BLUE}[wt]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[wt]${NC} $1"; }
log_error() { echo -e "${RED}[wt]${NC} $1" >&2; }

usage() {
    cat <<USAGE
Usage: wt <command> [args]

Commands:
  clean                   Retire worktrees whose commit has landed (in origin's
                          default branch or a merged pull request), wherever they
                          live; remove clean ones, archive ones with untracked files
    --all                 Every repo with a worktree under WORKTREES_ROOT
                          (default: the current repo)
    --dry-run             List what would happen
    --delete-branch       Also delete branches (local and remote)
  archive <name|branch|path>
                          Archive one worktree of the current repo now, landed
                          or not (git-ignored files such as node_modules dropped)
  prune [days] [--yes]    Delete archives older than N days (default: 30)
  install                Add wt to ~/.zshrc (one-time setup)

To start a worktree: claude -w <name>, EnterWorktree, an agent with
isolation: "worktree", or git worktree add.

Environment:
  WORKTREES_ROOT     Where --all looks and archives go (default: ~/.worktrees)
  WT_ACTIVE_MINUTES  Leave a worktree alone this long after a Claude session
                     wrote there (default: 120)
USAGE
    exit 1
}

retired() {
    log_error "wt $1 was retired."
    case "$1" in
        list|ls|tree|status) echo "  git worktree list" >&2 ;;
        *) echo "  Start a worktree with: claude -w <name>, or git worktree add -b <branch> <path>" >&2
           echo "  wt clean retires it once its work lands." >&2 ;;
    esac
    exit 1
}

_remove_empty_parents() {
    local dir="$1"
    while [[ "$dir" == "$WORKTREES_ROOT/"* ]] && [[ -d "$dir" ]] && [[ -z "$(ls -A "$dir")" ]]; do
        rmdir "$dir"
        dir=$(dirname "$dir")
    done
}

# Move a worktree into .archive. Git-ignored files (dependencies, build output,
# copied env files) stay behind: they regenerate, and they are most of the size.
_archive_path() {
    local worktree_path="$1" repo="$2" repo_name="$3" name="$4"
    git -C "$worktree_path" clean -fdXq 2>/dev/null || true
    local archive_dest="$WORKTREES_ROOT/.archive/$repo_name/$name"
    [[ -e "$archive_dest" ]] && archive_dest="${archive_dest}-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$(dirname "$archive_dest")"
    mv "$worktree_path" "$archive_dest"
    touch "$archive_dest"  # prune ages an archive from here, not from the worktree's last edit
    git -C "$repo" worktree prune
    _remove_empty_parents "$(dirname "$worktree_path")"
    log_ok "Archived to: $archive_dest"
}


# --- clean -------------------------------------------------------------------
# A worktree is retired once its HEAD commit has landed: the commit is in
# origin's default branch, or GitHub lists it in a merged pull request, which
# covers squash merges, detached review checkouts and renamed branches.
# Worktrees are found through `git worktree list`, so where they live and what
# made them (wt, an agent's `git worktree add`, a harness) doesn't matter.
# A clean worktree is removed; one holding untracked files is archived.

WT_ACTIVE_MINUTES="${WT_ACTIVE_MINUTES:-120}"

CLEAN_DRY=false
CLEAN_DELETE_BRANCH=false
CLEAN_REMOVE=0
CLEAN_ARCHIVE=0
CLEAN_SKIP=0
CLEAN_UNKNOWN=0
CLEAN_UNMERGED=0

_default_ref() {
    local repo="$1" ref
    if ref=$(git -C "$repo" symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null); then
        echo "$ref"
        return 0
    fi
    for ref in origin/main origin/master main master; do
        if git -C "$repo" rev-parse -q --verify "$ref^{commit}" >/dev/null 2>&1; then
            echo "$ref"
            return 0
        fi
    done
    return 0
}

# Prints merged, unmerged, none, or error:<reason>
_pr_state() {
    local worktree="$1" sha="$2" out
    if ! git -C "$worktree" remote get-url origin >/dev/null 2>&1; then
        echo "none"
        return 0
    fi
    if ! command -v gh >/dev/null 2>&1; then
        echo "error:gh is not installed"
        return 0
    fi
    if out=$(cd "$worktree" && gh api "repos/{owner}/{repo}/commits/$sha/pulls" \
        --jq 'if any(.[]; .merged_at != null) then "merged" elif length > 0 then "unmerged" else "none" end' 2>&1); then
        echo "$out"
    elif [[ "$out" == *"No commit found"* || "$out" == *"none of the git remotes"* ]]; then
        echo "none"
    else
        echo "error:$(echo "$out" | head -1)"
    fi
    return 0
}

_minutes_since_session() {
    local dir newest
    dir="$HOME/.claude/projects/$(echo "$1" | sed 's|[^a-zA-Z0-9]|-|g')"  # portability: allow
    [[ -d "$dir" ]] || return 0
    newest=$( (stat -f %m "$dir"/*.jsonl 2>/dev/null || stat -c %Y "$dir"/*.jsonl 2>/dev/null) | sort -rn | head -1) || true
    [[ -n "$newest" ]] && echo $(( ($(date +%s) - newest) / 60 ))
    return 0
}

CLEAN_CWDS=""

# Every process's working directory, as "pid<TAB>command<TAB>cwd" lines
_load_process_cwds() {
    command -v lsof >/dev/null 2>&1 || return 0
    CLEAN_CWDS=$(lsof -w -d cwd -Fpcn 2>/dev/null |
        awk '/^p/{p=substr($0,2)} /^c/{c=substr($0,2)} /^n/{print p "\t" c "\t" substr($0,2)}') || true
    return 0
}

_process_in() {
    [[ -n "$CLEAN_CWDS" ]] || return 0
    printf '%s\n' "$CLEAN_CWDS" |
        awk -F'\t' -v d="$1" '$3 == d || index($3, d "/") == 1 {print $2 " (pid " $1 ")"; exit}'
    return 0
}

_repo_label() {
    local path="$1" repo="$2" rel
    if [[ "$path" == "$WORKTREES_ROOT/"* ]]; then
        rel="${path#"$WORKTREES_ROOT"/}"
        echo "${rel%%/*}"
    else
        basename "${repo%/.git}" .git
    fi
}

_clean_skip() {
    log_info "skip     $1  ($2)"
    CLEAN_SKIP=$((CLEAN_SKIP + 1))
}

_clean_one() {
    local repo="$1" default_ref="$2" path="$3" sha="$4" branch="$5" locked="$6" prunable="$7"
    local label name id
    label=$(_repo_label "$path" "$repo")
    if [[ "$path" == "$WORKTREES_ROOT/$label/"* ]]; then
        name="${path#"$WORKTREES_ROOT/$label"/}"
        id="$label/$name"
    else
        name=$(basename "$path")
        id="$path"
        [[ "$path" == "$HOME/"* ]] && id="~/${path#"$HOME"/}"
    fi

    if [[ "$prunable" == true || ! -d "$path" ]]; then
        log_info "prune    $id  (directory is gone)"
        [[ "$CLEAN_DRY" == true ]] || git -C "$repo" worktree prune
        return 0
    fi
    if [[ "$locked" == true ]]; then
        _clean_skip "$id" "locked"
        return 0
    fi
    if [[ -n "$branch" ]]; then
        case "$branch" in
            main|master|develop|"${default_ref#origin/}") return 0 ;;
        esac
    fi

    local proc mins
    proc=$(_process_in "$path")
    if [[ -n "$proc" ]]; then
        _clean_skip "$id" "$proc is running in it"
        return 0
    fi
    mins=$(_minutes_since_session "$path")
    if [[ -n "$mins" ]] && (( mins < WT_ACTIVE_MINUTES )); then
        _clean_skip "$id" "a Claude session wrote here ${mins}m ago"
        return 0
    fi
    if [[ -n "$(git -C "$path" status --porcelain --untracked-files=no 2>/dev/null)" ]]; then
        _clean_skip "$id" "uncommitted changes"
        return 0
    fi

    local why state
    if [[ -n "$default_ref" ]] && git -C "$repo" merge-base --is-ancestor "$sha" "$default_ref" 2>/dev/null; then
        # A branch only just cut from the default branch is also "in" it; its
        # reflog, holding nothing past "Created from", tells the two apart.
        if [[ -n "$branch" ]] && [[ $(git -C "$repo" reflog show --format=%H "refs/heads/$branch" 2>/dev/null | wc -l) -le 1 ]]; then
            _clean_skip "$id" "$branch has no commits of its own yet"
            return 0
        fi
        why="in $default_ref"
    else
        state=$(_pr_state "$path" "$sha")
        case "$state" in
            merged) why="in a merged pull request" ;;
            error:*)
                CLEAN_UNKNOWN=$((CLEAN_UNKNOWN + 1))
                _clean_skip "$id" "could not ask GitHub: ${state#error:}"
                return 0
                ;;
            *)
                CLEAN_UNMERGED=$((CLEAN_UNMERGED + 1))
                return 0
                ;;
        esac
    fi

    local ref="${branch:-detached at ${sha:0:8}}" untracked
    untracked=$(git -C "$path" ls-files --others --exclude-standard | wc -l | tr -d ' ')
    if [[ "$untracked" -gt 0 ]]; then
        log_info "archive  $id  ($ref, $why; keeps $untracked untracked file(s))"
        CLEAN_ARCHIVE=$((CLEAN_ARCHIVE + 1))
        [[ "$CLEAN_DRY" == true ]] || _archive_path "$path" "$repo" "$label" "$name"
    else
        log_info "remove   $id  ($ref, $why)"
        CLEAN_REMOVE=$((CLEAN_REMOVE + 1))
        if [[ "$CLEAN_DRY" == false ]]; then
            if ! git -C "$repo" worktree remove "$path"; then
                log_error "git refused to remove $path"
                return 0
            fi
            _remove_empty_parents "$(dirname "$path")"
        fi
    fi

    if [[ "$CLEAN_DRY" == false && "$CLEAN_DELETE_BRANCH" == true && -n "$branch" ]]; then
        git -C "$repo" branch -D "$branch" >/dev/null 2>&1 && log_info "deleted branch $branch" || true
        git -C "$repo" push origin --delete "$branch" >/dev/null 2>&1 || true
    fi
    return 0
}

cmd_clean() {
    local scan_all=false
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --all|--all-sources) scan_all=true; shift ;;
            --dry-run) CLEAN_DRY=true; shift ;;
            --delete-branch) CLEAN_DELETE_BRANCH=true; shift ;;
            *) log_error "Unknown option: $1"; exit 1 ;;
        esac
    done

    # git reports physical paths; match them against a physical root
    [[ -d "$WORKTREES_ROOT" ]] && WORKTREES_ROOT=$(cd "$WORKTREES_ROOT" && pwd -P)

    local found=() orphans=() f d common
    if git rev-parse --git-dir &>/dev/null; then
        found+=("$(git rev-parse --path-format=absolute --git-common-dir)")
    elif [[ "$scan_all" == false ]]; then
        log_error "Not in a git repository. Use --all to scan $WORKTREES_ROOT"
        exit 1
    fi
    if [[ "$scan_all" == true && -d "$WORKTREES_ROOT" ]]; then
        while IFS= read -r f; do
            d=$(dirname "$f")
            if common=$(git -C "$d" rev-parse --path-format=absolute --git-common-dir 2>/dev/null); then
                found+=("$common")
            else
                orphans+=("$d")
            fi
        done < <(find "$WORKTREES_ROOT" -mindepth 1 \
            \( -path "$WORKTREES_ROOT/.archive" -o -name node_modules -o -name .venv -o -name target \) -prune \
            -o -name .git -type f -print 2>/dev/null)
    fi

    _load_process_cwds

    local repo line path sha branch locked prunable first default_ref
    while IFS= read -r repo; do
        [[ -n "$repo" ]] || continue
        default_ref=$(_default_ref "$repo")
        path="" sha="" branch="" locked=false prunable=false first=true
        while IFS= read -r line; do
            case "$line" in
                "worktree "*) path="${line#worktree }" ;;
                "HEAD "*) sha="${line#HEAD }" ;;
                "branch "*) branch="${line#branch refs/heads/}" ;;
                locked*) locked=true ;;
                prunable*) prunable=true ;;
                "")
                    if [[ "$first" == true ]]; then
                        first=false
                    elif [[ -n "$path" ]]; then
                        _clean_one "$repo" "$default_ref" "$path" "$sha" "$branch" "$locked" "$prunable" </dev/null
                    fi
                    path="" sha="" branch="" locked=false prunable=false
                    ;;
            esac
        done < <(git -C "$repo" worktree list --porcelain; echo)
    done < <(printf '%s\n' ${found[@]+"${found[@]}"} | sort -u)

    for d in ${orphans[@]+"${orphans[@]}"}; do
        log_info "orphan   ${d#"$WORKTREES_ROOT"/}  (its .git points at a repository that is gone; left alone)"
    done

    echo ""
    if [[ "$CLEAN_DRY" == true ]]; then
        log_ok "Would remove $CLEAN_REMOVE and archive $CLEAN_ARCHIVE. Skipped $CLEAN_SKIP; $CLEAN_UNMERGED not merged."
    else
        log_ok "Removed $CLEAN_REMOVE and archived $CLEAN_ARCHIVE. Skipped $CLEAN_SKIP; $CLEAN_UNMERGED not merged."
    fi
    if [[ $CLEAN_UNKNOWN -gt 0 ]]; then
        log_error "$CLEAN_UNKNOWN worktree(s) could not be checked against GitHub and were left alone. Check: gh auth status"
    fi
}

cmd_archive() {
    local target="${1:-}"
    if [[ -z "$target" ]]; then
        log_error "Usage: wt archive <name|branch|path>"
        exit 1
    fi
    if ! git rev-parse --git-dir &>/dev/null; then
        log_error "Not in a git repository"
        exit 1
    fi
    [[ -d "$WORKTREES_ROOT" ]] && WORKTREES_ROOT=$(cd "$WORKTREES_ROOT" && pwd -P)
    [[ "$target" == */* && -d "$target" ]] && target=$(cd "$target" && pwd -P)

    local repo line p="" b="" first=true path=""
    repo=$(git rev-parse --path-format=absolute --git-common-dir)
    while IFS= read -r line; do
        case "$line" in
            "worktree "*) p="${line#worktree }" ;;
            "branch "*) b="${line#branch refs/heads/}" ;;
            "")
                if [[ "$first" == true ]]; then
                    first=false
                elif [[ -n "$p" && ( "$p" == "$target" || "$(basename "$p")" == "$target" || "$b" == "$target" ) ]]; then
                    path="$p"
                    break
                fi
                p="" b=""
                ;;
        esac
    done < <(git -C "$repo" worktree list --porcelain; echo)

    if [[ -z "$path" ]]; then
        log_error "No worktree of this repo matches: $target"
        exit 1
    fi
    local label name
    label=$(_repo_label "$path" "$repo")
    if [[ "$path" == "$WORKTREES_ROOT/$label/"* ]]; then
        name="${path#"$WORKTREES_ROOT/$label"/}"
    else
        name=$(basename "$path")
    fi
    _archive_path "$path" "$repo" "$label" "$name"
}

cmd_prune() {
    local days=30 assume_yes=false
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --yes|-y) assume_yes=true; shift ;;
            *) days="$1"; shift ;;
        esac
    done
    local archive_root="$WORKTREES_ROOT/.archive"

    if [[ ! -d "$archive_root" ]]; then
        log_ok "No archives to prune"
        return 0
    fi

    # Find archived worktrees (directories containing a .git file)
    local candidates=()
    local candidate_ages=()

    while IFS= read -r git_file; do
        local archive_dir
        archive_dir=$(dirname "$git_file")
        # stat -f %m on macOS gives mtime in epoch seconds
        local mtime
        mtime=$(stat -f %m "$archive_dir" 2>/dev/null || stat -c %Y "$archive_dir" 2>/dev/null)
        local now
        now=$(date +%s)
        local age_days=$(( (now - mtime) / 86400 ))

        if [[ $age_days -ge $days ]]; then
            candidates+=("$archive_dir")
            candidate_ages+=("$age_days")
        fi
    done < <(find "$archive_root" -name ".git" -type f 2>/dev/null)

    if [[ ${#candidates[@]} -eq 0 ]]; then
        log_ok "No archives older than $days days"
        return 0
    fi

    log_info "Archives older than $days days:"
    local total_size=0
    for i in "${!candidates[@]}"; do
        local dir="${candidates[$i]}"
        local age="${candidate_ages[$i]}"
        local name="${dir#$archive_root/}"
        local size
        size=$(du -sh "$dir" 2>/dev/null | cut -f1)
        echo "  ${age}d  ${size}  $name"
    done

    echo ""
    local total
    total=$(du -sh "$archive_root" 2>/dev/null | cut -f1)
    log_info "${#candidates[@]} archive(s) found ($total total archive size)"
    if [[ "$assume_yes" == false ]]; then
        read -p "[wt] Delete these ${#candidates[@]} archive(s)? [y/N] " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Cancelled"
            return 0
        fi
    fi

    for dir in "${candidates[@]}"; do
        rm -rf "$dir"
    done

    # Clean up empty directories
    find "$archive_root" -type d -empty -delete 2>/dev/null

    log_ok "Pruned ${#candidates[@]} archive(s)"
}

cmd_install() {
    local source_line="source $SCRIPT_DIR/wt.zsh"
    local zshrc="$HOME/.zshrc"

    # Any existing wt.zsh source counts as installed — earlier installs wrote
    # a literal ~-prefixed path, which grep -qF on the resolved path would miss.
    if [[ -f "$zshrc" ]] && grep -qE '^[[:space:]]*source[[:space:]].*/wt\.zsh' "$zshrc"; then
        log_ok "Already installed in ~/.zshrc"
        return 0
    fi

    echo "" >> "$zshrc"
    echo "# wt - git worktree cleanup" >> "$zshrc"
    echo "$source_line" >> "$zshrc"
    log_ok "Added to ~/.zshrc — run: source ~/.zshrc"
}

main() {
    local cmd="${1:-}"
    case "$cmd" in
        ""|--help|-h) usage ;;
        clean) shift; cmd_clean "$@" ;;
        archive) shift; cmd_archive "$@" ;;
        prune) shift; cmd_prune "$@" ;;
        install) cmd_install ;;
        list|ls|tree|status|open|apply|cd|home|done) retired "$cmd" ;;
        *) retired "<branch>" ;;
    esac
}

main "$@"
