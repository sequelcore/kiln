import type { GuiProviderModelDiscoveryProjection } from "@kilnai/gateway-contracts";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef, useState } from "react";
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
  onAuthenticateProvider?: (
    provider: string,
    options?: { apiKey?: string; tier?: "go" | "zen" },
  ) => void | Promise<void>;
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

function searchRoutes(query: string): HTMLElement {
  const search = screen.getByRole("combobox", { name: "Search provider routes" });
  fireEvent.change(search, { target: { value: query } });
  return screen.getByRole("listbox", { name: "Provider routes" });
}

describe("ProviderPicker", () => {
  it("searches provider routes by provider or model and switches the concrete route directly", async () => {
    const onSwitchProvider = vi.fn().mockResolvedValue(undefined);
    renderPickerHarness({
      onSwitchProvider,
      providers: [
        ...baseProviders,
        {
          id: "openrouter",
          label: "OpenRouter",
          group: "direct-api",
          free: true,
          available: true,
          models: ["openai/gpt-4.1", "google/gemini-2.5-pro"],
        },
      ],
    });

    const routeList = searchRoutes("gemini");
    const routes = within(routeList).getAllByRole("option");
    expect(routes).toHaveLength(1);
    expect(routes[0]).toHaveAccessibleName("OpenRouter, google/gemini-2.5-pro");

    fireEvent.click(routes[0]!);
    await waitFor(() => {
      expect(onSwitchProvider).toHaveBeenCalledWith("openrouter", "google/gemini-2.5-pro");
    });
  });

  it("uses one anchored popover and command composition for all routes", () => {
    renderPickerHarness();

    const popover = document.querySelector<HTMLElement>('[data-slot="popover-content"]');
    expect(popover).not.toBeNull();
    expect(within(popover as HTMLElement).getByRole("combobox", { name: "Search provider routes" })).toBeInTheDocument();
    expect(within(popover as HTMLElement).getByRole("listbox", { name: "Provider routes" })).toBeInTheDocument();
    expect(popover?.querySelector('[data-slot="command"]')).toBeInTheDocument();
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
  });

  it("consolidates provider variants into a brand rail and filters routes by brand", () => {
    renderPickerHarness({
      providers: [
        ...baseProviders,
        {
          id: "opencode-go",
          label: "OpenCode Go",
          group: "subscription",
          free: true,
          available: true,
          models: ["kimi-k2.5"],
        },
        {
          id: "opencode-zen",
          label: "OpenCode Zen",
          group: "direct-api",
          free: false,
          available: true,
          models: ["claude-sonnet-4-6"],
        },
      ],
    });

    const providerRail = screen.getByRole("group", { name: "Providers" });
    expect(within(providerRail).getAllByRole("button", { name: "OpenCode" })).toHaveLength(1);
    fireEvent.click(within(providerRail).getByRole("button", { name: "OpenCode" }));

    const routeList = screen.getByRole("listbox", { name: "Provider routes" });
    expect(within(routeList).getByRole("option", { name: "OpenCode Go, kimi-k2.5" })).toBeInTheDocument();
    expect(within(routeList).getByRole("option", { name: "OpenCode Zen, claude-sonnet-4-6" })).toBeInTheDocument();
    expect(within(routeList).queryByRole("option", { name: /Codex/ })).not.toBeInTheDocument();
  });

  it("filters canonical local routes without inferring locality from provider ids in the picker", async () => {
    renderPickerHarness({
      providers: [
        ...baseProviders,
        { id: "openai", label: "OpenAI", group: "direct-api", free: false, available: true, models: ["gpt-5"] },
        { id: "ollama", label: "Ollama", group: "direct-api", free: true, available: true, models: ["qwen3"] },
      ],
    });

    const routeTypeInput = document.querySelector<HTMLInputElement>('input[name="provider-route-type"]');
    expect(routeTypeInput).not.toBeNull();
    fireEvent.change(routeTypeInput as HTMLInputElement, { target: { value: "local" } });
    const routeList = screen.getByRole("listbox", { name: "Provider routes" });
    await waitFor(() => {
      expect(within(routeList).getByRole("option", { name: "Ollama, qwen3" })).toBeInTheDocument();
      expect(within(routeList).queryByRole("option", { name: "OpenAI, gpt-5" })).not.toBeInTheDocument();
    });
  });

  it("renders official provider marks and one secondary route-type filter", () => {
    renderPickerHarness({
      providers: [
        ...baseProviders,
        {
          id: "codex-oauth",
          label: "Codex OAuth",
          group: "subscription",
          free: true,
          available: true,
          models: ["gpt-5.6"],
        },
        { id: "openai", label: "OpenAI", group: "direct-api", free: false, available: true, models: ["gpt-5"] },
      ],
    });

    expect(screen.getByRole("combobox", { name: "Route type" })).toHaveTextContent("Route type");
    expect(screen.queryByRole("button", { name: "Subscription routes" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Codex OAuth, gpt-5.6" }).querySelector('[data-provider-brand="codex"]'),
    ).not.toBeNull();
  });

  it("combines provider brand and route type without clearing either filter", async () => {
    renderPickerHarness({
      providers: [
        ...baseProviders,
        {
          id: "opencode-go",
          label: "OpenCode Go",
          group: "subscription",
          free: true,
          available: true,
          models: ["kimi-k2.5"],
        },
        {
          id: "opencode-zen",
          label: "OpenCode Zen",
          group: "direct-api",
          free: false,
          available: true,
          models: ["claude-sonnet-4-6"],
        },
      ],
    });

    const openCode = within(screen.getByRole("group", { name: "Providers" })).getByRole("button", {
      name: "OpenCode",
    });
    fireEvent.click(openCode);
    const routeTypeInput = document.querySelector<HTMLInputElement>('input[name="provider-route-type"]');
    expect(routeTypeInput).not.toBeNull();
    fireEvent.change(routeTypeInput as HTMLInputElement, { target: { value: "subscription" } });

    const routeList = screen.getByRole("listbox", { name: "Provider routes" });
    await waitFor(() => {
      expect(openCode).toHaveAttribute("aria-pressed", "true");
      expect(within(routeList).getByRole("option", { name: "OpenCode Go, kimi-k2.5" })).toBeInTheDocument();
      expect(within(routeList).queryByRole("option", { name: /OpenCode Zen/ })).not.toBeInTheDocument();
      expect(within(routeList).queryByRole("option", { name: /Codex/ })).not.toBeInTheDocument();
    });
  });

  it("exposes the exact active route independently from keyboard highlight", () => {
    renderPickerHarness();
    expect(screen.getByRole("option", { name: "Claude, claude-sonnet-4-6, Current" })).toBeInTheDocument();
  });

  it("switches the filtered route with keyboard selection", async () => {
    const onSwitchProvider = vi.fn().mockResolvedValue(undefined);
    renderPickerHarness({ onSwitchProvider });
    const search = screen.getByRole("combobox", { name: "Search provider routes" });
    fireEvent.change(search, { target: { value: "o4-mini" } });
    fireEvent.keyDown(search, { key: "Enter" });

    await waitFor(() => {
      expect(onSwitchProvider).toHaveBeenCalledWith("codex", "o4-mini");
    });
  });

  it("dismisses from outside the anchored surface when no operation is active", async () => {
    renderPickerHarness();
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull();
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Switch provider route" })).not.toBeInTheDocument();
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
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Switch provider route" }), { key: "Escape" });
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("keeps the picker stable while a provider switch is pending", async () => {
    let resolveSwitch: (() => void) | undefined;
    const onSwitchProvider = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSwitch = resolve;
        }),
    );
    renderPickerHarness({ onSwitchProvider });

    fireEvent.click(screen.getByRole("option", { name: "Codex, o3" }));
    await waitFor(() => expect(onSwitchProvider).toHaveBeenCalledWith("codex", "o3"));
    const dialog = screen.getByRole("dialog", { name: "Switch provider route" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(dialog).toBeInTheDocument();

    resolveSwitch?.();
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Switch provider route" })).not.toBeInTheDocument();
    });
  });

  it("requires an explicit Authenticate action for an authenticatable provider", async () => {
    const onAuthenticateProvider = vi.fn().mockResolvedValue(undefined);
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
    });

    fireEvent.click(screen.getByRole("option", { name: "Codex OAuth, No model selection" }));
    expect(onAuthenticateProvider).not.toHaveBeenCalled();
    expect(screen.getByText("Press Authenticate to start provider sign-in.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Authenticate" }));

    await waitFor(() => {
      expect(onAuthenticateProvider).toHaveBeenCalledWith("codex-oauth", {});
    });
  });

  it("collects API keys inside the governed picker and clears them across provider authority", async () => {
    const onAuthenticateProvider = vi.fn().mockResolvedValue(undefined);
    const prompt = vi.spyOn(window, "prompt");
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
      onAuthenticateProvider,
    });

    fireEvent.click(screen.getByRole("option", { name: "OpenCode Zen, No model selection" }));
    fireEvent.change(screen.getByLabelText("OpenCode Zen API key"), { target: { value: "test-api-key" } });
    fireEvent.click(screen.getByRole("option", { name: "OpenCode Go, No model selection" }));
    expect(screen.getByLabelText("OpenCode Go API key")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("OpenCode Go API key"), { target: { value: "go-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Authenticate" }));

    await waitFor(() => {
      expect(onAuthenticateProvider).toHaveBeenCalledWith("opencode-go", { apiKey: "go-key", tier: "go" });
    });
    expect(prompt).not.toHaveBeenCalled();
    prompt.mockRestore();
  });

  it("projects only eligible discovered routes and preserves observed evidence", () => {
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

    expect(screen.getByRole("option", { name: "Codex, gpt-5.5, Current" })).toHaveTextContent(
      "1 eligible / 2 observed",
    );
    expect(screen.queryByText("blocked-model")).not.toBeInTheDocument();
    expect(screen.queryByText("stale-local-model")).not.toBeInTheDocument();
  });

  it("ignores unknown providers and disables unavailable providers without auth", () => {
    const onSwitchProvider = vi.fn();
    renderPickerHarness({
      onSwitchProvider,
      providers: [
        ...baseProviders,
        {
          id: "unknown-provider",
          label: "Unknown",
          group: "direct-api",
          free: false,
          available: true,
          models: ["mystery"],
        },
        {
          id: "openai",
          label: "OpenAI",
          group: "direct-api",
          free: false,
          available: false,
          models: [],
          reason: "Connection failed.",
        },
      ],
    });

    expect(screen.queryByText("mystery")).not.toBeInTheDocument();
    const unavailable = screen.getByRole("option", { name: "OpenAI, No model selection" });
    expect(unavailable).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(unavailable);
    expect(onSwitchProvider).not.toHaveBeenCalled();
  });

  it("refreshes discovery in place with an accessible pending state", async () => {
    let finishRefresh: (() => void) | undefined;
    const onRefreshProviders = vi.fn(() => new Promise<void>((resolve) => {
      finishRefresh = resolve;
    }));
    renderPickerHarness({ onRefreshProviders });
    fireEvent.click(screen.getByRole("button", { name: "Refresh providers" }));
    await waitFor(() => expect(onRefreshProviders).toHaveBeenCalledOnce());

    const refreshing = screen.getByRole("button", { name: "Refreshing providers" });
    expect(refreshing).toBeDisabled();
    expect(refreshing).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("dialog", { name: "Switch provider route" })).toBeInTheDocument();

    finishRefresh?.();
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh providers" })).toBeEnabled());
  });

  it("keeps the usable picker open and reports a background refresh failure inline", async () => {
    const onRefreshProviders = vi.fn().mockRejectedValue(new Error("Could not refresh provider discovery."));
    renderPickerHarness({ onRefreshProviders });

    fireEvent.click(screen.getByRole("button", { name: "Refresh providers" }));

    expect(await screen.findByText("Could not refresh provider discovery.")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Switch provider route" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh providers" })).toBeEnabled();
  });

  it("renders device-code auth evidence with copy actions", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderPickerHarness({
      providerAuthenticating: true,
      providerAuthProvider: "codex-oauth",
      providerAuthMessage: "Complete sign-in in the browser, then return to Kiln.",
      providerAuthDetails: {
        method: "device_code",
        verificationUri: "https://example.test/activate",
        userCode: "ABCD-EFGH",
      },
    });

    expect(screen.getByText("ABCD-EFGH")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://example.test/activate"));
    expect(screen.getByRole("status")).toHaveTextContent("Link copied.");
  });

  it("renders browser OAuth as one secure sign-in action", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderPickerHarness({
      providerAuthenticating: true,
      providerAuthDetails: { method: "browser_oauth", authorizationUri: "https://example.test/oauth" },
    });

    expect(screen.queryByRole("button", { name: "Copy code" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open secure sign-in" }));
    expect(open).toHaveBeenCalledWith("https://example.test/oauth", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("switches an available model-less provider directly", async () => {
    const onSwitchProvider = vi.fn().mockResolvedValue(undefined);
    renderPickerHarness({
      activeProvider: "codex",
      activeModel: "o3",
      onSwitchProvider,
      providers: [
        { id: "claude", label: "Claude", group: "harness", free: false, available: true, models: [] },
        { id: "codex", label: "Codex", group: "harness", free: false, available: true, models: ["o3"] },
      ],
    });

    fireEvent.click(screen.getByRole("option", { name: "Claude, No model selection" }));
    await waitFor(() => expect(onSwitchProvider).toHaveBeenCalledWith("claude", undefined));
  });

  it("closes on Escape from the unified route list", async () => {
    renderPickerHarness();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Switch provider route" }), { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Switch provider route" })).not.toBeInTheDocument();
    });
  });

  it("keeps the picker open and exposes an actionable error when switching rejects", async () => {
    const onSwitchProvider = vi.fn().mockRejectedValue(new Error("socket closed"));
    renderPickerHarness({ onSwitchProvider });
    fireEvent.click(screen.getByRole("option", { name: "Codex, o4-mini" }));

    await waitFor(() => expect(onSwitchProvider).toHaveBeenCalledWith("codex", "o4-mini"));
    expect(await screen.findByText("socket closed")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Switch provider route" })).toBeInTheDocument();
  });

  it("exposes filter semantics and one selected route", async () => {
    renderPickerHarness();
    expect(screen.getByRole("combobox", { name: "Route type" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("option", { selected: true })).toHaveLength(1));
  });
});
