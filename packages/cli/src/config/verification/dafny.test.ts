import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { KilnGlobalConfig } from "../global-config.js";
import {
  digestDafnyInstallation,
  observeDafnyInstallationDigest,
  parseObservedDafnyVersion,
  resolveFormalVerificationConfiguration,
} from "./dafny.js";

const installationFiles = [
  { relativePath: "Dafny.exe", bytes: new TextEncoder().encode("dafny fixture") },
  { relativePath: "DafnyCore.dll", bytes: new TextEncoder().encode("core fixture") },
] as const;
const expectedInstallationDigest = digestDafnyInstallation(installationFiles);

function globalConfig(
  executable = "C:/tools/dafny.exe",
  expectedVersion = "4.11.0",
  installationRoot = "C:/tools",
): KilnGlobalConfig {
  return {
    version: "7",
    verification: {
      formal: {
        dafny: {
          executable,
          installationRoot,
          expectedVersion,
          expectedInstallationDigest,
        },
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
      runVersion,
      observeInstallationDigest: () => expectedInstallationDigest,
    });

    expect(result).toEqual({
      options: {
        executable: "C:/tools/dafny.exe",
        verifierVersion: "4.11.0",
      },
      identity: {
        version: "4.11.0",
        installationDigest: expectedInstallationDigest,
      },
    });
    expect(runVersion).toHaveBeenCalledWith("C:/tools/dafny.exe");
  });

  it("returns a typed diagnostic without registration when the version mismatches", () => {
    const result = resolveFormalVerificationConfiguration({
      globalConfig: globalConfig("/opt/dafny/dafny", "4.11.0", "/opt/dafny"),
      platform: "linux",
      runVersion: () => "Dafny 4.3.0",
      observeInstallationDigest: () => expectedInstallationDigest,
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
      runVersion,
      observeInstallationDigest: () => expectedInstallationDigest,
    });

    expect(result.diagnostic).toMatchObject({ code: "executable_unavailable" });
    expect(result.diagnostic?.message).toContain("absolute native executable path");
    expect(runVersion).not.toHaveBeenCalled();
  });

  it("fails closed before execution when any configured installation bytes drift", () => {
    const runVersion = vi.fn(() => "Dafny 4.11.0");
    const result = resolveFormalVerificationConfiguration({
      globalConfig: globalConfig("C:/tools/dafny.exe"),
      platform: "win32",
      runVersion,
      observeInstallationDigest: () => digestDafnyInstallation([
        installationFiles[0],
        { relativePath: "DafnyCore.dll", bytes: new TextEncoder().encode("different core") },
      ]),
    });

    expect(result.diagnostic).toMatchObject({
      code: "digest_mismatch",
      expectedInstallationDigest,
    });
    expect(runVersion).not.toHaveBeenCalled();
  });

  it("hashes the complete installation canonically and rejects ambiguous paths", () => {
    expect(digestDafnyInstallation([...installationFiles].reverse())).toBe(expectedInstallationDigest);
    expect(() => digestDafnyInstallation([
      ...installationFiles,
      { relativePath: "DafnyCore.dll", bytes: new Uint8Array() },
    ])).toThrow(/duplicate relative paths/u);
    expect(() => digestDafnyInstallation([
      { relativePath: "../outside.dll", bytes: new Uint8Array() },
    ])).toThrow(/unsafe relative path/u);
  });

  it("streams only a dedicated real installation root and rejects an outside executable", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-dafny-installation-"));
    const outside = mkdtempSync(join(tmpdir(), "kiln-dafny-outside-"));
    try {
      const executable = join(root, "Dafny.exe");
      const core = join(root, "DafnyCore.dll");
      const outsideExecutable = join(outside, "Dafny.exe");
      writeFileSync(executable, installationFiles[0].bytes);
      writeFileSync(core, installationFiles[1].bytes);
      writeFileSync(outsideExecutable, installationFiles[0].bytes);

      expect(observeDafnyInstallationDigest(root, executable)).toBe(expectedInstallationDigest);
      expect(() => observeDafnyInstallationDigest(root, outsideExecutable)).toThrow(/outside/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
