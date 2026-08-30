import type {
  ActionEffectEnvelope,
  AuthorityDescriptor,
  Capability,
  ErrorEvent,
  ManagedAgentAdapterWriteAuthorityDescriptor,
  ManagedAgentInvocationRecord,
  ManagedAgentInvocationRequest,
  ManagedAgentReplayResource,
  ManagedAgentUsageReport,
  ManagedAgentWriteEvidence,
  ManagedEconomicExecutionIdentity,
  ManagedEconomicExecutionReport,
  ModelDeliberationCapabilities,
  ProviderAdapter,
  ProviderTransportEvent,
  SandboxConfig,
  StructuredExecutionResult,
  ToolAuthorizedEvent,
  ToolCacheHitEvent,
  ToolCalledEvent,
  ToolDefinition,
  ToolResultEvent,
} from "@kilnai/core";
import type { TurnTerminalDisposition } from "@kilnai/core/agents";
import {
  AllCredentialsExhaustedError,
  defineManagedAgentAdapterDescriptor,
  defineManagedAgentAdapterWriteAuthorityDescriptor,
  defineManagedAgentInvocationRecord,
  defineStructuredExecutionResult,
  digestManagedEconomicValue,
  EventBus,
  extractText,
  isManagedAgentProviderQuotaFailure,
  knownModelCommunicationCapabilities,
  SandboxPolicy,
  STRUCTURED_EXECUTION_RESULT_JSON_SCHEMA,
  textParts,
} from "@kilnai/core";
import { nodePhysicalPathResolver } from "../../tools/node-physical-path-resolver.js";
import {
  type RuntimeModelRoundActionClaimStore,
  type RuntimeModelRoundDispatchContext,
  readRuntimeModelRoundAdmission,
  runtimeModelRoundEffectIdentity,
} from "../../execution-kernel/runtime-model-round-action-claim.js";
import type {
  RuntimeToolActionClaimStore,
  RuntimeToolActionClaimsContext,
} from "../../execution-kernel/runtime-tool-action-claim.js";
import type { EffectiveAuthorityAdmissionBundle } from "../../session/effective-authority-admission-bundle.js";
import { RuntimeSession } from "../../session/runtime-session.js";
import { RuntimeSessionOrchestrator } from "../../session/runtime-session-orchestrator.js";
import type {
  OrchestrateResult,
  OrchestratorDeps,
  PerCallToolConfig,
  RuntimeBuiltinToolExecutionContext,
  RuntimeBuiltinToolExecutor,
  RuntimeExecutionEnvelope,
  ToolExecutionSummary,
} from "../../session/runtime-session-orchestrator.types.js";
import { deriveRuntimeConvergencePolicyInput } from "../../session/runtime-execution-envelope.js";
import { admitManagedChildAuthority } from "./child-authority-admission.js";
import { ManagedEconomicLifecycleTimeoutError } from "./economic-dispatch-coordinator.js";
import { appendManagedResultHandoffContract } from "./handoff-prompt.js";
import type {
  ManagedAgentRuntimeAdapter,
  ManagedAgentRuntimeInvocationInput,
  ManagedAgentRuntimeInvocationProgressEvent,
} from "./index.js";
import {
  collectManagedAgentLiveWriteEvidence,
  normalizeManagedAgentLiveWriteChanges,
} from "./live-write-event-bridge.js";
import {
  buildManagedInvocationResourceContext,
  createManagedInvocationRuntimeResourceReader,
} from "./resource-context.js";

export interface ManagedDirectProviderRuntimeAdapterConfig {
  readonly providerId: string;
  readonly model?: string;
  readonly provider: ProviderAdapter;
  readonly tools: readonly ToolDefinition[];
  readonly builtinTools: ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
  readonly builtinToolsProvider?: () => ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
  readonly capabilityMap?: ReadonlyMap<string, Capability>;
  readonly toolAuthority?: ReadonlyMap<string, AuthorityDescriptor>;
  readonly writeAuthority?: ManagedAgentAdapterWriteAuthorityDescriptor;
  readonly executionEnvelope?: RuntimeExecutionEnvelope;
  readonly economicIdentity?: ManagedEconomicExecutionIdentity;
  readonly deliberationCapabilities?: ModelDeliberationCapabilities;
  /** Workload-local durable owner for consequential child tool/MCP effects. */
  readonly runtimeToolActionClaims: RuntimeToolActionClaimStore;
  /** Full persisted parent/child admission readback supplied by the workload owner. */
  readonly readAuthorityAdmission: (input: {
    readonly admissionId: string;
    readonly sessionId: string;
    readonly turnId: string;
  }) => EffectiveAuthorityAdmissionBundle | undefined | Promise<EffectiveAuthorityAdmissionBundle | undefined>;
  /** Workload-local durable owner for every direct-provider model round. */
  readonly runtimeModelRoundActionClaims: RuntimeModelRoundActionClaimStore;
  /** Stable identity for the prepared managed direct adapter binding. */
  readonly modelRoundAdapterIdentity?: string;
  readonly toolActionAdapterIdentity?: string;
  readonly now?: () => Date;
}

const TIMEOUT = { type: "managed-direct-runtime-timeout" } as const;
const MANAGED_DIRECT_PROVIDER_TOOL_ROUND_LIMIT = 32;
const MANAGED_DIRECT_PROVIDER_CONVERGENCE_POLICY_INPUT = deriveRuntimeConvergencePolicyInput({
  policyId: "kiln.managed-direct.default",
  toolRounds: MANAGED_DIRECT_PROVIDER_TOOL_ROUND_LIMIT,
});
const MANAGED_DIRECT_PROVIDER_EXECUTION_ENVELOPE: RuntimeExecutionEnvelope = {
  convergence: MANAGED_DIRECT_PROVIDER_CONVERGENCE_POLICY_INPUT,
};
const RESULT_SUMMARY_LIMIT = 2000;
const CHILD_EXECUTION_RESOURCE_LIMIT = 12000;
const TOOL_OUTPUT_LIMIT = 1200;
const ECONOMIC_EXECUTION_EVIDENCE_VALIDITY_MS = 5 * 60 * 1000;
const MAX_PROVIDER_TRANSPORT_PROGRESS_EVENTS_PER_CHILD = 128;
const RESULT_RESOURCE_NOTICE = "Full child result is available through the managed invocation result resource.";
const NO_DIRECT_HANDOFF_SUMMARY = "Direct provider managed invocation finished without final handoff text.";
const MANAGED_AGENT_SUBMIT_HANDOFF_TOOL_NAME = "managed_agent.submit_handoff";
const MANAGED_AGENT_SUBMIT_HANDOFF_EFFECT: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process"],
  reversibility: "compensatable",
  dataEgress: "metadata",
  identityUse: "none",
  consequences: ["local-state"],
  idempotency: "non-idempotent",
};
const MANAGED_AGENT_SUBMIT_HANDOFF_AUTHORITY: AuthorityDescriptor = {
  level: 2,
  allowed: true,
  requiresApproval: false,
  reason: "Runtime-internal structured handoff submission is an audited process-local mutation",
};

function managedEconomicUsageUnit(name: ManagedAgentUsageReport["tokenClasses"][number]["name"]): string {
  switch (name) {
    case "input":
      return "input-token";
    case "output":
      return "output-token";
    case "cache_read":
      return "cache-read-token";
    case "cache_write":
      return "cache-write-token";
  }
}

export class ManagedDirectProviderRuntimeAdapter implements ManagedAgentRuntimeAdapter {
  readonly descriptor;
  private readonly config: ManagedDirectProviderRuntimeAdapterConfig;
  private readonly providerId: string;
  private readonly model?: string;
  private readonly provider: ProviderAdapter;
  private readonly tools: readonly ToolDefinition[];
  private readonly builtinTools: ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
  private readonly builtinToolsProvider: () => ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
  private readonly capabilityMap?: ReadonlyMap<string, Capability>;
  private readonly toolAuthority?: ReadonlyMap<string, AuthorityDescriptor>;
  private readonly executionEnvelope: RuntimeExecutionEnvelope;
  private readonly economicIdentity?: ManagedEconomicExecutionIdentity;
  private readonly runtimeModelRoundActionClaims: RuntimeModelRoundActionClaimStore;
  private readonly readAuthorityAdmission: ManagedDirectProviderRuntimeAdapterConfig["readAuthorityAdmission"];
  private readonly modelRoundAdapterIdentity: string;
  private readonly now: () => Date;

  constructor(config: ManagedDirectProviderRuntimeAdapterConfig) {
    this.config = config;
    this.providerId = requireText(config.providerId, "Managed direct provider id is required");
    this.model = config.model;
    this.provider = config.provider;
    this.tools = config.tools;
    this.builtinTools = config.builtinTools;
    this.builtinToolsProvider = config.builtinToolsProvider ?? (() => this.builtinTools);
    this.capabilityMap = config.capabilityMap;
    this.toolAuthority = config.toolAuthority;
    this.executionEnvelope = config.executionEnvelope ?? MANAGED_DIRECT_PROVIDER_EXECUTION_ENVELOPE;
    this.economicIdentity = config.economicIdentity;
    this.runtimeModelRoundActionClaims = config.runtimeModelRoundActionClaims;
    this.readAuthorityAdmission = config.readAuthorityAdmission;
    this.modelRoundAdapterIdentity =
      config.modelRoundAdapterIdentity ?? `managed-direct:${this.providerId}:${this.model ?? ""}`;
    this.now = config.now ?? (() => new Date());
    if (
      this.economicIdentity !== undefined &&
      (this.economicIdentity.route.providerId !== this.providerId || this.economicIdentity.route.modelId !== this.model)
    ) {
      throw new Error("Managed direct adapter economic identity does not match its provider route.");
    }
    const writeAuthority =
      config.writeAuthority !== undefined
        ? defineManagedAgentAdapterWriteAuthorityDescriptor(config.writeAuthority)
        : undefined;
    this.descriptor = defineManagedAgentAdapterDescriptor({
      adapterDescriptorId: `adapter:${this.providerId}:direct-provider`,
      providerId: this.providerId,
      adapterKind: "direct",
      supportedProfiles:
        writeAuthority !== undefined
          ? [
              "foundation-readonly-plan",
              "foundation-propose-writes",
              "foundation-apply-approved-writes",
              "foundation-memory-write-proposals",
            ]
          : ["foundation-readonly-plan"],
      supportedExecutionModes: ["direct-provider"],
      lifecycle: {
        exposesStart: true,
        exposesTerminal: true,
        exposesCleanup: true,
      },
      cancellation: { supported: true },
      timeout: {
        supported: true,
        diagnosticArtifactOnTimeout: true,
      },
      transcript: {
        supported: true,
        redactionKnown: true,
        truncationKnown: true,
        persistenceKnown: true,
        retentionKnown: true,
      },
      usage: {
        supported: true,
        preservesProviderTokenClasses: true,
        supportsExplicitUnknowns: true,
        tokenClasses: ["input", "output", "cache_read", "cache_write"],
        semanticSourceGranularity: "estimated",
        evidenceBasis: "runtime",
      },
      resultHandoff: {
        boundedSummary: true,
        resourcePointers: true,
      },
      credentialRoute: { supported: true },
      memoryContext: { governedAdmission: true },
      ...(writeAuthority !== undefined ? { writeAuthority } : {}),
      unsupportedFieldPolicy: "reject",
      cleanup: { supported: true },
    });
  }

  bindProvider(provider: ProviderAdapter): ManagedDirectProviderRuntimeAdapter {
    return new ManagedDirectProviderRuntimeAdapter({
      ...this.config,
      provider,
    });
  }

  async invoke(input: ManagedAgentRuntimeInvocationInput): Promise<ManagedAgentInvocationRecord> {
    if (
      this.economicIdentity !== undefined &&
      (input.registerEconomicSettlement === undefined || input.createEconomicSettlement === undefined)
    ) {
      throw new Error("Managed economic direct adapter requires typed economic settlement ownership.");
    }
    if (
      this.economicIdentity === undefined &&
      (input.registerEconomicSettlement !== undefined || input.createEconomicSettlement !== undefined)
    ) {
      throw new Error("Managed direct adapter received economic settlement ownership without a committed identity.");
    }
    const request = input.request;
    const childSessionId = buildChildSessionId(request);
    const childTurnId = `${childSessionId}:turn:1`;
    const childSession = new RuntimeSession({
      sessionId: childSessionId,
      appName: "managed-agent",
      tenantId: request.authority.memoryScope.scope.id,
      userId: request.requestedBy,
      systemPrompt: request.input.summary,
    });
    const abortController = new AbortController();
    const abortFromRuntime = () => abortController.abort(input.abortSignal.reason);
    if (input.abortSignal.aborted) {
      abortFromRuntime();
    } else {
      input.abortSignal.addEventListener("abort", abortFromRuntime, { once: true });
    }
    const progressEvents: ManagedAgentRuntimeInvocationProgressEvent[] = [];
    const execution = this.runChildRuntime(input, childSession, abortController.signal, progressEvents);
    input.registerAdapterCompletion(execution);
    if (
      this.economicIdentity !== undefined &&
      input.registerEconomicSettlement !== undefined &&
      input.createEconomicSettlement !== undefined
    ) {
      input.registerEconomicSettlement(
        execution.then((record) => input.createEconomicSettlement!(this.createEconomicExecutionReport(record))),
      );
    }
    const timeout = createManagedInvocationTimeout(request.authority.timeoutMs, abortController);
    let raced: ManagedAgentInvocationRecord | typeof TIMEOUT;
    try {
      raced = await Promise.race([execution, timeout.promise]);
    } finally {
      timeout.cancel();
      input.abortSignal.removeEventListener("abort", abortFromRuntime);
    }

    if (raced === TIMEOUT) {
      execution.catch(() => undefined);
      return this.timedOutRecord(input, childSessionId, childTurnId, progressEvents);
    }

    return raced as ManagedAgentInvocationRecord;
  }

  private createEconomicExecutionReport(record: ManagedAgentInvocationRecord): ManagedEconomicExecutionReport {
    if (this.economicIdentity === undefined) {
      throw new Error("Managed direct adapter cannot report economics without a committed identity.");
    }
    const tokenClasses = record.usage?.tokenClasses ?? [];
    const providerRejectedBeforeResponse =
      record.diagnostics?.some((diagnostic) => diagnostic.classification === "provider_quota_exhausted") ?? false;
    const units = tokenClasses.flatMap((usage) => {
      if (usage.value === "unknown") return [];
      return [
        {
          atoms: String(usage.value),
          scale: 0,
          unit: managedEconomicUsageUnit(usage.name),
          scheme: { kind: "unit" as const },
        },
      ];
    });
    const unknownTokenClasses = tokenClasses
      .filter((usage) => usage.value === "unknown")
      .map((usage) => usage.name)
      .sort();
    const usage: ManagedEconomicExecutionReport["usage"] = providerRejectedBeforeResponse
      ? {
          kind: "complete",
          units: (["input", "output", "cache_read", "cache_write"] as const).map((name) => ({
            atoms: "0",
            scale: 0,
            unit: managedEconomicUsageUnit(name),
            scheme: { kind: "unit" as const },
          })),
        }
      : tokenClasses.length === 0
        ? {
            kind: "incomplete",
            knownUnits: units,
            reason: "provider-usage-missing",
          }
        : unknownTokenClasses.length > 0
          ? {
              kind: "incomplete",
              knownUnits: units,
              reason: `provider-usage-unknown:${unknownTokenClasses.join(",")}`,
            }
          : { kind: "complete", units };
    const observedAtDate = this.now();
    const observedAt = observedAtDate.toISOString();
    const validUntil = new Date(observedAtDate.getTime() + ECONOMIC_EXECUTION_EVIDENCE_VALIDITY_MS).toISOString();
    const sourceDigest = digestManagedEconomicValue({
      invocationId: record.invocationId,
      actualIdentity: this.economicIdentity,
      usage,
    });
    return {
      actualIdentity: this.economicIdentity,
      usage,
      evidence: {
        sourceIdentity: `managed-direct-runtime:${this.providerId}:${this.model}`,
        sourceRevision: sourceDigest,
        sourceDigest,
        observedAt,
        validUntil,
        confidence: "medium",
        authority: "calculated-estimate",
      },
    };
  }

  private async runChildRuntime(
    input: ManagedAgentRuntimeInvocationInput,
    childSession: RuntimeSession,
    abortSignal: AbortSignal,
    progressEvents: ManagedAgentRuntimeInvocationProgressEvent[],
  ): Promise<ManagedAgentInvocationRecord> {
    const request = input.request;
    const childSessionId = childSession.id;
    const childTurnId = `${childSessionId}:turn:1`;
    let providerTransportOrdinal = 0;
    const recordProgress = (event: ManagedAgentRuntimeInvocationProgressEvent): void => {
      progressEvents.push(event);
      void Promise.resolve(input.progressObserver?.(event)).catch(() => undefined);
    };
    try {
      const handoffSubmission = request.input.handoff ? createManagedHandoffSubmission() : undefined;
      const allowedToolNames = new Set([
        ...request.authority.toolAuthority.allowedToolNames,
        ...(handoffSubmission ? [MANAGED_AGENT_SUBMIT_HANDOFF_TOOL_NAME] : []),
      ]);
      const tools = [
        ...this.tools.filter((tool) => allowedToolNames.has(tool.name)),
        ...(handoffSubmission ? [handoffSubmission.tool] : []),
      ];
      const capabilityMap = this.capabilityMap
        ? new Map(filterMap(this.capabilityMap, allowedToolNames))
        : new Map<string, Capability>();
      const toolAuthority = this.toolAuthority
        ? new Map(filterMap(this.toolAuthority, allowedToolNames))
        : new Map<string, AuthorityDescriptor>();
      const runtimeBuiltinTools = new Map(this.builtinToolsProvider());
      if (handoffSubmission) {
        runtimeBuiltinTools.set(MANAGED_AGENT_SUBMIT_HANDOFF_TOOL_NAME, handoffSubmission.execute);
        capabilityMap.set(MANAGED_AGENT_SUBMIT_HANDOFF_TOOL_NAME, {
          name: handoffSubmission.tool.name,
          description: handoffSubmission.tool.description,
          schema: handoffSubmission.tool.inputSchema,
          tags: ["managed-invocation", "handoff", "runtime-internal"],
          effectEnvelope: MANAGED_AGENT_SUBMIT_HANDOFF_EFFECT,
        });
        toolAuthority.set(MANAGED_AGENT_SUBMIT_HANDOFF_TOOL_NAME, MANAGED_AGENT_SUBMIT_HANDOFF_AUTHORITY);
      }
      const effectiveToolAuthority = input.consumedWriteApproval
        ? applyConsumedWriteApproval(toolAuthority, request)
        : toolAuthority;
      const childAuthority = input.childAuthorityAdmission
        ? admitManagedChildAuthority({
            bundle: input.childAuthorityAdmission.bundle,
            request,
            candidateToolNames: [...allowedToolNames],
            capabilities: capabilityMap,
            toolAuthority: effectiveToolAuthority,
          })
        : undefined;
      const executionToolAllowlist = childAuthority
        ? new Set(childAuthority.allowedToolPermissions.map(({ toolName }) => toolName))
        : allowedToolNames;
      const executionToolAuthority = childAuthority
        ? new Map(childAuthority.allowedToolPermissions.map(({ toolName, authority }) => [toolName, authority]))
        : effectiveToolAuthority;
      const executionCapabilities = childAuthority
        ? new Map(
            childAuthority.allowedToolPermissions.map(({ toolName, effectEnvelope }) => {
              const capability = capabilityMap.get(toolName);
              if (!capability)
                throw new Error(`Managed child authority admission is missing capability for tool "${toolName}".`);
              return [toolName, { ...capability, effectEnvelope }];
            }),
          )
        : capabilityMap;
      const builtinTools = withManagedToolSandbox(runtimeBuiltinTools, createManagedToolSandbox(request));
      const eventBus = new EventBus();
      const unsubscribeProgress = attachManagedChildProgressObserver(
        eventBus,
        childSessionId,
        request.invocationId,
        recordProgress,
      );
      const deps: OrchestratorDeps = {
        provider: this.provider,
        ...(this.model ? { model: this.model } : {}),
        executionEnvelope: boundedExecutionEnvelope(this.executionEnvelope, input.workLimits?.maxTurns),
        tools: tools.filter((tool) => executionToolAllowlist.has(tool.name)),
        builtinTools,
        eventBus,
        ...(executionCapabilities.size > 0 ? { capabilityMap: executionCapabilities } : {}),
      };
      const orchestrator = new RuntimeSessionOrchestrator(deps);
      const routeModel = request.providerRoute.model ?? this.model ?? "";
      const communicationCapabilities = request.providerRoute.communicationIntent
        ? knownModelCommunicationCapabilities(request.providerRoute.providerId, routeModel)
        : undefined;
      const routeCapabilities =
        this.config.deliberationCapabilities || communicationCapabilities
          ? new Map([
              [
                `${request.providerRoute.providerId}/${routeModel}`,
                {
                  ...(this.config.deliberationCapabilities
                    ? { deliberation: this.config.deliberationCapabilities }
                    : {}),
                  ...(communicationCapabilities ? { communication: communicationCapabilities } : {}),
                },
              ],
            ])
          : undefined;
      const perCallConfig: PerCallToolConfig = {
        tenantId: request.authority.memoryScope.scope.id,
        ...(childAuthority ? { authorityAdmission: childAuthority.bundle } : {}),
        ...(input.attendedTrustedExecution !== undefined
          ? { attendedTrustedExecution: input.attendedTrustedExecution }
          : {}),
        ...(request.executionScope ? { executionScope: request.executionScope } : {}),
        abortSignal,
        toolAllowlist: executionToolAllowlist,
        additionalTools: tools.filter((tool) => executionToolAllowlist.has(tool.name)),
        ...(executionCapabilities.size > 0 ? { perCallCapabilities: executionCapabilities } : {}),
        ...(executionToolAuthority.size > 0 ? { toolAuthority: executionToolAuthority } : {}),
        ...(request.providerRoute.deliberationResolution
          ? { deliberationResolution: request.providerRoute.deliberationResolution }
          : {}),
        ...(request.providerRoute.deliberationIntent && !request.providerRoute.deliberationResolution
          ? {
              deliberationIntent: request.providerRoute.deliberationIntent,
              deliberationSource: "route",
            }
          : {}),
        ...(request.providerRoute.communicationIntent
          ? { communicationIntent: request.providerRoute.communicationIntent }
          : {}),
        ...(routeCapabilities ? { modelRoutingPolicy: { routeCapabilities } } : {}),
        providerTransport: {
          projectId: managedProviderTransportProjectId(request),
          requestIdPrefix: managedProviderTransportRequestIdPrefix(request),
          observer: {
            onEvent: (event) => {
              // Chunk cadence is unbounded and carries no durable diagnostic value.
              if (event.type === "response_chunk") return;
              if (providerTransportOrdinal >= MAX_PROVIDER_TRANSPORT_PROGRESS_EVENTS_PER_CHILD) return;
              providerTransportOrdinal += 1;
              recordProgress(
                managedProviderTransportProgressEvent(request.invocationId, providerTransportOrdinal, event),
              );
            },
          },
        },
      };
      if (!childAuthority) {
        throw new Error("Managed direct provider execution requires a full persisted child authority admission.");
      }
      const execution = childAuthority.bundle.turn.execution;
      if (execution.status !== "routed") {
        throw new Error("Managed direct provider execution requires a routed persisted child authority admission.");
      }
      const modelRoundDispatch: RuntimeModelRoundDispatchContext = {
        admission: childAuthority.bundle,
        intentFingerprint: runtimeModelRoundEffectIdentity({
          workload: "managed-direct",
          invocationId: request.invocationId,
          profile: request.profile,
          authorityProfileId: request.authority.authorityProfileId,
          providerId: request.providerRoute.providerId,
          model: request.providerRoute.model ?? this.model,
          summary: request.input.summary,
          prompt: request.input.prompt,
          resourceUris: request.input.resourceUris,
        }),
        attemptId: request.invocationId,
        routeId: execution.binding.routeId,
        accountId: execution.binding.accountId,
        credentialRevision: execution.binding.credentialRevision,
        admissionReadbackSessionId: childAuthority.bundle.sessionId,
        admissionReadbackTurnId: childAuthority.bundle.turnId,
        readAdmission: () =>
          readRuntimeModelRoundAdmission({
            readAdmission: this.readAuthorityAdmission,
            admissionId: childAuthority.bundle.admissionId,
            sessionId: childAuthority.bundle.sessionId,
            turnId: childAuthority.bundle.turnId,
            expected: {
              routeId: execution.binding.routeId,
              accountId: execution.binding.accountId,
              credentialRevision: execution.binding.credentialRevision,
            },
          }),
        store: this.runtimeModelRoundActionClaims,
        state: { claimed: false },
      };
      (perCallConfig as { runtimeModelRoundDispatch?: RuntimeModelRoundDispatchContext }).runtimeModelRoundDispatch =
        modelRoundDispatch;
      const runtimeToolActionClaims: RuntimeToolActionClaimsContext = {
        admission: childAuthority.bundle,
        attemptId: request.invocationId,
        adapterIdentity: this.config.toolActionAdapterIdentity ?? this.modelRoundAdapterIdentity,
        admissionReadbackSessionId: childAuthority.bundle.sessionId,
        admissionReadbackTurnId: childAuthority.bundle.turnId,
        readAdmission: this.config.readAuthorityAdmission,
        store: this.config.runtimeToolActionClaims,
        state: { claimed: false },
      };
      (perCallConfig as { runtimeToolActionClaims?: RuntimeToolActionClaimsContext }).runtimeToolActionClaims =
        runtimeToolActionClaims;
      // Resource hydration is a host-owned context admission before provider execution,
      // so it consumes the persisted parent-turn permission rather than exposing
      // resource_read as a child-callable model tool.
      const resourceReadPermission = childAuthority.bundle.turn.tools.allowedToolPermissions.find(
        ({ toolName }) => toolName === "resource_read",
      );
      const governedResourceContext = await buildManagedInvocationResourceContext({
        resourceUris: request.input.resourceUris,
        invocationId: request.invocationId,
        abortSignal,
        ...(resourceReadPermission
          ? { resourceReader: createManagedInvocationRuntimeResourceReader({
              builtinTools: runtimeBuiltinTools,
              session: childSession,
              authority: resourceReadPermission.authority,
              resolvedEffect: resourceReadPermission.effectEnvelope,
            }) }
          : {}),
      });
      let result: OrchestrateResult;
      try {
        const executionResult = await orchestrator.processMessage(
          childSession,
          textParts(
            appendManagedResultHandoffContract(
              request.input.prompt ?? request.input.summary,
              request,
              "submission-tool",
            ),
          ),
          governedResourceContext,
          builtinTools,
          perCallConfig,
        );
        // A handoff is only a finalization step for a completed execution. A
        // paused or failed child already has an authoritative typed
        // disposition; dispatching the handoff prompt here could replace that
        // disposition with a misleading successful finalization result.
        if (!handoffSubmission || executionResult.outcome !== "completed" || handoffSubmission.result()) {
          result = executionResult;
        } else {
          const handoffCapability = capabilityMap.get(MANAGED_AGENT_SUBMIT_HANDOFF_TOOL_NAME);
          const handoffAuthority = toolAuthority.get(MANAGED_AGENT_SUBMIT_HANDOFF_TOOL_NAME);
          const finalizationResult = await new RuntimeSessionOrchestrator({
            ...deps,
            tools: [handoffSubmission.tool],
          }).processMessage(
            childSession,
            textParts(
              [
                "Finalize this managed invocation now.",
                `Call ${MANAGED_AGENT_SUBMIT_HANDOFF_TOOL_NAME} exactly once with the completed structured result.`,
                "Do not perform more repository work and do not answer with prose instead of the tool call.",
              ].join("\n"),
            ),
            undefined,
            builtinTools,
            {
              ...perCallConfig,
              runtimeModelRoundDispatch: {
                ...modelRoundDispatch,
                attemptId: `${request.invocationId}:finalization`,
                intentFingerprint: runtimeModelRoundEffectIdentity({
                  workload: "managed-direct-finalization",
                  invocationId: request.invocationId,
                  profile: request.profile,
                  authorityProfileId: request.authority.authorityProfileId,
                  providerId: request.providerRoute.providerId,
                  model: request.providerRoute.model ?? this.model,
                  instruction: "submit-managed-result-handoff",
                }),
                state: { claimed: false },
              },
              toolAllowlist: new Set([MANAGED_AGENT_SUBMIT_HANDOFF_TOOL_NAME]),
              additionalTools: [handoffSubmission.tool],
              perCallCapabilities: handoffCapability
                ? new Map([[MANAGED_AGENT_SUBMIT_HANDOFF_TOOL_NAME, handoffCapability]])
                : undefined,
              toolAuthority: handoffAuthority
                ? new Map([[MANAGED_AGENT_SUBMIT_HANDOFF_TOOL_NAME, handoffAuthority]])
                : undefined,
              initialToolChoice: {
                type: "tool",
                name: MANAGED_AGENT_SUBMIT_HANDOFF_TOOL_NAME,
              },
            },
          );
          result = mergeManagedChildResults(executionResult, finalizationResult);
        }
      } finally {
        unsubscribeProgress();
      }
      const resultText = extractText(result.parts);
      const replayResource = resultReplayResource(request.invocationId, resultText);
      const childExecutionResource = childExecutionReplayResource(request.invocationId, result, resultText);
      const structuredResult = handoffSubmission?.result();
      const summary = structuredResult?.summary ?? clipSummary(resultText, replayResource?.uri, result);
      const writeEvidence = collectDirectRuntimeWriteEvidence(request, result.toolExecutions ?? []);
      const resultResourceUris = [
        managedInvocationUri(request.invocationId, "transcript"),
        ...(replayResource ? [replayResource.uri] : []),
        ...(childExecutionResource ? [childExecutionResource.uri] : []),
        ...writeEvidence.resultResourceUris,
      ];
      const replayResources = [replayResource, childExecutionResource].filter(
        (resource): resource is ManagedAgentReplayResource => resource !== undefined,
      );

      const missingRequiredHandoff =
        handoffSubmission !== undefined &&
        structuredResult === undefined &&
        !isNoHandoffDisposition(result);
      return defineManagedAgentInvocationRecord({
        ...this.baseRecord(input),
        lifecycleState: missingRequiredHandoff ? "failed" : lifecycleStateForDirectChildDisposition(result),
        stopReason: result.dispositionReason,
        childSessionId,
        childTurnId,
        transcript: transcriptPointer(request.invocationId),
        ...(missingRequiredHandoff
          ? {
              diagnostics: [
                {
                  uri: childExecutionResource?.uri ?? managedInvocationUri(request.invocationId, "transcript"),
                  kind: "failure" as const,
                },
              ],
            }
          : {}),
        usage: {
          source: "runtime",
          tokenClasses: [
            { name: "input", value: result.inputTokens },
            { name: "output", value: result.outputTokens },
            { name: "cache_read", value: result.cacheReadTokens },
            { name: "cache_write", value: result.cacheWriteTokens },
          ],
          cost: {
            currency: "unknown",
            amount: "unknown",
          },
        },
        resultHandoff: {
          provenance: structuredResult
            ? submissionToolHandoffProvenance(request.providerRoute.model)
            : runtimeGeneratedHandoffProvenance(request.providerRoute.model),
          summary,
          resourceUris: uniqueStrings([
            ...resultResourceUris,
            ...(structuredResult?.evidence.map((item) => item.uri) ?? []),
            ...(structuredResult?.citations.map((item) => item.uri) ?? []),
            ...(structuredResult?.verificationResults.flatMap((item) => item.evidenceUris) ?? []),
          ]),
          memoryWriteProposalUris: [],
          ...(structuredResult ? { structuredResult } : {}),
        },
        ...(replayResources.length > 0 ? { replayResources } : {}),
        ...(writeEvidence.evidence.length > 0 ? { writeEvidence: writeEvidence.evidence } : {}),
      });
    } catch (err) {
      if (input.abortSignal.aborted && input.abortSignal.reason instanceof ManagedEconomicLifecycleTimeoutError) {
        return this.timedOutRecord(input, childSessionId, childTurnId, progressEvents);
      }
      if (input.abortSignal.aborted) {
        return defineManagedAgentInvocationRecord({
          ...this.baseRecord(input),
          lifecycleState: "cancelled",
          childSessionId,
          childTurnId,
          transcript: transcriptPointer(request.invocationId),
          usage: unknownRuntimeUsage(),
          resultHandoff: {
            provenance: runtimeGeneratedHandoffProvenance(request.providerRoute.model),
            summary: String(input.abortSignal.reason ?? "Managed direct provider invocation cancelled."),
            resourceUris: [managedInvocationUri(request.invocationId, "transcript")],
            memoryWriteProposalUris: [],
          },
        });
      }
      const failureSummary = formatDirectProviderFailure(err, request.providerRoute);
      const providerQuotaExhausted = isDirectProviderQuotaFailure(err, failureSummary);
      return defineManagedAgentInvocationRecord({
        ...this.baseRecord(input),
        lifecycleState: "failed",
        childSessionId,
        childTurnId,
        transcript: transcriptPointer(request.invocationId),
        diagnostics: [
          {
            uri: managedInvocationUri(request.invocationId, "failure"),
            kind: "failure",
            ...(providerQuotaExhausted ? { classification: "provider_quota_exhausted" as const } : {}),
          },
        ],
        usage: unknownRuntimeUsage(),
        resultHandoff: {
          provenance: runtimeGeneratedHandoffProvenance(request.providerRoute.model),
          summary: failureSummary,
          resourceUris: [managedInvocationUri(request.invocationId, "failure")],
          memoryWriteProposalUris: [],
        },
      });
    }
  }

  private baseRecord(
    input: ManagedAgentRuntimeInvocationInput,
  ): Omit<
    ManagedAgentInvocationRecord,
    | "lifecycleState"
    | "childSessionId"
    | "childTurnId"
    | "transcript"
    | "diagnostics"
    | "usage"
    | "resultHandoff"
    | "writeEvidence"
  > {
    const request = input.request;
    return {
      invocationId: request.invocationId,
      agentId: request.agentId,
      parentSessionId: request.parentSessionId,
      parentTurnId: request.parentTurnId,
      profile: request.profile,
      providerRoute: this.providerRoute(request.providerRoute),
      adapterKind: request.adapterKind,
      executionMode: request.executionMode,
      authority: request.authority,
      capabilitySnapshot: input.admission.capabilitySnapshot,
    };
  }

  private timedOutRecord(
    input: ManagedAgentRuntimeInvocationInput,
    childSessionId: string,
    childTurnId: string,
    progressEvents: readonly ManagedAgentRuntimeInvocationProgressEvent[],
  ): ManagedAgentInvocationRecord {
    const request = input.request;
    const timeoutMs =
      input.abortSignal.reason instanceof ManagedEconomicLifecycleTimeoutError
        ? input.abortSignal.reason.timeoutMs
        : request.authority.timeoutMs;
    const timeoutSummary = formatTimeoutSummary({
      timeoutMs,
      childSessionId,
      childTurnId,
    });
    const timeoutResource = childTimeoutReplayResource(request.invocationId, timeoutSummary, progressEvents);
    return defineManagedAgentInvocationRecord({
      ...this.baseRecord(input),
      lifecycleState: "timed_out",
      stopReason: "managed-economic-duration-limit",
      childSessionId,
      childTurnId,
      transcript: transcriptPointer(request.invocationId),
      diagnostics: [
        {
          uri: managedInvocationUri(request.invocationId, "timeout"),
          kind: "timeout",
        },
      ],
      usage: unknownRuntimeUsage(),
      resultHandoff: {
        provenance: runtimeGeneratedHandoffProvenance(request.providerRoute.model),
        summary: timeoutSummary,
        resourceUris: [
          managedInvocationUri(request.invocationId, "transcript"),
          managedInvocationUri(request.invocationId, "timeout"),
        ],
        memoryWriteProposalUris: [],
      },
      replayResources: [timeoutResource],
    });
  }

  private providerRoute(
    route: ManagedAgentInvocationRequest["providerRoute"],
  ): ManagedAgentInvocationRequest["providerRoute"] {
    return {
      providerId: this.providerId,
      surface: "direct-provider",
      ...((route.model ?? this.model) ? { model: route.model ?? this.model } : {}),
      ...(route.deliberationIntent !== undefined ? { deliberationIntent: route.deliberationIntent } : {}),
      ...(route.communicationIntent !== undefined ? { communicationIntent: route.communicationIntent } : {}),
    };
  }
}

function runtimeGeneratedHandoffProvenance(model: string | undefined) {
  return {
    delivery: "runtime-generated" as const,
    configuredModelId: model ?? "provider-default",
    observedModelIds: [],
  };
}

function submissionToolHandoffProvenance(model: string | undefined) {
  return {
    delivery: "submission-tool" as const,
    configuredModelId: model ?? "provider-default",
    observedModelIds: [],
  };
}

export interface ManagedDirectProviderBindingAdapter extends ManagedAgentRuntimeAdapter {
  bindProvider(provider: ProviderAdapter): ManagedAgentRuntimeAdapter;
}

export function isManagedDirectProviderBindingAdapter(
  adapter: ManagedAgentRuntimeAdapter,
): adapter is ManagedDirectProviderBindingAdapter {
  return (
    adapter.descriptor.adapterKind === "direct" &&
    adapter.descriptor.supportedExecutionModes.includes("direct-provider") &&
    typeof Reflect.get(adapter, "bindProvider") === "function"
  );
}

function createManagedHandoffSubmission(): {
  readonly tool: ToolDefinition;
  readonly execute: RuntimeBuiltinToolExecutor;
  readonly result: () => StructuredExecutionResult | undefined;
} {
  let submitted: StructuredExecutionResult | undefined;
  const tool: ToolDefinition = {
    name: MANAGED_AGENT_SUBMIT_HANDOFF_TOOL_NAME,
    description:
      "Submit the single canonical structured result for this managed child invocation. Call exactly once after the work and its verification are complete.",
    inputSchema: STRUCTURED_EXECUTION_RESULT_JSON_SCHEMA,
    strict: true,
    tags: new Set(["managed-agent", "handoff", "runtime-control"]),
  };
  return {
    tool,
    execute: async (input) => {
      if (submitted) {
        return {
          output: "Managed result handoff was already submitted.",
          isError: true,
          metadata: { errorCode: "managed_handoff_already_submitted" },
        };
      }
      try {
        submitted = defineStructuredExecutionResult(input as unknown as StructuredExecutionResult);
        return {
          output: "Managed result handoff accepted.",
          isError: false,
          metadata: {
            kind: "managed-result-handoff",
            status: submitted.status,
          },
        };
      } catch (error) {
        return {
          output: error instanceof Error ? error.message : String(error),
          isError: true,
          metadata: { errorCode: "managed_handoff_invalid" },
        };
      }
    },
    result: () => submitted,
  };
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function boundedExecutionEnvelope(
  envelope: import("../../session/runtime-session-orchestrator.types.js").RuntimeExecutionEnvelope | undefined,
  maxTurns: number | undefined,
): import("../../session/runtime-session-orchestrator.types.js").RuntimeExecutionEnvelope | undefined {
  if (maxTurns === undefined) return envelope;
  const basePolicy = envelope?.convergence ?? MANAGED_DIRECT_PROVIDER_CONVERGENCE_POLICY_INPUT;
  return {
    ...(envelope ?? {}),
    convergence: deriveRuntimeConvergencePolicyInput({
      policyId: basePolicy.policyId,
      toolRounds: Math.min(basePolicy.toolRounds, maxTurns),
    }, basePolicy),
  };
}

function attachManagedChildProgressObserver(
  eventBus: EventBus,
  childSessionId: string,
  invocationId: string,
  observer: ManagedAgentRuntimeInvocationInput["progressObserver"],
): () => void {
  if (!observer) {
    return () => undefined;
  }
  const handler = (
    event: ToolAuthorizedEvent | ToolCalledEvent | ToolResultEvent | ToolCacheHitEvent | ErrorEvent,
  ): void => {
    if (event.sessionId !== childSessionId) {
      return;
    }
    const progress = managedChildProgressEvent(invocationId, event);
    if (progress) {
      void Promise.resolve(observer(progress)).catch(() => undefined);
    }
  };
  eventBus.on("tool_authorized", handler);
  eventBus.on("tool_called", handler);
  eventBus.on("tool_result", handler);
  eventBus.on("tool_cache_hit", handler);
  eventBus.on("error", handler);
  return () => {
    eventBus.off("tool_authorized", handler);
    eventBus.off("tool_called", handler);
    eventBus.off("tool_result", handler);
    eventBus.off("tool_cache_hit", handler);
    eventBus.off("error", handler);
  };
}

function managedChildProgressEvent(
  invocationId: string,
  event: ToolAuthorizedEvent | ToolCalledEvent | ToolResultEvent | ToolCacheHitEvent | ErrorEvent,
): ManagedAgentRuntimeInvocationProgressEvent {
  const recordedAt = event.timestamp instanceof Date ? event.timestamp.toISOString() : new Date().toISOString();
  const base = {
    eventId: `${invocationId}:progress:${event.type}:${recordedAt}:${"toolName" in event ? event.toolName : "runtime"}`,
    kind: event.type,
    recordedAt,
  };
  if (event.type === "tool_authorized") {
    return {
      ...base,
      summary: `${event.toolName} authorization ${event.allowed ? "allowed" : "denied"}`,
      toolName: event.toolName,
      metadata: {
        level: event.level,
        allowed: event.allowed,
        reason: event.reason,
      },
    };
  }
  if (event.type === "tool_called") {
    return {
      ...base,
      summary: `${event.toolName} called`,
      toolName: event.toolName,
      ...(event.metadata ? { metadata: event.metadata } : {}),
    };
  }
  if (event.type === "tool_result") {
    return {
      ...base,
      summary: `${event.toolName} ${event.success ? "succeeded" : "failed"}`,
      toolName: event.toolName,
      success: event.success,
      ...(event.isError !== undefined ? { isError: event.isError } : {}),
      durationMs: event.durationMs,
      ...(event.resultSummary ? { resultSummary: event.resultSummary } : {}),
      ...(event.metadata ? { metadata: event.metadata } : {}),
    };
  }
  if (event.type === "tool_cache_hit") {
    return {
      ...base,
      summary: `${event.toolName} cache hit`,
      toolName: event.toolName,
      metadata: { cacheTtl: event.cacheTtl },
    };
  }
  return {
    ...base,
    summary: event.message,
    isError: true,
    metadata: {
      code: event.code,
      taskId: event.taskId,
    },
  };
}

function filterMap<T>(source: ReadonlyMap<string, T>, allowedNames: ReadonlySet<string>): ReadonlyMap<string, T> {
  const filtered = new Map<string, T>();
  for (const [name, value] of source) {
    if (allowedNames.has(name)) {
      filtered.set(name, value);
    }
  }
  return filtered;
}

function withManagedToolSandbox(
  source: ReadonlyMap<string, RuntimeBuiltinToolExecutor>,
  sandbox: unknown,
): ReadonlyMap<string, RuntimeBuiltinToolExecutor> {
  const wrapped = new Map<string, RuntimeBuiltinToolExecutor>();
  for (const [name, executor] of source) {
    wrapped.set(name, async (input, context) => executor(input, withSandboxContext(context, sandbox)));
  }
  return wrapped;
}

function withSandboxContext(
  context: RuntimeBuiltinToolExecutionContext | undefined,
  sandbox: unknown,
): RuntimeBuiltinToolExecutionContext | undefined {
  if (!context) {
    return undefined;
  }
  return {
    ...context,
    sandbox,
  };
}

function createManagedToolSandbox(request: ManagedAgentInvocationRequest): {
  readonly cwd: string;
  readonly policy: SandboxPolicy;
  readonly physicalPathResolver: typeof nodePhysicalPathResolver;
} {
  const workingDirectory = request.authority.workingDirectory.path;
  const config: SandboxConfig = {
    fsPolicy:
      request.authority.toolAuthority.writeAllowed === true && request.authority.workingDirectory.mode !== "read-only"
        ? "read-write"
        : "read-only",
    netPolicy: request.authority.toolAuthority.networkAllowed === true ? "full" : "none",
    allowedPaths: resolveAllowedPaths(request),
    deniedPaths: resolveDeniedPaths(request),
    allowedDomains: request.authority.toolAuthority.networkAllowed === true ? ["*"] : [],
  };
  return {
    cwd: workingDirectory,
    policy: new SandboxPolicy({
      config,
      projectPath: workingDirectory,
    }),
    physicalPathResolver: nodePhysicalPathResolver,
  };
}

function resolveAllowedPaths(request: ManagedAgentInvocationRequest): readonly string[] {
  if (
    request.authority.toolAuthority.writeAllowed !== true ||
    request.authority.workingDirectory.mode === "read-only"
  ) {
    return uniquePaths([
      request.authority.workingDirectory.path,
      ...(request.authority.readAuthority?.workspace.allowedPaths ?? []),
    ]);
  }
  const workspaceScope = request.authority.writeAuthority?.scope.workspace;
  if (workspaceScope && workspaceScope.allowedPaths.length > 0) {
    return workspaceScope.allowedPaths;
  }
  return [request.authority.workingDirectory.path];
}

function resolveDeniedPaths(request: ManagedAgentInvocationRequest): readonly string[] {
  return uniquePaths([
    ...(request.authority.readAuthority?.workspace.deniedPaths ?? []),
    ...(request.authority.writeAuthority?.scope.workspace.deniedPaths ?? []),
  ]);
}

function uniquePaths(paths: readonly string[]): readonly string[] {
  return [...new Set(paths)];
}

function buildChildSessionId(request: ManagedAgentInvocationRequest): string {
  return `${request.parentSessionId}:managed:${request.invocationId}`;
}

function applyConsumedWriteApproval(
  source: ReadonlyMap<string, AuthorityDescriptor>,
  request: ManagedAgentInvocationRequest,
): ReadonlyMap<string, AuthorityDescriptor> {
  const approvedTools = new Set(request.authority.writeAuthority?.scope.tools.allowedToolNames ?? []);
  return new Map(
    [...source].map(([toolName, authority]) => [
      toolName,
      approvedTools.has(toolName) && authority.requiresApproval
        ? {
            ...authority,
            allowed: true,
            requiresApproval: false,
            reason: "Exact durable managed write approval was consumed before the dispatch fence",
          }
        : authority,
    ]),
  );
}

function managedProviderTransportProjectId(request: ManagedAgentInvocationRequest): string {
  return `kiln-project-${digestManagedEconomicValue({
    scopeKind: request.authority.memoryScope.scope.kind,
    scopeId: request.authority.memoryScope.scope.id,
  }).slice("sha256:".length)}`;
}

function managedProviderTransportRequestIdPrefix(request: ManagedAgentInvocationRequest): string {
  return `kiln-request-${digestManagedEconomicValue({
    invocationId: request.invocationId,
    parentTurnId: request.parentTurnId,
  }).slice("sha256:".length)}`;
}

function managedProviderTransportProgressEvent(
  invocationId: string,
  ordinal: number,
  event: ProviderTransportEvent,
): ManagedAgentRuntimeInvocationProgressEvent {
  const recordedAt = new Date().toISOString();
  const metadata =
    event.type === "response_headers"
      ? { eventType: event.type, phase: "headers", status: event.status }
      : event.type === "request_failed"
        ? { eventType: event.type, phase: event.phase }
        : { eventType: event.type };
  return {
    eventId: `${invocationId}:provider-transport:${ordinal}`,
    kind: "provider_transport",
    recordedAt,
    summary: `Provider transport ${event.type.replaceAll("_", " ")}.`,
    metadata,
  };
}

function collectDirectRuntimeWriteEvidence(
  request: ManagedAgentInvocationRequest,
  toolExecutions: readonly ToolExecutionSummary[],
): {
  readonly evidence: readonly ManagedAgentWriteEvidence[];
  readonly resultResourceUris: readonly string[];
} {
  const fileChanges = toolExecutions.flatMap((execution) =>
    (execution.fileChanges ?? []).map((change) => ({
      source: "tool-result" as const,
      path: change.path,
      changeType: change.changeType,
      ...(change.linesAdded !== undefined ? { linesAdded: change.linesAdded } : {}),
      ...(change.linesRemoved !== undefined ? { linesRemoved: change.linesRemoved } : {}),
      ...(change.diffPreview !== undefined ? { diffPreview: change.diffPreview } : {}),
      ...(change.diffTruncated !== undefined ? { diffTruncated: change.diffTruncated } : {}),
    })),
  );
  if (fileChanges.length === 0) {
    return {
      evidence: [],
      resultResourceUris: [],
    };
  }

  const collected = collectManagedAgentLiveWriteEvidence({
    request,
    fileChanges: normalizeManagedAgentLiveWriteChanges(fileChanges),
  });
  return {
    evidence: collected.evidence,
    resultResourceUris: collected.attemptResourceUris,
  };
}

function managedInvocationUri(invocationId: string, kind: string): string {
  return `kiln://managed-invocations/${invocationId}/${kind}`;
}

function transcriptPointer(invocationId: string) {
  return {
    uri: managedInvocationUri(invocationId, "transcript"),
    redacted: "unknown" as const,
    truncated: false,
    persisted: true,
    retention: "session" as const,
  };
}

function unknownRuntimeUsage(): ManagedAgentUsageReport {
  return {
    source: "runtime" as const,
    tokenClasses: [
      { name: "input", value: "unknown" as const },
      { name: "output", value: "unknown" as const },
      { name: "cache_read", value: "unknown" as const },
      { name: "cache_write", value: "unknown" as const },
    ],
    cost: {
      currency: "unknown" as const,
      amount: "unknown" as const,
    },
  };
}

function clipSummary(
  summary: string,
  resultResourceUri: string | undefined,
  disposition: TurnTerminalDisposition,
): string {
  const trimmed = summary.trim();
  if (trimmed.length === 0) {
    return `${NO_DIRECT_HANDOFF_SUMMARY} Inspect the transcript resource before recording governed evidence.`;
  }
  if (isNoHandoffDisposition(disposition)) {
    return `${NO_DIRECT_HANDOFF_SUMMARY} ${trimmed}`;
  }
  if (trimmed.length <= RESULT_SUMMARY_LIMIT) {
    return trimmed;
  }
  const suffix = resultResourceUri ? `... ${RESULT_RESOURCE_NOTICE}` : "...";
  const prefixLength = Math.max(0, RESULT_SUMMARY_LIMIT - suffix.length);
  return `${trimmed.slice(0, prefixLength)}${suffix}`;
}

function isNoHandoffDisposition(disposition: TurnTerminalDisposition): boolean {
  return disposition.outcome !== "completed";
}

function lifecycleStateForDirectChildDisposition(disposition: TurnTerminalDisposition): "completed" | "failed" {
  return disposition.outcome === "completed" ? "completed" : "failed";
}

function mergeManagedChildResults(execution: OrchestrateResult, finalization: OrchestrateResult): OrchestrateResult {
  return {
    ...finalization,
    inputTokens: execution.inputTokens + finalization.inputTokens,
    outputTokens: execution.outputTokens + finalization.outputTokens,
    cacheReadTokens: execution.cacheReadTokens + finalization.cacheReadTokens,
    cacheWriteTokens: execution.cacheWriteTokens + finalization.cacheWriteTokens,
    providerRequests: [...(execution.providerRequests ?? []), ...(finalization.providerRequests ?? [])],
    toolExecutions: [...(execution.toolExecutions ?? []), ...(finalization.toolExecutions ?? [])],
  };
}

function isFailedDirectChildDisposition(disposition: TurnTerminalDisposition): boolean {
  return disposition.outcome !== "completed";
}

function resultReplayResource(invocationId: string, text: string): ManagedAgentReplayResource | undefined {
  if (text.length <= RESULT_SUMMARY_LIMIT) {
    return undefined;
  }
  return {
    uri: managedInvocationUri(invocationId, "result/final"),
    title: "Managed invocation final result",
    mimeType: "text/markdown",
    text,
  };
}

function childExecutionReplayResource(
  invocationId: string,
  result: OrchestrateResult,
  resultText: string,
): ManagedAgentReplayResource | undefined {
  const toolExecutions = result.toolExecutions ?? [];
  if (
    resultText.trim().length > 0 &&
    toolExecutions.length === 0 &&
    !isFailedDirectChildDisposition(result)
  ) {
    return undefined;
  }
  return {
    uri: managedInvocationUri(invocationId, "child-execution"),
    title: "Managed invocation child execution evidence",
    mimeType: "text/markdown",
    text: clipResourceText(formatChildExecutionEvidence(result, resultText), CHILD_EXECUTION_RESOURCE_LIMIT),
  };
}

function childTimeoutReplayResource(
  invocationId: string,
  summary: string,
  progressEvents: readonly ManagedAgentRuntimeInvocationProgressEvent[],
): ManagedAgentReplayResource {
  return {
    uri: managedInvocationUri(invocationId, "timeout"),
    title: "Managed invocation timeout evidence",
    mimeType: "text/markdown",
    text: clipResourceText(
      formatChildTimeoutEvidence(summary, sanitizeTimeoutProgressEvidence(progressEvents)),
      CHILD_EXECUTION_RESOURCE_LIMIT,
    ),
  };
}

/** Timeout replay is durable evidence, unlike the in-memory progress stream. */
function sanitizeTimeoutProgressEvidence(
  progressEvents: readonly ManagedAgentRuntimeInvocationProgressEvent[],
): readonly ManagedAgentRuntimeInvocationProgressEvent[] {
  return progressEvents.map((event) =>
    event.kind === "provider_transport"
      ? event
      : {
          eventId: event.eventId,
          kind: event.kind,
          recordedAt: event.recordedAt,
          summary: "Tool progress observed before timeout.",
        },
  );
}

function formatChildExecutionEvidence(result: OrchestrateResult, resultText: string): string {
  return [
    "# Direct Child Execution Evidence",
    "",
    resultText.trim().length > 0 ? "## Final Output" : "Final output: <empty>",
    resultText.trim().length > 0 ? clipResourceText(resultText.trim(), TOOL_OUTPUT_LIMIT) : undefined,
    "",
    `Outcome: ${result.outcome}`,
    `Disposition reason: ${result.dispositionReason}`,
    `Input tokens: ${result.inputTokens}`,
    `Output tokens: ${result.outputTokens}`,
    `Cache read tokens: ${result.cacheReadTokens}`,
    `Cache write tokens: ${result.cacheWriteTokens}`,
    `Tool executions: ${result.toolExecutions?.length ?? 0}`,
    "",
    ...formatToolExecutionEvidence(result.toolExecutions ?? []),
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function formatChildTimeoutEvidence(
  summary: string,
  progressEvents: readonly ManagedAgentRuntimeInvocationProgressEvent[],
): string {
  return [
    "# Direct Child Timeout Evidence",
    "",
    summary,
    "",
    `Progress events: ${progressEvents.length}`,
    progressEvents.length === 0 ? "No child runtime progress events were observed before timeout." : undefined,
    "",
    ...progressEvents.flatMap((event, index) =>
      [
        `## Progress ${index + 1}: ${event.kind}`,
        "",
        `Recorded at: ${event.recordedAt}`,
        `Summary: ${event.summary}`,
        event.toolName ? `Tool: ${event.toolName}` : undefined,
        event.success !== undefined ? `Success: ${event.success}` : undefined,
        event.isError !== undefined ? `Error: ${event.isError}` : undefined,
        event.durationMs !== undefined ? `Duration ms: ${event.durationMs}` : undefined,
        event.resultSummary ? `Result summary: ${event.resultSummary}` : undefined,
        event.metadata ? `Metadata: ${clipResourceText(JSON.stringify(event.metadata), TOOL_OUTPUT_LIMIT)}` : undefined,
        "",
      ].filter((line): line is string => line !== undefined),
    ),
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function formatToolExecutionEvidence(toolExecutions: readonly ToolExecutionSummary[]): readonly string[] {
  if (toolExecutions.length === 0) {
    return [];
  }
  return toolExecutions.flatMap((execution, index) =>
    [
      `## Tool ${index + 1}: ${execution.toolName}`,
      "",
      execution.toolCallId ? `Tool call: ${execution.toolCallId}` : undefined,
      `Success: ${execution.success ? "true" : "false"}`,
      `Duration ms: ${execution.durationMs}`,
      execution.input ? `Input: ${clipResourceText(JSON.stringify(execution.input), TOOL_OUTPUT_LIMIT)}` : undefined,
      `Result summary: ${execution.resultSummary}`,
      execution.output ? `Output: ${clipResourceText(execution.output, TOOL_OUTPUT_LIMIT)}` : undefined,
      "",
    ].filter((line): line is string => line !== undefined),
  );
}

function clipResourceText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 14))}... [truncated]`;
}

function formatTimeoutSummary(input: {
  readonly timeoutMs: number;
  readonly childSessionId: string;
  readonly childTurnId: string;
}): string {
  return [
    `Direct provider managed invocation timed out after ${input.timeoutMs}ms.`,
    `Child session: ${input.childSessionId}.`,
    `Child turn: ${input.childTurnId}.`,
    "No completed child handoff was produced before timeout.",
    "Inspect the transcript and timeout diagnostic resources for replayable route, authority, context, and terminal-state evidence.",
  ].join(" ");
}

function formatDirectProviderFailure(
  error: unknown,
  providerRoute: ManagedAgentInvocationRequest["providerRoute"],
): string {
  const route = [
    `provider ${providerRoute.providerId}`,
    providerRoute.model ? `model ${providerRoute.model}` : undefined,
    providerRoute.deliberationIntent ? `deliberation ${providerRoute.deliberationIntent.mode}` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(", ");
  return `Direct provider managed invocation failed for ${route}. ${formatManagedProviderError(error)}`;
}

function isDirectProviderQuotaFailure(error: unknown, failureSummary: string): boolean {
  const errorSignal =
    error instanceof AllCredentialsExhaustedError
      ? {
          code: error.lastOutcome?.type.replaceAll("-", "_"),
          message: error.message,
        }
      : error instanceof Error
        ? error
        : undefined;
  return (
    isManagedAgentProviderQuotaFailure(errorSignal) || isManagedAgentProviderQuotaFailure({ message: failureSummary })
  );
}

function formatManagedProviderError(error: unknown): string {
  if (error instanceof AllCredentialsExhaustedError) {
    const details = [formatCredentialOutcome(error.lastOutcome), formatCredentialCause(error.cause)].filter(
      (detail): detail is string => detail !== undefined,
    );
    return details.length > 0 ? `${error.message}: ${details.join("; ")}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function formatCredentialOutcome(outcome: AllCredentialsExhaustedError["lastOutcome"]): string | undefined {
  if (!outcome) {
    return undefined;
  }
  switch (outcome.type) {
    case "rate-limited":
      return outcome.resetAt
        ? `last outcome rate-limited until ${new Date(outcome.resetAt).toISOString()}`
        : "last outcome rate-limited";
    case "quota-exceeded":
      return "last outcome quota-exceeded";
    case "auth-failed":
      return "last outcome auth-failed";
    case "connection-failed":
      return "last outcome connection-failed";
    case "unknown-error":
      return outcome.message ? `last outcome unknown-error ${outcome.message}` : "last outcome unknown-error";
    case "ok":
      return "last outcome ok";
  }
}

function formatCredentialCause(cause: unknown): string | undefined {
  if (!cause) {
    return undefined;
  }
  if (cause instanceof Error) {
    return `last error ${cause.message}`;
  }
  return `last error ${String(cause)}`;
}

function createManagedInvocationTimeout(
  timeoutMs: number,
  abortController: AbortController,
): { readonly promise: Promise<typeof TIMEOUT>; readonly cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(
      () => {
        abortController.abort();
        resolve(TIMEOUT);
      },
      Math.max(timeoutMs, 0),
    );
  });
  return {
    promise,
    cancel: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}

function requireText(value: string | undefined, message: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(message);
  }
  return value.trim();
}
