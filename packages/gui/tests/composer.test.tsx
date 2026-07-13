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
        prominence: "routine",
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
  it("aligns the composer with the transcript axis", () => {
    renderComposer();

    const form = screen.getByLabelText("Message").closest("form");
    expect(form).toHaveClass("mx-auto", "w-full", "max-w-3xl");
    expect(form).not.toHaveClass("max-w-4xl");
  });

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

  it.each([
    ["New session", "Next message starts fresh", "muted"],
    ["Continue chat", "Next message continues selected session", "accent"],
    ["Live", "Next message continues current session", "info"],
  ] as const)("hides routine continuity state %s", (label, description, tone) => {
    renderComposer({ continuityHint: { label, description, tone, prominence: "routine" } });

    expect(screen.queryByRole("status", { name: "Session continuity" })).not.toBeInTheDocument();
  });

  it.each([
    ["Detached", "Run continues in background", "warning"],
    ["Running", "Waiting for current turn", "info"],
  ] as const)("shows exceptional continuity state %s", (label, description, tone) => {
    renderComposer({ continuityHint: { label, description, tone, prominence: "exceptional" } });

    const status = screen.getByRole("status", { name: "Session continuity" });
    expect(status).toHaveTextContent(label);
    expect(status).toHaveAccessibleDescription(description);
    expect(status).toHaveAttribute("data-slot", "marker");
  });

  it("renders turn controls as accessible message options", () => {
    renderComposer();

    const options = screen.getByRole("group", { name: "Message options" });
    expect(within(options).getByRole("button", { name: "Claude Sonnet 4" })).toBeInTheDocument();
    expect(within(options).getByLabelText("Reasoning effort")).toBeInTheDocument();
    expect(within(options).getByLabelText(/Turn authority/)).toBeInTheDocument();
  });

  it("labels authoritative, partial, and restored context evidence without color-only state", () => {
    const { rerender } = render(
      <Composer
        status="ready"
        planMode={false}
        continuityHint={{ label: "New session", description: "Next message starts fresh", tone: "muted", prominence: "routine" }}
        contextUsage={{
          state: "authoritative",
          usedTokens: 2400,
          contextWindowTokens: 8000,
          remainingTokens: 5600,
          usedPercentage: 30,
          providerId: "openai",
          modelId: "gpt-5",
          observedAt: "2026-07-13T00:00:00.000Z",
          measurement: "provider_reported",
          lifecycle: "completed",
          contextWindowAuthority: "provider_reported",
          freshness: "fresh",
        }}
        commandMenu={{ open: false, query: "", commands: [], onQueryChange: vi.fn(), onExecute: vi.fn(), onOpenChange: vi.fn() }}
        leadingActions={null}
        trailingActions={null}
        onSubmit={() => undefined}
        onTogglePlanMode={() => undefined}
        onSubmitParts={() => undefined}
      />,
    );
    expect(screen.getByRole("button", { name: "Context 30%: 2.4k / 8k tokens" })).toHaveTextContent("30%");

    rerender(
      <Composer
        status="ready"
        planMode={false}
        continuityHint={{ label: "New session", description: "Next message starts fresh", tone: "muted", prominence: "routine" }}
        contextUsage={{
          state: "partial",
          usedTokens: 2400,
          providerId: "openai",
          modelId: "gpt-5",
          observedAt: "2026-07-13T00:00:00.000Z",
          measurement: "runtime_estimate",
          lifecycle: "restored",
          contextWindowAuthority: "unknown",
          freshness: "historical",
          reason: "No compatible context window was persisted.",
        }}
        commandMenu={{ open: false, query: "", commands: [], onQueryChange: vi.fn(), onExecute: vi.fn(), onOpenChange: vi.fn() }}
        leadingActions={null}
        trailingActions={null}
        onSubmit={() => undefined}
        onTogglePlanMode={() => undefined}
        onSubmitParts={() => undefined}
      />,
    );
    const restored = screen.getByRole("button", { name: "Context partial: 2.4k tokens; restored historical measurement" });
    expect(restored).toHaveTextContent("P");
    expect(restored).toHaveTextContent("H");
  });

  it("keeps all composer actions inside the compact input surface", () => {
    renderComposer();

    const textarea = screen.getByLabelText("Message");
    const inputSurface = textarea.parentElement;

    expect(inputSurface).not.toBeNull();
    const options = within(inputSurface as HTMLElement).getByRole("group", { name: "Message options" });
    expect(options).toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).getByRole("button", { name: "Attach audio file" })).toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).getByRole("button", { name: "Attach image" })).toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).getByRole("button", { name: "Plan" })).toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).getByLabelText(/Turn authority/)).toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).getByRole("button", { name: "Context usage unavailable" })).toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).getByRole("button", { name: "Claude Sonnet 4" })).toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).getByLabelText("Reasoning effort")).toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).getByRole("button", { name: "Record voice" })).toBeInTheDocument();
    expect(within(inputSurface as HTMLElement).getByRole("button", { name: "Send message" })).toBeInTheDocument();
  });

  it("keeps inactive composer controls visibly actionable before typing", () => {
    renderComposer();

    expect(screen.getByRole("button", { name: "Attach audio file" })).toHaveClass("bg-background/60");
    expect(screen.getByRole("button", { name: "Attach image" })).toHaveClass("bg-background/60");
    expect(screen.getByRole("button", { name: "Plan" })).toHaveClass("bg-background/60");
    expect(screen.getByRole("button", { name: "Record voice" })).toHaveClass("bg-background/60");
    expect(screen.getByRole("button", { name: "Context usage unavailable" })).toHaveClass("border", "bg-background/60");
  });

  it("orders the composer rail like a modern chat harness", () => {
    renderComposer();

    const options = screen.getByRole("group", { name: "Message options" });
    const orderedControls = [
      within(options).getByRole("button", { name: "Attach audio file" }),
      within(options).getByRole("button", { name: "Attach image" }),
      within(options).getByRole("button", { name: "Plan" }),
      within(options).getByLabelText(/Turn authority/),
      within(options).getByRole("button", { name: "Context usage unavailable" }),
      within(options).getByRole("button", { name: "Claude Sonnet 4" }),
      within(options).getByLabelText("Reasoning effort"),
      within(options).getByRole("button", { name: "Record voice" }),
      within(options).getByRole("button", { name: "Send message" }),
    ];

    for (let index = 0; index < orderedControls.length - 1; index += 1) {
      expect(orderedControls[index]!.compareDocumentPosition(orderedControls[index + 1]!) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBeTruthy();
    }
  });

  it("toggles plan mode without changing the draft", () => {
    const { onTogglePlanMode, onSubmit } = renderComposer();
    const textarea = screen.getByLabelText("Message");

    fireEvent.change(textarea, { target: { value: "Inspect this change" } });
    fireEvent.click(screen.getByRole("button", { name: "Plan" }));

    expect(onTogglePlanMode).toHaveBeenCalledWith(true);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("Inspect this change");
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

  it("uses a compact shadcn input surface with room for multi-line work", () => {
    renderComposer();

    const textarea = screen.getByLabelText("Message");
    const inputSurface = textarea.parentElement;

    expect(inputSurface).toHaveAttribute("data-slot", "input-group");
    expect(inputSurface).toHaveAttribute("data-composer-surface", "message");
    expect(inputSurface).toHaveClass("overflow-hidden", "rounded-xl", "bg-workspace-viewer-panel");
    expect(inputSurface).not.toHaveClass("bg-card");
    expect(inputSurface).not.toHaveClass("min-h-32");
    expect(textarea).toHaveClass("max-h-44", "px-3", "text-sm");
    expect(textarea).not.toHaveClass("min-h-20", "py-3");
  });

  it("does not render a separate technical control rail", () => {
    renderComposer();

    const options = screen.getByRole("group", { name: "Message options" });
    expect(options).not.toHaveClass("border-t", "bg-background/65");
    expect(options.firstElementChild).toHaveClass("grid");
  });

  it("uses a plain dock without a redundant boundary or decorative transcript fade", () => {
    renderComposer();

    const section = screen.getByRole("textbox", { name: "Message" }).closest("section");

    expect(section).toHaveClass("relative", "z-10", "bg-workspace-viewer");
    expect(section).not.toHaveClass("bg-background");
    expect(section).not.toHaveClass("border-t", "border-border/60");
    expect(section?.className).not.toContain("before:bg-gradient");
    expect(section?.className).not.toContain("backdrop-filter");
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

  it("attaches an image file and submits canonical image parts", async () => {
    const { onSubmitParts } = renderComposer();
    const file = new File(["abc"], "queja.png", { type: "image/png" });

    fireEvent.click(screen.getByRole("button", { name: "Attach image" }));
    fireEvent.change(screen.getByLabelText("Image file input"), {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(onSubmitParts).toHaveBeenCalledWith([
        {
          type: "image",
          mimeType: "image/png",
          data: "YWJj",
        },
      ], "Image: queja.png");
    });
  });

  it("submits pasted image clipboard data as canonical image parts", async () => {
    const { onSubmitParts } = renderComposer();
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    const file = new File(["abc"], "clipboard.png", { type: "image/png" });
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true }) as Event & {
      clipboardData?: {
        readonly files: readonly File[];
      };
    };
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: { files: [file] },
    });

    fireEvent(textarea, pasteEvent);

    await waitFor(() => {
      expect(onSubmitParts).toHaveBeenCalledWith([
        {
          type: "image",
          mimeType: "image/png",
          data: "YWJj",
        },
      ], "Image: clipboard.png");
    });
    expect(pasteEvent.defaultPrevented).toBe(true);
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
