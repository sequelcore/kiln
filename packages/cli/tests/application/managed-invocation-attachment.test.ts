import { describe, expect, it } from "vitest";
import { createKilnRuntimeManagedInvocationAttachment } from "../../src/application/managed-invocation-attachment.js";
import type { ManagedInvocationToolOptions } from "@kilnai/runtime";

function makeStubOptions(): ManagedInvocationToolOptions {
  return { routes: [] };
}

describe("managed invocation attachment factory", () => {
  describe("caller identity", () => {
    it("carries only stable identity when parent authority is resolved per call", () => {
      const attachment = createKilnRuntimeManagedInvocationAttachment("run", makeStubOptions());
      expect(attachment.callerIdentity).toEqual({
        kind: "kiln-runtime",
        surface: "run",
        attachmentId: "kiln-runtime:run",
      });
    });
  });

  it("preserves other attachment fields (options, surface) independent of authority", () => {
    const options = makeStubOptions();
    const attachment = createKilnRuntimeManagedInvocationAttachment("gui", options);
    expect(attachment.options).toBe(options);
    const callerIdentity = attachment.callerIdentity;
    if (callerIdentity.kind !== "kiln-runtime") throw new Error("expected kiln-runtime caller identity");
    expect(callerIdentity.surface).toBe("gui");
  });
});
