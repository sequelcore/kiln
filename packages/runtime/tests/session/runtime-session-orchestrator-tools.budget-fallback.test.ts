import { describe, expect, it, vi } from "vitest";
import { normalizeToolInput, resolveCommunicationIntent, type ProviderAdapter, type ToolDefinition } from "@kilnai/core/agents";
import { textParts } from "@kilnai/core/engine";
import { EventBus, type ErrorEvent } from "@kilnai/core/events";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import { makeProvider, makeSession, getReinjectedToolResultFromSecondCall, getReinjectedToolResultFromCall, getLastToolResultPartsFromCall } from "./runtime-session-orchestrator-tools-test-fixture.js";

describe("RuntimeSessionOrchestrator - budget and fallback", () => {
  it("preserves stop reason from fallback responses after max tool rounds", async () => {
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn()
        .mockResolvedValueOnce({
          parts: textParts("using tool"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-1", name: "get_data", input: { query: "test" } }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("fallback after tool budget"),
          inputTokens: 25,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "length",
        }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [{ name: "get_data", description: "Gets data", inputSchema: {}, tags: new Set() }],
      builtinTools: new Map([["get_data", vi.fn().mockResolvedValue("result")]]),
      eventBus: new EventBus(100),
      executionEnvelope: { toolRounds: { max: 1 } },
    });

    const result = await orchestrator.processMessage(
      makeSession(),
      textParts("fetch data"),
      undefined,
      undefined,
      {
        communicationIntent: resolveCommunicationIntent([{
          source: "invocation",
          intent: { locale: "en-GB", requiredContent: ["failure"], onUnsupported: "omit" },
        }]),
      },
    );

    expect(result.stopReason).toBe("length");
    expect(result.parts).toEqual(textParts("fallback after tool budget"));
    expect(result.providerRequests?.map((request) => request.communicationResolution?.identity)).toEqual([
      result.communicationResolution?.identity,
      result.communicationResolution?.identity,
    ]);
    const fallbackCall = (provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as {
      readonly messages?: readonly { readonly parts?: readonly { readonly type: string; readonly content?: string }[] }[];
      readonly tools?: readonly ToolDefinition[];
    };
    expect(fallbackCall.tools).toBeUndefined();
    expect(JSON.stringify(fallbackCall.messages?.at(-1))).toContain("Tool round budget exhausted");
  });

  it("returns explicit tool budget exhaustion when the fallback response still asks for tools", async () => {
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn()
        .mockResolvedValueOnce({
          parts: textParts("using tool"),
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-1", name: "get_data", input: { query: "test" } }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: [],
          inputTokens: 25,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-2", name: "get_data", input: { query: "again" } }],
          stopReason: "tool_calls",
        }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const readTool = vi.fn().mockResolvedValue("result");
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [{ name: "get_data", description: "Gets data", inputSchema: {}, tags: new Set() }],
      builtinTools: new Map([["get_data", readTool]]),
      eventBus: new EventBus(100),
      executionEnvelope: { toolRounds: { max: 1 } },
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("fetch data"));

    expect(provider.createMessage).toHaveBeenCalledTimes(2);
    expect(readTool).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe("tool_round_budget_exhausted");
    expect(result.parts).toEqual(textParts(
      "Tool round budget exhausted after 1 tool round. The bounded finalization pass did not produce a final answer without tools. Inspect the transcript and child execution evidence before recording governed evidence.",
    ));
  });

  it("does not impose a default low tool-round budget on interactive sessions", async () => {
    const productiveToolRounds = 35;
    let providerCallCount = 0;
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn().mockImplementation(() => {
        providerCallCount += 1;
        if (providerCallCount <= productiveToolRounds) {
          return {
            parts: textParts(`round ${providerCallCount}`),
            inputTokens: 10,
            outputTokens: 5,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            toolCalls: [{ id: `tc-${providerCallCount}`, name: "get_data", input: { round: providerCallCount } }],
            stopReason: "tool_use",
          };
        }
        return {
          parts: textParts("completed after many productive tool rounds"),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "end_turn",
        };
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const getData = vi.fn().mockResolvedValue("round result");
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [{ name: "get_data", description: "Gets data", inputSchema: {}, tags: new Set() }],
      builtinTools: new Map([["get_data", getData]]),
      eventBus: new EventBus(100),
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("keep working"));

    expect(result.stopReason).toBe("end_turn");
    expect(result.parts).toEqual(textParts("completed after many productive tool rounds"));
    expect(provider.createMessage).toHaveBeenCalledTimes(productiveToolRounds + 1);
    expect(getData).toHaveBeenCalledTimes(productiveToolRounds);
  });

    it("blocks before the first provider round when budget is exhausted", async () => {
      const provider = makeProvider();
      const sessionTurnBudget = {
        admit: vi.fn().mockResolvedValue({
          status: "denied",
          reason: "observed-at-or-above-limit",
          action: "stop",
          message: "Observed session tokens reached the limit.",
        }),
      };

      const orchestrator = new RuntimeSessionOrchestrator({
        provider,
        sessionTurnBudget,
      });

      const result = await orchestrator.processMessage(makeSession(), textParts("do work"));

      expect(sessionTurnBudget.admit).toHaveBeenCalledWith(expect.any(String));
      expect(provider.createMessage).not.toHaveBeenCalled();
      expect(result.parts.map((part) => "text" in part ? part.text : "").join(""))
        .toContain("Observed session tokens reached the limit.");
    });

    it("breaks the tool loop when budget is exhausted after an admitted first round", async () => {
      // Provider returns tool calls on every round
      let callCount = 0;
      const provider: ProviderAdapter = {
        name: "mock",
        createMessage: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount <= 3) {
            return {
              parts: textParts("thinking"),
              inputTokens: 100,
              outputTokens: 50,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              toolCalls: [{ id: `tc-${callCount}`, name: "get_data", input: {} }],
              stopReason: "tool_use",
            };
          }
          return {
            parts: textParts("final"),
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            toolCalls: [],
            stopReason: "end_turn",
          };
        }),
        streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
      };

      let budgetCheckCount = 0;
      const sessionTurnBudget = {
        admit: vi.fn().mockImplementation(() => {
          budgetCheckCount++;
          return {
            status: budgetCheckCount < 2 ? "admitted" : "denied",
            reason: budgetCheckCount < 2 ? "observed-below-limit" : "observed-at-or-above-limit",
            ...(budgetCheckCount < 2
              ? { observation: { observedTokens: 1, source: "test" } }
              : { action: "stop", message: "session limit reached" }),
          };
        }),
      };

      const eventBus = new EventBus(100);
      const emitSpy = vi.spyOn(eventBus, "emit");

      const orchestrator = new RuntimeSessionOrchestrator({
        provider,
        tools: [{ name: "get_data", description: "Gets data", inputSchema: {}, tags: new Set() }],
        builtinTools: new Map([["get_data", vi.fn().mockResolvedValue("ok")]]),
        sessionTurnBudget,
        eventBus,
      });

      const result = await orchestrator.processMessage(makeSession(), textParts("do work"));

      expect(sessionTurnBudget.admit).toHaveBeenCalledTimes(2);
      expect(result.parts.map((part) => "text" in part ? part.text : "").join("")).toContain("session limit reached");
      expect(emitSpy.mock.calls.some((call) =>
        call[0].type === "error" && JSON.stringify(call[0]).includes("session limit reached")
      )).toBe(true);
    });

    it("denies tool-budget finalization without losing prior effect evidence", async () => {
      const provider = makeProvider(1);
      const sessionTurnBudget = {
        admit: vi.fn()
          .mockResolvedValueOnce({ status: "admitted", reason: "observed-below-limit", observation: { observedTokens: 1, source: "test" } })
          .mockResolvedValueOnce({ status: "denied", reason: "observed-at-or-above-limit", action: "stop", message: "Finalization denied." }),
      };
      const eventBus = new EventBus(100);
      const emitSpy = vi.spyOn(eventBus, "emit");
      const orchestrator = new RuntimeSessionOrchestrator({
        provider,
        tools: [{ name: "get_data", description: "Gets data", inputSchema: {}, tags: new Set() }],
        builtinTools: new Map([["get_data", vi.fn().mockResolvedValue("result")]]),
        executionEnvelope: { toolRounds: { max: 1 } },
        sessionTurnBudget,
        eventBus,
      });

      const result = await orchestrator.processMessage(makeSession(), textParts("fetch data"));

      expect(result).toMatchObject({ outcome: "failed", inputTokens: 100, outputTokens: 50 });
      expect(result.parts).toEqual(textParts("Finalization denied."));
      expect(result.providerRequests).toHaveLength(1);
      expect(result.toolExecutions).toHaveLength(1);
      expect(provider.createMessage).toHaveBeenCalledTimes(1);
      expect(sessionTurnBudget.admit).toHaveBeenCalledTimes(2);
      const errorEvents = emitSpy.mock.calls
        .map(([event]) => event)
        .filter((event): event is ErrorEvent => event.type === "error");
      expect(errorEvents.filter((event) => event.message === "Finalization denied.")).toHaveLength(1);
    });

    it("denies repeated-tool-failure finalization without invoking its fallback", async () => {
      let providerCallCount = 0;
      const provider: ProviderAdapter = {
        name: "mock",
        createMessage: vi.fn().mockImplementation(() => {
          providerCallCount += 1;
          return {
            parts: textParts("retrying"),
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            toolCalls: [{ id: `tc-${providerCallCount}`, name: "get_data", input: {} }],
            stopReason: "tool_use",
          };
        }),
        streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
      };
      const sessionTurnBudget = {
        admit: vi.fn()
          .mockResolvedValueOnce({ status: "admitted", reason: "observed-below-limit", observation: { observedTokens: 1, source: "test" } })
          .mockResolvedValueOnce({ status: "admitted", reason: "observed-below-limit", observation: { observedTokens: 2, source: "test" } })
          .mockResolvedValueOnce({ status: "denied", reason: "observed-at-or-above-limit", action: "stop", message: "Failure finalization denied." }),
      };
      const eventBus = new EventBus(100);
      const emitSpy = vi.spyOn(eventBus, "emit");
      const orchestrator = new RuntimeSessionOrchestrator({
        provider,
        tools: [{ name: "get_data", description: "Gets data", inputSchema: {}, tags: new Set() }],
        builtinTools: new Map([["get_data", vi.fn().mockResolvedValue({ output: "deterministic failure", isError: true })]]),
        sessionTurnBudget,
        eventBus,
      });

      const result = await orchestrator.processMessage(makeSession(), textParts("fetch data"));

      expect(result).toMatchObject({ outcome: "failed", inputTokens: 200, outputTokens: 100 });
      expect(result.parts).toEqual(textParts("Failure finalization denied."));
      expect(result.providerRequests).toHaveLength(2);
      expect(result.toolExecutions).toHaveLength(2);
      expect(provider.createMessage).toHaveBeenCalledTimes(2);
      expect(sessionTurnBudget.admit).toHaveBeenCalledTimes(3);
      const errorEvents = emitSpy.mock.calls
        .map(([event]) => event)
        .filter((event): event is ErrorEvent => event.type === "error");
      expect(errorEvents.filter((event) => event.message === "Failure finalization denied.")).toHaveLength(1);
    });

    it("admits exactly once immediately before every provider effect in a finalized multi-round turn", async () => {
      let providerCallCount = 0;
      const provider: ProviderAdapter = {
        name: "mock",
        createMessage: vi.fn().mockImplementation(({ tools }: { tools?: readonly ToolDefinition[] }) => {
          providerCallCount += 1;
          return tools
            ? {
                parts: textParts("using tool"), inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0,
                toolCalls: [{ id: `tc-${providerCallCount}`, name: "get_data", input: {} }], stopReason: "tool_use",
              }
            : {
                parts: textParts("bounded final"), inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0,
                toolCalls: [], stopReason: "end_turn",
              };
        }),
        streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
      };
      const sessionTurnBudget = {
        admit: vi.fn().mockResolvedValue({
          status: "admitted", reason: "observed-below-limit", observation: { observedTokens: 1, source: "test" },
        }),
      };
      const orchestrator = new RuntimeSessionOrchestrator({
        provider,
        tools: [{ name: "get_data", description: "Gets data", inputSchema: {}, tags: new Set() }],
        builtinTools: new Map([["get_data", vi.fn().mockResolvedValue("result")]]),
        executionEnvelope: { toolRounds: { max: 2 } },
        sessionTurnBudget,
      });

      const result = await orchestrator.processMessage(makeSession(), textParts("fetch data"));

      expect(result.parts).toEqual(textParts("bounded final"));
      expect(provider.createMessage).toHaveBeenCalledTimes(3);
      expect(sessionTurnBudget.admit).toHaveBeenCalledTimes(3);
      const admissionOrder = sessionTurnBudget.admit.mock.invocationCallOrder;
      const providerOrder = (provider.createMessage as ReturnType<typeof vi.fn>).mock.invocationCallOrder;
      for (let index = 0; index < providerOrder.length; index += 1) {
        expect(admissionOrder[index]).toBeLessThan(providerOrder[index]!);
        if (index > 0) expect(admissionOrder[index]).toBeGreaterThan(providerOrder[index - 1]!);
      }
    });

    it("turns malformed tool arguments into a tool error instead of crashing execution", async () => {
      let callCount = 0;
      const eventBus = new EventBus(100);
      const toolFn = vi.fn().mockResolvedValue("should not run");
      const provider: ProviderAdapter = {
        name: "mock",
        createMessage: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return {
              parts: textParts("writing file..."),
              inputTokens: 100,
              outputTokens: 50,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              toolCalls: [{
                id: "tc-write-invalid-1",
                name: "write",
                input: normalizeToolInput("write", "{bad-json}"),
              }],
              stopReason: "tool_use",
            };
          }
          return {
            parts: textParts("done"),
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            toolCalls: [],
            stopReason: "end_turn",
          };
        }),
        streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
      };

      const orchestrator = new RuntimeSessionOrchestrator({
        provider,
        tools: [{ name: "write", description: "Writes files", inputSchema: {}, tags: new Set() }],
        builtinTools: new Map([["write", toolFn]]),
        eventBus,
      });

      const result = await orchestrator.processMessage(makeSession(), textParts("write file"));

      expect(toolFn).not.toHaveBeenCalled();
      expect(result.toolExecutions?.[0]).toMatchObject({
        toolCallId: "tc-write-invalid-1",
        toolName: "write",
        success: false,
      });
      expect(getReinjectedToolResultFromSecondCall(provider)).toContain("Invalid input for tool \"write\"");
      expect(eventBus.history().filter((event) => event.type === "tool_called" || event.type === "tool_result"))
        .toEqual([
          expect.objectContaining({
            type: "tool_called",
            toolCallId: "tc-write-invalid-1",
            toolName: "write",
          }),
          expect.objectContaining({
            type: "tool_result",
            toolCallId: "tc-write-invalid-1",
            toolName: "write",
            success: false,
            isError: true,
          }),
        ]);
    });

    it("stops retrying the same malformed tool call and falls back to a final text response", async () => {
      let callCount = 0;
      const toolFn = vi.fn().mockResolvedValue("should not run");
      const provider: ProviderAdapter = {
        name: "mock",
         createMessage: vi.fn().mockImplementation(({ tools }: { tools?: readonly ToolDefinition[] }) => {
          callCount++;
          if (tools && callCount <= 2) {
            return {
              parts: textParts("trying write again..."),
              inputTokens: 100,
              outputTokens: 50,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              toolCalls: [{
                id: `tc-write-invalid-${callCount}`,
                name: "write",
                input: normalizeToolInput("write", "{bad-json}"),
              }],
              stopReason: "tool_use",
            };
          }
          return {
            parts: textParts("I could not complete the write because the tool arguments were invalid."),
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            toolCalls: [],
            stopReason: "end_turn",
          };
        }),
        streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
      };

      const orchestrator = new RuntimeSessionOrchestrator({
        provider,
        tools: [{ name: "write", description: "Writes files", inputSchema: {}, tags: new Set() }],
        builtinTools: new Map([["write", toolFn]]),
      });

      const result = await orchestrator.processMessage(makeSession(), textParts("write file"));

      expect(toolFn).not.toHaveBeenCalled();
      expect((provider.createMessage as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
      expect(result.parts).toEqual(textParts("I could not complete the write because the tool arguments were invalid."));
      expect(result.toolExecutions?.[0]).toMatchObject({
        toolName: "write",
        success: false,
      });
      expect(result.toolExecutions?.[1]).toMatchObject({
        toolName: "write",
        success: false,
        resultSummary: expect.stringContaining("Repeated invalid input for tool \"write\""),
      });
      expect(getReinjectedToolResultFromCall(provider, 2)).toContain("Repeated invalid input for tool \"write\"");
    });

    it("stops retrying the same deterministic tool execution failure", async () => {
      let callCount = 0;
      const toolFn = vi.fn().mockResolvedValue({
        output: "Invalid input: structuredResult must be an object.",
        isError: true,
      });
      const provider: ProviderAdapter = {
        name: "mock",
         createMessage: vi.fn().mockImplementation(() => {
          callCount++;
           if (callCount <= 2) {
            return {
              parts: textParts("retrying finish..."),
              inputTokens: 100,
              outputTokens: 50,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              toolCalls: [{
                id: `tc-finish-failed-${callCount}`,
                name: "work_item.execution.finish",
                input: { workItemId: "work-1" },
              }],
              stopReason: "tool_use",
            };
          }
          return {
            parts: textParts("The work item could not be closed because the tool input remained invalid."),
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            toolCalls: [],
            stopReason: "end_turn",
          };
        }),
        streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
      };

      const orchestrator = new RuntimeSessionOrchestrator({
        provider,
        tools: [{
          name: "work_item.execution.finish",
          description: "Finishes governed work",
          inputSchema: {},
          tags: new Set(),
        }],
        builtinTools: new Map([["work_item.execution.finish", toolFn]]),
      });

      const result = await orchestrator.processMessage(makeSession(), textParts("finish work"));

      expect(toolFn).toHaveBeenCalledTimes(2);
      expect(provider.createMessage).toHaveBeenCalledTimes(3);
      expect(result.parts).toEqual(textParts(
        "The work item could not be closed because the tool input remained invalid.",
      ));
      expect(result.toolExecutions).toHaveLength(2);
      expect(getReinjectedToolResultFromCall(provider, 2)).toContain(
        "Repeated deterministic failure for tool \"work_item.execution.finish\"",
      );
    });

    it("stops equivalent failed command retries even when shell-only input changes", async () => {
      let callCount = 0;
      const toolFn = vi.fn().mockImplementation((input: Record<string, unknown>) => Promise.resolve({
        output: "error: Script not found \"check\"",
        isError: true,
        metadata: {
          toolName: "bash",
          kind: "command",
          cwd: "C:\\synthetic\\workspace",
          command: input.command,
          exitCode: 1,
          status: "failed",
        },
      }));
      const provider: ProviderAdapter = {
        name: "mock",
        createMessage: vi.fn().mockImplementation(({ tools }: { readonly tools?: readonly ToolDefinition[] }) => {
          callCount++;
          if (tools && callCount <= 3) {
            return {
              parts: textParts("trying another command shape..."),
              inputTokens: 100,
              outputTokens: 50,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              toolCalls: [{
                id: `tc-bash-failed-${callCount}`,
                name: "bash",
                input: {
                  command: callCount === 1 ? "bun run check" : callCount === 2 ? "bun run check 2>&1" : "bun run ci",
                },
              }],
              stopReason: "tool_use",
            };
          }
          return {
            parts: textParts("The repository does not define that verification script."),
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            toolCalls: [],
            stopReason: "end_turn",
          };
        }),
        streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
      };

      const orchestrator = new RuntimeSessionOrchestrator({
        provider,
        tools: [{ name: "bash", description: "Runs a command", inputSchema: {}, tags: new Set() }],
        builtinTools: new Map([["bash", toolFn]]),
      });

      const result = await orchestrator.processMessage(makeSession(), textParts("run verification"));

      expect(toolFn).toHaveBeenCalledTimes(2);
      expect(provider.createMessage).toHaveBeenCalledTimes(3);
      expect(result.parts).toEqual(textParts("The repository does not define that verification script."));
      expect(getReinjectedToolResultFromCall(provider, 2)).toContain(
        "Repeated deterministic failure for tool \"bash\"",
      );
    });

    it("does not execute tool calls returned by repeated-malformed fallback finalization", async () => {
      let callCount = 0;
      const toolFn = vi.fn().mockResolvedValue("should not run");
      const provider: ProviderAdapter = {
        name: "mock",
        createMessage: vi.fn().mockImplementation(({ tools }: { tools?: readonly ToolDefinition[] }) => {
          callCount++;
          if (tools && callCount <= 2) {
            return {
              parts: textParts("trying write again..."),
              inputTokens: 100,
              outputTokens: 50,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              toolCalls: [{
                id: `tc-write-invalid-${callCount}`,
                name: "write",
                input: normalizeToolInput("write", "{bad-json}"),
              }],
              stopReason: "tool_use",
            };
          }
          return {
            parts: [],
            inputTokens: 100,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            toolCalls: [{
              id: "tc-write-invalid-fallback",
              name: "write",
              input: { filePath: "src/demo.txt", content: "unexpected" },
            }],
            stopReason: "tool_calls",
          };
        }),
        streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
      };

      const orchestrator = new RuntimeSessionOrchestrator({
        provider,
        tools: [{ name: "write", description: "Writes files", inputSchema: {}, tags: new Set() }],
        builtinTools: new Map([["write", toolFn]]),
      });

      const result = await orchestrator.processMessage(makeSession(), textParts("write file"));
      const finalCall = (provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[2]?.[0] as {
        readonly tools?: readonly ToolDefinition[];
        readonly toolChoice?: { readonly type: string };
      };

      expect(provider.createMessage).toHaveBeenCalledTimes(3);
      expect(finalCall.tools).toBeUndefined();
      expect(finalCall.toolChoice).toEqual({ type: "none" });
      expect(toolFn).not.toHaveBeenCalled();
      expect(result.stopReason).toBe("no_tool_finalization_failed");
      expect(result.parts).toEqual(textParts(
        "Tool finalization did not produce a final answer without tools. Inspect the transcript and tool execution evidence before treating this turn as complete.",
      ));
    });

    it("reinjects a tool_result for every tool call before fallbacking after repeated malformed input", async () => {
      let callCount = 0;
      const toolFn = vi.fn().mockResolvedValue("should not run");
      const provider: ProviderAdapter = {
        name: "mock",
        createMessage: vi.fn().mockImplementation(({ tools }: { tools?: readonly ToolDefinition[] }) => {
          callCount++;
          if (tools && callCount === 1) {
            return {
              parts: textParts("first malformed attempt..."),
              inputTokens: 100,
              outputTokens: 50,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              toolCalls: [{
                id: "tc-write-invalid-1",
                name: "write",
                input: normalizeToolInput("write", "{bad-json}"),
              }],
              stopReason: "tool_use",
            };
          }
          if (tools && callCount === 2) {
            return {
              parts: textParts("retrying malformed tools..."),
              inputTokens: 100,
              outputTokens: 50,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              toolCalls: [
                {
                  id: "tc-write-invalid-2",
                  name: "write",
                  input: normalizeToolInput("write", "{bad-json}"),
                },
                {
                  id: "tc-read-invalid-2",
                  name: "read",
                  input: normalizeToolInput("read", "{bad-json}"),
                },
              ],
              stopReason: "tool_use",
            };
          }
          return {
            parts: textParts("I could not continue because the tool arguments were invalid."),
            inputTokens: 100,
            outputTokens: 50,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            toolCalls: [],
            stopReason: "end_turn",
          };
        }),
        streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
      };

      const orchestrator = new RuntimeSessionOrchestrator({
        provider,
        tools: [
          { name: "write", description: "Writes files", inputSchema: {}, tags: new Set() },
          { name: "read", description: "Reads files", inputSchema: {}, tags: new Set() },
        ],
        builtinTools: new Map([
          ["write", toolFn],
          ["read", toolFn],
        ]),
      });

      await orchestrator.processMessage(makeSession(), textParts("search workspace"));

      expect(toolFn).not.toHaveBeenCalled();
      expect((provider.createMessage as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
      const reinjectedToolResults = getLastToolResultPartsFromCall(provider, 2);
      expect(reinjectedToolResults).toHaveLength(2);
      expect(reinjectedToolResults[0]).toMatchObject({
        toolUseId: "tc-write-invalid-2",
      });
      expect(reinjectedToolResults[0]?.content).toContain("Repeated invalid input for tool \"write\"");
      expect(reinjectedToolResults[1]).toMatchObject({
        toolUseId: "tc-read-invalid-2",
      });
      expect(reinjectedToolResults[1]?.content).toContain("was not executed because this tool round was aborted");
    });
});
