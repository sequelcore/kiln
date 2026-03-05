// Gateway: Tenant routes -- Hono sub-app for multi-tenant message processing
// Handles tenant-scoped message processing, session listing, and session removal

import { Hono } from "hono";
import type { ContentPart } from "@kilnai/core";
import { textParts, extractText } from "@kilnai/core";
import type { ModeBOrchestrator } from "../session/mode-b-orchestrator.js";
import type { SessionRegistry } from "../session/session-registry.js";
import type { TenantRegistry } from "../tenant/tenant-registry.js";
import { buildTenantSystemPrompt } from "../tenant/system-prompt-builder.js";
import type { BillingConfig } from "./budget-middleware.js";
import { requireApiKey } from "./auth-middleware.js";
import { processInboundMessage } from "./message-pipeline.js";

/** Runtime configuration for a multi-tenant App */
export interface TenantAppRuntime {
  readonly appName: string;
  readonly orchestrator: ModeBOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  readonly tenantRegistry: TenantRegistry;
  readonly billing?: BillingConfig;
  readonly apiKey?: string;
}

/** Request body for POST /message */
interface TenantMessageRequest {
  readonly message?: string;
  readonly parts?: readonly ContentPart[];
  readonly userId: string;
  readonly tenantId: string;
  readonly plan?: string;
}

export function createTenantRoutes(runtime: TenantAppRuntime): Hono {
  const app = new Hono();

  if (runtime.apiKey) {
    app.use("*", requireApiKey(runtime.apiKey));
  }

  app.post("/message", async (c) => {
    let body: TenantMessageRequest;
    try {
      body = await c.req.json<TenantMessageRequest>();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    // Accept either { message: string } or { parts: ContentPart[] }
    const userParts: readonly ContentPart[] = body.parts && Array.isArray(body.parts)
      ? body.parts
      : (body.message && typeof body.message === "string" ? textParts(body.message) : []);
    if (userParts.length === 0) {
      return c.json({ error: "message or parts is required" }, 400);
    }
    if (!body.userId || typeof body.userId !== "string") {
      return c.json({ error: "userId is required" }, 400);
    }
    if (!body.tenantId || typeof body.tenantId !== "string") {
      return c.json({ error: "tenantId is required" }, 400);
    }

    // Resolve tenant
    const tenant = runtime.tenantRegistry.get(body.tenantId);
    if (!tenant || tenant.appName !== runtime.appName) {
      return c.json({ error: "Tenant not found" }, 404);
    }
    if (!tenant.enabled) {
      return c.json({ error: "Tenant is disabled" }, 403);
    }

    // Resolve billing: tenant-level billing takes precedence
    const billingConfig = tenant.billing?.budgetEndpoint
      ? (tenant.billing as unknown as BillingConfig)
      : runtime.billing;

    // Build system prompt from tenant config
    const systemPrompt = buildTenantSystemPrompt(tenant);

    const processResult = await processInboundMessage({
      orchestrator: runtime.orchestrator,
      sessionRegistry: runtime.sessionRegistry,
      appName: runtime.appName,
      tenantId: body.tenantId,
      userId: body.userId,
      systemPrompt,
      userParts,
      billing: billingConfig,
      channel: "api",
      idleTimeoutMs: tenant.idleTimeoutMs,
    });

    if (!processResult.ok) {
      return c.json({
        content: processResult.budgetDenied.message,
        budgetExhausted: true,
      });
    }

    const result = processResult.result;
    return c.json({
      content: extractText(result.parts),
      parts: result.parts,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      sessionId: result.sessionId,
      tenantId: body.tenantId,
    });
  });

  app.get("/sessions", async (c) => {
    const tenantIdFilter = c.req.query("tenantId");
    let sessions = await runtime.sessionRegistry.activeSessions();
    if (tenantIdFilter) {
      sessions = sessions.filter((s) => s.tenantId === tenantIdFilter);
    }
    return c.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        userId: s.userId,
        tenantId: s.tenantId,
        messageCount: s.messageCount,
        createdAt: s.createdAt.toISOString(),
        lastActivityAt: s.lastActivityAt.toISOString(),
      })),
    });
  });

  app.delete("/sessions/:tenantId/:userId", async (c) => {
    const tenantId = c.req.param("tenantId");
    const userId = c.req.param("userId");
    const removed = await runtime.sessionRegistry.remove(runtime.appName, userId, tenantId);
    return c.json({ removed });
  });

  return app;
}
