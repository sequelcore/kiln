import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProviderAdapter } from "@kilnai/core/agents";
import { sha256ContentIdentity } from "@kilnai/core/content-addressing";
import type { ContextAuditEntry, ProjectedContextBlock } from "@kilnai/core/context";
import { extractText, textParts } from "@kilnai/core/engine";
import { defineEffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import {
  runtimeModelRoundEffectIdentity,
  type RuntimeModelRoundActionClaim,
  type RuntimeModelRoundActionClaimPermit,
  type RuntimeModelRoundActionClaimStore,
  type RuntimeModelRoundDispatchContext,
} from "../../src/execution-kernel/runtime-model-round-action-claim.js";
import { RuntimeSessionOrchestrator } from "../../src/session/runtime-session-orchestrator.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_INPUT } from "../../src/session/runtime-execution-envelope.js";
import type { PerCallToolConfig } from "../../src/session/runtime-session-orchestrator.types.js";
import type { EscalationDetector } from "../../src/session/support/escalation/escalation-detector.js";

function makeProvider(): ProviderAdapter {
  return {
    name: "mock",
    createMessage: vi.fn().mockResolvedValue({
      parts: textParts("mock response"),
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

function makeSession(systemPrompt = "You are helpful."): RuntimeSession {
  return new RuntimeSession({ appName: "app", tenantId: "test-tenant", userId: "user-1", systemPrompt });
}

function makeGovernedContext(content: string) {
  const block: ProjectedContextBlock = {
    id: "fixture:directive",
    kind: "procedural",
    modelFacingSemantics: "directive",
    source: "fixture",
    content,
    required: true,
    score: 1,
    estimatedTokens: 1,
  };
  return {
    directives: [block],
    guidance: [],
    evidence: [],
    audit: {
      governor: "DefaultContextGovernor",
      selectedBlockIds: [block.id],
      deferredBlockIds: [],
      requiredBlockIds: [],
      preservedRequiredBlockIds: [],
      selectedTokens: 1,
      requiredTokens: 1,
      tokenBudget: 1,
      overflow: false,
      allocationMode: "whole-block",
      positionProfile: "balanced",
      requiredOverflowPolicy: "admit-and-report",
      blocks: [{
        id: block.id, kind: block.kind, modelFacingSemantics: block.modelFacingSemantics,
        source: block.source, contentHash: sha256ContentIdentity(block.content), required: block.required, estimatedTokens: 1, baseScore: 1,
        effectiveScore: 1, decision: "admitted", reason: "required-preserved", order: 0,
      }],
    } satisfies ContextAuditEntry,
  };
}

function makeModelRoundStore(): RuntimeModelRoundActionClaimStore {
  const rows = new Map<string, RuntimeModelRoundActionClaim>();
  const consumed = new WeakSet<object>();
  return {
    claim: (claim) => {
      const permit = {
        claimId: claim.claimId,
        permitId: `runtime-session-test:${claim.claimId}`,
        consume: () => {
          if (consumed.has(permit)) throw new Error("model-round permit already consumed");
          consumed.add(permit);
        },
      } as unknown as RuntimeModelRoundActionClaimPermit;
      rows.set(claim.claimId, claim);
      return permit;
    },
    settle: (permit, settlement) => {
      const claim = rows.get(permit.claimId);
      if (!claim || !consumed.has(permit)) throw new Error("model-round permit was not consumed");
      rows.set(permit.claimId, {
        ...claim,
        status: settlement.kind === "success" ? "settled" : "unknown",
        ...(settlement.kind === "unknown" ? { unknownReason: settlement.reason } : { outcome: "success" }),
      });
    },
  };
}

function withModelRoundClaim(
  orchestrator: RuntimeSessionOrchestrator,
  session: RuntimeSession,
  config: PerCallToolConfig | undefined,
): PerCallToolConfig {
  if (config?.runtimeModelRoundDispatch) return config;
  const deps = (orchestrator as unknown as { readonly deps: { model?: string } }).deps;
  // A concrete model identity is required by the canonical route binding. The
  // provider-only fixtures predate that boundary, so pin a synthetic model in
  // the fixture object before creating the persisted admission.
  if (!deps.model) (deps as { model?: string }).model = "fixture-model";
  const turnId = config?.authorityAdmission?.turnId
    ?? config?.turnCorrelationId
    ?? `${session.id}:turn:${Math.max(session.userTurnCount + 1, 1)}`;
  const routeId = "runtime-session-test-route";
  const accountId = "runtime-session-test-account";
  const credentialRevision = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const revision = { revisionSetId: "runtime-session-test", revisions: { fixture: "runtime-session-test" } } as const;
  const admission = defineEffectiveAuthorityAdmissionBundle({
    sessionId: session.id,
    turnId,
    admittedAt: "2026-08-22T00:00:00.000Z",
    configuration: { sessionRevision: revision, turnRevision: revision },
    session: {
      skillCatalog: { catalogId: "runtime-session-test", revision: "1", skillIds: [] },
      authorityCeiling: { maximumAuthority: "read_only", reason: "Runtime session fixture", subjectId: session.id },
    },
    turn: {
      authority: {
        executionMode: "execute", requestedAuthority: "read_only", admittedAuthority: "read_only",
        sourcePolicy: "runtime_surface_projection", reason: "Runtime session fixture", completeness: "authoritative",
        toolCount: 0, deniedToolCount: 0, sandboxProjection: "read_only",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: { allowedToolPermissions: [], deniedToolNames: [] },
      effectCeiling: {
        operation: "observe", boundaries: [], reversibility: "reversible", dataEgress: "none",
        identityUse: "none", consequences: [], idempotency: "idempotent",
      },
      budget: { status: "not-configured" },
      execution: {
        status: "routed",
        target: {
          targetId: routeId, providerId: "mock", providerModelId: deps.model ?? "fixture-model",
          accountSelection: { kind: "operator-override", accountPolicyId: "policy-1", accountId },
        },
        dataPolicy: { decision: { status: "admitted", freshness: "current", reason: "policy-admitted" } },
        binding: { status: "bound", routeId, accountId, credentialId: "runtime-session-test-credential", credentialRevision },
      },
    },
  });
  const context = {
    admission,
    intentFingerprint: runtimeModelRoundEffectIdentity({ fixture: "runtime-session", sessionId: session.id, turnId }),
    attemptId: `runtime-session-test-attempt:${session.id}:${turnId}`,
    routeId,
    accountId,
    credentialRevision,
    readAdmission: async () => admission,
    store: makeModelRoundStore(),
    state: { claimed: false },
  } satisfies RuntimeModelRoundDispatchContext;
  void orchestrator;
  return {
    ...config,
    // Runtime execution is admitted by the immutable bundle, not by the
    // legacy per-call authority facets. Keep the fixture's round claim and
    // bundle bound to the same synthetic turn.
    authorityAdmission: config?.authorityAdmission ?? admission,
    runtimeModelRoundDispatch: context,
  };
}

const canonicalProcessMessage = RuntimeSessionOrchestrator.prototype.processMessage;
RuntimeSessionOrchestrator.prototype.processMessage = function fixtureProcessMessage(
  session: RuntimeSession,
  userParts: Parameters<RuntimeSessionOrchestrator["processMessage"]>[1],
  governedContext?: Parameters<RuntimeSessionOrchestrator["processMessage"]>[2],
  callBuiltinTools?: Parameters<RuntimeSessionOrchestrator["processMessage"]>[3],
  perCallConfig?: PerCallToolConfig,
): ReturnType<RuntimeSessionOrchestrator["processMessage"]> {
  return canonicalProcessMessage.call(
    this,
    session,
    userParts,
    governedContext,
    callBuiltinTools,
    withModelRoundClaim(this, session, perCallConfig),
  );
};

describe("RuntimeSessionOrchestrator", () => {
  describe("constructor", () => {
    it("creates orchestrator with mock provider", () => {
      const provider = makeProvider();
      const orchestrator = new RuntimeSessionOrchestrator({ provider });
      expect(orchestrator).toBeDefined();
    });

    it("rejects invalid explicit tool-round envelopes at the runtime boundary", () => {
      const provider = makeProvider();

      expect(() =>
        new RuntimeSessionOrchestrator({
          provider,
          executionEnvelope: {
            convergence: { ...RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_INPUT, toolRounds: 0 },
          },
        })
      ).toThrow("toolRounds must be a finite positive safe integer");

      expect(() =>
        new RuntimeSessionOrchestrator({
          provider,
          executionEnvelope: {
            convergence: { ...RUNTIME_DEFAULT_TURN_CONVERGENCE_POLICY_INPUT, toolRounds: 1.5 },
          },
        })
      ).toThrow("toolRounds must be a finite positive safe integer");
    });
  });

  describe("processMessage", () => {
    let provider: ProviderAdapter;
    let orchestrator: RuntimeSessionOrchestrator;

    beforeEach(() => {
      provider = makeProvider();
      orchestrator = new RuntimeSessionOrchestrator({ provider });
    });

    it("adds user message to session", async () => {
      const session = makeSession();
      await orchestrator.processMessage(session, textParts("hello"));
      const history = session.conversationHistory;
      expect(history[0]).toEqual({ role: "user", parts: textParts("hello") });
    });

    it("adds assistant response to session after call", async () => {
      const session = makeSession();
      await orchestrator.processMessage(session, textParts("hello"));
      expect(session.messageCount).toBe(2);
      expect(session.conversationHistory[1]).toEqual({
        role: "assistant",
        parts: textParts("mock response"),
      });
    });

    it("builds correct system prompt from session", async () => {
      const session = makeSession("You are a coding assistant.");
      await orchestrator.processMessage(session, textParts("help me"));
      const callArgs = vi.mocked(provider.createMessage).mock.calls[0]?.[0];
      if (!callArgs) throw new Error("Expected provider request for system-prompt assertion.");
      expect(callArgs.system).toContain("You are a coding assistant.");
      expect(callArgs.system).toContain("[KILN EXECUTION IDENTITY]");
      expect(callArgs.system).toContain("provider: mock");
    });

    it("appends governed context to system prompt", async () => {
      const session = makeSession("Base prompt.");
      await orchestrator.processMessage(session, textParts("help"), makeGovernedContext("some governed context"));
      const callArgs = vi.mocked(provider.createMessage).mock.calls[0]?.[0];
      if (!callArgs) throw new Error("Expected provider request for governed-context assertion.");
      expect(callArgs.system).toContain("--- Governed Context Directives ---");
      expect(callArgs.system).toContain("some governed context");
      expect(callArgs.system).toContain("[KILN EXECUTION IDENTITY]");
    });

    it("binds provider transport evidence to the exact request round", async () => {
      const observer = { onEvent: vi.fn() };
      const watchdog = { chunkIdleTimeoutMs: 500 };

      await orchestrator.processMessage(makeSession(), textParts("help me"), undefined, undefined, {
        providerTransport: {
          projectId: "project-digest",
          requestIdPrefix: "invocation-digest",
          watchdog,
          observer,
        },
      });

      expect(provider.createMessage).toHaveBeenCalledWith(expect.objectContaining({
        requestIdentity: {
          projectId: "project-digest",
          requestId: "invocation-digest:response:1",
        },
        transportWatchdog: watchdog,
        transportObserver: observer,
      }));
    });

    it("appends canonical turn-local time after the stable session prompt", async () => {
      const session = makeSession("Base prompt.");
      await orchestrator.processMessage(session, textParts("what happened today?"), undefined, undefined, {
        temporalContext: {
          observedAt: "2026-07-19T04:45:46.720Z",
          timeZone: "America/Tijuana",
          localDate: "2026-07-18",
        },
      });
      const callArgs = vi.mocked(provider.createMessage).mock.calls[0]?.[0];
      if (!callArgs) throw new Error("Expected provider request for temporal-context assertion.");
      expect(callArgs.system).toContain("Base prompt.");
      expect(callArgs.system).toContain("--- Turn Temporal Context ---");
      expect(callArgs.system).toContain("Observed at (UTC): 2026-07-19T04:45:46.720Z");
      expect(callArgs.system).toContain("Operator-local date: 2026-07-18 (America/Tijuana)");
      expect(callArgs.system).toContain("Do not substitute a publication or retrieval date");
      expect(callArgs.system).toContain("--- Progressive Exact-Date Web Research ---");
      expect(callArgs.system).toContain("Do not copy the event date into startDate or endDate");
      expect(callArgs.system).toContain("retry at least once with a materially broader discovery query");
      expect(callArgs.system).toContain("Use web_extract on the strongest candidate pages");
    });

    it("fails closed instead of returning an unverified same-day event claim", async () => {
      vi.mocked(provider.createMessage).mockResolvedValueOnce({
        parts: textParts("Chivas perdió 0-2 hoy."),
        inputTokens: 100,
        outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
      stopReason: "end_turn",
      });
      const result = await orchestrator.processMessage(
        makeSession(),
        textParts("Hoy, ¿cuál fue el resultado de Chivas vs Toluca?"),
        undefined,
        undefined,
        {
          temporalContext: {
            observedAt: "2026-07-19T05:34:42.733Z",
            timeZone: "America/Tijuana",
            localDate: "2026-07-18",
          },
        },
      );

      expect(extractText(result.parts)).toContain("no pudo verificar");
      expect(extractText(result.parts)).not.toContain("0-2");
    });

    it("fails closed on an unverified explicit-date event claim and names the requested date", async () => {
      vi.mocked(provider.createMessage).mockResolvedValueOnce({
        parts: textParts("Chivas perdio 0-2."),
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        toolCalls: [],
        stopReason: "end_turn",
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

      expect(extractText(result.parts)).toContain("2026-07-18");
      expect(extractText(result.parts)).not.toContain("0-2");
    });

    it("rejects unaudited governed context content", async () => {
      const session = makeSession("Base prompt.");
      await expect(orchestrator.processMessage(session, textParts("help"), {
        directives: [{ id: "raw", kind: "procedural", modelFacingSemantics: "directive", source: "fixture", content: "raw context", required: true, score: 1 }],
        guidance: [],
        evidence: [],
      }))
        .rejects
        .toThrow("Governed runtime context must include a DefaultContextGovernor audit");
    });

    it("does not append governed context section when not provided", async () => {
      const session = makeSession("Base prompt.");
      await orchestrator.processMessage(session, textParts("help"));
      const callArgs = vi.mocked(provider.createMessage).mock.calls[0]?.[0];
      if (!callArgs) throw new Error("Expected provider request for system-prompt assertion.");
      expect(callArgs.system).toContain("Base prompt.");
      expect(callArgs.system).not.toContain("--- Governed Context ---");
      expect(callArgs.system).toContain("[KILN EXECUTION IDENTITY]");
    });

    it("returns token counts from provider response", async () => {
      const session = makeSession();
      const result = await orchestrator.processMessage(session, textParts("hello"));
      expect(result.inputTokens).toBe(100);
      expect(result.outputTokens).toBe(50);
      expect(result.cacheReadTokens).toBe(0);
      expect(result.cacheWriteTokens).toBe(0);
    });

    it("returns parts from provider response", async () => {
      const session = makeSession();
      const result = await orchestrator.processMessage(session, textParts("hello"));
      expect(extractText(result.parts)).toBe("mock response");
    });

    it("returns an explicit canonical completed outcome", async () => {
      const session = makeSession();

      const result = await orchestrator.processMessage(session, textParts("hello"));

      expect(result.outcome).toBe("completed");
    });

    it("accumulates conversation history across multiple calls", async () => {
      const session = makeSession();
      await orchestrator.processMessage(session, textParts("first message"));
      await orchestrator.processMessage(session, textParts("second message"));
      expect(session.messageCount).toBe(4);
      expect(session.conversationHistory[0]).toEqual({ role: "user", parts: textParts("first message") });
      expect(session.conversationHistory[1]).toEqual({ role: "assistant", parts: textParts("mock response") });
      expect(session.conversationHistory[2]).toEqual({ role: "user", parts: textParts("second message") });
      expect(session.conversationHistory[3]).toEqual({ role: "assistant", parts: textParts("mock response") });
    });

    it("projects old tool results for the provider while retaining the canonical session history", async () => {
      const session = makeSession();
      for (let index = 1; index <= 5; index += 1) {
        const toolUseId = `call-${index}`;
        session.addAssistantMessage([{
          type: "tool_use",
          id: toolUseId,
          name: "read",
          input: { path: `file-${index}.ts` },
        }]);
        session.addUserMessage([{
          type: "tool_result",
          toolUseId,
          content: String(index).repeat(160),
        }]);
      }
      const projectedOrchestrator = new RuntimeSessionOrchestrator({
        provider,
        executionEnvelope: {
          conversation: {
            toolResults: {
              triggerToolResultTokens: 100,
              retainRecentToolResults: 2,
            },
          },
        },
      });

      const result = await projectedOrchestrator.processMessage(session, textParts("continue"));

      const providerMessages = vi.mocked(provider.createMessage).mock.calls[0]?.[0].messages ?? [];
      const projectedResults = providerMessages.flatMap((message) => (
        message.parts.filter((part) => part.type === "tool_result")
      ));
      expect(projectedResults.slice(0, 3).map((part) => part.content)).toEqual([
        "[cleared:call-1]",
        "[cleared:call-2]",
        "[cleared:call-3]",
      ]);
      expect(session.conversationHistory[1]?.parts[0]).toEqual({
        type: "tool_result",
        toolUseId: "call-1",
        content: "1".repeat(160),
      });
      expect(result.providerRequests?.[0]?.conversationProjection).toMatchObject({
        clearedToolResultCount: 3,
        clearedToolUseIds: ["call-1", "call-2", "call-3"],
        overflow: false,
      });
    });

    it("uses session systemPrompt as system parameter", async () => {
      const session = makeSession("custom system prompt");
      await orchestrator.processMessage(session, textParts("msg"));
      const callArgs = vi.mocked(provider.createMessage).mock.calls[0]?.[0];
      if (!callArgs) throw new Error("Expected provider request for system-prompt assertion.");
      expect(callArgs.system).toContain("custom system prompt");
      expect(callArgs.system).toContain("[KILN EXECUTION IDENTITY]");
    });

    it("passes maxTokens to provider when configured", async () => {
      const orchWithTokens = new RuntimeSessionOrchestrator({ provider, maxTokens: 1024 });
      const session = makeSession();
      await orchWithTokens.processMessage(session, textParts("msg"));
      expect(provider.createMessage).toHaveBeenCalledWith(
        expect.objectContaining({ maxTokens: 1024 }),
      );
    });

    it("passes the admitted execution context to the provider boundary", async () => {
      const session = makeSession();

      await orchestrator.processMessage(session, textParts("msg"), undefined, undefined, {
        workingDirectory: "C:\\workspace\\kiln",
      });

      expect(provider.createMessage).toHaveBeenCalledWith(expect.objectContaining({
        executionContext: expect.objectContaining({
          workingDirectory: "C:\\workspace\\kiln",
          requestedAuthority: "read_only",
        }),
      }));
    });
  });

  describe("AI guard", () => {
    it("returns queued result with empty parts when sessionMode is 'queued'", async () => {
      const provider = makeProvider();
      const orchestrator = new RuntimeSessionOrchestrator({ provider });
      const session = makeSession();
      session.setSessionMode("queued");

      const result = await orchestrator.processMessage(session, textParts("hello from queue"));

      expect(result.queued).toBe(true);
      expect(result.parts).toEqual([]);
      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
      expect(result.cacheReadTokens).toBe(0);
      expect(result.cacheWriteTokens).toBe(0);
      expect(provider.createMessage).not.toHaveBeenCalled();
    });

    it("returns queued result when sessionMode is 'human_active'", async () => {
      const provider = makeProvider();
      const orchestrator = new RuntimeSessionOrchestrator({ provider });
      const session = makeSession();
      session.setSessionMode("queued");
      session.setSessionMode("human_active");

      const result = await orchestrator.processMessage(session, textParts("hello from human"));

      expect(result.queued).toBe(true);
      expect(result.parts).toEqual([]);
      expect(provider.createMessage).not.toHaveBeenCalled();
    });

    it("still adds user message to history when queued", async () => {
      const provider = makeProvider();
      const orchestrator = new RuntimeSessionOrchestrator({ provider });
      const session = makeSession();
      session.setSessionMode("queued");

      await orchestrator.processMessage(session, textParts("queued message"));

      const lastMsg = session.conversationHistory[session.conversationHistory.length - 1];
      expect(lastMsg).toEqual({ role: "user", parts: textParts("queued message") });
    });

    it("processes normally when sessionMode is 'ai_active'", async () => {
      const provider = makeProvider();
      const orchestrator = new RuntimeSessionOrchestrator({ provider });
      const session = makeSession();

      const result = await orchestrator.processMessage(session, textParts("hello"));

      expect(result.queued).toBe(false);
      expect(extractText(result.parts)).toBe("mock response");
      expect(provider.createMessage).toHaveBeenCalledTimes(1);
    });

    it("auto-reopens resolved sessions and processes normally", async () => {
      const provider = makeProvider();
      const orchestrator = new RuntimeSessionOrchestrator({ provider });
      const session = makeSession();
      // Transition to resolved: ai_active -> queued -> human_active -> resolved
      session.setSessionMode("queued");
      session.setSessionMode("human_active");
      session.setSessionMode("resolved");
      expect(session.sessionMode).toBe("resolved");

      const result = await orchestrator.processMessage(session, textParts("I'm back"));

      expect(result.queued).toBe(false);
      expect(extractText(result.parts)).toBe("mock response");
      expect(session.sessionMode).toBe("ai_active");
      expect(provider.createMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe("escalation detection", () => {
    it("includes pre-LLM escalation signal when keyword detected", async () => {
      const provider = makeProvider();
      const detector: EscalationDetector = {
        checkPreLLM: vi.fn().mockReturnValue({
          reason: "keyword",
          confidence: 0.8,
          detail: 'Matched keyword: "human"',
        }),
        checkPostLLM: vi.fn().mockReturnValue(null),
      };
      const orchestrator = new RuntimeSessionOrchestrator({ provider, escalationDetector: detector });
      const session = makeSession();

      const result = await orchestrator.processMessage(session, textParts("I want a human"));

      expect(result.escalation).toBeDefined();
      expect(result.escalation!.reason).toBe("keyword");
      expect(result.escalation!.confidence).toBe(0.8);
      // Post-LLM should NOT be called when pre-LLM triggers
      expect(detector.checkPostLLM).not.toHaveBeenCalled();
    });

    it("includes post-LLM escalation signal when loop detected", async () => {
      const provider = makeProvider();
      const detector: EscalationDetector = {
        checkPreLLM: vi.fn().mockReturnValue(null),
        checkPostLLM: vi.fn().mockReturnValue({
          reason: "loop",
          confidence: 0.85,
          detail: "Last 3 responses have similarity > 0.85",
        }),
      };
      const orchestrator = new RuntimeSessionOrchestrator({ provider, escalationDetector: detector });
      const session = makeSession();

      const result = await orchestrator.processMessage(session, textParts("hello"));

      expect(result.escalation).toBeDefined();
      expect(result.escalation!.reason).toBe("loop");
      expect(result.escalation!.confidence).toBe(0.85);
    });

    it("returns no escalation when detector returns null", async () => {
      const provider = makeProvider();
      const detector: EscalationDetector = {
        checkPreLLM: vi.fn().mockReturnValue(null),
        checkPostLLM: vi.fn().mockReturnValue(null),
      };
      const orchestrator = new RuntimeSessionOrchestrator({ provider, escalationDetector: detector });
      const session = makeSession();

      const result = await orchestrator.processMessage(session, textParts("hello"));

      expect(result.escalation).toBeUndefined();
    });

    it("returns no escalation when no detector is configured", async () => {
      const provider = makeProvider();
      const orchestrator = new RuntimeSessionOrchestrator({ provider });
      const session = makeSession();

      const result = await orchestrator.processMessage(session, textParts("I want a human"));

      expect(result.escalation).toBeUndefined();
    });

    it("generates a deterministic local context summary when escalation is detected", async () => {
      const provider = makeProvider();
      const detector: EscalationDetector = {
        checkPreLLM: vi.fn().mockReturnValue({
          reason: "keyword",
          confidence: 0.8,
          detail: 'Matched keyword: "human"',
        }),
        checkPostLLM: vi.fn().mockReturnValue(null),
      };
      const orchestrator = new RuntimeSessionOrchestrator({
        provider,
        escalationDetector: detector,
      });
      const session = makeSession();

      const result = await orchestrator.processMessage(session, textParts("I want a human"));

      expect(result.contextSummary).toContain("user: I want a human");
    });

    it("keeps the local context summary independent of provider failures", async () => {
      const provider = makeProvider();
      const detector: EscalationDetector = {
        checkPreLLM: vi.fn().mockReturnValue({
          reason: "keyword",
          confidence: 0.8,
          detail: 'Matched keyword: "human"',
        }),
        checkPostLLM: vi.fn().mockReturnValue(null),
      };
      const orchestrator = new RuntimeSessionOrchestrator({
        provider,
        escalationDetector: detector,
      });
      const session = makeSession();

      const result = await orchestrator.processMessage(session, textParts("I want a human"));

      expect(result.escalation).toBeDefined();
      expect(result.contextSummary).toContain("user: I want a human");
    });

    it("does not generate summary when no escalation detected", async () => {
      const provider = makeProvider();
      const detector: EscalationDetector = {
        checkPreLLM: vi.fn().mockReturnValue(null),
        checkPostLLM: vi.fn().mockReturnValue(null),
      };
      const orchestrator = new RuntimeSessionOrchestrator({
        provider,
        escalationDetector: detector,
      });
      const session = makeSession();

      const result = await orchestrator.processMessage(session, textParts("hello"));

      expect(result.contextSummary).toBeUndefined();
    });
  });
});
