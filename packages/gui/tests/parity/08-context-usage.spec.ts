import { expect, test, waitForGuiReady } from "./fixtures/gateway.js";

test.describe("parity category 8 - context usage evidence", () => {
  test("renders unavailable, partial, authoritative, and restored context evidence without fabricated precision", async ({ page }) => {
    await page.goto("/");
    await waitForGuiReady(page);

    await expect(page.getByRole("button", { name: "Context usage unavailable" })).toBeVisible();

    await page.getByRole("button", { name: /Inspect partial context evidence/ }).click();
    await expect(page.getByRole("button", { name: "Context partial: 2.4k tokens" })).toHaveText("P");

    await page.getByRole("button", { name: /Inspect authoritative context evidence/ }).click();
    await expect(page.getByRole("button", { name: "Context 25%: 2k / 8k tokens" })).toHaveText("25%");

    await page.getByRole("button", { name: /Summarize parity checklist/ }).click();
    const restored = page.getByRole("button", { name: "Context 30%: 2.4k / 8k tokens; restored historical measurement" });
    await expect(restored).toHaveText(/30%/);
    await expect(restored).toHaveText(/H/);
    await restored.hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toContainText("restored historical measurement");
  });

  test("keeps the circular control in the compact composer rail while switching route-bound fixture evidence", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 720 });
    await page.goto("/");
    await waitForGuiReady(page);

    await page.getByRole("button", { name: "Open session drawer" }).click();
    await page.getByRole("button", { name: /Inspect partial context evidence/ }).click();
    await expect(page.getByRole("button", { name: "Context partial: 2.4k tokens" })).toBeVisible();

    await page.getByRole("button", { name: "Open session drawer" }).click();
    await page.getByRole("button", { name: /Inspect authoritative context evidence/ }).click();
    await expect(page.getByRole("button", { name: "Context 25%: 2k / 8k tokens" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
