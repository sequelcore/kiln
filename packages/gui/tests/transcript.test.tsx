import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolEvidence, Transcript } from "../src/components/transcript.js";
import type { Message, TimelineEntry } from "../src/lib/session-store/index.js";
import {
  projectWorkflowActivity,
  type OperatorSessionEvent,
  type ToolResultPresentation,
  type WorkflowActivityProjection,
} from "@kilnai/gateway-contracts";

const syntheticToolClassification = {
  source: "fallback",
  reason: "Synthetic fixture supplies canonical typed presentation evidence.",
} satisfies ToolResultPresentation["classification"];

function message(id: string, role: Message["role"], content: string, streaming = false): Message {
  return {
    id,
    role,
    content,
    createdAt: new Date().toISOString(),
    streaming,
  };
}

function messageEntry(id: string, role: Message["role"], content: string, streaming = false): TimelineEntry {
  const entryMessage = message(id, role, content, streaming);
  return {
    id: `timeline:${id}`,
    type: "message",
    createdAt: entryMessage.createdAt,
    message: entryMessage,
  };
}

function workflowEvent(
  sequence: number,
  kind: OperatorSessionEvent["kind"],
  payload: Record<string, unknown>,
  executionScope?: OperatorSessionEvent["executionScope"],
): OperatorSessionEvent {
  return {
    eventId: `workflow-${sequence}`,
    kilnSessionId: "session-1",
    sequence,
    timestamp: `2026-07-15T18:00:0${sequence}.000Z`,
    kind,
    turnId: "turn-1",
    source: { actor: "tool", surface: "gui" },
    payload: kind === "tool_call_started" || kind === "tool_call_completed"
      ? { toolCallScopeId: "response-1", ...payload }
      : payload,
    ...(executionScope ? { executionScope } : {}),
  };
}

describe("Transcript", () => {
  it("places thinking at the end of the transcript instead of beside the composer", () => {
    const { container } = render(
      <Transcript
        activityDetails="Preparing the response"
        activityPhase="thinking"
        entries={[messageEntry("1", "user", "Inspect the repository")]}
      />,
    );

    expect(screen.getByRole("status", { name: "Assistant activity: Thinking · Preparing the response" })).toBeVisible();
    expect(document.querySelector('[data-role="transcript-activity"]')).toHaveAttribute("data-orb-state", "solving");
    const rows = container.querySelectorAll('[data-slot="message-scroller-item"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Inspect the repository");
    expect(rows[1]?.querySelector('[data-role="transcript-activity"]')).toBeInTheDocument();
  });

  it("preserves one activity row while thinking changes into live tool execution", () => {
    const { rerender } = render(
      <Transcript
        activityPhase="thinking"
        entries={[messageEntry("1", "user", "Inspect the repository")]}
      />,
    );

    const activityRow = document.querySelector('[data-role="transcript-activity"]');
    expect(activityRow).toBeInTheDocument();

    rerender(
      <Transcript
        activityPhase="tool_running"
        activityToolName="bash"
        entries={[
          messageEntry("1", "user", "Inspect the repository"),
          {
            id: "timeline:event:running-tool",
            type: "event",
            eventKind: "tool_call_started",
            createdAt: "2026-07-15T08:21:00.000Z",
            title: "Running command",
            summary: "Execution in progress",
            tone: "running",
            presentationDetails: [{ label: "Tool", value: "bash" }],
            details: {
              input: { command: "bun test" },
              liveOutput: "RUN tests",
              toolName: "bash",
            },
          },
        ]}
      />,
    );

    expect(document.querySelector('[data-role="transcript-activity"]')).toBe(activityRow);
    expect(screen.getByRole("status", { name: "Assistant activity: Using bash · Execution in progress" })).toBeVisible();
    expect(document.querySelector('[data-role="transcript-activity"]')).toHaveAttribute("data-orb-state", "working");
    expect(screen.queryByRole("button", { name: /Running command\. Running/u })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show bash details" }));
    expect(screen.getByRole("log", { name: "Command output" })).toHaveTextContent("RUN tests");
  });

  it("does not duplicate activity once assistant streaming is visible", () => {
    const { rerender } = render(
      <Transcript
        activityPhase="thinking"
        entries={[messageEntry("1", "user", "Inspect the repository")]}
      />,
    );

    rerender(
      <Transcript
        activityPhase="streaming"
        entries={[messageEntry("2", "assistant", "Writing the answer", true)]}
      />,
    );

    expect(screen.getByText("Writing the answer")).toBeVisible();
    expect(document.querySelector('[data-role="transcript-activity"]')).not.toBeInTheDocument();

    rerender(
      <Transcript
        activityPhase="thinking"
        entries={[
          messageEntry("3", "user", "Continue after the command"),
          {
            id: "timeline:event:completed-command-start",
            type: "event",
            eventKind: "tool_call_started",
            createdAt: "2026-07-15T08:22:00.000Z",
            title: "Running command",
            tone: "running",
            details: { toolCallId: "command-1", toolCallScopeId: "turn-1:response:1" },
          },
          {
            id: "timeline:event:completed-command-result",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: "2026-07-15T08:22:01.000Z",
            title: "Ran command",
            tone: "success",
            details: { toolCallId: "command-1", toolCallScopeId: "turn-1:response:1" },
          },
        ]}
      />,
    );

    expect(screen.getByRole("status", { name: "Assistant activity: Thinking" })).toBeVisible();
  });

  it("composes a terminal disposition after its assistant response without a status card", () => {
    const { container } = render(
      <Transcript
        entries={[
          { ...messageEntry("user-1", "user", "Say hello"), turnId: "turn-1" },
          {
            id: "timeline:turn-completed",
            type: "event",
            eventKind: "turn_completed",
            createdAt: "2026-08-31T20:09:22.000Z",
            turnId: "turn-1",
            title: "Turn completed",
            summary: "Completed Â· Completion eligible (completion_eligible)",
            tone: "success",
            details: {
              outcome: "completed",
              dispositionReason: "completion_eligible",
              routedProvider: "codex-oauth",
              routedModel: "gpt-5.6-luna",
            },
          },
          { ...messageEntry("assistant-1", "assistant", "Hi, Ricardo! How can I help?"), turnId: "turn-1" },
        ]}
      />,
    );

    const rows = container.querySelectorAll('[data-slot="message-scroller-item"]');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent("Hi, Ricardo! How can I help?");
    const disposition = rows[1]?.querySelector('[data-role="turn-disposition"]');
    expect(disposition).toBeInTheDocument();
    expect(disposition).toHaveAttribute("data-framing", "none");
    expect(disposition).not.toHaveClass("border", "shadow-sm");
    expect(within(rows[1] as HTMLElement).queryByText(/Completion eligible/u)).not.toBeInTheDocument();
    fireEvent.click(within(rows[1] as HTMLElement).getByRole("button", { name: /Turn completed\. Completed\. Show details/u }));
    expect(within(rows[1] as HTMLElement).getByText("gpt-5.6-luna")).toBeVisible();
  });

  it("renders formal verification obligations, proof effort, candidate identity, and the Assurance boundary", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    render(<ToolEvidence presentation={{
      outputKind: "verification",
      classification: syntheticToolClassification,
      title: "Dafny formal verification",
      summary: "1/2 obligations proved · 2,760 RU",
      fields: [],
      verification: {
        kind: "formal",
        engine: { name: "dafny", version: "4.11.0" },
        candidate: { digest, subjects: [{ path: "policy.dfy", contentDigest: digest }] },
        outcome: "refuted",
        totals: { total: 2, proved: 1, refuted: 1, unresolved: 0 },
        checks: [
          { label: "Allow", outcome: "proved", durationMs: 12, resourceCount: 1_840 },
          { label: "Deny", outcome: "refuted", detail: "postcondition might not hold", durationMs: 8, resourceCount: 920 },
        ],
        authority: { kind: "evidence_only", establishes: [] },
      },
      raw: { available: false },
    }} />);

    expect(screen.getByText("Dafny 4.11.0")).toBeInTheDocument();
    expect(document.querySelector('[data-verification-engine-mark="dafny"]')).toBeInTheDocument();
    expect(screen.getByText("1 of 2 obligations proved")).toBeInTheDocument();
    expect(screen.getByText("Allow")).toBeInTheDocument();
    expect(screen.getByText("1,840 RU")).toBeInTheDocument();
    expect(screen.getByText("Deny")).toBeInTheDocument();
    expect(screen.getByText("postcondition might not hold")).toBeInTheDocument();
    expect(screen.getByText("Assurance is a separate decision")).toBeInTheDocument();
    expect(screen.getByText(`${digest.slice(0, 19)}…${digest.slice(-8)}`)).toBeInTheDocument();
  });

  it("renders Oxlint diagnostics as verification evidence", () => {
    const digest = `sha256:${"b".repeat(64)}`;
    render(<ToolEvidence presentation={{
      outputKind: "verification",
      classification: syntheticToolClassification,
      title: "Oxlint static analysis",
      fields: [],
      verification: {
        kind: "static",
        engine: { name: "oxlint", version: "1.80.0" },
        candidate: { digest, subjects: [{ path: "policy.ts", contentDigest: digest }] },
        outcome: "violations",
        profile: { id: "oxlint.correctness+suspicious/v1", rulesAnalyzed: 245 },
        diagnostics: [{ rule: "no-unused-vars", severity: "warning", message: "Unused parameter", file: "policy.ts", line: 4, column: 8 }],
        authority: { kind: "evidence_only", establishes: [] },
      },
      raw: { available: false },
    }} />);

    expect(screen.getByText("Oxlint 1.80.0")).toBeInTheDocument();
    expect(document.querySelector('[data-verification-engine-mark="static-analysis"]')).toBeInTheDocument();
    expect(screen.getByText("1 diagnostic across 245 rules")).toBeInTheDocument();
    expect(screen.getByText("no-unused-vars")).toBeInTheDocument();
    expect(screen.getByText("policy.ts:4:8")).toBeInTheDocument();
  });

  it("renders Gentle review status without inventing findings or acceptance", () => {
    const digest = `sha256:${"c".repeat(64)}`;
    render(<ToolEvidence presentation={{
      outputKind: "verification",
      classification: syntheticToolClassification,
      title: "Gentle AI review status",
      fields: [],
      verification: {
        kind: "inferential",
        engine: { name: "gentle-ai", version: "2.5.0-rc.1" },
        candidate: { digest, subjects: [{ path: "policy.ts" }] },
        outcome: { applicability: "current_target", action: "collect", replayability: "exact", nextTransition: { kind: "collect", reasonCode: "review_pending" } },
        transaction: { lineageId: "review-demo", state: "reviewing", generation: 1, revision: digest },
        authority: { kind: "evidence_only", establishes: [] },
      },
      raw: { available: false },
    }} />);

    expect(screen.getByText("Gentle AI 2.5.0-rc.1")).toBeInTheDocument();
    expect(screen.getByText("review-demo")).toBeInTheDocument();
    expect(document.querySelector('[data-verification-engine-mark="gentle-ai"]')).toBeInTheDocument();
    expect(screen.getAllByText("current target")).toHaveLength(2);
    expect(screen.getByText("collect")).toBeInTheDocument();
    expect(screen.getByText("reviewing")).toBeInTheDocument();
    expect(screen.queryByText(/approved/iu)).not.toBeInTheDocument();
  });

  it("renders one identity-stable workflow container instead of repeated lifecycle rows", () => {
    const workItem = (status: "pending" | "completed", providedEvidence: readonly string[]) => ({
      id: "work-1",
      summary: "Inspect transcript ownership",
      status,
      workflowProfile: "verification-heavy",
      risk: "low",
      surface: "gui",
      expectedEvidence: ["surface-map", "tests"],
      providedEvidence,
      pauseRequirements: [],
      executionAttempts: [],
    });
    const scope = { kind: "work_item", goalRunId: "goal-1", workItemId: "work-1" } as const;
    const workflowActivity = projectWorkflowActivity([
      workflowEvent(1, "tool_call_completed", {
        toolCallId: "work-update-1",
        toolName: "work_item.update",
        metadata: { kind: "work_item", operation: "update", item: workItem("pending", []) },
        status: { state: "succeeded" },
      }),
      workflowEvent(2, "tool_call_completed", {
        toolCallId: "goal-create-1",
        toolName: "goal.create",
        metadata: {
          kind: "goal",
          operation: "create",
          goal: {
            id: "goal-1",
            objective: "Inspect the GUI",
            status: "active",
            workItemIds: ["work-1"],
            evidenceRequirements: [],
          },
        },
        status: { state: "succeeded" },
      }),
      workflowEvent(3, "tool_call_started", { toolCallId: "read-1", toolName: "read" }, scope),
      workflowEvent(4, "tool_call_completed", {
        toolCallId: "read-1",
        toolName: "read",
        outputSummary: "Read transcript.tsx",
        status: { state: "succeeded" },
      }, scope),
      workflowEvent(5, "tool_call_completed", {
        toolCallId: "work-update-2",
        toolName: "work_item.update",
        metadata: {
          kind: "work_item",
          operation: "update",
          item: workItem("completed", ["surface-map", "tests"]),
        },
        status: { state: "succeeded" },
      }),
    ]);
    const lifecycleEntries: TimelineEntry[] = workflowActivity.consumedEventIds.map((eventId, index) => ({
      id: `timeline:${eventId}`,
      type: "event",
      eventKind: "tool_call_completed",
      createdAt: "2026-07-15T18:00:00.000Z",
      sequence: index + 1,
      title: "Completed work_item.update",
      summary: "Lifecycle event",
      tone: "success",
    }));

    render(
      <Transcript
        entries={lifecycleEntries}
        workflowActivity={{ ...workflowActivity, foregroundGoal: undefined }}
      />,
    );

    expect(document.querySelectorAll('[data-role="workflow-activity"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-role="tool-event"]')).toHaveLength(0);
    expect(screen.getByRole("button", { name: /Inspect the GUI\. Blocked\. 1 of 1 work items completed\. Goal closeout is missing/u })).toBeVisible();
    expect(document.querySelector('[data-role="workflow-activity"] [class*="animate-spin"]')).not.toBeInTheDocument();
    expect(screen.getByText("Inspect transcript ownership")).toBeVisible();
    expect(screen.getByText("2 / 2")).toBeVisible();
    const scopedActions = screen.getByRole("button", { name: "Inspected repository. 1 action. Show details" });
    expect(scopedActions).toBeVisible();
    expect(screen.queryByText(/Read transcript\.tsx/u)).not.toBeInTheDocument();
    fireEvent.click(scopedActions);
    expect(screen.getByText(/Read transcript\.tsx/u)).toBeVisible();
    expect(document.querySelector('[data-role="workflow-activity"]')?.closest('[data-slot="transcript-operational-content"]'))
      .toHaveClass("min-w-0", "max-w-[min(42rem,94%)]", "flex-1", "pl-5", "sm:pl-8");
  });

  it("does not duplicate the foreground goal owned by the composer dock in the transcript", () => {
    const goal = {
      goal: {
        id: "goal-1",
        objective: "Repair managed invocation lifecycle",
        status: "active" as const,
        workItemIds: [],
        evidenceRequirements: [],
        evidence: [],
      },
      status: "in_progress" as const,
      workItems: [],
      toolCalls: [],
      fileChanges: [],
      unscopedToolCalls: [],
      firstSequence: 1,
      lastSequence: 1,
    };
    const workflowActivity: WorkflowActivityProjection = {
      goals: [goal],
      foregroundGoal: goal,
      standaloneWorkItems: [],
      unscopedToolCalls: [],
      consumedEventIds: [],
    };

    render(<Transcript entries={[]} workflowActivity={workflowActivity} />);

    expect(screen.queryByText("Repair managed invocation lifecycle")).not.toBeInTheDocument();
    expect(document.querySelector('[data-role="workflow-activity"]')).not.toBeInTheDocument();
  });

  it("keeps an optimistic user message before the workflow events it triggered", () => {
    const workflowActivity: WorkflowActivityProjection = {
      goals: [],
      standaloneWorkItems: [{
        item: {
          id: "work-1",
          summary: "Inspect transcript ownership",
          status: "pending",
          evidence: [],
          nextTools: [],
          pauseRequirements: [],
        },
        attempts: [],
        toolCalls: [],
        firstSequence: 7,
        lastSequence: 8,
      }],
      unscopedToolCalls: [],
      consumedEventIds: ["work-start", "work-complete"],
    };
    const { container } = render(
      <Transcript
        entries={[
          messageEntry("optimistic-user", "user", "Create governed work"),
          {
            id: "timeline:work-start",
            type: "event",
            eventKind: "tool_call_started",
            createdAt: "2026-07-15T18:00:07.000Z",
            sequence: 7,
            title: "Using work_item.update",
            tone: "running",
          },
          {
            id: "timeline:work-complete",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: "2026-07-15T18:00:08.000Z",
            sequence: 8,
            title: "Completed work_item.update",
            tone: "success",
          },
        ]}
        workflowActivity={workflowActivity}
      />,
    );

    const rows = container.querySelectorAll('[data-slot="message-scroller-item"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Create governed work");
    expect(rows[1]).toHaveAttribute("data-message-id", "workflow:work-item:work-1");
    expect(rows[0]?.querySelector('[data-slot="transcript-surface"]')).toHaveAttribute("data-surface-kind", "message");
    expect(rows[1]?.querySelector('[data-slot="transcript-surface"]')).toHaveAttribute("data-surface-kind", "workflow");
  });

  it("does not repeat a standalone work item summary inside its own container", () => {
    const workflowActivity: WorkflowActivityProjection = {
      goals: [],
      standaloneWorkItems: [{
        item: {
          id: "work-1",
          summary: "Inspect transcript ownership",
          status: "pending",
          workflowProfile: "verification-heavy",
          risk: "medium",
          surface: "runtime/transcript",
          evidence: [{ label: "surface-map", status: "pending" }],
          nextTools: [],
          pauseRequirements: [],
        },
        attempts: [],
        toolCalls: [],
        firstSequence: 1,
        lastSequence: 2,
      }],
      unscopedToolCalls: [],
      consumedEventIds: [],
    };

    render(<Transcript entries={[]} workflowActivity={workflowActivity} />);

    const trigger = screen.getByRole("button", { name: /Inspect transcript ownership\. Pending\./u });
    expect(trigger).toBeVisible();
    expect(document.querySelector('[data-role="workflow-activity"][data-variant="stream"]')).toBeInTheDocument();
    expect(screen.getAllByText("Inspect transcript ownership")).toHaveLength(1);
    expect(screen.getByText("verification-heavy")).toBeVisible();
    expect(screen.getByRole("progressbar", { name: "Evidence completion for work-1" })).toBeVisible();
  });

  it("collapses a progressive work stream when canonical status becomes completed", () => {
    const workflowActivity = (status: "in_progress" | "completed"): WorkflowActivityProjection => ({
      goals: [],
      standaloneWorkItems: [{
        item: {
          id: "work-1",
          summary: "Polish the GUI activity stream",
          status,
          evidence: [{ label: "visual-check", status: status === "completed" ? "completed" : "pending" }],
          nextTools: [],
          pauseRequirements: [],
        },
        attempts: [],
        toolCalls: [],
        firstSequence: 1,
        lastSequence: 2,
      }],
      unscopedToolCalls: [],
      consumedEventIds: [],
    });
    const { rerender } = render(
      <Transcript activityPhase="tool_running" entries={[]} workflowActivity={workflowActivity("in_progress")} />,
    );

    expect(screen.getByRole("progressbar", { name: "Evidence completion for work-1" })).toBeVisible();
    expect(document.querySelectorAll('[data-role="activity-orb"]')).toHaveLength(1);
    expect(document.querySelector('[data-role="assistant-activity"]')).not.toBeInTheDocument();

    rerender(<Transcript entries={[]} workflowActivity={workflowActivity("completed")} />);

    const completedTrigger = screen.getByRole("button", { name: /Polish the GUI activity stream\. Completed\./u });
    expect(completedTrigger).toBeVisible();
    expect(screen.queryByRole("progressbar", { name: "Evidence completion for work-1" })).not.toBeInTheDocument();
    fireEvent.click(completedTrigger);
    expect(screen.getByRole("progressbar", { name: "Evidence completion for work-1" })).toBeVisible();
  });

  it("groups consecutive routine tool calls into one progressive disclosure", () => {
    const createdAt = "2026-07-15T08:21:00.000Z";
    render(
      <Transcript
        entries={[
          messageEntry("1", "user", "Inspect the repository"),
          ...["read", "list", "grep"].map((tool, index): TimelineEntry => ({
            id: `timeline:event:${tool}`,
            type: "event",
            eventKind: index === 2 ? "tool_call_started" : "tool_call_completed",
            createdAt,
            title: `Completed ${tool}`,
            summary: `${tool} result ${index + 1}`,
            tone: index === 2 ? "running" : "success",
            presentationDetails: [{ label: "Tool", value: tool }],
          })),
        ]}
      />,
    );

    expect(document.querySelectorAll('[data-slot="ai-tool-group"]')).toHaveLength(1);
    const group = document.querySelector('[data-slot="ai-tool-group"]');
    expect(group).toHaveAttribute("data-presentation", "trace");
    expect(group).toHaveAttribute("data-framing", "none");
    const activitySummary = screen.getByRole("button", { name: "Inspecting repository. 3 actions. Show details" });
    expect(activitySummary).toBeVisible();
    expect(screen.queryByRole("list", { name: "Tool activity" })).not.toBeInTheDocument();
    fireEvent.click(activitySummary);
    expect(within(screen.getByRole("list", { name: "Tool activity" })).getAllByRole("listitem")).toHaveLength(3);
    expect(document.querySelectorAll('[data-slot="ai-tool"]')).toHaveLength(3);
    expect(screen.queryByLabelText("JSON output")).not.toBeInTheDocument();
  });

  it("keeps a completed trailing tool group collapsed even while the turn remains active", () => {
    render(
      <Transcript
        entries={[
          messageEntry("1", "user", "Inspect the repository"),
          ...["read", "grep"].map((tool, index): TimelineEntry => ({
            id: `timeline:event:completed:${tool}`,
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: `2026-07-15T08:21:0${index}.000Z`,
            title: `Completed ${tool}`,
            summary: `${tool} result`,
            tone: "success",
            presentationDetails: [{ label: "Tool", value: tool }],
          })),
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "Inspected repository. 2 actions. Show details" })).toBeVisible();
    expect(screen.queryByText("Completed")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Tool activity" })).not.toBeInTheDocument();
  });

  it("uses one trace-header anatomy for completed work and live thinking", () => {
    const { container } = render(
      <Transcript
        activityPhase="thinking"
        entries={[
          messageEntry("1", "user", "Inspect the repository"),
          ...["read", "grep"].map((tool, index): TimelineEntry => ({
            id: `timeline:event:completed:${tool}`,
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: `2026-07-15T08:21:0${index}.000Z`,
            title: `Completed ${tool}`,
            summary: `${tool} result`,
            tone: "success",
            presentationDetails: [{ label: "Tool", value: tool }],
          })),
        ]}
      />,
    );

    const headers = container.querySelectorAll('[data-slot="transcript-activity-header"]');
    expect(headers).toHaveLength(2);
    for (const header of headers) {
      expect(header).toHaveClass("gap-2", "py-1", "text-xs");
      expect(header.querySelector('[data-slot="transcript-activity-identity"]')).toHaveClass("size-5");
    }
    expect(container.querySelector('[data-slot="marker"]')).not.toBeInTheDocument();
  });

  it("groups consecutive non-governance failures into one compact disclosure", () => {
    render(
      <Transcript
        entries={[
          messageEntry("1", "user", "Read missing files"),
          ...["one.ts", "two.ts"].map((file, index): TimelineEntry => ({
            id: `timeline:event:failed-read:${index}`,
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: `2026-07-15T08:22:0${index}.000Z`,
            title: "Failed read",
            summary: `ENOENT: ${file}`,
            tone: "error",
            presentationDetails: [{ label: "Tool", value: "read" }],
          })),
        ]}
      />,
    );

    expect(document.querySelectorAll('[data-slot="ai-tool-group"]')).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Repository inspection needs attention. 2 actions. Show details" })).toBeVisible();
    expect(document.querySelectorAll('[data-role="tool"]')).toHaveLength(0);
  });

  it("uses one Tool anatomy for running, completed, paused, and failed presentations", () => {
    const createdAt = "2026-07-14T20:59:04.000Z";
    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:running-tool",
            type: "event",
            eventKind: "tool_call_started",
            createdAt,
            title: "Using read",
            summary: "Execution in progress",
            tone: "running",
            presentationDetails: [{ label: "Tool", value: "read" }],
          },
          {
            id: "timeline:event:completed-tool",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt,
            title: "Completed read",
            summary: "README.md",
            tone: "success",
            presentationDetails: [{ label: "Tool", value: "read" }],
          },
          {
            id: "timeline:event:paused-tool",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt,
            title: "Execution paused",
            summary: "Managed invocation is required.",
            tone: "warning",
            presentationDetails: [{ label: "Tool", value: "work_item.execution.start" }],
          },
          {
            id: "timeline:event:failed-tool",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt,
            title: "Failed goal.create",
            summary: "Route ownership is invalid.",
            tone: "error",
            presentationDetails: [{ label: "Tool", value: "goal.create" }],
          },
        ]}
      />,
    );

    expect(document.querySelectorAll('[data-slot="ai-tool-group"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Inspecting repository. 2 actions. Show details" }));
    const tools = document.querySelectorAll('[data-slot="ai-tool"]');
    expect(tools).toHaveLength(4);
    expect(document.querySelectorAll('[data-slot="ai-tool-header"]')).toHaveLength(4);
    expect(document.querySelectorAll('[data-slot="ai-tool-status"]')).toHaveLength(4);
    expect(screen.getByRole("button", { name: /Using read\. Running\. Show details/u })).toBeVisible();
    expect(screen.getByRole("button", { name: /Completed read\. Completed\. Show details/u })).toBeVisible();
    expect(screen.getByRole("button", { name: /Execution paused\. Paused\. Show details/u })).toBeVisible();
    expect(screen.getByRole("button", { name: /Failed goal\.create\. Failed\. Hide details/u })).toBeVisible();
  });

  it("renders structured tool diagnostics without a JSON dump", () => {
    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:goal-create-diagnostic",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: "2026-07-14T20:59:04.000Z",
            title: "Failed goal.create",
            summary: "goal.create cannot combine preferredRouteId and managedAgentProfile.",
            tone: "error",
            presentationDetails: [
              { label: "Tool", value: "goal.create" },
              { label: "Status", value: "failed" },
            ],
            toolPresentation: {
              outputKind: "diagnostic",
              classification: {
                source: "content-heuristic",
                reason: "structured error envelope",
                confidence: "high",
              },
              title: "Invalid input",
              summary: "goal.create cannot combine preferredRouteId and managedAgentProfile.",
              fields: [],
              diagnostic: {
                code: "invalid_input",
                message: "goal.create cannot combine preferredRouteId and managedAgentProfile.",
                recoverable: true,
                suggestedNextTool: "goal.create",
                requiredInput: [
                  { name: "objective", expected: "string" },
                  { name: "workItemIds", expected: "existing work item id[]" },
                ],
              },
              raw: { available: false, reason: "Structured diagnostic is rendered inline" },
            },
          },
        ]}
      />,
    );

    const tool = document.querySelector('[data-slot="ai-tool"]')!;
    expect(tool).toHaveAttribute("data-state", "failed");
    expect(within(tool as HTMLElement).getByText("Invalid input")).toBeVisible();
    expect(within(tool as HTMLElement).getAllByText("goal.create cannot combine preferredRouteId and managedAgentProfile.")).not.toHaveLength(0);
    expect(within(tool as HTMLElement).getByText("objective")).toBeVisible();
    expect(within(tool as HTMLElement).getByText("existing work item id[]")).toBeVisible();
    expect(within(tool as HTMLElement).queryByLabelText("JSON output")).not.toBeInTheDocument();
    expect(within(tool as HTMLElement).queryByRole("region", { name: "Text output" })).not.toBeInTheDocument();
  });

  it("renders one stable task prompt without redundant branding", () => {
    const { container } = render(<Transcript entries={[]} />);

    expect(screen.getByRole("heading", { name: "What should Kiln work on?" })).toBeInTheDocument();
    expect(container.querySelector('img[src*="logo.svg"]')).not.toBeInTheDocument();
    expect(screen.queryByText("Start a conversation to see the transcript.")).not.toBeInTheDocument();
  });

  it("keeps the empty prompt stable across mounts", () => {
    const { unmount } = render(<Transcript entries={[]} />);
    unmount();
    render(<Transcript entries={[]} />);

    expect(screen.getByRole("heading", { name: "What should Kiln work on?" })).toBeInTheDocument();
  });

  it("renders user, assistant, and error rows with distinct roles", () => {
    render(
      <Transcript
        entries={[
          messageEntry("1", "user", "hello"),
          messageEntry("2", "assistant", "world"),
          messageEntry("4", "error", "boom"),
        ]}
      />,
    );

    const rows = screen.getAllByRole("article");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAttribute("data-role", "user");
    expect(rows[1]).toHaveAttribute("data-role", "assistant");
    expect(rows[2]).toHaveAttribute("data-role", "error");
    expect(rows[1]).toHaveAccessibleName("Assistant response");
    expect(within(rows[1]!).getByText("world")).toBeInTheDocument();
    expect(within(rows[1]!).queryByText("Assistant", { exact: true })).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="message-avatar"]')).toBeNull();
  });

  it("loads assistant audio artifact previews through the transcript resource loader", async () => {
    const loadResourceDataUrl = vi.fn().mockResolvedValue("data:audio/wav;base64,BAUG");
    const assistantMessage: Message = {
      ...message("audio-message", "assistant", "spoken answer"),
      parts: [
        { type: "text", text: "spoken answer" },
        { type: "audio", mimeType: "audio/wav", artifactUri: "kiln://artifacts/voice-synthesis/artifact_2/content" },
      ],
    };

    render(
      <Transcript
        entries={[{
          id: "timeline:audio-message",
          type: "message",
          createdAt: assistantMessage.createdAt,
          message: assistantMessage,
        }]}
        loadResourceDataUrl={loadResourceDataUrl}
      />,
    );

    expect(screen.queryByRole("link", { name: "Open audio artifact" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open audio artifact" }));

    await waitFor(() => {
      expect(loadResourceDataUrl).toHaveBeenCalledWith("kiln://artifacts/voice-synthesis/artifact_2/content");
    });
    expect(screen.getByLabelText("Audio artifact preview")).toHaveAttribute("src", "data:audio/wav;base64,BAUG");
  });

  it("renders tool activity as a stable row before the following assistant message", () => {
    render(
      <Transcript
        entries={[
          messageEntry("1", "user", "read docs"),
          {
            id: "timeline:event:tool-started",
            type: "event",
            eventKind: "tool_call_started",
            createdAt: new Date().toISOString(),
            title: "Using read",
            summary: "Execution in progress",
            tone: "running",
            details: { toolCallId: "call_read_1", toolCallScopeId: "turn-1:response:1" },
          },
          {
            id: "timeline:event:tool-completed",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed read",
            summary: "# Session Model",
            tone: "success",
            details: {
              toolCallId: "call_read_1",
              toolCallScopeId: "turn-1:response:1",
              status: "succeeded",
            },
          },
          messageEntry("2", "assistant", "Here is the summary."),
        ]}
      />,
    );

    const rows = screen.getAllByRole("article");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAttribute("data-role", "user");
    expect(rows[1]).toHaveAttribute("data-role", "tool");
    expect(rows[2]).toHaveAttribute("data-role", "assistant");
    expect(rows[1]).not.toHaveTextContent("Using read");
    expect(rows[1]).not.toHaveTextContent("Execution in progress");
    expect(rows[1]).toHaveTextContent("Completed read");
    expect(rows[1]!.querySelector('[data-slot="ai-tool"]')).toHaveAttribute("data-state", "completed");
    expect(rows[1]).toHaveTextContent("# Session Model");
    expect(rows[2]).toHaveTextContent("Here is the summary.");
    expect(within(rows[2]!).queryByTestId("assistant-tool-events")).not.toBeInTheDocument();
  });

  it("summarizes multiple assistant tool events until details are requested", () => {
    render(
      <Transcript
        entries={[
          messageEntry("1", "user", "inspect and patch"),
          {
            id: "timeline:event:tool-read",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed read",
            summary: "# Session Model",
            tone: "success",
            details: {
              toolCallId: "call_read_1",
              toolCallScopeId: "turn-1:response:1",
              status: "succeeded",
            },
          },
          {
            id: "timeline:event:tool-patch",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed patch",
            summary: "1 file changed",
            tone: "success",
            details: { toolCallId: "call_patch_1", status: "succeeded" },
          },
          messageEntry("2", "assistant", "Patched."),
        ]}
      />,
    );

    const rows = screen.getAllByRole("article");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveAttribute("data-role", "tool-group");
    expect(rows[2]).toHaveAttribute("data-role", "assistant");
    expect(rows[1]!.querySelector('[data-slot="transcript-operational-content"]'))
      .toHaveClass("min-w-0", "max-w-[min(42rem,94%)]", "flex-1", "pl-5", "sm:pl-8");
    expect(within(rows[2]!).queryByTestId("assistant-tool-events")).not.toBeInTheDocument();

    fireEvent.click(within(rows[1]!).getByRole("button", { name: "Work completed. 2 actions. Show details" }));
    expect(rows[1]).toHaveTextContent("read");
    expect(rows[1]).toHaveTextContent("patch");
    fireEvent.click(within(rows[1]!).getByRole("button", { name: /read\. Completed\. Show details/u }));
    expect(within(rows[1]!).getByText("# Session Model")).toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("1 file changed");
  });

  it("renders trailing same-turn tool activity as a standalone operational row", () => {
    render(
      <Transcript
        entries={[
          messageEntry("1", "user", "create a file"),
          messageEntry("2", "assistant", "Created `im_alive.txt` with:"),
          {
            id: "timeline:event:tool-completed",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed write",
            summary: "1 file changed, 1 addition",
            tone: "success",
          },
          messageEntry("3", "user", "now edit it"),
        ]}
      />,
    );

    const rows = screen.getAllByRole("article");
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveAttribute("data-role", "assistant");
    expect(rows[1]).toHaveTextContent("Created im_alive.txt with:");
    expect(within(rows[1]!).queryByTestId("assistant-tool-events")).not.toBeInTheDocument();
    expect(rows[2]).toHaveAttribute("data-role", "tool");
    expect(rows[2]).toHaveTextContent("Completed write");
    expect(rows[3]).toHaveAttribute("data-role", "user");
  });

  it("marks interrupted tool rows distinctly from completed rows", () => {
    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:tool-interrupted",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Interrupted shell",
            summary: "Operator stopped execution",
            tone: "warning",
            details: { toolCallId: "call_shell_1", status: "interrupted" },
          },
        ]}
      />,
    );

    const tool = screen.getByRole("article").querySelector('[data-slot="ai-tool"]');
    const toolEvent = screen.getByRole("article").querySelector('[data-slot="ai-tool-status"]');
    expect(tool).toHaveAttribute("data-state", "paused");
    expect(toolEvent).toHaveClass("text-warning");
  });

  it("keeps JSON-shaped tool output compact in inline rows and details", () => {
    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:tool-json",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed read",
            summary: JSON.stringify({
              output: "# Session Model\n\nKiln session identity is provider-agnostic.",
              isError: false,
              metadata: { toolName: "read", operation: "read" },
            }),
            tone: "success",
            details: {
              result: JSON.stringify({
                output: "# Session Model\n\nKiln session identity is provider-agnostic.",
                isError: false,
                metadata: { toolName: "read", operation: "read" },
              }),
              status: "succeeded",
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("# Session Model")).toBeInTheDocument();
    expect(screen.queryByText(/"output"/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Show details$/u }));

    expect(screen.getAllByText("# Session Model")).toHaveLength(2);
    expect(screen.queryByText(/metadata/)).not.toBeInTheDocument();
  });

  it("renders typed diff tool presentations instead of raw JSON details", () => {
    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:tool-diff",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed patch",
            summary: "1 file changed, 18 additions, 6 removals",
            tone: "success",
            details: {
              result: JSON.stringify({
                output: "1 file changed, 18 additions, 6 removals",
                isError: false,
                metadata: { toolName: "patch", diffPreview: "- raw\n+ typed" },
              }),
              status: "succeeded",
            },
            toolPresentation: {
              outputKind: "diff",
              classification: syntheticToolClassification,
              title: "packages/gui/src/components/transcript.tsx",
              summary: "1 file changed, 18 additions, 6 removals",
              fields: [
                { label: "Files", value: "1" },
                { label: "Additions", value: "18" },
                { label: "Removals", value: "6" },
              ],
              preview: {
                text: "@@ ToolEventDetails @@\n- raw json\n+ typed preview",
                truncated: true,
              },
              raw: { available: true },
            },
          },
        ]}
      />,
    );

    expect(screen.queryByText("Diff")).not.toBeInTheDocument();
    const detailsButton = screen.getByRole("button", { name: /Show details$/u });
    fireEvent.click(detailsButton);

    expect(screen.getByText("Diff")).toBeInTheDocument();
    expect(screen.getByText("packages/gui/src/components/transcript.tsx")).toBeInTheDocument();
    expect(screen.getByText("Additions")).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
    expect(screen.getByText("+ typed preview")).toBeInTheDocument();
    expect(screen.queryByText("Open inspector")).not.toBeInTheDocument();
    expect(screen.queryByText("Raw available")).not.toBeInTheDocument();
    expect(screen.queryByText(/"metadata"/)).not.toBeInTheDocument();
  });

  it("renders validated comparison-table presentation intents as native tables", () => {
    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:managed-comparison",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed managed_agent.invoke",
            summary: "3 child routes compared",
            tone: "success",
            toolPresentation: {
              outputKind: "table",
              classification: syntheticToolClassification,
              title: "Managed child comparison",
              summary: "3 child routes compared",
              fields: [{ label: "Intent", value: "comparison_table" }],
              presentationIntent: {
                kind: "comparison_table",
                title: "Managed child comparison",
                summary: "3 child routes compared",
                columns: [
                  { key: "routeId", label: "Route" },
                  { key: "provider", label: "Provider" },
                  { key: "model", label: "Model" },
                  { key: "status", label: "Status", valueKind: "status" },
                  { key: "substantiveEvidence", label: "Evidence", valueKind: "boolean" },
                ],
                rows: [
                  {
                    routeId: "codex-oauth-readonly",
                    provider: "codex-oauth",
                    model: "gpt-5.4-mini",
                    status: "completed",
                    substantiveEvidence: true,
                  },
                ],
              },
              preview: {
                text: "| Route | Provider |",
              },
              raw: { available: false },
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show details$/u }));

    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Route" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Evidence" })).toBeInTheDocument();
    expect(within(table).getByText("codex-oauth-readonly")).toBeInTheDocument();
    expect(within(table).getByText("yes")).toBeInTheDocument();
    expect(screen.queryByText("Table preview")).not.toBeInTheDocument();
    expect(screen.queryByText("| Route | Provider |")).not.toBeInTheDocument();
    expect(screen.queryByText(/"presentationIntent"/)).not.toBeInTheDocument();
  });

  it("renders comparison-table cell semantics instead of plain scalar text", () => {
    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:semantic-table",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed managed_agent.invoke",
            summary: "2 routes compared",
            tone: "success",
            toolPresentation: {
              outputKind: "table",
              classification: syntheticToolClassification,
              title: "Managed child comparison",
              summary: "2 routes compared",
              fields: [{ label: "Intent", value: "comparison_table" }],
              presentationIntent: {
                kind: "comparison_table",
                title: "Managed child comparison",
                columns: [
                  { key: "routeId", label: "Route" },
                  { key: "status", label: "Status", valueKind: "status" },
                  { key: "substantiveEvidence", label: "Evidence", valueKind: "boolean", align: "center" },
                  { key: "durationMs", label: "Duration", valueKind: "number", align: "right" },
                ],
                rows: [
                  {
                    routeId: "codex-oauth-readonly",
                    status: "completed",
                    substantiveEvidence: true,
                    durationMs: 4200,
                  },
                  {
                    routeId: "opencode-readonly",
                    status: "failed",
                    substantiveEvidence: false,
                    durationMs: 120,
                  },
                ],
              },
              raw: { available: false },
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show details$/u }));

    expect(screen.getByText("completed")).toHaveAttribute("data-cell-kind", "status");
    expect(screen.getByText("failed")).toHaveAttribute("data-cell-kind", "status");
    expect(screen.getByLabelText("Evidence: yes")).toHaveAttribute("data-cell-kind", "boolean");
    expect(screen.getByLabelText("Evidence: no")).toHaveAttribute("data-cell-kind", "boolean");
    expect(screen.getByText("4,200")).toHaveAttribute("data-cell-kind", "number");
  });

  it("keeps structured visualizers bounded inside the transcript column", () => {
    const longValue = "very-long-unbroken-value-".repeat(16);

    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:bounded-table",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed managed_agent.invoke",
            summary: "2 routes compared",
            tone: "success",
            toolPresentation: {
              outputKind: "table",
              classification: {
                source: "presentation-intent",
                reason: "validated presentation intent selected renderer",
              },
              title: "Managed child comparison",
              summary: "2 routes compared",
              fields: [{ label: "Intent", value: "comparison_table" }],
              presentationIntent: {
                kind: "comparison_table",
                title: "Managed child comparison",
                columns: [
                  { key: "routeId", label: "Route" },
                  { key: "evidence", label: "Evidence" },
                ],
                rows: [
                  { routeId: "codex-oauth-readonly", evidence: longValue },
                ],
              },
              raw: { available: false },
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show details$/u }));

    const details = screen.getByTestId("tool-output-details");
    expect(details).toHaveClass("max-w-full", "overflow-hidden");
    const tableRegion = screen.getByTestId("tool-output-table");
    expect(tableRegion).toHaveAttribute("data-output-kind", "table");
    expect(tableRegion).toHaveClass("max-w-full", "overflow-x-auto");
    expect(within(tableRegion).getByText(longValue)).toHaveClass("break-words");
  });

  it("renders route-unavailable managed invocation intents without raw envelopes", () => {
    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:managed-unavailable",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Failed managed_agent.start",
            summary: "openrouter-readonly unavailable",
            tone: "error",
            toolPresentation: {
              outputKind: "table",
              classification: syntheticToolClassification,
              title: "Managed child invocation",
              summary: "openrouter-readonly unavailable",
              fields: [{ label: "Intent", value: "comparison_table" }],
              presentationIntent: {
                kind: "comparison_table",
                title: "Managed child invocation",
                summary: "openrouter-readonly unavailable",
                source: "managed_agent.start",
                confidence: "medium",
                columns: [
                  { key: "routeId", label: "Route" },
                  { key: "provider", label: "Provider" },
                  { key: "model", label: "Model" },
                  { key: "status", label: "Status", valueKind: "status" },
                  { key: "substantiveEvidence", label: "Evidence", valueKind: "boolean" },
                  { key: "failureReason", label: "Failure" },
                ],
                rows: [
                  {
                    routeId: "openrouter-readonly",
                    provider: "openrouter",
                    model: "openrouter/free",
                    status: "unavailable",
                    substantiveEvidence: false,
                    failureReason: "Direct provider route is not eligible.",
                  },
                ],
              },
              preview: {
                text: "| Route | Provider |",
              },
              raw: { available: false },
            },
          },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: /Hide details$/u })).toBeInTheDocument();

    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Route" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Failure" })).toBeInTheDocument();
    expect(within(table).getByText("openrouter-readonly")).toBeInTheDocument();
    expect(within(table).getByText("unavailable")).toBeInTheDocument();
    expect(within(table).getByText("no")).toBeInTheDocument();
    expect(within(table).getByText("Direct provider route is not eligible.")).toBeInTheDocument();
    expect(screen.queryByText("Table preview")).not.toBeInTheDocument();
    expect(screen.queryByText("| Route | Provider |")).not.toBeInTheDocument();
    expect(screen.queryByText(/"metadata"/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"presentationIntent"/)).not.toBeInTheDocument();
  });

  it("renders denied-skills managed invocation intents as native tables without raw envelopes", () => {
    const presentationIntent = {
      kind: "comparison_table",
      title: "Managed child invocation",
      summary: "opencode-readonly denied",
      source: "managed_agent.invoke",
      columns: [
        { key: "routeId", label: "Route" },
        { key: "provider", label: "Provider" },
        { key: "model", label: "Model" },
        { key: "status", label: "Status", valueKind: "status" },
        { key: "substantiveEvidence", label: "Evidence", valueKind: "boolean" },
        { key: "failureReason", label: "Failure" },
      ],
      rows: [
        {
          routeId: "opencode-readonly",
          provider: "opencode",
          model: "model-a",
          status: "denied",
          substantiveEvidence: false,
          failureReason: "Managed invocation denied skill(s): workspace-write",
        },
      ],
    } as const;

    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:managed-denied-skills",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Failed managed_agent.invoke",
            summary: "opencode-readonly denied",
            tone: "error",
            details: {
              result: JSON.stringify({
                output: "Managed invocation denied: Managed invocation denied skill(s): workspace-write",
                isError: true,
                metadata: {
                  toolName: "managed_agent.invoke",
                  kind: "managed-invocation",
                  status: "denied",
                  context: {
                    mode: "isolated",
                    agentProfile: "architecture-reviewer",
                    skills: ["workspace-write"],
                    deniedSkills: ["workspace-write"],
                  },
                  presentationIntent,
                },
              }),
              status: "failed",
            },
            toolPresentation: {
              outputKind: "table",
              classification: syntheticToolClassification,
              title: "Managed child invocation",
              summary: "opencode-readonly denied",
              fields: [{ label: "Denied skills", value: "workspace-write" }],
              presentationIntent,
              preview: {
                text: "| Route | Provider |",
              },
              raw: { available: false },
            },
          },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: /Hide details$/u })).toBeInTheDocument();

    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Route" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Failure" })).toBeInTheDocument();
    expect(within(table).getByText("opencode-readonly")).toBeInTheDocument();
    expect(within(table).getByText("denied")).toBeInTheDocument();
    expect(within(table).getByText("no")).toBeInTheDocument();
    expect(within(table).getByText("Managed invocation denied skill(s): workspace-write")).toBeInTheDocument();
    expect(screen.queryByText("Table preview")).not.toBeInTheDocument();
    expect(screen.queryByText("| Route | Provider |")).not.toBeInTheDocument();
    expect(screen.queryByText(/"metadata"/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"presentationIntent"/)).not.toBeInTheDocument();
  });

  it("exposes local recorder timeline controls for zoom, cut, caption, and redaction edits", () => {
    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:recorder-edits",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed recorder timeline",
            summary: "4 edit tracks",
            tone: "success",
            toolPresentation: {
              outputKind: "text",
              classification: syntheticToolClassification,
              title: "Recorder edit timeline",
              summary: "4 edit tracks",
              fields: [{ label: "Intent", value: "timeline" }],
              presentationIntent: {
                kind: "timeline",
                title: "Recorder edit timeline",
                summary: "Editable browser recorder tracks",
                items: [
                  {
                    id: "edit-auto-zoom-1",
                    timestamp: "00:01.250",
                    label: "auto_zoom click target",
                    status: "success",
                    summary: "Zoom into the submit button",
                  },
                  {
                    id: "edit-cut-1",
                    timestamp: "00:04.000",
                    label: "cut idle gap",
                    status: "warning",
                    summary: "Remove a 900 ms idle segment",
                  },
                  {
                    id: "edit-caption-1",
                    timestamp: "00:05.000",
                    label: "caption: Submit the form",
                    status: "info",
                    summary: "Submit the form",
                  },
                  {
                    id: "edit-redaction-1",
                    timestamp: "00:06.000",
                    label: "redaction password field",
                    status: "warning",
                    summary: "Mask the password field",
                  },
                ],
              },
              raw: { available: false },
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show details$/u }));

    const editor = screen.getByRole("region", { name: "Recorder timeline editor" });
    const zoom = within(editor).getByRole("slider", { name: "Zoom depth for auto_zoom click target" });
    fireEvent.change(zoom, { target: { value: "2.2" } });
    expect(within(editor).getByText("2.2x")).toBeInTheDocument();

    const cut = within(editor).getByRole("checkbox", { name: "Cut segment for cut idle gap" });
    expect(cut).not.toBeChecked();
    fireEvent.click(cut);
    expect(cut).toBeChecked();
    expect(within(editor).getByText("Cut selected")).toBeInTheDocument();

    const caption = within(editor).getByRole("textbox", { name: "Caption text for caption: Submit the form" });
    expect(caption).toHaveValue("Submit the form");
    fireEvent.change(caption, { target: { value: "Submit and confirm" } });
    expect(caption).toHaveValue("Submit and confirm");

    const redaction = within(editor).getByRole("checkbox", { name: "Redact region for redaction password field" });
    expect(redaction).not.toBeChecked();
    fireEvent.click(redaction);
    expect(redaction).toBeChecked();
    expect(within(editor).getByText("Redaction marked")).toBeInTheDocument();
  });

  it("keeps recorder timeline adjustments scoped to their edit item", () => {
    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:recorder-captions",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed recorder timeline",
            summary: "2 captions",
            tone: "success",
            toolPresentation: {
              outputKind: "text",
              classification: syntheticToolClassification,
              title: "Recorder caption timeline",
              summary: "2 caption tracks",
              fields: [{ label: "Intent", value: "timeline" }],
              presentationIntent: {
                kind: "timeline",
                title: "Recorder caption timeline",
                items: [
                  {
                    id: "edit-caption-1",
                    timestamp: "00:01.000",
                    label: "caption: Open settings",
                    summary: "Open settings",
                  },
                  {
                    id: "edit-caption-2",
                    timestamp: "00:02.000",
                    label: "caption: Save changes",
                    summary: "Save changes",
                  },
                ],
              },
              raw: { available: false },
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show details$/u }));

    const editor = screen.getByRole("region", { name: "Recorder timeline editor" });
    const firstCaption = within(editor).getByRole("textbox", { name: "Caption text for caption: Open settings" });
    const secondCaption = within(editor).getByRole("textbox", { name: "Caption text for caption: Save changes" });

    fireEvent.change(firstCaption, { target: { value: "Open preferences" } });

    expect(firstCaption).toHaveValue("Open preferences");
    expect(secondCaption).toHaveValue("Save changes");
  });

  it("keeps generic timeline presentations read-only even when labels mention captions", () => {
    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:generic-timeline",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed release plan",
            summary: "2 milestones",
            tone: "success",
            toolPresentation: {
              outputKind: "text",
              classification: syntheticToolClassification,
              title: "Release plan timeline",
              summary: "2 milestones",
              fields: [{ label: "Intent", value: "timeline" }],
              presentationIntent: {
                kind: "timeline",
                title: "Release plan timeline",
                items: [
                  {
                    id: "milestone-caption-copy",
                    timestamp: "Day 1",
                    label: "caption copy review",
                    summary: "Review marketing captions before launch",
                  },
                ],
              },
              raw: { available: false },
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show details$/u }));

    expect(screen.getByText("caption copy review")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recorder timeline editor" })).not.toBeInTheDocument();
  });

  it("renders resource-linked tool presentations without fake inspector actions", () => {
    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:tool-resource",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed read_many",
            summary: "24 files read, 109 skipped, 200000 bytes, truncated",
            tone: "success",
            details: {
              result: JSON.stringify({
                output: "--- C:\\workspace\\kiln\\docs\\architecture.md",
                isError: false,
                metadata: { toolName: "read_many" },
              }),
              status: "succeeded",
            },
            toolPresentation: {
              outputKind: "resource_links",
              classification: syntheticToolClassification,
              title: "read_many full output",
              summary: "24 files read, 109 skipped, 200000 bytes, truncated",
              fields: [
                { label: "Files", value: "24 read / 109 skipped" },
                { label: "Bytes", value: "200000" },
              ],
              resourceLinks: [
                {
                  uri: "kiln://artifacts/tool-results/artifact_1/content",
                  title: "read_many full output",
                  mimeType: "text/plain",
                  size: 200000,
                  relation: "full_output",
                },
              ],
              raw: { available: true },
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show details$/u }));

    expect(screen.getByText("Resource")).toBeInTheDocument();
    expect(screen.getAllByText("read_many full output").length).toBeGreaterThan(0);
    expect(screen.getByText("kiln://artifacts/tool-results/artifact_1/content")).toBeInTheDocument();
    expect(screen.queryByText("Open inspector")).not.toBeInTheDocument();
    expect(screen.queryByText("Raw available")).not.toBeInTheDocument();
    expect(screen.queryByText("--- C:\\workspace\\kiln\\docs\\architecture.md")).not.toBeInTheDocument();
  });

  it("renders resource bundle presentation intents as inspectable resources", () => {
    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:resource-bundle",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed artifacts",
            summary: "2 resources",
            tone: "success",
            toolPresentation: {
              outputKind: "resource_links",
              classification: syntheticToolClassification,
              title: "Generated artifacts",
              summary: "2 resources",
              fields: [{ label: "Intent", value: "resource_bundle" }],
              presentationIntent: {
                kind: "resource_bundle",
                title: "Generated artifacts",
                resources: [
                  {
                    uri: "kiln://artifacts/report/content",
                    title: "Research report",
                    mimeType: "text/markdown",
                    size: 2048,
                    relation: "primary",
                  },
                  {
                    uri: "kiln://artifacts/evidence/content",
                    title: "Evidence bundle",
                    mimeType: "application/json",
                    relation: "supporting",
                  },
                ],
              },
              raw: { available: false },
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show details$/u }));

    const resources = screen.getByRole("list", { name: "Generated artifacts resources" });
    expect(within(resources).getByText("Research report")).toBeInTheDocument();
    expect(within(resources).getByText("text/markdown")).toBeInTheDocument();
    expect(within(resources).getByText("primary")).toBeInTheDocument();
    expect(within(resources).getByText("2 KB")).toBeInTheDocument();
    expect(within(resources).getByText("kiln://artifacts/evidence/content")).toBeInTheDocument();
  });

  it("renders browser screenshot tool presentations as a numbered capture gallery", () => {
    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:browser-captures",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed browser_observe",
            summary: "Capture 1: Example Domain",
            tone: "success",
            details: {
              result: "observe: https://example.com",
              status: "succeeded",
            },
            toolPresentation: {
              outputKind: "image",
              classification: syntheticToolClassification,
              title: "Browser screenshots",
              summary: "Capture 1: Example Domain",
              fields: [
                { label: "URL", value: "https://example.com" },
                { label: "Session", value: "browser-1" },
              ],
              resourceLinks: [
                {
                  uri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
                  title: "browser_observe screenshot",
                  mimeType: "image/png",
                  size: 1234,
                  relation: "snapshot",
                  label: "Capture 1",
                  sequence: 1,
                },
                {
                  uri: "kiln://artifacts/interactive-screenshots/artifact_2/content",
                  title: "browser_click screenshot",
                  mimeType: "image/png",
                  size: 2345,
                  relation: "snapshot",
                  label: "Capture 2",
                  sequence: 2,
                },
                {
                  uri: "kiln://artifacts/browser-debug/artifact_3/content",
                  title: "browser diagnostic payload",
                  mimeType: "application/json",
                  size: 456,
                  relation: "full_output",
                },
              ],
              raw: {
                available: true,
                resourceUri: "kiln://artifacts/interactive-screenshots/artifact_1/content",
              },
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show details$/u }));

    const gallery = screen.getByRole("list", { name: "Browser screenshot captures" });
    expect(within(gallery).getByText("Capture 1")).toBeInTheDocument();
    expect(within(gallery).getByText("Capture 2")).toBeInTheDocument();
    expect(within(gallery).getByText("kiln://artifacts/interactive-screenshots/artifact_1/content")).toBeInTheDocument();
    expect(within(gallery).getByText("kiln://artifacts/interactive-screenshots/artifact_2/content")).toBeInTheDocument();
    expect(within(gallery).queryByText("browser diagnostic payload")).not.toBeInTheDocument();
    expect(screen.getByText("browser diagnostic payload")).toBeInTheDocument();
    expect(screen.getByText("kiln://artifacts/browser-debug/artifact_3/content")).toBeInTheDocument();
    expect(screen.queryByText(/data:image/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"metadata"/)).not.toBeInTheDocument();
  });

  it("loads browser screenshot resource links into inspectable transcript previews", async () => {
    const screenshotUri = "kiln://artifacts/interactive-screenshots/artifact_1/content";
    const screenshotDataUrl = "data:image/png;base64,a2lsbg==";
    const loadResourceDataUrl = vi.fn(async (uri: string) => (uri === screenshotUri ? screenshotDataUrl : null));

    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:browser-preview",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed browser_observe",
            summary: "Capture 1: Example Domain",
            tone: "success",
            details: {
              result: "observe: https://example.com",
              status: "succeeded",
            },
            toolPresentation: {
              outputKind: "image",
              classification: syntheticToolClassification,
              title: "Browser screenshots",
              summary: "Capture 1: Example Domain",
              fields: [
                { label: "URL", value: "https://example.com" },
                { label: "Session", value: "browser-1" },
              ],
              resourceLinks: [
                {
                  uri: screenshotUri,
                  title: "browser_observe screenshot",
                  mimeType: "image/png",
                  size: 1234,
                  relation: "snapshot",
                  label: "Capture 1",
                  sequence: 1,
                },
                {
                  uri: "kiln://artifacts/browser-debug/artifact_2/content",
                  title: "browser diagnostic payload",
                  mimeType: "application/json",
                  size: 456,
                  relation: "full_output",
                },
              ],
              raw: { available: true },
            },
          },
        ]}
        loadResourceDataUrl={loadResourceDataUrl}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show details$/u }));

    const preview = await screen.findByRole("img", { name: "Browser screenshot Capture 1" });
    expect(preview).toHaveAttribute("src", screenshotDataUrl);
    expect(loadResourceDataUrl).toHaveBeenCalledTimes(1);
    expect(loadResourceDataUrl).toHaveBeenCalledWith(screenshotUri);
    expect(screen.getByText(screenshotUri)).toBeInTheDocument();
    expect(screen.getByText("kiln://artifacts/browser-debug/artifact_2/content")).toBeInTheDocument();
  });

  it("renders read and tree tool presentations without JSON envelopes", () => {
    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:tool-read-live",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed read",
            summary: "# Session Model",
            tone: "success",
            details: {
              result: "# Session Model",
              status: "succeeded",
            },
            toolPresentation: {
              outputKind: "markdown",
              classification: syntheticToolClassification,
              title: "docs/architecture/session-model.md",
              summary: "# Session Model",
              fields: [{ label: "Path", value: "docs/architecture/session-model.md" }],
              preview: {
                text: "# Session Model\n\nKiln session identity is provider-agnostic.",
              },
              raw: { available: true },
            },
          },
          {
            id: "timeline:event:tool-tree-live",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed tree",
            summary: "55 entries under C:\\workspace\\kiln",
            tone: "success",
            details: {
              result: "55 entries under C:\\workspace\\kiln",
              status: "succeeded",
            },
            toolPresentation: {
              outputKind: "tree",
              classification: syntheticToolClassification,
              title: "C:\\workspace\\kiln",
              summary: "55 entries under C:\\workspace\\kiln",
              fields: [
                { label: "Path", value: "C:\\workspace\\kiln" },
                { label: "Entries", value: "55" },
                { label: "Depth", value: "3" },
              ],
              preview: {
                text: ".\npackages/\n  gui/",
              },
              resourceLinks: [
                {
                  uri: "kiln://artifacts/tool-results/artifact_tree/content",
                  title: "tree full output",
                  mimeType: "text/plain",
                  size: 9000,
                  relation: "full_output",
                },
              ],
              raw: { available: true, resourceUri: "kiln://artifacts/tool-results/artifact_tree/content" },
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Work completed. 2 actions. Show details" }));
    expect(screen.getByText("# Session Model")).toBeInTheDocument();
    expect(screen.getAllByText("55 entries under C:\\workspace\\kiln").length).toBeGreaterThan(0);

    let detailButtons = screen.getAllByRole("button", { name: /Show details$/u });
    fireEvent.click(detailButtons[0]!);

    expect(screen.getByText("Document")).toBeInTheDocument();
    expect(screen.queryByText("Status")).not.toBeInTheDocument();
    expect(screen.queryByText("succeeded")).not.toBeInTheDocument();
    detailButtons = screen.getAllByRole("button", { name: /Show details$/u });
    fireEvent.click(detailButtons[0]!);

    expect(screen.getAllByText("Directory tree").length).toBeGreaterThan(0);
    expect(screen.getAllByText("C:\\workspace\\kiln")).toHaveLength(1);
    expect(screen.getAllByText("55 entries under C:\\workspace\\kiln")).toHaveLength(1);
    expect(screen.getByText("Kiln session identity is provider-agnostic.")).toBeInTheDocument();
    const treeOutput = screen.getByRole("list", { name: "Directory tree output" });
    const treeLine = within(treeOutput).getByText("packages");
    expect(treeLine).toBeInTheDocument();
    expect(treeLine.closest("li")).toHaveAttribute("data-tree-entry-kind", "directory");
    expect(treeLine.closest("pre")).not.toBeInTheDocument();
    expect(screen.getByText("tree full output")).toBeInTheDocument();
    expect(screen.queryByText(/"output"/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"metadata"/)).not.toBeInTheDocument();
  });

  it("renders web search output as structured search results instead of raw text", () => {
    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:web-search",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed web_search",
            summary: "5 sources for FIFA World Cup 2026 fixtures",
            tone: "success",
            toolPresentation: {
              outputKind: "search_results",
              classification: {
                source: "tool-metadata",
                reason: "web/search metadata identifies search result output",
                confidence: "high",
              },
              title: "FIFA World Cup 2026 fixtures July 3 2026 matches",
              summary: "5 sources for FIFA World Cup 2026 fixtures",
              fields: [],
              searchResults: [
                {
                  title: "Matches | FIFA World Cup 2026",
                  url: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures",
                  source: "fifa.com",
                },
                {
                  title: "FIFA World Cup 2026 | Fixtures, groups, teams & more",
                  url: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/fixtures",
                  source: "fifa.com",
                },
              ],
              preview: {
                text: [
                  "5 sources for FIFA World Cup 2026 fixtures July 3 2026 matches",
                  "",
                  "1. Matches | FIFA World Cup 2026",
                  "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures",
                  "2. FIFA World Cup 2026 | Fixtures, groups, teams & more",
                  "[Fixtures](https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/fixtures)",
                ].join("\n"),
              },
              raw: { available: true },
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show details$/u }));

    const searchResultsOutput = screen.getByRole("region", { name: "Search results" });
    expect(within(searchResultsOutput).getAllByRole("listitem")).toHaveLength(2);
    expect(within(searchResultsOutput).getByRole("link", { name: "Matches | FIFA World Cup 2026" })).toHaveAttribute(
      "href",
      "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/scores-fixtures",
    );
    expect(screen.queryByRole("region", { name: "Document" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Text output" })).not.toBeInTheDocument();
  });

  it("labels unknown JSON fallback as structured data instead of text output", () => {
    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:custom-structured-data",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed custom.inspect",
            summary: "3 fields",
            tone: "success",
            toolPresentation: {
              outputKind: "data",
              classification: {
                source: "content-heuristic",
                reason: "structured JSON output classified from content",
                confidence: "medium",
              },
              title: "custom.inspect",
              summary: "3 fields",
              fields: [],
              preview: {
                text: '{"status":"ready","count":2,"items":["one","two"]}',
                language: "json",
              },
              raw: { available: true },
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show details$/u }));

    expect(screen.getByRole("region", { name: "Structured data" })).toBeVisible();
    expect(screen.getByLabelText("JSON output")).toBeVisible();
    expect(screen.queryByRole("region", { name: "Text output" })).not.toBeInTheDocument();
  });

  it("renders indented file tree output as a bounded hierarchical list", () => {
    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:tool-tree-hierarchy",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed tree",
            summary: "4 entries under C:\\workspace\\kiln",
            tone: "success",
            toolPresentation: {
              outputKind: "tree",
              classification: syntheticToolClassification,
              title: "C:\\workspace\\kiln",
              summary: "4 entries under C:\\workspace\\kiln",
              fields: [
                { label: "Path", value: "C:\\workspace\\kiln" },
                { label: "Entries", value: "4" },
              ],
              preview: {
                text: ".\npackages/\n  gui/\n    package.json\nREADME.md",
              },
              raw: { available: true },
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show details$/u }));

    const treeOutput = screen.getByRole("list", { name: "Directory tree output" });
    expect(treeOutput).toHaveAttribute("data-output-kind", "tree");
    expect(within(treeOutput).getByText("packages")).toBeInTheDocument();
    expect(within(treeOutput).getByText("gui")).toBeInTheDocument();
    expect(within(treeOutput).getByText("package.json").closest("li")).toHaveAttribute("data-tree-entry-kind", "file");
    expect(within(treeOutput).getByText("package.json").closest("li")).toHaveAttribute("data-tree-depth", "2");
    expect(within(treeOutput).getByText("README.md").closest("li")).toHaveAttribute("data-tree-depth", "0");
  });

  it("renders stat metadata as fields instead of JSON text preview", () => {
    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:tool-stat-live",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed stat",
            summary: "file · 25 bytes",
            tone: "success",
            details: {
              result: "{",
              status: "succeeded",
            },
            toolPresentation: {
              outputKind: "text",
              classification: syntheticToolClassification,
              title: "C:\\workspace\\kiln\\im_alive.txt",
              summary: "file · 25 bytes",
              fields: [
                { label: "Type", value: "file" },
                { label: "Size", value: "25 bytes" },
                { label: "Modified", value: "2026-04-30T12:33:05.305Z" },
              ],
              raw: { available: false },
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("file · 25 bytes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Show details$/u }));
    expect(screen.getByText("C:\\workspace\\kiln\\im_alive.txt")).toBeInTheDocument();
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("25 bytes")).toBeInTheDocument();
    expect(screen.queryByText("Text preview")).not.toBeInTheDocument();
    expect(screen.queryByText("{")).not.toBeInTheDocument();
  });

  it("does not render a tree summary as a tree preview", () => {
    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:tool-tree-summary",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed tree",
            summary: "20 entries under C:\\workspace\\kiln",
            tone: "success",
            details: {
              result: "20 entries under C:\\workspace\\kiln",
              status: "succeeded",
            },
            toolPresentation: {
              outputKind: "tree",
              classification: syntheticToolClassification,
              title: "C:\\workspace\\kiln",
              summary: "20 entries under C:\\workspace\\kiln",
              fields: [{ label: "Entries", value: "20" }],
              raw: { available: false },
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show details$/u }));
    expect(screen.getAllByText("20 entries under C:\\workspace\\kiln").length).toBeGreaterThan(0);
    expect(screen.queryByText("Tree preview")).not.toBeInTheDocument();
  });

  it("renders source file tool output as source instead of generic text preview", () => {
    render(
      <Transcript
        entries={[
          {
            id: "timeline:event:tool-read-package",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed read",
            summary: "3 lines · 22 bytes",
            tone: "success",
            details: {
              result: "{",
              status: "succeeded",
            },
            toolPresentation: {
              outputKind: "code",
              classification: syntheticToolClassification,
              title: "package.json",
              summary: "3 lines · 22 bytes",
              fields: [
                { label: "Path", value: "package.json" },
                { label: "Lines", value: "3" },
              ],
              preview: {
                text: "{\n  \"name\": \"kiln\"\n}",
                language: "json",
              },
              raw: { available: true },
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Show details$/u }));
    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("json")).toBeInTheDocument();
    expect(screen.getAllByText("3 lines · 22 bytes").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("JSON output")).toBeInTheDocument();
    expect(screen.getByText('"name":')).toHaveClass("kiln-json-view__label");
    expect(screen.getByText('"kiln"')).toHaveClass("kiln-json-view__string");
    expect(screen.queryByText("Text preview")).not.toBeInTheDocument();
    expect(screen.queryByText("Code preview")).not.toBeInTheDocument();
  });

  it("uses incremental content without avatar or cursor decoration", () => {
    render(
      <Transcript
        entries={[
          messageEntry("1", "assistant", "streaming...", true),
        ]}
      />,
    );
    expect(screen.queryByLabelText("Streaming")).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="message-avatar"]')).toBeNull();
    expect(screen.getByText("streaming...")).toBeInTheDocument();
  });

  it("renders assistant messages in the official lightweight bubble primitive", () => {
    render(
      <Transcript
        entries={[messageEntry("1", "assistant", "Here is the update.")]}
      />,
    );

    const assistantRow = screen.getByRole("article");
    expect(assistantRow).toHaveAttribute("data-role", "assistant");
    const bubble = assistantRow.querySelector('[data-slot="bubble"]');
    expect(bubble).toHaveAttribute("data-variant", "ghost");
    expect(bubble).not.toHaveClass("border", "bg-card");
  });

  it("keeps live tool events visible as rows before final text arrives", () => {
    render(
      <Transcript
        entries={[
          messageEntry("1", "user", "patch the file"),
          {
            id: "timeline:event:tool-started",
            type: "event",
            eventKind: "tool_call_started",
            createdAt: new Date().toISOString(),
            title: "Using patch",
            summary: "Execution in progress",
            tone: "running",
            details: { toolCallId: "call_patch_1", toolCallScopeId: "turn-1:response:1" },
          },
          {
            id: "timeline:event:tool-completed",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed patch",
            summary: "1 file changed",
            tone: "success",
            details: {
              toolCallId: "call_patch_1",
              toolCallScopeId: "turn-1:response:1",
              status: "succeeded",
            },
          },
        ]}
      />,
    );

    const rows = screen.getAllByRole("article");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("data-role", "user");
    expect(rows[1]).toHaveAttribute("data-role", "tool");
    expect(screen.queryByText("Using patch")).not.toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("Completed patch");
    expect(screen.queryByRole("status", { name: /Activity phase:/ })).not.toBeInTheDocument();
  });

  it("renders streamed command output inside the existing running tool card", () => {
    render(
      <Transcript
        entries={[{
          id: "timeline:event:command-started",
          type: "event",
          eventKind: "tool_call_started",
          createdAt: new Date().toISOString(),
          title: "Using bash",
          summary: "Execution in progress",
          tone: "running",
          details: {
            toolCallId: "command-1",
            toolName: "bash",
            input: { command: "bun test" },
            liveOutput: "RUN tests\n✓ passed\n",
          },
        }]}
      />,
    );

    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.queryByRole("log", { name: "Command output" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Using bash\. Running\. Show details/u }));
    expect(screen.getByRole("log", { name: "Command output" })).toHaveTextContent("RUN tests");
    expect(screen.getByRole("button", { name: "Copy output" })).toBeInTheDocument();
  });

  it("does not duplicate the responding state when an assistant message is already streaming", () => {
    render(
      <Transcript
        entries={[messageEntry("1", "assistant", "working", true)]}
      />,
    );

    expect(screen.queryByLabelText("Streaming")).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Activity phase: Responding" })).not.toBeInTheDocument();
  });

  it("keeps live tool rows durable without synthesizing assistant activity", () => {
    render(
      <Transcript
        entries={[
          messageEntry("1", "user", "patch the file"),
          {
            id: "timeline:event:tool-started",
            type: "event",
            eventKind: "tool_call_started",
            createdAt: new Date().toISOString(),
            title: "Using patch",
            summary: "Execution in progress",
            tone: "running",
            details: { toolCallId: "call_patch_1" },
          },
        ]}
      />,
    );

    const rows = screen.getAllByRole("article");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("data-role", "user");
    expect(rows[1]).toHaveAttribute("data-role", "tool");
    expect(rows[1]).toHaveTextContent("Using patch");
    expect(rows[1]!.querySelector('[data-slot="ai-tool"]')).toHaveAttribute("data-state", "running");
    expect(rows[1]!.querySelector('[data-slot="ai-tool-header"]')).toBeInTheDocument();
    expect(rows[1]!.querySelector('[data-slot="ai-tool-status"]')).toHaveTextContent("Running");
    expect(rows[1]!.querySelector('[data-role="active-tool-beam"]')).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /Activity phase:/ })).not.toBeInTheDocument();
  });

  it("renders active tool rows as compact inline trace entries", () => {
    render(
      <Transcript
        entries={[
          messageEntry("1", "user", "patch the file"),
          {
            id: "timeline:event:tool-started",
            type: "event",
            eventKind: "tool_call_started",
            createdAt: new Date().toISOString(),
            title: "Using patch",
            summary: "Execution in progress",
            tone: "running",
            details: { toolCallId: "call_patch_1", toolCallScopeId: "turn-1:response:1" },
          },
        ]}
      />,
    );

    const toolRow = screen.getAllByRole("article")[1]!;
    const tool = toolRow.querySelector('[data-slot="ai-tool"]');
    const toolEvent = toolRow.querySelector('[data-role="tool-event"]');
    expect(tool).toHaveAttribute("data-state", "running");
    expect(tool).toHaveAttribute("data-presentation", "trace");
    expect(tool).toHaveAttribute("data-framing", "none");
    expect(toolEvent).toHaveTextContent("Execution in progress");
    expect(toolEvent).toHaveAttribute("data-slot", "ai-tool-header");
    expect(toolRow.querySelector('[data-slot="ai-tool-status"]')).toHaveTextContent("Running");
    expect(toolRow.querySelector('[data-slot="ai-tool-status"]')).not.toHaveAttribute("data-slot", "badge");
    expect(tool?.querySelector('[data-slot="badge"]')).toBeNull();
    expect(toolRow.querySelector('[data-slot="ai-tool-status"] svg')).toHaveClass("motion-safe:animate-spin");
    expect(toolRow.querySelector('[data-role="active-tool-beam"]')).not.toBeInTheDocument();
  });

  it("renders canonical tool presentation details in transcript instead of raw structured input", () => {
    render(
      <Transcript
        entries={[
          messageEntry("1", "user", "delegate this"),
          {
            id: "timeline:event:tool-started",
            type: "event",
            eventKind: "tool_call_started",
            createdAt: new Date().toISOString(),
            title: "Delegating architecture review",
            summary: "read-only via codex-oauth/gpt-5.5 (direct-provider) · Execution in progress",
            tone: "running",
            details: {
              input: {
                access: "read-only",
                providerRoute: { providerId: "codex-oauth" },
                task: "Inspect docs/architecture/coordination/agent-tasks.md.",
              },
            },
            presentationDetails: [
              { label: "Tool", value: "managed_agent.invoke" },
              { label: "Tool call ID", value: "call_managed_1" },
              { label: "Access", value: "read-only" },
              { label: "Provider", value: "codex-oauth" },
              { label: "Model", value: "gpt-5.5" },
              { label: "Surface", value: "direct-provider" },
              { label: "Context mode", value: "isolated" },
              { label: "Agent profile", value: "architecture-reviewer" },
              { label: "Skills", value: "ddd-review" },
              { label: "Authority", value: "authority:codex-oauth-readonly:read-only" },
              { label: "Invocation ID", value: "managed-1" },
              { label: "Child session", value: "child-session-1" },
              { label: "Task", value: "Inspect docs/architecture/coordination/agent-tasks.md." },
            ],
          },
          messageEntry("2", "assistant", "", true),
        ]}
      />,
    );

    const row = screen.getAllByRole("article")[1]!;
    expect(row).toHaveTextContent("Delegating architecture review");
    expect(row).not.toHaveTextContent("managed_agent.invoke");
    expect(row).toHaveTextContent("gpt-5.5");
    expect(row).toHaveTextContent("direct-provider");
    fireEvent.click(within(row).getByRole("button", { name: /Show details$/u }));
    expect(row).toHaveTextContent("architecture-reviewer");
    expect(row).toHaveTextContent("ddd-review");
    expect(row).not.toHaveTextContent("Structured value");
    expect(row).not.toHaveTextContent("Tool call ID");
    expect(row).not.toHaveTextContent("authority:codex-oauth-readonly");
    expect(row).not.toHaveTextContent("managed-1");
    expect(row).not.toHaveTextContent("child-session-1");
  });

  it("composes the transcript with the official scroll viewport and live region", () => {
    render(<Transcript entries={[messageEntry("1", "assistant", "first")]} />);

    const viewport = screen.getByRole("region", { name: "Transcript" });
    expect(viewport).toHaveAttribute("data-slot", "message-scroller-viewport");
    expect(within(viewport).getByRole("log")).toHaveAttribute("data-slot", "message-scroller-content");
    expect(screen.getByRole("button", { name: "Jump to latest" })).toHaveAttribute("data-direction", "end");
  });

  it("exposes stable message rows and anchors each user turn", () => {
    render(
      <Transcript
        entries={[
          messageEntry("user-turn", "user", "Inspect the execution trace"),
          messageEntry("assistant-reply", "assistant", "I found the boundary"),
        ]}
      />,
    );

    const transcript = screen.getByLabelText("Transcript");
    expect(transcript.querySelector('[data-message-id="timeline:user-turn"]')).toHaveAttribute("data-scroll-anchor", "true");
    expect(transcript.querySelector('[data-message-id="timeline:assistant-reply"]')).toHaveAttribute("data-scroll-anchor", "false");
  });

  it("renders a compact semantic navigation rail for long transcripts", () => {
    render(
      <Transcript
        entries={[
          messageEntry("user-1", "user", "Investigate the trace"),
          {
            id: "timeline:event:tool-started",
            type: "event",
            eventKind: "tool_call_started",
            createdAt: new Date().toISOString(),
            title: "Using read",
            summary: "Execution in progress",
            tone: "running",
            details: { toolCallId: "call_read_1", toolCallScopeId: "turn-1:response:1" },
          },
          {
            id: "timeline:event:tool-failed",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Failed shell",
            summary: "Command failed",
            tone: "error",
            details: { toolCallId: "call_shell_1", status: "failed" },
          },
          messageEntry("assistant-1", "assistant", "The shell command failed."),
        ]}
      />,
    );

    const rail = screen.getByRole("navigation", { name: "Thread navigation" });
    expect(rail).toHaveAttribute("data-role", "thread-navigation-trail");
    const userAnchor = within(rail).getByRole("button", { name: "Jump to user turn 1" });
    const toolAnchor = within(rail).getByRole("button", { name: "Jump to tool execution 2" });
    const failureAnchor = within(rail).getByRole("button", { name: "Jump to tool failure 3" });
    const assistantAnchor = within(rail).getByRole("button", { name: "Jump to assistant reply 4" });
    expect(userAnchor).toHaveAttribute("data-thread-anchor-kind", "user");
    expect(toolAnchor).toHaveAttribute("data-thread-anchor-kind", "tool");
    expect(within(rail).getByRole("button", { name: "Jump to tool failure 3" })).toHaveAttribute("data-thread-anchor-kind", "failure");
    expect(within(rail).queryByRole("button", { name: "Return to latest thread anchor" })).not.toBeInTheDocument();
    expect(within(rail).getByText("Investigate the trace").closest('[data-role="thread-anchor-preview"]')).toBeInTheDocument();
    expect(within(rail).getAllByRole("button").filter((button) => button.getAttribute("aria-current") === "location")).toHaveLength(1);
    expect(assistantAnchor).toHaveAttribute("aria-current", "location");

    fireEvent.mouseEnter(toolAnchor);
    expect(rail).toHaveAttribute("data-expanded", "true");
    expect(toolAnchor).toHaveAttribute("data-selected", "true");
    expect(toolAnchor).toHaveAttribute("data-proximity", "0");
    expect(userAnchor).toHaveAttribute("data-proximity", "1");
    expect(failureAnchor).toHaveAttribute("data-proximity", "1");
    expect(assistantAnchor).toHaveAttribute("data-proximity", "2");

    fireEvent.mouseLeave(failureAnchor);
    expect(rail).toHaveAttribute("data-expanded", "false");

    fireEvent.click(failureAnchor);
  });

  it("labels the scroll control when live activity may be arriving out of view", () => {
    render(
      <Transcript
        entries={[messageEntry("1", "assistant", "streaming offscreen", true)]}
      />,
    );

    expect(screen.getByRole("button", { name: "Live response below" })).toHaveAttribute("data-direction", "end");
  });

  it("renders typed event metadata and approval actions inline", () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();

    render(
      <Transcript
        onApprove={onApprove}
        onDeny={onDeny}
        entries={[
          {
            id: "timeline:event:tool-result",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed write",
            summary: "Wrote demo.txt",
            tone: "success",
            details: {
              input: { path: "demo.txt", mode: "overwrite" },
              result: "Wrote demo.txt",
              status: "succeeded",
            },
          },
          {
            id: "timeline:event:approval",
            type: "event",
            eventKind: "approval_requested",
            createdAt: new Date().toISOString(),
            title: "Approval requested",
            summary: "Write demo.txt",
            tone: "warning",
            sessionId: "session-1",
            details: {
              approvalId: "approval-1",
              action: "Write demo.txt",
              justification: "Workspace mutation",
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /Show details$/u })[0]!);
    expect(screen.getByText("path")).toBeInTheDocument();
    expect(screen.getByText("demo.txt")).toBeInTheDocument();
    expect(screen.queryByText(/"input"/)).not.toBeInTheDocument();
    expect(screen.queryByText("{")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Show details$/u })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));

    expect(screen.getAllByText("Workspace mutation")).toHaveLength(2);
    expect(onApprove).toHaveBeenCalledWith("approval-1");
    expect(onDeny).toHaveBeenCalledWith("approval-1");
  });
});
