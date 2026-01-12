/**
 * E2E tests for Claude Config Visualizer
 *
 * Verifies the webui works and captures screenshots for documentation.
 * Run: bunx playwright test
 */

import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3333;
const BASE_URL = `http://localhost:${PORT}`;
const SCREENSHOTS_DIR = join(__dirname, "screenshots");

let server: ChildProcess;

test.beforeAll(async () => {
  // Start the server with bun
  server = spawn("bun", ["serve.ts"], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "inherit",
  });

  // Wait for server to be ready
  const maxAttempts = 30;
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

test.describe("Claude Config Visualizer", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");
  });

  test("page loads with header", async ({ page }) => {
    // ASCII brand should be visible
    const brand = page.locator(".ascii-brand");
    await expect(brand).toBeVisible();

    // Title should be present
    await expect(page.locator(".header-title")).toHaveText("Config Visualizer");
  });

  test("stats show counts", async ({ page }) => {
    // Wait for data to load - counts should not be "--"
    const commandsCount = page.locator("#count-commands");
    await expect(commandsCount).not.toHaveText("--");

    // All stat counts should have loaded
    for (const id of ["commands", "agents", "skills", "marketplaces", "plugins", "mcp"]) {
      const count = page.locator(`#count-${id}`);
      await expect(count).not.toHaveText("--");
    }
  });

  test("tabs navigate between sections", async ({ page }) => {
    const tabs = ["commands", "agents", "skills", "marketplaces", "plugins", "mcp"];

    for (const tab of tabs) {
      await page.click(`.tab[data-section="${tab}"]`);
      await expect(page.locator(`.tab[data-section="${tab}"]`)).toHaveClass(/active/);
      await expect(page.locator(`.stat[data-section="${tab}"]`)).toHaveClass(/active/);
    }
  });

  test("cards expand on click", async ({ page }) => {
    // Find a card and click to expand
    const card = page.locator(".card").first();
    await card.locator(".card-header").click();
    await expect(card).toHaveClass(/expanded/);

    // Click again to collapse
    await card.locator(".card-header").click();
    await expect(card).not.toHaveClass(/expanded/);
  });

  test("capture hero screenshot", async ({ page }) => {
    await page.screenshot({
      path: join(SCREENSHOTS_DIR, "hero.png"),
      fullPage: true,
    });
  });

  test("capture commands section", async ({ page }) => {
    await page.click('.tab[data-section="commands"]');
    await page.waitForTimeout(300); // Wait for animation

    // Expand first card if exists
    const card = page.locator(".card").first();
    if (await card.count()) {
      await card.locator(".card-header").click();
      await page.waitForTimeout(200);
    }

    await page.screenshot({
      path: join(SCREENSHOTS_DIR, "commands.png"),
    });
  });

  test("capture agents section", async ({ page }) => {
    await page.click('.tab[data-section="agents"]');
    await page.waitForTimeout(300);

    const card = page.locator(".card").first();
    if (await card.count()) {
      await card.locator(".card-header").click();
      await page.waitForTimeout(200);
    }

    await page.screenshot({
      path: join(SCREENSHOTS_DIR, "agents.png"),
    });
  });

  test("capture skills section", async ({ page }) => {
    await page.click('.tab[data-section="skills"]');
    await page.waitForTimeout(300);

    await page.screenshot({
      path: join(SCREENSHOTS_DIR, "skills.png"),
    });
  });

  test("capture mcp servers section", async ({ page }) => {
    await page.click('.tab[data-section="mcp"]');
    await page.waitForTimeout(300);

    await page.screenshot({
      path: join(SCREENSHOTS_DIR, "mcp.png"),
    });
  });
});
