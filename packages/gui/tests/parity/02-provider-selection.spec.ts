import { expect, test } from "./fixtures/gateway.js";

test.describe("parity category 2 - provider and model selection", () => {
  test("switches provider/model and stamps routed assistant headers", async ({ page }) => {
    await page.goto("/");

    const providerStatus = page.getByRole("button", { name: /Click to change/ });
    await expect(providerStatus).toBeVisible({ timeout: 3_000 });

    await providerStatus.click();
    await page.getByRole("option", { name: "Codex 6 models" }).click();
    await page.getByRole("option", { name: "gpt-5.4-mini" }).click();
    await expect(page.getByRole("button", { name: /Codex \/ gpt-5\.4-mini/ })).toBeVisible({ timeout: 2_000 });

    const composer = page.locator("#composer-input");
    await composer.fill("route this through codex");
    await composer.press("Enter");
    const codexRouteLabel = page.locator('[data-role="assistant"] header span:nth-child(2)').first();
    await expect(codexRouteLabel).toContainText("Codex", { timeout: 5_000 });

    await page.getByRole("button", { name: /Codex \/ gpt-5\.4-mini/ }).click();
    await page.getByRole("option", { name: "Claude No model selection" }).click();
    await expect(page.getByRole("button", { name: /Claude.*Click to change/ })).toBeVisible({ timeout: 2_000 });

    await composer.fill("route this through claude");
    await composer.press("Enter");
    const assistantRows = page.locator('[data-role="assistant"] header span:nth-child(2)');
    await expect(assistantRows.last()).toContainText("Claude", { timeout: 5_000 });
  });
});
