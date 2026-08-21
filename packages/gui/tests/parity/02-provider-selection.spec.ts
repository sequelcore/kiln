import { expect, test, waitForGuiReady } from "./fixtures/gateway.js";

test.describe("parity category 2 - execution target selection", () => {
  test("switches target and stamps routed assistant headers", async ({ page }) => {
    await page.goto("/");
    await waitForGuiReady(page);

    const targetSelector = page.getByRole("button", { name: /Execution target selector/ });
    await expect(targetSelector).toHaveAttribute("aria-label", /Current selection: Claude/);

    await targetSelector.click();
    const codexTarget = page.getByRole("option", { name: "Codex, Automatic" });
    const codexBrandMark = codexTarget.locator('[data-provider-brand="codex"]');
    await expect(codexBrandMark).not.toHaveCSS("mask-image", "none");
    await expect(codexBrandMark).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
    await codexTarget.click();
    await expect(targetSelector).toHaveAttribute("aria-label", /Current selection: Codex/);

    const composer = page.locator("#composer-input");
    await composer.fill("route this through codex");
    await composer.press("Enter");
    const assistantRows = page.locator('[data-role="assistant"] [data-slot="message-header"] [data-slot="badge"]');
    await expect(assistantRows.last()).toContainText("Codex", { timeout: 5_000 });
  });

  test("keeps an in-flight response stamped with its original target while inspecting alternatives", async ({ page }) => {
    await page.goto("/");
    await waitForGuiReady(page);

    const targetSelector = page.getByRole("button", { name: /Execution target selector/ });
    await expect(targetSelector).toHaveAttribute("aria-label", /Current selection: Claude/);

    const composer = page.locator("#composer-input");
    await composer.fill("hold stream for provider switch");
    await composer.press("Enter");
    const firstAssistantRoute = page.locator('[data-role="assistant"] [data-slot="message-header"] [data-slot="badge"]').first();
    await expect(firstAssistantRoute).toContainText("Claude", { timeout: 5_000 });

    await targetSelector.click();
    await expect(page.getByRole("option", { name: "Codex, Automatic" })).toBeVisible();
    await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
    await page.keyboard.press("Escape");

    await expect(page.locator('[data-role="assistant"]').first()).toContainText("echo:hold stream for provider switch", { timeout: 5_000 });
    await expect(firstAssistantRoute).toContainText("Claude", { timeout: 2_000 });
  });
});
