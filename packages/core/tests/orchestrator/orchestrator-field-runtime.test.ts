import { beforeEach, describe, expect, it, vi } from "vitest";

const fieldRuntimeMocks = vi.hoisted(() => {
  const release = vi.fn();
  return {
    release,
    acquireFieldRuntime: vi.fn(() => ({ release })),
    attachFieldUpdater: vi.fn(),
  };
});

vi.mock("../../src/field/field-service.js", () => ({
  acquireFieldRuntime: fieldRuntimeMocks.acquireFieldRuntime,
  attachFieldUpdater: fieldRuntimeMocks.attachFieldUpdater,
}));

describe("Orchestrator field runtime lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("releases the field runtime lease when disposed", async () => {
    const { Orchestrator } = await import("../../src/orchestrator/orchestrator.js");

    const orchestrator = new Orchestrator();

    expect(fieldRuntimeMocks.acquireFieldRuntime).toHaveBeenCalledTimes(1);
    orchestrator.dispose();

    expect(fieldRuntimeMocks.release).toHaveBeenCalledTimes(1);
  });

  it("releases the field runtime lease only once", async () => {
    const { Orchestrator } = await import("../../src/orchestrator/orchestrator.js");

    const orchestrator = new Orchestrator();
    orchestrator.dispose();
    orchestrator.dispose();

    expect(fieldRuntimeMocks.release).toHaveBeenCalledTimes(1);
  });
});
