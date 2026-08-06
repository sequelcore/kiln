import { describe, expect, it } from "vitest";
import { createPermissionProjectionIntegrity } from "../../src/config/translators/permission-projection.js";

describe("permission projection authorization", () => {
  it("attaches a matching stored full-access authorization", () => {
    const integrity = createPermissionProjectionIntegrity({
      harness: "codex",
      policy: { approval: "never", sandbox: "danger-full-access" },
      translated: {
        backend: "codex",
        config: {},
        nativeRules: {},
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
      storedAuthorization: {
        profile: "trusted-full-access",
        authorization: {
          status: "authorized",
          scope: "operator-local",
          revocable: true,
          authorizedBy: "operator:test",
          authorizedAt: "2026-08-06T00:00:00.000Z",
        },
      },
    });
    expect(integrity.authorization).toMatchObject({ status: "authorized", authorizedBy: "operator:test" });
  });

  it("falls back to unavailable when the stored authorization profile does not match", () => {
    const integrity = createPermissionProjectionIntegrity({
      harness: "codex",
      policy: { approval: "never", sandbox: "workspace-write" },
      translated: {
        backend: "codex",
        config: {},
        nativeRules: {},
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
      storedAuthorization: {
        profile: "trusted-full-access",
        authorization: {
          status: "authorized",
          scope: "operator-local",
          revocable: true,
          authorizedBy: "operator:test",
          authorizedAt: "2026-08-06T00:00:00.000Z",
        },
      },
    });
    expect(integrity.authorization).toMatchObject({ status: "unavailable" });
  });
});
