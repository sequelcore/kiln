import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef, useState } from "react";
import type { GuiProviderModelDiscoveryProjection } from "@kilnai/gateway-contracts";
import { describe, expect, it, vi } from "vitest";
import { ProviderPicker } from "../src/components/provider-picker.js";
import type { ProviderAuthDetails, ProviderDescriptor } from "../src/lib/session-store/index.js";

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
  providerModelDiscovery?: GuiProviderModelDiscoveryProjection | null;
  activeProvider?: string | null;
  activeModel?: string | null;
  onSwitchProvider?: (provider: string, model?: string) => void | Promise<void>;
  onAuthenticateProvider?: (provider: string, options?: { apiKey?: string; tier?: "go" | "zen" }) => void | Promise<void>;
  onRefreshProviders?: () => void | Promise<void>;
  providerAuthenticating?: boolean;
  providerAuthProvider?: string | null;
  providerAuthMessage?: string | null;
  providerAuthDetails?: ProviderAuthDetails | null;
}) {
  const onSwitchProvider = options?.onSwitchProvider ?? vi.fn();

  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <ProviderPicker
        open={open}
        providers={options?.providers ?? baseProviders}
        providerModelDiscovery={options?.providerModelDiscovery ?? null}
        activeProvider={options?.activeProvider ?? "claude"}
        activeModel={options?.activeModel ?? "claude-sonnet-4-6"}
        onSwitchProvider={(provider, model) => onSwitchProvider(provider, model)}
        onAuthenticateProvider={options?.onAuthenticateProvider}
        onRefreshProviders={options?.onRefreshProviders}
        providerAuthenticating={options?.providerAuthenticating}
        providerAuthProvider={options?.providerAuthProvider}
        providerAuthMessage={options?.providerAuthMessage}
        providerAuthDetails={options?.providerAuthDetails}
        onOpenChange={setOpen}
      />
    );
  }

  render(<Harness />);
  return { onSwitchProvider };
}

describe("ProviderPicker", () => {
  it("uses the owned dialog and command composition for searchable provider selection", () => {
    renderPickerHarness();

    const dialog = screen.getByRole("dialog", { name: "Switch provider" });
    expect(dialog).toHaveAttribute("data-slot", "dialog-content");
    expect(within(dialog).getByRole("combobox", { name: "Filter providers" })).toBeInTheDocument();
    expect(dialog.querySelector('[data-slot="command"]')).toBeInTheDocument();
  });

  it("dismisses from the backdrop when no operation is active", async () => {
    renderPickerHarness();

    const backdrop = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]');
    expect(backdrop).not.toBeNull();
    fireEvent.pointerDown(backdrop as HTMLElement);
    fireEvent.click(backdrop as HTMLElement);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Switch provider" })).not.toBeInTheDocument();
    });
  });

  it("restores focus to the invoking control after dismiss", async () => {
    function FocusHarness() {
      const [open, setOpen] = useState(false);
      const invokerRef = useRef<HTMLElement | null>(null);
      return (
        <>
          <button
            type="button"
            onClick={(event) => {
              invokerRef.current = event.currentTarget;
              setOpen(true);
            }}
          >
            Choose provider
          </button>
          <ProviderPicker
            open={open}
            providers={baseProviders}
            providerModelDiscovery={null}
            activeProvider="claude"
            activeModel="claude-sonnet-4-6"
            onSwitchProvider={vi.fn()}
            onOpenChange={setOpen}
            finalFocus={invokerRef}
          />
        </>
      );
    }

    render(<FocusHarness />);
    const opener = screen.getByRole("button", { name: "Choose provider" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("keeps modal authority while a provider switch is pending", async () => {
    let resolveSwitch: (() => void) | undefined;
    const onSwitchProvider = vi.fn(() => new Promise<void>((resolve) => {
      resolveSwitch = resolve;
    }));
    renderPickerHarness({ onSwitchProvider });

    fireEvent.click(screen.getByRole("option", { name: /Codex/ }));
    fireEvent.click(screen.getByRole("option", { name: "o3" }));
    await waitFor(() => expect(onSwitchProvider).toHaveBeenCalledWith("codex", "o3"));

    const dialog = screen.getByRole("dialog", { name: "Switch provider" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    const backdrop = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]');
    expect(backdrop).not.toBeNull();
    fireEvent.pointerDown(backdrop as HTMLElement);
    fireEvent.click(backdrop as HTMLElement);
    expect(screen.getByRole("dialog", { name: "Switch provider" })).toBeInTheDocument();

    resolveSwitch?.();
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Switch provider" })).not.toBeInTheDocument();
    });
  });

  it("collects API keys inside the governed picker instead of using a browser prompt", async () => {
    const onAuthenticateProvider = vi.fn().mockResolvedValue(undefined);
    const prompt = vi.spyOn(window, "prompt");
    renderPickerHarness({
      providers: [
        ...baseProviders,
        {
          id: "opencode-zen",
          label: "OpenCode Zen",
          group: "direct-api",
          free: false,
          available: false,
          models: [],
          reason: "OpenCode Zen API key is missing.",
          authState: "missing",
        },
      ],
      onAuthenticateProvider,
    });

    fireEvent.click(screen.getByRole("option", { name: /OpenCode Zen/ }));
    fireEvent.change(screen.getByLabelText("OpenCode Zen API key"), {
      target: { value: "test-api-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Authenticate" }));

    await waitFor(() => {
      expect(onAuthenticateProvider).toHaveBeenCalledWith("opencode-zen", { apiKey: "test-api-key", tier: "zen" });
    });
    expect(prompt).not.toHaveBeenCalled();
    prompt.mockRestore();
  });

  it("clears an API key before changing its provider authority", () => {
    renderPickerHarness({
      providers: [
        {
          id: "opencode-go",
          label: "OpenCode Go",
          group: "subscription",
          free: true,
          available: false,
          models: [],
          reason: "API key is missing.",
          authState: "missing",
        },
        {
          id: "opencode-zen",
          label: "OpenCode Zen",
          group: "direct-api",
          free: false,
          available: false,
          models: [],
          reason: "API key is missing.",
          authState: "missing",
        },
      ],
      onAuthenticateProvider: vi.fn(),
    });

    fireEvent.click(screen.getByRole("option", { name: /OpenCode Zen/ }));
    fireEvent.change(screen.getByLabelText("OpenCode Zen API key"), {
      target: { value: "zen-secret" },
    });
    fireEvent.click(screen.getByRole("option", { name: /OpenCode Go/ }));

    expect(screen.getByLabelText("OpenCode Go API key")).toHaveValue("");
  });

  it("projects only eligible discovered models and preserves observed evidence", () => {
    renderPickerHarness({
      providers: [{ ...baseProviders[1]!, models: ["stale-local-model"] }],
      activeProvider: "codex",
      activeModel: "gpt-5.5",
      providerModelDiscovery: {
        catalogEvidence: {
          status: "complete",
          source: { kind: "test", id: "provider-picker" },
          observedAt: "2026-08-10T00:00:00.000Z",
          counts: { total: 2, returned: 2, omitted: 0 },
        },
        entries: [
          {
            providerRoute: { providerId: "codex", providerModelId: "gpt-5.5" },
            eligibility: { eligible: true, reasonCodes: [] },
          },
          {
            providerRoute: { providerId: "codex", providerModelId: "blocked-model" },
            eligibility: { eligible: false, reasonCodes: ["policy_denied"] },
          },
        ] as GuiProviderModelDiscoveryProjection["entries"],
      },
    });

    expect(screen.getByRole("option", { name: /Codex/ })).toHaveTextContent("1 eligible / 2 observed");
    fireEvent.click(screen.getByRole("option", { name: /Codex/ }));
    expect(screen.getByRole("option", { name: "gpt-5.5" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "blocked-model" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "stale-local-model" })).not.toBeInTheDocument();
  });

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

    expect(unavailableProvider).toHaveAttribute("aria-disabled", "true");
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

  it("renders device-code auth link and code with copy actions", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderPickerHarness({
      providerAuthenticating: true,
      providerAuthProvider: "codex-oauth",
      providerAuthMessage: "Complete Codex sign-in in the browser, then return to Kiln.",
      providerAuthDetails: {
        method: "device_code",
        verificationUri: "https://chatgpt.com/activate",
        userCode: "ABCD-EFGH",
      },
    });

    expect(screen.getByText("https://chatgpt.com/activate")).toBeInTheDocument();
    expect(screen.getByText("ABCD-EFGH")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://chatgpt.com/activate");
    });
    expect(screen.getByText("Link copied.")).toBeInTheDocument();
  });

  it("renders browser OAuth as one secure sign-in action without a device code", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderPickerHarness({
      providerAuthenticating: true,
      providerAuthProvider: "codex-oauth",
      providerAuthMessage: "Complete Codex sign-in in the browser, then return to Kiln.",
      providerAuthDetails: {
        method: "browser_oauth",
        authorizationUri: "https://auth.openai.com/oauth/authorize?state=test",
      },
    });

    expect(screen.queryByText("Code")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy code" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open secure sign-in" }));
    expect(open).toHaveBeenCalledWith(
      "https://auth.openai.com/oauth/authorize?state=test",
      "_blank",
      "noopener,noreferrer",
    );
    open.mockRestore();
  });

  it("selects authenticatable providers without starting auth until Authenticate is pressed", async () => {
    const onAuthenticateProvider = vi.fn().mockResolvedValue(undefined);
    const onRefreshProviders = vi.fn().mockResolvedValue(undefined);
    renderPickerHarness({
      providers: [
        ...baseProviders,
        {
          id: "codex-oauth",
          label: "Codex OAuth",
          group: "subscription",
          free: true,
          available: false,
          models: [],
          reason: "Codex OAuth authentication is missing.",
          authState: "missing",
        },
      ],
      onAuthenticateProvider,
      onRefreshProviders,
    });

    fireEvent.click(screen.getByRole("option", { name: /Codex OAuth/ }));

    expect(onAuthenticateProvider).not.toHaveBeenCalled();
    expect(screen.getByText("Press Authenticate to start provider sign-in.")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Authenticate" })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Authenticate" }));

    await waitFor(() => {
      expect(onAuthenticateProvider).toHaveBeenCalledWith("codex-oauth", {});
    });
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

    expect(provider).toHaveAttribute("aria-disabled", "true");
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

    expect(provider).toHaveAttribute("aria-disabled", "true");
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
    const providerSearch = screen.getByRole("combobox", { name: "Filter providers" });

    fireEvent.keyDown(providerSearch, { key: "ArrowDown" });
    fireEvent.keyDown(providerSearch, { key: "Enter" });

    expect(screen.getByRole("listbox", { name: "Models" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "o3" })).toBeInTheDocument();
  });

  it("single-clicks through provider and model selection", async () => {
    const onSwitchProvider = vi.fn().mockResolvedValue(undefined);
    renderPickerHarness({ onSwitchProvider });

    fireEvent.click(screen.getByRole("option", { name: /Codex/ }));
    expect(screen.getByRole("listbox", { name: "Models" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter models" })).toHaveFocus();

    fireEvent.click(screen.getByRole("option", { name: "o4-mini" }));

    await waitFor(() => {
      expect(onSwitchProvider).toHaveBeenCalledWith("codex", "o4-mini");
    });
  });

  it("does not let command keyboard handling escape into dialog actions", () => {
    const onSwitchProvider = vi.fn();
    renderPickerHarness({ onSwitchProvider });

    fireEvent.click(screen.getByRole("option", { name: /Codex/ }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Close" }), { key: "Enter" });

    expect(onSwitchProvider).not.toHaveBeenCalled();
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
    fireEvent.click(screen.getByRole("option", { name: /OpenCode/ }));

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

    fireEvent.click(screen.getByRole("option", { name: /Claude/ }));

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

  it("Esc returns from models to providers, then Esc closes", async () => {
    renderPickerHarness();
    const providerSearch = screen.getByRole("combobox", { name: "Filter providers" });

    fireEvent.keyDown(providerSearch, { key: "ArrowDown" });
    fireEvent.keyDown(providerSearch, { key: "Enter" });
    expect(screen.getByRole("listbox", { name: "Models" })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Switch provider" }), { key: "Escape" });
    expect(screen.getByRole("listbox", { name: "Providers" })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Switch provider" }), { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Switch provider" })).not.toBeInTheDocument();
    });
  });

  it("awaits a successful provider switch before closing the dialog", async () => {
    const onSwitchProvider = vi.fn().mockResolvedValue(undefined);
    renderPickerHarness({ onSwitchProvider });
    const providerSearch = screen.getByRole("combobox", { name: "Filter providers" });

    fireEvent.keyDown(providerSearch, { key: "ArrowDown" }); // codex
    fireEvent.keyDown(providerSearch, { key: "Enter" }); // models pane
    const modelSearch = screen.getByRole("combobox", { name: "Filter models" });
    fireEvent.keyDown(modelSearch, { key: "ArrowDown" }); // o4-mini
    fireEvent.keyDown(modelSearch, { key: "Enter" });

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

    fireEvent.click(screen.getByRole("option", { name: /OpenRouter/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Filter models" }), {
      target: { value: "gemini" },
    });

    const modelList = screen.getByRole("listbox", { name: "Models" });
    expect(within(modelList).getAllByRole("option")).toHaveLength(1);
    expect(within(modelList).getByRole("option", { name: "google/gemini-2.5-pro" })).toBeInTheDocument();

    fireEvent.click(within(modelList).getByRole("option", { name: "google/gemini-2.5-pro" }));

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
      const providerSearch = screen.getByRole("combobox", { name: "Filter providers" });

      fireEvent.keyDown(providerSearch, { key: "ArrowDown" }); // codex
      fireEvent.keyDown(providerSearch, { key: "Enter" }); // models pane
      const modelSearch = screen.getByRole("combobox", { name: "Filter models" });
      fireEvent.keyDown(modelSearch, { key: "ArrowDown" }); // o4-mini
      fireEvent.keyDown(modelSearch, { key: "Enter" });

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
