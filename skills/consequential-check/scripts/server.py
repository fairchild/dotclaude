#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""The owner's review queue for pull requests the consequential check routed to them.

One page lists every open pull request labelled `consequential`, with the reasons the check gave.
For each, the owner answers one question, "glad this was flagged?", and when yes, which of the
reasons was why. The answer is acted on at once: a reply the tuning step can collect is posted on
the pull request, the label is changed to say what was decided, and the pull request is merged
when the owner asks for that in the same keystroke. A pull request whose current head raised
nothing, and fails the check only for a label an earlier head left, is cleared with one key: the
label comes off and the check runs again.

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

The page is served on 127.0.0.1 only, and every action needs the random token printed into it.
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
    state: str  # waiting: no answer at this head | answered: answered, still open | stale: only the label is left
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
                    reasons.append(Reason(qid, text, q.get("final"), q.get("raise_at")))
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
        latest: dict[str, dict] = {}
        for run in self.call("GET", f"/repos/{repo}/commits/{head}/check-runs?per_page=100").get("check_runs", []):  # type: ignore[union-attr]
            if run["name"] not in latest or run.get("id", 0) > latest[run["name"]].get("id", 0):
                latest[run["name"]] = run
        statuses = self.call("GET", f"/repos/{repo}/commits/{head}/status").get("statuses", [])  # type: ignore[union-attr]
        states = {name: ("running" if run.get("status") != "completed" else "failed" if run.get("conclusion") in self.FAILED else "ok")
                  for name, run in latest.items()}
        states |= {s["context"]: {"success": "ok", "pending": "running"}.get(s.get("state"), "failed") for s in statuses}
        for state, said in (("failed", "checks failing"), ("running", "checks still running")):
            if names := sorted(name for name, value in states.items() if value == state and name not in self.despite):
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
                if found := dialect.read(comment["body"]):
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
        found.sort(key=lambda item: (("waiting", "stale", "answered").index(item.state), item.repo, item.number))
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
        shown = {reason.id for reason in item.verdict.reasons} if item.verdict else set()
        if unknown := set(decision.reasons) - shown:
            return self.refused(f"not a reason shown: {sorted(unknown)}")
        # An answer already given at this head is not posted or counted twice; only the merge is left.
        answered = item.state == "answered"
        if answered and not decision.merge:
            return self.refused("already answered at this head")
        record = {"kind": "merge" if answered else "decision", "glad": decision.glad, "reasons": list(decision.reasons),
                  "other": decision.other, "merge": decision.merge,
                  "dialect": item.verdict.dialect if item.verdict else "", "verdict_head": item.verdict.head if item.verdict else "",
                  "shown": [asdict(reason) for reason in item.verdict.reasons] if item.verdict else []}
        plan = self.policy.steps(decision, item, self.config, self.reply(decision, item))
        return self.act(item, decision.head, record, [step for step in plan if step.name == "merge" or not answered])

    def clear(self, key: str, head: str) -> dict:
        """Take the label off a pull request whose current head raised nothing, and run the check
        again: the owner's way to clear a raise an earlier head left."""
        with self._lock:
            item = self.items.get(key)
        if item is None or item.state != "stale":
            return self.refused("not a pull request with only the label left: reload")
        repo, number, config = item.repo, item.number, self.config
        return self.act(item, head, {"kind": "clear"}, [
            Step("label", lambda forge: forge.relabel(repo, number, (config.label,), ())),
            Step("rerun", lambda forge: forge.rerun(repo, head, config.check))])


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
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Consequential queue</title>
<style>
:root{--bg:#f6f5f1;--card:#fff;--ink:#1c1b19;--dim:#6b675f;--rule:#dedad0;--accent:#1f5fbf;--yes:#1d7a46;--no:#b3401f;--focus:#1f5fbf}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--card:#201f1c;--ink:#ecebe6;--dim:#a09c92;--rule:#35332e;--accent:#7fb0ff;--yes:#6fcf97;--no:#f08a65;--focus:#7fb0ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:860px;margin:0 auto;padding:20px 16px 80px}
header{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 16px;margin-bottom:6px}h1{font-size:19px;margin:0}
#status{color:var(--dim)}.badge{font-size:12px;border:1px solid var(--no);color:var(--no);border-radius:99px;padding:1px 9px}
.keys{color:var(--dim);font-size:13px;margin:0 0 16px}kbd{font:12px ui-monospace,monospace;border:1px solid var(--rule);border-bottom-width:2px;border-radius:4px;padding:0 5px;background:var(--card)}
.card{background:var(--card);border:1px solid var(--rule);border-radius:10px;padding:14px 16px;margin:0 0 12px;scroll-margin:90px}
.card.on{border-color:var(--focus);box-shadow:0 0 0 2px color-mix(in srgb,var(--focus) 35%,transparent)}
.card.done{opacity:.62}.meta{color:var(--dim);font-size:13px;display:flex;flex-wrap:wrap;gap:2px 12px}
.title{font-weight:600;font-size:16px;margin:2px 0 4px;overflow-wrap:anywhere}.title a{color:inherit;text-decoration:none}.title a:hover{text-decoration:underline}
.why{margin:10px 0 0;padding:0;list-style:none}.why li{padding:5px 0;border-top:1px solid var(--rule);overflow-wrap:anywhere}
.why code,.meta code{font:13px ui-monospace,monospace}.why .score{color:var(--dim);font-size:13px;white-space:nowrap}
.ask{margin-top:12px;display:flex;flex-wrap:wrap;align-items:center;gap:8px}.ask b{margin-right:4px}
button{font:inherit;color:var(--ink);background:var(--card);border:1px solid var(--rule);border-radius:7px;padding:5px 12px;cursor:pointer}
button:hover{border-color:var(--dim)}button.yes.picked{background:var(--yes);border-color:var(--yes);color:#fff}button.no.picked{background:var(--no);border-color:var(--no);color:#fff}
button.go{border-color:var(--accent);color:var(--accent)}button:disabled{opacity:.45;cursor:default}
.more{margin-top:10px;display:none;flex-direction:column;gap:6px}.card.yes .more.yes,.card.no .more.no,.card.answered .more.act,.card.stale .more.act{display:flex}
label.pick{display:flex;gap:8px;align-items:flex-start;cursor:pointer}label.pick input{margin-top:4px}
input[type=text]{font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--rule);border-radius:7px;padding:5px 9px;width:100%}
.acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:6px}.result{margin-top:10px;font-size:14px}.result .bad{color:var(--no)}.result .good{color:var(--yes)}
h2{font-size:14px;color:var(--dim);font-weight:600;margin:22px 0 8px}.empty{color:var(--dim);padding:28px 0;text-align:center}
</style></head><body><main>
<header><h1>Consequential queue</h1><span id="status">Loading…</span><span id="mode"></span>
<button id="reload" style="margin-left:auto">Reload</button></header>
<p class="keys"><kbd>j</kbd>/<kbd>k</kbd> move · <kbd>y</kbd> glad it was flagged · <kbd>n</kbd> not · <kbd>1</kbd>–<kbd>9</kbd> which reason · <kbd>a</kbd> all of them · <kbd>o</kbd> other · <kbd>Enter</kbd> save · <kbd>Shift</kbd>+<kbd>Enter</kbd> save and merge · <kbd>c</kbd> clear a leftover label</p>
<div id="list"></div></main>
<script>
const TOKEN = __TOKEN__, MODE = __MODE__;
const list = document.getElementById("list"), status = document.getElementById("status");
let cards = [], at = 0, decided = 0;
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
async function api(path, body) {
  const r = await fetch(path, {method: body ? "POST" : "GET", headers: {"X-Queue-Token": TOKEN, "Content-Type": "application/json"}, body: body ? JSON.stringify(body) : undefined});
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `the server answered ${r.status}`);
  return data;
}
function card(item) {
  const c = el("section", "card " + item.state); c.item = item; c.glad = null;
  const meta = el("div", "meta"); meta.append(el("span", "", `${item.repo}#${item.number}`), el("span", "", item.size), el("span", "", `by ${item.author}`));
  const head = el("span"); head.append("head ", el("code", "", item.head.slice(0, 9))); meta.append(head);
  if (item.draft) meta.append(el("span", "", "draft"));
  item.earlier.forEach(t => meta.append(el("span", "", "you " + t)));
  const title = el("div", "title"), link = el("a", "", item.title); link.href = item.url; link.target = "_blank"; link.rel = "noopener"; title.append(link);
  c.append(meta, title);
  const v = item.verdict, reasons = v ? v.reasons : [];
  if (v && v.head && !item.head.startsWith(v.head) && !v.head.startsWith(item.head)) c.append(el("div", "meta", `The verdict below judged ${v.head.slice(0, 9)}, an earlier head.`));
  const why = el("ul", "why");
  if (!v) why.append(el("li", "", "No verdict comment found on this pull request."));
  reasons.forEach((r, i) => { const li = el("li"); li.append(`${i + 1}. `, el("code", "", r.id), " " + r.text + " ");
    if (r.p != null) li.append(el("span", "score", `p ${r.p.toFixed(2)}, line ${r.line.toFixed(2)}`)); why.append(li); });
  c.append(why);
  if (item.state !== "waiting") {
    const stale = item.state === "stale", act = el("div", "more act");
    act.append(el("div", "", stale ? "This head raised nothing. The label is from an earlier head or was added by hand, and it alone fails the check."
      : `You ${item.answer} this one at this head. It is still open, and the check stays red on it, so it is yours to merge.`));
    const acts = el("div", "acts"), go = el("button", "go", stale ? "Clear the label and re-run the check" : "Merge");
    go.onclick = () => stale ? clear(c) : save(c, true); acts.append(go); act.append(acts); c.append(act);
    c.glad = item.answer !== "overruled"; c.checks = []; c.other = {value: ""}; c.note = {value: ""};
    c.append(c.result = el("div", "result")); c.onclick = () => focus(cards.indexOf(c)); return c;
  }
  const ask = el("div", "ask"); ask.append(el("b", "", "Glad this was flagged?"));
  c.yes = el("button", "yes", "Yes"); c.no = el("button", "no", "No"); c.yes.onclick = () => pick(c, true); c.no.onclick = () => pick(c, false); ask.append(c.yes, c.no); c.append(ask);
  const yes = el("div", "more yes"); yes.append(el("div", "", "Why?")); c.checks = [];
  reasons.forEach((r, i) => { const l = el("label", "pick"), b = el("input"); b.type = "checkbox"; b.value = r.id; c.checks.push(b); l.append(b, el("span", "", `${i + 1}. ${r.id}`)); yes.append(l); });
  if (reasons.length > 1) { const l = el("label", "pick"); c.all = el("input"); c.all.type = "checkbox"; c.all.onchange = () => c.checks.forEach(b => b.checked = c.all.checked);
    l.append(c.all, el("span", "", reasons.length === 2 ? "Both" : "All of them")); yes.append(l); c.checks.forEach(b => b.onchange = () => c.all.checked = c.checks.every(x => x.checked)); }
  c.other = el("input"); c.other.type = "text"; c.other.maxLength = 500; c.other.placeholder = "Other: a reason the check did not give (optional)"; yes.append(c.other);
  const no = el("div", "more no"); c.note = el("input"); c.note.type = "text"; c.note.maxLength = 500; c.note.placeholder = "What it got wrong (optional)"; no.append(c.note);
  const acts = el("div", "acts"); c.save = el("button", "go", "Save"); c.merge = el("button", "", "Save and merge"); c.save.disabled = c.merge.disabled = true;
  c.save.onclick = () => save(c, false); c.merge.onclick = () => save(c, true); acts.append(c.save, c.merge);
  c.append(yes, no, acts, c.result = el("div", "result")); c.onclick = () => focus(cards.indexOf(c)); return c;
}
function pick(c, glad) { if (c.done || c.item.state !== "waiting") return; c.glad = glad; c.classList.toggle("yes", glad); c.classList.toggle("no", !glad);
  c.yes.classList.toggle("picked", glad); c.no.classList.toggle("picked", !glad); c.save.disabled = c.merge.disabled = false; }
function focus(i) { if (!cards.length) return; at = Math.max(0, Math.min(cards.length - 1, i)); cards.forEach((c, n) => c.classList.toggle("on", n === at)); cards[at].scrollIntoView({block: "nearest"}); }
function next() { const i = cards.findIndex((c, n) => n > at && !c.done); focus(i < 0 ? at : i); }
async function send(c, path, body) {
  if (c.done || c.busy) return; c.busy = true; c.result.textContent = "Saving…";
  let out; try { out = await api(path, body); } catch (e) { out = {ok: false, steps: [{step: "send", ok: false, detail: e.message}]}; }
  c.result.textContent = ""; out.steps.forEach(s => c.result.append(el("div", s.ok ? "good" : "bad", `${s.ok ? "✓" : "✗"} ${s.step}: ${s.detail}`)));
  c.busy = false;
  if (out.ok) { c.done = true; c.classList.add("done"); decided++; count(); document.activeElement.blur(); next(); }
}
function save(c, merge) {
  if (c.glad === null || c.item.state === "stale" || (c.item.state === "answered" && !merge)) return;
  return send(c, "/api/decide", {key: c.item.repo + "#" + c.item.number, head: c.item.head, glad: c.glad, merge,
    reasons: c.glad ? c.checks.filter(b => b.checked).map(b => b.value) : [], other: (c.glad ? c.other.value : c.note.value).trim()});
}
function clear(c) { if (c.item.state === "stale") return send(c, "/api/clear", {key: c.item.repo + "#" + c.item.number, head: c.item.head}); }
function count() { const left = cards.filter(c => !c.done && c.item.state !== "answered").length; status.textContent = `${left} waiting on you` + (decided ? ` · ${decided} done this session` : ""); }
async function load() {
  status.textContent = "Loading…"; let data; try { data = await api("/api/queue"); } catch (e) { status.textContent = "Could not load: " + e.message; return; }
  list.textContent = ""; cards = [];
  if (!data.items.length) list.append(el("div", "empty", "Nothing is waiting on you."));
  for (const [state, heading] of [["waiting", ""], ["stale", "Only the label is left"], ["answered", "Answered, still open"]]) {
    const group = data.items.filter(i => i.state === state);
    if (group.length && heading) list.append(el("h2", "", heading));
    group.forEach(i => { const c = card(i); cards.push(c); list.append(c); });
  }
  at = 0; focus(0); count();
}
document.getElementById("reload").onclick = load;
if (MODE) { const b = el("span", "badge", MODE); document.getElementById("mode").append(b); }
document.addEventListener("keydown", e => {
  const c = cards[at], typing = e.target.tagName === "INPUT" && e.target.type === "text";
  if (e.key === "Escape") { e.target.blur(); return; }
  if (e.key === "Enter" && c) { e.preventDefault(); c.item.state === "stale" ? clear(c) : save(c, e.shiftKey); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey || !c) return;
  if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); focus(at + 1); }
  else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); focus(at - 1); }
  else if (e.key === "c") clear(c);
  else if (e.key === "y") pick(c, true); else if (e.key === "n") pick(c, false);
  else if (c.item.state !== "waiting" || c.done) return;
  else if (/^[1-9]$/.test(e.key) && c.checks[+e.key - 1]) { pick(c, true); const b = c.checks[+e.key - 1]; b.checked = !b.checked; if (c.all) c.all.checked = c.checks.every(x => x.checked); }
  else if (e.key === "a" && c.checks.length) { pick(c, true); const on = !c.checks.every(x => x.checked); c.checks.forEach(b => b.checked = on); if (c.all) c.all.checked = on; }
  else if (e.key === "o") { e.preventDefault(); if (c.glad === null) pick(c, true); (c.glad ? c.other : c.note).focus(); }
});
load();
</script></body></html>
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
            self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'")
            self.end_headers()
            self.wfile.write(body)

        def reply(self, status: int, data: dict) -> None:
            self.send(status, json.dumps(data).encode())

        def local(self) -> bool:
            """This server's own name in Host, so another site cannot reach it by rebinding DNS."""
            return self.headers.get("Host", "") in hosts

        def allowed(self) -> bool:
            return self.local() and secrets.compare_digest(self.headers.get("X-Queue-Token", ""), token)

        def do_GET(self) -> None:
            if not self.local():
                return self.reply(403, {"error": "wrong host"})
            if self.path == "/":
                return self.send(200, page(token, mode), "text/html; charset=utf-8")
            if self.path == "/api/queue" and self.allowed():
                try:
                    return self.reply(200, {"items": [asdict(item) for item in queue.refresh()]})
                except ForgeError as error:
                    return self.reply(502, {"error": str(error)})
            self.reply(403 if self.path.startswith("/api/") else 404, {"error": "not allowed" if self.path.startswith("/api/") else "not found"})

        def do_POST(self) -> None:
            if self.path not in ("/api/decide", "/api/clear") or not self.allowed():
                return self.reply(403, {"error": "not allowed"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                data = json.loads(self.rfile.read(length)) if 0 < length <= 20_000 else None
                if self.path == "/api/clear":
                    return self.reply(200, queue.clear(str(data["key"]), str(data["head"])))
                decision = Decision(str(data["key"]), str(data["head"]), data["glad"] is True,
                                    tuple(str(reason) for reason in data.get("reasons", []))[:20],
                                    clean(data.get("other")), data.get("merge") is True)
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
    server, _ = serve(queue, args.port, mode)
    link = f"http://127.0.0.1:{server.server_address[1]}/"
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
        assert kept.state == "waiting" and [reason.id for reason in kept.verdict.reasons] == ["weakens_security"]  # type: ignore[union-attr]

        # Every answer and its outcome is on disk, and the summary counts each reason once per head.
        records = store.records()
        assert [r["kind"] for r in records[:4]] == ["decision", "outcome", "merge", "outcome"] and records[0]["shown"][0]["p"] == 0.91
        assert [r["kind"] for r in records if r["kind"] not in ("decision", "outcome", "merge")] == ["clear"]
        text = summary(records)
        assert "4 answered: 3 glad it was flagged, 1 not." in text, text
        assert re.search(r"^costs_money\s+3\s+2\s+0\s+1$", text, re.M) and re.search(r"^exposes_private_data\s+1\s+0\s+1\s+0$", text, re.M), text
        assert "- also drops the audit index" in text

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
            status, html = get("/")
            assert status == 200 and token.encode() in html and b"Consequential queue" in html
            assert get("/api/queue")[0] == 403 and get("/api/queue", **{"X-Queue-Token": "nope"})[0] == 403
            assert get("/", Host="evil.example")[0] == 403
            assert get("/api/queue", Host="evil.example", **{"X-Queue-Token": token})[0] == 403
            status, raw = get("/api/queue", **{"X-Queue-Token": token})
            listed = json.loads(raw)["items"]
            assert status == 200 and len(listed) == 5 and listed[0]["verdict"]["reasons"][0]["id"] == "hard_to_undo"
            assert listed[4]["state"] == "stale" and get("/api/clear", {"key": "example/app#105", "head": listed[4]["head"]})[0] == 403
            status, raw = get("/api/clear", {"key": "example/app#105", "head": listed[4]["head"]}, **{"X-Queue-Token": token})
            assert status == 200 and json.loads(raw)["ok"] and fresh.forge.reran  # type: ignore[attr-defined]
            answer = {"key": "example/app#102", "head": listed[1]["head"], "glad": True, "reasons": ["weakens_security"], "merge": True}
            assert get("/api/decide", answer)[0] == 403
            status, raw = get("/api/decide", answer, **{"X-Queue-Token": token})
            assert status == 200 and json.loads(raw)["ok"] and fresh.forge.merged == [("example/app", 102, listed[1]["head"])]  # type: ignore[attr-defined]
            assert get("/api/decide", {"key": 1}, **{"X-Queue-Token": token})[0] == 400
        finally:
            server.shutdown()

        # The GitHub forge, against a stand-in for the REST API: a refused token gives way to the
        # next, pull requests are told from issues, and a refused merge says what GitHub said.
        sent: list[tuple[str, str, object]] = []
        pull_json = {"number": 5, "title": "Raise the replica count", "html_url": "https://github.example/o/r/pull/5",
                     "user": {"login": "an-agent"}, "head": {"sha": "5" * 40}, "additions": 3, "deletions": 1,
                     "changed_files": 1, "draft": False, "labels": [{"name": "consequential"}]}
        verdict_body = demo_comment("5" * 40, {"costs_money": (0.8, 0.5, "replicas 2 to 6")})
        checks = [{"name": "ci", "id": 1, "status": "completed", "conclusion": "failure"},
                  {"name": "ci", "id": 2, "status": "completed", "conclusion": "success"},
                  {"name": "gate", "id": 3, "status": "completed", "conclusion": "failure"},
                  {"name": "e2e", "id": 4, "status": "in_progress", "conclusion": None}]

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
                    ("POST", "/repos/o/r/actions/jobs/4/rerun"): (201, {}),
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
            assert out["steps"][2]["detail"] == "not merged: checks failing: gate; checks still running: e2e"
            assert not any(method == "PUT" for method, _, _ in sent)
            github.despite = ("gate", "e2e")
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
            assert sent[-2][1].endswith("check-runs?per_page=100&check_name=e2e") and sent[-1][:2] == ("POST", "/repos/o/r/actions/jobs/4/rerun")
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
