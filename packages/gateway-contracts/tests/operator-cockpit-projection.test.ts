import { describe, expect, it } from "vitest";
import type { OperatorSessionEvent } from "../src/frames.js";
import {
  createOperatorCockpitBenchmarkFixture,
} from "../src/operator-cockpit-benchmark.js";
import {
  createOperatorCockpitReadOnlyAttachPlan,
  projectOperatorCockpitReadOnlyView,
} from "../src/operator-cockpit-projection.js";

describe("operator cockpit read-only projection", () => {
  it("projects canonical events into target-aware cockpit views without mutation authority", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "read-only",
      instanceCount: 2,
      sessionCount: 3,
      activeManagedSessionCount: 2,
      childInvocationCount: 5,
      eventCount: 30,
      startedAt: "2026-05-14T12:00:00.000Z",
    });

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "read-only:instance:1",
          label: "Local / kiln",
          kind: "local",
          gatewayUrl: "http://127.0.0.1:4810",
        },
        {
          instanceId: "read-only:instance:2",
          label: "Simulated remote",
          kind: "simulated-remote",
          gatewayUrl: "https://example.invalid",
        },
      ],
      events: fixture.events,
    });

    expect(projection.mode).toBe("read-only");
    expect(projection.projectedAt).toBe("2026-05-14T12:01:00.000Z");
    expect(projection.instances).toHaveLength(2);
    expect(projection.instances[0]).toMatchObject({
      instanceId: "read-only:instance:1",
      label: "Local / kiln",
      kind: "local",
      gatewayUrl: "http://127.0.0.1:4810",
      eventCount: 20,
      sessionCount: 2,
    });
    expect(projection.sessions).toHaveLength(3);
    expect(projection.sessions[0]).toMatchObject({
      sessionId: "read-only:session:1",
      instanceId: "read-only:instance:1",
      target: {
        instanceId: "read-only:instance:1",
        sessionId: "read-only:session:1",
      },
      eventCount: 10,
      authority: "read",
    });
    expect(projection.timeline).toHaveLength(30);
    expect(projection.timeline[0]).toMatchObject({
      eventId: "read-only:event:1",
      title: "Turn Started",
      target: {
        instanceId: "read-only:instance:1",
        sessionId: "read-only:session:1",
        eventId: "read-only:event:1",
      },
    });
    expect(projection.invocations.length).toBeGreaterThan(0);
    expect(projection.invocations[0]).toMatchObject({
      managedInvocationId: expect.stringContaining("read-only:child:"),
      target: {
        instanceId: expect.stringContaining("read-only:instance:"),
        sessionId: expect.stringContaining("read-only:session:"),
        managedInvocationId: expect.stringContaining("read-only:child:"),
      },
    });
    expect(projection.toolSummaries.length).toBeGreaterThan(0);
    expect(projection.toolSummaries[0]).toMatchObject({
      toolName: "synthetic_tool",
      target: {
        instanceId: expect.stringContaining("read-only:instance:"),
        sessionId: expect.stringContaining("read-only:session:"),
      },
    });
    expect(projection.cost.inputTokens).toBeGreaterThan(0);
    expect(projection.cost.outputTokens).toBeGreaterThan(0);
    expect(projection.cost.totalUsd).toBeGreaterThan(0);
    expect(projection.cost.providerRoutes).toContain("synthetic/fixture");
  });

  it("fails closed when an event references an unattached instance", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "missing-target",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 1,
      childInvocationCount: 1,
      eventCount: 5,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const unknownInstanceEvent: OperatorSessionEvent = {
      ...fixture.events[0]!,
      eventId: "missing-target:event:unknown",
      payload: {
        ...fixture.events[0]!.payload,
        instanceId: "missing-target:instance:unknown",
      },
    };

    expect(() => projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "missing-target:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
      ],
      events: [
        ...fixture.events,
        unknownInstanceEvent,
      ],
    })).toThrow("unattached instance");
  });

  it("rejects ambiguous or unsupported attach targets before projection", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "bad-target",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 0,
      childInvocationCount: 0,
      eventCount: 1,
      startedAt: "2026-05-14T12:00:00.000Z",
    });

    expect(() => projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "bad-target:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
        {
          instanceId: "bad-target:instance:1",
          label: "Duplicate",
          kind: "local",
        },
      ],
      events: fixture.events,
    })).toThrow("duplicated");

    expect(() => projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-14T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "bad-target:instance:1",
          label: "Local / kiln",
          kind: "unsupported" as never,
        },
      ],
      events: fixture.events,
    })).toThrow("unsupported kind");
  });

  it("creates a read-only attach plan for local and simulated remote gateways without opening connections", () => {
    const plan = createOperatorCockpitReadOnlyAttachPlan({
      plannedAt: "2026-05-14T12:04:00.000Z",
      attachTargets: [
        {
          instanceId: "attach-plan:local",
          label: "Local / kiln",
          kind: "local",
          gatewayUrl: "http://127.0.0.1:4810",
        },
        {
          instanceId: "attach-plan:remote",
          label: "Simulated remote",
          kind: "simulated-remote",
          gatewayUrl: "https://example.invalid",
        },
      ],
    });

    expect(plan).toEqual({
      mode: "read-only",
      plannedAt: "2026-05-14T12:04:00.000Z",
      targetCount: 2,
      mutationDispatch: "disabled",
      targets: [
        {
          instanceId: "attach-plan:local",
          label: "Local / kiln",
          kind: "local",
          gatewayUrl: "http://127.0.0.1:4810",
          connectionKind: "operator-gateway",
          transport: "http-ws",
          connectionState: "planned",
          mutationDispatch: "disabled",
        },
        {
          instanceId: "attach-plan:remote",
          label: "Simulated remote",
          kind: "simulated-remote",
          gatewayUrl: "https://example.invalid",
          connectionKind: "simulated-app-gateway",
          transport: "simulated-http-ws",
          connectionState: "planned",
          mutationDispatch: "disabled",
        },
      ],
    });
  });

  it("fails read-only attach planning for missing or unsafe gateway URLs", () => {
    expect(() => createOperatorCockpitReadOnlyAttachPlan({
      plannedAt: "2026-05-14T12:04:00.000Z",
      attachTargets: [
        {
          instanceId: "attach-plan:local",
          label: "Local / kiln",
          kind: "local",
        },
      ],
    })).toThrow("requires gatewayUrl");

    expect(() => createOperatorCockpitReadOnlyAttachPlan({
      plannedAt: "2026-05-14T12:04:00.000Z",
      attachTargets: [
        {
          instanceId: "attach-plan:local",
          label: "Local / kiln",
          kind: "local",
          gatewayUrl: "file:///C:/workspace/kiln",
        },
      ],
    })).toThrow("must use http:// or https://");
  });

  it("projects tool resource links as target-aware read-only cockpit resources", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "resource-links",
      instanceCount: 1,
      sessionCount: 1,
      activeManagedSessionCount: 0,
      childInvocationCount: 0,
      eventCount: 2,
      startedAt: "2026-05-14T12:00:00.000Z",
    });
    const toolEvent: OperatorSessionEvent = {
      ...fixture.events[1]!,
      eventId: "resource-links:event:2",
      kind: "tool_call_completed",
      payload: {
        fixtureId: "resource-links",
        instanceId: "resource-links:instance:1",
        sessionId: "resource-links:session:1",
        toolCallId: "resource-links:tool:read-many",
        toolName: "read_many",
        output: JSON.stringify({
          result: {
            output: "2 files read",
            metadata: {
              operation: "read_many",
              fileCount: 2,
              resourceLinks: [
                {
                  uri: "kiln://artifacts/read-many/content",
                  title: "Read Many Content",
                  mimeType: "application/json",
                  relation: "full_output",
                },
                {
                  uri: "kiln://artifacts/read-many/summary",
                  title: "Read Many Summary",
                  relation: "summary",
                },
              ],
            },
          },
        }),
        state: "succeeded",
      },
    };

    const projection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-05-14T12:05:00.000Z",
      attachTargets: [
        {
          instanceId: "resource-links:instance:1",
          label: "Local / kiln",
          kind: "local",
        },
      ],
      events: [
        fixture.events[0]!,
        toolEvent,
      ],
    });

    expect(projection.instances[0]).toMatchObject({
      resourceLinkCount: 2,
    });
    expect(projection.sessions[0]).toMatchObject({
      resourceLinkCount: 2,
    });
    expect(projection.timeline[1]?.resourceLinks).toEqual([
      {
        uri: "kiln://artifacts/read-many/content",
        title: "Read Many Content",
        mimeType: "application/json",
        relation: "full_output",
        target: {
          instanceId: "resource-links:instance:1",
          sessionId: "resource-links:session:1",
          eventId: "resource-links:event:2",
          toolCallId: "resource-links:tool:read-many",
          resourceUri: "kiln://artifacts/read-many/content",
        },
      },
      {
        uri: "kiln://artifacts/read-many/summary",
        title: "Read Many Summary",
        relation: "summary",
        target: {
          instanceId: "resource-links:instance:1",
          sessionId: "resource-links:session:1",
          eventId: "resource-links:event:2",
          toolCallId: "resource-links:tool:read-many",
          resourceUri: "kiln://artifacts/read-many/summary",
        },
      },
    ]);
    expect(projection.toolSummaries[0]).toMatchObject({
      resourceLinkCount: 2,
      resourceLinks: [
        expect.objectContaining({
          uri: "kiln://artifacts/read-many/content",
          target: {
            instanceId: "resource-links:instance:1",
            sessionId: "resource-links:session:1",
            eventId: "resource-links:event:2",
            toolCallId: "resource-links:tool:read-many",
            resourceUri: "kiln://artifacts/read-many/content",
          },
        }),
        expect.objectContaining({
          uri: "kiln://artifacts/read-many/summary",
        }),
      ],
    });
  });
});
