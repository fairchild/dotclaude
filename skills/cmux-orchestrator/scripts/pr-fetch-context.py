#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Fetch review-response context and manage review lifecycle for our PR.

Usage:
  uv run pr-fetch-context.py <pr-number> [--repo owner/repo]
  uv run pr-fetch-context.py <pr-number> --reply-comment <comment-id> <body> [--repo owner/repo]
  uv run pr-fetch-context.py <pr-number> --resolve-thread <comment-id> [--repo owner/repo]
  uv run pr-fetch-context.py <pr-number> --request-rereview [--repo owner/repo]

Without flags: outputs markdown context for agent consumption.
--reply-comment: posts a reply on a specific review comment thread.
--resolve-thread: resolves a review thread by its first comment ID.
--request-rereview: requests re-review from original reviewers.
Requires `gh` CLI authenticated.
"""

import json
import subprocess
import sys
from pathlib import Path


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
            lines.append(f"### Comment {i} (id: {c['id']}): {c['path']}:{c.get('line', '?')}")
            lines.append(f"**Reviewer:** {c['user']['login']}")
            if c.get("diff_hunk"):
                lines.append(f"```diff\n{c['diff_hunk']}\n```")
            lines.append(f"**Comment:** {c['body']}")
            lines.append("")

    script = f"uv run {Path(__file__).resolve()}"
    repo_flag_str = f" --repo {repo}" if repo else ""

    reviewers = list({c["user"]["login"] for c in comments_json})
    lines.append("## Your Task")
    lines.append("")
    lines.append("You are responding to code review comments on our PR. This is not a review of someone else's PR.")
    lines.append("")
    lines.append("First, read all unresolved comments together and reflect on them in the available code, test, product, and discussion context. If more context is needed, gather it before deciding.")
    lines.append("")
    lines.append("For each comment above:")
    lines.append("1. Understand the reviewer's concern")
    lines.append("2. Verify whether the concern is valid (read the code, run tests, check imports)")
    lines.append("3. Decide **Do**, **Defer**, or **Decline**")
    lines.append("   - Do: implement now, verify, and reply with what changed")
    lines.append("   - Defer: acknowledge validity, explain why it should not block this PR, and name the follow-up path")
    lines.append("   - Decline: explain why the requested change is not appropriate, with evidence")
    lines.append("4. Present a brief decision summary before execution")
    lines.append("5. Execute the decisions")
    lines.append("6. **For each comment**, close the loop:")
    lines.append(f"   - If you **fixed it**: resolve the thread:")
    lines.append(f"     `{script} {pr_number} --resolve-thread <comment-id>{repo_flag_str}`")
    lines.append(f"   - If you're **responding without resolving** (disagreeing, needs discussion, etc.):")
    lines.append(f"     `{script} {pr_number} --reply-comment <comment-id> \"your response\"{repo_flag_str}`")
    lines.append("7. After addressing ALL comments:")
    lines.append("   - Commit and push your changes")
    lines.append(f"   - Post a summary comment on the PR with `gh pr comment {pr_number}`")
    lines.append(f"   - Request re-review: `{script} {pr_number} --request-rereview{repo_flag_str}`")
    lines.append('   - Update cmux sidebar: `cmux set-status "review" "re-review requested" --icon "checkmark.circle" --color "#00FF00"`')
    lines.append("")

    return "\n".join(lines)


def reply_comment(pr_number: int, comment_id: int, body: str, repo: str | None = None) -> None:
    repo = repo or get_repo_from_git()
    run_gh(
        "api", f"repos/{repo}/pulls/{pr_number}/comments/{comment_id}/replies",
        "--method", "POST",
        "--field", f"body={body}",
    )
    print(f"Replied to comment {comment_id}")


def resolve_thread(pr_number: int, comment_id: int, repo: str | None = None) -> None:
    repo = repo or get_repo_from_git()
    owner, name = repo.split("/")

    # Find the thread node ID via GraphQL using the comment's database ID
    query = """
    query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              comments(first: 1) {
                nodes { databaseId }
              }
            }
          }
        }
      }
    }
    """
    result = json.loads(run_gh(
        "api", "graphql",
        "-f", f"query={query}",
        "-f", f"owner={owner}",
        "-f", f"name={name}",
        "-F", f"number={pr_number}",
    ))

    threads = result["data"]["repository"]["pullRequest"]["reviewThreads"]["nodes"]
    thread_id = None
    for t in threads:
        first_comments = t["comments"]["nodes"]
        if first_comments and first_comments[0]["databaseId"] == comment_id:
            thread_id = t["id"]
            break

    if not thread_id:
        # Comment might not be the first in its thread — scan all comments
        for t in threads:
            all_comments = json.loads(run_gh(
                "api", "graphql",
                "-f", f"query=query {{ node(id: \"{t['id']}\") {{ ... on PullRequestReviewThread {{ comments(first: 100) {{ nodes {{ databaseId }} }} }} }} }}",
            ))
            nodes = all_comments["data"]["node"]["comments"]["nodes"]
            if any(n["databaseId"] == comment_id for n in nodes):
                thread_id = t["id"]
                break

    if not thread_id:
        print(f"Could not find thread for comment {comment_id}", file=sys.stderr)
        sys.exit(1)

    if any(t["id"] == thread_id and t["isResolved"] for t in threads):
        print(f"Thread for comment {comment_id} is already resolved")
        return

    run_gh(
        "api", "graphql",
        "-f", f"query=mutation {{ resolveReviewThread(input: {{threadId: \"{thread_id}\"}}) {{ thread {{ isResolved }} }} }}",
    )
    print(f"Resolved thread for comment {comment_id}")


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
        print(__doc__, file=sys.stderr)
        sys.exit(1)

    pr_num = int(sys.argv[1])
    repo_arg = None
    if "--repo" in sys.argv:
        idx = sys.argv.index("--repo")
        repo_arg = sys.argv[idx + 1]

    if "--reply-comment" in sys.argv:
        idx = sys.argv.index("--reply-comment")
        cid = int(sys.argv[idx + 1])
        body = sys.argv[idx + 2]
        reply_comment(pr_num, cid, body, repo_arg)
    elif "--resolve-thread" in sys.argv:
        idx = sys.argv.index("--resolve-thread")
        cid = int(sys.argv[idx + 1])
        resolve_thread(pr_num, cid, repo_arg)
    elif "--request-rereview" in sys.argv:
        request_rereview(pr_num, repo_arg)
    else:
        print(fetch_pr_context(pr_num, repo_arg))
