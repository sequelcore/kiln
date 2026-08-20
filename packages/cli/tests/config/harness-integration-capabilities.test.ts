import { describe, expect, it } from "vitest";
import {
  HARNESSES_WITH_NATIVE_CONFIG_IMPORT,
  HARNESSES_WITH_NATIVE_PROJECTION,
  getHarnessIntegrationCapability,
  listHarnessIntegrationCapabilities,
  encodeNativeAgentModel,
  supportsHarnessIntegration,
  admitPreventiveRoute,
} from "../../src/config/harness-integration-capabilities.js";

describe("harness integration capabilities", () => {
  it("declares every native projection harness exactly once", () => {
    expect(HARNESSES_WITH_NATIVE_PROJECTION).toEqual(["claude", "codex", "opencode"]);
    expect(listHarnessIntegrationCapabilities().map((capability) => capability.harness)).toEqual(
      HARNESSES_WITH_NATIVE_PROJECTION,
    );
  });

  it("declares native config import only where Kiln can represent the native shape", () => {
    expect(HARNESSES_WITH_NATIVE_CONFIG_IMPORT).toEqual(["codex", "opencode"]);
    expect(supportsHarnessIntegration("claude", "nativeConfigImport")).toBe(false);
    expect(supportsHarnessIntegration("codex", "nativeConfigImport")).toBe(true);
    expect(supportsHarnessIntegration("opencode", "nativeConfigImport")).toBe(true);
  });

  it("keeps OpenCode runtime config injection explicit without removing native projection", () => {
    const opencode = getHarnessIntegrationCapability("opencode");

    expect(opencode.runtimeConfigInjection).toEqual({
      supported: true,
      mechanism: "OPENCODE_CONFIG_CONTENT",
      scope: "kiln-launched-process",
    });
    expect(opencode.nativeProjection.supported).toBe(true);
    expect(opencode.nativeProjection.requiredForStandalone).toBe(true);
  });

  it("keeps Codex runtime config injection process-scoped after live proof", () => {
    const codex = getHarnessIntegrationCapability("codex");

    expect(codex.runtimeConfigInjection).toEqual({
      supported: true,
      mechanism: "CODEX_HOME + CLI config overrides",
      scope: "kiln-launched-process",
    });
  });

  it("does not claim runtime config injection for Claude Code without proof", () => {
    expect(getHarnessIntegrationCapability("claude").runtimeConfigInjection.supported).toBe(false);
  });

  it("reports supported integration mechanisms by harness", () => {
    expect(supportsHarnessIntegration("codex", "mcpRuntimeTools")).toBe(true);
    expect(supportsHarnessIntegration("codex", "runtimeConfigInjection")).toBe(true);
    expect(supportsHarnessIntegration("opencode", "runtimeConfigInjection")).toBe(true);
    expect(supportsHarnessIntegration("claude", "runtimeConfigInjection")).toBe(false);
  });

  it("keeps model encoders transport-only", () => {
    expect(encodeNativeAgentModel("codex", "codex-oauth", "gpt-5.5")).toBe("gpt-5.5");
    expect(encodeNativeAgentModel("codex", "claude", "claude-sonnet")).toBeUndefined();
  });

  it("rejects unsupported restrictive rules instead of treating prompt constraints as enforcement", () => {
    const result = admitPreventiveRoute({
      route: "codex",
      approval: "on-request",
      sandbox: "read-only",
      representableRules: [],
      unsupportedRules: [
        { category: "tool", selector: "bash", action: "deny" },
        { category: "data-firewall", selector: "logs", action: "redact" },
        { category: "tool", selector: "read", action: "allow" },
      ],
    });

    expect(result.admitted).toBe(false);
    expect(result.rejectedRules.map((rule) => rule.action)).toEqual(["deny", "redact"]);
    expect(result.reason).toContain("post-hoc observation");
  });

  it("rejects an unsupported agent-scoped restriction", () => {
    const result = admitPreventiveRoute({
      route: "claude",
      approval: "never",
      sandbox: undefined,
      representableRules: [],
      unsupportedRules: [{ category: "agent-scope", selector: "planner:restrict", action: "restrict" }],
    });

    expect(result.admitted).toBe(false);
    expect(result.rejectedRules).toHaveLength(1);
  });

  it("does not reject unsupported allow-only declarations", () => {
    const result = admitPreventiveRoute({
      route: "opencode",
      approval: "never",
      sandbox: undefined,
      representableRules: [],
      unsupportedRules: [{ category: "tool", selector: "read", action: "allow" }],
    });

    expect(result.admitted).toBe(true);
    expect(result.rejectedRules).toHaveLength(0);
    expect(result.rejectedCapabilities).toHaveLength(0);
  });

  it("rejects a direct-provider route when sandbox is not preventively available", () => {
    const result = admitPreventiveRoute({
      route: "direct-provider",
      approval: "on-request",
      sandbox: "read-only",
      representableRules: [],
      unsupportedRules: [],
    });

    expect(result.admitted).toBe(false);
    expect(result.rejectedCapabilities).toEqual(["sandbox"]);
  });
});
