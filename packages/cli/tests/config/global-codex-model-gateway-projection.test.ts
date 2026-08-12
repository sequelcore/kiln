import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelGatewayConfig } from "@kilnai/core";
import { createModelGatewayConfigDigest, type ModelGatewayListenerIdentity } from "@kilnai/runtime";
import {
  buildCodexCompositeCatalog,
  syncGlobalCodexModelGatewayProjection,
} from "../../src/config/global-codex-model-gateway-projection.js";

const token = "codex-principal-token-that-is-at-least-thirty-two-bytes";

function config(): ModelGatewayConfig {
  return {
    port: 4910,
    replay: { ttlMs: 1_000, maxEntries: 10, hmacKeyEnv: "REPLAY_KEY" },
    surfaces: { openAIResponses: { maxBodyBytes: 1_024, maxConcurrentRequests: 1 } },
    principals: [{ tokenEnv: "CODEX_GATEWAY_TOKEN", ingress: "openai-responses", nativeHarness: "codex", tenantId: "tenant", applicationId: "codex", callerId: "native", capabilityId: "invoke", scopes: ["model.invoke"], budgetEvidenceId: "budget", virtualModelIds: ["kiln/model-a"] }],
    virtualModels: [{ id: "kiln/model-a", displayName: "Model A via Kiln", contextTokens: 200_000, outputTokens: 8_192, executionRouteId: "model-a-route", capabilities: ["text", "function-tools", "parallel-tool-calls"], affinity: { continuity: "none" }, deliberation: { levels: ["low", "high"], defaultLevel: "low", supportsAdaptive: false, evidenceRevision: "proof-v1" } }],
  };
}

const nativeCatalog = {
  models: [{ slug: "gpt-native", display_name: "Native", description: "Keep", default_reasoning_level: "medium", supported_reasoning_levels: [{ effort: "medium", description: "Keep" }], visibility: "list", supported_in_api: true, priority: 1, shell_type: "shell_command", model_messages: { instructions_template: "You are Codex, a coding agent based on GPT-5." }, base_instructions: "You are Codex, a coding agent based on GPT-5.", context_window: 272_000, supports_parallel_tool_calls: true, supports_search_tool: true, input_modalities: ["text", "image"] }],
};

function ready(value: ModelGatewayConfig): ModelGatewayListenerIdentity {
  return { service: "kiln-model-gateway", status: "ready", protocolVersion: 1, instanceId: "instance", pid: 123, version: "3.0.0", configDigest: createModelGatewayConfigDigest(value), port: value.port };
}

describe("global Codex composite model gateway projection", () => {
  let root: string | undefined;
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

  it("preserves native catalog entries and builds truthful virtual entries", () => {
    const catalog = buildCodexCompositeCatalog({ config: config(), nativeCatalog });
    expect(catalog.models[0]).toEqual(nativeCatalog.models[0]);
    expect(catalog.models[1]).toMatchObject({
      slug: "kiln/model-a",
      display_name: "Model A via Kiln",
      shell_type: "disabled",
      context_window: 200_000,
      default_reasoning_level: "low",
      supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
      supports_parallel_tool_calls: true,
      supports_search_tool: false,
      supports_reasoning_summaries: false,
      support_verbosity: false,
      apply_patch_tool_type: null,
      multi_agent_version: "v1",
      input_modalities: ["text"],
    });
    expect(JSON.stringify(catalog.models[1])).not.toContain("GPT-5");
  });

  it("installs and uninstalls only the owned base URL, catalog pointer, and catalog file", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-global-codex-"));
    const targetPath = join(root, ".codex", "config.toml");
    const catalogPath = join(root, ".kiln", "runtime", "native-projections", "codex-composite-models.json");
    const installStateDir = join(root, ".kiln", "runtime", "native-projections");
    await mkdir(join(root, ".codex"), { recursive: true });
    writeFileSync(targetPath, "model = \"gpt-native\"\napproval_policy = \"on-request\"\n");
    const gateway = config();

    await syncGlobalCodexModelGatewayProjection({ config: gateway, listener: ready(gateway), env: { CODEX_GATEWAY_TOKEN: token }, nativeCatalog, targetPath, catalogPath, installStateDir, operation: "install" });

    const installed = parseToml(readFileSync(targetPath, "utf8")) as Record<string, unknown>;
    expect(installed).toMatchObject({ model: "gpt-native", approval_policy: "on-request", model_catalog_json: catalogPath });
    expect(installed.model_provider).toBeUndefined();
    expect(installed.openai_base_url).toMatch(/^http:\/\/127\.0\.0\.1:4910\/\.well-known\/kiln\/codex-composite\/[A-Za-z0-9_-]{43}\/v1$/u);
    expect(JSON.parse(readFileSync(catalogPath, "utf8")).models).toHaveLength(2);

    await syncGlobalCodexModelGatewayProjection({ config: gateway, env: { CODEX_GATEWAY_TOKEN: token }, nativeCatalog, targetPath, catalogPath, installStateDir, operation: "uninstall" });
    expect(parseToml(readFileSync(targetPath, "utf8"))).toEqual({ model: "gpt-native", approval_policy: "on-request" });
    expect(existsSync(catalogPath)).toBe(false);
  });

  it("fails closed for unmanaged collisions and managed drift", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-global-codex-drift-"));
    const targetPath = join(root, "config.toml");
    const catalogPath = join(root, "catalog.json");
    const installStateDir = join(root, "state");
    const gateway = config();
    writeFileSync(targetPath, "openai_base_url = \"https://operator.example\"\n");
    await expect(syncGlobalCodexModelGatewayProjection({ config: gateway, listener: ready(gateway), env: { CODEX_GATEWAY_TOKEN: token }, nativeCatalog, targetPath, catalogPath, installStateDir, operation: "install" })).rejects.toThrow("unmanaged");
    writeFileSync(targetPath, "model = \"gpt-native\"\n");
    await syncGlobalCodexModelGatewayProjection({ config: gateway, listener: ready(gateway), env: { CODEX_GATEWAY_TOKEN: token }, nativeCatalog, targetPath, catalogPath, installStateDir, operation: "install" });
    writeFileSync(targetPath, readFileSync(targetPath, "utf8").replace("127.0.0.1", "localhost"));
    await expect(syncGlobalCodexModelGatewayProjection({ config: gateway, listener: ready(gateway), env: { CODEX_GATEWAY_TOKEN: token }, nativeCatalog, targetPath, catalogPath, installStateDir, operation: "install" })).rejects.toThrow("drift");
  });
});
