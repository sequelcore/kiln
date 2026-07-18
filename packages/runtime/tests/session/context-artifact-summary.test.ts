import { InMemoryContextArtifactCache, type ResumePolicyDecision } from "@kilnai/core";
import { describe, expect, it } from "vitest";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import { applyRuntimeTurnRecord } from "../../src/session/runtime-turn-record.js";
import {
  normalizeRuntimeTaskShape,
  readRuntimeSupportArtifactsDetailed,
} from "../../src/session/support/artifacts/context-artifact-summary.js";

const CACHE_FIRST_DECISION: ResumePolicyDecision = {
  cachedResumeSignalCount: 2,
  hasCachedResumeContext: true,
  resumeStrategy: "cache-first",
  shouldUseProviderNativeResume: false,
};

function makeSession(sessionId: string): RuntimeSession {
  return new RuntimeSession({
    appName: "kiln-gui",
    tenantId: "_gui",
    userId: "same-operator",
    sessionId,
    systemPrompt: "system",
  });
}

function recordCachedSupport(
  cache: InMemoryContextArtifactCache,
  session: RuntimeSession,
  taskShape: string,
): void {
  session.addUserMessage([{ type: "text", text: "Inspect the repository" }]);
  applyRuntimeTurnRecord({
    session,
    channel: "gui",
    taskShape,
    contextArtifactCache: cache,
    continuityDecision: CACHE_FIRST_DECISION,
    queued: false,
    inputTokens: 10,
    outputTokens: 5,
    contextSummary: "Goal goal-old belongs to the completed historical turn.",
    routingDecision: {
      provider: "codex-oauth",
      model: "gpt-5.6-terra",
      routingTier: "rule",
    },
    toolExecutions: [{
      toolName: "work_item.execution.start",
      durationMs: 1,
      success: false,
      resultSummary: "Goal not found: goal-old",
    }],
  });
}

describe("runtime continuity artifact scope", () => {
  it("does not admit task-shaped context or tool outcomes from another session", () => {
    const cache = new InMemoryContextArtifactCache();
    const taskShape = normalizeRuntimeTaskShape("Inspect the repository");
    recordCachedSupport(cache, makeSession("prior-gui-session"), taskShape);

    const result = readRuntimeSupportArtifactsDetailed(cache, {
      session: makeSession("fresh-gui-session"),
      channel: "gui",
      providerHint: "codex-oauth",
      taskShape,
    });

    expect(result.content).toBeUndefined();
    expect(result.supportArtifactCount).toBe(0);
    expect(result.supportArtifactSources).toEqual([]);
    expect(result.usedCachedSupport).toBe(false);
  });

  it("labels cached support from the same logical session as non-authoritative", () => {
    const cache = new InMemoryContextArtifactCache();
    const taskShape = normalizeRuntimeTaskShape("Inspect the repository");
    recordCachedSupport(cache, makeSession("resumed-gui-session"), taskShape);

    const result = readRuntimeSupportArtifactsDetailed(cache, {
      session: makeSession("resumed-gui-session"),
      channel: "gui",
      providerHint: "codex-oauth",
      taskShape,
    });

    expect(result.content).toContain("Non-authoritative session continuity");
    expect(result.content).toContain("Re-read canonical tools and resources");
    expect(result.supportArtifactSources).toEqual(["thread", "context", "tools"]);
    expect(result.usedCachedSupport).toBe(true);
  });
});
