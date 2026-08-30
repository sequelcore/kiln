import { describe, expect, it, vi } from "vitest";
import type { ProviderAdapter, ToolCall, ToolDefinition } from "@kilnai/core/agents";
import { extractText, textParts } from "@kilnai/core";
import { EventBus } from "@kilnai/core/events";
import {
  CanonicalTurnLifecycle,
  type CapturedRuntimeLedgerEvent,
} from "../../src/session/runtime-session-event-ledger.js";
import {
  deriveRuntimeConvergencePolicyInput,
  type RuntimeExecutionEnvelope,
} from "../../src/session/runtime-execution-envelope.js";
import {
  RuntimeSessionOrchestrator,
  type OrchestrateResult,
  type RuntimeBuiltinToolExecutor,
} from "../../src/session/runtime-session-orchestrator.js";
import { makeSession } from "./runtime-session-orchestrator-tools-test-fixture.js";
import { projectCanonicalTurnForTest } from "./canonical-turn-fixture.js";
import { requireRuntimeConvergence, requireRuntimeCompletionEvidence } from "./runtime-terminal-fixture.js";

type ProviderResponse = Awaited<ReturnType<ProviderAdapter["createMessage"]>>;

const CUMULATIVE_INPUT_TOKEN_TARGET = 346_355;
const INPUT_TOKENS_PER_REQUEST = 34_635;
const FINAL_INPUT_TOKENS = 34_640;

function response(
  inputTokens: number,
  toolCalls: readonly ToolCall[] = [],
  text = "turn complete",
): ProviderResponse {
  return {
    parts: textParts(text),
    inputTokens,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    toolCalls,
    stopReason: toolCalls.length > 0 ? "tool_use" : "end_turn",
  };
}

function call(
  id: string,
  name: string,
  input: Record<string, unknown> = {},
): ToolCall {
  return { id, name, input };
}

function tool(name: string): ToolDefinition {
  return {
    name,
    description: `Long-turn fixture tool: ${name}`,
    inputSchema: {},
    tags: new Set(),
  };
}

function longTurnBatches(): readonly (readonly ToolCall[])[] {
  return [
    [
      call("read-1", "read", { path: "src/one.ts" }),
      call("bash-1", "bash", { command: "first failed command" }),
      call("catalog-1", "tool_catalog_search", { query: "Dafny" }),
    ],
    [
      call("read-2", "read", { path: "src/two.ts" }),
      call("bash-2", "bash", { command: "second failed command" }),
      call("catalog-2", "tool_catalog_search", { query: "Oxlint" }),
    ],
    [
      call("read-3", "read", { path: "src/three.ts" }),
      call("bash-3", "bash", { command: "third failed command" }),
      call("catalog-3", "tool_catalog_search", { query: "missing producer one" }),
    ],
    [
      call("read-4", "read", { path: "src/four.ts" }),
      call("bash-4", "bash", { command: "fourth failed command" }),
      call("catalog-4", "tool_catalog_search", { query: "missing producer two" }),
    ],
    [
      call("read-5", "read", { path: "src/five.ts" }),
      call("write-5", "write", { path: "src/five.ts" }),
    ],
    [
      call("read-6", "read", { path: "src/six.ts" }),
      call("write-6", "write", { path: "src/six.ts" }),
    ],
    [
      call("read-7", "read", { path: "src/seven.ts" }),
      call("write-7", "write", { path: "src/seven.ts" }),
    ],
    [
      call("read-8", "read", { path: "src/eight.ts" }),
      call("write-8", "write", { path: "src/eight.ts" }),
    ],
    [
      call("read-9", "read", { path: "src/nine.ts" }),
      call("closeout-9", "work_item.complete", { id: "work-long-turn" }),
      call("write-9", "write", { path: "src/nine.ts" }),
    ],
  ];
}

function incompleteCloseoutItem(): Record<string, unknown> {
  return {
    id: "work-long-turn",
    summary: "Long-turn closeout remains blocked until verification evidence exists.",
    status: "in_progress",
    workflowProfile: "verification-heavy",
    triggers: ["verification-heavy"],
    expectedEvidence: ["implementation"],
    providedEvidence: ["implementation"],
    verificationGates: ["Dafny formal verification"],
    dependencies: [],
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    sequence: 1,
  };
}

function buildLongTurnExecutor(): RuntimeBuiltinToolExecutor {
  const closeoutItem = incompleteCloseoutItem();
  return async (_input, context) => {
    const toolName = context?.toolCall.name ?? "unknown";
    const toolCallId = context?.toolCall.id ?? "unknown";

    if (toolName === "bash") {
      return {
        output: `failed execution for ${toolCallId}`,
        isError: true,
        metadata: { kind: "command", status: "failed", exitCode: 1 },
      };
    }

    if (toolName === "tool_catalog_search") {
      return {
        output: JSON.stringify({ results: [] }),
        isError: false,
        metadata: {
          kind: "catalog",
          toolName: "tool_catalog_search",
          operation: "search",
          stale: false,
          materializableToolName: String(_input.query ?? "missing"),
          resultCount: 0,
          totalIndexed: 0,
        },
      };
    }

    if (toolName === "work_item.complete") {
      return {
        output: "Closeout blocked: Dafny formal verification is missing.",
        isError: true,
        metadata: {
          kind: "work_item",
          toolName,
          operation: "complete",
          id: "work-long-turn",
          item: closeoutItem,
          missingVerificationGates: ["Dafny formal verification"],
          failedVerificationGates: [],
          missingResidualRisk: false,
        },
      };
    }

    return {
      output: (`material-${toolCallId}-`).repeat(120),
      isError: false,
      metadata: { kind: "material", toolName, toolCallId },
    };
  };
}

function runtimeDisposition(
  result: OrchestrateResult,
): Extract<OrchestrateResult, {
  readonly outcome: "paused";
  readonly dispositionReason: "required_producer_not_run";
}> {
  if (result.outcome !== "paused" || result.dispositionReason !== "required_producer_not_run") {
    throw new Error(`Expected required producer pause, received ${result.outcome}/${result.dispositionReason}.`);
  }
  return result as Extract<OrchestrateResult, {
    readonly outcome: "paused";
    readonly dispositionReason: "required_producer_not_run";
  }>;
}

function capturedRuntimeEvents(eventBus: EventBus): readonly CapturedRuntimeLedgerEvent[] {
  const runtimeEventTypes = new Set([
    "approval_received",
    "approval_requested",
    "cost_update",
    "error",
    "model_routed",
    "multimodal_routed",
    "tool_called",
    "tool_output",
    "tool_result",
  ]);
  return eventBus.history().filter((event) => runtimeEventTypes.has(event.type)) as CapturedRuntimeLedgerEvent[];
}

describe("RuntimeSessionOrchestrator - deterministic long-turn convergence", () => {
  it("preserves counters, evidence, compaction, and an incomplete verification terminal", async () => {
    const batches = longTurnBatches();
    const providerResponses = [
      ...batches.map((batch, index) => response(INPUT_TOKENS_PER_REQUEST, batch, `round ${index + 1}`)),
      response(FINAL_INPUT_TOKENS, [], "closeout was attempted"),
    ];
    const provider: ProviderAdapter = {
      name: "long-turn-fixture",
      createMessage: vi.fn(async () => {
        const next = providerResponses.shift();
        if (!next) throw new Error("long-turn fixture exhausted its provider trace");
        return next;
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const execute = vi.fn(buildLongTurnExecutor());
    const toolNames = ["bash", "formal_verify", "read", "tool_catalog_search", "work_item.complete", "write"];
    const builtinTools = new Map<string, RuntimeBuiltinToolExecutor>(toolNames.map((name) => [name, execute]));
    const executionEnvelope: RuntimeExecutionEnvelope = {
      convergence: deriveRuntimeConvergencePolicyInput({
        policyId: "test.runtime.long-turn-convergence",
        providerRequests: 10,
        toolRounds: 10,
        toolCalls: 23,
        cumulativeInputTokens: CUMULATIVE_INPUT_TOKEN_TARGET,
        elapsedMs: 1_000_000,
        activeMs: 1_000_000,
        recoveryAttempts: 20,
        consecutiveNoProgressSteps: 20,
      }),
      conversation: {
        toolResults: {
          triggerToolResultTokens: 2_000,
          retainRecentToolResults: 3,
        },
      },
    };
    const eventBus = new EventBus(1_000);
    const session = makeSession();
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: toolNames.map(tool),
      builtinTools,
      eventBus,
      executionEnvelope,
      monotonicNow: () => 0,
    });

    const result = await orchestrator.processMessage(
      session,
      textParts("Use Dafny for formal verification, then attempt the work-item closeout."),
    );

    expect(provider.createMessage).toHaveBeenCalledTimes(10);
    expect(execute).toHaveBeenCalledTimes(23);
    expect(result).toMatchObject({
      outcome: "paused",
      dispositionReason: "required_producer_not_run",
      completion: {
        obligations: [{ canonicalToolId: "formal_verify", sourceAlias: "Dafny" }],
        producerEvidence: [{ canonicalProducerId: "formal_verify", status: "not_run" }],
        eligibility: {
          status: "ineligible",
          unmet: [{ canonicalToolId: "formal_verify", status: "not_run" }],
        },
      },
    });
    expect(result.outcome).not.toBe("completed");
    expect(result.parts).toEqual(textParts("formal_verify: not_run"));

    const convergence = requireRuntimeConvergence(result).convergence;
    const providerRequests = result.providerRequests ?? [];
    expect(providerRequests).toHaveLength(10);
    expect(result.inputTokens).toBe(CUMULATIVE_INPUT_TOKEN_TARGET);
    expect(providerRequests.map((request) => request.cumulativeInputTokens)).toEqual(
      Array.from({ length: 9 }, (_, index) => (index + 1) * INPUT_TOKENS_PER_REQUEST)
        .concat(CUMULATIVE_INPUT_TOKEN_TARGET),
    );
    expect(providerRequests.map((request) => request.cumulativeOutputTokens)).toEqual(
      Array.from({ length: 10 }, (_, index) => (index + 1) * 5),
    );
    for (let index = 1; index < providerRequests.length; index += 1) {
      const previous = providerRequests[index - 1]!;
      const current = providerRequests[index]!;
      expect(current.cumulativeInputTokens).toBeGreaterThanOrEqual(previous.cumulativeInputTokens);
      expect(current.cumulativeOutputTokens).toBeGreaterThanOrEqual(previous.cumulativeOutputTokens);
      expect(current.cumulativeCacheReadTokens).toBeGreaterThanOrEqual(previous.cumulativeCacheReadTokens);
      expect(current.cumulativeCacheWriteTokens).toBeGreaterThanOrEqual(previous.cumulativeCacheWriteTokens);
    }
    expect(convergence.progressEvidence).toHaveLength(23);
    expect(convergence.progressEvidence.filter((evidence) => evidence.reason === "failed_execution")).toHaveLength(5);
    expect(convergence.progressEvidence.filter((evidence) => evidence.reason === "empty_discovery")).toHaveLength(4);
    expect(convergence.progressEvidence.every((evidence) => evidence.kind === "progress"
      ? evidence.evidenceFingerprint.startsWith("sha256:")
      : evidence.strategyFingerprint.startsWith("sha256:"))).toBe(true);

    const finalProjection = providerRequests.at(-1)?.conversationProjection;
    expect(finalProjection).toMatchObject({
      policyId: "tool-result-clearing-v1",
      originalToolResultCount: 23,
      projectedToolResultCount: 23,
      clearedToolResultCount: expect.any(Number),
      overflow: false,
    });
    expect(finalProjection?.clearedToolResultCount).toBeGreaterThan(0);
    expect(finalProjection?.clearedToolUseIds).toContain("read-1");
    const finalProviderMessages = vi.mocked(provider.createMessage).mock.calls.at(-1)?.[0].messages ?? [];
    const finalProviderResults = finalProviderMessages.flatMap((message) => (
      message.parts.filter((part) => part.type === "tool_result")
    ));
    expect(finalProviderResults.some((part) => part.content === "[cleared:read-1]")).toBe(true);
    expect(finalProviderResults.some((part) => part.toolUseId === "closeout-9"
      && part.content === "Closeout blocked: Dafny formal verification is missing.")).toBe(true);

    const canonicalFirstResult = session.conversationHistory
      .flatMap((message) => message.parts)
      .find((part) => part.type === "tool_result" && part.toolUseId === "read-1");
    expect(canonicalFirstResult).toMatchObject({
      toolUseId: "read-1",
      content: ("material-read-1-").repeat(120),
    });
    expect(session.conversationHistory.some((message) => extractText(message.parts).includes("formal_verify: not_run"))).toBe(true);

    const dispositionResult = runtimeDisposition(result);
    const disposition = {
      outcome: "paused" as const,
      dispositionReason: "required_producer_not_run" as const,
      completion: dispositionResult.completion,
      convergence: dispositionResult.convergence,
    };
    const turnId = `${session.id}:turn:1`;
    await projectCanonicalTurnForTest({
      session,
      turnId,
      channel: "gui",
      userMessageContent: "Use Dafny for formal verification, then attempt the work-item closeout.",
      assistantMessageContent: extractText(result.parts),
      disposition,
      queued: false,
      turnStartedAt: new Date("2026-08-30T00:00:00.000Z"),
      turnCompletedAt: new Date("2026-08-30T00:01:00.000Z"),
      continuity: { strategy: "long-turn-fixture" },
      runtimeEvents: capturedRuntimeEvents(eventBus),
      providerRequests,
    });

    const terminals = session.sessionEvents.filter((event) => event.kind === "turn_completed");
    expect(terminals).toHaveLength(1);
    expect(terminals[0]).toMatchObject({
      outcome: "paused",
      dispositionReason: "required_producer_not_run",
      completion: {
        producerEvidence: [{ canonicalProducerId: "formal_verify", status: "not_run" }],
        eligibility: { status: "ineligible" },
      },
    });
    const sequences = session.sessionEvents.map((event) => event.sequence);
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(sequences).toEqual([...sequences].sort((left, right) => left - right));

    const replay = new CanonicalTurnLifecycle({
      session,
      turnId,
      channel: "gui",
      userMessageContent: "Use Dafny for formal verification, then attempt the work-item closeout.",
      turnStartedAt: new Date("2026-08-30T00:00:00.000Z"),
      continuity: { strategy: "long-turn-fixture" },
    });
    expect(replay.state).toBe("settled");
    await replay.settle({
      queued: false,
      disposition,
      turnCompletedAt: new Date("2026-08-30T00:02:00.000Z"),
    });
    expect(session.sessionEvents.filter((event) => event.kind === "turn_completed")).toHaveLength(1);
  });
});
