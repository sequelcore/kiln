import { describe, expect, it } from "vitest";
import {
  assessBoundedWorkScopePolicy,
  boundedWorkTripwireDiagnostics,
  pathWithinRoot,
  type BoundedWorkScopePolicyQuery,
} from "../../src/work-governance/index.js";
import type { BoundedWorkScope } from "../../src/work-governance/index.js";

const scope = (overrides: Partial<BoundedWorkScope> = {}): BoundedWorkScope => ({
  allowedWorkItemIds: ["work-core"],
  permittedEffects: ["modify_source"],
  permittedSurfaces: ["core"],
  allowedRoots: ["packages/core"],
  deniedRoots: [],
  refactorAuthority: "scoped",
  migrationAuthority: "none",
  dependencyAuthority: "none",
  ...overrides,
});

const query = (overrides: Partial<BoundedWorkScopePolicyQuery> = {}): BoundedWorkScopePolicyQuery => ({
  scope: scope(),
  nonGoals: [],
  workItemId: "work-core",
  effect: "modify_source",
  surface: "core",
  paths: [],
  requestedOutcomes: [],
  ...overrides,
});

describe("pathWithinRoot", () => {
  it("treats the repository root as containing every path", () => {
    expect(pathWithinRoot("packages/core/src/index.ts", ".")).toBe(true);
  });

  it("matches a path equal to the root", () => {
    expect(pathWithinRoot("packages/core", "packages/core")).toBe(true);
  });

  it("matches on a path segment boundary, not a bare string prefix", () => {
    expect(pathWithinRoot("packages/core/src/index.ts", "packages/core")).toBe(true);
    expect(pathWithinRoot("packages/core-extra/src/index.ts", "packages/core")).toBe(false);
  });
});

describe("assessBoundedWorkScopePolicy", () => {
  it("admits a fully permitted query", () => {
    expect(assessBoundedWorkScopePolicy(query({ paths: ["packages/core/src/index.ts"] }))).toEqual([]);
  });

  it("denies a path under a denied root even when it is also under an allowed root", () => {
    const violations = assessBoundedWorkScopePolicy(query({
      scope: scope({ allowedRoots: ["packages/core"], deniedRoots: ["packages/core/src/security"] }),
      paths: ["packages/core/src/security/keys.ts"],
    }));
    expect(violations).toEqual([{ kind: "path_denied", value: "packages/core/src/security/keys.ts" }]);
  });

  it("denies a path under a denied root even when the same root is listed as allowed", () => {
    const violations = assessBoundedWorkScopePolicy(query({
      scope: scope({ allowedRoots: ["packages/core"], deniedRoots: ["packages/core"] }),
      paths: ["packages/core/src/index.ts"],
    }));
    expect(violations).toEqual([{ kind: "path_denied", value: "packages/core/src/index.ts" }]);
  });

  it("reports a path outside every allowed root as not permitted", () => {
    const violations = assessBoundedWorkScopePolicy(query({ paths: ["packages/cli/src/index.ts"] }));
    expect(violations).toEqual([{ kind: "path_not_permitted", value: "packages/cli/src/index.ts" }]);
  });

  it("reports work item, effect, surface, path, and non-goal violations in declaration order", () => {
    const violations = assessBoundedWorkScopePolicy(query({
      scope: scope({ deniedRoots: ["packages/core/src/security"] }),
      nonGoals: ["Redesign provider economics."],
      workItemId: "work-other",
      effect: "external_write",
      surface: "gui",
      paths: ["packages/core/src/security/keys.ts"],
      requestedOutcomes: ["Redesign provider economics."],
    }));
    expect(violations.map((violation) => violation.kind)).toEqual([
      "work_item_not_permitted",
      "effect_not_permitted",
      "surface_not_permitted",
      "path_denied",
      "non_goal_requested",
    ]);
  });
});

describe("boundedWorkTripwireDiagnostics", () => {
  it("reports only metrics that exceed a configured threshold", () => {
    expect(boundedWorkTripwireDiagnostics(
      { changedFiles: 10, toolCalls: 50 },
      { changedFiles: 11, changedLines: 900, toolCalls: 50 },
    )).toEqual([
      { kind: "tripwire_exceeded", metric: "changed_files", actual: 11, threshold: 10 },
    ]);
  });

  it("reports nothing when no threshold is configured", () => {
    expect(boundedWorkTripwireDiagnostics({}, { changedFiles: 9000 })).toEqual([]);
  });
});
