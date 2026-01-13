---
name: cloudflare-workers-deploy
description: Set up Cloudflare Workers deployment for web applications with GitHub Actions CI/CD. Use when adding Workers deployment to an existing project, setting up auto-deploy on push/PR, configuring Durable Objects for stateful apps, or creating a dual-deployment pattern (keep Replit/Vercel while adding Workers). Supports Hono framework, static assets, and nodejs_compat.
license: Apache 2.0
---

# Cloudflare Workers Deployment

Deploy web applications to Cloudflare Workers with GitHub Actions automation.

## Quick Start

1. Create `wrangler.jsonc` at project root
2. Create `workers/` directory with Hono entry point
3. Add GitHub Actions workflows
4. Set secrets via `wrangler secret put`
5. Configure GitHub secrets for CI/CD

## Core Files

### wrangler.jsonc

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "app-name",
  "main": "workers/index.ts",
  "compatibility_date": "2025-01-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./dist/public/",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application"  // SPA routing: serve index.html for unknown paths
  },
  "vars": { "ENVIRONMENT": "development" },
  "env": {
    "preview": {
      "name": "app-name-preview",
      "vars": { "ENVIRONMENT": "preview" }
    },
    "production": {
      "name": "app-name",
      "vars": { "ENVIRONMENT": "production" }
    }
  }
}
```

Do NOT hardcode `account_id` - use `CLOUDFLARE_ACCOUNT_ID` env var in CI.

### workers/index.ts

```typescript
import { Hono } from "hono";
import type { Env } from "./env";

const app = new Hono<{ Bindings: Env }>();

app.get("/healthz", (c) => c.json({ status: "ok", env: c.env.ENVIRONMENT }));

// API routes here
app.get("/api/example", (c) => c.json({ message: "Hello" }));

// Fall through to static assets
app.all("*", async (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
```

### workers/env.d.ts

```typescript
export interface Env {
  ENVIRONMENT: string;
  ASSETS: Fetcher;
  // Add secrets and DO bindings here
}
```

## Package.json

Add scripts:
```json
"dev:workers": "npm run build && wrangler dev",
"deploy:preview": "npm run build && wrangler deploy --env preview",
"deploy:production": "npm run build && wrangler deploy --env production"
```

Add devDependencies:
```json
"@cloudflare/workers-types": "^4.20250620.0",
"wrangler": "^4.42.0"
```

Update tsconfig.json:
```json
{
  "include": ["...", "workers/**/*"],
  "compilerOptions": { "types": ["...", "@cloudflare/workers-types"] }
}
```

## GitHub Actions

See [references/github-actions.md](references/github-actions.md) for workflow templates:
- Auto preview on PRs
- Auto production on push to main

## Durable Objects

For stateful apps (sessions, scheduled tasks, real-time), see [references/durable-objects.md](references/durable-objects.md).

Key pattern: Use DO alarms instead of `setInterval`.

## Setup Checklist

1. `npm install`
2. `npx wrangler login`
3. `npm run deploy:production` (initial deploy)
4. `npx wrangler secret put SECRET_NAME --env production`
5. GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
6. Custom domain: Cloudflare dashboard → Workers → Settings → Domains

## Dual Deployment Pattern

Keep existing backend while adding Workers:

```
project/
├── server/           # Express/existing backend
├── workers/          # Hono/Workers backend
└── shared/           # Common code both import
    ├── schema.ts
    ├── data/
    └── handlers/
```
