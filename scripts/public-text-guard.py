#!/usr/bin/env python3
"""Keep references to your private GitHub repos out of public ones.

    public-text-guard.py check [--repo OWNER/NAME] FILE...
    public-text-guard.py hook        # Claude Code PreToolUse hook on Bash, JSON on stdin

`check` exits 0 clean, 1 refused, 2 a file is missing, 3 the check cannot run. With
--repo it checks nothing when that repo is private.

`hook` finds each write in a Bash command -- git commit and push; gh pr, issue and release
create, edit, comment, review, merge, close and reopen; gh repo create and edit; a gh api
write -- and the repo each one lands on. When a write lands on a public repo, it checks the
whole command text, with filesystem paths removed, plus any file the command passes as a
body or message, the commits a push would send, and what a merge with no body would write.
A hit denies the call. A private reference anywhere in the command counts, so a clean
public write chained after a command that names a private repo is denied too; split the
command. When a write's repo cannot be told and the text has a hit, it asks.

When the private list cannot be read and no cached copy exists, a crash, or a pattern that
does not compile: a local commit goes ahead with a warning, and a GitHub write asks first.
All gh calls in one run share a single deadline (PUBLIC_TEXT_GH_TIMEOUT, 20 s), so the hook
ends inside its own 30 s timeout.

It reads the literal command, which is what catches an accidental leak in an ordinary
command. It does not cover: `bash -c`, `sh -c` and `eval` strings; text that only exists at
run time, such as `$(cat body.md)`, a piped or redirected body, or a variable set by an
earlier command; a private reference written as a path; GH_REPO, GIT_DIR and --git-dir;
a remote's pushurl or remote.pushDefault; `cd` scoped to a subshell; commits already on any
remote-tracking ref; gists, labels and tag messages.

The private names are read from GitHub at run time and cached, never written here: a list
of them in a public file would be the leak this exists to stop. What counts as a hit, kept
narrow because a check that cries wolf gets bypassed: OWNER/name, `name#N` or `name #N`
(many private names are ordinary words), the owner's first name, private-network
addresses, *.ts.net and *.localhost hosts, and any pattern in the extra-patterns file.

Environment:
  PUBLIC_TEXT_OWNER   the account whose private repos count (default: gh's login)
  PUBLIC_TEXT_STATE   cache directory (default: $XDG_STATE_HOME/public-text)
  PUBLIC_TEXT_EXTRA   extra patterns, one regex per line, # comments
                      (default: $XDG_CONFIG_HOME/public-text/patterns, optional)
"""
from __future__ import annotations

import json
import os
import re
import shlex
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable, Optional

DAY = 86400
LIMIT = 1000
NB = r"[^A-Za-z0-9_.-]"
OCT = r"[0-9]{1,3}"


class Unrunnable(Exception):
    pass


def _env_dir(var: str, xdg: str, fallback: str, leaf: str) -> Path:
    if os.environ.get(var):
        return Path(os.environ[var]).expanduser()
    return Path(os.environ.get(xdg) or Path.home() / fallback) / leaf


STATE = _env_dir("PUBLIC_TEXT_STATE", "XDG_STATE_HOME", ".local/state", "public-text")
EXTRA = (Path(os.environ["PUBLIC_TEXT_EXTRA"]).expanduser() if os.environ.get("PUBLIC_TEXT_EXTRA")
         else Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config") / "public-text" / "patterns")
warnings: list[str] = []
deadline: Optional[float] = None


def gh_budget() -> float:
    try:
        return max(0.5, float(os.environ.get("PUBLIC_TEXT_GH_TIMEOUT") or 20))
    except ValueError:
        warnings.append("PUBLIC_TEXT_GH_TIMEOUT is not a number; using 20 s")
        return 20.0


def gh(*args: str, cwd: Optional[str] = None) -> Optional[str]:
    """One deadline for every gh call in a run, so the hook ends inside its own timeout."""
    global deadline
    if deadline is None:
        deadline = time.monotonic() + gh_budget()
    left = deadline - time.monotonic()
    if left <= 0:
        return None
    try:
        p = subprocess.Popen(["gh", *args], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             text=True, cwd=cwd, start_new_session=True)
    except OSError:
        return None
    try:
        out, _ = p.communicate(timeout=left)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        p.communicate()
        warnings.append("gh ran out of its time budget")
        return None
    return out if p.returncode == 0 else None


def cached(name: str, ttl: int, fetch: Callable[[], Optional[str]]) -> str:
    path = STATE / name
    if path.exists() and time.time() - path.stat().st_mtime < ttl:
        return path.read_text()
    got = fetch()
    if got is not None:
        STATE.mkdir(parents=True, exist_ok=True)
        path.write_text(got)
        return got
    if path.exists():
        warnings.append(f"could not refresh {name}; using the copy from "
                        f"{time.strftime('%Y-%m-%d %H:%M', time.localtime(path.stat().st_mtime))}")
        return path.read_text()
    raise Unrunnable(f"cannot read {name} from GitHub and there is no cached copy")


def owner() -> str:
    if os.environ.get("PUBLIC_TEXT_OWNER"):
        return os.environ["PUBLIC_TEXT_OWNER"]
    return cached("owner.txt", DAY, lambda: gh("api", "user", "-q", ".login")).strip()


def private_names(login: str) -> list[str]:
    def fetch() -> Optional[str]:
        got = gh("repo", "list", login, "--visibility", "private", "--limit", str(LIMIT),
                 "--json", "name", "-q", ".[].name")
        n = len((got or "").split())
        return got if 0 < n < LIMIT else None
    return cached(f"private-repos.{login}.txt", DAY, fetch).split()


def first_name(login: str) -> str:
    got = cached(f"name.{login}.txt", DAY, lambda: gh("api", f"users/{login}", "-q", ".name"))
    return (got.split() or [""])[0]


def extra_patterns() -> list[str]:
    if not EXTRA.exists():
        return []
    lines = (l.strip() for l in EXTRA.read_text().splitlines())
    return [l for l in lines if l and not l.startswith("#")]


def patterns() -> list[re.Pattern[str]]:
    login = owner()
    alt = "|".join(map(re.escape, private_names(login)))
    first = first_name(login)
    pats = [
        rf"{re.escape(login)}/({alt})({NB}|$)",
        rf"(^|{NB})({alt}) ?#[0-9]+",
        rf"(^|[^0-9.])(10\.{OCT}|192\.168|172\.(1[6-9]|2[0-9]|3[01]))\.{OCT}\.{OCT}([^0-9]|$)",
        rf"[A-Za-z0-9-]\.ts\.net({NB}|$)",
        rf"[A-Za-z0-9-]\.localhost({NB}|$)",
        *extra_patterns(),
    ]
    if first:
        pats.append(rf"(^|[^A-Za-z]){re.escape(first)}([^A-Za-z]|$)")
    compiled = []
    for p in pats:
        try:
            compiled.append(re.compile(p, re.I))
        except re.error as e:
            raise Unrunnable(f"a pattern does not compile ({p!r}: {e}); fix {EXTRA}")
    return compiled


def visibility(repo: str) -> Optional[str]:
    path = STATE / "visibility.json"
    try:
        seen = json.loads(path.read_text())
    except (OSError, ValueError):
        seen = {}
    vis, at = seen.get(repo, [None, 0])
    if vis and time.time() - at < 3600:
        return vis
    got = (gh("repo", "view", repo, "--json", "visibility", "-q", ".visibility") or "").strip()
    if not got:
        return None
    seen[repo] = [got, time.time()]
    STATE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(seen))
    return got


def is_private(repo: Optional[str]) -> bool:
    if not repo:
        return False
    vis = visibility(repo)
    if vis is None:
        warnings.append(f"cannot read the visibility of {repo}; checked as if public")
    return vis in ("PRIVATE", "INTERNAL")


def hits(text: str) -> list[str]:
    pats = patterns()
    return [line for line in text.splitlines() if any(p.search(line) for p in pats)]


# --- check: the CLI -----------------------------------------------------------

def check(argv: list[str]) -> int:
    repo = None
    if argv[:1] == ["--repo"]:
        repo, argv = argv[1], argv[2:]
        if "/" not in repo:
            repo = f"{owner()}/{repo}"
        if is_private(repo):
            print(f"public-text-guard: {repo} is private -- nothing to check")
            return 0
    found = 0
    for f in argv:
        if not Path(f).is_file():
            print(f"public-text-guard: no such file: {f}", file=sys.stderr)
            return 2
        try:
            for line in hits(Path(f).read_text(errors="replace")):
                print(f"  {f}: {line}")
                found += 1
        except Unrunnable as e:
            print(f"public-text-guard: CANNOT RUN -- {e}. Nothing was checked.", file=sys.stderr)
            return 3
    for w in warnings:
        print(f"public-text-guard: {w}", file=sys.stderr)
    if not found:
        print("public-text-guard: clean")
        return 0
    print(f"public-text-guard: REFUSED -- {found} line(s) name a private repo or private detail.")
    return 1


# --- hook: where a Bash command writes, and what it says --------------------------
#
# The text side reads the whole command, never one argument: every round of extracting
# arguments one by one opened a new hole (a heredoc in a variable, an attached option, a
# comment). Parsing is only for the target -- which repo each write in the chain lands on.

GITHUB = re.compile(r"github\.com[:/]([^/\s'\"]+)/([^/\s'\"]+?)(?:\.git)?(?:[/#?\s'\"]|$)")
OWNER_NAME = re.compile(r"[\w.-]+/[\w.-]+")
SEPARATORS = {";", "&&", "||", "|", "|&", "&", "\n", "(", ")", ";;"}
HEREDOC = re.compile(r"(?<!<)<<(-?)(?!<)\s*(['\"]?)(\w+)\2")
PATH_WORD = re.compile(r"(^|[\s'\"=(])(?:~|\.{1,2})?/[^\s'\"]*")
WRITE_HINT = re.compile(r"\bgit\b.*\b(commit|push)\b|\bgh\s+(pr|issue|api|release|repo)\b", re.S)
FILE_FLAGS = {"-F", "--file", "--body-file", "--notes-file", "--input"}
GH_WRITES = {"pr": {"create", "edit", "comment", "review", "merge", "close", "reopen"},
             "issue": {"create", "edit", "comment", "close", "reopen"},
             "release": {"create", "edit"}, "repo": {"create", "edit"}}


class Write:
    def __init__(self, what: str, repo: Optional[str], local: bool = False, private: bool = False):
        self.what, self.repo, self.local, self.private = what, repo, local, private
        self.files: list[str] = []
        self.fetch: Optional[Callable[[], Optional[str]]] = None


def without_heredoc_bodies(cmd: str) -> str:
    out: list[str] = []
    pending: list[tuple[str, bool]] = []
    for line in cmd.split("\n"):
        if pending:
            delim, dash = pending[0]
            if (line.lstrip("\t") if dash else line) == delim:
                pending.pop(0)
            continue
        out.append(line)
        pending += [(m[3], m[1] == "-") for m in HEREDOC.finditer(line)]
    return "\n".join(out)


def without_comments(cmd: str) -> str:
    """Drop what bash drops: an unquoted `#` that starts a word, to the end of its line."""
    out, quote, i = [], "", 0
    while i < len(cmd):
        c = cmd[i]
        if c == "\\" and quote != "'":
            out.append(cmd[i:i + 2]); i += 2; continue
        if quote:
            quote = "" if c == quote else quote
        elif c in "'\"":
            quote = c
        elif c == "#" and (i == 0 or cmd[i - 1] in " \t\n;&|()"):
            while i < len(cmd) and cmd[i] != "\n":
                i += 1
            continue
        out.append(c); i += 1
    return "".join(out)


def segments(cmd: str) -> Optional[list[list[str]]]:
    lex = shlex.shlex(without_comments(without_heredoc_bodies(cmd)), posix=True,
                      punctuation_chars=";&|()<>\n")
    lex.whitespace, lex.whitespace_split, lex.commenters = " \t\r", True, ""
    out: list[list[str]] = [[]]
    try:
        for tok in lex:
            if tok in SEPARATORS:
                out.append([])
            else:
                out[-1].append(tok)
    except ValueError:
        return None
    return [s for s in out if s]


def flag_value(toks: list[str], short: str, long: str) -> Optional[str]:
    got = None
    for i, t in enumerate(toks):
        if t in (short, long) and i + 1 < len(toks):
            got = toks[i + 1]
        elif t.startswith(long + "="):
            got = t.split("=", 1)[1]
        elif t.startswith(short) and len(t) > 2 and not t.startswith("--"):
            got = t[2:]
    return got


def file_args(toks: list[str]) -> list[str]:
    out = []
    for i, t in enumerate(toks):
        if t in FILE_FLAGS and i + 1 < len(toks):
            out.append(toks[i + 1])
        elif t.split("=", 1)[0] in FILE_FLAGS and "=" in t:
            out.append(t.split("=", 1)[1])
        elif re.fullmatch(r"-F.+", t):
            out.append(t[2:])
        if "=@" in t:
            out.append(t.split("=@", 1)[1])
    return out


def norm(repo: str) -> str:
    m = GITHUB.search(repo + " ")
    if m:
        return f"{m[1]}/{m[2]}"
    parts = re.sub(r"\.git$", "", repo).split("/")
    return "/".join(parts[-2:]) if len(parts) >= 2 else f"{owner()}/{parts[0]}"


def origin(cwd: str, remote: str = "origin") -> Optional[str]:
    url = remote if "://" in remote or "@" in remote else None
    if url is None:
        try:
            url = subprocess.run(["git", "-C", cwd, "remote", "get-url", remote],
                                 capture_output=True, text=True, timeout=5).stdout
        except (OSError, subprocess.TimeoutExpired):
            return None
    m = GITHUB.search(url or "")
    return f"{m[1]}/{m[2]}" if m else None


def git_write(toks: list[str], cwd: str) -> Optional[Write]:
    i = 0
    while i < len(toks) and toks[i].startswith("-"):
        if toks[i] == "-C" and i + 1 < len(toks):
            cwd = str(Path(cwd, Path(toks[i + 1]).expanduser()))
        i += 2 if toks[i] in ("-C", "-c", "--git-dir", "--work-tree", "--namespace") else 1
    sub, rest = (toks[i], toks[i + 1:]) if i < len(toks) else ("", [])
    if sub == "commit":
        w = Write("git commit", origin(cwd), local=True)
        w.files = file_args(rest)
        return w
    if sub != "push":
        return None
    pos, skip = [], False
    for t in rest:
        if skip:
            skip = False
        elif t in ("--repo", "-o", "--push-option", "--receive-pack", "--exec"):
            skip = True
        elif not t.startswith("-"):
            pos.append(t)
    refs = [r.lstrip("+").split(":")[0] for r in pos[1:]]
    refs = [r for r in refs if r] or (["--branches"] if {"--all", "--mirror"} & set(rest) else ["HEAD"])
    w = Write("git push", origin(cwd, pos[0] if pos else "origin"))

    def log() -> Optional[str]:
        try:
            r = subprocess.run(["git", "-C", cwd, "log", "--format=%B", *refs, "--not", "--remotes"],
                               capture_output=True, text=True, timeout=10)
        except (OSError, subprocess.TimeoutExpired):
            return None
        return r.stdout if r.returncode == 0 else None
    w.fetch = log
    return w


def gh_write(toks: list[str], cwd: str) -> Optional[Write]:
    group, verb, rest = (toks + ["", ""])[0], (toks + ["", ""])[1], toks[2:]
    if group == "api":
        rest = toks[1:]
        method = flag_value(rest, "-X", "--method")
        fields = any(re.fullmatch(r"-[fF].*|--(raw-)?field(=.*)?|--input(=.*)?", t) for t in rest)
        if (method or ("POST" if fields else "GET")).upper() == "GET":
            return None
        endpoint = next((t.lstrip("/") for t in rest if re.match(r"/?(repos/|graphql$)", t)), "")
        m = re.match(r"repos/([^/]+)/([^/]+)", endpoint)
        repo = None
        if m:
            here = (origin(cwd) or "/").split("/")
            repo = f"{here[0] if m[1] == '{owner}' else m[1]}/{here[1] if m[2] == '{repo}' else m[2]}"
        w = Write(f"gh api {endpoint or '(endpoint unread)'}", repo)
        w.files = file_args(rest)
        return w
    if verb not in GH_WRITES.get(group, ()):
        return None
    named = flag_value(rest, "-R", "--repo")
    url = next((f"{m[1]}/{m[2]}" for m in map(GITHUB.search, rest) if m), None)
    shaped = next((t for t in rest if OWNER_NAME.fullmatch(t)), None) if group == "repo" else None
    repo = norm(named) if named else url or shaped or (origin(cwd) if group != "repo" or verb == "edit" else None)
    w = Write(f"gh {group} {verb}", repo, private=group == "repo" and "--private" in rest)
    w.files = file_args(rest)
    explicit = any(re.fullmatch(r"-[bF].*|--body(-file)?(=.*)?", t) for t in rest)
    if (group, verb) == ("pr", "merge") and not explicit and not {"-r", "--rebase"} & set(rest):
        # With no body, GitHub writes one from the repo's squash/merge setting: the PR body,
        # or every commit's message. Read what it would write and check all of it.
        sel = [t for t in rest if re.fullmatch(r"\d+|https?://\S+", t)][:1]

        def landing() -> Optional[str]:
            return gh("pr", "view", *sel, "-R", repo or "", "--json", "title,body,commits", "-q",
                      '[.title, .body, (.commits[] | .messageHeadline, .messageBody)] | map(. // "") | join("\n")',
                      cwd=cwd)
        w.fetch = landing
    return w


def writes(cmd: str, cwd: str) -> list[Write]:
    segs = segments(cmd)
    if segs is None:
        return [Write("a command the guard could not parse", None)] if WRITE_HINT.search(cmd) else []
    out: list[Write] = []
    stack: list[str] = []
    for seg in segs:
        if seg[0] in ("cd", "pushd"):
            if seg[0] == "pushd":
                stack.append(cwd)
            cwd = str(Path(cwd, Path(seg[1] if len(seg) > 1 else "~").expanduser()))
            continue
        if seg[0] == "popd":
            cwd = stack.pop() if stack else cwd
            continue
        for i, t in enumerate(seg):
            name = t.rsplit("/", 1)[-1]
            if name in ("git", "gh"):
                w = git_write(seg[i + 1:], cwd) if name == "git" else gh_write(seg[i + 1:], cwd)
                if w:
                    out.append(w)
                break
    return out


def read_file(path: str, cwd: str) -> str:
    p = Path(path).expanduser()
    p = p if p.is_absolute() else Path(cwd) / p
    try:
        return p.read_text(errors="replace") if p.is_file() and p.stat().st_size < 1 << 20 else ""
    except OSError:
        return ""


def hook(event: dict) -> Optional[dict]:
    cmd = (event.get("tool_input") or {}).get("command") or ""
    if event.get("tool_name") != "Bash" or not re.search(r"\b(git|gh)\b", cmd):
        return None
    cwd = event.get("cwd") or os.getcwd()
    refused: list[str] = []
    unresolved: list[str] = []
    unrun: list[str] = []
    local_only = True
    try:
        found = writes(cmd, cwd)
    except Unrunnable as e:
        found, local_only = [], False
        unrun.append(str(e))
    scanned = PATH_WORD.sub(r"\1", cmd)  # paths are where a command runs, not what it says
    for w in found:
        try:
            if (w.local and not w.repo) or w.private or (w.repo and is_private(w.repo)):
                continue
            text = [scanned] + [read_file(f, cwd) for f in w.files]
            if w.fetch:
                got = w.fetch()
                if got is None:
                    raise Unrunnable(f"cannot read what {w.what} would publish")
                text.append(got)
            lines = [f"{w.what} -> {w.repo or 'a repo it could not name'}: {l.strip()[:200]}"
                     for l in hits("\n".join(text))]
            (refused if w.repo else unresolved).extend(lines)
        except Unrunnable as e:
            local_only = local_only and w.local
            unrun.append(str(e))
    note = "; ".join(dict.fromkeys(warnings))
    if refused:
        reason = ("public-text-guard: this command writes to a public repo, and its text names a private "
                  "repo or private detail:\n  " + "\n  ".join(dict.fromkeys(refused[:12])) +
                  "\nDescribe the change without the private reference (say \"a private repo\" if the link "
                  "matters). If the reference belongs to another command in this chain, split the command "
                  "and run the public write on its own.")
        return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                       "permissionDecisionReason": reason}}
    if unresolved or unrun:
        why = "; ".join(dict.fromkeys(unrun)) or (
            "it could not tell which repo this writes to, and the text names a private repo:\n  "
            + "\n  ".join(dict.fromkeys(unresolved[:12])))
        msg = f"public-text-guard could not clear this command: {why}"
        if not unresolved and local_only:
            return {"systemMessage": msg + ". Its text is UNCHECKED."}
        return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "ask",
                                       "permissionDecisionReason": msg}}
    return {"systemMessage": f"public-text-guard: {note}"} if note else None


def main(argv: list[str]) -> int:
    if argv[:1] == ["check"] and len(argv) > 1:
        return check(argv[1:])
    if argv[:1] == ["hook"]:
        event: dict = {}
        try:
            event = json.load(sys.stdin)
            out = hook(event)
        except Exception as e:  # a crashed guard says so on every call, and asks before a GitHub write
            msg = f"public-text-guard crashed ({type(e).__name__}: {e}); this command's text is UNCHECKED."
            cmd = str((event.get("tool_input") or {}).get("command") or "")
            out = ({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "ask",
                                           "permissionDecisionReason": msg}}
                   if re.search(r"\bgh\b|\bgit\b.*\bpush\b", cmd) else {"systemMessage": msg})
        if out:
            print(json.dumps(out))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
