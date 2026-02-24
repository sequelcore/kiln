import { Hono } from "hono";
import type { UpgradeWebSocket, WSContext } from "hono/ws";
import type { WebChannel } from "../channels/web-channel.js";
import type { IncomingMessage } from "@kilnai/core";

export interface WsRoutesConfig {
  readonly webChannel: WebChannel;
  readonly upgradeWebSocket: UpgradeWebSocket;
}

export function createWsRoutes(config: WsRoutesConfig): Hono {
  const app = new Hono();

  app.get(
    "/ws",
    config.upgradeWebSocket((c) => {
      // Prefer sessionId param; fall back to userId; generate one if absent
      const sessionId =
        c.req.query("sessionId") ??
        c.req.query("userId") ??
        crypto.randomUUID();

      return {
        onOpen(_event: Event, ws: WSContext) {
          config.webChannel.addClient(ws, sessionId);
        },
        onClose(_event: CloseEvent, ws: WSContext) {
          config.webChannel.removeClient(ws);
        },
        async onMessage(event: MessageEvent, _ws: WSContext) {
          try {
            const raw = event.data;
            const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw as ArrayBuffer);
            const parsed = JSON.parse(text) as IncomingMessage;
            await config.webChannel.receive(parsed);
          } catch {
            // Discard malformed messages
          }
        },
      };
    }),
  );

  return app;
}
