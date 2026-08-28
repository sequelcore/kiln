import type { ResolvedVendoredToolBinary } from "@kilnai/tools";
import { STATIC_ANALYSIS_PROFILE_CONFIG_DIGEST } from "@kilnai/core/verification";
import { describe, expect, it, vi } from "vitest";
import type { KilnGlobalConfig } from "../global-config.js";
import { parseObservedOxlintVersion, resolveStaticAnalysisConfiguration } from "./oxlint.js";

const managedBinary: ResolvedVendoredToolBinary = {
  binary: "oxlint",
  path: "C:/kiln/tools/oxlint.exe",
  packageName: "@kilnai/tools-win32-x64",
  packageRoot: "C:/kiln/tools",
  platform: "win32",
  arch: "x64",
  version: "1.80.0",
  archiveSha256: "a".repeat(64),
  binarySha256: "b".repeat(64),
};

function globalConfig(): KilnGlobalConfig {
  return {
    version: "6",
    verification: {
      static: {
        oxlint: { enabled: true },
      },
    },
  };
}

describe("static-analysis-config", () => {
  it("parses Oxlint's canonical version output", () => {
    expect(parseObservedOxlintVersion("Version: 1.80.0\n")).toBe("1.80.0");
    expect(parseObservedOxlintVersion("oxlint 1.80.0\r\n")).toBe("1.80.0");
  });

  it("resolves Kiln's exact managed artifact and records its identity", () => {
    const runVersion = vi.fn(() => "Version: 1.80.0");
    const result = resolveStaticAnalysisConfiguration({
      globalConfig: globalConfig(),
      platform: "win32",
      arch: "x64",
      resolveManagedBinary: () => managedBinary,
      runVersion,
    });

    expect(result).toEqual({
      options: { executable: managedBinary.path, analyzerVersion: "1.80.0" },
      identity: {
        version: "1.80.0",
        executableDigest: `sha256:${managedBinary.binarySha256}`,
        sourceArchiveDigest: `sha256:${managedBinary.archiveSha256}`,
        profileConfigDigest: STATIC_ANALYSIS_PROFILE_CONFIG_DIGEST,
      },
    });
    expect(runVersion).toHaveBeenCalledWith(managedBinary.path);
  });

  it("does not register a missing, mismatched, or unparseable artifact", () => {
    const missing = resolveStaticAnalysisConfiguration({
      globalConfig: globalConfig(),
      platform: "linux",
      arch: "arm64",
      resolveManagedBinary: () => undefined,
    });
    const mismatch = resolveStaticAnalysisConfiguration({
      globalConfig: globalConfig(),
      resolveManagedBinary: () => managedBinary,
      runVersion: () => "Version: 1.79.0",
    });
    const malformed = resolveStaticAnalysisConfiguration({
      globalConfig: globalConfig(),
      resolveManagedBinary: () => managedBinary,
      runVersion: () => "latest",
    });

    expect(missing).toMatchObject({ diagnostic: { code: "managed_artifact_unavailable" } });
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
});
