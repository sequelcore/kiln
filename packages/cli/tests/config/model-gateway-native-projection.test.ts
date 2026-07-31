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
    accounts: [{
      id: "account",
      providerId: "codex-oauth",
      credentialId: "credential",
      maxConcurrency: 1,
      reservedAffinitySlots: 0,
      economics: {
        capacityIdentity: "private-capacity-identity",
        subscriptionClass: "subscription",
        quotaClassId: "private-quota-class",
        creditPosture: "disabled",
        overagePosture: "disabled",
      },
    }],
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
          providerId: "codex-oauth",
          providerModelId: "upstream-a",
          accountIds: ["account"],
          capabilities: ["text", "parallel-tool-calls", "input-image-url"],
          affinity: { continuity: "none" },
          economics: {
            adapterCapabilityId: "codex-direct",
            adapterCapabilityVersion: "v1",
            authBillingChannel: "private-billing-channel",
            executionMode: "responses-api",
            serviceTier: "standard",
            rateCardBasis: "private-rate-card-basis",
            envelopeSemantics: "configured-upper-bound",
            fallbackPosture: "disabled",
            overagePosture: "disabled",
            contextClass: "standard-context",
            cacheClass: "provider-cache",
            priceEvidence: {
              kind: "subscription",
              rateCardId: "private-rate-card",
              rateCardRevision: "rev-1",
              evidence: {
                sourceIdentity: "configured-pricing",
                sourceRevision: "rev-1",
                sourceDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                observedAt: "2026-07-29T00:00:00.000Z",
                validUntil: "2026-08-29T00:00:00.000Z",
                confidence: "high",
                authority: "configured",
              },
            },
            auxiliaryCharges: [],
            executionEnvelope: {
              limits: [{ atoms: "1", scale: 0, unit: "request", scheme: { kind: "unit" } }],
            },
          },
        },
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
  it("adds a secret-free Codex Responses provider without taking ownership of the native picker", () => {
    const projected = buildCodexResponsesProjection({ config: config([principal("codex")]), modelCatalogPath: "C:/project/.kiln/projections/codex-model-catalog.json" });
    expect(projected?.patch).toMatchObject({
      model_providers: { kiln: { base_url: "http://127.0.0.1:4910/v1", env_key: "CODEX_TOKEN", wire_api: "responses", request_max_retries: 0, stream_max_retries: 0, supports_websockets: false, requires_openai_auth: false } },
    });
    expect(projected?.patch).not.toHaveProperty("model");
    expect(projected?.patch).not.toHaveProperty("model_provider");
    expect(projected?.patch).not.toHaveProperty("model_catalog_json");
    expect(projected?.patch).not.toHaveProperty("web_search");
    expect(projected?.managedFields).toEqual(["model_providers.kiln"]);
    expect(projected).not.toHaveProperty("catalog");
    expect(JSON.stringify(projected)).not.toContain("Bearer");
    expect(JSON.stringify(projected)).not.toContain("private-capacity-identity");
    expect(JSON.stringify(projected)).not.toContain("private-rate-card");
    expect(JSON.stringify(projected)).not.toContain("private-billing-channel");
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
    expect(projected?.patch).toHaveProperty("model_providers.kiln");
    expect(JSON.stringify(projected)).not.toContain("credential-a");
    expect(JSON.stringify(projected)).not.toContain("opencode-go");
  });

  it("adds an OpenCode Responses provider without synthesizing the native allowlist or default", () => {
    const projected = buildOpenCodeResponsesProjection({ config: config([principal("opencode")]), existingEnabledProviders: ["anthropic"] });
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

  it("does not project a principal assigned to an unsupported ingress", () => {
    const invalidIngress = { ...principal("codex"), ingress: "anthropic-messages" as never };
    expect(resolveResponsesNativeProjectionSource(config([invalidIngress]), "codex")).toBeUndefined();
  });

  it("does not require catalog-only base instructions when adding the Codex provider", () => {
    const withoutInstructions = config([principal("codex")]);
    const model = withoutInstructions.virtualModels[0]!;
    const invalid = { ...withoutInstructions, virtualModels: [{ ...model, baseInstructions: undefined }] };
    expect(buildCodexResponsesProjection({ config: invalid, modelCatalogPath: "C:/catalog.json" })).toBeDefined();
    const openCodeOnly = { ...invalid, principals: [principal("opencode")] };
    expect(buildOpenCodeResponsesProjection({ config: openCodeOnly })).toBeDefined();
  });
});
