import { describe, expect, it } from "vitest";
import {
  MODEL_FACING_DEFAULT_PERMISSION_POLICY,
  resolveModelFacingPermissionPolicy,
} from "./model-facing-permission-policy.js";

describe("model-facing permission policy", () => {
  it("provides one fail-closed fallback", () => {
    expect(Object.isFrozen(MODEL_FACING_DEFAULT_PERMISSION_POLICY)).toBe(true);
    expect(resolveModelFacingPermissionPolicy(undefined)).toEqual(
      MODEL_FACING_DEFAULT_PERMISSION_POLICY,
    );
    expect(MODEL_FACING_DEFAULT_PERMISSION_POLICY).toEqual({
      approval: "on-request",
      sandbox: "read-only",
      safeDefaults: true,
      auditLog: true,
    });
  });

  it("preserves explicit operator fields and fills omitted model-facing defaults", () => {
    const configured = {
      approval: "untrusted" as const,
      sandbox: "read-only" as const,
      safeDefaults: false,
      auditLog: false,
    };
    expect(resolveModelFacingPermissionPolicy(configured)).toEqual(configured);
    expect(resolveModelFacingPermissionPolicy({
      approval: "untrusted",
      sandbox: "read-only",
    })).toEqual({
      approval: "untrusted",
      sandbox: "read-only",
      safeDefaults: true,
      auditLog: true,
    });
  });

});
