---
name: webapp-testing
description: Interact with and test web applications using Playwright. Supports ad-hoc browser tasks (screenshots, form filling, deploy checks), Python and TypeScript E2E testing, visual debugging, and browser automation.
license: Apache-2.0
inspired-by: https://github.com/anthropics/anthropic-agent-skills
---

# Web Application Testing

Test and interact with web applications using Playwright. Supports ad-hoc browser tasks, Python test scripts, and TypeScript E2E patterns.

## Ad-hoc Browser Interaction

For quick one-off tasks — no test framework or codebase required.

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('https://example.com')
    page.wait_for_load_state('networkidle')

    # Screenshot
    page.screenshot(path='/tmp/screenshot.png', full_page=True)

    # Mobile viewport
    page.set_viewport_size({"width": 390, "height": 844})
    page.screenshot(path='/tmp/mobile.png', full_page=True)

    # Read content
    title = page.title()
    text = page.locator('main').inner_text()

    # Interact
    page.fill('[name="email"]', 'test@example.com')
    page.click('button[type="submit"]')

    browser.close()
```

Common ad-hoc tasks:
- **Screenshot a URL**: `page.screenshot(path='/tmp/shot.png', full_page=True)`
- **Check mobile layout**: Set viewport to 390x844, screenshot
- **Verify a deploy**: Navigate, check title/content, screenshot
- **Fill a form**: `page.fill()` + `page.click()`, screenshot result
- **Read page content**: `page.locator('selector').inner_text()`

Save scripts to `/tmp/` and run with `python /tmp/script.py`. No project setup needed — just `pip install playwright && playwright install chromium`.

---

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

## Writing Testable Frontend Code

When building UI components, follow these patterns so Playwright tests stay stable across refactors.

**Selector priority** (most to least resilient):
1. `getByRole` / `getByLabel` — semantic, survives styling changes
2. `getByTestId` — stable, explicit contract between code and tests
3. `getByText` — readable, but breaks on copy changes
4. CSS class / XPath — fragile, avoid

**Authoring guidelines:**
- Use semantic HTML (`<button>`, `<nav>`, `<input>`) over generic `<div>` with click handlers
- Add `aria-label` to interactive elements that lack visible text
- Add `data-testid` to elements that are hard to select semantically (dynamic lists, generated UIs)
- Keep `data-testid` values stable — they're a contract with tests, not implementation detail
- Use `<label htmlFor="...">` so `getByLabel` works
- Avoid dynamic classes/IDs as selectors — they break on every build

**Example — testable form:**
```html
<form data-testid="login-form">
  <label for="email">Email</label>
  <input id="email" type="email" aria-label="Email" />
  <button type="submit">Sign In</button>
</form>
```

Tests can use: `getByLabel('Email')`, `getByRole('button', { name: 'Sign In' })`, or `getByTestId('login-form')`.

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
