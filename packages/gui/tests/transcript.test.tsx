import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Transcript } from "../src/components/transcript.js";
import type { Message, TimelineEntry } from "../src/lib/session-store.js";

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

describe("Transcript", () => {
  it("renders user, assistant, tool, and error rows with distinct roles", () => {
    render(
      <Transcript
        entries={[
          messageEntry("1", "user", "hello"),
          messageEntry("2", "assistant", "world"),
          {
            id: "timeline:event:tool",
            type: "event",
            eventKind: "tool_call_started",
            createdAt: new Date().toISOString(),
            title: "Tool started: bash",
            summary: "Execution in progress",
            tone: "running",
          },
          messageEntry("4", "error", "boom"),
        ]}
      />,
    );

    const rows = screen.getAllByRole("article");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveAttribute("data-role", "user");
    expect(rows[1]).toHaveAttribute("data-role", "assistant");
    expect(rows[2]).toHaveTextContent("Tool started: bash");
    expect(rows[3]).toHaveAttribute("data-role", "error");
  });

  it("shows streaming cursor indicator for streaming assistant message", () => {
    render(
      <Transcript
        entries={[
          messageEntry("1", "assistant", "streaming...", true),
        ]}
      />,
    );
    expect(screen.getByLabelText("Streaming")).toBeInTheDocument();
  });

  it("renders assistant messages in a lightweight chat bubble", () => {
    render(
      <Transcript
        entries={[messageEntry("1", "assistant", "Here is the update.")]}
      />,
    );

    const assistantRow = screen.getByRole("article");
    expect(assistantRow).toHaveAttribute("data-role", "assistant");
    expect(assistantRow.firstElementChild).toHaveClass("rounded-lg", "border", "bg-card");
  });

  it("shows assistant thinking state in the transcript instead of the composer", () => {
    render(
      <Transcript
        entries={[messageEntry("1", "user", "build this")]}
        activityPhase="thinking"
      />,
    );

    expect(screen.getByRole("status", { name: "Activity phase: Thinking" })).toBeInTheDocument();
    expect(screen.getAllByRole("article").at(-1)).toHaveAttribute("data-role", "assistant");
  });

  it("does not duplicate the responding state when an assistant message is already streaming", () => {
    render(
      <Transcript
        entries={[messageEntry("1", "assistant", "working", true)]}
        activityPhase="streaming"
      />,
    );

    expect(screen.getByLabelText("Streaming")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Activity phase: Responding" })).not.toBeInTheDocument();
  });

  it("sticks to bottom unless user scrolled up", () => {
    const firstMessages = [
      messageEntry("1", "assistant", "first"),
      messageEntry("2", "assistant", "second"),
    ];

    const { rerender } = render(<Transcript entries={firstMessages} />);
    const container = screen.getByLabelText("Transcript");

    Object.defineProperty(container, "clientHeight", { configurable: true, value: 100 });
    Object.defineProperty(container, "scrollHeight", { configurable: true, value: 200, writable: true });
    Object.defineProperty(container, "scrollTop", { configurable: true, value: 100, writable: true });

    fireEvent.scroll(container);

    rerender(
      <Transcript
        entries={[...firstMessages, messageEntry("3", "assistant", "third")]}
      />,
    );

    expect((container as HTMLDivElement).scrollTop).toBe(200);

    (container as HTMLDivElement).scrollTop = 0;
    fireEvent.scroll(container);

    Object.defineProperty(container, "scrollHeight", { configurable: true, value: 300, writable: true });

    rerender(
      <Transcript
        entries={[...firstMessages, messageEntry("3", "assistant", "third"), messageEntry("4", "assistant", "fourth")]}
      />,
    );

    expect((container as HTMLDivElement).scrollTop).toBe(0);
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
            title: "Tool completed: write",
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

    fireEvent.click(screen.getAllByRole("button", { name: "Show details" })[0]!);
    expect(screen.getByText("path")).toBeInTheDocument();
    expect(screen.getByText("demo.txt")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Show details" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));

    expect(screen.getByText("Workspace mutation")).toBeInTheDocument();
    expect(onApprove).toHaveBeenCalledWith("session-1");
    expect(onDeny).toHaveBeenCalledWith("session-1");
  });
});
