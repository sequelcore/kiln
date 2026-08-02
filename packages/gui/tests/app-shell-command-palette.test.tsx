import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../src/components/app-shell.js";
import { useSessionStore } from "../src/lib/session-store.js";

const useQueryMock = vi.fn();
const waitForGatewayMock = vi.fn();
const waitForHealthMock = vi.fn();
const sendMock = vi.fn();
let wsState: "idle" | "connecting" | "open" | "reconnecting" | "closed" = "open";
const commandPalettePropsLog: Array<{ open: boolean }> = [];
const dashboardRefetchMock = vi.fn();
let appShellFrameInput: { onOperatorTerminalAvailability: (available: boolean) => void } | null = null;
const dashboardData = {
  providers: [],
  sessions: [],
  telemetry: {
    status: "idle" as const,
    dominantRegions: [],
    saturation: 0,
    entropy: 0,
  },
  continuationInfoByProvider: {},
  workingDirectory: "C:/workspace/kiln",
  domainLabel: "Kiln",
};

const dashboardOperatorWorkspaceHome = {
  mode: "read-only" as const,
  projectedAt: "2026-06-25T12:00:00.000Z",
  gatewayTargets: [],
  sessions: [],
  work: {
    totalCount: 0,
    activeCount: 0,
    blockedCount: 0,
    missingEvidenceCount: 0,
    goalCount: 0,
    activeGoalCount: 0,
    items: [],
  },
  managedAgents: {
    totalCount: 9,
    activeCount: 8,
    attentionCount: 7,
  },
  approvals: {
    pendingCount: 0,
    resolvedCount: 0,
    items: [],
  },
  configHealth: {
    status: "unknown" as const,
    issueCount: 0,
    items: [],
  },
  routeHealth: {
    totalCount: 0,
    admissionReadyCount: 0,
    admissionDegradedCount: 0,
    admissionBlockedCount: 0,
    admissionUnknownCount: 0,
    executionHealthyCount: 0,
    executionDegradedCount: 0,
    executionUnknownCount: 0,
    items: [],
  },
  providerReadiness: {
    totalCount: 0,
    liveProvenCount: 0,
    configuredCount: 0,
    unprovenCount: 0,
    unknownCount: 0,
    items: [],
  },
  gatewayHealth: {
    status: "unknown" as const,
    targetCount: 0,
    localCount: 0,
    remoteCount: 0,
    appTargetCount: 0,
    tenantTargetCount: 0,
    items: [],
  },
  resources: {
    totalCount: 0,
    linkedResourceCount: 0,
    items: [],
  },
  attention: {
    items: [],
    totalCount: 7,
    actionRequiredCount: 7,
    blockedCount: 0,
    failedCount: 0,
  },
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

vi.mock("../src/components/app-shell-frame-handler.js", () => ({
  createAppShellFrameHandler: (input: { onOperatorTerminalAvailability: (available: boolean) => void }) => {
    appShellFrameInput = input;
    return vi.fn();
  },
}));

vi.mock("../src/components/operator-terminal-dock.js", () => ({
  OPERATOR_TERMINAL_PANEL_ID: "operator-terminal-panel",
  OperatorTerminalDock: ({ expanded }: { expanded: boolean }) => (
    <section
      id="operator-terminal-panel"
      aria-label="Operator terminal"
      data-expanded={String(expanded)}
      hidden={!expanded}
    />
  ),
}));

vi.mock("../src/lib/wait-for-gateway.js", () => ({
  waitForGateway: (...args: unknown[]) => waitForGatewayMock(...args),
}));

vi.mock("../src/api/client.js", () => ({
  GuiGatewayClient: class {
    async waitForHealth(...args: unknown[]) {
      return waitForHealthMock(...args);
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
        continuationInfoByProvider: {},
        workingDirectory: "C:/workspace/kiln",
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
  Composer: ({
    commandMenu,
    onSubmit,
    onTogglePlanMode,
  }: {
    commandMenu: { onOpenChange: (open: boolean) => void };
    onSubmit: (text: string) => void;
    onTogglePlanMode: (enabled: boolean) => void;
  }) => (
    <div>
      <button type="button" onClick={() => commandMenu.onOpenChange(true)}>
        Open composer commands
      </button>
      <button type="button" onClick={() => onSubmit("hello target")}>
        Send test message
      </button>
      <button type="button" onClick={() => onTogglePlanMode(false)}>
        Switch to execute
      </button>
    </div>
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
    continuationTargetId: null,
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
    appShellFrameInput = null;
    commandPalettePropsLog.length = 0;
    installMatchMedia(false);
    resetStore();
    waitForGatewayMock.mockResolvedValue(undefined);
    waitForHealthMock.mockReset();
    waitForHealthMock.mockResolvedValue(undefined);
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

  it("toggles one persistent terminal panel across workbench surfaces with Ctrl+`", async () => {
    render(<AppShell />);

    await waitFor(() => {
      expect(appShellFrameInput).not.toBeNull();
    });
    act(() => appShellFrameInput?.onOperatorTerminalAvailability(true));

    const openTerminal = await screen.findByRole("button", { name: "Open terminal" });
    fireEvent.keyDown(window, { key: "`", code: "Backquote", ctrlKey: true });
    expect(openTerminal).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Operator terminal")).toHaveAttribute("data-expanded", "true");

    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    expect(screen.getByLabelText("Operator terminal")).toHaveAttribute("data-expanded", "true");

    fireEvent.keyDown(window, { key: "`", code: "Backquote", ctrlKey: true });
    expect(screen.getByRole("button", { name: "Open terminal" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Operator terminal")).not.toBeVisible();
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

  it("keys dashboard reads by the completed turn instead of refetching from an effect", async () => {
    const initialTurnCounter = useSessionStore.getState().turnCounter;
    render(<AppShell />);

    await waitFor(() => {
      expect(useQueryMock).toHaveBeenCalledWith(expect.objectContaining({
        queryKey: ["gui", "dashboard", "ready", initialTurnCounter],
      }));
    });
    dashboardRefetchMock.mockClear();

    act(() => {
      useSessionStore.setState({ turnCounter: initialTurnCounter + 1 });
    });

    await waitFor(() => {
      expect(useQueryMock).toHaveBeenCalledWith(expect.objectContaining({
        queryKey: ["gui", "dashboard", "ready", initialTurnCounter + 1],
      }));
    });
    expect(dashboardRefetchMock).not.toHaveBeenCalled();
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
    expect(screen.queryByText("C:/workspace/kiln")).not.toBeInTheDocument();
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

  it("uses the dashboard operator workspace home for managed-agent attention", async () => {
    dashboardQueryResult = {
      data: {
        ...dashboardData,
        operatorWorkspaceHome: dashboardOperatorWorkspaceHome,
      },
      error: null,
      isSuccess: true,
      refetch: dashboardRefetchMock,
    };

    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Agents" })).toHaveTextContent("7");
    });
  });

  it("sends composer messages with the selected gateway target identity", async () => {
    dashboardQueryResult = {
      data: {
        ...dashboardData,
        apps: [
          {
            name: "support",
            runtime: "tenant" as const,
            channels: ["api"],
            runtimeCapable: true,
            tenants: [{ tenantId: "acme", label: "ACME", enabled: true }],
          },
        ],
        activeAppName: "support",
        activeTenantId: "acme",
        operatorWorkspaceHome: {
          ...dashboardOperatorWorkspaceHome,
          gatewayTargets: [
            {
              instanceId: "app-gateway:support",
              label: "support",
              gatewayTarget: {
                targetId: "app-gateway:support",
                kind: "local-app-gateway" as const,
                trust: "local" as const,
                appId: "support",
              },
              sessionCount: 0,
              eventCount: 0,
              managedInvocationCount: 0,
              toolCallCount: 0,
              resourceLinkCount: 0,
              totalCostUsd: 0,
            },
            {
              instanceId: "app-gateway:support:tenant:acme",
              label: "ACME",
              gatewayTarget: {
                targetId: "app-gateway:support:tenant:acme",
                kind: "local-app-gateway" as const,
                trust: "local" as const,
                appId: "support",
                tenantId: "acme",
              },
              sessionCount: 0,
              eventCount: 0,
              managedInvocationCount: 0,
              toolCallCount: 0,
              resourceLinkCount: 0,
              totalCostUsd: 0,
            },
          ],
        },
      },
      error: null,
      isSuccess: true,
      refetch: dashboardRefetchMock,
    };

    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send test message" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Send test message" }));

    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
        type: "message",
        content: "hello target",
        gatewayTargetId: "app-gateway:support:tenant:acme",
        appName: "support",
        tenantId: "acme",
      }));
    });
  });

  it("sends approval responses with the selected gateway target identity", async () => {
    useSessionStore.setState({
      timelineEntries: [
        {
          id: "event:approval-1",
          type: "event",
          eventKind: "approval_requested",
          createdAt: "2026-06-25T12:03:00.000Z",
          title: "Approval requested",
          summary: "Apply bounded write",
          tone: "warning",
          details: {
            approvalId: "approval-1",
            action: "Apply bounded write",
          },
          sessionId: "session-1",
        },
      ],
    });
    dashboardQueryResult = {
      data: {
        ...dashboardData,
        apps: [
          {
            name: "support",
            runtime: "tenant" as const,
            channels: ["api"],
            runtimeCapable: true,
            tenants: [{ tenantId: "acme", label: "ACME", enabled: true }],
          },
        ],
        activeAppName: "support",
        activeTenantId: "acme",
        operatorWorkspaceHome: {
          ...dashboardOperatorWorkspaceHome,
          gatewayTargets: [
            {
              instanceId: "app-gateway:support:tenant:acme",
              label: "ACME",
              gatewayTarget: {
                targetId: "app-gateway:support:tenant:acme",
                kind: "local-app-gateway" as const,
                trust: "local" as const,
                appId: "support",
                tenantId: "acme",
              },
              sessionCount: 0,
              eventCount: 0,
              managedInvocationCount: 0,
              toolCallCount: 0,
              resourceLinkCount: 0,
              totalCostUsd: 0,
            },
          ],
        },
      },
      error: null,
      isSuccess: true,
      refetch: dashboardRefetchMock,
    };

    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));

    expect(sendMock).toHaveBeenCalledWith({
      type: "approve",
      approvalId: "approval-1",
      gatewayTargetId: "app-gateway:support:tenant:acme",
    });
    expect(sendMock).toHaveBeenCalledWith({
      type: "reject",
      approvalId: "approval-1",
      reason: "rejected by user",
      gatewayTargetId: "app-gateway:support:tenant:acme",
    });
  });

  it("sends execution mode transitions with the selected gateway target identity", async () => {
    useSessionStore.setState({ planMode: true });
    dashboardQueryResult = {
      data: {
        ...dashboardData,
        apps: [
          {
            name: "support",
            runtime: "tenant" as const,
            channels: ["api"],
            runtimeCapable: true,
            tenants: [{ tenantId: "acme", label: "ACME", enabled: true }],
          },
        ],
        activeAppName: "support",
        activeTenantId: "acme",
        operatorWorkspaceHome: {
          ...dashboardOperatorWorkspaceHome,
          gatewayTargets: [
            {
              instanceId: "app-gateway:support:tenant:acme",
              label: "ACME",
              gatewayTarget: {
                targetId: "app-gateway:support:tenant:acme",
                kind: "local-app-gateway" as const,
                trust: "local" as const,
                appId: "support",
                tenantId: "acme",
              },
              sessionCount: 0,
              eventCount: 0,
              managedInvocationCount: 0,
              toolCallCount: 0,
              resourceLinkCount: 0,
              totalCostUsd: 0,
            },
          ],
        },
      },
      error: null,
      isSuccess: true,
      refetch: dashboardRefetchMock,
    };

    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Switch to execute" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Switch to execute" }));

    expect(sendMock).toHaveBeenCalledWith({
      type: "execution_mode_transition",
      toMode: "execute",
      gatewayTargetId: "app-gateway:support:tenant:acme",
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

  it("retries gateway health when runtime bootstrap is blocked by provider discovery failure", async () => {
    dashboardQueryResult = {
      data: null,
      error: null,
      isSuccess: false,
      refetch: dashboardRefetchMock,
    };
    useSessionStore.setState({
      providerCatalogStatus: "error",
      providerCatalogError: "Could not load provider discovery.",
      providers: [],
      activeProvider: null,
      activeModel: null,
    });

    render(<AppShell />);

    expect(await screen.findByText("Kiln runtime needs attention")).toBeInTheDocument();
    await waitFor(() => {
      expect(waitForHealthMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(waitForHealthMock).toHaveBeenCalledTimes(2);
    });
    expect(dashboardRefetchMock).toHaveBeenCalled();
  });
});
