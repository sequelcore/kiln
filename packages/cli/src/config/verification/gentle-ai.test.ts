import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { KilnGlobalConfig } from "../global-config.js";
import { parseObservedGentleAiVersion, resolveGentleAiConfiguration } from "./gentle-ai.js";

let root: string | undefined;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe("Gentle AI configuration", () => {
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
            expectedExecutableDigest,
          },
        },
      },
    } as KilnGlobalConfig;
    const resolution = resolveGentleAiConfiguration({
      globalConfig,
      repositoryRoot: root,
      platform: "win32",
      discoveredPaths: [executable],
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
            expectedExecutableDigest: `sha256:${"ab".repeat(32)}`,
          },
        },
      },
    } as KilnGlobalConfig;
    const resolution = resolveGentleAiConfiguration({
      globalConfig,
      repositoryRoot: root,
      platform: "win32",
      discoveredPaths: [executable],
      runVersion: () => "2.5.0-rc.1",
      readExecutable: () => {
        throw new Error("access denied");
      },
    });
    expect(resolution.diagnostic).toMatchObject({ code: "digest_probe_failed" });
  });
});
