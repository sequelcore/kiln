import { defineConfig, devices } from "@playwright/test";

const CI = process.env["CI"] === "true";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  reporter: [["html", { outputFolder: "playwright-report", open: "never" }]],

  use: {
    baseURL: "http://localhost:5183",
    headless: true,
    trace: "on-first-retry",
  },

  retries: CI ? 2 : 0,

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "bun run dev",
    url: "http://localhost:5183",
    reuseExistingServer: !CI,
    timeout: 30_000,
  },
});
