import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "../src/components/composer.js";

function renderComposer(overrides?: Partial<ComponentProps<typeof Composer>>) {
  const onSubmit = vi.fn();
  const onEmptySubmit = vi.fn();
  const onTogglePlanMode = vi.fn();
  const onOpenCommandPalette = vi.fn();
  render(
    <Composer
      status="ready"
      planMode={false}
      activityLabel={null}
      resumeTargetId={null}
      onSubmit={onSubmit}
      onEmptySubmit={onEmptySubmit}
      onTogglePlanMode={onTogglePlanMode}
      onOpenCommandPalette={onOpenCommandPalette}
      {...overrides}
    />,
  );
  return { onSubmit, onEmptySubmit, onTogglePlanMode, onOpenCommandPalette };
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

  it("Enter with empty draft triggers empty-submit callback", () => {
    const { onSubmit, onEmptySubmit } = renderComposer();
    const textarea = screen.getByLabelText("Message");
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter", shiftKey: false });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onEmptySubmit).toHaveBeenCalledTimes(1);
  });

  it("Slash on empty draft opens the command palette route", () => {
    const { onOpenCommandPalette } = renderComposer();
    const textarea = screen.getByLabelText("Message");
    fireEvent.keyDown(textarea, { key: "/", code: "Slash" });
    expect(onOpenCommandPalette).toHaveBeenCalledTimes(1);
  });

  it("normalizes pasted text to LF and strips trailing newlines", () => {
    renderComposer();
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;

    fireEvent.paste(textarea, {
      clipboardData: {
        getData: () => "line1\r\nline2\r\n",
      },
    });

    expect(textarea.value).toBe("line1\nline2");
  });

  it("non-special editing keys do not trigger command actions", () => {
    const { onSubmit, onEmptySubmit, onOpenCommandPalette } = renderComposer();
    const textarea = screen.getByLabelText("Message");

    fireEvent.keyDown(textarea, { key: "Backspace", code: "Backspace" });
    fireEvent.keyDown(textarea, { key: "ArrowLeft", code: "ArrowLeft" });
    fireEvent.keyDown(textarea, { key: "Delete", code: "Delete" });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onEmptySubmit).not.toHaveBeenCalled();
    expect(onOpenCommandPalette).not.toHaveBeenCalled();
  });

  it("Textarea is configured for wrapped multi-line input", () => {
    renderComposer();
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    expect(textarea.getAttribute("wrap")).toBe("soft");
  });
});
