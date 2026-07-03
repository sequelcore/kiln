import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

    const { container } = render(<Transcript entries={[]} />);

    expect(screen.getByText("Job's live. Run it clean.")).toBeInTheDocument();
    expect(screen.getByText("Kiln")).toBeInTheDocument();
    expect(container.querySelector('img[src*="logo.svg"]')).toBeInTheDocument();
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
    expect(screen.getByLabelText("User avatar")).toBeInTheDocument();
    expect(screen.getByLabelText("Assistant avatar")).toBeInTheDocument();
    expect(screen.getByLabelText("Error avatar")).toHaveAttribute("data-avatar-state", "error");
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
            details: { toolCallId: "call_read_1" },
          },
          {
            id: "timeline:event:tool-completed",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed read",
            summary: "# Session Model",
            tone: "success",
            details: { toolCallId: "call_read_1", status: "succeeded" },
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
    expect(rows[1]!.querySelector('[data-role="tool-event"]')).toHaveAttribute("data-state", "complete");
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
            details: { toolCallId: "call_read_1", status: "succeeded" },
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
    expect(rows).toHaveLength(4);
    expect(rows[1]).toHaveAttribute("data-role", "tool");
    expect(rows[2]).toHaveAttribute("data-role", "tool");
    expect(rows[3]).toHaveAttribute("data-role", "assistant");
    expect(rows[1]).toHaveTextContent("Completed read");
    expect(rows[2]).toHaveTextContent("Completed patch");
    expect(within(rows[3]!).queryByTestId("assistant-tool-events")).not.toBeInTheDocument();

    fireEvent.click(within(rows[1]!).getByRole("button", { name: "Show details" }));

    expect(within(rows[1]!).getByText("# Session Model")).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent("1 file changed");
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

    const toolEvent = screen.getByRole("article").querySelector('[data-role="tool-event"]');
    expect(toolEvent).toHaveAttribute("data-state", "interrupted");
    expect(toolEvent).toHaveClass("border-warning/45");
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

    expect(screen.queryByText("Diff")).not.toBeInTheDocument();
    const detailsButton = screen.getByRole("button", { name: "Show details" });
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

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));

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

    expect(screen.getByRole("button", { name: "Hide details" })).toBeInTheDocument();

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

    expect(screen.getByRole("button", { name: "Hide details" })).toBeInTheDocument();

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

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));

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

    expect(screen.getByText("# Session Model")).toBeInTheDocument();
    expect(screen.getAllByText("55 entries under C:\\workspace\\kiln").length).toBeGreaterThan(0);

    let detailButtons = screen.getAllByRole("button", { name: "Show details" });
    fireEvent.click(detailButtons[0]!);

    expect(screen.getByText("Document")).toBeInTheDocument();
    expect(screen.queryByText("Status")).not.toBeInTheDocument();
    expect(screen.queryByText("succeeded")).not.toBeInTheDocument();
    detailButtons = screen.getAllByRole("button", { name: "Show details" });
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

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
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
              title: "C:\\workspace\\kiln",
              summary: "20 entries under C:\\workspace\\kiln",
              fields: [{ label: "Entries", value: "20" }],
              raw: { available: false },
            },
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
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

    fireEvent.click(screen.getByRole("button", { name: "Show details" }));
    expect(screen.getByText("Source")).toBeInTheDocument();
    expect(screen.getByText("json")).toBeInTheDocument();
    expect(screen.getAllByText("3 lines · 22 bytes").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("JSON output")).toBeInTheDocument();
    expect(screen.getByText('"name":')).toHaveClass("kiln-json-view__label");
    expect(screen.getByText('"kiln"')).toHaveClass("kiln-json-view__string");
    expect(screen.queryByText("Text preview")).not.toBeInTheDocument();
    expect(screen.queryByText("Code preview")).not.toBeInTheDocument();
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
    expect(screen.getByLabelText("Assistant avatar")).toHaveAttribute("data-avatar-state", "running");
    expect(screen.getByLabelText("Assistant avatar")).toHaveAttribute("data-avatar-motion", "subtle");
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

  it("shows assistant thinking state in the transcript instead of the composer", () => {
    render(
      <Transcript
        entries={[messageEntry("1", "user", "build this")]}
        activityPhase="thinking"
      />,
    );

    expect(screen.getByRole("status", { name: "Activity phase: Thinking" })).toBeInTheDocument();
    expect(screen.queryByText("Thinking")).not.toBeInTheDocument();
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
            details: { toolCallId: "call_patch_1" },
          },
          {
            id: "timeline:event:tool-completed",
            type: "event",
            eventKind: "tool_call_completed",
            createdAt: new Date().toISOString(),
            title: "Completed patch",
            summary: "1 file changed",
            tone: "success",
            details: { toolCallId: "call_patch_1", status: "succeeded" },
          },
        ]}
        activityPhase="streaming"
      />,
    );

    const rows = screen.getAllByRole("article");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAttribute("data-role", "user");
    expect(rows[1]).toHaveAttribute("data-role", "tool");
    expect(rows[2]).toHaveAttribute("data-role", "assistant");
    expect(screen.queryByText("Using patch")).not.toBeInTheDocument();
    expect(rows[1]).toHaveTextContent("Completed patch");
    expect(rows[2]).toHaveTextContent("Responding");
    expect(within(rows[2]!).queryByTestId("assistant-tool-events")).not.toBeInTheDocument();
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

  it("keeps the activity row separate from live tool rows", () => {
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
        activityPhase="tool_running"
        activityToolName="patch"
      />,
    );

    const rows = screen.getAllByRole("article");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAttribute("data-role", "user");
    expect(rows[1]).toHaveAttribute("data-role", "tool");
    expect(rows[2]).toHaveAttribute("data-role", "assistant");
    expect(rows[1]).toHaveTextContent("Using patch");
    expect(rows[1]!.querySelector('[data-role="tool-event"]')).toHaveAttribute("data-state", "running");
    expect(rows[1]!.querySelector('[data-role="tool-event"]')).toHaveClass("border-primary/35");
    expect(within(rows[2]!).queryByTestId("assistant-tool-events")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Activity phase: Using patch" })).toBeInTheDocument();
  });

  it("uses a decorative beam wrapper for active tool rows without replacing accessible state", () => {
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

    const toolRow = screen.getAllByRole("article")[1]!;
    const toolEvent = toolRow.querySelector('[data-role="tool-event"]');
    expect(toolEvent).toHaveAttribute("data-state", "running");
    expect(toolEvent).toHaveTextContent("Execution in progress");
    const beam = toolRow.querySelector('[data-role="active-tool-beam"]');
    expect(beam).not.toHaveAttribute("aria-hidden");
    expect(beam).toHaveAttribute("data-motion", "decorative");
    expect(beam).toHaveClass("max-w-full", "overflow-visible");
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
            title: "Using managed_agent.invoke",
            summary: "foundation-readonly-plan via codex-oauth/gpt-5.5 (direct-provider) · Execution in progress",
            tone: "running",
            details: {
              input: {
                profile: "foundation-readonly-plan",
                providerRoute: { providerId: "codex-oauth" },
                task: "Inspect docs/architecture/managed-agents.md.",
              },
            },
            presentationDetails: [
              { label: "Tool", value: "managed_agent.invoke" },
              { label: "Tool call ID", value: "call_managed_1" },
              { label: "Profile", value: "foundation-readonly-plan" },
              { label: "Provider", value: "codex-oauth" },
              { label: "Model", value: "gpt-5.5" },
              { label: "Surface", value: "direct-provider" },
              { label: "Context mode", value: "isolated" },
              { label: "Agent profile", value: "architecture-reviewer" },
              { label: "Skills", value: "ddd-review" },
              { label: "Authority", value: "authority:codex-oauth-readonly:foundation-readonly-plan" },
              { label: "Invocation ID", value: "managed-1" },
              { label: "Child session", value: "child-session-1" },
              { label: "Task", value: "Inspect docs/architecture/managed-agents.md." },
            ],
          },
          messageEntry("2", "assistant", "", true),
        ]}
      />,
    );

    const row = screen.getAllByRole("article")[1]!;
    expect(row).toHaveTextContent("gpt-5.5");
    expect(row).toHaveTextContent("direct-provider");
    fireEvent.click(within(row).getByRole("button", { name: "Show details" }));
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

    fireEvent.click(screen.getAllByRole("button", { name: "Show details" })[0]!);
    expect(screen.getByText("path")).toBeInTheDocument();
    expect(screen.getByText("demo.txt")).toBeInTheDocument();
    expect(screen.queryByText(/"input"/)).not.toBeInTheDocument();
    expect(screen.queryByText("{")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Show details" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));

    expect(screen.getAllByText("Workspace mutation")).toHaveLength(2);
    expect(onApprove).toHaveBeenCalledWith("approval-1");
    expect(onDeny).toHaveBeenCalledWith("approval-1");
  });
});
