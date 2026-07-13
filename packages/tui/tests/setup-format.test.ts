import { describe, expect, it } from "vitest";
import type { KilnConfigSetupSnapshot, KilnSkillCatalogSnapshot } from "@kilnai/gateway-contracts";
import { formatSetupSnapshot } from "../src/setup-format.js";

function setupSnapshot(): KilnConfigSetupSnapshot {
  return {
    projectRoot: "C:/workspace/kiln",
    projectContext: {
      path: "C:/workspace/kiln/.kiln/project-context.md",
      status: "valid",
      recommendation: "none",
    },
    repoShims: [],
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
      classification: "runtime-policy-mismatch",
      recommendation: "Restart Codex with proven Full Access or choose a narrower trusted profile.",
      remediationRequiresApproval: true,
      lastVerifiedAt: "2026-07-01T15:02:01.000Z",
    }],
    recommendedActions: ["none"],
  };
}

function skillCatalog(): KilnSkillCatalogSnapshot {
  return {
    entries: [
      {
        name: "repo-context-review",
        description: "Review repository context before implementation.",
        origin: "builtin",
        configured: true,
        builtIn: true,
        sourcePath: "builtin://kiln/skills/repo-context-review",
        projections: [
          { target: "opencode", displayName: "OpenCode", path: "C:/Users/test/.config/opencode/skills/repo-context-review/SKILL.md", status: "projected" },
          { target: "codex", displayName: "Codex", path: "C:/Users/test/.codex/skills/repo-context-review/SKILL.md", status: "drifted" },
          { target: "claude", displayName: "Claude Code", path: "C:/Users/test/.claude/skills/repo-context-review/SKILL.md", status: "missing" },
        ],
        admission: {
          state: "available",
          reason: "Configured Kiln skill. Admission still depends on explicit request, agent profile defaults, or auto skill selection.",
        },
      },
      {
        name: "frontend-review",
        description: "Review operator interfaces.",
        origin: "project",
        configured: true,
        builtIn: false,
        sourcePath: "C:/workspace/kiln/.kiln/skills/frontend-review/SKILL.md",
        projections: [{ target: "codex", displayName: "Codex", path: "C:/Users/test/.codex/skills/frontend-review/SKILL.md", status: "projected" }],
        admission: { state: "blocked", reason: "The active route does not permit this skill." },
        omissionReason: "route-policy-blocked",
      },
      {
        name: "native-only",
        description: "Native harness-local skill outside the Kiln registry.",
        origin: "native-harness",
        configured: false,
        builtIn: false,
        sourcePath: "C:/Users/test/.codex/skills/native-only/SKILL.md",
        projections: [{ target: "codex", displayName: "Codex", path: "C:/Users/test/.codex/skills/native-only/SKILL.md", status: "unmanaged-native" }],
        admission: { state: "unavailable", reason: "Harness-local skill is not configured in Kiln." },
        omissionReason: "native-harness-local-only",
      },
    ],
  };
}

describe("formatSetupSnapshot", () => {
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

  it("renders every shared skill diagnostic deterministically", () => {
    const snapshot = { ...setupSnapshot(), skills: skillCatalog() };

    const first = formatSetupSnapshot(snapshot);
    const second = formatSetupSnapshot({ ...snapshot, skills: { entries: [...skillCatalog().entries].reverse() } });

    expect(first).toBe(second);
    expect(first).toContain("skills:");
    expect(first).toContain("repo-context-review: origin=builtin identity=built-in admission=available");
    expect(first).toContain("admission reason=Configured Kiln skill. Admission still depends on explicit request");
    expect(first).toContain("target=claude status=missing path=C:/Users/test/.claude/skills/repo-context-review/SKILL.md");
    expect(first).toContain("target=codex status=drifted path=C:/Users/test/.codex/skills/repo-context-review/SKILL.md");
    expect(first).toContain("target=opencode status=projected path=C:/Users/test/.config/opencode/skills/repo-context-review/SKILL.md");
    expect(first).toContain("frontend-review: origin=project identity=configured admission=blocked");
    expect(first).toContain("omission reason=route-policy-blocked");
    expect(first).toContain("native-only: origin=native-harness identity=unconfigured admission=unavailable");
    expect(first).toContain("omission reason=native-harness-local-only");
  });

  it("renders explicit absent and empty skill catalog states", () => {
    expect(formatSetupSnapshot(setupSnapshot())).toContain("skills:\n  - unavailable");
    expect(formatSetupSnapshot({ ...setupSnapshot(), skills: { entries: [] } })).toContain("skills:\n  - none configured or reported");
  });
});
