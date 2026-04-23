import { expect, test } from "./fixtures/gateway.js";

test.describe("parity category 2 - provider and model selection", () => {
  test("switches provider/model and stamps routed assistant headers", async ({ page }) => {
    await page.goto("/");

    const providerStatus = page.getByRole("button", { name: "Current provider. Click to change." });
    await expect(providerStatus).toBeVisible({ timeout: 3_000 });

    await page.keyboard.press(process.platform === "darwin" ? "Meta+P" : "Control+P");
    await expect(page.getByRole("dialog", { name: "Switch provider" })).toBeVisible({ timeout: 2_000 });

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(providerStatus).toContainText("Codex", { timeout: 2_000 });

    const composer = page.locator("#composer-input");
    await composer.fill("route this through codex");
    await composer.press("Enter");
    const codexRouteLabel = page.locator('[data-role="assistant"] header span:nth-child(2)').first();
    await expect(codexRouteLabel).toContainText("Codex", { timeout: 5_000 });

    await providerStatus.click();
    await expect(page.getByRole("dialog", { name: "Switch provider" })).toBeVisible({ timeout: 2_000 });
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(providerStatus).toContainText("Claude", { timeout: 2_000 });

    await composer.fill("route this through claude");
    await composer.press("Enter");
    const assistantRows = page.locator('[data-role="assistant"] header span:nth-child(2)');
    await expect(assistantRows.last()).toContainText("Claude", { timeout: 5_000 });
  });
});
