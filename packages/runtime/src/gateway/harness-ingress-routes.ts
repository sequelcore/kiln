import { Hono } from "hono";
import type { UpgradeWebSocket, WSContext } from "hono/ws";
import {
  HarnessIngressContentPartSchema,
  HARNESS_INGRESS_PROTOCOL_VERSION,
  parseHarnessIngressClientFrame,
  type HarnessIngressContentPart,
  type HarnessIngressServerFrame,
  type HarnessIngressTransportIdentity,
} from "@kilnai/gateway-contracts";
import { resolveCommunicationIntent, type ContentPart } from "@kilnai/core";
import type { ProviderAdapterAppRuntime } from "./provider-adapter-routes.js";
import { processAdmittedTurn, sanitizeAssistantEgressText } from "./message-pipeline/index.js";
import { toCoreDeliberationIntent } from "./deliberation-projection.js";

export interface HarnessIngressRoutesConfig {
  /** Required because this route is deliberately opt-in and WebSocket-only. */
  readonly upgradeWebSocket: UpgradeWebSocket;
  /** Receives only the bearer credential, never a query parameter or raw request. */
  readonly authenticate: (bearerToken: string) => HarnessIngressTransportIdentity | undefined | Promise<HarnessIngressTransportIdentity | undefined>;
  /** Resolves an existing, configured runtime from transport-authenticated identity. */
  readonly resolveTarget: (identity: HarnessIngressTransportIdentity) => ProviderAdapterAppRuntime | undefined;
  /** Test seam; production uses the canonical admitted-turn pipeline. */
  readonly processAdmittedTurn?: typeof processAdmittedTurn;
}

interface ActiveTurn {
  readonly turnId: string;
  readonly controller: AbortController;
}

const ROUTE = "/harness/v1/ws";

/**
 * Builds the opt-in harness ingress. Identity is fixed before WebSocket upgrade;
 * individual frames contain no credentials or caller-controlled target identity.
 */
export function createHarnessIngressRoutes(config: HarnessIngressRoutesConfig): Hono {
  const app = new Hono<{ Variables: { harnessIdentity: HarnessIngressTransportIdentity } }>();
  const activeTurns = new Map<string, ActiveTurn>();
  const runAdmittedTurn = config.processAdmittedTurn ?? processAdmittedTurn;

  app.get(
    ROUTE,
    async (c, next) => {
      const bearer = readBearer(c.req.header("Authorization"));
      if (!bearer) return c.json({ error: "Unauthorized" }, 401);
      let identity: HarnessIngressTransportIdentity | undefined;
      try {
        identity = await config.authenticate(bearer);
      } catch {
        return c.json({ error: "Unauthorized" }, 401);
      }
      if (!identity) return c.json({ error: "Unauthorized" }, 401);
      c.set("harnessIdentity", identity);
      return next();
    },
    config.upgradeWebSocket((c) => {
      const identity = c.get("harnessIdentity") as HarnessIngressTransportIdentity | undefined;
      return {
        onMessage(event: MessageEvent, ws: WSContext) {
          void handleMessage({ payload: event.data, ws, identity, config, activeTurns, runAdmittedTurn });
        },
      };
    }),
  );
  return app as unknown as Hono;
}

async function handleMessage(input: {
  readonly payload: unknown;
  readonly ws: WSContext;
  readonly identity: HarnessIngressTransportIdentity | undefined;
  readonly config: HarnessIngressRoutesConfig;
  readonly activeTurns: Map<string, ActiveTurn>;
  readonly runAdmittedTurn: typeof processAdmittedTurn;
}): Promise<void> {
  const requestId = requestIdFromPayload(input.payload);
  if (!input.identity) {
    send(input.ws, errorFrame(requestId, "unauthorized"));
    return;
  }

  let frame;
  try {
    const payload = typeof input.payload === "string" ? JSON.parse(input.payload) : input.payload;
    frame = parseHarnessIngressClientFrame(payload, input.identity);
  } catch {
    send(input.ws, errorFrame(requestId, "invalid_request"));
    return;
  }

  const runtime = input.config.resolveTarget(input.identity);
  if (!runtime || runtime.appName !== input.identity.appName || !tenantMatches(runtime, input.identity)) {
    send(input.ws, errorFrame(frame.requestId, "unsupported"));
    return;
  }

  const tenantId = input.identity.tenantId ?? "_default";
  const activityKey = activeKey(input.identity, frame.sessionId);
  if (frame.type === "turn_cancel") {
    const active = input.activeTurns.get(activityKey);
    if (!active || active.turnId !== frame.turnId) {
      send(input.ws, { protocolVersion: HARNESS_INGRESS_PROTOCOL_VERSION, type: "turn_cancel_result", requestId: frame.requestId, turnId: frame.turnId, status: "not_active" });
      return;
    }
    active.controller.abort();
    send(input.ws, { protocolVersion: HARNESS_INGRESS_PROTOCOL_VERSION, type: "turn_cancel_result", requestId: frame.requestId, turnId: frame.turnId, status: "accepted" });
    return;
  }

  if (input.activeTurns.has(activityKey)) {
    send(input.ws, errorFrame(frame.requestId, "unsupported"));
    return;
  }
  const controller = new AbortController();
  const active: ActiveTurn = { turnId: frame.requestId, controller };
  input.activeTurns.set(activityKey, active);
  send(input.ws, {
    protocolVersion: HARNESS_INGRESS_PROTOCOL_VERSION,
    type: "turn_accepted",
    requestId: frame.requestId,
    turnId: frame.requestId,
    ...(frame.sessionId ? { sessionId: frame.sessionId } : {}),
  });

  void completeTurn({ frame, runtime, tenantId, ws: input.ws, activeTurns: input.activeTurns, activityKey, active, runAdmittedTurn: input.runAdmittedTurn });
}

async function completeTurn(input: {
  readonly frame: Extract<ReturnType<typeof parseHarnessIngressClientFrame>, { type: "turn_start" }>;
  readonly runtime: ProviderAdapterAppRuntime;
  readonly tenantId: string;
  readonly ws: WSContext;
  readonly activeTurns: Map<string, ActiveTurn>;
  readonly activityKey: string;
  readonly active: ActiveTurn;
  readonly runAdmittedTurn: typeof processAdmittedTurn;
}): Promise<void> {
  try {
    const deliberationIntent = toCoreDeliberationIntent(input.frame.deliberationIntent);
    const communicationIntent = input.frame.communicationIntent
      ? resolveCommunicationIntent([{ source: "user", intent: input.frame.communicationIntent }])
      : undefined;
    const userParts = toContentParts(input.frame.content, input.frame.parts);
    const session = input.frame.sessionId
      ? await input.runtime.sessionRegistry.getById(input.frame.sessionId)
      : await input.runtime.sessionRegistry.getOrCreate({
          appName: input.runtime.appName,
          tenantId: input.tenantId,
          userId: input.frame.userId,
          systemPrompt: input.runtime.systemPrompt,
        });
    if (!session
      || session.appName !== input.runtime.appName
      || session.tenantId !== input.tenantId
      || session.userId !== input.frame.userId) {
      send(input.ws, errorFrame(input.frame.requestId, "unsupported"));
      return;
    }
    const result = await input.runtime.gatewayAdmission.execute({
      ingressId: input.frame.requestId,
      appName: input.runtime.appName,
      tenantId: input.tenantId,
      userId: input.frame.userId,
      sessionId: session.id,
      channel: "harness",
      userParts,
      requestedAuthority: input.frame.requestedAuthority,
    }, async (admitted) => input.runAdmittedTurn({
      orchestrator: input.runtime.orchestrator.bindProvider(
        admitted.provider,
        admitted.bundle.turn.execution.status === "routed"
          ? admitted.bundle.turn.execution.target.providerModelId
          : undefined,
      ),
      sessionRegistry: input.runtime.sessionRegistry,
      admittedSession: admitted.session,
      appName: input.runtime.appName,
      tenantId: input.tenantId,
      userId: input.frame.userId,
      systemPrompt: input.runtime.systemPrompt,
      userParts,
      artifactStore: input.runtime.artifactStore,
      voiceConfig: input.runtime.voiceConfig,
      ttsAdapter: input.runtime.ttsAdapter,
      billing: input.runtime.billing,
      channel: "harness",
      authorityAdmission: admitted.bundle,
      runtimeMediaActionClaims: admitted.runtimeMediaActionClaims,
      tenant: input.runtime.tenant,
      eventBus: input.runtime.eventBus,
      contextArtifactCache: input.runtime.contextArtifactCache,
      coordinationContextProvider: input.runtime.coordinationContextProvider,
      perCallConfig: {
        ...admitted.perCallConfig,
        runtimeModelRoundDispatch: admitted.runtimeModelRoundDispatch,
        runtimeToolActionClaims: admitted.runtimeToolActionClaims,
        ...(deliberationIntent ? { deliberationIntent, deliberationSource: "operator" as const } : {}),
        ...(communicationIntent ? { communicationIntent } : {}),
        abortSignal: input.active.controller.signal,
      },
    }));
    if (!result.ok) {
      send(input.ws, errorFrame(input.frame.requestId, "unavailable"));
      return;
    }
    const output = projectCompletionOutput(result.result.parts);
    send(input.ws, {
      protocolVersion: HARNESS_INGRESS_PROTOCOL_VERSION,
      type: "turn_completed",
      requestId: input.frame.requestId,
      turnId: input.frame.requestId,
      sessionId: result.result.sessionId,
      outcome: input.active.controller.signal.aborted ? "cancelled" : "completed",
      ...output,
    });
  } catch {
    send(input.ws, errorFrame(input.frame.requestId, "internal"));
  } finally {
    if (input.activeTurns.get(input.activityKey) === input.active) input.activeTurns.delete(input.activityKey);
  }
}

function toContentParts(content: string | undefined, parts: readonly HarnessIngressContentPart[] | undefined): readonly ContentPart[] {
  if (content !== undefined) return [{ type: "text", text: content }];
  // The ingress contract is a deliberately safe subset of ContentPart.
  return (parts ?? []) as readonly ContentPart[];
}

function tenantMatches(runtime: ProviderAdapterAppRuntime, identity: HarnessIngressTransportIdentity): boolean {
  return (runtime.tenant?.tenantId ?? "_default") === (identity.tenantId ?? "_default");
}

function activeKey(identity: HarnessIngressTransportIdentity, sessionId: string | undefined): string {
  return [identity.callerId, identity.appName, identity.tenantId ?? "_default", identity.userId, sessionId ?? "new"].join("\u0000");
}

function readBearer(value: string | undefined): string | undefined {
  const match = /^Bearer\s+([^\s]+)$/i.exec(value ?? "");
  return match?.[1];
}

function requestIdFromPayload(payload: unknown): string {
  if (typeof payload !== "string") return "invalid";
  try {
    const parsed = JSON.parse(payload) as { requestId?: unknown };
    return typeof parsed.requestId === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(parsed.requestId) ? parsed.requestId : "invalid";
  } catch {
    return "invalid";
  }
}

function errorFrame(requestId: string, code: "invalid_request" | "unauthorized" | "unsupported" | "unavailable" | "internal"): HarnessIngressServerFrame {
  return { protocolVersion: HARNESS_INGRESS_PROTOCOL_VERSION, type: "error", requestId, code, redacted: true };
}

function projectCompletionOutput(parts: readonly ContentPart[]): Pick<Extract<HarnessIngressServerFrame, { type: "turn_completed" }>, "content" | "parts"> {
  const projected = parts.flatMap((part) => projectCompletionPart(part));
  if (projected.length === 0) return {};
  if (projected.every((part) => part.type === "text")) {
    const content = projected.map((part) => part.text).join("\n");
    return content ? { content } : {};
  }
  return { parts: projected };
}

function projectCompletionPart(part: unknown): HarnessIngressContentPart[] {
  if (!part || typeof part !== "object" || Array.isArray(part)) return [];
  const source = part as Record<string, unknown>;
  if (source.type === "text" && typeof source.text === "string") {
    const parsed = HarnessIngressContentPartSchema.safeParse({ type: "text", text: sanitizeAssistantEgressText(source.text) });
    return parsed.success ? [parsed.data] : [];
  }
  if ((source.type !== "image" && source.type !== "audio" && source.type !== "file") || typeof source.mimeType !== "string") return [];
  const candidate: Record<string, unknown> = { type: source.type, mimeType: source.mimeType };
  if (typeof source.data === "string") candidate.data = source.data;
  if (typeof source.artifactUri === "string") candidate.artifactUri = source.artifactUri;
  if (source.type === "audio" && typeof source.durationMs === "number") candidate.durationMs = source.durationMs;
  if (source.type === "file" && typeof source.filename === "string") candidate.filename = source.filename;
  const parsed = HarnessIngressContentPartSchema.safeParse(candidate);
  return parsed.success ? [parsed.data] : [];
}

function send(ws: WSContext, frame: HarnessIngressServerFrame): void {
  try {
    ws.send(JSON.stringify(frame));
  } catch {
    // Socket close must not cancel or leak an in-flight turn.
  }
}
