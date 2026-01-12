import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "e2e.test.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3333",
    trace: "off",
    screenshot: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
