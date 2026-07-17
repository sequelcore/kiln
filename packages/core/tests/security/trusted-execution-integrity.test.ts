import { describe, expect, it } from "vitest";
import {
  TRUSTED_EXECUTION_CLASSIFICATIONS,
  TRUSTED_EXECUTION_EVIDENCE_FRESHNESS,
  TRUSTED_EXECUTION_PROOF_STATUSES,
  authorizeTrustedExecutionIntent,
  classifyTrustedExecutionIntegrity,
  type TrustedExecutionClassificationInput,
} from "../../src/security/trusted-execution-integrity.js";

describe("trusted execution security vocabulary", () => {
  it("stays aligned with the serialized Gateway contract", () => {
    expect(TRUSTED_EXECUTION_CLASSIFICATIONS).toEqual([
      "current-verified",
      "intentional-operator-override",
      "native-projection-drift",
      "runtime-policy-mismatch",
      "effective-policy-unproven",
      "unsupported-semantic-translation",
      "dangerous-unapproved-broadening",
      "stale-evidence",
      "partial-observation",
      "observation-failed",
    ]);
    expect(TRUSTED_EXECUTION_EVIDENCE_FRESHNESS).toEqual(["current", "stale", "unknown"]);
    expect(TRUSTED_EXECUTION_PROOF_STATUSES).toEqual(["proven", "inferred", "unavailable", "contradictory"]);
  });
});

const currentEvidence = {
  profile: "trusted-full-access" as const,
  source: "runtime-observation" as const,
  observedAt: "2026-07-01T15:00:00.000Z",
  freshness: "current" as const,
  proof: "proven" as const,
  verifiedAt: "2026-07-01T15:00:01.000Z",
};

function input(overrides: Partial<TrustedExecutionClassificationInput> = {}): TrustedExecutionClassificationInput {
  return {
    desired: { ...currentEvidence, source: "operator-local-config" },
    persistedNative: { ...currentEvidence, source: "native-config", projectionOwnership: "kiln-managed" },
    effectiveRuntime: currentEvidence,
    enforcement: {
      approvalControl: "enforced",
      filesystemSandbox: "enforced",
      networkBoundary: "enforced",
      strength: "strong",
    },
    authorization: {
      status: "authorized",
      scope: "operator-local",
      authorizedBy: "operator:test",
      authorizedAt: "2026-07-01T14:59:00.000Z",
      revocable: true,
    },
    semanticLoss: [],
    observation: "complete",
    ...overrides,
  };
}

describe("classifyTrustedExecutionIntegrity", () => {
  it.each([
    ["dangerous-unapproved-broadening", input({
      persistedNative: { ...currentEvidence, profile: "trusted-full-access", source: "native-config", projectionOwnership: "operator-owned" },
      desired: { ...currentEvidence, profile: "restricted", source: "repository-config" },
      authorization: { status: "rejected", scope: "repository", revocable: true },
    })],
    ["observation-failed", input({ observation: "failed" })],
    ["partial-observation", input({ observation: "partial" })],
    ["stale-evidence", input({ effectiveRuntime: { ...currentEvidence, freshness: "stale" } })],
    ["unsupported-semantic-translation", input({ semanticLoss: ["filesystem sandbox cannot be represented"] })],
    ["runtime-policy-mismatch", input({ effectiveRuntime: { ...currentEvidence, profile: "workspace-write", proof: "contradictory" } })],
    ["effective-policy-unproven", input({ effectiveRuntime: { ...currentEvidence, proof: "inferred", source: "desktop-ui-selection" } })],
    ["intentional-operator-override", input({ persistedNative: { ...currentEvidence, profile: "restricted", source: "native-config", projectionOwnership: "operator-owned" } })],
    ["native-projection-drift", input({ persistedNative: { ...currentEvidence, profile: "restricted", source: "native-config", projectionOwnership: "kiln-managed" } })],
    ["current-verified", input()],
  ] as const)("applies precedence for %s", (expected, evidence) => {
    expect(classifyTrustedExecutionIntegrity(evidence).classification).toBe(expected);
  });

  it("never treats stale evidence as proof even when every profile matches", () => {
    const result = classifyTrustedExecutionIntegrity(input({
      desired: { ...currentEvidence, source: "operator-local-config", freshness: "stale" },
      persistedNative: { ...currentEvidence, source: "native-config", freshness: "stale", projectionOwnership: "kiln-managed" },
      effectiveRuntime: { ...currentEvidence, freshness: "stale" },
    }));

    expect(result).toMatchObject({ classification: "stale-evidence", effectiveIsProven: false });
  });

  it("treats a Full Access UI selection as inferred rather than effective proof", () => {
    const result = classifyTrustedExecutionIntegrity(input({
      sessionOverride: { ...currentEvidence, source: "desktop-ui-selection", proof: "inferred" },
      effectiveRuntime: undefined,
    }));

    expect(result).toMatchObject({
      classification: "effective-policy-unproven",
      effectiveIsProven: false,
    });
  });

  it("reports OpenCode allow honestly as permission resolution without sandbox enforcement", () => {
    const result = classifyTrustedExecutionIntegrity(input({
      harness: "opencode",
      enforcement: {
        approvalControl: "enforced",
        filesystemSandbox: "not-enforced",
        networkBoundary: "not-enforced",
        strength: "rules-only",
      },
    }));

    expect(result.enforcement).toMatchObject({
      approvalControl: "enforced",
      filesystemSandbox: "not-enforced",
      strength: "rules-only",
    });
  });

  it("does not classify an unauthorized operator-owned mismatch as intentional override", () => {
    const result = classifyTrustedExecutionIntegrity(input({
      persistedNative: { ...currentEvidence, profile: "restricted", source: "native-config", projectionOwnership: "operator-owned" },
      authorization: { status: "unavailable", revocable: true },
    }));

    expect(result.classification).not.toBe("intentional-operator-override");
  });

  it("classifies a broader persisted native policy as dangerous when it lacks authorization", () => {
    expect(classifyTrustedExecutionIntegrity(input({
      desired: { ...currentEvidence, profile: "workspace-write", source: "operator-local-config" },
      persistedNative: { ...currentEvidence, profile: "trusted-full-access", source: "native-config", projectionOwnership: "operator-owned" },
      effectiveRuntime: { ...currentEvidence, profile: "workspace-write" },
      authorization: { status: "unavailable", revocable: true },
    })).classification).toBe("dangerous-unapproved-broadening");
  });

  it.each([
    { desired: { ...currentEvidence, proof: "inferred" as const }, label: "inferred desired" },
    { desired: { ...currentEvidence, source: "desktop-ui-selection" as const }, label: "UI-selected desired" },
    { effectiveRuntime: { ...currentEvidence, source: "native-config" as const }, label: "non-runtime effective source" },
    { authorization: { status: "unavailable" as const, revocable: true }, label: "unauthorized trust" },
  ])("does not report current-verified with $label", (override) => {
    expect(classifyTrustedExecutionIntegrity(input(override)).classification).not.toBe("current-verified");
  });

  it("treats unknown freshness as unproven or partial rather than stale or current", () => {
    const result = classifyTrustedExecutionIntegrity(input({
      effectiveRuntime: { ...currentEvidence, freshness: "unknown" },
    }));

    expect(["effective-policy-unproven", "partial-observation"]).toContain(result.classification);
    expect(result.classification).not.toBe("stale-evidence");
    expect(result.classification).not.toBe("current-verified");
  });

  it("does not report current-verified when optional persisted evidence freshness is unknown", () => {
    expect(classifyTrustedExecutionIntegrity(input({
      persistedNative: {
        ...currentEvidence,
        source: "native-config",
        freshness: "unknown",
        projectionOwnership: "kiln-managed",
      },
    })).classification).not.toBe("current-verified");
  });
});

describe("authorizeTrustedExecutionIntent", () => {
  it("accepts an explicit, revocable operator-local trusted profile", () => {
    expect(authorizeTrustedExecutionIntent({
      source: "operator-local",
      requestedProfile: "trusted-full-access",
      operatorApproved: true,
      revocable: true,
      operatorId: "operator:test",
      authorizedAt: "2026-07-01T14:59:00.000Z",
    })).toMatchObject({ status: "authorized", scope: "operator-local" });
  });

  it.each([
    { operatorId: undefined, authorizedAt: "2026-07-01T14:59:00.000Z", revocable: true },
    { operatorId: "operator:test", authorizedAt: undefined, revocable: true },
    { operatorId: "operator:test", authorizedAt: "2026-07-01T14:59:00.000Z", revocable: false },
  ])("rejects trusted authorization without complete revocable operator evidence %#", (authorization) => {
    expect(authorizeTrustedExecutionIntent({
      source: "operator-local",
      requestedProfile: "trusted-full-access",
      operatorApproved: true,
      ...authorization,
    })).toMatchObject({ status: "rejected" });
  });

  it("rejects repository configuration that attempts to broaden personal authority", () => {
    expect(authorizeTrustedExecutionIntent({
      source: "repository",
      currentProfile: "restricted",
      requestedProfile: "trusted-full-access",
      operatorApproved: false,
      revocable: true,
    })).toMatchObject({
      status: "rejected",
      reason: "repository-cannot-broaden-operator-authority",
    });
  });

  it("allows repository configuration to narrow authority without granting trust", () => {
    expect(authorizeTrustedExecutionIntent({
      source: "repository",
      currentProfile: "trusted-full-access",
      requestedProfile: "restricted",
      operatorApproved: false,
      revocable: true,
    })).toMatchObject({ status: "narrowed", scope: "repository" });
  });

  it.each(["restricted", "workspace-write"] as const)(
    "does not require trust approval for operator-local %s intent",
    (requestedProfile) => {
      expect(authorizeTrustedExecutionIntent({
        source: "operator-local",
        currentProfile: "workspace-write",
        requestedProfile,
        operatorApproved: false,
        revocable: true,
      }).status).not.toBe("rejected");
    },
  );

  it("does not equate a rejected request with dangerous broadening", () => {
    const authorization = authorizeTrustedExecutionIntent({
      source: "operator-local",
      currentProfile: "trusted-full-access",
      requestedProfile: "restricted",
      operatorApproved: false,
      revocable: true,
    });

    expect(authorization).not.toMatchObject({
      status: "rejected",
      reason: "dangerous-unapproved-broadening",
    });
  });
});
