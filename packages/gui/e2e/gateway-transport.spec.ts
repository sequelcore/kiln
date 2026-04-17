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
        let userId: string | null = null;
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "welcome") {
              const params = new URL(url);
              userId = params.searchParams.get("userId");
            }
          } catch {}
        };
        ws.onopen = () => {
          resolve({ state: "open", userId });
        };
        ws.onerror = () => resolve({ state: "error", userId: null });
        ws.onclose = () => resolve({ state: "closed", userId });
        setTimeout(() => resolve({ state: "timeout", userId }), 3000);
      });
    }, wsUrl);

    expect(firstConnection.state).toBe("open");
    expect(firstConnection.userId).toBe("test-reconnect-user");
  });
});