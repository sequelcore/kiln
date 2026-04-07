import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import { execSync } from "node:child_process";
import { ModeBOrchestrator } from "../session/mode-b-orchestrator.js";
import { SessionRegistry } from "../session/session-registry.js";
import { textParts, extractText, EventBus, type ApprovalRequestedEvent, type ApprovalReceivedEvent, type KilnEvent } from "@kilnai/core";
import type { ContextArtifactCache } from "@kilnai/core";
import { CliSubscriptionExecutor } from "../execution/cli-subscription-executor.js";
import type { CliSessionFactory, CliSessionEvent } from "../execution/cli-subscription-executor.js";
import { ApprovalGateRegistry, ApprovalTarget } from "./approval-registry.js";
import {
  classifyRuntimeContextPressure,
  formatRuntimeResumeFeedbackLabel,
  formatRuntimeResumeDecision,
  normalizeRuntimeTaskShape,
  readRuntimeSupportArtifactsDetailed,
  writeRuntimeContinuityOutcomeArtifact,
  writeRuntimeContextBundleArtifact,
  writeRuntimeThreadSummaryArtifact,
  writeRuntimeToolBundleArtifact,
} from "../session/context-artifact-summary.js";

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

  // Activity streamer: bridges CLI session events to the active WS connection
  const activityStreamer = new TuiActivityStreamer();

  const executor = new CliSubscriptionExecutor(
    options.sessionManager.factory,
    providerLabel,
    (event) => activityStreamer.forward(event),
  );
  const eventBus = options.eventBus ?? new EventBus(100);
  const orchestrator = new ModeBOrchestrator({ provider: executor, eventBus });
  const approvalRegistry = new ApprovalGateRegistry();
  const sessionRegistry = new SessionRegistry();

  // Register orchestrator with approval registry for approval frame handling
  const approvalTarget: ApprovalTarget = {
    approve: () => orchestrator.continue?.(),
    reject: (reason: string) => orchestrator.emitApprovalReceived(false, reason),
    status: () => "awaiting_approval", // Simplified: always treat as awaiting_approval when approve is called
  };
  approvalRegistry.register("tui-session", approvalTarget);

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
          activityStreamer.register(ws, options.eventBus);
          ws.send(JSON.stringify({
            type: "welcome",
            models: {
              claude: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001", "sonnet", "opus", "haiku"],
              codex: codexModels.length > 0 ? codexModels : ["o4-mini", "o3", "o3-mini"],
              opencode: opencodeModels,
            },
            planMode: options.planMode ?? false,
          }));
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
            const taskShape = normalizeRuntimeTaskShape(userContent);

            // Send "thinking" status to indicate work has started
            ws.send(JSON.stringify({ type: "thinking" }));

            const session = await sessionRegistry.getOrCreate({
              appName: TUI_APP_NAME,
              tenantId: TUI_TENANT_ID,
              userId,
              systemPrompt,
            });

            const runtimeSupport = readRuntimeSupportArtifactsDetailed(options.contextArtifactCache, {
              session,
              channel: "tui",
              providerHint: session.sessionLedger.lastProvider,
              taskShape,
            });
            let result;
            try {
              const recalledRuntimeSummary = runtimeSupport.content;
              session.addExactArtifact(formatRuntimeResumeDecision(runtimeSupport.decision));
              result = await orchestrator.processMessage(
                session,
                textParts(userContent),
                recalledRuntimeSummary,
              );
            } catch (err) {
              ws.send(JSON.stringify({
                type: "error",
                message: err instanceof Error ? err.message : String(err),
              }));
              return;
            }

            session.accumulateTokens(result.inputTokens + result.outputTokens);
            session.updateSessionLedger({
              currentPhase: result.queued ? "queued" : "responded",
              lastProvider: result.routingDecision?.provider ?? session.sessionLedger.lastProvider,
              toolCallCount: result.toolExecutions?.length ?? session.sessionLedger.toolCallCount,
              turnDepth: session.userTurnCount,
              lastSummary: result.contextSummary,
            });
            if (result.routingDecision) {
              session.addExactArtifact(`Runtime routed provider: ${result.routingDecision.provider}/${result.routingDecision.model}`);
            }
            if (result.contextSummary) {
              session.addExactArtifact(`Runtime context summary: ${result.contextSummary}`);
            }
            if (result.toolExecutions) {
              for (const exec of result.toolExecutions) {
                session.addExactArtifact(`Tool execution: ${exec.toolName} (${exec.success ? "success" : "error"})`);
                if (exec.resultSummary.trim() !== "") {
                  session.addExactArtifact(`Tool result summary: ${exec.resultSummary}`);
                }
              }
            }
            writeRuntimeThreadSummaryArtifact(options.contextArtifactCache, session);
            writeRuntimeContextBundleArtifact(options.contextArtifactCache, {
              appName: session.appName,
              tenantId: session.tenantId,
              channel: "tui",
              provider: result.routingDecision?.provider ?? session.sessionLedger.lastProvider ?? "unknown",
              taskShape,
              contextSummary: result.contextSummary,
            });
            writeRuntimeToolBundleArtifact(options.contextArtifactCache, {
              appName: session.appName,
              tenantId: session.tenantId,
              channel: "tui",
              taskShape,
              toolExecutions: result.toolExecutions,
            });
            writeRuntimeContinuityOutcomeArtifact(options.contextArtifactCache, {
              session,
              channel: "tui",
              taskShape,
              decision: runtimeSupport.decision,
              queued: result.queued,
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
              toolCount: result.toolExecutions?.length,
              provider: result.routingDecision?.provider ?? session.sessionLedger.lastProvider,
              model: result.routingDecision?.model,
            });

            await sessionRegistry.save(session);

            ws.send(JSON.stringify({
              type: "done",
              content: extractText(result.parts),
              parts: result.parts,
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
              runtimeContinuity: {
                strategy: runtimeSupport.decision.resumeStrategy,
                feedbackLabel: formatRuntimeResumeFeedbackLabel(runtimeSupport.decision),
                pressure: classifyRuntimeContextPressure(runtimeSupport.supportArtifactCount),
                supportArtifactCount: runtimeSupport.supportArtifactCount,
                supportArtifactSources: runtimeSupport.supportArtifactSources,
                fallbackLabel: runtimeSupport.fallbackLabel,
                usedCachedSupport: runtimeSupport.usedCachedSupport,
                selectionReason: runtimeSupport.selectionReason,
              },
            }));
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
  private ws: WSContext | null = null;
  private eventBus: EventBus | null = null;
  private approvalHandler: ((event: import("@kilnai/core").KilnEvent) => void) | null = null;
  private receivedHandler: ((event: import("@kilnai/core").KilnEvent) => void) | null = null;

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
        if (this.ws) {
          this.ws.send(JSON.stringify({
            type: "approval_requested",
            description: approvalEvent.description,
            sessionId: approvalEvent.sessionId,
          }));
        }
      }
    };
    this.eventBus.onAny(this.approvalHandler);

    this.receivedHandler = (event: KilnEvent) => {
      if (event.type === "approval_received") {
        const receivedEvent = event as unknown as ApprovalReceivedEvent;
        if (this.ws) {
          this.ws.send(JSON.stringify({
            type: "approval_received",
            approved: receivedEvent.approved,
            reason: receivedEvent.reason,
          }));
        }
      }
    };
    this.eventBus.onAny(this.receivedHandler);
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
    this.eventBus = null;
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
