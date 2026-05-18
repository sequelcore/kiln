import type {
  OperatorEventPresentation,
} from "./operator-event-presentation.js";
import {
  presentOperatorSessionEvent,
} from "./operator-event-presentation.js";
import type {
  OperatorSessionEvent,
  OperatorSessionEventKind,
  OperatorSessionEventSource,
} from "./frames.js";
import type {
  OperatorCockpitAttachTarget,
  OperatorCockpitTimelineEntry,
} from "./operator-cockpit-projection.js";
import {
  projectOperatorCockpitReadOnlyView,
} from "./operator-cockpit-projection.js";
import type {
  OperatorCockpitReadOnlyViewStateInput,
} from "./operator-cockpit-view-state.js";
import {
  createOperatorCockpitReadOnlyViewState,
} from "./operator-cockpit-view-state.js";

export interface OperatorCockpitBenchmarkFixtureInput {
  readonly fixtureId: string;
  readonly instanceCount: number;
  readonly sessionCount: number;
  readonly activeManagedSessionCount: number;
  readonly childInvocationCount: number;
  readonly eventCount: number;
  readonly startedAt: string;
}

export interface OperatorCockpitBenchmarkFixtureSummary {
  readonly fixtureId: string;
  readonly instanceCount: number;
  readonly sessionCount: number;
  readonly activeManagedSessionCount: number;
  readonly childInvocationCount: number;
  readonly eventCount: number;
}

export interface OperatorCockpitBenchmarkFixture {
  readonly summary: OperatorCockpitBenchmarkFixtureSummary;
  readonly events: readonly OperatorSessionEvent[];
}

export interface OperatorCockpitProjectionBaselineInput {
  readonly fixture: OperatorCockpitBenchmarkFixture;
  readonly measuredAt: string;
}

export interface OperatorCockpitProjectionSummary {
  readonly eventId: string;
  readonly title: string;
  readonly tone: OperatorEventPresentation["tone"];
  readonly compactText: string;
}

export interface OperatorCockpitProjectionBaseline {
  readonly surface: "gui-shared-projection";
  readonly measuredAt: string;
  readonly fixture: OperatorCockpitBenchmarkFixtureSummary;
  readonly projectedEventCount: number;
  readonly durationMs: number;
  readonly firstProjection?: OperatorCockpitProjectionSummary;
  readonly lastProjection?: OperatorCockpitProjectionSummary;
}

export interface OperatorCockpitReadOnlyProjectionBaselineInput {
  readonly fixture: OperatorCockpitBenchmarkFixture;
  readonly measuredAt: string;
  readonly attachTargets: readonly OperatorCockpitAttachTarget[];
}

export interface OperatorCockpitReadOnlyTimelineSummary {
  readonly eventId: string;
  readonly title: string;
  readonly tone: OperatorCockpitTimelineEntry["tone"];
  readonly target: OperatorCockpitTimelineEntry["target"];
}

export interface OperatorCockpitReadOnlyProjectionBaseline {
  readonly surface: "shared-read-only-cockpit-projection";
  readonly measuredAt: string;
  readonly fixture: OperatorCockpitBenchmarkFixtureSummary;
  readonly projectedEventCount: number;
  readonly durationMs: number;
  readonly instanceCount: number;
  readonly sessionCount: number;
  readonly timelineCount: number;
  readonly invocationCount: number;
  readonly toolSummaryCount: number;
  readonly totalCostUsd: number;
  readonly providerRoutes: readonly string[];
  readonly firstTimelineEntry?: OperatorCockpitReadOnlyTimelineSummary;
  readonly lastTimelineEntry?: OperatorCockpitReadOnlyTimelineSummary;
}

export interface OperatorCockpitReadOnlyViewStateBaselineInput {
  readonly fixture: OperatorCockpitBenchmarkFixture;
  readonly measuredAt: string;
  readonly attachTargets: readonly OperatorCockpitAttachTarget[];
  readonly viewState: OperatorCockpitReadOnlyViewStateInput["viewState"];
}

export interface OperatorCockpitReadOnlyViewStateBaseline {
  readonly surface: "shared-read-only-cockpit-view-state";
  readonly measuredAt: string;
  readonly fixture: OperatorCockpitBenchmarkFixtureSummary;
  readonly durationMs: number;
  readonly focusResolved: boolean;
  readonly timelineValid: boolean;
  readonly filteredTimelineCount: number;
  readonly replayResolved: boolean;
  readonly replayEventId?: string;
  readonly previousEventId?: string;
  readonly nextEventId?: string;
  readonly instanceCount: number;
  readonly sessionCount: number;
  readonly timelineCount: number;
  readonly invocationCount: number;
  readonly toolSummaryCount: number;
}

export type OperatorCockpitBenchmarkEvidenceStatus =
  | "contract-only"
  | "insufficient-evidence"
  | "promotion-candidate"
  | "rejected";

export type OperatorCockpitBenchmarkEvidenceRecommendation =
  | "continue-contract-only"
  | "run-rendering-benchmarks"
  | "improve-web-gui"
  | "promote-native-surface"
  | "abandon";

export interface OperatorCockpitBrowserRenderingBenchmarkEvidenceReport {
  readonly measuredAt: string;
  readonly workloadId: string;
  readonly fixtureId?: string;
  readonly measured: boolean;
  readonly environment: string;
  readonly sampleCount: number;
}

export interface OperatorCockpitNativeRenderingBenchmarkEvidenceReport {
  readonly measuredAt: string;
  readonly workloadId: string;
  readonly fixtureId?: string;
  readonly measured: boolean;
  readonly environment: string;
  readonly sampleCount: number;
  readonly nativeAdvantageConfirmed?: boolean;
}

export interface OperatorCockpitDispatchEvidence {
  readonly measured: boolean;
}

export interface OperatorCockpitTargetClarityReport {
  readonly measuredAt: string;
  readonly workloadId: string;
  readonly fixtureId?: string;
  readonly measured: boolean;
  readonly complete: boolean;
  readonly targetCount: number;
}

export interface OperatorCockpitInteractionLatencyReport {
  readonly measuredAt: string;
  readonly workloadId: string;
  readonly fixtureId?: string;
  readonly measured: boolean;
  readonly complete: boolean;
  readonly sampleCount: number;
  readonly p95LatencyMs: number;
}

export interface OperatorCockpitMemoryReport {
  readonly measuredAt: string;
  readonly workloadId: string;
  readonly fixtureId?: string;
  readonly measured: boolean;
  readonly complete: boolean;
  readonly sampleCount: number;
  readonly peakRssMb: number;
}

export interface OperatorCockpitBenchmarkEvidenceReportInput {
  readonly measuredAt: string;
  readonly fixture?: OperatorCockpitBenchmarkFixture;
  readonly fixtureSummary?: OperatorCockpitBenchmarkFixtureSummary;
  readonly projectionBaseline?: OperatorCockpitProjectionBaseline;
  readonly readOnlyProjectionBaseline?: OperatorCockpitReadOnlyProjectionBaseline;
  readonly readOnlyViewStateBaseline?: OperatorCockpitReadOnlyViewStateBaseline;
  readonly browserRenderingEvidence?: OperatorCockpitBrowserRenderingBenchmarkEvidenceReport;
  readonly nativeRenderingEvidence?: OperatorCockpitNativeRenderingBenchmarkEvidenceReport;
  readonly resourceOpeningDispatchEvidence?: OperatorCockpitDispatchEvidence;
  readonly cancellationDispatchEvidence?: OperatorCockpitDispatchEvidence;
  readonly targetClarityReport?: OperatorCockpitTargetClarityReport;
  readonly interactionLatencyReport?: OperatorCockpitInteractionLatencyReport;
  readonly memoryReport?: OperatorCockpitMemoryReport;
}

export interface OperatorCockpitBenchmarkEvidenceReport {
  readonly measuredAt: string;
  readonly fixture: OperatorCockpitBenchmarkFixtureSummary;
  readonly status: OperatorCockpitBenchmarkEvidenceStatus;
  readonly recommendation: OperatorCockpitBenchmarkEvidenceRecommendation;
  readonly implementedEvidence: readonly string[];
  readonly missingEvidence: readonly string[];
  readonly promotionAllowed: boolean;
  readonly mutationDispatch: "disabled";
  readonly networkAttach: "not-started" | "measured";
  readonly renderingBenchmark: "not-run" | "partial" | "measured";
}

export type OperatorCockpitBenchmarkSurface =
  | "web-gui"
  | "native-cockpit";

export type OperatorCockpitBenchmarkRunnerKind =
  | "browser-rendering"
  | "native-rendering";

export type OperatorCockpitBenchmarkWorkloadKind =
  | "single-session-heavy"
  | "multi-session"
  | "multi-instance";

export interface OperatorCockpitBenchmarkRunnerAdmissionPrerequisites {
  readonly runnerAvailable: boolean;
  readonly rendererAvailable: boolean;
  readonly fixtureApproved: boolean;
  readonly baselineEvidencePresent: boolean;
}

export type OperatorCockpitBenchmarkRunnerAdmissionMissingPrerequisite =
  | "runnerAvailable"
  | "rendererAvailable"
  | "fixtureApproved"
  | "baselineEvidencePresent";

export type OperatorCockpitBenchmarkRunnerAdmissionFailedThreshold =
  | "surface-runner-mismatch"
  | "invalid-instance-count"
  | "invalid-session-count"
  | "invalid-event-count"
  | "invalid-child-invocation-count"
  | "invalid-active-managed-session-count"
  | "minimum-instance-count"
  | "minimum-session-count"
  | "minimum-active-managed-session-count"
  | "minimum-child-invocation-count"
  | "minimum-event-count";

export interface OperatorCockpitBenchmarkRunnerAdmissionInput {
  readonly measuredAt: string;
  readonly surface: OperatorCockpitBenchmarkSurface;
  readonly runnerKind: OperatorCockpitBenchmarkRunnerKind;
  readonly workloadKind: OperatorCockpitBenchmarkWorkloadKind;
  readonly fixtureSummary: OperatorCockpitBenchmarkFixtureSummary;
  readonly prerequisites: OperatorCockpitBenchmarkRunnerAdmissionPrerequisites;
}

export interface OperatorCockpitBenchmarkRunnerAdmission {
  readonly measuredAt: string;
  readonly surface: OperatorCockpitBenchmarkSurface;
  readonly runnerKind: OperatorCockpitBenchmarkRunnerKind;
  readonly workloadKind: OperatorCockpitBenchmarkWorkloadKind;
  readonly fixtureSummary: OperatorCockpitBenchmarkFixtureSummary;
  readonly status: "admitted" | "blocked";
  readonly missingPrerequisites: readonly OperatorCockpitBenchmarkRunnerAdmissionMissingPrerequisite[];
  readonly failedThresholds: readonly OperatorCockpitBenchmarkRunnerAdmissionFailedThreshold[];
  readonly execution: "not-started";
  readonly mutationDispatch: "disabled";
  readonly networkAttach: "not-started";
}

export type OperatorCockpitBenchmarkRunnerOrchestrationPlanBlockedReason =
  | "web-admission-blocked"
  | "native-admission-blocked"
  | "web-admission-surface-mismatch"
  | "native-admission-surface-mismatch"
  | "workload-kind-mismatch"
  | "fixture-summary-mismatch";

export interface OperatorCockpitBenchmarkRunnerOrchestrationPlanInput {
  readonly measuredAt: string;
  readonly webAdmission: OperatorCockpitBenchmarkRunnerAdmission;
  readonly nativeAdmission: OperatorCockpitBenchmarkRunnerAdmission;
}

export interface OperatorCockpitBenchmarkRunnerOrchestrationPlan {
  readonly measuredAt: string;
  readonly status: "planned" | "blocked";
  readonly blockedReasons: readonly OperatorCockpitBenchmarkRunnerOrchestrationPlanBlockedReason[];
  readonly workloadKind?: OperatorCockpitBenchmarkWorkloadKind;
  readonly fixtureSummary?: OperatorCockpitBenchmarkFixtureSummary;
  readonly execution: "not-started";
  readonly mutationDispatch: "disabled";
  readonly networkAttach: "not-started";
  readonly recommendation: "not-promoted";
  readonly evidence: "not-promoted";
}

export function createOperatorCockpitBenchmarkFixture(
  input: OperatorCockpitBenchmarkFixtureInput,
): OperatorCockpitBenchmarkFixture {
  assertPositiveInteger(input.instanceCount, "instanceCount");
  assertPositiveInteger(input.sessionCount, "sessionCount");
  assertNonNegativeInteger(input.activeManagedSessionCount, "activeManagedSessionCount");
  assertNonNegativeInteger(input.childInvocationCount, "childInvocationCount");
  assertPositiveInteger(input.eventCount, "eventCount");
  if (input.activeManagedSessionCount > input.sessionCount) {
    throw new RangeError("activeManagedSessionCount cannot exceed sessionCount.");
  }

  const startedAtMs = Date.parse(input.startedAt);
  if (!Number.isFinite(startedAtMs)) {
    throw new RangeError("startedAt must be a valid ISO timestamp.");
  }

  const events = Array.from({ length: input.eventCount }, (_, index) => {
    const sequence = index + 1;
    const sessionOrdinal = (index % input.sessionCount) + 1;
    const instanceOrdinal = ((sessionOrdinal - 1) % input.instanceCount) + 1;
    const childOrdinal = input.childInvocationCount === 0
      ? 0
      : ((index % input.childInvocationCount) + 1);
    const sessionId = `${input.fixtureId}:session:${sessionOrdinal}`;
    const instanceId = `${input.fixtureId}:instance:${instanceOrdinal}`;
    const managedInvocationId = childOrdinal > 0
      ? `${input.fixtureId}:child:${childOrdinal}`
      : undefined;
    const kind = eventKindForIndex(index, sessionOrdinal <= input.activeManagedSessionCount);

    return {
      eventId: `${input.fixtureId}:event:${sequence}`,
      kilnSessionId: sessionId,
      sequence,
      timestamp: new Date(startedAtMs + index).toISOString(),
      kind,
      turnId: `${sessionId}:turn:${Math.floor(index / input.sessionCount) + 1}`,
      source: {
        actor: sourceActorForKind(kind),
        surface: "gateway",
        component: "operator-cockpit-benchmark",
      },
      payload: createBenchmarkPayload({
        fixtureId: input.fixtureId,
        instanceId,
        sessionId,
        sessionOrdinal,
        sequence,
        kind,
        managedInvocationId,
      }),
    } satisfies OperatorSessionEvent;
  });

  return {
    summary: {
      fixtureId: input.fixtureId,
      instanceCount: input.instanceCount,
      sessionCount: input.sessionCount,
      activeManagedSessionCount: input.activeManagedSessionCount,
      childInvocationCount: input.childInvocationCount,
      eventCount: input.eventCount,
    },
    events,
  };
}

export function measureOperatorCockpitProjectionBaseline(
  input: OperatorCockpitProjectionBaselineInput,
): OperatorCockpitProjectionBaseline {
  const startedAt = performance.now();
  const projections = input.fixture.events.map((event) => {
    const presentation = presentOperatorSessionEvent(event);
    return {
      eventId: event.eventId,
      title: presentation.title,
      tone: presentation.tone,
      compactText: presentation.compactText ?? presentation.title,
    } satisfies OperatorCockpitProjectionSummary;
  });
  const durationMs = performance.now() - startedAt;

  return {
    surface: "gui-shared-projection",
    measuredAt: input.measuredAt,
    fixture: input.fixture.summary,
    projectedEventCount: projections.length,
    durationMs,
    ...(projections[0] ? { firstProjection: projections[0] } : {}),
    ...(projections[projections.length - 1] ? { lastProjection: projections[projections.length - 1] } : {}),
  };
}

export function measureOperatorCockpitReadOnlyProjectionBaseline(
  input: OperatorCockpitReadOnlyProjectionBaselineInput,
): OperatorCockpitReadOnlyProjectionBaseline {
  const startedAt = performance.now();
  const projection = projectOperatorCockpitReadOnlyView({
    projectedAt: input.measuredAt,
    attachTargets: input.attachTargets,
    events: input.fixture.events,
  });
  const durationMs = performance.now() - startedAt;
  const firstTimelineEntry = projection.timeline[0];
  const lastTimelineEntry = projection.timeline[projection.timeline.length - 1];

  return {
    surface: "shared-read-only-cockpit-projection",
    measuredAt: input.measuredAt,
    fixture: input.fixture.summary,
    projectedEventCount: projection.timeline.length,
    durationMs,
    instanceCount: projection.instances.length,
    sessionCount: projection.sessions.length,
    timelineCount: projection.timeline.length,
    invocationCount: projection.invocations.length,
    toolSummaryCount: projection.toolSummaries.length,
    totalCostUsd: projection.cost.totalUsd,
    providerRoutes: projection.cost.providerRoutes,
    ...(firstTimelineEntry
      ? { firstTimelineEntry: summarizeTimelineEntry(firstTimelineEntry) }
      : {}),
    ...(lastTimelineEntry
      ? { lastTimelineEntry: summarizeTimelineEntry(lastTimelineEntry) }
      : {}),
  };
}

export function measureOperatorCockpitReadOnlyViewStateBaseline(
  input: OperatorCockpitReadOnlyViewStateBaselineInput,
): OperatorCockpitReadOnlyViewStateBaseline {
  const projection = projectOperatorCockpitReadOnlyView({
    projectedAt: input.measuredAt,
    attachTargets: input.attachTargets,
    events: input.fixture.events,
  });
  const startedAt = performance.now();
  const view = createOperatorCockpitReadOnlyViewState({
    projection,
    viewState: input.viewState,
  });
  const durationMs = performance.now() - startedAt;

  return {
    surface: "shared-read-only-cockpit-view-state",
    measuredAt: input.measuredAt,
    fixture: input.fixture.summary,
    durationMs,
    focusResolved: view.focus.resolved,
    timelineValid: view.timeline.valid,
    filteredTimelineCount: view.timeline.entries.length,
    replayResolved: view.replay.resolved,
    ...(view.replay.entry ? { replayEventId: view.replay.entry.eventId } : {}),
    ...(view.replay.previousEventId ? { previousEventId: view.replay.previousEventId } : {}),
    ...(view.replay.nextEventId ? { nextEventId: view.replay.nextEventId } : {}),
    instanceCount: projection.instances.length,
    sessionCount: projection.sessions.length,
    timelineCount: projection.timeline.length,
    invocationCount: projection.invocations.length,
    toolSummaryCount: projection.toolSummaries.length,
  };
}

export function createOperatorCockpitBenchmarkEvidenceReport(
  input: OperatorCockpitBenchmarkEvidenceReportInput,
): OperatorCockpitBenchmarkEvidenceReport {
  const fixture = input.fixture?.summary ?? input.fixtureSummary;
  if (!fixture) {
    throw new RangeError("fixture or fixtureSummary is required.");
  }

  const implementedEvidence: string[] = [];
  if (input.projectionBaseline) implementedEvidence.push("shared-projection-baseline");
  if (input.readOnlyProjectionBaseline) implementedEvidence.push("shared-read-only-projection-baseline");
  if (input.readOnlyViewStateBaseline) implementedEvidence.push("shared-read-only-view-state-baseline");

  const hasProjectionBaselines = Boolean(
    input.projectionBaseline
    && input.readOnlyProjectionBaseline
    && input.readOnlyViewStateBaseline,
  );
  const hasBrowserRendering = input.browserRenderingEvidence?.measured === true;
  const hasNativeRendering = input.nativeRenderingEvidence?.measured === true;
  const hasNativeAdvantage = input.nativeRenderingEvidence?.nativeAdvantageConfirmed === true;
  const hasTargetClarity = input.targetClarityReport?.measured === true
    && input.targetClarityReport.complete === true;
  const hasInteractionLatency = input.interactionLatencyReport?.measured === true
    && input.interactionLatencyReport.complete === true;
  const hasMemoryReport = input.memoryReport?.measured === true
    && input.memoryReport.complete === true;
  const promotionAllowed = hasProjectionBaselines
    && hasBrowserRendering
    && hasNativeRendering
    && hasNativeAdvantage
    && hasTargetClarity
    && hasInteractionLatency
    && hasMemoryReport;

  const missingEvidence: string[] = [];
  if (!hasBrowserRendering) missingEvidence.push("browser-rendering-benchmark");
  if (!hasNativeRendering) missingEvidence.push("native-rendering-benchmark");
  if (!hasTargetClarity) missingEvidence.push("target-clarity-report");
  if (!hasInteractionLatency) missingEvidence.push("interaction-latency-report");
  if (!hasMemoryReport) missingEvidence.push("memory-report");
  if (!hasNativeAdvantage) missingEvidence.push("native-advantage-proof");

  const hasExternalEvidence = hasBrowserRendering
    || hasNativeRendering
    || hasTargetClarity
    || hasInteractionLatency
    || hasMemoryReport;
  const status: OperatorCockpitBenchmarkEvidenceStatus = !hasProjectionBaselines
    ? "rejected"
    : promotionAllowed
      ? "promotion-candidate"
      : hasExternalEvidence
        ? "insufficient-evidence"
        : "contract-only";

  const recommendation: OperatorCockpitBenchmarkEvidenceRecommendation = status === "rejected"
    ? "abandon"
    : promotionAllowed
      ? "promote-native-surface"
      : (!hasBrowserRendering || !hasNativeRendering)
        ? "run-rendering-benchmarks"
        : !hasNativeAdvantage
          ? "improve-web-gui"
          : "continue-contract-only";

  return {
    measuredAt: input.measuredAt,
    fixture,
    status,
    recommendation,
    implementedEvidence,
    missingEvidence,
    promotionAllowed,
    mutationDispatch: "disabled",
    networkAttach: "not-started",
    renderingBenchmark: hasBrowserRendering && hasNativeRendering
      ? "measured"
      : hasBrowserRendering || hasNativeRendering
        ? "partial"
        : "not-run",
  };
}

export function createOperatorCockpitBenchmarkRunnerAdmission(
  input: OperatorCockpitBenchmarkRunnerAdmissionInput,
): OperatorCockpitBenchmarkRunnerAdmission {
  const measuredAtMs = Date.parse(input.measuredAt);
  if (!Number.isFinite(measuredAtMs)) {
    throw new RangeError("measuredAt must be a valid ISO timestamp.");
  }

  const missingPrerequisites: OperatorCockpitBenchmarkRunnerAdmissionMissingPrerequisite[] = [];
  if (!input.prerequisites.runnerAvailable) missingPrerequisites.push("runnerAvailable");
  if (!input.prerequisites.rendererAvailable) missingPrerequisites.push("rendererAvailable");
  if (!input.prerequisites.fixtureApproved) missingPrerequisites.push("fixtureApproved");
  if (!input.prerequisites.baselineEvidencePresent) missingPrerequisites.push("baselineEvidencePresent");

  const failedThresholds = evaluateWorkloadThresholds(
    input.surface,
    input.runnerKind,
    input.workloadKind,
    input.fixtureSummary,
  );

  return {
    measuredAt: input.measuredAt,
    surface: input.surface,
    runnerKind: input.runnerKind,
    workloadKind: input.workloadKind,
    fixtureSummary: input.fixtureSummary,
    status: missingPrerequisites.length === 0 && failedThresholds.length === 0
      ? "admitted"
      : "blocked",
    missingPrerequisites,
    failedThresholds,
    execution: "not-started",
    mutationDispatch: "disabled",
    networkAttach: "not-started",
  };
}

export function createOperatorCockpitBenchmarkRunnerOrchestrationPlan(
  input: OperatorCockpitBenchmarkRunnerOrchestrationPlanInput,
): OperatorCockpitBenchmarkRunnerOrchestrationPlan {
  const measuredAtMs = Date.parse(input.measuredAt);
  if (!Number.isFinite(measuredAtMs)) {
    throw new RangeError("measuredAt must be a valid ISO timestamp.");
  }

  const blockedReasons: OperatorCockpitBenchmarkRunnerOrchestrationPlanBlockedReason[] = [];
  if (input.webAdmission.status !== "admitted") {
    blockedReasons.push("web-admission-blocked");
  }
  if (input.nativeAdmission.status !== "admitted") {
    blockedReasons.push("native-admission-blocked");
  }
  if (input.webAdmission.surface !== "web-gui" || input.webAdmission.runnerKind !== "browser-rendering") {
    blockedReasons.push("web-admission-surface-mismatch");
  }
  if (input.nativeAdmission.surface !== "native-cockpit"
    || input.nativeAdmission.runnerKind !== "native-rendering") {
    blockedReasons.push("native-admission-surface-mismatch");
  }

  const workloadKindMatches = input.webAdmission.workloadKind === input.nativeAdmission.workloadKind;
  if (!workloadKindMatches) {
    blockedReasons.push("workload-kind-mismatch");
  }

  const fixtureSummaryMatches = fixtureSummaryEquals(
    input.webAdmission.fixtureSummary,
    input.nativeAdmission.fixtureSummary,
  );
  if (!fixtureSummaryMatches) {
    blockedReasons.push("fixture-summary-mismatch");
  }

  const status = blockedReasons.length === 0 ? "planned" : "blocked";
  return {
    measuredAt: input.measuredAt,
    status,
    blockedReasons,
    ...(status === "planned"
      ? {
        workloadKind: input.webAdmission.workloadKind,
        fixtureSummary: input.webAdmission.fixtureSummary,
      }
      : {}),
    execution: "not-started",
    mutationDispatch: "disabled",
    networkAttach: "not-started",
    recommendation: "not-promoted",
    evidence: "not-promoted",
  };
}

function summarizeTimelineEntry(
  entry: OperatorCockpitTimelineEntry,
): OperatorCockpitReadOnlyTimelineSummary {
  return {
    eventId: entry.eventId,
    title: entry.title,
    tone: entry.tone,
    target: entry.target,
  };
}

function eventKindForIndex(
  index: number,
  sessionHasManagedChildren: boolean,
): OperatorSessionEventKind {
  if (index === 0) return "turn_started";
  if (sessionHasManagedChildren && index % 7 === 0) return "agent_invocation_started";
  if (sessionHasManagedChildren && index % 11 === 0) return "agent_invocation_completed";
  if (index % 5 === 0) return "tool_call_completed";
  if (index % 3 === 0) return "cost_updated";
  return "tool_call_started";
}

function sourceActorForKind(
  kind: OperatorSessionEventKind,
): OperatorSessionEventSource["actor"] {
  if (kind === "tool_call_started" || kind === "tool_call_completed") return "tool";
  return "runtime";
}

function createBenchmarkPayload(input: {
  readonly fixtureId: string;
  readonly instanceId: string;
  readonly sessionId: string;
  readonly sessionOrdinal: number;
  readonly sequence: number;
  readonly kind: OperatorSessionEventKind;
  readonly managedInvocationId?: string;
}): Record<string, unknown> {
  const base = {
    fixtureId: input.fixtureId,
    instanceId: input.instanceId,
    sessionId: input.sessionId,
  };

  if (input.kind === "turn_started") {
    return {
      ...base,
      prompt: `Supervise ${input.sessionId}`,
      requestedAuthority: "read",
    };
  }
  if (input.kind === "agent_invocation_started" || input.kind === "agent_invocation_completed") {
    return {
      ...base,
      managedInvocationId: input.managedInvocationId,
      status: input.kind === "agent_invocation_started" ? "running" : "completed",
      task: `Child invocation ${input.managedInvocationId ?? "none"}`,
      summary: `Managed child for ${input.sessionId}`,
      childIdentity: {
        childId: input.managedInvocationId,
        displayName: `Child ${input.sequence}`,
      },
    };
  }
  if (input.kind === "cost_updated") {
    return {
      ...base,
      provider: "synthetic",
      model: "fixture",
      inputTokens: input.sequence * 3,
      outputTokens: input.sequence,
      cost: {
        deltaUsd: input.sequence / 1_000_000,
        totalUsd: input.sequence / 100_000,
      },
    };
  }
  if (input.kind === "tool_call_completed") {
    return {
      ...base,
      toolCallId: `${input.sessionId}:tool:${input.sequence}`,
      toolName: "synthetic_tool",
      outputSummary: `Completed tool work for session ${input.sessionOrdinal}`,
      state: "succeeded",
    };
  }
  return {
    ...base,
    toolCallId: `${input.sessionId}:tool:${input.sequence}`,
    toolName: "synthetic_tool",
    input: {
      target: input.sessionId,
      sequence: input.sequence,
    },
  };
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${field} must be an integer >= 1.`);
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${field} must be an integer >= 0.`);
  }
}

function evaluateWorkloadThresholds(
  surface: OperatorCockpitBenchmarkSurface,
  runnerKind: OperatorCockpitBenchmarkRunnerKind,
  workloadKind: OperatorCockpitBenchmarkWorkloadKind,
  fixture: OperatorCockpitBenchmarkFixtureSummary,
): OperatorCockpitBenchmarkRunnerAdmissionFailedThreshold[] {
  const failed: OperatorCockpitBenchmarkRunnerAdmissionFailedThreshold[] = [];
  const require = (
    condition: boolean,
    threshold: OperatorCockpitBenchmarkRunnerAdmissionFailedThreshold,
  ): void => {
    if (!condition) failed.push(threshold);
  };

  require(surfaceRunnerPairMatches(surface, runnerKind), "surface-runner-mismatch");
  require(Number.isInteger(fixture.instanceCount) && fixture.instanceCount >= 1, "invalid-instance-count");
  require(Number.isInteger(fixture.sessionCount) && fixture.sessionCount >= 1, "invalid-session-count");
  require(Number.isInteger(fixture.eventCount) && fixture.eventCount >= 1, "invalid-event-count");
  require(
    Number.isInteger(fixture.childInvocationCount) && fixture.childInvocationCount >= 0,
    "invalid-child-invocation-count",
  );
  require(
    Number.isInteger(fixture.activeManagedSessionCount)
      && fixture.activeManagedSessionCount >= 0
      && fixture.activeManagedSessionCount <= fixture.sessionCount,
    "invalid-active-managed-session-count",
  );

  if (workloadKind === "single-session-heavy") {
    require(fixture.sessionCount >= 1, "minimum-session-count");
    require(fixture.childInvocationCount >= 50, "minimum-child-invocation-count");
    require(fixture.eventCount >= 100_000, "minimum-event-count");
    return failed;
  }

  if (workloadKind === "multi-session") {
    require(fixture.sessionCount >= 10, "minimum-session-count");
    require(fixture.activeManagedSessionCount >= 3, "minimum-active-managed-session-count");
    require(fixture.childInvocationCount >= 50, "minimum-child-invocation-count");
    require(fixture.eventCount >= 100_000, "minimum-event-count");
    return failed;
  }

  require(fixture.instanceCount >= 2, "minimum-instance-count");
  return failed;
}

function surfaceRunnerPairMatches(
  surface: OperatorCockpitBenchmarkSurface,
  runnerKind: OperatorCockpitBenchmarkRunnerKind,
): boolean {
  if (surface === "web-gui") {
    return runnerKind === "browser-rendering";
  }
  return runnerKind === "native-rendering";
}

function fixtureSummaryEquals(
  left: OperatorCockpitBenchmarkFixtureSummary,
  right: OperatorCockpitBenchmarkFixtureSummary,
): boolean {
  return left.fixtureId === right.fixtureId
    && left.instanceCount === right.instanceCount
    && left.sessionCount === right.sessionCount
    && left.activeManagedSessionCount === right.activeManagedSessionCount
    && left.childInvocationCount === right.childInvocationCount
    && left.eventCount === right.eventCount;
}
