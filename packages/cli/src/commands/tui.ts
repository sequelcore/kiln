import type { KilnAppConfig } from "../config.js";
import { inferResumeStrategyFeedback } from "../application/resume-strategy-feedback.js";
import { collectResumeSignals, decideResumeStrategy } from "../application/resume-strategy-policy.js";
import { createDefaultRegistry } from "../wrapper/session-registry.js";
import { SessionStore, TranscriptStore } from "../wrapper/session-store.js";
import type { ResumeFeedback, ResumeStrategy } from "../wrapper/index.js";
import { GatewaySession, waitForGateway, themes, kilnDark } from "@kilnai/tui";
import { getProjectContextArtifactCache } from "@kilnai/runtime";
import type { CliSessionFactory } from "@kilnai/runtime";
import type { ContextArtifactCache } from "@kilnai/core";

export interface TuiFlags {
  provider?: string;
  cwd?: string;
  port?: number;
  theme?: string;
}

const VALID_PROVIDERS = ["claude", "codex", "opencode"] as const;
type SupportedProvider = (typeof VALID_PROVIDERS)[number];

function parseProvider(p?: string): SupportedProvider {
  if (p && VALID_PROVIDERS.includes(p as SupportedProvider)) {
    return p as SupportedProvider;
  }
  return "claude";
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
  const providers = ["claude", "codex", "opencode"] as const;
  
  // Per-provider session state
  const providerState: Record<SupportedProvider, { resumeSessionId?: string; providerSessionId?: string }> = {
    claude: {},
    codex: {},
    opencode: {},
  };
  
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
    const state = providerState[currentProvider];
    return {
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

        const originalDispose = resumedSession.dispose.bind(resumedSession);
        resumedSession.dispose = async () => {
          const capturedId = resumedSession.sessionId;
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
        // no-op; inner session is disposed inside run lifecycle
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
  const providers = ["claude", "codex", "opencode"] as const;
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

export async function tuiCommand(appConfig: KilnAppConfig, flags: TuiFlags = {}): Promise<void> {
  const { startTui } = await import("@kilnai/tui");
  const { startTuiGateway } = await import("@kilnai/runtime");
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

  // Start the in-process TUI gateway on port 4801
  const gateway = await startTuiGateway({
    sessionManager,
    port: flags.port,
    onClear: sessionManager.onClear,
    contextArtifactCache,
  });

  // Wait for gateway to be ready before connecting the TUI
  await waitForGateway(`http://localhost:${gateway.port}/health`);

  // Pre-populate provider models from gateway
  const providerModelsRef: { current: Record<string, string[]> } = {
    current: gateway.models,
  };

  // GatewaySession is the sole SessionLike — gateway owns orchestration
  const createSession = async () => new GatewaySession(
    gateway.url,
    (models: Record<string, string[]>) => {
      providerModelsRef.current = models;
    }
  );

  const shutdown = (code = 0, error?: unknown) => {
    gateway.shutdown();
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
    createSession,
    provider,
    domain,
    resolvedTheme,
    initialResumeInfo,
    () => loadInitialResumeInfo(cwd, sessionStore),
    providerModelsRef,
    loadSessionList,
    handleResumeSession,
  );

  gateway.shutdown();
  for (const [ev, handler] of handlers) process.off(ev, handler);
}
