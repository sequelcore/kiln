import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { GuiInboundFrame } from "@kilnai/gateway-contracts";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GuiGatewayClient } from "../src/api/client.js";
import { AppShell } from "../src/components/app-shell.js";
import { useSessionStore } from "../src/lib/session-store/index.js";

const useQueryMock = vi.fn();
const waitForGatewayMock = vi.fn();
const sendMock = vi.fn();
const loadResourceDataUrlMock = vi.fn();
const loadWorkspaceFileMock = vi.fn(async (path: string) => ({
  path,
  name: path.replace(/\\/g, "/").split("/").at(-1) ?? path,
  kind: "text" as const,
  sizeBytes: 17,
  source: "gateway" as const,
  encoding: "utf-8" as const,
  language: path.endsWith(".json") ? "json" : "markdown",
  content: path.endsWith(".json") ? "{\"ok\":true}" : "# Project Context",
}));
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

    async loadOperatorSessionHistory() {
      return useSessionStore.getState().sessionList;
    }

    async loadDashboard(): ReturnType<GuiGatewayClient["loadDashboard"]> {
      return {
        executionRouteCatalog: { routes: [] },
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

    async loadWorkspaceFile(path: string) {
      return loadWorkspaceFileMock(path);
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

    async loadResourceDataUrl(uri: string) {
      return loadResourceDataUrlMock(uri);
    }

    async loadConfigSetup() {
      return {
        projectRoot: "C:/workspace/kiln",
        projectContext: {
          path: "C:/workspace/kiln/.kiln/project-context.md",
          status: "valid",
          recommendation: "none",
        },
        repoShims: [
          {
            target: "agents",
            targetId: "repo-shim:agents",
            path: "C:/workspace/kiln/AGENTS.md",
            status: "current",
            recommendation: "none",
          },
        ],
        globalInstructionShims: [],
        nativeProjections: [],
        permissionIntegrity: [],
        skillDiagnostics: { state: "current" },
        recommendedActions: ["none"],
      };
    }

    async loadConfigurationOnboarding() {
      return {
        schemaVersion: 1,
        status: "complete",
        scope: "project",
        posture: "read-only",
        targets: [{ id: "codex-terra", label: "Codex Terra", providerId: "codex-oauth", providerModelId: "gpt-5.6-terra", selected: true }],
        defaultTargetId: "codex-terra",
        blockers: [],
        nextAction: "Start the first turn.",
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
  SessionList: ({ onSelect }: { onSelect?: (sessionId: string) => void }) => (
    <div data-testid="session-list">
      Session list
      <button type="button" onClick={() => onSelect?.("session-1")}>Select session one</button>
    </div>
  ),
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
          path: "C:/workspace/kiln/package.json",
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
    sessionEvents: [
      {
        eventId: "file-1",
        kilnSessionId: "session-1",
        sequence: 1,
        timestamp: "2026-04-23T18:00:00.000Z",
        kind: "file_changed",
        source: { actor: "runtime", surface: "gui" },
        payload: {
          path: "packages/gui/src/app-shell.tsx",
          changeType: "modified",
        },
      },
      {
        eventId: "approval-1",
        kilnSessionId: "session-1",
        sequence: 2,
        timestamp: "2026-04-23T18:01:00.000Z",
        kind: "approval_requested",
        source: { actor: "runtime", surface: "gui" },
        payload: {
          approvalId: "approval-1",
          action: "Write file",
        },
      },
    ],
    timelineEntries: [
      {
        id: "timeline:file-1",
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
        id: "timeline:approval-1",
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
    providerCatalogStatus: "ready",
    providerCatalogError: null,
    providers: [],
    sessionList: [
      {
        sessionId: "session-1",
        title: "First task",
        tags: [],
        routesUsed: ["claude-default"],
        lastRoute: { routeId: "claude-default", provider: "claude" },
        updatedAt: "2026-04-21T20:00:00.000Z",
        costUsd: 0.1,
      },
    ],
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
    authorityStatus: null,
    outboundSend: null,
    clearTimeoutId: null,
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
    loadWorkspaceFileMock.mockClear();
    loadResourceDataUrlMock.mockResolvedValue("data:text/plain;base64,b2s=");
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
            projectRoot: "C:/workspace/kiln",
            projectContext: {
              path: "C:/workspace/kiln/.kiln/project-context.md",
              status: "valid" as const,
              recommendation: "none" as const,
            },
            repoShims: [
              {
                target: "agents" as const,
                targetId: "repo-shim:agents",
                path: "C:/workspace/kiln/AGENTS.md",
                status: "current" as const,
                recommendation: "none" as const,
              },
            ],
            globalInstructionShims: [],
            nativeProjections: [],
            permissionIntegrity: [],
            skillDiagnostics: { state: "current" as const },
            recommendedActions: ["none" as const],
          },
          error: null,
          isFetching: false,
          refetch: vi.fn(),
        };
      }
      if (queryKey.includes("configuration-onboarding")) {
        return {
          data: {
            schemaVersion: 1 as const,
            status: "complete" as const,
            scope: "project" as const,
            posture: "read-only" as const,
            targets: [{ id: "codex-terra", label: "Codex Terra", providerId: "codex-oauth", providerModelId: "gpt-5.6-terra", selected: true }],
            defaultTargetId: "codex-terra",
            blockers: [],
            nextAction: "Start the first turn.",
          },
          error: null,
          isFetching: false,
          refetch: vi.fn(),
        };
      }
      if (queryKey.includes("settings")) {
        const revision = `sha256:${"a".repeat(64)}`;
        return {
          data: {
            schemaRevision: 2 as const,
            generatedAt: "2026-08-22T00:00:00.000Z",
            health: "current" as const,
            activationStatus: {
              desiredRevisionSetId: revision,
              state: "not-started" as const,
              boundary: null,
              activeRevision: null,
              entries: [],
              summary: "No committed configuration activation is pending.",
            },
            sections: [
              { id: "general" as const, label: "General", description: "General preferences.", entryKeys: [] },
              { id: "providers" as const, label: "Providers", description: "Provider readiness.", entryKeys: [] },
              { id: "models" as const, label: "Models", description: "Models.", entryKeys: [] },
              { id: "permissions" as const, label: "Permissions", description: "Authority policy.", entryKeys: [] },
              { id: "tools" as const, label: "Tools", description: "Tools.", entryKeys: [] },
              { id: "usage-and-limits" as const, label: "Usage and Limits", description: "Limits.", entryKeys: [] },
              { id: "agents" as const, label: "Agents", description: "Agents.", entryKeys: [] },
              { id: "health" as const, label: "Health", description: "Health.", entryKeys: [] },
              { id: "advanced" as const, label: "Advanced", description: "Advanced.", entryKeys: [] },
            ],
            entries: [],
            revisions: {},
            modifiedCount: 0,
          },
          error: null,
          isFetching: false,
          refetch: vi.fn(),
        };
      }
      return {
        data: {
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
        },
        error: null,
        refetch: vi.fn(),
      };
    });
  });

  it("keeps the chat inspector closed until the operator requests a mode", async () => {
    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByTestId("session-list")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("workspace-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open inspector" })).toBeInTheDocument();
  });

  it("polls authoritative session history independently of local turns", async () => {
    render(<AppShell />);

    await waitFor(() => {
      const options = useQueryMock.mock.calls.findLast(([candidate]) => {
        const queryKey = (candidate as { queryKey?: readonly unknown[] }).queryKey ?? [];
        return queryKey.includes("sessions");
      })?.[0] as { refetchInterval?: number } | undefined;
      expect(options?.refetchInterval).toBe(2_000);
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

    expect(await screen.findByLabelText("Operator surfaces", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Chat" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "package.json" })).toBeInTheDocument();
    expect(screen.getByTestId("workspace-code")).toHaveTextContent(/"ok":\s*true/);
    expect(screen.getByTestId("workspace-panel")).toHaveTextContent("Selected file: C:/workspace/kiln/package.json");
  }, 10_000);

  it("returns to the chat surface when selecting a session from another surface", async () => {
    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByTestId("session-list")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Open package.json" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "package.json" })).toHaveAttribute("aria-selected", "true");
    });

    fireEvent.click(screen.getByRole("button", { name: "Select session one" }));

    expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
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

    expect(await screen.findByTestId("activity-log-panel")).toHaveTextContent("Activity: 2");
    expect(screen.getByTestId("session-list")).toBeInTheDocument();
  });

  it("opens canonical work item resources from the work surface", async () => {
    const openedWindow = {
      location: { href: "" },
      close: vi.fn(),
    };
    vi.spyOn(window, "open").mockImplementation(() => openedWindow as unknown as Window);
    useSessionStore.setState({
      timelineEntries: [
        ...useSessionStore.getState().timelineEntries,
        {
          id: "timeline:evt-work-update",
          type: "event",
          eventKind: "work_item_updated",
          createdAt: "2026-06-24T10:00:00.000Z",
          sequence: 3,
          title: "Work item updated",
          summary: "Inspect work item resource",
          tone: "warning",
          details: {
            operation: "update",
            workItem: {
              id: "work-shell-resource",
              summary: "Inspect work item resource",
              status: "blocked",
              workflowProfile: "verification-heavy",
              authorityProfile: "authority:foundation-readonly-plan",
              expectedEvidence: ["surface-map"],
              providedEvidence: [],
              verificationGates: ["bun test"],
              updatedAt: "2026-06-24T10:00:00.000Z",
            },
          },
        },
      ],
    });

    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByTestId("session-list")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open work item work-shell-resource resource" }));

    await waitFor(() => {
      expect(loadResourceDataUrlMock).toHaveBeenCalledWith("kiln://session/work-items/work-shell-resource");
    });
    expect(openedWindow.location.href).toBe("data:text/plain;base64,b2s=");
    expect(openedWindow.close).not.toHaveBeenCalled();
  });

  it("opens managed agents as a main workbench surface and opens resources from the click gesture", async () => {
    const callOrder: string[] = [];
    const openedWindow = {
      location: { href: "" },
      close: vi.fn(),
    };
    vi.spyOn(window, "open").mockImplementation(() => {
      callOrder.push("open");
      return openedWindow as unknown as Window;
    });
    loadResourceDataUrlMock.mockImplementation(async () => {
      callOrder.push("load");
      return "data:text/plain;base64,dHJhbnNjcmlwdA==";
    });
    useSessionStore.setState({
      sessionEvents: [
        {
          eventId: "event-agent-completed",
          kilnSessionId: "session-1",
          sequence: 3,
          timestamp: "2026-05-23T12:03:00.000Z",
          kind: "agent_invocation_completed",
          payload: {
            invocationId: "child-gui",
            lifecycleState: "completed",
            providerRoute: {
              providerId: "codex-oauth",
              model: "gpt-5.5",
            },
            managedInvocationEvidence: {
              transcript: {
                uri: "kiln://managed-agents/child-gui/transcript",
              },
            },
          },
        },
      ],
    });

    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByTestId("session-list")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Agents" }));

    expect(await screen.findByLabelText("Managed agents")).toHaveTextContent("child-gui");
    expect(screen.getByTestId("session-list")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Transcript" }));

    await waitFor(() => {
      expect(loadResourceDataUrlMock).toHaveBeenCalledWith("kiln://managed-agents/child-gui/transcript");
    });
    expect(callOrder).toEqual(["open", "load"]);
    expect(openedWindow.location.href).toBe("data:text/plain;base64,dHJhbnNjcmlwdA==");
    expect(openedWindow.close).not.toHaveBeenCalled();
  });

  it("sends managed-agent controls with the projected gateway target identity", async () => {
    useSessionStore.setState({
      sessionEvents: [
        {
          eventId: "event-agent-started",
          kilnSessionId: "session-1",
          sequence: 3,
          timestamp: "2026-05-23T12:03:00.000Z",
          kind: "agent_invocation_started",
          payload: {
            instanceId: "local-gui",
            sessionId: "session-1",
            managedInvocationId: "child-gui",
            lifecycleState: "running",
          },
        },
      ],
    });

    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByTestId("session-list")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel managed child child-gui" }));

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      type: "managed_agent_control",
      action: "cancel",
      sessionId: "session-1",
      invocationId: "child-gui",
      gatewayTargetId: "local-gui",
    }));
  });

  it("surfaces managed-agent cancel acknowledgement failures and clears them on acceptance", async () => {
    useSessionStore.setState({
      sessionEvents: [{
        eventId: "event-agent-started",
        kilnSessionId: "session-1",
        sequence: 3,
        timestamp: "2026-05-23T12:03:00.000Z",
        kind: "agent_invocation_started",
        payload: {
          instanceId: "local-gui",
          sessionId: "session-1",
          managedInvocationId: "child-gui",
          lifecycleState: "running",
        },
      }],
    });
    render(<AppShell />);

    await waitFor(() => {
      expect(screen.getByTestId("session-list")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));

    act(() => {
      guiWsOnFrame?.({
        type: "managed_agent_control_result",
        action: "cancel",
        sessionId: "session-1",
        invocationId: "child-gui",
        status: "failed",
        reason: "Managed agent control requires a live invocation service.",
        requestId: "managed-agent-control-1",
        handledAt: "2026-05-23T12:04:00.000Z",
      });
    });

    expect(screen.getByText("Managed agent control requires a live invocation service.")).toBeInTheDocument();

    act(() => {
      guiWsOnFrame?.({
        type: "managed_agent_control_result",
        action: "cancel",
        sessionId: "session-1",
        invocationId: "child-gui",
        status: "accepted",
        requestId: "managed-agent-control-1",
        handledAt: "2026-05-23T12:04:01.000Z",
      });
    });

    expect(screen.queryByText("Managed agent control requires a live invocation service.")).not.toBeInTheDocument();
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

    expect(await screen.findByLabelText("Memory graph", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Memory Lattice records" })).toContainElement(
      within(screen.getByRole("region", { name: "Memory Lattice records" })).getByRole(
        "button",
        { name: "Memory Lattice contract" },
      ),
    );
    expect(screen.getByTestId("session-list")).toBeInTheDocument();
  });

  it("opens configuration health inside the routed settings context", async () => {
    function Harness() {
      const [settingsSection, setSettingsSection] = useState<"health" | null>("health");
      return (
        <AppShell
          settingsSection={settingsSection}
          onCloseSettings={() => setSettingsSection(null)}
          onOpenSettings={() => setSettingsSection("health")}
        />
      );
    }
    render(<Harness />);

    expect(await screen.findByRole("region", { name: "Configuration Health" })).toHaveTextContent("Configuration Health");
    expect(screen.getByRole("region", { name: "Required Configuration Actions" })).toHaveTextContent(
      "No configuration actions are required.",
    );
    expect(screen.getByRole("region", { name: "Configuration Details" })).toHaveTextContent("valid");
    const setupQueryOptions = useQueryMock.mock.calls.findLast(([options]) => {
      const queryKey = (options as { queryKey?: readonly unknown[] }).queryKey ?? [];
      return queryKey.includes("setup");
    })?.[0] as {
      enabled?: boolean;
      refetchInterval?: (query: { state: { data?: { skillDiagnostics: { state: "current" } } } }) => number | false;
    } | undefined;
    expect(setupQueryOptions).toMatchObject({ enabled: true });
    expect(setupQueryOptions?.refetchInterval?.({
      state: { data: { skillDiagnostics: { state: "current" } } },
    })).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Preview Project Context" }));
    await waitFor(() => {
      expect(loadWorkspaceFileMock).toHaveBeenCalledWith("C:/workspace/kiln/.kiln/project-context.md");
    });
    expect(screen.getByRole("tab", { name: "project-context.md" })).toHaveAttribute("aria-selected", "true");
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
