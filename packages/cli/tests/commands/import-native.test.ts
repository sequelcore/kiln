import { describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import {
  createImportNativePlan,
  extractCodexNativeConfig,
  extractOpenCodeNativeConfig,
  parseImportNativeTarget,
} from "../../src/commands/import-native.js";
import type { KilnGlobalConfig } from "../../src/config/global-config.js";

describe("import-native command helpers", () => {
  it("extracts provider, model, approval, and sandbox from Codex TOML", () => {
    const nativeDocument = parseToml([
      "model = \"gpt-5.4\"",
      "approval_policy = \"on-request\"",
      "sandbox_mode = \"workspace-write\"",
    ].join("\n")) as Record<string, unknown>;

    expect(extractCodexNativeConfig(nativeDocument)).toEqual({
      provider: "codex",
      model: "gpt-5.4",
      permissions: {
        approval: "on-request",
        sandbox: "workspace-write",
      },
      extractedFields: [
        "provider",
        "model",
        "permissions.approval",
        "permissions.sandbox",
      ],
    });
  });

  it("merges imported Codex fields without clobbering unrelated Kiln fields", () => {
    const currentConfig: KilnGlobalConfig = {
      version: "2",
      identity: { name: "Alex", timezone: "America/Tijuana" },
      engines: {
        claude: { enabled: true, billing: "subscription" },
      },
      workerRouting: { defaultWorker: "claude" },
      permissions: {
        approval: "never",
        tools: [{ tool: "Read", action: "allow" }],
      },
      mcp: {
        servers: {
          kiln: { transport: "stdio", command: "kiln-mcp" },
        },
      },
    };

    const plan = createImportNativePlan({
      target: "codex",
      nativeConfigPath: "C:/Users/ExampleUser/.codex/config.toml",
      globalConfigPath: "C:/Users/ExampleUser/.kiln/config.yaml",
      currentConfig,
      nativeDocument: {
        model: "gpt-5.4",
        approval_policy: "on-request",
        sandbox_mode: "workspace-write",
      },
    });

    expect(plan.after).toEqual({
      version: "2",
      identity: { name: "Alex", timezone: "America/Tijuana" },
      engines: {
        claude: { enabled: true, billing: "subscription" },
        codex: { enabled: true },
      },
      workerRouting: { defaultWorker: "codex" },
      permissions: {
        approval: "on-request",
        sandbox: "workspace-write",
        tools: [{ tool: "Read", action: "allow" }],
      },
      workerModels: { codex: "gpt-5.4" },
      mcp: {
        servers: {
          kiln: { transport: "stdio", command: "kiln-mcp" },
        },
      },
      components: { include: ["baseline:core"] },
    });
    expect(plan.hasChanges).toBe(true);
    expect(plan.diff).toContain("--- C:/Users/ExampleUser/.kiln/config.yaml");
    expect(plan.diff).toContain("+++ C:/Users/ExampleUser/.kiln/config.yaml");
    expect(plan.diff).toContain("+  codex: gpt-5.4");
  });

  it("extracts provider, model, and permissions from OpenCode JSON", () => {
    expect(extractOpenCodeNativeConfig({
      model: "gpt-5.4-mini",
      permission: { default: "allow" },
    })).toEqual({
      provider: "opencode",
      model: "gpt-5.4-mini",
      permissions: {
        approval: "never",
        sandbox: "workspace-write",
      },
      extractedFields: [
        "provider",
        "model",
        "permissions.approval",
        "permissions.sandbox",
      ],
    });
  });

  it("maps OpenCode ask and deny permission defaults to Kiln approval modes", () => {
    expect(extractOpenCodeNativeConfig({ permission: { default: "ask" } }).permissions).toEqual({
      approval: "on-request",
    });
    expect(extractOpenCodeNativeConfig({ permission: { default: "deny" } }).permissions).toEqual({
      approval: "untrusted",
    });
  });

  it("does not create permission keys for unsupported Codex native values", () => {
    const extracted = extractCodexNativeConfig({
      approval_policy: "invalid",
      sandbox_mode: "unsafe",
      model: "",
    });

    expect(extracted).toEqual({
      provider: "codex",
      model: undefined,
      permissions: undefined,
      extractedFields: ["provider"],
    });
  });

  it("rejects missing and unknown import targets", () => {
    expect(() => parseImportNativeTarget(undefined)).toThrow(
      "Missing import-native target. Valid targets: codex, opencode",
    );
    expect(() => parseImportNativeTarget("claude")).toThrow(
      'Unknown import-native target "claude". Valid targets: codex, opencode',
    );
  });
});
