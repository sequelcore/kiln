import { describe, expect, it, vi } from "vitest";
import type { KilnGlobalConfig } from "./global-config.js";
import {
  parseObservedDafnyVersion,
  resolveFormalVerificationConfiguration,
} from "./dafny.js";

function globalConfig(executable = "dafny", expectedVersion = "4.11.0"): KilnGlobalConfig {
  return {
    version: "5",
    verification: {
      formal: {
        dafny: { executable, expectedVersion },
      },
    },
  };
}

describe("formal-verification-config", () => {
  it("parses a Dafny build version to its canonical version", () => {
    expect(parseObservedDafnyVersion("Dafny 4.11.0+build.123\n")).toBe("4.11.0");
    expect(parseObservedDafnyVersion("4.11.0\r\n")).toBe("4.11.0");
  });

  it("resolves the operator-written executable and records the observed canonical version", () => {
    const runVersion = vi.fn(() => "Dafny 4.11.0+build.123");

    const result = resolveFormalVerificationConfiguration({
      globalConfig: globalConfig("C:/tools/dafny.exe"),
      platform: "win32",
      discoveredPaths: [],
      runVersion,
    });

    expect(result).toEqual({
      options: {
        executable: "C:/tools/dafny.exe",
        verifierVersion: "4.11.0",
      },
    });
    expect(runVersion).toHaveBeenCalledWith("C:/tools/dafny.exe");
  });

  it("returns a typed diagnostic without registration when the version mismatches", () => {
    const result = resolveFormalVerificationConfiguration({
      globalConfig: globalConfig(),
      platform: "linux",
      runVersion: () => "Dafny 4.3.0",
    });

    expect(result.options).toBeUndefined();
    expect(result.diagnostic).toMatchObject({
      code: "version_mismatch",
      expectedVersion: "4.11.0",
      observedVersion: "4.3.0",
    });
  });

  it("returns a typed diagnostic when no operator declaration exists", () => {
    const result = resolveFormalVerificationConfiguration({ globalConfig: null });

    expect(result).toMatchObject({
      diagnostic: { code: "not_configured" },
    });
  });

  it("preserves the native Windows shim failure instead of launching a .cmd path", () => {
    const runVersion = vi.fn(() => "Dafny 4.11.0");
    const result = resolveFormalVerificationConfiguration({
      globalConfig: globalConfig("dafny"),
      platform: "win32",
      discoveredPaths: ["C:\\tools\\dafny.cmd"],
      runVersion,
    });

    expect(result.diagnostic).toMatchObject({ code: "executable_unavailable" });
    expect(result.diagnostic?.message).toContain("native Windows executable");
    expect(runVersion).not.toHaveBeenCalled();
  });
});
