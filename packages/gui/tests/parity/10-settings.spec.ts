import { expect, test, waitForGuiReady } from "./fixtures/gateway.js";

test.describe("parity category 10 - shared settings", () => {
  test("searches, resets inheritance, restores focus, and stays usable when narrow", async ({ page, operatorToken }) => {
    await page.goto(`/#operatorToken=${encodeURIComponent(operatorToken)}`);
    await waitForGuiReady(page);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/general(?:\?.*)?$/u);
    const navigation = page.getByRole("navigation", { name: "Settings sections" });
    await expect(navigation.getByRole("button")).toHaveCount(9);
    await expect(page.getByText("Project · Overridden in project · Next session")).toBeVisible();

    await page.keyboard.press("/");
    const sectionSearch = page.getByRole("combobox", { name: "Search settings" });
    await expect(sectionSearch).toBeFocused();
    await sectionSearch.fill("limits");
    await sectionSearch.press("Enter");
    await expect(page).toHaveURL(/\/settings\/usage-and-limits(?:\?.*)?$/u);
    await expect(page.getByRole("heading", { name: "Usage and Limits" })).toBeVisible();

    await navigation.getByRole("button", { name: "General" }).click();
    const reset = page.getByRole("button", { name: "Reset Domain to inheritance" });
    await reset.click();
    await expect(reset).toBeDisabled();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Apply change" }).click();
    await expect(page.getByRole("status")).toContainText("committed");
    await expect(page.getByText("Default · Inherited in project · Next session")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Value for Domain" })).toBeFocused();

    await navigation.getByRole("button", { name: "Advanced" }).click();
    const advancedSearch = page.getByRole("searchbox", { name: "Search all settings" });
    await advancedSearch.fill("missing setting");
    await expect(page.getByText("No settings match this filter.")).toBeVisible();

    await page.setViewportSize({ width: 560, height: 760 });
    await expect(page.getByRole("combobox", { name: "Settings category" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Search settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Back to workbench" })).toBeVisible();
  });
});
