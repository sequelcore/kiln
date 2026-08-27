import { describe, expect, it } from "vitest";
import type { ExecutionTargetCatalog, ExecutionTargetDataPolicyEvidence } from "@kilnai/core/agents";
import {
  ExecutionTargetDataPolicyAuthority,
  evaluateExecutionTargetDataPolicy,
} from "../../src/execution-routing/execution-target-data-policy-authority.js";

const evidence = (): ExecutionTargetDataPolicyEvidence => ({
  providerId: "opencode-go", providerModelId: "deepseek-v4-flash", dataUse: "not-used",
  trainingPosture: "prohibited", retention: { posture: "zero", days: 0 },
  permittedMaximumClassification: "confidential", permittedClassifications: ["public", "internal", "confidential"],
  sourceIdentity: "opencode-go-privacy", sourceRevision: "2026-08-01",
  sourceDigest: `sha256:${"c".repeat(64)}`, observedAt: "2026-08-01T00:00:00.000Z", expiresAt: "2026-08-31T00:00:00.000Z",
});

function catalog(policy = evidence()): ExecutionTargetCatalog {
  return { accounts: [], accountPolicies: [], targets: [{
    id: "deepseek-scout", label: "DeepSeek Scout", providerId: "opencode-go", providerModelId: "deepseek-v4-flash",
    dataClassification: "confidential", dataPolicyEvidence: policy,
    accountPolicyId: "scout-policy", economics: {} as never,
  }] };
}

describe("ExecutionTargetDataPolicyAuthority", () => {
  it("returns a sanitized current decision for the exact direct identity", () => {
    const authority = new ExecutionTargetDataPolicyAuthority({ catalog: catalog(), now: () => new Date("2026-08-15T00:00:00.000Z") });
    expect(authority.evaluate({ targetId: "deepseek-scout", providerId: "opencode-go", providerModelId: "deepseek-v4-flash" })).toEqual({
      decision: { status: "admitted", freshness: "current", reason: "policy-admitted" },
      evidence: {
        providerId: "opencode-go", providerModelId: "deepseek-v4-flash", sourceIdentity: "opencode-go-privacy",
        sourceRevision: "2026-08-01", sourceDigest: `sha256:${"c".repeat(64)}`,
        trainingPosture: "prohibited", retentionPosture: "zero", retentionDays: 0,
        maximumClassification: "confidential", observedAt: "2026-08-01T00:00:00.000Z", expiresAt: "2026-08-31T00:00:00.000Z",
      },
    });
  });

  it("denies drift without accepting caller-controlled classification", () => {
    const authority = new ExecutionTargetDataPolicyAuthority({ catalog: catalog(), now: () => new Date("2026-08-15T00:00:00.000Z") });
    const result = authority.evaluate({ targetId: "deepseek-scout", providerId: "native-opencode", providerModelId: "deepseek-v4-flash" });
    expect(result.decision).toEqual({ status: "denied", freshness: "current", reason: "provider-mismatch" });
    expect(JSON.stringify(result)).not.toMatch(/secret|payload|content|path/iu);
  });

  it("evaluates a harness target without fabricating account-backed route fields", () => {
    expect(evaluateExecutionTargetDataPolicy({
      targetId: "native-codex",
      providerId: "opencode-go",
      providerModelId: "deepseek-v4-flash",
      requestedClassification: "internal",
      evidence: evidence(),
      now: new Date("2026-08-15T00:00:00.000Z"),
    })).toMatchObject({
      decision: { status: "admitted", freshness: "current", reason: "policy-admitted" },
      evidence: { sourceIdentity: "opencode-go-privacy" },
    });
  });
});
