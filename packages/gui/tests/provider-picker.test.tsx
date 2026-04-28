import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ProviderPicker } from "../src/components/provider-picker.js";
import type { ProviderDescriptor } from "../src/lib/session-store.js";

const baseProviders: ProviderDescriptor[] = [
  {
    id: "claude",
    label: "Claude",
    group: "harness",
    free: false,
    available: true,
    models: ["claude-sonnet-4-6", "claude-opus-4-6"],
  },
  {
    id: "codex",
    label: "Codex",
    group: "harness",
    free: false,
    available: true,
    models: ["o3", "o4-mini"],
  },
  {
    id: "opencode",
    label: "OpenCode",
    group: "harness",
    free: false,
    available: true,
    models: [],
  },
];

function renderPickerHarness(options?: {
  providers?: ProviderDescriptor[];
  activeProvider?: string | null;
  activeModel?: string | null;
  onSwitchProvider?: (provider: string, model?: string) => void | Promise<void>;
  onRefreshProviders?: () => void | Promise<void>;
}) {
  const onSwitchProvider = options?.onSwitchProvider ?? vi.fn();

  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <ProviderPicker
        open={open}
        providers={options?.providers ?? baseProviders}
        activeProvider={options?.activeProvider ?? "claude"}
        activeModel={options?.activeModel ?? "claude-sonnet-4-6"}
        onSwitchProvider={(provider, model) => onSwitchProvider(provider, model)}
        onRefreshProviders={options?.onRefreshProviders}
        onOpenChange={setOpen}
      />
    );
  }

  render(<Harness />);
  return { onSwitchProvider };
}

describe("ProviderPicker", () => {
  it("renders only advertised providers grouped into their categories", () => {
    renderPickerHarness({
      providers: [
        ...baseProviders,
        {
          id: "opencode-go",
          label: "OpenCode Go",
          group: "subscription",
          free: true,
          available: true,
          models: ["minimax-m2.5"],
        },
        {
          id: "openai",
          label: "OpenAI",
          group: "direct-api",
          free: false,
          available: true,
          models: ["gpt-5"],
        },
      ],
    });

    expect(screen.getByRole("group", { name: "Subscription" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Harness" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Direct API" })).toBeInTheDocument();

    const providerList = screen.getByRole("listbox", { name: "Providers" });
    expect(within(providerList).getAllByRole("option")).toHaveLength(5);
    expect(screen.getByRole("option", { name: /OpenCode Go/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /OpenAI/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /OpenCode Zen/ })).not.toBeInTheDocument();
    expect(screen.getAllByText("Free")).toHaveLength(1);
  });

  it("renders unavailable provider-only entries as disabled and does not switch them", () => {
    const providers: ProviderDescriptor[] = [
      ...baseProviders,
      {
        id: "opencode-go",
        label: "OpenCode Go",
        group: "subscription",
        free: true,
        available: false,
        models: [],
        reason: "OpenCode Go auth is missing.",
      },
    ];
    const { onSwitchProvider } = renderPickerHarness({ providers });
    const unavailableProvider = screen.getByRole("option", { name: /OpenCode Go/ });

    expect(unavailableProvider).toBeDisabled();
    expect(within(unavailableProvider).getByText("Auth is missing.")).toBeInTheDocument();
    fireEvent.doubleClick(unavailableProvider);
    expect(onSwitchProvider).not.toHaveBeenCalled();
  });

  it("refreshes provider discovery from the picker without closing it", async () => {
    const onRefreshProviders = vi.fn().mockResolvedValue(undefined);
    renderPickerHarness({ onRefreshProviders });

    fireEvent.click(screen.getByRole("button", { name: "Refresh providers" }));

    await waitFor(() => {
      expect(onRefreshProviders).toHaveBeenCalledOnce();
    });
    expect(screen.getByRole("dialog", { name: "Switch provider" })).toBeInTheDocument();
  });

  it("treats available provider descriptors without models as unavailable", () => {
    const providers: ProviderDescriptor[] = [
      ...baseProviders,
      {
        id: "opencode-go",
        label: "OpenCode Go",
        group: "subscription",
        free: true,
        available: true,
        models: [],
      },
    ];
    const { onSwitchProvider } = renderPickerHarness({ providers });
    const provider = screen.getByRole("option", { name: /OpenCode Go/ });

    expect(provider).toBeDisabled();
    fireEvent.doubleClick(provider);
    expect(onSwitchProvider).not.toHaveBeenCalled();
  });

  it("treats blank model ids as unavailable", () => {
    const providers: ProviderDescriptor[] = [
      ...baseProviders,
      {
        id: "opencode-go",
        label: "OpenCode Go",
        group: "subscription",
        free: true,
        available: true,
        models: ["", "   "],
      },
    ];
    const { onSwitchProvider } = renderPickerHarness({ providers });
    const provider = screen.getByRole("option", { name: /OpenCode Go/ });

    expect(provider).toBeDisabled();
    fireEvent.doubleClick(provider);
    expect(onSwitchProvider).not.toHaveBeenCalled();
  });

  it("ignores unknown providers instead of rendering an Other group", () => {
    const providers: ProviderDescriptor[] = [
      ...baseProviders,
      {
        id: "unknown-provider",
        label: "Unknown Provider",
        group: "direct-api",
        free: false,
        available: true,
        models: ["mystery-1"],
      },
    ];

    renderPickerHarness({ providers });

    const providerList = screen.getByRole("listbox", { name: "Providers" });
    expect(within(providerList).getAllByRole("option")).toHaveLength(3);
    expect(screen.queryByRole("group", { name: "Other" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Unknown Provider/ })).not.toBeInTheDocument();
  });

  it("supports arrow navigation and Enter descends to model list", () => {
    renderPickerHarness();
    const dialog = screen.getByRole("dialog", { name: "Switch provider" });

    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(screen.getByRole("listbox", { name: "Models" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "o3" })).toBeInTheDocument();
  });

  it("single-clicks through provider and model selection", async () => {
    const onSwitchProvider = vi.fn().mockResolvedValue(undefined);
    renderPickerHarness({ onSwitchProvider });

    fireEvent.click(screen.getByRole("option", { name: /Codex/ }));
    expect(screen.getByRole("listbox", { name: "Models" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("option", { name: "o4-mini" }));

    await waitFor(() => {
      expect(onSwitchProvider).toHaveBeenCalledWith("codex", "o4-mini");
    });
  });

  it("preserves the active pane and selected provider when the provider catalog refreshes", () => {
    const onOpenChange = vi.fn();
    const onSwitchProvider = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <ProviderPicker
        open
        providers={baseProviders}
        activeProvider="claude"
        activeModel="claude-sonnet-4-6"
        onSwitchProvider={onSwitchProvider}
        onOpenChange={onOpenChange}
      />,
    );

    fireEvent.click(screen.getByRole("option", { name: /Codex/ }));
    expect(screen.getByRole("listbox", { name: "Models" })).toBeInTheDocument();

    rerender(
      <ProviderPicker
        open
        providers={baseProviders.map((provider) => ({
          ...provider,
          models: [...provider.models],
        }))}
        activeProvider="claude"
        activeModel="claude-sonnet-4-6"
        onSwitchProvider={onSwitchProvider}
        onOpenChange={onOpenChange}
      />,
    );

    expect(screen.getByRole("listbox", { name: "Models" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "o3" })).toBeInTheDocument();
    expect(screen.queryByRole("listbox", { name: "Providers" })).not.toBeInTheDocument();
  });

  it("empty model list does not switch provider", () => {
    const { onSwitchProvider } = renderPickerHarness();
    const dialog = screen.getByRole("dialog", { name: "Switch provider" });

    fireEvent.keyDown(dialog, { key: "ArrowDown" }); // codex
    fireEvent.keyDown(dialog, { key: "ArrowDown" }); // opencode
    fireEvent.keyDown(dialog, { key: "Enter" });

    expect(onSwitchProvider).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Switch provider" })).toBeInTheDocument();
  });

  it("switches a model-less Claude provider without opening the model list", async () => {
    const onSwitchProvider = vi.fn().mockResolvedValue(undefined);
    renderPickerHarness({
      activeProvider: "codex",
      activeModel: "o3",
      onSwitchProvider,
      providers: [
        {
          id: "claude",
          label: "Claude",
          group: "harness",
          free: false,
          available: true,
          models: [],
        },
        {
          id: "codex",
          label: "Codex",
          group: "harness",
          free: false,
          available: true,
          models: ["o3"],
        },
      ],
    });

    fireEvent.doubleClick(screen.getByRole("option", { name: /Claude/ }));

    await waitFor(() => {
      expect(onSwitchProvider).toHaveBeenCalledWith("claude", undefined);
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Switch provider" })).not.toBeInTheDocument();
    });
  });

  it("labels model-less Claude as requiring no model selection", () => {
    renderPickerHarness({
      providers: [
        {
          id: "claude",
          label: "Claude",
          group: "harness",
          free: false,
          available: true,
          models: [],
        },
      ],
    });

    expect(within(screen.getByRole("option", { name: /Claude/ })).getByText("No model selection")).toBeInTheDocument();
  });

  it("Esc returns from models to providers, then Esc closes", () => {
    renderPickerHarness();
    const dialog = screen.getByRole("dialog", { name: "Switch provider" });

    fireEvent.keyDown(dialog, { key: "ArrowDown" });
    fireEvent.keyDown(dialog, { key: "Enter" });
    expect(screen.getByRole("listbox", { name: "Models" })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Switch provider" }), { key: "Escape" });
    expect(screen.getByRole("listbox", { name: "Providers" })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Switch provider" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Switch provider" })).not.toBeInTheDocument();
  });

  it("awaits a successful provider switch before closing the dialog", async () => {
    const onSwitchProvider = vi.fn().mockResolvedValue(undefined);
    renderPickerHarness({ onSwitchProvider });
    const dialog = screen.getByRole("dialog", { name: "Switch provider" });

    fireEvent.keyDown(dialog, { key: "ArrowDown" }); // codex
    fireEvent.keyDown(dialog, { key: "Enter" }); // models pane
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Switch provider" }), { key: "ArrowDown" }); // o4-mini
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Switch provider" }), { key: "Enter" });

    await waitFor(() => {
      expect(onSwitchProvider).toHaveBeenCalledWith("codex", "o4-mini");
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Switch provider" })).not.toBeInTheDocument();
    });
  });

  it("filters large model lists by search and switches the concrete selected model id", async () => {
    const onSwitchProvider = vi.fn().mockResolvedValue(undefined);
    renderPickerHarness({
      activeProvider: "claude",
      activeModel: "claude-sonnet-4-6",
      onSwitchProvider,
      providers: [
        ...baseProviders,
        {
          id: "openrouter",
          label: "OpenRouter",
          group: "direct-api",
          free: true,
          available: true,
          models: [
            "openai/gpt-4.1",
            "anthropic/claude-sonnet-4.5",
            "google/gemini-2.5-pro",
            "qwen/qwen3-coder",
            "z-ai/glm-4.6",
          ],
        },
      ],
    });

    fireEvent.doubleClick(screen.getByRole("option", { name: /OpenRouter/ }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter models" }), {
      target: { value: "gemini" },
    });

    const modelList = screen.getByRole("listbox", { name: "Models" });
    expect(within(modelList).getAllByRole("option")).toHaveLength(1);
    expect(within(modelList).getByRole("option", { name: "google/gemini-2.5-pro" })).toBeInTheDocument();

    fireEvent.doubleClick(within(modelList).getByRole("option", { name: "google/gemini-2.5-pro" }));

    await waitFor(() => {
      expect(onSwitchProvider).toHaveBeenCalledWith("openrouter", "google/gemini-2.5-pro");
    });
  });

  it("keeps the picker open when onSwitchProvider rejects instead of treating the switch as accepted", async () => {
    const onSwitchProvider = vi.fn().mockRejectedValue(new Error("socket closed"));
    const onUnhandledRejection = vi.fn((event: PromiseRejectionEvent) => {
      event.preventDefault();
    });
    window.addEventListener("unhandledrejection", onUnhandledRejection as EventListener);

    try {
      renderPickerHarness({ onSwitchProvider });
      const dialog = screen.getByRole("dialog", { name: "Switch provider" });

      fireEvent.keyDown(dialog, { key: "ArrowDown" }); // codex
      fireEvent.keyDown(dialog, { key: "Enter" }); // models pane
      fireEvent.keyDown(screen.getByRole("dialog", { name: "Switch provider" }), { key: "ArrowDown" }); // o4-mini
      fireEvent.keyDown(screen.getByRole("dialog", { name: "Switch provider" }), { key: "Enter" });

      await waitFor(() => {
        expect(onSwitchProvider).toHaveBeenCalledWith("codex", "o4-mini");
      });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(screen.getByRole("dialog", { name: "Switch provider" })).toBeInTheDocument();
      expect(onUnhandledRejection).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("unhandledrejection", onUnhandledRejection as EventListener);
    }
  });

  it("exposes grouped list semantics and aria-selected options", () => {
    renderPickerHarness();
    expect(screen.getByRole("group", { name: "Harness" })).toBeInTheDocument();

    const selectedOptions = screen.getAllByRole("option", { selected: true });
    expect(selectedOptions).toHaveLength(1);
  });
});
