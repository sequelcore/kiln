// Gateway: Tenant routes -- Hono sub-app for multi-tenant message processing
// Handles tenant-scoped message processing, session listing, and session removal

import { Hono } from "hono";
import type { ModeBOrchestrator } from "../session/mode-b-orchestrator.js";
import type { SessionRegistry } from "../session/session-registry.js";
import type { TenantRegistry } from "../tenant/tenant-registry.js";
import { buildTenantSystemPrompt } from "../tenant/system-prompt-builder.js";
import { checkBudget, reportUsage } from "./budget-middleware.js";

/** Billing configuration for tenant routes (matches BillingConfig from mode-b-config) */
interface BillingConfig {
  readonly budgetEndpoint: string;
  readonly usageEndpoint: string;
  readonly overBudgetMessage: string;
  readonly tiers?: Readonly<Record<string, { readonly agents: readonly string[] }>>;
}

/** Runtime configuration for a multi-tenant App */
export interface TenantAppRuntime {
  readonly appName: string;
  readonly orchestrator: ModeBOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  readonly tenantRegistry: TenantRegistry;
  readonly billing?: BillingConfig;
}

/** Request body for POST /message */
interface TenantMessageRequest {
  readonly message: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly plan?: string;
}

export function createTenantRoutes(runtime: TenantAppRuntime): Hono {
  const app = new Hono();

  app.post("/message", async (c) => {
    let body: TenantMessageRequest;
    try {
      body = await c.req.json<TenantMessageRequest>();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!body.message || typeof body.message !== "string") {
      return c.json({ error: "message is required" }, 400);
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

    // Budget check (use tenantId:userId as billing key)
    const billingConfig = tenant.billing?.budgetEndpoint
      ? (tenant.billing as unknown as BillingConfig)
      : runtime.billing;
    if (billingConfig) {
      const billingUserId = `${body.tenantId}:${body.userId}`;
      const budgetResult = await checkBudget(billingConfig, billingUserId);
      if (!budgetResult.allowed) {
        return c.json({
          content: billingConfig.overBudgetMessage ?? "Budget exhausted.",
          budgetExhausted: true,
        });
      }
    }

    // Build system prompt from tenant config
    const systemPrompt = buildTenantSystemPrompt(tenant);

    // Get or create session with tenantId
    const session = runtime.sessionRegistry.getOrCreate({
      appName: runtime.appName,
      tenantId: body.tenantId,
      userId: body.userId,
      systemPrompt,
      idleTimeoutMs: tenant.idleTimeoutMs,
    });

    // Process message
    const result = await runtime.orchestrator.processMessage(session, body.message);

    // Report usage
    if (billingConfig) {
      const billingUserId = `${body.tenantId}:${body.userId}`;
      await reportUsage(billingConfig, billingUserId, {
        tokens: result.inputTokens + result.outputTokens,
        model: "unknown",
        role: "fast",
      });
    }

    return c.json({
      content: result.content,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      sessionId: session.id,
      tenantId: body.tenantId,
    });
  });

  app.get("/sessions", (c) => {
    const tenantIdFilter = c.req.query("tenantId");
    let sessions = runtime.sessionRegistry.activeSessions();
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

  app.delete("/sessions/:tenantId/:userId", (c) => {
    const tenantId = c.req.param("tenantId");
    const userId = c.req.param("userId");
    const removed = runtime.sessionRegistry.remove(runtime.appName, userId, tenantId);
    return c.json({ removed });
  });

  return app;
}
