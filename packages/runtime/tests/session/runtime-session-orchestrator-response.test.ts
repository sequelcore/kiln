import { describe, expect, it, vi } from "vitest";
import {
  buildEffectivePromptManifest,
  textParts,
  type EffectivePromptManifest,
  type ProviderAdapter,
} from "@kilnai/core";
import {
  finalizeRuntimeSessionResponse,
  requestRuntimeSessionFallbackResponse,
} from "../../src/session/runtime-session-orchestrator-response.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import type { ToolExecutionSummary } from "../../src/session/runtime-session-orchestrator.types.js";

function session(): RuntimeSession {
  return new RuntimeSession({
    appName: "app",
    tenantId: "tenant",
    userId: "user",
    systemPrompt: "base",
  });
}

function provider(): ProviderAdapter {
  return {
    name: "mock",
    createMessage: vi.fn().mockResolvedValue({
      parts: textParts("done"),
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

describe("requestRuntimeSessionFallbackResponse", () => {
  it("uses the manifest as the only prompt authority", async () => {
    const adapter = provider();
    const manifest = buildEffectivePromptManifest({
      components: [{
        id: "exact",
        revision: "revision",
        scope: "static",
        content: "Exact prompt.",
        provenance: { source: "test" },
      }],
    });

    await requestRuntimeSessionFallbackResponse(adapter, manifest, session(), 100);

    expect((adapter.createMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].system)
      .toBe(manifest.finalPrompt);
  });

  it("rejects an invalid separate prompt before invoking the provider", async () => {
    const adapter = provider();

    await expect(requestRuntimeSessionFallbackResponse(
      adapter,
      "incorrect separate prompt" as unknown as EffectivePromptManifest,
      session(),
      100,
    )).rejects.toThrow("effective prompt manifest");
    expect(adapter.createMessage).not.toHaveBeenCalled();
  });
});

// Roadmap 01 (External Runtime Governance), Slice 0 - Failing Trace Fixture.
// Second regression proof: "a parent success message can currently disagree with
// failed canonical execution state." governed-turn-outcome.ts already correctly
// computes outcome:"failed" when an unresolved managed-invocation blocking failure
// exists (see governed-turn-outcome.test.ts, "does not let terminal goal closeout
// hide an unresolved managed invocation failure"). The gap is one level up: nothing
// in finalizeRuntimeSessionResponse reconciles the free-text `parts` it returns
// against that computed `outcome` — an unqualified success claim in `parts` is
// returned completely unchanged whether the canonical turn succeeded or failed.
// Expected to fail until Roadmap 01 Slice 2/3 (Recovery And Terminal Consistency /
// Cross-Surface Replay) make final-answer eligibility depend on canonical state;
// this .fails must flip to a plain `it` once that lands.
describe("finalizeRuntimeSessionResponse (Roadmap 01 Slice 0)", () => {
  const unresolvedManagedInvocationFailure: ToolExecutionSummary = {
    toolName: "managed_agent.invoke",
    success: false,
    durationMs: 10,
    resultSummary: "Managed invocation route cannot execute this phase because it lacks required tools: bash.",
    metadata: {
      kind: "managed-invocation",
      status: "unavailable",
      goal: { id: "goal-external-runtime", status: "active" },
    },
  };

  it.fails(
    "does not let a success-claiming final message stand when canonical outcome disagrees",
    async () => {
      const unqualifiedSuccessClaim = textParts(
        "Navigation to both objectives succeeded and the console is clean.",
      );

      const result = await finalizeRuntimeSessionResponse({
        deps: { provider: provider() },
        session: session(),
        parts: unqualifiedSuccessClaim,
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        usageTotals: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        toolExecutions: [unresolvedManagedInvocationFailure],
      });

      // The turn outcome correctly disagrees with the claimed success today...
      expect(result.outcome).not.toBe("completed");
      // ...but nothing stops the disagreeing prose from being returned unchanged.
      // Desired: a final answer must not stand unqualified when canonical state
      // remains failed or blocked.
      expect(result.parts).not.toEqual(unqualifiedSuccessClaim);
    },
  );
});
