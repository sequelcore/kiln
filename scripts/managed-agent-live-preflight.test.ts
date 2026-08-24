import { describe, expect, it } from "vitest";
import {
  KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL,
  KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_ROUTE_ENV,
  KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS_ENV,
  evaluateManagedAgentLivePreflight,
  KILN_LIVE_CODEX_MODEL,
  KILN_LIVE_CODEX_TESTS_ENV,
  KILN_LIVE_CLAUDE_MODEL,
  KILN_LIVE_CLAUDE_TESTS_ENV,
  KILN_LIVE_MANAGED_AGENT_TESTS_ENV,
  KILN_LIVE_OPENCODE_MODEL,
  KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_ROUTE_ENV,
  KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_TESTS_ENV,
  KILN_LIVE_OPENCODE_TESTS_ENV,
  KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV,
  KILN_LIVE_OPENAI_DIRECT_MODEL,
  KILN_LIVE_OPENAI_DIRECT_TESTS_ENV,
  MANAGED_AGENT_LIVE_CONFIGURATION_FLAGS,
  projectClaudeNativeEntitlementEnvironment,
} from "./managed-agent-live-preflight.js";

describe("managed-agent live preflight", () => {
  it("does not admit an explicit master flag without a provider route", () => {
    const result = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
    });

    expect(result.ok).toBe(false);
    expect(result.enabledProviders).toEqual([]);
  });

  it.each([
    [KILN_LIVE_CODEX_TESTS_ENV, KILN_LIVE_CODEX_MODEL, "gpt-5.6-sol"],
    [KILN_LIVE_CLAUDE_TESTS_ENV, KILN_LIVE_CLAUDE_MODEL, "claude-sonnet-5"],
    [KILN_LIVE_OPENCODE_TESTS_ENV, KILN_LIVE_OPENCODE_MODEL, "opencode/minimax-m2.7-free"],
  ])("does not admit an explicitly disabled %s provider", (providerFlag, modelVariable, model) => {
    const result = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [providerFlag]: "0",
      [modelVariable]: model,
    });

    expect(result.ok).toBe(false);
    expect(result.enabledProviders).not.toContain(providerFlag);
  });

  it("requires explicit global and provider authority", () => {
    const result = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_CODEX_TESTS_ENV]: "1",
      [KILN_LIVE_CODEX_MODEL]: "gpt-5.6-sol",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain(KILN_LIVE_MANAGED_AGENT_TESTS_ENV);

    const admitted = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [KILN_LIVE_CODEX_TESTS_ENV]: "1",
      [KILN_LIVE_CODEX_MODEL]: "gpt-5.6-sol",
    });
    expect(admitted.ok).toBe(true);
    expect(admitted.enabledProviders).toEqual([KILN_LIVE_CODEX_TESTS_ENV]);
  });

  it.each([
    [KILN_LIVE_MANAGED_AGENT_TESTS_ENV, "true", KILN_LIVE_CODEX_TESTS_ENV],
    [KILN_LIVE_CODEX_TESTS_ENV, "false", KILN_LIVE_CODEX_TESTS_ENV],
    [KILN_LIVE_CLAUDE_TESTS_ENV, " \t", KILN_LIVE_CLAUDE_TESTS_ENV],
    [KILN_LIVE_OPENCODE_TESTS_ENV, "yes"],
  ])("rejects a present %s value that is not exactly 0 or 1", (...args) => {
    const [flag, value] = args;
    const result = evaluateManagedAgentLivePreflight({ [flag]: value });

    expect(result.ok).toBe(false);
    expect(result.enabledProviders).toEqual([]);
    expect(result.message).toContain(flag);
    expect(result.message).not.toContain(value);
  });

  it("owns all model and route variable names in one configuration registry", () => {
    expect(MANAGED_AGENT_LIVE_CONFIGURATION_FLAGS).toEqual(expect.arrayContaining([
      KILN_LIVE_CODEX_MODEL,
      KILN_LIVE_CLAUDE_MODEL,
      KILN_LIVE_OPENCODE_MODEL,
      KILN_LIVE_OPENAI_DIRECT_MODEL,
      KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL,
      KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_ROUTE_ENV,
      KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_ROUTE_ENV,
    ]));
  });

  it("requires an explicit exact Claude model before admitting the live proof", () => {
    const missing = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [KILN_LIVE_CLAUDE_TESTS_ENV]: "1",
    });
    expect(missing.ok).toBe(false);
    expect(missing.message).toContain(KILN_LIVE_CLAUDE_MODEL);

    const movingAlias = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [KILN_LIVE_CLAUDE_TESTS_ENV]: "1",
      [KILN_LIVE_CLAUDE_MODEL]: "default",
    });
    expect(movingAlias.ok).toBe(false);
    expect(movingAlias.message).toContain("exact Claude catalog model");

    const exact = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [KILN_LIVE_CLAUDE_TESTS_ENV]: "1",
      [KILN_LIVE_CLAUDE_MODEL]: "claude-sonnet-5",
    });
    expect(exact.ok).toBe(true);
  });

  it.each([
    [KILN_LIVE_CODEX_TESTS_ENV, KILN_LIVE_CODEX_MODEL, "gpt-5.6-sol"],
    [KILN_LIVE_OPENCODE_TESTS_ENV, KILN_LIVE_OPENCODE_MODEL, "opencode/minimax-m2.7-free"],
    [KILN_LIVE_OPENAI_DIRECT_TESTS_ENV, KILN_LIVE_OPENAI_DIRECT_MODEL, "gpt-4o-mini"],
    [KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV, KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL, "gpt-5.5"],
    [KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV, KILN_LIVE_CODEX_OAUTH_DIRECT_MODEL, "gpt-5.5"],
  ])("requires an explicit model for %s instead of inventing a live-proof default", (
    providerFlag,
    modelVariable,
    exactModel,
  ) => {
    const missing = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [providerFlag]: "1",
    });
    expect(missing.ok).toBe(false);
    expect(missing.message).toContain(modelVariable);

    const exact = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [providerFlag]: "1",
      [modelVariable]: exactModel,
    });
    expect(exact.ok).toBe(true);
  });

  it("requires the OpenCode write subproof to declare the base authority and model", () => {
    const model = "opencode/minimax-m2.7-free";
    const subproofOnly = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV]: "1",
      [KILN_LIVE_OPENCODE_MODEL]: model,
    });
    expect(subproofOnly.ok).toBe(false);
    expect(subproofOnly.message).toContain(KILN_LIVE_OPENCODE_TESTS_ENV);

    const missingModel = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [KILN_LIVE_OPENCODE_TESTS_ENV]: "1",
      [KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV]: "1",
    });
    expect(missingModel.ok).toBe(false);
    expect(missingModel.message).toContain(KILN_LIVE_OPENCODE_MODEL);

    const admitted = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [KILN_LIVE_OPENCODE_TESTS_ENV]: "1",
      [KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV]: "1",
      [KILN_LIVE_OPENCODE_MODEL]: model,
    });
    expect(admitted.ok).toBe(true);
    expect(admitted.enabledProviders).toEqual([
      KILN_LIVE_OPENCODE_TESTS_ENV,
      KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV,
    ]);
  });

  it.each([
    [KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_TESTS_ENV, KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_ROUTE_ENV, "opencode-go"],
    [KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS_ENV, KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_ROUTE_ENV, "codex-oauth"],
  ])("requires an explicit route for %s", (providerFlag, routeVariable, route) => {
    const missing = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [providerFlag]: "1",
    });
    expect(missing.ok).toBe(false);
    expect(missing.message).toContain(routeVariable);

    const admitted = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [providerFlag]: "1",
      [routeVariable]: route,
    });
    expect(admitted.ok).toBe(true);
  });

  it("does not echo model or route values in preflight messages", () => {
    const model = "sk-proj-operator-secret-value";
    const route = "account-subscription-secret-value";
    const result = evaluateManagedAgentLivePreflight({
      [KILN_LIVE_MANAGED_AGENT_TESTS_ENV]: "1",
      [KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV]: "1",
      [KILN_LIVE_OPENCODE_MODEL]: model,
      [KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_TESTS_ENV]: "1",
      [KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_ROUTE_ENV]: route,
    });

    expect(result.ok).toBe(false);
    expect(result.message).not.toContain(model);
    expect(result.message).not.toContain(route);
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
