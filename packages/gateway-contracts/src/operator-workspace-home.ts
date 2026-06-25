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
  readonly managedAgents: OperatorWorkspaceManagedAgentSummary;
  readonly resources: OperatorWorkspaceResourceSummary;
  readonly attention: OperatorAttentionSummary;
}

export interface OperatorWorkspaceHomeProjectionInput {
  readonly projectedAt: string;
  readonly cockpitView: OperatorCockpitReadOnlyViewState;
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
    managedAgents: {
      totalCount: 0,
      activeCount: 0,
      attentionCount: 0,
    },
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
    managedAgents: {
      totalCount: input.cockpitView.managedAgents.items.length,
      activeCount: input.cockpitView.managedAgents.activeCount,
      attentionCount: input.cockpitView.managedAgents.attentionCount,
    },
    resources: {
      totalCount: resourceItems.length,
      linkedResourceCount: resourceItems.length,
      items: resourceItems,
    },
    attention: input.cockpitView.attention,
  };
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
