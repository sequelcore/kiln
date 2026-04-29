import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette } from "../src/components/command-palette.js";

const commands = [
  {
    id: "clear",
    trigger: "clear",
    title: "Clear session",
    description: "Reset the active conversation.",
    keywords: ["reset", "session"],
  },
  {
    id: "resume",
    trigger: "resume",
    title: "Resume selected session",
    description: "Continue the highlighted session.",
    keywords: ["history", "continue"],
  },
] as const;

describe("CommandPalette", () => {
  it("filters commands from the query input", () => {
    const onExecute = vi.fn();
    render(
      <CommandPalette
        open
        title="Command Palette"
        placeholder="Filter commands…"
        query="continue"
        commands={commands}
        onQueryChange={() => {}}
        onExecute={onExecute}
        onOpenChange={() => {}}
      />,
    );

    expect(screen.getByText("Resume selected session")).toBeInTheDocument();
    expect(screen.queryByText("Clear session")).not.toBeInTheDocument();
  });

  it("supports arrow navigation and Enter execution", () => {
    const onExecute = vi.fn();
    render(
      <CommandPalette
        open
        title="Command Palette"
        placeholder="Filter commands…"
        query=""
        commands={commands}
        onQueryChange={() => {}}
        onExecute={onExecute}
        onOpenChange={() => {}}
      />,
    );

    const input = screen.getByPlaceholderText("Filter commands…");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onExecute).toHaveBeenCalledWith(commands[1]);
  });
});
