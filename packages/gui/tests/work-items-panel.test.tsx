import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkItemsPanel } from "../src/components/work-items-panel.js";
import type { WorkItemEntry } from "../src/lib/session-store/index.js";
import { useUiStore } from "../src/lib/ui-store.js";

describe("WorkItemsPanel", () => {
  beforeEach(() => {
    useUiStore.getState().setTheme("kiln-dark");
  });

  it("keeps repeated work-item ids distinct across canonical sessions", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const base = {
      id: "work-shared",
      status: "blocked",
      workflowProfile: "verification-heavy",
      authorityProfile: "authority:workspace-write",
      referenceRoots: [],
      expectedEvidence: [],
      providedEvidence: [],
      verificationGates: [],
      pauseRequirements: [],
      executionAttempts: [],
      pendingPauseRequirementCount: 0,
      missingEvidence: [],
      missingGoalEvidence: [],
      missingVerificationGates: [],
      failedVerificationGates: [],
      missingResidualRisk: false,
    } satisfies Omit<WorkItemEntry, "sessionId" | "summary" | "resourceUri" | "updatedAt">;
    const items: WorkItemEntry[] = [
      {
        ...base,
        sessionId: "session-a",
        summary: "Session A work",
        resourceUri: "kiln://session-a/work-items/work-shared",
        updatedAt: "2026-07-28T10:00:00.000Z",
      },
      {
        ...base,
        sessionId: "session-b",
        summary: "Session B work",
        resourceUri: "kiln://session-b/work-items/work-shared",
        updatedAt: "2026-07-28T10:01:00.000Z",
      },
    ];

    render(<WorkItemsPanel items={items} />);

    expect(screen.getByText("Session A work")).toBeInTheDocument();
    expect(screen.getByText("Session B work")).toBeInTheDocument();
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("same key");
  });

  it("renders assigned agent profiles with stable identity marks", () => {
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

    const task = screen.getByText("Review managed agent surface parity").closest('[data-slot="ai-task"]');
    expect(task).toHaveAttribute("data-status", "in_progress");
    expect(screen.getByRole("button", { name: /Review managed agent surface parity.*In progress.*0 of 1 evidence/u })).toBeInTheDocument();
    expect(screen.getByLabelText("react-ts-reviewer identity")).toHaveTextContent("RT");
    expect(screen.getByLabelText("react-ts-reviewer identity")).toHaveAttribute("data-identity-kind", "agent_profile");
    expect(screen.getByText(/react-ts-reviewer/u)).toBeInTheDocument();
    expect(screen.getByText("/workspace/references/cloned")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Review managed agent surface parity/u }));
    expect(screen.queryByText("/workspace/references/cloned")).not.toBeInTheDocument();
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

  it("does not render a superseded pause requirement as a pending blocker", () => {
    const items: WorkItemEntry[] = [
      {
        id: "work-superseded",
        summary: "Resume governed execution after supersession",
        status: "pending",
        workflowProfile: "verification-heavy",
        expectedEvidence: ["tests"],
        providedEvidence: [],
        verificationGates: [],
        pauseRequirements: [
          {
            id: "credentials-1",
            kind: "credentials",
            summary: "Provide test service credentials",
            status: "superseded",
          },
        ],
        updatedAt: "2026-07-26T20:00:00.000Z",
      },
    ];

    render(<WorkItemsPanel items={items} />);

    expect(screen.queryByText("credentials: Provide test service credentials")).not.toBeInTheDocument();
  });

  it("pulses only the most recently updated active work item", () => {
    const items: WorkItemEntry[] = [
      {
        id: "work-older",
        summary: "Inspect the existing surface",
        status: "in_progress",
        workflowProfile: "implementation",
        expectedEvidence: [],
        providedEvidence: [],
        verificationGates: [],
        updatedAt: "2026-07-14T10:00:00.000Z",
      },
      {
        id: "work-current",
        summary: "Implement the admitted slice",
        status: "in_progress",
        workflowProfile: "implementation",
        expectedEvidence: ["tests"],
        providedEvidence: [],
        verificationGates: [],
        updatedAt: "2026-07-14T11:00:00.000Z",
      },
    ];

    render(<WorkItemsPanel items={items} />);

    const beams = document.querySelectorAll('[data-role="work-item-activity-beam"]');
    expect(beams).toHaveLength(1);
    expect(beams[0]).toHaveAttribute("data-work-item-id", "work-current");
    expect(beams[0]).toHaveAttribute("data-beam-motion", "pulse");
    expect(beams[0]).toHaveAttribute("data-beam-theme", "dark");
    expect(beams[0]).toHaveAttribute("data-active");
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

    expect(screen.getByText("Audit work item inspectability").closest('[data-slot="ai-task"]')).toHaveAttribute("data-status", "blocked");
    expect(screen.getByLabelText("Work items")).toHaveTextContent("authority:foundation-readonly-plan");
    expect(screen.getByLabelText("Work items")).toHaveTextContent("Missing: tests, residual-risk");

    fireEvent.click(screen.getByRole("button", { name: "Open work item work-inspectable resource" }));

    expect(onOpenResource).toHaveBeenCalledWith("kiln://session/work-items/work-inspectable", {
      resourceUri: "kiln://session/work-items/work-inspectable",
      workItemId: "work-inspectable",
    });
  });
});
