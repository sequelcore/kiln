import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  WorkbenchInspectorPanel,
  WorkbenchSessionsPanel,
} from "../src/components/workbench-side-panels.js";
import { deriveSessionContinuity } from "../src/lib/session-continuity.js";

describe("Workbench side panels", () => {
  it("wires session selection through the side-panel host", () => {
    const onSelectSession = vi.fn();

    render(
      <WorkbenchSessionsPanel
        sessions={[
          {
            sessionId: "session-1",
            title: "Investigate UI",
            tags: [],
            providersUsed: ["codex"],
            lastRoute: { provider: "codex" },
            updatedAt: "2026-06-27T00:00:00.000Z",
            costUsd: 0.12,
          },
        ] as never}
        selectedSessionId={null}
        continuity={deriveSessionContinuity({
          status: "ready",
          selectedSessionId: null,
          liveSessionId: null,
          continuationTargetId: null,
          messageCount: 0,
          sessionEventCount: 0,
          detachedSessionIds: [],
        })}
        onSelectSession={onSelectSession}
        onStartNewSession={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Investigate UI/ }));

    expect(onSelectSession).toHaveBeenCalledWith("session-1");
  });

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
