import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRunManagedDirectActionClaimStorePaths } from "../../src/application/run-action-claim-store-paths.js";

describe("run action-claim store paths", () => {
  it("isolates finite CLI workloads instead of reusing surface-owned claim stores", () => {
    const runtimePath = join("C:", "operator-private", "runtime");
    const first = resolveRunManagedDirectActionClaimStorePaths(runtimePath, "session-1");
    const second = resolveRunManagedDirectActionClaimStorePaths(runtimePath, "session-2");

    expect(first.stateRoot).toBe(join(runtimePath, "run-sessions", "session-1"));
    expect(first.modelRoundClaimsPath).not.toBe(second.modelRoundClaimsPath);
    expect(first.toolActionClaimsPath).not.toBe(second.toolActionClaimsPath);
    expect(first.modelRoundClaimsPath).not.toContain(join(runtimePath, "managed-direct-model-round-action-claims.sqlite"));
    expect(first.toolActionClaimsPath).not.toContain(join(runtimePath, "managed-direct-tool-action-claims.sqlite"));
  });

  it("rejects a session identity that could escape its workload directory", () => {
    expect(() => resolveRunManagedDirectActionClaimStorePaths("C:/runtime", "../other"))
      .toThrow("filesystem-safe canonical identifier");
  });
});
