import { describe, expect, it } from "vitest";
import {
  createOperatorCockpitBenchmarkFixture,
  measureOperatorCockpitProjectionBaseline,
  measureOperatorCockpitReadOnlyProjectionBaseline,
} from "../src/operator-cockpit-benchmark.js";

describe("operator cockpit benchmark fixtures", () => {
  it("creates deterministic high-density session events with explicit instance and session targets", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "multi-session-small",
      instanceCount: 2,
      sessionCount: 3,
      activeManagedSessionCount: 2,
      childInvocationCount: 5,
      eventCount: 30,
      startedAt: "2026-05-14T12:00:00.000Z",
    });

    expect(fixture.summary).toEqual({
      fixtureId: "multi-session-small",
      instanceCount: 2,
      sessionCount: 3,
      activeManagedSessionCount: 2,
      childInvocationCount: 5,
      eventCount: 30,
    });
    expect(fixture.events).toHaveLength(30);
    expect(fixture.events[0]).toMatchObject({
      eventId: "multi-session-small:event:1",
      kilnSessionId: "multi-session-small:session:1",
      sequence: 1,
      kind: "turn_started",
      payload: {
        instanceId: "multi-session-small:instance:1",
        sessionId: "multi-session-small:session:1",
      },
    });
    expect(fixture.events.some((event) => event.kind === "agent_invocation_started")).toBe(true);
    expect(fixture.events.every((event) => typeof event.payload.instanceId === "string")).toBe(true);
  });

  it("measures a shared GUI projection baseline without mutating canonical events", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "projection-small",
      instanceCount: 1,
      sessionCount: 2,
      activeManagedSessionCount: 1,
      childInvocationCount: 3,
      eventCount: 20,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const baseline = measureOperatorCockpitProjectionBaseline({
      fixture,
      measuredAt: "2026-05-14T12:01:00.000Z",
    });

    expect(baseline.surface).toBe("gui-shared-projection");
    expect(baseline.fixture).toEqual(fixture.summary);
    expect(baseline.projectedEventCount).toBe(20);
    expect(baseline.durationMs).toBeGreaterThanOrEqual(0);
    expect(baseline.firstProjection).toMatchObject({
      eventId: "projection-small:event:1",
      title: "Turn Started",
    });
    expect(fixture.events[0]?.payload).toMatchObject({
      instanceId: "projection-small:instance:1",
    });
  });

  it("measures the shared read-only cockpit projection baseline with explicit attach targets", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "read-only-baseline",
      instanceCount: 2,
      sessionCount: 3,
      activeManagedSessionCount: 2,
      childInvocationCount: 5,
      eventCount: 30,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const baseline = measureOperatorCockpitReadOnlyProjectionBaseline({
      fixture,
      measuredAt: "2026-05-14T12:02:00.000Z",
      attachTargets: [
        {
          instanceId: "read-only-baseline:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
        {
          instanceId: "read-only-baseline:instance:2",
          label: "Simulated remote",
          kind: "simulated-remote",
        },
      ],
    });

    expect(baseline.surface).toBe("shared-read-only-cockpit-projection");
    expect(baseline.measuredAt).toBe("2026-05-14T12:02:00.000Z");
    expect(baseline.fixture).toEqual(fixture.summary);
    expect(baseline.projectedEventCount).toBe(30);
    expect(baseline.instanceCount).toBe(2);
    expect(baseline.sessionCount).toBe(3);
    expect(baseline.timelineCount).toBe(30);
    expect(baseline.invocationCount).toBeGreaterThan(0);
    expect(baseline.toolSummaryCount).toBeGreaterThan(0);
    expect(baseline.totalCostUsd).toBeGreaterThan(0);
    expect(baseline.providerRoutes).toContain("synthetic/fixture");
    expect(baseline.durationMs).toBeGreaterThanOrEqual(0);
    expect(baseline.firstTimelineEntry).toMatchObject({
      eventId: "read-only-baseline:event:1",
      target: {
        instanceId: "read-only-baseline:instance:1",
        sessionId: "read-only-baseline:session:1",
      },
      title: "Turn Started",
    });
    expect(baseline.lastTimelineEntry).toMatchObject({
      eventId: "read-only-baseline:event:30",
      target: {
        instanceId: "read-only-baseline:instance:1",
        sessionId: "read-only-baseline:session:3",
      },
    });
    expect(fixture.events[0]?.payload).toMatchObject({
      instanceId: "read-only-baseline:instance:1",
    });
  });

  it("fails the read-only projection baseline when attach targets are missing", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "missing-targets",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 0,
      childInvocationCount: 0,
      eventCount: 1,
      startedAt: "2026-05-14T12:00:00.000Z",
    });

    expect(() => measureOperatorCockpitReadOnlyProjectionBaseline({
      fixture,
      measuredAt: "2026-05-14T12:03:00.000Z",
      attachTargets: [],
    })).toThrow("requires at least one attach target");
  });
});
