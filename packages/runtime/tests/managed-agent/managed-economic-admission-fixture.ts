import {
  defineEffectiveAuthorityAdmissionBundle,
  type EffectiveAuthorityAdmissionBundle,
} from "../../src/session/effective-authority-admission-bundle.js";

/**
 * Complete, secret-free parent-turn receipt used by managed economic tests.
 *
 * The economic claim persists this exact value, so fixtures must exercise the
 * same JSON-only bundle contract as production.  Callers choose the session
 * and turn identity because the child boundary binds both to its request.
 */
export function managedEconomicAdmissionBundle(input: {
  readonly sessionId: string;
  readonly turnId: string;
  readonly admittedAuthority?: "read_only" | "audited";
}): EffectiveAuthorityAdmissionBundle {
  const admittedAuthority = input.admittedAuthority ?? "audited";
  return defineEffectiveAuthorityAdmissionBundle({
    sessionId: input.sessionId,
    turnId: input.turnId,
    admittedAt: "2026-08-01T00:00:00.000Z",
    configuration: {
      sessionRevision: {
        revisionSetId: "managed-economic-session-revision",
        revisions: { routes: "r1", skills: "s1" },
      },
      turnRevision: {
        revisionSetId: "managed-economic-turn-revision",
        revisions: { routes: "r1", skills: "s1" },
      },
    },
    session: {
      skillCatalog: {
        catalogId: "managed-economic-skills",
        revision: "s1",
        skillIds: [],
      },
      authorityCeiling: {
        maximumAuthority: admittedAuthority,
        reason: "managed economic test parent turn ceiling",
        subjectId: input.sessionId,
      },
    },
    turn: {
      capabilityParticipation: { status: "not-requested" },
      authority: {
        executionMode: "execute",
        requestedAuthority: admittedAuthority,
        admittedAuthority,
        sourcePolicy: "runtime_surface_projection",
        reason: "managed economic test parent turn admission",
        completeness: "authoritative",
        toolCount: 1,
        deniedToolCount: 0,
        sandboxProjection: admittedAuthority === "read_only" ? "read_only" : "workspace_write",
      },
      workGovernance: { status: "not-required" },
      operatorAdoption: { status: "not-required" },
      tools: {
        allowedToolPermissions: [{
          toolName: "managed_agent.invoke",
          authority: {
            level: 1,
            allowed: true,
            requiresApproval: false,
            reason: "managed economic test child dispatch",
          },
          effectEnvelope: {
            operation: "observe",
            boundaries: ["process"],
            reversibility: "reversible",
            dataEgress: "none",
            identityUse: "none",
            consequences: ["local-state"],
            idempotency: "idempotent",
          },
        }],
        deniedToolNames: [],
      },
      effectCeiling: {
        operation: "observe",
        boundaries: ["process"],
        reversibility: "reversible",
        dataEgress: "none",
        identityUse: "none",
        consequences: ["local-state"],
        idempotency: "idempotent",
      },
      budget: { status: "not-configured" },
      execution: { status: "not-routed" },
    },
  });
}

export function managedEconomicAdmissionContract(input: {
  readonly sessionId: string;
  readonly turnId: string;
  readonly admittedAuthority?: "read_only" | "audited";
}): { readonly bundle: EffectiveAuthorityAdmissionBundle } {
  return { bundle: managedEconomicAdmissionBundle(input) };
}
