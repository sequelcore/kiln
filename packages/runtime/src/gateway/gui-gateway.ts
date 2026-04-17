import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { Hono } from "hono";
import { createBunWebSocket, serveStatic } from "hono/bun";
import type { WSContext } from "hono/ws";
import {
  EventBus,
  extractText,
  textParts,
  type ApprovalReceivedEvent,
  type ApprovalRequestedEvent,
  type KilnEvent,
} from "@kilnai/core";
import { CliSubscriptionExecutor } from "../execution/cli-subscription-executor.js";
import type { CliSessionEvent } from "../execution/cli-subscription-executor.js";
import { ModeBOrchestrator } from "../session/mode-b-orchestrator.js";
import { SessionRegistry } from "../session/session-registry.js";
import { ApprovalGateRegistry } from "./approval-registry.js";
import {
  classifyRuntimeContextPressure,
  formatRuntimeResumeDecision,
  formatRuntimeResumeFeedbackLabel,
  normalizeRuntimeTaskShape,
  readRuntimeSupportArtifactsDetailed,
} from "../session/context-artifact-summary.js";
import {
  applyRuntimeTurnRecord,
  type RuntimeTurnApprovalTransition,
  type RuntimeTurnFileChange,
} from "../session/runtime-turn-record.js";
import type { OnProviderSwitch, OnResumeSession, OperatorSessionTransportOptions } from "./operator-gateway.js";

export interface GuiProviderDescriptor {
  readonly id: string;
  readonly label: string;
  readonly group: "subscription" | "harness" | "direct";
  readonly available: boolean;
}

export interface GuiSessionSummary {
  readonly id: string;
  readonly provider: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly costUsd: number;
}

export interface GuiTelemetrySnapshot {
  readonly status: string;
  readonly dominantRegions: readonly string[];
  readonly saturation: number;
  readonly entropy: number;
}

export interface GuiDashboardSnapshot {
  readonly providers: readonly GuiProviderDescriptor[];
  readonly sessions: readonly GuiSessionSummary[];
  readonly telemetry: GuiTelemetrySnapshot;
}

export interface GuiSessionMeta {
  readonly kilnSessionId: string;
  readonly provider: string;
  readonly task: string;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly costUsd?: number;
  readonly toolCount?: number;
  readonly turnDepth?: number;
  readonly providerSessionId?: string;
  readonly resumeStrategy?: string;
  readonly resumeFeedback?: {
    readonly sampleSize: number;
    readonly preferredStrategy?: string;
    readonly influencedChoice: boolean;
  };
  readonly resumeOutcome?: {
    readonly succeeded: boolean;
    readonly finalProvider?: string;
    readonly costUsd: number;
    readonly toolCallCount: number;
    readonly durationMs: number;
    readonly verificationPassed?: boolean;
  };
  readonly sessionLedger?: {
    readonly currentPhase: string;
    readonly resumedFrom?: string;
    readonly workingDirectory?: string;
    readonly worktreePath?: string;
    readonly lastError?: string;
    readonly lastProvider?: string;
    readonly toolCallCount?: number;
    readonly turnDepth?: number;
  };
  readonly exactArtifacts?: readonly string[];
}

export interface GuiSessionTranscriptLine {
  readonly seq: number;
  readonly ts: string;
  readonly type: string;
  readonly data: Record<string, unknown>;
}

export interface GuiSessionDetail {
  readonly id: string;
  readonly meta: GuiSessionMeta;
  readonly transcript: readonly GuiSessionTranscriptLine[];
}

export type GuiOutboundFrame =
  | { type: "message"; content: string }
  | { type: "clear" }
  | { type: "provider"; provider: string; model?: string }
  | { type: "resume"; sessionId: string; provider: string }
  | { type: "approve"; sessionId?: string }
  | { type: "reject"; reason: string; sessionId?: string }
  | { type: "exec" };

export type GuiInboundFrame =
  | { type: "thinking" }
  | {
      type: "activity";
      activity: string;
      toolName?: string;
      output?: string;
      usd?: number;
      input?: unknown;
      inputTokens?: number;
      outputTokens?: number;
      details?: string;
      sessionId?: string;
      path?: string;
      changeType?: "created" | "modified" | "deleted";
      linesAdded?: number;
      linesRemoved?: number;
    }
  | {
      type: "done";
      content: string;
      parts?: readonly unknown[];
      inputTokens: number;
      outputTokens: number;
      routedProvider?: string;
      routedModel?: string;
      runtimeContinuity?: {
        strategy: string;
        feedbackLabel?: string;
        pressure?: string;
        supportArtifactCount?: number;
        supportArtifactSources?: readonly string[];
        fallbackLabel?: string;
        usedCachedSupport?: boolean;
        selectionReason?: string;
      };
    }
  | { type: "error"; message: string; code?: string }
  | { type: "welcome"; greeting?: string; models?: Record<string, string[]>; planMode?: boolean }
  | { type: "exec_confirmed" }
  | { type: "cleared" }
  | { type: "provider_changed"; provider: string }
  | { type: "resume_selected"; sessionId: string; provider: string }
  | { type: "approval_requested"; description: string; sessionId: string }
  | { type: "approval_received"; approved: boolean; reason?: string; sessionId?: string };

export interface StartGuiGatewayOptions {
  readonly port?: number;
  readonly guiDistPath?: string;
  readonly getSnapshot: () => Promise<GuiDashboardSnapshot>;
  readonly getSessionDetail?: (sessionId: string) => Promise<GuiSessionDetail | null>;
  readonly operatorTransport?: OperatorSessionTransportOptions;
}

export interface GuiGateway {
  readonly port: number;
  readonly url: string;
  readonly apiUrl: string;
  readonly operatorWsUrl?: string;
  readonly operatorModels?: Record<string, string[]>;
  readonly hasMountedGui: boolean;
  shutdown(): void;
}

const GUI_APP_NAME = "kiln-gui";
const GUI_TENANT_ID = "_gui";
const DEFAULT_CLAUDE_MODELS = ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001", "sonnet", "opus", "haiku"];
const DEFAULT_CODEX_MODELS = ["o4-mini", "o3", "o3-mini"];

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
              resolve(data.map((model) => model.id).filter(Boolean));
              return;
            }
          } catch {
            // ignore malformed json while bootstrapping app-server
          }
        }
      });
      proc.on("error", () => {
        clearTimeout(timer);
        resolve([]);
      });
      proc.on("close", () => {
        clearTimeout(timer);
        resolve([]);
      });
      setTimeout(() => {
        try {
          proc.stdin.write(JSON.stringify({
            method: "model/list",
            id: 1,
            params: { limit: 100, includeHidden: false },
          }) + "\n");
        } catch {
          // process may already be closed
        }
      }, 300);
    });
  } catch {
    return [];
  }
}

export async function startGuiGateway(options: StartGuiGatewayOptions): Promise<GuiGateway> {
  const port = options.port ?? 4810;
  const app = new Hono();
  const guiDistPath = resolveGuiDistPath(options.guiDistPath);
  const hasMountedGui = guiDistPath !== undefined;
  const transportOptions = options.operatorTransport;

  const { upgradeWebSocket, websocket } = createBunWebSocket();
  const operatorModels = transportOptions
    ? await resolveOperatorModels()
    : undefined;

  let operatorWsUrl: string | undefined;

  app.use("/gui/api/*", async (c, next) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Headers", "Content-Type, Accept");
    c.header("Access-Control-Allow-Methods", "GET, OPTIONS");

    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }

    await next();
  });

  app.get("/health", (c) => c.json({ status: "ok", channel: "gui" }));

  app.get("/gui/api/dashboard", async (c) => {
    const snapshot = await options.getSnapshot();
    return c.json(snapshot);
  });

  app.get("/gui/api/sessions/:sessionId", async (c) => {
    const sessionId = c.req.param("sessionId").trim();
    const sessionDetail = sessionId.length > 0 && options.getSessionDetail
      ? await options.getSessionDetail(sessionId)
      : null;
    if (!sessionDetail) {
      return c.json({
        error: "session_not_found",
        message: `Session '${sessionId || "unknown"}' was not found.`,
      }, 404);
    }
    return c.json(sessionDetail);
  });

  if (transportOptions && operatorModels) {
    wireOperatorTransport(app, upgradeWebSocket, {
      port,
      transport: transportOptions,
      models: operatorModels,
      onReady: (url) => {
        operatorWsUrl = url;
      },
    });
  }

  app.get("/gui", (c) => c.redirect("/gui/"));

  if (guiDistPath) {
    app.use("/gui/*", serveStatic({
      root: guiDistPath,
      rewriteRequestPath: (path) => {
        const stripped = path.replace(/^\/gui/, "");
        return stripped === "/" || stripped === "" ? "/index.html" : stripped;
      },
    }));

    app.get("/gui/*", (c) => {
      const html = readFileSync(join(guiDistPath, "index.html"), "utf-8");
      return c.html(html);
    });
  } else {
    app.get("/gui/", (c) => c.html(renderGuiBootstrapPage(port)));
  }

  const server = Bun.serve({
    port,
    fetch: app.fetch,
    websocket,
  });

  return {
    port,
    url: `http://localhost:${port}/gui/`,
    apiUrl: `http://localhost:${port}/gui/api/dashboard`,
    operatorWsUrl,
    operatorModels,
    hasMountedGui,
    shutdown: () => server.stop(),
  };
}

async function resolveOperatorModels(): Promise<Record<string, string[]>> {
  const [opencodeModels, codexModels] = await Promise.all([
    getOpencodeModels(),
    getCodexModels(),
  ]);
  return {
    claude: [...DEFAULT_CLAUDE_MODELS],
    codex: codexModels.length > 0 ? codexModels : [...DEFAULT_CODEX_MODELS],
    opencode: opencodeModels,
  };
}

function wireOperatorTransport(
  app: Hono,
  upgradeWebSocket: ReturnType<typeof createBunWebSocket>["upgradeWebSocket"],
  input: {
    port: number;
    transport: OperatorSessionTransportOptions;
    models: Record<string, string[]>;
    onReady: (wsUrl: string) => void;
  },
): void {
  const providerLabel = input.transport.sessionManager.getProvider();
  const approvalRegistry = new ApprovalGateRegistry();
  const activityStreamer = new GuiActivityStreamer(approvalRegistry);
  const executor = new CliSubscriptionExecutor(
    input.transport.sessionManager.factory,
    providerLabel,
    (event) => activityStreamer.forward(event),
  );
  const eventBus = input.transport.eventBus ?? new EventBus(100);
  const orchestrator = new ModeBOrchestrator({ provider: executor, eventBus });
  const sessionRegistry = new SessionRegistry();

  activityStreamer.bindApprovalBridge({
    approve: (sessionId) => orchestrator.continue(sessionId),
    reject: (sessionId, reason) => orchestrator.emitApprovalReceived(false, reason, sessionId),
  });

  app.get(
    "/gui/ws",
    upgradeWebSocket((c) => {
      const userId = c.req.query("userId") ?? crypto.randomUUID();

      return {
        async onOpen(_event: Event, ws: WSContext) {
          activityStreamer.register(ws, eventBus);
          ws.send(JSON.stringify({
            type: "welcome",
            models: input.models,
            planMode: input.transport.planMode ?? false,
          } satisfies GuiInboundFrame));
        },

        async onMessage(event: MessageEvent, ws: WSContext) {
          try {
            const raw = typeof event.data === "string"
              ? event.data
              : new TextDecoder().decode(event.data as ArrayBuffer);

            const frame = JSON.parse(raw) as GuiOutboundFrame | Record<string, unknown>;

            if (frame.type === "clear") {
              try {
                await input.transport.onClear?.();
              } catch {
                // fail-open for parity with tui gateway clear behavior
              }
              ws.send(JSON.stringify({ type: "cleared" } satisfies GuiInboundFrame));
              return;
            }

            if (frame.type === "provider") {
              const newProvider = typeof frame.provider === "string" ? frame.provider : "claude";
              const newModel = typeof frame.model === "string" ? frame.model : undefined;
              input.transport.sessionManager.setProvider(newProvider);
              if (newModel !== undefined) {
                input.transport.sessionManager.setModel(newModel);
              }
              fireAndForgetProviderSwitch(input.transport.onProviderSwitch, newProvider);
              ws.send(JSON.stringify({ type: "provider_changed", provider: newProvider } satisfies GuiInboundFrame));
              return;
            }

            if (frame.type === "resume") {
              const sessionId = typeof frame.sessionId === "string" ? frame.sessionId.trim() : "";
              const provider = typeof frame.provider === "string" ? frame.provider.trim() : "";
              if (!sessionId || !provider) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: "Resume request must include sessionId and provider",
                } satisfies GuiInboundFrame));
                return;
              }
              try {
                await applyResumeSelection(input.transport.onResumeSession, sessionId, provider);
              } catch {
                ws.send(JSON.stringify({
                  type: "error",
                  message: "Resume selection failed",
                } satisfies GuiInboundFrame));
                return;
              }
              ws.send(JSON.stringify({
                type: "resume_selected",
                sessionId,
                provider,
              } satisfies GuiInboundFrame));
              return;
            }

            if (frame.type === "exec") {
              if (!input.transport.planMode) {
                ws.send(JSON.stringify({ type: "error", message: "Not in plan mode" } satisfies GuiInboundFrame));
                return;
              }
              ws.send(JSON.stringify({ type: "exec_confirmed" } satisfies GuiInboundFrame));
              return;
            }

            if (frame.type === "approve") {
              const sessionId = typeof frame.sessionId === "string" ? frame.sessionId : undefined;
              const result = approvalRegistry.approve(sessionId);
              if (!result.ok) {
                ws.send(JSON.stringify({ type: "error", message: result.error ?? "Approval failed" } satisfies GuiInboundFrame));
              }
              return;
            }

            if (frame.type === "reject") {
              const sessionId = typeof frame.sessionId === "string" ? frame.sessionId : undefined;
              const reason = typeof frame.reason === "string" ? frame.reason : "rejected by user";
              const result = approvalRegistry.reject(reason, sessionId);
              if (!result.ok) {
                ws.send(JSON.stringify({ type: "error", message: result.error ?? "Rejection failed" } satisfies GuiInboundFrame));
              }
              return;
            }

            if (frame.type !== "message") return;

            const userContent = typeof frame.content === "string" ? frame.content : "";
            if (!userContent.trim()) return;
            const taskShape = normalizeRuntimeTaskShape(userContent);

            ws.send(JSON.stringify({ type: "thinking" } satisfies GuiInboundFrame));

            const session = await sessionRegistry.getOrCreate({
              appName: GUI_APP_NAME,
              tenantId: GUI_TENANT_ID,
              userId,
              systemPrompt: input.transport.systemPrompt ?? "You are a helpful assistant.",
            });
            activityStreamer.beginTurnCapture(session.id);

            const runtimeSupport = readRuntimeSupportArtifactsDetailed(input.transport.contextArtifactCache, {
              session,
              channel: "gui",
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
              activityStreamer.endTurnCapture(session.id);
              ws.send(JSON.stringify({
                type: "error",
                message: err instanceof Error ? err.message : String(err),
              } satisfies GuiInboundFrame));
              return;
            }

            const turnCapture = activityStreamer.endTurnCapture(session.id);

            applyRuntimeTurnRecord({
              session,
              channel: "gui",
              taskShape,
              contextArtifactCache: input.transport.contextArtifactCache,
              continuityDecision: runtimeSupport.decision,
              queued: result.queued,
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
              contextSummary: result.contextSummary,
              toolExecutions: result.toolExecutions,
              routingDecision: result.routingDecision,
              fileChanges: turnCapture.fileChanges,
              approvalTransitions: turnCapture.approvalTransitions,
            });

            await sessionRegistry.save(session);

            ws.send(JSON.stringify({
              type: "done",
              content: extractText(result.parts),
              parts: result.parts,
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
              routedProvider: result.routingDecision?.provider ?? input.transport.sessionManager.getProvider(),
              routedModel: result.routingDecision?.model ?? input.transport.sessionManager.getModel(),
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
            } satisfies GuiInboundFrame));
          } catch {
            // discard malformed frames
          }
        },

        onClose(_event: CloseEvent, ws: WSContext) {
          activityStreamer.unregister(ws);
        },
      };
    }),
  );

  input.onReady(`ws://localhost:${input.port}/gui/ws`);
}

function fireAndForgetProviderSwitch(onProviderSwitch: OnProviderSwitch | undefined, provider: string): void {
  if (!onProviderSwitch) return;
  Promise.resolve(onProviderSwitch(provider)).catch(() => {
    // parity with clear behavior: provider switch errors should not tear down transport
  });
}

async function applyResumeSelection(
  onResumeSession: OnResumeSession | undefined,
  sessionId: string,
  provider: string,
): Promise<void> {
  if (!onResumeSession) {
    throw new Error("resume selection unsupported");
  }
  await onResumeSession(sessionId, provider);
}

function resolveGuiDistPath(configuredPath?: string): string | undefined {
  const candidate = configuredPath ?? join(process.cwd(), "packages", "gui", "dist");
  if (existsSync(join(candidate, "index.html"))) {
    return candidate;
  }
  return undefined;
}

function renderGuiBootstrapPage(port: number): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Kiln GUI Gateway</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #101414;
        color: #edf4ef;
        font: 16px/1.5 "Segoe UI", sans-serif;
      }
      main {
        width: min(720px, calc(100vw - 32px));
        padding: 32px;
        border: 1px solid rgba(136, 216, 192, 0.2);
        border-radius: 24px;
        background: rgba(20, 27, 27, 0.92);
      }
      code {
        display: block;
        margin: 16px 0;
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(0, 0, 0, 0.2);
        color: #88d8c0;
        white-space: pre-wrap;
      }
      a { color: #88d8c0; }
    </style>
  </head>
  <body>
    <main>
      <p>Kiln GUI gateway is running.</p>
      <h1>Frontend bundle is not built yet.</h1>
      <p>For local development, run the GUI Vite server and point it at this gateway.</p>
      <code>cd C:/Proyectos/Sequel/kiln/packages/gui
bun run dev</code>
      <p>The dev client will automatically probe <a href="http://localhost:${port}/gui/api/dashboard">/gui/api/dashboard</a> on port ${port}.</p>
    </main>
  </body>
</html>`;
}

class GuiActivityStreamer {
  private readonly pendingApprovals = new Set<string>();
  private capture: {
    sessionId: string;
    fileChanges: RuntimeTurnFileChange[];
    approvalTransitions: RuntimeTurnApprovalTransition[];
  } | null = null;
  private ws: WSContext | null = null;
  private eventBus: EventBus | null = null;
  private approvalHandler: ((event: KilnEvent) => void) | null = null;
  private receivedHandler: ((event: KilnEvent) => void) | null = null;
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
    };
  }

  endTurnCapture(sessionId: string): {
    fileChanges: readonly RuntimeTurnFileChange[];
    approvalTransitions: readonly RuntimeTurnApprovalTransition[];
  } {
    if (!this.capture || this.capture.sessionId !== sessionId) {
      return { fileChanges: [], approvalTransitions: [] };
    }
    const captured = {
      fileChanges: [...this.capture.fileChanges],
      approvalTransitions: [...this.capture.approvalTransitions],
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
          } satisfies GuiInboundFrame));
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
          } satisfies GuiInboundFrame));
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
    this.capture = null;
  }

  forward(event: CliSessionEvent): void {
    if (!this.ws) return;

    if (event.type === "tool_use") {
      this.ws.send(JSON.stringify({
        type: "activity",
        activity: "tool_use",
        toolName: event.toolName,
        input: event.input,
      } satisfies GuiInboundFrame));
    } else if (event.type === "tool_result") {
      this.ws.send(JSON.stringify({
        type: "activity",
        activity: "tool_result",
        toolName: event.toolName,
        output: event.output,
      } satisfies GuiInboundFrame));
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
      } satisfies GuiInboundFrame));
    } else if (event.type === "cost_update") {
      this.ws.send(JSON.stringify({
        type: "activity",
        activity: "cost_update",
        usd: event.usd,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
      } satisfies GuiInboundFrame));
    }
  }
}
