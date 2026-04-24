import { execSync } from "node:child_process";
import { join } from "node:path";
import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import {
  EventBus,
  extractText,
  textParts,
  OpenCodeAuth,
  type ApprovalReceivedEvent,
  type ApprovalRequestedEvent,
  type KilnEvent,
  type ModelRoutedEvent,
  type ToolAuthorizedEvent,
} from "@kilnai/core";
import { CliSubscriptionExecutor } from "../execution/cli-subscription-executor.js";
import type { CliSessionEvent } from "../execution/cli-subscription-executor.js";
import { RuntimeSessionOrchestrator } from "../session/runtime-session-orchestrator.js";
import type { PerCallToolConfig } from "../session/runtime-session-orchestrator.js";
import { SessionRegistry } from "../session/session-registry.js";
import { ApprovalGateRegistry } from "./approval-registry.js";
import { processAdmittedTurn } from "./message-pipeline.js";
import type {
  RuntimeTurnApprovalTransition,
  RuntimeTurnAuthorityDecision,
  RuntimeTurnFileChange,
} from "../session/runtime-turn-record.js";
import type { OnProviderSwitch, OnResumeSession, OperatorSessionTransportOptions } from "./operator-gateway.js";
import {
  mountGuiStaticAssetsIfPresent,
  resolveGuiDistCandidates,
  resolveGuiDistPath,
} from "./gui-static-assets.js";
import { buildGuiOperatorModels } from "./gui-provider-models.js";
import {
  buildAttachedRuntimePerCallToolConfig,
  createAttachedRuntimeBuiltinToolSurface,
  type AttachedRuntimeBuiltinToolSurface,
} from "./attached-runtime-tool-surface.js";
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
  GuiSessionEvent,
  GuiSessionMeta,
  GuiSessionSummary,
  GuiTelemetrySnapshot,
} from "@kilnai/gateway-contracts";

export interface StartGuiGatewayOptions {
  readonly port?: number;
  readonly guiDistPath?: string;
  readonly getSnapshot: () => Promise<GuiDashboardSnapshot>;
  readonly listSessions?: () => Promise<readonly GuiSessionSummary[]>;
  readonly getSessionDetail?: (sessionId: string) => Promise<GuiSessionDetail | null>;
  readonly workingDirectory?: string;
  readonly domainLabel?: string;
  readonly updateThemePreference?: (theme: string) => Promise<void> | void;
  readonly onConnectionCountChange?: (count: number) => void;
  readonly onManagedWindowClose?: () => void;
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

export function buildGuiPerCallToolConfig(): PerCallToolConfig {
  return buildAttachedRuntimePerCallToolConfig({
    tenantId: GUI_TENANT_ID,
  });
}

type GuiAuthorityStatus = NonNullable<Extract<GuiInboundFrame, { type: "welcome" }>["authorityStatus"]>;

export function deriveGuiAuthorityStatusFromPerCallConfig(
  config: PerCallToolConfig,
): GuiAuthorityStatus {
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
  const updateConnectionCount = (count: number) => {
    options.onConnectionCountChange?.(count);
  };

  app.use("/gui/api/*", async (c, next) => {
    c.header("Access-Control-Allow-Origin", "*");
    c.header("Access-Control-Allow-Headers", "Content-Type, Accept");
    c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

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

  app.post("/gui/api/preferences/theme", async (c) => {
    if (!options.updateThemePreference) {
      return c.json({ error: "unsupported" }, 404);
    }
    const payload = await c.req.json().catch(() => null) as { theme?: unknown } | null;
    const theme = typeof payload?.theme === "string" ? payload.theme.trim() : "";
    if (theme !== "kiln-dark" && theme !== "kiln-light" && theme !== "system-follow") {
      return c.json({ error: "invalid_theme" }, 400);
    }
    await options.updateThemePreference(theme);
    return c.json({ ok: true });
  });

  const handleManagedWindowClose = (c: { body: (data: null, status: 204) => Response }) => {
    options.onManagedWindowClose?.();
    return c.body(null, 204);
  };

  app.post("/gui/api/window-closed", handleManagedWindowClose);
  app.post("/gui-api/window-closed", handleManagedWindowClose);

  const listSessions = async (): Promise<readonly GuiSessionSummary[]> => {
    if (!options.listSessions) {
      return [];
    }
    const sessions = await options.listSessions();
    return sessions.slice(0, 20);
  };

  app.get("/sessions", async (c) => {
    const sessions = await listSessions();
    return c.json({ sessions });
  });

  app.get("/gui/api/sessions", async (c) => {
    const sessions = await listSessions();
    return c.json({ sessions });
  });

  app.get("/gui-api/sessions", async (c) => {
    const sessions = await listSessions();
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
        updateConnectionCount(activeConnections);
      },
      onSocketClose: () => {
        activeConnections = Math.max(0, activeConnections - 1);
        updateConnectionCount(activeConnections);
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
          updateConnectionCount(activeConnections);
          const guiAuthorityStatus = deriveGuiAuthorityStatusFromPerCallConfig(buildGuiPerCallToolConfig());
          ws.send(JSON.stringify({
            type: "welcome",
            models: {},
            providers: [],
            activeProvider: undefined,
            activeModel: undefined,
            planMode: false,
            workingDirectory: options.workingDirectory,
            domainLabel: options.domainLabel,
            authorityStatus: guiAuthorityStatus,
          } satisfies GuiInboundFrame));
        },
        onClose() {
          activeConnections = Math.max(0, activeConnections - 1);
          updateConnectionCount(activeConnections);
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
  const opencodeAuth = new OpenCodeAuth();
  const opencodeFile = await opencodeAuth.loadAuthFile();
  const opencodeTier = opencodeFile?.tier ?? null;
  return buildGuiOperatorModels({ opencodeModels, codexModels, opencodeTier });
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
  const builtinToolSurface = createAttachedRuntimeBuiltinToolSurface();
  const executor = new CliSubscriptionExecutor(
    input.transport.sessionManager.factory,
    providerLabel,
    (event) => activityStreamer.forward(event),
  );
  const eventBus = input.transport.eventBus ?? new EventBus(100);
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

  app.get(
    "/gui/ws",
    upgradeWebSocket((c) => {
      const userId = c.req.query("userId") ?? crypto.randomUUID();

      return {
        async onOpen(_event: Event, ws: WSContext) {
          input.onSocketOpen?.();
          activityStreamer.register(ws, eventBus);
          const activeProvider = input.transport.sessionManager.getProvider();
          let activeModel = input.transport.sessionManager.getModel();
          if (!activeModel) {
            const fallbackModel = input.models[activeProvider]?.[0];
            if (fallbackModel) {
              input.transport.sessionManager.setModel(fallbackModel);
              activeModel = fallbackModel;
            }
          }
          const guiAuthorityStatus = deriveGuiAuthorityStatusFromPerCallConfig(
            buildGuiTurnPerCallConfig(activeProvider, activeModel, builtinToolSurface),
          );
          ws.send(JSON.stringify({
            type: "welcome",
            models: input.models,
            providers: buildWelcomeProviderDescriptors(input.models),
            activeProvider,
            activeModel,
            planMode: input.transport.planMode ?? false,
            workingDirectory: input.transport.workingDirectory,
            domainLabel: input.transport.domainLabel,
            authorityStatus: guiAuthorityStatus,
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
              await sessionRegistry.detachActive(GUI_APP_NAME, userId, GUI_TENANT_ID);
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
              const newModel = typeof frame.model === "string"
                ? frame.model
                : input.models[newProvider]?.[0];
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
              if (!sessionId) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: "Resume request must include sessionId",
                } satisfies GuiInboundFrame));
                return;
              }
              try {
                await applyResumeSelection(input.transport.onResumeSession, sessionId);
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
              } satisfies GuiInboundFrame));
              return;
            }

            if (frame.type === "exec") {
              ws.send(JSON.stringify({ type: "exec_confirmed" } satisfies GuiInboundFrame));
              return;
            }

            if (frame.type === "approve" || (frame.type === "approval_response" && (frame as { approved?: boolean }).approved === true)) {
              const sessionId = typeof frame.sessionId === "string" ? frame.sessionId : undefined;
              const result = approvalRegistry.approve(sessionId);
              if (!result.ok) {
                ws.send(JSON.stringify({ type: "error", message: result.error ?? "Approval failed" } satisfies GuiInboundFrame));
              }
              return;
            }

            if (frame.type === "reject" || (frame.type === "approval_response" && (frame as { approved?: boolean }).approved === false)) {
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
            let result;
            try {
              const activeProvider = input.transport.sessionManager.getProvider();
              const activeModel = input.transport.sessionManager.getModel() || undefined;
              result = await processAdmittedTurn({
                orchestrator,
                sessionRegistry,
                appName: GUI_APP_NAME,
                tenantId: GUI_TENANT_ID,
                userId,
                sessionId: resumeSessionId || undefined,
                systemPrompt: input.transport.systemPrompt ?? "You are a helpful assistant.",
                userParts: textParts(userContent),
                channel: "gui",
                contextArtifactCache: input.transport.contextArtifactCache,
                perCallConfig: buildGuiTurnPerCallConfig(activeProvider, activeModel, builtinToolSurface),
                turnCapture: {
                  start: (sessionId, nextSequence) => {
                    activityStreamer.beginTurnCapture(sessionId, nextSequence);
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
              } satisfies GuiInboundFrame));
              return;
            }

            if (!result.ok) {
              ws.send(JSON.stringify({
                type: "error",
                message: result.budgetDenied.message,
              } satisfies GuiInboundFrame));
              return;
            }
            const output = result.result;
            const runtimeContinuity = output.runtimeContinuity ?? { strategy: "none" };

            ws.send(JSON.stringify({
              type: "done",
              content: extractText(output.parts),
              parts: output.parts,
              inputTokens: output.inputTokens,
              outputTokens: output.outputTokens,
              routedProvider: output.routingDecision?.provider ?? input.transport.sessionManager.getProvider(),
              routedModel: output.routingDecision?.model ?? input.transport.sessionManager.getModel(),
              runtimeContinuity,
              authorityStatus: deriveGuiAuthorityStatusFromPerCallConfig(
                buildGuiTurnPerCallConfig(
                  output.routingDecision?.provider ?? input.transport.sessionManager.getProvider(),
                  output.routingDecision?.model ?? input.transport.sessionManager.getModel(),
                  builtinToolSurface,
                ),
              ),
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

export function buildGuiTurnPerCallConfig(
  activeProvider: string,
  activeModel: string | undefined,
  builtinToolSurface: AttachedRuntimeBuiltinToolSurface = createAttachedRuntimeBuiltinToolSurface(),
): PerCallToolConfig {
  return buildAttachedRuntimePerCallToolConfig({
    tenantId: GUI_TENANT_ID,
    activeProvider,
    activeModel,
    builtinToolSurface,
  });
}

async function applyResumeSelection(
  onResumeSession: OnResumeSession | undefined,
  sessionId: string,
  provider?: string,
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
    nextSequence: number;
    toolOrdinal: number;
    approvalOrdinal: number;
    pendingToolCallIds: Map<string, string[]>;
    pendingApprovalIds: string[];
    assistantMessageId: string;
    fileChanges: RuntimeTurnFileChange[];
    approvalTransitions: RuntimeTurnApprovalTransition[];
    authorityDecisions: RuntimeTurnAuthorityDecision[];
  } | null = null;
  private ws: WSContext | null = null;
  private eventBus: EventBus | null = null;
  private approvalHandler: ((event: KilnEvent) => void) | null = null;
  private receivedHandler: ((event: KilnEvent) => void) | null = null;
  private modelRoutedHandler: ((event: KilnEvent) => void) | null = null;
  private authorizedHandler: ((event: KilnEvent) => void) | null = null;
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

  beginTurnCapture(sessionId: string, nextSequence: number): void {
    this.capture = {
      sessionId,
      nextSequence,
      toolOrdinal: 0,
      approvalOrdinal: 0,
      pendingToolCallIds: new Map<string, string[]>(),
      pendingApprovalIds: [],
      assistantMessageId: `${sessionId}:live:assistant`,
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

  private nextLiveSequence(): number | null {
    if (!this.capture) {
      return null;
    }
    const sequence = this.capture.nextSequence;
    this.capture.nextSequence += 1;
    return sequence;
  }

  private emitSessionEvent(input: {
    kind: "assistant_delta" | "provider_routed" | "tool_call_started" | "tool_call_completed" | "approval_requested" | "approval_resolved" | "file_changed" | "cost_updated";
    timestamp: string;
    payload: Record<string, unknown>;
  }): void {
    if (!this.ws || !this.capture) {
      return;
    }
    const sequence = this.nextLiveSequence();
    if (sequence === null) {
      return;
    }
    this.ws.send(JSON.stringify({
      type: "session_event",
      event: {
        eventId: `${this.capture.sessionId}:live:${sequence}`,
        kilnSessionId: this.capture.sessionId,
        sequence,
        timestamp: input.timestamp,
        kind: input.kind,
        turnId: `${this.capture.sessionId}:turn:live`,
        source: {
          actor: input.kind === "assistant_delta" ? "assistant" : input.kind.startsWith("tool_") ? "tool" : "runtime",
          surface: "gui",
          component: "gui-gateway",
        },
        payload: input.payload,
      },
    } satisfies GuiInboundFrame));
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
            const approvalId = `${sessionId}:live:approval:${++this.capture.approvalOrdinal}`;
            this.capture.pendingApprovalIds.push(approvalId);
            this.capture.approvalTransitions.push({
              status: "requested",
              sessionId,
              reason: approvalEvent.description,
            });
            this.emitSessionEvent({
              kind: "approval_requested",
              timestamp: approvalEvent.timestamp.toISOString(),
              payload: {
                approvalId,
                action: approvalEvent.description,
                justification: approvalEvent.description,
              },
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
            type: "activity_phase",
            phase: "awaiting_approval",
            details: approvalEvent.description,
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
            const approvalId = this.capture.pendingApprovalIds.shift() ?? `${sessionId}:live:approval:${++this.capture.approvalOrdinal}`;
            this.capture.approvalTransitions.push({
              status: receivedEvent.approved ? "approved" : "rejected",
              sessionId,
              reason: receivedEvent.reason,
            });
            this.emitSessionEvent({
              kind: "approval_resolved",
              timestamp: receivedEvent.timestamp.toISOString(),
              payload: {
                approvalId,
                resolution: {
                  decision: receivedEvent.approved ? "approved" : "denied",
                  resolvedBy: "operator",
                  reason: receivedEvent.reason,
                },
              },
            });
          }
          this.approvalRegistry.unregister(sessionId);
        }
        if (this.ws) {
          this.ws.send(JSON.stringify({
            type: "activity_phase",
            phase: "idle",
          } satisfies GuiInboundFrame));
        }
      }
    };
    this.eventBus.onAny(this.receivedHandler);

    this.modelRoutedHandler = (event: KilnEvent) => {
      if (event.type === "model_routed") {
        const routedEvent = event as unknown as ModelRoutedEvent;
        const sessionId = routedEvent.sessionId;
        if (this.capture && sessionId === this.capture.sessionId) {
          this.emitSessionEvent({
            kind: "provider_routed",
            timestamp: routedEvent.timestamp.toISOString(),
            payload: {
              provider: {
                provider: routedEvent.provider,
                model: routedEvent.model,
              },
              reason: routedEvent.reason,
            },
          });
        }
      }
    };
    this.eventBus.onAny(this.modelRoutedHandler);

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
    if (this.eventBus && this.modelRoutedHandler) {
      this.eventBus.offAny(this.modelRoutedHandler);
      this.modelRoutedHandler = null;
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

    if (event.type === "text_delta") {
      if (event.isThinking) {
        this.ws.send(JSON.stringify({
          type: "activity_phase",
          phase: "thinking",
          details: event.content,
        } satisfies GuiInboundFrame));
        return;
      }
      this.emitSessionEvent({
        kind: "assistant_delta",
        timestamp: new Date().toISOString(),
        payload: {
          messageId: this.capture?.assistantMessageId ?? "assistant-live",
          delta: event.content,
        },
      });
    } else if (event.type === "tool_use") {
      const toolCallId = this.capture
        ? `${this.capture.sessionId}:live:tool:${++this.capture.toolOrdinal}`
        : `${event.toolName ?? "tool"}_${Date.now()}`;
      if (this.capture) {
        const pending = this.capture.pendingToolCallIds.get(event.toolName) ?? [];
        pending.push(toolCallId);
        this.capture.pendingToolCallIds.set(event.toolName, pending);
      }
      this.emitSessionEvent({
        kind: "tool_call_started",
        timestamp: new Date().toISOString(),
        payload: {
          toolCallId,
          toolName: event.toolName ?? "unknown",
          input: (event.input && typeof event.input === "object" ? event.input : {}) as Record<string, unknown>,
        },
      });
      this.ws.send(JSON.stringify({
        type: "activity_phase",
        phase: "tool_running",
        toolName: event.toolName,
      } satisfies GuiInboundFrame));
    } else if (event.type === "tool_result") {
      const pending = this.capture?.pendingToolCallIds.get(event.toolName);
      const toolCallId = pending?.shift()
        ?? (this.capture ? `${this.capture.sessionId}:live:tool:${++this.capture.toolOrdinal}` : `${event.toolName ?? "tool"}_${Date.now()}`);
      if (pending && pending.length === 0 && this.capture) {
        this.capture.pendingToolCallIds.delete(event.toolName);
      }
      this.emitSessionEvent({
        kind: "tool_call_completed",
        timestamp: new Date().toISOString(),
        payload: {
          toolCallId,
          toolName: event.toolName ?? "unknown",
          outputSummary: event.output ?? "",
          status: {
            state: "succeeded",
          },
        },
      });
      this.ws.send(JSON.stringify({
        type: "activity_phase",
        phase: "idle",
      } satisfies GuiInboundFrame));
    } else if (event.type === "file_changed") {
      if (this.capture) {
        this.capture.fileChanges.push({
          path: event.path,
          changeType: event.changeType,
          linesAdded: event.linesAdded,
          linesRemoved: event.linesRemoved,
          diffPreview: event.diffPreview,
          diffTruncated: event.diffTruncated,
        });
      }
      this.emitSessionEvent({
        kind: "file_changed",
        timestamp: new Date().toISOString(),
        payload: {
          change: {
            path: event.path,
            changeType: event.changeType === "modified" ? "updated" : event.changeType,
            linesAdded: event.linesAdded,
            linesRemoved: event.linesRemoved,
            diffPreview: event.diffPreview,
            diffTruncated: event.diffTruncated,
          },
        },
      });
    } else if (event.type === "cost_update") {
      this.emitSessionEvent({
        kind: "cost_updated",
        timestamp: new Date().toISOString(),
        payload: {
          provider: {
            provider: event.provider ?? "unknown",
            model: event.model ?? event.canonicalModel ?? "unknown",
            canonicalModel: event.canonicalModel,
            billingMode: event.billingMode,
          },
          usage: {
            inputTokens: event.inputTokens ?? 0,
            outputTokens: event.outputTokens ?? 0,
            cacheReadTokens: event.cacheReadTokens ?? 0,
          },
          cost: {
            deltaUsd: event.usd,
            currency: "USD",
          },
        },
      });
    }
  }
}
