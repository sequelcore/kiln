import { describe, expect, it, vi } from "vitest";
import { resolveNativeCliExecutable } from "../../src/wrapper/native-cli-executable.js";

const { execFileSyncMock } = vi.hoisted(() => ({ execFileSyncMock: vi.fn(() => "") }));

vi.mock("node:child_process", () => ({ execFileSync: execFileSyncMock }));

describe("resolveNativeCliExecutable", () => {
  it("prefers a spawnable Windows executable over command shims", () => {
    const verify = vi.fn(() => true);

    const resolved = resolveNativeCliExecutable({
      command: "codex",
      platform: "win32",
      discoveredPaths: [
        "C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd",
        "C:\\Program Files\\Codex\\codex.exe",
      ],
      fallbackPaths: [],
      verify,
    });

    expect(resolved).toBe("C:\\Program Files\\Codex\\codex.exe");
    expect(verify).toHaveBeenCalledWith("C:\\Program Files\\Codex\\codex.exe");
    expect(verify).not.toHaveBeenCalledWith(expect.stringMatching(/\.cmd$/i));
  });

  it("prefers an explicit native harness installation over PATH aliases", () => {
    expect(resolveNativeCliExecutable({
      command: "codex",
      platform: "win32",
      discoveredPaths: ["C:\\Program Files\\Codex\\codex.exe"],
      fallbackPaths: ["C:\\Users\\test\\.codex\\.sandbox-bin\\codex.exe"],
      verify: () => true,
    })).toBe("C:\\Users\\test\\.codex\\.sandbox-bin\\codex.exe");
  });

  it("does not query PATH when the Windows command is already an absolute native executable", () => {
    const executable = "C:\\Tools\\gentle-ai.exe";

    expect(resolveNativeCliExecutable({
      command: executable,
      platform: "win32",
      fallbackPaths: [executable],
      verify: () => true,
    })).toBe(executable);
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it("fails clearly when Windows exposes only non-spawnable shims", () => {
    expect(() => resolveNativeCliExecutable({
      command: "codex",
      platform: "win32",
      discoveredPaths: ["C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd"],
      fallbackPaths: [],
      verify: () => true,
    })).toThrow("native Windows executable");
  });

  it("uses the PATH command directly on POSIX", () => {
    expect(resolveNativeCliExecutable({
      command: "opencode",
      platform: "linux",
      discoveredPaths: [],
      fallbackPaths: [],
      verify: () => true,
    })).toBe("opencode");
  });
});
