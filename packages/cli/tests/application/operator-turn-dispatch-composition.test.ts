import { describe, expect, it, vi } from "vitest";
import { defineExecutionCatalog } from "@kilnai/core/agents";
import { captureOperatorExecutionCatalogSnapshot } from "../../src/application/operator-turn-dispatch-composition.js";

describe("operator turn dispatch composition", () => {
  it("captures a catalog only when it matches the canonical global revision", () => {
    const configR1 = { revision: "R1" } as never;
    const configR2 = { revision: "R2" } as never;
    const readConfigSnapshot = vi.fn()
      .mockReturnValueOnce({ config: configR1, revision: "global-r1" })
      .mockReturnValueOnce({ config: configR2, revision: "global-r2" });
    const readConfigurationRevision = vi.fn()
      .mockReturnValueOnce({ revisionSetId: "mixed", revisions: { global: "global-r2", project: "project-r1" } })
      .mockReturnValueOnce({ revisionSetId: "R2", revisions: { global: "global-r2", project: "project-r1" } });
    const readExecutionCatalog = vi.fn((config: { revision: string }) => {
      expect(config.revision).toBe("R2");
      return defineExecutionCatalog({ accounts: [], accountPolicies: [], routes: [] });
    }) as never;

    const snapshot = captureOperatorExecutionCatalogSnapshot({
      projectPath: "C:/workspace",
      readConfigSnapshot,
      readConfigurationRevision,
      readExecutionCatalog,
    });

    expect(snapshot.configurationRevision.revisionSetId).toBe("R2");
    expect(readExecutionCatalog).toHaveBeenCalledTimes(1);
    expect(readExecutionCatalog).toHaveBeenCalledWith(configR2);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("fails closed when catalog values and canonical revision never stabilize", () => {
    expect(() => captureOperatorExecutionCatalogSnapshot({
      projectPath: "C:/workspace",
      readConfigSnapshot: () => ({ config: {} as never, revision: "global-r1" }),
      readConfigurationRevision: () => ({ revisionSetId: "R2", revisions: { global: "global-r2" } }),
      readExecutionCatalog: () => defineExecutionCatalog({ accounts: [], accountPolicies: [], routes: [] }),
    })).toThrow(/changed|stabili/iu);
  });
});
