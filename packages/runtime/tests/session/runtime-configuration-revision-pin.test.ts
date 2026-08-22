import { describe, expect, it } from "vitest";
import {
  captureRuntimeConfigurationRevision,
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
});
