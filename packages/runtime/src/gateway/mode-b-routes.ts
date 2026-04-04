// Gateway: Mode B routes -- Hono sub-app for provider-adapter Apps
// Handles message processing, session listing, and session removal

import { Hono } from "hono";
import type { ContentPart, TenantConfig, RetrievalPipeline, ContextArtifactCache } from "@kilnai/core";
import { textParts, extractText } from "@kilnai/core";
import { formatKnowledgeContext } from "./context-formatter.js";
import type { ModeBOrchestrator } from "../session/mode-b-orchestrator.js";
import type { SessionRegistry } from "../session/session-registry.js";
import { checkTier } from "./budget-middleware.js";
import type { BillingConfig } from "./budget-middleware.js";
import { requireApiKey } from "./auth-middleware.js";
import { processInboundMessage } from "./message-pipeline.js";
import { resolveAgentContextAsync } from "../tenant/agent-resolver.js";
import type { AgentHandoffSummarizer } from "../session/agent-handoff-summarizer.js";
import type { EventBus } from "@kilnai/core";

/** Runtime configuration for a Mode B App */
export interface ModeBAppRuntime {
  readonly appName: string;
  readonly orchestrator: ModeBOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  readonly billing?: BillingConfig;
  readonly systemPrompt: string;
  readonly apiKey?: string;
  readonly knowledgePipeline?: RetrievalPipeline;
  readonly knowledgeMode?: "auto" | "tool";
  readonly tenant?: TenantConfig;
  readonly handoffSummarizer?: AgentHandoffSummarizer;
  readonly eventBus?: EventBus;
  readonly groundingDeps?: import("./message-pipeline.js").InboundMessageContext["groundingDeps"];
  readonly contextArtifactCache?: ContextArtifactCache;
}

/** Request body for POST /message */
interface MessageRequest {
  readonly message?: string;
  readonly parts?: readonly ContentPart[];
  readonly userId: string;
  readonly plan?: string;
  readonly context?: Record<string, string>;
}

export function createModeBRoutes(runtime: ModeBAppRuntime): Hono {
  const app = new Hono();
  const tenantId = runtime.tenant?.tenantId ?? "_default";

  if (runtime.apiKey) {
    app.use("*", requireApiKey(runtime.apiKey));
  }

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

    // Validate optional context: must be a plain non-array object with string values
    if (body.context !== undefined) {
      if (typeof body.context !== "object" || Array.isArray(body.context) || body.context === null) {
        return c.json({ error: "context must be a plain object" }, 400);
      }
      for (const val of Object.values(body.context)) {
        if (typeof val !== "string") {
          return c.json({ error: "context values must be strings" }, 400);
        }
      }
    }
    const userContext = body.context;

    // Tier enforcement (Mode B specific -- not in the pipeline)
    if (runtime.billing?.tiers && body.plan) {
      const tierResult = checkTier(runtime.billing, body.plan, "fast");
      if (!tierResult.allowed) {
        return c.json({
          content: `Tier "fast" is not available on your "${body.plan}" plan. Allowed tiers: ${tierResult.allowedTiers.join(", ")}`,
          tierRestricted: true,
        });
      }
    }

    // Knowledge retrieval (auto mode)
    let knowledgeContext: string | undefined;
    if (runtime.knowledgePipeline && (runtime.knowledgeMode ?? "auto") === "auto") {
      const queryText = extractText(userParts);
      if (queryText.length > 0) {
        try {
          const results = await runtime.knowledgePipeline.retrieve(queryText, { topK: 5 });
          knowledgeContext = formatKnowledgeContext(results);
        } catch {
          // fail-open
        }
      }
    }

    // Resolve agent context if tenant has multi-agent config
    let systemPrompt = runtime.systemPrompt;
    let activeAgentId: string | undefined;
    let activeAgentName: string | undefined;
    let routingTier: "rule" | "embedding" | "fallback" | undefined;
    let routingConfidence: number | undefined;
    if (runtime.tenant) {
      // Get or create session for ping-pong guard context
      const session = await runtime.sessionRegistry.getOrCreate({
        appName: runtime.appName,
        tenantId,
        userId: body.userId,
        systemPrompt: "",
      });
      // Apply user context before agent resolution so persona interpolation uses current context
      if (userContext && Object.keys(userContext).length > 0) {
        session.updateUserContext(userContext);
      }
      const agentCtx = await resolveAgentContextAsync(
        runtime.tenant, userParts, session,
        { handoffSummarizer: runtime.handoffSummarizer, eventBus: runtime.eventBus },
        undefined, undefined, session.userContext,
      );
      systemPrompt = agentCtx.systemPrompt;
      activeAgentId = agentCtx.activeAgentId;
      activeAgentName = agentCtx.activeAgentName;
      routingTier = agentCtx.routingResult?.tier;
      routingConfidence = agentCtx.routingResult?.confidence;

      // Update session with resolved prompt and agent
      session.setSystemPrompt(agentCtx.systemPrompt);
      if (agentCtx.activeAgentId) {
        session.setActiveAgent(agentCtx.activeAgentId, agentCtx.handoffBrief);
      }
      await runtime.sessionRegistry.save(session);
    }

    let processResult;
    try {
      processResult = await processInboundMessage({
        orchestrator: runtime.orchestrator,
        sessionRegistry: runtime.sessionRegistry,
        appName: runtime.appName,
        tenantId,
        userId: body.userId,
        systemPrompt,
        userParts,
        billing: runtime.billing,
        channel: "api",
        knowledgeContext,
        userContext,
        groundingMode: runtime.tenant?.groundingMode,
        groundingDeps: runtime.groundingDeps,
        contextArtifactCache: runtime.contextArtifactCache,
        activeAgentId,
        activeAgentName,
        routingTier,
        routingConfidence,
      });
    } catch (err) {
      console.error(`[${runtime.appName}] processMessage error:`, err);
      return c.json({ error: String(err) }, 500);
    }

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
    });
  });

  app.get("/sessions", async (c) => {
    const sessions = await runtime.sessionRegistry.activeSessions();
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

  app.delete("/sessions/:userId", async (c) => {
    const userId = c.req.param("userId");
    const deleteTenantId = c.req.query("tenantId") ?? tenantId;
    const removed = await runtime.sessionRegistry.remove(runtime.appName, userId, deleteTenantId);
    return c.json({ removed });
  });

  return app;
}
