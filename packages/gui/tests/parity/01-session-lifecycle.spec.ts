import { expect, test } from "./fixtures/gateway.js";

test.describe("parity category 1 - session lifecycle", () => {
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
            // ignore heartbeat frames
          }
        }
        return originalSend.call(this, data);
      };
    });
  });

  test("launches ready, streams a turn, clears, continues selected session, toggles plan, and disconnects on close", async ({ page, gatewayPort }) => {
    await page.goto("/");

    const composer = page.locator("#composer-input");
    await expect(composer).toBeEnabled({ timeout: 5_000 });

    await composer.fill("first turn");
    await composer.press("Enter");

    const assistant = page.locator('[data-role="assistant"]').first();
    await expect(assistant).toContainText("Reply", { timeout: 5_000 });
    await expect(assistant).toContainText("users:1", { timeout: 5_000 });

    await page.getByRole("button", { name: "New Session" }).click();
    await expect(page.getByLabel("Transcript").locator('[data-role="user"]')).toHaveCount(0, { timeout: 5_000 });

    await page.getByRole("option", { name: /Summarize parity checklist/ }).click();
    await expect
      .poll(async () => page.evaluate(() => localStorage.getItem("kiln.gui.continuationTarget")))
      .toBeNull();

    await composer.fill("continue selected parity thread");
    await composer.press("Enter");
    await expect(page.locator('[data-role="assistant"]').last()).toContainText("Reply", { timeout: 5_000 });

    const continuationFrames = await page.evaluate(() => {
      return (window as unknown as { __kilnSentFrames: Array<{ type?: string; content?: string; continuationSessionId?: string; sessionIntent?: string }> })
        .__kilnSentFrames
        .filter((frame) => frame.type === "message");
    });
    const continuationFrame = continuationFrames.find((frame) => frame.content === "continue selected parity thread");
    expect(continuationFrame?.continuationSessionId).toBeTruthy();
    expect(continuationFrame?.sessionIntent).toBeUndefined();

    await page.getByRole("button", { name: "Plan" }).click();
    await expect(page.getByRole("button", { name: "Plan" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Plan" }).click();
    const sentFrames = await page.evaluate(() => {
      return (window as unknown as { __kilnSentFrames: Array<{ type?: string }> }).__kilnSentFrames;
    });
    expect(sentFrames.some((frame) => frame.type === "execution_mode_transition")).toBe(true);

    const before = await fetch(`http://localhost:${gatewayPort}/health`).then((response) => response.json() as Promise<{ connections?: number }>);
    expect((before.connections ?? 0) >= 1).toBe(true);

    await page.close();

    await expect.poll(async () => {
      const payload = await fetch(`http://localhost:${gatewayPort}/health`).then((response) => response.json() as Promise<{ connections?: number }>);
      return payload.connections ?? 0;
    }, { timeout: 5_000 }).toBe(0);
  });

  test("sends a fresh session boundary after New Session instead of resuming the previous live turn", async ({ page }) => {
    await page.goto("/");

    const composer = page.locator("#composer-input");
    await expect(composer).toBeEnabled({ timeout: 5_000 });

    await composer.fill("first turn");
    await composer.press("Enter");
    await expect(page.locator('[data-role="assistant"]').first()).toContainText("Reply", { timeout: 5_000 });

    await page.getByRole("button", { name: "New Session" }).click();
    await expect(page.getByLabel("Transcript").locator('[data-role="user"]')).toHaveCount(0, { timeout: 5_000 });

    await composer.fill("fresh turn");
    await composer.press("Enter");
    await expect(page.locator('[data-role="assistant"]').first()).toContainText("Reply", { timeout: 5_000 });

    const messageFrames = await page.evaluate(() => {
      return (window as unknown as { __kilnSentFrames: Array<{ type?: string; content?: string; sessionIntent?: string; continuationSessionId?: string }> })
        .__kilnSentFrames
        .filter((frame) => frame.type === "message");
    });
    const freshFrame = messageFrames.find((frame) => frame.content === "fresh turn");
    expect(freshFrame).toMatchObject({ sessionIntent: "fresh" });
    expect(freshFrame?.continuationSessionId).toBeUndefined();
  });
});
