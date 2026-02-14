#!/usr/bin/env bun
/**
 * Preview tool for the webui. Scans, serves, screenshots, and exits.
 *
 * Usage:
 *   bun webui/preview.ts                          # screenshot all sections
 *   bun webui/preview.ts blog                     # screenshot blog section
 *   bun webui/preview.ts blog/2026-02-13-team-memory  # screenshot expanded post
 *   bun webui/preview.ts --no-scan blog            # skip rescan, just screenshot
 *   bun webui/preview.ts --light blog              # light mode screenshot
 *   bun webui/preview.ts --width 800 blog          # custom viewport width
 *   bun webui/preview.ts --full blog               # full page screenshot
 */

import { spawn, execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 7444; // dedicated preview port
const BASE_URL = `http://localhost:${PORT}`;
const OUT_DIR = join(__dirname, "previews");

// Parse args
const args = process.argv.slice(2);
let skipScan = false;
let lightMode = false;
let fullPage = false;
let width = 1280;
let height = 900;
const sections: string[] = [];

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--no-scan": skipScan = true; break;
    case "--light": lightMode = true; break;
    case "--full": fullPage = true; break;
    case "--width": width = parseInt(args[++i]); break;
    case "--height": height = parseInt(args[++i]); break;
    default: sections.push(args[i]);
  }
}

// Default: screenshot just what was asked, or a hero shot
if (!sections.length) sections.push("blog");

async function ensureServer(): Promise<() => void> {
  // Check if already running on our port
  try {
    const res = await fetch(BASE_URL);
    if (res.ok) return () => {}; // already running, no-op cleanup
  } catch {}

  // Start server
  const server = spawn("bun", ["serve.ts"], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: "pipe",
  });

  // Wait for ready
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(BASE_URL);
      if (res.ok) break;
    } catch {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  return () => server.kill();
}

async function screenshot(hash: string, label: string) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height } });

  if (lightMode) {
    await page.emulateMedia({ colorScheme: "light" });
  }

  await page.goto(`${BASE_URL}/#${hash}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600); // animations

  // If hash includes a card name (e.g., blog/post-name), ensure it's expanded
  // Hash navigation may have already opened it — only click if still collapsed
  const parts = hash.split("/");
  if (parts.length > 1) {
    const section = parts[0];
    const cardName = parts.slice(1).join("/");
    if (section === "blog") {
      const card = page.locator(`.blog-card[data-name="${cardName}"]`);
      if (await card.count() && !(await card.evaluate(el => el.classList.contains("open")))) {
        await card.locator(".blog-card-header").click();
        await page.waitForTimeout(400);
      }
    } else {
      const card = page.locator(`.card[data-name="${cardName}"]`);
      if (await card.count() && !(await card.evaluate(el => el.classList.contains("expanded")))) {
        await card.locator(".card-header").click();
        await page.waitForTimeout(300);
      }
    }
  }

  const filename = `${label.replace(/\//g, "-")}${lightMode ? "-light" : ""}.png`;
  const outPath = join(OUT_DIR, filename);
  await page.screenshot({ path: outPath, fullPage });

  await browser.close();
  return outPath;
}

// Main
const dataJson = join(__dirname, "data.json");
if (!skipScan || !existsSync(dataJson)) {
  console.log("Scanning...");
  execSync("bun scan.ts --skip-validation", { cwd: __dirname, stdio: "inherit" });
}

execSync(`mkdir -p "${OUT_DIR}"`);

const killServer = await ensureServer();

try {
  for (const section of sections) {
    const label = section || "hero";
    console.log(`Capturing: ${label}`);
    const path = await screenshot(section, label);
    console.log(`  → ${path}`);
  }
} finally {
  killServer();
}
