import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageRow } from "../src/components/message-row.js";

describe("MessageRow", () => {
  it("renders assistant audio parts as compact playback actions", () => {
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
      />,
    );

    expect(screen.getByText("Here is the spoken answer.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Audio output" })).toBeInTheDocument();
    const audio = container.querySelector("audio");
    expect(audio).not.toBeNull();
    expect(audio?.getAttribute("src")).toBe("data:audio/mpeg;base64,AQID");
    expect(screen.getByRole("link", { name: "Open audio artifact" })).toHaveAttribute("href", "kiln://artifacts/voice-synthesis/artifact_1/content");
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
