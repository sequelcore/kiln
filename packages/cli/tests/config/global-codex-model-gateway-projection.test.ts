import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelGatewayConfig } from "@kilnai/core";
import { createModelGatewayConfigDigest, type ModelGatewayListenerIdentity } from "@kilnai/runtime";
import {
  createNativeProjectionSnapshot,
  writeNativeProjectionInstallState,
} from "../../src/config/native-projection-state.js";
import {
  GLOBAL_CODEX_MODEL_GATEWAY_TARGET_ID,
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

  it("installs an OAuth-backed HTTPS-only provider and uninstalls only owned fields", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-global-codex-"));
    const targetPath = join(root, ".codex", "config.toml");
    const catalogPath = join(root, ".kiln", "runtime", "native-projections", "codex-composite-models.json");
    const installStateDir = join(root, ".kiln", "runtime", "native-projections");
    await mkdir(join(root, ".codex"), { recursive: true });
    writeFileSync(targetPath, "model = \"gpt-native\"\napproval_policy = \"on-request\"\n");
    const gateway = config();

    await syncGlobalCodexModelGatewayProjection({ config: gateway, listener: ready(gateway), env: { CODEX_GATEWAY_TOKEN: token }, nativeCatalog, targetPath, catalogPath, installStateDir, operation: "install" });

    const installed = parseToml(readFileSync(targetPath, "utf8")) as Record<string, unknown>;
    expect(installed).toMatchObject({
      model: "gpt-native",
      approval_policy: "on-request",
      model_provider: "kiln",
      model_catalog_json: catalogPath,
      model_providers: {
        kiln: {
          name: "OpenAI",
          requires_openai_auth: true,
          wire_api: "responses",
          supports_websockets: false,
          supports_standalone_web_search: true,
          request_max_retries: 0,
          stream_max_retries: 0,
        },
      },
    });
    const provider = (installed.model_providers as { kiln: { base_url: string } }).kiln;
    expect(provider.base_url).toMatch(/^http:\/\/127\.0\.0\.1:4910\/\.well-known\/kiln\/codex-composite\/[A-Za-z0-9_-]{43}\/v1$/u);
    expect(provider).not.toHaveProperty("env_key");
    expect(installed.openai_base_url).toBeUndefined();
    expect(JSON.parse(readFileSync(catalogPath, "utf8")).models).toHaveLength(2);

    await syncGlobalCodexModelGatewayProjection({ config: gateway, env: { CODEX_GATEWAY_TOKEN: token }, nativeCatalog, targetPath, catalogPath, installStateDir, operation: "uninstall" });
    expect(parseToml(readFileSync(targetPath, "utf8"))).toEqual({ model: "gpt-native", approval_policy: "on-request" });
    expect(existsSync(catalogPath)).toBe(false);
  });

  it("atomically replaces the owned built-in OpenAI base URL projection", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-global-codex-migrate-"));
    const targetPath = join(root, ".codex", "config.toml");
    const catalogPath = join(root, ".kiln", "runtime", "native-projections", "codex-composite-models.json");
    const installStateDir = join(root, ".kiln", "runtime", "native-projections");
    await mkdir(join(root, ".codex"), { recursive: true });
    const previous = {
      model: "gpt-native",
      openai_base_url: "http://127.0.0.1:4910/owned/v1",
      model_catalog_json: catalogPath,
    };
    writeFileSync(targetPath, [
      'model = "gpt-native"',
      'openai_base_url = "http://127.0.0.1:4910/owned/v1"',
      `model_catalog_json = ${JSON.stringify(catalogPath)}`,
    ].join("\n"));
    writeNativeProjectionInstallState(installStateDir, {
      version: 1,
      targets: {
        [GLOBAL_CODEX_MODEL_GATEWAY_TARGET_ID]: createNativeProjectionSnapshot({
          targetId: GLOBAL_CODEX_MODEL_GATEWAY_TARGET_ID,
          filePath: targetPath,
          document: previous,
          managedFields: ["openai_base_url", "model_catalog_json"],
        }),
      },
    });
    const gateway = config();

    await syncGlobalCodexModelGatewayProjection({
      config: gateway,
      listener: ready(gateway),
      env: { CODEX_GATEWAY_TOKEN: token },
      nativeCatalog,
      targetPath,
      catalogPath,
      installStateDir,
      operation: "install",
    });

    const installed = parseToml(readFileSync(targetPath, "utf8")) as Record<string, unknown>;
    expect(installed.openai_base_url).toBeUndefined();
    expect(installed.model_provider).toBe("kiln");
    expect((installed.model_providers as { kiln: { requires_openai_auth: boolean; supports_websockets: boolean } }).kiln)
      .toMatchObject({ requires_openai_auth: true, supports_websockets: false });
  });

  it("fails closed for unmanaged collisions and managed drift", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-global-codex-drift-"));
    const targetPath = join(root, "config.toml");
    const catalogPath = join(root, "catalog.json");
    const installStateDir = join(root, "state");
    const gateway = config();
    writeFileSync(targetPath, "openai_base_url = \"https://operator.example\"\n");
    await expect(syncGlobalCodexModelGatewayProjection({ config: gateway, listener: ready(gateway), env: { CODEX_GATEWAY_TOKEN: token }, nativeCatalog, targetPath, catalogPath, installStateDir, operation: "install" })).rejects.toThrow("unmanaged");
    writeFileSync(targetPath, [
      'model_provider = "operator"',
      "",
      "[model_providers.kiln]",
      'base_url = "https://operator.example/v1"',
    ].join("\n"));
    await expect(syncGlobalCodexModelGatewayProjection({ config: gateway, listener: ready(gateway), env: { CODEX_GATEWAY_TOKEN: token }, nativeCatalog, targetPath, catalogPath, installStateDir, operation: "install" })).rejects.toThrow("unmanaged");
    writeFileSync(targetPath, "model = \"gpt-native\"\n");
    await syncGlobalCodexModelGatewayProjection({ config: gateway, listener: ready(gateway), env: { CODEX_GATEWAY_TOKEN: token }, nativeCatalog, targetPath, catalogPath, installStateDir, operation: "install" });
    writeFileSync(targetPath, readFileSync(targetPath, "utf8").replace("127.0.0.1", "localhost"));
    await expect(syncGlobalCodexModelGatewayProjection({ config: gateway, listener: ready(gateway), env: { CODEX_GATEWAY_TOKEN: token }, nativeCatalog, targetPath, catalogPath, installStateDir, operation: "install" })).rejects.toThrow("drift");
  });

  it("preserves an unmanaged non-table model_providers value", async () => {
    root = await mkdtemp(join(tmpdir(), "kiln-global-codex-provider-shape-"));
    const targetPath = join(root, "config.toml");
    const catalogPath = join(root, "catalog.json");
    const installStateDir = join(root, "state");
    const document = 'model_providers = "operator-owned"\n';
    writeFileSync(targetPath, document);

    await expect(syncGlobalCodexModelGatewayProjection({
      config: config(),
      listener: ready(config()),
      env: { CODEX_GATEWAY_TOKEN: token },
      nativeCatalog,
      targetPath,
      catalogPath,
      installStateDir,
      operation: "install",
    })).rejects.toThrow("unmanaged");

    expect(readFileSync(targetPath, "utf8")).toBe(document);
    expect(existsSync(catalogPath)).toBe(false);
    expect(existsSync(join(installStateDir, "install-state.json"))).toBe(false);
  });
});
