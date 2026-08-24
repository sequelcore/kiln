import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCliMemoryStorage } from "../../src/application/cli-memory-storage.js";

describe("cli memory storage", () => {
  it("uses the canonical private project state namespace", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "kiln-memory-project-"));
    const kilnHome = mkdtempSync(join(tmpdir(), "kiln-memory-home-"));

    const resolution = resolveCliMemoryStorage(projectRoot, { kilnHome });

    expect(resolution.projectRoot).toBe(realpathSync(projectRoot));
    expect(resolution.projectRuntimeId).toMatch(/^krp_[a-f0-9]{64}$/u);
    expect(resolution.stateDir).toBe(
      join(kilnHome, "projects", resolution.projectRuntimeId, "memory"),
    );
    expect(resolution.memoryDbPath).toBe(join(resolution.stateDir, "memory.db"));
  });

  it("accepts an explicit Kiln home seam", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "kiln-memory-project-"));
    const operatorHome = mkdtempSync(join(tmpdir(), "kiln-memory-operator-"));
    const kilnHome = join(operatorHome, ".kiln");

    const resolution = resolveCliMemoryStorage(projectRoot, { kilnHome });

    expect(resolution.stateDir).toBe(
      join(kilnHome, "projects", resolution.projectRuntimeId, "memory"),
    );
  });

  it("does not read legacy app-state environment overrides", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "kiln-memory-project-"));
    const operatorHome = mkdtempSync(join(tmpdir(), "kiln-memory-operator-"));
    const kilnHome = join(operatorHome, ".kiln");
    const previous = process.env.KILN_STATE_HOME;
    process.env.KILN_STATE_HOME = join(operatorHome, "legacy-state-home");
    try {
      const resolution = resolveCliMemoryStorage(projectRoot, { kilnHome });
      expect(resolution.stateDir).not.toContain("legacy-state-home");
    } finally {
      if (previous === undefined) delete process.env.KILN_STATE_HOME;
      else process.env.KILN_STATE_HOME = previous;
    }
  });
});
