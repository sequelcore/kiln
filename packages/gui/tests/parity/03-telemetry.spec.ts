import { expect, test } from "./fixtures/gateway.js";

test.describe("parity category 3 - cost and telemetry", () => {
  test("keeps telemetry out of persistent chrome and records cost evidence in Activity", async ({ page }) => {
    await page.goto("/");

    const composer = page.locator("#composer-input");
    await expect(composer).toBeEnabled({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Details" })).toHaveCount(0);
    await expect(page.getByText("field [idle]")).toHaveCount(0);
    await page.getByRole("button", { name: /provider.*Click to change/i }).click();
    await page.getByRole("option", { name: "Codex 6 models" }).click();
    await page.getByRole("option", { name: "gpt-5.4-mini" }).click();
    await expect(page.getByRole("button", { name: /Codex \/ gpt-5\.4-mini/ })).toBeVisible({
      timeout: 2_000,
    });

    await composer.fill("collect telemetry evidence");
    await composer.press("Enter");

    await expect(page.locator('[data-role="assistant"]').last()).toContainText("Reply", { timeout: 5_000 });

    await page.getByRole("button", { name: "Activity" }).click();
    await page.getByRole("button", { name: /Cost updated/ }).click();
    const detail = page.getByRole("region", { name: "Selected activity detail" });
    await expect(detail).toContainText("$0.0104", { timeout: 5_000 });
    await expect(detail).toContainText("21");
    await expect(detail).toContainText("42");
  });
});
