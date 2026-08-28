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
import type { RuntimeTurnTerminalDisposition } from "@kilnai/core/agents";
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
import type {
  CanonicalSessionEventBuilder,
  RuntimeSession,
} from "./runtime-session.js";
import type { RuntimeTurnFileChange } from "./runtime-turn-record.js";
import { sanitizeAssistantEgressText } from "./assistant-egress-sanitizer.js";
import {
  projectRuntimeLifecycleAttributionAllocations,
  type RuntimeLifecycleFinalOutputBoundary,
} from "./runtime-lifecycle-attribution-allocations.js";

export type CapturedRuntimeLedgerEvent =
  | ApprovalReceivedEvent
  | ApprovalRequestedEvent
  | CostUpdateEvent
  | ErrorEvent
  | ModelRoutedEvent
  | MultimodalRoutedEvent
  | ToolCalledEvent
  | ToolOutputEvent
  | ToolResultEvent;

export interface RuntimeContinuitySnapshot {
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

interface CanonicalTurnEventInput {
  readonly session: RuntimeSession;
  readonly executionRouteId?: string;
  readonly turnId?: string;
  readonly channel: string;
  readonly userMessageContent: string;
  readonly assistantMessageContent?: string;
  readonly queued: boolean;
  /** Present only while building the terminal event. */
  readonly disposition?: RuntimeTurnTerminalDisposition;
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

/** Terminal-only evidence supplied when a Runtime turn settles. */
export type CanonicalTurnTerminalInput = Omit<CanonicalTurnEventInput,
  "session" | "executionRouteId" | "turnId" | "channel" | "userMessageContent" | "turnStartedAt" | "continuity" | "runtimeEvents" | "disposition"
> & {
  /** The sole typed terminal authority persisted by the canonical event. */
  readonly disposition: RuntimeTurnTerminalDisposition;
  /** Runtime errors observed while settling are committed before the terminal. */
  readonly terminalRuntimeEvents?: readonly CapturedRuntimeLedgerEvent[];
};

type CanonicalTurnEventPhase = "start" | "progress" | "terminal";

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

function buildCanonicalTurnEvents(
  input: CanonicalTurnEventInput,
  phase: CanonicalTurnEventPhase,
  existingEvents: readonly CanonicalSessionEvent[],
  sequenceStart: number,
): readonly CanonicalSessionEvent[] {
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

  let sequence = sequenceStart;
  const nextSequence = () => sequence++;
  const pendingApprovalIds: string[] = [];
  let approvalOrdinal = 0;
  const previousTotalCostUsdByProvider = new Map<string, number>();
  for (const event of existingEvents) {
    if (event.kind !== "cost_updated" || event.turnId !== turnId) {
      continue;
    }
    const providerKey = sessionProviderKey(event.provider);
    const total = event.cost.totalUsd ?? 0;
    previousTotalCostUsdByProvider.set(
      providerKey,
      Math.max(previousTotalCostUsdByProvider.get(providerKey) ?? 0, total),
    );
  }

  if (phase === "start") {
    const hasEvent = (kind: CanonicalSessionEvent["kind"]): boolean => existingEvents.some(
      (event) => event.kind === kind && event.turnId === turnId,
    );
    if (!hasEvent("turn_started")) events.push(createSessionEvent<"turn_started">({
      kilnSessionId: session.id,
      sequence: nextSequence(),
      kind: "turn_started",
      turnId,
      turnOrdinal,
      trigger: "user_message",
      source: runtimeSource,
      timestamp: input.turnStartedAt,
    }));

    if (!hasEvent("user_message")) events.push(createSessionEvent<"user_message">({
      kilnSessionId: session.id,
      sequence: nextSequence(),
      kind: "user_message",
      turnId,
      messageId: `${turnId}:user`,
      content: userMessageContent,
      source: userSource,
      timestamp: input.turnStartedAt,
    }));

    if (!hasEvent("continuity_decided")) events.push(createSessionEvent<"continuity_decided">({
      kilnSessionId: session.id,
      sequence: nextSequence(),
      kind: "continuity_decided",
      turnId,
      decision: "continue",
      reason: formatContinuityReason(input.continuity),
      source: runtimeSource,
      timestamp: input.turnStartedAt,
    }));
  }

  if (phase === "progress") for (const runtimeEvent of input.runtimeEvents) {
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
        const providerIdentity = toSessionProviderIdentity(runtimeEvent);
        const providerKey = sessionProviderKey(providerIdentity);
        const totalCostUsd = runtimeEvent.totalCostUsd;
        const previousTotalCostUsd = previousTotalCostUsdByProvider.get(providerKey) ?? 0;
        const deltaUsd = Math.max(0, totalCostUsd - previousTotalCostUsd);
        previousTotalCostUsdByProvider.set(providerKey, Math.max(previousTotalCostUsd, totalCostUsd));
        const costEvent = createSessionEvent<"cost_updated">({
            kilnSessionId: session.id,
            sequence: nextSequence(),
            kind: "cost_updated",
            turnId,
            provider: providerIdentity,
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

  if (phase === "terminal") {
    const attributedCostEventIds = new Set(existingEvents
      .filter((event): event is Extract<CanonicalSessionEvent, { readonly kind: "lifecycle_attribution_recorded" }> =>
        event.kind === "lifecycle_attribution_recorded" && event.turnId === turnId)
      .map((event) => event.parentEventId));
    for (const costEvent of existingEvents) {
      if (costEvent.kind !== "cost_updated" || costEvent.turnId !== turnId || attributedCostEventIds.has(costEvent.eventId)) {
        continue;
      }
      events.push(createLifecycleAttributionEvent({
        costEvent,
        input,
        sequence: nextSequence(),
        runtimeSource,
        observedAt: costEvent.timestamp,
      }));
    }
  if (phase === "terminal" && input.runtimeEvents.length > 0) {
    const terminalRuntimeEvents = buildCanonicalTurnEvents(
      input,
      "progress",
      [...existingEvents, ...events],
      sequence,
    );
    events.push(...terminalRuntimeEvents);
    sequence += terminalRuntimeEvents.length;
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

  const disposition = requireCanonicalTurnDisposition(input);
  events.push(createSessionEvent<"turn_completed">({
    kilnSessionId: session.id,
    sequence: nextSequence(),
    kind: "turn_completed",
    turnId,
    ...disposition,
    outputMessageId: assistantMessageContent ? `${turnId}:assistant` : undefined,
    durationMs: Math.max(0, input.turnCompletedAt.getTime() - input.turnStartedAt.getTime()),
    source: runtimeSource,
    timestamp: input.turnCompletedAt,
  }));
  }

  return events;
}

function requireCanonicalTurnDisposition(input: CanonicalTurnEventInput): RuntimeTurnTerminalDisposition {
  if (input.disposition === undefined) {
    throw new Error("Canonical turn completion requires a terminal disposition.");
  }
  return input.disposition;
}

function createLifecycleAttributionEvent(details: {
  readonly costEvent: Extract<CanonicalSessionEvent, { readonly kind: "cost_updated" }>;
  readonly input: CanonicalTurnEventInput;
  readonly sequence: number;
  readonly runtimeSource: SessionEventSource;
  readonly observedAt: Date;
}): Extract<CanonicalSessionEvent, { readonly kind: "lifecycle_attribution_recorded" }> {
  const { costEvent } = details;
  const route = `${costEvent.provider.provider}/${costEvent.provider.model}`;
  const turnId = costEvent.turnId ?? details.input.turnId;
  if (!turnId) throw new Error("Lifecycle attribution requires a canonical turn id.");
  const lifecycleEvidence = normalizeLifecycleAttributionEvidence(
    details.input.lifecycleAttributionEvidence,
    costEvent.kilnSessionId,
    turnId,
  );
  const attributionLedger = projectCostUpdatedEventToLifecycleLedger(costEvent, {
    allocations: projectRuntimeLifecycleAttributionAllocations({
      contextAudit: lifecycleEvidence.contextAudit,
      finalOutput: lifecycleEvidence.finalOutput,
      route,
    }),
    context: { route },
  });
  const reconciled = reconcileLifecycleAttributionLedger(costEvent, attributionLedger);
  const efficiencyEvidence = projectVerifiedEfficiencyEvidence({
    lifecycleEvidence: {
      costEvent,
      ledger: reconciled.ledger,
      summary: reconciled.summary,
    },
    observedAt: details.observedAt.toISOString(),
    policy: details.input.efficiencyPolicy ?? {
      owner: "ContextGovernor",
      policyId: "context-whole-block-static-v1",
      configurationHash: hashPolicyAdaptationConfiguration({ contextAllocationMode: "whole-block" }),
    },
    outcome: details.input.disposition?.outcome === "completed"
      ? "succeeded"
      : details.input.disposition?.outcome === "failed"
        ? "failed"
        : "unknown",
  });
  return createSessionEvent<"lifecycle_attribution_recorded">({
    kilnSessionId: costEvent.kilnSessionId,
    sequence: details.sequence,
    kind: "lifecycle_attribution_recorded",
    turnId,
    parentEventId: costEvent.eventId,
    ledger: reconciled.ledger,
    summary: reconciled.summary,
    efficiencyEvidence,
    source: details.runtimeSource,
    timestamp: details.observedAt,
  });
}

/** Durable sink for canonical Runtime turn evidence. */
export type CanonicalSessionEventPersistence = (
  events: readonly CanonicalSessionEvent[],
) => Promise<void>;

export interface CanonicalTurnLifecycleOptions {
  readonly session: RuntimeSession;
  readonly turnId: string;
  readonly channel: string;
  readonly userMessageContent: string;
  readonly turnStartedAt: Date;
  readonly continuity: RuntimeContinuitySnapshot;
  readonly executionRouteId?: string;
  readonly persist?: CanonicalSessionEventPersistence;
  readonly publish?: (events: readonly CanonicalSessionEvent[]) => void;
  /** Called as soon as canonical progress cannot be persisted. */
  readonly requestAbort?: (reason: unknown) => void;
}

class CanonicalTurnEventBuilder {
  readonly #baseInput: CanonicalTurnEventInput;
  readonly #turnId: string;
  readonly #pendingApprovalIds: string[] = [];
  #approvalOrdinal = 0;

  constructor(input: CanonicalTurnEventInput) {
    this.#baseInput = input;
    this.#turnId = requireCanonicalTurnIdentity(input.session, input.turnId).turnId;
  }

  get turnId(): string {
    return this.#turnId;
  }

  normalizeApprovalEvent(event: CapturedRuntimeLedgerEvent): CapturedRuntimeLedgerEvent {
    if (event.type === "approval_requested") {
      const approvalId = event.approvalId ?? `${this.#turnId}:approval:${++this.#approvalOrdinal}`;
      this.#pendingApprovalIds.push(approvalId);
      return { ...event, approvalId };
    }
    if (event.type !== "approval_received") return event;
    const approvalId = event.approvalId
      ?? this.#pendingApprovalIds.shift()
      ?? `${this.#turnId}:approval:${++this.#approvalOrdinal}`;
    if (event.approvalId) {
      const pendingIndex = this.#pendingApprovalIds.indexOf(event.approvalId);
      if (pendingIndex >= 0) this.#pendingApprovalIds.splice(pendingIndex, 1);
    }
    return { ...event, approvalId };
  }

  start(
    existingEvents: readonly CanonicalSessionEvent[],
    nextSequence: number,
  ): readonly CanonicalSessionEvent[] {
    return this.#build("start", [], existingEvents, nextSequence);
  }

  progress(
    event: CapturedRuntimeLedgerEvent,
    existingEvents: readonly CanonicalSessionEvent[],
    nextSequence: number,
  ): readonly CanonicalSessionEvent[] {
    return this.#build("progress", [event], existingEvents, nextSequence);
  }

  terminal(
    input: CanonicalTurnTerminalInput,
    existingEvents: readonly CanonicalSessionEvent[],
    nextSequence: number,
  ): readonly CanonicalSessionEvent[] {
    return this.#build("terminal", [], existingEvents, nextSequence, input);
  }

  #build(
    phase: CanonicalTurnEventPhase,
    runtimeEvents: readonly CapturedRuntimeLedgerEvent[],
    existingEvents: readonly CanonicalSessionEvent[],
    nextSequence: number,
    terminalInput?: CanonicalTurnTerminalInput,
  ): readonly CanonicalSessionEvent[] {
    const projectedRuntimeEvents = phase === "terminal"
      ? (terminalInput?.terminalRuntimeEvents ?? [])
      : runtimeEvents;
    const input: CanonicalTurnEventInput = {
      ...this.#baseInput,
      ...(terminalInput ?? {}),
      runtimeEvents: projectedRuntimeEvents,
    };
    return buildCanonicalTurnEvents(input, phase, existingEvents, nextSequence);
  }
}

export type CanonicalTurnLifecycleState = "open" | "settling" | "settled" | "failed";

/**
 * Owns one Runtime turn from its durable start through exactly one terminal.
 * EventBus notifications are synchronous; this owner queues them in arrival
 * order and commits each batch only after its durable sink succeeds.
 */
export class CanonicalTurnLifecycle {
  readonly #options: CanonicalTurnLifecycleOptions;
  readonly #builder: CanonicalTurnEventBuilder;
  readonly #committedRuntimeKeys = new Set<string>();
  readonly #pendingRuntimeKeys = new Set<string>();
  #writeTail: Promise<void> = Promise.resolve();
  #writeFailure: unknown;
  #started = false;
  #state: CanonicalTurnLifecycleState = "open";
  #settledDisposition: RuntimeTurnTerminalDisposition | undefined;
  #settlement: Promise<void> | undefined;

  constructor(options: CanonicalTurnLifecycleOptions) {
    this.#options = options;
    this.#builder = new CanonicalTurnEventBuilder({
      session: options.session,
      executionRouteId: options.executionRouteId,
      turnId: options.turnId,
      channel: options.channel,
      userMessageContent: options.userMessageContent,
      queued: false,
      turnStartedAt: options.turnStartedAt,
      turnCompletedAt: options.turnStartedAt,
      continuity: options.continuity,
      runtimeEvents: [],
    });
    const turnId = this.#builder.turnId;
    const existingTerminal = options.session.sessionEvents.find(
      (event): event is Extract<CanonicalSessionEvent, { readonly kind: "turn_completed" }> =>
        event.kind === "turn_completed" && event.turnId === turnId,
    );
    if (existingTerminal) {
      this.#state = "settled";
      this.#settledDisposition = dispositionFromCanonicalTurnCompletedEvent(existingTerminal);
    }
  }

  get state(): CanonicalTurnLifecycleState {
    return this.#state;
  }

  async start(): Promise<void> {
    if (this.#started) {
      await this.flush();
      return;
    }
    if (this.#state === "settled") {
      throw new Error(
        `Canonical turn ${this.#builder.turnId} is already settled as ${this.#settledDisposition?.outcome}.`,
      );
    }
    if (this.#state !== "open") {
      if (this.#state === "failed") throw this.#writeFailure;
      this.#started = true;
      return;
    }
    this.#started = true;
    this.#enqueue((existingEvents, nextSequence) => {
      const existingTerminal = existingEvents.find(
        (event): event is Extract<CanonicalSessionEvent, { readonly kind: "turn_completed" }> =>
          event.kind === "turn_completed" && event.turnId === this.#builder.turnId,
      );
      if (existingTerminal) {
        throw new Error(`Canonical turn ${this.#builder.turnId} is already settled as ${existingTerminal.outcome}.`);
      }
      return this.#builder.start(existingEvents, nextSequence);
    }, []);
    await this.flush();
  }

  /** Queues one runtime event; late events after settling are ignored. */
  appendRuntimeEvent(event: CapturedRuntimeLedgerEvent): boolean {
    if (!this.#started) {
      throw new Error("Canonical Runtime turn lifecycle must start before runtime events are appended.");
    }
    if (this.#state === "failed") return false;
    if (this.#state !== "open" || event.sessionId !== this.#options.session.id) return false;
    const key = canonicalRuntimeEventIdentity(event);
    if (this.#committedRuntimeKeys.has(key) || this.#pendingRuntimeKeys.has(key)
      || runtimeEventIsAlreadyCanonical(this.#options.session.sessionEvents, this.#builder.turnId, event)) {
      return false;
    }
    const normalizedEvent = this.#builder.normalizeApprovalEvent(event);
    this.#pendingRuntimeKeys.add(key);
    this.#enqueue(
      (existingEvents, nextSequence) => this.#builder.progress(normalizedEvent, existingEvents, nextSequence),
      [key],
    );
    return true;
  }

  async appendRuntimeEvents(events: readonly CapturedRuntimeLedgerEvent[]): Promise<void> {
    for (const event of events) this.appendRuntimeEvent(event);
    await this.flush();
  }

  async settle(input: CanonicalTurnTerminalInput): Promise<void> {
    if (this.#state === "settled") {
      if (!sameTurnTerminalDisposition(this.#settledDisposition, input.disposition)) {
        throw new Error(
          `Canonical turn ${this.#builder.turnId} already settled as ${this.#settledDisposition?.outcome}.`,
        );
      }
      return;
    }
    if (this.#state === "failed") throw this.#writeFailure;
    if (!this.#started) throw new Error("Canonical Runtime turn lifecycle must start before settlement.");
    if (this.#settlement) return this.#settlement;
    this.#state = "settling";
    this.#settlement = (async () => {
      const terminalRuntimeEvents = (input.terminalRuntimeEvents ?? [])
        .map((event) => this.#builder.normalizeApprovalEvent(event));
      this.#enqueue(
        (existingEvents, nextSequence) => this.#builder.terminal({
          ...input,
          ...(terminalRuntimeEvents.length > 0 ? { terminalRuntimeEvents } : {}),
        }, existingEvents, nextSequence),
        [],
      );
      await this.flush();
      this.#state = "settled";
      this.#settledDisposition = input.disposition;
    })();
    return this.#settlement;
  }

  async flush(): Promise<void> {
    await this.#writeTail;
    if (this.#state === "failed") throw this.#writeFailure;
  }

  #enqueue(
    build: CanonicalSessionEventBuilder,
    runtimeKeys: readonly string[],
  ): void {
    this.#writeTail = this.#writeTail.then(async () => {
      if (this.#state === "failed") return;
      try {
        await this.#options.session.enqueueCanonicalSessionEventWrite(build, {
          persist: this.#options.persist,
          publish: this.#options.publish,
        });
        for (const key of runtimeKeys) {
          this.#pendingRuntimeKeys.delete(key);
          this.#committedRuntimeKeys.add(key);
        }
      } catch (error) {
        for (const key of runtimeKeys) this.#pendingRuntimeKeys.delete(key);
        this.#writeFailure ??= error;
        this.#state = "failed";
        this.#options.requestAbort?.(error);
      }
    });
  }
}

export function canonicalRuntimeEventIdentity(event: CapturedRuntimeLedgerEvent): string {
  const base = [event.type, event.sessionId, event.timestamp.toISOString()] as const;
  switch (event.type) {
    case "approval_requested":
      return runtimeEventIdentity([...base, event.approvalId, event.taskId]);
    case "approval_received":
      return runtimeEventIdentity([...base, event.approvalId, event.taskId, event.approved, event.reason ?? ""]);
    case "cost_update":
      return runtimeEventIdentity([
        ...base,
        event.provider ?? "",
        event.model ?? event.canonicalModel ?? "",
        event.inputTokens,
        event.outputTokens,
        event.cacheReadTokens,
        event.cacheWriteTokens,
        event.totalCostUsd,
      ]);
    case "error":
      return runtimeEventIdentity([...base, event.taskId, event.code, event.message]);
    case "model_routed":
      return runtimeEventIdentity([...base, event.provider, event.model, event.routingTier, event.previousModel ?? ""]);
    case "multimodal_routed":
      return runtimeEventIdentity([
        ...base,
        event.provider,
        event.model,
        event.strategy,
        event.reasonCode,
        event.requestedCapability,
      ]);
    case "tool_called":
      return runtimeEventIdentity([...base, event.toolCallId, event.toolCallScopeId, event.toolName, event.taskId ?? ""]);
    case "tool_output":
      return runtimeEventIdentity([
        ...base,
        event.toolCallId,
        event.toolCallScopeId,
        event.toolName,
        event.chunkIndex,
        event.stream,
        event.delta,
      ]);
    case "tool_result":
      return runtimeEventIdentity([
        ...base,
        event.toolCallId,
        event.toolCallScopeId,
        event.toolName,
        event.success,
        event.retryAttempt ?? 0,
        event.durationMs,
        event.resultSummary ?? "",
      ]);
  }
}

function sameTurnTerminalDisposition(
  left: RuntimeTurnTerminalDisposition | undefined,
  right: RuntimeTurnTerminalDisposition,
): boolean {
  if (left === undefined) return false;
  // Replayed canonical events are envelopes: they carry the same flattened
  // disposition fields plus event identity/timing and optional output data.
  // Compare the already-typed disposition structurally while ignoring that
  // envelope metadata.
  return Object.keys(right).every((key) => (
    Object.prototype.hasOwnProperty.call(left, key)
      && stableStringify(Reflect.get(left, key)) === stableStringify(Reflect.get(right, key))
  ));
}

function dispositionFromCanonicalTurnCompletedEvent(
  event: Extract<CanonicalSessionEvent, { readonly kind: "turn_completed" }>,
): RuntimeTurnTerminalDisposition {
  if (event.dispositionReason === "external_harness_completed" || event.dispositionReason === "external_harness_failed") {
    throw new Error("Runtime turn lifecycle cannot resume an external harness terminal event.");
  }
  return event;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? String(value);
}

function runtimeEventIdentity(parts: readonly unknown[]): string {
  return JSON.stringify(parts);
}

function runtimeEventIsAlreadyCanonical(
  sessionEvents: readonly CanonicalSessionEvent[],
  turnId: string,
  runtimeEvent: CapturedRuntimeLedgerEvent,
): boolean {
  return sessionEvents.some((event) => {
    if (!("turnId" in event) || event.turnId !== turnId) {
      return false;
    }
    if (event.timestamp.getTime() !== runtimeEvent.timestamp.getTime()) {
      return false;
    }
    switch (runtimeEvent.type) {
      case "approval_requested":
        return event.kind === "approval_requested"
          && event.approvalId === runtimeEvent.approvalId
          && event.action === runtimeEvent.description;
      case "approval_received":
        return event.kind === "approval_resolved"
          && event.approvalId === runtimeEvent.approvalId
          && event.resolution.decision === (runtimeEvent.approved ? "approved" : "denied")
          && event.resolution.reason === runtimeEvent.reason;
      case "cost_update":
        return event.kind === "cost_updated"
          && event.provider.provider === (runtimeEvent.provider ?? "unknown")
          && event.provider.model === (runtimeEvent.model ?? runtimeEvent.canonicalModel ?? "unknown")
          && event.usage.inputTokens === runtimeEvent.inputTokens
          && event.usage.outputTokens === runtimeEvent.outputTokens
          && event.usage.cacheReadTokens === runtimeEvent.cacheReadTokens
          && event.usage.cacheWriteTokens === runtimeEvent.cacheWriteTokens
          && event.cost.totalUsd === runtimeEvent.totalCostUsd;
      case "error":
        return event.kind === "error_recorded"
          && event.errorCode === runtimeEvent.code
          && event.message === runtimeEvent.message;
      case "model_routed":
        return event.kind === "provider_routed"
          && event.provider.provider === runtimeEvent.provider
          && event.provider.model === runtimeEvent.model
          && event.reason === runtimeEvent.reason;
      case "multimodal_routed":
        return event.kind === "multimodal_routed"
          && event.provider.provider === runtimeEvent.provider
          && event.provider.model === runtimeEvent.model
          && event.strategy === runtimeEvent.strategy
          && event.reasonCode === runtimeEvent.reasonCode;
      case "tool_called":
        return event.kind === "tool_call_started"
          && event.toolCallId === runtimeEvent.toolCallId
          && event.toolCallScopeId === runtimeEvent.toolCallScopeId
          && event.toolName === runtimeEvent.toolName;
      case "tool_output":
        return event.kind === "tool_call_output_delta"
          && event.toolCallId === runtimeEvent.toolCallId
          && event.toolCallScopeId === runtimeEvent.toolCallScopeId
          && event.toolName === runtimeEvent.toolName
          && event.stream === runtimeEvent.stream
          && event.delta === runtimeEvent.delta
          && event.chunkIndex === runtimeEvent.chunkIndex;
      case "tool_result":
        return event.kind === "tool_call_completed"
          && event.toolCallId === runtimeEvent.toolCallId
          && event.toolCallScopeId === runtimeEvent.toolCallScopeId
          && event.toolName === runtimeEvent.toolName
          && event.status.state === (runtimeEvent.success ? "succeeded" : "failed")
          && event.durationMs === runtimeEvent.durationMs
          && event.outputSummary === runtimeEvent.resultSummary;
    }
  });
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
    // The mutation authority reports its terminal outcome inside the durable
    // settlement. A committed change whose reconciliation failed is still a
    // committed change and must never project as a failed mutation.
    const settlement = isRecord(payload.settlement) ? payload.settlement : undefined;
    const outcome = readString(settlement?.outcome);
    if (outcome === "committed" || outcome === "committed-reconciliation-failed") {
      return [createSessionEvent<"config_change_applied">({
        kilnSessionId: input.sessionId,
        sequence: input.sequence(),
        kind: "config_change_applied",
        turnId: input.turnId,
        proposalId: readString(settlement?.proposalId) ?? "unknown",
        approvalId: readString(settlement?.approvalId) ?? "unknown",
        appliedWrites: readObjectPathArray(settlement?.appliedWrites),
        projectionEffects: readProjectionEffectArray(settlement?.reconciliationEffects),
        outcome,
        reconciliationErrors: readReconciliationErrors(settlement?.reconciliationEffects),
        source: input.source,
        timestamp: input.runtimeEvent.timestamp,
      })];
    }
    return [createSessionEvent<"config_change_failed">({
      kilnSessionId: input.sessionId,
      sequence: input.sequence(),
      kind: "config_change_failed",
      turnId: input.turnId,
      proposalId: readString(settlement?.proposalId),
      approvalId: readString(settlement?.approvalId),
      errorMessage: firstDiagnosticMessage(settlement?.diagnostics) ?? input.runtimeEvent.resultSummary ?? "Config apply rejected",
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

/** Flattens reconciliation errors so a partial convergence failure stays legible. */
function readReconciliationErrors(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const errors = isRecord(entry) ? entry.errors : undefined;
    return Array.isArray(errors) ? errors.filter((error): error is string => typeof error === "string") : [];
  });
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

function sessionProviderKey(provider: SessionProviderIdentity): string {
  return `${provider.provider}\0${provider.model}`;
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
