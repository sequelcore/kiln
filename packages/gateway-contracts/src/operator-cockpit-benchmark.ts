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
