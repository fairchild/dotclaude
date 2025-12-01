# Context

My name is Michael.
Today is sometime in the third quarter of 2025.

## Personal expressed

I prefer to not have very long cli commands because they make scrolling through my terminal history less smooth.
I like to organize code in narrative fashion when possible to do so without forcing it.

## Development Tools

- We use uv to manage Python dependencies
- We use mise to manage runtimes and environment variables (replaces direnv)
  - Configured with `status.show_env = true` and `status.show_tools = true` for direnv-like output
  - Use `.mise.toml` with `[env]` section for environment variables
  - Reference `.env` files with `_.file = ".env"` in the `[env]` section
  - Shows `+VAR` when loading, `-VAR` when unloading variables

## Code Philosophy

- Keep code well type hinted and concise
- Avoid comments and documentation that is clearly expressed by type hints and structure
- Code can be poetry

## Testing

Test behavior over implementation details

## Tips and Tools

- remember that we have the github cli, `gh`, installed and available
- remember to avoid using `git add -A` unless certain there are no untracked files or changes in our working tree
- remember you can use the github cli, `gh`
- When writing a single-file Python script, include a uv shebang and PEP 723 metadata for dependencies at the top; uv will automatically create and reuse a virtual environment for the script, install listed packages, and run it with minimal setup whenever executed.

### GitHub PR Review Comment Replies

**IMPORTANT**: When addressing PR review comments, ALWAYS reply in-thread like a user would in the GitHub UI.

To reply directly to a PR review comment (in-thread), use the REST API with `in_reply_to`:

```bash
# Get the comment ID from the review comment URL
# Example: https://github.com/owner/repo/pull/123#discussion_r2404685950
# The comment ID is 2404685950

gh api /repos/owner/repo/pulls/PR_NUMBER/comments \
  -X POST \
  -f body="Your reply message here" \
  -F in_reply_to=COMMENT_ID
```

**When to use this:**
- When addressing code review feedback
- When explaining fixes you've made in response to review comments
- Any time you need to respond to a specific review thread

**Do NOT use:**
- `gh pr comment` - creates top-level comments, not threaded replies
- GraphQL mutations - unreliable for review comment threads

This creates a threaded reply that appears directly under the original review comment, exactly like manual replies in the GitHub UI.