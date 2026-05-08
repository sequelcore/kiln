import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkItemsPanel } from "../src/components/work-items-panel.js";
import type { WorkItemEntry } from "../src/lib/session-store.js";

describe("WorkItemsPanel", () => {
  it("renders assigned agent profiles with deterministic avatars", () => {
    const items: WorkItemEntry[] = [
      {
        id: "work-1",
        summary: "Review managed agent surface parity",
        status: "in_progress",
        workflowProfile: "implementation",
        surface: "gui",
        assignedAgentProfile: "react-ts-reviewer",
        expectedEvidence: ["test"],
        providedEvidence: [],
        verificationGates: [],
        updatedAt: "2026-05-08T10:00:00.000Z",
      },
    ];

    render(<WorkItemsPanel items={items} />);

    expect(screen.getByLabelText("react-ts-reviewer avatar")).toHaveAttribute("data-avatar-state", "running");
    expect(screen.getByText(/react-ts-reviewer/u)).toBeInTheDocument();
  });
});
