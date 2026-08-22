import { describe, expect, it } from "vitest";
import {
  captureRuntimeConfigurationRevision,
  normalizeRuntimeConfigurationRevision,
  type RuntimeConfigurationRevisionSnapshot,
} from "../../src/session/runtime-configuration-revision-pin.js";

describe("Runtime configuration revision pin", () => {
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
    const revisionSetId = "sha256:" + "a".repeat(64);
    const first = normalizeRuntimeConfigurationRevision({
      revisionSetId,
      revisions: { project: "sha256:" + "b".repeat(64) },
      activationLineage: [
        {
          proposalId: "cfg-project",
          scope: "project",
          path: ".kiln/kiln.yaml",
          committedRevision: "sha256:" + "b".repeat(64),
          reconciliationGenerations: [
            { target: "native-skills", generation: "sha256:" + "d".repeat(64) },
            { target: "native-agents", generation: "sha256:" + "c".repeat(64) },
          ],
        },
      ],
    });
    const second = normalizeRuntimeConfigurationRevision({
      revisionSetId,
      revisions: { project: "sha256:" + "b".repeat(64) },
      activationLineage: [
        {
          proposalId: "cfg-project",
          scope: "project",
          path: ".kiln/kiln.yaml",
          committedRevision: "sha256:" + "b".repeat(64),
          reconciliationGenerations: [
            { target: "native-agents", generation: "sha256:" + "c".repeat(64) },
            { target: "native-skills", generation: "sha256:" + "d".repeat(64) },
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
    expect(Reflect.set(generation!, "generation", "sha256:" + "e".repeat(64))).toBe(false);
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
        committedRevision: "sha256:" + "b".repeat(64),
        reconciliationGenerations: [],
      }],
    })).toThrow(/proposalId|non-empty/iu);
    expect(() => normalizeRuntimeConfigurationRevision({
      ...base,
      activationLineage: [{
        proposalId: "cfg-project",
        scope: "project",
        path: "C:/operator/project/.kiln/kiln.yaml",
        committedRevision: "sha256:" + "b".repeat(64),
        reconciliationGenerations: [],
      }],
    })).toThrow(/path|absolute/iu);
    expect(() => normalizeRuntimeConfigurationRevision({
      ...base,
      activationLineage: [{
        proposalId: "cfg-project",
        scope: "project",
        path: ".kiln/kiln.yaml",
        committedRevision: "sha256:" + "b".repeat(64),
        reconciliationGenerations: [{ target: "native-skills", generation: "not-a-generation" }],
      }],
    })).toThrow(/generation/iu);
    expect(() => normalizeRuntimeConfigurationRevision({
      ...base,
      activationLineage: [
        {
          proposalId: "cfg-project-a",
          scope: "project",
          path: ".kiln/kiln.yaml",
          committedRevision: "sha256:" + "b".repeat(64),
          reconciliationGenerations: [],
        },
        {
          proposalId: "cfg-project-b",
          scope: "project",
          path: ".kiln/kiln.yaml",
          committedRevision: "sha256:" + "c".repeat(64),
          reconciliationGenerations: [],
        },
      ],
    })).toThrow(/one settlement|scope.*path/iu);
  });
});
