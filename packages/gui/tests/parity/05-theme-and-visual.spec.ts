import { expect, test } from "./fixtures/gateway.js";

test.describe("parity category 5 - theming and visual behavior", () => {
  test("persists theme changes and visually differentiates user and assistant messages", async ({ page }) => {
    await page.goto("/");

    const switcher = page.getByRole("radiogroup", { name: "Theme" });
    await expect(switcher).toBeVisible();
    await page.getByRole("radio", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    const composer = page.locator("#composer-input");
    await composer.fill("show visual roles");
    await composer.press("Enter");

    await expect(page.locator('[data-role="user"]').last()).toBeVisible({ timeout: 2_000 });
    await expect(page.locator('[data-role="assistant"]').last()).toBeVisible({ timeout: 5_000 });
  });
});
