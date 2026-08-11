import { expect, test, waitForGuiReady } from "./fixtures/gateway.js";

test.describe("parity category 8 - context usage evidence", () => {
  test("hides unavailable context and renders partial, authoritative, and restored evidence without fabricated precision", async ({ page }) => {
    await page.goto("/");
    await waitForGuiReady(page);

    await expect(page.getByRole("button", { name: "Context usage unavailable" })).toHaveCount(0);

    await page.getByRole("button", { name: /Inspect partial context evidence/ }).click();
    const partial = page.getByRole("button", { name: "Context partial: 2.4k tokens" });
    await expect(partial).toBeVisible();
    await partial.click();
    await expect(page.getByRole("heading", { name: "Context window" })).toBeVisible();
    await expect(page.getByText("Runtime estimate")).toBeVisible();
    await partial.click();

    await page.getByRole("button", { name: /Inspect authoritative context evidence/ }).click();
    const authoritative = page.getByRole("button", { name: "Context 25%: 2k / 8k tokens" });
    await expect(authoritative).toBeVisible();
    await authoritative.click();
    await expect(page.getByText("Provider reported")).toBeVisible();
    await expect(page.getByText("6k remaining")).toBeVisible();
    await authoritative.click();

    await page.getByRole("button", { name: /Summarize parity checklist/ }).click();
    const restored = page.getByRole("button", { name: "Context 30%: 2.4k / 8k tokens; restored historical measurement" });
    await expect(restored).toBeVisible();
    await restored.click();
    await expect(page.getByText("Historical")).toBeVisible();
  });

  test("keeps the context meter in the compact composer rail while switching route-bound fixture evidence", async ({ page }) => {
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
