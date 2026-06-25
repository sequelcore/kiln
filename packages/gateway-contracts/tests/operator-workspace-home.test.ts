import { describe, expect, it } from "vitest";
import type { OperatorSessionEvent } from "../src/frames.js";
import {
  createOperatorCockpitBenchmarkFixture,
} from "../src/operator-cockpit-benchmark.js";
import {
  projectOperatorCockpitReadOnlyView,
} from "../src/operator-cockpit-projection.js";
import {
  createOperatorCockpitReadOnlyViewState,
} from "../src/operator-cockpit-view-state.js";
import {
  createOperatorWorkspaceHomeProjection,
} from "../src/operator-workspace-home.js";

describe("operator workspace home projection", () => {
  it("summarizes gateway targets, sessions, managed agents, resources, and attention from shared cockpit state", () => {
    const fixture = createOperatorCockpitBenchmarkFixture({
      fixtureId: "workspace-home",
      instanceCount: 2,
      sessionCount: 3,
      activeManagedSessionCount: 2,
      childInvocationCount: 4,
      eventCount: 24,
      startedAt: "2026-06-25T12:00:00.000Z",
    });
    const resourceEvent: OperatorSessionEvent = {
      ...fixture.events[1]!,
      eventId: "workspace-home:event:resource",
      kind: "tool_call_completed",
      payload: {
        instanceId: "workspace-home:instance:1",
        sessionId: "workspace-home:session:1",
        toolCallId: "workspace-home:tool:read-many",
        toolName: "read_many",
        output: JSON.stringify({
          result: {
            output: "2 files read",
            metadata: {
              resourceLinks: [
                {
                  uri: "kiln://artifacts/workspace-home/content",
                  title: "Workspace Home Content",
                  mimeType: "application/json",
                  relation: "full_output",
                },
                {
                  uri: "kiln://artifacts/workspace-home/summary",
                  title: "Workspace Home Summary",
                  relation: "summary",
                },
              ],
            },
          },
        }),
        state: "succeeded",
      },
    };
    const cockpitProjection = projectOperatorCockpitReadOnlyView({
      projectedAt: "2026-06-25T12:01:00.000Z",
      attachTargets: [
        {
          instanceId: "workspace-home:instance:1",
          label: "Local Operator",
          kind: "local",
          gatewayUrl: "http://127.0.0.1:4810",
        },
        {
          instanceId: "workspace-home:instance:2",
          label: "Remote App",
          kind: "remote",
          gatewayUrl: "https://app.example.invalid",
          gatewayTarget: {
            targetId: "gateway:remote-app",
            kind: "remote-app-gateway",
            trust: "remote",
            appId: "support",
            tenantId: "acme",
          },
        },
      ],
      events: [
        ...fixture.events.slice(0, 1),
        resourceEvent,
        ...fixture.events.slice(2),
      ],
    });
    const cockpitView = createOperatorCockpitReadOnlyViewState({
      projection: cockpitProjection,
      viewState: {},
    });

    const home = createOperatorWorkspaceHomeProjection({
      projectedAt: "2026-06-25T12:02:00.000Z",
      cockpitView,
    });

    expect(home).toMatchObject({
      mode: "read-only",
      projectedAt: "2026-06-25T12:02:00.000Z",
      managedAgents: {
        totalCount: cockpitView.managedAgents.items.length,
        activeCount: cockpitView.managedAgents.activeCount,
        attentionCount: cockpitView.managedAgents.attentionCount,
      },
      attention: cockpitView.attention,
    });
    expect(home.gatewayTargets).toHaveLength(2);
    expect(home.gatewayTargets[0]).toMatchObject({
      instanceId: "workspace-home:instance:1",
      gatewayTarget: {
        targetId: "workspace-home:instance:1",
        kind: "local-operator-gateway",
        trust: "local",
      },
    });
    expect(home.gatewayTargets[1]).toMatchObject({
      instanceId: "workspace-home:instance:2",
      gatewayTarget: {
        targetId: "gateway:remote-app",
        kind: "remote-app-gateway",
        trust: "remote",
        appId: "support",
        tenantId: "acme",
      },
    });
    expect(home.sessions.length).toBe(cockpitProjection.sessions.length);
    expect(home.resources).toMatchObject({
      linkedResourceCount: 2,
      totalCount: 2,
      items: [
        {
          uri: "kiln://artifacts/workspace-home/content",
          title: "Workspace Home Content",
          relation: "full_output",
          target: {
            gatewayTargetId: "workspace-home:instance:1",
            instanceId: "workspace-home:instance:1",
            sessionId: "workspace-home:session:1",
            toolCallId: "workspace-home:tool:read-many",
            resourceUri: "kiln://artifacts/workspace-home/content",
          },
        },
        {
          uri: "kiln://artifacts/workspace-home/summary",
          title: "Workspace Home Summary",
          relation: "summary",
        },
      ],
    });
  });
});
