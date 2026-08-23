import { describe, expect, it, vi } from "vitest";
import { type ProviderAdapter } from "@kilnai/core/agents";
import { textParts } from "@kilnai/core/engine";
import { EventBus } from "@kilnai/core/events";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import { makeSession } from "./runtime-session-orchestrator-tools-test-fixture.js";

describe("RuntimeSessionOrchestrator - tool boundary", () => {
  it("fails closed on blank/duplicate tool call ids from a custom adapter before persisting or executing them", async () => {
    // ProviderAdapter is an open boundary -- any implementation, not just the built-in ones,
    // must have its tool call identity validated before results enter the runtime.
    const getData = vi.fn().mockResolvedValue("should never run");
    const provider: ProviderAdapter = {
      name: "custom-adapter",
      createMessage: vi.fn().mockResolvedValue({
        parts: textParts("using tool"),
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [
          { id: "", name: "get_data", input: { query: "a" } },
          { id: "", name: "get_data", input: { query: "b" } },
        ],
        stopReason: "tool_use",
      }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [{ name: "get_data", description: "Gets data", inputSchema: {}, tags: new Set() }],
      builtinTools: new Map([["get_data", getData]]),
    });
    const session = makeSession();

    await expect(orchestrator.processMessage(session, textParts("go"))).rejects.toMatchObject({
      code: "TOOL_CALL_IDENTITY_INVALID",
    });

    expect(getData).not.toHaveBeenCalled();
    expect(
      session.conversationHistory.some((message) => message.parts.some((part) => part.type === "tool_use")),
    ).toBe(false);
  });

  it("forces one bounded recovery round before allowing an exact-date answer", async () => {
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn()
        .mockResolvedValueOnce({
          parts: textParts("searching"),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-search-1", name: "web_search", input: { query: "narrow" } }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("I cannot verify it."),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "end_turn",
        })
        .mockResolvedValueOnce({
          parts: textParts("broadening"),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [{ id: "tc-search-2", name: "web_search", input: { query: "broad" } }],
          stopReason: "tool_use",
        })
        .mockResolvedValueOnce({
          parts: textParts("Verified analysis."),
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "end_turn",
        }),
      streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
    };
    const requirement = {
      exactLocalDate: "2026-07-18",
      requiredIdentityTerms: ["chivas", "toluca"],
      eventStatus: "completed",
      minimumIndependentSources: 2,
    } as const;
    const search = vi.fn()
      .mockResolvedValueOnce({
        output: "Insufficient evidence",
        isError: true,
        metadata: {
          toolName: "web_search",
          kind: "web",
          operation: "search",
          errorCode: "temporal_evidence_rejected",
          temporalRequirement: requirement,
          temporalEvidence: {
            accepted: false,
            reason: "independent_source_consensus_missing",
            acceptedSourceIds: [],
            rejectedSourceIds: ["https://index.example/results"],
          },
          recoveryDirective: {
            kind: "progressive_web_research",
            action: "broaden_search",
            constraintPolicy: "relax_only_agent_added",
            preserveTemporalRequirement: true,
            nextActions: ["broaden_search", "extract_candidates"],
          },
        },
      })
      .mockResolvedValueOnce({
        output: "Verified sources",
        isError: false,
        metadata: {
          toolName: "web_search",
          kind: "web",
          operation: "search",
          temporalRequirement: requirement,
          temporalEvidence: {
            accepted: true,
            acceptedSourceIds: ["https://one.example/match", "https://two.example/match"],
            rejectedSourceIds: [],
          },
        },
      });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [{ name: "web_search", description: "Searches the web", inputSchema: {}, tags: new Set() }],
      builtinTools: new Map([["web_search", search]]),
      eventBus: new EventBus(100),
      executionEnvelope: { toolRounds: { max: 4 } },
    });

    const result = await orchestrator.processMessage(
      makeSession(),
      textParts("Por que perdio Chivas contra Toluca el 18 de julio de 2026?"),
      undefined,
      undefined,
      {
        temporalContext: {
          observedAt: "2026-07-20T05:34:42.733Z",
          timeZone: "America/Tijuana",
          localDate: "2026-07-19",
        },
      },
    );

    expect(result.parts).toEqual(textParts("Verified analysis."));
    expect(search).toHaveBeenCalledTimes(2);
    expect(provider.createMessage).toHaveBeenCalledTimes(4);
    expect(JSON.stringify((provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[2]?.[0]))
      .toContain("Run one broader web_search");
  });
});
