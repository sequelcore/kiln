import { expect, test } from "./fixtures/gateway.js";

test.describe("session lifecycle parity", () => {
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

  test("1.1 launch readiness and 1.2 streaming submit", async ({ page }) => {
    await page.goto("/");
    const composer = page.locator("#composer-input");
    await expect(composer).toBeEnabled({ timeout: 3_000 });

    await composer.fill("first turn");
    await composer.press("Enter");

    const assistant = page.locator('[data-role="assistant"]').first();
    await expect(assistant).toContainText("Reply", { timeout: 5_000 });
    const firstLength = (await assistant.textContent())?.length ?? 0;
    await page.waitForTimeout(180);
    const secondLength = (await assistant.textContent())?.length ?? 0;
    expect(secondLength).toBeGreaterThan(firstLength);
  });

  test("1.3 clear empties transcript and clears context", async ({ page }) => {
    await page.goto("/");
    const composer = page.locator("#composer-input");
    await composer.fill("remember this");
    await composer.press("Enter");
    await expect(page.locator('[data-role="assistant"]').first()).toContainText("users:1", { timeout: 5_000 });

    await page.getByRole("button", { name: "New Session" }).click();
    await expect(page.getByText("Start a conversation to see the transcript.")).toBeVisible({ timeout: 5_000 });

    const sentFrames = await page.evaluate(() => {
      return (window as unknown as { __kilnSentFrames: Array<{ type?: string }> }).__kilnSentFrames;
    });
    expect(sentFrames.some((frame) => frame.type === "clear")).toBe(true);

    await composer.fill("after clear");
    await composer.press("Enter");
    await expect(page.locator('[data-role="assistant"]').last()).toContainText("users:1", { timeout: 5_000 });
  });

  test("1.4 session list resume target persists", async ({ page }) => {
    await page.goto("/");
    const sessionItem = page.getByText("Summarize parity checklist");
    await expect(sessionItem).toBeVisible({ timeout: 5_000 });
    await sessionItem.click();
    await page.getByRole("button", { name: "Resume Session" }).click();

    const persisted = await page.evaluate(() => localStorage.getItem("kiln.gui.resume.claude"));
    expect(persisted).toBeTruthy();
  });

  test("1.5 plan mode toggle includes palette and sends exec on disable", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Commands" }).click();
    await page.getByRole("button", { name: "Enable plan mode" }).click();
    await expect(page.getByText("Plan mode")).toBeVisible();

    await page.getByRole("button", { name: "Commands" }).click();
    await page.getByRole("button", { name: "Disable plan mode" }).click();

    const sentFrames = await page.evaluate(() => {
      return (window as unknown as { __kilnSentFrames: Array<{ type?: string }> }).__kilnSentFrames;
    });
    expect(sentFrames.some((frame) => frame.type === "exec")).toBe(true);
  });

  test("1.6 closing page closes ws connection", async ({ page, gatewayPort }) => {
    await page.goto("/");
    await expect(page.locator("#composer-input")).toBeEnabled({ timeout: 3_000 });

    const before = await fetch(`http://localhost:${gatewayPort}/health`).then((response) => response.json() as Promise<{ connections?: number }>);
    expect((before.connections ?? 0) >= 1).toBe(true);

    await page.close();

    await expect.poll(async () => {
      const payload = await fetch(`http://localhost:${gatewayPort}/health`).then((response) => response.json() as Promise<{ connections?: number }>);
      return payload.connections ?? 0;
    }, { timeout: 5_000 }).toBe(0);
  });
});
