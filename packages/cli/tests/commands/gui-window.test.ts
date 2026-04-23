import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  buildGuiWindowLaunchSpec,
  launchGuiWindow,
  resolveGuiBrowserHost,
  waitForManagedGuiAppWindowClose,
  type ResolvedGuiBrowserHost,
} from "../../src/commands/gui-window.js";

class FakeChildProcess extends EventEmitter {
  exitCode: number | null = null;

  kill(): boolean {
    this.exitCode = 0;
    this.emit("exit", 0, null);
    return true;
  }
}

describe("gui window launcher", () => {
  it("prefers a resolved command on PATH for the managed app window host", () => {
    const resolved = resolveGuiBrowserHost({
      platform: "win32",
      resolveCommand: (command) => (command === "msedge" ? "C:\\Tools\\msedge.exe" : null),
      pathExists: () => false,
    });

    expect(resolved).toEqual({
      id: "edge",
      label: "Microsoft Edge",
      executable: "C:\\Tools\\msedge.exe",
    });
  });

  it("falls back to known absolute paths when PATH lookup misses", () => {
    const resolved = resolveGuiBrowserHost({
      platform: "win32",
      resolveCommand: () => null,
      pathExists: (path) => path === "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    });

    expect(resolved).toEqual({
      id: "chrome",
      label: "Google Chrome",
      executable: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    });
  });

  it("builds an app-mode browser launch spec with a dedicated profile", () => {
    const host: ResolvedGuiBrowserHost = {
      id: "edge",
      label: "Microsoft Edge",
      executable: "C:\\Tools\\msedge.exe",
    };

    const launchSpec = buildGuiWindowLaunchSpec(host, "http://localhost:4810/gui/?theme=kiln-dark", "C:\\Temp\\kiln-profile");

    expect(launchSpec.command).toBe("C:\\Tools\\msedge.exe");
    expect(launchSpec.args).toContain("--new-window");
    expect(launchSpec.args).toContain("--app=http://localhost:4810/gui/?theme=kiln-dark");
    expect(launchSpec.args).toContain("--user-data-dir=C:\\Temp\\kiln-profile");
    expect(launchSpec.args).toContain("--disable-background-mode");
    expect(launchSpec.args).toContain("--disable-background-networking");
    expect(launchSpec.args).toContain("--no-service-autorun");
    expect(launchSpec.args).toContain("--remote-debugging-port=0");
  });

  it("cleans up the temporary profile directory when the managed window closes", async () => {
    const child = new FakeChildProcess();
    const spawnImpl = vi.fn(() => child as unknown as ReturnType<typeof launchGuiWindow>["child"]);
    const cleanupProfileDir = vi.fn();

    const session = launchGuiWindow("http://localhost:4810/gui/", {
      platform: "win32",
      resolveCommand: (command) => (command === "msedge" ? "C:\\Tools\\msedge.exe" : null),
      pathExists: () => false,
      createProfileDir: () => "C:\\Temp\\kiln-profile",
      cleanupProfileDir,
      spawnImpl,
    });

    expect(spawnImpl).toHaveBeenCalledWith(
      "C:\\Tools\\msedge.exe",
      expect.arrayContaining([
        "--new-window",
        "--user-data-dir=C:\\Temp\\kiln-profile",
      ]),
      {
        stdio: "ignore",
        windowsHide: false,
      },
    );

    child.emit("exit", 0, null);
    await session.whenClosed;

    expect(cleanupProfileDir).toHaveBeenCalledWith("C:\\Temp\\kiln-profile");
  });

  it("does not throw when closing while the temporary profile is still locked", () => {
    const child = new FakeChildProcess();
    const spawnImpl = vi.fn(() => child as unknown as ReturnType<typeof launchGuiWindow>["child"]);
    const cleanupProfileDir = vi.fn(() => {
      throw new Error("EBUSY");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const session = launchGuiWindow("http://localhost:4810/gui/", {
        platform: "win32",
        resolveCommand: (command) => (command === "msedge" ? "C:\\Tools\\msedge.exe" : null),
        pathExists: () => false,
        createProfileDir: () => "C:\\Temp\\kiln-profile",
        cleanupProfileDir,
        spawnImpl,
      });

      expect(() => session.close()).not.toThrow();
      expect(warn).toHaveBeenCalledWith("Could not clean up GUI browser profile at C:\\Temp\\kiln-profile: EBUSY");
    } finally {
      warn.mockRestore();
    }
  });

  it("treats the managed app window as closed once its DevTools page target disappears", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChildProcess();
      const fetchImpl = vi.fn<typeof fetch>()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ type: "page", url: "http://localhost:4810/gui/?theme=kiln-dark" }],
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        } as Response);

      const whenClosed = waitForManagedGuiAppWindowClose(
        "http://localhost:4810/gui/?theme=kiln-dark",
        "C:\\Temp\\kiln-profile",
        child as unknown as ReturnType<typeof launchGuiWindow>["child"],
        {
          fetchImpl,
          setIntervalImpl: setInterval,
          clearIntervalImpl: clearInterval,
          readDevToolsPort: () => 9222,
          pollMs: 100,
        },
      );

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      await expect(whenClosed).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
