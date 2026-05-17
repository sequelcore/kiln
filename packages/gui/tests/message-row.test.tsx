import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageRow } from "../src/components/message-row.js";

describe("MessageRow", () => {
  it("renders assistant markdown lists and GFM tables with visible structure", () => {
    const { container } = render(
      <MessageRow
        message={{
          id: "msg-markdown",
          role: "assistant",
          content: [
            "Checklist:",
            "",
            "- Provider discovery",
            "- GUI rendering",
            "",
            "| Surface | Status |",
            "| --- | --- |",
            "| Chat | fixed |",
          ].join("\n"),
          createdAt: "2026-05-16T00:00:00.000Z",
          parts: [],
        }}
      />,
    );

    expect(screen.getByRole("list")).toHaveClass("list-disc");
    expect(screen.getByText("Provider discovery").closest("li")).toHaveClass("pl-1");
    const table = screen.getByRole("table");
    expect(table).toHaveClass("border-collapse");
    expect(table.parentElement).toHaveClass("overflow-x-auto");
    expect(screen.getByRole("columnheader", { name: "Surface" })).toHaveClass("bg-background-element");
    expect(screen.getByRole("cell", { name: "fixed" })).toBeInTheDocument();
    expect(container.querySelector(".markdown-body")).not.toBeNull();
  });

  it("renders assistant audio parts as compact playback actions", async () => {
    const loadResourceDataUrl = vi.fn().mockResolvedValue("data:audio/mpeg;base64,AQID");
    const { container } = render(
      <MessageRow
        message={{
          id: "msg-1",
          role: "assistant",
          content: "Here is the spoken answer.",
          createdAt: "2026-05-15T00:00:00.000Z",
          parts: [
            { type: "text", text: "Here is the spoken answer." },
            { type: "audio", mimeType: "audio/mpeg", data: "AQID", artifactUri: "kiln://artifacts/voice-synthesis/artifact_1/content" },
          ],
        }}
        loadResourceDataUrl={loadResourceDataUrl}
      />,
    );

    expect(screen.getByText("Here is the spoken answer.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Audio output" })).toBeInTheDocument();
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio?.getAttribute("src")).toBe("data:audio/mpeg;base64,AQID");
    expect(screen.queryByRole("link", { name: "Open audio artifact" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open audio artifact" }));

    await waitFor(() => {
      expect(loadResourceDataUrl).toHaveBeenCalledWith("kiln://artifacts/voice-synthesis/artifact_1/content");
    });
    expect(screen.getByLabelText("Audio artifact preview")).toHaveAttribute("src", "data:audio/mpeg;base64,AQID");
  });

  it("renders a compact on-demand audio action for canonical assistant messages without audio", () => {
    render(
      <MessageRow
        message={{
          id: "msg-2",
          role: "assistant",
          content: "Generate audio when requested.",
          sourceMessageId: "runtime-message-2",
          createdAt: "2026-05-15T00:00:00.000Z",
          parts: [{ type: "text", text: "Generate audio when requested." }],
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Generate audio" })).toBeInTheDocument();
  });
});
