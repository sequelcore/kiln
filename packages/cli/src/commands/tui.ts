import type { KilnAppConfig } from "../config.js";
import { inferResumeStrategyFeedback } from "../application/resume-strategy-feedback.js";
import { collectResumeSignals, decideResumeStrategy } from "../application/resume-strategy-policy.js";
import { createDefaultRegistry } from "../wrapper/session-registry.js";
import { SessionStore, TranscriptStore } from "../wrapper/session-store.js";
import type { ResumeFeedback, ResumeStrategy } from "../wrapper/index.js";
import { GatewaySession, waitForGateway, themes, kilnDark } from "@kilnai/tui";
import type { SessionLike } from "@kilnai/tui";
import type { ContextArtifactCache } from "@kilnai/core";
import { getProjectContextArtifactCache } from "../application/project-context-cache.js";

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
}

interface TuiBootstrapResult {
  readonly createSession: () => Promise<SessionLike>;
  readonly providerModelsRef: { current: Record<string, string[]> };
  shutdown(): void;
}

const VALID_PROVIDERS = [
  "claude",
  "codex",
  "opencode",
  "anthropic",
  "openai",
  "deepseek",
  "openrouter",
  "ollama",
] as const;
type SupportedProvider = (typeof VALID_PROVIDERS)[number];
type ProviderSessionState = { resumeSessionId?: string; providerSessionId?: string };
type CliSessionFactory = (
  systemPrompt: string,
  cwd: string,
) => import("../wrapper/session.js").IKilnSession;

function parseProvider(p?: string): SupportedProvider {
  if (p && VALID_PROVIDERS.includes(p as SupportedProvider)) {
    return p as SupportedProvider;
  }
  return "claude";
}

function resolveTuiStartupTransport(_flags: TuiFlags): TuiStartupTransport {
  if (process.env.KILN_TUI_TRANSPORT?.toLowerCase() === 'gateway') {
    return 'gateway';
  }
  return "direct";
}

/**
 * Dynamic session factory that supports cross-provider session management.
 * Each provider maintains independent session state, allowing seamless switching.
 */
export async function makeMultiProviderSessionFactory(
  initialProvider: SupportedProvider,
  cwd: string,
  registry: ReturnType<typeof createDefaultRegistry>["registry"],
  sessionStore: SessionStore,
  transcriptStore: TranscriptStore,
  contextArtifactCache: ContextArtifactCache,
): Promise<MultiProviderSessionManager> {
  const providers = VALID_PROVIDERS;
  
  // Per-provider session state
  const providerState: Record<SupportedProvider, ProviderSessionState> = Object.fromEntries(
    VALID_PROVIDERS.map(
      (provider): [SupportedProvider, ProviderSessionState] => [provider, {}],
    ),
  ) as Record<SupportedProvider, ProviderSessionState>;
  
  let currentProvider: SupportedProvider = initialProvider;
  let currentModel: string = "";

  // Load last session for each provider
  for (const p of providers) {
    const lastRecord = await sessionStore.last(p);
    if (lastRecord) {
      providerState[p].resumeSessionId = lastRecord.sessionId;
      providerState[p].providerSessionId = lastRecord.providerSessionId;
    }
  }

  const policyAwareFactory: CliSessionFactory = (systemPrompt: string, sessionCwd: string) => {
    let activeSession: import("../wrapper/session.js").IKilnSession | null = null;
    const state = providerState[currentProvider];
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
        const resumedFrom = state.resumeSessionId;
        const projectArtifactKey = `project-summary:${cwd}`;
        const sessionArtifactKey = resumedFrom ? `session-summary:${resumedFrom}` : undefined;
        const planArtifactKey = `plan-summary:${cwd}:interactive`;
        const signals = collectResumeSignals({
          cache: contextArtifactCache,
          keys: [sessionArtifactKey, projectArtifactKey, planArtifactKey],
        });
        const feedback = resumedFrom
          ? await inferResumeStrategyFeedback(transcriptStore, currentProvider)
          : undefined;
        const decision = decideResumeStrategy({
          resumeSessionId: resumedFrom,
          preferredProvider: currentProvider,
          signals,
          feedback,
        });
        const resumeStrategy: ResumeStrategy = decision.resumeStrategy;
        const resumeFeedback: ResumeFeedback | undefined = decision.resumeFeedback;

        const resumedSession = registry.createSession(currentProvider, {
          task: "interactive",
          systemPrompt,
          cwd: sessionCwd || cwd,
          permissionPolicy: { approval: "never", sandbox: "workspace-write" },
          resumeSessionId: decision.shouldUseProviderNativeResume ? resumedFrom : undefined,
          model: currentModel || undefined,
        });
        activeSession = resumedSession;

        const originalDispose = resumedSession.dispose.bind(resumedSession);
        resumedSession.dispose = async () => {
          const capturedId = resumedSession.sessionId;
          if (typeof (transcriptStore as { init?: unknown }).init === "function") {
            await transcriptStore.init(capturedId, {
              kilnSessionId: capturedId,
              provider: currentProvider,
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
          await originalDispose();
          providerState[currentProvider].resumeSessionId = capturedId;
          providerState[currentProvider].providerSessionId = resumedSession.providerSessionId;
          await transcriptStore.finalize(capturedId, {
            completedAt: new Date().toISOString(),
            providerSessionId: resumedSession.providerSessionId,
            resumeStrategy,
            resumeFeedback,
            sessionLedger: {
              currentPhase: "completed",
              resumedFrom,
              workingDirectory: sessionCwd || cwd,
              lastProvider: currentProvider,
            },
          });
          await sessionStore.append({
            sessionId: capturedId,
            provider: currentProvider,
            task: "interactive",
            completedAt: new Date().toISOString(),
            cost: 0,
            projectPath: cwd,
            providerSessionId: resumedSession.providerSessionId,
            resumeStrategy,
          });
        };

        for await (const event of resumedSession.run(options)) {
          yield event;
        }
      },
      dispose: async () => {
        if (activeSession) {
          await activeSession.dispose();
        }
      },
    };
  };

  return {
    factory: policyAwareFactory,
    getProvider: () => currentProvider,
    setProvider: (newProvider: string) => {
      if (VALID_PROVIDERS.includes(newProvider as SupportedProvider)) {
        currentProvider = newProvider as SupportedProvider;
      }
    },
    getModel: () => currentModel,
    setModel: (model: string) => {
      currentModel = model;
    },
    onClear: async (provider?: string) => {
      const p = (provider && VALID_PROVIDERS.includes(provider as SupportedProvider)) 
        ? provider as SupportedProvider 
        : currentProvider;
      providerState[p].resumeSessionId = undefined;
      providerState[p].providerSessionId = undefined;
      await sessionStore.clearLast(p);
    },
    setResumeSession: (sessionId: string, provider: string) => {
      if (VALID_PROVIDERS.includes(provider as SupportedProvider)) {
        const p = provider as SupportedProvider;
        providerState[p].resumeSessionId = sessionId;
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
): Promise<Record<string, { strategy?: ResumeStrategy; feedbackLabel?: string }>> {
  const transcriptStore = new TranscriptStore(cwd);
  const providers = VALID_PROVIDERS;
  const info: Record<string, { strategy?: ResumeStrategy; feedbackLabel?: string }> = {};

  for (const provider of providers) {
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
  const { flags, sessionManager, contextArtifactCache } = options;

  const gateway = await startTuiGateway({
    sessionManager,
    port: flags.port,
    onClear: sessionManager.onClear,
    contextArtifactCache,
    planMode: flags.plan ?? false,
  });

  await waitForGateway(`http://localhost:${gateway.port}/health`);

  const providerModelsRef: { current: Record<string, string[]> } = {
    current: gateway.models,
  };

  const createSession = async () => new GatewaySession(
    gateway.url,
    (models: Record<string, string[]>) => {
      providerModelsRef.current = models;
    },
  );

  return {
    createSession,
    providerModelsRef,
    shutdown: () => gateway.shutdown(),
  };
}

function mapSessionEventToTui(event: unknown):
  | { type: "text_delta"; content: string; isThinking?: boolean }
  | { type: "file_changed"; path: string; changeType: "created" | "modified" | "deleted"; linesAdded?: number; linesRemoved?: number }
  | { type: "cost_update"; usd: number }
  | { type: "completed"; totalUsd: number }
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
  const { flags, sessionManager } = options;
  const sessionCwd = flags.cwd ?? process.cwd();

  const createSession = async (): Promise<SessionLike> => {
    const inner = sessionManager.factory(
      "You are Kiln TUI in direct transport mode.",
      sessionCwd,
    );

    return {
      async *run(opts: { prompt: string; cwd?: string }) {
        for await (const event of inner.run(opts)) {
          yield mapSessionEventToTui(event);
        }
      },
      async dispose() {
        await inner.dispose();
      },
    };
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

  const cwd = flags.cwd ?? process.cwd();
  const provider = parseProvider(flags.provider);
  const contextArtifactCache = await getProjectContextArtifactCache(cwd);

  // Resolve domain display name from app config if available
  let domain = "kiln";
  try {
    const { SessionManager } = await import("../wrapper/session-manager.js");
    const wrapperConfig = { mode: "cli-wrapper" as const, permissionPolicy: { approval: "never" as const, sandbox: "workspace-write" as const } };
    const manager = new SessionManager(wrapperConfig, appConfig, contextArtifactCache);
    const context = await manager.prepare("interactive", cwd, undefined, undefined, undefined);
    domain = context.domain.displayName;
  } catch {
    // Non-fatal — proceed without domain name
  }

  // Inject CLI session factory into the gateway (dependency inversion)
  const sessionStore = new SessionStore(cwd);
  const transcriptStore = new TranscriptStore(cwd);
  const initialResumeInfo = await loadInitialResumeInfo(cwd, sessionStore);
  const sessionManager = await makeMultiProviderSessionFactory(
    provider,
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

  const resolvedTheme = themes[flags.theme ?? "kiln-dark"] ?? kilnDark;

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
  const handleResumeSession = (sessionId: string) => {
    // Find which provider this session belongs to and set it as the resume target
    sessionManager.setResumeSession(sessionId, provider);
  };

  await startTui(
    bootstrap.createSession,
    provider,
    domain,
    resolvedTheme,
    initialResumeInfo,
    () => loadInitialResumeInfo(cwd, sessionStore),
    bootstrap.providerModelsRef,
    loadSessionList,
    handleResumeSession,
  );

  bootstrap.shutdown();
  for (const [ev, handler] of handlers) process.off(ev, handler);
}
