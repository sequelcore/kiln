import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigMutationStore, type StoredConfigMutationSettlement } from "../../src/application/config-mutation-store.js";
import { type ProjectStateBinding, resolveProjectStateBinding } from "../../src/application/project-state-root.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function digest(letter: string): `sha256:${string}` {
  return `sha256:${letter.repeat(64)}`;
}

interface StoreFixture {
  readonly projectPath: string;
  readonly binding: ProjectStateBinding;
  readonly globalConfigPath: string;
}

function workspace(label: string): { readonly root: string; readonly kilnHome: string } {
  const root = mkdtempSync(join(tmpdir(), `kiln-config-store-${label}-`));
  const kilnHome = join(root, "kiln-home");
  mkdirSync(kilnHome, { recursive: true });
  roots.push(root);
  return { root, kilnHome };
}

function projectFixture(root: string, kilnHome: string, name: string): StoreFixture {
  const projectPath = join(root, name);
  mkdirSync(join(projectPath, ".git"), { recursive: true });
  const binding = resolveProjectStateBinding(projectPath, { kilnHome });
  return { projectPath, binding, globalConfigPath: join(kilnHome, "config.yaml") };
}

function storeFor(fixture: StoreFixture): ConfigMutationStore {
  return new ConfigMutationStore(fixture.projectPath, {
    root: fixture.binding.mutationsPath,
    globalConfigPath: fixture.globalConfigPath,
  });
}

function settlement(input: {
  readonly proposalId: string;
  readonly path: string;
  readonly committedRevision: "absent" | `sha256:${string}`;
  readonly settledAt: string;
  readonly scope?: "project" | "global";
}): StoredConfigMutationSettlement {
  return {
    proposalId: input.proposalId,
    approvalId: null,
    scope: input.scope ?? "project",
    operation: "skill.upsert",
    settledAt: input.settledAt,
    outcome: "committed",
    baseRevision: "absent",
    committedRevision: input.committedRevision,
    appliedWrites: [{ path: input.path, previousHash: null, nextHash: input.committedRevision }],
    reconciliationEffects: [],
    diagnostics: [],
    rollbackToken: input.proposalId,
    activation: "reconcile",
    activationObservation: {
      state: "active",
      boundary: "reconcile",
      committedRevision: input.committedRevision,
      activeRevision: input.committedRevision,
      summary: "fixture",
    },
    restore: [],
  };
}

describe("ConfigMutationStore settlement lineage query", () => {
  it("selects the latest settlement by canonical path and committed revision", () => {
    const fixtureRoot = workspace("lineage");
    const fixture = projectFixture(fixtureRoot.root, fixtureRoot.kilnHome, "project");
    const path = fixture.binding.configPath;
    const otherPath = join(fixture.binding.agentsPath, "reviewer.md");
    const revisionA = digest("a");
    const revisionB = digest("b");
    const store = storeFor(fixture);

    store.settle(settlement({ proposalId: "cfg-apply-a", path, committedRevision: revisionA, settledAt: "2026-08-22T00:00:00.000Z" }));
    store.settle(settlement({ proposalId: "cfg-apply-b", path, committedRevision: revisionB, settledAt: "2026-08-22T00:00:02.000Z" }));
    store.settle(settlement({ proposalId: "cfg-rollback-a", path, committedRevision: revisionA, settledAt: "2026-08-22T00:00:03.000Z" }));
    store.settle(settlement({ proposalId: "cfg-other-path", path: otherPath, committedRevision: revisionA, settledAt: "2026-08-22T00:00:04.000Z" }));

    expect(store.readLatestSettlementForPath(path, revisionA)?.proposalId).toBe("cfg-rollback-a");
    expect(store.readLatestSettlementForPath(path, revisionB)).toBeNull();
    expect(store.readLatestSettlementForPath(path, digest("c"))).toBeNull();
  });

  it("does not resurrect an older same-hash settlement after an ungoverned byte change", () => {
    const fixtureRoot = workspace("resurrection");
    const fixture = projectFixture(fixtureRoot.root, fixtureRoot.kilnHome, "project");
    const path = fixture.binding.configPath;
    const revisionA = digest("a");
    const revisionB = digest("b");
    const store = storeFor(fixture);

    store.settle(settlement({ proposalId: "cfg-resurrection-a", path, committedRevision: revisionA, settledAt: "2026-08-22T00:00:00.000Z" }));
    store.settle(settlement({ proposalId: "cfg-resurrection-b", path, committedRevision: revisionB, settledAt: "2026-08-22T00:00:01.000Z" }));

    // The bytes happen to be A again, but no governed rollback produced them.
    // A prior A settlement must not be reused as activation lineage.
    expect(store.readLatestSettlementForPath(path, revisionA)).toBeNull();
  });

  it("shares globally scoped settlement order across project namespaces", () => {
    const fixtureRoot = workspace("global-order");
    const projectA = projectFixture(fixtureRoot.root, fixtureRoot.kilnHome, "project-a");
    const projectB = projectFixture(fixtureRoot.root, fixtureRoot.kilnHome, "project-b");
    const globalPath = join(fixtureRoot.kilnHome, "config.yaml");
    const storeA = storeFor(projectA);
    const storeB = storeFor(projectB);
    const revisionA = digest("a");

    storeA.settle(settlement({ proposalId: "cfg-global-a", path: globalPath, scope: "global", committedRevision: revisionA, settledAt: "2026-08-22T00:00:00.000Z" }));
    storeB.settle(settlement({ proposalId: "cfg-global-rollback-a", path: globalPath, scope: "global", committedRevision: revisionA, settledAt: "2026-08-22T00:00:01.000Z" }));

    expect(storeB.readLatestSettlementForPath(globalPath, revisionA)?.proposalId).toBe("cfg-global-rollback-a");
    expect(storeA.readLatestSettlementForPath(globalPath, revisionA)?.proposalId).toBe("cfg-global-rollback-a");
    expect(storeA.lockPathFor(globalPath)).toBe(storeB.lockPathFor(globalPath));
  });

  it("qualifies global settlements to the project whose projection evidence was produced", () => {
    const fixtureRoot = workspace("global-qualification");
    const projectA = projectFixture(fixtureRoot.root, fixtureRoot.kilnHome, "project-a");
    const projectB = projectFixture(fixtureRoot.root, fixtureRoot.kilnHome, "project-b");
    const globalPath = join(fixtureRoot.kilnHome, "config.yaml");
    const storeA = storeFor(projectA);
    const storeB = storeFor(projectB);

    storeA.settle({
      ...settlement({
        proposalId: "cfg-global-project-a",
        path: globalPath,
        scope: "global",
        committedRevision: digest("a"),
        settledAt: "2026-08-22T00:00:00.000Z",
      }),
      reconciliationGenerations: [{ target: "native-skills", generation: digest("a") }],
    });

    expect(storeA.readSettlements().map((entry) => entry.proposalId)).toContain("cfg-global-project-a");
    expect(storeB.readSettlements().map((entry) => entry.proposalId)).not.toContain("cfg-global-project-a");
    expect(storeB.readLatestSettlementForPath(globalPath, digest("a"))?.proposalId).toBe("cfg-global-project-a");
  });

  it("exposes global in-flight markers to every project store and clears the shared marker", () => {
    const fixtureRoot = workspace("global-progress");
    const projectA = projectFixture(fixtureRoot.root, fixtureRoot.kilnHome, "project-a");
    const projectB = projectFixture(fixtureRoot.root, fixtureRoot.kilnHome, "project-b");
    const globalPath = join(fixtureRoot.kilnHome, "config.yaml");
    const storeA = storeFor(projectA);
    const storeB = storeFor(projectB);
    const marker = {
      proposalId: "cfg-global-in-flight",
      path: globalPath,
      intendedRevision: digest("a"),
      startedAt: "2026-08-22T00:00:00.000Z",
    };

    storeA.writeProgressMarker(marker);
    expect(storeB.readProgressMarker(marker.proposalId)).toEqual(marker);
    expect(storeB.readProgressMarkers()).toEqual([marker]);

    storeB.clearProgressMarker(marker.proposalId);
    expect(storeA.readProgressMarker(marker.proposalId)).toBeNull();
  });

  it("rejects a settlement with an inconsistent activation observation", () => {
    const fixtureRoot = workspace("invalid-observation");
    const fixture = projectFixture(fixtureRoot.root, fixtureRoot.kilnHome, "project");
    const store = storeFor(fixture);
    const malformed = {
      ...settlement({
        proposalId: "cfg-invalid-observation",
        path: fixture.binding.configPath,
        committedRevision: digest("a"),
        settledAt: "2026-08-22T00:00:00.000Z",
      }),
      activationObservation: {
        state: "active",
        boundary: "next-turn",
        committedRevision: digest("b"),
        activeRevision: digest("c"),
        summary: "inconsistent",
      },
    } as unknown as StoredConfigMutationSettlement;

    expect(() => store.settle(malformed)).toThrow(/activation observation|boundary|revision/iu);
  });

});
