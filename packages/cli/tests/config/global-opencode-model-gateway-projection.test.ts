import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createModelGatewayConfigDigest, type ModelGatewayListenerIdentity } from "@kilnai/runtime";
import type { ModelGatewayConfig } from "@kilnai/core";
import { syncGlobalOpenCodeModelGatewayProjection } from "../../src/config/global-opencode-model-gateway-projection.js";

function config(): ModelGatewayConfig {
  return {
    port: 4910,
    replay: { ttlMs: 1000, maxEntries: 10, hmacKeyEnv: "REPLAY_KEY" },
    surfaces: { openAIResponses: { maxBodyBytes: 1024, maxConcurrentRequests: 1 } },
    principals: [{ tokenEnv: "OPENCODE_TOKEN", ingress: "openai-responses", tenantId: "tenant", applicationId: "opencode", callerId: "caller", capabilityId: "invoke", scopes: ["model.invoke"], budgetEvidenceId: "budget", virtualModelIds: ["model-a"], nativeHarness: "opencode" }],
    virtualModels: [{ id: "model-a", displayName: "Model A", contextTokens: 200_000, outputTokens: 8_192, executionRouteId: "model-a-route", capabilities: ["text"], affinity: { continuity: "none" } }],
  };
}

function ready(value: ModelGatewayConfig, overrides: Partial<ModelGatewayListenerIdentity> = {}): ModelGatewayListenerIdentity {
  return { service: "kiln-model-gateway", status: "ready", protocolVersion: 1, instanceId: "global-instance", pid: 123, version: "3.0.0", configDigest: createModelGatewayConfigDigest(value), port: value.port, ...overrides };
}

describe("global OpenCode model gateway projection", () => {
  let root: string | undefined;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

  it("adds only provider.kiln and records global install state", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-global-opencode-"));
    const targetPath = join(root, "home", ".config", "opencode", "opencode.json");
    const installStateDir = join(root, "home", ".kiln", "runtime", "native-projections");
    await mkdir(join(root, "home", ".config", "opencode"), { recursive: true });
    writeFileSync(targetPath, JSON.stringify({ model: "anthropic/claude", enabled_providers: ["anthropic"], provider: { anthropic: { name: "Keep" } }, theme: "dark" }));
    const gateway = config();

    await syncGlobalOpenCodeModelGatewayProjection({ config: gateway, listener: ready(gateway), targetPath, installStateDir, operation: "install" });

    expect(JSON.parse(readFileSync(targetPath, "utf8"))).toEqual({
      model: "anthropic/claude", enabled_providers: ["anthropic"], theme: "dark",
      provider: {
        anthropic: { name: "Keep" },
        kiln: { npm: "@ai-sdk/openai", name: "Kiln", options: { baseURL: "http://127.0.0.1:4910/v1", apiKey: "{env:OPENCODE_TOKEN}" }, models: { "model-a": { name: "Model A", limit: { context: 200000, output: 8192 } } } },
      },
    });
    const state = JSON.parse(readFileSync(join(installStateDir, "install-state.json"), "utf8"));
    expect(state.targets["global-opencode-model-gateway"]).toMatchObject({ filePath: targetPath, managedFields: ["provider.kiln"] });
    expect(JSON.stringify(state)).not.toContain(root.replaceAll("\\", "/") + "/project");
  });

  it("fails closed before writing for a mismatched listener digest", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-global-opencode-health-"));
    const targetPath = join(root, "opencode.json");
    const gateway = config();
    writeFileSync(targetPath, JSON.stringify({ theme: "keep" }));
    await expect(syncGlobalOpenCodeModelGatewayProjection({ config: gateway, listener: ready(gateway, { configDigest: "a".repeat(64) }), targetPath, installStateDir: join(root, "runtime"), operation: "install" }))
      .rejects.toThrow("listener identity does not match");
    expect(JSON.parse(readFileSync(targetPath, "utf8"))).toEqual({ theme: "keep" });
  });

  it("fails closed for malformed config, unmanaged collision, and managed drift", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-global-opencode-drift-"));
    const targetPath = join(root, "opencode.json");
    const installStateDir = join(root, "runtime");
    const gateway = config();
    writeFileSync(targetPath, "{");
    await expect(syncGlobalOpenCodeModelGatewayProjection({ config: gateway, listener: ready(gateway), targetPath, installStateDir, operation: "install" })).rejects.toThrow("unreadable");
    writeFileSync(targetPath, JSON.stringify({ provider: { kiln: { name: "operator" } } }));
    await expect(syncGlobalOpenCodeModelGatewayProjection({ config: gateway, listener: ready(gateway), targetPath, installStateDir, operation: "install" })).rejects.toThrow("unmanaged provider.kiln");
    writeFileSync(targetPath, JSON.stringify({ theme: "keep" }));
    await syncGlobalOpenCodeModelGatewayProjection({ config: gateway, listener: ready(gateway), targetPath, installStateDir, operation: "install" });
    const changed = JSON.parse(readFileSync(targetPath, "utf8"));
    changed.provider.kiln.name = "operator-change";
    writeFileSync(targetPath, JSON.stringify(changed));
    await expect(syncGlobalOpenCodeModelGatewayProjection({ config: gateway, listener: ready(gateway), targetPath, installStateDir, operation: "install" })).rejects.toThrow("drift");
    await expect(syncGlobalOpenCodeModelGatewayProjection({ config: gateway, listener: ready(gateway), targetPath, installStateDir, operation: "install", force: true }))
      .resolves.toMatchObject({ operation: "install", changed: true });
    expect(JSON.parse(readFileSync(targetPath, "utf8")).provider.kiln.name).toBe("Kiln");
  });

  it("replaces an explicitly adopted stale provider without treating it as implicit ownership", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-global-opencode-adopt-"));
    const targetPath = join(root, "opencode.json");
    const installStateDir = join(root, "runtime");
    const gateway = config();
    writeFileSync(targetPath, JSON.stringify({
      model: "native/default",
      provider: {
        native: { name: "Keep" },
        kiln: { npm: "@ai-sdk/openai", name: "Kiln", options: { baseURL: "http://127.0.0.1:4800/v1", apiKey: "{env:OLD_TOKEN}" }, models: {} },
      },
    }));

    await syncGlobalOpenCodeModelGatewayProjection({
      config: gateway,
      listener: ready(gateway),
      targetPath,
      installStateDir,
      operation: "install",
      adoptExisting: true,
    });

    const installed = JSON.parse(readFileSync(targetPath, "utf8"));
    expect(installed.model).toBe("native/default");
    expect(installed.provider.native).toEqual({ name: "Keep" });
    expect(installed.provider.kiln.options).toEqual({ baseURL: "http://127.0.0.1:4910/v1", apiKey: "{env:OPENCODE_TOKEN}" });
    expect(JSON.parse(readFileSync(join(installStateDir, "install-state.json"), "utf8")).targets["global-opencode-model-gateway"]).toBeDefined();
  });

  it("uninstalls exactly the managed provider and is shared by all project working directories", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-global-opencode-uninstall-"));
    const targetPath = join(root, "opencode.json");
    const installStateDir = join(root, "runtime");
    const gateway = config();
    writeFileSync(targetPath, JSON.stringify({ model: "native/default", provider: { native: { name: "Keep" } } }));
    await syncGlobalOpenCodeModelGatewayProjection({ config: gateway, listener: ready(gateway), targetPath, installStateDir, operation: "install" });
    await syncGlobalOpenCodeModelGatewayProjection({ config: gateway, listener: ready(gateway), targetPath, installStateDir, operation: "install" });
    await syncGlobalOpenCodeModelGatewayProjection({ config: gateway, targetPath, installStateDir, operation: "uninstall" });
    expect(JSON.parse(readFileSync(targetPath, "utf8"))).toEqual({ model: "native/default", provider: { native: { name: "Keep" } } });
    expect(JSON.parse(readFileSync(join(installStateDir, "install-state.json"), "utf8")).targets).toEqual({});
    expect(existsSync(join(installStateDir, "install-state.json"))).toBe(true);
  });
});
