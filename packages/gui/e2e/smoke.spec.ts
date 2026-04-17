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
