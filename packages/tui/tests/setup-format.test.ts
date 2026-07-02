import { describe, expect, it } from "vitest";
import type { KilnConfigSetupSnapshot } from "@kilnai/gateway-contracts";
import { formatSetupSnapshot } from "../src/setup-format.js";

function setupSnapshot(): KilnConfigSetupSnapshot {
  return {
    projectRoot: "C:/workspace/kiln",
    projectContext: {
      path: "C:/workspace/kiln/.kiln/project-context.md",
      status: "valid",
      recommendation: "none",
    },
    repoShims: [],
    nativeProjections: [],
    permissionIntegrity: [{
      harness: "codex",
      desired: {
        profile: "trusted-full-access",
        source: "operator-local-config",
        observedAt: "2026-07-01T15:00:00.000Z",
        verifiedAt: "2026-07-01T15:00:01.000Z",
        freshness: "current",
        proof: "proven",
      },
      persistedNative: {
        profile: "restricted",
        source: "native-config",
        observedAt: "2026-07-01T15:01:00.000Z",
        verifiedAt: "2026-07-01T15:01:01.000Z",
        freshness: "current",
        proof: "proven",
        projectionOwnership: "kiln-managed",
      },
      effectiveRuntime: {
        profile: "workspace-write",
        source: "runtime-observation",
        observedAt: "2026-07-01T15:02:00.000Z",
        verifiedAt: "2026-07-01T15:02:01.000Z",
        freshness: "current",
        proof: "proven",
      },
      enforcement: {
        approvalControl: "enforced",
        filesystemSandbox: "enforced",
        networkBoundary: "enforced",
        strength: "strong",
      },
      authorization: {
        status: "authorized",
        scope: "operator-local",
        authorizedBy: "operator",
        authorizedAt: "2026-07-01T14:59:00.000Z",
        revocable: true,
      },
      semanticLoss: [],
      classification: "runtime-policy-mismatch",
      recommendation: "Restart Codex with proven Full Access or choose a narrower trusted profile.",
      remediationRequiresApproval: true,
      lastVerifiedAt: "2026-07-01T15:02:01.000Z",
    }],
    recommendedActions: ["none"],
  };
}

describe("formatSetupSnapshot", () => {
  it("prints shared permission integrity evidence for TUI setup status", () => {
    const output = formatSetupSnapshot(setupSnapshot());

    expect(output).toContain("permission integrity:");
    expect(output).toContain("codex: runtime-policy-mismatch");
    expect(output).toContain("desired=trusted-full-access");
    expect(output).toContain("persisted=restricted");
    expect(output).toContain("effective=workspace-write");
    expect(output).toContain("approval required=yes");
    expect(output).toContain("Restart Codex with proven Full Access");
  });
});
