import { test, expect } from "./fixtures/gateway.js";

test.describe("GUI smoke", () => {
  test("landing route renders interactive shell", async ({ page, gatewayPort: _ }) => {
    await page.goto("/");
    await expect(page.locator("#composer-input")).toBeEnabled({ timeout: 3_000 });
    await expect(page.getByRole("complementary")).toBeVisible();
  });
});

test.describe("theme switcher", () => {
  test("switcher is present and clicking Light sets data-theme=light on <html>", async ({ page, gatewayPort: _ }) => {
    await page.goto("/");

    // Theme switcher radiogroup must be visible
    const switcher = page.getByRole("radiogroup", { name: "Theme" });
    await expect(switcher).toBeVisible();

    // Click the Light option
    await page.getByRole("radio", { name: "Light" }).click();

    // <html> data-theme must be "light" immediately (no reload required)
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // Reload — persisted choice must survive
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    // After reload, Light radio must still report aria-checked="true"
    await expect(page.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
  });
});
