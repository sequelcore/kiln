import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspacePanel } from "../src/components/workspace-panel.js";

const rootTree = {
  rootPath: "C:\\Proyectos\\Sequel\\kiln",
  source: "gateway" as const,
  entries: [
    {
      path: "C:\\Proyectos\\Sequel\\kiln\\packages",
      name: "packages",
      kind: "directory" as const,
    },
    {
      path: "C:\\Proyectos\\Sequel\\kiln\\README.md",
      name: "README.md",
      kind: "file" as const,
      vcs: {
        provider: "git" as const,
        state: "modified" as const,
      },
    },
  ],
};

function renderWorkspace(options: {
  readonly workspaceClient?: { loadWorkspaceDirectory: ReturnType<typeof vi.fn> };
  readonly onOpenFile?: ReturnType<typeof vi.fn>;
  readonly selectedFilePath?: string | null;
} = {}) {
  const workspaceClient = options.workspaceClient ?? {
    loadWorkspaceDirectory: vi.fn(),
  };
  const onOpenFile = options.onOpenFile ?? vi.fn();
  render(
    <WorkspacePanel
      gatewayWorkingDirectory={"C:\\Proyectos\\Sequel\\kiln"}
      workspaceTree={rootTree}
      workspaceClient={workspaceClient}
      selectedFilePath={options.selectedFilePath ?? null}
      onOpenFile={onOpenFile}
    />,
  );
  return { workspaceClient, onOpenFile };
}

describe("WorkspacePanel", () => {
  it("renders a navigable workspace tree from the canonical workspace snapshot", () => {
    renderWorkspace();

    expect(screen.getByLabelText("Workspace files")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Folder packages" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "File README.md" })).toBeInTheDocument();
    expect(screen.getByLabelText("Git modified")).toHaveTextContent("M");
    expect(screen.queryByLabelText("Workspace file preview")).not.toBeInTheDocument();
  });

  it("lazily expands directories and delegates selected files to the main document workspace", async () => {
    const workspaceClient = {
      loadWorkspaceDirectory: vi.fn().mockResolvedValue({
        rootPath: rootTree.rootPath,
        directoryPath: "C:\\Proyectos\\Sequel\\kiln\\packages",
        parentPath: rootTree.rootPath,
        source: "gateway" as const,
        entries: [
          {
            path: "C:\\Proyectos\\Sequel\\kiln\\packages\\gui\\src\\main.tsx",
            name: "main.tsx",
            kind: "file" as const,
          },
        ],
      }),
    };
    const onOpenFile = vi.fn();
    renderWorkspace({ workspaceClient, onOpenFile });

    fireEvent.click(screen.getByRole("button", { name: "Folder packages" }));

    expect(workspaceClient.loadWorkspaceDirectory).toHaveBeenCalledWith("C:\\Proyectos\\Sequel\\kiln\\packages");
    const nestedFile = await screen.findByRole("button", { name: "File main.tsx" });
    fireEvent.click(nestedFile);

    expect(onOpenFile).toHaveBeenCalledWith({
      path: "C:\\Proyectos\\Sequel\\kiln\\packages\\gui\\src\\main.tsx",
      name: "main.tsx",
      kind: "file",
    });
  });

  it("contains directory expansion failures in the workspace tree", async () => {
    const workspaceClient = {
      loadWorkspaceDirectory: vi.fn().mockRejectedValue(new Error("Workspace directory was not found.")),
    };
    renderWorkspace({ workspaceClient });

    fireEvent.click(screen.getByRole("button", { name: "Folder packages" }));

    expect(await screen.findByText("Workspace directory was not found.")).toBeInTheDocument();
  });

  it("keeps workspace root context visible without duplicating session metadata", () => {
    render(
      <WorkspacePanel
        gatewayWorkingDirectory={"C:\\Proyectos\\Sequel\\kiln"}
        workspaceTree={rootTree}
        worktreePath={"C:\\tmp\\kiln-worktree"}
      />,
    );

    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.getByLabelText("Workspace root")).toHaveTextContent("C:/Proyectos/Sequel/kiln");
    expect(screen.getAllByText("C:/Proyectos/Sequel/kiln")).toHaveLength(1);
    expect(screen.getByText("worktree: C:/tmp/kiln-worktree")).toBeInTheDocument();
    expect(screen.queryByText("Kiln")).not.toBeInTheDocument();
    expect(screen.queryByText("kiln-gui:_gui:test:123")).not.toBeInTheDocument();
    expect(screen.queryByText("codex-oauth / gpt-5.4-mini")).not.toBeInTheDocument();
  });

  it("shows fallback copy when no working directory is available", () => {
    render(
      <WorkspacePanel
        gatewayWorkingDirectory={undefined}
        workspaceTree={undefined}
      />,
    );

    expect(screen.getByText("No working directory available.")).toBeInTheDocument();
    expect(screen.getByText("No workspace tree available.")).toBeInTheDocument();
  });
});
