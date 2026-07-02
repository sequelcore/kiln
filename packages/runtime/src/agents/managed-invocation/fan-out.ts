import { posix, resolve, win32 } from "node:path";
import {
  buildManagedAgentOrchestrationResultEvidence,
  defineManagedAgentInvocationRequest,
  type BudgetAdmissionPolicy,
  type BudgetAdmissionRouteCandidate,
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

const FAN_OUT_PROFILE: ManagedAgentAdmissionProfile = "foundation-apply-approved-writes";
const FAN_OUT_CONTEXT_MODE = "isolated";

export interface ManagedAgentFanOutLifecycleRouteSelector {
  readonly providerId?: string;
  readonly model?: string;
  readonly routeId?: string;
}

export interface ManagedAgentFanOutBudgetAdmissionInput {
  readonly policy: BudgetAdmissionPolicy;
  readonly usageReader?: RuntimeBudgetUsageReader;
}

export interface ManagedAgentFanOutLifecycleInput {
  readonly orchestrationRequest: ManagedAgentOrchestrationRequest;
  readonly managedInvocation: ManagedInvocationToolOptions;
  readonly routeSelector?: ManagedAgentFanOutLifecycleRouteSelector;
  readonly requestedAuthority?: ManagedAgentRequestedAuthority;
  readonly budgetAdmission?: ManagedAgentFanOutBudgetAdmissionInput;
}

export interface ManagedAgentFanOutLifecycleChildRecord {
  readonly childId: string;
  readonly ordinal: number;
  readonly invocationId: string;
  readonly record?: ManagedAgentInvocationRecord;
  readonly error?: string;
}

export interface ManagedAgentFanOutLifecycleResult {
  readonly orchestrationResult: ManagedAgentOrchestrationResultEvidence;
  readonly childRecords: readonly ManagedAgentFanOutLifecycleChildRecord[];
}

export async function runManagedAgentFanOutLifecycle(
  input: ManagedAgentFanOutLifecycleInput,
): Promise<ManagedAgentFanOutLifecycleResult> {
  if (input.orchestrationRequest.mode !== "fan-out") {
    throw new Error("Managed lifecycle fan-out requires a fan-out orchestration request");
  }
  const service = input.managedInvocation.invocationService;
  if (!service) {
    throw new Error("Managed lifecycle fan-out requires an invocation service");
  }

  const route = selectFanOutRoute(input.managedInvocation, input.routeSelector);
  const profile = requireFanOutProfile(route);
  await assertFanOutBudgetAdmission({
    orchestrationRequest: input.orchestrationRequest,
    route,
    ...(input.budgetAdmission ? { budgetAdmission: input.budgetAdmission } : {}),
  });
  const requests = input.orchestrationRequest.childRequests.map((child) =>
    buildFanOutChildInvocationRequest({
      orchestrationRequest: input.orchestrationRequest,
      childId: child.childId,
      ordinal: child.ordinal,
      task: child.task,
      route,
      profile,
      requestedBy: input.managedInvocation.requestedBy ?? input.orchestrationRequest.requestedBy,
      requestSource: input.managedInvocation.requestSource ?? input.orchestrationRequest.requestSource,
      requestedAuthority: input.requestedAuthority ?? "audited",
    })
  );

  const startResults = await Promise.allSettled(requests.map(async (request) => {
    const startResult = await service.start(request, route.adapter, {
      routeId: route.routeId,
      routeSource: route.routeSource,
      routeHealth: {
        status: "healthy",
        reason: `Configured managed lifecycle fan-out route selected by CLI worker orchestration; routeSource=${route.routeSource}.`,
      },
      providerModelProof: {
        status: "live-proven",
        source: "managed-lifecycle-fan-out-route",
        requiresToolCalls: route.adapter.descriptor.adapterKind === "direct",
      },
      resourcePlane: {
        available: true,
        resourceUris: [],
        reason: "Fan-out child uses isolated managed worktree context.",
      },
      childIdentity: {
        agentId: request.agentId,
        displayName: route.routeId,
        ...(route.voiceProfile ? { voiceProfile: route.voiceProfile } : {}),
      },
    });
    if (startResult.status === "denied") {
      throw new Error(`Managed fan-out child '${request.invocationId}' denied: ${startResult.decision.reason}`);
    }
    const status = service.status(startResult.snapshot.invocationId);
    if (!status || status.lifecycleState !== "running") {
      throw new Error(`Managed fan-out child '${request.invocationId}' did not publish running lifecycle status`);
    }
    return startResult.snapshot.invocationId;
  }));
  const startFailures = startResults.filter((result) => result.status === "rejected");
  if (startFailures.length > 0) {
    await cleanupStartedFanOutChildren(
      service,
      requests,
      startResults,
      "Managed fan-out start failed; cancelling already-started children.",
    );
    throw new Error(`Managed fan-out child start failed: ${startFailures.map((result) =>
      result.reason instanceof Error ? result.reason.message : String(result.reason)
    ).join("; ")}`);
  }

  const starts = startResults.map((result) => {
    if (result.status === "rejected") {
      throw result.reason;
    }
    return result.value;
  });

  const settled = await Promise.allSettled(starts.map(async (invocationId, index) => {
    const child = input.orchestrationRequest.childRequests[index]!;
    const joined = await service.join(invocationId);
    if (joined.status !== "completed") {
      throw new Error(`Managed fan-out child '${invocationId}' did not reach terminal completion`);
    }
    return {
      childId: child.childId,
      ordinal: child.ordinal,
      invocationId,
      record: joined.record,
    } satisfies ManagedAgentFanOutLifecycleChildRecord;
  }));

  const childRecords = settled.map((result, index): ManagedAgentFanOutLifecycleChildRecord => {
    const child = input.orchestrationRequest.childRequests[index]!;
    const invocationId = starts[index] ?? child.childId;
    if (result.status === "fulfilled") {
      return result.value;
    }
    const snapshot = service.status(invocationId);
    return {
      childId: child.childId,
      ordinal: child.ordinal,
      invocationId,
      ...(snapshot?.record ? { record: snapshot.record } : {}),
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });

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
    })),
  );

  return {
    orchestrationResult,
    childRecords,
  };
}

async function assertFanOutBudgetAdmission(input: {
  readonly budgetAdmission?: ManagedAgentFanOutBudgetAdmissionInput;
  readonly orchestrationRequest: ManagedAgentOrchestrationRequest;
  readonly route: ManagedInvocationToolRoute;
}): Promise<void> {
  if (!input.budgetAdmission) {
    return;
  }
  const budgetAdmission = new RuntimeBudgetAdmissionService(input.budgetAdmission);
  const decision = await budgetAdmission.admit({
    subject: "managed-orchestration",
    sessionId: input.orchestrationRequest.parentSessionId,
    turnId: input.orchestrationRequest.parentTurnId,
    routeCandidates: [budgetRouteCandidate(input.route)],
  });
  if (decision.status === "denied") {
    throw new Error(`Managed fan-out budget admission denied: ${decision.message ?? decision.reason}`);
  }
}

function budgetRouteCandidate(route: ManagedInvocationToolRoute): BudgetAdmissionRouteCandidate {
  return {
    routeId: route.routeId,
    providerId: route.providerId,
    ...(route.model ? { model: route.model } : {}),
  };
}

async function cleanupStartedFanOutChildren(
  service: NonNullable<ManagedInvocationToolOptions["invocationService"]>,
  requests: readonly ManagedAgentInvocationRequest[],
  startResults: readonly PromiseSettledResult<string>[],
  reason: string,
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
      await service.join(startedInvocationId).catch(() => undefined);
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

function selectFanOutRoute(
  options: ManagedInvocationToolOptions,
  selector: ManagedAgentFanOutLifecycleRouteSelector | undefined,
): ManagedInvocationToolRoute {
  const matches = options.routes.filter((route) => {
    if (selector?.providerId && route.providerId !== selector.providerId) return false;
    if (selector?.model && route.model !== selector.model) return false;
    if (selector?.routeId && route.routeId !== selector.routeId) return false;
    const profile = route.profiles[FAN_OUT_PROFILE];
    return profile !== undefined
      && profile.workingDirectory.mode === "isolated-worktree"
      && profile.workingDirectoryLease !== undefined
      && route.adapter.descriptor.lifecycle.exposesStart
      && route.adapter.descriptor.lifecycle.exposesTerminal;
  });
  if (matches.length === 1) {
    return matches[0]!;
  }
  if (matches.length > 1) {
    throw new Error(`Managed lifecycle fan-out route selection is ambiguous. Specify a provider, model, or routeId. Matching routes: ${matches.map((route) => route.routeId).join(", ")}`);
  }
  const selectorSummary = [
    selector?.routeId ? `routeId '${selector.routeId}'` : undefined,
    selector?.providerId ? `provider '${selector.providerId}'` : undefined,
    selector?.model ? `model '${selector.model}'` : undefined,
  ].filter((part): part is string => part !== undefined).join(", ");
  throw new Error(`Managed lifecycle fan-out requires an isolated-worktree ${FAN_OUT_PROFILE} route${selectorSummary ? ` matching ${selectorSummary}` : ""}.`);
}

function requireFanOutProfile(route: ManagedInvocationToolRoute): ManagedInvocationRouteProfile {
  const profile = route.profiles[FAN_OUT_PROFILE];
  if (!profile) {
    throw new Error(`Managed lifecycle fan-out route '${route.routeId}' does not expose ${FAN_OUT_PROFILE}`);
  }
  if (profile.workingDirectory.mode !== "isolated-worktree" || !profile.workingDirectoryLease) {
    throw new Error(`Managed lifecycle fan-out route '${route.routeId}' must use an isolated worktree lease`);
  }
  return profile;
}

function buildFanOutChildInvocationRequest(input: {
  readonly orchestrationRequest: ManagedAgentOrchestrationRequest;
  readonly childId: string;
  readonly ordinal: number;
  readonly task: string;
  readonly route: ManagedInvocationToolRoute;
  readonly profile: ManagedInvocationRouteProfile;
  readonly requestedBy: string;
  readonly requestSource: string;
  readonly requestedAuthority: ManagedAgentRequestedAuthority;
}): ManagedAgentInvocationRequest {
  const invocationId = sanitizeInvocationId(input.childId);
  const workingDirectory = resolveFanOutWorkingDirectory(input.profile, invocationId);
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
      ? { writeAuthority: resolveFanOutWriteAuthority(input.profile, workingDirectory) }
      : {}),
  };
  return defineManagedAgentInvocationRequest({
    invocationId,
    agentId: `${input.route.routeId}:${FAN_OUT_PROFILE}`,
    parentSessionId: input.orchestrationRequest.parentSessionId,
    parentTurnId: input.orchestrationRequest.parentTurnId,
    profile: FAN_OUT_PROFILE,
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
      summary: `Fan-out worker ${input.ordinal}: ${input.orchestrationRequest.task}`,
      prompt: input.task,
      context: {
        mode: FAN_OUT_CONTEXT_MODE,
      },
      handoff: {
        roleIntent: "fan-out duplicate candidate",
        expectedEvidence: input.orchestrationRequest.expectedEvidence.map((evidence) => evidence.kind),
        requiredResultFields: ["summary", "evidence", "checks"],
        doneCriteria: [
          "Return a bounded result handoff for parent comparison.",
          "Do not mutate outside the managed isolated worktree.",
        ],
        residualRiskRequired: true,
      },
    },
  });
}

function resolveFanOutWorkingDirectory(
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

function resolveFanOutWriteAuthority(
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
