import { describe, expect, it } from "vitest";
import {
  getDirectProviderExecutionProfile,
  resolveDirectProviderExecutionProfile,
} from "../../src/agents/provider-execution-profiles.js";

describe("direct provider execution profiles", () => {
  it("rejects codex oauth when no model is provided instead of substituting the profile default", () => {
    expect(resolveDirectProviderExecutionProfile({
      provider: "codex-oauth",
    })).toBeUndefined();
  });

  it.each([
    "anthropic",
    "openai",
    "deepseek",
    "openrouter",
    "ollama",
    "opencode-go",
    "opencode-zen",
  ])("rejects %s when the selected model is blank instead of substituting the profile default", (provider) => {
    const profile = getDirectProviderExecutionProfile(provider);

    expect(profile).toBeDefined();
    expect(resolveDirectProviderExecutionProfile({
      provider,
      model: "   ",
    })).toBeUndefined();
  });

  it("promotes openai to executable mode when the explicitly selected model supports tools", () => {
    const resolved = resolveDirectProviderExecutionProfile({
      provider: "openai",
      model: "gpt-5.4",
    });

    expect(resolved).toMatchObject({
      provider: "openai",
      model: "gpt-5.4",
      defaultExecutionMode: "text-only",
      executionMode: "kiln-executable",
      defaultBillingMode: "metered",
      modelSupportsFunctionTools: true,
      modelSupportsRuntimeTools: true,
      modelSupportsTools: true,
      supportsKilnExecutableTools: true,
    });
  });

  it("promotes live-discovered OpenCode models without requiring static model capability rows", () => {
    const resolved = resolveDirectProviderExecutionProfile({
      provider: "opencode-go",
      model: "live-discovered-model",
    });

    expect(resolved).toMatchObject({
      provider: "opencode-go",
      model: "live-discovered-model",
      defaultExecutionMode: "text-only",
      executionMode: "kiln-executable",
      defaultBillingMode: "subscription",
      modelSupportsFunctionTools: true,
      modelSupportsRuntimeTools: true,
      modelSupportsTools: true,
      supportsKilnExecutableTools: true,
    });
  });

  it("promotes live-discovered Codex OAuth models without requiring static model capability rows", () => {
    const resolved = resolveDirectProviderExecutionProfile({
      provider: "codex-oauth",
      model: "gpt-5.5",
      discoveredModelCapabilities: { supportsFunctionTools: true },
    });

    expect(resolved).toMatchObject({
      provider: "codex-oauth",
      model: "gpt-5.5",
      defaultExecutionMode: "kiln-executable",
      executionMode: "kiln-executable",
      defaultBillingMode: "subscription",
      modelSupportsFunctionTools: true,
      modelSupportsRuntimeTools: true,
      modelSupportsTools: true,
      supportsKilnExecutableTools: true,
    });
  });

  it("lets explicit function-tool discovery metadata disable dynamic Codex OAuth tool fallback", () => {
    const resolved = resolveDirectProviderExecutionProfile({
      provider: "codex-oauth",
      model: "gpt-disabled",
      discoveredModelCapabilities: { supportsFunctionTools: false },
    });

    expect(resolved).toMatchObject({
      provider: "codex-oauth",
      model: "gpt-disabled",
      defaultExecutionMode: "kiln-executable",
      executionMode: "text-only",
      defaultBillingMode: "subscription",
      modelSupportsFunctionTools: false,
      modelSupportsRuntimeTools: false,
      modelSupportsTools: false,
      supportsKilnExecutableTools: false,
    });
  });

  it("keeps provider native tool metadata separate from Kiln runtime tool eligibility", () => {
    const resolved = resolveDirectProviderExecutionProfile({
      provider: "codex-oauth",
      model: "gpt-5.5",
      discoveredModelCapabilities: {
        supportsNativeShellTools: false,
        supportsNativePatchTools: false,
      },
    });

    expect(resolved).toMatchObject({
      executionMode: "kiln-executable",
      modelSupportsFunctionTools: true,
      modelSupportsRuntimeTools: true,
      modelSupportsTools: true,
      supportsKilnExecutableTools: true,
    });
  });

  it("fails closed when runtime tool execution is explicitly disabled", () => {
    const resolved = resolveDirectProviderExecutionProfile({
      provider: "codex-oauth",
      model: "gpt-5.5",
      discoveredModelCapabilities: {
        supportsFunctionTools: true,
        supportsRuntimeTools: false,
      },
    });

    expect(resolved).toMatchObject({
      executionMode: "text-only",
      modelSupportsFunctionTools: true,
      modelSupportsRuntimeTools: false,
      modelSupportsTools: false,
      supportsKilnExecutableTools: false,
    });
  });

  it("keeps unsupported selected models text-only even when the provider supports structured tool calls", () => {
    const resolved = resolveDirectProviderExecutionProfile({
      provider: "deepseek",
      model: "deepseek-reasoner",
    });

    expect(resolved).toMatchObject({
      provider: "deepseek",
      model: "deepseek-reasoner",
      defaultExecutionMode: "text-only",
      executionMode: "text-only",
      defaultBillingMode: "metered",
      modelSupportsFunctionTools: false,
      modelSupportsRuntimeTools: false,
      modelSupportsTools: false,
      supportsKilnExecutableTools: false,
    });
  });

  it("does not let requested executable mode bypass selected model capability", () => {
    const resolved = resolveDirectProviderExecutionProfile({
      provider: "deepseek",
      model: "deepseek-reasoner",
      requestedExecutionMode: "kiln-executable",
    });

    expect(resolved).toMatchObject({
      model: "deepseek-reasoner",
      executionMode: "text-only",
      modelSupportsFunctionTools: false,
      modelSupportsRuntimeTools: false,
      modelSupportsTools: false,
      supportsKilnExecutableTools: false,
    });
  });

  it("lets callers request text-only mode for tool-capable selected models", () => {
    const resolved = resolveDirectProviderExecutionProfile({
      provider: "openai",
      model: "gpt-5.4",
      requestedExecutionMode: "text-only",
    });

    expect(resolved).toMatchObject({
      model: "gpt-5.4",
      executionMode: "text-only",
      modelSupportsFunctionTools: true,
      modelSupportsRuntimeTools: true,
      modelSupportsTools: true,
      supportsKilnExecutableTools: true,
    });
  });

  it("returns undefined for unsupported provider ids", () => {
    expect(resolveDirectProviderExecutionProfile({ provider: "unknown" })).toBeUndefined();
  });
});
