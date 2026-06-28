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
  await browser.close();
  browser = undefined;
  process.stdout.write(`${JSON.stringify({ browserLaunchMs, navigationCommittedMs, firstUsableMs })}\n`);
} finally {
  await browser?.close().catch(() => undefined);
}
