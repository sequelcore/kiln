import type { ActionEffectEnvelope, Capability } from "@kilnai/core";
import { describe, expect, it } from "vitest";
import { defineOperatorAuthorityAdmissionFacets } from "../../src/execution-routing/operator-authority-admission-facets.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";

const READ: ActionEffectEnvelope = {
  operation: "observe", boundaries: ["workspace"], reversibility: "reversible", dataEgress: "none",
  identityUse: "none", consequences: ["local-state"], idempotency: "idempotent",
};
const WRITE: ActionEffectEnvelope = {
  operation: "mutate", boundaries: ["workspace"], reversibility: "compensatable", dataEgress: "metadata",
  identityUse: "authenticated", consequences: ["local-state"], idempotency: "conditionally-idempotent",
};

function capability(name: string, effectEnvelope: ActionEffectEnvelope): Capability {
  return { name, description: name, schema: {}, tags: [], effectEnvelope };
}

describe("defineOperatorAuthorityAdmissionFacets", () => {
  it("projects the exact owner maps and derives their least upper effect ceiling", () => {
    const session = new RuntimeSession({ appName: "app", tenantId: "tenant", userId: "user", systemPrompt: "system", sessionId: "session-1" });
    const result = defineOperatorAuthorityAdmissionFacets({
      executionId: "turn-1",
      session,
      snapshot: { catalog: {} as never, configurationRevision: { revisionSetId: "R1", revisions: { project: "p1" } } },
      candidateToolNames: ["write_file", "read_file", "delete_file"],
      skillCatalog: { catalogId: "operator", revision: "skills-r1", skillIds: [] },
      authorityCeiling: { maximumAuthority: "destructive", reason: "test session ceiling" },
      operatorAdoption: { status: "not-required" },
      perCallConfig: {
        toolAllowlist: new Set(["write_file", "read_file"]),
        toolAuthority: new Map([
          ["read_file", { level: 1, allowed: true, requiresApproval: false, reason: "read" }],
          ["write_file", { level: 2, allowed: true, requiresApproval: false, reason: "write" }],
        ]),
        perCallCapabilities: new Map([
          ["read_file", capability("read_file", READ)], ["write_file", capability("write_file", WRITE)],
        ]),
        effectiveTurnAuthority: {
          executionMode: "execute", requestedAuthority: "audited", admittedAuthority: "audited",
          sourcePolicy: "runtime_surface_projection", reason: "admitted", completeness: "authoritative",
          toolCount: 2, deniedToolCount: 1, sandboxProjection: "workspace_write",
        },
      },
    });
    expect(result.turn.tools.allowedToolPermissions.map((entry) => entry.toolName)).toEqual(["read_file", "write_file"]);
    expect(result.turn.tools.deniedToolNames).toEqual(["delete_file"]);
    expect(result.turn.effectCeiling).toEqual(WRITE);
    expect(result.sessionRevision.revisionSetId).toBe("R1");
    expect(result.session.skillCatalog.skillIds).toEqual([]);
  });

  it("fails closed on partial authority projection", () => {
    const session = new RuntimeSession({ appName: "app", tenantId: "tenant", userId: "user", systemPrompt: "system" });
    expect(() => defineOperatorAuthorityAdmissionFacets({
      executionId: "turn-1", session,
      snapshot: { catalog: {} as never, configurationRevision: { revisionSetId: "R1", revisions: { project: "p1" } } },
      candidateToolNames: [], perCallConfig: {},
      skillCatalog: { catalogId: "operator", revision: "skills-r1", skillIds: [] },
      authorityCeiling: { maximumAuthority: "destructive", reason: "test session ceiling" },
      operatorAdoption: { status: "not-required" },
    })).toThrow(/incomplete/iu);
  });
});
