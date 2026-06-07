import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "../src/components/composer.js";

function renderComposer(overrides?: Partial<ComponentProps<typeof Composer>>) {
  const onSubmit = vi.fn();
  const onTogglePlanMode = vi.fn();
  const onSubmitParts = vi.fn();
  const onCommandMenuOpenChange = vi.fn();
  const onCommandMenuExecute = vi.fn();
  const onCommandMenuQueryChange = vi.fn();
  render(
    <Composer
      status="ready"
      planMode={false}
      continuityHint={{
        label: "New session",
        description: "Next message starts fresh",
        tone: "muted",
      }}
      providerControl={<button type="button">Claude Sonnet 4</button>}
      reasoningControl={<select aria-label="Reasoning effort" defaultValue="medium"><option value="medium">Medium</option></select>}
      authorityControl={<select aria-label="Turn authority" defaultValue="auto"><option value="auto">Auto</option></select>}
      commandMenu={{
        open: false,
        query: "",
        commands: [
          {
            id: "new-session",
            trigger: "new session",
            title: "New Session",
          },
        ],
        onQueryChange: onCommandMenuQueryChange,
        onExecute: onCommandMenuExecute,
        onOpenChange: onCommandMenuOpenChange,
      }}
      onSubmit={onSubmit}
      onTogglePlanMode={onTogglePlanMode}
      onSubmitParts={onSubmitParts}
      {...overrides}
    />,
  );
  return {
    onSubmit,
    onTogglePlanMode,
    onSubmitParts,
    onCommandMenuOpenChange,
    onCommandMenuExecute,
    onCommandMenuQueryChange,
  };
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

  it("Enter with empty draft does not submit", () => {
    const { onSubmit } = renderComposer();
    const textarea = screen.getByLabelText("Message");
    fireEvent.keyDown(textarea, { key: "Enter", code: "Enter", shiftKey: false });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("Slash on empty draft opens the local command menu", () => {
    const { onCommandMenuOpenChange } = renderComposer();
    const textarea = screen.getByLabelText("Message");
    fireEvent.keyDown(textarea, { key: "/", code: "Slash" });
    expect(onCommandMenuOpenChange).toHaveBeenCalledWith(true);
  });

  it("Slash inserted through input change opens the local command menu", () => {
    const { onCommandMenuOpenChange } = renderComposer();
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "/" } });
    expect(onCommandMenuOpenChange).toHaveBeenCalledWith(true);
    expect(textarea.value).toBe("");
  });

  it("renders the local command menu above the composer when open", () => {
    renderComposer({
      commandMenu: {
        open: true,
        query: "",
        commands: [
          {
            id: "provider",
            trigger: "provider",
            title: "Provider",
            description: "Open the provider and model picker.",
          },
        ],
        onQueryChange: vi.fn(),
        onExecute: vi.fn(),
        onOpenChange: vi.fn(),
      },
    });

    const menu = screen.getByRole("dialog", { name: "Composer commands" });
    expect(menu).toHaveAttribute("aria-modal", "false");
    expect(within(menu).getByText("Provider")).toBeInTheDocument();
  });

  it("does not render a redundant command button", () => {
    renderComposer();

    expect(screen.queryByRole("button", { name: "Open command palette" })).not.toBeInTheDocument();
    expect(screen.queryByText("/command")).not.toBeInTheDocument();
  });

  it("renders the composer continuity hint", () => {
    renderComposer({
      continuityHint: {
        label: "Continue target",
        description: "Next message continues selected session",
        tone: "accent",
      },
    });

    const hint = screen.getByRole("status", { name: "Session continuity" });
    expect(within(hint).getByText("Continue target")).toBeInTheDocument();
    expect(within(hint).getByText("Next message continues selected session")).toBeInTheDocument();
  });

  it("renders the provider/model control in the composer rail", () => {
    renderComposer();

    expect(screen.getByRole("button", { name: "Claude Sonnet 4" })).toBeInTheDocument();
  });

  it("keeps model, effort, authority, plan, and send controls inside the input surface", () => {
    renderComposer();

    const textarea = screen.getByLabelText("Message");
    const inputSurface = textarea.parentElement;

    expect(inputSurface).not.toBeNull();
    expect(within(inputSurface as HTMLElement).getByRole("button", { name: "Claude Sonnet 4" })).toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).getByLabelText("Reasoning effort")).toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).getByLabelText("Turn authority")).toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).getByRole("button", { name: "Plan" })).toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).getByRole("button", { name: "Send message" })).toBeInTheDocument();
  });

  it("uses a restrained focus treatment on the input surface", () => {
    renderComposer();

    const textarea = screen.getByLabelText("Message");
    const inputSurface = textarea.parentElement;

    expect(inputSurface).toHaveClass("focus-within:border-ring/70");
    expect(inputSurface).not.toHaveClass("focus-within:ring-3");
  });

  it("uses theme elevation instead of default shadow scale", () => {
    renderComposer();

    const textarea = screen.getByLabelText("Message");
    const inputSurface = textarea.parentElement;

    expect(inputSurface).toHaveClass("shadow-[var(--shadow-elevated)]");
    expect(inputSurface).not.toHaveClass("shadow-sm");
  });

  it("keeps the input surface compact without crowding the controls", () => {
    renderComposer();

    const textarea = screen.getByLabelText("Message");
    const inputSurface = textarea.parentElement;

    expect(inputSurface).toHaveClass("overflow-hidden", "rounded-md");
    expect(textarea).toHaveClass("min-h-16", "max-h-36", "px-3", "py-3", "text-sm");
  });

  it("adds a non-interactive fade between transcript content and the composer", () => {
    renderComposer();

    const section = screen.getByRole("textbox", { name: "Message" }).closest("section");

    expect(section).toHaveClass("relative", "z-10", "bg-background/95");
    expect(section).toHaveClass("border-t", "border-border/60");
    expect(section).toHaveClass("before:pointer-events-none", "before:-top-8", "before:h-8");
    expect(section).toHaveClass("before:bg-gradient-to-t", "before:from-background", "before:to-transparent");
  });

  it("renders send as an icon button with an accessible label", () => {
    renderComposer();

    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
  });

  it("records voice input and submits canonical audio parts", async () => {
    const stopTrack = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    const activeRecorders: MockMediaRecorder[] = [];

    class MockMediaRecorder {
      static isTypeSupported(mimeType: string): boolean {
        return mimeType === "audio/webm;codecs=opus";
      }

      state = "inactive";
      mimeType = "audio/webm;codecs=opus";
      ondataavailable: ((event: { readonly data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;

      constructor() {
        activeRecorders.push(this);
      }

      start(): void {
        this.state = "recording";
      }

      stop(): void {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["abc"], { type: this.mimeType }) });
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", MockMediaRecorder);

    const { onSubmitParts } = renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "Record voice" }));

    await waitFor(() => expect(activeRecorders).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Stop voice recording" }));

    await waitFor(() => {
      expect(onSubmitParts).toHaveBeenCalledWith([
        {
          type: "audio",
          mimeType: "audio/webm;codecs=opus",
          data: "YWJj",
          durationMs: expect.any(Number),
        },
      ], expect.stringMatching(/^Voice input/));
    });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(stopTrack).toHaveBeenCalled();
  });

  it("attaches an audio file and submits canonical audio parts", async () => {
    const { onSubmitParts } = renderComposer();
    const file = new File(["abc"], "voice.webm", { type: "audio/webm" });

    fireEvent.click(screen.getByRole("button", { name: "Attach audio file" }));
    fireEvent.change(screen.getByLabelText("Audio file input"), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(onSubmitParts).toHaveBeenCalledWith([
        {
          type: "audio",
          mimeType: "audio/webm",
          data: "YWJj",
        },
      ], "Voice input");
    });
  });

  it("renders reasoning effort as part of the composer model controls", () => {
    renderComposer();

    expect(screen.getByLabelText("Reasoning effort")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claude Sonnet 4" })).toBeInTheDocument();
  });

  it("does not render placeholder-only file or approval chips", () => {
    renderComposer();

    expect(screen.queryByText("@files")).not.toBeInTheDocument();
    expect(screen.queryByText("approvals")).not.toBeInTheDocument();
  });

  it("does not block native paste behavior", () => {
    renderComposer();
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });

    fireEvent(textarea, pasteEvent);

    expect(pasteEvent.defaultPrevented).toBe(false);
  });

  it("non-special editing keys do not trigger command actions", () => {
    const { onSubmit, onCommandMenuOpenChange } = renderComposer();
    const textarea = screen.getByLabelText("Message");

    fireEvent.keyDown(textarea, { key: "Backspace", code: "Backspace" });
    fireEvent.keyDown(textarea, { key: "ArrowLeft", code: "ArrowLeft" });
    fireEvent.keyDown(textarea, { key: "Delete", code: "Delete" });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCommandMenuOpenChange).not.toHaveBeenCalled();
  });

  it("Textarea is configured for wrapped multi-line input", () => {
    renderComposer();
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    expect(textarea.getAttribute("wrap")).toBe("soft");
  });
});
