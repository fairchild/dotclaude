---
name: webapp-testing
description: Toolkit for interacting with and testing local web applications using Playwright. Supports Python and TypeScript, verifying frontend functionality, debugging UI behavior, capturing browser screenshots, and viewing browser logs.
license: Apache-2.0
inspired-by: https://github.com/anthropics/anthropic-agent-skills
---

# Web Application Testing

Test local web applications with Playwright in Python or TypeScript.

## Language Detection

```
Project has pyproject.toml / requirements.txt → Python (below)
Project has package.json / bun.lock / pnpm-lock.yaml → TypeScript (below)
Both → Prefer TypeScript; use Python if existing tests are Python
```

---

## Python Playwright

**Helper Scripts Available**:
- `scripts/with_server.py` - Manages server lifecycle (supports multiple servers)

**Always run scripts with `--help` first** to see usage. DO NOT read the source until you try running the script first and find that a customized solution is absolutely necessary. These scripts can be very large and thus pollute your context window. They exist to be called directly as black-box scripts rather than ingested into your context window.

### Decision Tree

```
User task → Is it static HTML?
    ├─ Yes → Read HTML file directly to identify selectors
    │         ├─ Success → Write Playwright script using selectors
    │         └─ Fails/Incomplete → Treat as dynamic (below)
    │
    └─ No (dynamic webapp) → Is the server already running?
        ├─ No → Run: python scripts/with_server.py --help
        │        Then use the helper + write simplified Playwright script
        │
        └─ Yes → Reconnaissance-then-action:
            1. Navigate and wait for networkidle
            2. Take screenshot or inspect DOM
            3. Identify selectors from rendered state
            4. Execute actions with discovered selectors
```

### Example: Using with_server.py

**Single server:**
```bash
python scripts/with_server.py --server "npm run dev" --port 5173 -- python your_automation.py
```

**Multiple servers (e.g., backend + frontend):**
```bash
python scripts/with_server.py \
  --server "cd backend && python server.py" --port 3000 \
  --server "cd frontend && npm run dev" --port 5173 \
  -- python your_automation.py
```

Automation script (servers managed automatically):
```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('http://localhost:5173')
    page.wait_for_load_state('networkidle')  # CRITICAL: Wait for JS to execute
    # ... your automation logic
    browser.close()
```

### Reference Files

- **examples/** - Examples showing common patterns:
  - `element_discovery.py` - Discovering buttons, links, and inputs on a page
  - `static_html_automation.py` - Using file:// URLs for local HTML
  - `console_logging.py` - Capturing console logs during automation

---

## TypeScript Playwright

For projects using npm/pnpm/bun with `@playwright/test`.

### Running Tests

Detect test command from `package.json`:
```bash
grep -E '"test"|"test:e2e"|"test:playwright"' package.json
```

Common patterns:
- `bun test` / `npm test` / `pnpm test` — default tests
- `bun run test:e2e` — E2E specific
- `bun run test:headed` — visible browser for debugging

### Dev Server

Most projects require the dev server running first:
```bash
# Terminal 1: Start dev server
bun run dev  # detect from lockfiles

# Terminal 2: Run tests
bun test
```

Check `wrangler.jsonc` or dev script for port (default Wrangler: `8787`):
```typescript
const BASE_URL = process.env.BASE_URL || 'http://localhost:8787';
await page.goto(BASE_URL);
```

### Test Structure

Tests live in `e2e/`, `tests/`, or `tests/e2e/`:

```typescript
import { test, expect } from '@playwright/test';

test('user can complete flow', async ({ page }) => {
  await page.goto('http://localhost:8787');
  await page.waitForLoadState('networkidle');
  await page.click('text=Get Started');
  await page.fill('[name="email"]', 'test@example.com');
  await expect(page.locator('.success')).toBeVisible();
});
```

### Screenshot Capture

```typescript
await page.screenshot({ path: 'screenshots/step-1.png' });
await page.screenshot({ path: 'screenshots/full.png', fullPage: true });
await page.locator('.component').screenshot({ path: 'screenshots/component.png' });
```

### Debugging

```bash
npx playwright test --headed     # visible browser
npx playwright test --ui         # interactive UI mode
npx playwright test --debug tests/auth.spec.ts  # debug specific test
```

### Selectors

Prefer semantic selectors:
```typescript
page.getByRole('button', { name: 'Submit' })
page.getByLabel('Email')
page.getByText('Welcome')
page.getByTestId('submit-btn')  // fallback
page.locator('.submit-button')  // last resort
```

### Waiting Strategies

```typescript
await page.waitForLoadState('networkidle');
await page.waitForSelector('.loaded');
await page.waitForResponse(resp => resp.url().includes('/api/'));
await expect(page.locator('.result')).toBeVisible({ timeout: 10000 });
```

---

## Common Patterns (Both Languages)

### Reconnaissance-Then-Action

1. Navigate and wait for `networkidle`
2. Take screenshot or inspect DOM
3. Identify selectors from rendered state
4. Execute actions with discovered selectors

### Common Pitfall

Don't inspect the DOM before waiting for `networkidle` on dynamic apps.

### Best Practices

- Use `--help` on bundled scripts before reading source
- Always close the browser when done
- Use descriptive selectors: `text=`, `role=`, CSS selectors, or IDs
- Add appropriate waits before assertions

---

## Visual Analysis (Subagent)

For dispatched visual analysis of test screenshots and UI/UX quality assessment:

```
Task(
  subagent_type: "general-purpose",
  model: "sonnet",
  prompt: "Read ~/.claude/skills/webapp-testing/SKILL.md. You are a Playwright
    test engineer and UI/UX analyst. Run the E2E tests, capture screenshots at
    key interaction points, then analyze for:
    - Functionality: Does the UI reflect expected state?
    - Usability: Are interactive elements accessible?
    - Visual hierarchy: Is information organized logically?
    - Consistency: Do elements follow design patterns?
    - Accessibility: Contrast ratios, focus states
    Project: {project}
    Tests: {test command or path}
    Return a structured report: test summary, visual findings, UX observations,
    prioritized recommendations, and screenshot inventory."
)
```
