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

  test("launches ready, streams a turn, clears, resumes, toggles plan, and disconnects on close", async ({ page, gatewayPort }) => {
    await page.goto("/");

    const composer = page.locator("#composer-input");
    await expect(composer).toBeEnabled({ timeout: 3_000 });

    await composer.fill("first turn");
    await composer.press("Enter");

    const assistant = page.locator('[data-role="assistant"]').first();
    await expect(assistant).toContainText("Reply", { timeout: 5_000 });
    await expect(assistant).toContainText("users:1", { timeout: 5_000 });

    await page.getByRole("button", { name: "New Session" }).click();
    await expect(page.getByText("Start a conversation to see the transcript.")).toBeVisible({ timeout: 5_000 });

    await page.getByText("Summarize parity checklist").click();
    await page.getByRole("button", { name: "Resume Session" }).click();
    await expect.poll(async () => page.evaluate(() => localStorage.getItem("kiln.gui.resume.claude"))).not.toBeNull();

    await page.getByRole("button", { name: "Plan" }).click();
    await expect(page.getByText("Plan mode")).toBeVisible();

    await page.getByRole("button", { name: "Plan" }).click();
    const sentFrames = await page.evaluate(() => {
      return (window as unknown as { __kilnSentFrames: Array<{ type?: string }> }).__kilnSentFrames;
    });
    expect(sentFrames.some((frame) => frame.type === "exec")).toBe(true);

    const before = await fetch(`http://localhost:${gatewayPort}/health`).then((response) => response.json() as Promise<{ connections?: number }>);
    expect((before.connections ?? 0) >= 1).toBe(true);

    await page.close();

    await expect.poll(async () => {
      const payload = await fetch(`http://localhost:${gatewayPort}/health`).then((response) => response.json() as Promise<{ connections?: number }>);
      return payload.connections ?? 0;
    }, { timeout: 5_000 }).toBe(0);
  });
});
