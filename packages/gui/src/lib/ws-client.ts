/**
 * @fileoverview GUI WebSocket client for gateway communication.
 * @module @kilnai/gui
 */

import { z } from "zod";
import type {
  GuiInboundFrame,
  GuiOutboundFrame,
} from "@kilnai/gateway-contracts";

// --- Zod Schemas for frame validation ---

/** Schema for GuiOutboundFrame validation. */
const GuiOutboundFrameSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    content: z.string(),
    executionMode: z.enum(["execute", "plan"]).optional(),
    requestedAuthority: z.enum(["auto", "read_only", "audited", "destructive"]).optional(),
    resumeSessionId: z.string().optional(),
    reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
    appName: z.string().optional(),
    tenantId: z.string().optional(),
  }),
  z.object({ type: z.literal("clear") }),
  z.object({ type: z.literal("refresh_providers") }),
  z.object({
    type: z.literal("provider_auth"),
    provider: z.string(),
    requestId: z.string().trim().min(1),
    apiKey: z.string().optional(),
    tier: z.enum(["go", "zen"]).optional(),
  }),
  z.object({
    type: z.literal("provider"),
    provider: z.string(),
    model: z.string().trim().min(1).optional(),
    requestId: z.string().trim().min(1),
  }),
  z.object({
    type: z.literal("operator_theme_set_result"),
    requestId: z.string().trim().min(1),
    ok: z.boolean(),
    appliedTheme: z.string().optional(),
    error: z.string().optional(),
  }),
  z.object({ type: z.literal("resume"), sessionId: z.string() }),
  z.object({ type: z.literal("approve"), approvalId: z.string().trim().min(1) }),
  z.object({ type: z.literal("reject"), reason: z.string(), approvalId: z.string().trim().min(1) }),
  z.object({
    type: z.literal("execution_mode_transition"),
    toMode: z.enum(["execute", "plan"]),
    planId: z.string().trim().min(1).optional(),
    residualRiskAcknowledged: z.boolean().optional(),
    residualRiskAcknowledgement: z.string().optional(),
  }),
]);

const GuiProviderDescriptorSchema = z.object({
  id: z.string(),
  label: z.string(),
  group: z.enum(["subscription", "harness", "direct-api"]),
  free: z.boolean(),
  available: z.boolean(),
  models: z.array(z.string()),
  status: z.enum([
    "available",
    "missing_auth",
    "auth_expired",
    "cli_missing",
    "endpoint_timeout",
    "endpoint_error",
    "empty_model_list",
    "daemon_unreachable",
    "model_selection_not_required",
  ]).optional(),
  reason: z.string().optional(),
  authState: z.enum(["authenticated", "missing", "expired", "not_required", "unknown"]).optional(),
  lastCheckedAt: z.string().optional(),
});

const GuiProviderModelCapabilitiesSchema = z.object({
  supportsFunctionTools: z.boolean().optional(),
  supportsRuntimeTools: z.boolean().optional(),
  supportsNativeShellTools: z.boolean().optional(),
  supportsNativePatchTools: z.boolean().optional(),
  supportsTools: z.boolean().optional(),
  supportsStreaming: z.boolean().optional(),
  supportsStructuredOutput: z.boolean().optional(),
  supportsVision: z.boolean().optional(),
  supportsParallelToolCalls: z.boolean().optional(),
  contextWindow: z.number().optional(),
  defaultReasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
  supportedReasoningEfforts: z.array(z.enum(["minimal", "low", "medium", "high", "xhigh"])).optional(),
});

const GuiProviderModelRouteHealthSchema = z.object({
  healthy: z.boolean(),
  reason: z.string().optional(),
  cooldownUntil: z.number().optional(),
});

const GuiProviderDiscoveryResultSchema = z.object({
  provider: z.string(),
  available: z.boolean(),
  models: z.array(z.string()),
  modelCapabilities: z.record(z.string(), GuiProviderModelCapabilitiesSchema).optional(),
  modelRouteHealth: z.record(z.string(), GuiProviderModelRouteHealthSchema).optional(),
  status: z.enum([
    "available",
    "missing_auth",
    "auth_expired",
    "cli_missing",
    "endpoint_timeout",
    "endpoint_error",
    "empty_model_list",
    "daemon_unreachable",
    "model_selection_not_required",
  ]),
  reason: z.string(),
  authState: z.enum(["authenticated", "missing", "expired", "not_required", "unknown"]),
  lastCheckedAt: z.string(),
});

const GuiAuthorityStatusSchema = z.object({
  effective: z.enum(["fail_closed", "read_only", "idempotent", "audited", "destructive", "unknown"]),
  completeness: z.enum(["authoritative", "partial"]),
});

const GuiInteractiveUseSnapshotSchema = z.object({
  target: z.enum(["browser", "computer"]),
  status: z.enum(["running", "succeeded", "failed"]),
  updatedAt: z.string(),
  kilnSessionId: z.string().optional(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  provider: z.string().optional(),
  sessionId: z.string().optional(),
  operation: z.string().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  visibleText: z.string().optional(),
  windowTitle: z.string().optional(),
  application: z.string().optional(),
  closeMethod: z.string().optional(),
  screenshotUri: z.string().optional(),
  screenshotDataUrl: z.string().optional(),
  actionSummary: z.string().optional(),
  error: z.string().optional(),
});

const GuiSessionEventSchema = z.object({
  eventId: z.string(),
  kilnSessionId: z.string(),
  sequence: z.number().int().min(1),
  timestamp: z.string(),
  kind: z.enum([
    "turn_started",
    "user_message",
    "assistant_message",
    "assistant_delta",
    "specification_submitted",
    "clarification_recorded",
    "plan_submitted",
    "plan_analysis_reported",
    "plan_approved",
    "goal.created",
    "goal.updated",
    "goal.completed",
    "goal.failed",
    "goal.cancelled",
    "work_items.materialized",
    "provider_routed",
    "tool_call_started",
    "tool_call_completed",
    "approval_requested",
    "approval_resolved",
    "config_change_proposed",
    "config_change_approved",
    "config_change_applied",
    "config_change_failed",
    "file_changed",
    "cost_updated",
    "work_item_updated",
    "agent_invocation_requested",
    "agent_invocation_started",
    "agent_invocation_completed",
    "agent_invocation_failed",
    "agent_invocation_cancelled",
    "continuity_decided",
    "error_recorded",
    "turn_completed",
  ]),
  turnId: z.string().optional(),
  parentEventId: z.string().optional(),
  source: z.object({
    actor: z.enum(["user", "assistant", "system", "tool", "runtime"]),
    surface: z.enum(["cli", "tui", "gui", "ide", "gateway", "runtime"]),
    component: z.string().optional(),
  }).optional(),
  payload: z.record(z.string(), z.unknown()),
});

/** Schema for GuiInboundFrame validation. */
const GuiInboundFrameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("thinking") }),
  z.object({
    type: z.literal("operator_theme_set"),
    requestId: z.string().trim().min(1),
    theme: z.string().trim().min(1),
    scope: z.enum(["session", "persisted"]),
    reason: z.string().optional(),
  }),
  z.object({ type: z.literal("session_event"), event: GuiSessionEventSchema }),
  z.object({
    type: z.literal("activity_phase"),
    kilnSessionId: z.string(),
    turnId: z.string().optional(),
    phase: z.enum(["idle", "thinking", "tool_running", "awaiting_approval", "streaming"]),
    toolName: z.string().optional(),
    details: z.string().optional(),
  }),
  z.object({
    type: z.literal("interactive_use_updated"),
    snapshot: GuiInteractiveUseSnapshotSchema,
  }),
  z.object({
    type: z.literal("done"),
    content: z.string(),
    parts: z.array(z.unknown()).optional(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    routedProvider: z.string().optional(),
    routedModel: z.string().optional(),
    authorityStatus: GuiAuthorityStatusSchema.optional(),
    runtimeContinuity: z
      .object({
        strategy: z.string(),
        feedbackLabel: z.string().optional(),
        pressure: z.string().optional(),
        supportArtifactCount: z.number().optional(),
        supportArtifactSources: z.array(z.string()).optional(),
        fallbackLabel: z.string().optional(),
        usedCachedSupport: z.boolean().optional(),
        selectionReason: z.string().optional(),
      })
      .optional(),
  }),
  z.object({ type: z.literal("error"), message: z.string(), code: z.string().optional() }),
  z.object({
    type: z.literal("welcome"),
    greeting: z.string().optional(),
    models: z.record(z.array(z.string())).optional(),
    providerDiscovery: z.array(GuiProviderDiscoveryResultSchema).optional(),
    providers: z.array(GuiProviderDescriptorSchema).optional(),
    activeProvider: z.string().optional(),
    activeModel: z.string().optional(),
    executionMode: z.enum(["execute", "plan"]).optional(),
    authorityStatus: GuiAuthorityStatusSchema.optional(),
  }),
  z.object({
    type: z.literal("execution_mode_transitioned"),
    executionMode: z.enum(["execute", "plan"]),
    planId: z.string().optional(),
    approvalId: z.string().optional(),
    planHash: z.string().optional(),
  }),
  z.object({ type: z.literal("cleared") }),
  z.object({
    type: z.literal("provider_auth_started"),
    provider: z.string(),
    requestId: z.string().trim().min(1),
    method: z.literal("device_code"),
    verificationUri: z.string(),
    userCode: z.string(),
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal("provider_auth_completed"),
    provider: z.string(),
    requestId: z.string().trim().min(1),
    models: z.record(z.array(z.string())),
    providerDiscovery: z.array(GuiProviderDiscoveryResultSchema),
    providers: z.array(GuiProviderDescriptorSchema).optional(),
  }),
  z.object({
    type: z.literal("provider_auth_failed"),
    provider: z.string(),
    requestId: z.string().trim().min(1),
    message: z.string(),
  }),
  z.object({
    type: z.literal("providers_refreshed"),
    models: z.record(z.array(z.string())),
    providerDiscovery: z.array(GuiProviderDiscoveryResultSchema),
    providers: z.array(GuiProviderDescriptorSchema),
  }),
  z.object({
    type: z.literal("provider_changed"),
    provider: z.string(),
    model: z.string().trim().min(1).optional(),
    requestId: z.string().trim().min(1),
  }),
  z.object({ type: z.literal("resume_selected"), sessionId: z.string() }),
]);

/** Connection lifecycle states for the GUI WebSocket client. */
export type GuiConnectionState =
  | "idle"
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed";

// --- Timing constants ---
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const RECONNECT_JITTER_FRACTION = 0.2;
const OUTBOUND_QUEUE_MAX = 100;

/**
 * Configuration options for GuiWsClient.
 */
export interface GuiWsClientOptions {
  readonly baseUrl: string;
  readonly userId: string;
  readonly onFrame: (frame: GuiInboundFrame) => void;
  readonly onStateChange: (state: GuiConnectionState) => void;
}

/**
 * GuiWsClient — WebSocket client for the GUI operator surface.
 *
 * Manages connection lifecycle, heartbeat, reconnect with exponential backoff,
 * and outbound message queuing.
 */
export class GuiWsClient {
  private ws: WebSocket | null = null;
  private _state: GuiConnectionState = "idle";
  private stopped = false;

  // Backoff state
  private backoffAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Heartbeat state
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongWatchdog: ReturnType<typeof setTimeout> | null = null;

  // Outbound queue (bounded)
  private outboundQueue: GuiOutboundFrame[] = [];

  constructor(private readonly options: GuiWsClientOptions) {}

  /** Current connection state. */
  get state(): GuiConnectionState {
    return this._state;
  }

  /** Whether the WebSocket is currently open. */
  get isOpen(): boolean {
    return this._state === "open";
  }

  /**
   * Connect to the gateway WebSocket.
   */
  connect(): void {
    if (this.stopped) return;

    this.setState("connecting");

    const wsUrl = `${this.options.baseUrl}?userId=${encodeURIComponent(this.options.userId)}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => this.handleOpen();
    this.ws.onmessage = (event) => this.handleMessage(event);
    this.ws.onclose = (event) => this.handleClose(event);
    this.ws.onerror = () => this.handleError();
  }

  /**
   * Send an outbound frame to the gateway.
   * Queues non-provider frames if the connection is not open.
   */
  send(frame: GuiOutboundFrame): void {
    // Validate outbound frame schema
    try {
      GuiOutboundFrameSchema.parse(frame);
    } catch {
      console.warn("[GuiWsClient] Invalid outbound frame:", JSON.stringify(frame));
      return;
    }

    if (this._state === "open" && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    } else if (frame.type === "provider") {
      throw new Error("Cannot send provider switch while WebSocket is not open");
    } else if (frame.type === "provider_auth") {
      throw new Error("Cannot send provider authentication while WebSocket is not open");
    } else {
      // Queue for later when not open
      if (this.outboundQueue.length >= OUTBOUND_QUEUE_MAX) {
        const dropped = this.outboundQueue.shift();
        console.warn("[GuiWsClient] Queue full, dropping:", JSON.stringify(dropped));
      }
      this.outboundQueue.push(frame);
    }
  }

  /**
   * Close the connection permanently.
   */
  close(code = 1000, reason = "client closed"): void {
    this.stopped = true;
    this.stopTimers();
    this.setState("closed");

    if (this.ws) {
      this.ws.close(code, reason);
      this.ws = null;
    }
  }

  // --- Private handlers ---

  private handleOpen(): void {
    // Reset backoff on successful connection
    this.backoffAttempts = 0;

    this.setState("open");
    this.startHeartbeat();

    // Drain outbound queue
    this.drainQueue();
  }

  private handleMessage(event: MessageEvent): void {
    const raw = typeof event.data === "string" ? event.data : String(event.data);

    // Handle pong (heartbeat response)
    if (raw === "pong") {
      this.resetPongWatchdog();
      return;
    }

    // Parse and validate inbound frame
    try {
      const parsed = JSON.parse(raw);
      GuiInboundFrameSchema.parse(parsed);
      this.options.onFrame(parsed as GuiInboundFrame);
    } catch {
      console.warn("[GuiWsClient] Invalid inbound frame:", raw);
    }
  }

  private handleClose(event: CloseEvent): void {
    this.stopHeartbeat();

    if (this.stopped) {
      this.setState("closed");
      return;
    }

    // Unexpected close — schedule reconnect
    if (event.code !== 1000) {
      this.setState("reconnecting");
      this.scheduleReconnect();
    } else {
      // Client-initiated close (code 1000) — don't reconnect
      this.setState("closed");
    }
  }

  private handleError(): void {
    this.stopHeartbeat();

    if (!this.stopped) {
      this.setState("reconnecting");
      this.scheduleReconnect();
    }
  }

  // --- Private state management ---

  private setState(state: GuiConnectionState): void {
    if (this._state !== state) {
      this._state = state;
      this.options.onStateChange(state);
    }
  }

  // --- Heartbeat ---

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send("ping");

        // Set pong watchdog — close if no pong within 60s
        if (!this.pongWatchdog) {
          this.pongWatchdog = setTimeout(() => {
            console.warn("[GuiWsClient] Pong timeout, closing connection");
            this.ws?.close(4000, "pong timeout");
          }, HEARTBEAT_TIMEOUT_MS);
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.resetPongWatchdog();
  }

  private resetPongWatchdog(): void {
    if (this.pongWatchdog) {
      clearTimeout(this.pongWatchdog);
      this.pongWatchdog = null;
    }
  }

  // --- Reconnect ---

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    // Exponential backoff: 1s → 2s → 4s → ... → 30s, with ±20% jitter
    const baseDelay = Math.min(
      RECONNECT_MIN_MS * Math.pow(2, this.backoffAttempts),
      RECONNECT_MAX_MS
    );

    const jitter = baseDelay * RECONNECT_JITTER_FRACTION * (Math.random() * 2 - 1);
    const delay = Math.round(baseDelay + jitter);

    this.backoffAttempts++;

    console.log(`[GuiWsClient] Reconnecting in ${delay}ms (attempt ${this.backoffAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // --- Queue management ---

  private drainQueue(): void {
    while (this.outboundQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      const frame = this.outboundQueue.shift();
      if (frame) {
        this.ws.send(JSON.stringify(frame));
      }
    }
  }

  // --- Cleanup ---

  private stopTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
  }
}
