import { describe, expect, it } from "vitest";
import type { GatewayAppBinding, GatewayChannelBinding, GatewayConfig } from "../../../src/engine/gateway/gateway-config.js";
import { validateGatewayConfig } from "../../../src/engine/gateway/gateway-config.js";
import { parseGatewayYaml } from "../../../src/engine/gateway/gateway-loader.js";

function makeChannelBinding(overrides: Partial<GatewayChannelBinding> = {}): GatewayChannelBinding {
  return { type: "api", path: "/api/test", ...overrides };
}

function makeAppBinding(overrides: Partial<GatewayAppBinding> = {}): GatewayAppBinding {
  return {
    name: "test-app",
    config: "apps/test.yaml",
    channels: [makeChannelBinding()],
    ...overrides,
  };
}

function makeConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    port: 4800,
    apps: [makeAppBinding()],
    ...overrides,
  };
}

const overlayGatewayYaml = `
port: 4800
apps: []
modelGateway:
  port: 4801
  replay: { ttlMs: 300000, maxEntries: 1000, hmacKeyEnv: KILN_REPLAY_KEY }
  surfaces:
    openAIResponses: { maxBodyBytes: 1048576, maxConcurrentRequests: 4 }
  principals:
    - { tokenEnv: TOKEN_ENV, ingress: openai-responses, tenantId: tenant, applicationId: app, callerId: caller, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: budget, virtualModelIds: [codex] }
  virtualModels:
    - id: codex
      displayName: Kiln Codex
      contextTokens: 200000
      outputTokens: 10000
      baseInstructions: You are a governed Kiln coding agent.
      executionRouteId: codex-standard
      capabilities: [text, function-tools]
      affinity: { continuity: none }
`;

describe("GatewayConfig model gateway overlay", () => {
  it("parses ingress metadata with only a canonical execution route reference", () => {
    const parsed = parseGatewayYaml(overlayGatewayYaml).modelGateway;

    expect(parsed).toMatchObject({
      port: 4801,
      surfaces: { openAIResponses: { maxConcurrentRequests: 4 } },
      virtualModels: [{
        id: "codex",
        executionRouteId: "codex-standard",
        capabilities: ["text", "function-tools"],
      }],
    });
    expect(parsed && "accounts" in parsed).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain("providerModelId");
  });

  it("rejects composite-only queue settings from shared HTTP surfaces", () => {
    const yaml = overlayGatewayYaml.replace("maxConcurrentRequests: 4", "maxConcurrentRequests: 4, maxQueuedRequests: 8");
    expect(() => parseGatewayYaml(yaml)).toThrow(/maxQueuedRequests/);
  });

  it.each([
    ["modelGateway.accounts", "  accounts: []\n"],
    ["virtual model providerModelId", "      providerModelId: gpt-5.6-codex\n"],
    ["virtual model accountIds", "      accountIds: [account-a]\n"],
    ["virtual model economics", "      economics: { adapterCapabilityId: duplicate-owner }\n"],
  ])("rejects duplicate Gateway ownership: %s", (_label, fragment) => {
    const yaml = fragment.startsWith("  accounts")
      ? overlayGatewayYaml.replace("  replay:", fragment + "  replay:")
      : overlayGatewayYaml.replace("      executionRouteId:", fragment + "      executionRouteId:");
    expect(() => parseGatewayYaml(yaml)).toThrow(/not supported/);
  });

  it("fails closed when the execution route reference is missing or non-canonical", () => {
    expect(() => parseGatewayYaml(overlayGatewayYaml.replace("executionRouteId: codex-standard", "executionRouteId: \"\""))).toThrow(/executionRouteId/);
    expect(() => parseGatewayYaml(overlayGatewayYaml.replace("executionRouteId: codex-standard", "executionRouteId: route with spaces"))).toThrow(/executionRouteId/);
  });

  it("rejects duplicate ownership in programmatic configs as well as YAML", () => {
    const parsed = parseGatewayYaml(overlayGatewayYaml);
    const legacy = structuredClone(parsed) as Record<string, any>;
    legacy.modelGateway.accounts = [];
    legacy.modelGateway.virtualModels[0].providerModelId = "upstream";
    const errors = validateGatewayConfig(legacy);
    expect(errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "modelGateway.accounts" }),
      expect.objectContaining({ field: "modelGateway.virtualModels[0].providerModelId" }),
    ]));
  });

  it("retains native-harness metadata, deliberation, and affinity as ingress concerns", () => {
    const yaml = overlayGatewayYaml
      .replace("capabilities: [text, function-tools]", "capabilities: [text, reasoning-controls]")
      .replace("affinity: { continuity: none }", "affinity: { continuity: prefer, scope: session, allowRebind: true }\n      deliberation: { levels: [low, high], defaultLevel: high, supportsAdaptive: true, evidenceRevision: rev-1 }")
      .replace("virtualModelIds: [codex]", "virtualModelIds: [codex], nativeHarness: codex")
      .replace("  surfaces:", "  codexComposite: { maxQueuedRequests: 8, queueTimeoutMs: 30000 }\n  surfaces:");
    expect(parseGatewayYaml(yaml).modelGateway).toMatchObject({
      codexComposite: { maxQueuedRequests: 8, queueTimeoutMs: 30000 },
      principals: [{ nativeHarness: "codex" }],
      virtualModels: [{
        executionRouteId: "codex-standard",
        deliberation: { levels: ["low", "high"], defaultLevel: "high" },
        affinity: { continuity: "prefer", scope: "session", allowRebind: true },
      }],
    });
  });

  it("requires queue policy only for a native Codex composite", () => {
    const codex = overlayGatewayYaml.replace("virtualModelIds: [codex]", "virtualModelIds: [codex], nativeHarness: codex");
    expect(() => parseGatewayYaml(codex)).toThrow(/codexComposite/);
    const nonCodex = overlayGatewayYaml.replace("  surfaces:", "  codexComposite: { maxQueuedRequests: 8, queueTimeoutMs: 30000 }\n  surfaces:");
    expect(() => parseGatewayYaml(nonCodex)).toThrow(/codexComposite/);
  });

  it("supports a standalone overlay and rejects unknown or unpreserved fields", () => {
    expect(parseGatewayYaml(overlayGatewayYaml).apps).toEqual([]);
    expect(() => parseGatewayYaml(overlayGatewayYaml.replace("capabilities: [text, function-tools]", "capabilities: [text, no-such-capability]"))).toThrow(/capabilities/);
    expect(() => parseGatewayYaml(`${overlayGatewayYaml}\nmodelGatway: {}`)).toThrow(/modelGatway/);
    expect(() => parseGatewayYaml(overlayGatewayYaml.replace("virtualModelIds: [codex]", "virtualModelIds: [unknown]"))).toThrow(/virtualModelIds/);
  });
});

describe("validateGatewayConfig", () => {
  it("returns empty array for a valid config", () => {
    expect(validateGatewayConfig(makeConfig())).toEqual([]);
  });

  it("accepts multiple valid apps with distinct names", () => {
    const config = makeConfig({
      apps: [
        makeAppBinding({ name: "app-a", channels: [{ type: "api", path: "/api/a" }] }),
        makeAppBinding({ name: "app-b", channels: [{ type: "whatsapp", phoneNumber: "+521234567890" }] }),
      ],
    });
    expect(validateGatewayConfig(config)).toEqual([]);
  });

  it("reports error for empty apps without a model gateway", () => {
    const errors = validateGatewayConfig(makeConfig({ apps: [] }));
    expect(errors.some((e) => e.field === "apps")).toBe(true);
  });

  it("reports duplicate app names, API paths, and phone numbers", () => {
    const config = makeConfig({
      apps: [
        makeAppBinding({ name: "duplicate", channels: [{ type: "api", path: "/api/shared", phoneNumber: "+521234567890" }] }),
        makeAppBinding({ name: "duplicate", channels: [{ type: "whatsapp", phoneNumber: "+521234567890" }] }),
        makeAppBinding({ name: "other", channels: [{ type: "api", path: "/api/shared" }] }),
      ],
    });
    const errors = validateGatewayConfig(config);
    expect(errors.some((e) => e.message.includes("duplicate"))).toBe(true);
    expect(errors.some((e) => e.message.includes("/api/shared"))).toBe(true);
    expect(errors.some((e) => e.message.includes("+521234567890"))).toBe(true);
  });

  it("reports invalid ports and accumulates app errors", () => {
    const config: GatewayConfig = {
      port: 0,
      apps: [
        { name: "", config: "", channels: [] },
        { name: "same", config: "a.yaml", channels: [{ type: "web" }] },
        { name: "same", config: "b.yaml", channels: [{ type: "api", path: "/shared" }] },
      ],
    };
    const errors = validateGatewayConfig(config);
    expect(errors.some((e) => e.field === "port")).toBe(true);
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });
});
