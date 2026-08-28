import { describe, expect, it } from "vitest";
import {
  captureRuntimeConfigurationRevision,
  normalizeRuntimeConfigurationRevision,
  type RuntimeConfigurationRevisionSnapshot,
} from "../../src/session/runtime-configuration-revision-pin.js";

describe("Runtime configuration revision pin", () => {
  const DIGEST_A = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const DIGEST_B = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const DIGEST_C = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
  const DIGEST_D = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

  it("captures one frozen snapshot while a later turn observes the next revision", async () => {
    let current: RuntimeConfigurationRevisionSnapshot = {
      revisionSetId: "R1",
      revisions: { execution: "execution-R1", permissions: "permissions-R1" },
    };
    let reads = 0;
    const provider = async (): Promise<RuntimeConfigurationRevisionSnapshot> => {
      reads += 1;
      return current;
    };

    const r1Turn = await captureRuntimeConfigurationRevision(provider);
    current = {
      revisionSetId: "R2",
      revisions: { execution: "execution-R2", permissions: "permissions-R2" },
    };
    const r2Turn = await captureRuntimeConfigurationRevision(provider);

    expect(r1Turn.revisionSetId).toBe("R1");
    expect(r1Turn.revisions.execution).toBe("execution-R1");
    expect(r2Turn.revisionSetId).toBe("R2");
    expect(reads).toBe(2);
    expect(Object.isFrozen(r1Turn)).toBe(true);
    expect(Object.isFrozen(r1Turn.revisions)).toBe(true);
  });

  it("retains the admitted R1 value through a controlled blocked-turn latch", async () => {
    let current: RuntimeConfigurationRevisionSnapshot = {
      revisionSetId: "R1",
      revisions: { route: "route-R1" },
    };
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const provider = async (): Promise<RuntimeConfigurationRevisionSnapshot> => {
      const admitted = current;
      await blocked;
      return admitted;
    };

    const r1Turn = captureRuntimeConfigurationRevision(provider);
    current = { revisionSetId: "R2", revisions: { route: "route-R2" } };
    release();
    const admittedR1 = await r1Turn;
    const nextR2 = await captureRuntimeConfigurationRevision(() => current);

    expect(admittedR1.revisionSetId).toBe("R1");
    expect(admittedR1.revisions.route).toBe("route-R1");
    expect(nextR2.revisionSetId).toBe("R2");
  });

  it("normalizes activation lineage independently from the revision-set digest", () => {
    const revisionSetId = DIGEST_A;
    const first = normalizeRuntimeConfigurationRevision({
      revisionSetId,
      revisions: { project: DIGEST_B },
      activationLineage: [
        {
          proposalId: "cfg-project",
          scope: "project",
          path: ".kiln/kiln.yaml",
          committedRevision: DIGEST_B,
          reconciliationGenerations: [
            { target: "native-skills", generation: DIGEST_D },
            { target: "native-agents", generation: DIGEST_C },
            { target: "workflow-snapshot", generation: DIGEST_B },
          ],
        },
      ],
    });
    const second = normalizeRuntimeConfigurationRevision({
      revisionSetId,
      revisions: { project: DIGEST_B },
      activationLineage: [
        {
          proposalId: "cfg-project",
          scope: "project",
          path: ".kiln/kiln.yaml",
          committedRevision: DIGEST_B,
          reconciliationGenerations: [
            { target: "workflow-snapshot", generation: DIGEST_B },
            { target: "native-agents", generation: DIGEST_C },
            { target: "native-skills", generation: DIGEST_D },
          ],
        },
      ],
    });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.revisionSetId).toBe(revisionSetId);
    expect(first.activationLineage).toBeDefined();
    expect(Object.isFrozen(first.activationLineage)).toBe(true);
    expect(Object.isFrozen(first.activationLineage?.[0])).toBe(true);
    expect(Object.isFrozen(first.activationLineage?.[0]?.reconciliationGenerations)).toBe(true);
    const generation = first.activationLineage?.[0]?.reconciliationGenerations[0];
    expect(Object.isFrozen(generation)).toBe(true);
    expect(Reflect.set(generation!, "generation", DIGEST_A)).toBe(false);
    expect(first.activationLineage?.[0]?.reconciliationGenerations.map((entry) => entry.target))
      .toContain("workflow-snapshot");
  });

  it("rejects malformed activation lineage instead of treating it as activation evidence", () => {
    const base = {
      revisionSetId: "R1",
      revisions: { project: "project-R1" },
    };
    expect(() => normalizeRuntimeConfigurationRevision({
      ...base,
      activationLineage: [{
        proposalId: "",
        scope: "project",
        path: ".kiln/kiln.yaml",
        committedRevision: DIGEST_B,
        reconciliationGenerations: [],
      }],
    })).toThrow(/proposalId|non-empty/iu);
    expect(() => normalizeRuntimeConfigurationRevision({
      ...base,
      activationLineage: [{
        proposalId: "cfg-project",
        scope: "project",
        path: "C:/operator/project/.kiln/kiln.yaml",
        committedRevision: DIGEST_B,
        reconciliationGenerations: [],
      }],
    })).toThrow(/path|absolute/iu);
    for (const path of ["C:operator\\config.yaml", "./config.yaml", ".kiln\\kiln.yaml"]) {
      expect(() => normalizeRuntimeConfigurationRevision({
        ...base,
        activationLineage: [{
          proposalId: "cfg-project",
          scope: "project",
          path,
          committedRevision: DIGEST_B,
          reconciliationGenerations: [],
        }],
      })).toThrow(/logical relative path/iu);
    }
    expect(() => normalizeRuntimeConfigurationRevision({
      ...base,
      activationLineage: [{
        proposalId: "cfg-project",
        scope: "project",
        path: ".kiln/kiln.yaml",
        committedRevision: DIGEST_B,
        reconciliationGenerations: [{ target: "native-skills", generation: "sha256:not-a-generation" }],
      }],
    })).toThrow(/generation/iu);
    expect(() => normalizeRuntimeConfigurationRevision({
      ...base,
      activationLineage: [
        {
          proposalId: "cfg-project-a",
          scope: "project",
          path: ".kiln/kiln.yaml",
          committedRevision: DIGEST_B,
          reconciliationGenerations: [],
        },
        {
          proposalId: "cfg-project-b",
          scope: "project",
          path: ".kiln/kiln.yaml",
          committedRevision: DIGEST_C,
          reconciliationGenerations: [],
        },
      ],
    })).toThrow(/one settlement|scope.*path/iu);
  });
});
