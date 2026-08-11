import { describe, expect, it } from "vitest";
import { buildComposerTurnOptions } from "../src/components/app-shell-composer-submission.js";

describe("buildComposerTurnOptions", () => {
  it("projects fixed deliberation fail-closed and the exact requested authority", () => {
    expect(buildComposerTurnOptions({
      selectedDeliberationLevel: "high",
      requestedAuthority: "audited",
      governedWorkItemCount: 4,
      gatewayTargetId: "target-1",
      appName: "console",
      tenantId: "tenant-1",
    })).toEqual({
      deliberationIntent: {
        mode: "fixed",
        preferredLevel: "high",
        onUnsupported: "deny",
      },
      requestedAuthority: "audited",
      governedWorkRequirement: {
        kind: "goal_materialization",
        requiredWorkItemCount: 4,
      },
      gatewayTargetId: "target-1",
      appName: "console",
      tenantId: "tenant-1",
    });
  });

  it("omits optional policy and routing evidence instead of inventing defaults", () => {
    expect(buildComposerTurnOptions({
      selectedDeliberationLevel: null,
      requestedAuthority: "auto",
      governedWorkItemCount: null,
    })).toEqual({ requestedAuthority: "auto" });
  });
});
