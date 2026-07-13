import { describe, expect, it } from "vitest";
import { formatReport } from "./session-report.js";

describe("formatReport", () => {
  it("renders the runtime-normalized context projection in the existing human session report", () => {
    const lines = formatReport({
      sessionId: "session-1",
      task: "Verify context evidence",
      domain: "default",
      phaseReached: "complete",
      cost: { total: 0, byRoleModel: {} },
      duration: 1_000,
      contextUsage: {
        state: "partial",
        usedTokens: 2_400,
        providerId: "anthropic",
        modelId: "claude-sonnet",
        turnId: "session-1:turn:1",
        observedAt: "2026-07-13T00:00:00.000Z",
        measurement: "runtime_estimate",
        lifecycle: "completed",
        contextWindowAuthority: "runtime_observed",
        freshness: "fresh",
        reason: "No provider-authoritative context window is available.",
      },
    }, "kiln");

    expect(lines).toContain("Context usage: Context partial: 2.4k tokens");
  });
});
