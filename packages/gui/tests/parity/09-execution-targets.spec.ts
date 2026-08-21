import { expect, test, waitForGuiReady } from "./fixtures/gateway.js";

test.describe("parity category 9 - canonical execution targets", () => {
  test("selects Sol medium by target identity and keeps unavailable targets closed", async ({ page }) => {
    await page.goto("/");
    await waitForGuiReady(page);

    const targetSelector = page.getByRole("button", { name: /Execution target selector/ });
    await targetSelector.click();
    await expect(page.getByRole("combobox", { name: "Search execution targets" })).toBeVisible();

    const unavailable = page.getByRole("option", { name: /DeepSeek Flash, Automatic, Unavailable/ });
    await expect(unavailable).toBeDisabled();
    await expect(page.getByText("Model unavailable")).toBeVisible();

    await page.getByRole("option", { name: "Sol Medium, Automatic" }).click();
    await expect(targetSelector).toContainText("Sol Medium");

    await targetSelector.click();
    await expect(page.getByRole("option", { name: "Sol Medium, Automatic, Current" })).toBeVisible();
  });
});
