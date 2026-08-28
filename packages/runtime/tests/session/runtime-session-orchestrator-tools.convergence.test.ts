import { describe, expect, it, vi } from "vitest";
import { type ProviderAdapter, type ToolDefinition, type TurnConvergencePolicyInput } from "@kilnai/core/agents";
import { textParts } from "@kilnai/core/engine";
import { EventBus } from "@kilnai/core/events";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import type { RuntimeExecutionEnvelope } from "../../src/session/runtime-session-orchestrator.types.js";
import {
  deriveRuntimeConvergencePolicyInput,
  RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_INPUT,
} from "../../src/session/runtime-execution-envelope.js";
import {
  makeProvider,
  makeSession,
} from "./runtime-session-orchestrator-tools-test-fixture.js";
import { requireRuntimeConvergence, requireRuntimeConvergencePause } from "./runtime-terminal-fixture.js";

type ProviderResponse = Awaited<ReturnType<ProviderAdapter["createMessage"]>>;

function response(overrides: Partial<ProviderResponse> = {}): ProviderResponse {
  return {
    parts: textParts("done"),
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    toolCalls: [],
    stopReason: "end_turn",
    ...overrides,
  };
}

function envelope(
  overrides: Partial<Omit<TurnConvergencePolicyInput, "policyId" | "configurationHash">> = {},
): RuntimeExecutionEnvelope {
  return {
    convergence: deriveRuntimeConvergencePolicyInput({
      ...RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_INPUT,
      policyId: "test.runtime.turn-convergence",
      ...overrides,
    }),
  };
}

function tool(name: string): ToolDefinition {
  return { name, description: name, inputSchema: {}, tags: new Set() };
}

describe("RuntimeSessionOrchestrator - turn convergence enforcement", () => {
  it("returns a typed session_not_active disposition while a human owns the session", async () => {
    const provider = makeProvider();
    const session = makeSession();
    session.setSessionMode("human_active");
    const orchestrator = new RuntimeSessionOrchestrator({ provider });

    const result = await orchestrator.processMessage(session, textParts("do work"));

    expect(provider.createMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      outcome: "paused",
      dispositionReason: "session_not_active",
      queued: true,
      parts: [],
    });
    expect("convergence" in result).toBe(false);
    expect(session.conversationHistory.at(-1)).toEqual({
      role: "user",
      parts: textParts("do work"),
    });
  });

  it("resolves an absent envelope to a finite policy", async () => {
    const provider = makeProvider();
    const orchestrator = new RuntimeSessionOrchestrator({ provider });

    const result = await orchestrator.processMessage(makeSession(), textParts("hello"));

    expect(provider.createMessage).toHaveBeenCalledTimes(1);
    expect(requireRuntimeConvergence(result).convergence.policy).toMatchObject({
      providerRequests: expect.any(Number),
      toolRounds: expect.any(Number),
      cumulativeInputTokens: expect.any(Number),
      elapsedMs: expect.any(Number),
      activeMs: expect.any(Number),
      recoveryAttempts: expect.any(Number),
    });
    expect(requireRuntimeConvergence(result).convergence.policy.providerRequests).toBeGreaterThan(0);
  });

  it("returns governed_work_incomplete when governed work remains open after provider completion", async () => {
    let round = 0;
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn().mockImplementation(() => {
        round += 1;
        if (round === 1) {
          return response({
            parts: textParts("assessing governed work"),
            toolCalls: [{ id: "assess-1", name: "work_governance.assess", input: {} }],
            stopReason: "tool_use",
          });
        }
        if (round === 2) {
          return response({
            parts: textParts("recording the work item"),
            toolCalls: [{ id: "update-1", name: "work_item.update", input: { id: "work-1" } }],
            stopReason: "tool_use",
          });
        }
        return response({ parts: textParts("The requested work is complete."), toolCalls: [] });
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const assess = vi.fn().mockResolvedValue({
      output: "recommendation: orchestrate",
      isError: false,
      metadata: { kind: "work_governance", recommendation: "orchestrate" },
    });
    const update = vi.fn().mockResolvedValue({
      output: "updated",
      isError: false,
      metadata: {
        kind: "work_item",
        id: "work-1",
        item: {
          id: "work-1",
          status: "in_progress",
          expectedEvidence: [],
          providedEvidence: [],
          pauseRequirements: [],
        },
      },
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [tool("work_governance.assess"), tool("work_item.update")],
      builtinTools: new Map([
        ["work_governance.assess", assess],
        ["work_item.update", update],
      ]),
      executionEnvelope: envelope({ providerRequests: 4, toolRounds: 4 }),
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("finish the governed work"));

    expect(provider.createMessage).toHaveBeenCalledTimes(3);
    expect(assess).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      outcome: "failed",
      dispositionReason: "governed_work_incomplete",
      convergence: {
        policy: expect.objectContaining({ toolRounds: 4 }),
        progressEvidence: expect.arrayContaining([
          expect.objectContaining({ kind: "progress" }),
        ]),
      },
    });
  });

  it("pauses at the provider-request limit without dispatching another request", async () => {
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn().mockResolvedValue(response({
        parts: textParts("using tool"),
        toolCalls: [{ id: "tc-1", name: "get_data", input: {} }],
        stopReason: "tool_use",
      })),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const getData = vi.fn().mockResolvedValue("result");
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [tool("get_data")],
      builtinTools: new Map([["get_data", getData]]),
      executionEnvelope: envelope({ providerRequests: 1, toolRounds: 4 }),
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("fetch data"));

    expect(provider.createMessage).toHaveBeenCalledTimes(1);
    expect(getData).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      outcome: "paused",
      dispositionReason: "provider_request_limit",
      convergence: {
        pause: {
          status: "pause",
          reason: "provider_request_limit",
          metric: "providerRequests",
          observed: 1,
          limit: 1,
        },
      },
    });
    expect(result.parts).toEqual(textParts("Turn paused: providerRequests limit reached (1/1)."));
  });

  it("denies projected cumulative input before the first provider dispatch", async () => {
    const provider = makeProvider();
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      executionEnvelope: envelope({ cumulativeInputTokens: 1 }),
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("a request larger than one token"));

    expect(provider.createMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      outcome: "paused",
      dispositionReason: "cumulative_input_limit",
      convergence: {
        pause: {
          status: "pause",
          reason: "cumulative_input_limit",
          metric: "cumulativeInputTokens",
          limit: 1,
        },
      },
    });
    expect(requireRuntimeConvergencePause(result).convergence.pause).toMatchObject({ observed: expect.any(Number) });
    expect(result.parts[0]).toEqual(expect.objectContaining({
      type: "text",
      text: expect.stringMatching(/^Turn paused: cumulativeInputTokens limit reached \(\d+\/1\)\.$/u),
    }));
  });

  it("denies an over-limit model tool batch atomically without execution or dangling history", async () => {
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn().mockResolvedValue(response({
        parts: textParts("using two tools"),
        toolCalls: [
          { id: "tc-1", name: "get_data", input: {} },
          { id: "tc-2", name: "get_data", input: {} },
        ],
        stopReason: "tool_use",
      })),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const getData = vi.fn().mockResolvedValue("result");
    const session = makeSession();
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [tool("get_data")],
      builtinTools: new Map([["get_data", getData]]),
      executionEnvelope: envelope({ toolRounds: 4, toolCalls: 1 }),
    });

    const result = await orchestrator.processMessage(session, textParts("fetch data"));

    expect(provider.createMessage).toHaveBeenCalledTimes(1);
    expect(getData).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      outcome: "paused",
      dispositionReason: "tool_call_limit",
      convergence: {
        pause: {
          status: "pause",
          reason: "tool_call_limit",
          metric: "toolCalls",
          observed: 2,
          limit: 1,
        },
      },
    });
    expect(result.parts).toEqual(textParts("Turn paused: toolCalls limit reached (2/1)."));
    expect(session.conversationHistory.flatMap((message) => message.parts)
      .some((part) => part.type === "tool_use" || part.type === "tool_result")).toBe(false);
  });

  it("pauses before dispatch when elapsed time reaches its limit", async () => {
    let reads = 0;
    const provider = makeProvider();
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      monotonicNow: () => (reads++ === 0 ? 0 : 5),
      executionEnvelope: envelope({ elapsedMs: 5 }),
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("hello"));

    expect(provider.createMessage).not.toHaveBeenCalled();
    expect(requireRuntimeConvergencePause(result).convergence.pause).toEqual({
      status: "pause",
      reason: "elapsed_time_limit",
      metric: "elapsedMs",
      observed: 5,
      limit: 5,
    });
  });

  it("records provider duration and enforces active time before the next dispatch", async () => {
    let now = 0;
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn().mockImplementation(() => {
        now = 10;
        return response({
          parts: textParts("using tool"),
          toolCalls: [{ id: "tc-1", name: "get_data", input: {} }],
          stopReason: "tool_use",
        });
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const getData = vi.fn().mockResolvedValue("result");
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      monotonicNow: () => now,
      tools: [tool("get_data")],
      builtinTools: new Map([["get_data", getData]]),
      executionEnvelope: envelope({ elapsedMs: 100, activeMs: 10, toolRounds: 4 }),
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("fetch data"));

    expect(provider.createMessage).toHaveBeenCalledTimes(1);
    expect(getData).not.toHaveBeenCalled();
    expect(requireRuntimeConvergencePause(result).convergence.pause).toMatchObject({
      status: "pause",
      reason: "active_time_limit",
      metric: "activeMs",
      limit: 10,
    });
    expect(result.providerRequests?.[0]?.durationMs).toBe(10);
  });

  it("bounds Runtime recovery continuations before another provider request", async () => {
    const provider = makeProvider();
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [tool("work_item.update")],
      executionEnvelope: envelope({ recoveryAttempts: 1, toolRounds: 4 }),
    });

    const result = await orchestrator.processMessage(
      makeSession(),
      textParts("create the governed work item first"),
      undefined,
      undefined,
      { governedWorkRequirement: { kind: "goal_materialization", requiredWorkItemCount: 1 } },
    );

    expect(provider.createMessage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      outcome: "paused",
      dispositionReason: "recovery_limit",
      convergence: {
        pause: {
          status: "pause",
          reason: "recovery_limit",
          metric: "recoveryAttempts",
          observed: 1,
          limit: 1,
        },
      },
    });
    expect(result.parts).toEqual(textParts("Turn paused: recoveryAttempts limit reached (1/1)."));
  });

  it("uses one managed transition reserve only for the tool-round limit", async () => {
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn()
        .mockResolvedValueOnce(response({
          parts: textParts("starting managed phase"),
          toolCalls: [{ id: "tc-managed", name: "managed_agent.invoke", input: { workItemId: "work-1" } }],
          stopReason: "tool_use",
        }))
        .mockResolvedValueOnce(response({
          parts: textParts("recording transition"),
          toolCalls: [{
            id: "tc-update",
            name: "work_item.update",
            input: { id: "work-1", providedEvidence: ["visual-reference-research"] },
          }],
          stopReason: "tool_use",
        }))
        .mockResolvedValue(response({ parts: textParts("must not narrate after reserve") })),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const managedInvoke = vi.fn().mockResolvedValue({
      output: JSON.stringify({ status: "handoff_not_substantive" }),
      isError: true,
      metadata: {
        toolName: "managed_agent.invoke",
        kind: "managed-invocation",
        status: "handoff_not_substantive",
        managedInvocationRecovery: {
          status: "phase_evidence_required",
          nextTool: "work_item.update",
          workItemId: "work-1",
          evidenceToRecord: ["visual-reference-research"],
          workItemUpdateInputTemplate: {
            id: "work-1",
            providedEvidence: ["visual-reference-research"],
          },
        },
      },
    });
    const workItemUpdate = vi.fn().mockResolvedValue({
      output: JSON.stringify({ item: { id: "work-1", providedEvidence: ["visual-reference-research"] } }),
      isError: false,
      metadata: {
        toolName: "work_item.update",
        kind: "work_item",
        operation: "update",
        id: "work-1",
        item: { id: "work-1", providedEvidence: ["visual-reference-research"] },
      },
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [tool("managed_agent.invoke"), tool("work_item.update")],
      builtinTools: new Map([
        ["managed_agent.invoke", managedInvoke],
        ["work_item.update", workItemUpdate],
      ]),
      eventBus: new EventBus(100),
      executionEnvelope: envelope({
        providerRequests: 4,
        toolRounds: 1,
        toolCalls: 4,
        cumulativeInputTokens: 100_000,
        elapsedMs: 100_000,
        activeMs: 100_000,
        recoveryAttempts: 2,
      }),
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("improve the GUI"));

    expect(provider.createMessage).toHaveBeenCalledTimes(2);
    expect(workItemUpdate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      outcome: "paused",
      dispositionReason: "tool_round_limit",
      convergence: {
        pause: {
          status: "pause",
          reason: "tool_round_limit",
          metric: "toolRounds",
          limit: 1,
        },
      },
    });
    expect(requireRuntimeConvergencePause(result).convergence.pause).toMatchObject({ observed: expect.any(Number) });
  });

  it("does not let the managed reserve bypass the provider-request limit", async () => {
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn().mockResolvedValue(response({
        parts: textParts("starting managed phase"),
        toolCalls: [{ id: "tc-managed", name: "managed_agent.invoke", input: { workItemId: "work-1" } }],
        stopReason: "tool_use",
      })),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const managedInvoke = vi.fn().mockResolvedValue({
      output: JSON.stringify({ status: "handoff_not_substantive" }),
      isError: true,
      metadata: {
        toolName: "managed_agent.invoke",
        kind: "managed-invocation",
        status: "handoff_not_substantive",
        managedInvocationRecovery: {
          status: "phase_evidence_required",
          nextTool: "work_item.update",
          workItemId: "work-1",
          evidenceToRecord: ["visual-reference-research"],
        },
      },
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [tool("managed_agent.invoke"), tool("work_item.update")],
      builtinTools: new Map([["managed_agent.invoke", managedInvoke]]),
      executionEnvelope: envelope({ providerRequests: 1, toolRounds: 1, recoveryAttempts: 2 }),
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("improve the GUI"));

    expect(provider.createMessage).toHaveBeenCalledTimes(1);
    expect(requireRuntimeConvergencePause(result).convergence.pause).toMatchObject({
      reason: "provider_request_limit",
      metric: "providerRequests",
      observed: 1,
      limit: 1,
    });
  });

  it("blocks before the first provider round when session budget is exhausted", async () => {
    const provider = makeProvider();
    const sessionTurnBudget = {
      admit: vi.fn().mockResolvedValue({
        status: "denied",
        reason: "observed-at-or-above-limit",
        action: "stop",
        message: "Observed session tokens reached the limit.",
      }),
    };

    const orchestrator = new RuntimeSessionOrchestrator({ provider, sessionTurnBudget });
    const result = await orchestrator.processMessage(makeSession(), textParts("do work"));

    expect(sessionTurnBudget.admit).toHaveBeenCalledWith(expect.any(String));
    expect(provider.createMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      outcome: "failed",
      dispositionReason: "outer_authority_denied",
      parts: textParts("Observed session tokens reached the limit."),
      convergence: {
        policy: expect.objectContaining({ toolRounds: expect.any(Number) }),
        progressEvidence: [],
      },
    });
  });

  it("stops before the next provider round when session budget is exhausted", async () => {
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn().mockResolvedValue(response({
        parts: textParts("using tool"),
        toolCalls: [{ id: "tc-1", name: "get_data", input: {} }],
        stopReason: "tool_use",
      })),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const sessionTurnBudget = {
      admit: vi.fn()
        .mockResolvedValueOnce({
          status: "admitted",
          reason: "observed-below-limit",
          observation: { observedTokens: 1, source: "test" },
        })
        .mockResolvedValueOnce({
          status: "denied",
          reason: "observed-at-or-above-limit",
          action: "stop",
          message: "Session limit reached.",
        }),
    };
    const getData = vi.fn().mockResolvedValue("result");
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [tool("get_data")],
      builtinTools: new Map([["get_data", getData]]),
      sessionTurnBudget,
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("do work"));

    expect(sessionTurnBudget.admit).toHaveBeenCalledTimes(2);
    expect(provider.createMessage).toHaveBeenCalledTimes(1);
    expect(getData).toHaveBeenCalledTimes(1);
    expect(result.parts).toEqual(textParts("Session limit reached."));
  });

  it("honors session turn admission without issuing a provider request", async () => {
    const provider = makeProvider();
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      sessionTurnBudget: {
        admit: vi.fn().mockResolvedValue({
          status: "denied",
          reason: "observed-at-or-above-limit",
          action: "stop",
          message: "Observed session tokens reached the limit.",
        }),
      },
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("do work"));

    expect(provider.createMessage).not.toHaveBeenCalled();
    expect(result.parts).toEqual(textParts("Observed session tokens reached the limit."));
  });
});
