import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { KilnAppConfig } from "../config.js";
import {
  loadContinuationSidebarInfo,
  type ContinuationSidebarInfo,
} from "../application/continuation-sidebar-info.js";
import { inferResumeStrategyFeedback } from "../application/resume-strategy-feedback.js";
import { collectResumeSignals, decideResumeStrategy } from "../application/resume-strategy-policy.js";
import {
  deriveSessionMetadata,
  mergeProvidersUsed,
  shouldPromoteLatestPromptToSessionTitle,
} from "../application/session-metadata.js";
import {
  buildCliPlanSummaryArtifactKeyFromShape,
  buildCliProjectSummaryArtifactKey,
  buildCliSessionSummaryArtifactKey,
} from "../application/context-artifact-keys.js";
import {
  readGlobalConfig,
  resolveGlobalDefaultModel,
  resolveGlobalDefaultProvider,
  resolveGlobalUiTheme,
} from "../config/global-config.js";
import { withGlobalIdentityContext } from "../config/operator-identity-context.js";
import { withContextCandidates } from "../application/agent-skill-context.js";
import { resolveInstructionProfileContextCandidates } from "../application/instruction-profile-context.js";
import { withWorkGovernanceContext } from "../application/work-governance-context.js";
import { createTranscriptRuntimeSessionHydrator } from "../application/runtime-session-rehydration.js";
import { readConfigStatusSnapshot } from "../application/config-status.js";
import {
  createCliTranscriptBudgetUsageReader,
  createRuntimeBudgetAdmissionFromGlobalConfig,
} from "../application/runtime-budget-admission.js";
import {
  createKilnRuntimeManagedInvocationAttachment,
  createManagedInvocationExecutionProofResolverRef,
} from "../application/managed-invocation-attachment.js";
import { readKilnYaml } from "../kiln-yaml.js";
import { loadKilnConfig, loadResolvedKilnMcpConfiguration } from "../config/config-merger.js";
import { resolveEffectiveProvider } from "../config/env-config.js";
import { resolveOperatorVoiceRuntime, type OperatorVoiceRuntime } from "../config/operator-voice.js";
import { createStartupProfiler, type StartupProfiler } from "../application/startup-profiler.js";
import { createManagedDirectProviderAdapterFactory } from "../config/managed-agent-direct-adapters.js";
import { createKilnConfigTools } from "../application/config-tools.js";
import { createWorkGovernanceTools } from "../application/work-governance-tool.js";
import { recoverStaleOpenTranscriptSessions } from "../application/transcript-session-recovery.js";
import { createStagedManagedInvocationRouteCatalog } from "../config/managed-agent-route-catalog.js";
import {
  readProviderDiscoveryCache,
  writeProviderDiscoveryCache,
} from "../config/provider-discovery-cache.js";
import {
  loadConfiguredBuiltinToolSurfaceOptions,
  withProgressiveRuntimeToolProjection,
} from "../config/builtin-tool-surface-config.js";
import { resolveEngineAvailabilityMap } from "../engines/engine-registry.js";
import {
  createDefaultRegistry,
  getProviderDisplayInfo,
  getRuntimeProviderAvailability,
  type ProviderId,
} from "../wrapper/session-registry.js";
import { SessionStore, TranscriptStore } from "../wrapper/session-store.js";
import type { PersistedProviderTokenUsage, PersistedTranscriptEvent, PersistedTranscriptEventDraft } from "../wrapper/session-store.js";
import type { ResumeFeedback, ResumeStrategy } from "../wrapper/index.js";
import { GatewaySession, waitForGateway, themes, kilnDark } from "@kilnai/tui";
import type { SessionLike } from "@kilnai/tui";
import {
  GUI_PROVIDER_DISPLAY_ORDER,
  buildOperatorToolResultPayload,
  formatPresentationIntentAsText,
  getGuiProviderMetadata,
  isGuiProviderModeless,
  parseOperatorToolResultEnvelope,
  presentOperatorEventPayload,
  type GuiProviderDiscoveryResult,
  type GuiProviderModelDiscoveryProjection,
} from "@kilnai/gateway-contracts";
import {
  assertScopedExecutionSessionToolEvent,
  GoalRunStore,
  WorkItemStore,
  createSessionBuiltinToolOptions,
  extractText,
  type AgentMessage,
  type CanonicalSessionEvent,
  type CanonicalSessionEventKind,
  type ContextArtifactCache,
  type DefaultBuiltinToolRegistryOptions,
  type ExecutionSessionRunOptions,
  type SessionEventSource,
  type SessionTurnOutcome,
} from "@kilnai/core";
import {
  attachManagedInvocationSessionEventSink,
  getProjectContextArtifactCache,
  withManagedInvocationService,
} from "@kilnai/runtime";
import {
  createProviderCatalogService,
  markGuiProviderDiscoveryStale,
  projectGuiProviderModelDiscovery,
  providerRequiresSelectedModelMessage,
  resolveGuiOperatorDiscoveryResults,
  resolveGuiProviderSwitch,
} from "@kilnai/runtime";
import {
  managedInvocationPersistedTranscriptEventDrafts,
  operatorTranscriptKindForType,
  operatorTranscriptSourceForType,
  projectGovernanceTranscriptEventDrafts,
} from "../application/operator-transcript-projection.js";
import type {
  CliSessionFactoryContext,
  ManagedInvocationToolAttachment,
  RuntimeBudgetAdmissionPort,
  RuntimeSessionHydrator,
} from "@kilnai/runtime";
import { persistTuiThemePreference } from "../application/operator-theme-preferences.js";
import { resolveProjectRoot } from "../application/project-root-resolver.js";

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
  readonly cwd: string;
  readonly sessionManager: MultiProviderSessionManager;
  readonly registry: ReturnType<typeof createDefaultRegistry>["registry"];
  readonly contextArtifactCache: ContextArtifactCache;
  readonly systemPrompt: string;
  readonly operatorTimeZone?: string;
  readonly builtinToolOptions?: DefaultBuiltinToolRegistryOptions;
  readonly managedInvocation?: ManagedInvocationToolAttachment;
  readonly budgetAdmission?: RuntimeBudgetAdmissionPort;
  readonly resumeSessionHydrator?: RuntimeSessionHydrator;
  readonly operatorVoice?: OperatorVoiceRuntime;
  readonly initialProviderDiscovery?: readonly GuiProviderDiscoveryResult[];
  readonly onProviderDiscoveryResolved?: (discovery: readonly GuiProviderDiscoveryResult[]) => void;
  readonly startupProfiler?: StartupProfiler;
}

interface TuiBootstrapResult {
  readonly createSession: () => Promise<SessionLike>;
  readonly providerModelsRef: { current: Record<string, string[]> };
  readonly providerDiscoveryRef: { current: readonly GuiProviderDiscoveryResult[] };
  readonly providerModelDiscoveryRef: { current: GuiProviderModelDiscoveryProjection | null };
  shutdown(): void;
}
type TuiControlSession = SessionLike & {
  clear?: () => Promise<void>;
  refreshProviders?: () => Promise<void>;
  switchProvider?: (provider: string, model?: string) => Promise<string>;
  approve?: (sessionId?: string) => void;
  reject?: (reason: string, sessionId?: string) => void;
};
type ProviderSessionState = { continuationSessionId?: string; providerSessionId?: string };
type CliSessionFactory = (
  systemPrompt: string,
  cwd: string,
  context?: CliSessionFactoryContext,
) => import("../wrapper/session.js").IKilnSession;
type CliProviderDisplayInfo = ReturnType<typeof getProviderDisplayInfo>[number];
type OperatorTranscriptSurface = "tui" | "gui";

function writeTuiBootstrapStatus(message: string): void {
  if (!process.stderr.isTTY) {
    return;
  }
  process.stderr.write(`${message}\n`);
}

function normalizeProviderModels(models: readonly string[] | undefined): string[] {
  const unique = new Set<string>();
  for (const model of models ?? []) {
    const trimmed = model.trim();
    if (trimmed.length > 0) {
      unique.add(trimmed);
    }
  }
  return [...unique];
}

function buildTuiStartupProviderDisplayInfo(input: {
  readonly providerDisplayInfo: readonly CliProviderDisplayInfo[];
  readonly runtimeModels: Record<string, string[]>;
  readonly runtimeDiscovery?: readonly GuiProviderDiscoveryResult[];
  readonly includeModelessProviders?: boolean;
  readonly includePendingProviders?: boolean;
}): CliProviderDisplayInfo[] {
  const providerById = new Map<string, CliProviderDisplayInfo>();
  for (const provider of input.providerDisplayInfo) {
    providerById.set(provider.id, provider);
  }

  const orderedProviderIds: string[] = [];
  const seen = new Set<string>();
  const addOrderedProviderId = (providerId: string): void => {
    if (seen.has(providerId) || !providerById.has(providerId)) {
      return;
    }
    seen.add(providerId);
    orderedProviderIds.push(providerId);
  };

  for (const provider of input.providerDisplayInfo) {
    addOrderedProviderId(provider.id);
  }
  for (const providerId of GUI_PROVIDER_DISPLAY_ORDER) {
    addOrderedProviderId(providerId);
  }

  return orderedProviderIds.flatMap((providerId) => {
    const provider = providerById.get(providerId);
    if (!provider) {
      return [];
    }
    const runtimeModels = normalizeProviderModels(input.runtimeModels[providerId]);
    const models = runtimeModels;
    const runtimeCatalogContainsProvider = Object.prototype.hasOwnProperty.call(input.runtimeModels, providerId);
    const discovery = input.runtimeDiscovery?.find((entry) => entry.provider === providerId);
    const metadata = getGuiProviderMetadata(providerId);
    const includeAuthProvider = Boolean(
      metadata?.authMethod
        && discovery
        && !discovery.available
        && (discovery.authState === "missing" || discovery.authState === "expired"),
    );
    if (models.length === 0) {
      const includeModelessProvider = input.includeModelessProviders === true
        && runtimeCatalogContainsProvider
        && isGuiProviderModeless(providerId);
      if (!includeModelessProvider && !includeAuthProvider && !input.includePendingProviders) {
        return [];
      }
    }
    return [{
      ...provider,
      models,
      available: discovery?.available,
      reason: discovery?.reason,
    }];
  });
}

function assertTuiProviderAvailableInStartupCatalog(
  provider: ProviderId,
  startupProviderDisplayInfo: readonly CliProviderDisplayInfo[],
): void {
  const startupProvider = startupProviderDisplayInfo.find((entry) => entry.id === provider);
  if (startupProvider && (startupProvider.models.length > 0 || isGuiProviderModeless(provider))) {
    return;
  }
  const metadata = getGuiProviderMetadata(provider);
  const startupAvailability = startupProvider as ({ readonly available?: boolean } & CliProviderDisplayInfo) | undefined;
  if (metadata?.authMethod && startupAvailability?.available === false) {
    return;
  }

  const runtimeProviderIds = startupProviderDisplayInfo
    .filter((entry) => entry.models.length > 0 || isGuiProviderModeless(entry.id))
    .map((entry) => entry.id);
  const availableProviders =
    runtimeProviderIds.length > 0 ? runtimeProviderIds.join(", ") : "none";
  throw new Error(
    `Provider '${provider}' is not available in the runtime TUI model catalog. Available providers: ${availableProviders}`,
  );
}

function projectEligibleTuiProviderModels(
  projection: GuiProviderModelDiscoveryProjection | null,
  discovery: readonly GuiProviderDiscoveryResult[],
  gatewayModelessProviderIds: readonly string[] = [],
): Record<string, string[]> {
  const modelsByProvider: Record<string, string[]> = {};
  for (const entry of projection?.entries ?? []) {
    if (!entry.eligibility.eligible) {
      continue;
    }
    const provider = entry.providerRoute.providerId;
    const model = entry.providerRoute.providerModelId;
    const models = modelsByProvider[provider] ?? [];
    if (!models.includes(model)) {
      models.push(model);
    }
    modelsByProvider[provider] = models;
  }
  for (const entry of discovery) {
    if (entry.available
      && entry.status === "model_selection_not_required"
      && isGuiProviderModeless(entry.provider)) {
      modelsByProvider[entry.provider] = [];
    }
  }
  for (const provider of gatewayModelessProviderIds) {
    if (isGuiProviderModeless(provider)) {
      modelsByProvider[provider] = [];
    }
  }
  return modelsByProvider;
}

function isOnlyStaleProviderDiscovery(discovery: readonly GuiProviderDiscoveryResult[]): boolean {
  return discovery.length > 0 && discovery.every((entry) => entry.status === "stale");
}

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

function parseProvider(
  p: string | undefined,
  providerIds: readonly ProviderId[],
): ProviderId {
  const requestedProvider = p?.trim() ?? "";
  if (requestedProvider.length === 0) {
    throw new Error("No provider configured. Set --provider, KILN_PROVIDER, or global provider.");
  }
  if (providerIds.includes(requestedProvider as ProviderId)) {
    return requestedProvider as ProviderId;
  }
  throw new Error(`Unknown provider: ${requestedProvider}`);
}

function toPersistedTranscriptEvent(
  sessionId: string,
  sequence: number,
  type: string,
  payload: Record<string, unknown>,
  surface: OperatorTranscriptSurface,
  turnId?: string,
  executionScope?: ExecutionSessionRunOptions["executionScope"],
): PersistedTranscriptEvent {
  return {
    eventId: randomUUID(),
    kilnSessionId: sessionId,
    sequence,
    timestamp: new Date().toISOString(),
    kind: operatorTranscriptKindForType(type),
    source: operatorTranscriptSourceForType(type, surface, surface === "gui" ? "gui-command" : "tui-command"),
    ...(turnId ? { turnId } : {}),
    ...(executionScope ? { executionScope } : {}),
    payload,
  };
}

function persistedEvent(
  sessionId: string,
  sequence: number,
  kind: CanonicalSessionEventKind,
  source: SessionEventSource,
  payload: Record<string, unknown>,
  turnId?: string,
): PersistedTranscriptEvent {
  return {
    eventId: randomUUID(),
    kilnSessionId: sessionId,
    sequence,
    timestamp: new Date().toISOString(),
    kind,
    source,
    ...(turnId ? { turnId } : {}),
    payload,
  };
}

function extractManagedProviderRouteIdFromToolUse(toolName: string, input: unknown): string | undefined {
  if (toolName !== "managed_agent.invoke" && toolName !== "managed_agent.start") {
    return undefined;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const providerRoute = (input as { readonly providerRoute?: unknown }).providerRoute;
  if (!providerRoute || typeof providerRoute !== "object" || Array.isArray(providerRoute)) {
    return undefined;
  }
  const providerId = (providerRoute as { readonly providerId?: unknown }).providerId;
  return typeof providerId === "string" && providerId.trim().length > 0 ? providerId.trim() : undefined;
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
  initialProvider: ProviderId | null,
  providerIds: readonly ProviderId[],
  cwd: string,
  registry: ReturnType<typeof createDefaultRegistry>["registry"],
  sessionStore: SessionStore,
  transcriptStore: TranscriptStore,
  contextArtifactCache: ContextArtifactCache,
  builtinToolOptions?: DefaultBuiltinToolRegistryOptions,
  transcriptSurface: OperatorTranscriptSurface = "tui",
  managedInvocation?: ManagedInvocationToolAttachment,
  budgetAdmission?: RuntimeBudgetAdmissionPort,
): Promise<MultiProviderSessionManager> {
  const providers = providerIds;

  // Per-provider session state
  const providerState = new Map<ProviderId, ProviderSessionState>(
    providers.map((provider) => [provider, {}]),
  );
  const providerModelState = new Map<ProviderId, string>(
    providers.map((provider) => [provider, ""]),
  );
  const activeTranscriptWriters = new Map<string, {
    appendManagedInvocationEvents(events: readonly CanonicalSessionEvent[]): Promise<void>;
  }>();
  const managedInvocationWithTranscriptSink = attachManagedInvocationSessionEventSink(managedInvocation, {
    publish: async (events, context) => {
      const sessionId = context.session.id;
      const writer = activeTranscriptWriters.get(sessionId);
      if (writer) {
        await writer.appendManagedInvocationEvents(events);
        return;
      }
      const appended = await transcriptStore.appendManyNext(
        sessionId,
        managedInvocationPersistedTranscriptEventDrafts(events),
      );
      const managedProviders = events
        .map(managedInvocationProviderId)
        .filter((providerId): providerId is string => providerId !== undefined);
      const managedUsage = managedInvocationProviderTokenUsageForAppendedEvents(events, appended);
      if (managedProviders.length > 0) {
        const existingMeta = await transcriptStore.readMeta(sessionId);
        if (existingMeta) {
          await transcriptStore.finalize(sessionId, {
            providersUsed: mergeProvidersUsed(existingMeta.providersUsed, managedProviders),
            ...(managedUsage.length > 0 ? { providerTokenUsage: managedUsage } : {}),
          });
        }
      }
    },
  });
  const sessionBuiltinToolOptions = createSessionBuiltinToolOptions(builtinToolOptions);

  let currentProvider: ProviderId | null = initialProvider;

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
      run: async function* (options: ExecutionSessionRunOptions) {
        const providerForTurn = currentProvider;
        if (!providerForTurn) {
          throw new Error("No provider selected for this turn.");
        }
        const modelForTurn = providerModelState.get(providerForTurn) || undefined;
        const state = providerState.get(providerForTurn) ?? {};
        const resumedFrom = state.continuationSessionId;
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
        const stableRuntimeSessionId = options.kilnSessionId ?? context?.kilnSessionId ?? resumedFrom;
        const decision = decideResumeStrategy({
          continuationSessionId: resumedFrom,
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
          ...(stableRuntimeSessionId ? { runtimeSessionId: stableRuntimeSessionId } : {}),
          continuationSessionId: decision.shouldUseProviderNativeResume ? resumedFrom : undefined,
          sessionLedgerOwner: "host",
          model: modelForTurn,
          deliberationResolution: options.deliberationResolution,
          ...(context?.requestedAuthority ? { requestedAuthority: context.requestedAuthority } : {}),
          ...(context?.operatorSurface ? { operatorSurface: context.operatorSurface } : {}),
          builtinToolOptions: sessionBuiltinToolOptions,
          ...(managedInvocationWithTranscriptSink ? { managedInvocation: managedInvocationWithTranscriptSink } : {}),
          ...(budgetAdmission ? { budgetAdmission } : {}),
        });
        activeSession = resumedSession;
        const capturedId = stableRuntimeSessionId ?? resumedSession.sessionId;
        const [existingRecord, existingMeta] = await Promise.all([
          sessionStore.find(capturedId),
          transcriptStore.readMeta(capturedId),
        ]);
        const task = existingMeta?.task ?? existingRecord?.task ?? "interactive";
        const shouldPromoteLatestPrompt = shouldPromoteLatestPromptToSessionTitle({
          existingTitle: existingMeta?.canonicalTitle ?? existingRecord?.canonicalTitle ?? existingMeta?.title ?? existingRecord?.title,
          latestPrompt: options.prompt,
        });
        const metadata = deriveSessionMetadata({
          task,
          prompt: options.prompt,
          provider: providerForTurn,
          model: modelForTurn,
          canonicalTitle: shouldPromoteLatestPrompt ? undefined : existingMeta?.canonicalTitle ?? existingRecord?.canonicalTitle,
          title: shouldPromoteLatestPrompt ? undefined : existingMeta?.title ?? existingRecord?.title,
          summary: shouldPromoteLatestPrompt ? undefined : existingMeta?.summary ?? existingRecord?.summary,
          tags: existingMeta?.tags ?? existingRecord?.tags,
          providersUsed: existingMeta?.providersUsed ?? existingRecord?.providersUsed,
        });
        const providersUsed = new Set(metadata.providersUsed);
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
        let turnOutcome: SessionTurnOutcome | undefined;
        let turnInputTokens = 0;
        let turnOutputTokens = 0;
        let turnCacheReadTokens = 0;
        let turnCacheWriteTokens = 0;
        let turnProviderTokenUsage: PersistedProviderTokenUsage | undefined;
        const managedProviderTokenUsage = new Map<string, PersistedProviderTokenUsage>();
        let assistantContent = "";
        let assistantDeltaIndex = 0;
        const pendingToolCallIds = new Map<string, string[]>();
        const priorTranscript = await transcriptStore.readTranscript(capturedId);
        const appendTranscriptEvent = async (event: PersistedTranscriptEventDraft): Promise<void> => {
          await transcriptStore.appendNext(capturedId, event);
        };
        activeTranscriptWriters.set(capturedId, {
          appendManagedInvocationEvents: async (events) => {
            for (const event of events) {
              const managedProviderId = managedInvocationProviderId(event);
              if (managedProviderId) {
                providersUsed.add(managedProviderId);
              }
            }
            const appended = await transcriptStore.appendManyNext(
              capturedId,
              managedInvocationPersistedTranscriptEventDrafts(events),
            );
            for (const usage of managedInvocationProviderTokenUsageForAppendedEvents(events, appended)) {
              recordPersistedProviderTokenUsage(managedProviderTokenUsage, usage);
            }
          },
        });
        const turnOrdinal = priorTranscript.filter((event) => event.kind === "turn_started").length + 1;
        const turnId = `${capturedId}:turn:${turnOrdinal}`;
        const assistantMessageId = `${turnId}:assistant`;
        const source = (actor: SessionEventSource["actor"]): SessionEventSource => ({
          actor,
          surface: transcriptSurface,
          component: transcriptSurface === "gui" ? "gui-command" : "tui-command",
        });
        await appendTranscriptEvent(
          persistedEvent(capturedId, 0, "turn_started", source("runtime"), {
            turnId,
            turnOrdinal,
            trigger: "user_message",
          }, turnId),
        );
        const userText = latestUserText(options.messages) ?? options.prompt.trim();
        if (userText) {
          await appendTranscriptEvent(
            toPersistedTranscriptEvent(capturedId, 0, "user", {
              messageId: `${turnId}:user`,
              content: userText,
            }, transcriptSurface, turnId),
          );
        }
        try {
          for await (const event of resumedSession.run({ ...options, turnId })) {
            if (!event || typeof event !== "object" || !("type" in event)) {
              yield event;
              continue;
            }
            if (event.type === "text_delta" && !event.isThinking) {
              assistantContent += event.content;
              await appendTranscriptEvent(
                toPersistedTranscriptEvent(capturedId, 0, "text_delta", {
                  messageId: assistantMessageId,
                  delta: event.content,
                  deltaIndex: assistantDeltaIndex++,
                }, transcriptSurface, turnId),
              );
            } else if (event.type === "tool_use") {
              assertScopedExecutionSessionToolEvent(event);
              const toolCallId = event.toolCallId;
              const toolCallScopeId = event.toolCallScopeId;
              const managedProvider = extractManagedProviderRouteIdFromToolUse(event.toolName, event.input);
              if (managedProvider) {
                providersUsed.add(managedProvider);
              }
              const pending = pendingToolCallIds.get(event.toolName) ?? [];
              pending.push(toolCallId);
              pendingToolCallIds.set(event.toolName, pending);
              await appendTranscriptEvent(
                toPersistedTranscriptEvent(capturedId, 0, "tool_use", {
                  toolCallId,
                  toolCallScopeId,
                  toolName: event.toolName,
                  input: event.input,
                }, transcriptSurface, turnId, options.executionScope),
              );
            } else if (event.type === "tool_result") {
              assertScopedExecutionSessionToolEvent(event);
              const pending = pendingToolCallIds.get(event.toolName);
              const toolCallId = event.toolCallId;
              const toolCallScopeId = event.toolCallScopeId;
              const pendingIndex = pending?.indexOf(event.toolCallId) ?? -1;
              if (pending && pendingIndex >= 0) {
                pending.splice(pendingIndex, 1);
              }
              if (pending && pending.length === 0) {
                pendingToolCallIds.delete(event.toolName);
              }
              const toolResultPayload = {
                toolCallScopeId,
                ...buildOperatorToolResultPayload({
                  toolCallId,
                  toolName: event.toolName,
                  output: event.output,
                  ...(event.outputSummary !== undefined ? { outputSummary: event.outputSummary } : {}),
                  ...(event.isError !== undefined ? { isError: event.isError } : {}),
                }),
              };
              const persistedToolResult = toPersistedTranscriptEvent(
                capturedId,
                0,
                "tool_result",
                toolResultPayload,
                transcriptSurface,
                turnId,
                options.executionScope,
              );
              await transcriptStore.appendManyNext(
                capturedId,
                [
                  persistedToolResult,
                  ...projectGovernanceTranscriptEventDrafts(persistedToolResult),
                ],
              );
            } else if (event.type === "error") {
              await appendTranscriptEvent(
                toPersistedTranscriptEvent(capturedId, 0, "error", {
                  message: event.message,
                  code: event.code,
                  retriable: event.isRetryable,
                }, transcriptSurface, turnId),
              );
            } else if (event.type === "cost_update") {
              const usageProvider = event.provider ?? providerForTurn;
              const usageModel = event.model ?? modelForTurn;
              turnCostUsd = event.usd;
              turnInputTokens = event.inputTokens ?? turnInputTokens;
              turnOutputTokens = event.outputTokens ?? turnOutputTokens;
              turnCacheReadTokens = event.cacheReadTokens ?? turnCacheReadTokens;
              turnCacheWriteTokens = event.cacheWriteTokens ?? turnCacheWriteTokens;
              turnProviderTokenUsage = {
                provider: usageProvider,
                ...(usageModel ? { model: usageModel } : {}),
                inputTokens: turnInputTokens,
                outputTokens: turnOutputTokens,
                cacheReadTokens: turnCacheReadTokens,
                cacheWriteTokens: turnCacheWriteTokens,
              };
              await appendTranscriptEvent(
                toPersistedTranscriptEvent(capturedId, 0, "cost_update", {
                  provider: {
                    provider: usageProvider,
                    ...(usageModel ? { model: usageModel } : {}),
                    ...(event.canonicalModel ? { canonicalModel: event.canonicalModel } : {}),
                    ...(event.billingMode ? { billingMode: event.billingMode } : {}),
                  },
                  usage: {
                    inputTokens: turnInputTokens,
                    outputTokens: turnOutputTokens,
                    cacheReadTokens: turnCacheReadTokens,
                    cacheWriteTokens: turnCacheWriteTokens,
                  },
                  cost: {
                    deltaUsd: event.usd,
                    currency: "USD",
                  },
                }, transcriptSurface, turnId),
              );
            }
            if (event.type === "completed") {
              turnCostUsd = event.totalUsd;
              turnOutcome = event.outcome;
            }
            yield options.executionScope && !event.executionScope
              ? { ...event, executionScope: options.executionScope }
              : event;
          }
        } finally {
          if (assistantContent.trim().length > 0) {
            await appendTranscriptEvent(
              persistedEvent(capturedId, 0, "assistant_message", source("assistant"), {
                messageId: assistantMessageId,
                content: assistantContent,
                provider: {
                  provider: providerForTurn,
                  ...(modelForTurn ? { model: modelForTurn } : { model: providerForTurn }),
                },
              }, turnId),
            );
          }
          const lastTurnOutcome = options.abortSignal?.aborted
            ? "cancelled"
            : turnOutcome ?? "failed";
          await appendTranscriptEvent(
            persistedEvent(capturedId, 0, "turn_completed", source("runtime"), {
              turnId,
              outcome: lastTurnOutcome,
              ...(assistantContent.trim().length > 0 ? { outputMessageId: assistantMessageId } : {}),
            }, turnId),
          );
          activeTranscriptWriters.delete(capturedId);
          await resumedSession.dispose();
          for (const [providerId, providerRuntimeState] of providerState) {
            providerRuntimeState.continuationSessionId = capturedId;
            if (providerId === providerForTurn) {
              providerRuntimeState.providerSessionId = resumedSession.providerSessionId;
            }
          }
          const finalProvidersUsed = mergeProvidersUsed([...providersUsed], [providerForTurn]);
          const finalMetadata = deriveSessionMetadata({
            task,
            provider: providerForTurn,
            model: modelForTurn,
            canonicalTitle: metadata.canonicalTitle,
            title: metadata.title,
            summary: metadata.summary,
            tags: metadata.tags,
            providersUsed: finalProvidersUsed,
            hasError: lastTurnOutcome === "failed",
          });
          if (typeof (transcriptStore as { finalize?: unknown }).finalize === "function") {
            await transcriptStore.finalize(capturedId, {
              completedAt: new Date().toISOString(),
              canonicalTitle: finalMetadata.canonicalTitle,
              title: finalMetadata.title,
              summary: finalMetadata.summary,
              tags: finalMetadata.tags,
              providersUsed: finalMetadata.providersUsed,
              lastTurnOutcome,
              costUsd: turnCostUsd,
              inputTokens: turnInputTokens,
              outputTokens: turnOutputTokens,
              cacheReadTokens: turnCacheReadTokens,
              cacheWriteTokens: turnCacheWriteTokens,
              ...((turnProviderTokenUsage || managedProviderTokenUsage.size > 0) ? {
                providerTokenUsage: [
                  ...(turnProviderTokenUsage ? [turnProviderTokenUsage] : []),
                  ...managedProviderTokenUsage.values(),
                ],
              } : {}),
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
            canonicalTitle: finalMetadata.canonicalTitle,
            title: finalMetadata.title,
            summary: finalMetadata.summary,
            tags: finalMetadata.tags,
            providersUsed: finalMetadata.providersUsed,
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
    managedInvocation: managedInvocationWithTranscriptSink,
    getProvider: () => currentProvider ?? "",
    setProvider: (newProvider: string) => {
      if (providers.includes(newProvider as ProviderId)) {
        currentProvider = newProvider as ProviderId;
      }
    },
    getModel: () => currentProvider ? providerModelState.get(currentProvider) ?? "" : "",
    setModel: (model: string) => {
      if (currentProvider) {
        providerModelState.set(currentProvider, model);
      }
    },
    onClear: async (provider?: string) => {
      for (const state of providerState.values()) {
        state.continuationSessionId = undefined;
        state.providerSessionId = undefined;
      }
      await sessionStore.clearContinuationTarget(provider);
    },
    setContinuationSession: (sessionId: string, provider?: string) => {
      const targetProvider = provider && providers.includes(provider as ProviderId)
        ? provider as ProviderId
        : currentProvider;
      if (!targetProvider) {
        return;
      }
      const state = providerState.get(targetProvider);
      if (state) {
        currentProvider = targetProvider;
        state.continuationSessionId = sessionId;
      }
    },
  };
}

function managedInvocationProviderId(event: CanonicalSessionEvent): string | undefined {
  if (
    event.kind !== "agent_invocation_requested"
    && event.kind !== "agent_invocation_started"
    && event.kind !== "agent_invocation_completed"
    && event.kind !== "agent_invocation_failed"
    && event.kind !== "agent_invocation_cancelled"
  ) {
    return undefined;
  }
  const providerId = event.providerRoute?.providerId;
  return typeof providerId === "string" && providerId.trim().length > 0
    ? providerId.trim()
    : undefined;
}

function managedInvocationProviderTokenUsageForAppendedEvents(
  events: readonly CanonicalSessionEvent[],
  appended: readonly PersistedTranscriptEvent[],
): readonly PersistedProviderTokenUsage[] {
  const appendedEventIds = new Set(appended.map((event) => event.eventId));
  return events.flatMap((event) => {
    if (
      (event.kind !== "agent_invocation_completed"
        && event.kind !== "agent_invocation_failed"
        && event.kind !== "agent_invocation_cancelled")
      || !appendedEventIds.has(event.eventId)
    ) {
      return [];
    }
    const provider = managedInvocationProviderId(event);
    const usage = event.managedInvocationEvidence?.usage;
    if (!provider || !usage) {
      return [];
    }
    const tokenClasses = new Map(usage.tokenClasses.map((entry) => [entry.name, entry.value] as const));
    const readUsage = (name: "input" | "output" | "cache_read" | "cache_write"): number => {
      const value = tokenClasses.get(name);
      return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
    };
    return [{
      provider,
      ...(event.providerRoute?.model ? { model: event.providerRoute.model } : {}),
      inputTokens: readUsage("input"),
      outputTokens: readUsage("output"),
      cacheReadTokens: readUsage("cache_read"),
      cacheWriteTokens: readUsage("cache_write"),
    }];
  });
}

function recordPersistedProviderTokenUsage(
  usageByProviderModel: Map<string, PersistedProviderTokenUsage>,
  usage: PersistedProviderTokenUsage,
): void {
  const key = `${usage.provider}\0${usage.model ?? ""}`;
  const existing = usageByProviderModel.get(key);
  usageByProviderModel.set(key, {
    provider: usage.provider,
    ...(usage.model ? { model: usage.model } : {}),
    inputTokens: (existing?.inputTokens ?? 0) + (usage.inputTokens ?? 0),
    outputTokens: (existing?.outputTokens ?? 0) + (usage.outputTokens ?? 0),
    cacheReadTokens: (existing?.cacheReadTokens ?? 0) + (usage.cacheReadTokens ?? 0),
    cacheWriteTokens: (existing?.cacheWriteTokens ?? 0) + (usage.cacheWriteTokens ?? 0),
  });
}

export interface MultiProviderSessionManager {
  readonly factory: CliSessionFactory;
  readonly managedInvocation?: ManagedInvocationToolAttachment;
  getProvider: () => string;
  setProvider: (provider: string) => void;
  getModel: () => string;
  setModel: (model: string) => void;
  onClear: (provider?: string) => Promise<void>;
  setContinuationSession: (sessionId: string, provider?: string) => void;
}

async function bootstrapGatewaySession(
  options: TuiBootstrapOptions,
): Promise<TuiBootstrapResult> {
  const { startTuiGateway } = await import("@kilnai/runtime");
  const { flags, sessionManager, contextArtifactCache, systemPrompt } = options;

  writeTuiBootstrapStatus("Starting Kiln TUI runtime...");
  options.startupProfiler?.mark("gateway-start-requested");
  const gateway = await startTuiGateway({
    sessionManager,
    port: flags.port,
    systemPrompt,
    operatorTimeZone: options.operatorTimeZone,
    onClear: sessionManager.onClear,
    getProviderAvailability: () => getRuntimeProviderAvailability(options.registry),
    contextArtifactCache,
    artifactStore: options.builtinToolOptions?.artifactResources?.store,
    voiceConfig: options.operatorVoice?.voiceConfig,
    sttAdapter: options.operatorVoice?.sttAdapter,
    ttsAdapter: options.operatorVoice?.ttsAdapter,
    executionMode: flags.plan ? "plan" : "execute",
    builtinToolOptions: options.builtinToolOptions,
    managedInvocation: options.managedInvocation,
    budgetAdmission: options.budgetAdmission,
    resumeSessionHydrator: options.resumeSessionHydrator,
    initialProviderDiscovery: options.initialProviderDiscovery,
    onProviderDiscoveryResolved: options.onProviderDiscoveryResolved,
  });
  options.startupProfiler?.mark("gateway-started", { port: gateway.port });

  writeTuiBootstrapStatus("Connecting to local gateway...");
  await waitForGateway(`http://localhost:${gateway.port}/health`);
  options.startupProfiler?.mark("gateway-health-ready", { port: gateway.port });
  writeTuiBootstrapStatus("Loading provider and model discovery...");

  const providerModelsRef: { current: Record<string, string[]> } = {
    current: projectEligibleTuiProviderModels(
      gateway.providerModelDiscovery,
      gateway.providerDiscovery ?? [],
      Object.keys(gateway.models),
    ),
  };
  const providerDiscoveryRef: { current: readonly GuiProviderDiscoveryResult[] } = {
    current: gateway.providerDiscovery ?? [],
  };
  const providerModelDiscoveryRef: { current: GuiProviderModelDiscoveryProjection | null } = {
    current: gateway.providerModelDiscovery,
  };

  let session: GatewaySession | null = null;
  const createSession = async (): Promise<SessionLike> => {
    if (!session) {
      session = new GatewaySession(
        gateway.url,
        (
          models: Record<string, string[]>,
          discovery?: readonly GuiProviderDiscoveryResult[],
          providerModelDiscovery?: GuiProviderModelDiscoveryProjection,
        ) => {
          providerModelsRef.current = models;
          providerDiscoveryRef.current = discovery ?? [];
          providerModelDiscoveryRef.current = providerModelDiscovery ?? null;
          providerModelsRef.current = projectEligibleTuiProviderModels(
            providerModelDiscoveryRef.current,
            providerDiscoveryRef.current,
            Object.keys(models),
          );
        },
      );
    }
    return session;
  };

  return {
    createSession,
    providerModelsRef,
    providerDiscoveryRef,
    providerModelDiscoveryRef,
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
  | { type: "text_delta"; content: string; isThinking?: boolean; sessionId?: string; turnId?: string }
  | { type: "file_changed"; path: string; changeType: "created" | "modified" | "deleted"; linesAdded?: number; linesRemoved?: number; sessionId?: string; turnId?: string }
  | { type: "cost_update"; usd: number; sessionId?: string; turnId?: string }
  | { type: "completed"; totalUsd: number; outcome: SessionTurnOutcome; routedProvider?: string; routedModel?: string }
  | { type: "error"; message: string }
  | { type: "activity"; activity: string; toolName?: string; output?: string; input?: unknown; sessionId?: string; turnId?: string } {
  const candidate = event as { type?: string; [key: string]: unknown } | undefined;
  const scoped = {
    ...(typeof candidate?.sessionId === "string" ? { sessionId: candidate.sessionId } : {}),
    ...(typeof candidate?.turnId === "string" ? { turnId: candidate.turnId } : {}),
  };
  switch (candidate?.type) {
    case "text_delta":
      return {
        type: "text_delta",
        content: String(candidate.content ?? ""),
        ...scoped,
      };
    case "file_changed":
      return {
        type: "file_changed",
        path: String(candidate.path ?? ""),
        changeType: (candidate.changeType as "created" | "modified" | "deleted") ?? "modified",
        linesAdded: typeof candidate.linesAdded === "number" ? candidate.linesAdded : undefined,
        linesRemoved: typeof candidate.linesRemoved === "number" ? candidate.linesRemoved : undefined,
        ...scoped,
      };
    case "cost_update":
      return {
        type: "cost_update",
        usd: typeof candidate.usd === "number" ? candidate.usd : 0,
        ...scoped,
      };
    case "completed": {
      const outcome = readSessionTurnOutcome(candidate.outcome);
      if (!outcome) {
        return {
          type: "error",
          message: "Session completed without a canonical terminal outcome.",
        };
      }
      return {
        type: "completed",
        totalUsd: typeof candidate.totalUsd === "number" ? candidate.totalUsd : 0,
        outcome,
        routedProvider: route?.provider,
        routedModel: route?.model || undefined,
      };
    }
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
        ...scoped,
      };
    case "tool_result": {
      const toolName = typeof candidate.toolName === "string" ? candidate.toolName : undefined;
      const presentation = toolName && typeof candidate.output === "string"
        ? presentOperatorEventPayload("tool_call_completed", buildOperatorToolResultPayload({
          toolCallId: typeof candidate.toolCallId === "string" ? candidate.toolCallId : "tool-result",
          toolName,
          output: candidate.output,
          ...(typeof candidate.outputSummary === "string" ? { outputSummary: candidate.outputSummary } : {}),
          ...(typeof candidate.isError === "boolean" ? { isError: candidate.isError } : {}),
        }))
        : undefined;
      const output = presentation?.toolPresentation?.presentationIntent
        ? formatPresentationIntentAsText(presentation.toolPresentation.presentationIntent)
        : typeof candidate.output === "string"
          ? parseOperatorToolResultEnvelope(candidate.output)?.output ?? candidate.output
          : undefined;
      return {
        type: "activity",
        activity: "tool_result",
        toolName,
        output,
        ...scoped,
      };
    }
    default:
      return {
        type: "activity",
        activity: "unknown_event",
      };
  }
}

function readSessionTurnOutcome(value: unknown): SessionTurnOutcome | undefined {
  return value === "completed" || value === "failed" || value === "cancelled" || value === "paused"
    ? value
    : undefined;
}

async function bootstrapDirectSession(
  options: TuiBootstrapOptions,
): Promise<TuiBootstrapResult> {
  const { sessionManager, systemPrompt } = options;
  const sessionCwd = options.cwd;
  let session: TuiControlSession | null = null;
  const providerModelsRef: { current: Record<string, string[]> } = { current: {} };
  const providerDiscoveryRef: { current: readonly GuiProviderDiscoveryResult[] } = { current: [] };
  const providerModelDiscoveryRef: { current: GuiProviderModelDiscoveryProjection | null } = { current: null };
  const providerCatalog = createProviderCatalogService<readonly GuiProviderDiscoveryResult[]>(
    () => resolveGuiOperatorDiscoveryResults(getRuntimeProviderAvailability(options.registry)),
    [],
    {
      initialDiscovery: options.initialProviderDiscovery
        ? markGuiProviderDiscoveryStale(options.initialProviderDiscovery)
        : undefined,
      onDiscoveryResolved: options.onProviderDiscoveryResolved,
    },
  );
  const applyProviderDiscovery = (discovery: readonly GuiProviderDiscoveryResult[]): Record<string, string[]> => {
    providerDiscoveryRef.current = discovery;
    providerModelDiscoveryRef.current = projectGuiProviderModelDiscovery(providerDiscoveryRef.current);
    providerModelsRef.current = projectEligibleTuiProviderModels(
      providerModelDiscoveryRef.current,
      providerDiscoveryRef.current,
    );
    return providerModelsRef.current;
  };
  applyProviderDiscovery(providerCatalog.snapshot().discovery);
  const refreshProviderModels = async (
    refreshOptions?: { readonly force?: boolean },
  ): Promise<Record<string, string[]>> => applyProviderDiscovery(
    (await providerCatalog.refresh(refreshOptions)).discovery,
  );
  const ensureProviderModels = async (): Promise<Record<string, string[]>> => applyProviderDiscovery(
    (await providerCatalog.ensureReady()).discovery,
  );
  providerCatalog.subscribe((snapshot) => {
    applyProviderDiscovery(snapshot.discovery);
  });
  writeTuiBootstrapStatus("Loading provider and model discovery...");
  options.startupProfiler?.mark("direct-provider-catalog-refresh-started");
  providerCatalog.startBackgroundRefresh({ force: true });
  const directRuntimeSessionId = `kiln-tui:direct:${randomUUID()}`;

  const createSession = async (): Promise<SessionLike> => {
    if (session) {
      return session;
    }

    const inner = sessionManager.factory(
      systemPrompt,
      sessionCwd,
      { kilnSessionId: directRuntimeSessionId },
    );

    session = {
      async *run(opts: { prompt: string; cwd?: string; kilnSessionId?: string }) {
        const providerForTurn = sessionManager.getProvider();
        let modelForTurn = sessionManager.getModel();
        const providerModels = await ensureProviderModels();
        const advertisedModels = providerModels[providerForTurn];
        if (!advertisedModels || (advertisedModels.length === 0 && !isGuiProviderModeless(providerForTurn))) {
          yield {
            type: "error",
            message: `Provider '${providerForTurn}' is unavailable`,
          };
          return;
        }
        if (advertisedModels.length === 0 && isGuiProviderModeless(providerForTurn)) {
          if (modelForTurn.trim().length > 0) {
            sessionManager.setModel("");
          }
          modelForTurn = "";
        }
        if (advertisedModels?.length && modelForTurn.trim().length === 0) {
          yield {
            type: "error",
            message: providerRequiresSelectedModelMessage(providerForTurn),
          };
          return;
        }
        if (advertisedModels?.length && !advertisedModels.includes(modelForTurn)) {
          yield {
            type: "error",
            message: `Provider '${providerForTurn}' does not advertise model '${modelForTurn}'`,
          };
          return;
        }
        for await (const event of inner.run({
          ...opts,
          kilnSessionId: opts.kilnSessionId ?? directRuntimeSessionId,
        })) {
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
      async refreshProviders() {
        await refreshProviderModels({ force: true });
      },
      async switchProvider(providerName: string, modelName?: string) {
        const provider = providerName.trim() as ProviderId;
        const requestedModel = typeof modelName === "string" ? modelName.trim() : "";
        await ensureProviderModels();
        const resolution = resolveGuiProviderSwitch({
          provider,
          model: requestedModel,
          discovery: providerDiscoveryRef.current,
          ...(providerModelDiscoveryRef.current
            ? { providerModelDiscovery: providerModelDiscoveryRef.current }
            : {}),
        });
        if (!resolution.ok) {
          throw new Error(resolution.error);
        }
        sessionManager.setProvider(resolution.provider);
        sessionManager.setModel(resolution.modelForSessionManager);
        return resolution.provider;
      },
    };
    return session;
  };

  return {
    createSession,
    providerModelsRef,
    providerDiscoveryRef,
    providerModelDiscoveryRef,
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
  const startupProfiler = createStartupProfiler("tui");
  startupProfiler.mark("command-entered");
  const cwd = resolveProjectRoot({ explicitPath: flags.cwd }).rootPath;
  const globalConfig = readGlobalConfig();
  const projectConfig = readKilnYaml(join(cwd, ".kiln"));
  const resolvedKilnConfig = await loadKilnConfig(cwd);
  const mcpResolution = loadResolvedKilnMcpConfiguration(cwd);
  const admittedMcpServers = mcpResolution.diagnostics.length === 0
    ? Object.values(mcpResolution.servers).filter((server) => server.enabled && server.admission?.state === "admitted")
    : [];
  const { registry } = createDefaultRegistry({ canonicalMcpServers: admittedMcpServers });
  const providerDisplayInfo = getProviderDisplayInfo(registry);
  const providerIds = providerDisplayInfo.map((entry) => entry.id);
  startupProfiler.mark("config-loaded", { projectPath: cwd });
  const runtimeAppConfig = withContextCandidates(
    withWorkGovernanceContext(withGlobalIdentityContext(appConfig, globalConfig), resolvedKilnConfig?.workGovernance),
    resolveInstructionProfileContextCandidates({
      projectPath: cwd,
      globalConfig,
      projectConfig,
    }),
  );
  const startupTransport = resolveTuiStartupTransport(flags);
  const provider = parseProvider(resolveEffectiveProvider(flags.provider, resolveGlobalDefaultProvider(globalConfig)), providerIds);
  const startupModel = resolveGlobalDefaultModel(globalConfig);
  const workItemStore = new WorkItemStore();
  const goalRunStore = new GoalRunStore();
  const managedInvocationProofs = createManagedInvocationExecutionProofResolverRef();
  const sessionStore = new SessionStore(cwd);
  const transcriptStore = new TranscriptStore(cwd);
  await recoverStaleOpenTranscriptSessions({
    transcriptStore,
    sessionStore,
    projectPath: cwd,
  });
  const runtimeBudgetAdmission = createRuntimeBudgetAdmissionFromGlobalConfig(
    globalConfig,
    createCliTranscriptBudgetUsageReader(transcriptStore),
  );
  const startupProviderIds = providerIds;
  const contextArtifactCache = await getProjectContextArtifactCache(cwd);
  startupProfiler.mark("context-cache-ready");
  const configuredBuiltinToolOptions = await loadConfiguredBuiltinToolSurfaceOptions(runtimeAppConfig, cwd, {
      memoryAuthority: {
        modelFacingSession: true,
        permissionAgent: "tui",
        caller: { kind: "operator_surface", id: "tui" },
      },
    });
  startupProfiler.mark("builtin-tool-options-loaded");
  let builtinToolOptions = createSessionBuiltinToolOptions(withProgressiveRuntimeToolProjection({
    ...configuredBuiltinToolOptions,
    workItemStore,
    goalRunStore,
    additionalTools: [
      ...(configuredBuiltinToolOptions.additionalTools ?? []),
      ...createKilnConfigTools(cwd),
      ...createWorkGovernanceTools(resolvedKilnConfig?.workGovernance, {
        workItemStore,
        goalRunStore,
        managedInvocationProofResolver: managedInvocationProofs.resolve,
      }),
    ],
  }, "execute"));
  startupProfiler.mark("builtin-tool-options-created");
  let managedRouteGlobalConfig = globalConfig;
  let managedRouteEngineAvailability = resolveEngineAvailabilityMap(managedRouteGlobalConfig);
  const stagedManagedInvocation = appConfig.managedInvocation
    ? undefined
    : await createStagedManagedInvocationRouteCatalog(globalConfig, {
      cwd,
      registry,
      surface: "tui",
      maxParallelChildren: resolvedKilnConfig?.parallelWorkers ?? 1,
      isProviderAvailable: (providerId) => managedRouteEngineAvailability.get(providerId),
      directAdapterFactory: createManagedDirectProviderAdapterFactory({
        builtinToolOptions: () => builtinToolOptions,
        canonicalMcpServers: admittedMcpServers,
      }),
      builtinToolOptions: () => builtinToolOptions,
      artifactStore: builtinToolOptions.artifactResources?.store,
    }, {
      reloadConfig: () => {
        managedRouteGlobalConfig = readGlobalConfig() ?? globalConfig;
        managedRouteEngineAvailability = resolveEngineAvailabilityMap(managedRouteGlobalConfig);
        return managedRouteGlobalConfig;
      },
      onRefreshError: (error) => {
        console.warn(`Managed invocation provider discovery failed: ${error instanceof Error ? error.message : String(error)}`);
      },
    });
  startupProfiler.mark("managed-invocation-staged", {
    hasManagedInvocation: Boolean(appConfig.managedInvocation ?? stagedManagedInvocation?.managedInvocation),
  });
  const managedInvocation = appConfig.managedInvocation ?? stagedManagedInvocation?.managedInvocation;
  const managedInvocationWithService = managedInvocation
    ? withManagedInvocationService(managedInvocation)
    : undefined;
  managedInvocationProofs.bind(managedInvocationWithService);
  const managedInvocationAttachment = managedInvocationWithService
    ? createKilnRuntimeManagedInvocationAttachment("tui", managedInvocationWithService)
    : undefined;
  const operatorVoice = await resolveOperatorVoiceRuntime(globalConfig);
  for (const warning of operatorVoice.warnings) {
    console.warn(warning);
  }
  startupProfiler.mark("voice-runtime-ready");

  // Resolve domain display name from app config if available
  let domain = "kiln";
  let systemPrompt = "You are a helpful assistant.";
  try {
    const { SessionManager } = await import("../wrapper/session-manager.js");
    const wrapperConfig = { mode: "cli-wrapper" as const, permissionPolicy: { approval: "never" as const, sandbox: "workspace-write" as const } };
    const manager = new SessionManager(wrapperConfig, runtimeAppConfig, contextArtifactCache);
    const context = await manager.prepare("interactive", cwd, undefined, undefined, undefined);
    domain = context.domain.displayName;
    systemPrompt = context.systemPrompt;
  } catch {
    // Non-fatal — proceed without domain name
  }

  // Inject CLI session factory into the gateway (dependency inversion)
  const resumeSessionHydrator = createTranscriptRuntimeSessionHydrator({
    transcriptStore,
    workItemStore,
    goalRunStore,
  });
  const initialContinuationInfo: Record<string, ContinuationSidebarInfo> = await loadContinuationSidebarInfo(
    sessionStore,
    transcriptStore,
    startupProviderIds,
  );
  const sessionManager = await makeMultiProviderSessionFactory(
    provider,
    startupProviderIds,
    cwd,
    registry,
    sessionStore,
    transcriptStore,
    contextArtifactCache,
    builtinToolOptions,
    "tui",
    managedInvocationAttachment,
    runtimeBudgetAdmission,
  );
  startupProfiler.mark("session-manager-ready");
  if (startupModel) {
    sessionManager.setModel(startupModel);
  }
  const managedInvocationForGateway = sessionManager.managedInvocation ?? managedInvocationAttachment;

  const initialProviderDiscovery = readProviderDiscoveryCache(cwd);
  const bootstrap = await bootstrapTuiSession({
    flags,
    cwd,
    sessionManager,
    registry,
    contextArtifactCache,
    systemPrompt,
    operatorTimeZone: runtimeAppConfig.operatorTimeZone,
    builtinToolOptions,
    managedInvocation: managedInvocationForGateway,
    budgetAdmission: runtimeBudgetAdmission,
    resumeSessionHydrator,
    operatorVoice,
    initialProviderDiscovery,
    onProviderDiscoveryResolved: (discovery) => writeProviderDiscoveryCache(cwd, discovery),
    startupProfiler,
  });
  startupProfiler.mark("bootstrap-context-ready", { transport: startupTransport });
  stagedManagedInvocation?.startBackgroundRefresh();

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

  const resolvedTheme = themes[flags.theme ?? resolveGlobalUiTheme(globalConfig) ?? "kiln-dark"] ?? kilnDark;

  // Session list loader for sidebar browser
  async function loadSessionList() {
    try {
      const records = await sessionStore.list();
      return records.slice(0, 20);
    } catch {
      return [];
    }
  }

  // Session continuation handler - sets the selected provider's continuation target.
  const handleResumeSession = (session: { sessionId: string; provider: string }) => {
    sessionManager.setProvider(session.provider);
    sessionManager.setContinuationSession(session.sessionId, session.provider);
  };

  const startupProviderDisplayInfo = buildTuiStartupProviderDisplayInfo({
    providerDisplayInfo,
    runtimeModels: bootstrap.providerModelsRef.current,
    runtimeDiscovery: bootstrap.providerDiscoveryRef.current,
    includeModelessProviders: true,
    includePendingProviders: bootstrap.providerDiscoveryRef.current.length === 0
      || isOnlyStaleProviderDiscovery(bootstrap.providerDiscoveryRef.current),
  });
  if (bootstrap.providerDiscoveryRef.current.length > 0
    && !isOnlyStaleProviderDiscovery(bootstrap.providerDiscoveryRef.current)) {
    assertTuiProviderAvailableInStartupCatalog(provider, startupProviderDisplayInfo);
  }
  const startupProvider = startupProviderDisplayInfo.find((entry) => entry.id === provider);
  if (startupProvider?.models[0] && sessionManager.getModel().trim().length === 0) {
    sessionManager.setModel(startupProvider.models[0]);
  }

  await startTui(
    bootstrap.createSession,
    startupProviderDisplayInfo,
    provider,
    domain,
    resolvedTheme,
    startupTransport === "direct" ? initialContinuationInfo : {},
    () => loadContinuationSidebarInfo(sessionStore, transcriptStore, startupProviderIds),
    bootstrap.providerModelsRef,
    bootstrap.providerDiscoveryRef,
    startupTransport === "direct" ? loadSessionList : undefined,
    startupTransport === "direct" ? handleResumeSession : undefined,
    () => bootstrap.createSession().then((session) => (
      session as unknown as { refreshProviders?: () => Promise<void> | void }
    ).refreshProviders?.()),
    (themeName) => persistTuiThemePreference(themeName, globalConfig),
    async () => (await readConfigStatusSnapshot({ projectPath: cwd })).setup,
    () => startupProfiler.mark("tui-first-frame-rendered"),
    bootstrap.providerModelDiscoveryRef,
  );

  bootstrap.shutdown();
  for (const [ev, handler] of handlers) process.off(ev, handler);
}
