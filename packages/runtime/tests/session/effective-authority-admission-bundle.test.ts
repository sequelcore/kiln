import { describe, expect, it } from "vitest";
import {
  defineEffectiveAuthorityAdmissionBundle,
  type EffectiveAuthorityAdmissionBundleInput,
} from "../../src/session/effective-authority-admission-bundle.js";

function input(): EffectiveAuthorityAdmissionBundleInput {
  return {
    sessionId: "session-1",
    turnId: "turn-1",
    admittedAt: "2026-08-22T18:00:00.000Z",
    configuration: {
      sessionRevision: { revisionSetId: "R1", revisions: { skills: "s1", routes: "r1" } },
      turnRevision: { revisionSetId: "R2", revisions: { routes: "r2", skills: "s1" } },
    },
    session: {
      skillCatalog: { catalogId: "operator", revision: "skills-r1", skillIds: ["research", "review"] },
      authorityCeiling: { maximumAuthority: "audited", reason: "operator session policy", subjectId: "session-1" },
    },
    turn: {
      authority: {
        executionMode: "execute",
        requestedAuthority: "audited",
        admittedAuthority: "audited",
        sourcePolicy: "runtime_surface_projection",
        reason: "admitted by the attached runtime surface",
        completeness: "authoritative",
        toolCount: 2,
        deniedToolCount: 1,
        sandboxProjection: "workspace_write",
      },
      workGovernance: { status: "not-required" },
      tools: {
        allowedToolNames: ["read_file", "write_file"],
        deniedToolNames: ["delete_repository"],
      },
      budget: {
        status: "admitted",
        reason: "observed-below-limit",
        observation: { observedTokens: 120, source: "session-events" },
      },
      execution: {
        status: "routed",
        route: {
          routeId: "sol",
          providerId: "codex-oauth",
          providerModelId: "gpt-5.6-sol",
          accountSelection: { mode: "exact", accountId: "operator", source: "route" },
        },
        dataPolicy: {
          decision: { status: "admitted", freshness: "current", reason: "policy-admitted" },
        },
        binding: {
          status: "bound",
          routeId: "sol",
          accountId: "operator",
          credentialId: "codex-oauth",
          credentialRevision: "credential-r1",
        },
      },
    },
  };
}

describe("EffectiveAuthorityAdmissionBundle", () => {
  it("creates a deterministic content-addressed plain value", () => {
    const first = defineEffectiveAuthorityAdmissionBundle(input());
    const reordered = input();
    const second = defineEffectiveAuthorityAdmissionBundle({
      ...reordered,
      configuration: {
        ...reordered.configuration,
        turnRevision: { ...reordered.configuration.turnRevision, revisions: { skills: "s1", routes: "r2" } },
      },
    });

    expect(first.admissionId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(second.admissionId).toBe(first.admissionId);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });

  it("detaches and deeply freezes every admitted facet", () => {
    const candidate = input();
    const bundle = defineEffectiveAuthorityAdmissionBundle(candidate);
    (candidate.session.skillCatalog.skillIds as string[]).push("late-skill");
    (candidate.turn.tools.allowedToolNames as string[]).push("late-tool");

    expect(bundle.session.skillCatalog.skillIds).toEqual(["research", "review"]);
    expect(bundle.turn.tools.allowedToolNames).toEqual(["read_file", "write_file"]);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.turn)).toBe(true);
    expect(Object.isFrozen(bundle.turn.execution)).toBe(true);
    expect(Object.isFrozen(bundle.turn.tools.allowedToolNames)).toBe(true);
  });

  it.each([
    ["secret material", { token: "secret-token" }],
    ["filesystem path", { workingDirectory: "C:/private/project" }],
    ["function", { callback: () => undefined }],
    ["Map", { values: new Map([["route", "sol"]]) }],
  ])("rejects %s anywhere in the serializable boundary", (_label, unsafe) => {
    const candidate = input() as EffectiveAuthorityAdmissionBundleInput & { unsafe?: unknown };
    candidate.unsafe = unsafe;
    expect(() => defineEffectiveAuthorityAdmissionBundle(candidate)).toThrow(/plain|secret|path|serializable/iu);
  });

  it("rejects a route binding that does not match the admitted route", () => {
    const candidate = input();
    if (candidate.turn.execution.status !== "routed") throw new Error("invalid fixture");
    (candidate.turn.execution as { binding: typeof candidate.turn.execution.binding }).binding = {
      ...candidate.turn.execution.binding,
      routeId: "other",
    };

    expect(() => defineEffectiveAuthorityAdmissionBundle(candidate)).toThrow(/route.*binding|binding.*route/iu);
  });

  it("rejects authority that exceeds the session ceiling", () => {
    const candidate = input();
    (candidate.session.authorityCeiling as { maximumAuthority: "read_only" | "audited" | "destructive" }).maximumAuthority = "read_only";
    (candidate.turn.authority as { admittedAuthority: "destructive" }).admittedAuthority = "destructive";

    expect(() => defineEffectiveAuthorityAdmissionBundle(candidate)).toThrow(/ceiling|exceed/iu);
  });

  it("rejects overlapping or count-inconsistent tool permissions", () => {
    const overlapping = input();
    (overlapping.turn.tools.deniedToolNames as string[]).push("read_file");
    expect(() => defineEffectiveAuthorityAdmissionBundle(overlapping)).toThrow(/allowed.*denied|overlap/iu);

    const inconsistent = input();
    (inconsistent.turn.authority as { toolCount: number }).toolCount = 1;
    expect(() => defineEffectiveAuthorityAdmissionBundle(inconsistent)).toThrow(/tool.*count/iu);
  });

  it("rejects incomplete work-governance and economic references", () => {
    const governance = input();
    (governance.turn as { workGovernance: typeof governance.turn.workGovernance }).workGovernance = {
      status: "required", kind: "goal", subjectId: "", authorityRevision: "r1",
    };
    expect(() => defineEffectiveAuthorityAdmissionBundle(governance)).toThrow(/subjectId|non-empty/iu);

    const economics = input();
    if (economics.turn.execution.status !== "routed") throw new Error("invalid fixture");
    (economics.turn.execution as { economicCommitment?: { commitmentId: string; authorityRevision: string } }).economicCommitment = {
      commitmentId: "", authorityRevision: "r1",
    };
    expect(() => defineEffectiveAuthorityAdmissionBundle(economics)).toThrow(/commitmentId|non-empty/iu);
  });
});
