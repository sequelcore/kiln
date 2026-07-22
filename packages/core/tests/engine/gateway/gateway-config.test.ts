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
  openAIResponses:
    enabled: true
    maxBodyBytes: 1048576
    maxConcurrentRequests: 4
    replay: { ttlMs: 300000, maxEntries: 1000, hmacKeyEnv: KILN_REPLAY_KEY }
    principals:
      - tokenEnv: KILN_RESPONSES_TOKEN
        tenantId: tenant-a
        applicationId: app-a
        callerId: caller-a
        capabilityId: model-invoke
        scopes: [model.invoke]
        budgetEvidenceId: budget-a
        virtualModelIds: [codex]
    virtualModels:
      - id: codex
        providerId: codex-oauth
        providerModelId: gpt-5.6-codex
        accountIds: [account-a]
        capabilities: [text, function-tools]
        affinity: { continuity: prefer, scope: session, allowRebind: true }
`);
    expect(parsed.modelGateway?.openAIResponses).toMatchObject({
      replay: { hmacKeyEnv: "KILN_REPLAY_KEY" },
      principals: [{ tokenEnv: "KILN_RESPONSES_TOKEN", applicationId: "app-a" }],
      virtualModels: [{ providerId: "codex-oauth", accountIds: ["account-a"], affinity: { scope: "session" } }],
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
  openAIResponses:
    enabled: true
    maxBodyBytes: 1024
    maxConcurrentRequests: 2
    replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: REPLAY_KEY }
    principals:
      - { tokenEnv: TOKEN_ENV, tenantId: tenant, applicationId: standalone-app, callerId: caller, capabilityId: invoke, scopes: [model.invoke], budgetEvidenceId: budget, virtualModelIds: [model] }
    virtualModels:
      - { id: model, providerId: codex-oauth, providerModelId: provider-model, accountIds: [account], capabilities: [text], affinity: { continuity: none } }
`;
    expect(parseGatewayYaml(standalone).apps).toEqual([]);
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
      .toThrow(/exactly one/);
  });

  it.each([
    ["unknown field", "extra: true"],
    ["wrong provider", "virtualModels:\n      - id: codex\n        providerId: other\n        providerModelId: model\n        accountIds: [a]\n        capabilities: [text]\n        affinity: { continuity: none }"],
  ])("fails closed for malformed model gateway %s", (_label, fragment) => {
    const yaml = `port: 4800\napps:\n  - name: app-a\n    config: a.yaml\n    channels: [{type: api}]\nmodelGateway:\n  port: 4801\n  accounts:\n    - {id: a, providerId: codex-oauth, credentialId: credential-a, maxConcurrency: 1, reservedAffinitySlots: 0}\n  openAIResponses:\n    enabled: true\n    maxBodyBytes: 1048576\n    maxConcurrentRequests: 4\n    replay: {ttlMs: 1000, maxEntries: 10, hmacKeyEnv: REPLAY_KEY}\n    principals:\n      - {tokenEnv: TOKEN_ENV, tenantId: t, applicationId: app-a, callerId: c, capabilityId: cap, scopes: [model.invoke], budgetEvidenceId: b, virtualModelIds: [m]}\n    virtualModels:\n      - {id: m, providerId: codex-oauth, providerModelId: p, accountIds: [a], capabilities: [text], affinity: {continuity: none}}\n    ${fragment}`;
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
