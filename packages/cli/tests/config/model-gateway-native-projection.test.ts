import { describe, expect, it } from "vitest";
import type { ModelGatewayConfig } from "@kilnai/core/engine";
import {
  buildClaudeMessagesProjection,
  buildOpenCodeResponsesProjection,
  resolveClaudeMessagesNativeProjectionSource,
  resolveResponsesNativeProjectionSource,
} from "../../src/config/model-gateway-native-projection.js";

function config(principals: ModelGatewayConfig["principals"]): ModelGatewayConfig {
  const hasResponses = principals.some((candidate) => candidate.ingress === "openai-responses");
  const hasMessages = principals.some((candidate) => candidate.ingress === "anthropic-messages");
  return {
    port: 4910,
    replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: "REPLAY_KEY" },
    surfaces: {
      ...(hasResponses ? { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } } : {}),
      ...(hasMessages ? { anthropicMessages: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } } : {}),
    },
    principals,
    virtualModels: [
        {
          id: "model-a",
          displayName: "Model A",
          contextTokens: 200000,
          outputTokens: 8192,
          baseInstructions: "Governed model A instructions.",
          targetId: "model-a-route",
          capabilities: ["text", "parallel-tool-calls", "input-image-url"],
          affinity: { continuity: "none" },
        },
        { id: "model-b", displayName: "Model B", contextTokens: 100000, outputTokens: 4096, baseInstructions: "Governed model B instructions.", targetId: "model-b-route", capabilities: ["text"], affinity: { continuity: "none" } },
    ],
  };
}

const principal = (nativeHarness: "codex" | "opencode", models = ["model-a"]): ModelGatewayConfig["principals"][number] => ({
  tokenEnv: `${nativeHarness.toUpperCase()}_TOKEN`, ingress: "openai-responses", tenantId: "tenant", applicationId: nativeHarness,
  callerId: "caller", capabilityId: "invoke", scopes: ["model.invoke"], budgetEvidenceId: "budget",
  virtualModelIds: models, nativeHarness,
});

const claudePrincipal = (tokenEnv = "ANTHROPIC_AUTH_TOKEN", models = ["model-a"]): ModelGatewayConfig["principals"][number] => ({
  tokenEnv, ingress: "anthropic-messages", tenantId: "tenant", applicationId: "claude",
  callerId: "caller", capabilityId: "invoke", scopes: ["model.invoke"], budgetEvidenceId: "budget",
  virtualModelIds: models, nativeHarness: "claude",
});

function claudeConfig(tokenEnv = "ANTHROPIC_AUTH_TOKEN", modelIds = ["claude-model-a"]): ModelGatewayConfig {
  const configured = config([claudePrincipal(tokenEnv, modelIds)]);
  return {
    ...configured,
    virtualModels: configured.virtualModels.slice(0, modelIds.length).map((model, index) => ({ ...model, id: modelIds[index]! })),
  };
}

describe("model gateway native projections", () => {
  it("adds an OpenCode Responses provider without synthesizing the native allowlist or default", () => {
    const projected = buildOpenCodeResponsesProjection({ config: config([principal("opencode")]) });
    expect(projected?.patch).toEqual({
      provider: { kiln: { npm: "@ai-sdk/openai", name: "Kiln", options: { baseURL: "http://127.0.0.1:4910/v1", apiKey: "{env:OPENCODE_TOKEN}" }, models: { "model-a": { name: "Model A", limit: { context: 200000, output: 8192 } } } } },
    });
    expect(projected?.managedFields).toEqual(["provider.kiln"]);
  });

  it("builds a secret-free Claude Messages gateway projection with granular managed env paths", () => {
    const projected = buildClaudeMessagesProjection({ config: claudeConfig() });

    expect(projected?.patch).toEqual({
      env: {
        ANTHROPIC_BASE_URL: "http://127.0.0.1:4910",
        CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
        CLAUDE_CODE_ATTRIBUTION_HEADER: "0",
        CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
        CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "1",
        CLAUDE_CODE_DISABLE_THINKING: "1",
        CLAUDE_CODE_MAX_RETRIES: "0",
        MAX_THINKING_TOKENS: "0",
        DISABLE_INTERLEAVED_THINKING: "1",
        DISABLE_PROMPT_CACHING: "1",
      },
      model: "claude-model-a",
    });
    expect(projected?.managedFields).toEqual([
      "env.ANTHROPIC_BASE_URL",
      "env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY",
      "env.CLAUDE_CODE_ATTRIBUTION_HEADER",
      "env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS",
      "env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING",
      "env.CLAUDE_CODE_DISABLE_THINKING",
      "env.CLAUDE_CODE_MAX_RETRIES",
      "env.MAX_THINKING_TOKENS",
      "env.DISABLE_INTERLEAVED_THINKING",
      "env.DISABLE_PROMPT_CACHING",
      "model",
    ]);
    expect(JSON.stringify(projected)).not.toContain("synthetic-live-probe-token");
  });

  it("keeps Claude source resolution separate and fails closed for a nonstandard credential env", () => {
    const configured = claudeConfig();
    expect(resolveClaudeMessagesNativeProjectionSource(configured)?.principal.nativeHarness).toBe("claude");
    expect(resolveResponsesNativeProjectionSource(configured, "codex")).toBeUndefined();
    expect(() => buildClaudeMessagesProjection({ config: claudeConfig("CLAUDE_GATEWAY_TOKEN") }))
      .toThrow("ANTHROPIC_AUTH_TOKEN");
  });

  it("does not pair Claude native projection with the Responses ingress", () => {
    const wrongIngress = { ...claudePrincipal(), ingress: "openai-responses" as const };
    expect(resolveClaudeMessagesNativeProjectionSource(config([wrongIngress]))).toBeUndefined();
  });

  it("does not invent a Claude default when multiple models are equally canonical", () => {
    const projected = buildClaudeMessagesProjection({ config: claudeConfig("ANTHROPIC_AUTH_TOKEN", ["claude-model-a", "anthropic-model-b"]) });
    expect(projected?.patch.model).toBeUndefined();
    expect(projected?.managedFields).not.toContain("model");
  });

  it("fails closed for a Claude model id that discovery cannot expose even without loader validation", () => {
    expect(() => buildClaudeMessagesProjection({ config: config([claudePrincipal()]) }))
      .toThrow("must start with claude or anthropic");
  });

  it("does not invent a default when multiple allowed models are equally canonical", () => {
    const projected = buildOpenCodeResponsesProjection({ config: config([principal("opencode", ["model-a", "model-b"])]) });
    expect(projected?.patch.model).toBeUndefined();
    expect(projected?.managedFields).not.toContain("model");
  });

  it("fails closed for an ambiguous native harness even when called without loader validation", () => {
    expect(() => resolveResponsesNativeProjectionSource(config([principal("codex"), { ...principal("codex"), tokenEnv: "OTHER_TOKEN", applicationId: "other" }]), "codex"))
      .toThrow("multiple codex");
  });

  it.each([
    ["codex", () => resolveResponsesNativeProjectionSource(config([principal("codex", [])]), "codex")],
    ["opencode", () => resolveResponsesNativeProjectionSource(config([principal("opencode", [])]), "opencode")],
    ["claude", () => resolveClaudeMessagesNativeProjectionSource(claudeConfig("ANTHROPIC_AUTH_TOKEN", []))],
  ])("fails closed for an empty %s native harness model allowlist without loader validation", (harness, resolve) => {
    expect(resolve).toThrow(`${harness} native harness principal must reference at least one virtual model.`);
  });

  it.each([
    ["codex", () => resolveResponsesNativeProjectionSource(config([principal("codex", ["model-a", "model-a"])]), "codex")],
    ["opencode", () => resolveResponsesNativeProjectionSource(config([principal("opencode", ["model-a", "model-a"])]), "opencode")],
    ["claude", () => resolveClaudeMessagesNativeProjectionSource(claudeConfig("ANTHROPIC_AUTH_TOKEN", ["claude-model-a", "claude-model-a"]))],
  ])("fails closed when a %s native harness principal repeats a virtual model id", (harness, resolve) => {
    expect(resolve).toThrow(`${harness} native harness principal repeats virtual model id`);
  });

  it.each([
    ["codex", () => resolveResponsesNativeProjectionSource(withDuplicateModel(config([principal("codex")])), "codex")],
    ["opencode", () => resolveResponsesNativeProjectionSource(withDuplicateModel(config([principal("opencode")])), "opencode")],
    ["claude", () => resolveClaudeMessagesNativeProjectionSource(withDuplicateModel(claudeConfig()))],
  ])("fails closed when a %s native harness references duplicate virtual model definitions", (harness, resolve) => {
    expect(resolve).toThrow(`${harness} native harness references duplicate virtual model definitions`);
  });

  it("does not project a principal assigned to an unsupported ingress", () => {
    const invalidIngress = { ...principal("codex"), ingress: "anthropic-messages" as never };
    expect(resolveResponsesNativeProjectionSource(config([invalidIngress]), "codex")).toBeUndefined();
  });

  it("does not require Codex-only instructions for an OpenCode projection", () => {
    const configured = config([principal("opencode")]);
    const model = configured.virtualModels[0]!;
    const openCodeOnly = { ...configured, virtualModels: [{ ...model, baseInstructions: undefined }] };
    expect(buildOpenCodeResponsesProjection({ config: openCodeOnly })).toBeDefined();
  });
});

function withDuplicateModel(configured: ModelGatewayConfig): ModelGatewayConfig {
  return { ...configured, virtualModels: [...configured.virtualModels, { ...configured.virtualModels[0]! }] };
}
