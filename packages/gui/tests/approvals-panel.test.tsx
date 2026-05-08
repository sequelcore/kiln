import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApprovalsPanel } from "../src/components/approvals-panel.js";

describe("ApprovalsPanel", () => {
  it("renders pending approvals and dispatches approve/deny for selected request", () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();

    render(
      <ApprovalsPanel
        approvals={[
          {
            id: "approval-1",
            description: "Write packages/gui/src/app-shell.tsx",
            sessionId: "session-1",
            requestedAt: "2026-04-24T04:00:00.000Z",
          },
          {
            id: "approval-2",
            description: "Edit packages/gui/src/transcript.tsx",
            sessionId: "session-2",
            requestedAt: "2026-04-24T04:05:00.000Z",
          },
        ]}
        onApprove={onApprove}
        onDeny={onDeny}
      />,
    );

    const review = screen.getByLabelText("Selected approval review");
    expect(within(review).getByText("Write packages/gui/src/app-shell.tsx")).toBeInTheDocument();

    fireEvent.click(within(review).getByRole("button", { name: "Approve" }));
    fireEvent.click(within(review).getByRole("button", { name: "Deny" }));

    expect(onApprove).toHaveBeenCalledWith("approval-1");
    expect(onDeny).toHaveBeenCalledWith("approval-1");

    fireEvent.click(screen.getByRole("button", { name: /Edit packages\/gui\/src\/transcript\.tsx/i }));
    expect(within(review).getByText("Edit packages/gui/src/transcript.tsx")).toBeInTheDocument();
  });
});
