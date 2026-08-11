import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  WorkbenchInspectorPanel,
} from "../src/components/workbench-side-panels.js";

describe("Workbench side panels", () => {
  it("renders the selected inspector mode without keeping branch logic in AppShell", () => {
    const onApprove = vi.fn();

    render(
      <WorkbenchInspectorPanel
        mode="approvals"
        gatewayWorkingDirectory={null}
        workspaceTree={undefined}
        workspaceClient={undefined}
        worktreePath={null}
        selectedFilePath={null}
        changedFiles={[]}
        approvals={[
          {
            id: "approval-1",
            title: "Run command",
            command: "bun test",
            reason: "Needs verification.",
          },
        ] as never}
        onOpenFile={vi.fn()}
        onApprove={onApprove}
        onDeny={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Approvals")).toHaveClass("border-l");
    expect(screen.getByLabelText("Approvals")).toHaveClass("w-full");
    expect(screen.getByLabelText("Approvals")).toHaveClass("min-w-0");
    expect(screen.getByLabelText("Approvals")).not.toHaveClass("border-r");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(onApprove).toHaveBeenCalledWith("approval-1");
  });

  it("keeps each inspector mode on the same full-width shell", () => {
    const baseProps = {
      gatewayWorkingDirectory: "C:\\workspace\\kiln",
      workspaceTree: {
        rootPath: "C:\\workspace\\kiln",
        entries: [],
        truncated: false,
        source: "gateway" as const,
      },
      workspaceClient: undefined,
      worktreePath: null,
      selectedFilePath: null,
      changedFiles: [],
      approvals: [],
      onOpenFile: vi.fn(),
      onApprove: vi.fn(),
      onDeny: vi.fn(),
    };
    const { rerender } = render(<WorkbenchInspectorPanel {...baseProps} mode="workspace" />);
    expect(screen.getByLabelText("Workspace")).toHaveClass("w-full", "min-w-0", "border-l");

    rerender(<WorkbenchInspectorPanel {...baseProps} mode="changed" />);
    expect(screen.getByLabelText("Changed Files")).toHaveClass("w-full", "min-w-0", "border-l");

    rerender(<WorkbenchInspectorPanel {...baseProps} mode="approvals" />);
    expect(screen.getByLabelText("Approvals")).toHaveClass("w-full", "min-w-0", "border-l");
  });
});
