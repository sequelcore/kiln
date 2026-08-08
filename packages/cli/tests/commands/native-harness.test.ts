import { describe, expect, it, vi } from "vitest";
import type { GlobalOperatorRuntimeLifecycle } from "../../src/application/operator-runtime-lifecycle.js";
import { nativeHarnessCommand } from "../../src/commands/native-harness.js";

describe("nativeHarnessCommand", () => {
  it.each(["codex", "claude", "opencode"] as const)("starts the %s global stdio bridge", async (harness) => {
    const bridge = vi.fn(async () => ({}));
    const pause = vi.fn();
    const resume = vi.fn();
    const lifecycle = fakeLifecycle();

    await nativeHarnessCommand(["control-plane-mcp", "--harness", harness], {
      createLifecycle: () => lifecycle,
      startBridge: bridge,
      pauseStdin: pause,
      resumeStdin: resume,
    });

    expect(bridge).toHaveBeenCalledWith({
      harness,
      supervisor: lifecycle.supervisor,
      readBridgeCredentials: lifecycle.readBridgeCredentials,
    });
    expect(pause).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
    expect(pause.mock.invocationCallOrder[0]).toBeLessThan(bridge.mock.invocationCallOrder[0]!);
    expect(bridge.mock.invocationCallOrder[0]).toBeLessThan(resume.mock.invocationCallOrder[0]!);
  });

  it("resumes stdin when bridge startup fails", async () => {
    const resume = vi.fn();
    await expect(nativeHarnessCommand(["control-plane-mcp", "--harness", "codex"], {
      createLifecycle: fakeLifecycle,
      startBridge: vi.fn(async () => { throw new Error("bridge failed"); }),
      pauseStdin: vi.fn(),
      resumeStdin: resume,
    })).rejects.toThrow("bridge failed");
    expect(resume).toHaveBeenCalledOnce();
  });

  it.each([
    ["unsupported"],
    ["control-plane-mcp", "--harness", "other"],
    ["control-plane-mcp", "--harness", "codex", "--unexpected"],
  ])("rejects unsupported and legacy syntax without touching stdio", async (...args) => {
    const pause = vi.fn();
    const bridge = vi.fn(async () => ({}));
    await expect(nativeHarnessCommand(args, {
      createLifecycle: fakeLifecycle,
      startBridge: bridge,
      pauseStdin: pause,
      resumeStdin: vi.fn(),
    })).rejects.toThrow("Usage:");
    expect(pause).not.toHaveBeenCalled();
    expect(bridge).not.toHaveBeenCalled();
  });
});

function fakeLifecycle(): GlobalOperatorRuntimeLifecycle {
  return {
    runtimeDir: "C:\\global\\runtime\\operator",
    port: 4_820,
    launch: {
      schemaVersion: 1,
      command: "bun",
      args: ["kiln.ts", "operator-runtime", "serve", "--global-runtime"],
      mode: "local-dev",
      version: "3.0.0-beta.1",
    },
    supervisor: { ensure: vi.fn() } as unknown as GlobalOperatorRuntimeLifecycle["supervisor"],
    readBridgeCredentials: vi.fn(async () => null),
    readChildCredentials: vi.fn(async () => null),
  };
}
