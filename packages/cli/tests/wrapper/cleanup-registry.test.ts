import { describe, expect, it, vi } from "vitest";
import { CleanupRegistry } from "../../src/wrapper/cleanup-registry.js";

describe("CleanupRegistry", () => {
  it("runs registered handlers once and clears them", async () => {
    const registry = new CleanupRegistry();
    const first = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockResolvedValue(undefined);
    registry.register(first);
    registry.register(second);

    await registry.runAll();
    await registry.runAll();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
