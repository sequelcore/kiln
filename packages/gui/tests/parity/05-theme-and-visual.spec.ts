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

    const assistant = page.locator('[data-role="assistant"]', { hasText: "Provider discovery" });
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
    await expect(page.locator('[data-role="assistant"]', { hasText: "Reply" })).toBeVisible({ timeout: 5_000 });

    await composer.fill("navigation rail second turn");
    await composer.press("Enter");
    await expect(page.locator('[data-role="assistant"]', { hasText: "users:2" })).toBeVisible({ timeout: 5_000 });

    const rail = page.getByRole("navigation", { name: "Thread navigation" });
    await expect(rail).toBeVisible();
    await expect(rail.getByRole("button", { name: "Jump to user turn 1" })).toBeVisible();
    await expect(rail.getByRole("button", { name: "Jump to assistant reply 2" })).toBeVisible();
    await expect(rail.getByRole("button", { name: "Return to latest thread anchor" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Jump to latest" })).toBeAttached();
    const currentAnchors = rail.locator('[aria-current="location"]');
    await expect(currentAnchors).toHaveCount(1);
    await expect(currentAnchors).toHaveAttribute("aria-label", "Jump to user turn 1");

    await page.getByLabel("Transcript").evaluate((viewport) => {
      let scrollTop = viewport.scrollTop;
      Object.defineProperty(viewport, "scrollTop", {
        configurable: true,
        get: () => scrollTop,
        set: (top: number) => {
          scrollTop = top;
          (window as unknown as { __kilnScrollTop?: number }).__kilnScrollTop = top;
        },
      });
      viewport.scrollTo = (optionsOrX: ScrollToOptions | number, y?: number) => {
        const top = typeof optionsOrX === "number" ? y ?? 0 : optionsOrX.top ?? 0;
        (window as unknown as { __kilnScrollTop?: number }).__kilnScrollTop = top;
        viewport.scrollTop = top;
      };
    });
    const firstTurn = rail.getByRole("button", { name: "Jump to user turn 1" });
    const distantTurn = rail.getByRole("button", { name: "Jump to assistant reply 4" });
    await distantTurn.hover();
    await expect(rail).toHaveAttribute("data-expanded", "true");
    await expect(distantTurn).toHaveAttribute("data-selected", "true");
    await expect(distantTurn.locator('[data-role="thread-anchor-preview"]')).toBeVisible();
    await expect(distantTurn.locator('[data-role="thread-anchor-preview"]')).toContainText("Reply");
    const selectedWidth = await distantTurn.locator(".thread-navigation-mark").evaluate((element) => element.getBoundingClientRect().width);
    const currentWidth = await firstTurn.locator(".thread-navigation-mark").evaluate((element) => element.getBoundingClientRect().width);
    expect(selectedWidth).toBeGreaterThan(currentWidth);
    await expect(distantTurn.locator(".thread-navigation-mark")).toHaveCSS("opacity", "1");
    const currentBackground = await currentAnchors.locator(".thread-navigation-mark").evaluate((element) => (
      getComputedStyle(element).backgroundColor
    ));
    const hoveredBackground = await distantTurn.locator(".thread-navigation-mark").evaluate((element) => (
      getComputedStyle(element).backgroundColor
    ));
    expect(hoveredBackground).not.toBe(currentBackground);

    await firstTurn.focus();
    await page.keyboard.press("Enter");
    await expect.poll(async () => page.evaluate(() => (
      (window as unknown as { __kilnScrollTop?: number }).__kilnScrollTop
    ))).toEqual(expect.any(Number));
    await page.evaluate(() => {
      delete (window as unknown as { __kilnScrollTop?: number }).__kilnScrollTop;
    });
    await rail.getByRole("button", { name: "Jump to assistant reply 2" }).click();
    await expect.poll(async () => page.evaluate(() => (
      (window as unknown as { __kilnScrollTop?: number }).__kilnScrollTop
    ))).toEqual(expect.any(Number));

    await page.setViewportSize({ width: 560, height: 760 });
    await expect(rail).toBeHidden();
  });

  test("keeps concurrent tool executions distinct and reduced-motion safe", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await waitForGuiReady(page);

    const composer = page.locator("#composer-input");
    await composer.fill("tool continuity browser check");
    await composer.press("Enter");

    const liveActivityBeam = page.locator('[data-role="live-activity-beam"]');
    await expect(liveActivityBeam).toBeVisible();
    expect(await liveActivityBeam.evaluate((element) => (
      [element, ...Array.from(element.querySelectorAll("*"))]
        .every((candidate) => getComputedStyle(candidate).animationName === "none")
    ))).toBe(true);

    const runningRows = page.locator('[data-role="tool-event"][data-state="running"]');
    await expect(runningRows).toHaveCount(2, { timeout: 5_000 });
    const activeBeams = page.locator('[data-role="active-tool-beam"]');
    await expect(activeBeams).toHaveCount(0);
    expect(await runningRows.evaluateAll((elements) => elements.every((element) => {
      return [element, ...Array.from(element.querySelectorAll("*"))]
        .every((candidate) => getComputedStyle(candidate).animationName === "none");
    }))).toBe(true);

    const completedRow = page.locator('[data-role="tool-event"][data-state="complete"]');
    const failedRow = page.locator('[data-role="tool-event"][data-state="error"]');
    await expect(completedRow).toHaveCount(1, { timeout: 5_000 });
    await expect(failedRow).toHaveCount(1, { timeout: 5_000 });
    await expect(completedRow).toContainText("First tool result");
    await expect(failedRow).toContainText("Second tool failed");
  });
});
