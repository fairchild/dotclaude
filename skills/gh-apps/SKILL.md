---
name: gh-apps
license: Apache-2.0
description: Create and manage GitHub Apps. Covers the manifest flow, JWTs and installation tokens, webhooks, key rotation, posting as a bot, and apps a CI workflow acts as. Triggers on "github app", "gh app", "installation token", "bot reviewer", "post as a bot", "who posted this", "release app", "create-github-app-token", "ruleset bypass".
---

# GitHub Apps Management

Script: `scripts/gh-apps.py`

## Quick Reference

| Command | Description |
|---------|-------------|
| `create NAME` | Create a GitHub App via manifest flow (opens browser) |
| `list` | List locally-registered apps |
| `info` | Show app info from GitHub API |
| `setup` | Validate stored credentials and test API access |
| `jwt` | Generate and print a JWT (10-min expiry) |
| `token` | Get an installation access token (`--permissions`, `--repo` narrow it) |
| `installations` | List app installations |
| `repos` | List accessible repos for an installation |
| `webhook-config` | Show webhook configuration |
| `webhook-update` | Update webhook URL/secret |
| `deliveries` | List recent webhook deliveries |
| `redeliver ID` | Redeliver a failed webhook |
| `rotate-key` | Guide through private key rotation (web UI) |
| `permissions` | Guide through permission changes (web UI) |
| `delete` | Guide through app deletion (web UI) |

Global flag: `--app SLUG` selects which app (auto-detected if only one exists).

## Credential Storage

```
~/.config/gh-apps/<slug>/
  app-id           # GitHub App ID
  app.pem          # Private key (chmod 600)
  client-id        # OAuth client ID
  client-secret    # OAuth client secret
  webhook-secret   # Auto-generated webhook secret
```

Env var overrides: `GH_APPS_APP_ID`, `GH_APPS_PRIVATE_KEY_PATH`, `GH_APPS_SLUG`.

## Common Workflows

### Create a new GitHub App

```bash
# Interactive browser flow — creates app and saves credentials automatically
scripts/gh-apps.py create my-bot --permissions issues:write,metadata:read --events issues,issue_comment

# Manual mode (no browser / headless)
scripts/gh-apps.py create my-bot --no-browser --permissions issues:write

# Create under an organization
scripts/gh-apps.py create org-bot --org my-org --permissions contents:read
```

Names are lowercase letters, digits and hyphens, at most 34 characters; `create` refuses anything
else, because the local credential folder and GitHub's slug must match.

Four things catch people the first time:

1. The account signed in to the browser becomes the app's owner. Check it before submitting.
2. Creating does not install. `token` fails with "no installations found" until the app is
   installed on a repository. Install it on selected repositories only.
3. A private app still has a public page at `github.com/apps/<slug>`, so its name is visible to
   anyone. A taken app name answers there, but a 404 does not mean the name is free: it must
   also differ from every GitHub user and organization login except your own, so check
   `github.com/<name>` too. Only submitting the form settles it.
4. After a permission change, each installation must accept the new permission before tokens
   carry it.

### Authenticate and use

```bash
# Verify credentials
scripts/gh-apps.py setup

# Generate JWT for API calls
scripts/gh-apps.py jwt

# Get installation token (for repo-scoped operations)
scripts/gh-apps.py token
```

### Post as the app

`token` prints only the token, so it can feed one command inline and never touch a file:

```bash
GH_TOKEN=$(scripts/gh-apps.py --app SLUG token) \
  gh api -X POST repos/OWNER/REPO/pulls/N/reviews -f event=APPROVE -f body='Looks good.'

# Hand an agent a token that can review but not push, for one repository
GH_TOKEN=$(scripts/gh-apps.py --app SLUG token --permissions pull_requests:write --repo REPO) gh ...
```

A narrowed token can never exceed what the installation holds. Whether a bot's approval counts
toward a required review depends on its permissions; read `references/identity-and-approvals.md`
before relying on one.

### Let a workflow act as the app

An app also works as a CI credential. A workflow mints a short-lived token from the app's key with
`actions/create-github-app-token`; pushes, tags and pull requests made with it start other workflows, which the
workflow's own `GITHUB_TOKEN` doesn't, and a ruleset can put the app on its bypass list.

```bash
scripts/gh-apps.py create my-release --permissions contents:write,pull_requests:write   # no --events: no webhook
# install it on the one repository (Only select repositories), then:
gh variable set RELEASE_APP_CLIENT_ID --repo OWNER/REPO --body "$(cat ~/.config/gh-apps/my-release/client-id)"
gh secret set RELEASE_APP_PRIVATE_KEY --repo OWNER/REPO < ~/.config/gh-apps/my-release/app.pem
```

- Install before adding the app to a ruleset's bypass list. Until it is installed on the repository, the rulesets API
  answers 422, "Actor ... integration must be part of the ruleset source or owner organization". The entry is
  `{"actor_id": APP_ID, "actor_type": "Integration", "bypass_mode": "always"}`, and a PUT replaces the whole list, so
  send the existing actors with it.
- After the secret is set, delete the local `app.pem` and the unused `client-secret`. The repository secret is then
  the only copy of the key; a new one comes from the app's settings page. `token` and `jwt` stop working locally.
- With no `--webhook-url` the manifest has no `hook_attributes`, the app has no webhook, and `webhook-config`
  answers 404.

### Manage webhooks

```bash
scripts/gh-apps.py webhook-config
scripts/gh-apps.py deliveries --limit 20
scripts/gh-apps.py redeliver 12345678
```

## What Requires Manual Steps

These operations have no API — the script prints the URL and instructions:

- **Private key rotation**: `rotate-key` — generate new key in web UI, save PEM locally
- **Permission changes**: `permissions` — modify in web UI, installations must re-approve
- **App deletion**: `delete` — confirm in web UI, then remove local credentials

## References

- **Manifest schema + examples**: See `references/manifest-schema.md`
- **API endpoints**: See `references/api-endpoints.md`
- **Permission sets for common use cases**: See `references/permissions-guide.md`
- **What an app's identity proves, and when a bot's approval counts**: See `references/identity-and-approvals.md`
