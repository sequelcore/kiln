import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "../src/components/composer.js";

function renderComposer(overrides?: Partial<ComponentProps<typeof Composer>>) {
  const onSubmit = vi.fn();
  const onTogglePlanMode = vi.fn();
  render(
    <Composer
      status="ready"
      planMode={false}
      activityLabel={null}
      resumeTargetId={null}
      onSubmit={onSubmit}
      onTogglePlanMode={onTogglePlanMode}
      {...overrides}
    />,
  );
  return { onSubmit, onTogglePlanMode };
}

describe("Composer", () => {
  it("Enter while idle triggers submit", () => {
    const { onSubmit } = renderComposer();
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter", shiftKey: false });
    expect(onSubmit).toHaveBeenCalledWith("hello");
  });

  it("Enter while running is a no-op", () => {
    const { onSubmit } = renderComposer({ status: "running" });
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter", shiftKey: false });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Shift+Enter inserts newline and does not submit", () => {
    const { onSubmit } = renderComposer();
    const textarea = screen.getByLabelText("Message");
    fireEvent.change(textarea, { target: { value: "line1" } });
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Textarea is configured for wrapped multi-line input", () => {
    renderComposer();
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    expect(textarea.getAttribute("wrap")).toBe("soft");
  });
});
