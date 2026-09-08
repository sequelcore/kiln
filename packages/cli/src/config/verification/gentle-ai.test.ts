import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KilnGlobalConfig } from "../global-config.js";
import { parseObservedGentleAiVersion, resolveGentleAiConfiguration } from "./gentle-ai.js";

let root: string | undefined;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe("Gentle AI configuration", () => {
  it.each(["missing", "invalid"])("does not execute with %s approval evidence", (state) => {
    const runVersion = vi.fn();
    const result = resolveGentleAiConfiguration({
      globalConfig: { version: "7", verification: { inferential: { gentleAi: { executable: "C:/tools/gentle-ai.exe", expectedVersion: "2.5.0-rc.1" } } } },
      repositoryRoot: "C:/project", platform: "win32", runVersion,
      readExecutable: () => new Uint8Array(),
      readApproval: () => { if (state === "invalid") throw new Error("corrupt evidence"); return undefined; },
    });
    expect(result.diagnostic?.code).toBe(`approval_${state}`);
    expect(runVersion).not.toHaveBeenCalled();
  });

  it("resolves only an exact prerelease version and executable digest", () => {
    root = mkdtempSync(join(tmpdir(), "kiln-gentle-config-"));
    const executable = join(root, "gentle-ai.exe");
    const bytes = "gentle fixture";
    writeFileSync(executable, bytes);
    const expectedExecutableDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const globalConfig = {
      verification: {
        inferential: {
          gentleAi: {
            executable,
            expectedVersion: "2.5.0-rc.1",
          },
        },
      },
    } as KilnGlobalConfig;
    const resolution = resolveGentleAiConfiguration({
      globalConfig,
      repositoryRoot: root,
      readApproval: (selection) => ({ version: 1, selection, digest: expectedExecutableDigest }),
      platform: "win32",
      runVersion: () => "gentle-ai 2.5.0-rc.1",
    });
    expect(resolution.diagnostic).toBeUndefined();
    expect(resolution.options).toMatchObject({
      executable,
      expectedVersion: "2.5.0-rc.1",
      expectedExecutableDigest,
      repositoryRoot: root,
    });
  });

  it("rejects version and digest drift", () => {
    expect(parseObservedGentleAiVersion("gentle-ai 2.5.0-rc.1")).toBe("2.5.0-rc.1");
    expect(() => parseObservedGentleAiVersion("gentle-ai dev")).toThrow(/canonical/);
  });

  it("fails closed when executable bytes cannot be read", () => {
    root = mkdtempSync(join(tmpdir(), "kiln-gentle-config-"));
    const executable = join(root, "gentle-ai.exe");
    writeFileSync(executable, "gentle fixture");
    const globalConfig = {
      verification: {
        inferential: {
          gentleAi: {
            executable,
            expectedVersion: "2.5.0-rc.1",
          },
        },
      },
    } as KilnGlobalConfig;
    const resolution = resolveGentleAiConfiguration({
      globalConfig,
      repositoryRoot: root,
      readApproval: (selection) => ({ version: 1, selection, digest: `sha256:${"ab".repeat(32)}` }),
      platform: "win32",
      runVersion: () => "2.5.0-rc.1",
      readExecutable: () => {
        throw new Error("access denied");
      },
    });
    expect(resolution.diagnostic).toMatchObject({ code: "digest_probe_failed" });
  });

  it("does not execute an executable whose digest does not match", () => {
    root = mkdtempSync(join(tmpdir(), "kiln-gentle-config-"));
    const executable = join(root, "gentle-ai.exe");
    writeFileSync(executable, "unexpected bytes");
    const runVersion = vi.fn(() => "gentle-ai 2.5.0-rc.1");
    const resolution = resolveGentleAiConfiguration({
      globalConfig: {
        version: "7",
        verification: {
          inferential: {
            gentleAi: {
              executable,
              expectedVersion: "2.5.0-rc.1",
            },
          },
        },
      },
      repositoryRoot: root,
      readApproval: (selection) => ({ version: 1, selection, digest: `sha256:${"ab".repeat(32)}` }),
      platform: "win32",
      runVersion,
    });

    expect(resolution.diagnostic).toMatchObject({ code: "digest_mismatch" });
    expect(runVersion).not.toHaveBeenCalled();
  });
});
