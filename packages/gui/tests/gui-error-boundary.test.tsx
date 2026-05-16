import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GuiErrorBoundary } from "../src/components/gui-error-boundary.js";

function BrokenSurface(): never {
  throw new Error("render failed");
}

describe("GuiErrorBoundary", () => {
  it("renders a focused recovery surface for React render failures", () => {
    const reload = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <GuiErrorBoundary onReload={reload}>
        <BrokenSurface />
      </GuiErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveAccessibleName("Kiln GUI failed to render");
    expect(screen.getByText("Kiln GUI failed to render")).toBeInTheDocument();
    expect(screen.getByText("render failed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reload GUI" }));

    expect(reload).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
