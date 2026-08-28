import { describe, expect, it, vi } from "vitest";
import { type ProviderAdapter } from "@kilnai/core/agents";
import { textParts } from "@kilnai/core/engine";
import { EventBus } from "@kilnai/core/events";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import {
  makeFixtureExecutionEnvelope,
  makeCommandProvider,
  makeToolCallProvider,
  makeProvider,
  makeSession,
} from "./runtime-session-orchestrator-tools-test-fixture.js";
import {
  requireRuntimeCompletion,
  requireRuntimeCompletionEvidence,
  requireRuntimeConvergence,
} from "./runtime-terminal-fixture.js";

describe("RuntimeSessionOrchestrator - completion obligations", () => {
  it("keeps an ordinary response unchanged when no completion obligation is present", async () => {
    const provider = makeProvider();
    const orchestrator = new RuntimeSessionOrchestrator({ provider });

    const result = await orchestrator.processMessage(makeSession(), textParts("hello"));

    expect(provider.createMessage).toHaveBeenCalledTimes(1);
    expect(result.parts).toEqual(textParts("done"));
    expect(result.outcome).toBe("completed");
    expect(requireRuntimeCompletion(result).completion).toMatchObject({
      obligations: [],
      producerEvidence: [],
      eligibility: { status: "eligible" },
    });
    expect(requireRuntimeConvergence(result).convergence).toMatchObject({
      policy: expect.objectContaining({ policyId: expect.any(String) }),
      progressEvidence: [],
    });
  });

  it("pauses when an available required producer was not run", async () => {
    const provider = makeProvider();
    const formalVerify = {
      name: "formal_verify",
      description: "Run the formal verifier.",
      inputSchema: {},
      tags: new Set<string>(),
    };
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
    });

    const result = await orchestrator.processMessage(
      makeSession(),
      textParts("Use Dafny."),
      undefined,
      undefined,
      { additionalTools: [formalVerify] },
    );

    expect(provider.createMessage).toHaveBeenCalledTimes(1);
    expect(result.parts).toEqual(textParts("formal_verify: not_run"));
    expect(result.outcome).toBe("paused");
    expect(result.dispositionReason).toBe("required_producer_not_run");
    expect(requireRuntimeCompletionEvidence(result).completion.producerEvidence).toEqual([
      { canonicalProducerId: "formal_verify", status: "not_run" },
    ]);
    expect(requireRuntimeCompletionEvidence(result).completion.eligibility).toMatchObject({
      status: "ineligible",
      unmet: [{ canonicalToolId: "formal_verify", status: "not_run" }],
    });
  });

  it("fails when a required producer is unavailable", async () => {
    const provider = makeProvider();
    const orchestrator = new RuntimeSessionOrchestrator({ provider });

    const result = await orchestrator.processMessage(makeSession(), textParts("Use Dafny."));

    expect(provider.createMessage).toHaveBeenCalledTimes(1);
    expect(result.parts).toEqual(textParts("formal_verify: unavailable"));
    expect(result.outcome).toBe("failed");
    expect(result.dispositionReason).toBe("required_producer_unavailable");
    expect(requireRuntimeCompletionEvidence(result).completion.producerEvidence).toEqual([
      { canonicalProducerId: "formal_verify", status: "unavailable" },
    ]);
    expect(requireRuntimeCompletionEvidence(result).completion.eligibility).toMatchObject({ status: "ineligible" });
  });

  it("fails closed when authority denies a producer that remains in the initial registry", async () => {
    const provider = makeProvider();
    const formalVerify = {
      name: "formal_verify",
      description: "Run the formal verifier.",
      inputSchema: {},
      tags: new Set<string>(),
    };
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [formalVerify],
    });

    const result = await orchestrator.processMessage(
      makeSession(),
      textParts("Use Dafny."),
      undefined,
      undefined,
      { toolAllowlist: new Set(["tool_catalog_search"]) },
    );

    expect(provider.createMessage).toHaveBeenCalledTimes(1);
    expect(result.parts).toEqual(textParts("formal_verify: unavailable"));
    expect(result.outcome).toBe("failed");
    expect(result.dispositionReason).toBe("required_producer_unavailable");
    expect(requireRuntimeCompletionEvidence(result).completion.producerEvidence).toEqual([
      { canonicalProducerId: "formal_verify", status: "unavailable" },
    ]);
  });

  it("does not treat a successful Bash substitution as required-producer evidence", async () => {
    const provider = makeCommandProvider("dafny verify src/Test.dfy");
    const bash = vi.fn().mockResolvedValue("Dafny completed");
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [
        { name: "bash", description: "Run a shell command.", inputSchema: {}, tags: new Set(["command"]) },
        { name: "formal_verify", description: "Run the formal verifier.", inputSchema: {}, tags: new Set() },
      ],
      builtinTools: new Map([["bash", bash]]),
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("Use Dafny through bash."));

    expect(provider.createMessage).toHaveBeenCalledTimes(2);
    expect(bash).toHaveBeenCalledTimes(1);
    expect(result.parts).toEqual(textParts("formal_verify: not_run"));
    expect(result.outcome).toBe("paused");
    expect(result.dispositionReason).toBe("required_producer_not_run");
    expect(requireRuntimeCompletionEvidence(result).completion.producerEvidence).toEqual([
      { canonicalProducerId: "formal_verify", status: "not_run" },
    ]);
  });

  it("fails with a typed execution-failed disposition when the required producer throws", async () => {
    const provider = makeToolCallProvider({ id: "formal-1", name: "formal_verify", input: {} });
    const formalVerify = {
      name: "formal_verify",
      description: "Run the formal verifier.",
      inputSchema: {},
      tags: new Set<string>(),
    };
    const verify = vi.fn().mockResolvedValue({ output: "verifier failed", isError: true });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [formalVerify],
      builtinTools: new Map([["formal_verify", verify]]),
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("Use Dafny."));

    expect(provider.createMessage).toHaveBeenCalledTimes(2);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe("failed");
    expect(result.dispositionReason).toBe("required_producer_execution_failed");
    expect(requireRuntimeCompletionEvidence(result).completion.eligibility).toMatchObject({ status: "ineligible" });
    expect(requireRuntimeCompletionEvidence(result).completion.producerEvidence).toEqual([
      { canonicalProducerId: "formal_verify", status: "execution_failed" },
    ]);
  });

  it("fails with a typed invalid-evidence disposition when a producer result is untyped", async () => {
    const provider = makeToolCallProvider({ id: "static-1", name: "static_analyze", input: {} });
    const staticAnalyze = {
      name: "static_analyze",
      description: "Run static analysis.",
      inputSchema: {},
      tags: new Set<string>(),
    };
    const analyze = vi.fn().mockResolvedValue("clean");
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      tools: [staticAnalyze],
      builtinTools: new Map([["static_analyze", analyze]]),
    });

    const result = await orchestrator.processMessage(makeSession(), textParts("Use Oxlint."));

    expect(provider.createMessage).toHaveBeenCalledTimes(2);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe("failed");
    expect(result.dispositionReason).toBe("required_producer_invalid_evidence");
    expect(requireRuntimeCompletionEvidence(result).completion.eligibility).toMatchObject({ status: "ineligible" });
    expect(requireRuntimeCompletionEvidence(result).completion.producerEvidence).toEqual([
      { canonicalProducerId: "static_analyze", status: "invalid_evidence" },
    ]);
  });
});

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
      executionEnvelope: makeFixtureExecutionEnvelope(4),
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
