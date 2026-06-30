import { describe, expect, it } from "vitest";
import { evaluateManagedInvocationCallerCapability } from "../../src/agents/managed-invocation/caller-capability-policy.js";

const adapterEvidence = {
  adapterDescriptorId: "adapter:test",
  adapterId: "kiln-managed-invocation",
} as const;

describe("managed invocation caller capability policy", () => {
  it.each([
    ["claude", "codex-oauth"],
    ["claude", "opencode-go"],
    ["claude", "opencode-zen"],
    ["claude", "openrouter"],
    ["codex", "opencode-go"],
    ["codex", "opencode-zen"],
    ["codex", "openrouter"],
    ["opencode", "codex-oauth"],
  ] as const)("admits external %s callers for %s", (harness, providerId) => {
    expect(evaluateManagedInvocationCallerCapability({
      callerIdentity: {
        kind: "external-harness",
        harness,
        attachmentId: `attachment:${harness}`,
        evidenceId: `evidence:${harness}`,
      },
      providerId,
      adapterEvidence,
    })).toMatchObject({ decision: "admitted", adapterEvidence });
  });

  it.each([
    ["claude", "anthropic"],
    ["codex", "codex-oauth"],
    ["opencode", "opencode-go"],
  ] as const)("denies unsupported external %s callers for %s", (harness, providerId) => {
    expect(evaluateManagedInvocationCallerCapability({
      callerIdentity: {
        kind: "external-harness",
        harness,
        attachmentId: `attachment:${harness}`,
        evidenceId: `evidence:${harness}`,
      },
      providerId,
      adapterEvidence,
    })).toMatchObject({ decision: "denied", adapterEvidence });
  });

  it("does not infer capability from provider or model prefixes", () => {
    expect(evaluateManagedInvocationCallerCapability({
      callerIdentity: {
        kind: "external-harness",
        harness: "codex",
        attachmentId: "attachment:codex",
        evidenceId: "evidence:codex",
      },
      providerId: "custom",
      model: "opencode-go/kimi-k2.7-code",
      adapterEvidence,
    }).decision).toBe("denied");
  });

  it("does not cross-harness restrict Kiln runtime callers", () => {
    expect(evaluateManagedInvocationCallerCapability({
      callerIdentity: {
        kind: "kiln-runtime",
        surface: "gateway",
        attachmentId: "attachment:gateway",
      },
      providerId: "custom-provider",
      adapterEvidence,
    })).toMatchObject({ decision: "admitted", adapterEvidence });
  });
});
