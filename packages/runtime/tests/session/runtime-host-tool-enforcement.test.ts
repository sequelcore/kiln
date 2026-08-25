import { describe, expect, it } from "vitest";
import { createBoundHostToolSandbox, SandboxPolicy } from "@kilnai/core/sandbox";
import type { InvocationAdmission } from "@kilnai/core/engine";
import { defineEffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import {
  assertRuntimeHostToolEnforcement,
  createRuntimeHostToolEnforcement,
} from "../../src/session/runtime-host-tool-enforcement.js";

const REVISION = `sha256:${"1".repeat(64)}` as const;
const POLICY = `sha256:${"2".repeat(64)}` as const;

describe("Runtime host tool enforcement", () => {
  it("requires the exact bundle, sandbox, and invocation admission references", () => {
    const sandbox = createBoundHostToolSandbox({
      policy: new SandboxPolicy({
        projectPath: "/tmp/lease",
        config: {
          fsPolicy: "read-write", netPolicy: "none", allowedPaths: ["/tmp/lease"], deniedPaths: [], allowedDomains: [],
        },
      }),
      leaseId: "lease:1",
      configurationRevisionId: REVISION,
      permissionPolicyDigest: POLICY,
    });
    const invocationAdmission: InvocationAdmission = {
      authorize: () => ({ level: 1, allowed: true, requiresApproval: false, reason: "test" }),
    };
    const bundle = defineEffectiveAuthorityAdmissionBundle({
      sessionId: "session", turnId: "turn", admittedAt: "2026-08-25T00:00:00.000Z",
      configuration: {
        sessionRevision: { revisionSetId: REVISION, revisions: { global: "g1" } },
        turnRevision: { revisionSetId: REVISION, revisions: { global: "g1" } },
      },
      session: {
        skillCatalog: { catalogId: "none", revision: "none", skillIds: [] },
        authorityCeiling: { maximumAuthority: "read_only", reason: "test" },
      },
      turn: {
        authority: {
          executionMode: "execute", requestedAuthority: "read_only", admittedAuthority: "fail_closed",
          sourcePolicy: "runtime_surface_projection", reason: "test", completeness: "authoritative", toolCount: 0,
          deniedToolCount: 0,
        },
        workGovernance: { status: "not-required" }, operatorAdoption: { status: "not-required" },
        tools: { allowedToolPermissions: [], deniedToolNames: [], hostEnforcement: sandbox.admission },
        effectCeiling: {
          operation: "observe", boundaries: [], reversibility: "reversible", dataEgress: "none",
          identityUse: "none", consequences: [], idempotency: "idempotent",
        },
        budget: { status: "not-configured" }, execution: { status: "not-routed" },
      },
    });
    const context = createRuntimeHostToolEnforcement({ bundle, sandbox, invocationAdmission });

    expect(assertRuntimeHostToolEnforcement(context, { bundle, sandbox, invocationAdmission })).toBe(context);
    expect(() => assertRuntimeHostToolEnforcement({ ...context }, { bundle, sandbox, invocationAdmission })).toThrow(/process-local/iu);
    expect(() => assertRuntimeHostToolEnforcement(context, {
      bundle,
      sandbox,
      invocationAdmission: { authorize: invocationAdmission.authorize },
    })).toThrow(/invocation admission/iu);
  });
});
