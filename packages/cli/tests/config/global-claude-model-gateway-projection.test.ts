import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelGatewayConfig } from "@kilnai/core/engine";
import { createModelGatewayConfigDigest, type ModelGatewayListenerIdentity } from "@kilnai/runtime";
import {
  hasGlobalClaudeModelGatewayProjection,
  syncGlobalClaudeModelGatewayProjection,
} from "../../src/config/global-claude-model-gateway-projection.js";

function config(): ModelGatewayConfig {
  return {
    port: 4910,
    replay: { ttlMs: 1_000, maxEntries: 10, hmacKeyEnv: "REPLAY_KEY" },
    surfaces: { anthropicMessages: { maxBodyBytes: 1_024, maxConcurrentRequests: 1 } },
    principals: [{ tokenEnv: "ANTHROPIC_AUTH_TOKEN", ingress: "anthropic-messages", nativeHarness: "claude", tenantId: "tenant", applicationId: "claude", callerId: "native", capabilityId: "invoke", scopes: ["model.invoke"], budgetEvidenceId: "budget", virtualModelIds: ["claude-kiln"] }],
    virtualModels: [{ id: "claude-kiln", displayName: "Claude via Kiln", contextTokens: 200_000, outputTokens: 8_192, targetId: "claude-route", capabilities: ["text"], affinity: { continuity: "none" } }],
  };
}

function ready(value: ModelGatewayConfig): ModelGatewayListenerIdentity {
  return { service: "kiln-model-gateway", status: "ready", protocolVersion: 1, instanceId: "instance", pid: 123, version: "3.0.0", configDigest: createModelGatewayConfigDigest(value), port: value.port };
}

describe("global Claude model gateway projection", () => {
  let root: string | undefined;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

  it("registers project routing globally and restores it after the Claude principal is removed", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-global-claude-"));
    const targetPath = join(root, "project", ".claude", "settings.json");
    const installStateDir = join(root, "home", ".kiln", "runtime", "native-projections");
    const gateway = config();
    const document = {
      permissions: { allow: ["Read"] },
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "keep" }] }] },
    };
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: "utf8", flag: "wx" });

    await syncGlobalClaudeModelGatewayProjection({ config: gateway, listener: ready(gateway), targetPath, installStateDir, operation: "install" });

    expect(hasGlobalClaudeModelGatewayProjection(installStateDir)).toBe(true);
    expect(JSON.parse(readFileSync(targetPath, "utf8"))).toMatchObject({ permissions: { allow: ["Read"] }, hooks: document.hooks, env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:4910" }, model: "claude-kiln" });

    const withoutClaude = { ...gateway, principals: [], virtualModels: [] };
    await syncGlobalClaudeModelGatewayProjection({ config: withoutClaude, installStateDir, operation: "uninstall" });

    expect(JSON.parse(readFileSync(targetPath, "utf8"))).toEqual(document);
    expect(hasGlobalClaudeModelGatewayProjection(installStateDir)).toBe(false);
  });

  it("restores every registered project from a different working directory", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-global-claude-multiple-"));
    const installStateDir = join(root, "global-state");
    const gateway = config();
    const targets = [join(root, "project-a", ".claude", "settings.json"), join(root, "project-b", ".claude", "settings.json")];
    for (const targetPath of targets) {
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, JSON.stringify({ hooks: { keep: targetPath } }), { encoding: "utf8", flag: "wx" });
      await syncGlobalClaudeModelGatewayProjection({ config: gateway, listener: ready(gateway), targetPath, installStateDir, operation: "install" });
    }

    const result = await syncGlobalClaudeModelGatewayProjection({ config: gateway, installStateDir, operation: "uninstall" });

    expect(result).toMatchObject({ operation: "uninstall", changed: true });
    expect(new Set(result.targetPaths)).toEqual(new Set(targets));
    for (const targetPath of targets) expect(JSON.parse(readFileSync(targetPath, "utf8"))).toEqual({ hooks: { keep: targetPath } });
  });

  it("fails closed before modifying a registered project when a managed field drifted", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-global-claude-drift-"));
    const targetPath = join(root, "project", ".claude", "settings.json");
    const installStateDir = join(root, "global-state");
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, JSON.stringify({ hooks: { keep: true } }), { encoding: "utf8", flag: "wx" });
    const gateway = config();
    await syncGlobalClaudeModelGatewayProjection({ config: gateway, listener: ready(gateway), targetPath, installStateDir, operation: "install" });
    const changed = JSON.parse(readFileSync(targetPath, "utf8"));
    changed.env.ANTHROPIC_BASE_URL = "https://operator.example";
    writeFileSync(targetPath, JSON.stringify(changed));

    await expect(syncGlobalClaudeModelGatewayProjection({ config: gateway, installStateDir, operation: "uninstall" })).rejects.toThrow("drift");
    expect(JSON.parse(readFileSync(targetPath, "utf8")).env.ANTHROPIC_BASE_URL).toBe("https://operator.example");
    expect(hasGlobalClaudeModelGatewayProjection(installStateDir)).toBe(true);
  });
});
