import { expect, test, waitForGuiReady } from "./fixtures/gateway.js";

test.describe("parity category 11 - execution target wizard", () => {
  test("previews and explicitly approves a discovered model from Settings > Models", async ({ page, operatorToken }) => {
    await page.goto(`/#operatorToken=${encodeURIComponent(operatorToken)}`);
    await waitForGuiReady(page);

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Models" }).click();
    await expect(page).toHaveURL(/\/settings\/models(?:\?.*)?$/u);
    await expect(page.getByRole("heading", { name: "Available models" })).toBeVisible();

    await page.getByRole("button", { name: "Add target for codex-oauth / gpt-5.6-terra" }).click();
    const wizard = page.getByRole("dialog");
    await wizard.getByLabel("Target label (optional)").fill("Parity Terra");
    await wizard.getByLabel("Maximum data classification").selectOption("internal");
    await wizard.getByLabel(/I accept conservative data handling for internal data/u).check();
    await wizard.getByRole("button", { name: "Review target" }).click();

    await expect(wizard.getByRole("heading", { name: "Review target" })).toBeVisible();
    await expect(wizard.getByText("Parity Terra", { exact: true })).toBeVisible();
    await expect(wizard.getByText("Expands write authority")).toBeVisible();
    await wizard.getByText("Advanced proposal details").click();
    await expect(wizard.getByText("next-session", { exact: true })).toBeVisible();
    await wizard.getByRole("button", { name: "Approve and create target" }).click();

    await expect(wizard).toBeHidden();
    await expect(page.getByRole("status")).toContainText("Execution target created.");
    await expect(page.getByText("Configured targets: Parity Terra")).toBeVisible();
  });
});
