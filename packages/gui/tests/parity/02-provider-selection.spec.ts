import { expect, test } from "./fixtures/gateway.js";

test.describe("parity category 2 - provider and model selection", () => {
  test("switches provider/model and stamps routed assistant headers", async ({ page }) => {
    await page.goto("/");

    const providerStatus = page.locator('button[aria-label^="Provider selector."]');
    await expect(providerStatus).toBeVisible({ timeout: 3_000 });
    await expect(providerStatus).toHaveAttribute("aria-label", /Provider selector/);

    await providerStatus.click();
    await page.getByRole("option", { name: /^Codex \d+ models$/ }).click();
    await page.getByRole("option", { name: "gpt-5.4-mini" }).click();
    await expect(providerStatus).toHaveAttribute("aria-label", /Codex \/ gpt-5\.4-mini/, { timeout: 2_000 });

    const composer = page.locator("#composer-input");
    await composer.fill("route this through codex");
    await composer.press("Enter");
    const codexRouteLabel = page.locator('[data-role="assistant"] header span:nth-child(2)').first();
    await expect(codexRouteLabel).toContainText("Codex", { timeout: 5_000 });

    await providerStatus.click();
    await page.getByRole("option", { name: "Claude No model selection" }).click();
    await expect(providerStatus).toHaveAttribute("aria-label", /Claude/, { timeout: 2_000 });

    await composer.fill("route this through claude");
    await composer.press("Enter");
    const assistantRows = page.locator('[data-role="assistant"] header span:nth-child(2)');
    await expect(assistantRows.last()).toContainText("Claude", { timeout: 5_000 });
  });

  test("keeps an in-flight response stamped with its original provider after selecting the next provider", async ({ page }) => {
    await page.goto("/");

    const providerStatus = page.locator('button[aria-label^="Provider selector."]');
    await expect(providerStatus).toBeVisible({ timeout: 3_000 });

    await providerStatus.click();
    await page.getByRole("option", { name: /^Codex \d+ models$/ }).click();
    await page.getByRole("option", { name: "gpt-5.4-mini" }).click();
    await expect(providerStatus).toHaveAttribute("aria-label", /Codex \/ gpt-5\.4-mini/, { timeout: 2_000 });

    const composer = page.locator("#composer-input");
    await composer.fill("hold stream for provider switch");
    await composer.press("Enter");
    const firstAssistantRoute = page.locator('[data-role="assistant"] header span:nth-child(2)').first();
    await expect(firstAssistantRoute).toContainText("Codex", { timeout: 5_000 });

    await providerStatus.click();
    await page.getByRole("option", { name: "Claude No model selection" }).click();
    await expect(providerStatus).toHaveAttribute("aria-label", /Claude/, { timeout: 2_000 });

    await expect(page.locator('[data-role="assistant"]').first()).toContainText("echo:hold stream for provider switch", { timeout: 5_000 });
    await expect(firstAssistantRoute).toContainText("Codex", { timeout: 2_000 });
  });
});
