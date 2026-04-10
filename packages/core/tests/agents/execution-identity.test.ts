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
  });
});
