import { describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import {
  extractCodexNativeConfig,
  extractOpenCodeNativeConfig,
  parseImportNativeTarget,
} from "../../src/commands/import-native.js";

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
