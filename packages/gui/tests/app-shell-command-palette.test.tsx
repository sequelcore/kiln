import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../src/components/app-shell.js";
import { useSessionStore } from "../src/lib/session-store.js";

const useQueryMock = vi.fn();
const waitForGatewayMock = vi.fn();
const sendMock = vi.fn();
let wsState: "idle" | "connecting" | "open" | "reconnecting" | "closed" = "open";
const commandPalettePropsLog: Array<{ open: boolean }> = [];
const dashboardRefetchMock = vi.fn();
const dashboardData = {
  providers: [],
  sessions: [],
  telemetry: {
    status: "idle" as const,
    dominantRegions: [],
    saturation: 0,
    entropy: 0,
  },
  resumeInfoByProvider: {},
  workingDirectory: "C:/Proyectos/Sequel/kiln",
  domainLabel: "Kiln",
};
let dashboardQueryResult: {
  data: typeof dashboardData | null;
  error: Error | null;
  isSuccess: boolean;
  refetch: typeof dashboardRefetchMock;
};

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => useQueryMock(options),
}));

vi.mock("../src/lib/use-gui-ws.js", () => ({
  useGuiWs: () => ({
    state: wsState,
    send: sendMock,
  }),
}));

vi.mock("../src/lib/wait-for-gateway.js", () => ({
  waitForGateway: (...args: unknown[]) => waitForGatewayMock(...args),
}));

vi.mock("../src/api/client.js", () => ({
  GuiGatewayClient: class {
    async waitForHealth() {
      return undefined;
    }

    async loadSessions() {
      return [];
    }

    async loadDashboard() {
      return {
        providers: [],
        sessions: [],
        telemetry: {
          status: "idle",
          dominantRegions: [],
          saturation: 0,
          entropy: 0,
        },
        resumeInfoByProvider: {},
        workingDirectory: "C:/Proyectos/Sequel/kiln",
        domainLabel: "Kiln",
      };
    }

    async saveThemePreference() {}
    async notifyWindowClosed() {}
  },
}));

vi.mock("../src/components/command-palette.js", () => ({
  CommandPalette: (props: { open: boolean }) => {
    commandPalettePropsLog.push({ open: props.open });
    return <div data-testid="command-palette-probe" data-open={String(props.open)} />;
  },
}));

vi.mock("../src/components/error-banner.js", () => ({
  ErrorBanner: ({ message }: { message: string }) => <div>{message}</div>,
}));

vi.mock("../src/components/theme-switcher.js", () => ({
  ThemeSwitcher: () => <button type="button">Theme</button>,
}));

vi.mock("../src/components/provider-picker.js", () => ({
  ProviderPicker: () => null,
}));

vi.mock("../src/components/provider-status.js", () => ({
  ProviderStatus: () => <div>Provider status</div>,
}));

vi.mock("../src/components/transcript.js", () => ({
  Transcript: () => <div>Transcript</div>,
}));

vi.mock("../src/components/composer.js", () => ({
  Composer: ({ commandMenu }: { commandMenu: { onOpenChange: (open: boolean) => void } }) => (
    <button type="button" onClick={() => commandMenu.onOpenChange(true)}>
      Open composer commands
    </button>
  ),
}));

vi.mock("../src/components/session-list.js", () => ({
  SessionList: () => <div data-testid="session-list">Session list</div>,
}));

vi.mock("../src/components/workspace-panel.js", () => ({
  WorkspacePanel: (props: { gatewayWorkingDirectory?: string }) => (
    <div>
      <span>Workspace</span>
      <span>{props.gatewayWorkingDirectory ?? "no dashboard working directory"}</span>
    </div>
  ),
}));

vi.mock("../src/components/changed-files-panel.js", () => ({
  ChangedFilesPanel: () => <div>Changed files</div>,
}));

vi.mock("../src/components/approvals-panel.js", () => ({
  ApprovalsPanel: () => <div>Approvals</div>,
}));

vi.mock("../src/components/activity-log-panel.js", () => ({
  ActivityLogPanel: () => <div>Activity</div>,
}));

function installMatchMedia(matches: boolean): void {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
    addListener: (listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeListener: (listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
    dispatchEvent: (event: Event) => {
      for (const listener of listeners) {
        listener(event as MediaQueryListEvent);
      }
      return true;
    },
  }));
}

function resetStore(): void {
  useSessionStore.setState({
    status: "ready",
    messages: [],
    timelineEntries: [],
    currentAssistant: null,
    planMode: false,
    activity: null,
    errorBanner: null,
    providerCatalogStatus: "ready",
    providerCatalogError: null,
    providers: [],
    activeProvider: "claude",
    activeModel: "claude-sonnet-4-6",
    sessionList: [],
    selectedSessionId: null,
    resumeTargetId: null,
    routedProvider: null,
    routedModel: null,
    routeMode: "auto",
    respondingProvider: null,
    respondingModel: null,
    turnCounter: 3,
    sessionCostUsd: 0.25,
    inputTokens: 1_000,
    outputTokens: 500,
    currentTurnTrackedInputTokens: 0,
    currentTurnTrackedOutputTokens: 0,
    clearPending: false,
    providerSwitching: false,
    providerExplicitSelection: false,
    authorityStatus: null,
    outboundSend: null,
    clearTimeoutId: null,
    providerSwitchTimeoutId: null,
    activityPhase: "idle",
  });
}

function latestPaletteProps(): { open: boolean } | undefined {
  return commandPalettePropsLog.at(-1);
}

describe("AppShell command palette and telemetry regressions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    wsState = "open";
    commandPalettePropsLog.length = 0;
    installMatchMedia(false);
    resetStore();
    waitForGatewayMock.mockResolvedValue(undefined);
    dashboardRefetchMock.mockReset();
    dashboardQueryResult = {
      data: dashboardData,
      error: null,
      isSuccess: true,
      refetch: dashboardRefetchMock,
    };
    useQueryMock.mockImplementation((options: { queryKey?: readonly unknown[] }) => {
      const queryKey = options.queryKey?.join(":") ?? "";
      if (queryKey.includes("sessions")) {
        return {
          data: [],
          error: null,
        };
      }
      if (queryKey.includes("session-detail")) {
        return {
          data: null,
          error: null,
        };
      }
      return dashboardQueryResult;
    });
  });

  it("opens the global command palette from Ctrl+K and Cmd+K", async () => {
    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open composer commands" })).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => {
      expect(latestPaletteProps()?.open).toBe(true);
    });

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => {
      expect(latestPaletteProps()?.open).toBe(false);
    });

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await waitFor(() => {
      expect(latestPaletteProps()?.open).toBe(true);
    });
  });

  it("keeps composer-triggered commands out of the global palette", async () => {
    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open composer commands" })).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => {
      expect(latestPaletteProps()?.open).toBe(true);
    });

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => {
      expect(latestPaletteProps()?.open).toBe(false);
    });

    fireEvent.click(screen.getByRole("button", { name: "Open composer commands" }));
    expect(latestPaletteProps()?.open).toBe(false);
  });

  it("keeps session telemetry out of the primary chat chrome", async () => {
    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open composer commands" })).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: "Details" })).not.toBeInTheDocument();
    expect(screen.queryByText(/turns/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tokens/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/cost/i)).not.toBeInTheDocument();
  });

  it("does not install an outbound sender while the websocket is reconnecting", async () => {
    wsState = "reconnecting";

    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open composer commands" })).toBeInTheDocument();
    });

    expect(useSessionStore.getState().outboundSend).toBeNull();
  });

  it("does not disconnect the session store during websocket state transitions", async () => {
    const originalDisconnect = useSessionStore.getState().disconnect;
    const disconnectMock = vi.fn();
    useSessionStore.setState({ disconnect: disconnectMock });

    try {
      wsState = "open";
      const { rerender, unmount } = render(<AppShell />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Open composer commands" })).toBeInTheDocument();
      });

      wsState = "reconnecting";
      rerender(<AppShell />);

      expect(disconnectMock).not.toHaveBeenCalled();

      unmount();
      expect(disconnectMock).toHaveBeenCalledOnce();
    } finally {
      useSessionStore.setState({ disconnect: originalDisconnect });
    }
  });

  it("keeps the dashboard error banner while cached dashboard data is present and only clears it after the error becomes null", async () => {
    dashboardQueryResult = {
      data: null,
      error: new Error("dashboard failed"),
      isSuccess: false,
      refetch: dashboardRefetchMock,
    };

    const { rerender } = render(<AppShell />);

    expect(await screen.findByText("Could not load dashboard state.")).toBeInTheDocument();

    const staleDashboardData = {
      ...dashboardData,
      telemetry: {
        status: "active",
        dominantRegions: ["stale-region"],
        saturation: 0.91,
        entropy: 0.77,
      },
    };
    dashboardQueryResult = {
      data: staleDashboardData,
      error: new Error("dashboard still failed"),
      isSuccess: true,
      refetch: dashboardRefetchMock,
    };

    rerender(<AppShell />);

    await waitFor(() => {
      expect(screen.getByText("Could not load dashboard state.")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    expect(screen.queryByText("C:/Proyectos/Sequel/kiln")).not.toBeInTheDocument();
    expect(screen.getByText("no dashboard working directory")).toBeInTheDocument();
    expect(screen.queryByText("dom: stale-region")).not.toBeInTheDocument();

    dashboardQueryResult = {
      data: dashboardData,
      error: null,
      isSuccess: true,
      refetch: dashboardRefetchMock,
    };

    rerender(<AppShell />);

    await waitFor(() => {
      expect(screen.queryByText("Could not load dashboard state.")).not.toBeInTheDocument();
    });
  });

  it("applies fresh dashboard providers to the provider store", async () => {
    dashboardQueryResult = {
      data: {
        ...dashboardData,
        providers: [
          {
            id: "openai",
            label: "OpenAI",
            group: "direct-api" as const,
            free: false,
            available: true,
            models: ["gpt-5.4"],
          },
        ],
      },
      error: null,
      isSuccess: true,
      refetch: dashboardRefetchMock,
    };

    render(<AppShell />);

    await waitFor(() => {
      expect(useSessionStore.getState().providers).toEqual([
        expect.objectContaining({
          id: "openai",
          available: true,
          models: ["gpt-5.4"],
        }),
      ]);
    });
  });

  it("wraps the app in a runtime bootstrap gate until provider discovery settles", async () => {
    dashboardQueryResult = {
      data: null,
      error: null,
      isSuccess: false,
      refetch: dashboardRefetchMock,
    };
    useSessionStore.setState({
      providerCatalogStatus: "pending",
      providerCatalogError: null,
      providers: [],
      activeProvider: null,
      activeModel: null,
    });

    render(<AppShell />);

    expect(await screen.findByRole("status", { name: "Runtime bootstrap" })).toBeInTheDocument();
    expect(screen.getByText("Starting Kiln runtime")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New Session" })).not.toBeInTheDocument();
  });
});
