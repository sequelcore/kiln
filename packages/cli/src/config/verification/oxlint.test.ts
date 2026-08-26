import { describe, expect, it, vi } from "vitest";
import type { KilnGlobalConfig } from "./global-config.js";
import { parseObservedOxlintVersion, resolveStaticAnalysisConfiguration } from "./oxlint.js";

function globalConfig(executable = "oxlint", expectedVersion = "1.80.0"): KilnGlobalConfig {
  return {
    version: "5",
    verification: {
      static: {
        oxlint: { executable, expectedVersion },
      },
    },
  };
}

describe("static-analysis-config", () => {
  it("parses Oxlint's canonical version output", () => {
    expect(parseObservedOxlintVersion("Version: 1.80.0\n")).toBe("1.80.0");
    expect(parseObservedOxlintVersion("oxlint 1.80.0\r\n")).toBe("1.80.0");
  });

  it("resolves the configured native executable and records its observed version", () => {
    const runVersion = vi.fn(() => "Version: 1.80.0");
    const result = resolveStaticAnalysisConfiguration({
      globalConfig: globalConfig("C:/tools/oxlint.exe"),
      platform: "win32",
      discoveredPaths: [],
      runVersion,
    });

    expect(result).toEqual({
      options: { executable: "C:/tools/oxlint.exe", analyzerVersion: "1.80.0" },
    });
    expect(runVersion).toHaveBeenCalledWith("C:/tools/oxlint.exe");
  });

  it("does not register a mismatched or unparseable analyzer", () => {
    const mismatch = resolveStaticAnalysisConfiguration({
      globalConfig: globalConfig(),
      platform: "linux",
      runVersion: () => "Version: 1.79.0",
    });
    const malformed = resolveStaticAnalysisConfiguration({
      globalConfig: globalConfig(),
      platform: "linux",
      runVersion: () => "latest",
    });

    expect(mismatch).toMatchObject({
      diagnostic: { code: "version_mismatch", expectedVersion: "1.80.0", observedVersion: "1.79.0" },
    });
    expect(malformed).toMatchObject({ diagnostic: { code: "version_unparseable" } });
  });

  it("remains absent when the operator did not opt in", () => {
    expect(resolveStaticAnalysisConfiguration({ globalConfig: null })).toMatchObject({
      diagnostic: { code: "not_configured" },
    });
  });

  it("rejects Windows command shims at the native process boundary", () => {
    const runVersion = vi.fn(() => "Version: 1.80.0");
    const result = resolveStaticAnalysisConfiguration({
      globalConfig: globalConfig(),
      platform: "win32",
      discoveredPaths: ["C:\\tools\\oxlint.cmd"],
      runVersion,
    });

    expect(result).toMatchObject({ diagnostic: { code: "executable_unavailable" } });
    expect(runVersion).not.toHaveBeenCalled();
  });
});
