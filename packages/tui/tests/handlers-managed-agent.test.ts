import { describe, expect, it, vi } from "vitest";
import type { OperatorSessionEvent } from "@kilnai/gateway-contracts";

vi.mock("@opentui/core", () => ({
  BoxRenderable: class { add = vi.fn(); },
  TextRenderable: class {
    content = "";
    constructor(_: unknown, props?: { content?: string }) { this.content = props?.content ?? ""; }
  },
  MarkdownRenderable: class {},
  SyntaxStyle: {
    create: () => ({}),
  },
  t: (strings: TemplateStringsArray, ...values: readonly unknown[]) =>
    strings.reduce((text, chunk, index) => `${text}${chunk}${String(values[index] ?? "")}`, ""),
  fg: () => (text: string) => text,
}));

import { handleActivity, sendMessage, type HandlerContext } from "../src/handlers.js";
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
  it("clears prior route-bound context evidence before a new turn streams", async () => {
    const ctx = handlerContext();
    ctx.state.contextUsage = {
      state: "authoritative",
      usedTokens: 2_000,
      contextWindowTokens: 8_000,
      remainingTokens: 6_000,
      usedPercentage: 25,
      providerId: "codex-oauth",
      modelId: "gpt-5.6-terra",
      turnId: "prior:turn:1",
      observedAt: "2026-07-13T00:00:00.000Z",
      measurement: "provider_reported",
      lifecycle: "completed",
      contextWindowAuthority: "provider_reported",
      freshness: "fresh",
    };
    ctx.createSession = async () => ({
      async *run() {
        // The projection must clear before completion evidence is available.
      },
      dispose: vi.fn(),
    });
    ctx.theme = { userBg: "user-bg", userFg: "user-fg" } as HandlerContext["theme"];
    ctx.chatScrollBox = { content: { add: vi.fn() } } as unknown as HandlerContext["chatScrollBox"];
    ctx.messageNodes = [];

    const renderSidebarTurns = vi.fn();
    await sendMessage(
      ctx,
      "switch route",
      { node: null },
      vi.fn(),
      renderSidebarTurns,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      { interval: null },
    );

    expect(ctx.state.contextUsage).toBeUndefined();
    expect(renderSidebarTurns).toHaveBeenCalled();
  });

  it("projects authority and resource identity for governed work items", () => {
    const ctx = handlerContext();
    const workUpdated = sessionEvent("evt-work-updated", 1, "work_item_updated", {
      workItem: {
        id: "work-visible",
        summary: "Audit TUI work item visibility.",
        status: "blocked",
        workflowProfile: "verification-heavy",
        authorityProfile: "authority:foundation-readonly-plan",
        assignedAgentProfile: "foundation-readonly-plan",
        expectedEvidence: ["surface-map", "tests"],
        providedEvidence: ["surface-map"],
        missingEvidence: ["tests"],
        missingResidualRisk: true,
        pauseRequirements: [
          {
            id: "capability-1",
            kind: "capability",
            summary: "Route unavailable",
            status: "pending",
          },
        ],
        updatedAt: "2026-06-24T10:00:00.000Z",
      },
    });

    handleActivity(
      ctx,
      "work_item_updated",
      undefined,
      undefined,
      "blocked",
      undefined,
      (workUpdated.payload as { readonly workItem: unknown }).workItem,
      undefined,
      undefined,
      vi.fn(),
      undefined,
      {
        sessionId: "session-1",
        turnId: "session-1:turn:live",
        sessionEvent: workUpdated,
      },
    );

    expect(ctx.state.workItems).toEqual([
      expect.objectContaining({
        id: "work-visible",
        resourceUri: "kiln://session/work-items/work-visible",
        authorityProfile: "authority:foundation-readonly-plan",
        assignedAgentProfile: "foundation-readonly-plan",
        missingEvidence: ["tests"],
        missingResidualRisk: true,
        pendingPauseRequirementCount: 1,
      }),
    ]);
  });

  it("excludes superseded requirements and fails closed on missing status for governed work items", () => {
    const ctx = handlerContext();
    const workUpdated = sessionEvent("evt-work-superseded", 1, "work_item_updated", {
      workItem: {
        id: "work-superseded",
        summary: "Audit TUI superseded pause requirement handling.",
        status: "pending",
        workflowProfile: "verification-heavy",
        pauseRequirements: [
          {
            id: "capability-1",
            kind: "capability",
            summary: "Route unavailable",
            status: "superseded",
            supersededByRequirementId: "capability-2",
            supersededAt: "2026-07-26T10:00:00.000Z",
            supersededBy: "operator",
            reason: "Replaced by a broader requirement.",
          },
          {
            id: "capability-2",
            kind: "capability",
            summary: "Malformed requirement without a status",
          },
        ],
        updatedAt: "2026-07-26T10:00:00.000Z",
      },
    });

    handleActivity(
      ctx,
      "work_item_updated",
      undefined,
      undefined,
      "pending",
      undefined,
      (workUpdated.payload as { readonly workItem: unknown }).workItem,
      undefined,
      undefined,
      vi.fn(),
      undefined,
      {
        sessionId: "session-1",
        turnId: "session-1:turn:live",
        sessionEvent: workUpdated,
      },
    );

    expect(ctx.state.workItems).toEqual([
      expect.objectContaining({
        id: "work-superseded",
        pendingPauseRequirementCount: 1,
      }),
    ]);
  });

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
