import { expect, test } from "./fixtures/gateway.js";

test.describe("parity category 3 - cost and telemetry", () => {
  test("renders telemetry surfaces and updates session counters after a turn", async ({ page }) => {
    await page.goto("/");

    const costSection = page.locator("section").filter({ has: page.getByText("Cost", { exact: true }) }).first();
    const sessionSection = page.locator("section").filter({ has: page.getByText("Session", { exact: true }) }).first();
    const continuitySection = page.locator("section").filter({ has: page.getByText("Continuity", { exact: true }) }).first();
    const fieldSection = page.locator("section").filter({ has: page.getByText("Field", { exact: true }) }).first();

    await expect(costSection).toBeVisible();
    await expect(sessionSection).toBeVisible();
    await expect(continuitySection).toBeVisible();
    await expect(fieldSection).toBeVisible();
    await expect(page.getByText("field [idle]")).toBeVisible();

    const composer = page.locator("#composer-input");
    await composer.fill("collect telemetry evidence");
    await composer.press("Enter");

    await expect(page.getByText("thinking...")).toBeVisible({ timeout: 2_000 });
    await expect(costSection.getByText("$0.0104", { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(sessionSection.getByText("turns: 1", { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(sessionSection.getByText(/tok:\s+\d+(?:\.\d+)?k?\/\d+(?:\.\d+)?k?/)).toBeVisible({ timeout: 5_000 });
  });
});
