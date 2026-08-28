import { describe, expect, it } from "vitest";
import type { KilnConfigSetupSnapshot, KilnSkillCatalogSummarySnapshot } from "@kilnai/gateway-contracts";
import { formatSetupSnapshot } from "../src/setup-format.js";

function setupSnapshot(): KilnConfigSetupSnapshot {
  return {
    projectRoot: "C:/workspace/kiln",
    projectContext: {
      path: "C:/workspace/kiln/.kiln/project-context.md",
      status: "valid",
      recommendation: "none",
    },
    projectInstructions: [],
    workflowSnapshots: [],
    globalInstructionShims: [],
    nativeProjections: [],
    permissionIntegrity: [{
      harness: "codex",
      desired: {
        profile: "trusted-full-access",
        source: "operator-local-config",
        observedAt: "2026-07-01T15:00:00.000Z",
        verifiedAt: "2026-07-01T15:00:01.000Z",
        freshness: "current",
        proof: "proven",
      },
      persistedNative: {
        profile: "restricted",
        source: "native-config",
        observedAt: "2026-07-01T15:01:00.000Z",
        verifiedAt: "2026-07-01T15:01:01.000Z",
        freshness: "current",
        proof: "proven",
        projectionOwnership: "kiln-managed",
      },
      effectiveRuntime: {
        profile: "workspace-write",
        source: "runtime-observation",
        observedAt: "2026-07-01T15:02:00.000Z",
        verifiedAt: "2026-07-01T15:02:01.000Z",
        freshness: "current",
        proof: "proven",
      },
      enforcement: {
        approvalControl: "enforced",
        filesystemSandbox: "enforced",
        networkBoundary: "enforced",
        strength: "strong",
      },
      authorization: {
        status: "authorized",
        scope: "operator-local",
        authorizedBy: "operator",
        authorizedAt: "2026-07-01T14:59:00.000Z",
        revocable: true,
      },
      semanticLoss: [],
      semanticLimitations: [],
      limitationAcceptances: [],
      classification: "runtime-policy-mismatch",
      recommendation: "Restart Codex with proven Full Access or choose a narrower trusted profile.",
    remediationRequiresApproval: true,
    lastVerifiedAt: "2026-07-01T15:02:01.000Z",
  }],
    skillDiagnostics: { state: "current", observedAt: "2026-07-01T15:03:00.000Z" },
    recommendedActions: ["none"],
  };
}

function skillCatalog(): KilnSkillCatalogSummarySnapshot {
  return {
    complete: false,
    healthyPackages: 3,
    warningPackages: 1,
    blockedPackages: 1,
    equivalentDuplicates: 3,
    issues: [{ skillName: "planner", kind: "drifted", harness: "codex", projectionState: "drifted", path: "C:/Users/test/.codex/skills/planner/SKILL.md" }],
    divergentCollisions: 2,
    caseCollisions: 1,
    issueCount: 4,
    omittedIssueCount: 3,
    harnesses: [
      { harness: "opencode", candidateCount: 8, descriptionBytes: 800, budget: { status: "unknown", reason: "No authority." } },
      { harness: "codex", candidateCount: 12, descriptionBytes: 1200, budget: { status: "unknown", reason: "No authority." } },
      { harness: "claude", candidateCount: 9, descriptionBytes: 900, budget: { status: "unknown", reason: "No authority." } },
    ],
    externalExposure: [],
  };
}

describe("formatSetupSnapshot", () => {
  it("prints the shared effective value, provenance chain, and health", () => {
    const output = formatSetupSnapshot({
      ...setupSnapshot(),
      effectiveConfig: {
        schemaRevision: 1,
        health: "current",
        fields: [{
          identity: "/permissions",
          value: { sandbox: "read-only" },
          scope: "effective",
          source: "composed",
          sourcePath: "kiln://effective/permissions",
          defaultStatus: "explicit",
          overrideChain: [
            { scope: "global", sourcePath: "C:/home/.kiln/config.yaml", disposition: "contributed" },
            { scope: "project", sourcePath: "C:/workspace/kiln/.kiln/kiln.yaml", disposition: "contributed" },
          ],
          health: "current",
          schemaRevision: 1,
          activation: "next-session",
          sensitivity: "public",
        }],
      },
    });

    expect(output).toContain("effective configuration: current");
    expect(output).toContain("/permissions: source=composed health=current activation=next-session");
    expect(output).toContain('value={"sandbox":"read-only"}');
    expect(output).toContain("chain=global:contributed -> project:contributed");
  });

  it("prints shared permission integrity evidence for TUI setup status", () => {
    const output = formatSetupSnapshot(setupSnapshot());

    expect(output).toContain("permission integrity:");
    expect(output).toContain("codex: runtime-policy-mismatch");
    expect(output).toContain("desired=trusted-full-access");
    expect(output).toContain("persisted=restricted");
    expect(output).toContain("effective=workspace-write");
    expect(output).toContain("approval required=yes");
    expect(output).toContain("Restart Codex with proven Full Access");
  });

  it("formats global instruction projection setup actions", () => {
    const output = formatSetupSnapshot({
      ...setupSnapshot(),
      recommendedActions: [
        "sync-global-instruction-shims",
        "adopt-or-back-up-global-instructions",
        "review-global-instruction-drift",
      ],
    });

    expect(output).toContain(
      "actions: sync global instruction shims, adopt or back up global instructions, review global instruction drift",
    );
  });

  it("renders each global instruction shim target, harness, status, and recommendation", () => {
    const output = formatSetupSnapshot({
      ...setupSnapshot(),
      globalInstructionShims: [
        {
          targetId: "codex-global-instructions",
          harness: "codex",
          path: "C:/Users/test/.codex/AGENTS.md",
          kind: "global-instruction-shim",
          status: "stale",
          recommendation: "sync-global-instruction-shims",
        },
        {
          targetId: "claude-global-instructions",
          harness: "claude-code",
          path: "C:/Users/test/.claude/CLAUDE.md",
          kind: "global-instruction-shim",
          status: "unmanaged",
          recommendation: "adopt-or-back-up-global-instructions",
        },
        {
          targetId: "opencode-global-instructions",
          harness: "opencode",
          path: "C:/Users/test/.config/opencode/AGENTS.md",
          kind: "global-instruction-shim",
          status: "drifted",
          recommendation: "review-global-instruction-drift",
        },
      ],
    });

    expect(output).toContain("C:/Users/test/.codex/AGENTS.md");
    expect(output).toContain("C:/Users/test/.claude/CLAUDE.md");
    expect(output).toContain("C:/Users/test/.config/opencode/AGENTS.md");
    expect(output).toContain("codex-global-instructions: harness=codex status=stale recommendation=sync global instruction shims");
    expect(output).toContain("claude-global-instructions: harness=claude-code status=unmanaged recommendation=adopt or back up global instructions");
    expect(output).toContain("opencode-global-instructions: harness=opencode status=drifted recommendation=review global instruction drift");
  });

  it("renders an explicit empty global instruction shim state", () => {
    expect(formatSetupSnapshot(setupSnapshot())).toContain("global instruction shims:\n  - none");
  });

  it("renders the bounded shared skill summary deterministically", () => {
    const snapshot = { ...setupSnapshot(), skills: skillCatalog() };

    const first = formatSetupSnapshot(snapshot);
    const second = formatSetupSnapshot({ ...snapshot, skills: { ...skillCatalog(), harnesses: [...skillCatalog().harnesses].reverse() } });

    expect(first).toBe(second);
    expect(first).toContain("skills:");
    expect(first).toContain("inventory=incomplete");
    expect(first).toContain("duplicates=3 collisions=divergent:2,case:1");
    expect(first).toContain("harness=codex implicit=12 description-bytes=1200 budget=unknown");
    expect(first).toContain("issue skill=planner harness=codex kind=drifted status=drifted path=C:/Users/test/.codex/skills/planner/SKILL.md");
    expect(first).toContain("issues omitted=3 total=4");
  });

  it("renders an absent skill summary explicitly", () => {
    expect(formatSetupSnapshot(setupSnapshot())).toContain("skills:\n  - diagnostics=current\n  - unavailable");
  });

  it("renders private workflow snapshot status, path, and drift detail", () => {
    const output = formatSetupSnapshot({
      ...setupSnapshot(),
      workflowSnapshots: [{
        targetId: "workflow-snapshot:manifest",
        path: "C:/Users/test/.kiln/projects/id/projections/workflow-snapshot-manifest.json",
        kind: "workflow-snapshot",
        status: "stale",
        details: "workflow snapshot markdown drifted",
      }],
      recommendedActions: ["sync-workflow-snapshot"],
    });

    expect(output).toContain("workflow snapshots:");
    expect(output).toContain("workflow-snapshot:manifest: stale");
    expect(output).toContain("workflow-snapshot-manifest.json");
    expect(output).toContain("workflow snapshot markdown drifted");
  });

  it("tells the operator how to refresh pending skill diagnostics", () => {
    const snapshot = { ...setupSnapshot(), skillDiagnostics: { state: "pending" as const } };

    expect(formatSetupSnapshot(snapshot)).toContain(
      "diagnostics=pending; run /setup again to view completed skill diagnostics",
    );
  });

  it("renders intentionally omitted diagnostics without retry guidance", () => {
    const snapshot = {
      ...setupSnapshot(),
      skillDiagnostics: {
        state: "not_collected" as const,
        reason: "Skill diagnostics are not collected by this narrow read.",
      },
    };

    const output = formatSetupSnapshot(snapshot);
    expect(output).toContain("diagnostics=not_collected reason=Skill diagnostics are not collected by this narrow read.");
    expect(output).not.toContain("run /setup again");
  });
});
