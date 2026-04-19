import { describe, expect, it } from "vitest";
import { InMemoryContextArtifactCache, type ResumePolicyDecision } from "@kilnai/core";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { applyRuntimeTurnRecord } from "../../src/session/runtime-turn-record.js";

function makeDecision(
  strategy: ResumePolicyDecision["resumeStrategy"],
  cachedResumeSignalCount = 1,
): ResumePolicyDecision {
  return {
    cachedResumeSignalCount,
    hasCachedResumeContext: cachedResumeSignalCount > 0,
    resumeStrategy: strategy,
    shouldUseProviderNativeResume: strategy === "provider-native",
  };
}

describe("applyRuntimeTurnRecord", () => {
  it("updates ledger, artifacts, and cache from one canonical turn input", () => {
    const session = new RuntimeSession({
      appName: "app",
      tenantId: "tenant",
      userId: "user",
      systemPrompt: "system",
    });
    session.addUserMessage([{ type: "text", text: "hello" }]);
    const cache = new InMemoryContextArtifactCache();

    const record = applyRuntimeTurnRecord({
      session,
      channel: "api",
      taskShape: "diagnostics",
      contextArtifactCache: cache,
      continuityDecision: makeDecision("cache-first", 3),
      queued: false,
      inputTokens: 40,
      outputTokens: 12,
      contextSummary: "Summarized context",
      routingDecision: {
        provider: "mock-provider",
        model: "mock-model",
        routingTier: "rule",
      },
      toolExecutions: [
        {
          toolName: "read_file",
          durationMs: 12,
          success: true,
          resultSummary: "Read src/index.ts",
        },
      ],
      escalationReason: "keyword",
      groundingBlockedClaims: ["unsupported claim"],
      fileChanges: [
        {
          path: "src/index.ts",
          changeType: "modified",
          linesAdded: 2,
          linesRemoved: 1,
        },
      ],
      approvalTransitions: [
        {
          status: "requested",
          sessionId: session.id,
          reason: "Needs approval",
        },
      ],
      authorityDecisions: [
        {
          toolName: "read_file",
          level: 1,
          allowed: true,
          reason: "Read-only tool, auto-execute",
        },
      ],
    });

    expect(record.provider).toBe("mock-provider");
    expect(record.model).toBe("mock-model");
    expect(record.toolExecutions?.length).toBe(1);
    expect(record.fileChanges).toHaveLength(1);
    expect(record.approvalTransitions).toHaveLength(1);
    expect(record.authorityDecisions).toHaveLength(1);
    expect(record.authorityDecisions[0]).toEqual({
      toolName: "read_file",
      level: 1,
      allowed: true,
      reason: "Read-only tool, auto-execute",
    });
    expect(record.continuity.strategy).toBe("cache-first");
    expect(session.totalTokens).toBe(52);
    expect(session.sessionLedger.currentPhase).toBe("responded");
    expect(session.sessionLedger.lastProvider).toBe("mock-provider");
    expect(session.sessionLedger.toolCallCount).toBe(1);
    expect(session.sessionLedger.lastSummary).toBe("Summarized context");
    expect(session.exactArtifacts).toContain("Runtime routed provider: mock-provider/mock-model");
    expect(session.exactArtifacts).toContain("Runtime context summary: Summarized context");
    expect(session.exactArtifacts).toContain("Tool execution: read_file (success)");
    expect(session.exactArtifacts).toContain("Tool result summary: Read src/index.ts");
    expect(session.exactArtifacts).toContain("Escalation detected: keyword");
    expect(session.exactArtifacts).toContain("Grounding blocked: unsupported claim");
    expect(session.exactArtifacts).toContain("File changed: src/index.ts");
    expect(session.exactArtifacts).toContain(`Approval requested: ${session.id} (Needs approval)`);
    expect(session.exactArtifacts).toContain("Tool authority: read_file L1 allow (Read-only tool, auto-execute)");

    expect(cache.listByKind("runtime-thread-summary")).toHaveLength(1);
    expect(cache.listByKind("runtime-context-bundle")).toHaveLength(1);
    expect(cache.listByKind("runtime-tool-bundle")).toHaveLength(1);
    expect(cache.listByKind("runtime-continuity-outcome")).toHaveLength(1);
  });

  it("preserves prior provider/tool count when turn has no routing or tools", () => {
    const session = new RuntimeSession({
      appName: "app",
      tenantId: "tenant",
      userId: "user",
      systemPrompt: "system",
    });
    session.addUserMessage([{ type: "text", text: "hello" }]);
    session.updateSessionLedger({
      lastProvider: "existing-provider",
      toolCallCount: 4,
    });

    const cache = new InMemoryContextArtifactCache();
    const record = applyRuntimeTurnRecord({
      session,
      channel: "api",
      taskShape: "interactive",
      contextArtifactCache: cache,
      continuityDecision: makeDecision("fallback-replay", 0),
      queued: true,
      inputTokens: 0,
      outputTokens: 0,
    });

    expect(record.provider).toBe("existing-provider");
    expect(record.fileChanges).toEqual([]);
    expect(record.approvalTransitions).toEqual([]);
    expect(record.authorityDecisions).toEqual([]);
    expect(session.sessionLedger.currentPhase).toBe("queued");
    expect(session.sessionLedger.lastProvider).toBe("existing-provider");
    expect(session.sessionLedger.toolCallCount).toBe(4);
    expect(cache.listByKind("runtime-tool-bundle")).toHaveLength(0);
  });
});
