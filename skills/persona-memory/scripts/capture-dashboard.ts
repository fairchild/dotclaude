#!/usr/bin/env bun
import { mkdirSync } from "fs";
import { join } from "path";
import { chromium, type BrowserContextOptions } from "playwright";

interface CaptureVariant {
  name: string;
  context: BrowserContextOptions;
}

type ThemeMode = "auto" | "light" | "dark" | "both";
type ThemeChoice = "light" | "dark";

interface CaptureReport {
  ok: boolean;
  code: string;
  details: {
    base_url: string;
    output_dir: string;
    deterministic_status: string | null;
    theme_mode: ThemeMode;
    primary_theme: ThemeChoice;
    local_time: string;
    captured_variants: string[];
    files: string[];
  };
}

const skillDir = join(import.meta.dir, "..");

function getArg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowStamp(): string {
  return new Date().toISOString().replace(/[.:]/g, "-");
}

function parseThemeMode(raw: string | null): ThemeMode {
  if (!raw) return "auto";
  if (raw === "auto" || raw === "light" || raw === "dark" || raw === "both") return raw;
  throw new Error(`Invalid --theme '${raw}'. Expected auto|light|dark|both.`);
}

function chooseThemeByLocalTime(now: Date): ThemeChoice {
  const hour = now.getHours();
  return hour >= 18 || hour < 7 ? "dark" : "light";
}

function oppositeTheme(theme: ThemeChoice): ThemeChoice {
  return theme === "dark" ? "light" : "dark";
}

function buildVariants(themeMode: ThemeMode, primaryTheme: ThemeChoice): CaptureVariant[] {
  const desktop = (scheme: ThemeChoice, suffix = ""): CaptureVariant => ({
    name: `desktop-${scheme}${suffix}`,
    context: {
      viewport: { width: 1440, height: 1080 },
      colorScheme: scheme,
      deviceScaleFactor: 2,
    },
  });

  const mobile = (scheme: ThemeChoice, suffix = ""): CaptureVariant => ({
    name: `mobile-${scheme}${suffix}`,
    context: {
      viewport: { width: 390, height: 844 },
      colorScheme: scheme,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    },
  });

  if (themeMode === "both") {
    return [
      desktop("light"),
      desktop("dark"),
      mobile("light"),
      mobile("dark"),
    ];
  }

  if (themeMode === "light" || themeMode === "dark") {
    return [
      desktop(themeMode),
      mobile(themeMode),
    ];
  }

  const sanityTheme = oppositeTheme(primaryTheme);
  return [
    desktop(primaryTheme),
    mobile(primaryTheme),
    desktop(sanityTheme, "-sanity"),
  ];
}

async function waitForHealth(baseUrl: string, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "unknown";

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`, { cache: "no-store" });
      if (res.ok) return;
      lastError = `HTTP_${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await sleep(250);
  }

  throw new Error(`dashboard server did not become healthy (${lastError})`);
}

async function triggerDeterministic(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/run/deterministic`, {
    method: "POST",
    cache: "no-store",
  });

  const payload = (await res.json()) as {
    ok?: boolean;
    code?: string;
    details?: { report?: { status?: string }; run_status?: string };
  };

  if (!res.ok || !payload.ok) {
    throw new Error(`deterministic run failed: ${payload.code || `HTTP_${res.status}`}`);
  }

  return payload.details?.report?.status || payload.details?.run_status || "unknown";
}

async function triggerRebuild(baseUrl: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/evalset/rebuild`, {
    method: "POST",
    cache: "no-store",
  });
  const payload = (await res.json()) as { ok?: boolean; code?: string };
  if (!res.ok || !payload.ok) {
    throw new Error(`evalset rebuild failed: ${payload.code || `HTTP_${res.status}`}`);
  }
}

async function captureVariant(
  baseUrl: string,
  outputDir: string,
  variant: CaptureVariant,
): Promise<string[]> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(variant.context);
  const page = await context.newPage();

  const files: string[] = [];
  try {
    await page.goto(`${baseUrl}/assets/eval-dashboard/`, { waitUntil: "networkidle" });
    await page.waitForSelector("#loadLatest", { timeout: 15000 });
    await page.click("#loadLatest");
    await page.waitForTimeout(1200);

    const fullPath = join(outputDir, `${variant.name}-full.png`);
    await page.screenshot({ path: fullPath, fullPage: true });
    files.push(fullPath);

    const curationCard = page.locator("article.card:has(h3:has-text('Evalset Curation'))").first();
    if ((await curationCard.count()) > 0) {
      await curationCard.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      const curationPath = join(outputDir, `${variant.name}-curation.png`);
      await curationCard.screenshot({ path: curationPath });
      files.push(curationPath);
    }

    return files;
  } finally {
    await context.close();
    await browser.close();
  }
}

const host = getArg("host") || "127.0.0.1";
const portRaw = getArg("port") || "8799";
const port = Number(portRaw);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`Invalid --port '${portRaw}'. Expected 1..65535.`);
  process.exit(1);
}

const baseUrl = `http://${host}:${port}`;
const outDirArg = getArg("out-dir");
const outputDir = outDirArg || join(skillDir, "assets", "eval-dashboard", "screenshots", nowStamp());
const startServer = !hasFlag("no-server");
const skipRun = hasFlag("skip-run");
const themeMode = parseThemeMode(getArg("theme"));
const localNow = new Date();
const localTime = localNow.toLocaleString();
const primaryTheme = chooseThemeByLocalTime(localNow);

mkdirSync(outputDir, { recursive: true });
const variants: CaptureVariant[] = buildVariants(themeMode, primaryTheme);

let serverProc: Bun.Subprocess | null = null;
let deterministicStatus: string | null = null;

try {
  if (startServer) {
    serverProc = Bun.spawn(["bun", "scripts/serve-eval-dashboard.ts", "--host", host, "--port", String(port)], {
      cwd: skillDir,
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  await waitForHealth(baseUrl);

  if (!skipRun) {
    deterministicStatus = await triggerDeterministic(baseUrl);
  }
  await triggerRebuild(baseUrl);

  const files: string[] = [];
  for (const variant of variants) {
    const captured = await captureVariant(baseUrl, outputDir, variant);
    files.push(...captured);
  }

  const report: CaptureReport = {
    ok: true,
    code: "SUCCESS",
    details: {
      base_url: baseUrl,
      output_dir: outputDir,
      deterministic_status: deterministicStatus,
      theme_mode: themeMode,
      primary_theme: primaryTheme,
      local_time: localTime,
      captured_variants: variants.map((variant) => variant.name),
      files,
    },
  };

  console.log(JSON.stringify(report, null, 2));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  const report: CaptureReport = {
    ok: false,
    code: "CAPTURE_FAILED",
    details: {
      base_url: baseUrl,
      output_dir: outputDir,
      deterministic_status: deterministicStatus,
      theme_mode: themeMode,
      primary_theme: primaryTheme,
      local_time: localTime,
      captured_variants: variants.map((variant) => variant.name),
      files: [],
    },
  };
  console.error(message);
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
} finally {
  if (serverProc) {
    try {
      serverProc.kill();
      await serverProc.exited;
    } catch {
      // no-op
    }
  }
}
