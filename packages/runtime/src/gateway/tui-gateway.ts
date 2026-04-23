import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import { execSync } from "node:child_process";
import { RuntimeSessionOrchestrator } from "../session/runtime-session-orchestrator.js";
import type { PerCallToolConfig } from "../session/runtime-session-orchestrator.js";
import { SessionRegistry } from "../session/session-registry.js";
import { textParts, extractText, EventBus, type ApprovalRequestedEvent, type ApprovalReceivedEvent, type KilnEvent, type ToolAuthorizedEvent } from "@kilnai/core";
import type { ContextArtifactCache } from "@kilnai/core";
import { CliSubscriptionExecutor } from "../execution/cli-subscription-executor.js";
import type { CliSessionFactory, CliSessionEvent } from "../execution/cli-subscription-executor.js";
import { ApprovalGateRegistry } from "./approval-registry.js";
import { processAdmittedTurn } from "./message-pipeline.js";
import {
  buildAttachedRuntimePerCallToolConfig,
  createAttachedRuntimeBuiltinToolSurface,
  type AttachedRuntimeBuiltinToolSurface,
} from "./attached-runtime-tool-surface.js";
import type {
  RuntimeTurnApprovalTransition,
  RuntimeTurnAuthorityDecision,
  RuntimeTurnFileChange,
} from "../session/runtime-turn-record.js";

async function getOpencodeModels(): Promise<string[]> {
  try {
    const output = execSync("opencode models", { encoding: "utf8" });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

async function getCodexModels(): Promise<string[]> {
  try {
    const { spawn } = await import("node:child_process");
    return await new Promise<string[]>((resolve) => {
      const proc = spawn("codex", ["app-server"], {
        stdio: ["pipe", "pipe", "ignore"],
      });
      let buffer = "";
      const timer = setTimeout(() => {
        proc.kill();
        resolve([]);
      }, 5_000);
      proc.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const msg = JSON.parse(trimmed) as Record<string, unknown>;
            if (msg.id === 1 && msg.result) {
              clearTimeout(timer);
              proc.kill();
              const data = (msg.result as { data?: Array<{ id: string }> }).data ?? [];
              resolve(data.map((m) => m.id).filter(Boolean));
              return;
            }
          } catch {
            // not JSON yet, keep buffering
          }
        }
      });
      proc.on("error", () => { clearTimeout(timer); resolve([]); });
      proc.on("close", () => { clearTimeout(timer); resolve([]); });
      // Send model/list request once process is ready
      setTimeout(() => {
        try {
          proc.stdin.write(JSON.stringify({ method: "model/list", id: 1, params: { limit: 100, includeHidden: false } }) + "\n");
        } catch {
          // process may have exited
        }
      }, 300);
    });
  } catch {
    return [];
  }
}

/**
 * Provider switch handler - called by the gateway when user switches provider.
 */
export type OnProviderSwitch = (provider: string) => void | Promise<void>;

export interface TuiGatewayOptions {
  /** Port for the TUI gateway. Default: 4801. */
  readonly port?: number;
  /**
   * Multi-provider session manager (injected by packages/cli/src/commands/tui.ts).
   * Provides factory + provider/model get/set for cross-provider session support.
   */
  readonly sessionManager: {
    readonly factory: CliSessionFactory;
    getProvider: () => string;
    setProvider: (provider: string) => void;
    getModel: () => string;
    setModel: (model: string) => void;
  };
  /** System prompt for the TUI session. Default: "You are a helpful assistant." */
  readonly systemPrompt?: string;
  /**
   * Optional callback invoked when the TUI sends a { type: "clear" } frame.
   * Should reset the persisted session ID so the next turn starts fresh.
   * Fail-open: errors are swallowed and { type: "cleared" } is still sent.
   */
  readonly onClear?: () => Promise<void>;
  /** Optional callback invoked when user switches provider in TUI. */
  readonly onProviderSwitch?: OnProviderSwitch;
  /** Optional context-artifact cache used to hydrate and persist runtime summaries. */
  readonly contextArtifactCache?: ContextArtifactCache;
  /** Event bus for listening to approval events. */
  readonly eventBus?: EventBus;
  /** Whether plan mode is active (read-only planning). */
  readonly planMode?: boolean;
}

export interface TuiGateway {
  /** WebSocket URL to connect to. e.g. "ws://localhost:4801/tui/ws" */
  readonly url: string;
  readonly port: number;
  readonly models: Record<string, string[]>;
  /** Gracefully stop the gateway server. */
  shutdown(): void;
}

const TUI_APP_NAME = "kiln-tui";
const TUI_TENANT_ID = "_tui";

export interface TuiAuthorityStatus {
  readonly effective: "fail_closed" | "read_only" | "idempotent" | "audited" | "destructive" | "unknown";
  readonly completeness: "authoritative" | "partial";
}

export function buildTuiPerCallToolConfig(): PerCallToolConfig {
  return buildAttachedRuntimePerCallToolConfig({
    tenantId: TUI_TENANT_ID,
  });
}

export function deriveTuiAuthorityStatusFromPerCallConfig(
  config: PerCallToolConfig,
): TuiAuthorityStatus {
  const hasAllowlist = config.toolAllowlist !== undefined;
  const allowlistSize = config.toolAllowlist?.size ?? 0;
  const authorityMap = config.toolAuthority;
  const hasAuthorityMap = authorityMap instanceof Map;
  const authoritySize = authorityMap?.size ?? 0;

  if (hasAllowlist && allowlistSize === 0) {
    return { effective: "fail_closed", completeness: "authoritative" };
  }

  if (!hasAuthorityMap) {
    return { effective: "unknown", completeness: "partial" };
  }
  if (authoritySize === 0) {
    return { effective: "unknown", completeness: "partial" };
  }

  let sawReadOnly = false;
  let sawIdempotent = false;
  let sawAudited = false;
  for (const descriptor of authorityMap.values()) {
    if (!descriptor) {
      return { effective: "unknown", completeness: "partial" };
    }
    if (descriptor.level === 4 || descriptor.requiresApproval || !descriptor.allowed) {
      return { effective: "destructive", completeness: "authoritative" };
    }
    if (descriptor.level === 1) sawReadOnly = true;
    else if (descriptor.level === 2) sawIdempotent = true;
    else sawAudited = true;
  }

  if (sawAudited) return { effective: "audited", completeness: "authoritative" };
  if (sawIdempotent) return { effective: "idempotent", completeness: "authoritative" };
  if (sawReadOnly) return { effective: "read_only", completeness: "authoritative" };
  return { effective: "unknown", completeness: "partial" };
}

export function buildTuiWelcomeFramePayload(input: {
  readonly models: Record<string, string[]>;
  readonly planMode: boolean;
  readonly authorityStatus: TuiAuthorityStatus;
}): {
  readonly type: "welcome";
  readonly models: Record<string, string[]>;
  readonly planMode: boolean;
  readonly authorityStatus: TuiAuthorityStatus;
} {
  return {
    type: "welcome",
    models: input.models,
    planMode: input.planMode,
    authorityStatus: input.authorityStatus,
  };
}

export function buildTuiTurnPerCallConfig(
  activeProvider: string,
  activeModel: string | undefined,
  builtinToolSurface: AttachedRuntimeBuiltinToolSurface = createAttachedRuntimeBuiltinToolSurface(),
): PerCallToolConfig {
  return buildAttachedRuntimePerCallToolConfig({
    tenantId: TUI_TENANT_ID,
    activeProvider,
    activeModel,
    builtinToolSurface,
  });
}

export function buildTuiDoneFramePayload(input: {
  readonly content: string;
  readonly parts: readonly unknown[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly routedProvider: string;
  readonly routedModel: string;
  readonly runtimeContinuity: {
    readonly strategy: string;
    readonly feedbackLabel?: string;
    readonly pressure?: string;
    readonly supportArtifactCount?: number;
    readonly supportArtifactSources?: readonly string[];
    readonly fallbackLabel?: string;
    readonly usedCachedSupport?: boolean;
    readonly selectionReason?: string;
  };
  readonly authorityStatus: TuiAuthorityStatus;
}): {
  readonly type: "done";
  readonly content: string;
  readonly parts: readonly unknown[];
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly routedProvider: string;
  readonly routedModel: string;
  readonly runtimeContinuity: {
    readonly strategy: string;
    readonly feedbackLabel?: string;
    readonly pressure?: string;
    readonly supportArtifactCount?: number;
    readonly supportArtifactSources?: readonly string[];
    readonly fallbackLabel?: string;
    readonly usedCachedSupport?: boolean;
    readonly selectionReason?: string;
  };
  readonly authorityStatus: TuiAuthorityStatus;
} {
  return {
    type: "done",
    content: input.content,
    parts: input.parts,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    routedProvider: input.routedProvider,
    routedModel: input.routedModel,
    runtimeContinuity: input.runtimeContinuity,
    authorityStatus: input.authorityStatus,
  };
}

/**
 * Start the in-process TUI gateway.
 *
 * Returns immediately after the server is listening.
 * The caller (tui.ts CLI command) holds the returned TuiGateway and calls
 * shutdown() on process exit.
 */
export async function startTuiGateway(options: TuiGatewayOptions): Promise<TuiGateway> {
  const port = options.port ?? 4801;
  const providerLabel = options.sessionManager.getProvider();
  const systemPrompt = options.systemPrompt ?? "You are a helpful assistant.";

  const approvalRegistry = new ApprovalGateRegistry();

  // Activity streamer: bridges CLI session events to the active WS connection
  const activityStreamer = new TuiActivityStreamer(approvalRegistry);
  const builtinToolSurface = createAttachedRuntimeBuiltinToolSurface();

  const executor = new CliSubscriptionExecutor(
    options.sessionManager.factory,
    providerLabel,
    (event) => activityStreamer.forward(event),
  );
  const eventBus = options.eventBus ?? new EventBus(100);
  const orchestrator = new RuntimeSessionOrchestrator({
    provider: executor,
    eventBus,
    builtinTools: builtinToolSurface.callBuiltinTools,
  });
  const sessionRegistry = new SessionRegistry();
  activityStreamer.bindApprovalBridge({
    approve: (sessionId) => orchestrator.continue(sessionId),
    reject: (sessionId, reason) => orchestrator.emitApprovalReceived(false, reason, sessionId),
  });

  const { upgradeWebSocket, websocket } = createBunWebSocket();

  const app = new Hono();

  // Health check — polled by the CLI to confirm gateway is ready
  app.get("/health", (c) => c.json({ status: "ok", channel: "tui" }));

  // TUI WebSocket endpoint — no widgetId, no tenant, just userId
  app.get(
    "/tui/ws",
    upgradeWebSocket((c) => {
      const userId = c.req.query("userId") ?? crypto.randomUUID();

      return {
        async onOpen(_event: Event, ws: WSContext) {
          activityStreamer.register(ws, eventBus);
          const activeProvider = options.sessionManager.getProvider();
          const activeModel = options.sessionManager.getModel() || undefined;
          const authorityStatus = deriveTuiAuthorityStatusFromPerCallConfig(
            buildTuiTurnPerCallConfig(activeProvider, activeModel, builtinToolSurface),
          );
          ws.send(JSON.stringify(buildTuiWelcomeFramePayload({
            models: {
              claude: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001", "sonnet", "opus", "haiku"],
              codex: codexModels.length > 0 ? codexModels : ["o4-mini", "o3", "o3-mini"],
              opencode: opencodeModels,
            },
            planMode: options.planMode ?? false,
            authorityStatus,
          })));
        },

        async onMessage(event: MessageEvent, ws: WSContext) {
          try {
            const raw = typeof event.data === "string"
              ? event.data
              : new TextDecoder().decode(event.data as ArrayBuffer);

            const frame = JSON.parse(raw) as Record<string, unknown>;

            if (frame.type === "clear") {
              try {
                await options.onClear?.();
              } catch {
                // Fail-open: log nothing, still acknowledge
              }
              ws.send(JSON.stringify({ type: "cleared" }));
              return;
            }

            if (frame.type === "provider") {
              const newProvider: string = typeof frame.provider === "string" ? frame.provider : "claude";
              const newModel: string | undefined = typeof frame.model === "string" ? frame.model : undefined;
              options.sessionManager.setProvider(newProvider);
              if (newModel !== undefined) {
                options.sessionManager.setModel(newModel);
              }
              options.onProviderSwitch?.(newProvider);
              ws.send(JSON.stringify({ type: "provider_changed", provider: newProvider }));
              return;
            }

            // Handle plan mode execution transition
            if (frame.type === "exec") {
              if (!options.planMode) {
                ws.send(JSON.stringify({ type: "error", message: "Not in plan mode" }));
                return;
              }
              ws.send(JSON.stringify({ type: "exec_confirmed" }));
              return;
            }

            // Handle approval responses from TUI
            if (frame.type === "approve") {
              const sessionId = typeof frame.sessionId === "string" ? frame.sessionId : undefined;
              const result = approvalRegistry.approve(sessionId);
              if (!result.ok) {
                ws.send(JSON.stringify({ type: "error", message: result.error ?? "Approval failed" }));
              }
              return;
            }
            if (frame.type === "reject") {
              const sessionId = typeof frame.sessionId === "string" ? frame.sessionId : undefined;
              const reason = typeof frame.reason === "string" ? frame.reason : "rejected by user";
              const result = approvalRegistry.reject(reason, sessionId);
              if (!result.ok) {
                ws.send(JSON.stringify({ type: "error", message: result.error ?? "Rejection failed" }));
              }
              return;
            }

            if (frame.type !== "message") return;

            const userContent = typeof frame.content === "string"
              ? frame.content
              : "";

            if (!userContent.trim()) return;
            // Send "thinking" status to indicate work has started
            ws.send(JSON.stringify({ type: "thinking" }));
            let result;
            try {
              const activeProvider = options.sessionManager.getProvider();
              const activeModel = options.sessionManager.getModel() || undefined;
              result = await processAdmittedTurn({
                orchestrator,
                sessionRegistry,
                appName: TUI_APP_NAME,
                tenantId: TUI_TENANT_ID,
                userId,
                systemPrompt,
                userParts: textParts(userContent),
                channel: "tui",
                contextArtifactCache: options.contextArtifactCache,
                perCallConfig: buildTuiTurnPerCallConfig(activeProvider, activeModel, builtinToolSurface),
                turnCapture: {
                  start: (sessionId) => {
                    activityStreamer.beginTurnCapture(sessionId);
                  },
                  finish: (sessionId) => activityStreamer.endTurnCapture(sessionId),
                  abort: (sessionId) => {
                    activityStreamer.endTurnCapture(sessionId);
                  },
                },
              });
            } catch (err) {
              ws.send(JSON.stringify({
                type: "error",
                message: err instanceof Error ? err.message : String(err),
              }));
              return;
            }

            if (!result.ok) {
              ws.send(JSON.stringify({
                type: "error",
                message: result.budgetDenied.message,
              }));
              return;
            }
            const output = result.result;
            const runtimeContinuity = output.runtimeContinuity ?? { strategy: "none" };

            const authorityStatus = deriveTuiAuthorityStatusFromPerCallConfig(
              buildTuiTurnPerCallConfig(
                output.routingDecision?.provider ?? options.sessionManager.getProvider(),
                output.routingDecision?.model ?? options.sessionManager.getModel(),
                builtinToolSurface,
              ),
            );
            ws.send(JSON.stringify(buildTuiDoneFramePayload({
              content: extractText(output.parts),
              parts: output.parts,
              inputTokens: output.inputTokens,
              outputTokens: output.outputTokens,
              routedProvider: output.routingDecision?.provider ?? options.sessionManager.getProvider(),
              routedModel: output.routingDecision?.model ?? options.sessionManager.getModel(),
              runtimeContinuity,
              authorityStatus,
            })));
          } catch {
            // Discard malformed frames
          }
        },

        onClose(_event: CloseEvent, ws: WSContext) {
          activityStreamer.unregister(ws);
          // Session persists across reconnects (stored in sessionRegistry)
        },
      };
    }),
  );

  const [opencodeModels, codexModels] = await Promise.all([
    getOpencodeModels(),
    getCodexModels(),
  ]);

  const server = Bun.serve({
    port,
    fetch: app.fetch,
    websocket,
  });

  return {
    url: `ws://localhost:${port}/tui/ws`,
    port,
    models: {
      claude: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001", "sonnet", "opus", "haiku"],
      codex: codexModels.length > 0 ? codexModels : ["o4-mini", "o3", "o3-mini"],
      opencode: opencodeModels,
    },
    shutdown: () => server.stop(),
  };
}

/**
 * Bridges CLI session events to the active WebSocket connection.
 *
 * The TUI gateway has exactly one WS connection at a time. This class
 * holds a reference to the current WS and forwards activity events
 * (tool_use, tool_result, cost_update, thinking) as they arrive from
 * the CliSubscriptionExecutor.
 */
class TuiActivityStreamer {
  private readonly pendingApprovals = new Set<string>();
  private capture: {
    sessionId: string;
    fileChanges: RuntimeTurnFileChange[];
    approvalTransitions: RuntimeTurnApprovalTransition[];
    authorityDecisions: RuntimeTurnAuthorityDecision[];
  } | null = null;
  private ws: WSContext | null = null;
  private eventBus: EventBus | null = null;
  private approvalHandler: ((event: import("@kilnai/core").KilnEvent) => void) | null = null;
  private receivedHandler: ((event: import("@kilnai/core").KilnEvent) => void) | null = null;
  private authorizedHandler: ((event: import("@kilnai/core").KilnEvent) => void) | null = null;
  private approvalBridge: {
    approve: (sessionId: string) => void;
    reject: (sessionId: string, reason: string) => void;
  } | null = null;

  constructor(private readonly approvalRegistry: ApprovalGateRegistry) {}

  bindApprovalBridge(bridge: {
    approve: (sessionId: string) => void;
    reject: (sessionId: string, reason: string) => void;
  }): void {
    this.approvalBridge = bridge;
  }

  beginTurnCapture(sessionId: string): void {
    this.capture = {
      sessionId,
      fileChanges: [],
      approvalTransitions: [],
      authorityDecisions: [],
    };
  }

  endTurnCapture(sessionId: string): {
    fileChanges: readonly RuntimeTurnFileChange[];
    approvalTransitions: readonly RuntimeTurnApprovalTransition[];
    authorityDecisions: readonly RuntimeTurnAuthorityDecision[];
  } {
    if (!this.capture || this.capture.sessionId !== sessionId) {
      return { fileChanges: [], approvalTransitions: [], authorityDecisions: [] };
    }
    const captured = {
      fileChanges: [...this.capture.fileChanges],
      approvalTransitions: [...this.capture.approvalTransitions],
      authorityDecisions: [...this.capture.authorityDecisions],
    };
    this.capture = null;
    return captured;
  }

  register(ws: WSContext, eventBus?: EventBus): void {
    this.ws = ws;
    this.eventBus = eventBus ?? null;
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    if (!this.eventBus) return;

    this.approvalHandler = (event: KilnEvent) => {
      if (event.type === "approval_requested") {
        const approvalEvent = event as unknown as ApprovalRequestedEvent;
        const sessionId = approvalEvent.sessionId;
        if (sessionId) {
          this.pendingApprovals.add(sessionId);
          if (this.capture && this.capture.sessionId === sessionId) {
            this.capture.approvalTransitions.push({
              status: "requested",
              sessionId,
              reason: approvalEvent.description,
            });
          }
          this.approvalRegistry.register(sessionId, {
            approve: () => this.approvalBridge?.approve(sessionId),
            reject: (reason: string) => this.approvalBridge?.reject(sessionId, reason),
            status: () => (this.pendingApprovals.has(sessionId) ? "awaiting_approval" : "resolved"),
          });
        }
        if (this.ws) {
          this.ws.send(JSON.stringify({
            type: "approval_requested",
            description: approvalEvent.description,
            sessionId,
          }));
        }
      }
    };
    this.eventBus.onAny(this.approvalHandler);

    this.receivedHandler = (event: KilnEvent) => {
      if (event.type === "approval_received") {
        const receivedEvent = event as unknown as ApprovalReceivedEvent;
        const sessionId = receivedEvent.sessionId;
        if (sessionId) {
          this.pendingApprovals.delete(sessionId);
          if (this.capture && this.capture.sessionId === sessionId) {
            this.capture.approvalTransitions.push({
              status: receivedEvent.approved ? "approved" : "rejected",
              sessionId,
              reason: receivedEvent.reason,
            });
          }
          this.approvalRegistry.unregister(sessionId);
        }
        if (this.ws) {
          this.ws.send(JSON.stringify({
            type: "approval_received",
            approved: receivedEvent.approved,
            reason: receivedEvent.reason,
            sessionId,
          }));
        }
      }
    };
    this.eventBus.onAny(this.receivedHandler);

    this.authorizedHandler = (event: KilnEvent) => {
      if (event.type === "tool_authorized") {
        const authorizedEvent = event as ToolAuthorizedEvent;
        const sessionId = authorizedEvent.sessionId;
        if (sessionId && this.capture && this.capture.sessionId === sessionId) {
          this.capture.authorityDecisions.push({
            toolName: authorizedEvent.toolName,
            level: authorizedEvent.level,
            allowed: authorizedEvent.allowed,
            reason: authorizedEvent.reason,
          });
        }
      }
    };
    this.eventBus.onAny(this.authorizedHandler);
  }

  unregister(ws: WSContext): void {
    if (this.ws === ws) {
      this.ws = null;
    }
    if (this.eventBus && this.approvalHandler) {
      this.eventBus.offAny(this.approvalHandler);
      this.approvalHandler = null;
    }
    if (this.eventBus && this.receivedHandler) {
      this.eventBus.offAny(this.receivedHandler);
      this.receivedHandler = null;
    }
    if (this.eventBus && this.authorizedHandler) {
      this.eventBus.offAny(this.authorizedHandler);
      this.authorizedHandler = null;
    }
    this.eventBus = null;
    this.capture = null;
  }

  forward(event: CliSessionEvent): void {
    if (!this.ws) return;

    // Only forward activity events, not raw text deltas or completion
    if (event.type === "tool_use") {
      this.ws.send(JSON.stringify({
        type: "activity",
        activity: "tool_use",
        toolName: event.toolName,
        input: event.input,
      }));
    } else if (event.type === "tool_result") {
      this.ws.send(JSON.stringify({
        type: "activity",
        activity: "tool_result",
        toolName: event.toolName,
        output: event.output,
      }));
    } else if (event.type === "file_changed") {
      if (this.capture) {
        this.capture.fileChanges.push({
          path: event.path,
          changeType: event.changeType,
          linesAdded: event.linesAdded,
          linesRemoved: event.linesRemoved,
        });
      }
      this.ws.send(JSON.stringify({
        type: "activity",
        activity: "file_changed",
        path: event.path,
        changeType: event.changeType,
        linesAdded: event.linesAdded,
        linesRemoved: event.linesRemoved,
      }));
    } else if (event.type === "cost_update") {
      this.ws.send(JSON.stringify({
        type: "activity",
        activity: "cost_update",
        usd: event.usd,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
      }));
    }
    // text_delta, completed, error are handled by the gateway's done frame
    // approval_requested/approval_received come via eventBus, not CliSessionEvent
  }
}
