// Gateway: Mode B routes -- Hono sub-app for provider-adapter Apps
// Handles message processing, session listing, and session removal

import { Hono } from "hono";
import type { ContentPart } from "@kilnai/core";
import { textParts, extractText } from "@kilnai/core";
import type { ModeBOrchestrator } from "../session/mode-b-orchestrator.js";
import type { SessionRegistry } from "../session/session-registry.js";
import { checkBudget, reportUsage, checkTier } from "./budget-middleware.js";
import type { BillingConfig } from "./budget-middleware.js";

/** Runtime configuration for a Mode B App */
export interface ModeBAppRuntime {
  readonly appName: string;
  readonly orchestrator: ModeBOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  readonly billing?: BillingConfig;
  readonly systemPrompt: string;
}

/** Request body for POST /message */
interface MessageRequest {
  readonly message?: string;
  readonly parts?: readonly ContentPart[];
  readonly userId: string;
  readonly plan?: string;
}

export function createModeBRoutes(runtime: ModeBAppRuntime): Hono {
  const app = new Hono();

  app.post("/message", async (c) => {
    let body: MessageRequest;
    try {
      body = await c.req.json<MessageRequest>();
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

    // Budget check
    if (runtime.billing) {
      const budgetResult = await checkBudget(runtime.billing, body.userId);
      if (!budgetResult.allowed) {
        return c.json({
          content: runtime.billing.overBudgetMessage,
          budgetExhausted: true,
        });
      }

      // Tier enforcement
      if (runtime.billing.tiers && body.plan) {
        const tierResult = checkTier(runtime.billing, body.plan, "fast");
        if (!tierResult.allowed) {
          return c.json({
            content: `Tier "fast" is not available on your "${body.plan}" plan. Allowed tiers: ${tierResult.allowedTiers.join(", ")}`,
            tierRestricted: true,
          });
        }
      }
    }

    // Get or create session
    const session = runtime.sessionRegistry.getOrCreate({
      appName: runtime.appName,
      userId: body.userId,
      systemPrompt: runtime.systemPrompt,
    });

    // Process message
    let result;
    try {
      result = await runtime.orchestrator.processMessage(session, userParts);
    } catch (err) {
      console.error(`[${runtime.appName}] processMessage error:`, err);
      return c.json({ error: String(err) }, 500);
    }

    // Report token usage to billing (fire-and-forget)
    if (runtime.billing) {
      reportUsage(runtime.billing, body.userId, {
        tokens: result.inputTokens + result.outputTokens,
        model: "default",
        role: "assistant",
      });
    }

    return c.json({
      content: extractText(result.parts),
      parts: result.parts,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      sessionId: session.id,
    });
  });

  app.get("/sessions", (c) => {
    const sessions = runtime.sessionRegistry.activeSessions();
    return c.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        userId: s.userId,
        messageCount: s.messageCount,
        createdAt: s.createdAt.toISOString(),
        lastActivityAt: s.lastActivityAt.toISOString(),
      })),
    });
  });

  app.delete("/sessions/:userId", (c) => {
    const userId = c.req.param("userId");
    const removed = runtime.sessionRegistry.remove(runtime.appName, userId);
    return c.json({ removed });
  });

  return app;
}
