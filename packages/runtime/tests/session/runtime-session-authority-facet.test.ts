import { describe, expect, it } from "vitest";
import { RuntimeSession } from "../../src/session/runtime-session.js";
import {
  defineRuntimeSessionAuthorityFacet,
  type RuntimeSessionAuthorityFacetInput,
} from "../../src/session/runtime-session-authority-facet.js";
import { serializeSession, deserializeSession } from "../../src/session/persistence/session-serializer.js";

function makeFacet(sessionId = "session-1"): RuntimeSessionAuthorityFacetInput {
  return {
    sessionId,
    sessionRevision: { revisionSetId: "R1", revisions: { skills: "skills-r1", routes: "routes-r1" } },
    skillCatalog: { catalogId: "operator", revision: "catalog-r1", skillIds: ["review", "research"] },
    authorityCeiling: { maximumAuthority: "audited", reason: "operator session policy", subjectId: sessionId },
  };
}

describe("RuntimeSessionAuthorityFacet", () => {
  it("creates a deterministic immutable secret-free facet", () => {
    const facet = defineRuntimeSessionAuthorityFacet(makeFacet());
    expect(facet.schemaRevision).toBe(1);
    expect(facet.facetId).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(facet.skillCatalog.skillIds).toEqual(["research", "review"]);
    expect(Object.isFrozen(facet)).toBe(true);
    expect(Object.isFrozen(facet.skillCatalog)).toBe(true);
    expect(Object.isFrozen(facet.sessionRevision.revisions)).toBe(true);
  });

  it("admits normalized portable activation-lineage paths in the pinned session revision", () => {
    const candidate = makeFacet();
    const facet = defineRuntimeSessionAuthorityFacet({
      ...candidate,
      sessionRevision: {
        ...candidate.sessionRevision,
        activationLineage: [{
          proposalId: "cfg-session-lineage",
          scope: "global",
          path: "config.yaml",
          committedRevision: `sha256:${"a".repeat(64)}`,
          reconciliationGenerations: [],
        }],
      },
    });

    expect(facet.sessionRevision.activationLineage?.[0]?.path).toBe("config.yaml");
  });

  it("rejects activation-lineage paths that escape their portable configuration root", () => {
    const candidate = makeFacet();
    expect(() => defineRuntimeSessionAuthorityFacet({
      ...candidate,
      sessionRevision: {
        ...candidate.sessionRevision,
        activationLineage: [{
          proposalId: "cfg-session-lineage",
          scope: "global",
          path: "../operator/config.yaml",
          committedRevision: `sha256:${"a".repeat(64)}`,
          reconciliationGenerations: [],
        }],
      },
    })).toThrow(/logical relative path/iu);
  });

  it.each([
    ["secret material", { token: "do-not-persist" }],
    ["filesystem path", { workingDirectory: "C:/private/project" }],
    ["non-plain value", { values: new Map([["a", "b"]]) }],
  ])("rejects %s", (_label, unsafe) => {
    const candidate = makeFacet() as RuntimeSessionAuthorityFacetInput & { unsafe?: unknown };
    candidate.unsafe = unsafe;
    expect(() => defineRuntimeSessionAuthorityFacet(candidate)).toThrow(/secret|path|plain|serializable/iu);
  });

  it("keeps revision-only or absent sessions explicitly non-authoritative", () => {
    const session = new RuntimeSession({ appName: "app", tenantId: "tenant", userId: "user", systemPrompt: "system" });
    expect(session.runtimeSessionAuthorityFacet).toBeUndefined();
    session.bindRuntimeConfigurationRevision({ revisionSetId: "legacy", revisions: { project: "r1" } });
    expect(session.runtimeSessionAuthorityFacet).toBeUndefined();
  });

  it("persists and restores the exact facet", () => {
    const session = new RuntimeSession({
      appName: "app", tenantId: "tenant", userId: "user", systemPrompt: "system", sessionId: "session-1",
    });
    session.bindRuntimeSessionAuthorityFacet(makeFacet());
    const restored = deserializeSession(serializeSession(session));
    expect(restored.runtimeSessionAuthorityFacet?.facetId).toBe(session.runtimeSessionAuthorityFacet?.facetId);
    expect(restored.runtimeSessionAuthorityFacet).toEqual(session.runtimeSessionAuthorityFacet);
  });

  it("does not allow a different facet to replace an admitted session facet", () => {
    const session = new RuntimeSession({
      appName: "app", tenantId: "tenant", userId: "user", systemPrompt: "system", sessionId: "session-1",
    });
    session.bindRuntimeSessionAuthorityFacet(makeFacet());
    expect(() => session.bindRuntimeSessionAuthorityFacet({
      ...makeFacet(),
      authorityCeiling: { maximumAuthority: "read_only", reason: "attenuated" },
    })).toThrow(/already bound|different/iu);
  });

  it("advances optimistic concurrency when the authority facet is first bound", () => {
    const session = new RuntimeSession({
      appName: "app", tenantId: "tenant", userId: "user", systemPrompt: "system", sessionId: "session-1",
    });
    const version = session.version;
    session.bindRuntimeSessionAuthorityFacet(makeFacet());
    expect(session.version).toBe(version + 1);
    session.bindRuntimeSessionAuthorityFacet(makeFacet());
    expect(session.version).toBe(version + 1);
  });

  it("rejects a facet that disagrees with the session revision pin", () => {
    const session = new RuntimeSession({
      appName: "app", tenantId: "tenant", userId: "user", systemPrompt: "system", sessionId: "session-1",
    });
    session.bindRuntimeConfigurationRevision({ revisionSetId: "R2", revisions: { skills: "skills-r2", routes: "routes-r2" } });
    expect(() => session.bindRuntimeSessionAuthorityFacet(makeFacet())).toThrow(/revision/iu);
  });
});
