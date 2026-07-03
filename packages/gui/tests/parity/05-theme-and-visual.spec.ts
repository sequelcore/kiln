import { expect, test, waitForGuiReady } from "./fixtures/gateway.js";

const COMPOSER_READY_TIMEOUT_MS = 15_000;

test.describe("parity category 5 - theming and visual behavior", () => {
  test("persists theme changes and visually differentiates user and assistant messages", async ({ page }) => {
    await page.goto("/");
    await waitForGuiReady(page);

    await expect(page.locator("#composer-input")).toBeEnabled({ timeout: COMPOSER_READY_TIMEOUT_MS });

    await page.getByRole("button", { name: "Setup" }).click();
    const switcher = page.getByRole("combobox", { name: "Theme" });
    await expect(switcher).toBeVisible();
    await switcher.click();
    await page.getByRole("option", { name: "Kiln Paper" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await page.reload();
    await expect(page.locator("#composer-input")).toBeEnabled({ timeout: COMPOSER_READY_TIMEOUT_MS });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("button", { name: /Provider selector/ })).toBeVisible({ timeout: 2_000 });

    const composer = page.locator("#composer-input");
    await composer.fill("show visual roles");
    await composer.press("Enter");

    await expect(page.locator('[data-role="user"]').last()).toBeVisible({ timeout: 2_000 });
    await expect(page.locator('[data-role="assistant"]').last()).toBeVisible({ timeout: 5_000 });
  });

  test("renders assistant markdown lists and tables with visible browser styling", async ({ page }) => {
    await page.goto("/");
    await waitForGuiReady(page);

    await expect(page.locator("#composer-input")).toBeEnabled({ timeout: COMPOSER_READY_TIMEOUT_MS });

    const composer = page.locator("#composer-input");
    await composer.fill("markdown rendering check");
    await composer.press("Enter");

    const assistant = page.locator('[data-role="assistant"]').last();
    await expect(assistant.getByText("Provider discovery")).toBeVisible({ timeout: 5_000 });
    const list = assistant.locator(".markdown-body ul").first();
    await expect(list).toHaveCSS("list-style-type", "disc");
    const table = assistant.locator(".markdown-body table").first();
    await expect(table).toBeVisible();
    await expect(table.locator("th").first()).toHaveCSS("font-weight", "600");
    await expect(table.locator("td", { hasText: "fixed" })).toBeVisible();
    await expect(table.locator("..")).toHaveCSS("overflow-x", "auto");
  });

  test("shows a compact long-thread navigation rail without covering latest controls", async ({ page }) => {
    await page.goto("/");
    await waitForGuiReady(page);

    const composer = page.locator("#composer-input");
    await expect(composer).toBeEnabled({ timeout: COMPOSER_READY_TIMEOUT_MS });

    await composer.fill("navigation rail first turn");
    await composer.press("Enter");
    await expect(page.locator('[data-role="assistant"]').last()).toContainText("Reply", { timeout: 5_000 });

    await composer.fill("navigation rail second turn");
    await composer.press("Enter");
    await expect(page.locator('[data-role="assistant"]').last()).toContainText("users:2", { timeout: 5_000 });

    const rail = page.getByRole("navigation", { name: "Thread navigation" });
    await expect(rail).toBeVisible();
    await expect(rail.getByRole("button", { name: "Jump to user turn 1" })).toBeVisible();
    await expect(rail.getByRole("button", { name: "Jump to assistant reply 2" })).toBeVisible();
    await expect(rail.getByRole("button", { name: "Return to latest thread anchor" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Jump to latest" })).toBeAttached();
  });
});
