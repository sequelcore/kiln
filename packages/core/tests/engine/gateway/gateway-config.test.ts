import { describe, it, expect } from "vitest";
import type { GatewayConfig, GatewayAppBinding, GatewayChannelBinding } from "../../../src/engine/gateway/gateway-config.js";
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

describe("GatewayConfig", () => {
  it("parses an explicit secret-free model gateway surface", () => {
    const parsed = parseGatewayYaml(`
port: 4800
apps:
  - name: app-a
    config: apps/a.yaml
    channels: [{ type: api, path: /api/a }]
modelGateway:
  port: 4801
  accounts:
    - { id: account-a, providerId: codex-oauth, credentialId: credential-a, maxConcurrency: 2, reservedAffinitySlots: 1 }
  replay: { ttlMs: 300000, maxEntries: 1000, hmacKeyEnv: KILN_REPLAY_KEY }
  surfaces:
    openAIResponses: { maxBodyBytes: 1048576, maxConcurrentRequests: 4 }
  principals:
      - tokenEnv: KILN_RESPONSES_TOKEN
        ingress: openai-responses
        tenantId: tenant-a
        applicationId: app-a
        callerId: caller-a
        capabilityId: model-invoke
        scopes: [model.invoke]
        budgetEvidenceId: budget-a
        virtualModelIds: [codex]
        nativeHarness: codex
  virtualModels:
      - id: codex
        displayName: Kiln Codex
        contextTokens: 200000
        outputTokens: 10000
        baseInstructions: You are a governed Kiln coding agent.
        providerId: codex-oauth
        providerModelId: gpt-5.6-codex
        accountIds: [account-a]
        capabilities: [text, function-tools]
        affinity: { continuity: prefer, scope: session, allowRebind: true }
`);
    expect(parsed.modelGateway).toMatchObject({
      replay: { hmacKeyEnv: "KILN_REPLAY_KEY" },
      principals: [{ tokenEnv: "KILN_RESPONSES_TOKEN", applicationId: "app-a", nativeHarness: "codex" }],
      virtualModels: [{ displayName: "Kiln Codex", contextTokens: 200000, outputTokens: 10000, providerId: "codex-oauth", accountIds: ["account-a"], affinity: { scope: "session" } }],
    });
    expect(JSON.stringify(parsed)).not.toContain("secret-value");
  });

  it("supports a standalone model gateway and rejects unknown root keys or unpreserved capabilities", () => {
    const standalone = `port: 4800
apps: []
modelGateway:
  port: 4801
  accounts:
    - { id: account, providerId: codex-oauth, credentialId: credential, maxConcurrency: 1, reservedAffinitySlots: 0 }
  replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: REPLAY_KEY }
  surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 2 } }
  principals:
      - { tokenEnv: TOKEN_ENV, ingress: openai-responses, tenantId: tenant, applicationId: standalone-app, callerId: caller, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: budget, virtualModelIds: [model] }
  virtualModels:
      - { id: model, displayName: Model, contextTokens: 1000, outputTokens: 100, providerId: codex-oauth, providerModelId: provider-model, accountIds: [account], capabilities: [text], affinity: { continuity: none } }
`;
    expect(parseGatewayYaml(standalone).apps).toEqual([]);
    expect(() => parseGatewayYaml(standalone.replace("displayName: Model, contextTokens: 1000, outputTokens: 100, ", ""))).not.toThrow();
    expect(parseGatewayYaml(standalone.replace("apps: []\n", "")).apps).toEqual([]);
    for (const malformed of ["{}", "null", "standalone"]) {
      expect(() => parseGatewayYaml(standalone.replace("apps: []", `apps: ${malformed}`))).toThrow(/apps/);
    }
    expect(() => parseGatewayYaml(`${standalone}\nmodelGatway: {}`)).toThrow(/modelGatway/);
    expect(() => parseGatewayYaml(standalone.replace("capabilities: [text]", "capabilities: [text, reasoning-encrypted-content]")))
      .toThrow(/capabilities/);
    expect(() => parseGatewayYaml(standalone.replace("virtualModelIds: [model]", "virtualModelIds: [unknown]")))
      .toThrow(/virtualModelIds/);
    expect(() => parseGatewayYaml(standalone
      .replace("accounts:\n    - { id: account", "accounts:\n    - { id: account-2, providerId: codex-oauth, credentialId: credential-2, maxConcurrency: 1, reservedAffinitySlots: 0 }\n    - { id: account")
      .replace("accountIds: [account]", "accountIds: [account, account-2]")))
      .not.toThrow();
  });

  it("admits supported direct providers and same-provider account pools", () => {
    const yaml = `port: 4800
apps: []
modelGateway:
  port: 4801
  accounts:
    - { id: kimi-primary, providerId: opencode-go, credentialId: go-primary, maxConcurrency: 2, reservedAffinitySlots: 1 }
    - { id: kimi-secondary, providerId: opencode-go, credentialId: go-secondary, maxConcurrency: 1, reservedAffinitySlots: 0 }
    - { id: claude-primary, providerId: anthropic, credentialId: anthropic-primary, maxConcurrency: 1, reservedAffinitySlots: 0 }
  replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: REPLAY_KEY }
  surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 2 } }
  principals:
    - { tokenEnv: TOKEN_ENV, ingress: openai-responses, tenantId: tenant, applicationId: app, callerId: caller, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: budget, virtualModelIds: [kimi, claude] }
  virtualModels:
    - { id: kimi, providerId: opencode-go, providerModelId: kimi-k3, accountIds: [kimi-primary, kimi-secondary], capabilities: [text], affinity: { continuity: prefer, scope: session, allowRebind: true } }
    - { id: claude, providerId: anthropic, providerModelId: claude-sonnet, accountIds: [claude-primary], capabilities: [text], affinity: { continuity: none } }
`;

    expect(parseGatewayYaml(yaml).modelGateway).toMatchObject({
      accounts: [
        { providerId: "opencode-go" },
        { providerId: "opencode-go" },
        { providerId: "anthropic" },
      ],
      virtualModels: [
        { providerId: "opencode-go", accountIds: ["kimi-primary", "kimi-secondary"] },
        { providerId: "anthropic", accountIds: ["claude-primary"] },
      ],
    });

    expect(() => parseGatewayYaml(yaml.replace("accountIds: [kimi-primary, kimi-secondary]", "accountIds: [kimi-primary, claude-primary]")))
      .toThrow(/belongs to provider 'anthropic'/);
    expect(() => parseGatewayYaml(yaml.replace("providerId: opencode-go", "providerId: unsupported-provider")))
      .toThrow(/supported direct provider/);
    expect(() => parseGatewayYaml(yaml.replace("capabilities: [text]", "capabilities: [text, reasoning-controls]")))
      .toThrow(/opencode-go.*reasoning-controls/);
  });

  it("rejects retired authorities and admits only mounted protocol surfaces", () => {
    const canonical = `port: 4800
apps: []
modelGateway:
  port: 4801
  accounts: [{ id: account, providerId: codex-oauth, credentialId: credential, maxConcurrency: 1, reservedAffinitySlots: 0 }]
  replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: REPLAY_KEY }
  surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } }
  principals: [{ tokenEnv: RESPONSES_TOKEN, ingress: openai-responses, nativeHarness: codex, tenantId: tenant, applicationId: codex-app, callerId: caller, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: budget, virtualModelIds: [model] }]
  virtualModels: [{ id: model, displayName: Model, contextTokens: 1000, outputTokens: 100, providerId: codex-oauth, providerModelId: provider-model, accountIds: [account], capabilities: [text], affinity: { continuity: none } }]
`;
    expect(() => parseGatewayYaml(canonical.replace("surfaces:", "openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 }\n  surfaces:"))).toThrow(/modelGateway\.openAIResponses/);
    expect(() => parseGatewayYaml(canonical.replace("openai-responses", "anthropic-messages"))).toThrow(/requires modelGateway\.surfaces\.anthropicMessages/);
    const claude = canonical
      .replace("openAIResponses", "anthropicMessages")
      .replace("openai-responses", "anthropic-messages")
      .replace("nativeHarness: codex", "nativeHarness: claude")
      .replace("id: model", "id: claude-kiln")
      .replaceAll("[model]", "[claude-kiln]");
    expect(parseGatewayYaml(claude).modelGateway).toMatchObject({
      surfaces: { anthropicMessages: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } },
      principals: [{ ingress: "anthropic-messages", nativeHarness: "claude" }],
    });
    expect(() => parseGatewayYaml(claude.replaceAll("claude-kiln", "model"))).toThrow(/Claude native model ids/);
  });

  it("allows the same trusted identity on distinct ingresses but not twice on one ingress", () => {
    const yaml = `port: 4800
apps: []
modelGateway:
  port: 4801
  accounts: [{ id: account, providerId: codex-oauth, credentialId: credential, maxConcurrency: 1, reservedAffinitySlots: 0 }]
  replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: REPLAY_KEY }
  surfaces:
    openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 }
    anthropicMessages: { maxBodyBytes: 1024, maxConcurrentRequests: 1 }
  principals:
    - { tokenEnv: RESPONSES_TOKEN, ingress: openai-responses, tenantId: tenant, applicationId: app, callerId: caller, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: budget, virtualModelIds: [claude-kiln] }
    - { tokenEnv: ANTHROPIC_TOKEN, ingress: anthropic-messages, tenantId: tenant, applicationId: app, callerId: caller, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: budget, virtualModelIds: [claude-kiln], nativeHarness: claude }
  virtualModels:
    - { id: claude-kiln, displayName: Claude Kiln, contextTokens: 1000, outputTokens: 100, providerId: codex-oauth, providerModelId: upstream, accountIds: [account], capabilities: [text], affinity: { continuity: none } }
`;
    expect(() => parseGatewayYaml(yaml)).not.toThrow();
    expect(() => parseGatewayYaml(yaml.replace("ingress: anthropic-messages", "ingress: openai-responses"))).toThrow(/trusted principal identity must be unique/);
    const withoutAnthropicPrincipal = yaml.replace("    - { tokenEnv: ANTHROPIC_TOKEN, ingress: anthropic-messages, tenantId: tenant, applicationId: app, callerId: caller, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: budget, virtualModelIds: [claude-kiln], nativeHarness: claude }\n", "");
    expect(() => parseGatewayYaml(withoutAnthropicPrincipal)).toThrow(/surfaces\.anthropicMessages.*requires at least one anthropic-messages principal/);
  });

  it("requires unique native harness ownership and complete picker metadata", () => {
    const yaml = `port: 4800
apps: []
modelGateway:
  port: 4801
  accounts:
    - { id: account, providerId: codex-oauth, credentialId: credential, maxConcurrency: 1, reservedAffinitySlots: 0 }
  replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: REPLAY_KEY }
  surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } }
  principals:
      - { tokenEnv: TOKEN_A, ingress: openai-responses, tenantId: tenant, applicationId: a, callerId: a, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: a, virtualModelIds: [model], nativeHarness: codex }
      - { tokenEnv: TOKEN_B, ingress: openai-responses, tenantId: tenant, applicationId: b, callerId: b, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: b, virtualModelIds: [model], nativeHarness: codex }
  virtualModels:
      - { id: model, displayName: Model, contextTokens: 1000, outputTokens: 100, baseInstructions: Governed fixture instructions., providerId: codex-oauth, providerModelId: upstream, accountIds: [account], capabilities: [text], affinity: { continuity: none } }
`;
    expect(() => parseGatewayYaml(yaml)).toThrow(/native harness 'codex' must be unique/);
    const singleWithoutInstructions = yaml
      .replace("      - { tokenEnv: TOKEN_B, ingress: openai-responses, tenantId: tenant, applicationId: b, callerId: b, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: b, virtualModelIds: [model], nativeHarness: codex }\n", "")
      .replace("baseInstructions: Governed fixture instructions., ", "");
    expect(() => parseGatewayYaml(singleWithoutInstructions)).toThrow(/baseInstructions/);
    expect(() => parseGatewayYaml(singleWithoutInstructions.replace("nativeHarness: codex", "nativeHarness: opencode"))).not.toThrow();
    expect(() => parseGatewayYaml(yaml.replace(", nativeHarness: codex }\n      -", " }\n      -").replace(", nativeHarness: codex }\n    virtualModels", " }\n    virtualModels").replace("displayName: Model", "displayName: ''")))
      .toThrow(/displayName/);
  });

  it.each([
    ["unknown field", "extra: true"],
    ["wrong provider", "virtualModels:\n      - id: codex\n        displayName: Codex\n        contextTokens: 1000\n        outputTokens: 100\n        providerId: other\n        providerModelId: model\n        accountIds: [a]\n        capabilities: [text]\n        affinity: { continuity: none }"],
  ])("fails closed for malformed model gateway %s", (_label, fragment) => {
    const yaml = `port: 4800\napps:\n  - name: app-a\n    config: a.yaml\n    channels: [{type: api}]\nmodelGateway:\n  port: 4801\n  accounts:\n    - {id: a, providerId: codex-oauth, credentialId: credential-a, maxConcurrency: 1, reservedAffinitySlots: 0}\n  replay: {ttlMs: 1000, maxEntries: 10, hmacKeyEnv: REPLAY_KEY}\n  surfaces: {openAIResponses: {maxBodyBytes: 1048576, maxConcurrentRequests: 4}}\n  principals:\n      - {tokenEnv: TOKEN_ENV, ingress: openai-responses, tenantId: t, applicationId: app-a, callerId: c, capabilityId: cap, scopes: [model.invoke], budgetEvidenceId: b, virtualModelIds: [m]}\n  virtualModels:\n      - {id: m, displayName: Model, contextTokens: 1000, outputTokens: 100, providerId: codex-oauth, providerModelId: p, accountIds: [a], capabilities: [text], affinity: {continuity: none}}\n    ${fragment}`;
    expect(() => parseGatewayYaml(yaml)).toThrow();
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

    it("reports error for empty apps array", () => {
      const errors = validateGatewayConfig(makeConfig({ apps: [] }));
      expect(errors.some((e) => e.field === "apps")).toBe(true);
    });

    it("reports error for duplicate app names", () => {
      const config = makeConfig({
        apps: [
          makeAppBinding({ name: "duplicate", channels: [{ type: "api", path: "/api/a" }] }),
          makeAppBinding({ name: "duplicate", channels: [{ type: "web" }] }),
        ],
      });
      const errors = validateGatewayConfig(config);
      expect(errors.some((e) => e.field.includes("name") && e.message.includes("duplicate"))).toBe(true);
    });

    it("reports error for duplicate API paths", () => {
      const config = makeConfig({
        apps: [
          makeAppBinding({ name: "app-a", channels: [{ type: "api", path: "/api/shared" }] }),
          makeAppBinding({ name: "app-b", channels: [{ type: "api", path: "/api/shared" }] }),
        ],
      });
      const errors = validateGatewayConfig(config);
      expect(errors.some((e) => e.message.includes("/api/shared"))).toBe(true);
    });

    it("reports error for duplicate phone numbers", () => {
      const config = makeConfig({
        apps: [
          makeAppBinding({ name: "app-a", channels: [{ type: "whatsapp", phoneNumber: "+521234567890" }] }),
          makeAppBinding({ name: "app-b", channels: [{ type: "whatsapp", phoneNumber: "+521234567890" }] }),
        ],
      });
      const errors = validateGatewayConfig(config);
      expect(errors.some((e) => e.message.includes("+521234567890"))).toBe(true);
    });

    it("reports error for port 0", () => {
      const errors = validateGatewayConfig(makeConfig({ port: 0 }));
      expect(errors.some((e) => e.field === "port")).toBe(true);
    });

    it("reports error for negative port", () => {
      const errors = validateGatewayConfig(makeConfig({ port: -1 }));
      expect(errors.some((e) => e.field === "port")).toBe(true);
    });

    it("reports error for port above 65535", () => {
      const errors = validateGatewayConfig(makeConfig({ port: 70000 }));
      expect(errors.some((e) => e.field === "port")).toBe(true);
    });

    it("reports error for non-integer port", () => {
      const errors = validateGatewayConfig(makeConfig({ port: 3.14 }));
      expect(errors.some((e) => e.field === "port")).toBe(true);
    });

    it("reports error when app name is empty", () => {
      const config = makeConfig({
        apps: [makeAppBinding({ name: "" })],
      });
      const errors = validateGatewayConfig(config);
      expect(errors.some((e) => e.field.includes("name"))).toBe(true);
    });

    it("reports error when app config is empty", () => {
      const config = makeConfig({
        apps: [makeAppBinding({ config: "" })],
      });
      const errors = validateGatewayConfig(config);
      expect(errors.some((e) => e.field.includes("config"))).toBe(true);
    });

    it("reports error when app has no channel bindings", () => {
      const config = makeConfig({
        apps: [makeAppBinding({ channels: [] })],
      });
      const errors = validateGatewayConfig(config);
      expect(errors.some((e) => e.field.includes("channels"))).toBe(true);
    });

    it("accumulates multiple errors", () => {
      const config: GatewayConfig = {
        port: 0,
        apps: [
          { name: "", config: "", channels: [] },
          { name: "same", config: "a.yaml", channels: [{ type: "web" }] },
          { name: "same", config: "b.yaml", channels: [{ type: "api", path: "/shared" }] },
          { name: "other", config: "c.yaml", channels: [{ type: "api", path: "/shared" }] },
        ],
      };
      const errors = validateGatewayConfig(config);
      expect(errors.length).toBeGreaterThanOrEqual(4);
    });
  });
});
