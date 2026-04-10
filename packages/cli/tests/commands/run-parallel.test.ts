import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@kilnai/runtime", () => ({
  getProjectContextArtifactCache: vi.fn(),
}));

import { runParallelWorkers } from "../../src/commands/run.js";
import type { KilnAppConfig } from "../../src/config.js";

const MOCK_APP_CONFIG: KilnAppConfig = {
  appName: "kiln",
  dirName: ".kiln",
  version: "0.1.0",
  description: "test",
  createRegistry: () => {
    throw new Error("not called");
  },
  buildSystemPrompt: () => "",
  mcpServerName: "kiln",
};

describe("runParallelWorkers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("when 2 workers both succeed: prints '2/2 workers succeeded', does NOT exit 1", async () => {
    const runner = vi.fn().mockResolvedValue(undefined);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    await runParallelWorkers(MOCK_APP_CONFIG, "test task", {}, 2, runner);

    expect(runner).toHaveBeenCalledTimes(2);
    expect(runner).toHaveBeenCalledWith(
      MOCK_APP_CONFIG,
      "test task",
      expect.objectContaining({ workers: 1, isolate: true }),
    );

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("2/2 workers succeeded");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("when all workers fail: exits 1 (process.exit(1) is called)", async () => {
    const runner = vi.fn().mockRejectedValue(new Error("Worker failed"));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    await expect(runParallelWorkers(MOCK_APP_CONFIG, "test task", {}, 2, runner)).rejects.toThrow(
      "process.exit called",
    );

    expect(runner).toHaveBeenCalledTimes(2);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("when 1 of 2 workers fails: prints '1/2 workers succeeded', does NOT exit 1", async () => {
    const runner = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Worker 2 failed"));
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    await runParallelWorkers(MOCK_APP_CONFIG, "test task", {}, 2, runner);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("1/2 workers succeeded");
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
