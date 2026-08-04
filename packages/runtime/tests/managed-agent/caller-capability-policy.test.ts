import { describe, expect, it } from "vitest";
import { evaluateManagedInvocationCallerCapability } from "../../src/agents/managed-invocation/caller-capability-policy.js";

const adapterEvidence = {
  adapterDescriptorId: "adapter:test",
  adapterId: "kiln-managed-invocation",
} as const;

const kilnRuntimeCaller = {
  kind: "kiln-runtime" as const,
  surface: "gateway",
  attachmentId: "attachment:gateway",
};

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

  describe("authority bounding for kiln-runtime callers", () => {
    it("admits kiln-runtime caller with parent read_only + child read_only", () => {
      expect(evaluateManagedInvocationCallerCapability({
        callerIdentity: {
          ...kilnRuntimeCaller,
          parentEffectiveRequestedAuthority: "read_only",
        },
        providerId: "opencode-go",
        childRequestedAuthority: "read_only",
        adapterEvidence,
      })).toMatchObject({ decision: "admitted", adapterEvidence });
    });

    it("denies kiln-runtime caller with parent read_only + child destructive with authority-narrowing-required", () => {
      const result = evaluateManagedInvocationCallerCapability({
        callerIdentity: {
          ...kilnRuntimeCaller,
          parentEffectiveRequestedAuthority: "read_only",
        },
        providerId: "opencode-go",
        childRequestedAuthority: "destructive",
        adapterEvidence,
      });
      expect(result.decision).toBe("denied");
      expect(result.reason).toBe("authority-narrowing-required");
    });

    it("denies kiln-runtime caller with parent read_only + child audited with authority-narrowing-required", () => {
      const result = evaluateManagedInvocationCallerCapability({
        callerIdentity: {
          ...kilnRuntimeCaller,
          parentEffectiveRequestedAuthority: "read_only",
        },
        providerId: "opencode-go",
        childRequestedAuthority: "audited",
        adapterEvidence,
      });
      expect(result.decision).toBe("denied");
      expect(result.reason).toBe("authority-narrowing-required");
    });

    it("denies kiln-runtime caller with parent read_only + child auto with authority-narrowing-required", () => {
      const result = evaluateManagedInvocationCallerCapability({
        callerIdentity: {
          ...kilnRuntimeCaller,
          parentEffectiveRequestedAuthority: "read_only",
        },
        providerId: "opencode-go",
        childRequestedAuthority: "auto",
        adapterEvidence,
      });
      expect(result.decision).toBe("denied");
      expect(result.reason).toBe("authority-narrowing-required");
    });

    it("admits kiln-runtime caller with parent destructive + child destructive", () => {
      expect(evaluateManagedInvocationCallerCapability({
        callerIdentity: {
          ...kilnRuntimeCaller,
          parentEffectiveRequestedAuthority: "destructive",
        },
        providerId: "opencode-go",
        childRequestedAuthority: "destructive",
        adapterEvidence,
      })).toMatchObject({ decision: "admitted", adapterEvidence });
    });

    it("admits kiln-runtime caller with parent destructive + child read_only (parent wider is fine)", () => {
      expect(evaluateManagedInvocationCallerCapability({
        callerIdentity: {
          ...kilnRuntimeCaller,
          parentEffectiveRequestedAuthority: "destructive",
        },
        providerId: "opencode-go",
        childRequestedAuthority: "read_only",
        adapterEvidence,
      })).toMatchObject({ decision: "admitted", adapterEvidence });
    });

    // auto/unset parent is the most permissive admitted-by-config path.
    // The executor's resolveManagedInvocationRequestedAuthority handles narrowing,
    // so the policy admits unconditionally when parent authority is unset/auto.
    it("admits kiln-runtime caller with parent auto + child destructive (most permissive path)", () => {
      expect(evaluateManagedInvocationCallerCapability({
        callerIdentity: {
          ...kilnRuntimeCaller,
          parentEffectiveRequestedAuthority: "auto",
        },
        providerId: "opencode-go",
        childRequestedAuthority: "destructive",
        adapterEvidence,
      })).toMatchObject({ decision: "admitted", adapterEvidence });
    });

    it("admits kiln-runtime caller with no parent authority set + child destructive (unset = most permissive path)", () => {
      expect(evaluateManagedInvocationCallerCapability({
        callerIdentity: kilnRuntimeCaller,
        providerId: "opencode-go",
        childRequestedAuthority: "destructive",
        adapterEvidence,
      })).toMatchObject({ decision: "admitted", adapterEvidence });
    });

    it("admits kiln-runtime caller with no childRequestedAuthority (candidate admission path)", () => {
      expect(evaluateManagedInvocationCallerCapability({
        callerIdentity: {
          ...kilnRuntimeCaller,
          parentEffectiveRequestedAuthority: "read_only",
        },
        providerId: "opencode-go",
        adapterEvidence,
      })).toMatchObject({ decision: "admitted", adapterEvidence });
    });

    it("external-harness callers are unaffected by authority bounding", () => {
      expect(evaluateManagedInvocationCallerCapability({
        callerIdentity: {
          kind: "external-harness",
          harness: "claude",
          attachmentId: "attachment:claude",
          evidenceId: "evidence:claude",
        },
        providerId: "opencode-go",
        childRequestedAuthority: "destructive",
        adapterEvidence,
      })).toMatchObject({ decision: "admitted", adapterEvidence });
    });
  });
});
