import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "node:child_process";
import { stopGuiChildProcess } from "../../src/commands/gui-child-process.js";

class FakeChildProcess extends EventEmitter {
  exitCode: number | null = null;
  pid = 4321;
  kill = vi.fn(() => {
    this.exitCode = 0;
    this.emit("exit", 0, null);
    return true;
  });
}

describe("GUI child process shutdown", () => {
  it("terminates the exact Windows process tree before its wrapper can orphan Vite", async () => {
    const child = new FakeChildProcess();
    const spawnSyncImpl = vi.fn(() => ({ status: 0 }));

    await stopGuiChildProcess(child as unknown as ChildProcess, {
      platform: "win32",
      spawnSyncImpl: spawnSyncImpl as never,
    });

    expect(spawnSyncImpl).toHaveBeenCalledWith(
      "taskkill",
      ["/PID", "4321", "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });
});
