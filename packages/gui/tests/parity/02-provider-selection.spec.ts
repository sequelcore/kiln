import { expect, test, waitForGuiReady } from "./fixtures/gateway.js";

test.describe("parity category 2 - provider and model selection", () => {
  test("switches provider/model and stamps routed assistant headers", async ({ page }) => {
    await page.goto("/");
    await waitForGuiReady(page);

    const providerStatus = page.locator('button[aria-label^="Provider selector."]');
    await expect(providerStatus).toBeVisible({ timeout: 3_000 });
    await expect(providerStatus).toHaveAttribute("aria-label", /Provider selector/);

    await providerStatus.click();
    await expect(page.getByRole("option", { name: "Codex, No model selection" })).toBeDisabled();
    const codexBrandMark = page.getByRole("button", { name: "Codex" }).locator('[data-provider-brand="codex"]');
    await expect(codexBrandMark).not.toHaveCSS("mask-image", "none");
    await expect(codexBrandMark).not.toHaveCSS("background-color", "rgb(255, 255, 255)");

    await page.getByRole("button", { name: "Refresh providers" }).click();
    await expect(page.getByRole("dialog", { name: "Switch provider route" })).toBeVisible();
    await expect(page.getByRole("status", { name: "Runtime bootstrap" })).toHaveCount(0);

    const openCodeBrand = page.getByRole("button", { name: "OpenCode" });
    await expect(openCodeBrand.locator('[data-provider-brand="opencode"]')).not.toHaveCSS("mask-image", "none");
    await openCodeBrand.click();
    await page.getByRole("combobox", { name: "Route type" }).click();
    await page.getByRole("option", { name: "Harness", exact: true }).click();
    await expect(openCodeBrand).toHaveAttribute("aria-pressed", "true");
    const routeList = page.getByRole("listbox", { name: "Provider routes" });
    await expect(routeList.getByRole("option", { name: "OpenCode, No model selection" })).toBeVisible();
    await expect(routeList.getByRole("option", { name: /Claude/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(providerStatus).toHaveAttribute("aria-label", /Claude \/ Select model/, { timeout: 2_000 });

    const composer = page.locator("#composer-input");
    await composer.fill("route this through claude");
    await composer.press("Enter");
    const assistantRows = page.locator('[data-role="assistant"] [data-slot="message-header"] [data-slot="badge"]');
    await expect(assistantRows.last()).toContainText("Claude", { timeout: 5_000 });
  });

  test("keeps an in-flight response stamped with its original provider while inspecting provider options", async ({ page }) => {
    await page.goto("/");
    await waitForGuiReady(page);

    const providerStatus = page.locator('button[aria-label^="Provider selector."]');
    await expect(providerStatus).toBeVisible({ timeout: 3_000 });

    const composer = page.locator("#composer-input");
    await composer.fill("hold stream for provider switch");
    await composer.press("Enter");
    const firstAssistantRoute = page.locator('[data-role="assistant"] [data-slot="message-header"] [data-slot="badge"]').first();
    await expect(firstAssistantRoute).toContainText("Claude", { timeout: 5_000 });

    await providerStatus.click();
    await expect(page.getByRole("option", { name: "Codex, No model selection" })).toBeDisabled();
    await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
    await page.keyboard.press("Escape");

    await expect(page.locator('[data-role="assistant"]').first()).toContainText("echo:hold stream for provider switch", { timeout: 5_000 });
    await expect(firstAssistantRoute).toContainText("Claude", { timeout: 2_000 });
  });
});
