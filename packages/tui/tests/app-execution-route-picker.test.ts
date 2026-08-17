import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionRouteCatalog, GuiProviderDiscoveryResult } from "@kilnai/gateway-contracts";
import type { ReactiveState } from "../src/state.js";
import type { KilnTheme } from "../src/theme.js";

const harness = vi.hoisted(() => ({
  renderer: null as {
    destroy: () => void;
    keyInput: { emit: (event: string, payload: unknown) => void };
  } | null,
  state: null as ReactiveState | null,
  ui: null as { commandBarStatus: { content: string } } | null,
  switchExecutionRoute: vi.fn(),
  authenticateProvider: vi.fn(),
  sendMessage: vi.fn(),
  routePicker: null as { title: { content: string }; rows: Array<{ content: string }> } | null,
}));

vi.mock("../src/state.js", async () => {
  const actual = await vi.importActual<typeof import("../src/state.js")>("../src/state.js");
  return {
    ...actual,
    createReactiveState: () => {
      const state = actual.createReactiveState();
      state.currentProvider = "claude";
      state.currentModel = "claude-sonnet-4-6";
      harness.state = state;
      return state;
    },
  };
});

vi.mock("@kilnai/core", () => ({
  getFieldStore: () => ({
    snapshot: async () => ({
      regions: new Map(),
      dominantRegions: [],
      entropy: 0,
    }),
  }),
}));

vi.mock("../src/handlers.js", () => ({
  sendMessage: (...args: unknown[]) => harness.sendMessage(...args),
}));

vi.mock("../src/render.js", () => ({
  renderSidebarCost: () => undefined,
  renderSidebarContinuation: () => undefined,
  renderSidebarTurns: () => undefined,
  renderSidebarProvider: () => undefined,
  renderSidebarField: () => undefined,
  renderSidebarSessions: () => undefined,
  renderSidebarApprovals: () => undefined,
  renderSidebarChanges: () => undefined,
  renderSidebarWork: () => undefined,
  renderSidebarManagedAgents: () => undefined,
  renderSlashPopover: () => undefined,
}));

vi.mock("../src/ui.js", () => ({
  initUI: () => {
    const ui = {
      rootContainer: { backgroundColor: "", add: () => undefined },
      mainRow: { add: () => undefined },
      chatColumn: { backgroundColor: "" },
      chatScrollBox: { backgroundColor: "", content: { add: () => undefined } },
      sidebar: { width: 42, backgroundColor: "" },
      sidebarProviderText: { content: "" },
      sidebarCostText: { content: "" },
      sidebarCwdText: { content: "" },
      sidebarTurnsText: { content: "" },
      sidebarContinuationText: { content: "" },
      sidebarFieldText: { content: "" },
      sidebarDivider: { content: "" },
      sidebarToolsBox: { content: { add: () => undefined } },
      sidebarManagedAgentsText: { content: "" },
      sidebarWorkText: { content: "" },
      sidebarSessionsText: { content: "" },
      sidebarApprovalsText: { content: "" },
      sidebarChangesText: { content: "" },
      inputContainer: { backgroundColor: "" },
      inputTextarea: {
        clear: () => undefined,
        focus: () => undefined,
        plainText: "",
        textColor: "",
      },
      commandBar: { backgroundColor: "" },
      commandBarStatus: { content: "" },
      commandBarText: { content: "" },
      slashPopover: { backgroundColor: "" },
      slashPopoverText: { content: "" },
    };
    harness.ui = ui;
    return ui;
  },
  createThemePicker: () => ({
    items: [],
    panel: { destroy: () => undefined },
    scrollBox: { scrollTo: () => undefined },
  }),
  destroyThemePicker: () => undefined,
  createExecutionRoutePicker: () => {
    const contentChildren: unknown[] = [];
    const content = {
      y: 0,
      add: (child: { y?: number; parent?: unknown }) => {
        child.parent = content;
        child.y = contentChildren.length;
        contentChildren.push(child);
      },
    };
    const scrollBox = {
      content,
      viewport: { height: 8 },
      scrollTop: 0,
      scrollTo: (value: number) => {
        scrollBox.scrollTop = value;
      },
      scrollChildIntoView: () => undefined,
    };
    const picker = {
      rows: [] as Array<{ id?: string; content: string; destroy: () => void }>,
      scrollBox,
      title: { content: "" },
      hint: { content: "" },
      mode: "routes",
    };
    harness.routePicker = picker;
    return picker;
  },
  destroyExecutionRoutePicker: () => undefined,
}));

vi.mock("@opentui/core", () => {
  class MockEmitter {
    private readonly listeners = new Map<string, Array<(payload?: unknown) => void>>();

    on(event: string, listener: (payload?: unknown) => void): void {
      const current = this.listeners.get(event) ?? [];
      current.push(listener);
      this.listeners.set(event, current);
    }

    once(event: string, listener: (payload?: unknown) => void): void {
      const wrapped = (payload?: unknown) => {
        this.off(event, wrapped);
        listener(payload);
      };
      this.on(event, wrapped);
    }

    off(event: string, listener: (payload?: unknown) => void): void {
      const current = this.listeners.get(event) ?? [];
      this.listeners.set(event, current.filter((candidate) => candidate !== listener));
    }

    emit(event: string, payload?: unknown): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(payload);
      }
    }
  }

  class MockTextRenderable {
    id?: string;
    content: string;
    width?: string | number;
    height: number;
    y = 0;
    parent?: unknown;

    constructor(_renderer: unknown, options: {
      id?: string;
      content?: string;
      width?: string | number;
      height?: number;
    }) {
      this.id = options.id;
      this.content = options.content ?? "";
      this.width = options.width;
      this.height = options.height ?? 1;
    }

    destroy(): void {}
  }

  class MockRenderer extends MockEmitter {
    width = 120;
    height = 40;
    root = { add: () => undefined };
    keyInput = new MockEmitter();
    setBackgroundColor = () => undefined;
    start = () => undefined;
    destroy = () => {
      this.emit("destroy");
    };
  }

  const stringify = (value: unknown): string => (
    typeof value === "string" ? value : String(value)
  );

  return {
    createCliRenderer: async () => {
      const renderer = new MockRenderer();
      harness.renderer = renderer;
      return renderer;
    },
    TextRenderable: MockTextRenderable,
    BoxRenderable: MockTextRenderable,
    TextareaRenderable: MockTextRenderable,
    ScrollBoxRenderable: MockTextRenderable,
    RGBA: class {},
    fg: () => (value: unknown) => stringify(value),
    t: (strings: TemplateStringsArray, ...values: unknown[]) => strings.reduce(
      (result, segment, index) => result + segment + (index < values.length ? stringify(values[index]) : ""),
      "",
    ),
  };
});

import { startTui } from "../src/app.js";

const TEST_THEME: KilnTheme = {
  background: "#000000",
  backgroundElement: "#111111",
  backgroundPanel: "#161616",
  text: "#ffffff",
  textMuted: "#999999",
  primary: "#00aaee",
  accent: "#22dd88",
  warning: "#ffaa00",
  error: "#ff3366",
  border: "#444444",
  borderActive: "#00aaee",
  success: "#22dd88",
  info: "#00aaee",
  userFg: "#ffffff",
  userBg: "#1b1b1b",
  userBorder: "#444444",
  assistantBg: "#222222",
  toolFg: "#22dd88",
  thinkingFg: "#999999",
  cursorFg: "#ffffff",
};

async function flushUi(): Promise<void> {
  await Promise.resolve();
  vi.runAllTicks();
  await Promise.resolve();
}

async function waitForTuiReady(): Promise<void> {
  await vi.waitFor(() => {
    expect(harness.renderer).not.toBeNull();
    expect(harness.state).not.toBeNull();
    expect(harness.ui).not.toBeNull();
  });
  await flushUi();
}

const ROUTE_CATALOG: ExecutionRouteCatalog = {
  routes: [
    {
      routeId: "claude-default",
      label: "Claude",
      providerId: "claude",
      providerModelId: "claude-sonnet-4-6",
      accountSelection: { mode: "exact", eligibleAccountCount: 1, allowOperatorOverride: false },
      availability: "available",
      reasonCodes: ["configured"],
      repairActions: [],
    },
    {
      routeId: "openai-gpt-5",
      label: "OpenAI GPT-5",
      providerId: "openai",
      providerModelId: "gpt-5.4",
      accountSelection: { mode: "automatic", eligibleAccountCount: 2, allowOperatorOverride: true },
      accountOverrideIds: ["work", "personal"],
      availability: "available",
      reasonCodes: ["configured"],
      repairActions: [],
    },
    {
      routeId: "codex-oauth",
      label: "Codex OAuth",
      providerId: "codex-oauth",
      providerModelId: "gpt-5.4",
      accountSelection: { mode: "exact", eligibleAccountCount: 1, allowOperatorOverride: false },
      availability: "unavailable",
      reasonCodes: ["missing-credentials"],
      repairActions: ["authenticate-provider"],
    },
  ],
};

function emitText(text: string): void {
  for (const character of text) {
    harness.renderer?.keyInput.emit("keypress", {
      sequence: character,
      name: character,
      ctrl: false,
      meta: false,
    });
  }
}

function emitKey(sequence: string, name: string): void {
  harness.renderer?.keyInput.emit("keypress", {
    sequence,
    name,
    ctrl: false,
    meta: false,
  });
}

async function openExecutionRoutePickerAndChooseOpenAi(): Promise<void> {
  emitText("/target");
  emitKey("\r", "return");
  await flushUi();
  expect(harness.state?.executionRoutePickerOpen).toBe(true);
  emitKey("\x1b[B", "down");
  await flushUi();
  emitKey("\r", "return");
  await flushUi();
  expect(harness.state?.executionRoutePickerOpen).toBe(true);
  emitKey("\r", "return");
  await flushUi();
}

describe("TUI execution-route picker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    harness.renderer = null;
    harness.state = null;
    harness.ui = null;
    harness.switchExecutionRoute.mockReset();
    harness.authenticateProvider.mockReset();
    harness.sendMessage.mockReset();
    harness.routePicker = null;
  });

  it("cycles requested turn authority and exposes it to the next sent turn", async () => {
    const createSession = vi.fn(async () => ({
      run: async function* () {},
      dispose: vi.fn(),
      executionRouteCatalog: ROUTE_CATALOG,
    }));

    const startPromise = startTui(
      createSession,
      [
        { id: "claude", group: "subscription", models: ["claude-sonnet-4-6"], free: false },
      ],
      "claude",
      "kiln",
      TEST_THEME,
    );

    try {
      await waitForTuiReady();
      emitText("/authority");
      emitKey("\r", "return");
      await flushUi();
      emitText("hello");
      emitKey("\r", "return");
      await flushUi();

      expect(harness.state?.currentRequestedAuthority).toBe("read_only");
      expect(harness.ui?.commandBarStatus.content).toContain("Authority: read only");
      expect(harness.sendMessage).toHaveBeenCalledOnce();
      expect((harness.sendMessage.mock.calls[0]?.[0] as { state: ReactiveState }).state.currentRequestedAuthority).toBe("read_only");
    } finally {
      harness.renderer?.destroy();
      void startPromise.catch(() => undefined);
    }
  });

  it("reports the first rendered frame through the startup lifecycle callback", async () => {
    const onFirstFrame = vi.fn();
    const createSession = vi.fn(async () => ({
      run: async function* () {},
      dispose: vi.fn(),
      executionRouteCatalog: ROUTE_CATALOG,
    }));

    const startPromise = startTui(
      createSession,
      [
        { id: "claude", group: "subscription", models: ["claude-sonnet-4-6"], free: false },
      ],
      "claude",
      "kiln",
      TEST_THEME,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      onFirstFrame,
    );

    try {
      await waitForTuiReady();

      expect(onFirstFrame).toHaveBeenCalledOnce();
    } finally {
      harness.renderer?.destroy();
      void startPromise.catch(() => undefined);
    }
  });

  it("requires explicit continue mode before empty Enter continues a selected session", async () => {
    const onContinueSession = vi.fn()
      .mockReturnValueOnce(false)
      .mockReturnValue(true);
    const createSession = vi.fn(async () => ({
      run: async function* () {},
      dispose: vi.fn(),
      executionRouteCatalog: ROUTE_CATALOG,
    }));

    const startPromise = startTui(
      createSession,
      [
        { id: "claude", group: "subscription", models: ["claude-sonnet-4-6"], free: false },
      ],
      "claude",
      "kiln",
      TEST_THEME,
      {},
      undefined,
      undefined,
      undefined,
      async () => [
        {
          sessionId: "session-1",
          title: "Previous task",
          tags: [],
          routesUsed: ["claude-default"],
          lastRoute: { routeId: "claude-default", provider: "claude", model: "claude-sonnet-4-6" },
          updatedAt: "2026-06-07T00:00:00.000Z",
          costUsd: 0,
        },
      ],
      onContinueSession,
    );

    try {
      await waitForTuiReady();
      emitKey("\r", "return");
      await flushUi();

      expect(onContinueSession).not.toHaveBeenCalled();
      expect(harness.state?.sessionContinuationMode).toBe(false);
      expect(harness.state?.selectedSessionIndex).toBe(-1);

      emitText("/continue");
      emitKey("\r", "return");
      await flushUi();

      expect(onContinueSession).not.toHaveBeenCalled();
      expect(harness.state?.sessionContinuationMode).toBe(true);
      expect(harness.ui?.commandBarStatus.content).toContain("Enter to continue");

      emitKey("\r", "return");
      await flushUi();

      expect(onContinueSession).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "session-1" }));
      expect(harness.state?.sessionContinuationMode).toBe(false);
      expect(harness.ui?.commandBarStatus.content).toContain("execution target claude-default is unavailable");

      emitText("/continue");
      emitKey("\r", "return");
      await flushUi();
      emitKey("\r", "return");
      await flushUi();

      expect(onContinueSession).toHaveBeenCalledTimes(2);
      expect(harness.ui?.commandBarStatus.content).toContain("Continuing session");
    } finally {
      harness.renderer?.destroy();
      void startPromise.catch(() => undefined);
    }
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("does not update derived evidence until execution-route selection resolves successfully", async () => {
    let resolveSwitch: ((provider: string) => void) | undefined;
    harness.switchExecutionRoute.mockImplementation(
      () => new Promise<string>((resolve) => {
        resolveSwitch = resolve;
      }),
    );

    const createSession = vi.fn(async () => ({
      run: async function* () {},
      dispose: vi.fn(),
      executionRouteCatalog: ROUTE_CATALOG,
      switchExecutionRoute: harness.switchExecutionRoute,
    }));

    const startPromise = startTui(
      createSession,
      [
        { id: "claude", group: "subscription", models: ["claude-sonnet-4-6"], free: false },
        { id: "openai", group: "direct-api", models: ["gpt-5.4"], free: false },
      ],
      "claude",
      "kiln",
      TEST_THEME,
    );

    try {
      await waitForTuiReady();
      await openExecutionRoutePickerAndChooseOpenAi();

      expect(harness.switchExecutionRoute).toHaveBeenCalledWith("openai-gpt-5");
      expect(harness.state?.currentProvider).toBe("claude");
      expect(harness.state?.currentModel).toBe("claude-sonnet-4-6");

      resolveSwitch?.("openai-gpt-5");
      await flushUi();

      expect(harness.state?.currentProvider).toBe("openai");
      expect(harness.state?.currentModel).toBe("gpt-5.4");
    } finally {
      resolveSwitch?.("openai-gpt-5");
      harness.renderer?.destroy();
      void startPromise.catch(() => undefined);
    }
  });

  it("preserves derived execution evidence when route selection rejects with a connection failure", async () => {
    harness.switchExecutionRoute.mockImplementation(async () => {
      throw new Error("Execution target selection requires an active TUI gateway connection");
    });

    const createSession = vi.fn(async () => ({
      run: async function* () {},
      dispose: vi.fn(),
      executionRouteCatalog: ROUTE_CATALOG,
      switchExecutionRoute: harness.switchExecutionRoute,
    }));

    const startPromise = startTui(
      createSession,
      [
        { id: "claude", group: "subscription", models: ["claude-sonnet-4-6"], free: false },
        { id: "openai", group: "direct-api", models: ["gpt-5.4"], free: false },
      ],
      "claude",
      "kiln",
      TEST_THEME,
    );

    try {
      await waitForTuiReady();
      await openExecutionRoutePickerAndChooseOpenAi();

      expect(harness.switchExecutionRoute).toHaveBeenCalledWith("openai-gpt-5");
      expect(harness.state?.currentProvider).toBe("claude");
      expect(harness.state?.currentModel).toBe("claude-sonnet-4-6");
      expect(harness.ui?.commandBarStatus.content).toContain(
        "Execution target selection requires an active TUI gateway connection",
      );
    } finally {
      harness.renderer?.destroy();
      void startPromise.catch(() => undefined);
    }
  });

  it("keeps configured route evidence separate from provider model discovery", async () => {
    harness.switchExecutionRoute.mockResolvedValue("openai-gpt-5");
    const providerModelsRef: { current: Record<string, string[]> } = {
      current: {
        claude: ["claude-sonnet-4-6"],
        openai: ["gpt-5.4"],
      },
    };
    const createSession = vi.fn(async () => ({
      run: async function* () {},
      dispose: vi.fn(),
      executionRouteCatalog: ROUTE_CATALOG,
      switchExecutionRoute: harness.switchExecutionRoute,
    }));

    const startPromise = startTui(
      createSession,
      [
        { id: "claude", group: "subscription", models: ["claude-sonnet-4-6"], free: false },
        { id: "openai", group: "direct-api", models: ["gpt-5.4"], free: false },
      ],
      "claude",
      "kiln",
      TEST_THEME,
      {},
      undefined,
      providerModelsRef,
    );

    try {
      await waitForTuiReady();
      providerModelsRef.current = {};
      vi.advanceTimersByTime(500);
      await openExecutionRoutePickerAndChooseOpenAi();

      expect(harness.switchExecutionRoute).toHaveBeenCalledWith("openai-gpt-5");
      expect(harness.state?.currentProvider).toBe("openai");
      expect(harness.state?.currentModel).toBe("gpt-5.4");
      expect(harness.state?.executionRoutePickerOpen).toBe(false);
    } finally {
      harness.renderer?.destroy();
      void startPromise.catch(() => undefined);
    }
  });

  it("refreshes the execution-route catalog from the open picker", async () => {
    harness.switchExecutionRoute.mockResolvedValue("openai-gpt-5");
    const refreshExecutionRoutes = vi.fn(async () => undefined);
    const createSession = vi.fn(async () => ({
      run: async function* () {},
      dispose: vi.fn(),
      executionRouteCatalog: ROUTE_CATALOG,
      switchExecutionRoute: harness.switchExecutionRoute,
      refreshExecutionRoutes,
    }));

    const startPromise = startTui(
      createSession,
      [
        { id: "claude", group: "subscription", models: ["claude-sonnet-4-6"], free: false },
        { id: "openai", group: "direct-api", models: [], free: false, available: false, reason: "OPENAI_API_KEY is missing." },
      ],
      "claude",
      "kiln",
      TEST_THEME,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    try {
      await waitForTuiReady();
      emitText("/target");
      emitKey("\r", "return");
      await flushUi();

      emitKey("r", "r");
      await flushUi();

      expect(refreshExecutionRoutes).toHaveBeenCalledOnce();
      expect(harness.state?.executionRoutePickerOpen).toBe(true);
      expect(harness.ui?.commandBarStatus.content).toContain("Execution target catalog refreshed");
    } finally {
      harness.renderer?.destroy();
      void startPromise.catch(() => undefined);
    }
  });

  it("opens the Runtime Available Models read-only view from the route picker without selecting", async () => {
    const createSession = vi.fn(async () => ({
      run: async function* () {}, dispose: vi.fn(), executionRouteCatalog: ROUTE_CATALOG,
      availableModels: { observedAt: "2026-08-13T18:00:00.000Z", entries: [{ providerId: "provider", providerRouteId: "provider:direct", providerModelId: "model", discoveryState: "observed", eligibilityState: "eligible", availabilityState: "available", configuredState: "unconfigured", configuredRouteRefs: [], reasonCodes: ["discovery-observed"] }] },
      switchExecutionRoute: harness.switchExecutionRoute,
    }));
    const startPromise = startTui(createSession, [{ id: "claude", group: "subscription", models: ["claude-sonnet-4-6"], free: false }], "claude", "kiln", TEST_THEME);
    try {
      await waitForTuiReady();
      emitText("/target"); emitKey("\r", "return"); await flushUi();
      emitKey("a", "a"); await flushUi();
      expect(harness.routePicker?.title.content).toContain("Available Models (read-only)");
      expect(harness.routePicker?.rows.some((row) => row.content.includes("provider/model"))).toBe(true);
      emitKey("\r", "return"); await flushUi();
      expect(harness.switchExecutionRoute).not.toHaveBeenCalled();
      expect(harness.state?.executionRoutePickerOpen).toBe(true);
    } finally { harness.renderer?.destroy(); void startPromise.catch(() => undefined); }
  });

  it("shows a route-catalog loader and blocks selection while refresh is in flight", async () => {
    let resolveRefresh: (() => void) | undefined;
    const refreshExecutionRoutes = vi.fn(() => new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    }));
    const createSession = vi.fn(async () => ({
      run: async function* () {},
      dispose: vi.fn(),
      executionRouteCatalog: ROUTE_CATALOG,
      switchExecutionRoute: harness.switchExecutionRoute,
      refreshExecutionRoutes,
    }));

    const startPromise = startTui(
      createSession,
      [
        { id: "claude", group: "subscription", models: ["claude-sonnet-4-6"], free: false },
        { id: "openai", group: "direct-api", models: ["gpt-5.4"], free: false },
      ],
      "claude",
      "kiln",
      TEST_THEME,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    try {
      await waitForTuiReady();
      emitText("/target");
      emitKey("\r", "return");
      await flushUi();

      emitKey("r", "r");
      await flushUi();

      expect(refreshExecutionRoutes).toHaveBeenCalledOnce();
      expect(harness.ui?.commandBarStatus.content).toContain("Refreshing execution targets");

      emitKey("\r", "return");
      await flushUi();

      expect(harness.switchExecutionRoute).not.toHaveBeenCalled();
      expect(harness.state?.executionRoutePickerOpen).toBe(true);

      resolveRefresh?.();
      await flushUi();

      expect(harness.ui?.commandBarStatus.content).toContain("Execution target catalog refreshed");
    } finally {
      harness.renderer?.destroy();
      void startPromise.catch(() => undefined);
    }
  });

  it("selects the automatic account for a configured route", async () => {
    harness.switchExecutionRoute.mockResolvedValue("openai-gpt-5");

    const createSession = vi.fn(async () => ({
      run: async function* () {},
      dispose: vi.fn(),
      executionRouteCatalog: ROUTE_CATALOG,
      switchExecutionRoute: harness.switchExecutionRoute,
    }));

    const startPromise = startTui(
      createSession,
      [
        { id: "claude", group: "harness", models: [], free: false },
        { id: "openai", group: "direct-api", models: ["gpt-5.4"], free: false },
      ],
      "claude",
      "kiln",
      TEST_THEME,
    );

    try {
      await waitForTuiReady();
      emitText("/target");
      emitKey("\r", "return");
      await flushUi();
      expect(harness.state?.executionRoutePickerOpen).toBe(true);

      emitKey("\x1b[B", "down");
      await flushUi();
      emitKey("\r", "return");
      await flushUi();
      expect(harness.state?.executionRoutePickerOpen).toBe(true);
      emitKey("\r", "return");
      await flushUi();

      expect(harness.switchExecutionRoute).toHaveBeenCalledWith("openai-gpt-5");
      expect(harness.state?.currentProvider).toBe("openai");
      expect(harness.state?.currentModel).toBe("gpt-5.4");
      expect(harness.state?.executionRoutePickerOpen).toBe(false);
    } finally {
      harness.renderer?.destroy();
      void startPromise.catch(() => undefined);
    }
  });

  it("sends a selected eligible account override through the execution target", async () => {
    harness.switchExecutionRoute.mockResolvedValue("openai-gpt-5");
    const createSession = vi.fn(async () => ({
      run: async function* () {},
      dispose: vi.fn(),
      executionRouteCatalog: ROUTE_CATALOG,
      switchExecutionRoute: harness.switchExecutionRoute,
    }));

    const startPromise = startTui(
      createSession,
      [
        { id: "claude", group: "harness", models: [], free: false },
        { id: "openai", group: "direct-api", models: ["gpt-5.4"], free: false },
      ],
      "claude",
      "kiln",
      TEST_THEME,
    );

    try {
      await waitForTuiReady();
      emitText("/target");
      emitKey("\r", "return");
      await flushUi();
      emitKey("\x1b[B", "down");
      await flushUi();
      emitKey("\r", "return");
      await flushUi();
      emitKey("\x1b[B", "down");
      await flushUi();
      emitKey("\r", "return");
      await flushUi();

      expect(harness.switchExecutionRoute).toHaveBeenCalledWith("openai-gpt-5", "work");
    } finally {
      harness.renderer?.destroy();
      void startPromise.catch(() => undefined);
    }
  });

  it("does not allow selecting an unavailable configured route", async () => {
    harness.switchExecutionRoute.mockResolvedValue("codex-oauth");

    const createSession = vi.fn(async () => ({
      run: async function* () {},
      dispose: vi.fn(),
      executionRouteCatalog: ROUTE_CATALOG,
      switchExecutionRoute: harness.switchExecutionRoute,
    }));

    const startPromise = startTui(
      createSession,
      [
        { id: "openai", group: "direct-api", models: ["gpt-5.4"], free: false },
        { id: "codex", group: "harness", models: [], free: false },
      ],
      "openai",
      "kiln",
      TEST_THEME,
    );

    try {
      await waitForTuiReady();
      emitText("/target");
      emitKey("\r", "return");
      await flushUi();
      expect(harness.state?.executionRoutePickerOpen).toBe(true);

      emitKey("\x1b[B", "down");
      await flushUi();
      emitKey("\r", "return");
      await flushUi();

      expect(harness.switchExecutionRoute).not.toHaveBeenCalled();
      expect(harness.state?.currentProvider).toBe("openai");
      expect(harness.state?.currentModel).toBe("gpt-5.4");
      expect(harness.state?.executionRoutePickerOpen).toBe(true);
    } finally {
      harness.renderer?.destroy();
      void startPromise.catch(() => undefined);
    }
  });

  it("requires explicit confirmation before starting device-code provider auth", async () => {
    harness.authenticateProvider.mockResolvedValue(undefined);
    const createSession = vi.fn(async () => ({
      run: async function* () {},
      dispose: vi.fn(),
      executionRouteCatalog: ROUTE_CATALOG,
      switchExecutionRoute: harness.switchExecutionRoute,
      authenticateProvider: harness.authenticateProvider,
    }));
    const providerDiscoveryRef: { current: readonly GuiProviderDiscoveryResult[] } = {
      current: [
        {
          provider: "codex-oauth",
          available: false,
          models: [],
          status: "missing_auth",
          reason: "Codex OAuth authentication is missing.",
          authState: "missing",
          lastCheckedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    };

    const startPromise = startTui(
      createSession,
      [
        { id: "claude", group: "harness", models: [], free: false },
        { id: "codex-oauth", group: "subscription", models: [], free: true, available: false, reason: "Codex OAuth authentication is missing." },
      ],
      "claude",
      "kiln",
      TEST_THEME,
      {},
      undefined,
      undefined,
      providerDiscoveryRef,
    );

    try {
      await waitForTuiReady();
      emitText("/target");
      emitKey("\r", "return");
      await flushUi();
      expect(harness.state?.executionRoutePickerOpen).toBe(true);

      emitKey("\x1b[B", "down");
      await flushUi();
      emitKey("\x1b[B", "down");
      await flushUi();
      emitKey("\r", "return");
      await flushUi();

      expect(harness.authenticateProvider).not.toHaveBeenCalled();
      expect(harness.ui?.commandBarStatus.content).not.toContain("Open ");

      emitKey("\r", "return");
      await flushUi();

      expect(harness.authenticateProvider).toHaveBeenCalledWith(
        "codex-oauth",
        expect.objectContaining({
          onStarted: expect.any(Function),
        }),
      );
    } finally {
      harness.renderer?.destroy();
      void startPromise.catch(() => undefined);
    }
  });

  it("uses the auth-completion route catalog without requesting a second refresh", async () => {
    const authenticatedCatalog = {
      ...ROUTE_CATALOG,
      routes: [
        ROUTE_CATALOG.routes[0]!,
        ROUTE_CATALOG.routes[1]!,
        {
          ...ROUTE_CATALOG.routes[2]!,
          availability: "available" as const,
          reasonCodes: [],
          repairActions: [],
        },
      ],
    } satisfies ExecutionRouteCatalog;
    let executionRouteCatalog: ExecutionRouteCatalog = ROUTE_CATALOG;
    const refreshExecutionRoutes = vi.fn(async () => undefined);
    const authenticateProvider = vi.fn(async () => {
      executionRouteCatalog = authenticatedCatalog;
    });
    const session = {
      run: async function* () {},
      dispose: vi.fn(),
      get executionRouteCatalog() {
        return executionRouteCatalog;
      },
      switchExecutionRoute: harness.switchExecutionRoute,
      refreshExecutionRoutes,
      authenticateProvider,
    };
    const createSession = vi.fn(async () => session);
    const providerDiscoveryRef: { current: readonly GuiProviderDiscoveryResult[] } = {
      current: [
        {
          provider: "codex-oauth",
          available: false,
          models: [],
          status: "missing_auth",
          reason: "Codex OAuth authentication is missing.",
          authState: "missing",
          lastCheckedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    };

    const startPromise = startTui(
      createSession,
      [
        { id: "claude", group: "harness", models: [], free: false },
        { id: "codex-oauth", group: "subscription", models: [], free: true, available: false, reason: "Codex OAuth authentication is missing." },
      ],
      "claude",
      "kiln",
      TEST_THEME,
      {},
      undefined,
      undefined,
      providerDiscoveryRef,
    );

    try {
      await waitForTuiReady();
      emitText("/target");
      emitKey("\r", "return");
      await flushUi();
      emitKey("\x1b[B", "down");
      await flushUi();
      emitKey("\x1b[B", "down");
      await flushUi();
      emitKey("\r", "return");
      await flushUi();
      emitKey("\r", "return");
      await flushUi();

      expect(authenticateProvider).toHaveBeenCalledOnce();
      expect(refreshExecutionRoutes).not.toHaveBeenCalled();
      expect(harness.ui?.commandBarStatus.content).toContain("Provider authentication completed");

      emitKey("\r", "return");
      await flushUi();
      expect(harness.switchExecutionRoute).toHaveBeenCalledWith("codex-oauth");
    } finally {
      harness.renderer?.destroy();
      void startPromise.catch(() => undefined);
    }
  });
});
