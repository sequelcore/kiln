import { execSync } from "node:child_process";
import { join } from "node:path";
import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
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
import {
  mountGuiStaticAssetsIfPresent,
  resolveGuiDistCandidates,
  resolveGuiDistPath,
} from "./gui-static-assets.js";
import type {
  GuiDashboardSnapshot,
  GuiInboundFrame,
  GuiOutboundFrame,
  GuiProviderDescriptor,
  GuiSessionDetail,
  GuiSessionSummary,
} from "@kilnai/gateway-contracts";

export type {
  GuiDashboardSnapshot,
  GuiInboundFrame,
  GuiOutboundFrame,
  GuiProviderDescriptor,
  GuiSessionDetail,
  GuiSessionMeta,
  GuiSessionSummary,
  GuiSessionTranscriptLine,
  GuiTelemetrySnapshot,
} from "@kilnai/gateway-contracts";

export interface StartGuiGatewayOptions {
  readonly port?: number;
  readonly guiDistPath?: string;
  readonly getSnapshot: () => Promise<GuiDashboardSnapshot>;
  readonly listSessions?: (provider?: string) => Promise<readonly GuiSessionSummary[]>;
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

const PROVIDER_ORDER = [
  "claude",
  "codex",
  "opencode",
  "codex-oauth",
  "anthropic",
  "openai",
  "deepseek",
  "openrouter",
  "ollama",
] as const;

const PROVIDER_META: Record<string, {
  readonly label: string;
  readonly group: GuiProviderDescriptor["group"];
  readonly free: boolean;
}> = {
  claude: { label: "Claude", group: "harness", free: false },
  codex: { label: "Codex", group: "harness", free: false },
  opencode: { label: "OpenCode", group: "harness", free: false },
  "codex-oauth": { label: "Codex OAuth", group: "subscription", free: true },
  anthropic: { label: "Anthropic", group: "direct-api", free: false },
  openai: { label: "OpenAI", group: "direct-api", free: false },
  deepseek: { label: "DeepSeek", group: "direct-api", free: false },
  openrouter: { label: "OpenRouter", group: "direct-api", free: true },
  ollama: { label: "Ollama", group: "direct-api", free: true },
};

function getProviderMeta(providerId: string): {
  readonly label: string;
  readonly group: GuiProviderDescriptor["group"];
  readonly free: boolean;
} {
  return PROVIDER_META[providerId] ?? {
    label: providerId,
    group: "direct-api",
    free: false,
  };
}

function buildWelcomeProviderDescriptors(models: Record<string, string[]>): GuiProviderDescriptor[] {
  const knownDescriptors = PROVIDER_ORDER.map((id) => {
    const meta = getProviderMeta(id);
    return {
      id,
      label: meta.label,
      group: meta.group,
      free: meta.free,
      models: models[id] ?? [],
      available: true,
    } satisfies GuiProviderDescriptor;
  });

  const known = new Set(PROVIDER_ORDER);
  const extras = Object.keys(models)
    .filter((id) => !known.has(id as (typeof PROVIDER_ORDER)[number]))
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({
      id,
      label: id,
      group: "direct-api" as const,
      free: false,
      models: models[id] ?? [],
      available: true,
    } satisfies GuiProviderDescriptor));

  return [...knownDescriptors, ...extras];
}

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
  const guiDistPath = resolveGuiDistPath(options.guiDistPath, import.meta.url);
  const hasMountedGui = mountGuiStaticAssetsIfPresent(app, guiDistPath);
  if (!hasMountedGui) {
    const unresolvedGuiDistPath = resolveGuiDistCandidates(options.guiDistPath, import.meta.url)[0] ?? "<unknown>";
    console.warn(`[gui-gateway] GUI bundle missing at ${join(unresolvedGuiDistPath, "index.html")}; skipping /gui mount.`);
  }
  const transportOptions = options.operatorTransport;
  let activeConnections = 0;

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

  app.get("/health", (c) => c.json({ status: "ok", channel: "gui", connections: activeConnections }));
  app.get("/gui-api/health", (c) => c.json({ status: "ok", channel: "gui", connections: activeConnections }));

  app.get("/gui/api/dashboard", async (c) => {
    const snapshot = await options.getSnapshot();
    return c.json(snapshot);
  });

  const listSessions = async (providerRaw: string | undefined): Promise<readonly GuiSessionSummary[]> => {
    if (!options.listSessions) {
      return [];
    }
    const provider = providerRaw?.trim() ? providerRaw.trim() : undefined;
    const sessions = await options.listSessions(provider);
    return sessions.slice(0, 20);
  };

  app.get("/sessions", async (c) => {
    const sessions = await listSessions(c.req.query("provider"));
    return c.json({ sessions });
  });

  app.get("/gui/api/sessions", async (c) => {
    const sessions = await listSessions(c.req.query("provider"));
    return c.json({ sessions });
  });

  app.get("/gui-api/sessions", async (c) => {
    const sessions = await listSessions(c.req.query("provider"));
    return c.json({ sessions });
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
      onSocketOpen: () => {
        activeConnections += 1;
      },
      onSocketClose: () => {
        activeConnections = Math.max(0, activeConnections - 1);
      },
    });
  } else {
    // Minimal WebSocket endpoint for environments without an operator transport
    // (e.g. dashboard-only mode, e2e test fixtures). Accepts connections and
    // sends a welcome frame so clients can verify connectivity.
    app.get(
      "/gui/ws",
      upgradeWebSocket(() => ({
        onOpen(_event: Event, ws: WSContext) {
          activeConnections += 1;
          ws.send(JSON.stringify({
            type: "welcome",
            models: {},
            providers: [],
            activeProvider: undefined,
            activeModel: undefined,
            planMode: false,
          } satisfies GuiInboundFrame));
        },
        onClose() {
          activeConnections = Math.max(0, activeConnections - 1);
        },
      })),
    );
  }

  app.get("/gui", (c) => c.redirect("/gui/"));

  const server = Bun.serve({
    port,
    fetch: app.fetch,
    websocket,
  });

  const boundPort = server.port ?? port;

  return {
    port: boundPort,
    url: `http://localhost:${boundPort}/gui/`,
    apiUrl: `http://localhost:${boundPort}/gui/api/dashboard`,
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
    onSocketOpen?: () => void;
    onSocketClose?: () => void;
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
          input.onSocketOpen?.();
          activityStreamer.register(ws, eventBus);
          const activeProvider = input.transport.sessionManager.getProvider();
          const activeModel = input.transport.sessionManager.getModel();
          ws.send(JSON.stringify({
            type: "welcome",
            models: input.models,
            providers: buildWelcomeProviderDescriptors(input.models),
            activeProvider,
            activeModel,
            planMode: input.transport.planMode ?? false,
          } satisfies GuiInboundFrame));
        },

        async onMessage(event: MessageEvent, ws: WSContext) {
          try {
            const raw = typeof event.data === "string"
              ? event.data
              : new TextDecoder().decode(event.data as ArrayBuffer);

            if (raw === "ping") {
              ws.send("pong");
              return;
            }

            const frame = JSON.parse(raw) as GuiOutboundFrame | Record<string, unknown>;

            if (frame.type === "clear") {
              await sessionRegistry.remove(GUI_APP_NAME, userId, GUI_TENANT_ID);
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
              ws.send(JSON.stringify({
                type: "provider_changed",
                provider: newProvider,
                model: newModel,
              } satisfies GuiInboundFrame));
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

            const userContent = typeof frame.content === "string"
              ? frame.content
              : typeof frame.text === "string"
                ? frame.text
                : "";
            const resumeSessionId = typeof frame.resumeSessionId === "string"
              ? frame.resumeSessionId.trim()
              : "";
            if (!userContent.trim()) return;
            const taskShape = normalizeRuntimeTaskShape(userContent);

            if (resumeSessionId && input.transport.onResumeSession) {
              try {
                await applyResumeSelection(
                  input.transport.onResumeSession,
                  resumeSessionId,
                  input.transport.sessionManager.getProvider(),
                );
              } catch {
                ws.send(JSON.stringify({
                  type: "error",
                  message: "Resume selection failed",
                } satisfies GuiInboundFrame));
                return;
              }
            }

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
          input.onSocketClose?.();
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

    if (event.type === "text_delta") {
      if (event.isThinking) {
        this.ws.send(JSON.stringify({
          type: "activity",
          activity: "reasoning",
          details: event.content,
        } satisfies GuiInboundFrame));
        return;
      }
      this.ws.send(JSON.stringify({
        type: "text_delta",
        content: event.content,
      } satisfies GuiInboundFrame));
    } else if (event.type === "tool_use") {
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
