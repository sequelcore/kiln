import { describe, expect, it } from "vitest";
import type { KilnSkillSourceInventorySnapshot } from "@kilnai/gateway-contracts";
import { compileCodexExternalSkillExposure, computeCodexExternalInventoryFingerprint } from "../../src/config/external-skill-exposure.js";

const digest = (char: string) => `sha256:${char.repeat(64)}`;
const healthy = { status: "healthy" as const, fileCount: 1, packageBytes: 10, brokenResourceCount: 0, riskSignals: [], diagnostics: [] };
const trusted = { level: "external-unverified" as const, reason: "External source; not locally reviewed." };
const fresh = { status: "current" as const, reason: "Synced from source." };
const noDependencies = { allowedTools: [], executableResources: 0 };
function inventory(complete = true): KilnSkillSourceInventorySnapshot {
  return { complete, candidates: [
    { name: "one", canonicalName: "one", sourceKind: "shared-agents", sourceId: "shared:one", exposureScope: "user", sourcePath: "one/SKILL.md", relationship: "external", packageDigest: digest("a"), descriptionBytes: 3, trust: trusted, freshness: fresh, dependencies: noDependencies, health: healthy, applicableHarnesses: ["codex", "opencode"], effectiveVisibility: "implicit" },
    { name: "two", canonicalName: "two", sourceKind: "plugin", sourceId: "plugin:two", exposureScope: "user", sourcePath: "two/SKILL.md", relationship: "external", packageDigest: digest("b"), descriptionBytes: 3, trust: trusted, freshness: fresh, dependencies: noDependencies, health: healthy, applicableHarnesses: ["codex"], effectiveVisibility: "implicit" },
    { name: "manual", canonicalName: "manual", sourceKind: "system", sourceId: "system:manual", exposureScope: "harness", sourcePath: "manual/SKILL.md", relationship: "external", packageDigest: digest("c"), descriptionBytes: 3, trust: trusted, freshness: fresh, dependencies: noDependencies, health: healthy, applicableHarnesses: ["codex"], effectiveVisibility: "explicit-only" },
  ], sources: [], identities: [], resolutions: [], harnesses: [], diagnostics: complete ? [] : [{ code: "incomplete", message: "failed" }] };
}

describe("external skill exposure", () => {
  const expectedFingerprint = computeCodexExternalInventoryFingerprint([
    { sourceId: "shared:one", packageDigest: digest("a") }, { sourceId: "plugin:two", packageDigest: digest("b") },
  ]);
  it("compiles the reviewed keep-set complement into exact disabled paths", () => {
    const result = compileCodexExternalSkillExposure({ inventory: inventory(), policy: { version: 1, harnesses: { codex: { expectedFingerprint, keepImplicit: [{ sourceId: "shared:one", packageDigest: digest("a") }] } } }, absolutePathBySourceId: new Map([["shared:one", "C:/shared/one/SKILL.md"], ["plugin:two", "C:/plugin/two/SKILL.md"]]), now: new Date("2026-08-12T00:00:00Z") });
    expect(result.disabledItems).toEqual([{ path: "C:/plugin/two/SKILL.md", enabled: false }]);
    expect(result.disabledItems.some((item) => item.path.includes("manual"))).toBe(false);
    expect(result.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
  it("fails closed for incomplete inventory, digest drift, and absent absolute paths", () => {
    expect(() => compileCodexExternalSkillExposure({ inventory: inventory(false), policy: { version: 1, harnesses: { codex: { expectedFingerprint, keepImplicit: [] } } }, absolutePathBySourceId: new Map() })).toThrow("incomplete");
    expect(() => compileCodexExternalSkillExposure({ inventory: inventory(), policy: { version: 1, harnesses: { codex: { expectedFingerprint, keepImplicit: [{ sourceId: "shared:one", packageDigest: digest("c") }] } } }, absolutePathBySourceId: new Map() })).toThrow("digest drifted");
    expect(() => compileCodexExternalSkillExposure({ inventory: inventory(), policy: { version: 1, harnesses: { codex: { expectedFingerprint, keepImplicit: [] } } }, absolutePathBySourceId: new Map() })).toThrow("Absolute external catalog path");
  });

  it("refuses to keep a digest-reviewed package that currently has blocked health", () => {
    const base = inventory();
    const candidates = base.candidates.map((candidate) => candidate.sourceId === "shared:one"
      ? { ...candidate, health: { ...healthy, status: "blocked" as const, diagnostics: [{ code: "broken-resource", message: "Missing referenced file." }] } }
      : candidate);
    expect(() => compileCodexExternalSkillExposure({
      inventory: { ...base, candidates },
      policy: { version: 1, harnesses: { codex: { expectedFingerprint, keepImplicit: [{ sourceId: "shared:one", packageDigest: digest("a") }] } } },
      absolutePathBySourceId: new Map(),
    })).toThrow("blocked by package health");
  });

  it("excludes project-scoped candidates from global rules and fingerprints", () => {
    const base = inventory();
    const projectCandidate = { ...base.candidates[0]!, sourceId: "shared:project:one", exposureScope: "project" as const };
    const withProject = { ...base, candidates: [...base.candidates, projectCandidate] };
    const policy = { version: 1 as const, harnesses: { codex: { expectedFingerprint, keepImplicit: [] } } };
    const paths = new Map([["shared:one", "C:/user/one/SKILL.md"], ["plugin:two", "C:/plugin/two/SKILL.md"], [projectCandidate.sourceId, "D:/project/.agents/skills/one/SKILL.md"]]);
    const first = compileCodexExternalSkillExposure({ inventory: base, policy, absolutePathBySourceId: paths });
    const second = compileCodexExternalSkillExposure({ inventory: withProject, policy, absolutePathBySourceId: paths });
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.disabledItems).toEqual(first.disabledItems);
    expect(second.disabledItems.some((item) => item.path.startsWith("D:/project"))).toBe(false);
  });
});
