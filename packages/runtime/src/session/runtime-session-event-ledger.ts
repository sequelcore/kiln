import type {
  ApprovalReceivedEvent,
  ApprovalRequestedEvent,
  CanonicalPlanAnalysisFindingDraft,
  CanonicalPlanWorkItemDraft,
  CanonicalSessionEvent,
  CanonicalOperatorAdoptionDecisionEvent,
  BoundedWorkAdoptionAuthority,
  CostUpdateEvent,
  ErrorEvent,
  ModelRoutedEvent,
  MultimodalDelegationEvidence,
  MultimodalRoutedEvent,
  SessionEventSource,
  SessionProviderIdentity,
  SessionTurnOutcome,
  SessionToolStatus,
  GoalRun,
  WorkItem,
  WorkItemExecutionAttempt,
  ToolCalledEvent,
  ToolOutputEvent,
  ToolResultEvent,
  ContextAuditEntry,
  ContextUsageProjection,
  VerifiedEfficiencyPolicyIdentity,
  ProviderRequestEvidence,
  CanonicalTurnId,
} from "@kilnai/core";
import {
  canonicalTurnId,
  createOperatorAdoptionDecisionAuthority,
  createSessionEvent,
  parseCanonicalTurnId as parseCoreCanonicalTurnId,
  hashPolicyAdaptationConfiguration,
  projectCostUpdatedEventToLifecycleLedger,
  projectVerifiedEfficiencyEvidence,
  reconcileLifecycleAttributionLedger,
  projectFinalEffectivePromptObservation,
} from "@kilnai/core";
import type { RuntimeSession } from "./runtime-session.js";
import type { RuntimeTurnFileChange } from "./runtime-turn-record.js";
import { sanitizeAssistantEgressText } from "./assistant-egress-sanitizer.js";
import {
  projectRuntimeLifecycleAttributionAllocations,
  type RuntimeLifecycleFinalOutputBoundary,
} from "./runtime-lifecycle-attribution-allocations.js";

type CapturedRuntimeLedgerEvent =
  | ApprovalReceivedEvent
  | ApprovalRequestedEvent
  | CostUpdateEvent
  | ErrorEvent
  | ModelRoutedEvent
  | MultimodalRoutedEvent
  | ToolCalledEvent
  | ToolOutputEvent
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

export interface RuntimeLifecycleAttributionEvidence {
  readonly contextAudit?: ContextAuditEntry;
  readonly finalOutput?: RuntimeLifecycleFinalOutputBoundary;
}

export interface AppendCanonicalTurnEventsInput {
  readonly session: RuntimeSession;
  readonly executionRouteId?: string;
  readonly turnId?: string;
  readonly channel: string;
  readonly userMessageContent: string;
  readonly assistantMessageContent?: string;
  readonly queued: boolean;
  readonly turnOutcome: SessionTurnOutcome;
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
  readonly lifecycleAttributionEvidence?: RuntimeLifecycleAttributionEvidence;
  readonly efficiencyPolicy?: VerifiedEfficiencyPolicyIdentity;
  readonly clarificationRecords?: readonly {
    readonly specificationId: string;
    readonly clarificationId: string;
    readonly affectedSection: string;
  }[];
  readonly authorityMutationViolations?: readonly RuntimeTurnAuthorityMutationViolation[];
  readonly fileChanges?: readonly RuntimeTurnFileChange[];
  readonly contextUsage?: ContextUsageProjection;
  readonly providerRequests?: readonly ProviderRequestEvidence[];
}

export function resolveCanonicalTurnIdentity(
  session: RuntimeSession,
  correlationId: string | undefined,
): { readonly turnId: CanonicalTurnId; readonly turnOrdinal: number; readonly correlationId?: string } {
  const turnOrdinal = nextCanonicalTurnOrdinal(session);
  const normalizedCorrelationId = correlationId?.trim();
  const priorDecision = normalizedCorrelationId
    ? session.sessionEvents.find(
      (event): event is Extract<CanonicalSessionEvent, { readonly kind: "operator_adoption_decision" }> =>
        event.kind === "operator_adoption_decision" && event.correlationId === normalizedCorrelationId,
    )
    : undefined;
  const priorOrdinal = priorDecision ? parseCanonicalTurnOrdinal(session.id, priorDecision.operatorTurnId) : undefined;
  if (priorDecision && priorOrdinal !== undefined) {
    return {
      turnId: canonicalTurnId(session.id, priorOrdinal),
      turnOrdinal: priorOrdinal,
      correlationId: normalizedCorrelationId,
    };
  }
  return {
    turnId: canonicalTurnId(session.id, turnOrdinal),
    turnOrdinal,
    ...(normalizedCorrelationId ? { correlationId: normalizedCorrelationId } : {}),
  };
}

export function appendCanonicalOperatorAdoptionDecision(input: {
  readonly session: RuntimeSession;
  readonly turnId: CanonicalTurnId;
  readonly actorId: string;
  readonly correlationId?: string;
  readonly timestamp?: Date;
}): CanonicalOperatorAdoptionDecisionEvent {
  const timestamp = input.timestamp ?? new Date();
  const correlationId = input.correlationId?.trim() || undefined;
  const authority = createOperatorAdoptionDecisionAuthority({
    ownerSessionId: input.session.id,
    operatorTurnId: input.turnId,
    actorId: input.actorId,
  });
  const existing = input.session.sessionEvents.find(
    (event): event is Extract<CanonicalSessionEvent, { readonly kind: "operator_adoption_decision" }> =>
      event.kind === "operator_adoption_decision" && event.decisionId === authority.decisionId,
  );
  if (existing) {
    if (
      existing.kilnSessionId !== input.session.id
      || existing.turnId !== input.turnId
      || existing.operatorTurnId !== authority.operatorTurnId
      || existing.correlationId !== correlationId
      || !sameAdoptionAuthority(existing.contractAuthority, authority.contractAuthority)
    ) {
      throw new Error(`Operator adoption decision ${authority.decisionId} does not match the canonical turn authority.`);
    }
    return existing;
  }
  const event = createSessionEvent<"operator_adoption_decision">({
    kilnSessionId: input.session.id,
    sequence: input.session.nextSessionEventSequence(),
    kind: "operator_adoption_decision",
    turnId: input.turnId,
    ...authority,
    turnOrdinal: requireCanonicalTurnIdentity(input.session, input.turnId).turnOrdinal,
    ...(correlationId ? { correlationId } : {}),
    source: makeSource("runtime", "runtime", "operator-adoption"),
    timestamp,
  });
  input.session.appendSessionEvents([event]);
  return event;
}

export function appendCanonicalTurnEvents(input: AppendCanonicalTurnEventsInput): readonly CanonicalSessionEvent[] {
  const { session } = input;
  const turnIdentity = requireCanonicalTurnIdentity(session, input.turnId);
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
  let approvalOrdinal = 0;
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
          ...(input.executionRouteId ? { routeId: input.executionRouteId } : {}),
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
        const toolCallId = requireRuntimeToolCallId(runtimeEvent, turnId);
        const toolCallScopeId = requireRuntimeToolCallScopeId(runtimeEvent, turnId);
        events.push(createSessionEvent<"tool_call_started">({
          kilnSessionId: session.id,
          sequence: nextSequence(),
          kind: "tool_call_started",
          turnId,
          toolCallId,
          toolCallScopeId,
          toolName: runtimeEvent.toolName,
          input: runtimeEvent.toolInput,
          ...(runtimeEvent.executionScope ? { executionScope: runtimeEvent.executionScope } : {}),
          ...(runtimeEvent.metadata ? { metadata: runtimeEvent.metadata } : {}),
          source: makeSource("tool", "runtime", "orchestrator"),
          timestamp: runtimeEvent.timestamp,
        }));
        break;
      }
      case "tool_output": {
        const toolCallId = requireRuntimeToolCallId(runtimeEvent, turnId);
        const toolCallScopeId = requireRuntimeToolCallScopeId(runtimeEvent, turnId);
        events.push(createSessionEvent<"tool_call_output_delta">({
          kilnSessionId: session.id,
          sequence: nextSequence(),
          kind: "tool_call_output_delta",
          turnId,
          toolCallId,
          toolCallScopeId,
          toolName: runtimeEvent.toolName,
          stream: runtimeEvent.stream,
          delta: runtimeEvent.delta,
          chunkIndex: runtimeEvent.chunkIndex,
          ...(runtimeEvent.executionScope ? { executionScope: runtimeEvent.executionScope } : {}),
          source: makeSource("tool", "runtime", "orchestrator"),
          timestamp: runtimeEvent.timestamp,
        }));
        break;
      }
      case "tool_result": {
        const toolCallId = requireRuntimeToolCallId(runtimeEvent, turnId);
        const toolCallScopeId = requireRuntimeToolCallScopeId(runtimeEvent, turnId);
        events.push(createSessionEvent<"tool_call_completed">({
          kilnSessionId: session.id,
          sequence: nextSequence(),
          kind: "tool_call_completed",
          turnId,
          toolCallId,
          toolCallScopeId,
          toolName: runtimeEvent.toolName,
          ...(runtimeEvent.executionScope ? { executionScope: runtimeEvent.executionScope } : {}),
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
        for (const goalEvent of projectGoalEvents({
          sessionId: session.id,
          turnId,
          sequence: nextSequence,
          runtimeEvent,
          source: makeSource("tool", "runtime", "work-governance"),
        })) {
          events.push(goalEvent);
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
        const costEvent = createSessionEvent<"cost_updated">({
          kilnSessionId: session.id,
          sequence: nextSequence(),
          kind: "cost_updated",
          turnId,
          provider: toSessionProviderIdentity(runtimeEvent),
          usage: {
            inputTokens: runtimeEvent.inputTokens,
            outputTokens: runtimeEvent.outputTokens,
            cacheReadTokens: runtimeEvent.cacheReadTokens,
            cacheWriteTokens: runtimeEvent.cacheWriteTokens,
          },
          cost: {
            currency: "USD",
            deltaUsd,
            totalUsd: totalCostUsd,
            ...(runtimeEvent.costEvidence ? { evidence: runtimeEvent.costEvidence } : {}),
          },
          source: runtimeSource,
          timestamp: runtimeEvent.timestamp,
        });
        events.push(costEvent);
        const route = `${costEvent.provider.provider}/${costEvent.provider.model}`;
        const lifecycleEvidence = normalizeLifecycleAttributionEvidence(
          input.lifecycleAttributionEvidence,
          session.id,
          turnId,
        );
        const attributionLedger = projectCostUpdatedEventToLifecycleLedger(costEvent, {
          allocations: projectRuntimeLifecycleAttributionAllocations({
            contextAudit: lifecycleEvidence.contextAudit,
            finalOutput: lifecycleEvidence.finalOutput,
            route,
          }),
          context: {
            route,
          },
        });
        const reconciled = reconcileLifecycleAttributionLedger(costEvent, attributionLedger);
        const efficiencyEvidence = projectVerifiedEfficiencyEvidence({
          lifecycleEvidence: {
            costEvent,
            ledger: reconciled.ledger,
            summary: reconciled.summary,
          },
          observedAt: runtimeEvent.timestamp.toISOString(),
          policy: input.efficiencyPolicy ?? {
            owner: "ContextGovernor",
            policyId: "context-whole-block-static-v1",
            configurationHash: hashPolicyAdaptationConfiguration({ contextAllocationMode: "whole-block" }),
          },
          outcome: input.turnOutcome === "completed"
            ? "succeeded"
            : input.turnOutcome === "failed"
              ? "failed"
              : "unknown",
        });
        events.push(createSessionEvent<"lifecycle_attribution_recorded">({
          kilnSessionId: session.id,
          sequence: nextSequence(),
          kind: "lifecycle_attribution_recorded",
          turnId,
          parentEventId: costEvent.eventId,
          ledger: reconciled.ledger,
          summary: reconciled.summary,
          efficiencyEvidence,
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
      ...(fileChange.toolCallId ? { toolCallId: fileChange.toolCallId } : {}),
      ...(fileChange.executionScope ? { executionScope: fileChange.executionScope } : {}),
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

  if (input.contextUsage) {
    events.push(createSessionEvent<"context_usage_observed">({
      kilnSessionId: session.id,
      sequence: nextSequence(),
      kind: "context_usage_observed",
      turnId,
      contextUsage: input.contextUsage,
      source: runtimeSource,
      timestamp: new Date(input.contextUsage.observedAt),
    }));
  }

  const effectivePrompt = projectFinalEffectivePromptObservation(input.providerRequests);
  if (effectivePrompt) {
    events.push(createSessionEvent<"effective_prompt_observed">({
      kilnSessionId: session.id,
      sequence: nextSequence(),
      kind: "effective_prompt_observed",
      turnId,
      effectivePrompt,
      source: runtimeSource,
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
    outcome: input.turnOutcome,
    outputMessageId: assistantMessageContent ? `${turnId}:assistant` : undefined,
    durationMs: Math.max(0, input.turnCompletedAt.getTime() - input.turnStartedAt.getTime()),
    source: runtimeSource,
    timestamp: input.turnCompletedAt,
  }));

  session.appendSessionEvents(events);
  return events;
}

function sameAdoptionAuthority(
  left: BoundedWorkAdoptionAuthority,
  right: BoundedWorkAdoptionAuthority,
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "operator" && right.kind === "operator") {
    return left.actorId === right.actorId && left.decisionId === right.decisionId;
  }
  return left.kind === "approved_plan"
    && right.kind === "approved_plan"
    && left.planId === right.planId
    && left.planDigest === right.planDigest;
}

function parseCanonicalTurnOrdinal(sessionId: string, turnId: string): number | undefined {
  return parseCoreCanonicalTurnId(turnId, sessionId);
}

export function requireCanonicalTurnIdentity(
  session: RuntimeSession,
  turnId: string | undefined,
): { readonly turnId: CanonicalTurnId; readonly turnOrdinal: number } {
  if (!turnId) {
    const turnOrdinal = nextCanonicalTurnOrdinal(session);
    return { turnId: canonicalTurnId(session.id, turnOrdinal), turnOrdinal };
  }
  const turnOrdinal = parseCanonicalTurnOrdinal(session.id, turnId);
  if (turnOrdinal === undefined) {
    throw new Error("Canonical turn id must belong to the runtime session and end with a positive ordinal.");
  }
  return { turnId: canonicalTurnId(session.id, turnOrdinal), turnOrdinal };
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

function normalizeLifecycleAttributionEvidence(
  evidence: RuntimeLifecycleAttributionEvidence | undefined,
  sessionId: string,
  turnId: string,
): RuntimeLifecycleAttributionEvidence {
  if (!evidence?.finalOutput) {
    return evidence ?? {};
  }
  return {
    ...evidence,
    finalOutput: {
      ...evidence.finalOutput,
      evidenceUri: evidence.finalOutput.evidenceUri ?? `kiln://sessions/${sessionId}/turns/${turnId}/final-output`,
    },
  };
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

function goalFromToolMetadata(value: unknown): GoalRun | undefined {
  if (!isRecord(value)) return undefined;
  return isGoalRun(value.goal) ? value.goal : undefined;
}

function isGoalRun(value: unknown): value is GoalRun {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && typeof value.objective === "string"
    && typeof value.ownerSessionId === "string"
    && isRecord(value.source)
    && (value.status === "active" || value.status === "completed" || value.status === "failed" || value.status === "cancelled")
    && Array.isArray(value.workItemIds)
    && isRecord(value.authorityEnvelope)
    && isRecord(value.routePolicy)
    && Array.isArray(value.evidenceRequirements)
    && Array.isArray(value.evidence)
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string"
    && typeof value.sequence === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function projectGoalEvents(input: {
  readonly sessionId: string;
  readonly turnId: string;
  readonly sequence: () => number;
  readonly runtimeEvent: ToolResultEvent;
  readonly source: SessionEventSource;
}): readonly CanonicalSessionEvent[] {
  const metadata = input.runtimeEvent.metadata;
  const goal = goalFromToolMetadata(metadata);
  if (!goal) return [];
  const envelope = () => ({
    kilnSessionId: input.sessionId,
    sequence: input.sequence(),
    turnId: input.turnId,
    goal,
    source: input.source,
    timestamp: input.runtimeEvent.timestamp,
  });
  if (goal.status === "completed" && goal.closeoutSummary) {
    return [createSessionEvent<"goal.completed">({
      ...envelope(),
      kind: "goal.completed",
      closeoutSummary: goal.closeoutSummary,
    })];
  }
  if (goal.status === "failed" && goal.terminalReason) {
    return [createSessionEvent<"goal.failed">({
      ...envelope(),
      kind: "goal.failed",
      reason: goal.terminalReason,
    })];
  }
  if (goal.status === "cancelled" && goal.terminalReason) {
    return [createSessionEvent<"goal.cancelled">({
      ...envelope(),
      kind: "goal.cancelled",
      reason: goal.terminalReason,
    })];
  }
  if (goal.status !== "active") return [];
  if (isRecord(metadata) && metadata.kind === "goal" && metadata.operation === "create") {
    return [createSessionEvent<"goal.created">({ ...envelope(), kind: "goal.created" })];
  }
  return [createSessionEvent<"goal.updated">({
    ...envelope(),
    kind: "goal.updated",
    changedFields: isRecord(metadata) && Array.isArray(metadata.changedFields)
      ? metadata.changedFields.filter((field): field is string => typeof field === "string")
      : ["currentPhase"],
  })];
}

function requireRuntimeToolCallId(
  runtimeEvent: ToolCalledEvent | ToolOutputEvent | ToolResultEvent,
  turnId: string,
): string {
  if (typeof runtimeEvent.toolCallId === "string" && runtimeEvent.toolCallId.trim().length > 0) {
    return runtimeEvent.toolCallId;
  }
  throw new Error(
    `Runtime ${runtimeEvent.type} event for tool "${runtimeEvent.toolName}" in turn "${turnId}" is missing toolCallId.`,
  );
}

function requireRuntimeToolCallScopeId(
  runtimeEvent: ToolCalledEvent | ToolOutputEvent | ToolResultEvent,
  turnId: string,
): string {
  if (typeof runtimeEvent.toolCallScopeId === "string" && runtimeEvent.toolCallScopeId.trim().length > 0) {
    return runtimeEvent.toolCallScopeId;
  }
  throw new Error(
    `Runtime ${runtimeEvent.type} event for tool "${runtimeEvent.toolName}" in turn "${turnId}" is missing toolCallScopeId.`,
  );
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
