import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { KilnConfigSetupSnapshot } from "@kilnai/gateway-contracts";
import { SetupPanel } from "../src/components/setup-panel.js";

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
    nativeProjections: [],
    recommendedActions: ["adopt-project-context", "sync-repo-shims"],
    ...overrides,
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

    const actions = screen.getByRole("region", { name: "Required Setup Actions" });
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
    expect(screen.getByRole("region", { name: "Required Setup Actions" })).toHaveTextContent("No setup actions are required.");
    expect(screen.queryByRole("button", { name: "Current" })).not.toBeInTheDocument();
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
    expect(screen.getByRole("table", { name: "Canonical setup sources" })).toHaveTextContent(
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
});
