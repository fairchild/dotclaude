---
name: playwright-ts
description: TypeScript Playwright E2E testing patterns for Cloudflare Workers applications. Use when running E2E tests, capturing screenshots, or debugging frontend behavior in projects using npm/pnpm/bun test scripts.
---

# TypeScript Playwright Testing

E2E testing patterns for Cloudflare Workers apps using TypeScript Playwright.

## Quick Reference

**Detect test command from package.json:**
```bash
# Check scripts in package.json for test patterns
grep -E '"test"|"test:e2e"|"test:playwright"' package.json
```

**Common patterns across projects:**
- `npm test` / `pnpm test` / `bun test` — run default tests
- `npm run test:e2e` — E2E specific tests
- `npm run test:playwright` — Playwright runner directly
- `npm run test:headed` — visible browser for debugging

**Note:** Detect package manager from lockfiles (see CLAUDE.md) and use the appropriate command.

## Cloudflare Workers Dev Server

Most projects require the dev server running before tests:

```bash
# Terminal 1: Start dev server
npm run dev  # or pnpm dev, bun dev (detect from lockfiles)

# Terminal 2: Run tests
npm test  # use detected package manager
```

Some projects have combined scripts:
```bash
# Starts server and runs tests
npm run e2e:server  # server only
npm test            # assumes server running
```

## Test Structure

Tests live in `e2e/`, `tests/`, or `tests/e2e/`:

```typescript
import { test, expect } from '@playwright/test';

test('user can complete flow', async ({ page }) => {
  await page.goto('http://localhost:8787');
  await page.waitForLoadState('networkidle');

  // Interact
  await page.click('text=Get Started');
  await page.fill('[name="email"]', 'test@example.com');

  // Assert
  await expect(page.locator('.success')).toBeVisible();
});
```

## Screenshot Capture

For debugging or documentation:

```typescript
// Single screenshot
await page.screenshot({ path: 'screenshots/step-1.png' });

// Full page
await page.screenshot({ path: 'screenshots/full.png', fullPage: true });

// Element only
await page.locator('.component').screenshot({ path: 'screenshots/component.png' });
```

**Environment-controlled screenshots:**
```typescript
if (process.env.SCREENSHOTS === 'true') {
  await page.screenshot({ path: `screenshots/${testInfo.title}.png` });
}
```

Run with: `SCREENSHOTS=true npm test` (use detected package manager)

## Debugging Patterns

**Headed mode:**
```bash
npm run test:headed
# or
npx playwright test --headed
```

**UI mode (interactive):**
```bash
npx playwright test --ui
```

**Debug specific test:**
```bash
npx playwright test --debug tests/auth.spec.ts
```

**Trace on failure:**
```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    trace: 'on-first-retry',
  },
});
```

## Common Selectors

Prefer semantic selectors:
```typescript
// Good - semantic
page.getByRole('button', { name: 'Submit' })
page.getByLabel('Email')
page.getByText('Welcome')

// Acceptable - test IDs
page.getByTestId('submit-btn')

// Last resort - CSS
page.locator('.submit-button')
```

## Waiting Strategies

```typescript
// Wait for network idle (SPAs)
await page.waitForLoadState('networkidle');

// Wait for specific element
await page.waitForSelector('.loaded');

// Wait for response
await page.waitForResponse(resp => resp.url().includes('/api/'));

// Explicit timeout
await expect(page.locator('.result')).toBeVisible({ timeout: 10000 });
```

## Project-Specific Ports

Check `wrangler.jsonc` or dev script for port:
- Default Wrangler: `8787`
- Some projects: `8788`, `5173`

```typescript
const BASE_URL = process.env.BASE_URL || 'http://localhost:8787';
await page.goto(BASE_URL);
```
