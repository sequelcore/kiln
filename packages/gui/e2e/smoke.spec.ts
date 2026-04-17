import { test, expect } from "./fixtures/gateway.js";

test.describe("GUI smoke", () => {
  test("landing route renders with gateway health status", async ({ page, gatewayPort: _ }) => {
    // gatewayPort fixture boots a real gui-gateway subprocess before this test runs.
    // Vite proxies /gui-api to that gateway port via GUI_GATEWAY_PORT.

    await page.goto("/");

    // Page title text is visible
    await expect(page.getByRole("heading", { name: "Kiln" })).toBeVisible();

    // Gateway health status is rendered — the hook fetches /gui-api/health and
    // renders data.status ("ok") as a visible span.
    await expect(page.getByText("ok")).toBeVisible({ timeout: 10_000 });

    // Accessibility: <main> landmark must exist
    await expect(page.locator("main")).toBeVisible();
  });
});
