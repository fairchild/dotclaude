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
import tempfile
import time
import unittest
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
  "repo view "*) echo PUBLIC ;;
  "pr view "*) printf '%s\n' "${FAKE_PR_TEXT:-a clean title}" ;;
  *) echo "fake gh: unexpected: $*" >&2; exit 64 ;;
esac
"""


class Guard(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        (self.tmp / "bin").mkdir()
        gh = self.tmp / "bin" / "gh"
        gh.write_text(FAKE_GH)
        gh.chmod(0o755)
        self.env = {**os.environ, "PATH": f"{self.tmp / 'bin'}:{os.environ['PATH']}",
                    "PUBLIC_TEXT_STATE": str(self.tmp / "state"),
                    "PUBLIC_TEXT_EXTRA": str(self.tmp / "patterns")}
        self.env.pop("PUBLIC_TEXT_OWNER", None)
        self.repo = self.git_repo("pub")

    def git_repo(self, name: str) -> Path:
        repo = self.tmp / name
        repo.mkdir()
        for args in (["init", "-q"], ["remote", "add", "origin", f"git@github.com:acme/{name}.git"],
                     ["config", "user.email", "t@example.com"], ["config", "user.name", "t"],
                     ["commit", "-q", "--allow-empty", "-m", "chore: start"]):
            subprocess.run(["git", "-C", str(repo), *args], check=True)
        return repo

    def check(self, text: str, *args: str, **env: str) -> int:
        f = self.tmp / "text.md"
        f.write_text(text + "\n")
        return subprocess.run([sys.executable, str(GUARD), "check", *args, str(f)],
                              env={**self.env, **env}, capture_output=True).returncode

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

    # --- the checker ------------------------------------------------------------

    def test_refuses_each_kind_of_private_reference(self) -> None:
        for text in (DIRTY, "fixed (hush-svc #7)", "see home#3", "https://github.com/acme/secretproj/pull/3",
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


if __name__ == "__main__":
    unittest.main(verbosity=1)
