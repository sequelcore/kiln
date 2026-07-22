import { describe, expect, it } from "vitest";
import type { ModelGatewayConfig } from "@kilnai/core";
import {
  buildCodexResponsesProjection,
  buildOpenCodeResponsesProjection,
  resolveResponsesNativeProjectionSource,
} from "../../src/config/model-gateway-native-projection.js";

function config(principals: ModelGatewayConfig["openAIResponses"]["principals"]): ModelGatewayConfig {
  return {
    port: 4910,
    accounts: [{ id: "account", providerId: "codex-oauth", credentialId: "credential", maxConcurrency: 1, reservedAffinitySlots: 0 }],
    openAIResponses: {
      enabled: true,
      maxBodyBytes: 1024,
      maxConcurrentRequests: 1,
      replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: "REPLAY_KEY" },
      principals,
      virtualModels: [
        { id: "model-a", displayName: "Model A", contextTokens: 200000, outputTokens: 8192, baseInstructions: "Governed model A instructions.", providerId: "codex-oauth", providerModelId: "upstream-a", accountIds: ["account"], capabilities: ["text", "parallel-tool-calls", "input-image-url"], affinity: { continuity: "none" } },
        { id: "model-b", displayName: "Model B", contextTokens: 100000, outputTokens: 4096, baseInstructions: "Governed model B instructions.", providerId: "codex-oauth", providerModelId: "upstream-b", accountIds: ["account"], capabilities: ["text"], affinity: { continuity: "none" } },
      ],
    },
  };
}

const principal = (nativeHarness: "codex" | "opencode", models = ["model-a"]): ModelGatewayConfig["openAIResponses"]["principals"][number] => ({
  tokenEnv: `${nativeHarness.toUpperCase()}_TOKEN`, tenantId: "tenant", applicationId: nativeHarness,
  callerId: "caller", capabilityId: "invoke", scopes: ["model.invoke"], budgetEvidenceId: "budget",
  virtualModelIds: models, nativeHarness,
});

describe("model gateway native projections", () => {
  it("builds a secret-free Codex Responses provider and official static model catalog", () => {
    const projected = buildCodexResponsesProjection({ config: config([principal("codex")]), modelCatalogPath: "C:/project/.kiln/projections/codex-model-catalog.json" });
    expect(projected?.patch).toMatchObject({
      model: "model-a", model_provider: "kiln", model_catalog_json: "C:/project/.kiln/projections/codex-model-catalog.json",
      model_providers: { kiln: { base_url: "http://127.0.0.1:4910/v1", env_key: "CODEX_TOKEN", wire_api: "responses", request_max_retries: 0, stream_max_retries: 0, supports_websockets: false, requires_openai_auth: false } },
    });
    expect(JSON.stringify(projected)).not.toContain("Bearer");
    expect(projected?.catalog.models).toEqual([expect.objectContaining({
      slug: "model-a", display_name: "Model A", context_window: 200000,
      base_instructions: "Governed model A instructions.", visibility: "list", supported_in_api: true,
      supports_parallel_tool_calls: true, input_modalities: ["text", "image"],
    })]);
  });

  it("builds an OpenCode Responses provider while preserving enabled providers", () => {
    const projected = buildOpenCodeResponsesProjection({ config: config([principal("opencode")]), existingEnabledProviders: ["anthropic"] });
    expect(projected?.patch).toEqual({
      provider: { kiln: { npm: "@ai-sdk/openai", name: "Kiln", options: { baseURL: "http://127.0.0.1:4910/v1", apiKey: "{env:OPENCODE_TOKEN}" }, models: { "model-a": { name: "Model A", limit: { context: 200000, output: 8192 } } } } },
      enabled_providers: ["anthropic", "kiln"],
      model: "kiln/model-a",
    });
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

  it("requires canonical base instructions only at the Codex projection boundary", () => {
    const withoutInstructions = config([principal("codex")]);
    const model = withoutInstructions.openAIResponses.virtualModels[0]!;
    const invalid = { ...withoutInstructions, openAIResponses: { ...withoutInstructions.openAIResponses, virtualModels: [{ ...model, baseInstructions: undefined }] } };
    expect(() => buildCodexResponsesProjection({ config: invalid, modelCatalogPath: "C:/catalog.json" })).toThrow("base instructions");
    const openCodeOnly = { ...invalid, openAIResponses: { ...invalid.openAIResponses, principals: [principal("opencode")] } };
    expect(buildOpenCodeResponsesProjection({ config: openCodeOnly })).toBeDefined();
  });
});
