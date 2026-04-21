import type { KilnAppConfig } from "../config.js";
import { inferResumeStrategyFeedback } from "../application/resume-strategy-feedback.js";
import { collectResumeSignals, decideResumeStrategy } from "../application/resume-strategy-policy.js";
import {
  buildCliPlanSummaryArtifactKeyFromShape,
  buildCliProjectSummaryArtifactKey,
  buildCliSessionSummaryArtifactKey,
} from "../application/context-artifact-keys.js";
import { readGlobalConfig } from "../config/global-config.js";
import { resolveEffectiveProvider } from "../config/env-config.js";
import { createDefaultRegistry, getProviderDisplayInfo, type ProviderId } from "../wrapper/session-registry.js";
import { SessionStore, TranscriptStore } from "../wrapper/session-store.js";
import type { ResumeFeedback, ResumeStrategy } from "../wrapper/index.js";
import { GatewaySession, waitForGateway, themes, kilnDark } from "@kilnai/tui";
import type { SessionLike } from "@kilnai/tui";
import type { ContextArtifactCache } from "@kilnai/core";
import { getProjectContextArtifactCache } from "@kilnai/runtime";

export interface TuiFlags {
  provider?: string;
  cwd?: string;
  port?: number;
  theme?: string;
  plan?: boolean;
}

type TuiStartupTransport = "gateway" | "direct";

interface TuiBootstrapOptions {
  readonly flags: TuiFlags;
  readonly sessionManager: MultiProviderSessionManager;
  readonly contextArtifactCache: ContextArtifactCache;
  readonly systemPrompt: string;
}

interface TuiBootstrapResult {
  readonly createSession: () => Promise<SessionLike>;
  readonly providerModelsRef: { current: Record<string, string[]> };
  shutdown(): void;
}
type TuiControlSession = SessionLike & {
  clear?: () => Promise<void>;
  switchProvider?: (provider: string, model?: string) => Promise<string>;
  approve?: (sessionId?: string) => void;
  reject?: (reason: string, sessionId?: string) => void;
};
type ProviderSessionState = { resumeSessionId?: string; providerSessionId?: string };
type CliSessionFactory = (
  systemPrompt: string,
  cwd: string,
) => import("../wrapper/session.js").IKilnSession;

function parseProvider(p: string | undefined, providerIds: readonly ProviderId[]): ProviderId {
  if (p && providerIds.includes(p as ProviderId)) {
    return p as ProviderId;
  }
  return providerIds.includes("claude") ? "claude" : providerIds[0] ?? "claude";
}

function resolveTuiStartupTransport(_flags: TuiFlags): TuiStartupTransport {
  if (process.env.KILN_TUI_TRANSPORT?.toLowerCase() === "direct") {
    return "direct";
  }
  return "gateway";
}

/**
 * Dynamic session factory that supports cross-provider session management.
 * Each provider maintains independent session state, allowing seamless switching.
 */
export async function makeMultiProviderSessionFactory(
  initialProvider: ProviderId,
  providerIds: readonly ProviderId[],
  cwd: string,
  registry: ReturnType<typeof createDefaultRegistry>["registry"],
  sessionStore: SessionStore,
  transcriptStore: TranscriptStore,
  contextArtifactCache: ContextArtifactCache,
): Promise<MultiProviderSessionManager> {
  const providers = providerIds;
  
  // Per-provider session state
  const providerState = new Map<ProviderId, ProviderSessionState>(
    providers.map((provider) => [provider, {}]),
  );
  
  let currentProvider: ProviderId = initialProvider;
  let currentModel: string = "";

  // Load last session for each provider
  for (const p of providers) {
    const lastRecord = await sessionStore.last(p);
    if (lastRecord) {
      const state = providerState.get(p);
      if (!state) continue;
      state.resumeSessionId = lastRecord.sessionId;
      state.providerSessionId = lastRecord.providerSessionId;
    }
  }

  const policyAwareFactory: CliSessionFactory = (systemPrompt: string, sessionCwd: string) => {
    let activeSession: import("../wrapper/session.js").IKilnSession | null = null;
    return {
      get capabilities() {
        return activeSession?.capabilities ?? registry.list().find((provider) => provider.id === currentProvider)?.capabilities ?? {
          mcp: false,
          streaming: true,
          resumable: false,
          resume: false,
          costTrackingMode: "computed",
          supportedTools: [],
          maxContextTokens: null,
          priority: 0,
          fallbackTo: null,
          permissionPolicy: { approval: "never", sandbox: "workspace-write" },
        };
      },
      get sessionId() {
        return activeSession?.sessionId ?? `${currentProvider}-tui-session`;
      },
      get providerSessionId() {
        return activeSession?.providerSessionId;
      },
      run: async function* (options) {
        const providerForTurn = currentProvider;
        const modelForTurn = currentModel || undefined;
        const state = providerState.get(providerForTurn) ?? {};
        const resumedFrom = state.resumeSessionId;
        const projectArtifactKey = buildCliProjectSummaryArtifactKey(cwd);
        const sessionArtifactKey = resumedFrom
          ? buildCliSessionSummaryArtifactKey(resumedFrom)
          : undefined;
        const planArtifactKey = buildCliPlanSummaryArtifactKeyFromShape(cwd, "interactive");
        const signals = collectResumeSignals({
          cache: contextArtifactCache,
          keys: [sessionArtifactKey, projectArtifactKey, planArtifactKey],
        });
        const feedback = resumedFrom
          ? await inferResumeStrategyFeedback(transcriptStore, providerForTurn)
          : undefined;
        const decision = decideResumeStrategy({
          resumeSessionId: resumedFrom,
          preferredProvider: providerForTurn,
          signals,
          feedback,
        });
        const resumeStrategy: ResumeStrategy = decision.resumeStrategy;
        const resumeFeedback: ResumeFeedback | undefined = decision.resumeFeedback;

        const resumedSession = registry.createSession(providerForTurn, {
          task: "interactive",
          systemPrompt,
          cwd: sessionCwd || cwd,
          permissionPolicy: { approval: "never", sandbox: "workspace-write" },
          resumeSessionId: decision.shouldUseProviderNativeResume ? resumedFrom : undefined,
          model: modelForTurn,
        });
        activeSession = resumedSession;
        const capturedId = resumedSession.sessionId;
        if (typeof (transcriptStore as { init?: unknown }).init === "function") {
          await transcriptStore.init(capturedId, {
            kilnSessionId: capturedId,
            provider: providerForTurn,
            task: "interactive",
            startedAt: new Date().toISOString(),
            resumeStrategy,
            resumeFeedback,
            sessionLedger: {
              currentPhase: "interactive",
              resumedFrom,
              workingDirectory: sessionCwd || cwd,
            },
          });
        }

        let turnCostUsd = 0;
        try {
          for await (const event of resumedSession.run(options)) {
            if (
              event
              && typeof event === "object"
              && "type" in event
              && event.type === "completed"
            ) {
              turnCostUsd = event.totalUsd;
            }
            yield event;
          }
        } finally {
          await resumedSession.dispose();
          const currentState = providerState.get(providerForTurn);
          if (currentState) {
            currentState.resumeSessionId = capturedId;
            currentState.providerSessionId = resumedSession.providerSessionId;
          }
          if (typeof (transcriptStore as { finalize?: unknown }).finalize === "function") {
            await transcriptStore.finalize(capturedId, {
              completedAt: new Date().toISOString(),
              providerSessionId: resumedSession.providerSessionId,
              resumeStrategy,
              resumeFeedback,
              sessionLedger: {
                currentPhase: "completed",
                resumedFrom,
                workingDirectory: sessionCwd || cwd,
                lastProvider: providerForTurn,
              },
            });
          }
          await sessionStore.append({
            sessionId: capturedId,
            provider: providerForTurn,
            task: "interactive",
            completedAt: new Date().toISOString(),
            cost: turnCostUsd,
            projectPath: cwd,
            providerSessionId: resumedSession.providerSessionId,
            resumeStrategy,
          });
          if (activeSession === resumedSession) {
            activeSession = null;
          }
        }
      },
      dispose: async () => {
        if (activeSession) {
          await activeSession.dispose();
          activeSession = null;
        }
      },
    };
  };

  return {
    factory: policyAwareFactory,
    getProvider: () => currentProvider,
    setProvider: (newProvider: string) => {
      if (providers.includes(newProvider as ProviderId)) {
        currentProvider = newProvider as ProviderId;
      }
    },
    getModel: () => currentModel,
    setModel: (model: string) => {
      currentModel = model;
    },
    onClear: async (provider?: string) => {
      const p = (provider && providers.includes(provider as ProviderId)) 
        ? provider as ProviderId 
        : currentProvider;
      const state = providerState.get(p);
      if (state) {
        state.resumeSessionId = undefined;
        state.providerSessionId = undefined;
      }
      await sessionStore.clearLast(p);
    },
    setResumeSession: (sessionId: string, provider: string) => {
      if (providers.includes(provider as ProviderId)) {
        const p = provider as ProviderId;
        const state = providerState.get(p);
        if (state) {
          currentProvider = p;
          state.resumeSessionId = sessionId;
        }
      }
    },
  };
}

export interface MultiProviderSessionManager {
  readonly factory: CliSessionFactory;
  getProvider: () => string;
  setProvider: (provider: string) => void;
  getModel: () => string;
  setModel: (model: string) => void;
  onClear: (provider?: string) => Promise<void>;
  setResumeSession: (sessionId: string, provider: string) => void;
}

function formatResumeFeedback(feedback: ResumeFeedback | undefined): string | undefined {
  if (!feedback) {
    return undefined;
  }
  const source = feedback.influencedChoice ? "applied" : "observed";
  const preferred = feedback.preferredStrategy ? ` ${feedback.preferredStrategy}` : "";
  return `${source}${preferred} · ${feedback.sampleSize}`;
}

async function loadInitialResumeInfo(
  cwd: string,
  sessionStore: SessionStore,
  providerIds: readonly ProviderId[],
): Promise<Record<string, { strategy?: ResumeStrategy; feedbackLabel?: string }>> {
  const transcriptStore = new TranscriptStore(cwd);
  const info: Record<string, { strategy?: ResumeStrategy; feedbackLabel?: string }> = {};

  for (const provider of providerIds) {
    const lastRecord = await sessionStore.last(provider);
    if (!lastRecord) {
      continue;
    }
    const meta = await transcriptStore.readMeta(lastRecord.sessionId);
    if (!meta?.resumeStrategy || meta.resumeStrategy === "none") {
      continue;
    }
    info[provider] = {
      strategy: meta.resumeStrategy,
      feedbackLabel: formatResumeFeedback(meta.resumeFeedback),
    };
  }

  return info;
}

async function bootstrapGatewaySession(
  options: TuiBootstrapOptions,
): Promise<TuiBootstrapResult> {
  const { startTuiGateway } = await import("@kilnai/runtime");
  const { flags, sessionManager, contextArtifactCache, systemPrompt } = options;

  const gateway = await startTuiGateway({
    sessionManager,
    port: flags.port,
    systemPrompt,
    onClear: sessionManager.onClear,
    contextArtifactCache,
    planMode: flags.plan ?? false,
  });

  await waitForGateway(`http://localhost:${gateway.port}/health`);

  const providerModelsRef: { current: Record<string, string[]> } = {
    current: gateway.models,
  };

  let session: GatewaySession | null = null;
  const createSession = async (): Promise<SessionLike> => {
    if (!session) {
      session = new GatewaySession(
        gateway.url,
        (models: Record<string, string[]>) => {
          providerModelsRef.current = models;
        },
      );
    }
    return session;
  };

  return {
    createSession,
    providerModelsRef,
    shutdown: () => {
      void session?.dispose();
      gateway.shutdown();
    },
  };
}

function mapSessionEventToTui(
  event: unknown,
  route?: { provider: string; model: string },
):
  | { type: "text_delta"; content: string; isThinking?: boolean }
  | { type: "file_changed"; path: string; changeType: "created" | "modified" | "deleted"; linesAdded?: number; linesRemoved?: number }
  | { type: "cost_update"; usd: number }
  | { type: "completed"; totalUsd: number; routedProvider?: string; routedModel?: string }
  | { type: "error"; message: string }
  | { type: "activity"; activity: string; toolName?: string; output?: string; input?: unknown } {
  const candidate = event as { type?: string; [key: string]: unknown } | undefined;
  switch (candidate?.type) {
    case "text_delta":
      return {
        type: "text_delta",
        content: String(candidate.content ?? ""),
      };
    case "file_changed":
      return {
        type: "file_changed",
        path: String(candidate.path ?? ""),
        changeType: (candidate.changeType as "created" | "modified" | "deleted") ?? "modified",
        linesAdded: typeof candidate.linesAdded === "number" ? candidate.linesAdded : undefined,
        linesRemoved: typeof candidate.linesRemoved === "number" ? candidate.linesRemoved : undefined,
      };
    case "cost_update":
      return {
        type: "cost_update",
        usd: typeof candidate.usd === "number" ? candidate.usd : 0,
      };
    case "completed":
      return {
        type: "completed",
        totalUsd: typeof candidate.totalUsd === "number" ? candidate.totalUsd : 0,
        routedProvider: route?.provider,
        routedModel: route?.model || undefined,
      };
    case "error":
      return {
        type: "error",
        message: `${String(candidate.code ?? "ERROR")}: ${String(candidate.message ?? "Unknown error")}`,
      };
    case "tool_use":
      return {
        type: "activity",
        activity: "tool_use",
        toolName: typeof candidate.toolName === "string" ? candidate.toolName : undefined,
        input: candidate.input,
      };
    case "tool_result":
      return {
        type: "activity",
        activity: "tool_result",
        toolName: typeof candidate.toolName === "string" ? candidate.toolName : undefined,
        output: typeof candidate.output === "string" ? candidate.output : undefined,
      };
    default:
      return {
        type: "activity",
        activity: "unknown_event",
      };
  }
}

async function bootstrapDirectSession(
  options: TuiBootstrapOptions,
): Promise<TuiBootstrapResult> {
  const { flags, sessionManager, systemPrompt } = options;
  const sessionCwd = flags.cwd ?? process.cwd();
  let session: TuiControlSession | null = null;

  const createSession = async (): Promise<SessionLike> => {
    if (session) {
      return session;
    }

    const inner = sessionManager.factory(
      systemPrompt,
      sessionCwd,
    );

    session = {
      async *run(opts: { prompt: string; cwd?: string }) {
        const providerForTurn = sessionManager.getProvider();
        const modelForTurn = sessionManager.getModel();
        for await (const event of inner.run(opts)) {
          yield mapSessionEventToTui(event, {
            provider: providerForTurn,
            model: modelForTurn,
          });
        }
      },
      async dispose() {
        await inner.dispose();
      },
      async clear() {
        await sessionManager.onClear(sessionManager.getProvider());
      },
      async switchProvider(providerName: string, modelName?: string) {
        sessionManager.setProvider(providerName);
        sessionManager.setModel(modelName ?? "");
        return providerName;
      },
    };
    return session;
  };

  return {
    createSession,
    providerModelsRef: { current: {} },
    shutdown: () => {},
  };
}

async function bootstrapTuiSession(
  options: TuiBootstrapOptions,
): Promise<TuiBootstrapResult> {
  const transport = resolveTuiStartupTransport(options.flags);
  if (transport === 'gateway') {
    return bootstrapGatewaySession(options);
  }
  return bootstrapDirectSession(options);
}

export async function tuiCommand(appConfig: KilnAppConfig, flags: TuiFlags = {}): Promise<void> {
  const { startTui } = await import("@kilnai/tui");
  const { registry } = createDefaultRegistry();
  const providerDisplayInfo = getProviderDisplayInfo(registry);
  const providerIds = providerDisplayInfo.map((entry) => entry.id);

  const cwd = flags.cwd ?? process.cwd();
  const globalConfig = readGlobalConfig();
  const provider = parseProvider(resolveEffectiveProvider(flags.provider, globalConfig?.provider), providerIds);
  const contextArtifactCache = await getProjectContextArtifactCache(cwd);

  // Resolve domain display name from app config if available
  let domain = "kiln";
  let systemPrompt = "You are a helpful assistant.";
  try {
    const { SessionManager } = await import("../wrapper/session-manager.js");
    const wrapperConfig = { mode: "cli-wrapper" as const, permissionPolicy: { approval: "never" as const, sandbox: "workspace-write" as const } };
    const manager = new SessionManager(wrapperConfig, appConfig, contextArtifactCache);
    const context = await manager.prepare("interactive", cwd, undefined, undefined, undefined);
    domain = context.domain.displayName;
    systemPrompt = context.systemPrompt;
  } catch {
    // Non-fatal — proceed without domain name
  }

  // Inject CLI session factory into the gateway (dependency inversion)
  const sessionStore = new SessionStore(cwd);
  const transcriptStore = new TranscriptStore(cwd);
  const initialResumeInfo = await loadInitialResumeInfo(cwd, sessionStore, providerIds);
  const startupTransport = resolveTuiStartupTransport(flags);
  const sessionManager = await makeMultiProviderSessionFactory(
    provider,
    providerIds,
    cwd,
    registry,
    sessionStore,
    transcriptStore,
    contextArtifactCache,
  );

  const bootstrap = await bootstrapTuiSession({
    flags,
    sessionManager,
    contextArtifactCache,
    systemPrompt,
  });

  const shutdown = (code = 0, error?: unknown) => {
    bootstrap.shutdown();
    if (error) {
      process.stderr.write(String(error instanceof Error ? (error.stack ?? error.message) : error) + "\n");
      process.exitCode = 1;
    } else {
      process.exitCode = code;
    }
    setTimeout(() => process.exit(process.exitCode ?? code), 50).unref();
  };

  const handlers = [
    ["SIGINT", () => shutdown(0)],
    ["SIGTERM", () => shutdown(0)],
    ["SIGHUP", () => shutdown(0)],
    ["uncaughtException", (e: unknown) => shutdown(1, e)],
    ["unhandledRejection", (e: unknown) => shutdown(1, e)],
  ] as const;

  for (const [ev, handler] of handlers) process.on(ev, handler);

  const resolvedTheme = themes[flags.theme ?? globalConfig?.tui?.theme ?? "kiln-dark"] ?? kilnDark;

  // Session list loader for sidebar browser
  async function loadSessionList() {
    try {
      const records = await sessionStore.list();
      return records.slice(0, 20);
    } catch {
      return [];
    }
  }

  // Session resume handler - sets resume session ID for the selected provider
  const handleResumeSession = (session: { sessionId: string; provider: string }) => {
    sessionManager.setProvider(session.provider);
    sessionManager.setResumeSession(session.sessionId, session.provider);
  };

  await startTui(
    bootstrap.createSession,
    providerDisplayInfo,
    provider,
    domain,
    resolvedTheme,
    startupTransport === "direct" ? initialResumeInfo : {},
    () => loadInitialResumeInfo(cwd, sessionStore, providerIds),
    bootstrap.providerModelsRef,
    startupTransport === "direct" ? loadSessionList : undefined,
    startupTransport === "direct" ? handleResumeSession : undefined,
  );

  bootstrap.shutdown();
  for (const [ev, handler] of handlers) process.off(ev, handler);
}
