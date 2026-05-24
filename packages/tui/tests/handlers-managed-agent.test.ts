import { describe, expect, it, vi } from "vitest";
import type { OperatorSessionEvent } from "@kilnai/gateway-contracts";

vi.mock("@opentui/core", () => ({
  BoxRenderable: class {},
  TextRenderable: class {},
  MarkdownRenderable: class {},
  SyntaxStyle: {
    create: () => ({}),
  },
  t: (strings: TemplateStringsArray, ...values: readonly unknown[]) =>
    strings.reduce((text, chunk, index) => `${text}${chunk}${String(values[index] ?? "")}`, ""),
  fg: () => (text: string) => text,
}));

import { handleActivity, type HandlerContext } from "../src/handlers.js";
import { createReactiveState } from "../src/state.js";

function sessionEvent(
  eventId: string,
  sequence: number,
  kind: OperatorSessionEvent["kind"],
  payload: Record<string, unknown>,
): OperatorSessionEvent {
  return {
    eventId,
    kilnSessionId: "session-1",
    sequence,
    timestamp: `2026-05-23T12:00:0${sequence}.000Z`,
    kind,
    turnId: "session-1:turn:live",
    payload,
  };
}

function handlerContext(renderSidebarManagedAgents = vi.fn()): HandlerContext {
  const state = createReactiveState();
  state.status = "running";
  return {
    state,
    renderSidebarManagedAgents,
    renderSidebarWork: vi.fn(),
  } as unknown as HandlerContext;
}

describe("TUI handler managed-agent projection", () => {
  it("feeds work-item adoption-gate session events into the live managed-agent cockpit state", () => {
    const renderSidebarManagedAgents = vi.fn();
    const ctx = handlerContext(renderSidebarManagedAgents);
    const childCompleted = sessionEvent("evt-child-completed", 1, "agent_invocation_completed", {
      invocationId: "child-adopted",
      managedInvocationId: "child-adopted",
      instanceId: "local-tui",
      sessionId: "session-1",
      lifecycleState: "completed",
    });
    const adoptionUpdated = sessionEvent("evt-adoption-updated", 2, "work_item_updated", {
      instanceId: "local-tui",
      sessionId: "session-1",
      workItem: {
        id: "work-adopted",
        summary: "Adopt child output.",
        status: "completed",
        workflowProfile: "sequel-standard",
        expectedEvidence: ["managed-orchestration:adoption-gate"],
        providedEvidence: ["managed-orchestration:result-handoff"],
        updatedAt: "2026-05-23T12:00:02.000Z",
      },
      managedOrchestrationAdoptionGate: {
        required: true,
        target: "slice-6-handoff-review-adoption",
        reason: "Managed child output must be adopted before closeout.",
        orchestrationId: "orch-adoption",
        childId: "child-adopted",
        mergePolicyMode: "manual",
        status: "adopted",
        adoptedBy: "operator",
        adoptedAt: "2026-05-23T12:00:02.000Z",
        resourceUris: ["kiln://artifacts/orch-adoption/adoption-review"],
        blockingEvidence: [],
      },
    });

    handleActivity(
      ctx,
      "agent_invocation_completed",
      undefined,
      undefined,
      "completed",
      undefined,
      childCompleted.payload,
      undefined,
      undefined,
      vi.fn(),
      undefined,
      {
        sessionId: "session-1",
        turnId: "session-1:turn:live",
        sessionEvent: childCompleted,
      },
    );
    handleActivity(
      ctx,
      "work_item_updated",
      undefined,
      undefined,
      "adopted",
      undefined,
      (adoptionUpdated.payload as { readonly workItem: unknown }).workItem,
      undefined,
      undefined,
      vi.fn(),
      undefined,
      {
        sessionId: "session-1",
        turnId: "session-1:turn:live",
        sessionEvent: adoptionUpdated,
      },
    );

    expect(ctx.state.managedAgentSessionEvents.map((event) => event.eventId)).toEqual([
      "evt-child-completed",
      "evt-adoption-updated",
    ]);
    expect(ctx.state.managedAgents.items).toEqual([
      expect.objectContaining({
        managedInvocationId: "child-adopted",
        adoptionGate: expect.objectContaining({
          status: "adopted",
          adoptedBy: "operator",
        }),
      }),
    ]);
    expect(renderSidebarManagedAgents).toHaveBeenCalledTimes(2);
  });
});
