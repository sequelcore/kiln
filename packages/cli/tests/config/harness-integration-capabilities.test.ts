import { describe, expect, it } from "vitest";
import {
  HARNESSES_WITH_NATIVE_CONFIG_IMPORT,
  HARNESSES_WITH_NATIVE_PROJECTION,
  getHarnessIntegrationCapability,
  listHarnessIntegrationCapabilities,
  encodeNativeAgentModel,
  supportsHarnessIntegration,
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
});
