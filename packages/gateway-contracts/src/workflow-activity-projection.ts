import type { OperatorSessionEvent } from "./frames.js";
import {
  presentOperatorSessionEvent,
  type ToolResultGoalPresentation,
  type ToolResultTaskItemPresentation,
  type ToolResultTaskStatus,
  type ToolResultWorkItemPresentation,
} from "./operator-event-presentation.js";

export type WorkflowToolCallState = "running" | "completed" | "failed";

export interface WorkflowToolCallActivity {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly state: WorkflowToolCallState;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly summary?: string;
  readonly firstSequence: number;
  readonly lastSequence: number;
}

export interface WorkflowExecutionAttemptActivity {
  readonly id: string;
  readonly status: string;
  readonly executionMode?: string;
  readonly managedInvocationId?: string;
  readonly toolCalls: readonly WorkflowToolCallActivity[];
}

export interface WorkflowWorkItemActivity {
  readonly item: ToolResultWorkItemPresentation;
  readonly goalRunId?: string;
  readonly attempts: readonly WorkflowExecutionAttemptActivity[];
  readonly toolCalls: readonly WorkflowToolCallActivity[];
  readonly firstSequence: number;
  readonly lastSequence: number;
}

export interface WorkflowGoalActivity {
  readonly goal: ToolResultGoalPresentation;
  readonly status: ToolResultTaskStatus;
  readonly statusReason?: string;
  readonly workItems: readonly WorkflowWorkItemActivity[];
  readonly toolCalls: readonly WorkflowToolCallActivity[];
  readonly firstSequence: number;
  readonly lastSequence: number;
}

export interface WorkflowActivityProjection {
  readonly goals: readonly WorkflowGoalActivity[];
  readonly standaloneWorkItems: readonly WorkflowWorkItemActivity[];
  readonly unscopedToolCalls: readonly WorkflowToolCallActivity[];
  readonly consumedEventIds: readonly string[];
}

interface MutableToolCall {
  toolCallId: string;
  toolName: string;
  state: WorkflowToolCallState;
  startedAt?: string;
  completedAt?: string;
  summary?: string;
  firstSequence: number;
  lastSequence: number;
  managedInvocationId?: string;
  executionScope?: OperatorSessionEvent["executionScope"];
  eventIds: string[];
}

interface MutableAttempt {
  id: string;
  workItemId: string;
  goalRunId: string;
  status: string;
  executionMode?: string;
  managedInvocationId?: string;
  toolCallIds: string[];
}

interface MutableWorkItem {
  item: ToolResultWorkItemPresentation;
  goalRunId?: string;
  attemptIds: string[];
  toolCallIds: string[];
  firstSequence: number;
  lastSequence: number;
}

interface MutableGoal {
  goal: ToolResultGoalPresentation;
  firstSequence: number;
  lastSequence: number;
  toolCallIds: string[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readStrings(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function normalizeStatus(value: unknown): ToolResultTaskStatus {
  switch (value) {
    case "running":
    case "started":
    case "active":
      return "in_progress";
    case "complete":
    case "succeeded":
      return "completed";
    case "pending":
    case "in_progress":
    case "completed":
    case "paused":
    case "blocked":
    case "cancelled":
    case "failed":
      return value;
    default:
      return "pending";
  }
}

function workItemFromRecord(record: Record<string, unknown>): ToolResultWorkItemPresentation | undefined {
  const id = readString(record.id);
  const summary = readString(record.summary);
  if (!id || !summary) return undefined;
  const providedEvidence = new Set(readStrings(record.providedEvidence));
  const evidence: ToolResultTaskItemPresentation[] = readStrings(record.expectedEvidence).map((label) => ({
    label,
    status: providedEvidence.has(label) ? "completed" : "pending",
  }));
  const pauseRequirements = Array.isArray(record.pauseRequirements)
    ? record.pauseRequirements.flatMap((entry) => {
        if (typeof entry === "string" && entry.trim().length > 0) return [entry];
        const requirement = asRecord(entry);
        const requirementSummary = readString(requirement?.summary);
        return requirementSummary ? [requirementSummary] : [];
      })
    : [];
  return {
    id,
    summary,
    status: normalizeStatus(record.status),
    ...(readString(record.workflowProfile) ? { workflowProfile: readString(record.workflowProfile) } : {}),
    ...(readString(record.risk) ? { risk: readString(record.risk) } : {}),
    ...(readString(record.surface) ? { surface: readString(record.surface) } : {}),
    ...(readString(record.authorityProfile) ? { authorityProfile: readString(record.authorityProfile) } : {}),
    evidence,
    nextTools: [],
    pauseRequirements,
    ...(readString(record.residualRisk) ? { residualRisk: readString(record.residualRisk) } : {}),
  };
}

function goalFromRecord(record: Record<string, unknown>): ToolResultGoalPresentation | undefined {
  const id = readString(record.id);
  const objective = readString(record.objective);
  const status = readString(record.status);
  if (!id || !objective || !status) return undefined;
  const authorityEnvelope = asRecord(record.authorityEnvelope);
  const routePolicy = asRecord(record.routePolicy);
  return {
    id,
    objective,
    status,
    ...(readString(record.currentPhase) ? { phase: readString(record.currentPhase) } : {}),
    workItemIds: readStrings(record.workItemIds),
    ...(readString(authorityEnvelope?.maximumAuthority) ? { authority: readString(authorityEnvelope?.maximumAuthority) } : {}),
    ...(readString(authorityEnvelope?.escalationPolicy) ? { escalationPolicy: readString(authorityEnvelope?.escalationPolicy) } : {}),
    ...(readString(routePolicy?.workflowProfile) ? { workflowProfile: readString(routePolicy?.workflowProfile) } : {}),
    evidenceRequirements: Array.isArray(record.evidenceRequirements)
      ? record.evidenceRequirements.flatMap((entry) => {
          const requirement = asRecord(entry);
          const requirementId = readString(requirement?.id);
          const description = readString(requirement?.description);
          return requirementId && description
            ? [{ id: requirementId, description, required: requirement?.required === true }]
            : [];
        })
      : [],
    evidence: Array.isArray(record.evidence)
      ? record.evidence.flatMap((entry) => {
          const evidence = asRecord(entry);
          const requirementId = readString(evidence?.requirementId);
          const summary = readString(evidence?.summary);
          return requirementId && summary
            ? [{
                requirementId,
                summary,
                resourceUris: readStrings(evidence?.resourceUris),
                workItemIds: readStrings(evidence?.workItemIds),
              }]
            : [];
        })
      : [],
  };
}

function toolCallId(payload: Record<string, unknown>, event: OperatorSessionEvent): string | undefined {
  return readString(payload.toolCallId) ?? (event.kind.startsWith("tool_call_") ? event.eventId : undefined);
}

function managedInvocationId(event: OperatorSessionEvent): string | undefined {
  const payload = event.payload;
  const metadata = asRecord(payload.metadata);
  const scope = asRecord(payload.executionScope);
  return event.executionScope?.managedInvocationId
    ?? readString(scope?.managedInvocationId)
    ?? readString(payload.managedInvocationId)
    ?? readString(payload.invocationId)
    ?? readString(metadata?.managedInvocationId)
    ?? readString(metadata?.invocationId);
}

function completedToolState(payload: Record<string, unknown>): WorkflowToolCallState {
  const status = asRecord(payload.status);
  const state = readString(status?.state) ?? readString(payload.status);
  return payload.isError === true || state === "failed" || state === "error" ? "failed" : "completed";
}

function workflowSnapshot(event: OperatorSessionEvent): {
  readonly workItem?: ToolResultWorkItemPresentation;
  readonly workItemRecord?: Record<string, unknown>;
  readonly goal?: ToolResultGoalPresentation;
  readonly task?: NonNullable<ReturnType<typeof presentOperatorSessionEvent>["toolPresentation"]>["task"];
} {
  const payload = event.payload;
  const metadata = asRecord(payload.metadata);
  const rawWorkItem = asRecord(payload.workItem) ?? asRecord(metadata?.item);
  const rawGoal = asRecord(payload.goal) ?? asRecord(metadata?.goal);
  const presentation = presentOperatorSessionEvent(event).toolPresentation;
  return {
    ...(presentation?.workItem || rawWorkItem
      ? { workItem: presentation?.workItem ?? workItemFromRecord(rawWorkItem!), workItemRecord: rawWorkItem }
      : {}),
    ...(presentation?.goal || rawGoal
      ? { goal: presentation?.goal ?? goalFromRecord(rawGoal!) }
      : {}),
    ...(presentation?.task ? { task: presentation.task } : {}),
  };
}

function freezeToolCall(tool: MutableToolCall): WorkflowToolCallActivity {
  return {
    toolCallId: tool.toolCallId,
    toolName: tool.toolName,
    state: tool.state,
    ...(tool.startedAt ? { startedAt: tool.startedAt } : {}),
    ...(tool.completedAt ? { completedAt: tool.completedAt } : {}),
    ...(tool.summary ? { summary: tool.summary } : {}),
    firstSequence: tool.firstSequence,
    lastSequence: tool.lastSequence,
  };
}

function projectedGoalStatus(
  goal: ToolResultGoalPresentation,
  workItems: readonly WorkflowWorkItemActivity[],
): Pick<WorkflowGoalActivity, "status" | "statusReason"> {
  const status = normalizeStatus(goal.status);
  if (
    status === "in_progress"
    && workItems.length > 0
    && workItems.every((entry) => normalizeStatus(entry.item.status) === "completed")
  ) {
    const recorded = new Set(goal.evidence.map((evidence) => evidence.requirementId));
    const missing = goal.evidenceRequirements
      .filter((requirement) => requirement.required && !recorded.has(requirement.id))
      .map((requirement) => requirement.id);
    return {
      status: "blocked",
      statusReason: missing.length > 0
        ? `Missing goal evidence: ${missing.join(", ")}`
        : "Goal closeout is missing",
    };
  }
  return { status };
}

export function projectWorkflowActivity(
  sourceEvents: readonly OperatorSessionEvent[],
): WorkflowActivityProjection {
  const events = [...sourceEvents].sort((left, right) => {
    const sequence = left.sequence - right.sequence;
    return sequence === 0 ? left.eventId.localeCompare(right.eventId) : sequence;
  });
  const goals = new Map<string, MutableGoal>();
  const workItems = new Map<string, MutableWorkItem>();
  const attempts = new Map<string, MutableAttempt>();
  const invocationAttemptIds = new Map<string, string>();
  const tools = new Map<string, MutableToolCall>();
  const consumedEventIds = new Set<string>();

  for (const event of events) {
    const payload = event.payload;
    const snapshot = workflowSnapshot(event);
    if (snapshot.goal) {
      const previous = goals.get(snapshot.goal.id);
      goals.set(snapshot.goal.id, {
        goal: snapshot.goal,
        firstSequence: previous?.firstSequence ?? event.sequence,
        lastSequence: event.sequence,
        toolCallIds: previous?.toolCallIds ?? [],
      });
      consumedEventIds.add(event.eventId);
    }
    if (snapshot.workItem) {
      const previous = workItems.get(snapshot.workItem.id);
      const goalRunId = readString(snapshot.workItemRecord?.goalRunId) ?? previous?.goalRunId;
      workItems.set(snapshot.workItem.id, {
        item: snapshot.workItem,
        ...(goalRunId ? { goalRunId } : {}),
        attemptIds: previous?.attemptIds ?? [],
        toolCallIds: previous?.toolCallIds ?? [],
        firstSequence: previous?.firstSequence ?? event.sequence,
        lastSequence: event.sequence,
      });
      consumedEventIds.add(event.eventId);
    }
    if (snapshot.task?.workItemId) {
      const previous = workItems.get(snapshot.task.workItemId);
      const presentation = presentOperatorSessionEvent(event);
      const taskItem: ToolResultWorkItemPresentation = previous
        ? {
            ...previous.item,
            status: snapshot.task.status,
            evidence: snapshot.task.items.length > 0 ? snapshot.task.items : previous.item.evidence,
            nextTools: snapshot.task.nextTool ? [snapshot.task.nextTool] : previous.item.nextTools,
          }
        : {
            id: snapshot.task.workItemId,
            summary: presentation.title,
            status: snapshot.task.status,
            evidence: snapshot.task.items,
            nextTools: snapshot.task.nextTool ? [snapshot.task.nextTool] : [],
            pauseRequirements: snapshot.task.status === "paused" || snapshot.task.status === "blocked"
              ? snapshot.task.reason ? [snapshot.task.reason] : []
              : [],
          };
      workItems.set(snapshot.task.workItemId, {
        item: taskItem,
        ...(previous?.goalRunId ? { goalRunId: previous.goalRunId } : {}),
        attemptIds: previous?.attemptIds ?? [],
        toolCallIds: previous?.toolCallIds ?? [],
        firstSequence: previous?.firstSequence ?? event.sequence,
        lastSequence: event.sequence,
      });
      consumedEventIds.add(event.eventId);
    }

    if (event.kind === "work_item_execution_started" || event.kind === "work_item_execution_finished") {
      const attemptRecord = asRecord(payload.attempt);
      const workItemRecord = asRecord(payload.workItem);
      const id = readString(attemptRecord?.id);
      const workItemId = readString(attemptRecord?.workItemId) ?? readString(workItemRecord?.id);
      const goalRunId = readString(attemptRecord?.goalRunId) ?? readString(workItemRecord?.goalRunId);
      if (id && workItemId && goalRunId) {
        const previous = attempts.get(id);
        const invocationId = readString(attemptRecord?.managedInvocationId) ?? previous?.managedInvocationId;
        attempts.set(id, {
          id,
          workItemId,
          goalRunId,
          status: readString(attemptRecord?.status) ?? previous?.status ?? "started",
          ...(readString(attemptRecord?.executionMode) ? { executionMode: readString(attemptRecord?.executionMode) } : {}),
          ...(invocationId ? { managedInvocationId: invocationId } : {}),
          toolCallIds: previous?.toolCallIds ?? [],
        });
        if (invocationId) invocationAttemptIds.set(invocationId, id);
        const item = workItems.get(workItemId);
        if (item && !item.attemptIds.includes(id)) item.attemptIds.push(id);
      }
      consumedEventIds.add(event.eventId);
    }

    if (event.kind !== "tool_call_started" && event.kind !== "tool_call_completed") continue;
    const id = toolCallId(payload, event);
    if (!id) continue;
    const previous = tools.get(id);
    const name = readString(payload.toolName) ?? previous?.toolName ?? "tool";
    const presentation = presentOperatorSessionEvent(event);
    const invocationId = managedInvocationId(event) ?? previous?.managedInvocationId;
    const next: MutableToolCall = {
      toolCallId: id,
      toolName: name,
      state: event.kind === "tool_call_started" ? "running" : completedToolState(payload),
      ...(event.kind === "tool_call_started"
        ? { startedAt: event.timestamp, ...(previous?.completedAt ? { completedAt: previous.completedAt } : {}) }
        : { ...(previous?.startedAt ? { startedAt: previous.startedAt } : {}), completedAt: event.timestamp }),
      ...(presentation.summary ? { summary: presentation.summary } : previous?.summary ? { summary: previous.summary } : {}),
      firstSequence: previous?.firstSequence ?? event.sequence,
      lastSequence: event.sequence,
      ...(invocationId ? { managedInvocationId: invocationId } : {}),
      ...(event.executionScope ? { executionScope: event.executionScope } : {}),
      eventIds: [...(previous?.eventIds ?? []), event.eventId],
    };
    tools.set(id, next);
  }

  for (const tool of tools.values()) {
    const scope = tool.executionScope;
    const attemptId = scope?.kind === "work_item" && scope.attemptId
      ? scope.attemptId
      : tool.managedInvocationId
        ? invocationAttemptIds.get(tool.managedInvocationId)
        : undefined;
    const attempt = attemptId ? attempts.get(attemptId) : undefined;
    if (attempt) {
      if (!attempt.toolCallIds.includes(tool.toolCallId)) attempt.toolCallIds.push(tool.toolCallId);
      continue;
    }
    if (scope?.kind === "work_item") {
      const item = workItems.get(scope.workItemId);
      if (item && !item.toolCallIds.includes(tool.toolCallId)) item.toolCallIds.push(tool.toolCallId);
      continue;
    }
    if (scope?.kind === "goal") {
      const goal = goals.get(scope.goalRunId);
      if (goal && !goal.toolCallIds.includes(tool.toolCallId)) goal.toolCallIds.push(tool.toolCallId);
    }
  }

  const structuredToolCallIds = new Set<string>();
  for (const tool of tools.values()) {
    if (!tool.eventIds.some((eventId) => consumedEventIds.has(eventId))) continue;
    structuredToolCallIds.add(tool.toolCallId);
    for (const eventId of tool.eventIds) consumedEventIds.add(eventId);
  }

  const freezeAttempt = (attempt: MutableAttempt): WorkflowExecutionAttemptActivity => ({
    id: attempt.id,
    status: attempt.status,
    ...(attempt.executionMode ? { executionMode: attempt.executionMode } : {}),
    ...(attempt.managedInvocationId ? { managedInvocationId: attempt.managedInvocationId } : {}),
    toolCalls: attempt.toolCallIds
      .flatMap((id) => tools.get(id) ? [freezeToolCall(tools.get(id)!)] : [])
      .sort((left, right) => left.firstSequence - right.firstSequence),
  });
  const freezeWorkItem = (item: MutableWorkItem): WorkflowWorkItemActivity => ({
    item: item.item,
    ...(item.goalRunId ? { goalRunId: item.goalRunId } : {}),
    attempts: item.attemptIds.flatMap((id) => attempts.get(id) ? [freezeAttempt(attempts.get(id)!)] : []),
    toolCalls: item.toolCallIds.flatMap((id) => tools.get(id) ? [freezeToolCall(tools.get(id)!)] : []),
    firstSequence: item.firstSequence,
    lastSequence: item.lastSequence,
  });

  const claimedWorkItemIds = new Set<string>();
  const projectedGoals = [...goals.values()]
    .sort((left, right) => left.firstSequence - right.firstSequence)
    .map((goal): WorkflowGoalActivity => {
      const workItemIds = new Set([
        ...goal.goal.workItemIds,
        ...[...workItems.values()]
          .filter((item) => item.goalRunId === goal.goal.id)
          .map((item) => item.item.id),
      ]);
      const projectedItems = [...workItemIds].flatMap((id) => {
        const item = workItems.get(id);
        if (!item) return [];
        claimedWorkItemIds.add(id);
        return [freezeWorkItem(item)];
      });
      const sequences = projectedItems.flatMap((item) => [item.firstSequence, item.lastSequence]);
      return {
        goal: goal.goal,
        ...projectedGoalStatus(goal.goal, projectedItems),
        workItems: projectedItems,
        toolCalls: goal.toolCallIds.flatMap((id) => tools.get(id) ? [freezeToolCall(tools.get(id)!)] : []),
        firstSequence: Math.min(goal.firstSequence, ...sequences),
        lastSequence: Math.max(goal.lastSequence, ...sequences),
      };
    });
  const standaloneWorkItems = [...workItems.values()]
    .filter((item) => !claimedWorkItemIds.has(item.item.id))
    .map(freezeWorkItem)
    .sort((left, right) => left.firstSequence - right.firstSequence);
  const scopedToolCallIds = new Set([
    ...[...attempts.values()].flatMap((attempt) => attempt.toolCallIds),
    ...[...workItems.values()].flatMap((item) => item.toolCallIds),
    ...[...goals.values()].flatMap((goal) => goal.toolCallIds),
  ]);
  for (const toolCallId of scopedToolCallIds) {
    const tool = tools.get(toolCallId);
    if (!tool) continue;
    for (const eventId of tool.eventIds) consumedEventIds.add(eventId);
  }
  const unscopedToolCalls = [...tools.values()]
    .filter((tool) => !structuredToolCallIds.has(tool.toolCallId) && !scopedToolCallIds.has(tool.toolCallId))
    .map(freezeToolCall)
    .sort((left, right) => left.firstSequence - right.firstSequence);

  return {
    goals: projectedGoals,
    standaloneWorkItems,
    unscopedToolCalls,
    consumedEventIds: events.filter((event) => consumedEventIds.has(event.eventId)).map((event) => event.eventId),
  };
}
