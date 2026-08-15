import { posix, resolve, win32 } from "node:path";
import {
  buildManagedAgentOrchestrationResultEvidence,
  admitManagedRoute,
  digestManagedEconomicValue,
  defineManagedAgentInvocationRequest,
  resolveCommunicationIntent,
  type ManagedAgentAdmissionDecision,
  type ManagedAgentAdmissionProfile,
  type ManagedAgentAuthorityProfile,
  type ManagedAgentCallerAttachmentIdentity,
  type ManagedAgentInvocationRecord,
  type ManagedAgentInvocationRequest,
  type ManagedAgentLifecycleState,
  type ManagedAgentOrchestrationChildResult,
  type ManagedAgentOrchestrationRequest,
  type ManagedAgentOrchestrationResultEvidence,
  type ManagedAgentRequestedAuthority,
  type ManagedAgentWorkingDirectory,
  type DeliberationResolution,
  type ResolvedCommunicationIntent,
} from "@kilnai/core";
import {
  collectManagedEconomicCandidates,
  type ManagedEconomicCandidateSet,
  type ManagedInvocationRouteProfile,
  type ManagedInvocationToolOptions,
  type ManagedInvocationToolRoute,
} from "./runtime-tool/index.js";
import { resolveManagedInvocationAgentProfile } from "./agent-profile-catalog.js";
import { deriveManagedInvocationCallerAuthority } from "./caller-capability-policy.js";
import type { ManagedAgentRuntimeInvocationLifecycleOptions } from "./index.js";
import type { ManagedInvocationExecutableRoute } from "./runtime-tool/types.js";
import { resolveManagedInvocationRouteProfile } from "./runtime-tool/profile-resolution.js";

const ORCHESTRATION_CONTEXT_MODE = "isolated";

export interface ManagedAgentOrchestrationLifecycleRouteSelector {
  readonly providerId?: string;
  readonly model?: string;
  readonly routeId?: string;
}

export interface ManagedAgentOrchestrationLifecycleInput {
  readonly orchestrationRequest: ManagedAgentOrchestrationRequest;
  readonly managedInvocation: ManagedInvocationToolOptions;
  readonly profile: ManagedAgentAdmissionProfile;
  readonly routeSelector?: ManagedAgentOrchestrationLifecycleRouteSelector;
  readonly requestedAuthority?: ManagedAgentRequestedAuthority;
  readonly callerIdentity?: ManagedAgentCallerAttachmentIdentity;
  readonly economicAdoptedDecisionAt?: string;
  readonly abortSignal?: AbortSignal;
  readonly lifecycleObserver?: ManagedAgentOrchestrationLifecycleObserver;
}

export interface ManagedAgentOrchestrationLifecycleObserver {
  onAdmissionResolved(input: {
    readonly request: ManagedAgentInvocationRequest;
    readonly decision: ManagedAgentAdmissionDecision;
  }): void | Promise<void>;
  onTerminal(input: {
    readonly request: ManagedAgentInvocationRequest;
    readonly record: ManagedAgentInvocationRecord;
    readonly durationMs?: number;
  }): void | Promise<void>;
}

export interface ManagedAgentOrchestrationLifecycleChildRecord {
  readonly childId: string;
  readonly ordinal: number;
  readonly invocationId: string;
  readonly record?: ManagedAgentInvocationRecord;
  readonly error?: string;
}

export interface ManagedAgentOrchestrationLifecycleResult {
  readonly orchestrationResult: ManagedAgentOrchestrationResultEvidence;
  readonly childRecords: readonly ManagedAgentOrchestrationLifecycleChildRecord[];
}

export class ManagedEconomicCommitmentUnavailableError extends Error {
  readonly code = "economic_commitment_unavailable";

  constructor(readonly candidateSet: ManagedEconomicCandidateSet) {
    super("Managed orchestration requires a durable economic commitment before execution");
    this.name = "ManagedEconomicCommitmentUnavailableError";
  }
}

interface PreparedOrchestrationChild {
  readonly child: ManagedAgentOrchestrationRequest["childRequests"][number];
  readonly agentProfile?: string;
  readonly deliberationIntent?: ManagedAgentInvocationRequest["providerRoute"]["deliberationIntent"];
  readonly deliberationResolution?: DeliberationResolution;
  readonly communicationIntent?: ResolvedCommunicationIntent;
  readonly route: ManagedInvocationToolRoute;
  readonly profile: ManagedInvocationRouteProfile;
  readonly economicCandidateSet?: ManagedEconomicCandidateSet;
}

interface ExecutableOrchestrationChild extends PreparedOrchestrationChild {
  readonly route: ManagedInvocationExecutableRoute;
  readonly request: ManagedAgentInvocationRequest;
  readonly economicDispatch?: NonNullable<ManagedAgentRuntimeInvocationLifecycleOptions["economicDispatch"]>;
  readonly abortSignal?: AbortSignal;
}

export async function runManagedAgentOrchestrationLifecycle(
  input: ManagedAgentOrchestrationLifecycleInput,
): Promise<ManagedAgentOrchestrationLifecycleResult> {
  const service = input.managedInvocation.invocationService;
  if (!service) {
    throw new Error("Managed orchestration lifecycle requires an invocation service");
  }

  const preparedChildren = input.orchestrationRequest.childRequests.map((child): PreparedOrchestrationChild => {
    const agent = resolveManagedInvocationAgentProfile(input.managedInvocation, child.agentProfile);
    if (child.agentProfile && !agent) {
      throw new Error(`Managed orchestration references unknown agent profile '${child.agentProfile}'`);
    }
    if (agent && agent.admissionProfile !== input.profile) {
      throw new Error(`Managed orchestration agent profile '${agent.name}' requires '${agent.admissionProfile}', not '${input.profile}'`);
    }
    const communicationIntent = agent?.providerRoute?.communicationIntent
      ?? (agent?.communication
        ? resolveCommunicationIntent([{ source: "agent-profile", intent: agent.communication }])
        : undefined);
    let economicCandidateSet: ManagedEconomicCandidateSet | undefined;
    if (agent?.economicPolicyId && agent.economicPolicyRevision) {
      economicCandidateSet = collectManagedEconomicCandidates({
          economicPolicyId: agent.economicPolicyId,
          economicPolicyRevision: agent.economicPolicyRevision,
          configuredAgentProfileId: agent.name,
          authorityProfileId: agent.authorityProfileId,
          admissionProfileId: input.profile,
          ...(input.callerIdentity ? { callerIdentity: input.callerIdentity } : {}),
          ...(child.routeId ?? input.routeSelector?.routeId
            ? { routeId: child.routeId ?? input.routeSelector?.routeId }
            : {}),
          ...(input.routeSelector?.providerId || agent?.providerRoute?.providerId
            ? {
                providerRoute: {
                  providerId: input.routeSelector?.providerId ?? agent?.providerRoute?.providerId ?? "",
                  surface: "configured",
                  ...(input.routeSelector?.model ?? agent?.providerRoute?.model
                    ? { model: input.routeSelector?.model ?? agent?.providerRoute?.model }
                    : {}),
                  ...(agent?.providerRoute?.deliberationIntent
                    ? { deliberationIntent: agent.providerRoute.deliberationIntent }
                    : {}),
                  ...(communicationIntent ? { communicationIntent } : {}),
                },
              }
            : {}),
        }, input.managedInvocation.routes, input.managedInvocation.unavailableRoutes);
      if (economicCandidateSet.candidates.length === 0) {
        throw new ManagedEconomicCommitmentUnavailableError(economicCandidateSet);
      }
      if (!input.managedInvocation.economicDispatch) {
        throw new ManagedEconomicCommitmentUnavailableError(economicCandidateSet);
      }
    }
    if (child.routeId && agent?.routeId && child.routeId !== agent.routeId) {
      throw new Error(`Managed orchestration child route '${child.routeId}' contradicts agent profile '${agent.name}' route '${agent.routeId}'`);
    }
    const routeId = child.routeId ?? agent?.routeId;
    const route = selectOrchestrationRoute(
      input.managedInvocation,
      input.profile,
      input.orchestrationRequest.isolation.workingDirectoryMode,
      routeId ? { routeId } : input.routeSelector,
      economicCandidateSet !== undefined,
      agent,
    );
    assertOrchestrationAgentRoute(agent, route);
    return {
      child,
      ...(agent ? { agentProfile: agent.name } : {}),
      ...(agent?.providerRoute?.deliberationIntent
        ? { deliberationIntent: agent.providerRoute.deliberationIntent }
        : {}),
      ...(communicationIntent ? { communicationIntent } : {}),
      route,
      ...(economicCandidateSet ? { economicCandidateSet } : {}),
      profile: requireOrchestrationProfile(
        route,
        input.profile,
        input.orchestrationRequest.isolation.workingDirectoryMode,
        agent,
      ),
    };
  });
  assertIndependentReviewRouteDiversity(input.orchestrationRequest, preparedChildren);
  const recordsByKey = new Map<string, ManagedAgentOrchestrationLifecycleChildRecord>();
  const pending = new Map(preparedChildren.map((entry) => [entry.child.key, entry]));
  while (pending.size > 0) {
    const ready = [...pending.values()].filter((entry) =>
      entry.child.dependsOn.every((dependencyKey) => recordsByKey.has(dependencyKey))
    );
    if (ready.length === 0) {
      throw new Error("Managed orchestration dependency graph cannot make progress");
    }
    for (let offset = 0; offset < ready.length; offset += input.orchestrationRequest.maxConcurrentChildren) {
      const wave = ready.slice(offset, offset + input.orchestrationRequest.maxConcurrentChildren);
      const executable: ExecutableOrchestrationChild[] = [];
      try {
        for (const entry of wave) {
          const failedDependencies = entry.child.dependsOn.filter((key) =>
            !isSuccessfulLifecycleState(recordsByKey.get(key)?.record?.lifecycleState)
          );
          if (failedDependencies.length > 0) {
            recordsByKey.set(entry.child.key, {
              childId: entry.child.childId,
              ordinal: entry.child.ordinal,
              invocationId: sanitizeInvocationId(entry.child.childId),
              error: `Blocked by failed dependencies: ${failedDependencies.join(", ")}`,
            });
            continue;
          }
          const dependencyRecords = entry.child.dependsOn
            .map((key) => recordsByKey.get(key)?.record)
            .filter((record): record is ManagedAgentInvocationRecord => record !== undefined);
          const dispatched = await prepareOrchestrationEconomicDispatch(input, entry);
          executable.push({
            ...dispatched,
            request: buildOrchestrationChildInvocationRequest({
              orchestrationRequest: input.orchestrationRequest,
              childId: entry.child.childId,
              ordinal: entry.child.ordinal,
              task: entry.child.task,
              roleIntent: entry.child.roleIntent,
              ...(entry.agentProfile ? { agentProfile: entry.agentProfile } : {}),
              ...(entry.deliberationIntent ? { deliberationIntent: entry.deliberationIntent } : {}),
              ...(entry.communicationIntent ? { communicationIntent: entry.communicationIntent } : {}),
              ...(dispatched.deliberationResolution
                ? { deliberationResolution: dispatched.deliberationResolution }
                : {}),
              dependencyRecords,
              route: dispatched.route,
              profile: dispatched.profile,
              requestedBy: input.managedInvocation.requestedBy ?? input.orchestrationRequest.requestedBy,
              requestSource: input.managedInvocation.requestSource ?? input.orchestrationRequest.requestSource,
              requestedAuthority: input.requestedAuthority ?? (input.callerIdentity ? "audited" : "read_only"),
              admissionProfile: input.profile,
            }),
          });
        }
      } catch (error) {
        const releaseErrors: unknown[] = [];
        for (const prepared of executable) {
          try {
            await prepared.economicDispatch?.recordExecutionSettlementPending(
              "orchestration-wave-preparation-failed",
            );
          } catch (releaseError) {
            releaseErrors.push(releaseError);
          }
        }
        if (releaseErrors.length > 0) {
          throw new AggregateError([error, ...releaseErrors], "Managed orchestration post-fence pending recording failed.");
        }
        throw error;
      }
      const completed = await runOrchestrationBatch({
        service,
        entries: executable,
        ...(input.managedInvocation.invocationOwner
          ? { invocationOwner: input.managedInvocation.invocationOwner }
          : {}),
        ...(input.lifecycleObserver ? { lifecycleObserver: input.lifecycleObserver } : {}),
      });
      for (const record of completed) {
        const key = executable.find((entry) => entry.child.childId === record.childId)!.child.key;
        recordsByKey.set(key, record);
      }
    }
    for (const entry of ready) pending.delete(entry.child.key);
  }
  const childRecords = input.orchestrationRequest.childRequests.map((child) => recordsByKey.get(child.key)!);

  const orchestrationResult = buildManagedAgentOrchestrationResultEvidence(
    input.orchestrationRequest,
    childRecords.map((child): ManagedAgentOrchestrationChildResult => ({
      childId: child.childId,
      ordinal: child.ordinal,
      lifecycleState: child.record?.lifecycleState ?? "failed",
      success: isSuccessfulLifecycleState(child.record?.lifecycleState),
      ...(child.error !== undefined ? { error: child.error } : {}),
      resourceUris: child.record?.resultHandoff?.resourceUris
        ?? child.record?.resourceLease?.resourceUris
        ?? child.record?.capabilitySnapshot.resourceLease.resourceUris
        ?? [],
      diagnosticUris: child.record?.resourceLease?.diagnosticUris
        ?? child.record?.capabilitySnapshot.resourceLease.diagnosticUris
        ?? [],
      ...(child.record ? {
        invocationId: child.record.invocationId,
        routeId: child.record.capabilitySnapshot.routeId,
        providerId: child.record.providerRoute.providerId,
        ...(child.record.providerRoute.model ? { model: child.record.providerRoute.model } : {}),
        authorityProfileId: child.record.authority.authorityProfileId,
        contextMode: child.record.capabilitySnapshot.contextMode,
        ...(child.record.coordinationUsage ? { coordinationUsage: child.record.coordinationUsage } : {}),
        replayEvidenceUris: child.record.replayResources?.map((resource) => resource.uri) ?? [],
      } : {}),
    })),
  );

  return {
    orchestrationResult,
    childRecords,
  };
}

async function prepareOrchestrationEconomicDispatch(
  input: ManagedAgentOrchestrationLifecycleInput,
  entry: PreparedOrchestrationChild,
): Promise<PreparedOrchestrationChild & {
  readonly route: ManagedInvocationExecutableRoute;
  readonly economicDispatch?: NonNullable<ManagedAgentRuntimeInvocationLifecycleOptions["economicDispatch"]>;
  readonly abortSignal?: AbortSignal;
}> {
  admitOrchestrationRoute(input, entry);
  if (!entry.economicCandidateSet) {
    const adapter = await entry.route.createAdapter?.();
    if (!adapter) throw new Error("managed_orchestration_adapter_unavailable");
    if (!orchestrationAdapterMatchesRouteCapability(adapter, entry.route)) {
      throw new Error("managed_orchestration_route_capability_adapter_mismatch");
    }
    return { ...entry, route: { ...entry.route, adapter } };
  }
  if (entry.economicCandidateSet.candidates.length === 0) {
    throw new ManagedEconomicCommitmentUnavailableError(entry.economicCandidateSet);
  }
  const economicDispatch = input.managedInvocation.economicDispatch;
  if (!economicDispatch || !input.economicAdoptedDecisionAt) {
    throw new ManagedEconomicCommitmentUnavailableError(entry.economicCandidateSet);
  }
  const economicIdentity = digestManagedEconomicValue({
    parentSessionId: input.orchestrationRequest.parentSessionId,
    parentTurnId: input.orchestrationRequest.parentTurnId,
    authorityProfileId: entry.profile.authorityProfileId,
    invocationId: sanitizeInvocationId(entry.child.childId),
    childId: entry.child.childId,
    task: entry.child.task,
    roleIntent: entry.child.roleIntent,
    agentProfile: entry.agentProfile,
    deliberationIntent: entry.deliberationIntent ?? null,
    admissionProfileId: input.profile,
    candidateSet: entry.economicCandidateSet,
  }).slice("sha256:".length);
  const preparation = await economicDispatch.prepare({
    candidateSet: entry.economicCandidateSet,
    jobId: `managed-economic-job:${economicIdentity}`,
    economicAttemptId: `economic-attempt:${economicIdentity}`,
    intentFingerprint: digestManagedEconomicValue({ candidateSet: entry.economicCandidateSet, economicIdentity }),
    adoptedDecisionAt: input.economicAdoptedDecisionAt,
    parentSessionId: input.orchestrationRequest.parentSessionId,
    parentTurnId: input.orchestrationRequest.parentTurnId,
    authorityProfileId: entry.profile.authorityProfileId,
    invocationId: sanitizeInvocationId(entry.child.childId),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
  });
  if (preparation.status === "already-dispatched") {
    throw new Error(`Managed orchestration economic child '${entry.child.childId}' is already dispatch-fenced; replay will not dispatch it again.`);
  }
  if (preparation.status === "denied") {
    throw new ManagedEconomicCommitmentUnavailableError(entry.economicCandidateSet);
  }
  const selected = preparation.commitment.reservation.selectedIdentity.route;
  const selectedCandidate = entry.economicCandidateSet.candidates.find((candidate) =>
    candidate.routeId === selected.routeId
    && candidate.providerId === selected.providerId
    && candidate.model === selected.modelId);
  if (!selectedCandidate
    || selected.routeId !== entry.route.routeId
    || selected.providerId !== entry.route.providerId
    || selected.modelId !== entry.route.model) {
    await preparation.recordExecutionSettlementPending("committed-route-mismatch");
    throw new Error(`Managed orchestration economic commitment does not match selected route '${entry.route.routeId}'.`);
  }
  if (!orchestrationAdapterMatchesRouteCapability(preparation.adapter, entry.route)) {
    await preparation.recordExecutionSettlementPending("committed-route-adapter-mismatch");
    throw new Error("managed_orchestration_route_capability_adapter_mismatch");
  }
  return {
    ...entry,
    ...(selectedCandidate.deliberationResolution
      ? { deliberationResolution: selectedCandidate.deliberationResolution }
      : {}),
    route: { ...entry.route, adapter: preparation.adapter },
    abortSignal: preparation.abortSignal,
    economicDispatch: {
      commitment: preparation.commitment,
      dispatchFenceId: preparation.dispatchFenceId,
      recordExecutionSettlementPending: preparation.recordExecutionSettlementPending,
      createExecutionSettlement: preparation.createExecutionSettlement,
      registerEconomicSettlement: preparation.registerEconomicSettlement,
    },
  };
}

function admitOrchestrationRoute(
  input: ManagedAgentOrchestrationLifecycleInput,
  entry: PreparedOrchestrationChild,
): void {
  const route = entry.route;
  if (!route.capability || !route.capability.identity || !route.capability.target || !route.capability.adapter) {
    throw new Error("managed_orchestration_route_capability_missing");
  }
  if (route.capability.identity.routeId !== route.routeId
    || route.capability.target.providerId !== route.providerId
    || route.capability.target.modelId !== route.model) {
    throw new Error("managed_orchestration_route_capability_identity_mismatch");
  }
  if (route.capability.capacity.kind === "policy-bound" && !entry.economicCandidateSet) {
    throw new Error("managed_orchestration_policy_bound_capacity_requires_economic_commitment");
  }
  const requestedAuthority = input.requestedAuthority === undefined || input.requestedAuthority === "auto"
    ? input.callerIdentity ? "audited" : "read_only"
    : input.requestedAuthority;
  const decision = admitManagedRoute({
    route: route.capability,
    work: {
      evaluatedAt: new Date().toISOString(),
      profile: input.profile,
      requestedAuthority,
      requiredToolNames: entry.profile.allowedToolNames,
      requiresRecursion: false,
      requiresAttachments: route.externalRuntimeAttachment !== undefined,
      requiresWrite: entry.profile.writeAllowed === true,
      ...(route.externalRuntimeAttachment ? { requestedExternalRuntimeAttachment: route.externalRuntimeAttachment } : {}),
      minimumProof: "configured",
    },
    caller: deriveManagedInvocationCallerAuthority({
      ...(input.callerIdentity ? { callerIdentity: input.callerIdentity } : {}),
      routeAllowedToolNames: entry.profile.allowedToolNames,
    }),
  });
  if (decision.status !== "admitted") {
    throw new Error(`managed_orchestration_route_admission_denied:${decision.reasons.map((reason) => reason.code).join(",")}`);
  }
}

function orchestrationAdapterMatchesRouteCapability(
  adapter: ManagedInvocationExecutableRoute["adapter"],
  route: ManagedInvocationToolRoute,
): boolean {
  const modes = adapter.descriptor.supportedExecutionModes;
  if (modes.length !== 1 || adapter.descriptor.providerId !== route.providerId) return false;
  const [mode] = modes;
  const capabilityKind = adapter.descriptor.adapterKind === "direct"
    ? mode === "direct-provider" ? "direct-provider" : undefined
    : adapter.descriptor.adapterKind === "harness"
      ? mode === "local-harness" ? "native-harness"
        : mode === "cli-harness" ? "cli-harness"
          : mode === "remote-harness" ? "governed-external-runtime" : undefined
      : undefined;
  return capabilityKind === route.capability.adapter.kind;
}

async function runOrchestrationBatch(input: {
  readonly service: NonNullable<ManagedInvocationToolOptions["invocationService"]>;
  readonly entries: readonly ExecutableOrchestrationChild[];
  readonly invocationOwner?: object;
  readonly lifecycleObserver?: ManagedAgentOrchestrationLifecycleObserver;
}): Promise<readonly ManagedAgentOrchestrationLifecycleChildRecord[]> {
  const startResults = await Promise.allSettled(input.entries.map(async ({ request, route, economicDispatch, abortSignal }) => {
    const { adapter } = route;
    const startResult = await input.service.start(request, adapter, {
      routeId: route.routeId,
      routeSource: route.routeSource,
      // Roadmap 01 Slice 3.1 (F3) - managed_agent.orchestrate has no input
      // surface to express a requested attachment yet; surfacing the route's
      // declared attachment here still routes every orchestrated child
      // through the single core admission gate (evaluateManagedAgentAdmission),
      // so a route attached to a specific external-runtime instance fails
      // closed instead of silently dispatching unattached.
      ...(route.externalRuntimeAttachment ? { externalRuntimeAttachment: route.externalRuntimeAttachment } : {}),
      routeHealth: {
        status: "healthy",
        reason: `Configured managed orchestration route selected by runtime lifecycle; routeSource=${route.routeSource}.`,
      },
      providerModelProof: {
        status: "live-proven",
        source: "managed-orchestration-lifecycle-route",
        requiresToolCalls: adapter.descriptor.adapterKind === "direct",
      },
      resourcePlane: {
        available: true,
        resourceUris: [],
        reason: "Managed orchestration child uses isolated worktree context.",
      },
      childIdentity: {
        agentId: request.agentId,
        displayName: route.routeId,
        ...(route.voiceProfile ? { voiceProfile: route.voiceProfile } : {}),
      },
    }, input.invocationOwner || economicDispatch || abortSignal ? {
      ...(input.invocationOwner ? { owner: input.invocationOwner } : {}),
      ...(economicDispatch ? { economicDispatch } : {}),
      ...(abortSignal ? { abortSignal } : {}),
    } : undefined);
    await input.lifecycleObserver?.onAdmissionResolved({ request, decision: startResult.decision });
    if (startResult.status === "denied") {
      throw new Error(`Managed orchestration child '${request.invocationId}' denied: ${startResult.decision.reason}`);
    }
    const status = input.service.status(startResult.snapshot.invocationId);
    if (!status || status.lifecycleState !== "running") {
      throw new Error(`Managed orchestration child '${request.invocationId}' did not publish running lifecycle status`);
    }
    return startResult.snapshot.invocationId;
  }));
  const startFailures = startResults.filter((result) => result.status === "rejected");
  if (startFailures.length > 0) {
    await cleanupStartedOrchestrationChildren(
      input.service,
      input.entries.map((entry) => entry.request),
      startResults,
      "Managed orchestration start failed; cancelling already-started children.",
      input.lifecycleObserver,
    );
    throw new Error(`Managed orchestration child start failed: ${startFailures.map((result) =>
      result.reason instanceof Error ? result.reason.message : String(result.reason)
    ).join("; ")}`);
  }
  const invocationIds = startResults.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
  const settled = await Promise.allSettled(invocationIds.map(async (invocationId, index) => {
    const { child, request } = input.entries[index]!;
    let joined: Awaited<ReturnType<typeof input.service.join>>;
    try {
      joined = await input.service.join(invocationId);
    } catch (error) {
      const snapshot = input.service.status(invocationId);
      if (snapshot?.record) {
        await input.lifecycleObserver?.onTerminal({
          request,
          record: snapshot.record,
          ...(snapshot.durationMs !== undefined ? { durationMs: snapshot.durationMs } : {}),
        });
      }
      throw error;
    }
    if (joined.status !== "completed") {
      throw new Error(`Managed orchestration child '${invocationId}' did not reach terminal completion`);
    }
    const snapshot = input.service.status(invocationId);
    await input.lifecycleObserver?.onTerminal({
      request,
      record: joined.record,
      ...(snapshot?.durationMs !== undefined ? { durationMs: snapshot.durationMs } : {}),
    });
    return {
      childId: child.childId,
      ordinal: child.ordinal,
      invocationId,
      record: joined.record,
    } satisfies ManagedAgentOrchestrationLifecycleChildRecord;
  }));
  return settled.map((result, index): ManagedAgentOrchestrationLifecycleChildRecord => {
    const child = input.entries[index]!.child;
    const invocationId = invocationIds[index] ?? child.childId;
    if (result.status === "fulfilled") return result.value;
    const snapshot = input.service.status(invocationId);
    return {
      childId: child.childId,
      ordinal: child.ordinal,
      invocationId,
      ...(snapshot?.record ? { record: snapshot.record } : {}),
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });
}

function assertIndependentReviewRouteDiversity(
  request: ManagedAgentOrchestrationRequest,
  children: readonly PreparedOrchestrationChild[],
): void {
  if (request.mode !== "review-swarm") return;
  const identities = new Set(children.map(({ route }) => `${route.providerId}\u0000${route.model ?? ""}`));
  if (identities.size < 2) {
    throw new Error("Managed independent review requires at least two distinct provider/model identities");
  }
}

function assertOrchestrationAgentRoute(
  agent: NonNullable<ManagedInvocationToolOptions["agentCatalog"]>[number] | undefined,
  route: ManagedInvocationToolRoute,
): void {
  if (!agent) return;
  if (agent.providerRoute?.providerId && agent.providerRoute.providerId !== route.providerId) {
    throw new Error(`Managed orchestration agent profile '${agent.name}' provider does not match route '${route.routeId}'`);
  }
  if (agent.providerRoute?.model && agent.providerRoute.model !== route.model) {
    throw new Error(`Managed orchestration agent profile '${agent.name}' model does not match route '${route.routeId}'`);
  }
}

async function cleanupStartedOrchestrationChildren(
  service: NonNullable<ManagedInvocationToolOptions["invocationService"]>,
  requests: readonly ManagedAgentInvocationRequest[],
  startResults: readonly PromiseSettledResult<string>[],
  reason: string,
  lifecycleObserver?: ManagedAgentOrchestrationLifecycleObserver,
): Promise<void> {
  await Promise.allSettled(requests.map(async (request, index) => {
    const startResult = startResults[index];
    const startedInvocationId = startResult?.status === "fulfilled"
      ? startResult.value
      : request.invocationId;
    const snapshot = service.status(startedInvocationId);
    if (!snapshot) {
      return;
    }
    try {
      if (!isTerminalLifecycleState(snapshot.lifecycleState)) {
        await service.cancel(startedInvocationId, reason);
      }
    } finally {
      const joined = await service.join(startedInvocationId).catch(() => undefined);
      if (joined?.status === "completed") {
        const terminalSnapshot = service.status(startedInvocationId);
        await lifecycleObserver?.onTerminal({
          request,
          record: joined.record,
          ...(terminalSnapshot?.durationMs !== undefined ? { durationMs: terminalSnapshot.durationMs } : {}),
        });
      }
    }
  }));
}

function isSuccessfulLifecycleState(lifecycleState: ManagedAgentLifecycleState | undefined): boolean {
  return lifecycleState === "completed" || lifecycleState === "recovered";
}

function isTerminalLifecycleState(lifecycleState: ManagedAgentLifecycleState): boolean {
  return lifecycleState === "completed"
    || lifecycleState === "failed"
    || lifecycleState === "timed_out"
    || lifecycleState === "cancelled"
    || lifecycleState === "stale"
    || lifecycleState === "recovered";
}

function selectOrchestrationRoute(
  options: ManagedInvocationToolOptions,
  admissionProfile: ManagedAgentAdmissionProfile,
  workingDirectoryMode: ManagedAgentWorkingDirectory["mode"] | undefined,
  selector: ManagedAgentOrchestrationLifecycleRouteSelector | undefined,
  allowEconomicAdapterlessRoute = false,
  agent?: NonNullable<ManagedInvocationToolOptions["agentCatalog"]>[number],
): ManagedInvocationToolRoute {
  const matches = options.routes.filter((route) => {
    if (selector?.providerId && route.providerId !== selector.providerId) return false;
    if (selector?.model && route.model !== selector.model) return false;
    if (selector?.routeId && route.routeId !== selector.routeId) return false;
    const profile = resolveManagedInvocationRouteProfile(route, admissionProfile, agent);
    return profile !== undefined
      && profile.workingDirectory.mode === workingDirectoryMode
      && (workingDirectoryMode !== "isolated-worktree" || profile.workingDirectoryLease !== undefined)
      && (route.createAdapter !== undefined || (allowEconomicAdapterlessRoute && route.economicCapability?.status === "verified"));
  });
  if (matches.length === 1) {
    return matches[0]!;
  }
  if (matches.length > 1) {
    throw new Error(`Managed orchestration route selection is ambiguous. Specify a provider, model, or routeId. Matching routes: ${matches.map((route) => route.routeId).join(", ")}`);
  }
  const selectorSummary = [
    selector?.routeId ? `routeId '${selector.routeId}'` : undefined,
    selector?.providerId ? `provider '${selector.providerId}'` : undefined,
    selector?.model ? `model '${selector.model}'` : undefined,
  ].filter((part): part is string => part !== undefined).join(", ");
  const workingDirectoryRequirement = workingDirectoryMode === "isolated-worktree"
    ? "an isolated-worktree"
    : `a ${workingDirectoryMode ?? "declared"}`;
  throw new Error(`Managed orchestration requires ${workingDirectoryRequirement} ${admissionProfile} route${selectorSummary ? ` matching ${selectorSummary}` : ""}.`);
}

function requireOrchestrationProfile(
  route: ManagedInvocationToolRoute,
  admissionProfile: ManagedAgentAdmissionProfile,
  workingDirectoryMode: ManagedAgentWorkingDirectory["mode"] | undefined,
  agent?: NonNullable<ManagedInvocationToolOptions["agentCatalog"]>[number],
): ManagedInvocationRouteProfile {
  const profile = resolveManagedInvocationRouteProfile(route, admissionProfile, agent);
  if (!profile) {
    throw new Error(`Managed orchestration route '${route.routeId}' does not expose ${admissionProfile}`);
  }
  if (profile.workingDirectory.mode !== workingDirectoryMode) {
    throw new Error(`Managed orchestration route '${route.routeId}' working directory mode does not match the orchestration request`);
  }
  if (workingDirectoryMode === "isolated-worktree" && !profile.workingDirectoryLease) {
    throw new Error(`Managed orchestration route '${route.routeId}' must expose its isolated worktree lease`);
  }
  return profile;
}

function buildOrchestrationChildInvocationRequest(input: {
  readonly orchestrationRequest: ManagedAgentOrchestrationRequest;
  readonly childId: string;
  readonly ordinal: number;
  readonly task: string;
  readonly roleIntent: string;
  readonly agentProfile?: string;
  readonly deliberationIntent?: ManagedAgentInvocationRequest["providerRoute"]["deliberationIntent"];
  readonly deliberationResolution?: DeliberationResolution;
  readonly communicationIntent?: ResolvedCommunicationIntent;
  readonly dependencyRecords: readonly ManagedAgentInvocationRecord[];
  readonly route: ManagedInvocationExecutableRoute;
  readonly profile: ManagedInvocationRouteProfile;
  readonly requestedBy: string;
  readonly requestSource: string;
  readonly requestedAuthority: ManagedAgentRequestedAuthority;
  readonly admissionProfile: ManagedAgentAdmissionProfile;
}): ManagedAgentInvocationRequest {
  const { adapter } = input.route;
  const invocationId = sanitizeInvocationId(input.childId);
  const workingDirectory = resolveOrchestrationWorkingDirectory(input.profile, invocationId);
  const authority: ManagedAgentAuthorityProfile = {
    authorityProfileId: input.profile.authorityProfileId,
    permissionProfile: input.profile.permissionProfile,
    toolAuthority: {
      allowedToolNames: input.profile.allowedToolNames,
      writeAllowed: input.profile.writeAllowed === true,
      networkAllowed: input.profile.networkAllowed === true,
    },
    workingDirectory,
    timeoutMs: input.profile.timeoutMs,
    credentialRoute: normalizeCredentialRoute(input.profile.credentialRoute),
    memoryScope: input.profile.memoryScope,
    ...(input.profile.writeAuthority
      ? { writeAuthority: resolveOrchestrationWriteAuthority(input.profile, workingDirectory) }
      : {}),
  };
  const dependencyHandoffs = input.dependencyRecords.flatMap((record) =>
    record.resultHandoff ? [{ invocationId: record.invocationId, handoff: record.resultHandoff }] : []
  );
  const dependencyResourceUris = [...new Set(dependencyHandoffs.flatMap(({ handoff }) => handoff.resourceUris))];
  const prompt = dependencyHandoffs.length === 0
    ? input.task
    : [
      input.task,
      "",
      "## Dependency handoffs",
      "Use these completed upstream results as governed inputs. Verify them before adoption.",
      ...dependencyHandoffs.flatMap(({ invocationId, handoff }) => [
        `### ${invocationId}`,
        handoff.summary,
        ...(handoff.resourceUris.length > 0 ? [`Resources: ${handoff.resourceUris.join(", ")}`] : []),
      ]),
    ].join("\n");
  return defineManagedAgentInvocationRequest({
    invocationId,
    agentId: `${input.route.routeId}:${input.admissionProfile}`,
    parentSessionId: input.orchestrationRequest.parentSessionId,
    parentTurnId: input.orchestrationRequest.parentTurnId,
    profile: input.admissionProfile,
    requestedBy: input.requestedBy,
    requestSource: input.requestSource,
    executionIntent: {
      attendance: "unattended",
      lifecycle: "background",
    },
    requestedAuthority: input.requestedAuthority,
    providerRoute: {
      providerId: input.route.providerId,
      surface: input.route.surface ?? adapter.descriptor.supportedExecutionModes[0] ?? "cli-harness",
      ...(input.route.model ? { model: input.route.model } : {}),
      ...(input.deliberationIntent ? { deliberationIntent: input.deliberationIntent } : {}),
      ...(input.deliberationResolution ? { deliberationResolution: input.deliberationResolution } : {}),
      ...(input.communicationIntent ? { communicationIntent: input.communicationIntent } : {}),
    },
    adapterKind: adapter.descriptor.adapterKind,
    executionMode: adapter.descriptor.supportedExecutionModes[0] ?? "cli-harness",
    authority,
    input: {
      summary: `${input.roleIntent} ${input.ordinal}: ${input.orchestrationRequest.task}`,
      prompt,
      ...(dependencyResourceUris.length > 0 ? { resourceUris: dependencyResourceUris } : {}),
      context: {
        mode: ORCHESTRATION_CONTEXT_MODE,
        ...(input.agentProfile
          ? { agentProfile: input.agentProfile, admittedAgentProfile: input.agentProfile }
          : {}),
      },
      handoff: {
        roleIntent: input.roleIntent,
        expectedEvidence: input.orchestrationRequest.expectedEvidence.map((evidence) => evidence.kind),
        requiredResultFields: ["summary", "evidence", "verificationResults"],
        doneCriteria: [
          "Return a bounded result handoff for parent comparison.",
          "Do not mutate outside the managed isolated worktree.",
        ],
        residualRiskRequired: true,
      },
    },
  });
}

function resolveOrchestrationWorkingDirectory(
  profile: ManagedInvocationRouteProfile,
  invocationId: string,
): ManagedAgentWorkingDirectory {
  if (!profile.workingDirectoryLease || profile.workingDirectory.mode !== "isolated-worktree") {
    return profile.workingDirectory;
  }
  return {
    path: joinLeasePath(profile.workingDirectoryLease.rootPath, invocationId),
    mode: "isolated-worktree",
  };
}

function resolveOrchestrationWriteAuthority(
  profile: ManagedInvocationRouteProfile,
  workingDirectory: ManagedAgentWorkingDirectory,
): ManagedAgentAuthorityProfile["writeAuthority"] {
  const authority = profile.writeAuthority;
  if (!authority || !profile.workingDirectoryLease || workingDirectory.mode !== "isolated-worktree") {
    return authority;
  }
  return {
    ...authority,
    scope: {
      ...authority.scope,
      workspace: {
        ...authority.scope.workspace,
        allowedPaths: rebaseLeasePaths(
          authority.scope.workspace.allowedPaths,
          profile.workingDirectoryLease.sourcePath,
          workingDirectory.path,
        ),
        deniedPaths: rebaseLeasePaths(
          authority.scope.workspace.deniedPaths,
          profile.workingDirectoryLease.sourcePath,
          workingDirectory.path,
        ),
      },
    },
  };
}

function normalizeCredentialRoute(route: ManagedInvocationRouteProfile["credentialRoute"]): ManagedInvocationRouteProfile["credentialRoute"] {
  if (route.mode === "credentialless") {
    return route;
  }
  return {
    ...route,
    routeId: route.routeId.trim(),
  };
}

function sanitizeInvocationId(id: string): string {
  return id.replace(/[^A-Za-z0-9_.:-]/g, "-");
}

function rebaseLeasePaths(paths: readonly string[], sourceRootPath: string, targetRootPath: string): readonly string[] {
  return paths.map((path) => rebaseLeasePath(path, sourceRootPath, targetRootPath));
}

function rebaseLeasePath(path: string, sourceRootPath: string, targetRootPath: string): string {
  const normalizedPath = normalizeLeasePath(path);
  const normalizedSource = normalizeLeasePath(sourceRootPath);
  const normalizedTarget = normalizeLeasePath(targetRootPath);
  const caseInsensitive = isCaseInsensitivePath(normalizedPath)
    || isCaseInsensitivePath(normalizedSource)
    || isCaseInsensitivePath(normalizedTarget);
  const comparablePath = comparableLeasePath(normalizedPath, caseInsensitive);
  const comparableSource = comparableLeasePath(normalizedSource, caseInsensitive);
  if (comparablePath === comparableSource) {
    return normalizedTarget;
  }
  const prefix = `${comparableSource}/`;
  if (!comparablePath.startsWith(prefix)) {
    return path;
  }
  return `${normalizedTarget}/${normalizedPath.slice(normalizedSource.length + 1)}`;
}

function normalizeLeasePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function comparableLeasePath(path: string, caseInsensitive: boolean): string {
  return caseInsensitive ? path.toLowerCase() : path;
}

function isCaseInsensitivePath(path: string): boolean {
  return /^[A-Za-z]:\//.test(path) || path.startsWith("//");
}

function joinLeasePath(rootPath: string, childId: string): string {
  if (win32.isAbsolute(rootPath) || rootPath.includes("\\")) {
    return win32.join(rootPath, childId);
  }
  if (posix.isAbsolute(rootPath)) {
    return posix.join(rootPath, childId);
  }
  return resolve(rootPath, childId);
}
