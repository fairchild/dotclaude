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
command. A write's repo comes only from a selector -- -R, the PR, issue or repo argument, an
API path, git -C or the directory after cd, pushd and popd -- never from a URL in its text,
and a hit asks whenever any write's repo is unknown or the command could not be fully read.
It does not cover: `bash -c`, `sh -c` and `eval` strings; text that only exists at run
time, such as `$(cat body.md)`, a piped or redirected body, or a variable set by an earlier
command; a private reference written as a path, including a markdown link to
`/OWNER/NAME/...`; GH_REPO, GIT_DIR and --git-dir; a remote's pushurl or
remote.pushDefault; `cd` scoped to a subshell; commits already on any remote-tracking ref;
gists, labels and tag messages.

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
gh_err = ""


def gh_budget() -> float:
    try:
        return max(0.5, float(os.environ.get("PUBLIC_TEXT_GH_TIMEOUT") or 20))
    except ValueError:
        warnings.append("PUBLIC_TEXT_GH_TIMEOUT is not a number; using 20 s")
        return 20.0


def gh(*args: str, cwd: Optional[str] = None) -> Optional[str]:
    """One deadline for every gh call in a run, so the hook ends inside its own timeout."""
    global deadline, gh_err
    gh_err = ""
    if deadline is None:
        deadline = time.monotonic() + gh_budget()
    left = deadline - time.monotonic()
    if left <= 0:
        return None
    try:
        p = subprocess.Popen(["gh", *args], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             text=True, cwd=cwd, start_new_session=True)
    except OSError:
        return None
    try:
        out, gh_err = p.communicate(timeout=left)
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
        rf"{re.escape(login)}/({alt})(\.git)?({NB}|$)",
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


def repo_exists(repo: str) -> Optional[bool]:
    if visibility(repo):
        return True
    return False if "Could not resolve to a Repository" in gh_err else None


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
HEREDOC = re.compile(r"<<(-?)\s*(['\"]?)([\w-]+)\2")
PATH_WORD = re.compile(r"(^|[\s'\"=(])(?:~|\.{1,2})?/[^\s'\"]*")
WRITE_HINT = re.compile(r"\bgit\b.*\b(commit|push)\b|\bgh\s+(pr|issue|api|release|repo)\b", re.S)
FILE_FLAGS = {"-F", "--file", "--body-file", "--notes-file", "--input"}
GH_WRITES = {"pr": {"create", "edit", "comment", "review", "merge", "close", "reopen"},
             "issue": {"create", "edit", "comment", "close", "reopen"},
             "release": {"create", "edit"}, "repo": {"create", "edit"}}
# The options that take a value, per command, from `gh <command> --help`: a value read as an
# argument would be read as the repo.
VALUED = {
    ("repo", "edit"): {"-d", "--description", "-h", "--homepage", "--add-topic", "--remove-topic",
                       "--default-branch", "--visibility", "--squash-merge-commit-message"},
    ("repo", "create"): {"-d", "--description", "-h", "--homepage", "-g", "--gitignore", "-l", "--license",
                         "-r", "--remote", "-s", "--source", "-t", "--team", "-p", "--template"},
}
PR_VALUED = {"-R", "--repo", "-b", "--body", "-F", "--body-file", "-t", "--title", "-B", "--base", "-H", "--head",
             "-l", "--label", "-T", "--template", "-A", "--author-email", "--match-head-commit", "--subject",
             "--assignee", "--reviewer", "--milestone", "--project", "--add-label", "--remove-label",
             "--add-assignee", "--remove-assignee", "--add-reviewer", "--remove-reviewer", "--add-project",
             "--remove-project", "-n", "--notes", "--notes-file", "--target", "--notes-start-tag"}
for _g in ("pr", "issue"):
    for _v in ("create", "edit"):
        VALUED[(_g, _v)] = PR_VALUED | {"-a", "-r", "-m", "-p"}
    for _v in ("close", "reopen"):
        VALUED[(_g, _v)] = PR_VALUED | {"-c", "--comment"}
MARK = "\x01"
MAX_FILE = 1 << 20


class Write:
    def __init__(self, what: str, repo: Optional[str], cwd: str, local: bool = False, private: bool = False):
        self.what, self.repo, self.cwd, self.local, self.private = what, repo, cwd, local, private
        self.files: list[str] = []
        self.fetch: Optional[Callable[[], Optional[str]]] = None


class Shell:
    """Bash's reading of a command, as far as finding its writes needs: comments and heredoc
    bodies dropped, and each $(...) or `...`, quoted or not, lifted out as a command of its
    own. `doubt` is set when the command does not close the way bash would need it to."""

    def __init__(self, src: str) -> None:
        self.src, self.i, self.doubt = src, 0, False
        self.inner: list[str] = []
        self.pending: list[tuple[str, bool]] = []
        self.outer = self.code("")

    def code(self, end: str) -> str:
        s, out, depth = self.src, [], 0
        while self.i < len(s):
            c = s[self.i]
            if c == end and (end == "`" or depth == 0):
                self.i += 1
                return "".join(out)
            if c == "\\":
                out.append(s[self.i:self.i + 2]); self.i += 2; continue
            if c == "'":
                j = s.find("'", self.i + 1)
                if j < 0:
                    self.doubt, j = True, len(s) - 1
                out.append(s[self.i:j + 1]); self.i = j + 1; continue
            if c == '"':
                out.append(self.dquote()); continue
            if s.startswith("$(", self.i) or c == "`":
                out.append(self.lift()); continue
            if c == "#" and (self.i == 0 or s[self.i - 1] in " \t\n;&|()"):
                while self.i < len(s) and s[self.i] != "\n":
                    self.i += 1
                continue
            m = HEREDOC.match(s, self.i) if s.startswith("<<", self.i) and s[self.i - 1:self.i] != "<" else None
            if m and not s.startswith("<<<", self.i):
                self.pending.append((m[3], m[1] == "-"))
                out.append(m[0]); self.i = m.end(); continue
            if c == "\n" and self.pending:
                self.bodies()
            depth += (c == "(") - (c == ")" and depth > 0)
            out.append(c); self.i += 1
        self.doubt |= bool(end)
        return "".join(out)

    def dquote(self) -> str:
        s, out = self.src, ['"']
        self.i += 1
        while self.i < len(s):
            c = s[self.i]
            if c == "\\":
                out.append(s[self.i:self.i + 2]); self.i += 2; continue
            if c == '"':
                self.i += 1
                return "".join(out + ['"'])
            if s.startswith("$(", self.i) or c == "`":
                out.append(self.lift()); continue
            out.append(c); self.i += 1
        self.doubt = True
        return "".join(out)

    def lift(self) -> str:
        tick = self.src[self.i] == "`"
        self.i += 1 if tick else 2
        start = self.i
        self.code("`" if tick else ")")
        self.inner.append(self.src[start:self.i - 1])
        return f"{MARK}{len(self.inner) - 1}{MARK}"

    def bodies(self) -> None:
        """A heredoc's body is dropped only when its closing line is there."""
        s, j = self.src, self.i + 1
        for delim, dash in self.pending:
            while True:
                if j > len(s):
                    self.pending = []
                    return
                k = s.find("\n", j)
                k = len(s) if k < 0 else k
                line, j = s[j:k], k + 1
                if (line.lstrip("\t") if dash else line) == delim:
                    break
        self.pending = []
        self.i = j - 1


def segments(text: str) -> Optional[list[list[str]]]:
    lex = shlex.shlex(text, posix=True, punctuation_chars=";&|()<>\n")
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
        w = Write("git commit", origin(cwd), cwd, local=True)
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
    w = Write("git push", origin(cwd, pos[0] if pos else "origin"), cwd)

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
        w = Write(f"gh api {endpoint or '(endpoint unread)'}", repo, cwd)
        w.files = file_args(rest)
        return w
    if verb not in GH_WRITES.get(group, ()):
        return None
    # A target comes only from a selector: -R, the repo argument, or the checkout. A URL or
    # owner/name inside a title, body or comment is text, and text never sets the target.
    named = flag_value(rest, "-R", "--repo")
    pos, skip = [], False
    for t in rest:
        if skip:
            skip = False
        elif t.startswith("-"):
            skip = t in VALUED.get((group, verb), PR_VALUED)
        else:
            pos.append(t)
    first = pos[0] if pos and group != "release" else ""
    if named:
        repo: Optional[str] = norm(named)
    elif group == "repo":
        repo = norm(first) if first else (origin(cwd) if verb == "edit" else None)
    elif GITHUB.search(first):
        repo = norm(first)
    elif OWNER_NAME.fullmatch(first):
        # gh pr and gh issue take a number, a URL or a branch here; feat/x is a branch.
        known = repo_exists(first)
        repo = first if known else origin(cwd) if known is False else None
    else:
        repo = origin(cwd)
    w = Write(f"gh {group} {verb}", repo, cwd, private=group == "repo" and "--private" in rest)
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


def writes(cmd: str, cwd: str) -> tuple[list[Write], bool]:
    """Every write in the command, each with the repo it lands on, and whether any of the
    command could not be read the way bash would read it."""
    sh = Shell(cmd)
    segs = segments(sh.outer)
    doubt = sh.doubt or segs is None
    out: list[Write] = []
    stack: list[str] = []
    for seg in segs or []:
        for tok in seg:
            for n in re.findall(f"{MARK}(\\d+){MARK}", tok):
                got, unsure = writes(sh.inner[int(n)], cwd)
                out += got
                doubt |= unsure
        if seg[0] in ("cd", "pushd"):
            if seg[0] == "pushd":
                stack.append(cwd)
            target = next((a for a in seg[1:] if not a.startswith("-")), "~")
            cwd = str(Path(cwd, Path(target).expanduser()))
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
    return out, doubt


def read_file(path: str, cwd: str) -> str:
    p = Path(path).expanduser()
    p = p if p.is_absolute() else Path(cwd) / p
    try:
        if not p.is_file():
            return ""
        if p.stat().st_size >= MAX_FILE:
            raise Unrunnable(f"{path} is over 1 MiB and was not read")
        return p.read_text(errors="replace")
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
        found, doubt = writes(cmd, cwd)
        if doubt and WRITE_HINT.search(cmd):  # a write the parse may have missed has no known repo
            found.append(Write("a command the guard could not fully read", None, cwd))
    except Unrunnable as e:
        found, local_only = [], False
        unrun.append(str(e))
    scanned = PATH_WORD.sub(r"\1", cmd)  # paths are where a command runs, not what it says
    for w in found:
        try:
            if w.local and not w.repo:
                continue
            if w.private or (w.repo and is_private(w.repo)):
                continue
            text = [scanned] + [read_file(f, w.cwd) for f in w.files]
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
