import { Hono } from "hono";
import type { UpgradeWebSocket, WSContext } from "hono/ws";
import type { WebChannel } from "../channels/web-channel.js";
import type { IncomingMessage } from "@kilnai/core";

export interface WsRoutesConfig {
  readonly webChannel: WebChannel;
  readonly upgradeWebSocket: UpgradeWebSocket;
  readonly validateToken?: (token: string) => { valid: boolean; userId?: string };
}

export function createWsRoutes(config: WsRoutesConfig): Hono {
  const app = new Hono();

  let validatedUserId: string | undefined;

  app.get(
    "/ws",
    async (c, next) => {
      if (config.validateToken) {
        const token = c.req.query("token");
        if (!token) return c.text("Unauthorized", 401);
        const result = config.validateToken(token);
        if (!result.valid) return c.text("Unauthorized", 401);
        validatedUserId = result.userId;
      }
      await next();
    },
    config.upgradeWebSocket((c) => {
      const sessionId =
        validatedUserId ??
        c.req.query("sessionId") ??
        c.req.query("userId") ??
        crypto.randomUUID();
      validatedUserId = undefined;

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
