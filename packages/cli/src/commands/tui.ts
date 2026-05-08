import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { KilnAppConfig } from "../config.js";
import {
  loadResumeSidebarInfo,
  type ResumeSidebarInfo,
} from "../application/resume-sidebar-info.js";
import { inferResumeStrategyFeedback } from "../application/resume-strategy-feedback.js";
import { collectResumeSignals, decideResumeStrategy } from "../application/resume-strategy-policy.js";
import {
  deriveSessionMetadata,
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
import { readKilnYaml } from "../kiln-yaml.js";
import { loadKilnConfig } from "../config/config-merger.js";
import { resolveEffectiveProvider } from "../config/env-config.js";
import { createManagedDirectProviderAdapterFactory } from "../config/managed-agent-direct-adapters.js";
import { createKilnConfigTools } from "../application/config-tools.js";
import { createWorkGovernanceTools } from "../application/work-governance-tool.js";
import { discoverManagedAgentProviderModels } from "../config/managed-agent-provider-models.js";
import { resolveManagedInvocationToolOptions } from "../config/managed-agent-routes.js";
import { loadConfiguredWebToolSurfaceOptions } from "../config/web-tools-config.js";
import { resolveEngineAvailabilityMap } from "../engines/engine-registry.js";
import {
  createDefaultRegistry,
  getProviderDisplayInfo,
  getRuntimeProviderAvailability,
  type ProviderId,
} from "../wrapper/session-registry.js";
import { SessionStore, TranscriptStore } from "../wrapper/session-store.js";
import type { PersistedTranscriptEvent } from "../wrapper/session-store.js";
import type { ResumeFeedback, ResumeStrategy } from "../wrapper/index.js";
import { GatewaySession, waitForGateway, themes, kilnDark } from "@kilnai/tui";
import type { SessionLike } from "@kilnai/tui";
import {
  GUI_PROVIDER_DISPLAY_ORDER,
  formatPresentationIntentAsText,
  getGuiProviderMetadata,
  isGuiProviderModeless,
  presentOperatorEventPayload,
  type GuiProviderDiscoveryResult,
} from "@kilnai/gateway-contracts";
import {
  createSessionBuiltinToolOptions,
  extractText,
  type AgentMessage,
  type CanonicalSessionEventKind,
  type ContextArtifactCache,
  type DefaultBuiltinToolRegistryOptions,
  type SessionEventSource,
} from "@kilnai/core";
import { getProjectContextArtifactCache } from "@kilnai/runtime";
import {
  createProviderCatalogService,
  projectGuiOperatorModels,
  providerRequiresSelectedModelMessage,
  resolveGuiOperatorDiscoveryResults,
  resolveGuiProviderSwitch,
} from "@kilnai/runtime";
import type {
  CliSessionFactoryContext,
  CliSessionRunOptions,
  ManagedInvocationToolOptions,
  RuntimeSessionHydrator,
} from "@kilnai/runtime";
import { persistTuiThemePreference } from "../application/operator-theme-preferences.js";

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
  readonly registry: ReturnType<typeof createDefaultRegistry>["registry"];
  readonly contextArtifactCache: ContextArtifactCache;
  readonly systemPrompt: string;
  readonly builtinToolOptions?: DefaultBuiltinToolRegistryOptions;
  readonly managedInvocation?: ManagedInvocationToolOptions;
  readonly resumeSessionHydrator?: RuntimeSessionHydrator;
}

interface TuiBootstrapResult {
  readonly createSession: () => Promise<SessionLike>;
  readonly providerModelsRef: { current: Record<string, string[]> };
  readonly providerDiscoveryRef: { current: readonly GuiProviderDiscoveryResult[] };
  shutdown(): void;
}
type TuiControlSession = SessionLike & {
  clear?: () => Promise<void>;
  refreshProviders?: () => Promise<void>;
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

function mapTranscriptTypeToSource(type: string, surface: OperatorTranscriptSurface): SessionEventSource {
  const component = surface === "gui" ? "gui-command" : "tui-command";
  switch (type) {
    case "user":
      return { actor: "user", surface, component };
    case "text_delta":
      return { actor: "assistant", surface, component };
    case "tool_use":
    case "tool_result":
      return { actor: "tool", surface, component };
    case "error":
      return { actor: "runtime", surface, component };
    default:
      return { actor: "system", surface, component };
  }
}

function toPersistedTranscriptEvent(
  sessionId: string,
  sequence: number,
  type: string,
  payload: Record<string, unknown>,
  surface: OperatorTranscriptSurface,
  turnId?: string,
): PersistedTranscriptEvent {
  return {
    eventId: randomUUID(),
    kilnSessionId: sessionId,
    sequence,
    timestamp: new Date().toISOString(),
    kind: mapTranscriptTypeToKind(type),
    source: mapTranscriptTypeToSource(type, surface),
    ...(turnId ? { turnId } : {}),
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

function parseToolResultEnvelope(value: string | undefined): {
  readonly output: string;
  readonly isError?: boolean;
  readonly metadata?: Record<string, unknown>;
} {
  if (!value) return { output: "" };
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { output: value };
    }
    const record = parsed as Record<string, unknown>;
    const output = typeof record.output === "string" ? record.output : value;
    const metadata = record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? record.metadata as Record<string, unknown>
      : undefined;
    return {
      output,
      ...(typeof record.isError === "boolean" ? { isError: record.isError } : {}),
      ...(metadata ? { metadata } : {}),
    };
  } catch {
    return { output: value };
  }
}

function buildToolResultPayload(input: {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output: string;
  readonly outputSummary?: string;
  readonly isError?: boolean;
}): Record<string, unknown> {
  const full = parseToolResultEnvelope(input.output);
  const summary = parseToolResultEnvelope(input.outputSummary);
  const outputSummary = summary.output || full.output.slice(0, 200);
  const isError = full.isError ?? input.isError ?? false;
  return {
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    output: full.output,
    outputSummary,
    ...(full.metadata ? { metadata: full.metadata } : {}),
    status: {
      state: isError ? "failed" : "succeeded",
    },
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
  initialProvider: ProviderId | null,
  providerIds: readonly ProviderId[],
  cwd: string,
  registry: ReturnType<typeof createDefaultRegistry>["registry"],
  sessionStore: SessionStore,
  transcriptStore: TranscriptStore,
  contextArtifactCache: ContextArtifactCache,
  builtinToolOptions?: DefaultBuiltinToolRegistryOptions,
  transcriptSurface: OperatorTranscriptSurface = "tui",
  managedInvocation?: ManagedInvocationToolOptions,
): Promise<MultiProviderSessionManager> {
  const providers = providerIds;
  
  // Per-provider session state
  const providerState = new Map<ProviderId, ProviderSessionState>(
    providers.map((provider) => [provider, {}]),
  );
  const providerModelState = new Map<ProviderId, string>(
    providers.map((provider) => [provider, ""]),
  );
  const sessionBuiltinToolOptions = createSessionBuiltinToolOptions(builtinToolOptions);
  
  let currentProvider: ProviderId | null = initialProvider;

  const defaultResumeRecord = await sessionStore.getResumeTarget();
  for (const p of providers) {
    const state = providerState.get(p);
    if (!state) continue;
    const resumeRecord = await sessionStore.getResumeTarget(p) ?? defaultResumeRecord;
    if (!resumeRecord) continue;
    state.resumeSessionId = resumeRecord.sessionId;
    state.providerSessionId = resumeRecord.providerThread?.provider === p
      ? resumeRecord.providerThread.nativeSessionId
      : (await sessionStore.findProviderThread?.(resumeRecord.sessionId, p))?.nativeSessionId;
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
        if (!providerForTurn) {
          throw new Error("No provider selected for this turn.");
        }
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
          reasoningEffort: options.reasoningEffort,
          ...(context?.operatorSurface ? { operatorSurface: context.operatorSurface } : {}),
          builtinToolOptions: sessionBuiltinToolOptions,
          ...(managedInvocation ? { managedInvocation } : {}),
        });
        activeSession = resumedSession;
        const capturedId = options.kilnSessionId ?? context?.kilnSessionId ?? resumedFrom ?? resumedSession.sessionId;
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
        let turnIsError = false;
        let assistantContent = "";
        let assistantDeltaIndex = 0;
        const pendingToolCallIds = new Map<string, string[]>();
        let syntheticToolOrdinal = 0;
        const priorTranscript = await transcriptStore.readTranscript(capturedId);
        let transcriptSeq = priorTranscript.length;
        const turnOrdinal = priorTranscript.filter((event) => event.kind === "turn_started").length + 1;
        const turnId = `${capturedId}:turn:${turnOrdinal}`;
        const assistantMessageId = `${turnId}:assistant`;
        const source = (actor: SessionEventSource["actor"]): SessionEventSource => ({
          actor,
          surface: transcriptSurface,
          component: transcriptSurface === "gui" ? "gui-command" : "tui-command",
        });
        await transcriptStore.append(
          capturedId,
          persistedEvent(capturedId, ++transcriptSeq, "turn_started", source("runtime"), {
            turnId,
            turnOrdinal,
            trigger: "user_message",
          }, turnId),
        );
        const userText = latestUserText(options.messages) ?? options.prompt.trim();
        if (userText) {
          await transcriptStore.append(
            capturedId,
            toPersistedTranscriptEvent(capturedId, ++transcriptSeq, "user", {
              messageId: `${turnId}:user`,
              content: userText,
            }, transcriptSurface, turnId),
          );
        }
        try {
          for await (const event of resumedSession.run(options)) {
            if (!event || typeof event !== "object" || !("type" in event)) {
              yield event;
              continue;
            }
            if (event.type === "text_delta" && !event.isThinking) {
              assistantContent += event.content;
              await transcriptStore.append(
                capturedId,
                toPersistedTranscriptEvent(capturedId, ++transcriptSeq, "text_delta", {
                  messageId: assistantMessageId,
                  delta: event.content,
                  deltaIndex: assistantDeltaIndex++,
                }, transcriptSurface, turnId),
              );
            } else if (event.type === "tool_use") {
              const toolCallId = event.toolCallId ?? `${turnId}:tool:${++syntheticToolOrdinal}`;
              const pending = pendingToolCallIds.get(event.toolName) ?? [];
              pending.push(toolCallId);
              pendingToolCallIds.set(event.toolName, pending);
              await transcriptStore.append(
                capturedId,
                toPersistedTranscriptEvent(capturedId, ++transcriptSeq, "tool_use", {
                  toolCallId,
                  toolName: event.toolName,
                  input: event.input,
                }, transcriptSurface, turnId),
              );
            } else if (event.type === "tool_result") {
              const pending = pendingToolCallIds.get(event.toolName);
              let toolCallId: string | undefined;
              if (event.toolCallId) {
                toolCallId = event.toolCallId;
                const pendingIndex = pending?.indexOf(event.toolCallId) ?? -1;
                if (pending && pendingIndex >= 0) {
                  pending.splice(pendingIndex, 1);
                }
              } else {
                toolCallId = pending?.shift();
              }
              if (pending && pending.length === 0) {
                pendingToolCallIds.delete(event.toolName);
              }
              if (!toolCallId) {
                toolCallId = `${turnId}:tool:${++syntheticToolOrdinal}`;
                await transcriptStore.append(
                  capturedId,
                  toPersistedTranscriptEvent(capturedId, ++transcriptSeq, "tool_use", {
                    toolCallId,
                    toolName: event.toolName,
                  }, transcriptSurface, turnId),
                );
              }
              await transcriptStore.append(
                capturedId,
                toPersistedTranscriptEvent(capturedId, ++transcriptSeq, "tool_result", buildToolResultPayload({
                  toolCallId,
                  toolName: event.toolName,
                  output: event.output,
                  ...(event.outputSummary !== undefined ? { outputSummary: event.outputSummary } : {}),
                  ...(event.isError !== undefined ? { isError: event.isError } : {}),
                }), transcriptSurface, turnId),
              );
            } else if (event.type === "error") {
              turnIsError = true;
              await transcriptStore.append(
                capturedId,
                toPersistedTranscriptEvent(capturedId, ++transcriptSeq, "error", {
                  message: event.message,
                  code: event.code,
                  retriable: event.isRetryable,
                }, transcriptSurface, turnId),
              );
            }
            if (event.type === "completed") {
              turnCostUsd = event.totalUsd;
              turnIsError = event.isError;
            }
            yield event;
          }
        } finally {
          if (assistantContent.trim().length > 0) {
            await transcriptStore.append(
              capturedId,
              persistedEvent(capturedId, ++transcriptSeq, "assistant_message", source("assistant"), {
                messageId: assistantMessageId,
                content: assistantContent,
                provider: {
                  provider: providerForTurn,
                  ...(modelForTurn ? { model: modelForTurn } : { model: providerForTurn }),
                },
              }, turnId),
            );
          }
          await transcriptStore.append(
            capturedId,
            persistedEvent(capturedId, ++transcriptSeq, "turn_completed", source("runtime"), {
              turnId,
              outcome: turnIsError ? "failed" : "completed",
              ...(assistantContent.trim().length > 0 ? { outputMessageId: assistantMessageId } : {}),
            }, turnId),
          );
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
        state.resumeSessionId = undefined;
        state.providerSessionId = undefined;
      }
      await sessionStore.clearResumeTarget(provider);
    },
    setResumeSession: (sessionId: string, provider?: string) => {
      const targetProvider = provider && providers.includes(provider as ProviderId)
        ? provider as ProviderId
        : currentProvider;
      if (!targetProvider) {
        return;
      }
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

  writeTuiBootstrapStatus("Starting Kiln TUI runtime...");
  const gateway = await startTuiGateway({
    sessionManager,
    port: flags.port,
    systemPrompt,
    onClear: sessionManager.onClear,
    getProviderAvailability: () => getRuntimeProviderAvailability(options.registry),
    contextArtifactCache,
    executionMode: flags.plan ? "plan" : "execute",
    builtinToolOptions: options.builtinToolOptions,
    managedInvocation: options.managedInvocation,
    resumeSessionHydrator: options.resumeSessionHydrator,
  });

  writeTuiBootstrapStatus("Connecting to local gateway...");
  await waitForGateway(`http://localhost:${gateway.port}/health`);
  writeTuiBootstrapStatus("Loading provider and model discovery...");

  const providerModelsRef: { current: Record<string, string[]> } = {
    current: gateway.models,
  };
  const providerDiscoveryRef: { current: readonly GuiProviderDiscoveryResult[] } = {
    current: gateway.providerDiscovery ?? [],
  };

  let session: GatewaySession | null = null;
  const createSession = async (): Promise<SessionLike> => {
    if (!session) {
      session = new GatewaySession(
        gateway.url,
        (models: Record<string, string[]>, discovery?: readonly GuiProviderDiscoveryResult[]) => {
          providerModelsRef.current = models;
          providerDiscoveryRef.current = discovery ?? [];
        },
      );
    }
    return session;
  };

  return {
    createSession,
    providerModelsRef,
    providerDiscoveryRef,
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
  | { type: "completed"; totalUsd: number; routedProvider?: string; routedModel?: string }
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
        ...scoped,
      };
    case "tool_result": {
      const toolName = typeof candidate.toolName === "string" ? candidate.toolName : undefined;
      const presentation = toolName && typeof candidate.output === "string"
        ? presentOperatorEventPayload("tool_call_completed", buildToolResultPayload({
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
          ? parseToolResultEnvelope(candidate.output).output
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

async function bootstrapDirectSession(
  options: TuiBootstrapOptions,
): Promise<TuiBootstrapResult> {
  const { flags, sessionManager, systemPrompt } = options;
  const sessionCwd = flags.cwd ?? process.cwd();
  let session: TuiControlSession | null = null;
  const providerModelsRef: { current: Record<string, string[]> } = { current: {} };
  const providerDiscoveryRef: { current: readonly GuiProviderDiscoveryResult[] } = { current: [] };
  const providerCatalog = createProviderCatalogService<readonly GuiProviderDiscoveryResult[]>(
    () => resolveGuiOperatorDiscoveryResults(getRuntimeProviderAvailability(options.registry)),
    [],
  );
  const applyProviderDiscovery = (discovery: readonly GuiProviderDiscoveryResult[]): Record<string, string[]> => {
    providerDiscoveryRef.current = discovery;
    providerModelsRef.current = projectGuiOperatorModels(providerDiscoveryRef.current);
    return providerModelsRef.current;
  };
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
  providerCatalog.startBackgroundRefresh({ force: true });

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
      async refreshProviders() {
        await refreshProviderModels({ force: true });
      },
      async switchProvider(providerName: string, modelName?: string) {
        const provider = providerName.trim() as ProviderId;
        const requestedModel = typeof modelName === "string" ? modelName.trim() : "";
        const resolution = resolveGuiProviderSwitch({
          provider,
          model: requestedModel,
          models: await ensureProviderModels(),
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
  const projectConfig = readKilnYaml(join(cwd, ".kiln"));
  const resolvedKilnConfig = await loadKilnConfig(cwd);
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
  const startupProviderIds = providerIds;
  const contextArtifactCache = await getProjectContextArtifactCache(cwd);
  const configuredBuiltinToolOptions = await loadConfiguredWebToolSurfaceOptions(runtimeAppConfig, cwd, {
      memoryAuthority: {
        modelFacingSession: true,
        permissionAgent: "tui",
        caller: { kind: "operator_surface", id: "tui" },
      },
    });
  const builtinToolOptions = createSessionBuiltinToolOptions({
    ...configuredBuiltinToolOptions,
    additionalTools: [
      ...(configuredBuiltinToolOptions.additionalTools ?? []),
      ...createKilnConfigTools(cwd),
      ...createWorkGovernanceTools(resolvedKilnConfig?.workGovernance),
    ],
  });
  const engineAvailability = resolveEngineAvailabilityMap(globalConfig);
  const managedAgentProviderModels = await discoverManagedAgentProviderModels();
  const managedInvocationResolution = await resolveManagedInvocationToolOptions(globalConfig, {
    cwd,
    registry,
    surface: "tui",
    isProviderAvailable: (providerId) => engineAvailability.get(providerId),
    providerModels: managedAgentProviderModels,
    directAdapterFactory: createManagedDirectProviderAdapterFactory({ builtinToolOptions }),
    artifactStore: builtinToolOptions.artifactResources?.store,
  });
  const managedInvocation = appConfig.managedInvocation ?? managedInvocationResolution.managedInvocation;

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
  const sessionStore = new SessionStore(cwd);
  const transcriptStore = new TranscriptStore(cwd);
  const resumeSessionHydrator = createTranscriptRuntimeSessionHydrator({ transcriptStore });
  const initialResumeInfo: Record<string, ResumeSidebarInfo> = await loadResumeSidebarInfo(
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
    managedInvocation,
  );
  if (startupModel) {
    sessionManager.setModel(startupModel);
  }

  const bootstrap = await bootstrapTuiSession({
    flags,
    sessionManager,
    registry,
    contextArtifactCache,
    systemPrompt,
    builtinToolOptions,
    managedInvocation,
    resumeSessionHydrator,
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

  // Session resume handler - sets resume session ID for the selected provider
  const handleResumeSession = (session: { sessionId: string; provider: string }) => {
    sessionManager.setProvider(session.provider);
    sessionManager.setResumeSession(session.sessionId, session.provider);
  };

  const startupProviderDisplayInfo = buildTuiStartupProviderDisplayInfo({
    providerDisplayInfo,
    runtimeModels: bootstrap.providerModelsRef.current,
    runtimeDiscovery: bootstrap.providerDiscoveryRef.current,
    includeModelessProviders: true,
    includePendingProviders: bootstrap.providerDiscoveryRef.current.length === 0,
  });
  if (bootstrap.providerDiscoveryRef.current.length > 0) {
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
    startupTransport === "direct" ? initialResumeInfo : {},
    () => loadResumeSidebarInfo(sessionStore, transcriptStore, startupProviderIds),
    bootstrap.providerModelsRef,
    bootstrap.providerDiscoveryRef,
    startupTransport === "direct" ? loadSessionList : undefined,
    startupTransport === "direct" ? handleResumeSession : undefined,
    () => bootstrap.createSession().then((session) => (
      session as unknown as { refreshProviders?: () => Promise<void> | void }
    ).refreshProviders?.()),
    (themeName) => persistTuiThemePreference(themeName, globalConfig),
    async () => (await readConfigStatusSnapshot({ projectPath: cwd })).setup,
  );

  bootstrap.shutdown();
  for (const [ev, handler] of handlers) process.off(ev, handler);
}
