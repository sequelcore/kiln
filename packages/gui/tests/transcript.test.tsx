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
  it("renders a minimal empty state without an instructional card", () => {
    vi.spyOn(Date, "now").mockReturnValue(0);

    render(<Transcript entries={[]} />);

    expect(screen.getByText("Job's live. Run it clean.")).toBeInTheDocument();
    expect(screen.getByText("Kiln")).toBeInTheDocument();
    expect(screen.queryByText("Start a conversation to see the transcript.")).not.toBeInTheDocument();
  });

  it("selects a different empty phrase on a fresh empty mount", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(0);
    try {
      const { unmount } = render(<Transcript entries={[]} />);
      expect(screen.getByText("Job's live. Run it clean.")).toBeInTheDocument();

      unmount();
      nowSpy.mockReturnValue(1);
      render(<Transcript entries={[]} />);

      expect(screen.getByText("Signal's hot. Take control.")).toBeInTheDocument();
    } finally {
      nowSpy.mockRestore();
    }
  });

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
            title: "Using bash",
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
    expect(rows[2]).toHaveAttribute("data-role", "tool");
    expect(rows[2]).toHaveTextContent("Using bash");
    expect(rows[2]).not.toHaveClass("rounded-lg");
    expect(rows[3]).toHaveAttribute("data-role", "error");
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

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));

    expect(screen.getByText("Diff preview")).toBeInTheDocument();
    expect(screen.getByText("packages/gui/src/components/transcript.tsx")).toBeInTheDocument();
    expect(screen.getByText("Additions")).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
    expect(screen.getByText("+ typed preview")).toBeInTheDocument();
    expect(screen.getByText("Open inspector")).toBeInTheDocument();
    expect(screen.queryByText(/"metadata"/)).not.toBeInTheDocument();
  });

  it("renders resource-linked tool presentations with an inspector action", () => {
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
                output: "--- C:\\Proyectos\\Sequel\\kiln\\docs\\architecture.md",
                isError: false,
                metadata: { toolName: "read_many" },
              }),
              status: "succeeded",
            },
            toolPresentation: {
              outputKind: "resource_links",
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

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));

    expect(screen.getByText("Resource link")).toBeInTheDocument();
    expect(screen.getAllByText("read_many full output").length).toBeGreaterThan(0);
    expect(screen.getByText("kiln://artifacts/tool-results/artifact_1/content")).toBeInTheDocument();
    expect(screen.getByText("Open inspector")).toBeInTheDocument();
    expect(screen.queryByText("--- C:\\Proyectos\\Sequel\\kiln\\docs\\architecture.md")).not.toBeInTheDocument();
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

  it("names the active tool in the live transcript activity row", () => {
    render(
      <Transcript
        entries={[messageEntry("1", "user", "read docs")]}
        activityPhase="tool_running"
        activityToolName="read_many"
      />,
    );

    expect(screen.getByRole("status", { name: "Activity phase: Using read_many" })).toBeInTheDocument();
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

    fireEvent.click(screen.getAllByRole("button", { name: "Show details" })[0]!);
    expect(screen.getByText("path")).toBeInTheDocument();
    expect(screen.getByText("demo.txt")).toBeInTheDocument();
    expect(screen.queryByText(/"input"/)).not.toBeInTheDocument();
    expect(screen.queryByText("{")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Show details" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));

    expect(screen.getByText("Workspace mutation")).toBeInTheDocument();
    expect(onApprove).toHaveBeenCalledWith("session-1");
    expect(onDeny).toHaveBeenCalledWith("session-1");
  });
});
