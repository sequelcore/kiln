import { describe, expect, it } from "vitest";
import { createPermissionProjectionIntegrity } from "../../src/config/translators/permission-projection.js";

describe("permission projection authorization", () => {
  it("requires an attended lease for full access instead of attaching durable authorization", () => {
    const integrity = createPermissionProjectionIntegrity({
      harness: "codex",
      policy: { approval: "never", sandbox: "danger-full-access" },
      translated: {
        backend: "codex",
        config: { approvalMode: "never", sandboxMode: "danger-full-access" },
        nativeRules: { coarseOnly: true },
        representableRules: [],
        unsupportedRules: [],
        constraintInstructions: [],
        warnings: [],
      },
      enforcement: {
        approvalControl: "enforced",
        filesystemSandbox: "enforced",
        networkBoundary: "enforced",
        strength: "strong",
      },
      now: new Date("2026-08-06T00:00:00.000Z"),
    });
    expect(integrity.authorization).toEqual({
      status: "unavailable",
      revocable: true,
      reason: "attended-session-lease-not-attached-to-native-projection",
    });
    expect(integrity.classification).toBe("effective-policy-unproven");
  });

  it("does not require authorization for a narrower policy", () => {
    const integrity = createPermissionProjectionIntegrity({
      harness: "codex",
      policy: { approval: "never", sandbox: "workspace-write" },
      translated: {
        backend: "codex",
        config: { approvalMode: "never", sandboxMode: "danger-full-access" },
        nativeRules: { coarseOnly: true },
        representableRules: [],
        unsupportedRules: [],
        constraintInstructions: [],
        warnings: [],
      },
      enforcement: {
        approvalControl: "enforced",
        filesystemSandbox: "enforced",
        networkBoundary: "enforced",
        strength: "strong",
      },
      now: new Date("2026-08-06T00:00:00.000Z"),
    });
    expect(integrity.authorization).toEqual({
      status: "unavailable",
      revocable: true,
      reason: "authorization-not-required-for-narrower-policy",
    });
  });
});
