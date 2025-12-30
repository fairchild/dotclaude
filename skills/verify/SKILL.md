---
name: verify
description: Verify deployment health for production or staging. Use when checking if a deployment succeeded, running smoke tests against live environments, or confirming a feature works before continuing development. Works with Cloudflare Workers, GitHub Actions, and generic HTTP endpoints.
---

# Verify Deployment

Confirm deployments are healthy before proceeding with development.

## Quick Checks

### 1. Health Endpoint

```bash
# Check /healthz (common pattern)
curl -sf https://app.example.com/healthz | jq .

# With timeout
curl -sf --max-time 10 https://app.example.com/healthz
```

Expected response:
```json
{"status": "ok", "env": "production"}
```

### 2. GitHub Actions Status

```bash
# Check latest workflow run
gh run list --workflow=deploy.yml --limit=1

# Watch a specific run
gh run watch <run-id>

# Check if deployment succeeded
gh run view --json conclusion -q '.conclusion' <run-id>
```

### 3. Smoke Tests

Check `package.json` for smoke test scripts:

```bash
# Common patterns (use detected package manager from lockfiles - see CLAUDE.md)
npm run test:smoke
npm run test:prod
BASE_URL=https://app.example.com npm test -- --grep=@smoke
```

## Verification Workflow

```
Deploy completes
      ↓
Check /healthz → ❌ → Investigate logs
      ↓ ✅
Run smoke tests → ❌ → Debug failing tests
      ↓ ✅
Verify feature works → ❌ → Check implementation
      ↓ ✅
Continue development
```

## Environment Detection

Detect environment from `wrangler.jsonc`:

```bash
# Get production URL
grep -A5 '"production"' wrangler.jsonc | grep 'name'

# Common patterns:
# - Production: app-name (https://app-name.workers.dev or custom domain)
# - Preview: app-name-preview
# - Staging: app-name-staging
```

## Cloudflare Workers Specifics

### Check Worker Status

```bash
# Via wrangler (requires auth)
npx wrangler deployments list

# Check recent deployment
npx wrangler deployments view
```

### Tail Logs

```bash
# Production logs
npx wrangler tail --env production

# Filter errors
npx wrangler tail --env production --status error
```

## Common Issues

| Symptom | Check |
|---------|-------|
| 502/503 errors | Worker crashed - check `wrangler tail` |
| Old version deployed | GitHub Actions cache - re-run workflow |
| Environment vars missing | `wrangler secret list --env production` |
| Durable Objects errors | Check DO migrations in wrangler.jsonc |

## Integration with Development Loop

Before starting new work:

```bash
# 1. Confirm last deploy succeeded
gh run list --workflow=deploy.yml --limit=1

# 2. Hit health endpoint
curl -sf https://app.example.com/healthz

# 3. Run quick smoke test (use detected package manager)
npm run test:smoke

# All green? → Continue development
```

## Script Template

```bash
#!/bin/bash
set -e

URL="${1:-https://app.example.com}"

echo "Checking $URL..."

# Health check
if curl -f "$URL/healthz" > /dev/null; then
  echo "✅ Health check passed"
else
  echo "❌ Health check failed"
  exit 1
fi

# Smoke tests (if available)
if grep -q '"test:smoke"' package.json 2>/dev/null; then
  echo "Running smoke tests..."
  # Detect package manager from lockfiles (see CLAUDE.md)
  BASE_URL="$URL" npm run test:smoke
fi

echo "✅ Verification complete"
```
