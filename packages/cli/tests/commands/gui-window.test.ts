import { EventEmitter } from "node:events";
import type { spawn } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  buildGuiWindowLaunchSpec,
  launchGuiWindow,
  removeGuiProfileDirectory,
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

class FakeBrowserWebSocket extends EventTarget {
  readonly send = vi.fn((_message: string) => {
    queueMicrotask(() => {
      this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ id: 1, result: {} }) }));
    });
  });
}

describe("gui window launcher", () => {
  it("retries transient Windows profile locks until removal succeeds", async () => {
    const busy = Object.assign(new Error("profile busy"), { code: "EBUSY" });
    const remove = vi.fn()
      .mockRejectedValueOnce(busy)
      .mockRejectedValueOnce(busy)
      .mockResolvedValue(undefined);
    const wait = vi.fn(async () => undefined);

    await removeGuiProfileDirectory("C:\\Temp\\kiln-profile", {
      remove,
      wait,
      maxRetries: 2,
      retryDelayMs: 100,
    });

    expect(remove).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 100);
    expect(wait).toHaveBeenNthCalledWith(2, 200);
  });

  it("does not retry a non-transient profile cleanup failure", async () => {
    const denied = Object.assign(new Error("profile denied"), { code: "EACCES" });
    const remove = vi.fn().mockRejectedValue(denied);
    const wait = vi.fn(async () => undefined);

    await expect(removeGuiProfileDirectory("C:\\Temp\\kiln-profile", {
      remove,
      wait,
    })).rejects.toBe(denied);

    expect(remove).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });

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

    const launchSpec = buildGuiWindowLaunchSpec(host, "http://localhost:4810/gui/?theme=phosphor", "C:\\Temp\\kiln-profile");

    expect(launchSpec.command).toBe("C:\\Tools\\msedge.exe");
    expect(launchSpec.args).toContain("--new-window");
    expect(launchSpec.args).toContain("--app=http://localhost:4810/gui/?theme=phosphor");
    expect(launchSpec.args).toContain("--user-data-dir=C:\\Temp\\kiln-profile");
    expect(launchSpec.args).toContain("--disable-background-mode");
    expect(launchSpec.args).toContain("--disable-background-networking");
    expect(launchSpec.args).toContain("--no-service-autorun");
    expect(launchSpec.args).toContain("--remote-debugging-port=0");
  });

  it("keeps the temporary profile while an Edge launcher hands off to the managed window", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    // `spawn` carries a dozen stdio-shaped overloads; a single-signature mock can never
    // structurally match the full set, so the mock is cast at the boundary where it is
    // handed to `launchGuiWindow`'s `spawnImpl` option (the one call site that consumes it).
    const spawnImpl = vi.fn(() => child) as unknown as typeof spawn;
    const cleanupProfileDir = vi.fn();
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ type: "page", url: "http://localhost:4810/gui/" }],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ type: "page", url: "http://localhost:4810/gui/" }],
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      } as Response);

    try {
      const session = launchGuiWindow("http://localhost:4810/gui/", {
        platform: "win32",
        resolveCommand: (command) => (command === "msedge" ? "C:\\Tools\\msedge.exe" : null),
        pathExists: () => false,
        createProfileDir: () => "C:\\Temp\\kiln-profile",
        cleanupProfileDir,
        spawnImpl,
        fetchImpl,
        readDevToolsPort: () => 9222,
        pollMs: 100,
        closeConfirmationMs: 200,
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

      child.exitCode = 0;
      child.emit("exit", 0, null);
      await vi.advanceTimersByTimeAsync(100);
      expect(cleanupProfileDir).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(300);
      await session.whenClosed;

      expect(cleanupProfileDir).not.toHaveBeenCalled();

      await session.close();
      expect(cleanupProfileDir).toHaveBeenCalledWith("C:\\Temp\\kiln-profile");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects shutdown when the browser profile cannot be removed", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    // `spawn` carries a dozen stdio-shaped overloads; a single-signature mock can never
    // structurally match the full set, so the mock is cast at the boundary where it is
    // handed to `launchGuiWindow`'s `spawnImpl` option (the one call site that consumes it).
    const spawnImpl = vi.fn(() => child) as unknown as typeof spawn;
    const cleanupError = Object.assign(new Error("profile busy"), { code: "EBUSY" });
    const cleanupProfileDir = vi.fn(() => {
      throw cleanupError;
    });
    try {
      const session = launchGuiWindow("http://localhost:4810/gui/", {
        platform: "win32",
        resolveCommand: (command) => (command === "msedge" ? "C:\\Tools\\msedge.exe" : null),
        pathExists: () => false,
        createProfileDir: () => "C:\\Temp\\kiln-profile",
        cleanupProfileDir,
        spawnImpl,
        readDevToolsPort: () => null,
        startupTimeoutMs: 100,
      });

      await expect(session.close()).rejects.toBe(cleanupError);
      expect(child.exitCode).toBe(0);
      expect(cleanupProfileDir).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes the dedicated browser before removing its profile", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    // `spawn` carries a dozen stdio-shaped overloads; a single-signature mock can never
    // structurally match the full set, so the mock is cast at the boundary where it is
    // handed to `launchGuiWindow`'s `spawnImpl` option (the one call site that consumes it).
    const spawnImpl = vi.fn(() => child) as unknown as typeof spawn;
    const socket = new FakeBrowserWebSocket();
    const cleanupProfileDir = vi.fn();
    const fetchMock = vi.fn(async (input: string | URL | Request) => ({
      ok: true,
      json: async () => String(input).endsWith("/json/version")
        ? { webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/test" }
        : [{ type: "page", url: "http://localhost:4810/gui/" }],
    } as Response));
    const fetchImpl = fetchMock as unknown as typeof fetch;

    try {
      const session = launchGuiWindow("http://localhost:4810/gui/", {
        platform: "win32",
        resolveCommand: (command) => (command === "msedge" ? "C:\\Tools\\msedge.exe" : null),
        pathExists: () => false,
        createProfileDir: () => "C:\\Temp\\kiln-profile",
        cleanupProfileDir,
        createWebSocket: () => {
          queueMicrotask(() => socket.dispatchEvent(new Event("open")));
          return socket as unknown as WebSocket;
        },
        spawnImpl,
        fetchImpl,
        readDevToolsPort: () => 9222,
        pollMs: 100,
      });

      const closePromise = session.close();
      await vi.advanceTimersByTimeAsync(10);

      expect(fetchMock).toHaveBeenLastCalledWith("http://127.0.0.1:9222/json/version");
      expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ id: 1, method: "Browser.close" }));
      expect(cleanupProfileDir).not.toHaveBeenCalled();

      socket.dispatchEvent(new Event("close"));
      await closePromise;
      expect(socket.send.mock.invocationCallOrder[0]).toBeLessThan(cleanupProfileDir.mock.invocationCallOrder[0]!);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not make observed window closure wait on profile cleanup", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    // `spawn` carries a dozen stdio-shaped overloads; a single-signature mock can never
    // structurally match the full set, so the mock is cast at the boundary where it is
    // handed to `launchGuiWindow`'s `spawnImpl` option (the one call site that consumes it).
    const spawnImpl = vi.fn(() => child) as unknown as typeof spawn;
    let finishCleanup: (() => void) | undefined;
    const cleanupProfileDir = vi.fn(() => new Promise<void>((resolve) => {
      finishCleanup = resolve;
    }));

    try {
      const session = launchGuiWindow("http://localhost:4810/gui/", {
        platform: "win32",
        resolveCommand: (command) => (command === "msedge" ? "C:\\Tools\\msedge.exe" : null),
        pathExists: () => false,
        createProfileDir: () => "C:\\Temp\\kiln-profile",
        cleanupProfileDir,
        spawnImpl,
        readDevToolsPort: () => null,
        startupTimeoutMs: 100,
      });
      const closePromise = session.close();
      await vi.advanceTimersByTimeAsync(100);
      expect(cleanupProfileDir).toHaveBeenCalledOnce();

      finishCleanup?.();
      await closePromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the managed app window open through a transient DevTools target absence", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChildProcess();
      const fetchImpl = vi.fn<typeof fetch>()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ type: "page", url: "http://localhost:4810/gui/?theme=phosphor" }],
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        } as Response)
        .mockResolvedValue({
          ok: true,
          json: async () => [{ type: "page", url: "http://localhost:4810/gui/?theme=phosphor" }],
        } as Response);

      const whenClosed = waitForManagedGuiAppWindowClose(
        "http://localhost:4810/gui/?theme=phosphor",
        "C:\\Temp\\kiln-profile",
        child as unknown as ReturnType<typeof launchGuiWindow>["child"],
        {
          fetchImpl,
          setIntervalImpl: setInterval,
          clearIntervalImpl: clearInterval,
          readDevToolsPort: () => 9222,
          pollMs: 100,
          closeConfirmationMs: 200,
        },
      );
      const settled = vi.fn();
      void whenClosed.then(settled, settled);

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(300);

      expect(settled).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats the managed app window as closed after its target stays absent for the confirmation grace", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChildProcess();
      const fetchImpl = vi.fn<typeof fetch>()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ type: "page", url: "http://localhost:4810/gui/" }],
        } as Response)
        .mockResolvedValue({
          ok: true,
          json: async () => [],
        } as Response);

      const whenClosed = waitForManagedGuiAppWindowClose(
        "http://localhost:4810/gui/",
        "C:\\Temp\\kiln-profile",
        child as unknown as ReturnType<typeof launchGuiWindow>["child"],
        {
          fetchImpl,
          readDevToolsPort: () => 9222,
          pollMs: 100,
          closeConfirmationMs: 200,
        },
      );

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(199);
      const settled = vi.fn();
      void whenClosed.then(settled);
      expect(settled).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await expect(whenClosed).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
