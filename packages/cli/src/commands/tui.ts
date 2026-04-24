import { randomUUID } from "node:crypto";
import type { KilnAppConfig } from "../config.js";
import {
  loadResumeSidebarInfo,
  type ResumeSidebarInfo,
} from "../application/resume-sidebar-info.js";
import { inferResumeStrategyFeedback } from "../application/resume-strategy-feedback.js";
import { collectResumeSignals, decideResumeStrategy } from "../application/resume-strategy-policy.js";
import { deriveSessionMetadata } from "../application/session-metadata.js";
import {
  buildCliPlanSummaryArtifactKeyFromShape,
  buildCliProjectSummaryArtifactKey,
  buildCliSessionSummaryArtifactKey,
} from "../application/context-artifact-keys.js";
import { readGlobalConfig } from "../config/global-config.js";
import { resolveEffectiveProvider } from "../config/env-config.js";
import { createDefaultRegistry, getProviderDisplayInfo, type ProviderId } from "../wrapper/session-registry.js";
import { SessionStore, TranscriptStore } from "../wrapper/session-store.js";
import type { PersistedTranscriptEvent } from "../wrapper/session-store.js";
import type { ResumeFeedback, ResumeStrategy } from "../wrapper/index.js";
import { GatewaySession, waitForGateway, themes, kilnDark } from "@kilnai/tui";
import type { SessionLike } from "@kilnai/tui";
import {
  extractText,
  type AgentMessage,
  type CanonicalSessionEventKind,
  type ContextArtifactCache,
  type SessionEventSource,
} from "@kilnai/core";
import { getProjectContextArtifactCache } from "@kilnai/runtime";
import type { CliSessionFactoryContext, CliSessionRunOptions } from "@kilnai/runtime";

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
  context?: CliSessionFactoryContext,
) => import("../wrapper/session.js").IKilnSession;

function latestUserText(messages: readonly AgentMessage[] | undefined): string | undefined {
  if (!messages) {
    return undefined;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") {
      continue;
    }
    const text = extractText(message.parts).trim();
    return text.length > 0 ? text : undefined;
  }
  return undefined;
}

function parseProvider(p: string | undefined, providerIds: readonly ProviderId[]): ProviderId {
  if (p && providerIds.includes(p as ProviderId)) {
    return p as ProviderId;
  }
  return providerIds.includes("claude") ? "claude" : providerIds[0] ?? "claude";
}

function mapTranscriptTypeToKind(type: string): CanonicalSessionEventKind {
  switch (type) {
    case "user":
      return "user_message";
    case "text_delta":
      return "assistant_delta";
    case "tool_use":
      return "tool_call_started";
    case "tool_result":
      return "tool_call_completed";
    case "error":
      return "error_recorded";
    default:
      return "assistant_message";
  }
}

function mapTranscriptTypeToSource(type: string): SessionEventSource {
  switch (type) {
    case "user":
      return { actor: "user", surface: "tui", component: "tui-command" };
    case "text_delta":
      return { actor: "assistant", surface: "tui", component: "tui-command" };
    case "tool_use":
    case "tool_result":
      return { actor: "tool", surface: "tui", component: "tui-command" };
    case "error":
      return { actor: "runtime", surface: "tui", component: "tui-command" };
    default:
      return { actor: "system", surface: "tui", component: "tui-command" };
  }
}

function toPersistedTranscriptEvent(
  sessionId: string,
  sequence: number,
  type: string,
  payload: Record<string, unknown>,
): PersistedTranscriptEvent {
  return {
    eventId: randomUUID(),
    kilnSessionId: sessionId,
    sequence,
    timestamp: new Date().toISOString(),
    kind: mapTranscriptTypeToKind(type),
    source: mapTranscriptTypeToSource(type),
    payload,
  };
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
  const providerModelState = new Map<ProviderId, string>(
    providers.map((provider) => [provider, ""]),
  );
  
  let currentProvider: ProviderId = initialProvider;

  const lastRecord = await sessionStore.last();
  if (lastRecord) {
    for (const p of providers) {
      const state = providerState.get(p);
      if (!state) continue;
      state.resumeSessionId = lastRecord.sessionId;
      state.providerSessionId = lastRecord.providerThread?.provider === p
        ? lastRecord.providerThread.nativeSessionId
        : (await sessionStore.findProviderThread?.(lastRecord.sessionId, p))?.nativeSessionId;
    }
  }

  const policyAwareFactory: CliSessionFactory = (
    systemPrompt: string,
    sessionCwd: string,
    context?: CliSessionFactoryContext,
  ) => {
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
      run: async function* (options: CliSessionRunOptions) {
        const providerForTurn = currentProvider;
        const modelForTurn = providerModelState.get(providerForTurn) || undefined;
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
          sessionLedgerOwner: "host",
          model: modelForTurn,
        });
        activeSession = resumedSession;
        const capturedId = options.kilnSessionId ?? context?.kilnSessionId ?? resumedFrom ?? resumedSession.sessionId;
        const [existingRecord, existingMeta] = await Promise.all([
          sessionStore.find(capturedId),
          transcriptStore.readMeta(capturedId),
        ]);
        const task = existingMeta?.task ?? existingRecord?.task ?? "interactive";
        const metadata = deriveSessionMetadata({
          task,
          prompt: options.prompt,
          provider: providerForTurn,
          model: modelForTurn,
          canonicalTitle: existingMeta?.canonicalTitle ?? existingRecord?.canonicalTitle,
          title: existingMeta?.title ?? existingRecord?.title,
          summary: existingMeta?.summary ?? existingRecord?.summary,
          tags: existingMeta?.tags ?? existingRecord?.tags,
          providersUsed: existingMeta?.providersUsed ?? existingRecord?.providersUsed,
        });
        const startedAt = existingMeta?.startedAt ?? new Date().toISOString();
        if (typeof (transcriptStore as { init?: unknown }).init === "function") {
          await transcriptStore.init(capturedId, {
            kilnSessionId: capturedId,
            provider: providerForTurn,
            canonicalTitle: metadata.canonicalTitle,
            title: metadata.title,
            summary: metadata.summary,
            tags: metadata.tags,
            providersUsed: metadata.providersUsed,
            task,
            startedAt,
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
        let transcriptSeq = (await transcriptStore.readTranscript(capturedId)).length;
        const userText = latestUserText(options.messages);
        if (userText) {
          await transcriptStore.append(
            capturedId,
            toPersistedTranscriptEvent(capturedId, ++transcriptSeq, "user", { content: userText }),
          );
        }
        try {
          for await (const event of resumedSession.run(options)) {
            if (event.type === "text_delta" && !event.isThinking) {
              await transcriptStore.append(
                capturedId,
                toPersistedTranscriptEvent(capturedId, ++transcriptSeq, "text_delta", {
                  type: "text_delta",
                  content: event.content,
                }),
              );
            } else if (event.type === "tool_use") {
              await transcriptStore.append(
                capturedId,
                toPersistedTranscriptEvent(capturedId, ++transcriptSeq, "tool_use", {
                  type: "tool_use",
                  toolName: event.toolName,
                  input: event.input,
                }),
              );
            } else if (event.type === "tool_result") {
              await transcriptStore.append(
                capturedId,
                toPersistedTranscriptEvent(capturedId, ++transcriptSeq, "tool_result", {
                  type: "tool_result",
                  toolName: event.toolName,
                  output: event.output,
                }),
              );
            } else if (event.type === "error") {
              await transcriptStore.append(
                capturedId,
                toPersistedTranscriptEvent(capturedId, ++transcriptSeq, "error", {
                  type: "error",
                  message: event.message,
                  code: event.code,
                }),
              );
            }
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
          for (const [providerId, providerRuntimeState] of providerState) {
            providerRuntimeState.resumeSessionId = capturedId;
            if (providerId === providerForTurn) {
              providerRuntimeState.providerSessionId = resumedSession.providerSessionId;
            }
          }
          if (typeof (transcriptStore as { finalize?: unknown }).finalize === "function") {
            await transcriptStore.finalize(capturedId, {
              completedAt: new Date().toISOString(),
              canonicalTitle: metadata.canonicalTitle,
              title: metadata.title,
              summary: metadata.summary,
              tags: metadata.tags,
              providersUsed: metadata.providersUsed,
              providerThread: resumedSession.providerSessionId
                ? { provider: providerForTurn, nativeSessionId: resumedSession.providerSessionId }
                : undefined,
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
            task,
            canonicalTitle: metadata.canonicalTitle,
            title: metadata.title,
            summary: metadata.summary,
            tags: metadata.tags,
            providersUsed: metadata.providersUsed,
            completedAt: new Date().toISOString(),
            cost: turnCostUsd,
            projectPath: cwd,
            providerThread: resumedSession.providerSessionId
              ? { provider: providerForTurn, nativeSessionId: resumedSession.providerSessionId }
              : undefined,
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
    getModel: () => providerModelState.get(currentProvider) ?? "",
    setModel: (model: string) => {
      providerModelState.set(currentProvider, model);
    },
    onClear: async (_provider?: string) => {
      for (const state of providerState.values()) {
        state.resumeSessionId = undefined;
        state.providerSessionId = undefined;
      }
    },
    setResumeSession: (sessionId: string, provider?: string) => {
      const targetProvider = provider && providers.includes(provider as ProviderId)
        ? provider as ProviderId
        : currentProvider;
      const state = providerState.get(targetProvider);
      if (state) {
        currentProvider = targetProvider;
        state.resumeSessionId = sessionId;
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
  setResumeSession: (sessionId: string, provider?: string) => void;
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
  const initialResumeInfo: Record<string, ResumeSidebarInfo> = await loadResumeSidebarInfo(
    sessionStore,
    transcriptStore,
    providerIds,
  );
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
    () => loadResumeSidebarInfo(sessionStore, transcriptStore, providerIds),
    bootstrap.providerModelsRef,
    startupTransport === "direct" ? loadSessionList : undefined,
    startupTransport === "direct" ? handleResumeSession : undefined,
  );

  bootstrap.shutdown();
  for (const [ev, handler] of handlers) process.off(ev, handler);
}
