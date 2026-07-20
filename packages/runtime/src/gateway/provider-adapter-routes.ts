// Gateway: provider-adapter routes -- Hono sub-app for provider-adapter Apps
// Handles message processing, session listing, and session removal

import { Hono } from "hono";
import type { ArtifactResourceStore, ContentPart, TenantConfig, RetrievalPipeline, ContextArtifactCache, TtsAdapter, VoiceConfig } from "@kilnai/core";
import type { OperatorTurnRequestedAuthority } from "@kilnai/gateway-contracts";
import { textParts, extractText } from "@kilnai/core";
import type { RuntimeSessionOrchestrator } from "../session/runtime-session-orchestrator.js";
import type { SessionRegistry } from "../session/persistence/session-registry.js";
import { checkTier } from "./budget-middleware.js";
import type { BillingConfig } from "./budget-middleware.js";
import { requireApiKey } from "./auth-middleware.js";
import { processAdmittedTurn } from "./message-pipeline.js";
import type { AgentHandoffSummarizer } from "../session/support/summarization/agent-handoff-summarizer.js";
import type { EventBus } from "@kilnai/core";

/** Runtime configuration for a provider-adapter app */
export interface ProviderAdapterAppRuntime {
  readonly appName: string;
  readonly orchestrator: RuntimeSessionOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  readonly billing?: BillingConfig;
  readonly systemPrompt: string;
  readonly artifactStore?: ArtifactResourceStore;
  readonly voiceConfig?: VoiceConfig;
  readonly ttsAdapter?: TtsAdapter;
  readonly apiKey?: string;
  readonly knowledgePipeline?: RetrievalPipeline;
  readonly knowledgeMode?: "auto" | "tool";
  readonly tenant?: TenantConfig;
  readonly handoffSummarizer?: AgentHandoffSummarizer;
  readonly eventBus?: EventBus;
  readonly groundingDeps?: import("./message-pipeline.js").AdmittedTurnContext["groundingDeps"];
  readonly contextArtifactCache?: ContextArtifactCache;
  readonly coordinationContextProvider?: import("./message-pipeline.js").AdmittedTurnContext["coordinationContextProvider"];
  readonly toolAllowlist?: ReadonlySet<string>;
}

/** Request body for POST /message */
interface MessageRequest {
  readonly message?: string;
  readonly parts?: readonly ContentPart[];
  readonly userId: string;
  readonly requestedAuthority?: OperatorTurnRequestedAuthority;
  readonly plan?: string;
  readonly context?: Record<string, string>;
}

export function createProviderAdapterRoutes(runtime: ProviderAdapterAppRuntime): Hono {
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
    if (!isRequestedAuthority(body.requestedAuthority)) {
      return c.json({ error: "requestedAuthority must be auto, read_only, audited, or destructive" }, 400);
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

    // Tier enforcement stays in ingress admission.
    // It is request-contract/commercial gating and must fail before the
    // admitted-turn handoff mutates session state or runs runtime policy.
    if (runtime.billing?.tiers && body.plan) {
      const tierResult = checkTier(runtime.billing, body.plan, "fast");
      if (!tierResult.allowed) {
        return c.json({
          content: `Tier "fast" is not available on your "${body.plan}" plan. Allowed tiers: ${tierResult.allowedTiers.join(", ")}`,
          tierRestricted: true,
        });
      }
    }

    let processResult;
    try {
      processResult = await processAdmittedTurn({
        orchestrator: runtime.orchestrator,
        sessionRegistry: runtime.sessionRegistry,
        appName: runtime.appName,
        tenantId,
        userId: body.userId,
        systemPrompt: runtime.systemPrompt,
        userParts,
        artifactStore: runtime.artifactStore,
        voiceConfig: runtime.voiceConfig,
        ttsAdapter: runtime.ttsAdapter,
        billing: runtime.billing,
        channel: "api",
        requestedAuthority: body.requestedAuthority,
        userContext,
        knowledgePipeline: runtime.knowledgePipeline,
        knowledgeMode: runtime.knowledgeMode,
        tenant: runtime.tenant,
        handoffSummarizer: runtime.handoffSummarizer,
        eventBus: runtime.eventBus,
        groundingMode: runtime.tenant?.groundingMode,
        groundingDeps: runtime.groundingDeps,
        contextArtifactCache: runtime.contextArtifactCache,
        coordinationContextProvider: runtime.coordinationContextProvider,
        ...(runtime.toolAllowlist ? { perCallConfig: { toolAllowlist: runtime.toolAllowlist } } : {}),
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

function isRequestedAuthority(value: unknown): value is OperatorTurnRequestedAuthority | undefined {
  return value === undefined
    || value === "auto"
    || value === "read_only"
    || value === "audited"
    || value === "destructive";
}
