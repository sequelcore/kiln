import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("ansi-to-react", () => ({
  default: {
    default: ({ children }: { readonly children?: string }) => <code>{children}</code>,
  },
}));

import { Terminal } from "../src/components/ai-elements/terminal.js";

describe("Terminal module interop", () => {
  it("renders output when the CommonJS component arrives through a default wrapper", () => {
    render(<Terminal output="build complete" />);

    expect(screen.getByRole("log", { name: "Command output" })).toHaveTextContent("build complete");
  });
});
