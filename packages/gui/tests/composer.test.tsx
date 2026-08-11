import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "../src/components/composer.js";
import { useUiStore } from "../src/lib/ui-store.js";

function renderComposer(overrides?: Partial<ComponentProps<typeof Composer>>) {
  const onSubmit = vi.fn(() => true);
  const onTogglePlanMode = vi.fn();
  const onGovernedWorkItemCountChange = vi.fn();
  const onCancel = vi.fn();
  const onCommandMenuOpenChange = vi.fn();
  const onCommandMenuExecute = vi.fn();
  const onCommandMenuQueryChange = vi.fn();
  const props: ComponentProps<typeof Composer> = {
    status: "ready",
    planMode: false,
    governedWorkItemCount: null,
    continuityHint: {
      label: "New session",
      description: "Next message starts fresh",
      tone: "muted",
      prominence: "routine",
    },
    providerControl: <button type="button">Claude Sonnet 4</button>,
    deliberationControl: <select aria-label="Deliberation level" defaultValue="medium"><option value="medium">Medium</option></select>,
    authorityControl: <select aria-label="Turn authority" defaultValue="auto"><option value="auto">Auto</option></select>,
    commandMenu: {
      open: false,
      query: "",
      commands: [
        {
          id: "new-session",
          trigger: "new session",
          title: "New Session",
        },
      ],
      onQueryChange: onCommandMenuQueryChange,
      onExecute: onCommandMenuExecute,
      onOpenChange: onCommandMenuOpenChange,
    },
    onSubmit,
    onTogglePlanMode,
    onGovernedWorkItemCountChange,
    onCancel,
    ...overrides,
  };
  const result = render(
    <Composer
      {...props}
    />,
  );
  return {
    onSubmit,
    onTogglePlanMode,
    onGovernedWorkItemCountChange,
    onCancel,
    onCommandMenuOpenChange,
    onCommandMenuExecute,
    onCommandMenuQueryChange,
    unmount: result.unmount,
    rerenderComposer(next: Partial<ComponentProps<typeof Composer>>) {
      result.rerender(<Composer {...props} {...next} />);
    },
  };
}

function openAttachmentMenu(): void {
  fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
}

describe("Composer", () => {
  beforeEach(() => {
    useUiStore.getState().setTheme("kiln-dark");
  });

  it("renders one visible semantic thinking signal beside the active beam", () => {
    renderComposer({
      status: "running",
      activityPhase: "thinking",
      activityDetails: "Preparing the response",
    });

    expect(screen.getByRole("status", { name: "Activity phase: Thinking · Preparing the response" })).toBeInTheDocument();
    expect(screen.getByText("Thinking")).toBeVisible();
    expect(document.querySelector('[data-role="composer-activity"]')).toHaveAttribute("data-orb-state", "solving");
    expect(document.querySelector('[data-role="activity-orb"]')).toHaveAttribute("data-orb-state", "solving");
    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveAttribute("data-state", "thinking");
    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveAttribute("data-active");
    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveAttribute("data-beam-motion", "pulse");
    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveAttribute("data-beam-treatment", "contained");
    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveAttribute("data-beam-size", "pulse-inner");
    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveAttribute("data-beam-palette", "mono");
    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveAttribute("data-beam-static", "true");
    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveAttribute("data-beam-theme", "dark");
  });

  it("keeps the foreground goal beside the composer with accessible progress and controls", async () => {
    const onGoalControl = vi.fn(() => true);
    renderComposer({
      foregroundGoal: {
        goal: {
          id: "goal-1",
          objective: "Repair the governed runtime lifecycle.",
          status: "active",
          activeDurationMs: 65_000,
          activeSince: new Date().toISOString(),
          workItemIds: ["work-1"],
          evidenceRequirements: [],
          evidence: [],
        },
        status: "in_progress",
        workItems: [{
          item: {
            id: "work-1",
            summary: "Verify canonical session events.",
            status: "in_progress",
            evidence: [],
            nextTools: [],
            pauseRequirements: [],
          },
          attempts: [],
          toolCalls: [],
          firstSequence: 1,
          lastSequence: 1,
        }],
        toolCalls: [],
        fileChanges: [],
        firstSequence: 1,
        lastSequence: 1,
      },
      goalControlFailure: {
        goalRunId: "goal-1",
        message: "Goal is already paused.",
      },
      onGoalControl,
    });

    expect(screen.getByText("Goal in progress")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Goal is already paused.");
    fireEvent.click(screen.getByRole("button", { name: /open goal progress/i }));
    const workItem = await screen.findByLabelText("Verify canonical session events. In progress");
    expect(workItem).toHaveAttribute("data-slot", "ai-task-item");
    expect(workItem).toHaveAttribute("data-status", "in_progress");

    fireEvent.click(screen.getByRole("button", { name: "Pause goal" }));
    expect(onGoalControl).toHaveBeenCalledWith({ goalRunId: "goal-1", action: "pause" });

    fireEvent.click(screen.getByRole("button", { name: "Edit goal objective" }));
    const objective = await screen.findByRole("textbox", { name: "Goal objective" });
    fireEvent.change(objective, { target: { value: "Revised lifecycle objective." } });
    fireEvent.click(screen.getByRole("button", { name: "Save objective" }));
    expect(onGoalControl).toHaveBeenCalledWith({
      goalRunId: "goal-1",
      action: "update_objective",
      objective: "Revised lifecycle objective.",
    });
  });

  it("uses the active Kiln light theme instead of the operating-system preference", () => {
    useUiStore.getState().setTheme("kiln-light");

    renderComposer({ status: "running", activityPhase: "thinking" });

    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveAttribute("data-beam-theme", "light");
  });

  it("names the active tool with the generic working orb instead of inferring a tool-specific animation", () => {
    renderComposer({
      status: "running",
      activityPhase: "tool_running",
      activityToolName: "read_many",
    });

    expect(screen.getByRole("status", { name: "Activity phase: Using read_many" })).toBeInTheDocument();
    expect(screen.getByText("Using read_many")).toBeVisible();
    expect(document.querySelector('[data-role="composer-activity"]')).toHaveAttribute("data-orb-state", "working");
  });

  it("keeps the composer beam active until response streaming finishes", () => {
    renderComposer({ status: "running", activityPhase: "streaming" });

    expect(screen.getByRole("status", { name: "Activity phase: Responding" })).toBeInTheDocument();
    expect(document.querySelector('[data-role="composer-activity"]')).toHaveAttribute("data-orb-state", "composing");
    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveAttribute("data-state", "streaming");
    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveAttribute("data-active");
    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveStyle({ "--beam-strength": "0.2" });
  });

  it("uses the outward bloom only while the completed response fades out", () => {
    const { rerenderComposer } = renderComposer({ status: "running", activityPhase: "streaming" });

    rerenderComposer({ status: "ready", activityPhase: "idle" });

    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveAttribute("data-beam-treatment", "completion");
    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveAttribute("data-beam-size", "pulse-outside");
    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveAttribute("data-beam-palette", "sunset");
    expect(document.querySelector('[data-role="composer-activity-beam"]')).not.toHaveAttribute("data-active");
    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveAttribute("data-fading");
  });

  it("does not present an error transition as a completion bloom", () => {
    const { rerenderComposer } = renderComposer({ status: "running", activityPhase: "streaming" });

    rerenderComposer({ status: "error", activityPhase: "idle" });

    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveAttribute("data-beam-treatment", "off");
    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveAttribute("data-beam-size", "pulse-inner");
  });

  it("does not flash the beam off between tool activity phases", () => {
    renderComposer({ status: "running", activityPhase: "idle" });

    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveAttribute("data-state", "idle");
    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveAttribute("data-active");
  });

  it("pauses aggregate motion while operator approval is required", () => {
    renderComposer({ status: "running", activityPhase: "awaiting_approval" });

    expect(document.querySelector('[data-role="composer-activity-beam"]')).not.toHaveAttribute("data-active");
    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveAttribute("data-beam-treatment", "paused");
    expect(screen.getByRole("status", { name: "Activity phase: Awaiting approval" })).toBeInTheDocument();
    expect(document.querySelector('[data-role="composer-activity"]')).toHaveAttribute("data-orb-paused", "true");
  });

  it("keeps the composer beam inactive and omits live status while idle", () => {
    renderComposer({ activityPhase: "idle" });

    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveAttribute("data-state", "idle");
    expect(document.querySelector('[data-role="composer-activity-beam"]')).not.toHaveAttribute("data-active");
    expect(document.querySelector('[data-role="composer-activity-beam"]')).toHaveAttribute("data-beam-treatment", "off");
    expect(screen.queryByRole("status", { name: /Activity phase:/ })).not.toBeInTheDocument();
  });

  it("aligns the composer with the transcript axis", () => {
    renderComposer();

    const form = screen.getByLabelText("Message").closest("form");
    expect(form).toHaveClass("mx-auto", "w-full", "max-w-3xl");
    expect(form).not.toHaveClass("max-w-4xl");
  });

  it("Enter while idle triggers submit", () => {
    const { onSubmit } = renderComposer();
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter", shiftKey: false });
    expect(onSubmit).toHaveBeenCalledWith({ text: "hello" });
  });

  it("Enter while running is a no-op", () => {
    const { onSubmit } = renderComposer({ status: "running" });
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter", shiftKey: false });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Shift+Enter inserts newline and does not submit", () => {
    const { onSubmit } = renderComposer();
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "line1" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Enter with empty draft does not submit", () => {
    const { onSubmit } = renderComposer();
    const textarea = screen.getByLabelText("Message");
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter", shiftKey: false });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Slash on empty draft opens the local command menu", () => {
    const { onCommandMenuOpenChange } = renderComposer();
    const textarea = screen.getByLabelText("Message");
    fireEvent.keyDown(textarea, { key: "/", code: "Slash" });
    expect(onCommandMenuOpenChange).toHaveBeenCalledWith(true);
  });

  it("Slash inserted through input change opens the local command menu", () => {
    const { onCommandMenuOpenChange } = renderComposer();
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "/" } });
    expect(onCommandMenuOpenChange).toHaveBeenCalledWith(true);
    expect(textarea.value).toBe("");
  });

  it("renders the local command menu above the composer when open", () => {
    renderComposer({
      commandMenu: {
        open: true,
        query: "",
        commands: [
          {
            id: "provider",
            trigger: "provider",
            title: "Provider",
            description: "Open the provider and model picker.",
          },
        ],
        onQueryChange: vi.fn(),
        onExecute: vi.fn(),
        onOpenChange: vi.fn(),
      },
    });

    const menu = screen.getByRole("dialog", { name: "Composer commands" });
    expect(menu).toHaveAttribute("aria-modal", "false");
    expect(within(menu).getByText("Provider")).toBeInTheDocument();
  });

  it("executes the selected composer command with cmdk keyboard navigation", () => {
    const onExecute = vi.fn();
    renderComposer({
      commandMenu: {
        open: true,
        query: "",
        commands: [
          { id: "first", trigger: "first", title: "First" },
          { id: "second", trigger: "second", title: "Second" },
        ],
        onQueryChange: vi.fn(),
        onExecute,
        onOpenChange: vi.fn(),
      },
    });
    const input = screen.getByPlaceholderText("Filter commands");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onExecute).toHaveBeenCalledWith(expect.objectContaining({ id: "second" }));
  });

  it("does not execute a command when Close is activated with Enter", () => {
    const onExecute = vi.fn();
    const onOpenChange = vi.fn();
    renderComposer({
      commandMenu: {
        open: true,
        query: "",
        commands: [{ id: "provider", trigger: "provider", title: "Provider" }],
        onQueryChange: vi.fn(),
        onExecute,
        onOpenChange,
      },
    });
    const close = screen.getByRole("button", { name: "Close" });
    close.focus();
    fireEvent.keyDown(close, { key: "Enter" });
    fireEvent.click(close);

    expect(onExecute).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("returns focus to the message input when Escape closes composer commands", () => {
    const onOpenChange = vi.fn();
    renderComposer({
      commandMenu: {
        open: true,
        query: "",
        commands: [{ id: "provider", trigger: "provider", title: "Provider" }],
        onQueryChange: vi.fn(),
        onExecute: vi.fn(),
        onOpenChange,
      },
    });
    const filter = screen.getByPlaceholderText("Filter commands");
    expect(filter).toHaveFocus();
    fireEvent.keyDown(filter, { key: "Escape" });

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByLabelText("Message")).toHaveFocus();
  });

  it("does not render a redundant command button", () => {
    renderComposer();

    expect(screen.queryByRole("button", { name: "Open command palette" })).not.toBeInTheDocument();
    expect(screen.queryByText("/command")).not.toBeInTheDocument();
  });

  it.each([
    ["New session", "Next message starts fresh", "muted"],
    ["Continue chat", "Next message continues selected session", "accent"],
    ["Live", "Next message continues current session", "info"],
  ] as const)("hides routine continuity state %s", (label, description, tone) => {
    renderComposer({ continuityHint: { label, description, tone, prominence: "routine" } });

    expect(screen.queryByRole("status", { name: "Session continuity" })).not.toBeInTheDocument();
  });

  it.each([
    ["Detached", "Run continues in background", "warning"],
  ] as const)("shows exceptional continuity state %s", (label, description, tone) => {
    renderComposer({ continuityHint: { label, description, tone, prominence: "exceptional" } });

    const status = screen.getByRole("status", { name: "Session continuity" });
    expect(status).toHaveTextContent(label);
    expect(status).toHaveAccessibleDescription(description);
    expect(status).toHaveAttribute("data-slot", "marker");
    expect(status).toHaveAttribute("data-tone", tone);
  });

  it("hides routine running continuity while activity is already announced", () => {
    renderComposer({
      status: "running",
      activityPhase: "thinking",
      continuityHint: {
        label: "Running",
        description: "Waiting for current turn",
        tone: "info",
        prominence: "routine",
      },
    });

    expect(screen.queryByRole("status", { name: "Session continuity" })).not.toBeInTheDocument();
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
  });

  it("keeps authority and provider visible while disclosing tuning controls", async () => {
    renderComposer();

    const options = screen.getByRole("group", { name: "Message options" });
    expect(within(options).getByRole("button", { name: "Claude Sonnet 4" })).toBeInTheDocument();
    expect(within(options).getByLabelText(/Turn authority/)).toBeInTheDocument();
    expect(within(options).queryByLabelText("Deliberation level")).not.toBeInTheDocument();
    fireEvent.click(within(options).getByRole("button", { name: "Turn settings: Build" }));
    expect(await screen.findByLabelText("Deliberation level")).toBeInTheDocument();
  });

  it("configures a typed governed goal requirement from the composer", async () => {
    const { onGovernedWorkItemCountChange } = renderComposer();

    fireEvent.click(screen.getByRole("button", { name: "Turn settings: Build" }));
    expect(await screen.findByRole("heading", { name: "Turn settings" })).toBeVisible();
    expect(screen.getByLabelText("Exact work items")).toHaveValue(3);

    fireEvent.click(screen.getByRole("button", { name: "Require goal setup" }));
    expect(onGovernedWorkItemCountChange).toHaveBeenCalledWith(3);
  });

  it("exposes and removes an active governed requirement without color-only state", async () => {
    const onGovernedWorkItemCountChange = vi.fn();
    renderComposer({ governedWorkItemCount: 4, onGovernedWorkItemCountChange });

    const trigger = screen.getByRole("button", { name: "Turn settings: Build; governed goal with 4 work items" });
    expect(trigger).toHaveTextContent("Goal 4");

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "Remove goal setup" }));
    expect(onGovernedWorkItemCountChange).toHaveBeenCalledWith(null);
  });

  it("labels authoritative, partial, and restored context evidence without color-only state", () => {
    const { rerender } = render(
      <Composer
        status="ready"
        planMode={false}
        governedWorkItemCount={null}
        continuityHint={{ label: "New session", description: "Next message starts fresh", tone: "muted", prominence: "routine" }}
        contextUsage={{
          state: "authoritative",
          usedTokens: 2400,
          contextWindowTokens: 8000,
          remainingTokens: 5600,
          usedPercentage: 30,
          providerId: "openai",
          modelId: "gpt-5",
          observedAt: "2026-07-13T00:00:00.000Z",
          measurement: "provider_reported",
          lifecycle: "completed",
          contextWindowAuthority: "provider_reported",
          freshness: "fresh",
        }}
        commandMenu={{ open: false, query: "", commands: [], onQueryChange: vi.fn(), onExecute: vi.fn(), onOpenChange: vi.fn() }}
        leadingActions={null}
        trailingActions={null}
        onSubmit={() => undefined}
        onTogglePlanMode={() => undefined}
        onGovernedWorkItemCountChange={() => undefined}
      onCancel={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Context 30%: 2.4k / 8k tokens" })).not.toHaveTextContent("30%");

    rerender(
      <Composer
        status="ready"
        planMode={false}
        governedWorkItemCount={null}
        continuityHint={{ label: "New session", description: "Next message starts fresh", tone: "muted", prominence: "routine" }}
        contextUsage={{
          state: "partial",
          usedTokens: 2400,
          providerId: "openai",
          modelId: "gpt-5",
          observedAt: "2026-07-13T00:00:00.000Z",
          measurement: "runtime_estimate",
          lifecycle: "restored",
          contextWindowAuthority: "unknown",
          freshness: "historical",
          reason: "No compatible context window was persisted.",
        }}
        commandMenu={{ open: false, query: "", commands: [], onQueryChange: vi.fn(), onExecute: vi.fn(), onOpenChange: vi.fn() }}
        leadingActions={null}
        trailingActions={null}
        onSubmit={() => undefined}
        onTogglePlanMode={() => undefined}
        onGovernedWorkItemCountChange={() => undefined}
        onCancel={() => undefined}
      />,
    );
    const restored = screen.getByRole("button", { name: "Context partial: 2.4k tokens; restored historical measurement" });
    expect(restored).not.toHaveTextContent("2.4k");
    fireEvent.click(restored);
    return waitFor(() => {
      expect(screen.getByText("Context window")).toBeVisible();
      expect(screen.getByText("Runtime estimate")).toBeVisible();
      expect(screen.getByText("Historical")).toBeVisible();
    });
  });

  it("keeps all composer actions inside the compact input surface", () => {
    renderComposer();

    const textarea = screen.getByLabelText("Message");
    const inputSurface = textarea.parentElement;

    expect(inputSurface).not.toBeNull();
    const options = within(inputSurface as HTMLElement).getByRole("group", { name: "Message options" });
    expect(options).toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).getByRole("button", { name: "Add attachment" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attach audio file" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attach image" })).not.toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).getByRole("button", { name: "Turn settings: Build" })).toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).queryByRole("button", { name: "Plan" })).not.toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).queryByRole("button", { name: "Configure governed task" })).not.toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).getByLabelText(/Turn authority/)).toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).queryByRole("button", { name: "Context usage unavailable" })).not.toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).getByRole("button", { name: "Claude Sonnet 4" })).toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).queryByLabelText("Deliberation level")).not.toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).getByRole("button", { name: "Record voice" })).toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).getByRole("button", { name: "Send message" })).toBeInTheDocument();
  });

  it("keeps inactive composer controls visibly actionable before typing", () => {
    renderComposer();

    expect(screen.getByRole("button", { name: "Add attachment" })).toHaveClass("border-transparent");
    expect(screen.getByRole("button", { name: "Add attachment" })).not.toHaveTextContent("Add");
    expect(screen.getByRole("button", { name: "Turn settings: Build" })).toHaveClass("h-8", "items-center", "justify-center");
    expect(screen.getByRole("button", { name: "Record voice" })).toHaveClass("border-transparent");
    expect(screen.queryByRole("button", { name: "Context usage unavailable" })).not.toBeInTheDocument();
  });

  it("orders the composer rail like a modern chat harness", () => {
    renderComposer();

    const options = screen.getByRole("group", { name: "Message options" });
    const orderedControls = [
      within(options).getByRole("button", { name: "Add attachment" }),
      within(options).getByLabelText(/Turn authority/),
      within(options).getByRole("button", { name: "Claude Sonnet 4" }),
      within(options).getByRole("button", { name: "Turn settings: Build" }),
      within(options).getByRole("button", { name: "Record voice" }),
      within(options).getByRole("button", { name: "Send message" }),
    ];

    for (let index = 0; index < orderedControls.length - 1; index += 1) {
      expect(orderedControls[index]!.compareDocumentPosition(orderedControls[index + 1]!) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBeTruthy();
    }
  });

  it("toggles plan mode without changing the draft", async () => {
    const { onTogglePlanMode, onSubmit } = renderComposer();
    const textarea = screen.getByLabelText("Message");

    fireEvent.change(textarea, { target: { value: "Inspect this change" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn settings: Build" }));
    fireEvent.click(await screen.findByRole("button", { name: "Plan for approval" }));

    expect(onTogglePlanMode).toHaveBeenCalledWith(true);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("Inspect this change");
  });

  it("keeps governed goal setup subordinate to Build mode", async () => {
    const { onTogglePlanMode } = renderComposer({ planMode: true });

    fireEvent.click(screen.getByRole("button", { name: "Turn settings: Plan" }));
    expect(await screen.findByRole("button", { name: "Plan for approval" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("Exact work items")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Build" }));
    expect(onTogglePlanMode).toHaveBeenCalledWith(false);
  });

  it("uses a restrained focus treatment on the input surface", () => {
    renderComposer();

    const textarea = screen.getByLabelText("Message");
    const inputSurface = textarea.parentElement;

    expect(inputSurface).toHaveClass("focus-within:border-ring/70");
    expect(inputSurface).not.toHaveClass("focus-within:ring-3");
  });

  it("keeps the composer surface legible when an individual action is disabled", () => {
    renderComposer();

    const inputSurface = screen.getByLabelText("Message").parentElement;
    const sendButton = screen.getByRole("button", { name: "Send message" });

    expect(sendButton).toBeDisabled();
    expect(sendButton).toHaveClass("disabled:opacity-50");
    expect(inputSurface).not.toHaveClass("has-disabled:opacity-50", "has-disabled:bg-input/50");
  });

  it("uses one boundary without redundant surface elevation", () => {
    renderComposer();

    const textarea = screen.getByLabelText("Message");
    const inputSurface = textarea.parentElement;

    expect(inputSurface).toHaveClass("border-border");
    expect(inputSurface?.className).not.toContain("shadow-");
  });

  it("uses a compact shadcn input surface with room for multi-line work", () => {
    renderComposer();

    const textarea = screen.getByLabelText("Message");
    const inputSurface = textarea.parentElement;

    expect(inputSurface).toHaveAttribute("data-slot", "input-group");
    expect(inputSurface).toHaveAttribute("data-composer-surface", "message");
    expect(inputSurface).toHaveClass("overflow-hidden", "rounded-xl", "bg-workspace-viewer-panel");
    expect(inputSurface).not.toHaveClass("bg-card");
    expect(inputSurface).not.toHaveClass("min-h-32");
    expect(textarea).toHaveClass("max-h-44", "px-3", "text-sm");
    expect(textarea).not.toHaveClass("min-h-20", "py-3");
  });

  it("does not render a separate technical control rail", () => {
    renderComposer();

    const options = screen.getByRole("group", { name: "Message options" });
    expect(options).not.toHaveClass("border-t", "bg-background/65");
    expect(options.firstElementChild).toHaveClass("flex", "flex-wrap");
    expect(options.querySelector('[data-role="composer-leading-actions"]')).toHaveClass("shrink-0");
    expect(options.querySelector('[data-role="composer-secondary-controls"]')).not.toHaveClass("overflow-x-auto");
  });

  it("uses a plain dock without a redundant boundary or decorative transcript fade", () => {
    renderComposer();

    const section = screen.getByRole("textbox", { name: "Message" }).closest("section");

    expect(section).toHaveClass("relative", "z-10", "bg-transparent");
    expect(section).not.toHaveClass("bg-background");
    expect(section).not.toHaveClass("border-t", "border-border/60");
    expect(section?.className).not.toContain("before:bg-gradient");
    expect(section?.className).not.toContain("backdrop-filter");
  });

  it("renders send as an icon button with an accessible label", () => {
    renderComposer();

    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
  });

  it("records voice input and prepares canonical audio parts", async () => {
    const stopTrack = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    const activeRecorders: MockMediaRecorder[] = [];

    class MockMediaRecorder {
      static isTypeSupported(mimeType: string): boolean {
        return mimeType === "audio/webm;codecs=opus";
      }

      state = "inactive";
      mimeType = "audio/webm;codecs=opus";
      ondataavailable: ((event: { readonly data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;

      constructor() {
        activeRecorders.push(this);
      }

      start(): void {
        this.state = "recording";
      }

      stop(): void {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["abc"], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);

    const { onSubmit } = renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "Record voice" }));

    await waitFor(() => expect(activeRecorders).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Stop voice recording" }));

    await waitFor(() => expect(screen.getByText("Voice recording")).toBeVisible());
    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ text: "", parts: [
        {
          type: "audio",
          mimeType: "audio/webm;codecs=opus",
          data: "YWJj",
          durationMs: expect.any(Number),
        },
      ], displayContent: expect.stringMatching(/^Voice input/) });
    });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stopTrack).toHaveBeenCalled();
  });

  it("reports microphone permission failure without losing the draft", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => true });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    renderComposer();
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "Keep this draft" } });

    fireEvent.click(screen.getByRole("button", { name: "Record voice" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Microphone access failed");
    expect(textarea).toHaveValue("Keep this draft");
  });

  it("stops microphone tracks without preparing a turn when unmounted", async () => {
    const stopTrack = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) },
    });
    const recorders: CleanupMediaRecorder[] = [];
    class CleanupMediaRecorder {
      static isTypeSupported(): boolean { return true; }
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: { readonly data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor() { recorders.push(this); }
      start(): void { this.state = "recording"; }
      stop(): void { this.state = "inactive"; this.onstop?.(); }
    }
    vi.stubGlobal("MediaRecorder", CleanupMediaRecorder);
    const { onSubmit, unmount } = renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "Record voice" }));
    await waitFor(() => expect(recorders).toHaveLength(1));

    unmount();

    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not start concurrent microphone permission requests", () => {
    const getUserMedia = vi.fn(() => new Promise(() => undefined));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => true });
    renderComposer();
    const record = screen.getByRole("button", { name: "Record voice" });

    fireEvent.click(record);
    fireEvent.click(record);

    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("stops a microphone stream resolved after unmount", async () => {
    let resolveStream: ((stream: { getTracks: () => Array<{ stop: () => void }> }) => void) | undefined;
    const stopTrack = vi.fn();
    const getUserMedia = vi.fn(() => new Promise<{ getTracks: () => Array<{ stop: () => void }> }>((resolve) => {
      resolveStream = resolve;
    }));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });
    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => true });
    const { unmount } = renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "Record voice" }));

    unmount();
    resolveStream?.({ getTracks: () => [{ stop: stopTrack }] });

    await waitFor(() => expect(stopTrack).toHaveBeenCalledOnce());
  });

  it("stops and discards a live recording when captured chunks exceed 10 MB", async () => {
    const stopTrack = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) },
    });
    const recorders: BudgetMediaRecorder[] = [];
    class BudgetMediaRecorder {
      static isTypeSupported(): boolean { return true; }
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: { readonly data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor() { recorders.push(this); }
      start(): void { this.state = "recording"; }
      stop(): void { this.state = "inactive"; this.onstop?.(); }
    }
    vi.stubGlobal("MediaRecorder", BudgetMediaRecorder);
    const { onSubmit } = renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "Record voice" }));
    await waitFor(() => expect(recorders).toHaveLength(1));
    const oversizedChunk = new Blob(["fixture"], { type: "audio/webm" });
    Object.defineProperty(oversizedChunk, "size", { value: 10 * 1024 * 1024 + 1 });

    act(() => recorders[0]?.ondataavailable?.({ data: oversizedChunk }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Voice recordings are limited to 10 MB");
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(screen.queryByText("Voice recording")).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("prepares an audio file and submits it only with the turn", async () => {
    const { onSubmit } = renderComposer();
    const file = new File(["abc"], "voice.webm", { type: "audio/webm" });

    openAttachmentMenu();
    fireEvent.click(screen.getByRole("button", { name: "Attach audio file" }));
    fireEvent.change(screen.getByLabelText("Audio file input"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(screen.getByText("voice.webm")).toBeVisible());
    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ text: "", parts: [
        {
          type: "audio",
          mimeType: "audio/webm",
          data: "YWJj",
        },
      ], displayContent: "Voice input" });
    });
  });

  it("replaces send with an accessible stop action while a turn is active", () => {
    const { onCancel } = renderComposer({ status: "running" });

    fireEvent.click(screen.getByRole("button", { name: "Stop response" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Send message" })).not.toBeInTheDocument();
  });

  it("disables the stop action while cancellation is pending", () => {
    renderComposer({ status: "running", cancelPending: true });

    expect(screen.getByRole("button", { name: "Cancelling response" })).toBeDisabled();
  });

  it("prepares an image and submits text and parts atomically", async () => {
    const { onSubmit } = renderComposer();
    const file = new File(["abc"], "queja.png", { type: "image/png" });

    openAttachmentMenu();
    fireEvent.click(screen.getByRole("button", { name: "Attach image" }));
    fireEvent.change(screen.getByLabelText("Image file input"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(screen.getByText("queja.png")).toBeVisible());
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Review this" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({ text: "Review this", parts: [
        {
          type: "image",
          mimeType: "image/png",
          data: "YWJj",
        },
      ], displayContent: "Review this\nImage: queja.png" });
    });
  });

  it("prepares pasted image data without losing the draft", async () => {
    const { onSubmit } = renderComposer();
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Keep this" } });
    const file = new File(["abc"], "clipboard.png", { type: "image/png" });
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true }) as Event & {
      clipboardData?: {
        readonly files: readonly File[];
      };
    };
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: { files: [file] },
    });

    fireEvent(textarea, pasteEvent);

    await waitFor(() => expect(screen.getByText("clipboard.png")).toBeVisible());
    expect(textarea).toHaveValue("Keep this");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(pasteEvent.defaultPrevented).toBe(true);
  });

  it("removes a prepared attachment before submitting", async () => {
    const { onSubmit } = renderComposer();
    const file = new File(["abc"], "remove.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Image file input"), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText("remove.png")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: "Remove remove.png" }));

    expect(screen.queryByText("remove.png")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps the prepared turn when the runtime rejects submission", () => {
    const onSubmit = vi.fn(() => false);
    renderComposer({ onSubmit });
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "Retry me" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter" });

    expect(onSubmit).toHaveBeenCalledWith({ text: "Retry me" });
    expect(textarea).toHaveValue("Retry me");
  });

  it("shows an accessible error when an image cannot be prepared", async () => {
    renderComposer();
    const file = new File(["not-an-image"], "broken.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Image file input"), { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not prepare this attachment.");
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  });

  it("blocks text submission until a failed attachment is removed", async () => {
    const { onSubmit } = renderComposer();
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Do not lose the image" } });
    const file = new File(["not-an-image"], "broken.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Image file input"), { target: { files: [file] } });

    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects an oversized attachment before reading it", async () => {
    renderComposer();
    const file = new File(["small fixture"], "huge.png", { type: "image/png" });
    Object.defineProperty(file, "size", { value: 11 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText("Image file input"), { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("10 MB per file");
    expect(screen.queryByText("huge.png")).not.toBeInTheDocument();
  });

  it("accepts the exact per-file limit and rejects a total over 25 MB", async () => {
    renderComposer();
    const exact = new File(["fixture"], "exact.png", { type: "image/png" });
    Object.defineProperty(exact, "size", { value: 10 * 1024 * 1024 });
    fireEvent.change(screen.getByLabelText("Image file input"), { target: { files: [exact] } });
    expect(await screen.findByText("exact.png")).toBeVisible();

    for (const name of ["second.png", "over-total.png"]) {
      const file = new File(["fixture"], name, { type: "image/png" });
      Object.defineProperty(file, "size", { value: 8 * 1024 * 1024 });
      fireEvent.change(screen.getByLabelText("Image file input"), { target: { files: [file] } });
    }

    expect(await screen.findByRole("alert")).toHaveTextContent("25 MB total");
    expect(screen.queryByText("over-total.png")).not.toBeInTheDocument();
  });

  it("limits a turn to eight prepared attachments", async () => {
    renderComposer();
    for (let index = 1; index <= 9; index += 1) {
      const file = new File([String(index)], `image-${index}.png`, { type: "image/png" });
      fireEvent.change(screen.getByLabelText("Image file input"), { target: { files: [file] } });
    }

    expect(await screen.findByRole("alert")).toHaveTextContent("up to 8 files");
    expect(screen.queryByText("image-9.png")).not.toBeInTheDocument();
  });

  it("preserves text from a mixed image clipboard payload", async () => {
    renderComposer();
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Before " } });
    const file = new File(["abc"], "mixed.png", { type: "image/png" });
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true }) as Event & {
      clipboardData?: { readonly files: readonly File[]; getData: (type: string) => string };
    };
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: { files: [file], getData: (type: string) => type === "text/plain" ? "and after" : "" },
    });

    fireEvent(textarea, pasteEvent);

    await waitFor(() => expect(screen.getByText("mixed.png")).toBeVisible());
    expect(textarea).toHaveValue("Before and after");
  });

  it("keeps deliberation in turn settings next to the visible model route", async () => {
    renderComposer();

    expect(screen.getByRole("button", { name: "Claude Sonnet 4" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Deliberation level")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Turn settings: Build" }));
    expect(await screen.findByLabelText("Deliberation level")).toBeInTheDocument();
  });

  it("does not render placeholder-only file or approval chips", () => {
    renderComposer();

    expect(screen.queryByText("@files")).not.toBeInTheDocument();
    expect(screen.queryByText("approvals")).not.toBeInTheDocument();
  });

  it("does not block native paste behavior", () => {
    renderComposer();
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });

    fireEvent(textarea, pasteEvent);

    expect(pasteEvent.defaultPrevented).toBe(false);
  });

  it("non-special editing keys do not trigger command actions", () => {
    const { onSubmit, onCommandMenuOpenChange } = renderComposer();
    const textarea = screen.getByLabelText("Message");

    fireEvent.keyDown(textarea, { key: "Backspace", code: "Backspace" });
    fireEvent.keyDown(textarea, { key: "ArrowLeft", code: "ArrowLeft" });
    fireEvent.keyDown(textarea, { key: "Delete", code: "Delete" });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCommandMenuOpenChange).not.toHaveBeenCalled();
  });

  it("Textarea is configured for wrapped multi-line input", () => {
    renderComposer();
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    expect(textarea.getAttribute("wrap")).toBe("soft");
  });
});
