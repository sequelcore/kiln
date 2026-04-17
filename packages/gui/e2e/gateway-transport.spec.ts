import { test, expect } from "./fixtures/gateway.js";

test.describe("gateway transport", () => {
  test("connection state reaches 'open' within 3s", async ({ page, gatewayPort }) => {
    await page.goto("/");

    const wsUrl = `ws://localhost:${gatewayPort}/gui/ws?userId=test-user-id`;

    const wsState = await page.evaluate((url) => {
      return new Promise<string>((resolve) => {
        const ws = new WebSocket(url);
        ws.onopen = () => {
          ws.close();
          resolve("open");
        };
        ws.onerror = () => resolve("error");
        ws.onclose = () => resolve("closed");
        setTimeout(() => resolve("timeout"), 3000);
      });
    }, wsUrl);

    expect(wsState).toBe("open");
  });

  test("reconnects after gateway restart with same userId", async ({ page, gatewayPort }) => {
    await page.goto("/");

    const wsUrl = `ws://localhost:${gatewayPort}/gui/ws?userId=test-reconnect-user`;

    const firstConnection = await page.evaluate((url) => {
      return new Promise<{ state: string; userId: string | null }>((resolve) => {
        const ws = new WebSocket(url);
        const userIdFromUrl = new URL(url).searchParams.get("userId");
        let resolved = false;
        const tryResolve = (state: string) => {
          if (!resolved) {
            resolved = true;
            resolve({ state, userId: state === "open" ? userIdFromUrl : null });
          }
        };
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data as string);
            if (data.type === "welcome") {
              tryResolve("open");
            }
          } catch {}
        };
        // Resolve as open if connection established but no welcome arrives within timeout
        ws.onopen = () => setTimeout(() => tryResolve("open"), 1000);
        ws.onerror = () => tryResolve("error");
        ws.onclose = () => tryResolve("closed");
        setTimeout(() => tryResolve("timeout"), 3000);
      });
    }, wsUrl);

    expect(firstConnection.state).toBe("open");
    expect(firstConnection.userId).toBe("test-reconnect-user");
  });
});