import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { KilnConfigSetupSnapshot, KilnSkillCatalogSummarySnapshot, TrustedExecutionIntegrity } from "@kilnai/gateway-contracts";
import { SetupPanel } from "../src/components/setup-panel.js";

function permissionIntegrity(): TrustedExecutionIntegrity {
  return {
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
  };
}

function setupSnapshot(overrides: Partial<KilnConfigSetupSnapshot> = {}): KilnConfigSetupSnapshot {
  return {
    projectRoot: "C:/workspace/kiln",
    projectContext: {
      path: "C:/workspace/kiln/.kiln/project-context.md",
      status: "missing",
      recommendation: "adopt-project-context",
    },
    repoShims: [
      {
        target: "agents",
        targetId: "repo-shim:agents",
        path: "C:/workspace/kiln/AGENTS.md",
        status: "stale",
        recommendation: "sync-repo-shims",
      },
    ],
    globalInstructionShims: [],
    nativeProjections: [],
    permissionIntegrity: [],
    recommendedActions: ["adopt-project-context", "sync-repo-shims"],
    ...overrides,
  };
}

function skillCatalog(): KilnSkillCatalogSummarySnapshot {
  return {
    complete: false,
    equivalentDuplicates: 2,
    divergentCollisions: 1,
    caseCollisions: 3,
    issueCount: 4,
    omittedIssueCount: 3,
    harnesses: [
      { harness: "claude", candidateCount: 7, descriptionBytes: 512, budget: { status: "unknown", reason: "Claude does not publish an authoritative catalog budget." } },
      { harness: "codex", candidateCount: 11, descriptionBytes: 1_024, budget: { status: "unknown", reason: "Codex does not publish an authoritative catalog budget." } },
      { harness: "opencode", candidateCount: 5, descriptionBytes: 256, budget: { status: "unknown", reason: "OpenCode does not publish an authoritative catalog budget." } },
    ],
    issues: [{ skillName: "planner", kind: "drifted", harness: "codex", projectionState: "drifted", path: "C:/Users/test/.codex/skills/planner/SKILL.md" }],
  };
}

describe("SetupPanel", () => {
  it("prioritizes recommended setup actions with executable controls", () => {
    const onExecuteAction = vi.fn();

    render(
      <SetupPanel
        snapshot={setupSnapshot()}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
        onExecuteAction={onExecuteAction}
        onPreviewSource={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Configuration Health" })).toBeInTheDocument();
    expect(screen.getByText("2 Actions Need Attention")).toBeInTheDocument();

    const actions = screen.getByRole("region", { name: "Required Configuration Actions" });
    expect(within(actions).getByRole("button", { name: "Adopt Project Context" })).toBeInTheDocument();
    expect(within(actions).getByRole("button", { name: "Sync Repo Shims" })).toBeInTheDocument();
    expect(within(actions).queryByText("C:/workspace/kiln/AGENTS.md")).not.toBeInTheDocument();

    fireEvent.click(within(actions).getByRole("button", { name: "Sync Repo Shims" }));

    expect(onExecuteAction).toHaveBeenCalledWith("sync-repo-shims");
  });

  it("renders a quiet current state without required action buttons", () => {
    render(
      <SetupPanel
        snapshot={setupSnapshot({
          projectContext: {
            path: "C:/workspace/kiln/.kiln/project-context.md",
            status: "valid",
            recommendation: "none",
          },
          repoShims: [
            {
              target: "agents",
              targetId: "repo-shim:agents",
              path: "C:/workspace/kiln/AGENTS.md",
              status: "current",
              recommendation: "none",
            },
          ],
          recommendedActions: ["none"],
        })}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
        onExecuteAction={vi.fn()}
        onPreviewSource={vi.fn()}
      />,
    );

    expect(screen.getByText("Configuration Is Current")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Required Configuration Actions" })).toHaveTextContent("No configuration actions are required.");
    expect(screen.queryByRole("button", { name: "Current" })).not.toBeInTheDocument();
  });

  it("warns when permission integrity is mismatched even without setup repair actions", () => {
    render(
      <SetupPanel
        snapshot={setupSnapshot({
          projectContext: {
            path: "C:/workspace/kiln/.kiln/project-context.md",
            status: "valid",
            recommendation: "none",
          },
          repoShims: [],
          nativeProjections: [],
          permissionIntegrity: [permissionIntegrity()],
          recommendedActions: ["none"],
        })}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
        onExecuteAction={vi.fn()}
        onPreviewSource={vi.fn()}
      />,
    );

    expect(screen.queryByText("Configuration Is Current")).not.toBeInTheDocument();
    expect(screen.getByText("Permission Integrity Needs Attention")).toBeInTheDocument();
    const integrity = screen.getByRole("region", { name: "Permission Integrity" });
    expect(integrity).toHaveTextContent("codex");
    expect(integrity).toHaveTextContent("runtime-policy-mismatch");
    expect(integrity).toHaveTextContent("desired trusted-full-access");
    expect(integrity).toHaveTextContent("persisted restricted");
    expect(integrity).toHaveTextContent("effective workspace-write");
    expect(integrity).toHaveTextContent("approval required");
    expect(integrity).toHaveTextContent("Restart Codex with proven Full Access");
  });

  it("presents setup sources as comparable inventories instead of a path dump", () => {
    render(
      <SetupPanel
        snapshot={setupSnapshot({
          nativeProjections: [{
            targetId: "codex-agent:planner",
            path: "C:/Users/test/.codex/agents/planner.toml",
            kind: "native",
            status: "managed",
            managedFieldCount: 1,
            updatedAt: "2026-06-27T12:29:50.875Z",
          }],
        })}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
        onExecuteAction={vi.fn()}
        onPreviewSource={vi.fn()}
      />,
    );

    expect(screen.queryByRole("heading", { name: "Setup Sources" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Configuration Overview" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Canonical configuration sources" })).toHaveTextContent(
      "Durable repository guidance inherited by every harness",
    );
    expect(screen.getByRole("table", { name: "Native harness projections" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Native harness projections" })).toHaveTextContent("1 managed field");
    expect(screen.queryByText("2026-06-27T12:29:50.875Z")).not.toBeInTheDocument();
    expect(screen.queryByText("C:/workspace/kiln/.kiln/project-context.md")).not.toBeInTheDocument();
    expect(screen.queryByText("C:/workspace/kiln/AGENTS.md")).not.toBeInTheDocument();
  });

  it("opens project-owned setup sources through the workspace preview boundary", () => {
    const onPreviewSource = vi.fn();

    render(
      <SetupPanel
        snapshot={setupSnapshot({
          projectContext: {
            path: "C:/workspace/kiln/.kiln/project-context.md",
            status: "valid",
            recommendation: "none",
          },
        })}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
        onExecuteAction={vi.fn()}
        onPreviewSource={onPreviewSource}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview Project Context" }));

    expect(onPreviewSource).toHaveBeenCalledWith("C:/workspace/kiln/.kiln/project-context.md");
  });

  it("renders global instruction shim targets in overview and inventory from the shared setup snapshot", () => {
    render(
      <SetupPanel
        snapshot={setupSnapshot({
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
          recommendedActions: [
            "sync-global-instruction-shims",
            "adopt-or-back-up-global-instructions",
            "review-global-instruction-drift",
          ],
        })}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
        onExecuteAction={vi.fn()}
        onPreviewSource={vi.fn()}
      />,
    );

    expect(screen.getByText("3 Actions Need Attention")).toBeInTheDocument();
    expect(screen.getByText("5 sources")).toBeInTheDocument();
    expect(screen.getAllByText("Global Instruction Shims")).toHaveLength(2);
    const inventory = screen.getByRole("table", { name: "Global instruction shims" });
    expect(inventory).toHaveTextContent("codex-global-instructions");
    expect(inventory).toHaveTextContent("claude-global-instructions");
    expect(inventory).toHaveTextContent("opencode-global-instructions");
    expect(inventory).toHaveTextContent("codex");
    expect(inventory).toHaveTextContent("claude-code");
    expect(inventory).toHaveTextContent("opencode");
    expect(inventory).toHaveTextContent("stale");
    expect(inventory).toHaveTextContent("unmanaged");
    expect(inventory).toHaveTextContent("drifted");
    expect(inventory).toHaveTextContent("sync-global-instruction-shims");
    expect(inventory).toHaveTextContent("adopt-or-back-up-global-instructions");
    expect(inventory).toHaveTextContent("review-global-instruction-drift");
  });

  it("executes safe global sync once but blocks global adoption and drift review actions", () => {
    const onExecuteAction = vi.fn();

    render(
      <SetupPanel
        snapshot={setupSnapshot({
          recommendedActions: [
            "sync-global-instruction-shims",
            "adopt-or-back-up-global-instructions",
            "review-global-instruction-drift",
          ],
        })}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
        onExecuteAction={onExecuteAction}
        onPreviewSource={vi.fn()}
      />,
    );

    const actions = screen.getByRole("region", { name: "Required Configuration Actions" });
    fireEvent.click(within(actions).getByRole("button", { name: "Sync Global Instruction Shims" }));
    fireEvent.click(within(actions).getByRole("button", { name: "Review Global Instructions" }));
    fireEvent.click(within(actions).getByRole("button", { name: "Review Global Instruction Drift" }));

    expect(onExecuteAction).toHaveBeenCalledTimes(1);
    expect(onExecuteAction).toHaveBeenCalledWith("sync-global-instruction-shims");
    expect(within(actions).getByRole("button", { name: "Review Global Instructions" })).toBeDisabled();
    expect(within(actions).getByRole("button", { name: "Review Global Instruction Drift" })).toBeDisabled();
  });

  it("renders bounded skill catalog evidence without detailed admission or projection rows", () => {
    render(
      <SetupPanel
        snapshot={setupSnapshot({ skills: skillCatalog() })}
        loading={false}
        error={null}
        onRefresh={vi.fn()}
        onExecuteAction={vi.fn()}
        onPreviewSource={vi.fn()}
      />,
    );

    expect(screen.getByText("Incomplete inventory")).toBeInTheDocument();
    const identitySummary = screen.getByRole("group", { name: "Skill identity summary" });
    expect(identitySummary).toHaveTextContent("Equivalent duplicates2");
    expect(identitySummary).toHaveTextContent("Divergent collision1");
    expect(identitySummary).toHaveTextContent("Case collisions3");
    const inventory = screen.getByRole("table", { name: "Per-harness implicit skill catalog" });
    expect(inventory).toHaveTextContent("Claude Code");
    expect(inventory).toHaveTextContent("7");
    expect(inventory).toHaveTextContent("512 B");
    expect(inventory).toHaveTextContent("Codex");
    expect(inventory).toHaveTextContent("11");
    expect(inventory).toHaveTextContent("1,024 B");
    expect(inventory).toHaveTextContent("OpenCode");
    expect(inventory).toHaveTextContent("Unknown");
    const issues = screen.getByRole("table", { name: "Actionable skill catalog issues" });
    expect(issues).toHaveTextContent("planner");
    expect(issues).toHaveTextContent("drifted");
    expect(screen.getByRole("button", { name: "Copy path for planner Codex skill issue" })).toBeInTheDocument();
    expect(screen.getByText("3 more issues omitted from this bounded summary (4 total). Open the detailed skills view for the complete catalog.")).toBeInTheDocument();
    expect(screen.queryByText("repo-context-review")).not.toBeInTheDocument();
  });

  it("renders an accessible unavailable state when the shared skill catalog summary is absent", () => {
    render(
      <SetupPanel snapshot={setupSnapshot()} loading={false} error={null} onRefresh={vi.fn()} onExecuteAction={vi.fn()} onPreviewSource={vi.fn()} />,
    );

    expect(screen.getByRole("status", { name: "Skill catalog status" })).toHaveTextContent("Skill diagnostics are unavailable from this setup snapshot.");
  });
});
