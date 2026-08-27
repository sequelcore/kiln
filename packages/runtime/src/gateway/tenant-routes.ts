// Gateway: Tenant routes -- Hono sub-app for multi-tenant message processing
// Handles tenant-scoped message processing, session listing, and session removal

import { Hono } from "hono";
import type { ArtifactResourceStore, ContentPart, ContextArtifactCache, TtsAdapter, VoiceConfig } from "@kilnai/core";
import { resolveCommunicationIntent, textParts, extractText } from "@kilnai/core";
import type { RuntimeSessionOrchestrator } from "../session/runtime-session-orchestrator.js";
import type { SessionRegistry } from "../session/persistence/session-registry.js";
import type { TenantRegistry } from "../tenant/tenant-registry.js";
import type { BillingConfig } from "./budget-middleware.js";
import { buildTenantSystemPrompt } from "../tenant/system-prompt-builder.js";
import { requireApiKey } from "./auth-middleware.js";
import { processAdmittedTurn } from "./message-pipeline/index.js";
import { CommunicationIntentSchema, type OperatorTurnRequestedAuthority } from "@kilnai/gateway-contracts";
import {
  type GatewayAuthorityAdmissionPort,
} from "./gateway-authority-admission.js";

/** Runtime configuration for a multi-tenant App */
export interface TenantAppRuntime {
  readonly appName: string;
  readonly orchestrator: RuntimeSessionOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  readonly tenantRegistry: TenantRegistry;
  readonly artifactStore?: ArtifactResourceStore;
  readonly voiceConfig?: VoiceConfig;
  readonly ttsAdapter?: TtsAdapter;
  readonly billing?: BillingConfig;
  readonly apiKey?: string;
  readonly contextArtifactCache?: ContextArtifactCache;
  readonly coordinationContextProvider?: import("./message-pipeline/index.js").AdmittedTurnContext["coordinationContextProvider"];
  /** Required Runtime owner for durable, complete authority admission. */
  readonly gatewayAdmission: GatewayAuthorityAdmissionPort;
  /** Transitional non-authority application hint; ignored by this route. */
  readonly toolAllowlist?: ReadonlySet<string>;
}

/** Request body for POST /message */
interface TenantMessageRequest {
  readonly message?: string;
  readonly parts?: readonly ContentPart[];
  readonly userId: string;
  readonly tenantId: string;
  readonly plan?: string;
  readonly requestedAuthority?: OperatorTurnRequestedAuthority;
  readonly communicationIntent?: unknown;
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
    if (!isRequestedAuthority(body.requestedAuthority)) {
      return c.json({ error: "requestedAuthority must be auto, read_only, audited, or destructive" }, 400);
    }
    const parsedCommunication = body.communicationIntent === undefined
      ? undefined
      : CommunicationIntentSchema.safeParse(body.communicationIntent);
    if (parsedCommunication && !parsedCommunication.success) {
      return c.json({ error: "communicationIntent is invalid" }, 400);
    }
    const communicationIntent = parsedCommunication?.success
      ? resolveCommunicationIntent([{ source: "user", intent: parsedCommunication.data }])
      : undefined;

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

    const session = await runtime.sessionRegistry.getOrCreate({
      appName: runtime.appName,
      tenantId: body.tenantId,
      userId: body.userId,
      systemPrompt: buildTenantSystemPrompt(tenant),
      idleTimeoutMs: tenant.idleTimeoutMs,
    });
    let processResult;
    try {
      processResult = await runtime.gatewayAdmission.execute({
          ingressId: crypto.randomUUID(),
          appName: runtime.appName,
          tenantId: body.tenantId,
          userId: body.userId,
          sessionId: session.id,
          channel: "api",
          userParts,
          requestedAuthority: body.requestedAuthority,
        }, async (admitted) => processAdmittedTurn({
        orchestrator: runtime.orchestrator.bindProvider(
          admitted.provider,
          admitted.bundle.turn.execution.status === "routed" ? admitted.bundle.turn.execution.target.providerModelId : undefined,
        ),
        sessionRegistry: runtime.sessionRegistry,
        appName: runtime.appName,
        tenantId: body.tenantId,
        userId: body.userId,
        admittedSession: admitted.session,
        userParts,
        artifactStore: runtime.artifactStore,
        voiceConfig: runtime.voiceConfig,
        ttsAdapter: runtime.ttsAdapter,
        billing: billingConfig,
        channel: "api",
        tenant,
        authorityAdmission: admitted.bundle,
        runtimeMediaActionClaims: admitted.runtimeMediaActionClaims,
        // requestedAuthority remains request context only; the committed
        // bundle is the sole authority source crossing into execution.
        perCallConfig: {
          ...admitted.perCallConfig,
          runtimeModelRoundDispatch: admitted.runtimeModelRoundDispatch,
          ...(communicationIntent ? { communicationIntent } : {}),
        },
        idleTimeoutMs: tenant.idleTimeoutMs,
        contextArtifactCache: runtime.contextArtifactCache,
        coordinationContextProvider: runtime.coordinationContextProvider,
      }));
    } catch (error) {
      console.error(`[${runtime.appName}] tenant processMessage error:`, error);
      return c.json({ error: String(error) }, 503);
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
      tenantId: body.tenantId,
      communicationResolution: result.communicationResolution,
      effectivePromptObservation: result.effectivePromptObservation,
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

function isRequestedAuthority(value: unknown): value is OperatorTurnRequestedAuthority | undefined {
  return value === undefined
    || value === "auto"
    || value === "read_only"
    || value === "audited"
    || value === "destructive";
}
