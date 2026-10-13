#!/usr/bin/env python3
"""Keep references to your private GitHub repos out of public ones.

    public-text-guard.py check [--repo OWNER/NAME] FILE...
    public-text-guard.py hook        # Claude Code PreToolUse hook on Bash, JSON on stdin

`check` exits 0 clean, 1 refused, 2 a file is missing, 3 the check cannot run. With
--repo it checks nothing when that repo is private.

`hook` reads the outgoing text of a Bash command that writes to GitHub -- a commit
message, a push's new commits, a PR/issue/release title or body, a comment or review, a
merge's commit message, a `gh api` write's fields -- and denies the call when that text
names one of your private repos and the target repo is public. When the private list
cannot be read and no cached copy exists, a local commit goes ahead with a warning and a
GitHub write asks you first.

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


def gh(*args: str, cwd: Optional[str] = None) -> Optional[str]:
    try:
        r = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=20, cwd=cwd)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout if r.returncode == 0 else None


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
    return [re.compile(p, re.I) for p in pats]


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


# --- hook: what a Bash command is about to publish ------------------------------

SEPARATORS = {";", "&&", "||", "|", "|&", "&", "\n", "(", ")", ";;"}
GITHUB = re.compile(r"github\.com[:/]([^/\s]+)/([^/\s]+?)(?:\.git)?(?:[/#?\s]|$)")


class Write:
    def __init__(self, what: str, cwd: str, repo: Optional[str] = None, local: bool = False):
        self.what, self.cwd, self.repo, self.local = what, cwd, repo, local
        self.text: list[str] = []
        self.fetch: Optional[Callable[[str], Optional[str]]] = None


def segments(cmd: str) -> list[list[str]]:
    lex = shlex.shlex(cmd, posix=True, punctuation_chars=";&|()<>\n")
    lex.whitespace, lex.whitespace_split = " \t\r", True
    out: list[list[str]] = [[]]
    for tok in lex:
        if tok in SEPARATORS:
            out.append([])
        else:
            out[-1].append(tok)
    return [s for s in out if s]


def flags(toks: list[str], valued: set[str]) -> tuple[dict[str, list[str]], list[str]]:
    opts: dict[str, list[str]] = {}
    pos: list[str] = []
    i = 0
    while i < len(toks):
        t = toks[i]
        if t.startswith("--") and "=" in t:
            k, v = t.split("=", 1)
            opts.setdefault(k, []).append(v)
        elif t in valued and i + 1 < len(toks):
            opts.setdefault(t, []).append(toks[i + 1])
            i += 1
        elif t.startswith("-") and len(t) > 1:
            opts.setdefault(t, []).append("")
        else:
            pos.append(t)
        i += 1
    return opts, pos


def pick(opts: dict[str, list[str]], *names: str) -> list[str]:
    return [v for n in names for v in opts.get(n, [])]


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


def read_file(path: str, cwd: str, raw: str) -> str:
    if path == "-":
        return raw
    p = Path(path).expanduser()
    p = p if p.is_absolute() else Path(cwd) / p
    try:
        return p.read_text(errors="replace")
    except OSError:
        return raw


def parse_git(toks: list[str], cwd: str, raw: str) -> Optional[Write]:
    i = 0
    while i < len(toks) and toks[i].startswith("-"):
        if toks[i] == "-C" and i + 1 < len(toks):
            cwd = str(Path(cwd, Path(toks[i + 1]).expanduser()))
        i += 2 if toks[i] in ("-C", "-c", "--git-dir", "--work-tree", "--namespace") else 1
    sub, rest = (toks[i], toks[i + 1:]) if i < len(toks) else ("", [])
    if sub == "commit":
        w = Write("git commit", cwd, origin(cwd), local=True)
        j = 0
        while j < len(rest):
            t = rest[j]
            nxt = rest[j + 1] if j + 1 < len(rest) else ""
            if t in ("-m", "--message") or re.fullmatch(r"-[a-zA-Z]*m", t):
                w.text.append(nxt); j += 1
            elif t in ("-F", "--file") or re.fullmatch(r"-[a-zA-Z]*F", t):
                w.text.append(read_file(nxt, cwd, raw)); j += 1
            elif t.startswith("--message="):
                w.text.append(t.split("=", 1)[1])
            elif t.startswith("--file="):
                w.text.append(read_file(t.split("=", 1)[1], cwd, raw))
            elif re.fullmatch(r"-m.+", t):
                w.text.append(t[2:])
            j += 1
        return w
    if sub == "push":
        opts, pos = flags(rest, {"--repo", "-o", "--push-option", "--receive-pack", "--exec"})
        remote = pos[0] if pos else "origin"
        refs = [r.lstrip("+").split(":")[0] for r in pos[1:]]
        refs = [r for r in refs if r] or (["--branches"] if "--all" in opts or "--mirror" in opts else ["HEAD"])
        w = Write("git push", cwd, origin(cwd, remote))

        def log(_: str) -> Optional[str]:
            try:
                r = subprocess.run(["git", "-C", cwd, "log", "--format=%B", *refs, "--not", "--remotes"],
                                   capture_output=True, text=True, timeout=20)
            except (OSError, subprocess.TimeoutExpired):
                return None
            return r.stdout if r.returncode == 0 else None
        w.fetch = log
        return w
    return None


GH_TEXT = {  # (group, verb) -> (text flags, file flags)
    ("pr", "create"): ({"-t", "--title", "-b", "--body"}, {"-F", "--body-file"}),
    ("pr", "edit"): ({"-t", "--title", "-b", "--body"}, {"-F", "--body-file"}),
    ("pr", "comment"): ({"-b", "--body"}, {"-F", "--body-file"}),
    ("pr", "review"): ({"-b", "--body"}, {"-F", "--body-file"}),
    ("pr", "merge"): ({"-t", "--subject", "-b", "--body"}, {"-F", "--body-file"}),
    ("issue", "create"): ({"-t", "--title", "-b", "--body"}, {"-F", "--body-file"}),
    ("issue", "edit"): ({"-t", "--title", "-b", "--body"}, {"-F", "--body-file"}),
    ("issue", "comment"): ({"-b", "--body"}, {"-F", "--body-file"}),
    ("release", "create"): ({"-t", "--title", "-n", "--notes"}, {"-F", "--notes-file"}),
    ("release", "edit"): ({"-t", "--title", "-n", "--notes"}, {"-F", "--notes-file"}),
}
GH_VALUED = {"-R", "--repo", "-B", "--base", "-H", "--head", "-l", "--label", "-a", "--assignee",
             "-r", "--reviewer", "-m", "--milestone", "-p", "--project", "-T", "--template",
             "-A", "--author-email", "--match-head-commit", "--add-label", "--remove-label",
             "--add-assignee", "--remove-assignee", "--add-reviewer", "--remove-reviewer",
             "--add-project", "--remove-project", "--target", "--notes-start-tag"}
API_VALUED = {"-X", "--method", "-H", "--header", "-f", "--raw-field", "-F", "--field", "--input",
              "-q", "--jq", "-t", "--template", "--hostname", "--cache", "-p", "--preview"}


def gh_repo(opts: dict[str, list[str]], pos: list[str], cwd: str) -> Optional[str]:
    explicit = pick(opts, "-R", "--repo")
    if explicit:
        parts = explicit[-1].split("/")
        return "/".join(parts[-2:]) if len(parts) >= 2 else f"{owner()}/{parts[0]}"
    for p in pos:
        m = GITHUB.search(p)
        if m:
            return f"{m[1]}/{m[2]}"
    return origin(cwd)


def parse_gh(toks: list[str], cwd: str, raw: str) -> Optional[Write]:
    if len(toks) < 2:
        return None
    group = toks[0]
    if group == "api":
        opts, pos = flags(toks[1:], API_VALUED)
        fields = pick(opts, "-f", "--raw-field", "-F", "--field")
        method = (pick(opts, "-X", "--method") or ["POST" if fields or "--input" in opts else "GET"])[-1]
        if method.upper() == "GET" or not pos:
            return None
        endpoint = pos[0].lstrip("/")
        m = re.match(r"repos/([^/]+)/([^/]+)", endpoint)
        repo = None
        if m:
            o, r = m[1], m[2]
            here = origin(cwd) or "/"
            repo = f"{here.split('/')[0] if o == '{owner}' else o}/{here.split('/')[1] if r == '{repo}' else r}"
        w = Write(f"gh api {method.upper()} {endpoint}", cwd, repo)
        for f in fields:
            v = f.split("=", 1)[-1]
            w.text.append(read_file(v[1:], cwd, raw) if v.startswith("@") else v)
        w.text += [read_file(f, cwd, raw) for f in pick(opts, "--input")]
        return w
    verb = toks[1]
    spec = GH_TEXT.get((group, verb))
    if not spec:
        return None
    text_flags, file_flags = spec
    valued = (GH_VALUED - {"-m"} if verb == "merge" else GH_VALUED) | text_flags | file_flags
    opts, pos = flags(toks[2:], valued)
    w = Write(f"gh {group} {verb}", cwd, gh_repo(opts, pos, cwd))
    w.text = pick(opts, *text_flags) + [read_file(f, cwd, raw) for f in pick(opts, *file_flags)]
    if (group, verb) == ("pr", "merge") and not ({"-r", "--rebase"} & opts.keys()) \
            and not pick(opts, "-b", "--body", "-F", "--body-file"):
        # With no body, GitHub writes one from the repo's squash/merge setting: the PR body,
        # or every commit's message. Read what it would write and check all of it.
        sel = [p for p in pos if not p.startswith("-")][:1]

        def landing(repo: str) -> Optional[str]:
            return gh("pr", "view", *sel, "-R", repo, "--json", "title,body,commits", "-q",
                      '[.title, .body, (.commits[] | .messageHeadline, .messageBody)] | map(. // "") | join("\n")',
                      cwd=cwd)
        w.fetch = landing
    return w


def writes(cmd: str, cwd: str) -> list[Write]:
    try:
        segs = segments(cmd)
    except ValueError:  # a bare heredoc with an apostrophe; the whole command is the text
        segs = []
        if re.search(r"\bgit\b.*\b(commit|push)\b|\bgh\s+(pr|issue|api|release)\b", cmd):
            w = Write("a command the guard could not parse", cwd, origin(cwd),
                      local=not re.search(r"\bgh\b|\bpush\b", cmd))
            w.text = [cmd]
            return [w]
    out: list[Write] = []
    for seg in segs:
        if seg[0] == "cd" and len(seg) > 1:
            cwd = str(Path(cwd, Path(seg[1]).expanduser()))
            continue
        for i, t in enumerate(seg):
            name = t.rsplit("/", 1)[-1]
            w = (parse_git(seg[i + 1:], cwd, cmd) if name == "git"
                 else parse_gh(seg[i + 1:], cwd, cmd) if name == "gh" else None)
            if name in ("git", "gh"):
                if w:
                    if re.search(r"\$\{?[A-Za-z_]", "".join(w.text)):
                        w.text.append(cmd)  # a variable's value is only visible where it was set
                    out.append(w)
                break
    return out


def hook(event: dict) -> Optional[dict]:
    cmd = (event.get("tool_input") or {}).get("command") or ""
    if event.get("tool_name") != "Bash" or not re.search(r"\b(git|gh)\b", cmd):
        return None
    refused: list[str] = []
    unrun: list[Write] = []
    try:
        found = writes(cmd, event.get("cwd") or os.getcwd())
    except Unrunnable as e:
        found, w = [], Write("gh", "")
        w.text = [str(e)]
        unrun.append(w)
    for w in found:
        try:
            if w.local and not w.repo:
                continue  # a commit with no GitHub remote publishes nothing yet; its push is checked
            if is_private(w.repo):
                continue
            if w.fetch:
                got = w.fetch(w.repo or "")
                if got is None:
                    raise Unrunnable(f"cannot read what {w.what} would publish")
                w.text.append(got)
            refused += [f"{w.what} -> {w.repo or 'an unknown repo'}: {l.strip()[:200]}"
                        for l in hits("\n".join(w.text))]
        except Unrunnable as e:
            w.text = [str(e)]
            unrun.append(w)
    note = "; ".join(dict.fromkeys(warnings))
    if refused:
        reason = ("public-text-guard: this text is bound for a public repo and names a private repo "
                  "or private detail:\n  " + "\n  ".join(refused[:12]) +
                  "\nDescribe the change without the private reference (say \"a private repo\" if "
                  "the link matters), then run it again.")
        return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                       "permissionDecisionReason": reason}}
    if unrun:
        why = "; ".join(w.text[0] for w in unrun)
        msg = f"public-text-guard could not check this command: {why}. Its text is UNCHECKED."
        if all(w.local for w in unrun):
            return {"systemMessage": msg}
        return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "ask",
                                       "permissionDecisionReason": msg}}
    return {"systemMessage": f"public-text-guard: {note}"} if note else None


def main(argv: list[str]) -> int:
    if argv[:1] == ["check"] and len(argv) > 1:
        return check(argv[1:])
    if argv[:1] == ["hook"]:
        try:
            out = hook(json.load(sys.stdin))
        except Exception as e:  # a crashed guard must say so, never pass quietly or wedge the shell
            out = {"systemMessage": f"public-text-guard crashed ({type(e).__name__}: {e}); "
                                    "this command's text is UNCHECKED."}
        if out:
            print(json.dumps(out))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
