import { describe, expect, it } from "vitest";
import {
  appendExecutionIdentity,
  formatExecutionIdentity,
  resolveExecutionIdentity,
} from "../../src/agents/execution-identity.js";

describe("execution identity helpers", () => {
  it("resolves configured provider/model when routed identity is absent", () => {
    const identity = resolveExecutionIdentity({
      configuredProvider: "codex-oauth",
      configuredModel: "gpt-5.4",
    });

    expect(identity).toEqual({
      source: "configured",
      provider: "codex-oauth",
      model: "gpt-5.4",
      canonicalModel: "gpt-5.4",
      billingMode: "subscription",
    });
  });

  it("prefers routed provider/model over configured values", () => {
    const identity = resolveExecutionIdentity({
      configuredProvider: "codex-oauth",
      configuredModel: "gpt-5.4",
      routedProvider: "openai",
      routedModel: "gpt-4o-mini",
    });

    expect(identity).toEqual({
      source: "runtime-routed",
      provider: "openai",
      model: "gpt-4o-mini",
      canonicalModel: "gpt-4o-mini",
      billingMode: "metered",
    });
  });

  it("derives canonical models from provider-qualified runtime ids", () => {
    const identity = resolveExecutionIdentity({
      configuredProvider: "opencode",
      configuredModel: "opencode/nemotron-3-super-free",
    });

    expect(identity).toEqual({
      source: "configured",
      provider: "opencode",
      model: "opencode/nemotron-3-super-free",
      canonicalModel: "nemotron-3-super-free",
      billingMode: "free",
    });
  });

  it.each([
    ["opencode-go", "deepseek-v4-flash", "subscription"],
    ["opencode-zen", "deepseek-v4-pro", "metered"],
    ["lmstudio", "local-model", "free"],
  ] as const)("uses the canonical %s provider billing policy", (provider, model, billingMode) => {
    expect(resolveExecutionIdentity({
      configuredProvider: provider,
      configuredModel: model,
    })).toMatchObject({
      provider,
      model,
      billingMode,
    });
  });

  it("does not let a model-name suffix override a subscription provider contract", () => {
    expect(resolveExecutionIdentity({
      configuredProvider: "opencode-go",
      configuredModel: "historical-model-free",
    })).toMatchObject({
      billingMode: "subscription",
    });
  });

  it("returns undefined when no provider/model is known", () => {
    expect(resolveExecutionIdentity({})).toBeUndefined();
  });

  it("appends formatted identity to an existing prompt", () => {
    const identity = resolveExecutionIdentity({
      configuredProvider: "openai",
      configuredModel: "gpt-5.4-mini",
    });
    const appended = appendExecutionIdentity("Base prompt", identity);

    expect(appended).toContain("Base prompt");
    expect(appended).toContain(formatExecutionIdentity(identity!));
    expect(appended).toContain("billing-mode: metered");
  });
});
