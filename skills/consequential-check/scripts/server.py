#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""The owner's review queue for pull requests the consequential check routed to them.

One page shows the open pull requests labelled `consequential` one at a time, each with the reasons
the check gave. For each, the owner answers one question, "glad this was flagged?", and when yes,
which of the reasons was why. The answer is acted on at once: a reply the tuning step can collect is posted on
the pull request, the label is changed to say what was decided, and the pull request is merged
when the owner asks for that in the same keystroke. A pull request whose current head raised
nothing, and fails the check only for a label an earlier head left, is cleared with one button:
the label comes off and the check runs again.

    server.py --repo OWNER/REPO [--repo ...]   serve the queue on 127.0.0.1 and print its link
    server.py --demo                           the same page over made-up pull requests, no network
    server.py --dry-run --repo OWNER/REPO      read the real queue; every action only says what it would do
    server.py --summary                        how the answers so far fall, per reason
    server.py --self-test

The owner runs it, under their own GitHub sign-in: each answer is their label and each merge is
their merge. An agent runs it only with --demo or --dry-run.

What it keeps: every answer and what was done about it, one JSON object per line, in
$XDG_STATE_HOME/consequential-check/decisions.jsonl (--state PATH to move it). --on-record CMD
also pipes each record to a command, for a store somewhere else.

The four parts a repository may want to change are small classes with one job each, and
--adapter FILE swaps any of them without editing this file. The file is Python and may define:

    dialects(config) -> list[Dialect]        more verdict-comment formats, tried before the built-in
    forge(config, default) -> Forge          where pull requests are read and acted on
    store(config, default) -> Store          where answers are kept
    policy(config, default) -> Policy        what an answer does: which comment, labels, merge

The page is served on 127.0.0.1 only, to the link printed at start: that link carries a random
token, and the page and every action need it.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, Iterator, Protocol

MARKER = "<!-- consequential-check -->"
DATA_MARKER = "consequential-check-data"
DECISION_MARKER = "consequential-decision"
DEFAULT_PORT = 8741
NOTE_LIMIT = 500


# ---------------------------------------------------------------- what is being decided

@dataclass(frozen=True)
class Config:
    repos: tuple[str, ...] = ()
    label: str = "consequential"
    check: str = "consequential-check"  # the check's name; it fails by design on what is listed here
    confirmed_label: str = "consequential:confirmed"
    overruled_label: str = "consequential:overruled"
    merge_method: str = "squash"
    bots: tuple[str, ...] = ("github-actions[bot]",)
    dry_run: bool = False


@dataclass(frozen=True)
class Reason:
    id: str  # a question id, or a slug for a reason that has none
    text: str
    p: float | None = None
    line: float | None = None


@dataclass(frozen=True)
class Verdict:
    dialect: str
    headline: str
    reasons: tuple[Reason, ...]
    head: str = ""  # the commit it judged, as far as the comment says
    comment_id: int = 0
    consequential: bool = True  # false: this head raised nothing, and only the label fails the check


@dataclass(frozen=True)
class Item:
    repo: str
    number: int
    title: str
    url: str
    author: str
    head: str
    size: str
    draft: bool
    # waiting: no answer at this head | answered: answered, still open | stale: only the label is
    # left | pending: flagged, and the check has not judged this head yet
    state: str
    verdict: Verdict | None
    earlier: tuple[str, ...] = ()  # answers given at earlier heads, newest last
    labels: tuple[str, ...] = ()  # lower case, as GitHub matches them
    answer: str = ""  # with `answered`: confirmed or overruled

    @property
    def key(self) -> str:
        return f"{self.repo}#{self.number}"


@dataclass(frozen=True)
class Decision:
    key: str
    head: str
    glad: bool  # glad this was flagged: the verdict was right
    reasons: tuple[str, ...] = ()  # which of the reasons shown was why
    other: str = ""  # a reason the check did not give, or why it was wrong
    merge: bool = False
    seconds: float | None = None  # from the card showing to the answer, as the page measured it


def clean(text: object, limit: int = NOTE_LIMIT) -> str:
    return " ".join(str(text or "").split())[:limit]


def hidden(marker: str, data: dict) -> str:
    """One JSON line in an HTML comment; `<` and `>` escaped so nothing inside can close it."""
    text = json.dumps(data, sort_keys=True, separators=(",", ":")).replace("<", "\\u003c").replace(">", "\\u003e")
    return f"<!-- {marker}: {text} -->"


def unhidden(marker: str, body: str) -> dict | None:
    found = re.findall(rf"^<!-- {re.escape(marker)}: (\{{[^\r\n]*\}}) -->\r?$", body, re.M)
    try:
        return json.loads(found[-1]) if found else None
    except json.JSONDecodeError:
        return None


# ---------------------------------------------------------------- dialects: how a verdict reads

class Dialect(Protocol):
    """One verdict-comment format: how to read the check's comment, and what the owner's reply to
    it looks like. A repository with its own gate adds one through --adapter."""
    name: str

    def read(self, body: str) -> Verdict | None: ...

    def reply(self, decision: Decision, verdict: Verdict | None) -> str: ...


class CheckDialect:
    """The comment consequential.py writes, and the `consequential: right|wrong` reply its tuning
    step collects. A reason is a question that raised or was too close to call."""
    name = "consequential-check"
    bullet = re.compile(r"^- \*\*([a-z_]+)\*\* \(p ([0-9.]+), line ([0-9.]+)\): (.*?)(?: _\([^)]*\)_)?$", re.M)
    close = "too close to its line to call"

    def read(self, body: str) -> Verdict | None:
        if not body.startswith(MARKER):
            return None
        first = next((line for line in body.splitlines()[1:] if line.strip()), "")
        headline = re.sub(r"[*`]", "", first).strip()
        yes = "Consequential: yes" in headline
        data = unhidden(DATA_MARKER, body)
        if data:
            questions = data.get("questions") or {}
            reasons = []
            listed = [*data.get("raised", []), *data.get("uncertain", [])]  # the data line sorts its keys
            for qid, q in sorted(questions.items(), key=lambda pair: listed.index(pair[0]) if pair[0] in listed else len(listed)):
                if q.get("raised") or q.get("uncertain"):
                    said = clean(q.get("why"))
                    text = ". ".join(filter(None, [self.close if q.get("uncertain") else "", said])) or "no reason given"
                    reasons.append(Reason(qid, text, float(q["final"]), float(q["raise_at"])))
            if data.get("consequential") and not reasons:
                reasons = [Reason("not_judged", clean(data.get("reason")) or "the owner merges: nothing was judged")]
            return Verdict(self.name, headline, tuple(reasons), str(data.get("head", "")), consequential=bool(data.get("consequential")))
        reasons = [Reason(qid, clean(why), float(p), float(line)) for qid, p, line, why in self.bullet.findall(body)]
        head = re.search(r"\bat `([0-9a-f]{7,40})`", first)
        return Verdict(self.name, headline, tuple(reasons), head.group(1) if head else "", consequential=yes)

    def reply(self, decision: Decision, verdict: Verdict | None) -> str:
        if decision.glad:
            because = f" because {', '.join(decision.reasons)}" if decision.reasons else ""
            other = f"; other: {decision.other}" if decision.other else ""
            return f"consequential: right{because}{other}"
        shown = " ".join(r.id for r in verdict.reasons) if verdict else ""
        return " ".join(filter(None, ["consequential: wrong", shown, decision.other]))


# ---------------------------------------------------------------- store: where answers are kept

class Store(Protocol):
    def append(self, record: dict) -> None: ...

    def records(self) -> list[dict]: ...


class JsonlStore:
    """One JSON object per line, appended and synced, so an answer survives the next crash."""

    def __init__(self, path: Path) -> None:
        self.path, self._lock = path, threading.Lock()

    def append(self, record: dict) -> None:
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a") as file:
                file.write(json.dumps(record, sort_keys=True) + "\n")
                file.flush()
                os.fsync(file.fileno())

    def records(self) -> list[dict]:
        if not self.path.is_file():
            return []
        rows = []
        for line in self.path.read_text().splitlines():
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return rows


class HookedStore:
    """A store that also pipes each record, as JSON on stdin, to a command. The command failing
    is reported and never loses the record: the inner store has it already."""

    def __init__(self, inner: Store, command: str) -> None:
        self.inner, self.command = inner, command

    def append(self, record: dict) -> None:
        self.inner.append(record)
        try:
            done = subprocess.run(self.command, shell=True, input=json.dumps(record), text=True,
                                  capture_output=True, timeout=30)
            if done.returncode:
                print(f"--on-record exited {done.returncode}: {done.stderr.strip()[:200]}", file=sys.stderr)
        except (OSError, subprocess.TimeoutExpired) as error:
            print(f"--on-record failed ({error.__class__.__name__})", file=sys.stderr)

    def records(self) -> list[dict]:
        return self.inner.records()


def default_state() -> Path:
    home = Path(os.environ.get("XDG_STATE_HOME") or Path.home() / ".local" / "state")
    return home / "consequential-check" / "decisions.jsonl"


# ---------------------------------------------------------------- forge: where pull requests live

class ForgeError(RuntimeError):
    pass


class Forge(Protocol):
    """Everything the queue needs from the host of the pull requests. `waiting` returns plain
    dicts: number, title, url, author, head, additions, deletions, changed_files, draft, and
    comments as [{id, author, body}]."""

    def login(self) -> str: ...

    def waiting(self, repo: str, labels: tuple[str, ...]) -> list[dict]: ...

    def head(self, repo: str, number: int) -> str: ...

    def comment(self, repo: str, number: int, body: str) -> str: ...

    def relabel(self, repo: str, number: int, remove: tuple[str, ...], add: tuple[str, ...]) -> str: ...

    def merge(self, repo: str, number: int, head: str, method: str) -> str: ...

    def rerun(self, repo: str, head: str, check: str) -> str: ...


class GitHub:
    """GitHub's REST API with the owner's own token: GH_TOKEN, GITHUB_TOKEN, or `gh auth token`.
    A token GitHub refuses is dropped and the next one tried, since a cloud session's variable
    may hold a placeholder its proxy replaces, or one that has expired."""

    FAILED = {"failure", "timed_out", "cancelled", "action_required", "startup_failure", "stale"}

    def __init__(self, api: str = "", tokens: list[str] | None = None, despite: tuple[str, ...] = ()) -> None:
        self.api = (api or os.environ.get("GITHUB_API_URL") or "https://api.github.com").rstrip("/")
        self._token: str | None = None
        self._given = tokens
        self.despite = despite  # checks a merge may go ahead without, for one that fails by design

    def tokens(self) -> Iterator[str]:
        if self._given is not None:
            yield from self._given
            return
        seen: set[str] = set()
        for name in ("GH_TOKEN", "GITHUB_TOKEN"):
            if (token := os.environ.get(name, "").strip()) and token not in seen:
                seen.add(token)
                yield token
        try:
            token = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=10).stdout.strip()
        except (OSError, subprocess.TimeoutExpired):
            token = ""
        if token and token not in seen:
            yield token

    def send(self, method: str, path: str, body: dict | None, token: str) -> object:
        request = urllib.request.Request(
            self.api + path, method=method, data=None if body is None else json.dumps(body).encode(),
            headers={"Accept": "application/vnd.github+json", "Authorization": f"Bearer {token}",
                     "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=30) as response:
            text = response.read()
            return json.loads(text) if text else None

    def call(self, method: str, path: str, body: dict | None = None) -> object:
        refused = "no GitHub token: set GH_TOKEN or sign in with `gh auth login`"
        for token in [self._token] if self._token else self.tokens():
            try:
                result = self.send(method, path, body, token)
            except urllib.error.HTTPError as error:
                try:
                    said = clean(json.load(error).get("message"), 200)
                except (ValueError, AttributeError):
                    said = ""
                refused = f"GitHub answered {error.code}" + (f": {said}" if said else "")
                # 401 is the token; 403 is the token only before any call has worked with it.
                if error.code == 401 or (error.code == 403 and not self._token):
                    continue
                raise ForgeError(refused) from None
            except (urllib.error.URLError, TimeoutError) as error:
                raise ForgeError(f"no answer from GitHub ({error.__class__.__name__})") from None
            self._token = token
            return result
        raise ForgeError(refused)

    def pages(self, path: str) -> list[dict]:
        rows: list[dict] = []
        for page in range(1, 11):
            batch = self.call("GET", f"{path}{'&' if '?' in path else '?'}per_page=100&page={page}")
            assert isinstance(batch, list)
            rows += batch
            if len(batch) < 100:
                break
        return rows

    def login(self) -> str:
        return str(self.call("GET", "/user")["login"])  # type: ignore[index]

    def waiting(self, repo: str, labels: tuple[str, ...]) -> list[dict]:
        numbers = sorted({issue["number"] for label in labels
                          for issue in self.pages(f"/repos/{repo}/issues?state=open&labels={urllib.parse.quote(label)}")
                          if "pull_request" in issue})

        def read(number: int) -> dict:
            pull = self.call("GET", f"/repos/{repo}/pulls/{number}")
            assert isinstance(pull, dict)
            comments = self.pages(f"/repos/{repo}/issues/{number}/comments")
            return {"number": number, "title": pull.get("title", ""), "url": pull.get("html_url", ""),
                    "author": (pull.get("user") or {}).get("login", ""), "head": pull["head"]["sha"],
                    "additions": pull.get("additions", 0), "deletions": pull.get("deletions", 0),
                    "changed_files": pull.get("changed_files", 0), "draft": bool(pull.get("draft")),
                    "labels": [label["name"] for label in pull.get("labels", [])],
                    "comments": [{"id": c["id"], "author": (c.get("user") or {}).get("login", ""), "body": c.get("body") or ""}
                                 for c in comments]}

        with ThreadPoolExecutor(max_workers=6) as pool:
            return list(pool.map(read, numbers))

    def head(self, repo: str, number: int) -> str:
        return str(self.call("GET", f"/repos/{repo}/pulls/{number}")["head"]["sha"])  # type: ignore[index]

    def comment(self, repo: str, number: int, body: str) -> str:
        made = self.call("POST", f"/repos/{repo}/issues/{number}/comments", {"body": body})
        return f"commented: {made.get('html_url', '')}" if isinstance(made, dict) else "commented"

    def relabel(self, repo: str, number: int, remove: tuple[str, ...], add: tuple[str, ...]) -> str:
        for label in remove:
            try:
                self.call("DELETE", f"/repos/{repo}/issues/{number}/labels/{urllib.parse.quote(label, safe='')}")
            except ForgeError as error:
                if "404" not in str(error):  # already off is fine
                    raise
        if add:
            self.call("POST", f"/repos/{repo}/issues/{number}/labels", {"labels": list(add)})
        return ", ".join([f"-{name}" for name in remove] + [f"+{name}" for name in add])

    def unready(self, repo: str, number: int, head: str) -> list[str]:
        """Why not to merge this head. An owner's token can merge past a failing check, and
        GitHub then says nothing, so the checks are read here first."""
        pull = self.call("GET", f"/repos/{repo}/pulls/{number}")
        assert isinstance(pull, dict)
        found = ["it is a draft"] if pull.get("draft") else []
        if pull.get("mergeable") is False:
            found.append("it conflicts with its base")
        # The latest run of each job, where a job is a name within one check suite: a re-run
        # replaces its own earlier run, and a passing job never stands in for a failing one of the
        # same name in another workflow.
        latest: dict[tuple[object, str], dict] = {}
        for page in range(1, 11):
            batch = self.call("GET", f"/repos/{repo}/commits/{head}/check-runs?per_page=100&page={page}")
            runs = batch.get("check_runs", []) if isinstance(batch, dict) else []
            for run in runs:
                job = ((run.get("check_suite") or {}).get("id"), run["name"])
                if job not in latest or run.get("id", 0) > latest[job].get("id", 0):
                    latest[job] = run
            if len(runs) < 100:
                break
        statuses = self.call("GET", f"/repos/{repo}/commits/{head}/status?per_page=100").get("statuses", [])  # type: ignore[union-attr]
        states = [(name, "running" if run.get("status") != "completed" else "failed" if run.get("conclusion") in self.FAILED else "ok")
                  for (_, name), run in latest.items()]
        states += [(s["context"], {"success": "ok", "pending": "running"}.get(s.get("state"), "failed")) for s in statuses]
        for state, said in (("failed", "checks failing"), ("running", "checks still running")):
            if names := sorted({name for name, value in states if value == state and name not in self.despite}):
                found.append(f"{said}: {', '.join(names)}")
        return found

    def merge(self, repo: str, number: int, head: str, method: str) -> str:
        if unready := self.unready(repo, number, head):
            raise ForgeError("not merged: " + "; ".join(unready))
        self.call("PUT", f"/repos/{repo}/pulls/{number}/merge", {"sha": head, "merge_method": method})
        return f"merged at {head[:9]} ({method})"

    def rerun(self, repo: str, head: str, check: str) -> str:
        """Run the named check again on this head. An Actions job's id is its check run's id."""
        found = self.call("GET", f"/repos/{repo}/commits/{head}/check-runs?per_page=100&check_name={urllib.parse.quote(check)}")
        runs = found.get("check_runs", []) if isinstance(found, dict) else []
        if not runs:
            raise ForgeError(f"no `{check}` run on {head[:9]} to run again")
        self.call("POST", f"/repos/{repo}/actions/jobs/{max(run['id'] for run in runs)}/rerun")
        return f"`{check}` is running again on {head[:9]}"


class DryRun:
    """Reads go to the real forge; every write only says what it would have done."""

    def __init__(self, inner: Forge) -> None:
        self.inner = inner
        self.login, self.waiting, self.head = inner.login, inner.waiting, inner.head

    def rerun(self, repo: str, head: str, check: str) -> str:
        return f"would run `{check}` again on {head[:9]}"

    def comment(self, repo: str, number: int, body: str) -> str:
        return f"would comment: {body.splitlines()[0]}"

    def relabel(self, repo: str, number: int, remove: tuple[str, ...], add: tuple[str, ...]) -> str:
        return "would set " + ", ".join([f"-{name}" for name in remove] + [f"+{name}" for name in add])

    def merge(self, repo: str, number: int, head: str, method: str) -> str:
        return f"would merge at {head[:9]} ({method})"


class Demo:
    """Made-up pull requests held in memory, for trying the page and for the self-test."""

    def __init__(self, pulls: dict[str, list[dict]] | None = None, owner: str = "owner") -> None:
        self.pulls, self.owner, self.merged = pulls if pulls is not None else demo_pulls(), owner, []
        self.reran: list[tuple[str, str, str]] = []
        self._ids = iter(range(9000, 99999))

    def find(self, repo: str, number: int) -> dict:
        return next(pull for pull in self.pulls.get(repo, []) if pull["number"] == number)

    def login(self) -> str:
        return self.owner

    def waiting(self, repo: str, labels: tuple[str, ...]) -> list[dict]:
        return [json.loads(json.dumps(pull)) for pull in self.pulls.get(repo, [])
                if not pull.get("merged") and {name.lower() for name in labels} & {name.lower() for name in pull["labels"]}]

    def head(self, repo: str, number: int) -> str:
        return self.find(repo, number)["head"]

    def comment(self, repo: str, number: int, body: str) -> str:
        self.find(repo, number)["comments"].append({"id": next(self._ids), "author": self.owner, "body": body})
        return "commented"

    def relabel(self, repo: str, number: int, remove: tuple[str, ...], add: tuple[str, ...]) -> str:
        pull = self.find(repo, number)
        gone = {name.lower() for name in remove}
        pull["labels"] = [name for name in pull["labels"] if name.lower() not in gone] + [n for n in add if n not in pull["labels"]]
        return ", ".join([f"-{name}" for name in remove] + [f"+{name}" for name in add])

    def merge(self, repo: str, number: int, head: str, method: str) -> str:
        pull = self.find(repo, number)
        if pull.get("blocked"):
            raise ForgeError(f"GitHub answered 405: {pull['blocked']}")
        pull["merged"] = True
        self.merged.append((repo, number, head))
        return f"merged at {head[:9]} ({method})"

    def rerun(self, repo: str, head: str, check: str) -> str:
        self.reran.append((repo, head, check))
        return f"`{check}` is running again on {head[:9]}"


def demo_comment(head: str, raised: dict[str, tuple[float, float, str]], reason: str = "", unsure: tuple[str, ...] = (),
                 consequential: bool = True) -> str:
    """A verdict comment in the shape consequential.py writes, with its data line."""
    decided = None if unsure or not (raised or not consequential) else "jev-1.14.0"
    lines = [MARKER, f"**Consequential: {'yes' if consequential else 'no'}** at `{head[:12]}`" + (f", decided by `{decided}`" if decided else ""), ""]
    if consequential:
        lines += ["**Why the owner merges this one**", ""]
        lines += [f"- **{qid}** (p {p:.2f}, line {line:.2f}): {'too close to its line to call. ' if qid in unsure else ''}{why}"
                  for qid, (p, line, why) in raised.items()] or [f"- {reason}."]
    else:
        lines += ["**The check still fails.** The pull request carries the `consequential` label, from an earlier head or added by hand."]
    data = {"head": head, "consequential": consequential, "judged": bool(raised) or not consequential, "decided_by": decided,
            "raised": [qid for qid, (p, line, _) in raised.items() if p >= line], "uncertain": list(unsure), "reason": reason,
            "questions": {qid: {"final": p, "raise_at": line, "raised": p >= line, "uncertain": qid in unsure, "why": why}
                          for qid, (p, line, why) in raised.items()}}
    return "\n".join([*lines, "", hidden(DATA_MARKER, data), "<!-- agent-note -->"]) + "\n"


def demo_pulls() -> dict[str, list[dict]]:
    def pull(number: int, title: str, head: str, size: tuple[int, int, int], comment: str, **more: object) -> dict:
        return {"number": number, "title": title, "url": f"https://github.com/example/app/pull/{number}", "author": "an-agent",
                "head": head * 5, "additions": size[0], "deletions": size[1], "changed_files": size[2], "draft": False,
                "labels": ["consequential"], "comments": [{"id": number * 10, "author": "github-actions[bot]", "body": comment}],
                **more}

    return {"example/app": [
        pull(101, "Drop the legacy sessions table", "a1b2c3d4", (48, 212, 6), demo_comment("a1b2c3d4" * 5, {
            "hard_to_undo": (0.91, 0.5, "the migration drops `sessions_v1` and its rows in place"),
            "exposes_private_data": (0.34, 0.3, "the backfill logs each migrated email address")})),
        pull(102, "Widen the deploy workflow's token to write packages", "b2c3d4e5", (9, 3, 1), demo_comment("b2c3d4e5" * 5, {
            "weakens_security": (0.82, 0.3, "adds `packages: write` to the workflow's permissions")})),
        pull(103, "Fix a typo in the retry log line", "c3d4e5f6", (1, 1, 1), demo_comment("c3d4e5f6" * 5, {
            "costs_money": (0.46, 0.5, "the retry loop calls the billed API")}, unsure=("costs_money",))),
        pull(104, "Nightly re-index against the search API", "d4e5f6a7", (120, 4, 5), demo_comment("d4e5f6a7" * 5, {
            "costs_money": (0.88, 0.5, "a new cron calls the billed search API every night"),
            "product_decision": (0.64, 0.6, "search results change order for every user")}),
            blocked="Required status check \"ci\" is failing"),
        pull(105, "Rename the export button", "e5f6a7b8", (6, 6, 2),
             demo_comment("e5f6a7b8" * 5, {}, "no question raised", consequential=False), labels=["Consequential"]),
    ]}


# ---------------------------------------------------------------- policy: what an answer does

@dataclass(frozen=True)
class Step:
    name: str
    run: Callable[[Forge], str]


class Policy(Protocol):
    """What happens on the forge when the owner answers. Steps run in order and stop at the first
    that fails, so a merge never follows a reply that was not posted."""

    def steps(self, decision: Decision, item: Item, config: Config, reply: str) -> list[Step]: ...


class ReplyLabelMerge:
    """Post the reply, change the label to say what was decided, merge when asked.

    Overruled: `consequential` comes off and the overruled label goes on. The check is not run
    again: it would raise the same head again, so that head stays the owner's to merge, and the
    label no longer fails a later head that raises nothing. Confirmed: the confirmed label goes
    on beside `consequential`, which stays. The merge comes last, so a refused one leaves the
    answer posted and labelled."""

    def steps(self, decision: Decision, item: Item, config: Config, reply: str) -> list[Step]:
        repo, number = item.repo, item.number
        stale, add = ((config.overruled_label,), config.confirmed_label) if decision.glad else (
            (config.label, config.confirmed_label), config.overruled_label)
        remove = tuple(name for name in stale if name.lower() in item.labels)
        steps = [Step("reply", lambda forge: forge.comment(repo, number, reply)),
                 Step("label", lambda forge: forge.relabel(repo, number, remove, (add,)))]
        if decision.merge:
            steps.append(Step("merge", lambda forge: forge.merge(repo, number, decision.head, config.merge_method)))
        return steps


# ---------------------------------------------------------------- the queue

def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Queue:
    """Reads what is waiting, takes an answer, acts on it, and keeps a record of both."""

    def __init__(self, config: Config, forge: Forge, store: Store, policy: Policy, dialects: list[Dialect]) -> None:
        self.config, self.forge, self.store, self.policy, self.dialects = config, forge, store, policy, dialects
        self.items: dict[str, Item] = {}
        self._owner = ""
        self._lock = threading.Lock()

    def owner(self) -> str:
        self._owner = self._owner or self.forge.login()
        return self._owner

    def verdict(self, comments: list[dict]) -> Verdict | None:
        """The check's latest verdict comment. Only a bot's comment counts: anyone can comment."""
        for comment in reversed(comments):
            if comment["author"] not in self.config.bots:
                continue
            for dialect in self.dialects:
                try:
                    found = dialect.read(comment["body"])
                except (TypeError, ValueError, KeyError, AttributeError):
                    continue  # the marker with a body in the wrong shape: not a verdict this can read
                if found:
                    return replace(found, comment_id=int(comment["id"]))
        return None

    def answers(self, comments: list[dict]) -> list[dict]:
        """The owner's earlier answers on this pull request, read from their own replies."""
        mine = [unhidden(DECISION_MARKER, c["body"]) for c in comments if c["author"] == self.owner()]
        return [answer for answer in mine if answer]

    def item(self, repo: str, pull: dict) -> Item | None:
        answers = self.answers(pull["comments"])
        current = next((a for a in reversed(answers) if a.get("head") == pull["head"]), None)
        labels = tuple(name.lower() for name in pull["labels"])
        verdict = self.verdict(pull["comments"])
        judged_here = bool(verdict and verdict.head and (pull["head"].startswith(verdict.head) or verdict.head.startswith(pull["head"])))
        if current:
            state = "answered"  # stays listed until it merges: the check is still red on this head
        elif self.config.label.lower() not in labels:
            return None  # a decision label alone, left by an earlier head, with nothing flagged now
        elif verdict and verdict.head and not judged_here:
            state = "pending"  # the reasons on record are an earlier head's: nothing to answer yet
        else:
            state = "stale" if verdict and not verdict.consequential and judged_here else "waiting"
        earlier = tuple(f"{'confirmed' if a.get('glad') else 'overruled'} at {str(a.get('head'))[:9]}"
                        for a in answers if a.get("head") != pull["head"])
        return Item(repo, pull["number"], pull["title"], pull["url"], pull["author"], pull["head"],
                    f"+{pull['additions']} −{pull['deletions']} in {pull['changed_files']} file{'s' if pull['changed_files'] != 1 else ''}",
                    pull["draft"], state, verdict, earlier, labels,
                    ("confirmed" if current.get("glad") else "overruled") if current else "")

    def refresh(self) -> list[Item]:
        labels = (self.config.label, self.config.confirmed_label, self.config.overruled_label)
        found = [item for repo in self.config.repos for pull in self.forge.waiting(repo, labels)
                 if (item := self.item(repo, pull))]
        found.sort(key=lambda item: (("waiting", "stale", "answered", "pending").index(item.state), item.repo, item.number))
        with self._lock:
            self.items = {item.key: item for item in found}
        return found

    def reply(self, decision: Decision, item: Item) -> str:
        """The owner's reply: the dialect's line the tuning step reads, and the answer as data."""
        dialect = next((d for d in self.dialects if item.verdict and d.name == item.verdict.dialect), self.dialects[-1])
        data = {"head": decision.head, "glad": decision.glad, "reasons": list(decision.reasons), "other": decision.other,
                "shown": [reason.id for reason in item.verdict.reasons] if item.verdict else [],
                "verdict_comment": item.verdict.comment_id if item.verdict else 0, "merge": decision.merge}
        return f"{dialect.reply(decision, item.verdict)}\n\n{hidden(DECISION_MARKER, data)}\n"

    def refused(self, detail: str) -> dict:
        return {"ok": False, "steps": [{"step": "check", "ok": False, "detail": detail}]}

    def act(self, item: Item, head: str, record: dict, plan: list[Step]) -> dict:
        """Run `plan` for the head the page showed. The record is kept before anything is done, and
        what was done is kept after."""
        steps: list[dict] = []
        try:
            live = self.forge.head(item.repo, item.number)
        except ForgeError as error:
            live, steps = "", [{"step": "check", "ok": False, "detail": str(error)}]
        if live and (live != item.head or live != head):
            steps = [{"step": "check", "ok": False, "detail": f"the head is now {live[:9]}, not the one shown: reload"}]
        if not steps:
            self.store.append({"at": now(), "by": self.owner(), "repo": item.repo, "number": item.number, "title": item.title,
                               "head": head, "dry_run": self.config.dry_run, **record})
            for step in plan:
                try:
                    steps.append({"step": step.name, "ok": True, "detail": step.run(self.forge)})
                except ForgeError as error:
                    steps.append({"step": step.name, "ok": False, "detail": str(error)})
                    break
        ok = all(step["ok"] for step in steps)
        self.store.append({"kind": "outcome", "at": now(), "repo": item.repo, "number": item.number, "head": head,
                           "ok": ok, "steps": steps, "dry_run": self.config.dry_run})
        return {"ok": ok, "steps": steps}

    def decide(self, decision: Decision) -> dict:
        with self._lock:
            item = self.items.get(decision.key)
        if item is None:
            return self.refused("not in the queue any more: reload")
        if item.state == "stale":
            return self.refused("this head raised nothing: clear the label instead")
        if item.state == "pending":
            return self.refused("the check has not judged this head yet: reload once it has")
        shown = {reason.id for reason in item.verdict.reasons} if item.verdict else set()
        if unknown := set(decision.reasons) - shown:
            return self.refused(f"not a reason shown: {sorted(unknown)}")
        # An answer already given at this head is not posted or counted twice; only the merge is left.
        answered = item.state == "answered"
        if answered and not decision.merge:
            return self.refused("already answered at this head")
        record = {"kind": "merge" if answered else "decision", "glad": decision.glad, "reasons": list(decision.reasons),
                  "other": decision.other, "merge": decision.merge, "seconds": decision.seconds,
                  "dialect": item.verdict.dialect if item.verdict else "", "verdict_head": item.verdict.head if item.verdict else "",
                  "shown": [asdict(reason) for reason in item.verdict.reasons] if item.verdict else []}
        plan = self.policy.steps(decision, item, self.config, self.reply(decision, item))
        out = self.act(item, decision.head, record, [step for step in plan if step.name == "merge" or not answered])
        done = {step["step"] for step in out["steps"] if step["ok"]}
        with self._lock:
            if "merge" in done:
                self.items.pop(item.key, None)
            elif "reply" in done:
                self.items[item.key] = replace(item, state="answered", answer="confirmed" if decision.glad else "overruled")
        return out

    def clear(self, key: str, head: str) -> dict:
        """Take the label off a pull request whose current head raised nothing, and run the check
        again: the owner's way to clear a raise an earlier head left."""
        with self._lock:
            item = self.items.get(key)
        if item is None or item.state != "stale":
            return self.refused("not a pull request with only the label left: reload")
        repo, number, config = item.repo, item.number, self.config
        gone = tuple(name for name in (config.label, config.confirmed_label, config.overruled_label) if name.lower() in item.labels)
        out = self.act(item, head, {"kind": "clear"}, [
            Step("label", lambda forge: forge.relabel(repo, number, gone, ())),
            Step("rerun", lambda forge: forge.rerun(repo, head, config.check))])
        if out["ok"]:
            with self._lock:
                self.items.pop(key, None)
        return out


    def rerun(self, key: str, head: str) -> dict:
        """Run the check again on a head it has not judged: the way out when its run died, since
        nothing here can tell a slow check from a dead one."""
        with self._lock:
            item = self.items.get(key)
        if item is None or item.state != "pending":
            return self.refused("not a pull request waiting on the check: reload")
        repo, check = item.repo, self.config.check
        return self.act(item, head, {"kind": "rerun"}, [Step("rerun", lambda forge: forge.rerun(repo, head, check))])


def summary(records: list[dict]) -> str:
    """How the answers fall: per reason, how often it was shown and how often it was why."""
    latest: dict[tuple[str, int, str], dict] = {}
    for record in records:
        if record.get("kind") == "decision" and not record.get("dry_run"):
            latest[(record["repo"], record["number"], record["head"])] = record
    if not latest:
        return "No answers recorded yet.\n"
    glad = sum(1 for record in latest.values() if record["glad"])
    out = [f"{len(latest)} answered: {glad} glad it was flagged, {len(latest) - glad} not.", "",
           f"{'reason':<24}{'shown':>6}{'was why':>9}{'not why':>9}{'flag unwanted':>15}"]
    rows: dict[str, list[int]] = {}
    for record in latest.values():
        for reason in record.get("shown", []):
            row = rows.setdefault(reason["id"], [0, 0, 0, 0])
            row[0] += 1
            row[1 if record["glad"] and reason["id"] in record["reasons"] else 2 if record["glad"] else 3] += 1
    out += [f"{name:<24}{row[0]:>6}{row[1]:>9}{row[2]:>9}{row[3]:>15}" for name, row in sorted(rows.items())]
    others = [record["other"] for record in latest.values() if record["glad"] and record.get("other")]
    if others:
        out += ["", "Reasons the check did not give:"] + [f"- {text}" for text in others]
    return "\n".join(out) + "\n"


# ---------------------------------------------------------------- the page

PAGE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Consequential queue</title>
<style>
/* Lede's look (https://lede.cloudcompute.com) in plain CSS: its tokens by name, flat cards on a
   grouped ground, capsule controls, one filled button, and native elements throughout. */
:root {
  color-scheme: light dark;
  --primary: #0a63d1; --primary-foreground: #ffffff; --background-grouped: #f2f2f5; --foreground: #131316;
  --card: #ffffff; --muted-foreground: #5b5b63; --fill-control: rgba(120, 120, 132, 0.14); --fill-selected: #ffffff;
  --border: rgba(60, 60, 67, 0.20); --input: #7a7a82; --destructive: #b6232b;
  --shadow-raised: 0 1px 3px rgba(0, 0, 0, 0.10), 0 1px 1px rgba(0, 0, 0, 0.04);
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-6: 24px; --space-8: 32px;
  --radius: 22px; --radius-md: 14px; --size-hit-min: 44px;
  --font-sans: -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
}
@media (prefers-color-scheme: dark) { :root {
  --primary: #4c9aff; --primary-foreground: #06111f; --background-grouped: #000000; --foreground: #f4f4f6;
  --card: #1c1c1f; --muted-foreground: #acacb3; --fill-control: rgba(120, 120, 132, 0.28); --fill-selected: #5a5a60;
  --border: rgba(84, 84, 92, 0.65); --input: #8c8c94; --destructive: #ff8a8a; --shadow-raised: 0 1px 3px rgba(0, 0, 0, 0.60);
} }
@media (prefers-contrast: more) { :root {
  --primary: #0040a8; --background-grouped: #ffffff; --foreground: #000000; --muted-foreground: #2f2f35;
  --fill-control: #e4e4ea; --border: #5f5f66; --input: #5f5f66; --destructive: #8c0f16;
} }
@media (prefers-contrast: more) and (prefers-color-scheme: dark) { :root {
  --primary: #9cc9ff; --primary-foreground: #000000; --background-grouped: #000000; --foreground: #ffffff; --card: #121214;
  --muted-foreground: #dcdce2; --fill-control: #2a2a30; --border: #a0a0a8; --input: #a0a0a8; --destructive: #ffb5b5;
} }
* { box-sizing: border-box; }
h1, h2, h3, p, ul, dl, dd, fieldset, legend { margin: 0; padding: 0; }
ul { list-style: none; }
[hidden] { display: none !important; }

/* The page: one column, with a gutter that grows with the window. */
body { margin: 0 auto; max-width: 44rem; padding: 40px clamp(var(--space-4), 5vw, var(--space-8)) 64px;
  background: var(--background-grouped); color: var(--foreground); font: 1.0625rem/1.375rem var(--font-sans);
  -webkit-font-smoothing: antialiased; overflow-wrap: anywhere; }
h1 { font-size: 2.125rem; line-height: 2.5625rem; letter-spacing: -0.025rem; text-wrap: balance; }
h2 { font-size: 1.25rem; line-height: 1.5625rem; text-wrap: balance; }
a { color: inherit; text-decoration: none; text-underline-offset: 3px; }
a:hover { text-decoration: underline; }
.muted { color: var(--muted-foreground); }
.note, h3 { font-size: 0.8125rem; line-height: 1.125rem; color: var(--muted-foreground); }
h3 { font-weight: 600; }
legend, .field > label { display: block; font-size: 0.9375rem; line-height: 1.25rem; font-weight: 600; }
/* The focus ring. The page moves focus itself (on load, after an answer, between sections), and
   browsers differ on whether focus a script moved counts as keyboard focus. So the page keeps its
   own account: `data-keys` is on the root from the start and after any key, and off after a click. */
:focus-visible, :root[data-keys] :focus { outline: 2px solid var(--primary); outline-offset: 2px; }
:root :is(.track, .check) input:focus { outline: none; }  /* its track or its label wears the ring */

/* PageHeader: the title with its one action beside it, and the summary under both at full width. */
body > header { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: var(--space-1) var(--space-4); }
#summary { grid-column: 1 / -1; }
#summary span { white-space: nowrap; }  /* a line breaks between counts, never inside one */
main { margin-top: var(--space-6); }
main > * + * { margin-top: var(--space-4); }
#status:empty + * { margin-top: 0; }  /* a live region is announced only if it was in the page before it had text */
#status { font-size: 0.9375rem; line-height: 1.25rem; }
#status.failed { color: var(--destructive); }

/* Card: the pull request being answered. One step of space between its parts, half a step inside them. */
.card { display: grid; gap: var(--space-6); padding: var(--space-6); border-radius: var(--radius); background: var(--card); min-width: 0; }
.card > * { min-width: 0; }
.card > header > * + * { margin-top: var(--space-1); }
.card h3 { margin-bottom: var(--space-2); }
.reasons li { padding: var(--space-3) 0; }
.reasons li:first-child { padding-top: 0; }
.reasons li + li { border-top: 1px solid var(--border); }
.reasons strong { display: block; font-size: 0.9375rem; line-height: 1.25rem; }
form { display: grid; gap: var(--space-6); }
fieldset { min-width: 0; border: 0; }
legend { margin-bottom: var(--space-2); }
.field { margin-top: var(--space-3); }
fieldset > .field:first-child { margin-top: 0; }
.field > label { margin-bottom: var(--space-2); }
.field input { display: block; min-height: var(--size-hit-min); width: 100%; padding: 0 var(--space-3); border: 1px solid var(--input);
  border-radius: var(--radius-md); background: var(--card); color: var(--foreground); font: inherit; }

button { min-height: var(--size-hit-min); padding: 0 20px; border: 0; border-radius: 999px; background: var(--fill-control);
  color: var(--foreground); font: inherit; font-weight: 600; white-space: nowrap; cursor: pointer; }
button.filled { background: var(--primary); color: var(--primary-foreground); }
button.plain { padding: 0 var(--space-3); background: none; color: var(--primary); }
button:disabled { opacity: 0.5; cursor: default; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.actions .plain { margin-left: auto; }

/* SegmentedControl: a fieldset of radio inputs on one track. The label wears the focus ring. */
.track { display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr; padding: 2px; border-radius: 999px;
  background: var(--fill-control); vertical-align: top; }
.track label { position: relative; display: grid; place-items: center; min-width: 5.5rem; min-height: 40px; padding: 0 var(--space-4);
  border-radius: 999px; font-weight: 600; cursor: pointer; }
.track input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
.track label:has(:checked) { background: var(--fill-selected); box-shadow: var(--shadow-raised); }
/* Focus lands on the question. Until it has an answer the ring is the whole track's, so that no
   option looks chosen; after that it is the chosen option's. */
.track:not(:has(:checked)):has(:focus-visible), :root[data-keys] .track:not(:has(:checked)):focus-within,
.track label:has(:checked:focus-visible), :root[data-keys] .track label:has(:checked:focus),
.check:has(:focus-visible), :root[data-keys] .check:has(:focus) { outline: 2px solid var(--primary); outline-offset: 2px; }

.check { display: flex; align-items: center; gap: var(--space-3); min-height: var(--size-hit-min); border-radius: var(--radius-md); cursor: pointer; }
.check input { flex: none; width: 1.25rem; height: 1.25rem; margin: 0; accent-color: var(--primary); }

/* Disclosure: a native details whose summary reads while it is closed. */
summary { display: flex; align-items: center; gap: var(--space-2); min-height: var(--size-hit-min); border-radius: var(--radius-md);
  font-size: 0.9375rem; line-height: 1.25rem; font-weight: 600; color: var(--muted-foreground); cursor: pointer; list-style: none; }
summary::-webkit-details-marker { display: none; }
summary::before { content: ""; flex: none; width: 7px; height: 7px; margin: 0 3px 0 2px; border: solid currentColor; border-width: 0 2px 2px 0;
  transform: rotate(-45deg); transition: transform 0.2s; }
details[open] > summary::before { transform: rotate(45deg); }
@media (prefers-reduced-motion: reduce) { summary::before { transition: none; } }
/* Inside the card the summary keeps its hit height and gives back the space that height adds. */
.card details { margin: calc(-1 * var(--space-1)) 0 calc(-1 * var(--space-3)); }
.card details[open] { margin-bottom: 0; }
/* On the page a disclosure is a card of its own. */
main > details { border-radius: var(--radius); background: var(--card); }
main > details > summary { min-height: 56px; padding: 0 var(--space-6); border-radius: var(--radius); outline-offset: -2px; }
main > details > :not(summary) { margin: 0 var(--space-6); }
main > details > :last-child:not(summary) { padding-bottom: var(--space-4); }
main > details > .note { padding-bottom: var(--space-3); }
main > details > dl { margin-top: var(--space-2); }
/* A row's title keeps a readable width: where the row is too narrow, the note and the button move under it. */
.rows li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); min-height: 56px; padding: var(--space-3) 0;
  border-top: 1px solid var(--border); }
.rows a { flex: 1 1 14rem; min-width: 0; }
.rows .note { flex: none; }
.rows button { min-height: 36px; margin-left: auto; padding: 0 var(--space-4); font-size: 0.9375rem; }
dl { display: grid; grid-template-columns: max-content 1fr; align-items: baseline; gap: var(--space-2) var(--space-4); font-size: 0.9375rem; line-height: 1.25rem; }
dt { color: var(--muted-foreground); }
kbd { display: inline-block; min-width: 1.5rem; padding: 1px 6px; border: 1px solid var(--border); border-radius: 6px; text-align: center;
  font: 0.75rem/1.125rem ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--foreground); }
main > details > .check { margin-top: var(--space-2); font-size: 0.9375rem; }

@media (width < 30em) {
  body { padding-top: var(--space-6); }
  h1 { font-size: 1.75rem; line-height: 2.125rem; }
  .card { padding: 20px var(--space-4); }
  main > details > summary { padding: 0 var(--space-4); }
  main > details > :not(summary) { margin: 0 var(--space-4); }
  .actions button:not(.plain) { flex: 1; }
}
</style>
</head>
<body>
<header>
  <h1>Consequential queue</h1>
  <button type="button" id="reload">Reload</button>
  <p id="summary" class="muted">Loading…</p>
</header>

<main>
  <p id="status" role="status"></p>
  <div id="current"></div>

  <details id="stale" hidden>
    <summary></summary>
    <p class="note">The current head raised nothing. Clearing takes the label off and runs the check again.</p>
    <ul class="rows"></ul>
  </details>

  <details id="answered" hidden>
    <summary></summary>
    <p class="note">The check stays red on a head it raised, so these are yours to merge.</p>
    <ul class="rows"></ul>
  </details>

  <details id="pending" hidden>
    <summary></summary>
    <p class="note">The check has not judged the current head. If its run is not in progress, run it again.</p>
    <ul class="rows"></ul>
  </details>

  <details>
    <summary>Keyboard shortcuts</summary>
    <dl>
      <dt><kbd>y</kbd> <kbd>n</kbd></dt><dd>Glad it was flagged, or not</dd>
      <dt><kbd>1</kbd>–<kbd>9</kbd> <kbd>a</kbd></dt><dd>Tick a reason, or all of them</dd>
      <dt><kbd>o</kbd></dt><dd>Type another reason, or what it got wrong</dd>
      <dt><kbd>Enter</kbd></dt><dd>Save and show the next one</dd>
      <dt><kbd>Shift</kbd> <kbd>Enter</kbd></dt><dd>Save and merge</dd>
      <dt><kbd>s</kbd></dt><dd>Skip for now</dd>
      <dt><kbd>j</kbd> <kbd>k</kbd></dt><dd>Next or previous section, and the rows of an open one</dd>
      <dt><kbd>→</kbd> <kbd>←</kbd></dt><dd>Open a section and step into it, step out and close it</dd>
      <dt><kbd>Esc</kbd></dt><dd>Back up: from a row to its section, from anywhere else to the question</dd>
    </dl>
    <label class="check"><input type="checkbox" id="letters" checked>Use the single-key shortcuts</label>
  </details>
</main>

<template id="item">
  <article class="card" aria-labelledby="item-title">
    <header>
      <h2 id="item-title"><a target="_blank" rel="noopener"></a></h2>
      <p class="note" data-meta></p>
    </header>
    <section aria-labelledby="item-why">
      <h3 id="item-why">Flagged for</h3>
      <ul class="reasons"></ul>
      <details hidden>
        <summary>Scores</summary>
        <dl></dl>
      </details>
    </section>
    <form>
      <fieldset>
        <legend>Glad this was flagged?</legend>
        <div class="track">
          <label><input type="radio" name="glad" value="yes" required>Yes</label>
          <label><input type="radio" name="glad" value="no">No</label>
        </div>
      </fieldset>
      <fieldset data-when="yes" hidden disabled>
        <legend>Which was why?</legend>
        <div data-checks></div>
        <div class="field">
          <label for="item-other">Another reason <span class="muted">(optional)</span></label>
          <input id="item-other" name="other" type="text" maxlength="500" autocomplete="off">
        </div>
      </fieldset>
      <fieldset data-when="no" hidden disabled>
        <div class="field">
          <label for="item-note">What it got wrong <span class="muted">(optional)</span></label>
          <input id="item-note" name="note" type="text" maxlength="500" autocomplete="off">
        </div>
      </fieldset>
      <div class="actions">
        <button type="submit" name="then" value="save" class="filled">Save</button>
        <button type="submit" name="then" value="merge">Save and merge</button>
        <button type="button" class="plain" data-skip>Skip</button>
      </div>
    </form>
  </article>
</template>

<template id="empty">
  <section class="card" aria-labelledby="empty-title">
    <header>
      <h2 id="empty-title">Nothing to answer</h2>
      <p class="muted">Every flagged pull request has your answer at its current head.</p>
    </header>
  </section>
</template>

<template id="row">
  <li><a target="_blank" rel="noopener"></a><span class="note"></span><button type="button"></button></li>
</template>

<script>
const TOKEN = __TOKEN__, MODE = __MODE__;
const $ = (selector, root = document) => root.querySelector(selector);
const copy = id => $("#" + id).content.firstElementChild.cloneNode(true);
const words = id => id.replace(/[._]/g, " ");
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const keyOf = item => `${item.repo}#${item.number}`;
let groups = {waiting: [], stale: [], answered: [], pending: []}, since = 0;
const busy = () => { const form = $("#current form"); return !!form && form.ariaBusy === "true"; };

async function api(path, body) {
  const response = await fetch(path, {method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined,
    headers: {"X-Queue-Token": TOKEN, "Content-Type": "application/json"}});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `the server answered ${response.status}`);
  return data;
}
async function act(path, body) {
  try { return await api(path, body); } catch (error) { return {ok: false, steps: [{step: "send", ok: false, detail: error.message}]}; }
}
function lede(parts) {
  const shown = parts.filter(Boolean);
  $("#summary").replaceChildren(...shown.flatMap((text, at) => {
    const part = document.createElement("span"); part.textContent = text + (at < shown.length - 1 ? " ·" : ""); return at ? [" ", part] : [part];
  }));
}
function say(text, failed) { const status = $("#status"); status.textContent = text; status.classList.toggle("failed", !!failed); }
function report(item, out) {
  const did = {reply: "replied", label: "labelled", merge: "merged", rerun: "check running again"};
  const steps = out.steps.map(step => step.ok ? did[step.step] || step.step : `${step.step} failed: ${step.detail}`).join(", ");
  say(`${keyOf(item)} ${out.ok ? "saved" : "not finished"}: ${steps}.`, !out.ok);
}

function showItem() {
  const item = groups.waiting[0], holder = $("#current");
  if (!item) { holder.replaceChildren(copy("empty")); home(); return; }
  const card = copy("item"), form = $("form", card), reasons = item.verdict ? item.verdict.reasons : [];
  const link = $("h2 a", card); link.textContent = item.title; link.href = item.url;
  const stale = item.verdict && item.verdict.head && !item.head.startsWith(item.verdict.head) && !item.verdict.head.startsWith(item.head);
  $("[data-meta]", card).textContent = [keyOf(item), item.size, item.draft && "draft", ...item.earlier.map(text => "you " + text),
    stale && "the reasons are from an earlier head"].filter(Boolean).join(" · ");
  const list = $(".reasons", card), scores = $("section details", card), checks = $("[data-checks]", card);
  if (!reasons.length) list.append(Object.assign(document.createElement("li"), {className: "muted", textContent: "No verdict comment was found."}));
  for (const reason of reasons) {
    const row = document.createElement("li"), name = document.createElement("strong");
    name.textContent = words(reason.id); row.append(name, " " + reason.text); list.append(row);
    if (reason.p != null) {
      scores.hidden = false;
      $("dl", scores).append(Object.assign(document.createElement("dt"), {textContent: words(reason.id)}),
        Object.assign(document.createElement("dd"), {textContent: `${reason.p.toFixed(2)}, raises at ${reason.line.toFixed(2)}`}));
    }
    checks.append(check("reason", reason.id, words(reason.id)));
  }
  if (reasons.length > 1) checks.append(check("all", "", reasons.length === 2 ? "Both" : "All of them"));
  form.addEventListener("change", event => sync(form, event.target));
  form.addEventListener("submit", event => { event.preventDefault(); save(item, form, event.submitter && event.submitter.value === "merge"); });
  $("[data-skip]", form).addEventListener("click", skip);
  holder.replaceChildren(card);
  since = performance.now();
  home();
}
// Where the keyboard starts and where Escape returns to: the question, or with nothing to answer,
// the first section.
function home() {
  const track = $("#current .track");
  if (!track) return ($("main > details:not([hidden]) > summary") || $("#reload")).focus();
  ($(":checked", track) || $("input", track)).focus();
}
// The places j and k step through, top to bottom: the scores, the question, each section's header
// and, while a section is open, what is inside it.
function stops() {
  const track = $("#current .track");
  return [...document.querySelectorAll("#current section details:not([hidden]) > summary"), ...(track ? [track] : []),
    ...document.querySelectorAll("main > details:not([hidden]) > summary, main > details[open]:not([hidden]) :is(.rows button:enabled, #letters)")];
}
function step(by, from) {
  const all = stops(), track = $("#current .track");
  let at = all.findIndex(stop => stop === from || stop.contains(from));
  if (at < 0) at = track ? all.indexOf(track) : by > 0 ? -1 : all.length;  // anywhere else in the form counts as the question
  const to = all[at + by];
  if (to === track) home(); else if (to) to.focus();
  return to;
}
function check(name, value, text) {
  const label = document.createElement("label"), box = document.createElement("input");
  label.className = "check"; box.type = "checkbox"; box.name = name; box.value = value; label.append(box, text); return label;
}
function sync(form, changed) {
  const glad = form.elements.glad.value, boxes = [...form.querySelectorAll("[name=reason]")], all = form.elements.all;
  for (const part of form.querySelectorAll("[data-when]")) part.hidden = part.disabled = part.dataset.when !== glad;
  if (all && changed === all) boxes.forEach(box => box.checked = all.checked);
  else if (all) all.checked = boxes.length > 0 && boxes.every(box => box.checked);
}
function choose(form, glad) {
  form.elements.glad.value = glad; sync(form, null);
  // The ring follows the answer while focus is on the question, or nowhere.
  const active = document.activeElement;
  if (active === document.body || $(".track", form).contains(active)) home();
}

async function save(item, form, merge) {
  if (form.ariaBusy === "true") return;
  form.ariaBusy = "true"; form.querySelectorAll("button").forEach(button => button.disabled = true);
  const glad = form.elements.glad.value === "yes";
  const out = await act("/api/decide", {key: keyOf(item), head: item.head, glad, merge,
    reasons: glad ? [...form.querySelectorAll("[name=reason]:checked")].map(box => box.value) : [],
    other: (glad ? form.elements.other : form.elements.note).value.trim(), seconds: Math.round((performance.now() - since) / 100) / 10});
  report(item, out);
  const replied = out.steps.some(step => step.step === "reply" && step.ok);
  if (out.ok || replied) {
    groups.waiting = groups.waiting.filter(other => other !== item);
    if (!(out.ok && merge)) groups.answered.push({...item, state: "answered", answer: glad ? "confirmed" : "overruled"});
    render();
  } else { form.ariaBusy = "false"; form.querySelectorAll("button").forEach(button => button.disabled = false); home(); }
}
function skip() { if (!busy() && groups.waiting.length > 1) { groups.waiting.push(groups.waiting.shift()); say(""); showItem(); } }

function showRows(id, items, summary, label, run, stays) {
  const group = $("#" + id); group.hidden = !items.length; $("summary", group).textContent = summary;
  $("ul", group).replaceChildren(...items.map(item => {
    const row = copy("row"), link = $("a", row), button = $("button", row);
    link.textContent = item.title; link.href = item.url; $("span", row).textContent = item.answer || keyOf(item);
    button.textContent = label; button.setAttribute("aria-label", `${label}: ${item.title}`);
    button.addEventListener("click", async () => {
      const at = [...row.parentElement.children].indexOf(row), held = document.activeElement === button;
      button.disabled = true; const out = await run(item); report(item, out);
      if (out.ok && !stays) { groups[id] = groups[id].filter(other => other !== item); render(false); } else button.disabled = out.ok;
      if (!held) return;
      // The row now in this one's place, then the rows after it, then the ones before, nearest first.
      const rows = [...group.querySelectorAll(".rows li")];
      const near = [...rows.slice(at), ...rows.slice(0, at).reverse()].map(other => $("button:enabled", other)).find(Boolean);
      if (near) near.focus(); else if (group.hidden) home(); else $("summary", group).focus();
    });
    return row;
  }));
}
function render(item = true) {
  const {waiting, stale, answered, pending} = groups;
  lede([`${waiting.length} to answer`, stale.length && plural(stale.length, "leftover label", "leftover labels"),
    answered.length && `${answered.length} answered, still open`, pending.length && `${pending.length} waiting on the check`, MODE]);
  if (item) showItem();
  showRows("stale", stale, plural(stale.length, "with only the label left", "with only the label left"), "Clear label",
    item => act("/api/clear", {key: keyOf(item), head: item.head}));
  showRows("answered", answered, `${answered.length} answered, still open`, "Merge",
    item => act("/api/decide", {key: keyOf(item), head: item.head, glad: item.answer !== "overruled", merge: true, reasons: [], other: ""}));
  showRows("pending", pending, `${pending.length} waiting on the check`, "Run the check again",
    item => act("/api/rerun", {key: keyOf(item), head: item.head}), true);
}
async function load() {
  $("#summary").textContent = "Loading…"; say("");
  let data; try { data = await api("/api/queue"); } catch (error) { $("#summary").textContent = "Could not load the queue."; say(error.message, true); return; }
  groups = {waiting: [], stale: [], answered: [], pending: []};
  for (const item of data.items) groups[item.state].push(item);
  render();
}

// Every shortcut has a visible control that does the same thing, and the single-key ones can be
// turned off: a stray key, or speech input, should not be able to answer.
const letters = $("#letters");
try { letters.checked = localStorage.getItem("letters") !== "off"; } catch (error) { /* storage is optional */ }
letters.addEventListener("change", () => { try { localStorage.setItem("letters", letters.checked ? "on" : "off"); } catch (error) { /* optional */ } });
const root = document.documentElement;
root.dataset.keys = "";
document.addEventListener("pointerdown", () => delete root.dataset.keys, true);
document.addEventListener("keydown", event => {
  root.dataset.keys = "";
  if (busy() || event.metaKey || event.ctrlKey || event.altKey) return;
  const form = $("#current form"), target = event.target, key = event.key;
  const header = target.matches("summary") ? target : null, section = target.closest("details");
  const inside = !header && !!section && !!target.closest("main > details");  // a row's button, or the toggle below
  // Escape backs up one level: from inside a section to its header, from anywhere else to the question.
  if (key === "Escape") { event.preventDefault(); return inside ? $("summary", section).focus() : home(); }
  // Enter belongs to whatever has focus: a button, a link, a disclosure, the form's own fields.
  // Shift+Enter is the page's, from the form or from nowhere, a text field included.
  if (key === "Enter") {
    if (!form) return;
    if (event.shiftKey && (target === document.body || form.contains(target))) { event.preventDefault(); form.requestSubmit($("[value=merge]", form)); }
    else if (target === document.body) form.requestSubmit($("[value=save]", form));
    return;
  }
  if (target.matches("input[type=text]")) return;
  // Sections: j and k step through them from anywhere. The arrows do the same once focus is on
  // one; on the question they belong to the radio group.
  const letter = letters.checked && target !== letters && key.length === 1 ? key : "", onStop = header || inside;
  if (letter === "j" || key === "ArrowDown" && onStop) { event.preventDefault(); return step(1, target); }
  if (letter === "k" || key === "ArrowUp" && onStop) { event.preventDefault(); return step(-1, target); }
  if ((key === "ArrowRight" || letter === "l") && header) {
    event.preventDefault();
    if (!section.open) section.open = true; else if (section.contains(stops()[stops().indexOf(header) + 1])) step(1, target);
    return;
  }
  if ((key === "ArrowLeft" || letter === "h") && onStop) { event.preventDefault(); return header ? void (section.open = false) : $("summary", section).focus(); }
  if (!form || !letter) return;
  const boxes = [...form.querySelectorAll("[name=reason]")];
  if (letter === "y") choose(form, "yes");
  else if (letter === "n") choose(form, "no");
  else if (letter === "s") skip();
  else if (letter === "o") { event.preventDefault(); if (!form.elements.glad.value) choose(form, "yes"); (form.elements.glad.value === "yes" ? form.elements.other : form.elements.note).focus(); }
  else if (letter === "a" && boxes.length) { choose(form, "yes"); const on = !boxes.every(box => box.checked); boxes.forEach(box => box.checked = on); sync(form, null); }
  else if (/^[1-9]$/.test(letter) && boxes[letter - 1]) { choose(form, "yes"); boxes[letter - 1].checked = !boxes[letter - 1].checked; sync(form, null); }
});
$("#reload").addEventListener("click", load);
load();
</script>
</body>
</html>
"""


def page(token: str, mode: str) -> bytes:
    return PAGE.replace("__TOKEN__", json.dumps(token)).replace("__MODE__", json.dumps(mode)).encode()


def handler(queue: Queue, token: str, mode: str, hosts: set[str]) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args: object) -> None:
            return None

        def send(self, status: int, body: bytes, kind: str = "application/json") -> None:
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; "
                             "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers()
            self.wfile.write(body)

        def reply(self, status: int, data: dict) -> None:
            self.send(status, json.dumps(data).encode())

        def local(self) -> bool:
            """This server's own name in Host, so another site cannot reach it by rebinding DNS."""
            return self.headers.get("Host", "") in hosts

        def allowed(self) -> bool:
            return self.local() and secrets.compare_digest(self.headers.get("X-Queue-Token", "").encode(), token.encode())

        def do_GET(self) -> None:
            if not self.local():
                return self.reply(403, {"error": "wrong host"})
            url = urllib.parse.urlsplit(self.path)
            if url.path == "/":
                # The page carries the token every action needs, so it is served only to the link
                # the server printed: another process on this machine cannot fetch it and act.
                given = urllib.parse.parse_qs(url.query).get("t", [""])[0]
                if not secrets.compare_digest(given.encode(), token.encode()):
                    return self.send(403, b"Open the link this server printed when it started.\n", "text/plain; charset=utf-8")
                return self.send(200, page(token, mode), "text/html; charset=utf-8")
            if self.path == "/api/queue" and self.allowed():
                try:
                    return self.reply(200, {"items": [asdict(item) for item in queue.refresh()]})
                except ForgeError as error:
                    return self.reply(502, {"error": str(error)})
            self.reply(403 if self.path.startswith("/api/") else 404, {"error": "not allowed" if self.path.startswith("/api/") else "not found"})

        def do_POST(self) -> None:
            if self.path not in ("/api/decide", "/api/clear", "/api/rerun") or not self.allowed():
                return self.reply(403, {"error": "not allowed"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                data = json.loads(self.rfile.read(length)) if 0 < length <= 20_000 else None
                if self.path != "/api/decide":
                    run = queue.clear if self.path == "/api/clear" else queue.rerun
                    return self.reply(200, run(str(data["key"]), str(data["head"])))
                decision = Decision(str(data["key"]), str(data["head"]), data["glad"] is True,
                                    tuple(str(reason) for reason in data.get("reasons", []))[:20],
                                    clean(data.get("other")), data.get("merge") is True,
                                    min(86_400.0, max(0.0, float(data["seconds"]))) if isinstance(data.get("seconds"), (int, float)) else None)
            except (TypeError, KeyError, ValueError):
                return self.reply(400, {"error": "not a decision"})
            self.reply(200, queue.decide(decision))

    return Handler


# ---------------------------------------------------------------- putting it together

def load_adapter(path: Path) -> object:
    spec = importlib.util.spec_from_file_location("consequential_adapter", path)
    if not (spec and spec.loader):
        raise SystemExit(f"cannot load the adapter {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["consequential_adapter"] = module
    spec.loader.exec_module(module)
    return module


def build(config: Config, forge: Forge, store: Store, adapter: object | None = None) -> Queue:
    policy: Policy = ReplyLabelMerge()
    dialects: list[Dialect] = [CheckDialect()]
    if adapter:
        if make := getattr(adapter, "forge", None):
            forge = make(config, forge)
        if make := getattr(adapter, "store", None):
            store = make(config, store)
        if make := getattr(adapter, "policy", None):
            policy = make(config, policy)
        if make := getattr(adapter, "dialects", None):
            dialects = [*make(config), *dialects]
    return Queue(config, DryRun(forge) if config.dry_run else forge, store, policy, dialects)


def serve(queue: Queue, port: int, mode: str) -> tuple[ThreadingHTTPServer, str]:
    token = secrets.token_urlsafe(32)
    server = ThreadingHTTPServer(("127.0.0.1", port), lambda *a: None)  # the handler needs the bound port
    bound = server.server_address[1]
    server.RequestHandlerClass = handler(queue, token, mode, {f"127.0.0.1:{bound}", f"localhost:{bound}"})
    return server, token


def current_repo() -> tuple[str, ...]:
    """OWNER/REPO of the checkout this was started in, from its origin."""
    try:
        url = subprocess.run(["git", "remote", "get-url", "origin"], capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return ()
    found = re.search(r"github\.com[:/]+([^/\s]+/[^/\s]+?)(?:\.git)?/?$", url)
    return (found.group(1),) if found else ()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", action="append", default=[], help="OWNER/REPO; repeat for several (default: this checkout's origin)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--open", action="store_true", help="open the page in a browser")
    parser.add_argument("--demo", action="store_true", help="made-up pull requests, no network, nothing kept")
    parser.add_argument("--dry-run", action="store_true", help="read the real queue; change nothing on GitHub")
    parser.add_argument("--state", type=Path, help="where answers are kept (default: the XDG state directory)")
    parser.add_argument("--on-record", metavar="CMD", help="also pipe each record, as JSON, to this command")
    parser.add_argument("--adapter", type=Path, help="a Python file that swaps the forge, store, policy or dialects")
    parser.add_argument("--label", default=Config.label)
    parser.add_argument("--check", default=Config.check, help="the check's name: a merge goes ahead while it fails, and it is what a cleared label re-runs")
    parser.add_argument("--confirmed-label", default=Config.confirmed_label)
    parser.add_argument("--overruled-label", default=Config.overruled_label)
    parser.add_argument("--merge-method", default=Config.merge_method, choices=["squash", "merge", "rebase"])
    parser.add_argument("--merge-despite", action="append", default=[], metavar="CHECK",
                        help="another check a merge may go ahead without; every other check must have passed")
    parser.add_argument("--bot", action="append", default=[], help="an account whose verdict comments count (default: github-actions[bot])")
    parser.add_argument("--summary", action="store_true", help="print how the answers so far fall, and exit")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    store: Store = JsonlStore(args.state or default_state())
    if args.summary:
        print(summary(store.records()), end="")
        return 0
    repos = ("example/app",) if args.demo else tuple(args.repo) or current_repo()
    if not repos:
        parser.error("no repository: pass --repo OWNER/REPO")
    config = Config(repos, args.label, args.check, args.confirmed_label, args.overruled_label, args.merge_method,
                    tuple(args.bot) or Config.bots, args.dry_run)
    if args.demo:
        store = JsonlStore(Path(tempfile.mkdtemp(prefix="consequential-demo-")) / "decisions.jsonl")
    elif args.on_record:
        store = HookedStore(store, args.on_record)
    queue = build(config, Demo() if args.demo else GitHub(despite=(args.check, *args.merge_despite)), store, load_adapter(args.adapter) if args.adapter else None)
    mode = "demo: nothing is real" if args.demo else "dry run: nothing changes on GitHub" if args.dry_run else ""
    server, token = serve(queue, args.port, mode)
    link = f"http://127.0.0.1:{server.server_address[1]}/?t={token}"
    print(f"Consequential queue for {', '.join(repos)}: {link}" + (f"  ({mode})" if mode else ""), flush=True)
    if args.open:
        import webbrowser

        webbrowser.open(link)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
    return 0


# ---------------------------------------------------------------- self-test

def self_test() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        store = JsonlStore(Path(tmp) / "state" / "decisions.jsonl")
        forge = Demo()
        config = Config(("example/app",))
        queue = build(config, forge, store)
        items = {item.number: item for item in queue.refresh()}
        assert {n: item.state for n, item in items.items()} == {101: "waiting", 102: "waiting", 103: "waiting", 104: "waiting", 105: "stale"}
        first = items[101].verdict
        assert first and [reason.id for reason in first.reasons] == ["hard_to_undo", "exposes_private_data"]
        assert first.reasons[0].p == 0.91 and first.reasons[0].line == 0.5 and first.comment_id == 1010
        # A question too close to call is a reason too, and says so.
        assert items[103].verdict.reasons == (Reason("costs_money", "too close to its line to call. the retry loop calls the billed API", 0.46, 0.5),)  # type: ignore[union-attr]

        # The comment without its data line still reads, from the bullets, without the model's name.
        def bare(body: str) -> str:
            return "\n".join(line for line in body.splitlines() if DATA_MARKER not in line)

        read = CheckDialect().read(bare(demo_comment("f" * 40, {"costs_money": (0.7, 0.5, "a paid API _(Haiku)_")})))
        assert read and read.reasons == (Reason("costs_money", "a paid API", 0.7, 0.5),) and read.head == "f" * 12 and read.consequential
        read = CheckDialect().read(bare(demo_comment("f" * 40, {}, consequential=False)))
        assert read and read.reasons == () and not read.consequential
        assert CheckDialect().read("**Consequential: yes**") is None

        # Glad, one of two reasons, another reason added: the reply the tuning step reads, the
        # confirmed label beside `consequential`, and the card moves to "answered, still open".
        out = queue.decide(Decision("example/app#101", items[101].head, True, ("hard_to_undo",), "also drops the audit index"))
        assert out["ok"] and [step["step"] for step in out["steps"]] == ["reply", "label"], out
        pull = forge.find("example/app", 101)
        reply = pull["comments"][-1]["body"]
        assert reply.splitlines()[0] == "consequential: right because hard_to_undo; other: also drops the audit index"
        answer = unhidden(DECISION_MARKER, reply)
        assert answer and answer["shown"] == ["hard_to_undo", "exposes_private_data"] and answer["reasons"] == ["hard_to_undo"]
        assert answer["verdict_comment"] == 1010 and pull["labels"] == ["consequential", "consequential:confirmed"]
        items = {item.number: item for item in queue.refresh()}
        assert (items[101].state, items[101].answer) == ("answered", "confirmed")
        # It is not answered twice. Merging it later posts no second reply and leaves the labels.
        assert queue.decide(Decision("example/app#101", items[101].head, False))["steps"][0]["detail"] == "already answered at this head"
        out = queue.decide(Decision("example/app#101", items[101].head, True, merge=True))
        assert out["ok"] and [step["step"] for step in out["steps"]] == ["merge"], out
        assert forge.merged == [("example/app", 101, items[101].head)] and pull["labels"] == ["consequential", "consequential:confirmed"]
        assert len([c for c in pull["comments"] if DECISION_MARKER in c["body"]]) == 1

        # Not glad: the label is replaced and nothing runs the check again. The check is still red
        # on that head, so the pull request stays listed, as the owner's to merge.
        out = queue.decide(Decision("example/app#103", items[103].head, False, other="a log line, no new calls"))
        assert out["ok"] and out["steps"][1]["detail"] == "-consequential, +consequential:overruled" and not forge.reran
        assert forge.find("example/app", 103)["labels"] == ["consequential:overruled"]
        assert forge.find("example/app", 103)["comments"][-1]["body"].startswith("consequential: wrong costs_money a log line, no new calls\n")
        kept = {item.number: item for item in queue.refresh()}[103]
        assert (kept.state, kept.answer) == ("answered", "overruled")
        # A new push that the check does not flag drops it from the list; one it flags again puts
        # it back as waiting, with the earlier answer shown.
        again = forge.find("example/app", 103)
        again["head"] = "9" * 40
        assert 103 not in {item.number for item in queue.refresh()}
        again["labels"] = ["Consequential", "consequential:overruled"]
        assert {item.number: item for item in queue.refresh()}[103].state == "pending"  # flagged, not yet judged at this head
        again["comments"][0]["body"] = demo_comment("9" * 40, {"costs_money": (0.7, 0.5, "the retry loop calls the billed API")})
        back = {item.number: item for item in queue.refresh()}[103]
        assert back.state == "waiting" and back.earlier == ("overruled at c3d4e5f6c",)
        # Confirmed this time: the stale overruled label comes off, whatever the label's case.
        assert queue.decide(Decision("example/app#103", "9" * 40, True, ("costs_money",)))["ok"]
        assert again["labels"] == ["Consequential", "consequential:confirmed"]

        # A refused merge is reported, `consequential` stays on, and the answer is kept.
        out = queue.decide(Decision("example/app#104", items[104].head, True, ("costs_money", "product_decision"), merge=True))
        assert not out["ok"] and out["steps"][-1] == {"step": "merge", "ok": False, "detail": 'GitHub answered 405: Required status check "ci" is failing'}
        assert [step["step"] for step in out["steps"]] == ["reply", "label", "merge"] and not forge.find("example/app", 104).get("merged")
        assert forge.find("example/app", 104)["labels"] == ["consequential", "consequential:confirmed"]
        assert {item.number: item for item in queue.refresh()}[104].state == "answered"

        # A head that raised nothing, failing only for the label an earlier head left: it takes no
        # answer, and clearing it removes the label and runs the check again.
        assert queue.decide(Decision("example/app#105", items[105].head, True))["steps"][0]["detail"].startswith("this head raised nothing")
        assert queue.clear("example/app#102", items[102].head)["steps"][0]["detail"].startswith("not a pull request with only the label left")
        out = queue.clear("example/app#105", items[105].head)
        assert out["ok"] and [step["step"] for step in out["steps"]] == ["label", "rerun"], out
        assert forge.find("example/app", 105)["labels"] == [] and forge.reran == [("example/app", items[105].head, "consequential-check")]
        assert 105 not in {item.number for item in queue.refresh()}

        # A head that moved after the page loaded is refused, and so is a reason that was not shown.
        forge.find("example/app", 102)["head"] = "0" * 40
        out = queue.decide(Decision("example/app#102", items[102].head, True, merge=True))
        assert not out["ok"] and "the head is now 000000000" in out["steps"][0]["detail"] and not forge.find("example/app", 102).get("merged")
        queue.refresh()
        assert not queue.decide(Decision("example/app#102", "0" * 40, True, ("costs_money",)))["ok"]
        assert not queue.decide(Decision("example/app#999", "x", True))["ok"]

        # A decision comment from anyone but the owner, or a verdict from anyone but the bot, is not read.
        forge.find("example/app", 102)["comments"] += [
            {"id": 1, "author": "someone-else", "body": "consequential: wrong\n\n" + hidden(DECISION_MARKER, {"head": "0" * 40, "glad": False})},
            {"id": 2, "author": "someone-else", "body": demo_comment("0" * 40, {"costs_money": (0.9, 0.5, "forged")})}]
        kept = {item.number: item for item in queue.refresh()}[102]
        # The forged verdict names the new head; the bot's own is still the earlier head's, so it waits on the check.
        assert kept.state == "pending" and [reason.id for reason in kept.verdict.reasons] == ["weakens_security"]  # type: ignore[union-attr]

        # Every answer and its outcome is on disk, and the summary counts each reason once per head.
        records = store.records()
        assert [r["kind"] for r in records[:4]] == ["decision", "outcome", "merge", "outcome"] and records[0]["shown"][0]["p"] == 0.91
        assert [r["kind"] for r in records if r["kind"] not in ("decision", "outcome", "merge")] == ["clear"]
        text = summary(records)
        assert "4 answered: 3 glad it was flagged, 1 not." in text, text
        assert re.search(r"^costs_money\s+3\s+2\s+0\s+1$", text, re.M) and re.search(r"^exposes_private_data\s+1\s+0\s+1\s+0$", text, re.M), text
        assert "- also drops the audit index" in text

        # The page merges an answered pull request without reloading. That is the merge alone: no
        # second reply, and no second answer in the record.
        def one(number: int, head: str, comment: str, labels: list[str]) -> dict:
            return {"number": number, "title": "t", "url": "u", "author": "a", "head": head, "additions": 1, "deletions": 0,
                    "changed_files": 1, "draft": False, "labels": labels,
                    "comments": [{"id": number * 10, "author": "github-actions[bot]", "body": comment}]}

        old, new = "1" * 40, "2" * 40
        again_forge = Demo({"example/app": [
            one(1, new, demo_comment(new, {"costs_money": (0.9, 0.5, "a paid API")}), ["consequential"]),
            one(2, new, demo_comment(old, {"costs_money": (0.9, 0.5, "a paid API")}), ["consequential"]),
            one(3, new, demo_comment(new, {}, consequential=False), ["consequential", "consequential:confirmed"]),
            one(4, new, MARKER + "\n**Consequential: yes**\n\n" + hidden(DATA_MARKER, {"consequential": True, "questions": [1]}), ["consequential"]),
            one(5, new, MARKER + "\n**Consequential: yes**\n\n- **costs_money** (p 0.5.1, line 0.50): x", ["consequential"])]})
        again_store = JsonlStore(Path(tmp) / "again.jsonl")
        again = build(config, again_forge, again_store)
        states = {item.number: item for item in again.refresh()}
        assert again.decide(Decision("example/app#1", new, True, ("costs_money",)))["ok"]
        out = again.decide(Decision("example/app#1", new, True, merge=True))
        assert [step["step"] for step in out["steps"]] == ["merge"] and again_forge.merged == [("example/app", 1, new)]
        assert len([c for c in again_forge.find("example/app", 1)["comments"] if DECISION_MARKER in c["body"]]) == 1
        assert [r["kind"] for r in again_store.records()] == ["decision", "outcome", "merge", "outcome"]
        assert again.decide(Decision("example/app#1", new, True, merge=True))["steps"][0]["detail"].startswith("not in the queue")
        # Reasons that judged an earlier head are not answered as if they were this head's.
        assert states[2].state == "pending"
        assert again.decide(Decision("example/app#2", new, True, merge=True))["steps"][0]["detail"].startswith("the check has not judged this head")
        assert not again_forge.find("example/app", 2).get("merged")
        # What it can do is run the check again, in case its run died; it stays pending until the check answers.
        out = again.rerun("example/app#2", new)
        assert out["ok"] and [step["step"] for step in out["steps"]] == ["rerun"] and again_forge.reran[-1] == ("example/app", new, "consequential-check")
        assert again.rerun("example/app#4", new)["steps"][0]["detail"].startswith("not a pull request waiting on the check")
        assert {item.number: item for item in again.refresh()}[2].state == "pending"
        # Clearing a leftover label takes the decision labels of earlier heads with it.
        assert states[3].state == "stale" and again.clear("example/app#3", new)["ok"] and again_forge.find("example/app", 3)["labels"] == []
        # A bot comment with the marker and a body in the wrong shape is not a verdict, and does
        # not take the queue down with it.
        assert (states[4].state, states[4].verdict, states[5].verdict) == ("waiting", None, None)

        # A dry run reads the same queue and changes nothing.
        dry_forge = Demo()
        dry = build(Config(("example/app",), dry_run=True), dry_forge, JsonlStore(Path(tmp) / "dry.jsonl"))
        head = {item.number: item for item in dry.refresh()}[102].head
        out = dry.decide(Decision("example/app#102", head, False, merge=True))
        assert out["ok"] and all(step["detail"].startswith("would ") for step in out["steps"])
        assert dry_forge.find("example/app", 102)["labels"] == ["consequential"] and not dry_forge.merged
        assert summary(dry.store.records()) == "No answers recorded yet.\n"

        # --on-record pipes each record to a command; an adapter swaps a dialect and the policy.
        sink = Path(tmp) / "sink.jsonl"
        hooked = HookedStore(JsonlStore(Path(tmp) / "hooked.jsonl"), f"cat >> {sink}")
        hooked.append({"kind": "decision", "n": 1})
        assert json.loads(sink.read_text()) == {"kind": "decision", "n": 1} and hooked.records() == [{"kind": "decision", "n": 1}]
        adapter = Path(tmp) / "adapter.py"
        adapter.write_text('''
import server
class Gate:
    name = "gate"
    def read(self, body):
        return server.Verdict(self.name, "gate says so", (server.Reason("paths", "touches deploy/"),)) if body.startswith("GATE") else None
    def reply(self, decision, verdict):
        return "/gate " + ("mine" if decision.glad else "not-mine")
class ReplyOnly:
    def steps(self, decision, item, config, reply):
        return [server.Step("reply", lambda forge: forge.comment(item.repo, item.number, reply))]
def dialects(config): return [Gate()]
def policy(config, default): return ReplyOnly()
''')
        sys.modules.setdefault("server", sys.modules[__name__])
        other = Demo({"example/app": [{"number": 7, "title": "t", "url": "u", "author": "a", "head": "7" * 40, "additions": 1,
                                       "deletions": 0, "changed_files": 1, "draft": False, "labels": ["consequential"],
                                       "comments": [{"id": 70, "author": "github-actions[bot]", "body": "GATE"}]}]})
        adapted = build(config, other, JsonlStore(Path(tmp) / "adapted.jsonl"), load_adapter(adapter))
        seven = adapted.refresh()[0]
        assert seven.verdict and seven.verdict.dialect == "gate"
        out = adapted.decide(Decision(seven.key, seven.head, True, ("paths",)))
        assert [step["step"] for step in out["steps"]] == ["reply"] and other.find("example/app", 7)["labels"] == ["consequential"]
        assert other.find("example/app", 7)["comments"][-1]["body"].startswith("/gate mine\n")

        # The page and its API: only this host, only with the page's token.
        fresh = build(config, Demo(), JsonlStore(Path(tmp) / "http.jsonl"))
        server, token = serve(fresh, 0, "demo")
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_address[1]}"

        def get(path: str, body: dict | None = None, **headers: str) -> tuple[int, bytes]:
            request = urllib.request.Request(base + path, data=json.dumps(body).encode() if body else None, headers=headers,
                                             method="POST" if body else "GET")
            try:
                with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=10) as response:
                    return response.status, response.read()
            except urllib.error.HTTPError as error:
                return error.code, error.read()

        try:
            # The page carries the token, so it is served only to the link the server printed,
            # and it cannot be framed by another site.
            assert get("/")[0] == 403 and token.encode() not in get("/")[1] and get("/?t=wrong")[0] == 403
            assert get("/?t=%C3%A9")[0] == 403 and get("/api/queue", **{"X-Queue-Token": "\u00e9"})[0] == 403  # not ASCII: wrong, not a crash
            status, html = get(f"/?t={token}")
            assert status == 200 and token.encode() in html and b"Consequential queue" in html
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(f"{base}/?t={token}", timeout=10) as response:
                assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"] and response.headers["X-Frame-Options"] == "DENY"
            # The page's bones: one h1, a main, a live status, and a form whose question is a
            # fieldset's legend and whose every text input has a label of its own.
            text = html.decode()
            assert text.count("<h1>") == 1 and "<main>" in text and 'role="status"' in text and text.count("<form>") == 1
            assert "<legend>Glad this was flagged?</legend>" in text and 'type="radio" name="glad" value="yes" required' in text
            assert all(f'<label for="{found}"' in text for found in re.findall(r'<input id="([^"]+)"', text)) and "placeholder=" not in text
            assert get("/api/queue")[0] == 403 and get("/api/queue", **{"X-Queue-Token": "nope"})[0] == 403
            assert get(f"/?t={token}", Host="evil.example")[0] == 403
            assert get("/api/queue", Host="evil.example", **{"X-Queue-Token": token})[0] == 403
            status, raw = get("/api/queue", **{"X-Queue-Token": token})
            listed = json.loads(raw)["items"]
            assert status == 200 and len(listed) == 5 and listed[0]["verdict"]["reasons"][0]["id"] == "hard_to_undo"
            assert listed[4]["state"] == "stale" and get("/api/clear", {"key": "example/app#105", "head": listed[4]["head"]})[0] == 403
            status, raw = get("/api/clear", {"key": "example/app#105", "head": listed[4]["head"]}, **{"X-Queue-Token": token})
            assert status == 200 and json.loads(raw)["ok"] and fresh.forge.reran  # type: ignore[attr-defined]
            answer = {"key": "example/app#102", "head": listed[1]["head"], "glad": True, "reasons": ["weakens_security"], "merge": True,
                      "seconds": 4.2}
            assert get("/api/decide", answer)[0] == 403
            status, raw = get("/api/decide", answer, **{"X-Queue-Token": token})
            assert status == 200 and json.loads(raw)["ok"] and fresh.forge.merged == [("example/app", 102, listed[1]["head"])]  # type: ignore[attr-defined]
            assert get("/api/decide", {"key": 1}, **{"X-Queue-Token": token})[0] == 400
            assert [r["seconds"] for r in fresh.store.records() if r["kind"] == "decision"] == [4.2]  # kept with the answer
        finally:
            server.shutdown()

        # The GitHub forge, against a stand-in for the REST API: a refused token gives way to the
        # next, pull requests are told from issues, and a refused merge says what GitHub said.
        sent: list[tuple[str, str, object]] = []
        pull_json = {"number": 5, "title": "Raise the replica count", "html_url": "https://github.example/o/r/pull/5",
                     "user": {"login": "an-agent"}, "head": {"sha": "5" * 40}, "additions": 3, "deletions": 1,
                     "changed_files": 1, "draft": False, "labels": [{"name": "consequential"}]}
        verdict_body = demo_comment("5" * 40, {"costs_money": (0.8, 0.5, "replicas 2 to 6")})
        # `ci` failed and its re-run passed, in one suite. `lint` passes in that suite and fails as
        # a job of the same name in another workflow, which the passing one must not hide.
        checks = [{"name": "ci", "id": 1, "status": "completed", "conclusion": "failure", "check_suite": {"id": 10}},
                  {"name": "ci", "id": 2, "status": "completed", "conclusion": "success", "check_suite": {"id": 10}},
                  {"name": "gate", "id": 3, "status": "completed", "conclusion": "failure", "check_suite": {"id": 10}},
                  {"name": "e2e", "id": 4, "status": "in_progress", "conclusion": None, "check_suite": {"id": 10}},
                  {"name": "lint", "id": 5, "status": "completed", "conclusion": "failure", "check_suite": {"id": 11}},
                  {"name": "lint", "id": 6, "status": "completed", "conclusion": "success", "check_suite": {"id": 10}}]

        class Api(BaseHTTPRequestHandler):
            def log_message(self, *args: object) -> None:
                return None

            def answer(self, status: int, data: object) -> None:
                body = json.dumps(data).encode()
                self.send_response(status)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def handle_any(self) -> None:
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length)) if length else None
                path = self.path.split("?")[0]
                if self.headers.get("Authorization") != "Bearer good":
                    return self.answer(401, {"message": "Bad credentials"})
                sent.append((self.command, self.path, body))
                routes = {
                    ("GET", "/user"): (200, {"login": "owner"}),
                    ("GET", "/repos/o/r/issues"): (200, [{"number": 5, "pull_request": {}}, {"number": 6}]),
                    ("GET", "/repos/o/r/pulls/5"): (200, pull_json),
                    ("GET", "/repos/o/r/issues/5/comments"): (200, [{"id": 50, "user": {"login": "github-actions[bot]"}, "body": verdict_body}]),
                    ("POST", "/repos/o/r/issues/5/comments"): (201, {"html_url": "https://github.example/o/r/pull/5#c"}),
                    ("POST", "/repos/o/r/issues/5/labels"): (200, []),
                    ("DELETE", "/repos/o/r/issues/5/labels/consequential"): (200, []),
                    ("DELETE", "/repos/o/r/issues/5/labels/consequential%3Aconfirmed"): (404, {"message": "Label does not exist"}),
                    ("PUT", "/repos/o/r/pulls/5/merge"): (405, {"message": "Required status check \"ci\" is expected."}),
                    ("GET", f"/repos/o/r/commits/{'5' * 40}/check-runs"): (200, {"check_runs": checks}),
                    ("GET", f"/repos/o/r/commits/{'5' * 40}/status"): (200, {"statuses": [{"context": "preview", "state": "success"}]}),
                    ("POST", "/repos/o/r/actions/jobs/6/rerun"): (201, {}),
                }
                self.answer(*routes.get((self.command, path), (404, {"message": "Not Found"})))

            do_GET = do_POST = do_PUT = do_DELETE = handle_any

        api = ThreadingHTTPServer(("127.0.0.1", 0), Api)
        threading.Thread(target=api.serve_forever, daemon=True).start()
        try:
            github = GitHub(f"http://127.0.0.1:{api.server_address[1]}", tokens=["stale", "good"])
            real = build(Config(("o/r",)), github, JsonlStore(Path(tmp) / "github.jsonl"))
            (five,) = real.refresh()
            assert github._token == "good" and five.key == "o/r#5" and five.author == "an-agent" and five.size == "+3 −1 in 1 file"
            assert five.verdict and five.verdict.reasons[0].id == "costs_money" and five.verdict.comment_id == 50
            assert any("labels=consequential%3Aconfirmed" in path for _, path, _ in sent)
            out = real.decide(Decision("o/r#5", "5" * 40, False, other="within the budget", merge=True))
            assert [(step["step"], step["ok"]) for step in out["steps"]] == [("reply", True), ("label", True), ("merge", False)], out
            assert out["steps"][0]["detail"] == "commented: https://github.example/o/r/pull/5#c"
            # The owner's token could merge past these, so the forge refuses before asking GitHub.
            assert out["steps"][2]["detail"] == "not merged: checks failing: gate, lint; checks still running: e2e"
            assert not any(method == "PUT" for method, _, _ in sent)
            github.despite = ("gate", "e2e", "lint")
            try:
                github.merge("o/r", 5, "5" * 40, "squash")
                raise AssertionError("merged past GitHub's refusal")
            except ForgeError as error:
                assert str(error) == 'GitHub answered 405: Required status check "ci" is expected.'
            writes = [(method, path.split("?")[0], body) for method, path, body in sent if method != "GET"]
            assert writes[0][:2] == ("POST", "/repos/o/r/issues/5/comments") and writes[0][2]["body"].startswith("consequential: wrong costs_money within the budget\n")
            assert writes[1:3] == [("DELETE", "/repos/o/r/issues/5/labels/consequential", None),
                                   ("POST", "/repos/o/r/issues/5/labels", {"labels": ["consequential:overruled"]})]
            assert writes[3] == ("PUT", "/repos/o/r/pulls/5/merge", {"sha": "5" * 40, "merge_method": "squash"})
            assert github.relabel("o/r", 5, ("consequential:confirmed",), ()) == "-consequential:confirmed"  # a 404 on removal is fine
            assert github.rerun("o/r", "5" * 40, "e2e") == "`e2e` is running again on 555555555"
            assert sent[-2][1].endswith("check-runs?per_page=100&check_name=e2e") and sent[-1][:2] == ("POST", "/repos/o/r/actions/jobs/6/rerun")
            try:
                GitHub(github.api, tokens=["stale"]).login()
                raise AssertionError("a refused token signed in")
            except ForgeError as error:
                assert str(error) == "GitHub answered 401: Bad credentials"
        finally:
            api.shutdown()

        # What consequential.py writes is what this reads, when the two sit side by side.
        sibling = Path(__file__).resolve().parent / "consequential.py"
        if sibling.is_file():
            spec = importlib.util.spec_from_file_location("consequential", sibling)
            assert spec and spec.loader
            check = importlib.util.module_from_spec(spec)
            sys.modules["consequential"] = check
            spec.loader.exec_module(check)
            assert (check.MARKER, check.DATA_MARKER) == (MARKER, DATA_MARKER)
            rubric = "\n\n".join(f"## {q.id}\n\nYes:\n- yes\n\nNo:\n- no" for q in check.QUESTIONS)

            def answers(**ps: float) -> dict:
                return {q.id: {"p": ps.get(q.id, 0.02), "why": "a nightly <job> --> billed" if q.id in ps else ""} for q in check.QUESTIONS}

            def judged(jev: dict, opus: dict | None = None) -> str:
                models = check.Models(lambda key, model, state, rubric: check.Reply("jev-1.14.0", {k: {**v, "why": ""} for k, v in jev.items()}),
                                      lambda key, model, system, diff: check.Reply(model, opus if opus and model == check.DEFAULT_STRONG_MODEL else jev))
                result = check.decide(check.Pull(rubric, "+x"), {"TYPESAFE_API_KEY": "k", "ANTHROPIC_API_KEY": "k"}, models)
                return check.render(result, "abcdef0123456789", labelled=True)

            read = CheckDialect().read(judged(answers(costs_money=0.9, hard_to_undo=0.8)))
            assert read and read.consequential and read.head == "abcdef0123456789"
            assert read.reasons == (Reason("hard_to_undo", "a nightly <job> --> billed", 0.8, 0.5),
                                    Reason("costs_money", "a nightly <job> --> billed", 0.9, 0.5))
            # Too close for Jev and for Opus: nobody decided, and the question is still the reason.
            read = CheckDialect().read(judged(answers(costs_money=0.55), answers(costs_money=0.45)))
            assert read and read.consequential and read.reasons == (
                Reason("costs_money", "too close to its line to call. a nightly <job> --> billed", 0.45, 0.5),)
            # Nothing raised on a head that still carries the label: the queue's "only the label is left".
            read = CheckDialect().read(judged(answers()))
            assert read and not read.consequential and read.reasons == ()
            # Nothing judged: one reason that says why, so the card is not blank.
            fork = check.render(check.decide(check.Pull(rubric, "+x"), {}, from_fork=True), "abcdef0123456789")
            assert CheckDialect().read(fork).reasons == (Reason("not_judged", "the pull request comes from a fork: nothing judged"),)  # type: ignore[union-attr]
    print("self-test: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
