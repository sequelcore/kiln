import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Transcript } from "../src/components/transcript.js";
import type { Message } from "../src/lib/session-store.js";

function message(id: string, role: Message["role"], content: string, streaming = false): Message {
  return {
    id,
    role,
    content,
    createdAt: new Date().toISOString(),
    streaming,
  };
}

describe("Transcript", () => {
  it("renders user, assistant, tool, and error rows with distinct roles", () => {
    render(
      <Transcript
        messages={[
          message("1", "user", "hello"),
          message("2", "assistant", "world"),
          message("3", "tool", "bash"),
          message("4", "error", "boom"),
        ]}
      />,
    );

    const rows = screen.getAllByRole("article");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveAttribute("data-role", "user");
    expect(rows[1]).toHaveAttribute("data-role", "assistant");
    expect(rows[2]).toHaveAttribute("data-role", "tool");
    expect(rows[3]).toHaveAttribute("data-role", "error");
  });

  it("shows streaming cursor indicator for streaming assistant message", () => {
    render(
      <Transcript
        messages={[
          message("1", "assistant", "streaming...", true),
        ]}
      />,
    );
    expect(screen.getByLabelText("Streaming")).toBeInTheDocument();
  });

  it("sticks to bottom unless user scrolled up", () => {
    const firstMessages = [
      message("1", "assistant", "first"),
      message("2", "assistant", "second"),
    ];

    const { rerender } = render(<Transcript messages={firstMessages} />);
    const container = screen.getByLabelText("Transcript");

    Object.defineProperty(container, "clientHeight", { configurable: true, value: 100 });
    Object.defineProperty(container, "scrollHeight", { configurable: true, value: 200, writable: true });
    Object.defineProperty(container, "scrollTop", { configurable: true, value: 100, writable: true });

    fireEvent.scroll(container);

    rerender(
      <Transcript
        messages={[...firstMessages, message("3", "assistant", "third")]}
      />,
    );

    expect((container as HTMLDivElement).scrollTop).toBe(200);

    (container as HTMLDivElement).scrollTop = 0;
    fireEvent.scroll(container);

    Object.defineProperty(container, "scrollHeight", { configurable: true, value: 300, writable: true });

    rerender(
      <Transcript
        messages={[...firstMessages, message("3", "assistant", "third"), message("4", "assistant", "fourth")]}
      />,
    );

    expect((container as HTMLDivElement).scrollTop).toBe(0);
  });
});

