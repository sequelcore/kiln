import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { defaultGlobalConfig, validateGlobalConfig } from "../../src/config/global-config.js";
import {
  executionTargetEvidenceRevision,
  projectExecutionTargetCatalogFromIntent,
  type ExecutionTargetCatalogIntent,
} from "../../src/config/execution-target-evidence-store.js";

const FIXTURE_PATH = resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "scripts",
  "fixtures",
  "startup-profile-global-config.yaml",
);
const EVIDENCE_FIXTURE_PATH = resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "scripts",
  "fixtures",
  "startup-profile-execution-target-evidence.json",
);

function readFixture(): Record<string, unknown> {
  return parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<string, unknown>;
}

/**
 * The GUI startup profile measures a configured operator environment, so it runs
 * against a committed fixture rather than whatever the host has. These cases keep
 * that fixture honest: a schema change or a change to the canonical defaults must
 * fail here, not silently degrade the benchmark.
 */
describe("startup profile global configuration fixture", () => {
  it("satisfies the canonical global configuration contract", () => {
    expect(() => validateGlobalConfig(readFixture())).not.toThrow();
  });

  it("differs from canonical defaults only by its target and project-owned permissions", () => {
    const { targetCatalog, targetRouting, ...rest } = readFixture();
    const { permissions: _projectOwnedPermissions, ...defaultsWithoutPermissions } = defaultGlobalConfig();

    expect(targetCatalog, "the fixture exists to supply a direct target").toBeDefined();
    expect(targetRouting).toBeDefined();
    expect(readFixture()).not.toHaveProperty("permissions");
    expect(rest).toEqual(defaultsWithoutPermissions);
  });

  it("routes to a direct target that the catalog actually declares", () => {
    const fixture = readFixture() as {
      targetCatalog: { targets: readonly { id: string; kind: string }[] };
      targetRouting: { defaultTargetId: string };
    };

    expect(fixture.targetCatalog.targets).toContainEqual(
      expect.objectContaining({ id: fixture.targetRouting.defaultTargetId, kind: "direct" }),
    );
  });

  it("binds the intent to an exact, admissible managed-evidence snapshot", () => {
    const fixture = readFixture() as { targetCatalog: ExecutionTargetCatalogIntent };
    const evidence = JSON.parse(readFileSync(EVIDENCE_FIXTURE_PATH, "utf8")) as unknown;

    expect(executionTargetEvidenceRevision(evidence)).toBe(fixture.targetCatalog.evidenceRevision);
    expect(projectExecutionTargetCatalogFromIntent(
      fixture.targetCatalog,
      evidence,
      fixture.targetCatalog.evidenceRevision,
      { now: new Date("2026-08-20T00:00:00.000Z") },
    ).targets).toHaveLength(1);
  });
});
