import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatWorkbench } from "../src/components/chat-workbench.js";

const approval = {
  id: "approval-1",
  description: "Tool \"bash\" requires approval: workspace write",
  sessionId: "session-1",
  requestedAt: "2026-05-08T12:00:00.000Z",
};

describe("ChatWorkbench", () => {
  it("keeps the transcript and composer in one chat workspace", () => {
    render(
      <ChatWorkbench
        layout="active"
        surfaces={<div>Transcript surface</div>}
        composer={<div>Message composer</div>}
        pendingApprovals={[]}
        approvalResponseFailure={null}
        selectedSessionId={null}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onOpenApprovals={vi.fn()}
      />,
    );

    const workspace = screen.getByRole("region", { name: "Chat workspace" });
    expect(workspace).toHaveAttribute("data-layout", "kiln-chat-workbench");
    expect(workspace.firstElementChild).toHaveClass("min-w-[min(100%,38rem)]");
    expect(workspace).toHaveTextContent("Transcript surface");
    expect(workspace).toHaveTextContent("Message composer");
    expect(screen.queryByRole("region", { name: "Approval required" })).not.toBeInTheDocument();
  });

  it("centers the same composer with the transcript prompt for a new session", () => {
    render(
      <ChatWorkbench
        layout="landing"
        surfaces={<div>New-session prompt</div>}
        composer={<div data-testid="composer-instance">Message composer</div>}
        pendingApprovals={[]}
        approvalResponseFailure={null}
        selectedSessionId={null}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onOpenApprovals={vi.fn()}
      />,
    );

    const workspace = screen.getByRole("region", { name: "Chat workspace" });
    expect(workspace).toHaveAttribute("data-chat-layout", "landing");
    expect(workspace.querySelector('[data-layout="landing-composition"]')).toHaveClass("justify-center");
    expect(screen.getAllByTestId("composer-instance")).toHaveLength(1);
  });

  it("renders the current approval inline above the composer", () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    const onOpenApprovals = vi.fn();
    render(
      <ChatWorkbench
        layout="active"
        surfaces={<div>Transcript surface</div>}
        composer={<div>Message composer</div>}
        pendingApprovals={[approval]}
        approvalResponseFailure={{ requestId: "approval-response-1", approvalId: "approval-1", decision: "approve", message: "Approval is no longer pending." }}
        selectedSessionId="session-1"
        onApprove={onApprove}
        onDeny={onDeny}
        onOpenApprovals={onOpenApprovals}
      />,
    );

    const dock = screen.getByRole("region", { name: "Approval required" });
    expect(dock).toHaveTextContent("Tool \"bash\" requires approval");
    expect(within(dock).getByRole("alert")).toHaveTextContent("Approval is no longer pending.");
    expect(dock.firstElementChild).toHaveClass("mx-auto", "max-w-3xl");

    fireEvent.click(within(dock).getByRole("button", { name: "Approve" }));
    expect(onApprove).toHaveBeenCalledWith("approval-1");

    fireEvent.click(within(dock).getByRole("button", { name: "Deny" }));
    expect(onDeny).toHaveBeenCalledWith("approval-1");

    fireEvent.click(within(dock).getByRole("button", { name: "Details" }));
    expect(onOpenApprovals).toHaveBeenCalledTimes(1);
  });

  it("routes multi-session approval queues to the secondary approvals panel", () => {
    const onOpenApprovals = vi.fn();
    render(
      <ChatWorkbench
        layout="active"
        surfaces={<div>Transcript surface</div>}
        composer={<div>Message composer</div>}
        pendingApprovals={[
          approval,
          { ...approval, id: "approval-2", sessionId: "session-2" },
        ]}
        approvalResponseFailure={null}
        selectedSessionId={null}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onOpenApprovals={onOpenApprovals}
      />,
    );

    const dock = screen.getByRole("region", { name: "Pending approvals" });
    expect(dock).toHaveTextContent("2 approvals are waiting in other sessions.");
    expect(dock.firstElementChild).toHaveClass("mx-auto", "max-w-3xl");
    fireEvent.click(within(dock).getByRole("button", { name: "Review" }));
    expect(onOpenApprovals).toHaveBeenCalledTimes(1);
  });
});
