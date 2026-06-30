import type {
  ApprovalReceivedEvent,
  ApprovalRequestedEvent,
  CanonicalPlanAnalysisFindingDraft,
  CanonicalPlanWorkItemDraft,
  CanonicalSessionEvent,
  CostUpdateEvent,
  ErrorEvent,
  ModelRoutedEvent,
  MultimodalDelegationEvidence,
  MultimodalRoutedEvent,
  SessionEventSource,
  SessionProviderIdentity,
  SessionTurnOutcome,
  SessionToolStatus,
  WorkItem,
  WorkItemExecutionAttempt,
  ToolCalledEvent,
  ToolResultEvent,
} from "@kilnai/core";
import { createSessionEvent } from "@kilnai/core";
import type { RuntimeSession } from "./runtime-session.js";
import type { RuntimeTurnFileChange } from "./runtime-turn-record.js";
import { sanitizeAssistantEgressText } from "./assistant-egress-sanitizer.js";

type CapturedRuntimeLedgerEvent =
  | ApprovalReceivedEvent
  | ApprovalRequestedEvent
  | CostUpdateEvent
  | ErrorEvent
  | ModelRoutedEvent
  | MultimodalRoutedEvent
  | ToolCalledEvent
  | ToolResultEvent;

interface RuntimeContinuitySnapshot {
  readonly strategy: string;
  readonly feedbackLabel?: string;
  readonly selectionReason?: string;
  readonly fallbackLabel?: string;
}

export interface RuntimeTurnAuthorityMutationViolation {
  readonly errorCode: string;
  readonly message: string;
  readonly details: Record<string, unknown>;
}

export interface AppendCanonicalTurnEventsInput {
  readonly session: RuntimeSession;
  readonly turnId?: string;
  readonly channel: string;
  readonly userMessageContent: string;
  readonly assistantMessageContent?: string;
  readonly queued: boolean;
  readonly turnOutcome?: SessionTurnOutcome;
  readonly turnStartedAt: Date;
  readonly turnCompletedAt: Date;
  readonly continuity: RuntimeContinuitySnapshot;
  readonly runtimeEvents: readonly CapturedRuntimeLedgerEvent[];
  readonly planSubmissions?: readonly {
    readonly planId: string;
    readonly planHash: string;
    readonly mode: "plan";
    readonly objective: string;
    readonly nonGoals: readonly string[];
    readonly operatorDecisionsRequired: readonly string[];
    readonly assumptions: readonly string[];
    readonly affectedSurfaces: readonly string[];
    readonly riskClassification: "low" | "medium" | "high" | "critical";
    readonly workflowProfile: string;
    readonly workGovernancePosture: "direct" | "orchestrate" | "delegate";
    readonly workGovernanceRationale: string;
    readonly expectedEvidence: readonly string[];
    readonly verificationGates: readonly string[];
    readonly managedAgentDelegationCandidates: readonly string[];
    readonly approvalBoundaries: readonly string[];
    readonly rollbackNotes: string;
    readonly residualRisks: readonly string[];
    readonly sourceSpecificationId: string;
    readonly clarificationRecordIds: readonly string[];
    readonly constitutionSnapshotHash: string;
    readonly constitutionSnapshotIds: readonly string[];
    readonly proposedWorkItemCount: number;
    readonly proposedWorkItems: readonly CanonicalPlanWorkItemDraft[];
    readonly summary: string;
  }[];
  readonly analysisReports?: readonly {
    readonly reportId: string;
    readonly planId: string;
    readonly specificationId: string;
    readonly status: "blocked" | "ready";
    readonly highestSeverity: "critical" | "high" | "medium" | "low" | "none";
    readonly findingIds: readonly string[];
    readonly blockingFindingIds: readonly string[];
    readonly findingCount: number;
    readonly findings: readonly CanonicalPlanAnalysisFindingDraft[];
    readonly summary: string;
  }[];
  readonly specificationSubmissions?: readonly {
    readonly specificationId: string;
    readonly status: "draft" | "ready_for_plan";
    readonly summary: string;
    readonly issueCodes: readonly string[];
    readonly blockingIssueCodes: readonly string[];
  }[];
  readonly clarificationRecords?: readonly {
    readonly specificationId: string;
    readonly clarificationId: string;
    readonly affectedSection: string;
  }[];
  readonly authorityMutationViolations?: readonly RuntimeTurnAuthorityMutationViolation[];
  readonly fileChanges?: readonly RuntimeTurnFileChange[];
}

export function appendCanonicalTurnEvents(input: AppendCanonicalTurnEventsInput): readonly CanonicalSessionEvent[] {
  const { session } = input;
  const turnIdentity = resolveCanonicalTurnIdentity(session, input.turnId);
  const turnOrdinal = turnIdentity.turnOrdinal;
  const turnId = turnIdentity.turnId;
  const userMessageContent = input.userMessageContent.trim();
  const assistantMessageContent = input.assistantMessageContent
    ? sanitizeAssistantEgressText(input.assistantMessageContent).trim()
    : undefined;
  const events: CanonicalSessionEvent[] = [];
  const runtimeSource = makeSource("runtime", "runtime", "message-pipeline");
  const userSource = makeSource("user", mapChannelToSurface(input.channel), "message-pipeline");
  const assistantSource = makeSource("assistant", "runtime", "message-pipeline");

  let sequence = session.nextSessionEventSequence();
  const nextSequence = () => sequence++;
  const pendingApprovalIds: string[] = [];
  const pendingToolCallIds = new Map<string, string[]>();
  let approvalOrdinal = 0;
  let toolOrdinal = 0;
  let previousTotalCostUsd = 0;

  events.push(createSessionEvent<"turn_started">({
    kilnSessionId: session.id,
    sequence: nextSequence(),
    kind: "turn_started",
    turnId,
    turnOrdinal,
    trigger: "user_message",
    source: runtimeSource,
    timestamp: input.turnStartedAt,
  }));

  events.push(createSessionEvent<"user_message">({
    kilnSessionId: session.id,
    sequence: nextSequence(),
    kind: "user_message",
    turnId,
    messageId: `${turnId}:user`,
    content: userMessageContent,
    source: userSource,
    timestamp: input.turnStartedAt,
  }));

  events.push(createSessionEvent<"continuity_decided">({
    kilnSessionId: session.id,
    sequence: nextSequence(),
    kind: "continuity_decided",
    turnId,
    decision: "continue",
    reason: formatContinuityReason(input.continuity),
    source: runtimeSource,
    timestamp: input.turnStartedAt,
  }));

  for (const runtimeEvent of input.runtimeEvents) {
    switch (runtimeEvent.type) {
      case "model_routed": {
        events.push(createSessionEvent<"provider_routed">({
          kilnSessionId: session.id,
          sequence: nextSequence(),
          kind: "provider_routed",
          turnId,
          provider: toSessionProviderIdentity(runtimeEvent),
          reason: runtimeEvent.reason,
          source: runtimeSource,
          timestamp: runtimeEvent.timestamp,
        }));
        break;
      }
      case "multimodal_routed": {
        events.push(createSessionEvent<"multimodal_routed">({
          kilnSessionId: session.id,
          sequence: nextSequence(),
          kind: "multimodal_routed",
          turnId,
          provider: toSessionProviderIdentity(runtimeEvent),
          strategy: runtimeEvent.strategy,
          reasonCode: runtimeEvent.reasonCode,
          reason: runtimeEvent.reason,
          requestedCapability: runtimeEvent.requestedCapability,
          requiredModalities: runtimeEvent.requiredModalities,
          artifactUris: runtimeEvent.artifactUris,
          ...(runtimeEvent.delegation ? { delegation: toSessionDelegationEvidence(runtimeEvent.delegation) } : {}),
          diagnostics: runtimeEvent.diagnostics,
          source: runtimeSource,
          timestamp: runtimeEvent.timestamp,
        }));
        break;
      }
      case "tool_called": {
        const toolCallId = `${turnId}:tool:${++toolOrdinal}`;
        const pending = pendingToolCallIds.get(runtimeEvent.toolName) ?? [];
        pending.push(toolCallId);
        pendingToolCallIds.set(runtimeEvent.toolName, pending);
        events.push(createSessionEvent<"tool_call_started">({
          kilnSessionId: session.id,
          sequence: nextSequence(),
          kind: "tool_call_started",
          turnId,
          toolCallId,
          toolName: runtimeEvent.toolName,
          input: runtimeEvent.toolInput,
          ...(runtimeEvent.metadata ? { metadata: runtimeEvent.metadata } : {}),
          source: makeSource("tool", "runtime", "orchestrator"),
          timestamp: runtimeEvent.timestamp,
        }));
        break;
      }
      case "tool_result": {
        const pending = pendingToolCallIds.get(runtimeEvent.toolName);
        const toolCallId = pending?.shift() ?? `${turnId}:tool:${++toolOrdinal}`;
        if (pending && pending.length === 0) {
          pendingToolCallIds.delete(runtimeEvent.toolName);
        }
        events.push(createSessionEvent<"tool_call_completed">({
          kilnSessionId: session.id,
          sequence: nextSequence(),
          kind: "tool_call_completed",
          turnId,
          toolCallId,
          toolName: runtimeEvent.toolName,
          status: toSessionToolStatus(runtimeEvent),
          durationMs: runtimeEvent.durationMs,
          output: runtimeEvent.output,
          outputSummary: runtimeEvent.resultSummary,
          ...(runtimeEvent.metadata ? { metadata: runtimeEvent.metadata } : {}),
          ...(runtimeEvent.resourceLinks ? { resourceLinks: runtimeEvent.resourceLinks } : {}),
          ...(runtimeEvent.toolUsage ? { toolUsage: runtimeEvent.toolUsage } : {}),
          source: makeSource("tool", "runtime", "orchestrator"),
          timestamp: runtimeEvent.timestamp,
        }));
        for (const configEvent of projectConfigMutationEvents({
          sessionId: session.id,
          turnId,
          sequence: nextSequence,
          runtimeEvent,
          source: makeSource("tool", "runtime", "config-mutation"),
        })) {
          events.push(configEvent);
        }
        for (const workItemEvent of projectWorkItemEvents({
          sessionId: session.id,
          turnId,
          toolCallId,
          sequence: nextSequence,
          runtimeEvent,
          source: makeSource("tool", "runtime", "work-governance"),
        })) {
          events.push(workItemEvent);
        }
        break;
      }
      case "approval_requested": {
        const approvalId = runtimeEvent.approvalId ?? `${turnId}:approval:${++approvalOrdinal}`;
        pendingApprovalIds.push(approvalId);
        events.push(createSessionEvent<"approval_requested">({
          kilnSessionId: session.id,
          sequence: nextSequence(),
          kind: "approval_requested",
          turnId,
          approvalId,
          action: runtimeEvent.description,
          justification: runtimeEvent.description,
          source: runtimeSource,
          timestamp: runtimeEvent.timestamp,
        }));
        break;
      }
      case "approval_received": {
        const approvalId = runtimeEvent.approvalId ?? pendingApprovalIds.shift() ?? `${turnId}:approval:${++approvalOrdinal}`;
        events.push(createSessionEvent<"approval_resolved">({
          kilnSessionId: session.id,
          sequence: nextSequence(),
          kind: "approval_resolved",
          turnId,
          approvalId,
          resolution: {
            decision: runtimeEvent.approved ? "approved" : "denied",
            resolvedBy: "operator",
            reason: runtimeEvent.reason,
          },
          source: runtimeSource,
          timestamp: runtimeEvent.timestamp,
        }));
        break;
      }
      case "cost_update": {
        const totalCostUsd = runtimeEvent.totalCostUsd;
        const deltaUsd = Math.max(0, totalCostUsd - previousTotalCostUsd);
        previousTotalCostUsd = totalCostUsd;
        events.push(createSessionEvent<"cost_updated">({
          kilnSessionId: session.id,
          sequence: nextSequence(),
          kind: "cost_updated",
          turnId,
          provider: toSessionProviderIdentity(runtimeEvent),
          usage: {
            inputTokens: runtimeEvent.inputTokens,
            outputTokens: runtimeEvent.outputTokens,
            cacheReadTokens: runtimeEvent.cacheReadTokens,
            cacheWriteTokens: 0,
          },
          cost: {
            currency: "USD",
            deltaUsd,
            totalUsd: totalCostUsd,
          },
          source: runtimeSource,
          timestamp: runtimeEvent.timestamp,
        }));
        break;
      }
      case "error": {
        events.push(createSessionEvent<"error_recorded">({
          kilnSessionId: session.id,
          sequence: nextSequence(),
          kind: "error_recorded",
          turnId,
          errorCode: runtimeEvent.code,
          message: runtimeEvent.message,
          retriable: false,
          source: runtimeSource,
          timestamp: runtimeEvent.timestamp,
        }));
        break;
      }
    }
  }

  for (const submission of input.planSubmissions ?? []) {
    events.push(createSessionEvent<"plan_submitted">({
      kilnSessionId: session.id,
      sequence: nextSequence(),
      kind: "plan_submitted",
      turnId,
      planId: submission.planId,
      planHash: submission.planHash,
      mode: submission.mode,
      objective: submission.objective,
      nonGoals: submission.nonGoals,
      operatorDecisionsRequired: submission.operatorDecisionsRequired,
      assumptions: submission.assumptions,
      affectedSurfaces: submission.affectedSurfaces,
      riskClassification: submission.riskClassification,
      workflowProfile: submission.workflowProfile,
      workGovernancePosture: submission.workGovernancePosture,
      workGovernanceRationale: submission.workGovernanceRationale,
      expectedEvidence: submission.expectedEvidence,
      verificationGates: submission.verificationGates,
      managedAgentDelegationCandidates: submission.managedAgentDelegationCandidates,
      approvalBoundaries: submission.approvalBoundaries,
      rollbackNotes: submission.rollbackNotes,
      residualRisks: submission.residualRisks,
      sourceSpecificationId: submission.sourceSpecificationId,
      clarificationRecordIds: submission.clarificationRecordIds,
      constitutionSnapshotHash: submission.constitutionSnapshotHash,
      constitutionSnapshotIds: submission.constitutionSnapshotIds,
      proposedWorkItemCount: submission.proposedWorkItemCount,
      proposedWorkItems: submission.proposedWorkItems,
      summary: submission.summary,
      source: runtimeSource,
      timestamp: input.turnCompletedAt,
    }));
  }

  for (const report of input.analysisReports ?? []) {
    events.push(createSessionEvent<"plan_analysis_reported">({
      kilnSessionId: session.id,
      sequence: nextSequence(),
      kind: "plan_analysis_reported",
      turnId,
      reportId: report.reportId,
      planId: report.planId,
      specificationId: report.specificationId,
      status: report.status,
      highestSeverity: report.highestSeverity,
      findingIds: report.findingIds,
      blockingFindingIds: report.blockingFindingIds,
      findingCount: report.findingCount,
      findings: report.findings,
      summary: report.summary,
      source: runtimeSource,
      timestamp: input.turnCompletedAt,
    }));
  }

  for (const specification of input.specificationSubmissions ?? []) {
    events.push(createSessionEvent<"specification_submitted">({
      kilnSessionId: session.id,
      sequence: nextSequence(),
      kind: "specification_submitted",
      turnId,
      specificationId: specification.specificationId,
      status: specification.status,
      summary: specification.summary,
      issueCodes: specification.issueCodes,
      blockingIssueCodes: specification.blockingIssueCodes,
      source: runtimeSource,
      timestamp: input.turnCompletedAt,
    }));
  }

  for (const clarification of input.clarificationRecords ?? []) {
    events.push(createSessionEvent<"clarification_recorded">({
      kilnSessionId: session.id,
      sequence: nextSequence(),
      kind: "clarification_recorded",
      turnId,
      specificationId: clarification.specificationId,
      clarificationId: clarification.clarificationId,
      affectedSection: clarification.affectedSection,
      source: runtimeSource,
      timestamp: input.turnCompletedAt,
    }));
  }

  for (const violation of input.authorityMutationViolations ?? []) {
    events.push(createSessionEvent<"error_recorded">({
      kilnSessionId: session.id,
      sequence: nextSequence(),
      kind: "error_recorded",
      turnId,
      errorCode: violation.errorCode,
      message: violation.message,
      retriable: false,
      details: violation.details,
      source: runtimeSource,
      timestamp: input.turnCompletedAt,
    }));
  }

  for (const fileChange of input.fileChanges ?? []) {
    events.push(createSessionEvent<"file_changed">({
      kilnSessionId: session.id,
      sequence: nextSequence(),
      kind: "file_changed",
      turnId,
      change: {
        changeType: mapFileChangeType(fileChange.changeType),
        path: fileChange.path,
        linesAdded: fileChange.linesAdded,
        linesRemoved: fileChange.linesRemoved,
        diffPreview: fileChange.diffPreview,
        diffTruncated: fileChange.diffTruncated,
      },
      source: makeSource("tool", "runtime", "message-pipeline"),
      timestamp: input.turnCompletedAt,
    }));
  }

  if (assistantMessageContent && assistantMessageContent.length > 0) {
    events.push(createSessionEvent<"assistant_message">({
      kilnSessionId: session.id,
      sequence: nextSequence(),
      kind: "assistant_message",
      turnId,
      messageId: `${turnId}:assistant`,
      content: assistantMessageContent,
      source: assistantSource,
      timestamp: input.turnCompletedAt,
    }));
  }

  events.push(createSessionEvent<"turn_completed">({
    kilnSessionId: session.id,
    sequence: nextSequence(),
    kind: "turn_completed",
    turnId,
    outcome: input.turnOutcome ?? (input.queued ? "cancelled" : "completed"),
    outputMessageId: assistantMessageContent ? `${turnId}:assistant` : undefined,
    durationMs: Math.max(0, input.turnCompletedAt.getTime() - input.turnStartedAt.getTime()),
    source: runtimeSource,
    timestamp: input.turnCompletedAt,
  }));

  session.appendSessionEvents(events);
  return events;
}

function resolveCanonicalTurnIdentity(
  session: RuntimeSession,
  turnId: string | undefined,
): { readonly turnId: string; readonly turnOrdinal: number } {
  if (turnId === undefined) {
    const turnOrdinal = nextCanonicalTurnOrdinal(session);
    return {
      turnId: `${session.id}:turn:${turnOrdinal}`,
      turnOrdinal,
    };
  }

  const prefix = `${session.id}:turn:`;
  if (!turnId.startsWith(prefix)) {
    throw new Error("Canonical turn id must belong to the runtime session.");
  }
  const turnOrdinal = Number.parseInt(turnId.slice(prefix.length), 10);
  if (!Number.isSafeInteger(turnOrdinal) || turnOrdinal < 1) {
    throw new Error("Canonical turn id must end with a positive turn ordinal.");
  }
  return { turnId, turnOrdinal };
}

function nextCanonicalTurnOrdinal(session: RuntimeSession): number {
  const highestPersistedTurnOrdinal = session.sessionEvents.reduce((highest, event) => {
    const turnId = "turnId" in event ? event.turnId : undefined;
    if (typeof turnId !== "string") {
      return highest;
    }
    const prefix = `${session.id}:turn:`;
    if (!turnId.startsWith(prefix)) {
      return highest;
    }
    const ordinal = Number.parseInt(turnId.slice(prefix.length), 10);
    return Number.isFinite(ordinal) ? Math.max(highest, ordinal) : highest;
  }, 0);

  return Math.max(session.userTurnCount, highestPersistedTurnOrdinal + 1, 1);
}

function projectWorkItemEvents(input: {
  readonly sessionId: string;
  readonly turnId: string;
  readonly toolCallId: string;
  readonly sequence: () => number;
  readonly runtimeEvent: ToolResultEvent;
  readonly source: SessionEventSource;
}): readonly CanonicalSessionEvent[] {
  if (!input.runtimeEvent.toolName.startsWith("work_item.")) {
    return [];
  }
  const metadata = input.runtimeEvent.metadata;
  if (!isWorkItemToolMetadata(metadata)) {
    return [];
  }
  if (metadata.operation === "update" || metadata.operation === "complete") {
    return [createSessionEvent<"work_item_updated">({
      kilnSessionId: input.sessionId,
      sequence: input.sequence(),
      kind: "work_item_updated",
      turnId: input.turnId,
      toolCallId: input.toolCallId,
      workItem: metadata.item,
      operation: metadata.operation,
      missingEvidence: readStringArray(metadata.missingEvidence),
      missingGoalEvidence: readStringArray(metadata.missingGoalEvidence),
      missingVerificationGates: readStringArray(metadata.missingVerificationGates),
      failedVerificationGates: readStringArray(metadata.failedVerificationGates),
      missingResidualRisk: metadata.missingResidualRisk === true,
      source: input.source,
      timestamp: input.runtimeEvent.timestamp,
    })];
  }
  if (metadata.operation === "execution_started" && metadata.attempt) {
    return [createSessionEvent<"work_item_execution_started">({
      kilnSessionId: input.sessionId,
      sequence: input.sequence(),
      kind: "work_item_execution_started",
      turnId: input.turnId,
      toolCallId: input.toolCallId,
      workItem: metadata.item,
      attempt: metadata.attempt,
      source: input.source,
      timestamp: input.runtimeEvent.timestamp,
    })];
  }
  if (metadata.operation === "execution_finished" && metadata.attempt) {
    return [createSessionEvent<"work_item_execution_finished">({
      kilnSessionId: input.sessionId,
      sequence: input.sequence(),
      kind: "work_item_execution_finished",
      turnId: input.turnId,
      toolCallId: input.toolCallId,
      workItem: metadata.item,
      attempt: metadata.attempt,
      missingEvidence: readStringArray(metadata.missingEvidence),
      missingGoalEvidence: readStringArray(metadata.missingGoalEvidence),
      missingVerificationGates: readStringArray(metadata.missingVerificationGates),
      failedVerificationGates: readStringArray(metadata.failedVerificationGates),
      missingResidualRisk: metadata.missingResidualRisk === true,
      source: input.source,
      timestamp: input.runtimeEvent.timestamp,
    })];
  }
  return [];
}

function projectConfigMutationEvents(input: {
  readonly sessionId: string;
  readonly turnId: string;
  readonly sequence: () => number;
  readonly runtimeEvent: ToolResultEvent;
  readonly source: SessionEventSource;
}): readonly CanonicalSessionEvent[] {
  const payload = parseJsonRecord(input.runtimeEvent.output);
  if (!payload || !input.runtimeEvent.toolName.startsWith("kiln_config.")) {
    return [];
  }
  if (input.runtimeEvent.toolName === "kiln_config.propose_change") {
    const proposalId = readString(payload.proposalId);
    const operation = readString(payload.operation);
    const status = payload.status === "valid" || payload.status === "invalid" ? payload.status : undefined;
    if (!proposalId || !operation || !status) {
      return [];
    }
    return [createSessionEvent<"config_change_proposed">({
      kilnSessionId: input.sessionId,
      sequence: input.sequence(),
      kind: "config_change_proposed",
      turnId: input.turnId,
      proposalId,
      operation,
      status,
      affectedCanonicalPaths: readStringArray(payload.affectedCanonicalPaths),
      authorityImpact: readString(payload.authorityImpact) ?? "unknown",
      source: input.source,
      timestamp: input.runtimeEvent.timestamp,
    })];
  }
  if (input.runtimeEvent.toolName === "kiln_config.apply_change") {
    const status = readString(payload.status);
    if (status === "applied") {
      return [createSessionEvent<"config_change_applied">({
        kilnSessionId: input.sessionId,
        sequence: input.sequence(),
        kind: "config_change_applied",
        turnId: input.turnId,
        proposalId: readString(payload.proposalId) ?? "unknown",
        approvalId: readString(payload.approvalId) ?? "unknown",
        appliedWrites: readObjectPathArray(payload.appliedWrites),
        projectionEffects: readProjectionEffectArray(payload.projectionEffects),
        source: input.source,
        timestamp: input.runtimeEvent.timestamp,
      })];
    }
    return [createSessionEvent<"config_change_failed">({
      kilnSessionId: input.sessionId,
      sequence: input.sequence(),
      kind: "config_change_failed",
      turnId: input.turnId,
      proposalId: readString(payload.proposalId),
      approvalId: readString(payload.approvalId),
      errorMessage: firstDiagnosticMessage(payload.diagnostics) ?? input.runtimeEvent.resultSummary ?? "Config apply failed",
      source: input.source,
      timestamp: input.runtimeEvent.timestamp,
    })];
  }
  return [];
}

function isWorkItemToolMetadata(value: unknown): value is {
  readonly kind: "work_item";
  readonly operation: "update" | "list" | "complete" | "execution_started" | "execution_finished";
  readonly item: WorkItem;
  readonly attempt?: WorkItemExecutionAttempt;
  readonly missingEvidence?: unknown;
  readonly missingGoalEvidence?: unknown;
  readonly missingVerificationGates?: unknown;
  readonly failedVerificationGates?: unknown;
  readonly missingResidualRisk?: unknown;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return candidate.kind === "work_item"
    && (
      candidate.operation === "update"
      || candidate.operation === "list"
      || candidate.operation === "complete"
      || candidate.operation === "execution_started"
      || candidate.operation === "execution_finished"
    )
    && isWorkItem(candidate.item)
    && (
      candidate.operation === "execution_started" || candidate.operation === "execution_finished"
        ? isWorkItemExecutionAttempt(candidate.attempt)
        : true
    );
}

function isWorkItem(value: unknown): value is WorkItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string"
    && typeof candidate.summary === "string"
    && typeof candidate.status === "string"
    && typeof candidate.workflowProfile === "string"
    && Array.isArray(candidate.expectedEvidence)
    && Array.isArray(candidate.providedEvidence)
    && Array.isArray(candidate.verificationGates)
    && Array.isArray(candidate.dependencies)
    && typeof candidate.createdAt === "string"
    && typeof candidate.updatedAt === "string"
    && typeof candidate.sequence === "number";
}

function isWorkItemExecutionAttempt(value: unknown): value is WorkItemExecutionAttempt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string"
    && typeof candidate.workItemId === "string"
    && typeof candidate.goalRunId === "string"
    && typeof candidate.status === "string"
    && typeof candidate.executionMode === "string"
    && typeof candidate.startedAt === "string"
    && Array.isArray(candidate.providedEvidence)
    && Array.isArray(candidate.missingEvidence)
    && typeof candidate.missingResidualRisk === "boolean";
}

function parseJsonRecord(value: string | undefined): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => readString(entry) ? [readString(entry)!] : [])
    : [];
}

function readObjectPathArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const record = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : null;
        const path = readString(record?.path);
        return path ? [path] : [];
      })
    : [];
}

function readProjectionEffectArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const record = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : null;
        const target = readString(record?.target);
        const status = readString(record?.status);
        return target ? [`${target}${status ? `:${status}` : ""}`] : [];
      })
    : [];
}

function firstDiagnosticMessage(value: unknown): string | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  for (const entry of value) {
    const record = entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : null;
    const message = readString(record?.message);
    if (message) {
      return message;
    }
  }
  return undefined;
}

function mapChannelToSurface(channel: string): SessionEventSource["surface"] {
  switch (channel) {
    case "gui":
      return "gui";
    case "tui":
      return "tui";
    default:
      return "gateway";
  }
}

function makeSource(
  actor: SessionEventSource["actor"],
  surface: SessionEventSource["surface"],
  component: string,
): SessionEventSource {
  return { actor, surface, component };
}

function formatContinuityReason(continuity: RuntimeContinuitySnapshot): string {
  const parts = [`strategy=${continuity.strategy}`];
  if (continuity.feedbackLabel) {
    parts.push(`feedback=${continuity.feedbackLabel}`);
  }
  if (continuity.selectionReason) {
    parts.push(`selection=${continuity.selectionReason}`);
  }
  if (continuity.fallbackLabel) {
    parts.push(`fallback=${continuity.fallbackLabel}`);
  }
  return parts.join("; ");
}

function toSessionProviderIdentity(event: {
  readonly provider?: string;
  readonly model?: string;
  readonly canonicalModel?: string;
  readonly billingMode?: SessionProviderIdentity["billingMode"];
}): SessionProviderIdentity {
  return {
    provider: event.provider ?? "unknown",
    model: event.model ?? event.canonicalModel ?? "unknown",
    canonicalModel: event.canonicalModel,
    billingMode: event.billingMode,
  };
}

function toSessionDelegationEvidence(delegation: MultimodalDelegationEvidence): NonNullable<Extract<
  CanonicalSessionEvent,
  { readonly kind: "multimodal_routed" }
>["delegation"]> {
  return {
    routeId: delegation.routeId,
    provider: delegation.provider,
    model: delegation.model,
    ...(delegation.agentProfile ? { agentProfile: delegation.agentProfile } : {}),
    authorityProfileId: delegation.authorityProfileId,
    routeHealth: delegation.routeHealth,
    policyDecision: delegation.policyDecision,
    costBudgetDecision: delegation.costBudgetDecision,
    expectedResult: delegation.expectedResult,
    uncertainty: delegation.uncertainty,
    artifactUris: delegation.artifactUris,
    requestedCapability: delegation.requestedCapability,
  };
}

function toSessionToolStatus(event: ToolResultEvent): SessionToolStatus {
  if (event.success) {
    return { state: "succeeded" };
  }
  return {
    state: "failed",
    errorCode: event.isError ? "tool_error" : undefined,
    errorMessage: event.resultSummary,
  };
}

function mapFileChangeType(changeType: string | undefined): "created" | "updated" | "deleted" | "renamed" {
  switch (changeType) {
    case "created":
      return "created";
    case "deleted":
      return "deleted";
    case "renamed":
      return "renamed";
    default:
      return "updated";
  }
}
