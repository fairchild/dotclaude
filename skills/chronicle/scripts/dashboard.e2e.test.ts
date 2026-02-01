/**
 * E2E tests for Chronicle Dashboard - Collapsible Repo Sidebar
 *
 * Run: bunx playwright test skills/chronicle/scripts/dashboard.e2e.test.ts
 */

import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "child_process";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3457; // Use different port to avoid conflicts
const BASE_URL = `http://localhost:${PORT}`;

let server: ChildProcess;

test.beforeAll(async () => {
  server = spawn("bun", ["dashboard.ts"], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "pipe",
  });

  // Wait for server to be ready
  const maxAttempts = 50;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(BASE_URL);
      if (res.ok) break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
});

test.afterAll(async () => {
  server?.kill();
});

test.describe("Collapsible Repo Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage before each test
    await page.goto(BASE_URL);
    await page.evaluate(() => localStorage.removeItem("collapsedRepos"));
    await page.reload();
    await page.waitForLoadState("networkidle");
  });

  test("repo groups have toggle button and count badge", async ({ page }) => {
    // Wait for sidebar to load
    const repoGroup = page.locator(".repo-group").first();
    await expect(repoGroup).toBeVisible({ timeout: 5000 });

    // Toggle button should exist
    const toggle = repoGroup.locator(".repo-toggle");
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText("▶");

    // Count badge should exist but be hidden initially (not collapsed)
    const count = repoGroup.locator(".repo-count");
    await expect(count).toBeAttached();
    await expect(count).toBeHidden(); // CSS display:none when not collapsed
  });

  test("clicking toggle collapses repo and shows count", async ({ page }) => {
    const repoGroup = page.locator(".repo-group").first();
    await expect(repoGroup).toBeVisible({ timeout: 5000 });

    const toggle = repoGroup.locator(".repo-toggle");
    const branches = repoGroup.locator(".repo-branches");
    const count = repoGroup.locator(".repo-count");

    // Initially expanded
    await expect(repoGroup).not.toHaveClass(/collapsed/);
    await expect(branches).toBeVisible();
    await expect(count).toBeHidden();

    // Click to collapse
    await toggle.click();

    // Now collapsed
    await expect(repoGroup).toHaveClass(/collapsed/);
    await expect(branches).toBeHidden();
    await expect(count).toBeVisible();

    // Count should show a number in parentheses
    const countText = await count.textContent();
    expect(countText).toMatch(/\(\d+\)/);
  });

  test("clicking toggle again expands repo", async ({ page }) => {
    const repoGroup = page.locator(".repo-group").first();
    await expect(repoGroup).toBeVisible({ timeout: 5000 });

    const toggle = repoGroup.locator(".repo-toggle");
    const branches = repoGroup.locator(".repo-branches");

    // Collapse
    await toggle.click();
    await expect(repoGroup).toHaveClass(/collapsed/);
    await expect(branches).toBeHidden();

    // Expand
    await toggle.click();
    await expect(repoGroup).not.toHaveClass(/collapsed/);
    await expect(branches).toBeVisible();
  });

  test("collapsed state persists after page refresh", async ({ page }) => {
    const repoGroup = page.locator(".repo-group").first();
    await expect(repoGroup).toBeVisible({ timeout: 5000 });

    // Get repo name for verification
    const repoName = await repoGroup.locator(".repo-name").getAttribute("data-repo");

    // Collapse
    await repoGroup.locator(".repo-toggle").click();
    await expect(repoGroup).toHaveClass(/collapsed/);

    // Verify localStorage was updated
    const stored = await page.evaluate(() => localStorage.getItem("collapsedRepos"));
    expect(stored).toContain(repoName);

    // Refresh page
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Find the same repo group and verify still collapsed
    const repoGroupAfter = page.locator(`.repo-group:has(.repo-name[data-repo="${repoName}"])`);
    await expect(repoGroupAfter).toHaveClass(/collapsed/);
  });

  test("multiple repos can be collapsed independently", async ({ page }) => {
    const repoGroups = page.locator(".repo-group");
    const count = await repoGroups.count();

    if (count < 2) {
      test.skip();
      return;
    }

    const first = repoGroups.nth(0);
    const second = repoGroups.nth(1);

    // Collapse first only
    await first.locator(".repo-toggle").click();
    await expect(first).toHaveClass(/collapsed/);
    await expect(second).not.toHaveClass(/collapsed/);

    // Collapse second too
    await second.locator(".repo-toggle").click();
    await expect(first).toHaveClass(/collapsed/);
    await expect(second).toHaveClass(/collapsed/);

    // Expand first
    await first.locator(".repo-toggle").click();
    await expect(first).not.toHaveClass(/collapsed/);
    await expect(second).toHaveClass(/collapsed/);
  });
});
