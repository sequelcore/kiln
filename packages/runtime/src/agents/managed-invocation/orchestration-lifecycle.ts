import { posix, resolve, win32 } from "node:path";
import {
  buildManagedAgentOrchestrationResultEvidence,
  defineManagedAgentInvocationRequest,
  type BudgetAdmissionPolicy,
  type BudgetAdmissionRouteCandidate,
  type ManagedAgentAdmissionDecision,
  type ManagedAgentAdmissionProfile,
  type ManagedAgentAuthorityProfile,
  type ManagedAgentInvocationRecord,
  type ManagedAgentInvocationRequest,
  type ManagedAgentLifecycleState,
  type ManagedAgentOrchestrationChildResult,
  type ManagedAgentOrchestrationRequest,
  type ManagedAgentOrchestrationResultEvidence,
  type ManagedAgentRequestedAuthority,
  type ManagedAgentWorkingDirectory,
} from "@kilnai/core";
import type {
  ManagedInvocationRouteProfile,
  ManagedInvocationToolOptions,
  ManagedInvocationToolRoute,
} from "./runtime-tool.js";
import {
  RuntimeBudgetAdmissionService,
  type RuntimeBudgetUsageReader,
} from "../../session/runtime-budget-admission.js";
import { resolveManagedInvocationAgentProfile } from "./agent-profile-catalog.js";

const ORCHESTRATION_CONTEXT_MODE = "isolated";

export interface ManagedAgentOrchestrationLifecycleRouteSelector {
  readonly providerId?: string;
  readonly model?: string;
  readonly routeId?: string;
}

export interface ManagedAgentOrchestrationBudgetAdmissionInput {
  readonly policy: BudgetAdmissionPolicy;
  readonly usageReader?: RuntimeBudgetUsageReader;
}

export interface ManagedAgentOrchestrationLifecycleInput {
  readonly orchestrationRequest: ManagedAgentOrchestrationRequest;
  readonly managedInvocation: ManagedInvocationToolOptions;
  readonly profile: ManagedAgentAdmissionProfile;
  readonly routeSelector?: ManagedAgentOrchestrationLifecycleRouteSelector;
  readonly requestedAuthority?: ManagedAgentRequestedAuthority;
  readonly budgetAdmission?: ManagedAgentOrchestrationBudgetAdmissionInput;
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

interface PreparedOrchestrationChild {
  readonly child: ManagedAgentOrchestrationRequest["childRequests"][number];
  readonly agentProfile?: string;
  readonly route: ManagedInvocationToolRoute;
  readonly profile: ManagedInvocationRouteProfile;
}

interface ExecutableOrchestrationChild extends PreparedOrchestrationChild {
  readonly request: ManagedAgentInvocationRequest;
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
    if (agent?.authorityProfile && agent.authorityProfile !== input.profile) {
      throw new Error(`Managed orchestration agent profile '${agent.name}' requires '${agent.authorityProfile}', not '${input.profile}'`);
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
    );
    assertOrchestrationAgentRoute(agent, route);
    return {
      child,
      ...(agent ? { agentProfile: agent.name } : {}),
      route,
      profile: requireOrchestrationProfile(
        route,
        input.profile,
        input.orchestrationRequest.isolation.workingDirectoryMode,
      ),
    };
  });
  assertIndependentReviewRouteDiversity(input.orchestrationRequest, preparedChildren);
  await assertOrchestrationBudgetAdmission({
    orchestrationRequest: input.orchestrationRequest,
    routes: uniqueRoutes(preparedChildren.map((entry) => entry.route)),
    ...(input.budgetAdmission ? { budgetAdmission: input.budgetAdmission } : {}),
  });
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
        executable.push({
          ...entry,
          request: buildOrchestrationChildInvocationRequest({
            orchestrationRequest: input.orchestrationRequest,
            childId: entry.child.childId,
            ordinal: entry.child.ordinal,
            task: entry.child.task,
            roleIntent: entry.child.roleIntent,
            ...(entry.agentProfile ? { agentProfile: entry.agentProfile } : {}),
            dependencyRecords,
            route: entry.route,
            profile: entry.profile,
            requestedBy: input.managedInvocation.requestedBy ?? input.orchestrationRequest.requestedBy,
            requestSource: input.managedInvocation.requestSource ?? input.orchestrationRequest.requestSource,
            requestedAuthority: input.requestedAuthority ?? "audited",
            admissionProfile: input.profile,
          }),
        });
      }
      const completed = await runOrchestrationBatch({
        service,
        entries: executable,
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

async function runOrchestrationBatch(input: {
  readonly service: NonNullable<ManagedInvocationToolOptions["invocationService"]>;
  readonly entries: readonly ExecutableOrchestrationChild[];
  readonly lifecycleObserver?: ManagedAgentOrchestrationLifecycleObserver;
}): Promise<readonly ManagedAgentOrchestrationLifecycleChildRecord[]> {
  const startResults = await Promise.allSettled(input.entries.map(async ({ request, route }) => {
    const startResult = await input.service.start(request, route.adapter, {
      routeId: route.routeId,
      routeSource: route.routeSource,
      routeHealth: {
        status: "healthy",
        reason: `Configured managed orchestration route selected by runtime lifecycle; routeSource=${route.routeSource}.`,
      },
      providerModelProof: {
        status: "live-proven",
        source: "managed-orchestration-lifecycle-route",
        requiresToolCalls: route.adapter.descriptor.adapterKind === "direct",
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
    });
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

async function assertOrchestrationBudgetAdmission(input: {
  readonly budgetAdmission?: ManagedAgentOrchestrationBudgetAdmissionInput;
  readonly orchestrationRequest: ManagedAgentOrchestrationRequest;
  readonly routes: readonly ManagedInvocationToolRoute[];
}): Promise<void> {
  if (!input.budgetAdmission) {
    return;
  }
  const budgetAdmission = new RuntimeBudgetAdmissionService(input.budgetAdmission);
  const decision = await budgetAdmission.admit({
    subject: "managed-orchestration",
    sessionId: input.orchestrationRequest.parentSessionId,
    turnId: input.orchestrationRequest.parentTurnId,
    routeCandidates: input.routes.map(budgetRouteCandidate),
  });
  if (decision.status === "denied") {
    throw new Error(`Managed orchestration budget admission denied: ${decision.message ?? decision.reason}`);
  }
}

function uniqueRoutes(routes: readonly ManagedInvocationToolRoute[]): readonly ManagedInvocationToolRoute[] {
  return [...new Map(routes.map((route) => [route.routeId, route])).values()];
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

function budgetRouteCandidate(route: ManagedInvocationToolRoute): BudgetAdmissionRouteCandidate {
  return {
    routeId: route.routeId,
    providerId: route.providerId,
    ...(route.model ? { model: route.model } : {}),
  };
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
): ManagedInvocationToolRoute {
  const matches = options.routes.filter((route) => {
    if (selector?.providerId && route.providerId !== selector.providerId) return false;
    if (selector?.model && route.model !== selector.model) return false;
    if (selector?.routeId && route.routeId !== selector.routeId) return false;
    const profile = route.profiles[admissionProfile];
    return profile !== undefined
      && profile.workingDirectory.mode === workingDirectoryMode
      && (workingDirectoryMode !== "isolated-worktree" || profile.workingDirectoryLease !== undefined)
      && route.adapter.descriptor.lifecycle.exposesStart
      && route.adapter.descriptor.lifecycle.exposesTerminal;
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
): ManagedInvocationRouteProfile {
  const profile = route.profiles[admissionProfile];
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
  readonly dependencyRecords: readonly ManagedAgentInvocationRecord[];
  readonly route: ManagedInvocationToolRoute;
  readonly profile: ManagedInvocationRouteProfile;
  readonly requestedBy: string;
  readonly requestSource: string;
  readonly requestedAuthority: ManagedAgentRequestedAuthority;
  readonly admissionProfile: ManagedAgentAdmissionProfile;
}): ManagedAgentInvocationRequest {
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
      surface: input.route.surface ?? input.route.adapter.descriptor.supportedExecutionModes[0] ?? "cli-harness",
      ...(input.route.model ? { model: input.route.model } : {}),
    },
    adapterKind: input.route.adapter.descriptor.adapterKind,
    executionMode: input.route.adapter.descriptor.supportedExecutionModes[0] ?? "cli-harness",
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
  if (route.mode !== "runtime-selected") {
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
