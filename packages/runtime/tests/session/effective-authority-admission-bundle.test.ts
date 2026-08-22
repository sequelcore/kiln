import { describe, expect, it } from "vitest";
import {
  applyEffectiveAuthorityAdmissionBundleToPerCallConfig,
  defineEffectiveAuthorityAdmissionBundle,
  projectToolPermissionAdmissionFromPerCallConfig,
  type EffectiveAuthorityAdmissionBundleInput,
} from "../../src/session/effective-authority-admission-bundle.js";
import type { PerCallToolConfig } from "../../src/session/runtime-session-orchestrator.types.js";
import type { ActionEffectEnvelope, AuthorityDescriptor, Capability } from "@kilnai/core";
import { canonicalTurnId, createOperatorAdoptionDecisionAuthority } from "@kilnai/core/events";

const READ_AUTHORITY: AuthorityDescriptor = { level: 1, allowed: true, requiresApproval: false, reason: "read-only tool admitted" };
const WRITE_AUTHORITY: AuthorityDescriptor = { level: 2, allowed: true, requiresApproval: false, reason: "audited tool admitted" };
const READ_EFFECT: ActionEffectEnvelope = { operation: "observe", boundaries: ["workspace"], reversibility: "reversible", dataEgress: "none", identityUse: "none", consequences: ["local-state"], idempotency: "idempotent" };
const WRITE_EFFECT: ActionEffectEnvelope = { operation: "mutate", boundaries: ["workspace"], reversibility: "reversible", dataEgress: "none", identityUse: "none", consequences: ["local-state"], idempotency: "idempotent" };
const WORKSPACE_WRITE_CEILING: ActionEffectEnvelope = { operation: "mutate", boundaries: ["workspace"], reversibility: "irreversible", dataEgress: "project-data", identityUse: "authenticated", consequences: ["local-state"], idempotency: "non-idempotent" };
const READ_ONLY_CEILING: ActionEffectEnvelope = { operation: "observe", boundaries: ["workspace"], reversibility: "reversible", dataEgress: "metadata", identityUse: "none", consequences: ["local-state"], idempotency: "idempotent" };

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
      operatorAdoption: { status: "not-required" },
      tools: {
        allowedToolPermissions: [
          { toolName: "read_file", authority: READ_AUTHORITY, effectEnvelope: READ_EFFECT },
          { toolName: "write_file", authority: WRITE_AUTHORITY, effectEnvelope: WRITE_EFFECT },
        ],
        deniedToolNames: ["delete_repository"],
      },
      effectCeiling: WORKSPACE_WRITE_CEILING,
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
  it("requires an explicit adoption outcome and preserves the non-authority outcome", () => {
    const bundle = defineEffectiveAuthorityAdmissionBundle(input());
    expect(bundle.turn.operatorAdoption).toEqual({ status: "not-required" });
    expect(Object.isFrozen(bundle.turn.operatorAdoption)).toBe(true);
    expect(JSON.stringify(bundle)).not.toMatch(/secret|credentialMaterial/iu);
  });

  it("admits the Core adoption decision only when it names this session and canonical turn", () => {
    const turnId = canonicalTurnId("session-1", 1);
    const decision = createOperatorAdoptionDecisionAuthority({
      ownerSessionId: "session-1",
      operatorTurnId: turnId,
      actorId: "operator",
    });
    const bundle = defineEffectiveAuthorityAdmissionBundle({
      ...input(),
      turnId,
      turn: { ...input().turn, operatorAdoption: { status: "admitted", decision } },
    });
    expect(bundle.turn.operatorAdoption).toEqual({ status: "admitted", decision });
    expect(Object.isFrozen(bundle.turn.operatorAdoption)).toBe(true);

    const mismatchedSession = { ...decision, ownerSessionId: "other-session" };
    expect(() => defineEffectiveAuthorityAdmissionBundle({
      ...input(), turnId, turn: { ...input().turn, operatorAdoption: { status: "admitted", decision: mismatchedSession } },
    })).toThrow(/owner session.*match/iu);
    expect(() => defineEffectiveAuthorityAdmissionBundle({
      ...input(), turnId: "session-1:turn:2", turn: { ...input().turn, operatorAdoption: { status: "admitted", decision } },
    })).toThrow(/canonical turn.*match/iu);

    const forged = {
      ...decision,
      decisionId: "forged-decision",
      contractAuthority: { ...decision.contractAuthority, decisionId: "forged-decision" },
    };
    expect(() => defineEffectiveAuthorityAdmissionBundle({
      ...input(), turnId, turn: { ...input().turn, operatorAdoption: { status: "admitted", decision: forged } },
    })).toThrow(/canonical Core decision identity/iu);

    expect(() => defineEffectiveAuthorityAdmissionBundle({
      ...input(), turnId,
      turn: {
        ...input().turn,
        operatorAdoption: { status: "admitted", decision },
        workGovernance: { status: "required", kind: "goal", subjectId: "other", authorityRevision: "other" },
      },
    })).toThrow(/work governance.*operator-adoption/iu);
    expect(() => defineEffectiveAuthorityAdmissionBundle({
      ...input(),
      turn: {
        ...input().turn,
        operatorAdoption: { status: "not-required" },
        workGovernance: { status: "required", kind: "goal", subjectId: "other", authorityRevision: "other" },
      },
    })).toThrow(/work governance.*operator-adoption/iu);
  });

  it("transports an admitted adoption decision through the temporary per-call seam", () => {
    const turnId = canonicalTurnId("session-1", 1);
    const decision = createOperatorAdoptionDecisionAuthority({
      ownerSessionId: "session-1", operatorTurnId: turnId, actorId: "operator",
    });
    const bundle = defineEffectiveAuthorityAdmissionBundle({
      ...input(), turnId,
      turn: { ...input().turn, operatorAdoption: { status: "admitted", decision } },
    });
    const projected = applyEffectiveAuthorityAdmissionBundleToPerCallConfig(bundle, {
      perCallCapabilities: new Map(bundle.turn.tools.allowedToolPermissions.map((entry) => [entry.toolName, {
        name: entry.toolName, description: entry.toolName, schema: {}, tags: [], effectEnvelope: entry.effectEnvelope,
      }])),
    });
    expect(projected.operatorAdoptionDecision).toEqual(decision);
    expect(() => applyEffectiveAuthorityAdmissionBundleToPerCallConfig(bundle, {
      operatorAdoptionDecision: createOperatorAdoptionDecisionAuthority({
        ownerSessionId: "session-1", operatorTurnId: turnId, actorId: "different-operator",
      }),
    })).toThrow(/operator-adoption.*mismatch/iu);
  });

  it("projects exact execution facets from the committed bundle over matching legacy transport", () => {
    const bundle = defineEffectiveAuthorityAdmissionBundle(input());
    const capabilities = new Map<string, Capability>(bundle.turn.tools.allowedToolPermissions.map((entry) => [entry.toolName, {
      name: entry.toolName, description: entry.toolName, schema: { type: "object" }, tags: [], effectEnvelope: entry.effectEnvelope,
    }]));
    const legacy = {
      toolAllowlist: new Set(["read_file", "write_file"]),
      toolAuthority: new Map([["read_file", READ_AUTHORITY], ["write_file", WRITE_AUTHORITY]]),
      perCallCapabilities: capabilities,
      effectiveTurnAuthority: bundle.turn.authority,
      runtimeConfigurationRevision: bundle.configuration.turnRevision,
      executionBinding: bundle.turn.execution.status === "routed" ? bundle.turn.execution.binding : undefined,
      additionalTools: [
        { name: "read_file", description: "read", inputSchema: { type: "object" } },
        { name: "write_file", description: "write", inputSchema: { type: "object" } },
        { name: "unadmitted", description: "extra", inputSchema: { type: "object" } },
      ],
      toolCallMetadata: new Map([
        ["read_file", () => ({})],
        ["unadmitted", () => ({})],
      ]),
    } satisfies PerCallToolConfig;

    const projected = applyEffectiveAuthorityAdmissionBundleToPerCallConfig(bundle, legacy);
    expect([...projected.toolAllowlist ?? []]).toEqual(["read_file", "write_file"]);
    expect(projected.toolAuthority?.get("write_file")).toEqual(WRITE_AUTHORITY);
    expect(projected.perCallCapabilities?.get("write_file")?.effectEnvelope).toEqual(WRITE_EFFECT);
    expect(projected.effectiveTurnAuthority).toEqual(bundle.turn.authority);
    expect(projected.runtimeConfigurationRevision).toEqual(bundle.configuration.turnRevision);
    expect(projected.admittedExecutionRoute).toEqual(
      bundle.turn.execution.status === "routed" ? bundle.turn.execution.route : undefined,
    );
    expect(projected.additionalTools?.map((tool) => tool.name)).toEqual(["read_file", "write_file"]);
    expect([...projected.toolCallMetadata?.keys() ?? []]).toEqual(["read_file"]);
  });

  it("rejects a mismatched legacy authority transport during migration", () => {
    const bundle = defineEffectiveAuthorityAdmissionBundle(input());
    expect(() => applyEffectiveAuthorityAdmissionBundleToPerCallConfig(bundle, {
      toolAllowlist: new Set(["read_file"]),
    })).toThrow(/mismatch/iu);
    expect(() => applyEffectiveAuthorityAdmissionBundleToPerCallConfig(bundle, {
      admittedExecutionRoute: {
        routeId: "other-route",
        providerId: "other-provider",
        providerModelId: "other-model",
      },
    })).toThrow(/route mismatch/iu);
  });

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
    (candidate.turn.tools.allowedToolPermissions as unknown as unknown[]).push({
      toolName: "late-tool", authority: READ_AUTHORITY, effectEnvelope: READ_EFFECT,
    });

    expect(bundle.session.skillCatalog.skillIds).toEqual(["research", "review"]);
    expect(bundle.turn.tools.allowedToolPermissions.map((entry) => entry.toolName)).toEqual(["read_file", "write_file"]);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.turn)).toBe(true);
    expect(Object.isFrozen(bundle.turn.execution)).toBe(true);
    expect(Object.isFrozen(bundle.turn.tools.allowedToolPermissions)).toBe(true);
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

  it("rejects a descriptor authority above the admitted turn authority", () => {
    const candidate = input();
    (candidate.turn.authority as { admittedAuthority: "read_only" }).admittedAuthority = "read_only";
    expect(() => defineEffectiveAuthorityAdmissionBundle(candidate)).toThrow(/descriptor.*authority|turn authority|overreach/iu);
  });

  it("rejects an effect envelope incompatible with the explicit turn effect ceiling", () => {
    const candidate = input();
    (candidate.turn as { effectCeiling: ActionEffectEnvelope }).effectCeiling = READ_ONLY_CEILING;
    expect(() => defineEffectiveAuthorityAdmissionBundle(candidate)).toThrow(/effect.*ceiling|narrow/iu);
  });

  it("preserves approval-gated descriptors as conditional permissions", () => {
    const candidate = input();
    const permissions = candidate.turn.tools.allowedToolPermissions as Array<{
      toolName: string; authority: AuthorityDescriptor; effectEnvelope: ActionEffectEnvelope;
    }>;
    permissions[0] = { ...permissions[0]!, authority: { level: 3, allowed: false, requiresApproval: true, reason: "operator approval required" } };
    expect(defineEffectiveAuthorityAdmissionBundle(candidate).turn.tools.allowedToolPermissions[0]?.authority).toMatchObject({ allowed: false, requiresApproval: true });
  });

  it("projects exact descriptor and declared effect from the per-call owner maps", () => {
    const capabilities = new Map<string, Capability>([
      ["read_file", { name: "read_file", description: "read", schema: {}, tags: [], effectEnvelope: READ_EFFECT }],
      ["write_file", { name: "write_file", description: "write", schema: {}, tags: [], effectEnvelope: WRITE_EFFECT }],
    ]);
    const projected = projectToolPermissionAdmissionFromPerCallConfig({
      candidateToolNames: ["write_file", "read_file", "delete_repository"],
      config: {
        toolAllowlist: new Set(["write_file", "read_file"]),
        toolAuthority: new Map([["read_file", READ_AUTHORITY], ["write_file", WRITE_AUTHORITY]]),
        perCallCapabilities: capabilities,
      },
    });
    expect(projected).toEqual({
      allowedToolPermissions: [
        { toolName: "read_file", authority: READ_AUTHORITY, effectEnvelope: READ_EFFECT },
        { toolName: "write_file", authority: WRITE_AUTHORITY, effectEnvelope: WRITE_EFFECT },
      ],
      deniedToolNames: ["delete_repository"],
    });
  });

  it("projects approval-gated descriptors only when the capability owns the approval tag", () => {
    const approvalAuthority: AuthorityDescriptor = {
      level: 3,
      allowed: false,
      requiresApproval: true,
      reason: "operator approval required",
    };
    const approvalCapability: Capability = {
      name: "deploy_preview",
      description: "deploy preview",
      schema: {},
      tags: ["operator-approval"],
      effectEnvelope: WRITE_EFFECT,
    };
    const projected = projectToolPermissionAdmissionFromPerCallConfig({
      candidateToolNames: ["deploy_preview"],
      config: {
        toolAllowlist: new Set(["deploy_preview"]),
        toolAuthority: new Map([["deploy_preview", approvalAuthority]]),
        perCallCapabilities: new Map([["deploy_preview", approvalCapability]]),
      },
    });
    expect(projected.allowedToolPermissions[0]?.authority).toEqual(approvalAuthority);

    expect(() => projectToolPermissionAdmissionFromPerCallConfig({
      candidateToolNames: ["deploy_preview"],
      config: {
        toolAllowlist: new Set(["deploy_preview"]),
        toolAuthority: new Map([["deploy_preview", approvalAuthority]]),
        perCallCapabilities: new Map([["deploy_preview", { ...approvalCapability, tags: [] }]]),
      },
    })).toThrow(/approval.*tag/iu);
  });

  it.each([
    ["descriptor", { toolAuthority: new Map(), perCallCapabilities: new Map([["read_file", { name: "read_file", description: "read", schema: {}, tags: [], effectEnvelope: READ_EFFECT }]]) }],
    ["effect ceiling", { toolAuthority: new Map([["read_file", READ_AUTHORITY]]), perCallCapabilities: new Map([["read_file", { name: "read_file", description: "read", schema: {}, tags: [] }]]) }],
  ])("fails closed when a projected %s is missing", (_label, ownerMaps) => {
    expect(() => projectToolPermissionAdmissionFromPerCallConfig({
      candidateToolNames: ["read_file"],
      config: { toolAllowlist: new Set(["read_file"]), ...ownerMaps },
    })).toThrow(/descriptor|effect|ceiling|admission/iu);
  });

  it("rejects incomplete work-governance and economic references", () => {
    const governance = input();
    (governance.turn as { workGovernance: typeof governance.turn.workGovernance }).workGovernance = {
      status: "required", kind: "goal", subjectId: "", authorityRevision: "r1",
    };
    expect(() => defineEffectiveAuthorityAdmissionBundle(governance)).toThrow(/subjectId|non-empty|operator-adoption/iu);

    const economics = input();
    if (economics.turn.execution.status !== "routed") throw new Error("invalid fixture");
    (economics.turn.execution as { economicCommitment?: { commitmentId: string; authorityRevision: string } }).economicCommitment = {
      commitmentId: "", authorityRevision: "r1",
    };
    expect(() => defineEffectiveAuthorityAdmissionBundle(economics)).toThrow(/commitmentId|non-empty/iu);
  });
});
