import { describe, expect, it, vi } from "vitest";
import { type ProviderAdapter, type ToolDefinition } from "@kilnai/core/agents";
import { textParts } from "@kilnai/core/engine";
import { canonicalTurnId } from "@kilnai/core/events";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import {
  makeFixtureExecutionEnvelope,
  makeProvider,
  makeSession,
} from "./runtime-session-orchestrator-tools-test-fixture.js";

describe("RuntimeSessionOrchestrator - governed work materialization", () => {
  const tool = (name: string): ToolDefinition => ({
    name,
    description: name,
    inputSchema: {},
    tags: new Set(),
  });

  it("blocks inspection until the exact work-item set and operator-direct goal are materialized", async () => {
    const session = makeSession();
    const turnId = canonicalTurnId(session.id, Math.max(session.userTurnCount + 1, 1));
    let round = 0;
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn().mockImplementation(() => {
        round += 1;
        if (round === 1) {
          return {
            parts: textParts("materializing work"),
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            toolCalls: [
              { id: "tree-early", name: "tree", input: {} },
              { id: "work-1", name: "work_item.update", input: { id: "work-1" } },
              { id: "work-2", name: "work_item.update", input: { id: "work-2" } },
              { id: "work-3", name: "work_item.update", input: { id: "work-3" } },
            ],
            stopReason: "tool_use",
          };
        }
        if (round === 2) {
          return {
            parts: textParts("creating goal"),
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            toolCalls: [
              {
                id: "goal-1",
                name: "goal.create",
                input: {
                  workItemIds: ["work-1", "work-2", "work-3"],
                },
              },
              { id: "tree-same-round", name: "tree", input: {} },
            ],
            stopReason: "tool_use",
          };
        }
        if (round === 3) {
          return {
            parts: textParts("inspecting"),
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            toolCalls: [{ id: "tree-after-goal", name: "tree", input: {} }],
            stopReason: "tool_use",
          };
        }
        return {
          parts: textParts("done"),
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "end_turn",
        };
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const update = vi.fn().mockImplementation(async (input: Record<string, unknown>) => ({
      output: "updated",
      isError: false,
      metadata: { kind: "work_item", item: { id: input.id } },
    }));
    const createGoal = vi.fn().mockImplementation(async (input: Record<string, unknown>) => ({
      output: "created",
      isError: false,
      metadata: {
        kind: "goal",
        goal: {
          id: "goal-1",
          source: { kind: "operator_direct", turnId },
          workItemIds: input.workItemIds,
        },
      },
    }));
    const inspectTree = vi.fn().mockResolvedValue("tree output");
    const tools = [
      tool("work_governance.assess"),
      tool("work_profile.list"),
      tool("work_item.list"),
      tool("work_item.update"),
      tool("goal.create"),
      tool("tree"),
    ];
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools,
      builtinTools: new Map([
        ["work_item.update", update],
        ["goal.create", createGoal],
        ["tree", inspectTree],
      ]),
      executionEnvelope: makeFixtureExecutionEnvelope(5),
    });

    const result = await orchestrator.processMessage(
      session,
      textParts("create a governed goal before inspection"),
      undefined,
      undefined,
      {
        turnCorrelationId: turnId,
        governedWorkRequirement: { kind: "goal_materialization", requiredWorkItemCount: 3 },
      },
    );

    expect(update).toHaveBeenCalledTimes(3);
    expect(createGoal).toHaveBeenCalledTimes(1);
    expect(createGoal).toHaveBeenCalledWith(
      expect.objectContaining({ workItemIds: ["work-1", "work-2", "work-3"] }),
      expect.anything(),
    );
    expect(inspectTree).toHaveBeenCalledTimes(1);
    expect(result.toolExecutions).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolCallId: "tree-early", success: false }),
      expect.objectContaining({ toolCallId: "tree-same-round", success: false }),
      expect.objectContaining({ toolCallId: "tree-after-goal", success: true }),
    ]));
    expect(result.parts).toEqual(textParts("done"));
    const calls = (provider.createMessage as ReturnType<typeof vi.fn>).mock.calls;
    expect((calls[0]?.[0].tools as ToolDefinition[]).map((entry) => entry.name)).not.toContain("tree");
    expect((calls[1]?.[0].tools as ToolDefinition[]).map((entry) => entry.name)).toContain("goal.create");
    expect((calls[2]?.[0].tools as ToolDefinition[]).map((entry) => entry.name)).toContain("tree");
  });

  it("returns a specific terminal reason when materialization reaches its tool-round convergence limit", async () => {
    const provider = makeProvider(1);
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [tool("work_item.update"), tool("goal.create"), tool("tree")],
      builtinTools: new Map([["get_data", vi.fn()]]),
      executionEnvelope: makeFixtureExecutionEnvelope(1),
    });

    const result = await orchestrator.processMessage(
      makeSession(),
      textParts("create the goal first"),
      undefined,
      undefined,
      {
        turnCorrelationId: "turn-1",
        governedWorkRequirement: { kind: "goal_materialization", requiredWorkItemCount: 3 },
      },
    );

    expect(result.dispositionReason).toBe("governed_work_materialization_required");
    expect(result.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: expect.stringContaining("Create 3 more distinct work items") }),
    ]));
  });
});
