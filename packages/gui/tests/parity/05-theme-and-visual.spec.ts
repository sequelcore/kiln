import { expect, test, waitForGuiReady } from "./fixtures/gateway.js";

const COMPOSER_READY_TIMEOUT_MS = 15_000;

test.describe("parity category 5 - theming and visual behavior", () => {
  test("persists theme changes and visually differentiates user and assistant messages", async ({ page }) => {
    await page.goto("/");
    await waitForGuiReady(page);

    await expect(page.locator("#composer-input")).toBeEnabled({ timeout: COMPOSER_READY_TIMEOUT_MS });
    const composerSurface = page.locator('[data-composer-surface="message"]');
    await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
    await expect(composerSurface).toHaveCSS("opacity", "1");

    await page.getByRole("button", { name: "Setup" }).click();
    const switcher = page.getByRole("combobox", { name: "Theme" });
    await expect(switcher).toBeVisible();

    await switcher.click();
    await page.getByRole("option", { name: "Kiln Obsidian" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-kiln-theme", "kiln-dark");
    const obsidianCanvas = await page.locator("html").evaluate((root) => (
      getComputedStyle(root).getPropertyValue("--color-background").trim()
    ));

    await switcher.click();
    await page.getByRole("option", { name: "Kiln Graphite" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-kiln-theme", "kiln-graphite");
    const graphiteCanvas = await page.locator("html").evaluate((root) => (
      getComputedStyle(root).getPropertyValue("--color-background").trim()
    ));
    expect(graphiteCanvas).not.toBe(obsidianCanvas);

    await switcher.click();
    await page.getByRole("option", { name: "Kiln Paper" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator("html")).toHaveAttribute("data-kiln-theme", "kiln-light");

    await page.reload();
    await expect(page.locator("#composer-input")).toBeEnabled({ timeout: COMPOSER_READY_TIMEOUT_MS });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("button", { name: /Provider selector/ })).toBeVisible({ timeout: 2_000 });
    const visualRoles = await page.locator("html").evaluate((root) => {
      const style = getComputedStyle(root);
      return {
        assistant: style.getPropertyValue("--color-assistant-bg").trim(),
        user: style.getPropertyValue("--color-user-bg").trim(),
      };
    });
    expect(visualRoles.user).not.toBe(visualRoles.assistant);
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
    await expect(currentAnchors).toHaveAttribute("aria-label", "Jump to assistant reply 2");

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
    await page.goto("/");
    await waitForGuiReady(page);

    const composer = page.locator("#composer-input");
    await composer.fill("tool continuity browser check");
    await composer.press("Enter");

    const composerActivityBeam = page.locator('[data-role="composer-activity-beam"]');
    await expect(composerActivityBeam).toBeVisible();
    await expect(composerActivityBeam).toHaveAttribute("data-beam-motion", "pulse");
    await expect(composerActivityBeam).toHaveAttribute("data-beam-palette", "colorful");
    await expect(composerActivityBeam).toHaveAttribute("data-beam-theme", "dark");
    await expect(page.locator('[data-role="live-activity-label"]')).toHaveCount(0);
    await expect(page.locator('[aria-label="Transcript"] [aria-label="Streaming"]')).toHaveCount(0);
    await expect(page.locator('[aria-label="Transcript"] [role="status"]')).toHaveCount(0);
    await expect.poll(async () => composerActivityBeam.evaluate((element) => (
      Number.parseFloat(getComputedStyle(element, "::after").opacity)
    ))).toBeGreaterThan(0.2);

    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await composerActivityBeam.evaluate((element) => (
      [element, ...Array.from(element.querySelectorAll("*"))]
        .every((candidate) => getComputedStyle(candidate).animationName === "none")
    ))).toBe(true);

    const activeBeams = page.locator('[data-role="active-tool-beam"]');
    await expect(activeBeams).toHaveCount(0);

    const actionGroup = page.getByRole("button", { name: "2 actions. Show actions" });
    await expect(actionGroup).toBeVisible({ timeout: 5_000 });
    await actionGroup.click();

    const completedRow = page.locator('[data-slot="ai-tool"][data-state="completed"]');
    const failedRow = page.locator('[data-slot="ai-tool"][data-state="failed"]');
    await expect(completedRow).toHaveCount(1, { timeout: 5_000 });
    await expect(failedRow).toHaveCount(1, { timeout: 5_000 });
    await expect(completedRow).toContainText("First tool result");
    await expect(failedRow).toContainText("Second tool failed");
  });

  test("renders paused work item execution as a bounded task instead of JSON", async ({ page }) => {
    await page.goto("/");
    await waitForGuiReady(page);

    const composer = page.locator("#composer-input");
    await expect(composer).toBeEnabled({ timeout: COMPOSER_READY_TIMEOUT_MS });
    await composer.fill("paused work item visual check");
    await composer.press("Enter");

    const header = page.getByRole("button", { name: /Execution paused\. Paused\. inspect-composer-activity-ownership/u });
    await expect(header).toBeVisible({ timeout: 15_000 });
    const task = page.locator('[data-role="workflow-activity"]');
    await expect(task).toBeVisible();
    await expect(task).toHaveAttribute("data-status", "paused");
    await expect(task.getByText("inspect-composer-activity-ownership", { exact: true })).toHaveCount(1);
    await expect(task).toContainText("managedInvocationId is required before starting managed-delegation execution.");
    await expect(task.getByRole("progressbar", { name: "Evidence completion for inspect-composer-activity-ownership" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Text output" })).toHaveCount(0);
    await expect(page.getByLabel("JSON output")).toHaveCount(0);
    const transcriptRows = page.locator('[data-slot="message-scroller-item"]');
    await expect(transcriptRows.first()).toContainText("paused work item visual check");

    const transcriptBounds = await page.getByLabel("Transcript").boundingBox();
    const messageSurfaceBounds = await transcriptRows.first().locator('[data-slot="transcript-surface"]').boundingBox();
    const taskBounds = await task.boundingBox();
    expect(transcriptBounds).not.toBeNull();
    expect(messageSurfaceBounds).not.toBeNull();
    expect(taskBounds).not.toBeNull();
    expect(taskBounds!.x).toBeGreaterThanOrEqual(transcriptBounds!.x);
    expect(taskBounds!.x + taskBounds!.width).toBeLessThanOrEqual(transcriptBounds!.x + transcriptBounds!.width);
    expect(taskBounds!.width).toBeLessThanOrEqual(messageSurfaceBounds!.width);
    await expect.poll(async () => page.getByLabel("Transcript").evaluate((element) => (
      element.scrollWidth <= element.clientWidth
    ))).toBe(true);

    await page.setViewportSize({ width: 900, height: 720 });
    const compactMessageBounds = await transcriptRows.first().locator('[data-slot="transcript-surface"]').boundingBox();
    const compactTaskBounds = await task.boundingBox();
    expect(compactMessageBounds).not.toBeNull();
    expect(compactTaskBounds).not.toBeNull();
    expect(compactTaskBounds!.x).toBeGreaterThanOrEqual(compactMessageBounds!.x);
    expect(compactTaskBounds!.x + compactTaskBounds!.width)
      .toBeLessThanOrEqual(compactMessageBounds!.x + compactMessageBounds!.width);
    await expect.poll(async () => page.getByLabel("Transcript").evaluate((element) => (
      element.scrollWidth <= element.clientWidth
    ))).toBe(true);
    const colors = await task.evaluate((element) => {
      const style = getComputedStyle(element);
      return { color: style.color, backgroundColor: style.backgroundColor };
    });
    expect(colors.color).not.toBe(colors.backgroundColor);
  });

  test("renders structured tool errors as diagnostics inside the shared Tool anatomy", async ({ page }) => {
    await page.goto("/");
    await waitForGuiReady(page);

    const composer = page.locator("#composer-input");
    await expect(composer).toBeEnabled({ timeout: COMPOSER_READY_TIMEOUT_MS });
    await composer.fill("structured diagnostic visual check");
    await composer.press("Enter");

    const header = page.getByRole("button", { name: /goal\.create\. Failed\./u });
    await expect(header).toBeVisible({ timeout: 15_000 });
    const tool = header.locator("..");
    await expect(tool).toHaveAttribute("data-slot", "ai-tool");
    await expect(tool).toHaveAttribute("data-state", "failed");
    await expect(header).toContainText("goal.create");
    await expect(tool.locator('[data-slot="ai-tool-status"]')).toHaveText("Failed");
    if (await header.getAttribute("aria-expanded") !== "true") {
      await header.click();
    }

    await expect(tool.getByRole("alert")).toContainText("Invalid input");
    await expect(tool.getByRole("alert")).toContainText("goal.create cannot combine preferredRouteId and managedAgentProfile.");
    await expect(tool.getByRole("alert")).toContainText("objective");
    await expect(tool.getByRole("alert")).toContainText("existing work item id[]");
    await expect(tool.getByLabel("JSON output")).toHaveCount(0);
    await expect(tool.getByRole("region", { name: "Text output" })).toHaveCount(0);
  });

  test("renders governed tool results as work, goal, task, and diagnostic UI", async ({ page }) => {
    await page.goto("/");
    await waitForGuiReady(page);

    const composer = page.locator("#composer-input");
    await expect(composer).toBeEnabled({ timeout: COMPOSER_READY_TIMEOUT_MS });
    await composer.fill("governed tool presentation visual check");
    await composer.press("Enter");

    const goal = page.locator('[data-role="workflow-activity"]');
    await expect(goal).toHaveCount(1, { timeout: 15_000 });
    await expect(goal.getByRole("button", { name: /Perform evidence-backed UX verification\..*1 work items/u })).toBeVisible();
    await expect(goal.getByRole("list", { name: "Goal work items" })).toContainText("Inspect composer activity ownership.");
    await expect(goal).toContainText("1 / 2");
    await expect(goal.getByRole("progressbar", { name: "Evidence completion for work-1" })).toBeVisible();
    await expect(page.getByRole("button", { name: /work_item\.(?:update|execution\.start)/u })).toHaveCount(0);

    const readHeader = page.getByRole("button", { name: /read\. Failed\./u });
    await expect(readHeader).toBeVisible();
    const readTool = readHeader.locator("..");
    await expect(readTool.getByRole("alert")).toContainText("Read failed");
    await expect(readTool.getByRole("alert")).toContainText("ENOENT");
    await expect(readTool.getByRole("alert")).toContainText("C:\\repo\\missing.ts");

    await expect(page.getByRole("region", { name: "Text output" })).toHaveCount(0);
    await expect(page.getByLabel("JSON output")).toHaveCount(0);
  });
});
