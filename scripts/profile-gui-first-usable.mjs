import { chromium } from "@playwright/test";

const [guiUrl, timeoutRaw] = process.argv.slice(2);
const timeoutMs = Number(timeoutRaw);

if (!guiUrl || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  throw new Error("Usage: node profile-gui-first-usable.mjs <gui-url> <timeout-ms>");
}

const startedAt = performance.now();
let browser;

try {
  browser = await chromium.launch({ headless: true });
  const browserLaunchMs = Math.round(performance.now() - startedAt);
  const page = await browser.newPage();
  await page.goto(guiUrl, { waitUntil: "commit", timeout: timeoutMs });
  const navigationCommittedMs = Math.round(performance.now() - startedAt);

  const composer = page.getByPlaceholder("Message Kiln", { exact: true });
  await composer.waitFor({ state: "visible", timeout: timeoutMs });
  await composer.fill("Kiln startup readiness probe");

  const sendButton = page.locator('button[aria-label="Send message"]:visible');
  await sendButton.waitFor({ state: "visible", timeout: timeoutMs });
  const deadline = Date.now() + timeoutMs;
  while (!(await sendButton.isEnabled())) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for the GUI composer to become usable");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await composer.fill("");

  const firstUsableMs = Math.round(performance.now() - startedAt);
  const initialResources = await page.evaluate(() => {
    function resourceName(name) {
      try {
        const url = new URL(name);
        if (url.pathname.startsWith("/gui/@fs/")) {
          const packagesIndex = url.pathname.indexOf("/packages/");
          if (packagesIndex >= 0) {
            return `/gui/@fs<workspace>${url.pathname.slice(packagesIndex)}${url.search}`;
          }
          const nodeModulesIndex = url.pathname.indexOf("/node_modules/");
          if (nodeModulesIndex >= 0) {
            return `/gui/@fs<workspace>${url.pathname.slice(nodeModulesIndex)}${url.search}`;
          }
          return `/gui/@fs<redacted>${url.search}`;
        }
        return `${url.pathname}${url.search}`;
      } catch {
        return name;
      }
    }

    const resources = performance
      .getEntriesByType("resource")
      .filter((entry) => entry.startTime <= performance.now())
      .map((entry) => {
        const resource = entry;
        return {
          name: resourceName(resource.name),
          initiatorType: resource.initiatorType,
          startTimeMs: Math.round(resource.startTime),
          durationMs: Math.round(resource.duration),
          transferSize: Number.isFinite(resource.transferSize) ? resource.transferSize : undefined,
        };
      });
    return {
      count: resources.length,
      totalDurationMs: resources.reduce((sum, entry) => sum + entry.durationMs, 0),
      slowest: resources
        .toSorted((left, right) => right.durationMs - left.durationMs)
        .slice(0, 20),
    };
  });
  await browser.close();
  browser = undefined;
  process.stdout.write(`${JSON.stringify({ browserLaunchMs, navigationCommittedMs, firstUsableMs, initialResources })}\n`);
} finally {
  await browser?.close().catch(() => undefined);
}
