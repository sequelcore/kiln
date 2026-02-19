import type { Hono } from "hono";
import type { UpgradeWebSocket, WSContext, WSMessageReceive } from "hono/ws";
import type { SessionState } from "../session-state.js";

export function registerWsRoutes(
  app: Hono,
  state: SessionState,
  upgradeWebSocket: UpgradeWebSocket,
): void {
  app.get(
    "/ws",
    upgradeWebSocket((_c) => ({
      onOpen(_evt: Event, ws: WSContext) {
        state.addClient(ws);
        const snapshot = state.snapshot();
        ws.send(JSON.stringify({ type: "snapshot", data: snapshot }));
      },

      onMessage(evt: MessageEvent<WSMessageReceive>, ws: WSContext) {
        let msg: { type?: string };
        try {
          msg = JSON.parse(String(evt.data)) as { type?: string };
        } catch {
          return;
        }

        switch (msg.type) {
          case "ping":
            ws.send(JSON.stringify({ type: "pong", data: null }));
            break;

          case "start_session": {
            const payload = msg as {
              task?: string;
              flags?: { apiKey?: string; provider?: string };
            };
            if (payload.task) {
              try {
                state.startSession(payload.task, payload.flags);
              } catch (err) {
                const message =
                  err instanceof Error ? err.message : "Failed to start session";
                ws.send(JSON.stringify({ type: "error", message }));
              }
            }
            break;
          }

          case "stop_session":
            state.stopSession();
            break;
        }
      },

      onClose(_evt: CloseEvent, ws: WSContext) {
        state.removeClient(ws);
      },
    })),
  );
}
