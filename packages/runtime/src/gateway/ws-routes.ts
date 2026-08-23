import { Hono } from "hono";
import type { UpgradeWebSocket, WSContext } from "hono/ws";
import type { WebChannel } from "../channels/web-channel.js";
import type { ArtifactResourceStore, CommunicationResolution, ContentPart, IncomingMessage, ProviderRequestEvidence, ResolvedCommunicationIntent, SessionTurnOutcome } from "@kilnai/core";
import { projectFinalEffectivePromptObservation, resolveCommunicationIntent, textParts, extractText } from "@kilnai/core";
import { CommunicationIntentSchema, type OperatorTurnRequestedAuthority } from "@kilnai/gateway-contracts";
import { createGenericMediaDownloader } from "./audio-preprocessor.js";
import { captureMultimodalArtifacts } from "./multimodal-artifact-ingestion.js";
import type { GatewayAuthorityAdmissionCommit, GatewayAuthorityAdmissionPort } from "./gateway-authority-admission.js";
import { dispatchChannelEgress } from "../channels/channel-egress-action-claim.js";
import { extractSuggestions } from "../tenant/suggestion-parser.js";

export interface WsResponseEgressInput {
  readonly slot: "assistant" | "suggestions" | "error";
  readonly frame: Record<string, unknown>;
}

export type WsResponseEgress = (input: WsResponseEgressInput) => Promise<boolean>;

export interface WsProcessMessageResult {
  readonly parts: readonly ContentPart[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly outcome: SessionTurnOutcome;
  readonly communicationResolution?: CommunicationResolution;
  readonly providerRequests?: readonly ProviderRequestEvidence[];
  /** Runtime-owned egress dispatcher; absent means the response is not delivered. */
  readonly dispatchEgress?: WsResponseEgress;
  /** Error projection prepared inside the Runtime admission callback. */
  readonly errorMessage?: string;
}

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
    readonly communicationIntent?: ResolvedCommunicationIntent;
    /** Stable client identity used by the Runtime admission and egress claim. */
    readonly idempotencyKey?: string;
    /** Validation failures are projected only after a Runtime admission exists. */
    readonly validationError?: string;
    /** The route-owned socket used by the Runtime egress claim closure. */
    readonly ws?: WSContext;
  }) => Promise<WsProcessMessageResult>;
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
              const requestedAuthorityValid = isRequestedAuthority(parsed.requestedAuthority);
              const parsedCommunication = parsed.communicationIntent === undefined
                ? undefined
                : CommunicationIntentSchema.safeParse(parsed.communicationIntent);
              const communicationIntentValid = parsedCommunication === undefined || parsedCommunication.success;
              const communicationIntent = parsedCommunication?.success
                ? resolveCommunicationIntent([{ source: "user", intent: parsedCommunication.data }])
                : undefined;
              const clientMessageId = typeof parsed.messageId === "string"
                ? parsed.messageId
                : typeof parsed.requestId === "string"
                  ? parsed.requestId
                  : typeof parsed.id === "string" ? parsed.id : undefined;
              let userParts: readonly ContentPart[] = Array.isArray(parsed.parts)
                ? (parsed.parts as ContentPart[])
                : textParts(String(parsed.content ?? ""));

              try {
                if (config.artifactStore) {
                  try {
                    userParts = await captureMultimodalArtifacts(userParts, {
                      artifactStore: config.artifactStore,
                      downloader: createGenericMediaDownloader(),
                      sourceKind: "uploaded-file",
                      sourceIdPrefix: `${config.appName ?? "websocket"}:${config.tenantId ?? "_default"}:${userId}:web`,
                      producerName: "gateway-web-ingress",
                    });
                  } catch (error) {
                    const failedCapture = await config.processMessage(userId, userParts, {
                      ...(clientMessageId ? { idempotencyKey: clientMessageId } : {}),
                      ws,
                      validationError: error instanceof Error ? error.message : String(error),
                    });
                    await failedCapture.dispatchEgress?.({
                      slot: "error",
                      frame: { type: "error", message: failedCapture.errorMessage ?? "Unable to process media." },
                    });
                    return;
                  }
                }
                const result = await config.processMessage(userId, userParts, {
                  ...(requestedAuthorityValid ? { requestedAuthority: parsed.requestedAuthority as OperatorTurnRequestedAuthority | undefined } : {}),
                  ...(communicationIntent ? { communicationIntent } : {}),
                  ...(clientMessageId ? { idempotencyKey: clientMessageId } : {}),
                  ws,
                  ...(!requestedAuthorityValid
                    ? { validationError: "requestedAuthority must be auto, read_only, audited, or destructive" }
                    : !communicationIntentValid
                      ? { validationError: "communicationIntent is invalid" }
                      : {}),
                });
                if (result.errorMessage) {
                  await result.dispatchEgress?.({
                    slot: "error",
                    frame: { type: "error", message: result.errorMessage },
                  });
                  return;
                }
                const { content: responseContent, suggestions: followUpSuggestions } =
                  extractSuggestions(extractText(result.parts));
                const assistantSent = await result.dispatchEgress?.({
                  slot: "assistant",
                  frame: {
                    type: "done",
                    content: responseContent,
                    parts: result.parts,
                    inputTokens: result.inputTokens,
                    outputTokens: result.outputTokens,
                    outcome: result.outcome,
                    communicationResolution: result.communicationResolution,
                    effectivePromptObservation: projectFinalEffectivePromptObservation(result.providerRequests),
                  },
                }) ?? false;
                if (!assistantSent) return;
                if (followUpSuggestions.length > 0) {
                  await result.dispatchEgress?.({
                    slot: "suggestions",
                    frame: { type: "suggestions", items: followUpSuggestions },
                  });
                }
              } catch {
                // Admission rejection, socket loss, and an unknown claimed
                // outcome are deliberately silent: a second error send would
                // be a post-dispatch retry without a durable claim.
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

/** Build the only WebSocket response sender used by provider-adapter routes. */
export function createWsResponseEgress(input: {
  readonly gatewayAdmission: GatewayAuthorityAdmissionPort;
  readonly admitted: GatewayAuthorityAdmissionCommit;
  readonly appName: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly idempotencyKey: string;
  readonly ws: WSContext;
}): WsResponseEgress {
  return async ({ slot, frame }) => {
    try {
      await dispatchChannelEgress({
        context: input.gatewayAdmission.channelEgressActionClaims,
        authorityAdmission: input.admitted.bundle,
        attemptId: input.admitted.runtimeModelRoundDispatch.attemptId,
        callerId: `ws:${input.appName}:${input.tenantId}:${input.userId}`,
        idempotencyKey: input.idempotencyKey,
        logicalSendSlot: slot,
        channel: "web",
        destination: `web:${input.appName}:${input.tenantId}:${input.userId}`,
        adapterIdentity: "websocket:provider-adapter",
        payload: frame,
        send: async () => {
          const readyState = (input.ws as unknown as { readonly readyState?: number }).readyState;
          if (readyState !== undefined && readyState !== 1) throw new Error("WebSocket is not open.");
          input.ws.send(JSON.stringify(frame));
        },
      });
      return true;
    } catch {
      // A claimed socket failure is unknown and must not trigger an error
      // fallback or another provider/transport send.
      return false;
    }
  };
}
