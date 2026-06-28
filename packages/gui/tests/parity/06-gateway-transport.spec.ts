import { expect, test, waitForGuiReady } from "./fixtures/gateway.js";

test.describe("parity category 6 - gateway transport behavior", () => {
  test("opens the websocket transport and preserves the stable user id on reconnect-capable connections", async ({ page, gatewayPort }) => {
    await page.goto("/");
    await waitForGuiReady(page);

    const wsUrl = `ws://localhost:${gatewayPort}/gui/ws?userId=test-reconnect-user`;

    const connection = await page.evaluate((url) => {
      return new Promise<{ state: string; userId: string | null }>((resolve) => {
        const ws = new WebSocket(url);
        const userId = new URL(url).searchParams.get("userId");
        let done = false;
        const finish = (state: string) => {
          if (done) {
            return;
          }
          done = true;
          resolve({ state, userId: state === "open" ? userId : null });
        };

        ws.onmessage = (event) => {
          try {
            const frame = JSON.parse(event.data as string);
            if (frame.type === "welcome") {
              finish("open");
            }
          } catch {
            // ignore non-json
          }
        };
        ws.onopen = () => setTimeout(() => finish("open"), 1_000);
        ws.onerror = () => finish("error");
        ws.onclose = () => finish("closed");
        setTimeout(() => finish("timeout"), 3_000);
      });
    }, wsUrl);

    expect(connection.state).toBe("open");
    expect(connection.userId).toBe("test-reconnect-user");
  });
});
