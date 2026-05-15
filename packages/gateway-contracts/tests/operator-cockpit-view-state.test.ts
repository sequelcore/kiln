import { describe, expect, it } from "vitest";
import {
  createOperatorCockpitBenchmarkFixture,
} from "../src/operator-cockpit-benchmark.js";
import {
  projectOperatorCockpitReadOnlyView,
} from "../src/operator-cockpit-projection.js";
import {
  createOperatorCockpitReadOnlyViewState,
} from "../src/operator-cockpit-view-state.js";

describe("operator cockpit read-only view state", () => {
  it("derives focused session, filtered timeline, and replay cursor without mutation dispatch", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "view-state",
      instanceCount: 2,
      sessionCount: 3,
      activeManagedSessionCount: 2,
      childInvocationCount: 4,
      eventCount: 24,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "view-state:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
        {
          instanceId: "view-state:instance:2",
          label: "Simulated remote",
          kind: "simulated-remote",
        },
      ],
      events: fixture.events,
    });

    const replayEvent = projection.timeline[1]!;
    const view = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {
        focusTarget: {
          instanceId: replayEvent.instanceId,
          sessionId: replayEvent.sessionId,
        },
        filters: {
          instanceId: replayEvent.instanceId,
          sessionId: replayEvent.sessionId,
          kinds: [replayEvent.kind],
        },
        replayCursor: {
          instanceId: replayEvent.instanceId,
          sessionId: replayEvent.sessionId,
          eventId: replayEvent.eventId,
        },
      },
    });

    expect(view.mode).toBe("read-only");
    expect(view.dispatch).toBe("not-dispatched");
    expect(view.mutationDispatch).toBe("disabled");
    expect(view.focus.resolved).toBe(true);
    expect(view.focus.target).toEqual({
      instanceId: replayEvent.instanceId,
      sessionId: replayEvent.sessionId,
    });
    expect(view.timeline.entries.length).toBeGreaterThan(0);
    expect(view.timeline.entries.every((entry) => (
      entry.instanceId === replayEvent.instanceId
      && entry.sessionId === replayEvent.sessionId
      && entry.kind === replayEvent.kind
    ))).toBe(true);
    expect(view.replay.resolved).toBe(true);
    expect(view.replay.entry?.eventId).toBe(replayEvent.eventId);
  });

  it("fails closed when focus, filters, or replay targets do not resolve", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "view-state-fail",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 1,
      childInvocationCount: 1,
      eventCount: 8,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "view-state-fail:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
      ],
      events: fixture.events,
    });
    const view = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {
        focusTarget: {
          instanceId: "view-state-fail:instance:missing",
          sessionId: "view-state-fail:session:missing",
        },
        filters: {
          instanceId: "view-state-fail:instance:missing",
        },
        replayCursor: {
          instanceId: "view-state-fail:instance:missing",
          sessionId: "view-state-fail:session:missing",
          eventId: "view-state-fail:event:missing",
        },
      },
    });

    expect(view.focus.resolved).toBe(false);
    expect(view.timeline.entries).toEqual([]);
    expect(view.timeline.valid).toBe(false);
    expect(view.replay.resolved).toBe(false);
    expect(view.replay.entry).toBeUndefined();
    expect(view.replay.previousEventId).toBeUndefined();
    expect(view.replay.nextEventId).toBeUndefined();
  });

  it("does not resolve replay when filter state is invalid", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "view-state-invalid-filter-replay",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 1,
      childInvocationCount: 1,
      eventCount: 8,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "view-state-invalid-filter-replay:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
      ],
      events: fixture.events,
    });
    const replayEvent = projection.timeline[0]!;

    const view = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {
        filters: {
          instanceId: "view-state-invalid-filter-replay:instance:missing",
        },
        replayCursor: {
          instanceId: replayEvent.instanceId,
          sessionId: replayEvent.sessionId,
          eventId: replayEvent.eventId,
        },
      },
    });

    expect(view.timeline.valid).toBe(false);
    expect(view.replay.resolved).toBe(false);
    expect(view.replay.entry).toBeUndefined();
  });

  it("filters managed invocation and tool timelines from explicit projected targets", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "view-state-targets",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 1,
      childInvocationCount: 2,
      eventCount: 18,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "view-state-targets:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
      ],
      events: fixture.events,
    });
    const invocation = projection.invocations[0]!;
    const tool = projection.toolSummaries[0]!;

    const invocationView = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {
        filters: {
          instanceId: invocation.instanceId,
          sessionId: invocation.sessionId,
          managedInvocationId: invocation.managedInvocationId,
        },
      },
    });
    const toolView = createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {
        filters: {
          instanceId: tool.instanceId,
          sessionId: tool.sessionId,
          toolCallId: tool.toolCallId,
        },
      },
    });

    expect(invocationView.timeline.valid).toBe(true);
    expect(invocationView.timeline.entries.length).toBeGreaterThan(0);
    expect(invocationView.timeline.entries.every((entry) => (
      entry.target.managedInvocationId === invocation.managedInvocationId
    ))).toBe(true);
    expect(toolView.timeline.valid).toBe(true);
    expect(toolView.timeline.entries.length).toBeGreaterThan(0);
    expect(toolView.timeline.entries.every((entry) => (
      entry.target.toolCallId === tool.toolCallId
    ))).toBe(true);
  });

  it("fails closed for scoped timeline filters without their enclosing target", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "view-state-scoped-targets",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 1,
      childInvocationCount: 1,
      eventCount: 12,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "view-state-scoped-targets:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
      ],
      events: fixture.events,
    });
    const invocation = projection.invocations[0]!;
    const tool = projection.toolSummaries[0]!;

    expect(createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {
        filters: {
          sessionId: invocation.sessionId,
        },
      },
    }).timeline.valid).toBe(false);
    expect(createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {
        filters: {
          instanceId: invocation.instanceId,
          managedInvocationId: invocation.managedInvocationId,
        },
      },
    }).timeline.valid).toBe(false);
    expect(createOperatorCockpitReadOnlyViewState({
      projection,
      viewState: {
        filters: {
          instanceId: tool.instanceId,
          toolCallId: tool.toolCallId,
        },
      },
    }).timeline.valid).toBe(false);
  });
});
