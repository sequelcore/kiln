import { describe, expect, it } from "vitest";
import type { KilnSkillSourceInventorySnapshot } from "@kilnai/gateway-contracts";
import {
  compileCodexExternalSkillExposure,
} from "../../src/config/external-skill-exposure.js";

const digest = (char: string) => `sha256:${char.repeat(64)}`;
const healthy = {
  status: "healthy" as const,
  fileCount: 1,
  packageBytes: 10,
  brokenResourceCount: 0,
  riskSignals: [],
  diagnostics: [],
};
const trusted = { level: "external-unverified" as const, reason: "External source; not locally reviewed." };
const fresh = { status: "current" as const, reason: "Synced from source." };
const noDependencies = { allowedTools: [], executableResources: 0 };
function inventory(complete = true): KilnSkillSourceInventorySnapshot {
  return {
    complete,
    candidates: [
      {
        name: "one",
        canonicalName: "one",
        sourceKind: "shared-agents",
        sourceId: "shared:one",
        exposureScope: "user",
        sourcePath: "one/SKILL.md",
        relationship: "external",
        packageDigest: digest("a"),
        descriptionBytes: 3,
        trust: trusted,
        freshness: fresh,
        dependencies: noDependencies,
        health: healthy,
        applicableHarnesses: ["codex", "opencode"],
        effectiveVisibility: "implicit",
      },
      {
        name: "two",
        canonicalName: "two",
        sourceKind: "plugin",
        sourceId: "plugin:two",
        exposureScope: "user",
        sourcePath: "two/SKILL.md",
        relationship: "external",
        packageDigest: digest("b"),
        descriptionBytes: 3,
        trust: trusted,
        freshness: fresh,
        dependencies: noDependencies,
        health: healthy,
        applicableHarnesses: ["codex"],
        effectiveVisibility: "implicit",
      },
      {
        name: "manual",
        canonicalName: "manual",
        sourceKind: "system",
        sourceId: "system:manual",
        exposureScope: "harness",
        sourcePath: "manual/SKILL.md",
        relationship: "external",
        packageDigest: digest("c"),
        descriptionBytes: 3,
        trust: trusted,
        freshness: fresh,
        dependencies: noDependencies,
        health: healthy,
        applicableHarnesses: ["codex"],
        effectiveVisibility: "explicit-only",
      },
    ],
    sources: [],
    identities: [],
    resolutions: [],
    harnesses: [],
    diagnostics: complete ? [] : [{ code: "incomplete", message: "failed" }],
  };
}

describe("external skill exposure", () => {
  const policy = { version: 2 as const, harnesses: { codex: { keepImplicit: [{ sourceId: "shared:one" }] } } };
  const approvals = [{ version: 1 as const, harness: "codex" as const, sourceId: "shared:one", packageDigest: digest("a") }];
  const paths = new Map([["shared:one", "C:/shared/one/SKILL.md"], ["plugin:two", "C:/plugin/two/SKILL.md"]]);
  const compile = (snapshot = inventory(), evidence = approvals) => compileCodexExternalSkillExposure({
    inventory: snapshot, policy, approvals: evidence, absolutePathBySourceId: paths,
  });

  it("keeps only exact approved contents and suppresses the remaining implicit candidates", () => {
    const result = compile();
    expect(result.disabledItems).toEqual([{ path: "C:/plugin/two/SKILL.md", enabled: false }]);
    expect(result.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("requires review for missing evidence or changed selected contents", () => {
    expect(() => compile(inventory(), [])).toThrow("Needs review: one");
    expect(() => compile(inventory(), [{ ...approvals[0]!, packageDigest: digest("b") }])).toThrow("Needs review: one");
  });

  it("does not invalidate approval when unrelated inventory changes", () => {
    const base = inventory();
    const changed = { ...base, candidates: base.candidates.map((candidate) => candidate.sourceId === "plugin:two"
      ? { ...candidate, packageDigest: digest("d") } : candidate) };
    expect(compile(changed).disabledItems).toEqual(compile(base).disabledItems);
    expect(compile(changed).fingerprint).not.toBe(compile(base).fingerprint);
    const added = { ...base.candidates[1]!, sourceId: "plugin:new" };
    const result = compileCodexExternalSkillExposure({ inventory: { ...base, candidates: [...base.candidates, added] },
      policy, approvals, absolutePathBySourceId: new Map([...paths, [added.sourceId, "C:/new/SKILL.md"]]) });
    expect(result.disabledItems).toContainEqual({ path: "C:/new/SKILL.md", enabled: false });
  });

  it("fails closed for incomplete discovery, absent selections, ambiguity, blocked health, and missing paths", () => {
    expect(() => compile(inventory(false))).toThrow("incomplete");
    const base = inventory();
    expect(() => compile({ ...base, candidates: base.candidates.slice(1) })).toThrow("source is absent");
    expect(() => compile({ ...base, candidates: [...base.candidates, base.candidates[0]!] })).toThrow("Ambiguous");
    expect(() => compile({ ...base, candidates: base.candidates.map((candidate) => ({ ...candidate, health: { ...healthy, status: "blocked" as const } })) })).toThrow("blocked by package health");
    expect(() => compileCodexExternalSkillExposure({ inventory: base, policy, approvals, absolutePathBySourceId: new Map() })).toThrow("Absolute external catalog path");
  });

  it("excludes project candidates from global approval and projection", () => {
    const base = inventory();
    const withProject = { ...base, candidates: [...base.candidates, { ...base.candidates[0]!, sourceId: "project:one", exposureScope: "project" as const }] };
    expect(compile(withProject).fingerprint).toBe(compile(base).fingerprint);
    expect(compile(withProject).disabledItems).toEqual(compile(base).disabledItems);
  });
});
