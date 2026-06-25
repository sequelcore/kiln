import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
        referenceRoots: ["/workspace/references/cloned"],
        expectedEvidence: ["test"],
        providedEvidence: [],
        verificationGates: [],
        updatedAt: "2026-05-08T10:00:00.000Z",
      },
    ];

    render(<WorkItemsPanel items={items} />);

    expect(screen.getByLabelText("react-ts-reviewer avatar")).toHaveAttribute("data-avatar-state", "running");
    expect(screen.getByText(/react-ts-reviewer/u)).toBeInTheDocument();
    expect(screen.getByText("/workspace/references/cloned")).toBeInTheDocument();
  });

  it("renders pause requirements and latest execution attempt state", () => {
    const items: WorkItemEntry[] = [
      {
        id: "work-paused",
        summary: "Resume governed execution",
        status: "in_progress",
        workflowProfile: "verification-heavy",
        expectedEvidence: ["tests"],
        providedEvidence: [],
        verificationGates: [],
        pauseRequirements: [
          {
            id: "credentials-1",
            kind: "credentials",
            summary: "Provide test service credentials",
            status: "pending",
          },
        ],
        executionAttempts: [
          {
            id: "goal-1:work-paused:attempt:1",
            status: "started",
            executionMode: "managed_delegation",
            startedAt: "2026-05-12T20:00:00.000Z",
            managedInvocationId: "invocation-1",
          },
        ],
        updatedAt: "2026-05-12T20:00:00.000Z",
      },
    ];

    render(<WorkItemsPanel items={items} />);

    expect(screen.getByText("credentials: Provide test service credentials")).toBeInTheDocument();
    expect(screen.getByText("managed delegation / started")).toBeInTheDocument();
    expect(screen.getByText("invocation-1")).toBeInTheDocument();
  });

  it("renders authority and opens the canonical work item resource", () => {
    const onOpenResource = vi.fn();
    const items: WorkItemEntry[] = [
      {
        id: "work-inspectable",
        summary: "Audit work item inspectability",
        status: "blocked",
        workflowProfile: "verification-heavy",
        authorityProfile: "authority:foundation-readonly-plan",
        expectedEvidence: ["surface-map", "tests"],
        providedEvidence: ["surface-map"],
        verificationGates: ["bun run typecheck"],
        missingEvidence: ["tests"],
        missingResidualRisk: true,
        resourceUri: "kiln://session/work-items/work-inspectable",
        updatedAt: "2026-06-24T10:00:00.000Z",
      },
    ];

    render(<WorkItemsPanel items={items} onOpenResource={onOpenResource} />);

    expect(screen.getByLabelText("Work items")).toHaveTextContent("authority:foundation-readonly-plan");
    expect(screen.getByLabelText("Work items")).toHaveTextContent("Missing: tests, residual-risk");

    fireEvent.click(screen.getByRole("button", { name: "Open work item work-inspectable resource" }));

    expect(onOpenResource).toHaveBeenCalledWith("kiln://session/work-items/work-inspectable", {
      resourceUri: "kiln://session/work-items/work-inspectable",
      workItemId: "work-inspectable",
    });
  });
});
