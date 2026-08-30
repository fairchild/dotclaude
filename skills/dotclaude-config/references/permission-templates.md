# Permission Templates

Copy relevant sections into your project's `.claude/settings.json`.

## Pattern Matching Rules

### Bash patterns
- **Glob `*` only** — matches any characters. `**` is NOT supported for Bash.
- **Word boundary**: `Bash(ls *)` (space before `*`) matches `ls -la` and bare `ls`, but NOT `lsof`. `Bash(ls*)` matches both.
- **`:*` is deprecated** — use ` *` (space + asterisk) instead. `Bash(git add *)` not `Bash(git add:*)`.
- **`~` is literal** — matches only if the command string starts with `~`, not the expanded `/Users/...` path.
- **Compound commands blocked** — `Bash(git add *)` won't match `git add file && rm -rf /` (security feature). Also means `git add file && git commit -m "msg"` won't auto-allow even if both are in the allow list.
- **Eval order**: deny > ask > allow. First match wins.

### Read/Write/Edit patterns
- **Gitignore semantics** — `**` works for recursive directory matching.
- **`~` expands** to home directory: `Read(~/.ssh/**)` matches `/Users/you/.ssh/id_rsa`. <!-- portability: allow -->

### Scripts
- Allowlist executable scripts by path: `Bash(~/.claude/skills/my-skill/scripts/run.py *)` <!-- portability: allow -->
- Agent generates commands with `~` paths, so tilde matching works reliably.

## Minimal (Research/Exploration)

For read-only exploration, documentation, learning projects.

```json
{
  "permissions": {
    "allow": [
      "Bash(ls *)",
      "Bash(cat *)",
      "Bash(head *)",
      "Bash(tail *)",
      "Bash(grep *)",
      "Bash(find *)",
      "Bash(tree *)",
      "Bash(git status)",
      "Bash(git log *)",
      "Bash(git diff *)"
    ]
  }
}
```

## Standard (Typical Development)

For most projects. Safe git ops, package management, testing.

```json
{
  "permissions": {
    "allow": [
      "Bash(git add *)",
      "Bash(git commit *)",
      "Bash(git checkout *)",
      "Bash(git branch *)",
      "Bash(git stash *)",
      "Bash(git fetch *)",
      "Bash(git pull *)",
      "Bash(gh pr *)",
      "Bash(gh issue *)"
    ],
    "ask": [
      "Bash(git push *)",
      "Bash(git reset *)",
      "Bash(git rebase *)",
      "Bash(rm -rf *)"
    ]
  }
}
```

## Package Managers

Add based on your project's stack.

### Bun/TypeScript
```json
"Bash(bun *)",
"Bash(bun run *)",
"Bash(bun test *)",
"Bash(bun add *)",
"Bash(bunx *)"
```

### pnpm
```json
"Bash(pnpm *)",
"Bash(pnpm run *)",
"Bash(pnpm test *)",
"Bash(pnpm add *)"
```

### npm
```json
"Bash(npm run *)",
"Bash(npx *)"
```

### Poetry/Python
```json
"Bash(poetry *)",
"Bash(poetry run *)",
"Bash(uv *)",
"Bash(uv run *)"
```

### Cargo/Rust
```json
"Bash(cargo *)",
"Bash(cargo run *)",
"Bash(cargo test *)",
"Bash(cargo build *)"
```

## Deployment

### Cloudflare Workers
```json
"Bash(wrangler *)",
"Bash(wrangler dev *)",
"Bash(wrangler deploy *)"
```

## Testing

```json
"Bash(vitest *)",
"Bash(playwright *)",
"Bash(playwright test *)"
```

## Full Autonomy (Trusted Projects)

For projects where you want maximum automation. Use sparingly.

```json
{
  "permissions": {
    "allow": [
      "Bash(git push *)",
      "Bash(wrangler deploy *)"
    ],
    "deny": [
      "Bash(git push --force *)",
      "Bash(git reset --hard *)"
    ]
  }
}
```

## Security Denies (Always Include)

Prevent accidental exposure of secrets.

```json
{
  "permissions": {
    "deny": [
      "Read(.env)",
      "Read(.env.*)",
      "Read(**/.env)",
      "Read(**/.env.*)",
      "Read(secrets/**)",
      "Read(**/*secret*)",
      "Read(**/*credential*)",
      "Read(**/*.pem)",
      "Read(**/*.key)",
      "Read(~/.ssh/**)",
      "Read(~/.aws/**)",
      "Write(.env*)",
      "Write(secrets/**)",
      "Write(**/*.pem)",
      "Write(**/*.key)"
    ]
  }
}
```
