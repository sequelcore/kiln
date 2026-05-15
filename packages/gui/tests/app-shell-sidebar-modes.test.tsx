import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { GuiInboundFrame } from "@kilnai/gateway-contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../src/components/app-shell.js";
import { useSessionStore } from "../src/lib/session-store.js";

const useQueryMock = vi.fn();
const waitForGatewayMock = vi.fn();
const sendMock = vi.fn();
let guiWsOnFrame: ((frame: GuiInboundFrame) => void) | null = null;

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => useQueryMock(options),
}));

vi.mock("../src/lib/use-gui-ws.js", () => ({
  useGuiWs: (_baseUrl: string, options?: { onFrame?: (frame: GuiInboundFrame) => void }) => {
    guiWsOnFrame = options?.onFrame ?? null;
    return {
    state: "open",
    send: sendMock,
    };
  },
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
      return useSessionStore.getState().sessionList;
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

    async loadWorkspaceFile() {
      return {
        path: "C:/Proyectos/Sequel/kiln/package.json",
        name: "package.json",
        kind: "text",
        sizeBytes: 17,
        source: "gateway",
        encoding: "utf-8",
        language: "json",
        content: "{\"ok\":true}",
      };
    }

    async loadMemoryLatticeGraph() {
      return {
        snapshot: {
          nodes: [{
            id: "memory:record-1",
            recordId: "record-1",
            layer: "semantic",
            scope: { kind: "project", id: "kiln" },
            label: "Memory Lattice contract",
            score: 1,
          }],
          edges: [],
          limits: { maxNodes: 25, maxEdges: 50 },
          truncated: false,
        },
        filters: { depth: 0 },
      };
    }

    async loadConfigSetup() {
      return {
        projectRoot: "C:/Proyectos/Sequel/kiln",
        projectContext: {
          path: "C:/Proyectos/Sequel/kiln/.kiln/project-context.md",
          status: "valid",
          recommendation: "none",
        },
        repoShims: [
          {
            target: "agents",
            targetId: "repo-shim:agents",
            path: "C:/Proyectos/Sequel/kiln/AGENTS.md",
            status: "current",
            recommendation: "none",
          },
        ],
        nativeProjections: [],
        recommendedActions: ["none"],
      };
    }

    async saveThemePreference() {}
  },
}));

vi.mock("../src/components/command-palette.js", () => ({
  CommandPalette: () => null,
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
  Transcript: ({ entries }: { entries: readonly { id: string; title?: string }[] }) => (
    <div data-testid="transcript-probe">
      Transcript entries: {entries.length}
      {entries.map((entry) => (
        <span key={entry.id}>{entry.title}</span>
      ))}
    </div>
  ),
}));

vi.mock("../src/components/composer.js", () => ({
  Composer: () => <div>Composer</div>,
}));

vi.mock("../src/components/session-list.js", () => ({
  SessionList: () => <div data-testid="session-list">Session list</div>,
}));

vi.mock("../src/components/workspace-panel.js", () => ({
  WorkspacePanel: ({
    selectedSessionId,
    selectedFilePath,
    onOpenFile,
  }: {
    selectedSessionId: string | null;
    selectedFilePath?: string | null;
    onOpenFile?: (entry: { path: string; name: string; kind: "file" }) => void;
  }) => (
    <div data-testid="workspace-panel">
      Workspace panel: {selectedSessionId ?? "none"}
      <span>Selected file: {selectedFilePath ?? "none"}</span>
      <button
        type="button"
        onClick={() => onOpenFile?.({
          path: "C:/Proyectos/Sequel/kiln/package.json",
          name: "package.json",
          kind: "file",
        })}
      >
        Open package.json
      </button>
    </div>
  ),
}));

vi.mock("../src/components/changed-files-panel.js", () => ({
  ChangedFilesPanel: ({ files }: { files: readonly { path: string }[] }) => (
    <div data-testid="changed-files-panel">Changed files: {files.length}</div>
  ),
}));

vi.mock("../src/components/approvals-panel.js", () => ({
  ApprovalsPanel: ({ approvals }: { approvals: readonly { id: string }[] }) => (
    <div data-testid="approvals-panel">Approvals: {approvals.length}</div>
  ),
}));

vi.mock("../src/components/activity-log-panel.js", () => ({
  ActivityLogPanel: ({ entries }: { entries: readonly { id: string }[] }) => (
    <div data-testid="activity-log-panel">Activity: {entries.length}</div>
  ),
}));

function installMatchMedia(matches: boolean): void {
  vi.stubGlobal("matchMedia", () => ({
    matches,
    media: "(max-width: 1024px)",
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  }));
}

function resetStore(): void {
  useSessionStore.setState({
    status: "ready",
    messages: [],
    timelineEntries: [
      {
        id: "event:file-1",
        type: "event",
        eventKind: "file_changed",
        createdAt: "2026-04-23T18:00:00.000Z",
        title: "File changed",
        summary: "modified: packages/gui/src/app-shell.tsx",
        tone: "info",
        details: {
          path: "packages/gui/src/app-shell.tsx",
          changeType: "modified",
        },
      },
      {
        id: "event:approval-1",
        type: "event",
        eventKind: "approval_requested",
        createdAt: "2026-04-23T18:01:00.000Z",
        title: "Approval requested",
        summary: "Write file",
        tone: "warning",
        details: {
          approvalId: "approval-1",
          action: "Write file",
        },
        sessionId: "session-1",
      },
    ],
    currentAssistant: null,
    planMode: false,
    activity: null,
    errorBanner: null,
    providerCatalogStatus: "ready",
    providerCatalogError: null,
    providers: [],
    activeProvider: "claude",
    activeModel: "claude-sonnet-4-6",
    sessionList: [
      {
        id: "session-1",
        providersUsed: ["claude"],
        lastProvider: "claude",
        completedAt: "2026-04-21T20:00:00.000Z",
        cost: 0.1,
        taskSummary: "First task",
      },
    ],
    selectedSessionId: null,
    resumeTargetId: null,
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

describe("AppShell sidebar modes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    guiWsOnFrame = null;
    installMatchMedia(false);
    resetStore();
    waitForGatewayMock.mockResolvedValue(undefined);
    useQueryMock.mockImplementation((options: { queryKey?: readonly unknown[] }) => {
      const queryKey = options.queryKey?.join(":") ?? "";
      if (queryKey.includes("sessions")) {
        return {
          data: useSessionStore.getState().sessionList,
          error: null,
        };
      }
      if (queryKey.includes("session-detail")) {
        return {
          data: null,
          error: null,
        };
      }
      if (queryKey.includes("memory-lattice")) {
        return {
          data: {
            snapshot: {
              nodes: [{
                id: "memory:record-1",
                recordId: "record-1",
                layer: "semantic" as const,
                scope: { kind: "project" as const, id: "kiln" },
                label: "Memory Lattice contract",
                score: 1,
              }],
              edges: [],
              limits: { maxNodes: 25, maxEdges: 50 },
              truncated: false,
            },
            filters: { depth: 0 },
          },
          error: null,
          isFetching: false,
          refetch: vi.fn(),
        };
      }
      if (queryKey.includes("setup")) {
        return {
          data: {
            projectRoot: "C:/Proyectos/Sequel/kiln",
            projectContext: {
              path: "C:/Proyectos/Sequel/kiln/.kiln/project-context.md",
              status: "valid" as const,
              recommendation: "none" as const,
            },
            repoShims: [
              {
                target: "agents" as const,
                targetId: "repo-shim:agents",
                path: "C:/Proyectos/Sequel/kiln/AGENTS.md",
                status: "current" as const,
                recommendation: "none" as const,
              },
            ],
            nativeProjections: [],
            recommendedActions: ["none" as const],
          },
          error: null,
          isFetching: false,
          refetch: vi.fn(),
        };
      }
      return {
        data: {
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
        },
        error: null,
        refetch: vi.fn(),
      };
    });
  });

  it("opens changed files in the inspector while keeping sessions persistent", async () => {
    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByTestId("session-list")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Changed files" }));

    expect(screen.getByTestId("changed-files-panel")).toHaveTextContent("Changed files: 1");
    expect(screen.getByTestId("session-list")).toBeInTheDocument();
  });

  it("opens workspace in the inspector while keeping sessions persistent", async () => {
    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByTestId("session-list")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));

    expect(screen.getByTestId("workspace-panel")).toHaveTextContent("Workspace panel: none");
    expect(screen.getByTestId("session-list")).toBeInTheDocument();
  });

  it("opens workspace files in main document tabs instead of the sidebar panel", async () => {
    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByTestId("session-list")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Open package.json" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Operator surfaces")).toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "package.json" })).toBeInTheDocument();
    expect(screen.getByTestId("workspace-code")).toHaveTextContent(/"ok":\s*true/);
    expect(screen.getByTestId("workspace-panel")).toHaveTextContent("Selected file: C:/Proyectos/Sequel/kiln/package.json");
  });

  it("opens approvals in the inspector while keeping sessions persistent", async () => {
    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByTestId("session-list")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Approvals" }));

    expect(screen.getByTestId("approvals-panel")).toHaveTextContent("Approvals: 1");
    expect(screen.getByTestId("session-list")).toBeInTheDocument();
  });

  it("opens activity as a main workbench surface while keeping sessions persistent", async () => {
    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByTestId("session-list")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Activity" }));

    expect(screen.getByTestId("activity-log-panel")).toHaveTextContent("Activity: 2");
    expect(screen.getByTestId("session-list")).toBeInTheDocument();
  });

  it("keeps browser use out of the primary sidebar and opens it as a dynamic workbench tab", async () => {
    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByTestId("session-list")).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "Browser" })).not.toBeInTheDocument();

    act(() => {
      guiWsOnFrame?.({
        type: "interactive_use_updated",
        snapshot: {
          target: "browser",
          status: "running",
          updatedAt: "2026-05-08T12:00:00.000Z",
          toolName: "browser_observe",
          operation: "observe",
          sessionId: "browser-1",
          title: "Example App",
          url: "https://app.example.com",
        },
      });
    });

    expect(await screen.findByRole("tab", { name: "Browser: Example App" })).toBeInTheDocument();
    expect(screen.getByText("conversation")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
  });

  it("collapses the primary sidebar into an icon rail and keeps sessions accessible", async () => {
    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByTestId("session-list")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));

    expect(localStorage.getItem("kiln.gui.sidebarCollapsed")).toBe("true");
    expect(screen.queryByTestId("session-list")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open sessions" }));

    expect(await screen.findByTestId("session-list")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Expand sidebar" }));

    expect(localStorage.getItem("kiln.gui.sidebarCollapsed")).toBe("false");
    expect(screen.queryByRole("button", { name: "Open sessions" })).not.toBeInTheDocument();
    expect(screen.getByTestId("session-list")).toBeInTheDocument();
  });

  it("restores the collapsed primary sidebar preference", async () => {
    localStorage.setItem("kiln.gui.sidebarCollapsed", "true");

    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    });

    expect(screen.queryByTestId("session-list")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open sessions" })).toBeInTheDocument();
  });

  it("opens memory as a main workbench surface with graph and records", async () => {
    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByTestId("session-list")).toBeInTheDocument();
    });
    expect(screen.queryByRole("tab", { name: "Memory Lattice" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Memory" }));

    expect(await screen.findByLabelText("Memory graph")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Memory Lattice records" })).toContainElement(
      within(screen.getByRole("region", { name: "Memory Lattice records" })).getByRole(
        "button",
        { name: "Memory Lattice contract" },
      ),
    );
    expect(screen.getByTestId("session-list")).toBeInTheDocument();
  });

  it("opens setup as a main workbench surface", async () => {
    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByTestId("session-list")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Setup" }));

    expect(screen.getByRole("region", { name: "Setup" })).toHaveTextContent("Setup");
    expect(screen.getByRole("region", { name: "Setup actions" })).toHaveTextContent("Configuration is current");
    expect(screen.getByRole("region", { name: "Project context" })).toHaveTextContent("valid");
    const setupQueryOptions = useQueryMock.mock.calls.findLast(([options]) => {
      const queryKey = (options as { queryKey?: readonly unknown[] }).queryKey ?? [];
      return queryKey.includes("setup");
    })?.[0] as { enabled?: boolean; refetchInterval?: unknown } | undefined;
    expect(setupQueryOptions).toMatchObject({ enabled: true });
    expect(setupQueryOptions).not.toHaveProperty("refetchInterval");
    expect(screen.getByTestId("session-list")).toBeInTheDocument();
  });

  it("invalidates the Memory Lattice query when memory changes arrive over the gateway", async () => {
    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByTestId("session-list")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Memory" }));

    const initialMemoryQuery = useQueryMock.mock.calls.findLast(([options]) => {
      const queryKey = (options as { queryKey?: readonly unknown[] }).queryKey ?? [];
      return queryKey.includes("memory-lattice");
    });
    expect(initialMemoryQuery?.[0]).toMatchObject({
      queryKey: ["gui", "memory-lattice", { depth: 0, limit: 25 }, 0],
    });

    act(() => {
      guiWsOnFrame?.({
        type: "memory_lattice_invalidated",
        occurredAt: "2026-04-30T12:00:00.000Z",
        reason: "record_created",
        scope: { kind: "project", id: "kiln" },
        layer: "semantic",
        recordId: "record-2",
      });
    });

    await waitFor(() => {
      const latestMemoryQuery = useQueryMock.mock.calls.findLast(([options]) => {
        const queryKey = (options as { queryKey?: readonly unknown[] }).queryKey ?? [];
        return queryKey.includes("memory-lattice");
      });
      expect(latestMemoryQuery?.[0]).toMatchObject({
        queryKey: ["gui", "memory-lattice", { depth: 0, limit: 25 }, 1],
      });
    });
  });

  it("keeps non-actionable runtime events out of the transcript", async () => {
    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByTestId("transcript-probe")).toBeInTheDocument();
    });

    expect(screen.getByTestId("transcript-probe")).toHaveTextContent("Transcript entries: 1");
    expect(screen.getByTestId("transcript-probe")).toHaveTextContent("Approval requested");
    expect(screen.getByTestId("transcript-probe")).not.toHaveTextContent("File changed");
  });
});
