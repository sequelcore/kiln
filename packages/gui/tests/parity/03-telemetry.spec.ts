import { expect, test, waitForGuiReady } from "./fixtures/gateway.js";

test.describe("parity category 3 - cost and telemetry", () => {
  test("keeps telemetry out of persistent chrome and records cost evidence in Activity", async ({ page }) => {
    await page.goto("/");
    await waitForGuiReady(page);

    const composer = page.locator("#composer-input");
    await expect(composer).toBeEnabled({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Details" })).toHaveCount(0);
    await expect(page.getByText("field [idle]")).toHaveCount(0);
    const providerStatus = page.locator('button[aria-label^="Provider selector."]');
    await providerStatus.click();
    await expect(page.getByRole("option", { name: "Codex, No model selection" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(providerStatus).toHaveAttribute("aria-label", /Provider selector/, { timeout: 2_000 });

    await composer.fill("collect telemetry evidence");
    await composer.press("Enter");

    await expect(page.locator('[data-role="assistant"]').last()).toContainText("Reply", { timeout: 5_000 });

    await page.getByRole("button", { name: "Activity" }).click();
    await page.getByRole("button", { name: /Cost updated/u }).click();
    const detail = page.getByRole("region", { name: "Selected activity detail" });
    await expect(detail).toContainText("Input tokens", { timeout: 5_000 });
    await expect(detail).toContainText("Output tokens");
  });
});
