import { test, expect } from "./fixtures/gateway.js";

test.describe("GUI smoke", () => {
  test("landing route renders interactive shell", async ({ page, gatewayPort: _ }) => {
    await page.goto("/");
    await expect(page.locator("#composer-input")).toBeEnabled({ timeout: 3_000 });
    await expect(page.getByRole("complementary")).toBeVisible();
  });
});

test.describe("theme switcher", () => {
  test("setup theme switcher persists Kiln Paper on <html>", async ({ page, gatewayPort: _ }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Setup" }).click();
    const switcher = page.getByRole("combobox", { name: "Theme" });
    await expect(switcher).toBeVisible();
    await switcher.click();
    await page.getByRole("option", { name: "Kiln Paper" }).click();

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});
