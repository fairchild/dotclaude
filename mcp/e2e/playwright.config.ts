import { defineConfig } from "@playwright/test";

// The suite drives the real Worker: `wrangler dev` over a freshly built
// snapshot, so routing, negotiation and the generated pages are the ones
// production serves.
const port = Number(process.env.SKILLS_E2E_PORT ?? 8794);
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: ".",
  testMatch: "*.e2e.test.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  outputDir: "artifacts",
  timeout: 60_000,
  use: {
    baseURL: origin,
    browserName: "chromium",
    viewport: { width: 1280, height: 900 },
    // Every run leaves a watchable recording of the keyboard journey.
    video: { mode: "on", size: { width: 1280, height: 900 } },
    trace: "retain-on-failure",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  webServer: {
    command: `bun run build && ./node_modules/.bin/wrangler dev --config worker/wrangler.toml --ip 127.0.0.1 --port ${port}`,
    cwd: "..",
    url: `${origin}/manifest.json`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { WRANGLER_SEND_METRICS: "false" },
  },
});
