import { defineConfig, devices } from "@playwright/test";
import { createServer } from "node:net";

const CI = process.env["CI"] === "true";
const gatewayPort = process.env.GUI_GATEWAY_PORT ?? String(await reserveGatewayPort());
process.env.GUI_GATEWAY_PORT = gatewayPort;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  reporter: [["html", { outputFolder: "playwright-report", open: "never" }]],
  // Single worker: the Vite proxy has a fixed gateway target (GUI_GATEWAY_PORT)
  // and each test's fixture starts its own gateway. Running sequentially means
  // only one fixture-started gateway exists at a time, so the Vite proxy and
  // direct-connection tests always see a live gateway.
  workers: 1,

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
    env: {
      ...process.env,
      GUI_GATEWAY_PORT: gatewayPort,
    },
  },
});

async function reserveGatewayPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a GUI gateway port for Playwright.");
  }
  return address.port;
}
