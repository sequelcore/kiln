import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GuiProviderModelDiscoveryProjection } from "@kilnai/gateway-contracts";
import { AppShell } from "../src/components/app-shell.js";
import { useSessionStore } from "../src/lib/session-store/index.js";

const useQueryMock = vi.fn();
const waitForGatewayMock = vi.fn();
const sendMock = vi.fn();
const sessionsData = [
  {
    sessionId: "session-1",
    title: "First task",
    tags: [],
    routesUsed: ["claude-default"],
    lastRoute: { routeId: "claude-default", provider: "claude" },
    updatedAt: "2026-04-21T20:00:00.000Z",
    costUsd: 0.1,
  },
] as const;
const dashboardData = {
  providers: [],
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
const dashboardRefetchMock = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => useQueryMock(options),
}));

vi.mock("../src/lib/use-gui-ws.js", () => ({
  useGuiWs: () => ({
    state: "open",
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

    async loadOperatorSessionHistory() {
      return sessionsData;
    }

    async loadDashboard() {
      return {
        providers: [],
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
  },
}));

vi.mock("../src/components/command-palette.js", () => ({
  CommandPalette: () => null,
}));

vi.mock("../src/components/execution-route-picker.js", () => ({
  ExecutionRoutePicker: () => null,
}));

vi.mock("../src/components/provider-status.js", () => ({
  ProviderStatus: () => <div>Provider status</div>,
}));

vi.mock("../src/components/transcript.js", () => ({
  Transcript: () => <div>Transcript</div>,
}));

vi.mock("../src/components/composer.js", () => ({
  Composer: () => <div>Composer</div>,
}));

vi.mock("../src/components/session-list.js", () => ({
  SessionList: () => <div data-testid="session-list">Session list</div>,
}));

vi.mock("../src/components/workspace-panel.js", () => ({
  WorkspacePanel: () => <div>Workspace</div>,
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
    providerCatalogStatus: "ready",
    providerCatalogError: null,
    providers: [{
      id: "claude",
      label: "Claude",
      group: "harness",
      free: false,
      available: true,
      models: ["claude-sonnet-4-6"],
    }],
    providerModelDiscovery: providerModelDiscovery("claude", "claude-sonnet-4-6"),
    activeProvider: null,
    activeModel: null,
    sessionList: [],
    selectedSessionId: null,
    continuationTargetId: null,
    routedProvider: null,
    routedModel: null,
    routeMode: "auto",
    respondingProvider: null,
    respondingModel: null,
    turnCounter: 0,
    sessionCostUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
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

function providerModelDiscovery(
  providerId: string,
  providerModelId: string,
): GuiProviderModelDiscoveryProjection {
  return {
    catalogEvidence: {
      status: "complete",
      source: { kind: "test", id: "app-shell-responsive" },
      observedAt: "2026-07-01T00:00:00.000Z",
      counts: { total: 1, returned: 1, omitted: 0 },
    },
    entries: [{
      providerRoute: { providerId, providerModelId },
      eligibility: { eligible: true, reasonCodes: [] },
    } as GuiProviderModelDiscoveryProjection["entries"][number]],
  };
}

describe("AppShell responsive sidebar", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installMatchMedia(true);
    resetStore();
    waitForGatewayMock.mockResolvedValue(undefined);
    useQueryMock.mockImplementation((options: { queryKey?: readonly unknown[] }) => {
      const queryKey = options.queryKey?.join(":") ?? "";
      if (queryKey.includes("sessions")) {
        return {
          data: sessionsData,
          error: null,
        };
      }
      if (queryKey.includes("session-detail")) {
        return {
          data: null,
          error: null,
        };
      }
      return {
        data: dashboardData,
        error: null,
        refetch: dashboardRefetchMock,
      };
    });
  });

  it("collapses the sidebar into a drawer on narrow viewports", async () => {
    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open session drawer" })).toBeInTheDocument();
    });
    expect(screen.getByRole("region", { name: "Chat workspace" })).toHaveAttribute("data-chat-layout", "landing");
    expect(screen.queryByRole("button", { name: "Theme" })).not.toBeInTheDocument();

    expect(screen.queryByRole("dialog", { name: "Sessions drawer" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open session drawer" }));

    const drawer = await screen.findByRole("dialog", { name: "Sessions drawer" });
    expect(drawer).toBeInTheDocument();
    expect(screen.getByTestId("session-list")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close session drawer" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Sessions drawer" })).not.toBeInTheDocument();
    });
  });

});
