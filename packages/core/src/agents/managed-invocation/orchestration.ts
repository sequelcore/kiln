import {
  defineManagedAgentCoordinationUsageReport,
  type ManagedAgentCoordinationUsageReport,
  type ManagedAgentInvocationContextMode,
  type ManagedAgentLifecycleState,
  type ManagedAgentWorkingDirectory,
} from "./index.js";

export const MANAGED_AGENT_ORCHESTRATION_MODES = [
  "fan-out",
  "decomposition",
  "review-swarm",
  "route-comparison",
  "background-job",
] as const;

export type ManagedAgentOrchestrationMode = typeof MANAGED_AGENT_ORCHESTRATION_MODES[number];

export const MANAGED_AGENT_ORCHESTRATION_EVIDENCE_KINDS = [
  "result-handoff",
  "comparison-summary",
  "review-findings",
  "route-outcome",
  "completion-signal",
] as const;

export type ManagedAgentOrchestrationEvidenceKind = typeof MANAGED_AGENT_ORCHESTRATION_EVIDENCE_KINDS[number];

export type ManagedAgentOrchestrationMergePolicyMode =
  | "compare-and-select"
  | "collect-all"
  | "first-success"
  | "manual-review-required"
  | "none";

export interface ManagedAgentOrchestrationExpectedEvidence {
  readonly kind: ManagedAgentOrchestrationEvidenceKind;
  readonly label: string;
  readonly required: boolean;
}

export interface ManagedAgentOrchestrationChildRequest {
  readonly childId: string;
  readonly key: string;
  readonly ordinal: number;
  readonly roleIntent: string;
  readonly task: string;
  readonly agentProfile?: string;
  readonly routeId?: string;
  readonly dependsOn: readonly string[];
  readonly expectedEvidence: readonly ManagedAgentOrchestrationExpectedEvidence[];
}

export interface ManagedAgentOrchestrationChildPlan {
  readonly key?: string;
  readonly roleIntent: string;
  readonly task: string;
  readonly agentProfile?: string;
  readonly routeId?: string;
  readonly dependsOn?: readonly string[];
  readonly expectedEvidence?: readonly ManagedAgentOrchestrationExpectedEvidence[];
}

export interface ManagedAgentOrchestrationRequestBuilderBaseInput {
  readonly orchestrationId: string;
  readonly parentSessionId: string;
  readonly parentTurnId: string;
  readonly requestedBy: string;
  readonly requestSource: string;
  readonly task: string;
  readonly workingDirectoryMode: ManagedAgentWorkingDirectory["mode"];
}

export interface ManagedAgentParallelOrchestrationRequestBuilderInput
  extends ManagedAgentOrchestrationRequestBuilderBaseInput {
  readonly childPlans: readonly ManagedAgentOrchestrationChildPlan[];
  readonly maxConcurrentChildren: number;
}

export interface ManagedAgentOrchestrationIsolationPolicy {
  readonly required: boolean;
  readonly reason: string;
  readonly workingDirectoryMode?: ManagedAgentWorkingDirectory["mode"];
}

export interface ManagedAgentOrchestrationMergePolicy {
  readonly mode: ManagedAgentOrchestrationMergePolicyMode;
  readonly adoptionRequired: boolean;
  readonly adoptionReadinessRequired: boolean;
}

export interface ManagedAgentOrchestrationRequest {
  readonly orchestrationId: string;
  readonly parentSessionId: string;
  readonly parentTurnId: string;
  readonly requestedBy: string;
  readonly requestSource: string;
  readonly mode: ManagedAgentOrchestrationMode;
  readonly task: string;
  readonly childRequests: readonly ManagedAgentOrchestrationChildRequest[];
  readonly maxConcurrentChildren: number;
  readonly isolation: ManagedAgentOrchestrationIsolationPolicy;
  readonly expectedEvidence: readonly ManagedAgentOrchestrationExpectedEvidence[];
  readonly mergePolicy: ManagedAgentOrchestrationMergePolicy;
}

export type ManagedAgentOrchestrationAvailability = "available" | "unavailable";

export type ManagedAgentOrchestrationTaskRisk = "low" | "medium" | "high" | "unknown";

export interface ManagedAgentOrchestrationAdmissionLimits {
  readonly maxChildren: number;
  readonly routeHealth: ManagedAgentOrchestrationAvailability;
  readonly budget: ManagedAgentOrchestrationAvailability;
  readonly workspace: ManagedAgentOrchestrationAvailability;
  readonly taskRisk: ManagedAgentOrchestrationTaskRisk;
}

export type ManagedAgentOrchestrationAdmissionDecision =
  | {
    readonly status: "admitted";
    readonly orchestrationId: string;
    readonly mode: ManagedAgentOrchestrationMode;
    readonly admittedChildCount: number;
    readonly maxConcurrentChildren: number;
    readonly request: ManagedAgentOrchestrationRequest;
    readonly limits: ManagedAgentOrchestrationAdmissionLimits;
  }
  | {
    readonly status: "denied";
    readonly orchestrationId: string;
    readonly mode: ManagedAgentOrchestrationMode;
    readonly reason: string;
    readonly missingCapabilities: readonly string[];
  };

export interface ManagedAgentOrchestrationChildResult {
  readonly childId: string;
  readonly ordinal: number;
  readonly lifecycleState: ManagedAgentLifecycleState;
  readonly success: boolean;
  readonly error?: string;
  readonly resourceUris?: readonly string[];
  readonly diagnosticUris?: readonly string[];
  readonly invocationId?: string;
  readonly routeId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly authorityProfileId?: string;
  readonly contextMode?: ManagedAgentInvocationContextMode;
  readonly coordinationUsage?: ManagedAgentCoordinationUsageReport;
  readonly replayEvidenceUris?: readonly string[];
}

export interface ManagedAgentOrchestrationNormalizedChildResult {
  readonly childId: string;
  readonly ordinal: number;
  readonly lifecycleState: ManagedAgentLifecycleState;
  readonly success: boolean;
  readonly error?: string;
  readonly resourceUris: readonly string[];
  readonly diagnosticUris: readonly string[];
  readonly invocationId?: string;
  readonly routeId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly authorityProfileId?: string;
  readonly contextMode?: ManagedAgentInvocationContextMode;
  readonly coordinationUsage?: ManagedAgentCoordinationUsageReport;
  readonly replayEvidenceUris: readonly string[];
}

export interface ManagedAgentOrchestrationResultEvidence {
  readonly orchestrationId: string;
  readonly mode: ManagedAgentOrchestrationMode;
  readonly status: "completed" | "partial" | "failed";
  readonly requestedChildCount: number;
  readonly succeededCount: number;
  readonly failedCount: number;
  readonly expectedEvidence: readonly ManagedAgentOrchestrationExpectedEvidence[];
  readonly childResults: readonly ManagedAgentOrchestrationNormalizedChildResult[];
}

export function buildManagedAgentFanOutOrchestrationRequest(input: {
  readonly orchestrationId: string;
  readonly parentSessionId: string;
  readonly parentTurnId: string;
  readonly requestedBy: string;
  readonly requestSource: string;
  readonly task: string;
  readonly childCount: number;
  readonly maxConcurrentChildren: number;
  readonly workingDirectoryMode: ManagedAgentWorkingDirectory["mode"];
}): ManagedAgentOrchestrationRequest {
  if (!Number.isInteger(input.childCount) || input.childCount < 2) {
    throw new Error("Managed fan-out orchestration requires at least two children");
  }
  const expectedEvidence: readonly ManagedAgentOrchestrationExpectedEvidence[] = [
    {
      kind: "result-handoff",
      label: "bounded child result handoff",
      required: true,
    },
    {
      kind: "comparison-summary",
      label: "parent comparison across child outputs",
      required: true,
    },
  ];
  return defineManagedAgentOrchestrationRequest({
    orchestrationId: input.orchestrationId,
    parentSessionId: input.parentSessionId,
    parentTurnId: input.parentTurnId,
    requestedBy: input.requestedBy,
    requestSource: input.requestSource,
    mode: "fan-out",
    task: input.task,
    childRequests: Array.from({ length: input.childCount }, (_, index) => ({
      childId: `${input.orchestrationId}:child:${index + 1}`,
      key: `candidate-${index + 1}`,
      ordinal: index + 1,
      roleIntent: "duplicate-candidate",
      task: input.task,
      dependsOn: [],
      expectedEvidence,
    })),
    maxConcurrentChildren: input.maxConcurrentChildren,
    isolation: {
      required: true,
      reason: "fan-out children require isolated workspaces so duplicate candidates cannot mutate one checkout",
      workingDirectoryMode: input.workingDirectoryMode,
    },
    expectedEvidence,
    mergePolicy: {
      mode: "compare-and-select",
      adoptionRequired: false,
      adoptionReadinessRequired: false,
    },
  });
}

export function buildManagedAgentDecompositionOrchestrationRequest(
  input: ManagedAgentParallelOrchestrationRequestBuilderInput,
): ManagedAgentOrchestrationRequest {
  const expectedEvidence = buildModeExpectedEvidence("decomposition");
  return buildManagedAgentModeOrchestrationRequest(input, {
    mode: "decomposition",
    childPlans: input.childPlans,
    maxConcurrentChildren: input.maxConcurrentChildren,
    expectedEvidence,
    mergePolicy: {
      mode: "collect-all",
      adoptionRequired: true,
      adoptionReadinessRequired: true,
    },
  });
}

export function buildManagedAgentReviewSwarmOrchestrationRequest(
  input: ManagedAgentParallelOrchestrationRequestBuilderInput,
): ManagedAgentOrchestrationRequest {
  const expectedEvidence = buildModeExpectedEvidence("review-swarm");
  return buildManagedAgentModeOrchestrationRequest(input, {
    mode: "review-swarm",
    childPlans: input.childPlans,
    maxConcurrentChildren: input.maxConcurrentChildren,
    expectedEvidence,
    mergePolicy: {
      mode: "manual-review-required",
      adoptionRequired: false,
      adoptionReadinessRequired: false,
    },
  });
}

export function buildManagedAgentRouteComparisonOrchestrationRequest(
  input: ManagedAgentParallelOrchestrationRequestBuilderInput,
): ManagedAgentOrchestrationRequest {
  const expectedEvidence = buildModeExpectedEvidence("route-comparison");
  return buildManagedAgentModeOrchestrationRequest(input, {
    mode: "route-comparison",
    childPlans: input.childPlans,
    maxConcurrentChildren: input.maxConcurrentChildren,
    expectedEvidence,
    mergePolicy: {
      mode: "compare-and-select",
      adoptionRequired: false,
      adoptionReadinessRequired: false,
    },
  });
}

export function buildManagedAgentBackgroundJobOrchestrationRequest(
  input: ManagedAgentOrchestrationRequestBuilderBaseInput & {
    readonly roleIntent: string;
    readonly key?: string;
    readonly agentProfile?: string;
    readonly routeId?: string;
  },
): ManagedAgentOrchestrationRequest {
  const expectedEvidence = buildModeExpectedEvidence("background-job");
  return buildManagedAgentModeOrchestrationRequest(input, {
    mode: "background-job",
    childPlans: [
      {
        ...(input.key !== undefined ? { key: input.key } : {}),
        roleIntent: input.roleIntent,
        task: input.task,
        ...(input.agentProfile !== undefined ? { agentProfile: input.agentProfile } : {}),
        ...(input.routeId !== undefined ? { routeId: input.routeId } : {}),
        expectedEvidence,
      },
    ],
    maxConcurrentChildren: 1,
    expectedEvidence,
    mergePolicy: {
      mode: "none",
      adoptionRequired: false,
      adoptionReadinessRequired: false,
    },
  });
}

function buildManagedAgentModeOrchestrationRequest(
  input: ManagedAgentOrchestrationRequestBuilderBaseInput,
  config: {
    readonly mode: ManagedAgentOrchestrationMode;
    readonly childPlans: readonly ManagedAgentOrchestrationChildPlan[];
    readonly maxConcurrentChildren: number;
    readonly expectedEvidence: readonly ManagedAgentOrchestrationExpectedEvidence[];
    readonly mergePolicy: ManagedAgentOrchestrationMergePolicy;
  },
): ManagedAgentOrchestrationRequest {
  return defineManagedAgentOrchestrationRequest({
    orchestrationId: input.orchestrationId,
    parentSessionId: input.parentSessionId,
    parentTurnId: input.parentTurnId,
    requestedBy: input.requestedBy,
    requestSource: input.requestSource,
    mode: config.mode,
    task: input.task,
    childRequests: buildChildRequests(input.orchestrationId, config.childPlans, config.expectedEvidence),
    maxConcurrentChildren: config.maxConcurrentChildren,
    isolation: {
      required: true,
      reason: `managed ${config.mode} children require an explicit isolated execution boundary`,
      workingDirectoryMode: input.workingDirectoryMode,
    },
    expectedEvidence: config.expectedEvidence,
    mergePolicy: config.mergePolicy,
  });
}

export function defineManagedAgentOrchestrationRequest(
  input: ManagedAgentOrchestrationRequest,
): ManagedAgentOrchestrationRequest {
  const mode = requireOrchestrationMode(input.mode);
  const childRequests = requireNonEmptyArray(input.childRequests, "Managed orchestration child requests are required")
    .map(requireChildRequest);
  const expectedEvidence = requireNonEmptyArray(
    input.expectedEvidence,
    "Managed orchestration expected evidence is required",
  ).map(requireExpectedEvidence);
  const maxConcurrentChildren = requirePositiveInteger(
    input.maxConcurrentChildren,
    "Managed orchestration max concurrent children must be greater than zero",
  );
  if (maxConcurrentChildren > childRequests.length) {
    throw new Error("Managed orchestration concurrency cannot exceed requested children");
  }
  if (mode === "fan-out" && childRequests.length < 2) {
    throw new Error("Managed fan-out orchestration requires at least two children");
  }
  requireUniqueChildRequests(childRequests);
  requireValidChildDependencies(childRequests);
  const isolation = requireIsolationPolicy(mode, input.isolation);
  const mergePolicy = {
    mode: requireMergePolicyMode(input.mergePolicy.mode),
    adoptionRequired: input.mergePolicy.adoptionRequired === true,
    adoptionReadinessRequired: input.mergePolicy.adoptionReadinessRequired === true,
  };
  const request = {
    orchestrationId: requireText(input.orchestrationId, "Managed orchestration id is required"),
    parentSessionId: requireText(input.parentSessionId, "Managed orchestration parent session id is required"),
    parentTurnId: requireText(input.parentTurnId, "Managed orchestration parent turn id is required"),
    requestedBy: requireText(input.requestedBy, "Managed orchestration requester is required"),
    requestSource: requireText(input.requestSource, "Managed orchestration request source is required"),
    mode,
    task: requireText(input.task, "Managed orchestration task is required"),
    childRequests,
    maxConcurrentChildren,
    isolation,
    expectedEvidence,
    mergePolicy,
  };
  requireModePolicy(request);
  return request;
}

export function admitManagedAgentOrchestrationRequest(
  input: ManagedAgentOrchestrationRequest,
  limits: ManagedAgentOrchestrationAdmissionLimits,
): ManagedAgentOrchestrationAdmissionDecision {
  const request = defineManagedAgentOrchestrationRequest(input);
  const normalizedLimits = requireAdmissionLimits(limits);
  const missingCapabilities: string[] = [];
  if (request.childRequests.length > normalizedLimits.maxChildren) {
    missingCapabilities.push("orchestration.maxChildren");
  }
  if (normalizedLimits.routeHealth !== "available") {
    missingCapabilities.push("orchestration.routeHealth.available");
  }
  if (normalizedLimits.budget !== "available") {
    missingCapabilities.push("orchestration.budget.available");
  }
  if (normalizedLimits.workspace !== "available") {
    missingCapabilities.push("orchestration.workspace.available");
  }
  if (normalizedLimits.taskRisk === "high" && request.maxConcurrentChildren > 1) {
    missingCapabilities.push("orchestration.taskRisk.parallelAdmissible");
  }

  if (missingCapabilities.length > 0) {
    return {
      status: "denied",
      orchestrationId: request.orchestrationId,
      mode: request.mode,
      reason: "managed orchestration admission failed",
      missingCapabilities,
    };
  }

  return {
    status: "admitted",
    orchestrationId: request.orchestrationId,
    mode: request.mode,
    admittedChildCount: request.childRequests.length,
    maxConcurrentChildren: request.maxConcurrentChildren,
    request,
    limits: normalizedLimits,
  };
}

export function buildManagedAgentOrchestrationResultEvidence(
  requestInput: ManagedAgentOrchestrationRequest,
  childResultsInput: readonly ManagedAgentOrchestrationChildResult[],
): ManagedAgentOrchestrationResultEvidence {
  const request = defineManagedAgentOrchestrationRequest(requestInput);
  const childResults = childResultsInput.map(requireChildResult);
  requireExactChildResults(request, childResults);
  for (const child of request.childRequests) {
    if (!childResults.some((result) => result.childId === child.childId)) {
      throw new Error(`Managed orchestration result is missing child result: ${child.childId}`);
    }
  }
  const succeededCount = childResults.filter((result) => result.success).length;
  const failedCount = childResults.length - succeededCount;
  const status = succeededCount === childResults.length
    ? "completed"
    : succeededCount === 0
      ? "failed"
      : "partial";
  return {
    orchestrationId: request.orchestrationId,
    mode: request.mode,
    status,
    requestedChildCount: request.childRequests.length,
    succeededCount,
    failedCount,
    expectedEvidence: request.expectedEvidence,
    childResults: childResults.map((result) => ({
      ...result,
      resourceUris: result.resourceUris ?? [],
      diagnosticUris: result.diagnosticUris ?? [],
      replayEvidenceUris: result.replayEvidenceUris ?? [],
    })),
  };
}

function requireChildRequest(input: ManagedAgentOrchestrationChildRequest): ManagedAgentOrchestrationChildRequest {
  return {
    childId: requireText(input.childId, "Managed orchestration child id is required"),
    key: requireText(input.key, "Managed orchestration child key is required"),
    ordinal: requirePositiveInteger(input.ordinal, "Managed orchestration child ordinal must be greater than zero"),
    roleIntent: requireText(input.roleIntent, "Managed orchestration child role intent is required"),
    task: requireText(input.task, "Managed orchestration child task is required"),
    ...(input.agentProfile !== undefined
      ? { agentProfile: requireText(input.agentProfile, "Managed orchestration child agent profile is required") }
      : {}),
    ...(input.routeId !== undefined
      ? { routeId: requireText(input.routeId, "Managed orchestration child route id is required") }
      : {}),
    dependsOn: input.dependsOn.map((dependency) =>
      requireText(dependency, "Managed orchestration child dependency key is required")
    ),
    expectedEvidence: requireNonEmptyArray(
      input.expectedEvidence,
      "Managed orchestration child expected evidence is required",
    ).map(requireExpectedEvidence),
  };
}

function buildModeExpectedEvidence(
  mode: ManagedAgentOrchestrationMode,
): readonly ManagedAgentOrchestrationExpectedEvidence[] {
  if (mode === "fan-out") {
    return [
      {
        kind: "result-handoff",
        label: "bounded child result handoff",
        required: true,
      },
      {
        kind: "comparison-summary",
        label: "parent comparison across child outputs",
        required: true,
      },
    ];
  }
  if (mode === "decomposition") {
    return [
      {
        kind: "result-handoff",
        label: "bounded subtask result handoff",
        required: true,
      },
      {
        kind: "completion-signal",
        label: "subtask completion signal",
        required: true,
      },
    ];
  }
  if (mode === "review-swarm") {
    return [
      {
        kind: "review-findings",
        label: "independent review findings",
        required: true,
      },
      {
        kind: "comparison-summary",
        label: "parent review synthesis",
        required: true,
      },
    ];
  }
  if (mode === "route-comparison") {
    return [
      {
        kind: "route-outcome",
        label: "candidate route outcome",
        required: true,
      },
      {
        kind: "comparison-summary",
        label: "parent route comparison",
        required: true,
      },
    ];
  }
  return [
    {
      kind: "completion-signal",
      label: "background completion signal",
      required: true,
    },
    {
      kind: "result-handoff",
      label: "bounded background result handoff",
      required: true,
    },
  ];
}

function buildChildRequests(
  orchestrationId: string,
  childPlans: readonly ManagedAgentOrchestrationChildPlan[],
  expectedEvidence: readonly ManagedAgentOrchestrationExpectedEvidence[],
): readonly ManagedAgentOrchestrationChildRequest[] {
  return requireNonEmptyArray(childPlans, "Managed orchestration child plans are required")
    .map((plan, index) => ({
      childId: `${orchestrationId}:child:${index + 1}`,
      key: plan.key ?? `child-${index + 1}`,
      ordinal: index + 1,
      roleIntent: plan.roleIntent,
      task: plan.task,
      ...(plan.agentProfile !== undefined ? { agentProfile: plan.agentProfile } : {}),
      ...(plan.routeId !== undefined ? { routeId: plan.routeId } : {}),
      dependsOn: plan.dependsOn ?? [],
      expectedEvidence: plan.expectedEvidence ?? expectedEvidence,
    }));
}

function requireValidChildDependencies(
  children: readonly ManagedAgentOrchestrationChildRequest[],
): void {
  const keys = new Set<string>();
  for (const child of children) {
    if (keys.has(child.key)) {
      throw new Error(`Managed orchestration child key must be unique: ${child.key}`);
    }
    keys.add(child.key);
  }
  for (const child of children) {
    for (const dependency of child.dependsOn) {
      if (dependency === child.key) {
        throw new Error(`Managed orchestration child cannot depend on itself: ${child.key}`);
      }
      if (!keys.has(dependency)) {
        throw new Error(`Managed orchestration child dependency is unknown: ${dependency}`);
      }
    }
  }
}

function requireChildResult(input: ManagedAgentOrchestrationChildResult): ManagedAgentOrchestrationChildResult {
  const lifecycleState = requireTerminalLifecycleState(input.lifecycleState);
  const success = input.success === true;
  requireLifecycleSuccessConsistency(lifecycleState, success);
  return {
    childId: requireText(input.childId, "Managed orchestration child result id is required"),
    ordinal: requirePositiveInteger(input.ordinal, "Managed orchestration child result ordinal must be greater than zero"),
    lifecycleState,
    success,
    ...(input.error !== undefined ? { error: requireText(input.error, "Managed orchestration child error is required") } : {}),
    ...(input.resourceUris !== undefined
      ? { resourceUris: input.resourceUris.map((uri) => requireText(uri, "Managed orchestration child result resource uri is required")) }
      : {}),
    ...(input.diagnosticUris !== undefined
      ? { diagnosticUris: input.diagnosticUris.map((uri) => requireText(uri, "Managed orchestration child result diagnostic uri is required")) }
      : {}),
    ...(input.invocationId !== undefined ? { invocationId: requireText(input.invocationId, "Managed orchestration invocation id is required") } : {}),
    ...(input.routeId !== undefined ? { routeId: requireText(input.routeId, "Managed orchestration route id is required") } : {}),
    ...(input.providerId !== undefined ? { providerId: requireText(input.providerId, "Managed orchestration provider id is required") } : {}),
    ...(input.model !== undefined ? { model: requireText(input.model, "Managed orchestration model is required") } : {}),
    ...(input.authorityProfileId !== undefined
      ? { authorityProfileId: requireText(input.authorityProfileId, "Managed orchestration authority profile id is required") }
      : {}),
    ...(input.contextMode !== undefined ? { contextMode: input.contextMode } : {}),
    ...(input.coordinationUsage !== undefined
      ? { coordinationUsage: defineManagedAgentCoordinationUsageReport(input.coordinationUsage) }
      : {}),
    ...(input.replayEvidenceUris !== undefined
      ? { replayEvidenceUris: input.replayEvidenceUris.map((uri) => requireText(uri, "Managed orchestration replay evidence uri is required")) }
      : {}),
  };
}

function requireModePolicy(request: ManagedAgentOrchestrationRequest): void {
  requireIsolatedExecutionPolicy(request);
  if (request.mode === "fan-out") {
    requireMinimumChildren(request, 2, "Managed fan-out orchestration requires at least two children");
    requireEvidenceKinds(request, ["result-handoff", "comparison-summary"]);
    requireMergePolicy(request, "compare-and-select", false, false, "Managed fan-out orchestration requires compare-and-select merge policy");
    return;
  }
  if (request.mode === "decomposition") {
    requireMinimumChildren(request, 2, "Managed decomposition orchestration requires at least two children");
    requireEvidenceKinds(request, ["result-handoff", "completion-signal"]);
    requireMergePolicy(request, "collect-all", true, true, "Managed decomposition orchestration requires collect-all merge policy");
    return;
  }
  if (request.mode === "review-swarm") {
    requireMinimumChildren(request, 2, "Managed review-swarm orchestration requires at least two children");
    requireEvidenceKinds(request, ["review-findings", "comparison-summary"]);
    requireMergePolicy(request, "manual-review-required", false, false, "Managed review-swarm orchestration requires manual-review-required merge policy");
    return;
  }
  if (request.mode === "route-comparison") {
    requireMinimumChildren(request, 2, "Managed route-comparison orchestration requires at least two children");
    requireEvidenceKinds(request, ["route-outcome", "comparison-summary"]);
    requireMergePolicy(request, "compare-and-select", false, false, "Managed route-comparison orchestration requires compare-and-select merge policy");
    return;
  }
  if (request.childRequests.length !== 1 || request.maxConcurrentChildren !== 1) {
    throw new Error("Managed background-job orchestration requires exactly one child");
  }
  requireEvidenceKinds(request, ["completion-signal", "result-handoff"]);
  requireMergePolicy(request, "none", false, false, "Managed background-job orchestration requires no merge policy");
}

function requireIsolatedExecutionPolicy(request: ManagedAgentOrchestrationRequest): void {
  if (!request.isolation.required) {
    throw new Error(`Managed ${request.mode} orchestration requires isolated child workspaces`);
  }
  if (request.isolation.workingDirectoryMode === "workspace-write" || request.isolation.workingDirectoryMode === undefined) {
    throw new Error(`Managed ${request.mode} orchestration requires read-only, sandbox, or isolated-worktree execution`);
  }
  if (request.mode === "fan-out" && request.isolation.workingDirectoryMode !== "isolated-worktree") {
    throw new Error(`Managed ${request.mode} orchestration requires isolated-worktree working directory mode`);
  }
}

function requireMinimumChildren(
  request: ManagedAgentOrchestrationRequest,
  minimum: number,
  message: string,
): void {
  if (request.childRequests.length < minimum) {
    throw new Error(message);
  }
}

function requireEvidenceKinds(
  request: ManagedAgentOrchestrationRequest,
  requiredKinds: readonly ManagedAgentOrchestrationEvidenceKind[],
): void {
  for (const kind of requiredKinds) {
    if (!request.expectedEvidence.some((evidence) => evidence.kind === kind && evidence.required)) {
      throw new Error(`Managed ${request.mode} orchestration requires ${kind} evidence`);
    }
    for (const child of request.childRequests) {
      if (!child.expectedEvidence.some((evidence) => evidence.kind === kind && evidence.required)) {
        throw new Error(`Managed ${request.mode} orchestration child ${child.childId} requires ${kind} evidence`);
      }
    }
  }
}

function requireMergePolicy(
  request: ManagedAgentOrchestrationRequest,
  mode: ManagedAgentOrchestrationMergePolicyMode,
  adoptionRequired: boolean,
  adoptionReadinessRequired: boolean,
  message: string,
): void {
  if (request.mergePolicy.mode !== mode) {
    throw new Error(message);
  }
  if (request.mergePolicy.adoptionRequired !== adoptionRequired) {
    throw new Error(`Managed ${request.mode} orchestration requires adoptionRequired=${String(adoptionRequired)}`);
  }
  if (request.mergePolicy.adoptionReadinessRequired !== adoptionReadinessRequired) {
    throw new Error(`Managed ${request.mode} orchestration requires adoptionReadinessRequired=${String(adoptionReadinessRequired)}`);
  }
}

function requireUniqueChildRequests(childRequests: readonly ManagedAgentOrchestrationChildRequest[]): void {
  const childIds = new Set<string>();
  const ordinals = new Set<number>();
  for (const child of childRequests) {
    if (childIds.has(child.childId)) {
      throw new Error("Managed orchestration child ids must be unique");
    }
    childIds.add(child.childId);
    if (ordinals.has(child.ordinal)) {
      throw new Error("Managed orchestration child ordinals must be unique");
    }
    ordinals.add(child.ordinal);
  }
}

function requireExactChildResults(
  request: ManagedAgentOrchestrationRequest,
  childResults: readonly ManagedAgentOrchestrationChildResult[],
): void {
  const requestedById = new Map(request.childRequests.map((child) => [child.childId, child]));
  const seenResults = new Set<string>();
  for (const result of childResults) {
    const requested = requestedById.get(result.childId);
    if (!requested) {
      throw new Error(`Managed orchestration result includes unknown child result: ${result.childId}`);
    }
    if (seenResults.has(result.childId)) {
      throw new Error(`Managed orchestration result duplicates child result: ${result.childId}`);
    }
    seenResults.add(result.childId);
    if (requested.ordinal !== result.ordinal) {
      throw new Error(`Managed orchestration result ordinal mismatch for child result: ${result.childId}`);
    }
  }
}

function requireExpectedEvidence(
  input: ManagedAgentOrchestrationExpectedEvidence,
): ManagedAgentOrchestrationExpectedEvidence {
  return {
    kind: requireEvidenceKind(input.kind),
    label: requireText(input.label, "Managed orchestration expected evidence label is required"),
    required: input.required === true,
  };
}

function requireAdmissionLimits(
  input: ManagedAgentOrchestrationAdmissionLimits,
): ManagedAgentOrchestrationAdmissionLimits {
  return {
    maxChildren: requirePositiveInteger(input.maxChildren, "Managed orchestration max children must be greater than zero"),
    routeHealth: requireAvailability(input.routeHealth, "route health"),
    budget: requireAvailability(input.budget, "budget"),
    workspace: requireAvailability(input.workspace, "workspace"),
    taskRisk: requireTaskRisk(input.taskRisk),
  };
}

function requireIsolationPolicy(
  mode: ManagedAgentOrchestrationMode,
  input: ManagedAgentOrchestrationIsolationPolicy | undefined,
): ManagedAgentOrchestrationIsolationPolicy {
  if (input === undefined) {
    throw new Error("Managed orchestration isolation policy is required");
  }
  const isolation: ManagedAgentOrchestrationIsolationPolicy = {
    required: input.required === true,
    reason: requireText(input.reason, "Managed orchestration isolation reason is required"),
    ...(input.workingDirectoryMode !== undefined
      ? { workingDirectoryMode: requireWorkingDirectoryMode(input.workingDirectoryMode) }
      : {}),
  };
  if (mode === "fan-out") {
    if (!isolation.required) {
      throw new Error("Managed fan-out orchestration requires isolated child workspaces");
    }
    if (isolation.workingDirectoryMode !== "isolated-worktree") {
      throw new Error("Managed fan-out orchestration requires isolated-worktree working directory mode");
    }
  }
  return isolation;
}

function requireOrchestrationMode(value: ManagedAgentOrchestrationMode): ManagedAgentOrchestrationMode {
  if (MANAGED_AGENT_ORCHESTRATION_MODES.includes(value)) {
    return value;
  }
  throw new Error(`Unsupported managed orchestration mode: ${value as string}`);
}

function requireEvidenceKind(value: ManagedAgentOrchestrationEvidenceKind): ManagedAgentOrchestrationEvidenceKind {
  if (MANAGED_AGENT_ORCHESTRATION_EVIDENCE_KINDS.includes(value)) {
    return value;
  }
  throw new Error(`Unsupported managed orchestration evidence kind: ${value as string}`);
}

function requireMergePolicyMode(value: ManagedAgentOrchestrationMergePolicyMode): ManagedAgentOrchestrationMergePolicyMode {
  if (
    value === "compare-and-select" ||
    value === "collect-all" ||
    value === "first-success" ||
    value === "manual-review-required" ||
    value === "none"
  ) {
    return value;
  }
  throw new Error(`Unsupported managed orchestration merge policy: ${value as string}`);
}

function requireWorkingDirectoryMode(value: ManagedAgentWorkingDirectory["mode"]): ManagedAgentWorkingDirectory["mode"] {
  if (value === "read-only" || value === "workspace-write" || value === "isolated-worktree" || value === "sandbox") {
    return value;
  }
  throw new Error(`Unsupported managed orchestration working directory mode: ${value as string}`);
}

function requireTerminalLifecycleState(value: ManagedAgentLifecycleState): ManagedAgentLifecycleState {
  if (
    value === "completed" ||
    value === "failed" ||
    value === "timed_out" ||
    value === "cancelled" ||
    value === "stale" ||
    value === "recovered"
  ) {
    return value;
  }
  throw new Error(`Managed orchestration child result lifecycle state must be terminal: ${value as string}`);
}

function requireLifecycleSuccessConsistency(lifecycleState: ManagedAgentLifecycleState, success: boolean): void {
  const successfulLifecycle = lifecycleState === "completed" || lifecycleState === "recovered";
  if (success && !successfulLifecycle) {
    throw new Error("Managed orchestration child result success must use completed or recovered lifecycle state");
  }
  if (!success && successfulLifecycle) {
    throw new Error("Managed orchestration child result successful lifecycle state must report success");
  }
}

function requireAvailability(
  value: ManagedAgentOrchestrationAvailability,
  label: string,
): ManagedAgentOrchestrationAvailability {
  if (value === "available" || value === "unavailable") {
    return value;
  }
  throw new Error(`Unsupported managed orchestration ${label} availability: ${value as string}`);
}

function requireTaskRisk(value: ManagedAgentOrchestrationTaskRisk): ManagedAgentOrchestrationTaskRisk {
  if (value === "low" || value === "medium" || value === "high" || value === "unknown") {
    return value;
  }
  throw new Error(`Unsupported managed orchestration task risk: ${value as string}`);
}

function requireNonEmptyArray<T>(value: readonly T[], message: string): readonly T[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(message);
  }
  return value;
}

function requirePositiveInteger(value: number, message: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(message);
  }
  return value;
}

function requireText(value: string | undefined, message: string): string {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    throw new Error(message);
  }
  return trimmed;
}
