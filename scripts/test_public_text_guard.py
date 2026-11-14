#!/usr/bin/env python3
"""Cases for scripts/public-text-guard.py, run against a fake gh so no account is needed.

Usage:
  python3 scripts/test_public_text_guard.py
  GUARD=/path/to/older/public-text-guard.py python3 scripts/test_public_text_guard.py  # red run
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import socket
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional

GUARD = Path(os.environ.get("GUARD") or Path(__file__).resolve().parent / "public-text-guard.py")
DIRTY = "Follows acme/secretproj#12 closely."

FAKE_GH = r"""#!/usr/bin/env bash
[ -n "${FAKE_GH_DOWN:-}" ] && exit 1
[ -n "${FAKE_GH_HANG:-}" ] && { sleep 120; exit 1; }
[ -n "${FAKE_GH_SLOW:-}" ] && sleep "$FAKE_GH_SLOW"
case "$*" in
  "api user "*) echo acme ;;
  "repo list acme --visibility private"*) printf 'secretproj\nhush-svc\nhome\n' ;;
  "api users/acme "*) echo "Somebody Person" ;;
  "repo view acme/secretproj "*) echo PRIVATE ;;
  "repo view acme/unknown "*) exit 1 ;;
  "repo view feat/"*|"repo view claude/"*)
    echo "GraphQL: Could not resolve to a Repository with the name '$3'. (repository)" >&2; exit 1 ;;
  "repo view "*) echo PUBLIC ;;
  "pr view "*) printf '%s\n' "${FAKE_PR_TEXT:-a clean title}" ;;
  *) echo "fake gh: unexpected: $*" >&2; exit 64 ;;
esac
"""


class Harness(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "bin").mkdir()
        gh = self.tmp / "bin" / "gh"
        gh.write_text(FAKE_GH)
        gh.chmod(0o755)
        self.env = {**os.environ, "PATH": f"{self.tmp / 'bin'}:{os.environ['PATH']}",
                    "PUBLIC_TEXT_STATE": str(self.tmp / "state"),
                    "PUBLIC_TEXT_EXTRA": str(self.tmp / "patterns"),
                    "PUBLIC_TEXT_QUESTIONS": str(self.tmp / "questions.json")}
        for var in ("PUBLIC_TEXT_OWNER", "TYPESAFE_API_KEY", "TYPESAFE_BASE_URL", "PUBLIC_TEXT_JUDGE",
                    "PUBLIC_TEXT_JUDGE_TIMEOUT", "PUBLIC_TEXT_JUDGE_MODEL"):
            self.env.pop(var, None)
        self.repo = self.git_repo("pub")

    def git_repo(self, name: str) -> Path:
        repo = self.tmp / name
        repo.mkdir()
        for args in (["init", "-q"], ["remote", "add", "origin", f"git@github.com:acme/{name}.git"],
                     ["config", "user.email", "t@example.com"], ["config", "user.name", "t"],
                     ["commit", "-q", "--allow-empty", "-m", "chore: start"]):
            subprocess.run(["git", "-C", str(repo), *args], check=True)
        return repo

    def run_check(self, text: str, *args: str, **env: str) -> subprocess.CompletedProcess:
        f = self.tmp / "text.md"
        f.write_text(text + "\n")
        return subprocess.run([sys.executable, str(GUARD), "check", *args, str(f)],
                              env={**self.env, **env}, capture_output=True, text=True)

    def check(self, text: str, *args: str, **env: str) -> int:
        return self.run_check(text, *args, **env).returncode

    def hook(self, command: str, cwd: Optional[Path] = None, **env: str) -> dict:
        event = {"tool_name": "Bash", "tool_input": {"command": command}, "cwd": str(cwd or self.repo)}
        out = subprocess.run([sys.executable, str(GUARD), "hook"], input=json.dumps(event),
                             env={**self.env, **env}, capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout) if out.stdout.strip() else {}

    def decision(self, command: str, cwd: Optional[Path] = None, **env: str) -> str:
        out = self.hook(command, cwd, **env)
        return out.get("hookSpecificOutput", {}).get("permissionDecision") or (
            "warn" if "systemMessage" in out else "pass")


class Guard(Harness):
    # --- the checker ------------------------------------------------------------

    def test_refuses_each_kind_of_private_reference(self) -> None:
        for text in ("clone https://github.com/acme/secretproj.git", "git@github.com:acme/secretproj.git",
                     DIRTY, "fixed (hush-svc #7)", "see home#3", "https://github.com/acme/secretproj/pull/3",
                     "Somebody decided", "the box at 192.168.1.20", "on 10.0.0.5", "box.tail1.ts.net",
                     "http://board.localhost/"):
            with self.subTest(text=text):
                self.assertEqual(self.check(text), 1)

    def test_ordinary_words_public_refs_and_public_addresses_pass(self) -> None:
        for text in ("A review pass merged it.", "The home page and the services layer.",
                     "see acme/publicthing#12", "Somebodyelse wrote it", "macOS 10.15.7 and 8.8.8.8",
                     "run it on localhost:3000"):
            with self.subTest(text=text):
                self.assertEqual(self.check(text), 0)

    def test_a_private_target_is_not_checked(self) -> None:
        self.assertEqual(self.check(DIRTY, "--repo", "acme/secretproj"), 0)
        self.assertEqual(self.check(DIRTY, "--repo", "acme/pub"), 1)
        self.assertEqual(self.check(DIRTY, "--repo", "acme/unknown"), 1)

    def test_extra_patterns_count(self) -> None:
        (self.tmp / "patterns").write_text("# local words\nwidgetron\n")
        self.assertEqual(self.check("the widgetron merged it"), 1)

    def test_no_list_is_cannot_run_and_a_stale_list_still_checks(self) -> None:
        self.assertEqual(self.check("clean", FAKE_GH_DOWN="1"), 3)
        self.assertEqual(self.check("clean"), 0)  # fills the cache
        for f in (self.tmp / "state").iterdir():
            os.utime(f, (0, 0))
        self.assertEqual(self.check(DIRTY, FAKE_GH_DOWN="1"), 1)

    # --- the hook ---------------------------------------------------------------

    def test_commit_messages(self) -> None:
        self.assertEqual(self.decision(f'git commit -m "fix: x" -m "{DIRTY}"'), "deny")
        self.assertEqual(self.decision('git commit -m "fix: a clean change"'), "pass")
        self.assertEqual(self.decision(f'git commit -am "{DIRTY}"'), "deny")
        heredoc = f"git commit -m \"$(cat <<'EOF'\nfix: it's a thing\n\n{DIRTY}\nEOF\n)\""
        self.assertEqual(self.decision(heredoc), "deny")
        bare = f"git commit -F - <<'EOF'\nfix: it's bare\n\n{DIRTY}\nEOF"
        self.assertEqual(self.decision(bare), "deny")
        (self.tmp / "msg.txt").write_text(f"fix: x\n\n{DIRTY}\n")
        self.assertEqual(self.decision(f"git commit -F {self.tmp / 'msg.txt'}"), "deny")
        self.assertEqual(self.decision(f'MSG="{DIRTY}"; git commit -m "$MSG"'), "deny")

    def test_cd_and_dash_C_find_the_target(self) -> None:
        private = self.git_repo("secretproj")
        self.assertEqual(self.decision(f'git commit -m "{DIRTY}"', cwd=private), "pass")
        self.assertEqual(self.decision(f'cd {self.repo} && git commit -m "{DIRTY}"', cwd=private), "deny")
        self.assertEqual(self.decision(f'git -C {self.repo} commit -m "{DIRTY}"', cwd=private), "deny")
        local = self.tmp / "local"
        subprocess.run(["git", "init", "-q", str(local)], check=True)
        self.assertEqual(self.decision(f'git commit -m "{DIRTY}"', cwd=local), "pass")

    def test_push_checks_the_commits_it_would_publish(self) -> None:
        self.assertEqual(self.decision("git push -u origin HEAD"), "pass")
        subprocess.run(["git", "-C", str(self.repo), "commit", "-q", "--allow-empty", "-m", DIRTY], check=True)
        self.assertEqual(self.decision("git push -u origin HEAD"), "deny")
        self.assertEqual(self.decision("git push"), "deny")

    def test_gh_writes(self) -> None:
        self.assertEqual(self.decision(f'gh pr create --draft --title "feat: x" --body "{DIRTY}"'), "deny")
        self.assertEqual(self.decision(f'gh pr create -R acme/secretproj --title x --body "{DIRTY}"'), "pass")
        self.assertEqual(self.decision('gh pr create --title "feat: x" --body "clean"'), "pass")
        self.assertEqual(self.decision(f'gh issue comment 4 -R acme/pub --body "{DIRTY}"'), "deny")
        self.assertEqual(self.decision(f'gh pr comment https://github.com/acme/pub/pull/4 -b "{DIRTY}"',
                                       cwd=self.tmp), "deny")
        (self.tmp / "body.md").write_text(DIRTY)
        self.assertEqual(self.decision(f"gh pr edit 4 --body-file {self.tmp / 'body.md'}"), "deny")
        self.assertEqual(self.decision(f'gh release create v1 -n "{DIRTY}"'), "deny")
        self.assertEqual(self.decision("gh pr view 4 --json body"), "pass")

    def test_gh_api_writes(self) -> None:
        post = f"gh api -X POST repos/acme/pub/issues/4/comments -f body='{DIRTY}'"
        self.assertEqual(self.decision(post), "deny")
        self.assertEqual(self.decision(post.replace("acme/pub", "acme/secretproj")), "pass")
        self.assertEqual(self.decision(f"gh api repos/{{owner}}/{{repo}}/issues/4/comments -f body='{DIRTY}'"), "deny")
        self.assertEqual(self.decision("gh api repos/acme/pub/pulls/4"), "pass")
        self.assertEqual(self.decision(f"gh api graphql -f query='mutation {{ x(body: \"{DIRTY}\") }}'"), "ask")

    def test_merge_checks_what_github_would_write(self) -> None:
        self.assertEqual(self.decision("gh pr merge 4 --squash --auto", FAKE_PR_TEXT=f"feat: x\n{DIRTY}"), "deny")
        self.assertEqual(self.decision("gh pr merge 4 --squash --auto"), "pass")
        self.assertEqual(self.decision('gh pr merge 4 --squash --subject "feat: x (#4)" --body "clean"',
                                       FAKE_PR_TEXT=DIRTY), "pass")
        self.assertEqual(self.decision("gh pr merge 4 --rebase", FAKE_PR_TEXT=DIRTY), "pass")

    def test_cannot_run_warns_a_commit_and_asks_before_a_github_write(self) -> None:
        self.assertEqual(self.decision('git commit -m "fix: x"', FAKE_GH_DOWN="1"), "warn")
        self.assertEqual(self.decision('gh pr create --title x --body y', FAKE_GH_DOWN="1"), "ask")
        self.assertEqual(self.decision("ls -la", FAKE_GH_DOWN="1"), "pass")


    # --- codex pass on 3ed4b1f: shapes agents type, and ways it failed quietly ---------------

    def test_a_bad_pattern_fails_loud(self) -> None:
        (self.tmp / "patterns").write_text("[\n")
        self.assertEqual(self.decision('git commit -m "fix: x"'), "warn")
        self.assertEqual(self.decision('gh pr create --title x --body y'), "ask")

    def test_a_crash_warns_and_asks_before_a_github_write(self) -> None:
        state = self.tmp / "state-is-a-file"
        state.write_text("")
        self.assertEqual(self.decision('git commit -m "fix: x"', PUBLIC_TEXT_STATE=str(state)), "warn")
        self.assertEqual(self.decision('gh pr create --title x --body y', PUBLIC_TEXT_STATE=str(state)), "ask")

    def test_a_hanging_gh_stays_inside_the_hook_timeout(self) -> None:
        started = time.monotonic()
        got = self.decision('gh pr comment 4 -b "clean"', FAKE_GH_HANG="1", PUBLIC_TEXT_GH_TIMEOUT="2")
        self.assertEqual(got, "ask")
        self.assertLess(time.monotonic() - started, 10)

    def test_boolean_and_attached_short_options(self) -> None:
        private = self.git_repo("secretproj")
        (self.tmp / "msg.txt").write_text(DIRTY)
        for cmd in (f'gh pr review 4 -r -b "{DIRTY}"', f'gh pr review 4 -a -b "{DIRTY}"',
                    f'gh release create v1 -p -n "{DIRTY}"', f"git commit -F- <<'EOF'\n{DIRTY}\nEOF",
                    f"git commit -F{self.tmp / 'msg.txt'}", f"gh pr create -t x -b'{DIRTY}'",
                    f"gh api repos/acme/pub/issues/4/comments -fbody='{DIRTY}'"):
            with self.subTest(cmd=cmd):
                self.assertEqual(self.decision(cmd), "deny")
        self.assertEqual(self.decision(f'gh pr create -Racme/pub -t x -b "{DIRTY}"', cwd=private), "deny")
        self.assertEqual(self.decision(f'gh pr create -a someone -t x -b "{DIRTY}"'), "deny")

    def test_comments_posted_by_close_and_repo_descriptions(self) -> None:
        for cmd in (f'gh pr close 4 -c "{DIRTY}"', f'gh issue close 4 --comment "{DIRTY}"',
                    f'gh pr reopen 4 --comment "{DIRTY}"', f'gh repo edit --description "{DIRTY}"',
                    f'gh repo edit acme/pub -d "{DIRTY}"'):
            with self.subTest(cmd=cmd):
                self.assertEqual(self.decision(cmd), "deny")
        self.assertEqual(self.decision(f'gh repo edit acme/secretproj -d "{DIRTY}"'), "pass")

    def test_the_unparsed_fallback_honours_the_named_repo(self) -> None:
        private = self.git_repo("secretproj")
        cmd = f"gh issue create -R acme/pub -t x -F - <<EOF\nit's {DIRTY}\nEOF"
        self.assertEqual(self.decision(cmd, cwd=private), "deny")
        self.assertEqual(self.decision(cmd.replace("acme/pub", "acme/secretproj")), "pass")

    def test_the_whole_command_is_the_text(self) -> None:
        # The accepted cost: a private reference anywhere in the command denies a public write,
        # and the reason says to split the command.
        out = self.hook('gh pr view 1 -R acme/secretproj && N=ok; gh pr comment 4 -b "$N"')
        self.assertIn("split", out["hookSpecificOutput"]["permissionDecisionReason"])
        self.assertEqual(self.decision(f'N="{DIRTY}" && gh pr comment 4 -b "$N"'), "deny")
        self.assertEqual(self.decision(f'cd {self.repo} && git commit -m "fix: clean"', cwd=self.tmp), "pass")

    def test_pushd_and_a_hash_inside_a_word(self) -> None:
        private = self.git_repo("secretproj")
        self.assertEqual(self.decision(f'pushd {self.repo} && git commit -m "{DIRTY}"', cwd=private), "deny")
        self.assertEqual(self.decision(f'git commit -m wip#1 && gh pr comment 4 -b "{DIRTY}"'), "deny")


    # --- codex round 2 on c38c957 -----------------------------------------------------------

    def test_a_heredoc_assigned_to_a_variable(self) -> None:
        for write in ('gh pr comment 4 -b "$BODY"', 'git commit -m "$BODY"'):
            for subject in ("fix: a thing", "fix: it's a thing"):
                with self.subTest(write=write, subject=subject):
                    cmd = f"BODY=$(cat <<'EOF'\n{subject}\n\n{DIRTY}\nEOF\n)\n{write}"
                    self.assertEqual(self.decision(cmd), "deny")

    def test_bash_comments_neither_retarget_nor_write(self) -> None:
        self.assertEqual(self.decision(f'gh pr comment 4 -R acme/pub -b "{DIRTY}" # -R acme/secretproj'), "deny")
        self.assertEqual(self.decision(f'gh pr comment 4 -b "{DIRTY}" # see https://github.com/acme/secretproj/pull/1'),
                         "deny")
        self.assertEqual(self.decision(f'# gh pr comment 4 -b "{DIRTY}"\nls'), "pass")

    def test_a_slow_gh_shares_one_deadline(self) -> None:
        started = time.monotonic()
        got = self.decision("gh pr merge 4 -s", FAKE_GH_SLOW="1.5", PUBLIC_TEXT_GH_TIMEOUT="3")
        self.assertEqual(got, "ask")
        self.assertLess(time.monotonic() - started, 6)

    def test_a_bad_timeout_setting_still_checks(self) -> None:
        self.assertEqual(self.decision(f'gh pr comment 4 -b "{DIRTY}"', PUBLIC_TEXT_GH_TIMEOUT="x"), "deny")

    def test_the_target_belongs_to_the_write_segment(self) -> None:
        private = self.git_repo("secretproj")
        heredoc = f"-F - <<EOF\nit's {DIRTY}\nEOF"
        self.assertEqual(self.decision(f"gh pr view 1 -R acme/secretproj; gh pr comment 4 {heredoc}"), "deny")
        self.assertEqual(self.decision(f"gh pr comment https://github.com/acme/pub/pull/4 {heredoc}", cwd=private),
                         "deny")
        self.assertEqual(self.decision(f"gh pr comment 4 {heredoc}", cwd=private), "pass")

    def test_repo_edit_and_create_find_their_repo(self) -> None:
        private = self.git_repo("secretproj")
        self.assertEqual(self.decision(f'gh repo edit --add-topic x acme/pub -d "{DIRTY}"', cwd=private), "deny")
        self.assertEqual(self.decision(f'gh repo create acme/newthing --public --description "{DIRTY}"'), "deny")
        self.assertEqual(self.decision(f'gh repo create acme/newthing --private --description "{DIRTY}"'), "pass")

    def test_popd_returns(self) -> None:
        private = self.git_repo("secretproj")
        self.assertEqual(self.decision(f'pushd {private} && popd && git commit -m "{DIRTY}"'), "deny")

    def test_attached_message_after_a_flag_cluster(self) -> None:
        self.assertEqual(self.decision(f'git commit -am"{DIRTY}"'), "deny")


    # --- codex round 3 on bd478fd: a target only from a selector ---------------------------

    URL = "https://github.com/acme/secretproj/pull/1"

    def test_a_url_in_the_text_never_sets_the_target(self) -> None:
        private = self.git_repo("secretproj")
        for cmd in (f'gh pr comment 4 -b "see {self.URL}"', f'gh issue close 4 -c "see {self.URL}"',
                    f'gh pr create -t "after {self.URL}" -b x', f'gh release create v1 -n "see {self.URL}"'):
            with self.subTest(cmd=cmd):
                self.assertEqual(self.decision(cmd), "deny")
        self.assertEqual(self.decision(f'gh repo edit -d "{DIRTY}" -d acme/secretproj acme/pub', cwd=private), "deny")

    def test_a_positional_url_selects_and_a_url_in_text_does_not(self) -> None:
        private = self.git_repo("secretproj")
        cmd = f'gh pr comment -b "see {self.URL}" https://github.com/acme/pub/pull/4'
        self.assertEqual(self.decision(cmd, cwd=private), "deny")
        sibling = f'gh pr comment 12 -b "{DIRTY}; see https://github.com/acme/hush-svc/pull/3"'
        self.assertEqual(self.decision(sibling, cwd=private), "pass")
        self.assertEqual(self.decision(f'gh pr create -t x -b "{DIRTY} https://github.com/cli/cli/pull/3"',
                                       cwd=private), "pass")

    def test_a_heredoc_opener_needs_code_context_and_a_closing_line(self) -> None:
        private = self.git_repo("secretproj")
        write = f'gh pr comment 4 -R acme/pub -b "{DIRTY}"'
        for first in ('git commit -m "doc: explain <<EOF"', "# example: cat <<EOF", "printf '%s' '<<EOF'",
                      "cat <<END-X\nbody\nEND-X"):
            with self.subTest(first=first):
                self.assertEqual(self.decision(f"{first}\n{write}", cwd=private), "deny")

    def test_a_body_file_resolves_against_its_segment(self) -> None:
        (self.repo / "body.md").write_text(DIRTY + "\n")
        self.assertEqual(self.decision("cd pub && gh pr comment 4 -R acme/pub -F body.md", cwd=self.tmp), "deny")
        self.assertEqual(self.decision("git -C pub commit -F body.md", cwd=self.tmp), "deny")

    def test_a_write_inside_a_command_substitution(self) -> None:
        private = self.git_repo("secretproj")
        for cmd in (f"PR=\"$(gh pr create -R acme/pub -t x -b '{DIRTY}')\"",
                    f"PR=`gh pr create -R acme/pub -t x -b '{DIRTY}'`"):
            with self.subTest(cmd=cmd):
                self.assertEqual(self.decision(cmd, cwd=private), "deny")

    def test_an_oversize_body_file_is_not_read_as_empty(self) -> None:
        big = self.tmp / "big.md"
        big.write_text("x" * (1 << 20) + "\n")
        self.assertEqual(self.decision(f"gh pr comment 4 -F {big}"), "ask")
        self.assertEqual(self.decision(f"git commit -F {big}"), "warn")


    # --- codex round 4 on 267903f -----------------------------------------------------------

    def test_repo_value_tables_are_per_command(self) -> None:
        private = self.git_repo("secretproj")
        self.assertEqual(self.decision(f'gh repo edit --template acme/pub -d "mirror of {DIRTY}"', cwd=private),
                         "deny")
        self.assertEqual(self.decision(f'gh repo create -p acme/secretproj acme/newpub --public -d "Fork of {DIRTY}"',
                                       cwd=private), "deny")

    def test_a_branch_name_is_not_a_repo(self) -> None:
        private = self.git_repo("secretproj")
        self.assertEqual(self.decision(f'gh pr comment feat/guard -b "{DIRTY}"', cwd=private), "pass")
        self.assertEqual(self.decision('gh pr edit claude/fix-x --body "Follows hush-svc#3"', cwd=private), "pass")
        self.assertEqual(self.decision(f'gh pr comment feat/guard -b "{DIRTY}"'), "deny")

    def test_cd_double_dash(self) -> None:
        private = self.git_repo("secretproj")
        self.assertEqual(self.decision(f'cd -- {self.repo} && git commit -m "{DIRTY}"', cwd=private), "deny")


    # --- codex round 5 on ae5f991 -----------------------------------------------------------

    SU = "https://github.com/acme/secretproj/issues/3"

    def test_value_flags_this_gh_has(self) -> None:
        private = self.git_repo("secretproj")
        pu, iu = "https://github.com/acme/pub/pull/4", "https://github.com/acme/pub/issues/4"
        for cmd in (f'gh pr comment --attach shot.png {pu} -b "{DIRTY}"',
                    f'gh issue close -r "not planned" {iu} -c "{DIRTY}"',
                    f'gh issue close --duplicate-of 3 {iu} -c "{DIRTY}"',
                    f'gh issue edit --type Bug {iu} --body "{DIRTY}"'):
            with self.subTest(cmd=cmd):
                self.assertEqual(self.decision(cmd, cwd=private), "deny")
        for cmd in (f'gh issue create -t t -b "{DIRTY}" --parent {self.SU}',
                    f'gh issue create -t t -b "{DIRTY}" --blocking {self.SU}',
                    f'gh issue edit 4 --add-sub-issue {self.SU} --body "{DIRTY}"'):
            with self.subTest(cmd=cmd):
                self.assertEqual(self.decision(cmd), "deny")

    def test_an_owner_name_argument_is_a_branch(self) -> None:
        private = self.git_repo("secretproj")
        self.assertEqual(self.decision(f'gh pr comment acme/secretproj -b "{DIRTY}"'), "deny")
        self.assertEqual(self.decision(f'gh pr comment acme/pub -b "{DIRTY}"', cwd=private), "pass")

    def test_a_url_outside_the_selector_slot_asks(self) -> None:
        for cmd in (f'gh pr comment 4 --frobnicate {self.SU} -b "{DIRTY}"',
                    f'gh issue create --frobnicate {self.SU} -t t -b "{DIRTY}"',
                    f'gh pr comment https://github.com/acme/pub/pull/4 --frobnicate {self.SU} -b "{DIRTY}"'):
            with self.subTest(cmd=cmd):
                self.assertEqual(self.decision(cmd), "ask")


# --- the decision-model pass, against a local stand-in for the TypeSafe API -------------------

TELLING = "Their sessions sent 4,000 messages in March."
TELLS = {"work_patterns": "4,000 messages", "private_infrastructure": "the box named quietbox",
         "codenames": "Project Heron"}
KEY = "test-key-0123456789abcdef"


class FakeJev:
    """Answers each Noul 0.93 when the text holds that question's tell, and 0.04 otherwise."""

    def __init__(self) -> None:
        self.requests: list[dict] = []
        self.mode = "ok"
        self.release = threading.Event()
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args: object) -> None:
                pass

            def do_POST(self) -> None:
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                fake.requests.append({"path": self.path, "auth": self.headers.get("Authorization"), "body": body})
                if fake.mode == "hang":
                    fake.release.wait(30)
                text = body["state"]["text"]
                answers = {k: {"type": "noul", "noul": 0.93 if TELLS.get(k, "\0") in text else 0.04}
                           for k in body["questions"]}
                reply = {"model": "jev-test", "answers": {} if fake.mode == "partial" else answers,
                         "usage": {"input_tokens": 10, "output_tokens": 1}}
                payload = b"not json" if fake.mode == "garbage" else json.dumps(reply).encode()
                self.send_response(529 if fake.mode == "overloaded" else 200)
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.release.set()
        self.server.shutdown()
        self.server.server_close()


class Judge(Harness):
    def setUp(self) -> None:
        super().setUp()
        self.jev = FakeJev()
        self.addCleanup(self.jev.close)
        self.keyed = {"TYPESAFE_API_KEY": KEY, "TYPESAFE_BASE_URL": self.jev.url, "NO_PROXY": "127.0.0.1"}
        self.write = f'gh pr create --title "feat: x" --body "{TELLING}"'

    def reason(self, command: str, **env: str) -> str:
        return self.hook(command, **env).get("hookSpecificOutput", {}).get("permissionDecisionReason", "")

    def test_without_a_key_only_the_patterns_run(self) -> None:
        self.assertEqual(self.check(TELLING, TYPESAFE_BASE_URL=self.jev.url), 0)
        self.assertEqual(self.decision(self.write, TYPESAFE_BASE_URL=self.jev.url), "pass")
        self.assertEqual(self.decision(self.write, **{**self.keyed, "TYPESAFE_API_KEY": "_"}), "warn")
        self.assertEqual(self.jev.requests, [])

    def test_check_refuses_what_the_model_reads_as_private(self) -> None:
        got = self.run_check(TELLING, **self.keyed)
        self.assertEqual(got.returncode, 1)
        self.assertIn("work_patterns, p=0.93", got.stdout)
        self.assertEqual(self.check("A review pass merged it.", **self.keyed), 0)
        sent = self.jev.requests[0]
        self.assertEqual((sent["path"], sent["auth"]), ("/v1/systemone", f"Bearer {KEY}"))
        self.assertEqual({q["type"] for q in sent["body"]["questions"].values()}, {"noul"})
        self.assertTrue(sent["body"]["model"])

    def test_the_hook_denies_and_names_the_question(self) -> None:
        self.assertIn("figures or incidents about how a specific person works", self.reason(self.write, **self.keyed))
        self.assertEqual(self.decision(self.write, **self.keyed), "deny")
        self.assertEqual(self.decision('gh pr create --title "feat: x" --body "clean"', **self.keyed), "pass")
        self.assertEqual(self.decision(f'git commit -m "{TELLING}"', **self.keyed), "deny")
        subprocess.run(["git", "-C", str(self.repo), "commit", "-q", "--allow-empty", "-m", TELLING], check=True)
        self.assertEqual(self.decision("git push -u origin HEAD", **self.keyed), "deny")
        (self.tmp / "body.md").write_text(f"The cache lives on the box named quietbox.\n")
        self.assertIn("private_infrastructure", self.reason(f"gh pr edit 4 -F {self.tmp / 'body.md'}", **self.keyed))

    def test_only_text_bound_for_a_known_public_repo_is_sent(self) -> None:
        private = self.git_repo("secretproj")
        local = self.tmp / "local"
        subprocess.run(["git", "init", "-q", str(local)], check=True)
        self.assertEqual(self.decision(self.write, cwd=private, **self.keyed), "pass")
        self.assertEqual(self.decision(self.write + " -R acme/unknown", **self.keyed), "warn")
        self.assertEqual(self.decision(f'git commit -m "{TELLING}"', cwd=local, **self.keyed), "pass")
        self.assertEqual(self.check(TELLING, "--repo", "acme/secretproj", **self.keyed), 0)
        self.assertEqual(self.check(TELLING, "--repo", "acme/unknown", **self.keyed), 0)
        self.assertEqual(self.jev.requests, [])
        self.assertEqual(self.check(TELLING, "--repo", "acme/pub", **self.keyed), 1)

    def test_a_pattern_hit_is_refused_without_asking_the_model(self) -> None:
        self.assertEqual(self.decision(f'gh pr comment 4 -b "{DIRTY} {TELLING}"', **self.keyed), "deny")
        self.assertEqual(self.check(f"{DIRTY} {TELLING}", **self.keyed), 1)
        self.assertEqual(self.jev.requests, [])

    def test_a_failing_model_warns_and_never_blocks(self) -> None:
        for mode in ("overloaded", "garbage", "partial"):
            with self.subTest(mode=mode):
                self.jev.mode = mode
                self.assertEqual(self.decision(self.write, **self.keyed), "warn")
                got = self.run_check(TELLING, **self.keyed)
                self.assertEqual(got.returncode, 0)
                self.assertIn("did not read this text", got.stderr)
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            dead = f"http://127.0.0.1:{s.getsockname()[1]}"
        self.assertEqual(self.decision(self.write, **{**self.keyed, "TYPESAFE_BASE_URL": dead}), "warn")
        self.assertEqual(self.decision(f'gh pr comment 4 -b "{DIRTY}"', **{**self.keyed, "TYPESAFE_BASE_URL": dead}),
                         "deny")

    def test_a_hanging_model_is_abandoned_at_its_deadline(self) -> None:
        self.jev.mode = "hang"
        started = time.monotonic()
        self.assertEqual(self.decision(self.write, PUBLIC_TEXT_JUDGE_TIMEOUT="1", **self.keyed), "warn")
        self.assertLess(time.monotonic() - started, 8)

    def test_warn_reports_and_off_does_not_ask(self) -> None:
        out = self.hook(self.write, PUBLIC_TEXT_JUDGE="warn", **self.keyed)
        self.assertIn("work_patterns", out.get("systemMessage", ""))
        self.assertNotIn("hookSpecificOutput", out)
        got = self.run_check(TELLING, PUBLIC_TEXT_JUDGE="warn", **self.keyed)
        self.assertEqual(got.returncode, 0)
        self.assertIn("work_patterns", got.stderr)
        asked = len(self.jev.requests)
        self.assertEqual(self.decision(self.write, PUBLIC_TEXT_JUDGE="off", **self.keyed), "pass")
        self.assertEqual(len(self.jev.requests), asked)
        self.assertEqual(self.decision(self.write, PUBLIC_TEXT_JUDGE="loud", **self.keyed), "deny")

    def test_secret_shapes_and_the_key_are_not_sent(self) -> None:
        token = "ghp_" + "A1b2" * 6
        self.assertEqual(self.check(f"the token {token} and the key {KEY}", **self.keyed), 0)
        text = self.jev.requests[0]["body"]["state"]["text"]
        self.assertNotIn(token, text)
        self.assertNotIn(KEY, text)
        self.assertEqual(text.count("[redacted:secret]"), 2)

    def test_the_questions_file_moves_drops_and_adds(self) -> None:
        asks = self.tmp / "questions.json"
        asks.write_text(json.dumps({"work_patterns": {"at": 0.95}}))
        self.assertEqual(self.check(TELLING, **self.keyed), 0)
        asks.write_text(json.dumps({"work_patterns": None}))
        self.assertEqual(self.check(TELLING, **self.keyed), 0)
        self.assertNotIn("work_patterns", self.jev.requests[-1]["body"]["questions"])
        asks.write_text(json.dumps({"codenames": {"ask": "Does `text` name an unreleased project?", "at": 0.8}}))
        got = self.run_check("Ships after Project Heron.", **self.keyed)
        self.assertEqual(got.returncode, 1)
        self.assertIn("codenames", got.stdout)
        asks.write_text("[1, 2")
        got = self.run_check(TELLING, **self.keyed)
        self.assertEqual(got.returncode, 0)
        self.assertIn("did not read this text", got.stderr)

    def test_every_answer_is_logged_without_the_text(self) -> None:
        self.check(TELLING, "--repo", "acme/pub", **self.keyed)
        entry = json.loads((self.tmp / "state" / "judge.jsonl").read_text().splitlines()[-1])
        self.assertEqual((entry["repo"], entry["raised"], entry["p"]["work_patterns"]),
                         ("acme/pub", ["work_patterns"], 0.93))
        self.assertNotIn("4,000", json.dumps(entry))

    def test_long_text_is_read_in_part_and_says_so(self) -> None:
        got = self.run_check("x" * 70_000 + " " + TELLING, **self.keyed)
        self.assertEqual(got.returncode, 0)
        self.assertIn("read the first 60000", got.stderr)
        self.assertEqual(len(self.jev.requests[0]["body"]["state"]["text"]), 60_000)


if __name__ == "__main__":
    unittest.main(verbosity=1)
