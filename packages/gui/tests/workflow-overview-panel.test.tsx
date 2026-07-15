import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowOverviewPanel } from "../src/components/workflow-overview-panel.js";
import type { TimelineEntry } from "../src/lib/session-store.js";

describe("WorkflowOverviewPanel", () => {
  it("renders plan, goal, and materialization state from canonical timeline events", () => {
    const entries: TimelineEntry[] = [
      {
        id: "timeline-plan",
        type: "event",
        eventKind: "plan_submitted",
        createdAt: "2026-05-12T21:00:00.000Z",
        sequence: 1,
        title: "Plan submitted",
        summary: "Implement operator workflow previews",
        tone: "info",
        details: {
          planId: "plan-1",
          mode: "plan",
          objective: "Implement operator workflow previews",
          workflowProfile: "ui-change",
          riskClassification: "medium",
          proposedWorkItemCount: 2,
        },
      },
      {
        id: "timeline-goal",
        type: "event",
        eventKind: "goal.created",
        createdAt: "2026-05-12T21:01:00.000Z",
        sequence: 2,
        title: "Goal created",
        summary: "active · Implement operator workflow previews",
        tone: "info",
        details: {
          goal: {
            id: "goal-1",
            objective: "Implement operator workflow previews",
            source: { kind: "approved_plan", planId: "plan-1" },
            status: "active",
            workItemIds: ["work-1", "work-2"],
            authorityEnvelope: {
              maximumAuthority: "audited",
              escalationPolicy: "approval_required",
            },
            routePolicy: {
              workflowProfile: "ui-change",
            },
          },
        },
      },
      {
        id: "timeline-materialized",
        type: "event",
        eventKind: "work_items.materialized",
        createdAt: "2026-05-12T21:02:00.000Z",
        sequence: 3,
        title: "Work items materialized",
        summary: "2 work items · plan plan-1",
        tone: "success",
        details: {
          materialization: {
            id: "mat-1",
            planId: "plan-1",
            planHash: "sha256:plan",
            approvalId: "approval-1",
            goalRunId: "goal-1",
            workItemIds: ["work-1", "work-2"],
            createdWorkItemIds: ["work-1", "work-2"],
            reusedWorkItemIds: [],
          },
        },
      },
    ];

    render(<WorkflowOverviewPanel entries={entries} />);

    expect(screen.getByRole("region", { name: "Workflow overview" })).toBeInTheDocument();
    expect(screen.getByText("Plan review")).toBeInTheDocument();
    expect(screen.getAllByText("Implement operator workflow previews")).toHaveLength(2);
    expect(screen.getAllByText("plan-1")).toHaveLength(2);
    expect(screen.getByText("Approved plan plan-1")).toBeInTheDocument();
    expect(screen.getAllByText("ui-change")).toHaveLength(2);
    expect(screen.getByText("medium risk")).toBeInTheDocument();
    expect(screen.getByText("Goal run")).toBeInTheDocument();
    expect(screen.getAllByText("goal-1")).toHaveLength(2);
    expect(screen.getByText("audited authority")).toBeInTheDocument();
    expect(screen.getAllByText("Work items")).toHaveLength(3);
    expect(screen.getByText("2 materialized")).toBeInTheDocument();
  });

  it("renders admitted authority and route rationale from canonical turn completion details", () => {
    const entries: TimelineEntry[] = [
      {
        id: "timeline-turn",
        type: "event",
        eventKind: "turn_completed",
        createdAt: "2026-05-12T21:03:00.000Z",
        sequence: 4,
        title: "Turn completed",
        summary: "claude · claude-sonnet-4-6",
        tone: "success",
        details: {
          routedProvider: "claude",
          routedModel: "claude-sonnet-4-6",
          routingRationale: {
            selectedProvider: "claude",
            selectedModel: "claude-sonnet-4-6",
            selectionMode: "auto",
            routingReason: "Rule matched ui-change route",
            routingTier: "rule",
            requestedReasoningEffort: "high",
          },
          authorityStatus: {
            effective: "read_only",
            completeness: "authoritative",
          },
        },
      },
    ];

    render(<WorkflowOverviewPanel entries={entries} />);

    expect(screen.getByText("Authority and route")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
    expect(screen.getByText("auto selection")).toBeInTheDocument();
    expect(screen.getByText("rule route")).toBeInTheDocument();
    expect(screen.getByText("read only authority")).toBeInTheDocument();
    expect(screen.getByText("authoritative")).toBeInTheDocument();
    expect(screen.getByText("Rule matched ui-change route")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
  });

  it("renders an empty workflow state without local-only placeholders", () => {
    render(<WorkflowOverviewPanel entries={[]} />);

    expect(screen.getByText("no workflow lifecycle yet")).toBeInTheDocument();
    expect(screen.getByText(/Canonical plan, goal, and materialization events/u)).toBeInTheDocument();
  });
});
