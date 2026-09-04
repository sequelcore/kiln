import { describe, expect, it, vi } from "vitest";
import {
  resolveWindowsTaskkillExecutable,
  terminateWindowsProcessTree,
} from "../../src/utils/windows-process-tree.js";

describe("Windows process-tree termination", () => {
  it("resolves taskkill from the trusted Windows system root", () => {
    expect(resolveWindowsTaskkillExecutable("C:\\Windows")).toBe("C:\\Windows\\System32\\taskkill.exe");
    expect(resolveWindowsTaskkillExecutable("Windows")).toBeUndefined();
    expect(resolveWindowsTaskkillExecutable(undefined)).toBeUndefined();
  });

  it("terminates one exact process tree without a shell or ambient PATH lookup", async () => {
    const run = vi.fn(async () => 0);

    await expect(terminateWindowsProcessTree(17680, {
      systemRoot: "C:\\Windows",
      run,
    })).resolves.toBe(true);

    expect(run).toHaveBeenCalledWith(
      "C:\\Windows\\System32\\taskkill.exe",
      ["/pid", "17680", "/t", "/f"],
      { windowsHide: true, shell: false, stdio: "ignore" },
    );
  });

  it("fails closed when SystemRoot is not an absolute trusted path", async () => {
    const run = vi.fn();
    await expect(terminateWindowsProcessTree(17680, { systemRoot: "Windows", run })).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});
