import { afterEach, describe, expect, it, vi } from "vitest";
import { createStartupProfiler } from "../../src/application/startup-profiler.js";

describe("startup profiler", () => {
  const originalWrite = process.stderr.write;

  afterEach(() => {
    process.stderr.write = originalWrite;
    vi.restoreAllMocks();
  });

  it("does not emit phase markers unless explicitly enabled", () => {
    const write = vi.fn();
    process.stderr.write = write as unknown as typeof process.stderr.write;

    createStartupProfiler("gui", false).mark("config-loaded");

    expect(write).not.toHaveBeenCalled();
  });

  it("emits structured phase markers with redacted path details", () => {
    const write = vi.fn();
    process.stderr.write = write as unknown as typeof process.stderr.write;

    createStartupProfiler("gui", true).mark("config-loaded", {
      projectPath: "C:\\Proyectos\\Sequel\\kiln",
      mode: "dev",
    });

    expect(write).toHaveBeenCalledTimes(1);
    const line = String(write.mock.calls[0]?.[0]);
    expect(line).toMatch(/^KILN_STARTUP_PROFILE /);
    const payload = JSON.parse(line.replace(/^KILN_STARTUP_PROFILE /, ""));
    expect(payload).toMatchObject({
      type: "kiln_startup_profile",
      surface: "gui",
      phase: "config-loaded",
      detail: {
        projectPath: "<path:kiln>",
        mode: "dev",
      },
    });
    expect(payload.elapsedMs).toEqual(expect.any(Number));
  });
});
