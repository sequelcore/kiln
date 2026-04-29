import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspacePanel } from "../src/components/workspace-panel.js";

describe("WorkspacePanel", () => {
  it("renders root entries from the canonical workspace snapshot", () => {
    render(
      <WorkspacePanel
        domainLabel="Kiln"
        gatewayWorkingDirectory={"C:\\Proyectos\\Sequel\\kiln"}
        workspaceTree={{
          rootPath: "C:\\Proyectos\\Sequel\\kiln",
          source: "gateway",
          entries: [
            {
              path: "C:\\Proyectos\\Sequel\\kiln\\packages",
              name: "packages",
              kind: "directory",
            },
            {
              path: "C:\\Proyectos\\Sequel\\kiln\\README.md",
              name: "README.md",
              kind: "file",
            },
          ],
        }}
        selectedSessionId="kiln-gui:_gui:test:123"
        sessionMeta={null}
        activeProvider="codex-oauth"
        activeModel="gpt-5.4-mini"
      />,
    );

    expect(screen.getByLabelText("Workspace root entries")).toBeInTheDocument();
    expect(screen.getByText("directory · packages")).toBeInTheDocument();
    expect(screen.getByText("file · README.md")).toBeInTheDocument();
    expect(screen.getByText("C:/Proyectos/Sequel/kiln/packages")).toBeInTheDocument();
    expect(screen.queryByText("File-tree browsing is intentionally gated until the gateway exposes a canonical workspace-tree contract.")).not.toBeInTheDocument();
  });

  it("keeps workspace metadata cards visible with snapshot data", () => {
    render(
      <WorkspacePanel
        domainLabel="Kiln"
        gatewayWorkingDirectory={"C:\\Proyectos\\Sequel\\kiln"}
        workspaceTree={{
          rootPath: "C:\\Proyectos\\Sequel\\kiln",
          source: "gateway",
          entries: [],
        }}
        selectedSessionId="kiln-gui:_gui:test:123"
        sessionMeta={{
          kilnSessionId: "kiln-gui:_gui:test:123",
          task: "Review session",
          startedAt: "2026-04-24T09:00:00.000Z",
          sessionLedger: {
            currentPhase: "ai_active",
            workingDirectory: "C:\\Proyectos\\Sequel\\kiln",
            worktreePath: "C:\\tmp\\kiln-worktree",
            lastProvider: "codex-oauth",
            toolCallCount: 5,
            turnDepth: 3,
          },
        }}
        activeProvider="codex-oauth"
        activeModel="gpt-5.4-mini"
      />,
    );

    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("Kiln")).toBeInTheDocument();
    expect(screen.getByText("kiln-gui:_gui:test:123")).toBeInTheDocument();
    expect(screen.getByText("codex-oauth / gpt-5.4-mini")).toBeInTheDocument();
    expect(screen.getByText("C:/Proyectos/Sequel/kiln")).toBeInTheDocument();
    expect(screen.getByText("C:/tmp/kiln-worktree")).toBeInTheDocument();
  });

  it("shows fallback copy when no working directory is available", () => {
    render(
      <WorkspacePanel
        domainLabel={undefined}
        gatewayWorkingDirectory={undefined}
        workspaceTree={undefined}
        selectedSessionId={null}
        sessionMeta={null}
        activeProvider={null}
        activeModel={null}
      />,
    );

    expect(screen.getByText("No active session selected")).toBeInTheDocument();
    expect(screen.getByText("No working directory available.")).toBeInTheDocument();
    expect(screen.getByText("No workspace tree available.")).toBeInTheDocument();
  });
});
