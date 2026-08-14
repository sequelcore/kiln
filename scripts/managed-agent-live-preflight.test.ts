import { describe, expect, it } from "vitest";
import {
  evaluateManagedAgentLivePreflight,
  KILN_LIVE_CODEX_MODEL,
  KILN_LIVE_CODEX_TESTS_ENV,
  KILN_LIVE_CLAUDE_MODEL,
  KILN_LIVE_CLAUDE_TESTS_ENV,
  KILN_LIVE_OPENCODE_MODEL,
  KILN_LIVE_OPENCODE_TESTS_ENV,
  projectClaudeNativeEntitlementEnvironment,
} from "./managed-agent-live-preflight.js";

describe("managed-agent live preflight", () => {
  it("requires an explicit exact Claude model before admitting the live proof", () => {
    const missing = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_CLAUDE_TESTS_ENV]: "1",
    });
    expect(missing.ok).toBe(false);
    expect(missing.message).toContain(KILN_LIVE_CLAUDE_MODEL);

    const movingAlias = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_CLAUDE_TESTS_ENV]: "1",
      [KILN_LIVE_CLAUDE_MODEL]: "default",
    });
    expect(movingAlias.ok).toBe(false);
    expect(movingAlias.message).toContain("exact Claude catalog model");

    const exact = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_CLAUDE_TESTS_ENV]: "1",
      [KILN_LIVE_CLAUDE_MODEL]: "claude-sonnet-5",
    });
    expect(exact.ok).toBe(true);
  });

  it.each([
    [KILN_LIVE_CODEX_TESTS_ENV, KILN_LIVE_CODEX_MODEL, "gpt-5.6-sol"],
    [KILN_LIVE_OPENCODE_TESTS_ENV, KILN_LIVE_OPENCODE_MODEL, "opencode/minimax-m2.7-free"],
  ])("requires an explicit model for %s instead of inventing a live-proof default", (
    providerFlag,
    modelVariable,
    exactModel,
  ) => {
    const missing = evaluateManagedAgentLivePreflight({
      [providerFlag]: "1",
    });
    expect(missing.ok).toBe(false);
    expect(missing.message).toContain(modelVariable);

    const exact = evaluateManagedAgentLivePreflight({
      [providerFlag]: "1",
      [modelVariable]: exactModel,
    });
    expect(exact.ok).toBe(true);
  });

  it("removes environment routes that can override the native Claude entitlement", () => {
    expect(projectClaudeNativeEntitlementEnvironment({
      ANTHROPIC_API_KEY: "api-key",
      ANTHROPIC_AUTH_TOKEN: "token",
      ANTHROPIC_BASE_URL: "https://example.invalid",
      CLAUDE_CODE_SSE_PORT: "9999",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDE_CODE_USE_FOUNDRY: "1",
      CLAUDE_CODE_USE_VERTEX: "1",
      KILN_SAFE_EVIDENCE: "retained",
    })).toEqual({ KILN_SAFE_EVIDENCE: "retained" });
  });
});
