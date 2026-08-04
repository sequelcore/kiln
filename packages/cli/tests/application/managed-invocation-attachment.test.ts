import { describe, expect, it } from "vitest";
import { createKilnRuntimeManagedInvocationAttachment } from "../../src/application/managed-invocation-attachment.js";
import type { ManagedInvocationToolOptions } from "@kilnai/runtime";

function makeStubOptions(): ManagedInvocationToolOptions {
  return { routes: [] };
}

describe("managed invocation attachment factory", () => {
  describe("caller identity parentEffectiveRequestedAuthority", () => {
    it("includes parentEffectiveRequestedAuthority when the resolved value is read_only (plan-mode contract)", () => {
      // This is the threading contract that closes the 1.1 security bug.
      // The CLI must resolve the effective authority (plan ? "read_only" : raw flag)
      // BEFORE calling the factory, and pass the resolved value here.
      const attachment = createKilnRuntimeManagedInvocationAttachment(
        "run",
        makeStubOptions(),
        "read_only",
      );
      expect(attachment.callerIdentity).toMatchObject({
        kind: "kiln-runtime",
        surface: "run",
        attachmentId: "kiln-runtime:run",
        parentEffectiveRequestedAuthority: "read_only",
      });
    });

    it("includes parentEffectiveRequestedAuthority when the resolved value is destructive", () => {
      const attachment = createKilnRuntimeManagedInvocationAttachment(
        "run",
        makeStubOptions(),
        "destructive",
      );
      expect(attachment.callerIdentity).toMatchObject({
        kind: "kiln-runtime",
        surface: "run",
        attachmentId: "kiln-runtime:run",
        parentEffectiveRequestedAuthority: "destructive",
      });
    });

    it("omits parentEffectiveRequestedAuthority when undefined (most-permissive path for non-plan sessions without --authority)", () => {
      // This is the deliberate most-permissive path.
      // When the operator runs without --plan and without --authority,
      // no authority narrowing is applied to child dispatches.
      const attachment = createKilnRuntimeManagedInvocationAttachment(
        "run",
        makeStubOptions(),
        undefined,
      );
      expect(attachment.callerIdentity).toMatchObject({
        kind: "kiln-runtime",
        surface: "run",
        attachmentId: "kiln-runtime:run",
      });
      expect(attachment.callerIdentity).not.toHaveProperty("parentEffectiveRequestedAuthority");
    });
  });

  it("preserves other attachment fields (options, surface) independent of authority", () => {
    const options = makeStubOptions();
    const attachment = createKilnRuntimeManagedInvocationAttachment("gui", options, "read_only");
    expect(attachment.options).toBe(options);
    expect(attachment.callerIdentity.surface).toBe("gui");
  });
});
