#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Fetch PR review context and manage re-review requests.

Usage:
  uv run pr-fetch-context.py <pr-number> [--repo owner/repo]
  uv run pr-fetch-context.py <pr-number> --request-rereview [--repo owner/repo]

Without flags: outputs markdown context for agent consumption.
With --request-rereview: requests re-review from original reviewers.
Requires `gh` CLI authenticated.
"""

import json
import subprocess
import sys


def run_gh(*args: str) -> str:
    result = subprocess.run(
        ["gh", *args],
        capture_output=True, text=True, check=True,
    )
    return result.stdout.strip()


def get_repo_from_git() -> str:
    """Derive owner/repo from git remote origin."""
    url = subprocess.run(
        ["git", "remote", "get-url", "origin"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    if url.startswith("git@"):
        path = url.split(":", 1)[1]
    else:
        path = "/".join(url.split("/")[-2:])
    return path.removesuffix(".git")


def fetch_pr_context(pr_number: int, repo: str | None = None) -> str:
    repo = repo or get_repo_from_git()
    repo_flag = ["--repo", repo]

    pr_json = json.loads(run_gh(
        "pr", "view", str(pr_number), *repo_flag,
        "--json", "number,title,headRefName,baseRefName,url,body,reviewRequests,reviews",
    ))

    comments_json = json.loads(run_gh(
        "api", f"repos/{repo}/pulls/{pr_number}/comments",
    ))

    reviews_json = json.loads(run_gh(
        "api", f"repos/{repo}/pulls/{pr_number}/reviews",
    ))

    lines: list[str] = []
    lines.append(f"# PR #{pr_json['number']}: {pr_json['title']}")
    lines.append("")
    lines.append(f"**Branch:** `{pr_json['headRefName']}` → `{pr_json['baseRefName']}`")
    lines.append(f"**URL:** {pr_json['url']}")
    lines.append("")

    active_reviews = [
        r for r in reviews_json
        if r.get("state") in ("CHANGES_REQUESTED", "COMMENTED")
        and r.get("body")
    ]
    if active_reviews:
        lines.append("## Review Summaries")
        lines.append("")
        for r in active_reviews:
            lines.append(f"**{r['user']['login']}** ({r['state']}):")
            lines.append(f"> {r['body']}")
            lines.append("")

    if comments_json:
        lines.append("## Inline Review Comments")
        lines.append("")
        for i, c in enumerate(comments_json, 1):
            lines.append(f"### Comment {i}: {c['path']}:{c.get('line', '?')}")
            lines.append(f"**Reviewer:** {c['user']['login']}")
            if c.get("diff_hunk"):
                lines.append(f"```diff\n{c['diff_hunk']}\n```")
            lines.append(f"**Comment:** {c['body']}")
            lines.append("")

    reviewers = list({c["user"]["login"] for c in comments_json})
    lines.append("## Your Task")
    lines.append("")
    lines.append("You are responding to PR code review feedback. For each comment above:")
    lines.append("1. Understand the reviewer's concern")
    lines.append("2. Verify whether the concern is valid (read the code, run tests, check imports)")
    lines.append("3. Fix the issue if valid, or gather evidence that it's already handled")
    lines.append("4. After addressing ALL comments:")
    lines.append("   - Commit and push your changes")
    lines.append(f"   - Post a summary comment on the PR with `gh pr comment {pr_number}`")
    lines.append(f"   - Request re-review: `uv run ~/.claude/skills/cmux-orchestrator/scripts/pr-fetch-context.py {pr_number} --request-rereview`")
    lines.append('   - Update cmux sidebar: `cmux set-status "review" "re-review requested" --icon "checkmark.circle" --color "#00FF00"`')
    lines.append("")

    return "\n".join(lines)


def request_rereview(pr_number: int, repo: str | None = None) -> None:
    repo = repo or get_repo_from_git()

    comments_json = json.loads(run_gh(
        "api", f"repos/{repo}/pulls/{pr_number}/comments",
    ))
    reviews_json = json.loads(run_gh(
        "api", f"repos/{repo}/pulls/{pr_number}/reviews",
    ))

    # Collect unique reviewers from comments and reviews (exclude bots)
    reviewer_logins: set[str] = set()
    for c in comments_json:
        login = c["user"]["login"]
        if not login.endswith("[bot]"):
            reviewer_logins.add(login)
    for r in reviews_json:
        if r.get("state") in ("CHANGES_REQUESTED", "COMMENTED"):
            login = r["user"]["login"]
            if not login.endswith("[bot]"):
                reviewer_logins.add(login)

    if not reviewer_logins:
        print("No human reviewers found to request re-review from.", file=sys.stderr)
        sys.exit(1)

    for login in sorted(reviewer_logins):
        print(f"Requesting re-review from {login}...")
        run_gh(
            "api", f"repos/{repo}/pulls/{pr_number}/requested_reviewers",
            "--method", "POST",
            "--field", f"reviewers[]={login}",
        )
        print(f"  done.")

    print(f"\nRe-review requested from: {', '.join(sorted(reviewer_logins))}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: pr-fetch-context.py <pr-number> [--repo owner/repo] [--request-rereview]", file=sys.stderr)
        sys.exit(1)

    pr_num = int(sys.argv[1])
    repo_arg = None
    if "--repo" in sys.argv:
        repo_arg = sys.argv[sys.argv.index("--repo") + 1]

    if "--request-rereview" in sys.argv:
        request_rereview(pr_num, repo_arg)
    else:
        print(fetch_pr_context(pr_num, repo_arg))
