// Gateway: WS Tenant Routes -- multi-tenant WebSocket endpoint
// Resolves tenant by widgetId, creates per-user sessions, processes chat frames

import { Hono } from "hono";
import type { UpgradeWebSocket, WSContext } from "hono/ws";
import type { WebChannel } from "../channels/web-channel.js";
import type { ContentPart } from "@kilnai/core";
import { textParts, extractText } from "@kilnai/core";
import type { ModeBOrchestrator } from "../session/mode-b-orchestrator.js";
import type { SessionRegistry } from "../session/session-registry.js";
import type { TenantRegistry } from "../tenant/tenant-registry.js";
import { buildTenantSystemPrompt } from "../tenant/system-prompt-builder.js";
import { checkBudget, reportUsage } from "./budget-middleware.js";
import type { BillingConfig } from "./budget-middleware.js";

export interface WsTenantRoutesConfig {
  readonly webChannel: WebChannel;
  readonly upgradeWebSocket: UpgradeWebSocket;
  readonly appName: string;
  readonly orchestrator: ModeBOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  readonly tenantRegistry: TenantRegistry;
  readonly billing?: BillingConfig;
}

export function createWsTenantRoutes(config: WsTenantRoutesConfig): Hono {
  const app = new Hono();

  app.get(
    "/ws",
    async (c, next) => {
      const widgetId = c.req.query("widgetId");
      if (!widgetId) return c.text("widgetId is required", 400);

      const tenant = config.tenantRegistry.resolveByWidgetId(widgetId, config.appName);
      if (!tenant) return c.text("Widget not found", 404);

      await next();
    },
    config.upgradeWebSocket((c) => {
      const widgetId = c.req.query("widgetId")!;
      const tenant = config.tenantRegistry.resolveByWidgetId(widgetId, config.appName)!;

      const userId = c.req.query("userId") ?? crypto.randomUUID();
      const systemPrompt = buildTenantSystemPrompt(tenant);

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

            if (parsed.type === "message") {
              const userParts: readonly ContentPart[] = Array.isArray(parsed.parts)
                ? (parsed.parts as ContentPart[])
                : textParts(String(parsed.content ?? ""));

              // Resolve billing config once: tenant-level takes precedence
              const activeBilling = tenant.billing?.budgetEndpoint
                ? (tenant.billing as unknown as BillingConfig)
                : config.billing;

              try {
                // Budget check
                if (activeBilling) {
                  const budgetResult = await checkBudget(activeBilling, tenant.tenantId);
                  if (!budgetResult.allowed) {
                    ws.send(JSON.stringify({
                      type: "error",
                      message: activeBilling.overBudgetMessage ?? "Budget exhausted.",
                    }));
                    return;
                  }
                }

                const session = config.sessionRegistry.getOrCreate({
                  appName: config.appName,
                  tenantId: tenant.tenantId,
                  userId,
                  systemPrompt,
                  idleTimeoutMs: tenant.idleTimeoutMs,
                });

                const result = await config.orchestrator.processMessage(session, userParts);

                // Report usage (fire-and-forget)
                if (activeBilling) {
                  reportUsage(activeBilling, {
                    tenantId: tenant.tenantId,
                    messages: 1,
                    tokens: result.inputTokens + result.outputTokens,
                    model: config.orchestrator.model ?? "unknown",
                  });
                }

                ws.send(JSON.stringify({
                  type: "done",
                  content: extractText(result.parts),
                  parts: result.parts,
                  inputTokens: result.inputTokens,
                  outputTokens: result.outputTokens,
                }));
              } catch {
                ws.send(JSON.stringify({
                  type: "error",
                  message: "Something went wrong. Please try again.",
                }));
              }
            }
          } catch {
            // Discard malformed messages
          }
        },
      };
    }),
  );

  return app;
}
