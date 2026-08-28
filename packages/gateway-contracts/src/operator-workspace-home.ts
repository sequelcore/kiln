import type {
  OperatorCockpitReadOnlyViewState,
} from "./operator-cockpit-view-state.js";
import type {
  OperatorCockpitActionTarget,
  OperatorGatewayTargetIdentity,
} from "./operator-cockpit-target.js";
import type {
  OperatorAttentionSummary,
} from "./operator-attention.js";
import type {
  OperatorSessionEvent,
} from "./frames.js";
import type {
  KilnConfigSetupSnapshot,
  KilnConfigSourceStatus,
  KilnProjectionTargetStatus,
} from "./config-status.js";
import {
  isOperatorGovernedWorkItemBlocking,
  projectOperatorGovernedWorkItems,
  type OperatorGovernedWorkItemProjection,
} from "./operator-governed-work.js";

export interface OperatorWorkspaceGatewayTargetSummary {
  readonly instanceId: string;
  readonly label: string;
  readonly gatewayTarget: OperatorGatewayTargetIdentity;
  readonly sessionCount: number;
  readonly eventCount: number;
  readonly managedInvocationCount: number;
  readonly toolCallCount: number;
  readonly resourceLinkCount: number;
  readonly totalCostUsd: number;
}

export interface OperatorWorkspaceSessionSummary {
  readonly instanceId: string;
  readonly gatewayTargetId?: string;
  readonly sessionId: string;
  readonly eventCount: number;
  readonly managedInvocationCount: number;
  readonly toolCallCount: number;
  readonly resourceLinkCount: number;
  readonly totalCostUsd: number;
  readonly latestEventId: string;
  readonly latestEventTitle: string;
}

export interface OperatorWorkspaceManagedAgentSummary {
  readonly totalCount: number;
  readonly activeCount: number;
  readonly attentionCount: number;
}

export interface OperatorWorkspaceWorkItemSummary {
  readonly workItemId: string;
  readonly sessionId: string;
  readonly summary: string;
  readonly status: string;
  readonly resourceUri: string;
  readonly updatedAt: string;
  readonly workflowProfile?: string;
  readonly authorityProfile?: string;
  readonly assignedAgentProfile?: string;
  readonly pendingPauseCount: number;
  readonly missingEvidenceCount: number;
  readonly failedVerificationGateCount: number;
}

export interface OperatorWorkspaceWorkSummary {
  readonly totalCount: number;
  readonly activeCount: number;
  readonly blockedCount: number;
  readonly missingEvidenceCount: number;
  readonly goalCount: number;
  readonly activeGoalCount: number;
  readonly items: readonly OperatorWorkspaceWorkItemSummary[];
}

export interface OperatorWorkspaceApprovalItem {
  readonly approvalId: string;
  readonly sessionId: string;
  readonly requestedAt: string;
  readonly action: string;
  readonly justification?: string;
}

export interface OperatorWorkspaceApprovalSummary {
  readonly pendingCount: number;
  readonly resolvedCount: number;
  readonly items: readonly OperatorWorkspaceApprovalItem[];
}

export type OperatorWorkspaceHealthStatus = "healthy" | "degraded" | "blocked" | "unknown";

export interface OperatorWorkspaceConfigHealthItem {
  readonly id: string;
  readonly status: OperatorWorkspaceHealthStatus;
  readonly summary: string;
  readonly source?: string;
  readonly recommendation?: string;
}

export interface OperatorWorkspaceConfigHealthSummary {
  readonly status: OperatorWorkspaceHealthStatus;
  readonly issueCount: number;
  readonly items: readonly OperatorWorkspaceConfigHealthItem[];
}

export interface OperatorWorkspaceRouteHealthItem {
  readonly routeId: string;
  readonly routeSource: string;
  readonly admissionStatus: OperatorWorkspaceHealthStatus;
  readonly capturedAt: string;
  readonly executionHealth: {
    readonly status: "healthy" | "degraded" | "unknown";
    readonly capturedAt?: string;
    readonly lastTerminalState?: "completed" | "failed" | "timed_out" | "cancelled";
    readonly errorCode?: string;
    readonly reason?: string;
  };
  readonly providerId?: string;
  readonly model?: string;
  readonly adapterKind?: string;
  readonly executionMode?: string;
  readonly admissionReason?: string;
}

export interface OperatorWorkspaceRouteHealthSummary {
  readonly totalCount: number;
  readonly admissionReadyCount: number;
  readonly admissionDegradedCount: number;
  readonly admissionBlockedCount: number;
  readonly admissionUnknownCount: number;
  readonly executionHealthyCount: number;
  readonly executionDegradedCount: number;
  readonly executionUnknownCount: number;
  readonly items: readonly OperatorWorkspaceRouteHealthItem[];
}

export interface OperatorWorkspaceProviderReadinessItem {
  readonly providerId: string;
  readonly status: "live-proven" | "configured" | "unproven" | "unknown";
  readonly capturedAt: string;
  readonly model?: string;
  readonly source?: string;
  readonly requiresToolCalls?: boolean;
}

export interface OperatorWorkspaceProviderReadinessSummary {
  readonly totalCount: number;
  readonly liveProvenCount: number;
  readonly configuredCount: number;
  readonly unprovenCount: number;
  readonly unknownCount: number;
  readonly items: readonly OperatorWorkspaceProviderReadinessItem[];
}

export interface OperatorWorkspaceGatewayHealthItem {
  readonly targetId: string;
  readonly kind: string;
  readonly trust: string;
  readonly status: OperatorWorkspaceHealthStatus;
  readonly sessionCount: number;
  readonly label?: string;
  readonly gatewayUrl?: string;
  readonly appId?: string;
  readonly tenantId?: string;
}

export interface OperatorWorkspaceGatewayHealthSummary {
  readonly status: OperatorWorkspaceHealthStatus;
  readonly targetCount: number;
  readonly localCount: number;
  readonly remoteCount: number;
  readonly appTargetCount: number;
  readonly tenantTargetCount: number;
  readonly items: readonly OperatorWorkspaceGatewayHealthItem[];
}

export interface OperatorWorkspaceResourceSummary {
  readonly totalCount: number;
  readonly linkedResourceCount: number;
  readonly items: readonly OperatorWorkspaceResourceItem[];
}

export interface OperatorWorkspaceResourceItem {
  readonly uri: string;
  readonly target: OperatorCockpitActionTarget;
  readonly title?: string;
  readonly label?: string;
  readonly mimeType?: string;
  readonly size?: number;
  readonly relation?: string;
}

export interface OperatorWorkspaceHomeProjection {
  readonly mode: "read-only";
  readonly projectedAt: string;
  readonly gatewayTargets: readonly OperatorWorkspaceGatewayTargetSummary[];
  readonly sessions: readonly OperatorWorkspaceSessionSummary[];
  readonly work: OperatorWorkspaceWorkSummary;
  readonly managedAgents: OperatorWorkspaceManagedAgentSummary;
  readonly approvals: OperatorWorkspaceApprovalSummary;
  readonly configHealth: OperatorWorkspaceConfigHealthSummary;
  readonly routeHealth: OperatorWorkspaceRouteHealthSummary;
  readonly providerReadiness: OperatorWorkspaceProviderReadinessSummary;
  readonly gatewayHealth: OperatorWorkspaceGatewayHealthSummary;
  readonly resources: OperatorWorkspaceResourceSummary;
  readonly attention: OperatorAttentionSummary;
}

export interface OperatorWorkspaceHomeProjectionInput {
  readonly projectedAt: string;
  readonly cockpitView: OperatorCockpitReadOnlyViewState;
  readonly events?: readonly OperatorSessionEvent[];
  readonly configHealth?: OperatorWorkspaceConfigHealthSummary;
}

export interface OperatorWorkspaceHomeEmptyProjectionInput {
  readonly projectedAt: string;
}

export function createEmptyOperatorWorkspaceHomeProjection(
  input: OperatorWorkspaceHomeEmptyProjectionInput,
): OperatorWorkspaceHomeProjection {
  return {
    mode: "read-only",
    projectedAt: input.projectedAt,
    gatewayTargets: [],
    sessions: [],
    work: EMPTY_WORK_SUMMARY,
    managedAgents: {
      totalCount: 0,
      activeCount: 0,
      attentionCount: 0,
    },
    approvals: EMPTY_APPROVAL_SUMMARY,
    configHealth: EMPTY_CONFIG_HEALTH_SUMMARY,
    routeHealth: EMPTY_ROUTE_HEALTH_SUMMARY,
    providerReadiness: EMPTY_PROVIDER_READINESS_SUMMARY,
    gatewayHealth: EMPTY_GATEWAY_HEALTH_SUMMARY,
    resources: {
      totalCount: 0,
      linkedResourceCount: 0,
      items: [],
    },
    attention: {
      items: [],
      totalCount: 0,
      actionRequiredCount: 0,
      blockedCount: 0,
      failedCount: 0,
    },
  };
}

export function createOperatorWorkspaceHomeProjection(
  input: OperatorWorkspaceHomeProjectionInput,
): OperatorWorkspaceHomeProjection {
  const projection = input.cockpitView.projection;
  const resourceItems = collectResourceItems(input.cockpitView);
  const events = input.events ?? [];
  return {
    mode: "read-only",
    projectedAt: input.projectedAt,
    gatewayTargets: projection.instances.map((instance) => ({
      instanceId: instance.instanceId,
      label: instance.label,
      gatewayTarget: instance.gatewayTarget,
      sessionCount: instance.sessionCount,
      eventCount: instance.eventCount,
      managedInvocationCount: instance.managedInvocationCount,
      toolCallCount: instance.toolCallCount,
      resourceLinkCount: instance.resourceLinkCount,
      totalCostUsd: instance.totalCostUsd,
    })),
    sessions: projection.sessions.map((session) => ({
      instanceId: session.instanceId,
      ...(session.target.gatewayTargetId !== undefined ? { gatewayTargetId: session.target.gatewayTargetId } : {}),
      sessionId: session.sessionId,
      eventCount: session.eventCount,
      managedInvocationCount: session.managedInvocationCount,
      toolCallCount: session.toolCallCount,
      resourceLinkCount: session.resourceLinkCount,
      totalCostUsd: session.totalCostUsd,
      latestEventId: session.latestEventId,
      latestEventTitle: session.latestEventTitle,
    })),
    work: createWorkSummary(events),
    managedAgents: {
      totalCount: input.cockpitView.managedAgents.items.length,
      activeCount: input.cockpitView.managedAgents.activeCount,
      attentionCount: input.cockpitView.managedAgents.attentionCount,
    },
    approvals: createApprovalSummary(events),
    configHealth: input.configHealth ?? EMPTY_CONFIG_HEALTH_SUMMARY,
    routeHealth: createRouteHealthSummary(events),
    providerReadiness: createProviderReadinessSummary(events),
    gatewayHealth: createGatewayHealthSummary(projection.instances.map((instance) => ({
      gatewayTarget: instance.gatewayTarget,
      sessionCount: instance.sessionCount,
    }))),
    resources: {
      totalCount: resourceItems.length,
      linkedResourceCount: resourceItems.length,
      items: resourceItems,
    },
    attention: input.cockpitView.attention,
  };
}

export function createOperatorWorkspaceConfigHealthSummary(
  setup: KilnConfigSetupSnapshot,
): OperatorWorkspaceConfigHealthSummary {
  const items: OperatorWorkspaceConfigHealthItem[] = [];
  const projectContextStatus = configSourceStatusToHealth(setup.projectContext.status);
  if (projectContextStatus !== "healthy" || setup.projectContext.recommendation !== "none") {
    items.push({
      id: "project-context",
      status: projectContextStatus,
      summary: `Project context is ${setup.projectContext.status}.`,
      source: setup.projectContext.path,
      ...(setup.projectContext.recommendation !== "none" ? { recommendation: setup.projectContext.recommendation } : {}),
    });
  }
  for (const instruction of setup.projectInstructions) {
    const status = projectInstructionStatusToHealth(instruction.status);
    if (status === "healthy" && instruction.recommendation === "none") {
      continue;
    }
    items.push({
      id: instruction.targetId,
      status,
      summary: instruction.details ?? `Project instruction ${instruction.target} is ${instruction.status}.`,
      source: instruction.path,
      ...(instruction.recommendation !== "none" ? { recommendation: instruction.recommendation } : {}),
    });
  }
  for (const projection of setup.nativeProjections) {
    const status = projectionStatusToHealth(projection.status);
    if (status === "healthy") {
      continue;
    }
    items.push({
      id: projection.targetId,
      status,
      summary: projection.details ?? `Native projection is ${projection.status}.`,
      source: projection.path,
    });
  }
  for (const integrity of setup.permissionIntegrity) {
    if (integrity.classification === "current-verified") {
      continue;
    }
    items.push({
      id: `permission-integrity:${integrity.harness}`,
      status: permissionIntegrityStatus(integrity.classification),
      summary: `${displayHarnessName(integrity.harness)} permission integrity is ${integrity.classification}.`,
      recommendation: integrity.recommendation,
    });
  }
  return {
    status: setup.recommendedActions.some((action) => action !== "none") || items.length > 0
      ? summarizeHealthStatus(items.map((item) => item.status))
      : "healthy",
    issueCount: items.length,
    items,
  };
}

function permissionIntegrityStatus(classification: string): OperatorWorkspaceHealthStatus {
  if (classification === "runtime-policy-mismatch" || classification === "dangerous-unapproved-broadening") {
    return "blocked";
  }
  return "degraded";
}

function displayHarnessName(harness: string): string {
  if (harness === "codex") return "Codex";
  if (harness === "claude-code") return "Claude Code";
  if (harness === "opencode") return "OpenCode";
  return harness;
}

const EMPTY_WORK_SUMMARY: OperatorWorkspaceWorkSummary = {
  totalCount: 0,
  activeCount: 0,
  blockedCount: 0,
  missingEvidenceCount: 0,
  goalCount: 0,
  activeGoalCount: 0,
  items: [],
};

const EMPTY_APPROVAL_SUMMARY: OperatorWorkspaceApprovalSummary = {
  pendingCount: 0,
  resolvedCount: 0,
  items: [],
};

const EMPTY_CONFIG_HEALTH_SUMMARY: OperatorWorkspaceConfigHealthSummary = {
  status: "unknown",
  issueCount: 0,
  items: [],
};

const EMPTY_ROUTE_HEALTH_SUMMARY: OperatorWorkspaceRouteHealthSummary = {
  totalCount: 0,
  admissionReadyCount: 0,
  admissionDegradedCount: 0,
  admissionBlockedCount: 0,
  admissionUnknownCount: 0,
  executionHealthyCount: 0,
  executionDegradedCount: 0,
  executionUnknownCount: 0,
  items: [],
};

const EMPTY_PROVIDER_READINESS_SUMMARY: OperatorWorkspaceProviderReadinessSummary = {
  totalCount: 0,
  liveProvenCount: 0,
  configuredCount: 0,
  unprovenCount: 0,
  unknownCount: 0,
  items: [],
};

const EMPTY_GATEWAY_HEALTH_SUMMARY: OperatorWorkspaceGatewayHealthSummary = {
  status: "unknown",
  targetCount: 0,
  localCount: 0,
  remoteCount: 0,
  appTargetCount: 0,
  tenantTargetCount: 0,
  items: [],
};

function createWorkSummary(events: readonly OperatorSessionEvent[]): OperatorWorkspaceWorkSummary {
  if (events.length === 0) {
    return EMPTY_WORK_SUMMARY;
  }
  const workItems = projectOperatorGovernedWorkItems(events);
  const goals = new Map<string, string>();

  for (const event of events) {
    const payload = asRecord(event.payload);
    if (event.kind.startsWith("goal.")) {
      const goal = asRecord(payload.goal);
      const goalId = readString(goal.id) ?? readString(payload.goalId);
      if (goalId) {
        goals.set(goalId, readString(goal.status) ?? goalStatusFromEventKind(event.kind));
      }
      continue;
    }
  }

  const items = workItems.map(toWorkspaceWorkItemSummary);
  return {
    totalCount: items.length,
    activeCount: items.filter((item) => !isTerminalWorkStatus(item.status)).length,
    blockedCount: workItems.filter(isOperatorGovernedWorkItemBlocking).length,
    missingEvidenceCount: items.reduce((total, item) => total + item.missingEvidenceCount, 0),
    goalCount: goals.size,
    activeGoalCount: [...goals.values()].filter((status) => status === "active").length,
    items,
  };
}

function createApprovalSummary(events: readonly OperatorSessionEvent[]): OperatorWorkspaceApprovalSummary {
  if (events.length === 0) {
    return EMPTY_APPROVAL_SUMMARY;
  }
  const pending = new Map<string, OperatorWorkspaceApprovalItem>();
  let resolvedCount = 0;

  for (const event of [...events].sort(compareEvents)) {
    const payload = asRecord(event.payload);
    if (event.kind === "approval_requested") {
      const approvalId = readString(payload.approvalId) ?? event.eventId;
      const justification = readString(payload.justification);
      pending.set(approvalId, {
        approvalId,
        sessionId: readString(payload.sessionId) ?? event.kilnSessionId,
        requestedAt: event.timestamp,
        action: readString(payload.action) ?? "Approval required",
        ...(justification ? { justification } : {}),
      });
      continue;
    }
    if (event.kind === "approval_resolved") {
      resolvedCount += 1;
      const resolution = asRecord(payload.resolution);
      const approvalId = readString(payload.approvalId) ?? readString(resolution.approvalId);
      if (approvalId) {
        pending.delete(approvalId);
      }
    }
  }

  return {
    pendingCount: pending.size,
    resolvedCount,
    items: [...pending.values()].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
  };
}

function createRouteHealthSummary(events: readonly OperatorSessionEvent[]): OperatorWorkspaceRouteHealthSummary {
  if (events.length === 0) {
    return EMPTY_ROUTE_HEALTH_SUMMARY;
  }
  const byRoute = new Map<string, OperatorWorkspaceRouteHealthItem>();
  for (const event of [...events].sort((left, right) =>
    left.sequence - right.sequence || left.timestamp.localeCompare(right.timestamp)
  )) {
    const payload = asRecord(event.payload);
    const capabilitySnapshot = asRecord(payload.capabilitySnapshot);
    const routeId = readString(capabilitySnapshot.routeId) ?? readString(payload.routeId);
    if (!routeId) {
      continue;
    }
    const routeHealth = asRecord(capabilitySnapshot.routeHealth);
    const providerRoute = readFirstRecord(capabilitySnapshot.providerRoute, payload.providerRoute);
    const providerId = readString(providerRoute.providerId);
    const model = readString(providerRoute.model);
    const adapterKind = readString(capabilitySnapshot.adapterKind);
    const executionMode = readString(capabilitySnapshot.executionMode);
    const admissionReason = readString(routeHealth.reason);
    const previous = byRoute.get(routeId);
    const terminal = routeExecutionHealth(event, payload);
    byRoute.set(routeId, {
      routeId,
      routeSource: readString(capabilitySnapshot.routeSource) ?? readString(payload.routeSource) ?? previous?.routeSource ?? "unknown",
      admissionStatus: readString(routeHealth.status)
        ? normalizeHealthStatus(readString(routeHealth.status))
        : previous?.admissionStatus ?? "unknown",
      capturedAt: readString(capabilitySnapshot.capturedAt) ?? previous?.capturedAt ?? event.timestamp,
      executionHealth: terminal ?? previous?.executionHealth ?? { status: "unknown" },
      ...(providerId ?? previous?.providerId ? { providerId: providerId ?? previous!.providerId } : {}),
      ...(model ?? previous?.model ? { model: model ?? previous!.model } : {}),
      ...(adapterKind ?? previous?.adapterKind ? { adapterKind: adapterKind ?? previous!.adapterKind } : {}),
      ...(executionMode ?? previous?.executionMode ? { executionMode: executionMode ?? previous!.executionMode } : {}),
      ...(admissionReason ?? previous?.admissionReason
        ? { admissionReason: admissionReason ?? previous!.admissionReason }
        : {}),
    });
  }
  const items = [...byRoute.values()].sort((a, b) => a.routeId.localeCompare(b.routeId));
  return {
    totalCount: items.length,
    admissionReadyCount: items.filter((item) => item.admissionStatus === "healthy").length,
    admissionDegradedCount: items.filter((item) => item.admissionStatus === "degraded").length,
    admissionBlockedCount: items.filter((item) => item.admissionStatus === "blocked").length,
    admissionUnknownCount: items.filter((item) => item.admissionStatus === "unknown").length,
    executionHealthyCount: items.filter((item) => item.executionHealth.status === "healthy").length,
    executionDegradedCount: items.filter((item) => item.executionHealth.status === "degraded").length,
    executionUnknownCount: items.filter((item) => item.executionHealth.status === "unknown").length,
    items,
  };
}

function routeExecutionHealth(
  event: OperatorSessionEvent,
  payload: Record<string, unknown>,
): OperatorWorkspaceRouteHealthItem["executionHealth"] | undefined {
  if (event.kind === "agent_invocation_completed") {
    return { status: "healthy", capturedAt: event.timestamp, lastTerminalState: "completed" };
  }
  if (event.kind === "agent_invocation_failed") {
    const lifecycleState = readString(payload.lifecycleState) === "timed_out" ? "timed_out" : "failed";
    const errorCode = readString(payload.errorCode);
    const reason = readString(payload.errorMessage);
    return {
      status: "degraded",
      capturedAt: event.timestamp,
      lastTerminalState: lifecycleState,
      ...(errorCode ? { errorCode } : {}),
      ...(reason ? { reason } : {}),
    };
  }
  if (event.kind === "agent_invocation_cancelled") {
    const reason = readString(payload.reason);
    return {
      status: "unknown",
      capturedAt: event.timestamp,
      lastTerminalState: "cancelled",
      ...(reason ? { reason } : {}),
    };
  }
  return undefined;
}

function createProviderReadinessSummary(events: readonly OperatorSessionEvent[]): OperatorWorkspaceProviderReadinessSummary {
  if (events.length === 0) {
    return EMPTY_PROVIDER_READINESS_SUMMARY;
  }
  const byProviderModel = new Map<string, OperatorWorkspaceProviderReadinessItem>();
  for (const event of events) {
    const payload = asRecord(event.payload);
    const capabilitySnapshot = asRecord(payload.capabilitySnapshot);
    const providerRoute = readFirstRecord(capabilitySnapshot.providerRoute, payload.providerRoute);
    const providerId = readString(providerRoute.providerId);
    if (!providerId) {
      continue;
    }
    const model = readString(providerRoute.model);
    const providerModelProof = asRecord(capabilitySnapshot.providerModelProof);
    const proofStatus = readString(providerModelProof.status);
    if (!proofStatus) {
      continue;
    }
    const status = normalizeProviderReadinessStatus(proofStatus);
    const source = readString(providerModelProof.source);
    byProviderModel.set(`${providerId}:${model ?? ""}`, {
      providerId,
      status,
      capturedAt: readString(capabilitySnapshot.capturedAt) ?? event.timestamp,
      ...(model ? { model } : {}),
      ...(source ? { source } : {}),
      ...(typeof providerModelProof.requiresToolCalls === "boolean" ? { requiresToolCalls: providerModelProof.requiresToolCalls } : {}),
    });
  }
  const items = [...byProviderModel.values()].sort((a, b) => `${a.providerId}:${a.model ?? ""}`.localeCompare(`${b.providerId}:${b.model ?? ""}`));
  return {
    totalCount: items.length,
    liveProvenCount: items.filter((item) => item.status === "live-proven").length,
    configuredCount: items.filter((item) => item.status === "configured").length,
    unprovenCount: items.filter((item) => item.status === "unproven").length,
    unknownCount: items.filter((item) => item.status === "unknown").length,
    items,
  };
}

function createGatewayHealthSummary(input: readonly {
  readonly gatewayTarget: OperatorGatewayTargetIdentity;
  readonly sessionCount: number;
}[]): OperatorWorkspaceGatewayHealthSummary {
  if (input.length === 0) {
    return EMPTY_GATEWAY_HEALTH_SUMMARY;
  }
  const items = input.map(({ gatewayTarget, sessionCount }) => ({
    targetId: gatewayTarget.targetId,
    kind: gatewayTarget.kind,
    trust: gatewayTarget.trust,
    status: gatewayTarget.trust === "local" ? "healthy" as const : "unknown" as const,
    sessionCount,
    ...(gatewayTarget.label !== undefined ? { label: gatewayTarget.label } : {}),
    ...(gatewayTarget.gatewayUrl !== undefined ? { gatewayUrl: gatewayTarget.gatewayUrl } : {}),
    ...(gatewayTarget.appId !== undefined ? { appId: gatewayTarget.appId } : {}),
    ...(gatewayTarget.tenantId !== undefined ? { tenantId: gatewayTarget.tenantId } : {}),
  }));
  return {
    status: summarizeHealthStatus(items.map((item) => item.status)),
    targetCount: items.length,
    localCount: items.filter((item) => item.trust === "local").length,
    remoteCount: items.filter((item) => item.trust === "remote").length,
    appTargetCount: items.filter((item) => item.kind === "local-app-gateway" || item.kind === "remote-app-gateway").length,
    tenantTargetCount: items.filter((item) => item.tenantId !== undefined).length,
    items,
  };
}

function toWorkspaceWorkItemSummary(
  workItem: OperatorGovernedWorkItemProjection,
): OperatorWorkspaceWorkItemSummary {
  return {
    workItemId: workItem.id,
    sessionId: workItem.sessionId ?? "unknown",
    summary: workItem.summary,
    status: workItem.status,
    resourceUri: workItem.resourceUri,
    updatedAt: workItem.updatedAt,
    ...(workItem.workflowProfile ? { workflowProfile: workItem.workflowProfile } : {}),
    ...(workItem.authorityProfile ? { authorityProfile: workItem.authorityProfile } : {}),
    ...(workItem.assignedAgentProfile ? { assignedAgentProfile: workItem.assignedAgentProfile } : {}),
    pendingPauseCount: workItem.pendingPauseRequirementCount,
    missingEvidenceCount: workItem.missingEvidence.length
      + workItem.missingGoalEvidence.length
      + workItem.missingVerificationGates.length
      + (workItem.missingResidualRisk ? 1 : 0),
    failedVerificationGateCount: workItem.failedVerificationGates.length,
  };
}

function isTerminalWorkStatus(status: string): boolean {
  return status === "completed" || status === "cancelled";
}

function goalStatusFromEventKind(kind: string): string {
  if (kind === "goal.completed") return "completed";
  if (kind === "goal.failed") return "failed";
  if (kind === "goal.cancelled") return "cancelled";
  return "active";
}

function normalizeHealthStatus(status: string | null): OperatorWorkspaceHealthStatus {
  if (status === "healthy" || status === "degraded" || status === "blocked") {
    return status;
  }
  return "unknown";
}

function normalizeProviderReadinessStatus(status: string | null): OperatorWorkspaceProviderReadinessItem["status"] {
  if (status === "live-proven" || status === "configured" || status === "unproven") {
    return status;
  }
  return "unknown";
}

function configSourceStatusToHealth(status: KilnConfigSourceStatus): OperatorWorkspaceHealthStatus {
  if (status === "valid") {
    return "healthy";
  }
  if (status === "invalid") {
    return "blocked";
  }
  return "degraded";
}

function projectionStatusToHealth(status: KilnProjectionTargetStatus): OperatorWorkspaceHealthStatus {
  if (status === "current" || status === "managed") {
    return "healthy";
  }
  if (status === "drifted") {
    return "blocked";
  }
  return "degraded";
}

function projectInstructionStatusToHealth(
  status: KilnConfigSetupSnapshot["projectInstructions"][number]["status"],
): OperatorWorkspaceHealthStatus {
  if (status === "project-owned") {
    return "healthy";
  }
  if (status === "unreadable") {
    return "blocked";
  }
  return "degraded";
}

function summarizeHealthStatus(statuses: readonly OperatorWorkspaceHealthStatus[]): OperatorWorkspaceHealthStatus {
  if (statuses.length === 0) {
    return "unknown";
  }
  if (statuses.some((status) => status === "blocked")) {
    return "blocked";
  }
  if (statuses.some((status) => status === "degraded" || status === "unknown")) {
    return "degraded";
  }
  return "healthy";
}

function collectResourceItems(
  cockpitView: OperatorCockpitReadOnlyViewState,
): readonly OperatorWorkspaceResourceItem[] {
  const byUri = new Map<string, OperatorWorkspaceResourceItem>();
  for (const entry of cockpitView.projection.timeline) {
    for (const resource of entry.resourceLinks ?? []) {
      if (byUri.has(resource.uri)) {
        continue;
      }
      byUri.set(resource.uri, {
        uri: resource.uri,
        target: resource.target,
        ...(resource.title !== undefined ? { title: resource.title } : {}),
        ...(resource.label !== undefined ? { label: resource.label } : {}),
        ...(resource.mimeType !== undefined ? { mimeType: resource.mimeType } : {}),
        ...(resource.size !== undefined ? { size: resource.size } : {}),
        ...(resource.relation !== undefined ? { relation: resource.relation } : {}),
      });
    }
  }
  return [...byUri.values()].sort((a, b) => a.uri.localeCompare(b.uri));
}

function compareEvents(a: OperatorSessionEvent, b: OperatorSessionEvent): number {
  if (a.sequence !== b.sequence) {
    return a.sequence - b.sequence;
  }
  const timestampCompare = a.timestamp.localeCompare(b.timestamp);
  return timestampCompare === 0 ? a.eventId.localeCompare(b.eventId) : timestampCompare;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readFirstRecord(...values: readonly unknown[]): Record<string, unknown> {
  for (const value of values) {
    const record = asRecord(value);
    if (Object.keys(record).length > 0) {
      return record;
    }
  }
  return {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
