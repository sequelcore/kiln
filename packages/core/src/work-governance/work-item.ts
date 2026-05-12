export type WorkItemStatus = "pending" | "in_progress" | "blocked" | "completed" | "cancelled";

export type WorkItemRecommendedReasoningEffort = "low" | "medium" | "high";

export interface WorkItemRoutingRecommendation {
  readonly routeId?: string;
  readonly agentProfile?: string;
  readonly reasoningEffort: WorkItemRecommendedReasoningEffort;
  readonly modelTaskSuitability: string;
  readonly rationale: string;
}

export interface WorkItemUpsertInput {
  readonly id?: string;
  readonly summary: string;
  readonly status?: WorkItemStatus;
  readonly workflowProfile: string;
  readonly risk?: string;
  readonly triggers: readonly string[];
  readonly surface?: string;
  readonly assignedAgentProfile?: string;
  readonly routeId?: string;
  readonly authorityProfile?: string;
  readonly expectedEvidence: readonly string[];
  readonly providedEvidence?: readonly string[];
  readonly verificationGates: readonly string[];
  readonly dependencies?: readonly string[];
  readonly residualRisk?: string;
  readonly planId?: string;
  readonly planHash?: string;
  readonly goalRunId?: string;
  readonly sourceWorkItemId?: string;
  readonly routingRecommendation?: WorkItemRoutingRecommendation;
}

export interface WorkItem extends WorkItemUpsertInput {
  readonly id: string;
  readonly status: WorkItemStatus;
  readonly providedEvidence: readonly string[];
  readonly dependencies: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sequence: number;
}

export interface WorkItemCompletionInput {
  readonly id: string;
  readonly providedEvidence?: readonly string[];
  readonly residualRisk?: string;
}

export interface WorkItemCompletionResult {
  readonly item: WorkItem;
  readonly missingEvidence: readonly string[];
  readonly missingResidualRisk: boolean;
}

export interface WorkItemSnapshot {
  readonly items: readonly WorkItem[];
  readonly updatedAt?: string;
  readonly sequence: number;
}

export interface WorkItemResourceChangeNotifier {
  notifyResourceUpdated(uri: string): void;
}

export interface WorkItemStoreOptions {
  readonly resourceNotifications?: WorkItemResourceChangeNotifier;
  readonly now?: () => string;
}

export class WorkItemStore {
  private readonly items = new Map<string, WorkItem>();
  private readonly now: () => string;
  private sequence = 0;
  private resourceNotifications?: WorkItemResourceChangeNotifier;

  constructor(options: WorkItemStoreOptions = {}) {
    this.resourceNotifications = options.resourceNotifications;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  setResourceChangeNotifier(resourceNotifications: WorkItemResourceChangeNotifier): void {
    this.resourceNotifications = resourceNotifications;
  }

  upsert(input: WorkItemUpsertInput): WorkItem {
    const now = this.now();
    const existing = input.id ? this.items.get(input.id) : undefined;
    const id = input.id ?? `work-${this.sequence + 1}`;
    const item: WorkItem = {
      id,
      summary: input.summary,
      status: input.status ?? existing?.status ?? "pending",
      workflowProfile: input.workflowProfile,
      risk: input.risk,
      triggers: unique(input.triggers),
      surface: input.surface,
      assignedAgentProfile: input.assignedAgentProfile,
      routeId: input.routeId,
      authorityProfile: input.authorityProfile,
      expectedEvidence: unique(input.expectedEvidence),
      providedEvidence: unique(input.providedEvidence ?? existing?.providedEvidence ?? []),
      verificationGates: unique(input.verificationGates),
      dependencies: unique(input.dependencies ?? existing?.dependencies ?? []),
      residualRisk: input.residualRisk ?? existing?.residualRisk,
      planId: input.planId ?? existing?.planId,
      planHash: input.planHash ?? existing?.planHash,
      goalRunId: input.goalRunId ?? existing?.goalRunId,
      sourceWorkItemId: input.sourceWorkItemId ?? existing?.sourceWorkItemId,
      routingRecommendation: input.routingRecommendation ?? existing?.routingRecommendation,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      sequence: ++this.sequence,
    };
    this.items.set(id, item);
    this.notifyChanged(item.id);
    return item;
  }

  list(status?: WorkItemStatus): readonly WorkItem[] {
    const items = [...this.items.values()].sort((left, right) => left.sequence - right.sequence);
    return status ? items.filter((item) => item.status === status) : items;
  }

  get(id: string): WorkItem | undefined {
    return this.items.get(id);
  }

  snapshot(status?: WorkItemStatus): WorkItemSnapshot {
    const items = this.list(status);
    return {
      items,
      updatedAt: items.at(-1)?.updatedAt,
      sequence: this.sequence,
    };
  }

  complete(input: WorkItemCompletionInput): WorkItemCompletionResult | undefined {
    const existing = this.items.get(input.id);
    if (!existing) {
      return undefined;
    }

    const providedEvidence = unique([
      ...existing.providedEvidence,
      ...(input.providedEvidence ?? []),
    ]);
    const missingEvidence = existing.expectedEvidence.filter((evidence) => !providedEvidence.includes(evidence));
    const residualRisk = input.residualRisk ?? existing.residualRisk;
    const missingResidualRisk = existing.expectedEvidence.includes("residual-risk") && !residualRisk;
    const status: WorkItemStatus = missingEvidence.length === 0 && !missingResidualRisk ? "completed" : "blocked";

    const item = this.upsert({
      ...existing,
      status,
      providedEvidence,
      residualRisk,
    });

    return {
      item,
      missingEvidence,
      missingResidualRisk,
    };
  }

  private notifyChanged(id: string): void {
    this.resourceNotifications?.notifyResourceUpdated("kiln://session/work-items");
    this.resourceNotifications?.notifyResourceUpdated(`kiln://session/work-items/${encodeURIComponent(id)}`);
  }
}

function unique<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}
