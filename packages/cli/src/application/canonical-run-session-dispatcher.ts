import { createHash, randomUUID } from "node:crypto";
import type { ActionEffectEnvelope, Capability, KilnMcpClient, ToolDefinition } from "@kilnai/core";
import {
  assertBoundHostToolSandbox,
  type defineExecutionTargetCatalog,
  normalizeActionEffectEnvelope,
} from "@kilnai/core";
import {
  type AttachedRuntimeBuiltinToolSurface,
  type AttendedTrustedExecutionLeaseApprovalPort,
  AttendedTrustedExecutionLeaseSessionAuthority,
  type AuthorityAdmissionEvidenceStore,
  defineOperatorAuthorityAdmissionFacets,
  fingerprintOperatorTurnIntent,
  hasGovernedGoalTools,
  OperatorAuthorityAdmissionCoordinator,
  type OperatorSessionExecutionTargetCatalogSnapshot,
  prepareOperatorAdoptionTurn,
  type RuntimeAuthorityAdmissionCandidateConfig,
  type RuntimeConfigurationRevisionSnapshot,
  RuntimeSession,
  type RuntimeSessionTurnBudgetAuthority,
  readRuntimeModelRoundAdmission,
  createRuntimeHostToolEnforcement,
  createRuntimeCapabilityAuthorityCandidateProjection,
  requireOperatorAdoptionDecisionPersistence,
} from "@kilnai/runtime";
import { createCanonicalMcpClient } from "../config/mcp-credentials.js";
import { normalizeMcpSelector } from "../wrapper/mcp-selector.js";
import { createPermissionEvaluator } from "../wrapper/permission-evaluator.js";
import { digestKilnPermissionPolicy } from "../config/model-facing-permission-policy.js";
import { assertConfiguredInvocationAdmission } from "../config/builtin-tool-surface-config.js";
import { ProviderSession } from "../wrapper/provider-session.js";
import { isDirectApiProvider, type ProviderId } from "../wrapper/session-registry.js";
import { createOperatorTurnDispatchComposition } from "./operator-turn-dispatch-composition.js";
import type { RunSessionOptions, RunSessionResult, RunSessionRouteCandidate } from "./run-session.js";
import { runSession } from "./run-session.js";

type CanonicalRunSessionPayload = Omit<RunSessionOptions, "routeCandidates">;

export interface CanonicalRunSessionDispatcher {
  readonly dispatch: (payload: CanonicalRunSessionPayload) => Promise<RunSessionResult>;
  readonly close: () => void;
}

export function createCanonicalRunAttendedTrustedExecutionSessionAuthority(input: {
  readonly operatorSessionId: string;
  readonly projectRuntimeId: `krp_${string}`;
  readonly configurationRevision: RuntimeConfigurationRevisionSnapshot;
  readonly approvalPort: AttendedTrustedExecutionLeaseApprovalPort;
}): AttendedTrustedExecutionLeaseSessionAuthority {
  return new AttendedTrustedExecutionLeaseSessionAuthority({
    binding: {
      localPrincipalId: `local-operator-session:${randomUUID()}`,
      operatorSessionId: input.operatorSessionId,
      projectRuntimeId: input.projectRuntimeId,
      compositionRevision: input.configurationRevision.revisionSetId as `sha256:${string}`,
    },
    approvalPort: input.approvalPort,
  });
}

/**
 * Dispatches one direct-provider session through canonical target/account
 * admission and binds the post-fence credential to the provider adapter.
 */
export function createCanonicalRunSessionDispatcher(input: {
  readonly catalog: ReturnType<typeof defineExecutionTargetCatalog>;
  readonly cwd: string;
  readonly authorityStateRoot?: string;
  readonly executionId: string;
  readonly targetId: string;
  readonly accountOverrideId?: string;
  readonly routeEvidence?: Pick<RunSessionRouteCandidate, "deliberationResolution">;
  /** Exact Runtime revision captured by the canonical command boundary. */
  readonly configurationRevision: RuntimeConfigurationRevisionSnapshot;
  /** Durable canonical turn/job evidence; direct runs fail closed without it. */
  readonly authorityAdmissionEvidenceStore: AuthorityAdmissionEvidenceStore;
  /** Canonical Runtime owner for the one pre-fence session budget admission. */
  readonly sessionTurnBudget?: RuntimeSessionTurnBudgetAuthority;
  /** Mandatory atomic catalog/revision source for canonical admission. */
  readonly captureCatalogSnapshot: () =>
    | OperatorSessionExecutionTargetCatalogSnapshot
    | Promise<OperatorSessionExecutionTargetCatalogSnapshot>;
  /** Interactive process-local authority; omitted by non-interactive surfaces. */
  readonly attendedTrustedExecution?: {
    readonly projectRuntimeId: `krp_${string}`;
    readonly approvalPort: AttendedTrustedExecutionLeaseApprovalPort;
  };
}): CanonicalRunSessionDispatcher {
  const canonicalIntent = {
    targetId: input.targetId,
    ...(input.accountOverrideId ? { accountOverrideId: input.accountOverrideId } : {}),
  };
  const canonicalIntentFingerprint = fingerprintOperatorTurnIntent({
    executionId: input.executionId,
    intent: canonicalIntent,
  });
  const composition = createOperatorTurnDispatchComposition<CanonicalRunSessionPayload, RunSessionResult>({
    initialCatalog: input.catalog,
    captureCatalogSnapshot: input.captureCatalogSnapshot,
    cwd: input.authorityStateRoot ?? input.cwd,
    readDispatchOutcome: (result) => (result.runtimeModelRoundOutcome === "unknown" ? "unknown" : "completed"),
  });
  type Prepared = {
    readonly runtimeSession: RuntimeSession;
    readonly builtinToolSurface: AttachedRuntimeBuiltinToolSurface;
    readonly mcpClients: readonly KilnMcpClient[];
    readonly mcpCapabilities: readonly Capability[];
    readonly perCallConfig: RuntimeAuthorityAdmissionCandidateConfig;
    readonly attendedTrustedExecutionSessionAuthority?: AttendedTrustedExecutionLeaseSessionAuthority;
  };
  const authorityCoordinator = new OperatorAuthorityAdmissionCoordinator<CanonicalRunSessionPayload, Prepared>({
    resolveSession: async (request) => {
      const payload = request.payload;
      const sessionId = payload.sessionId ?? input.executionId;
      const session = new RuntimeSession({
        appName: "kiln-cli",
        tenantId: "cli-session",
        userId: sessionId,
        sessionId,
        systemPrompt: payload.sessionConfig.systemPrompt ?? "",
      });
      const replay = payload.operatorAdoption?.replayCanonicalSessionEvents;
      if (replay) {
        const events = await replay(sessionId);
        for (const event of events
          .filter((entry) => entry.kilnSessionId === sessionId)
          .sort((left, right) => left.sequence - right.sequence)) {
          session.appendSessionEvents([event]);
        }
      }
      return { session, allowAuthorityFacetCreation: true };
    },
    prepare: async ({ request, session, admission, snapshot, binding }) => {
      const payload = request.payload;
      const provider = admission.providerId as ProviderId;
      if (!isDirectApiProvider(provider))
        throw new Error(`Canonical direct run resolved unsupported provider '${admission.providerId}'.`);
      const mcpClients = (payload.sessionConfig.canonicalMcpServers ?? []).map((server) =>
        createCanonicalMcpClient(server, payload.sessionConfig.kilnHome),
      );
      const discoveredMcpCapabilities = (
        await Promise.all(mcpClients.map((client) => client.discoverProviderCapabilities()))
      ).flat();
      const permissionEvaluator = createPermissionEvaluator(payload.permissionPolicy, {
        agent: payload.permissionAgent,
      });
      const scopedMcpToolAllowlist =
        permissionEvaluator.scope.matchedScope && permissionEvaluator.scope.mcpTools
          ? new Set(permissionEvaluator.scope.mcpTools.map(normalizeMcpSelector))
          : undefined;
      const mcpPartition = intersectCanonicalMcpCapabilities(
        discoveredMcpCapabilities,
        payload.sessionConfig.mcpToolAllowlist,
        scopedMcpToolAllowlist,
      );
      if (mcpPartition.explicitlyDenied.length > 0) {
        const denied = mcpPartition.explicitlyDenied[0]!;
        throw new Error(
          `Canonical direct run denied an explicitly requested MCP ${denied.kind} '${denied.name}' because its effect envelope is unknown or not admitted.`,
        );
      }
      const mcpCapabilities = mcpPartition.admitted;
      const externalTools: ToolDefinition[] = mcpCapabilities.map((capability) => ({
        name: capability.name,
        description: capability.description,
        inputSchema: capability.schema,
        tags: new Set(capability.tags),
        ...(capability.effectEnvelope ? { effectEnvelope: capability.effectEnvelope } : {}),
      }));
      const externalCapabilities = new Map(mcpCapabilities.map((capability) => [capability.name, capability] as const));
      const admittedMcpToolNames = new Set(mcpCapabilities.map((capability) => capability.name));
      const operatorAdoption = payload.operatorAdoption;
      if (!operatorAdoption) throw new Error("Canonical direct runs require a durable operator adoption binding.");
      const adoption = await prepareOperatorAdoptionTurn({
        session,
        actorId: operatorAdoption.actorId ?? session.id,
        correlationId: request.executionId,
        persist: requireOperatorAdoptionDecisionPersistence(operatorAdoption.persist),
      });
      const attendedTrustedExecutionSessionAuthority =
        input.attendedTrustedExecution === undefined
          ? undefined
          : createCanonicalRunAttendedTrustedExecutionSessionAuthority({
              operatorSessionId: session.id,
              projectRuntimeId: input.attendedTrustedExecution.projectRuntimeId,
              configurationRevision: snapshot.configurationRevision,
              approvalPort: input.attendedTrustedExecution.approvalPort,
            });
      const builder = new ProviderSession({
        ...payload.sessionConfig,
        provider,
        model: admission.providerModelId,
        runtimeSessionId: session.id,
        mcpClients,
        mcpToolAllowlist: admittedMcpToolNames,
        capabilityComposition: {
          appId: `cli-direct:${provider}`,
          surfaceId: "cli-direct",
        },
      });
      const capabilityGeneration = builder.authorityCapabilityGeneration;
      const capabilityCandidateProjection = capabilityGeneration === undefined
        ? undefined
        : createRuntimeCapabilityAuthorityCandidateProjection(capabilityGeneration);
      const hostToolSandbox = payload.toolSandbox === undefined
        ? undefined
        : assertBoundHostToolSandbox(payload.toolSandbox);
      if (hostToolSandbox
        && hostToolSandbox.admission.permissionPolicyDigest !== digestKilnPermissionPolicy(payload.permissionPolicy)) {
        throw new Error("Canonical host sandbox does not bind the exact effective permission policy.");
      }
      let perCallConfig = {
        ...builder.buildAuthorityPerCallConfig({
          deliberationResolution: payload.sessionConfig.deliberationResolution,
          communicationIntent: payload.sessionConfig.communicationIntent,
          requestedAuthority: payload.sessionConfig.requestedAuthority,
          abortSignal: payload.abortSignal,
          turnId: adoption.turnId,
          workingDirectory: payload.sessionConfig.cwd,
          ...(hostToolSandbox ? { toolSandbox: hostToolSandbox } : {}),
          externalTools,
          externalCapabilities,
        }),
        ...(attendedTrustedExecutionSessionAuthority === undefined ? {} : { attendedTrustedExecutionSessionAuthority }),
        executionBinding: binding,
        runtimeConfigurationRevision: snapshot.configurationRevision,
        turnId: adoption.turnId,
        turnCorrelationId: adoption.correlationId,
        operatorAdoptionDecision: adoption.operatorAdoptionDecision,
        ...(hostToolSandbox ? { hostToolSandboxAdmission: hostToolSandbox.admission } : {}),
      } satisfies RuntimeAuthorityAdmissionCandidateConfig;
      if (capabilityGeneration !== undefined) {
        const toolAllowlist = new Set(perCallConfig.toolAllowlist ?? []);
        const toolAuthority = new Map(perCallConfig.toolAuthority ?? []);
        const perCallCapabilities = new Map(perCallConfig.perCallCapabilities ?? []);
        const discoveryEffect: ActionEffectEnvelope = {
          operation: "observe", boundaries: [], reversibility: "reversible", dataEgress: "none",
          identityUse: "none", consequences: [], idempotency: "idempotent",
        };
        for (const toolName of capabilityCandidateProjection!.discoveryToolNames) {
          toolAllowlist.add(toolName);
          toolAuthority.set(toolName, { level: 1, allowed: true, requiresApproval: false, reason: "Runtime capability discovery" });
          perCallCapabilities.set(toolName, {
            name: toolName, description: "Runtime capability discovery", schema: {},
            tags: ["read-only"], effectEnvelope: discoveryEffect,
          });
        }
        for (const candidate of capabilityGeneration.authorityCandidates) {
          if (candidate.toolName === undefined || candidate.materializationStatus !== "materializable") continue;
          toolAllowlist.add(candidate.toolName);
          toolAuthority.set(candidate.toolName, candidate.candidateAuthority);
          perCallCapabilities.set(candidate.toolName, {
            name: candidate.toolName,
            description: `Deferred capability ${candidate.capabilityId}`,
            schema: {},
            tags: ["deferred-capability"],
            effectEnvelope: candidate.effect,
          });
        }
        perCallConfig = {
          ...perCallConfig,
          toolAllowlist,
          toolAuthority,
          perCallCapabilities,
          effectiveTurnAuthority: perCallConfig.effectiveTurnAuthority === undefined
            ? undefined
            : {
                ...perCallConfig.effectiveTurnAuthority,
                toolCount: toolAllowlist.size,
                deniedToolCount: 0,
              },
        };
      }
      const candidateToolNames = [...new Set([
        ...builder.capabilities.supportedTools,
        ...discoveredMcpCapabilities.map((capability) => capability.name),
        ...(capabilityCandidateProjection?.discoveryToolNames ?? []),
        ...(capabilityGeneration?.authorityCandidates.flatMap((candidate) => candidate.toolName ?? []) ?? []),
      ])];
      const projectedAuthority = perCallConfig.effectiveTurnAuthority;
      const authority =
        projectedAuthority && isCanonicalAuthorityAdmissible(projectedAuthority)
          ? projectedAuthority
          : canonicalizeOmittedAuthority({
              requestedAuthority: payload.sessionConfig.requestedAuthority,
              admittedToolCount: perCallConfig.toolAuthority?.size ?? 0,
              candidateToolCount: candidateToolNames.length,
            });
      if (authority && authority !== projectedAuthority) {
        perCallConfig = {
          ...perCallConfig,
          toolAllowlist: new Set(),
          toolAuthority: new Map(),
          additionalTools: [],
          perCallCapabilities: new Map(),
          effectiveTurnAuthority: authority,
        };
      }
      if (!authority || !isCanonicalAuthorityAdmissible(authority)) {
        throw new Error(
          "Canonical direct run requires a complete non-partial authority decision; auto/unknown authority is denied.",
        );
      }
      const workGovernance = hasGovernedGoalTools({
        toolAllowlist: perCallConfig.toolAllowlist,
        additionalTools: perCallConfig.additionalTools,
      })
        ? {
            status: "required" as const,
            kind: "goal" as const,
            subjectId: adoption.operatorAdoptionDecision.decisionId,
            authorityRevision: adoption.operatorAdoptionDecision.decisionId,
          }
        : { status: "not-required" as const };
      const facets = defineOperatorAuthorityAdmissionFacets({
        executionId: request.executionId,
        turnId: adoption.turnId,
        session,
        snapshot,
        perCallConfig,
        candidateToolNames,
        skillCatalog: defineCanonicalSkillCatalogAdmission([]),
        authorityCeiling: {
          maximumAuthority: canonicalAuthorityCeiling(authority.admittedAuthority),
          reason: authority.reason,
        },
        workGovernance,
        operatorAdoption: { status: "admitted", decision: adoption.operatorAdoptionDecision },
        capabilityParticipation: { status: "not-requested" },
      });
      return {
        facets,
        ...(capabilityCandidateProjection === undefined ? {} : { capabilityCandidateProjection }),
        prepared: {
          runtimeSession: session,
          builtinToolSurface: builder.authorityBuiltinToolSurface,
          mcpClients,
          mcpCapabilities,
          perCallConfig,
          ...(capabilityGeneration === undefined ? {} : { capabilityGeneration }),
          ...(attendedTrustedExecutionSessionAuthority === undefined
            ? {}
            : { attendedTrustedExecutionSessionAuthority }),
        },
      };
    },
    saveSession: () => undefined,
    evidenceStore: input.authorityAdmissionEvidenceStore,
    sessionTurnBudget: input.sessionTurnBudget,
    discardPrepared: disposePrepared,
  });
  composition.authorityAdmissionBridge.bind(authorityCoordinator);
  composition.bridge.bind(async ({ executionId, admission, binding, credential, authorityAdmission, payload }) => {
    const provider = admission.providerId as ProviderId;
    if (!isDirectApiProvider(provider)) {
      throw new Error(`Execution target '${admission.targetId}' resolved to an unsupported direct provider.`);
    }
    const prepared = authorityCoordinator.consume(executionId, authorityAdmission);
    try {
      const readAdmission = input.authorityAdmissionEvidenceStore.readAdmission;
      if (!readAdmission)
        throw new Error("Canonical direct run has no durable admission readback for model-round claiming.");
      const persistedRuntimeAdmission = await readRuntimeModelRoundAdmission({
        readAdmission: (request) => readAdmission.call(input.authorityAdmissionEvidenceStore, request),
        admissionId: authorityAdmission.admissionId,
        sessionId: authorityAdmission.sessionId,
        turnId: authorityAdmission.turnId,
        expected: {
          routeId: binding.routeId,
          accountId: binding.accountId,
          credentialRevision: binding.credentialRevision,
        },
      });
      const runtimeModelRoundDispatch = {
        admission: persistedRuntimeAdmission,
        intentFingerprint: canonicalIntentFingerprint,
        attemptId: executionId,
        routeId: binding.routeId,
        accountId: binding.accountId,
        credentialRevision: binding.credentialRevision,
        state: { claimed: false },
        readAdmission: () =>
          readRuntimeModelRoundAdmission({
            readAdmission: (request) => readAdmission.call(input.authorityAdmissionEvidenceStore, request),
            admissionId: authorityAdmission.admissionId,
            sessionId: authorityAdmission.sessionId,
            turnId: authorityAdmission.turnId,
            expected: {
              routeId: binding.routeId,
              accountId: binding.accountId,
              credentialRevision: binding.credentialRevision,
            },
          }),
        store: composition.modelRoundActionClaims,
      } satisfies NonNullable<import("@kilnai/runtime").PerCallToolConfig["runtimeModelRoundDispatch"]>;
      const runtimeToolActionClaims = {
        admission: persistedRuntimeAdmission,
        attemptId: executionId,
        adapterIdentity: `operator:${binding.routeId}:${binding.accountId}:${binding.credentialRevision}`,
        state: { claimed: false },
        readAdmission: (request: {
          readonly admissionId: string;
          readonly sessionId: string;
          readonly turnId: string;
        }) =>
          readRuntimeModelRoundAdmission({
            readAdmission: (readRequest) => readAdmission.call(input.authorityAdmissionEvidenceStore, readRequest),
            admissionId: request.admissionId,
            sessionId: request.sessionId,
            turnId: request.turnId,
            expected: {
              routeId: binding.routeId,
              accountId: binding.accountId,
              credentialRevision: binding.credentialRevision,
            },
          }),
        store: composition.toolActionClaims,
      } satisfies NonNullable<import("@kilnai/runtime").PerCallToolConfig["runtimeToolActionClaims"]>;
      const {
        turnId: _candidateTurnId,
        operatorAdoptionDecision: _candidateAdoptionDecision,
        executionBinding: _candidateExecutionBinding,
        admittedExecutionTarget: _candidateExecutionTarget,
        effectiveTurnAuthority: _candidateTurnAuthority,
        authorityContext: _candidateAuthorityContext,
        runtimeConfigurationRevision: _candidateConfigurationRevision,
        runtimeSessionConfigurationRevision: _candidateSessionConfigurationRevision,
        toolAllowlist: _candidateToolAllowlist,
        toolAuthority: _candidateToolAuthority,
        ...admittedExecutionConfig
      } = prepared.perCallConfig;
      const runtimeHostToolEnforcement = persistedRuntimeAdmission.turn.tools.hostEnforcement
        ? createRuntimeHostToolEnforcement({
            bundle: persistedRuntimeAdmission,
            sandbox: assertBoundHostToolSandbox(admittedExecutionConfig.sandbox),
            invocationAdmission: assertConfiguredInvocationAdmission(
              admittedExecutionConfig.toolInvocationAdmission,
              payload.permissionPolicy,
            ),
          })
        : undefined;
      const {
        attendedTrustedExecutionSessionAuthority: _attendedTrustedExecutionSessionAuthority,
        ...authorityAdmissionContext
      } = prepared;
      return await runSession({
        ...payload,
        sessionConfig: {
          ...payload.sessionConfig,
          provider,
          model: admission.providerModelId,
          runtimeSessionId: prepared.runtimeSession.id,
          credentialBinding: {
            routeId: binding.routeId,
            accountId: binding.accountId,
            credentialId: binding.credentialId,
            credentialRevision: binding.credentialRevision,
          },
          executionCredential: credential,
          authorityAdmissionContext: {
            ...authorityAdmissionContext,
            bundle: persistedRuntimeAdmission,
            perCallConfig: {
              ...admittedExecutionConfig,
              authorityAdmission: persistedRuntimeAdmission,
              runtimeModelRoundDispatch,
              runtimeToolActionClaims,
              ...(runtimeHostToolEnforcement ? { runtimeHostToolEnforcement } : {}),
            },
          },
        },
        routeCandidates: [
          {
            provider,
            model: admission.providerModelId,
            credentialBinding: {
              routeId: binding.routeId,
              accountId: binding.accountId,
              credentialId: binding.credentialId,
              credentialRevision: binding.credentialRevision,
            },
            executionCredential: credential,
            ...(input.routeEvidence ?? {}),
          },
        ],
      });
    } catch (error) {
      await disposePrepared(prepared);
      throw error;
    } finally {
      prepared.attendedTrustedExecutionSessionAuthority?.closeSession();
    }
  });

  return {
    dispatch: (payload) => {
      return composition.dispatcher
        .dispatchTurn({
          executionId: input.executionId,
          intentFingerprint: canonicalIntentFingerprint,
          intent: canonicalIntent,
          payload,
        })
        .then(({ result }) => result);
    },
    close: () => {
      composition.close();
    },
  };
}

function defineCanonicalSkillCatalogAdmission(skillIdsInput: readonly string[]) {
  const skillIds = [...new Set(skillIdsInput)].sort();
  return Object.freeze({
    catalogId: "runtime-session-skills",
    revision: `sha256:${createHash("sha256").update(JSON.stringify(skillIds), "utf8").digest("hex")}`,
    skillIds: Object.freeze(skillIds),
  });
}

export type CanonicalMcpCapabilityKind = "tool" | "resource" | "prompt";

export type DeniedCanonicalMcpCapability = Capability & { readonly kind: CanonicalMcpCapabilityKind };

export function partitionCanonicalMcpCapabilities(capabilities: readonly Capability[]): {
  readonly admitted: readonly Capability[];
  readonly denied: readonly DeniedCanonicalMcpCapability[];
} {
  return {
    admitted: capabilities.filter((capability) => isKnownCanonicalMcpEffect(capability.effectEnvelope)),
    denied: capabilities
      .filter((capability) => !isKnownCanonicalMcpEffect(capability.effectEnvelope))
      .map((capability) => ({ ...capability, kind: canonicalMcpCapabilityKind(capability) })),
  };
}

export function intersectCanonicalMcpCapabilities(
  capabilities: readonly Capability[],
  explicitAllowlist?: ReadonlySet<string>,
  scopedAllowlist?: ReadonlySet<string>,
): {
  readonly admitted: readonly Capability[];
  readonly denied: readonly DeniedCanonicalMcpCapability[];
  readonly explicitlyDenied: readonly DeniedCanonicalMcpCapability[];
} {
  const partition = partitionCanonicalMcpCapabilities(capabilities);
  const explicit = explicitAllowlist ? new Set([...explicitAllowlist].map(normalizeMcpSelector)) : undefined;
  const scoped = scopedAllowlist ? new Set([...scopedAllowlist].map(normalizeMcpSelector)) : undefined;
  const admitted: Capability[] = [];
  const denied: DeniedCanonicalMcpCapability[] = [...partition.denied];
  const explicitlyDenied: DeniedCanonicalMcpCapability[] = partition.denied.filter(
    (capability) => explicit?.has(normalizeMcpSelector(capability.name)) === true,
  );
  for (const capability of partition.admitted) {
    const normalizedName = normalizeMcpSelector(capability.name);
    if (explicit && !explicit.has(normalizedName)) continue;
    if (scoped && !scoped.has(normalizedName)) {
      denied.push({ ...capability, kind: canonicalMcpCapabilityKind(capability) });
      if (explicit?.has(normalizedName))
        explicitlyDenied.push({ ...capability, kind: canonicalMcpCapabilityKind(capability) });
      continue;
    }
    admitted.push(capability);
  }
  return { admitted, denied, explicitlyDenied };
}

export function canonicalizeOmittedAuthority(
  input: {
    readonly requestedAuthority: string | undefined;
    readonly admittedToolCount: number;
    readonly candidateToolCount: number;
  },
):
  | {
      readonly executionMode: "execute";
      readonly requestedAuthority: "read_only";
      readonly admittedAuthority: "fail_closed";
      readonly sourcePolicy: "runtime_surface_projection";
      readonly reason: string;
      readonly completeness: "authoritative";
      readonly toolCount: 0;
      readonly deniedToolCount: number;
  }
  | undefined {
  if (input.requestedAuthority !== undefined && input.requestedAuthority !== "auto") return undefined;
  if (!Number.isSafeInteger(input.admittedToolCount) || input.admittedToolCount < 0
    || !Number.isSafeInteger(input.candidateToolCount) || input.candidateToolCount < input.admittedToolCount) {
    throw new Error("Canonical direct run authority counts are invalid.");
  }
  if (input.admittedToolCount > 0)
    throw new Error("Canonical direct run requires a concrete authority decision when tools are admitted.");
  return {
    executionMode: "execute",
    requestedAuthority: "read_only",
    admittedAuthority: "fail_closed",
    sourcePolicy: "runtime_surface_projection",
    reason: "No tool was authoritatively admitted by the canonical direct-run boundary.",
    completeness: "authoritative",
    toolCount: 0,
    deniedToolCount: input.candidateToolCount,
  };
}

function canonicalMcpCapabilityKind(capability: Capability): CanonicalMcpCapabilityKind {
  if (capability.tags?.includes("resource")) return "resource";
  if (capability.tags?.includes("prompt")) return "prompt";
  return "tool";
}

function isKnownCanonicalMcpEffect(effect: unknown): effect is ActionEffectEnvelope {
  const normalized = normalizeActionEffectEnvelope(effect);
  if (!normalized) return false;
  return (
    normalized.reversibility !== "unknown" &&
    normalized.dataEgress !== "unknown" &&
    normalized.identityUse !== "unknown" &&
    normalized.idempotency !== "unknown" &&
    !normalized.consequences.includes("unknown")
  );
}

async function disposePrepared(prepared: {
  readonly builtinToolSurface: AttachedRuntimeBuiltinToolSurface;
  readonly mcpClients: readonly KilnMcpClient[];
  readonly attendedTrustedExecutionSessionAuthority?: AttendedTrustedExecutionLeaseSessionAuthority;
}): Promise<void> {
  prepared.attendedTrustedExecutionSessionAuthority?.closeSession();
  const outcomes = await Promise.allSettled([
    prepared.builtinToolSurface.dispose(),
    ...prepared.mcpClients.map((client) => client.disconnect()),
  ]);
  const failure = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
  if (failure) throw failure.reason;
}

export function isCanonicalAuthorityAdmissible(authority: {
  readonly completeness: string;
  readonly admittedAuthority: string;
  readonly toolCount?: number;
}): boolean {
  return (
    authority.completeness === "authoritative" &&
    authority.admittedAuthority !== "unknown" &&
    (authority.admittedAuthority !== "fail_closed" || authority.toolCount === undefined || authority.toolCount === 0)
  );
}

function canonicalAuthorityCeiling(
  authority: "fail_closed" | "read_only" | "idempotent" | "audited" | "destructive" | "unknown",
): "read_only" | "audited" | "destructive" {
  if (authority === "unknown") {
    throw new Error("Unknown canonical authority cannot define a session ceiling.");
  }
  if (authority === "fail_closed" || authority === "read_only" || authority === "idempotent") {
    return "read_only";
  }
  return authority;
}
