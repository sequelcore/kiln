import { Hono } from "hono";
import type { UpgradeWebSocket, WSContext } from "hono/ws";
import type { WebChannel } from "../channels/web-channel.js";
import type { ArtifactResourceStore, ContentPart, IncomingMessage } from "@kilnai/core";
import type { OperatorTurnRequestedAuthority } from "@kilnai/gateway-contracts";
import { textParts, extractText } from "@kilnai/core";
import { createGenericMediaDownloader } from "./audio-preprocessor.js";
import { captureMultimodalArtifacts } from "./multimodal-artifact-ingestion.js";

export interface WsRoutesConfig {
  readonly webChannel: WebChannel;
  readonly upgradeWebSocket: UpgradeWebSocket;
  readonly validateToken?: (token: string) => { valid: boolean; userId?: string };
  readonly apiKey?: string;
  readonly appName?: string;
  readonly tenantId?: string;
  readonly artifactStore?: ArtifactResourceStore;
  readonly processMessage?: (userId: string, parts: readonly ContentPart[], options?: {
    readonly requestedAuthority?: OperatorTurnRequestedAuthority;
  }) => Promise<{
    parts: readonly ContentPart[];
    inputTokens: number;
    outputTokens: number;
  }>;
}

export function createWsRoutes(config: WsRoutesConfig): Hono {
  const app = new Hono();

  /**
   * Per-request validated userId, scoped by token to avoid module-level mutable state.
   * Entries are consumed (deleted) immediately in the upgrade handler, so concurrent
   * requests with different tokens never collide.
   */
  const validatedUserIds = new Map<string, string>();

  app.get(
    "/ws",
    async (c, next) => {
      if (config.validateToken) {
        const token = c.req.query("token");
        if (!token) return c.text("Unauthorized", 401);
        const result = config.validateToken(token);
        if (!result.valid) return c.text("Unauthorized", 401);
        if (result.userId) {
          validatedUserIds.set(token, result.userId);
        }
      } else if (config.apiKey) {
        const key = c.req.query("apiKey");
        if (!key || key !== config.apiKey) return c.text("Unauthorized", 401);
      }
      await next();
    },
    config.upgradeWebSocket((c) => {
      const token = c.req.query("token");
      const validatedUserId = token ? validatedUserIds.get(token) : undefined;
      if (token) validatedUserIds.delete(token);

      const userId =
        validatedUserId ??
        c.req.query("sessionId") ??
        c.req.query("userId") ??
        crypto.randomUUID();

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
              if (!isRequestedAuthority(parsed.requestedAuthority)) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: "requestedAuthority must be auto, read_only, audited, or destructive",
                }));
                return;
              }
              let userParts: readonly ContentPart[] = Array.isArray(parsed.parts)
                ? (parsed.parts as ContentPart[])
                : textParts(String(parsed.content ?? ""));

              try {
                if (config.artifactStore) {
                  userParts = await captureMultimodalArtifacts(userParts, {
                    artifactStore: config.artifactStore,
                    downloader: createGenericMediaDownloader(),
                    sourceKind: "uploaded-file",
                    sourceIdPrefix: `${config.appName ?? "websocket"}:${config.tenantId ?? "_default"}:${userId}:web`,
                    producerName: "gateway-web-ingress",
                  });
                }
                const result = await config.processMessage(userId, userParts, {
                  requestedAuthority: parsed.requestedAuthority,
                });
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

function isRequestedAuthority(value: unknown): value is OperatorTurnRequestedAuthority | undefined {
  return value === undefined
    || value === "auto"
    || value === "read_only"
    || value === "audited"
    || value === "destructive";
}
