import { describe, expect, it } from "vitest";
import { createBoundHostToolSandbox, SandboxPolicy } from "@kilnai/core/sandbox";
import type { InvocationAdmission } from "@kilnai/core/engine";
import { defineEffectiveAuthorityAdmissionBundle } from "../../src/session/effective-authority-admission-bundle.js";
import {
  assertRuntimeHostToolEnforcement,
  createRuntimeHostToolEnforcement,
  deriveRuntimeHostToolEnforcement,
  resolveRuntimeHostToolEnforcement,
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
        capabilityParticipation: { status: "not-requested" },
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

describe("Runtime host enforcement attenuation", () => {
  it("intersects child and grandchild sandbox policies while retaining the parent lineage", () => {
    const parentPolicy = new SandboxPolicy({
      projectPath: "/tmp/lease",
      config: {
        fsPolicy: "read-write",
        netPolicy: "documentation",
        allowedPaths: ["/tmp/lease"],
        deniedPaths: ["/tmp/lease/child/parent-deny"],
        allowedDomains: ["example.com"],
      },
    });
    const sandbox = createBoundHostToolSandbox({
      policy: parentPolicy,
      leaseId: "lease:attenuation",
      configurationRevisionId: REVISION,
      permissionPolicyDigest: POLICY,
    });
    const invocationAdmission: InvocationAdmission = {
      authorize: ({ toolName }) => ({ level: 3, allowed: toolName !== "parent-deny", requiresApproval: true, reason: "parent" }),
    };
    const bundle = defineEffectiveAuthorityAdmissionBundle({
      sessionId: "session",
      turnId: "turn",
      admittedAt: "2026-08-25T00:00:00.000Z",
      configuration: {
        sessionRevision: { revisionSetId: REVISION, revisions: { global: "g1" } },
        turnRevision: { revisionSetId: REVISION, revisions: { global: "g1" } },
      },
      session: {
        skillCatalog: { catalogId: "none", revision: "none", skillIds: [] },
        authorityCeiling: { maximumAuthority: "read_only", reason: "test" },
      },
      turn: {
        capabilityParticipation: { status: "not-requested" },
        authority: {
          executionMode: "execute",
          requestedAuthority: "read_only",
          admittedAuthority: "fail_closed",
          sourcePolicy: "runtime_surface_projection",
          reason: "test",
          completeness: "authoritative",
          toolCount: 0,
          deniedToolCount: 0,
        },
        workGovernance: { status: "not-required" },
        operatorAdoption: { status: "not-required" },
        tools: { allowedToolPermissions: [], deniedToolNames: [], hostEnforcement: sandbox.admission },
        effectCeiling: {
          operation: "observe",
          boundaries: [],
          reversibility: "reversible",
          dataEgress: "none",
          identityUse: "none",
          consequences: [],
          idempotency: "idempotent",
        },
        budget: { status: "not-configured" },
        execution: { status: "not-routed" },
      },
    });
    const parent = createRuntimeHostToolEnforcement({ bundle, sandbox, invocationAdmission });
    const child = deriveRuntimeHostToolEnforcement({
      parent,
      bundle,
      childInvocationAdmission: {
        authorize: ({ toolName }) => ({ level: 1, allowed: toolName !== "child-deny", requiresApproval: false, reason: "child" }),
      },
      childPolicy: new SandboxPolicy({
        projectPath: "/tmp/lease/child",
        config: {
          fsPolicy: "read-write",
          netPolicy: "full",
          allowedPaths: ["/tmp/lease/child"],
          deniedPaths: [],
          allowedDomains: ["*"],
        },
      }),
    });
    const childBinding = resolveRuntimeHostToolEnforcement(child, { bundle });
    expect(childBinding.parent?.sandbox).toBe(sandbox);
    expect(childBinding.sandbox.policy.canRead("/tmp/lease/child/file")).toBe(true);
    expect(childBinding.sandbox.policy.canRead("/tmp/lease/child/parent-deny/file")).toBe(false);
    expect(childBinding.sandbox.policy.canWrite("/tmp/lease/child/parent-deny/file")).toBe(false);
    expect(childBinding.sandbox.policy.canAccess("example.com")).toBe(true);
    expect(childBinding.sandbox.policy.canAccess("untrusted.test")).toBe(false);
    const authorize = (toolName: string) => childBinding.invocationAdmission.authorize({
      toolName,
      toolInput: {},
      resolvedEffect: bundle.turn.effectCeiling,
    });
    expect(authorize("read")).toMatchObject({ level: 3, allowed: true, requiresApproval: true });
    expect(authorize("parent-deny")).toMatchObject({ allowed: false });
    expect(authorize("child-deny")).toMatchObject({ allowed: false });
    expect(() => resolveRuntimeHostToolEnforcement({ ...child }, { bundle })).toThrow(/process-local/iu);
    expect(() => resolveRuntimeHostToolEnforcement(child, { bundle: { ...bundle } })).toThrow(/another authority/iu);


    const grandchild = deriveRuntimeHostToolEnforcement({
      parent: child,
      bundle,
      childPolicy: new SandboxPolicy({
        projectPath: "/tmp/lease/child",
        config: {
          fsPolicy: "read-write",
          netPolicy: "full",
          allowedPaths: ["/tmp/lease/child"],
          deniedPaths: ["/tmp/lease/child/grandchild-deny"],
          allowedDomains: ["*"],
        },
      }),
    });
    const grandchildBinding = resolveRuntimeHostToolEnforcement(grandchild, { bundle });
    expect(grandchildBinding.parent?.sandbox).toBe(childBinding.sandbox);
    expect(grandchildBinding.sandbox.policy.canRead("/tmp/lease/child/parent-deny/file")).toBe(false);
    expect(grandchildBinding.sandbox.policy.canRead("/tmp/lease/child/grandchild-deny/file")).toBe(false);

    const sameChildPolicyAgain = deriveRuntimeHostToolEnforcement({
      parent: child,
      bundle,
      childPolicy: new SandboxPolicy({
        projectPath: "/tmp/lease/child",
        config: {
          fsPolicy: "read-write",
          netPolicy: "full",
          allowedPaths: ["/tmp/lease/child"],
          deniedPaths: [],
          allowedDomains: ["*"],
        },
      }),
    });
    const repeatedBinding = resolveRuntimeHostToolEnforcement(sameChildPolicyAgain, { bundle });
    expect(repeatedBinding.sandbox.admission.sandboxId).not.toBe(childBinding.sandbox.admission.sandboxId);
    expect(repeatedBinding.sandbox.admission.policyDigest).not.toBe(childBinding.sandbox.admission.policyDigest);
  });
});
