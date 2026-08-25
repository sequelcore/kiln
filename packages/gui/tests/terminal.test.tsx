import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Terminal } from "../src/components/ai-elements/terminal.js";

describe("Terminal", () => {
  it("uses the canonical terminal material instead of conversation colors", () => {
    render(<Terminal output="build complete" />);

    const terminal = screen.getByRole("log", { name: "Command output" }).parentElement;
    expect(terminal).toHaveClass("bg-terminal-background", "text-terminal-foreground");
    expect(terminal).not.toHaveClass("bg-code-background", "text-code-foreground");
  });
});
