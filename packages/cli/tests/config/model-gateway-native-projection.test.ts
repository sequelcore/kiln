import { describe, expect, it } from "vitest";
import type { ModelGatewayConfig } from "@kilnai/core";
import {
  buildClaudeMessagesProjection,
  buildCodexResponsesProjection,
  buildOpenCodeResponsesProjection,
  resolveClaudeMessagesNativeProjectionSource,
  resolveResponsesNativeProjectionSource,
} from "../../src/config/model-gateway-native-projection.js";

function config(principals: ModelGatewayConfig["principals"]): ModelGatewayConfig {
  const hasResponses = principals.some((candidate) => candidate.ingress === "openai-responses");
  const hasMessages = principals.some((candidate) => candidate.ingress === "anthropic-messages");
  return {
    port: 4910,
    accounts: [{ id: "account", providerId: "codex-oauth", credentialId: "credential", maxConcurrency: 1, reservedAffinitySlots: 0 }],
    replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: "REPLAY_KEY" },
    surfaces: {
      ...(hasResponses ? { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } } : {}),
      ...(hasMessages ? { anthropicMessages: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } } : {}),
    },
    principals,
    virtualModels: [
        { id: "model-a", displayName: "Model A", contextTokens: 200000, outputTokens: 8192, baseInstructions: "Governed model A instructions.", providerId: "codex-oauth", providerModelId: "upstream-a", accountIds: ["account"], capabilities: ["text", "parallel-tool-calls", "input-image-url"], affinity: { continuity: "none" } },
        { id: "model-b", displayName: "Model B", contextTokens: 100000, outputTokens: 4096, baseInstructions: "Governed model B instructions.", providerId: "codex-oauth", providerModelId: "upstream-b", accountIds: ["account"], capabilities: ["text"], affinity: { continuity: "none" } },
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
  it("builds a secret-free Codex Responses provider and official static model catalog", () => {
    const projected = buildCodexResponsesProjection({ config: config([principal("codex")]), modelCatalogPath: "C:/project/.kiln/projections/codex-model-catalog.json" });
    expect(projected?.patch).toMatchObject({
      model: "model-a", model_provider: "kiln", model_catalog_json: "C:/project/.kiln/projections/codex-model-catalog.json", web_search: "disabled",
      model_providers: { kiln: { base_url: "http://127.0.0.1:4910/v1", env_key: "CODEX_TOKEN", wire_api: "responses", request_max_retries: 0, stream_max_retries: 0, supports_websockets: false, requires_openai_auth: false } },
    });
    expect(JSON.stringify(projected)).not.toContain("Bearer");
    expect(projected?.catalog.models).toEqual([expect.objectContaining({
      slug: "model-a", display_name: "Model A", context_window: 200000,
      base_instructions: "Governed model A instructions.", visibility: "list", supported_in_api: true,
      supports_parallel_tool_calls: true, input_modalities: ["text", "image"],
    })]);
  });

  it("projects an OpenCode-backed virtual model into Codex without exposing upstream credentials", () => {
    const configured = config([principal("codex")]);
    const crossProvider: ModelGatewayConfig = {
      ...configured,
      accounts: [
        { id: "go-a", providerId: "opencode-go", credentialId: "credential-a", maxConcurrency: 1, reservedAffinitySlots: 0 },
        { id: "go-b", providerId: "opencode-go", credentialId: "credential-b", maxConcurrency: 1, reservedAffinitySlots: 0 },
      ],
      virtualModels: configured.virtualModels.map((model) => ({
        ...model,
        providerId: "opencode-go" as const,
        accountIds: ["go-a", "go-b"],
        capabilities: ["text", "function-tools"] as const,
      })),
    };

    const projected = buildCodexResponsesProjection({ config: crossProvider, modelCatalogPath: "C:/catalog.json" });
    expect(projected?.catalog.models[0]).toMatchObject({ slug: "model-a", display_name: "Model A" });
    expect(JSON.stringify(projected)).not.toContain("credential-a");
    expect(JSON.stringify(projected)).not.toContain("opencode-go");
  });

  it("builds an OpenCode Responses provider while preserving enabled providers", () => {
    const projected = buildOpenCodeResponsesProjection({ config: config([principal("opencode")]), existingEnabledProviders: ["anthropic"] });
    expect(projected?.patch).toEqual({
      provider: { kiln: { npm: "@ai-sdk/openai", name: "Kiln", options: { baseURL: "http://127.0.0.1:4910/v1", apiKey: "{env:OPENCODE_TOKEN}" }, models: { "model-a": { name: "Model A", limit: { context: 200000, output: 8192 } } } } },
      enabled_providers: ["anthropic", "kiln"],
      model: "kiln/model-a",
    });
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

  it("does not project a principal assigned to an unsupported ingress", () => {
    const invalidIngress = { ...principal("codex"), ingress: "anthropic-messages" as never };
    expect(resolveResponsesNativeProjectionSource(config([invalidIngress]), "codex")).toBeUndefined();
  });

  it("requires canonical base instructions only at the Codex projection boundary", () => {
    const withoutInstructions = config([principal("codex")]);
    const model = withoutInstructions.virtualModels[0]!;
    const invalid = { ...withoutInstructions, virtualModels: [{ ...model, baseInstructions: undefined }] };
    expect(() => buildCodexResponsesProjection({ config: invalid, modelCatalogPath: "C:/catalog.json" })).toThrow("base instructions");
    const openCodeOnly = { ...invalid, principals: [principal("opencode")] };
    expect(buildOpenCodeResponsesProjection({ config: openCodeOnly })).toBeDefined();
  });
});
