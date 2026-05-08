import { expect, test } from "./fixtures/gateway.js";

test.describe("parity category 4 - input and keyboard ergonomics", () => {
  test("opens slash palette from empty input and resumes selected session with empty Enter", async ({ page }) => {
    await page.goto("/");

    const composer = page.locator("#composer-input");
    await composer.click();
    await composer.press("/");

    const palette = page.getByRole("dialog", { name: "Composer commands" });
    await expect(palette).toBeVisible({ timeout: 2_000 });
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden({ timeout: 2_000 });

    await page.getByRole("option", { name: /Summarize parity checklist/ }).click();
    await composer.click();
    await composer.press("Enter");

    await expect.poll(async () => page.evaluate(() => localStorage.getItem("kiln.gui.resumeTarget"))).not.toBeNull();
  });
});
