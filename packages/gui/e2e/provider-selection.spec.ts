import { expect, test } from "./fixtures/gateway.js";

test.describe("provider and model selection parity", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const sentFrames: unknown[] = [];
      (window as unknown as { __kilnSentFrames: unknown[] }).__kilnSentFrames = sentFrames;
      const originalSend = WebSocket.prototype.send;
      WebSocket.prototype.send = function patchedSend(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        if (typeof data === "string") {
          try {
            sentFrames.push(JSON.parse(data));
          } catch {
            // ignore non-json payloads (heartbeat ping)
          }
        }
        return originalSend.call(this, data);
      };
    });
  });

  test("switches provider via keyboard and click, updates routed headers, and survives clear", async ({ page }) => {
    await page.goto("/");

    const providerStatus = page.getByRole("button", { name: "Current provider. Click to change." });
    await expect(providerStatus).toBeVisible({ timeout: 3_000 });
    const composer = page.locator("#composer-input");
    const composerSection = page.locator("section").filter({ has: composer }).first();

    await page.keyboard.press(process.platform === "darwin" ? "Meta+P" : "Control+P");
    await expect(page.getByRole("dialog", { name: "Switch provider" })).toBeVisible({ timeout: 2_000 });

    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Switch provider" })).toBeHidden({ timeout: 2_000 });
    await expect(providerStatus).toContainText("Codex", { timeout: 2_000 });

    await composer.fill("first provider turn");
    await composer.press("Enter");
    await expect(composer).toHaveValue("", { timeout: 2_000 });
    await expect(page.locator('[data-role="assistant"]').first()).toBeVisible({ timeout: 5_000 });

    const firstRouteLabel = page.locator('[data-role="assistant"] header span:nth-child(2)').first();
    await expect(firstRouteLabel).toContainText("Codex");
    const firstRouteText = (await firstRouteLabel.textContent())?.trim() ?? "";

    await expect(composerSection.getByText("Ready")).toBeVisible({ timeout: 5_000 });
    await providerStatus.click();
    await expect(page.getByRole("dialog", { name: "Switch provider" })).toBeVisible({ timeout: 2_000 });
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await expect(providerStatus).toContainText("Claude", { timeout: 2_000 });

    await expect(composerSection.getByText("Ready")).toBeVisible({ timeout: 5_000 });
    const assistantRows = page.locator('[data-role="assistant"]');
    const assistantCountBeforeSecondTurn = await assistantRows.count();
    await composer.fill("second provider turn");
    await composer.press("Enter");
    await expect(composer).toHaveValue("", { timeout: 2_000 });
    await expect(assistantRows).toHaveCount(assistantCountBeforeSecondTurn + 1, { timeout: 5_000 });

    const secondRouteLabel = page.locator('[data-role="assistant"] header span:nth-child(2)').nth(assistantCountBeforeSecondTurn);
    await expect(secondRouteLabel).toContainText("Claude");
    const secondRouteText = (await secondRouteLabel.textContent())?.trim() ?? "";
    expect(secondRouteText).not.toBe(firstRouteText);

    await expect(composerSection.getByText("Ready")).toBeVisible({ timeout: 5_000 });
    const statusBeforeClear = (await providerStatus.textContent()) ?? "";
    await page.getByRole("button", { name: "Clear" }).click();
    const sentFrames = await page.evaluate(() => {
      return (window as unknown as { __kilnSentFrames: Array<{ type?: string }> }).__kilnSentFrames;
    });
    expect(sentFrames.some((frame) => frame.type === "clear")).toBe(true);
    await expect(providerStatus).toContainText("Claude");
    const statusAfterClear = (await providerStatus.textContent()) ?? "";
    expect(statusAfterClear).toContain("Claude");
    expect(statusBeforeClear).toContain("Claude");
  });
});
