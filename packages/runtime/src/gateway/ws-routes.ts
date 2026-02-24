import { Hono } from "hono";
import type { UpgradeWebSocket, WSContext } from "hono/ws";
import type { WebChannel } from "../channels/web-channel.js";
import type { ContentPart, IncomingMessage } from "@kilnai/core";
import { textParts, extractText } from "@kilnai/core";

export interface WsRoutesConfig {
  readonly webChannel: WebChannel;
  readonly upgradeWebSocket: UpgradeWebSocket;
  readonly validateToken?: (token: string) => { valid: boolean; userId?: string };
  readonly processMessage?: (userId: string, parts: readonly ContentPart[]) => Promise<{
    parts: readonly ContentPart[];
    inputTokens: number;
    outputTokens: number;
  }>;
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
      const userId =
        validatedUserId ??
        c.req.query("sessionId") ??
        c.req.query("userId") ??
        crypto.randomUUID();
      validatedUserId = undefined;

      return {
        onOpen(_event: Event, ws: WSContext) {
          config.webChannel.addClient(ws, userId);
        },
        onClose(_event: CloseEvent, ws: WSContext) {
          config.webChannel.removeClient(ws);
        },
        async onMessage(event: MessageEvent, ws: WSContext) {
          try {
            const raw = event.data;
            const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw as ArrayBuffer);
            const parsed = JSON.parse(text) as Record<string, unknown>;

            // Handle chat message frames via orchestrator
            if (parsed.type === "message" && config.processMessage) {
              const userParts: readonly ContentPart[] = Array.isArray(parsed.parts)
                ? (parsed.parts as ContentPart[])
                : textParts(String(parsed.content ?? ""));

              try {
                const result = await config.processMessage(userId, userParts);
                ws.send(JSON.stringify({
                  type: "done",
                  content: extractText(result.parts),
                  parts: result.parts,
                  inputTokens: result.inputTokens,
                  outputTokens: result.outputTokens,
                }));
              } catch (err) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: err instanceof Error ? err.message : String(err),
                }));
              }
              return;
            }

            // Fall back to webChannel.receive for non-message frames
            await config.webChannel.receive(parsed as unknown as IncomingMessage);
          } catch {
            // Discard malformed messages
          }
        },
      };
    }),
  );

  return app;
}
