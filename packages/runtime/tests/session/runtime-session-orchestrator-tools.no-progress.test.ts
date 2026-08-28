import { describe, expect, it, vi } from "vitest";
import type { ProviderAdapter, ToolCall, ToolDefinition } from "@kilnai/core/agents";
import { textParts } from "@kilnai/core/engine";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import type { RuntimeExecutionEnvelope } from "../../src/session/runtime-session-orchestrator.types.js";
import {
  deriveRuntimeConvergencePolicyInput,
  RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_INPUT,
} from "../../src/session/runtime-execution-envelope.js";
import { makeSession } from "./runtime-session-orchestrator-tools-test-fixture.js";
import { requireRuntimeConvergence } from "./runtime-terminal-fixture.js";

type ProviderResponse = Awaited<ReturnType<ProviderAdapter["createMessage"]>>;

function response(toolCall?: ToolCall): ProviderResponse {
  return {
    parts: textParts(toolCall ? "using tool" : "done"),
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    toolCalls: toolCall ? [toolCall] : [],
    stopReason: toolCall ? "tool_use" : "end_turn",
  };
}

function sequenceProvider(toolCalls: readonly ToolCall[]): ProviderAdapter {
  let index = 0;
  return {
    name: "mock",
    createMessage: vi.fn(async () => response(toolCalls[index++])),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

function tool(name: string): ToolDefinition {
  return { name, description: name, inputSchema: {}, tags: new Set() };
}

function envelope(consecutiveNoProgressSteps = 2): RuntimeExecutionEnvelope {
  return {
    convergence: deriveRuntimeConvergencePolicyInput({
      ...RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_INPUT,
      policyId: "test.runtime.no-progress",
      providerRequests: 12,
      toolRounds: 10,
      toolCalls: 12,
      consecutiveNoProgressSteps,
    }),
  };
}

function call(id: string, name: string, input: Record<string, unknown> = {}): ToolCall {
  return { id, name, input };
}

function expectNoProgressPause(
  result: Awaited<ReturnType<RuntimeSessionOrchestrator["processMessage"]>>,
  reasons: readonly string[],
  limit = 2,
): void {
  expect(result).toMatchObject({
    outcome: "paused",
    convergence: {
      pause: {
        status: "pause",
        reason: "no_progress",
        metric: "consecutiveNoProgressSteps",
        observed: limit,
        limit,
      },
    },
  });
  expect(requireRuntimeConvergence(result).convergence.progressEvidence.map((evidence) => evidence.reason)).toEqual(reasons);
}

describe("RuntimeSessionOrchestrator - no-progress convergence", () => {
  it("stops identical failed calls before another provider request", async () => {
    const provider = sequenceProvider([
      call("fail-1", "bash", { command: "exit 1" }),
      call("fail-2", "bash", { command: "exit 1" }),
      call("fail-3", "bash", { command: "must not run" }),
    ]);
    const execute = vi.fn().mockResolvedValue({
      output: "exit code 1",
      isError: true,
      metadata: { kind: "command", status: "failed", exitCode: 1 },
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [tool("bash")],
      builtinTools: new Map([["bash", execute]]),
      executionEnvelope: envelope(),
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("run it"));

    expect(provider.createMessage).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(2);
    expectNoProgressPause(result, ["failed_execution", "failed_execution"]);
  });

  it("groups varied command inputs in the same failed strategy", async () => {
    const provider = sequenceProvider([
      call("varied-1", "bash", { command: "first missing path" }),
      call("varied-2", "bash", { command: "second missing path" }),
      call("varied-3", "bash", { command: "must not run" }),
    ]);
    const execute = vi.fn().mockResolvedValue({
      output: "exit code 1",
      isError: true,
      metadata: { kind: "command", status: "failed", exitCode: 1 },
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [tool("bash")],
      builtinTools: new Map([["bash", execute]]),
      executionEnvelope: envelope(),
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("find it"));

    expect(provider.createMessage).toHaveBeenCalledTimes(2);
    expectNoProgressPause(result, ["failed_execution", "failed_execution"]);
    const failures = requireRuntimeConvergence(result).convergence.progressEvidence
      .filter((evidence) => evidence.kind === "no_progress");
    expect(failures).toHaveLength(2);
    expect(failures[0]?.strategyFingerprint).toBe(failures[1]?.strategyFingerprint);
  });

  it("detects alternating repeated successful results", async () => {
    const provider = sequenceProvider([
      call("a-1", "read", { key: "A" }),
      call("b-1", "read", { key: "B" }),
      call("a-2", "read", { key: "A" }),
      call("b-2", "read", { key: "B" }),
      call("a-3", "read", { key: "must not run" }),
    ]);
    const execute = vi.fn(async (input: Record<string, unknown>) => String(input.key));
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [tool("read")],
      builtinTools: new Map([["read", execute]]),
      executionEnvelope: envelope(),
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("inspect"));

    expect(provider.createMessage).toHaveBeenCalledTimes(4);
    expect(execute).toHaveBeenCalledTimes(4);
    expectNoProgressPause(result, [
      "new_material_result",
      "new_material_result",
      "repeated_result",
      "repeated_result",
    ]);
  });

  it("treats repeated typed empty catalog searches as no progress", async () => {
    const provider = sequenceProvider([
      call("catalog-1", "tool_catalog_search", { query: "Dafny" }),
      call("catalog-2", "tool_catalog_search", { query: "Oxlint" }),
      call("catalog-3", "tool_catalog_search", { query: "must not run" }),
    ]);
    const search = vi.fn(async (input: Record<string, unknown>) => ({
      output: JSON.stringify({ results: [] }),
      isError: false,
      metadata: {
        kind: "catalog",
        toolName: "tool_catalog_search",
        operation: "search",
        stale: false,
        materializableToolName: String(input.query),
        resultCount: 0,
      },
    }));
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [tool("tool_catalog_search")],
      builtinTools: new Map([["tool_catalog_search", search]]),
      executionEnvelope: envelope(),
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("discover producers"));

    expect(provider.createMessage).toHaveBeenCalledTimes(2);
    expectNoProgressPause(result, ["empty_discovery", "empty_discovery"]);
  });

  it("records blocked-only batches and keeps tool-use/result transcript pairs", async () => {
    const provider = sequenceProvider([
      call("blocked-1", "not_projected"),
      call("blocked-2", "not_projected"),
      call("blocked-3", "not_projected"),
    ]);
    const session = makeSession();
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [tool("allowed")],
      builtinTools: new Map([["allowed", vi.fn().mockResolvedValue("unused")]]),
      executionEnvelope: envelope(1),
    });

    const result = await orchestrator.processMessage(session, textParts("use blocked tool"));

    expect(provider.createMessage).toHaveBeenCalledTimes(1);
    expectNoProgressPause(result, ["blocked_batch"], 1);
    const parts = session.conversationHistory.flatMap((message) => message.parts);
    expect(parts.filter((part) => part.type === "tool_use").map((part) => part.id)).toEqual(["blocked-1"]);
    expect(parts.filter((part) => part.type === "tool_result").map((part) => part.toolUseId)).toEqual(["blocked-1"]);
  });

  it("continues while successful batches produce distinct material", async () => {
    const provider = sequenceProvider([
      call("new-1", "read", { key: "A" }),
      call("new-2", "read", { key: "B" }),
      call("new-3", "read", { key: "C" }),
    ]);
    const execute = vi.fn(async (input: Record<string, unknown>) => String(input.key));
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [tool("read")],
      builtinTools: new Map([["read", execute]]),
      executionEnvelope: envelope(),
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("read all"));

    expect(provider.createMessage).toHaveBeenCalledTimes(4);
    expect(result.outcome).toBe("completed");
    const convergence = requireRuntimeConvergence(result).convergence;
    expect("pause" in convergence).toBe(false);
    expect(convergence.progressEvidence.map((evidence) => evidence.reason)).toEqual([
      "new_material_result",
      "new_material_result",
      "new_material_result",
    ]);
  });
});
