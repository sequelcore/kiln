import { expect, test } from "./fixtures/gateway.js";

test.describe("parity category 5 - theming and visual behavior", () => {
  test("persists theme changes and visually differentiates user and assistant messages", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("#composer-input")).toBeEnabled({ timeout: 5_000 });

    await page.getByRole("button", { name: "Setup" }).click();
    const switcher = page.getByRole("combobox", { name: "Theme" });
    await expect(switcher).toBeVisible();
    await switcher.click();
    await page.getByRole("option", { name: "Kiln Paper" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.reload();
    await expect(page.locator("#composer-input")).toBeEnabled({ timeout: 5_000 });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: /provider.*Click to change/i }).click();
    await page.getByRole("option", { name: "Codex 6 models" }).click();
    await page.getByRole("option", { name: "gpt-5.4-mini" }).click();
    await expect(page.getByRole("button", { name: /Codex \/ gpt-5\.4-mini/ })).toBeVisible({
      timeout: 2_000,
    });

    const composer = page.locator("#composer-input");
    await composer.fill("show visual roles");
    await composer.press("Enter");

    await expect(page.locator('[data-role="user"]').last()).toBeVisible({ timeout: 2_000 });
    await expect(page.locator('[data-role="assistant"]').last()).toBeVisible({ timeout: 5_000 });
  });
});
