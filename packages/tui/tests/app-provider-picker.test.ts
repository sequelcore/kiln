import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactiveState } from "../src/state.js";

const harness = vi.hoisted(() => ({
  renderer: null as {
    destroy: () => void;
    keyInput: { emit: (event: string, payload: unknown) => void };
  } | null,
  state: null as ReactiveState | null,
  ui: null as { commandBarStatus: { content: string } } | null,
  switchProvider: vi.fn(),
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
  sendMessage: () => undefined,
}));

vi.mock("../src/render.js", () => ({
  renderSidebarCost: () => undefined,
  renderSidebarResume: () => undefined,
  renderSidebarTurns: () => undefined,
  renderSidebarProvider: () => undefined,
  renderSidebarField: () => undefined,
  renderSidebarSessions: () => undefined,
  renderSidebarApprovals: () => undefined,
  renderSidebarChanges: () => undefined,
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
      sidebarResumeText: { content: "" },
      sidebarFieldText: { content: "" },
      sidebarDivider: { content: "" },
      sidebarToolsBox: { content: { add: () => undefined } },
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
  createProviderPicker: () => {
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
    return {
      rows: [] as Array<{ id?: string; content: string; destroy: () => void }>,
      scrollBox,
      title: { content: "" },
      hint: { content: "" },
      mode: "providers",
    };
  },
  destroyProviderPicker: () => undefined,
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

import { startTui } from "../src/app.tsx";

const TEST_THEME = {
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
  userBg: "#1b1b1b",
  assistantBg: "#222222",
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

async function openProviderPickerAndChooseOpenAi(): Promise<void> {
  emitText("/provider");
  emitKey("\r", "return");
  await flushUi();
  expect(harness.state?.providerPickerOpen).toBe(true);
  emitKey("\x1b[B", "down");
  await flushUi();
  emitKey("\r", "return");
  await flushUi();
  emitKey("\r", "return");
  await flushUi();
}

describe("TUI provider picker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    harness.renderer = null;
    harness.state = null;
    harness.ui = null;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("does not update provider or model until switchProvider resolves successfully", async () => {
    let resolveSwitch: ((provider: string) => void) | undefined;
    harness.switchProvider.mockImplementation(
      () => new Promise<string>((resolve) => {
        resolveSwitch = resolve;
      }),
    );

    const createSession = vi.fn(async () => ({
      run: async function* () {},
      dispose: vi.fn(),
      switchProvider: harness.switchProvider,
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
      await openProviderPickerAndChooseOpenAi();

      expect(harness.switchProvider).toHaveBeenCalledWith("openai", "gpt-5.4");
      expect(harness.state?.currentProvider).toBe("claude");
      expect(harness.state?.currentModel).toBe("claude-sonnet-4-6");

      resolveSwitch?.("openai");
      await flushUi();

      expect(harness.state?.currentProvider).toBe("openai");
      expect(harness.state?.currentModel).toBe("gpt-5.4");
    } finally {
      resolveSwitch?.("openai");
      harness.renderer?.destroy();
      void startPromise.catch(() => undefined);
    }
  });

  it("preserves the previous provider and model when switchProvider rejects with a connection failure", async () => {
    harness.switchProvider.mockImplementation(async () => {
      throw new Error("Provider switch requires an active TUI gateway connection");
    });

    const createSession = vi.fn(async () => ({
      run: async function* () {},
      dispose: vi.fn(),
      switchProvider: harness.switchProvider,
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
      await openProviderPickerAndChooseOpenAi();

      expect(harness.switchProvider).toHaveBeenCalledWith("openai", "gpt-5.4");
      expect(harness.state?.currentProvider).toBe("claude");
      expect(harness.state?.currentModel).toBe("claude-sonnet-4-6");
      expect(harness.ui?.commandBarStatus.content).toContain(
        "Provider switch requires an active TUI gateway connection",
      );
    } finally {
      harness.renderer?.destroy();
      void startPromise.catch(() => undefined);
    }
  });

  it("removes stale models when the provider model ref refreshes to empty", async () => {
    harness.switchProvider.mockResolvedValue("openai");
    const providerModelsRef = {
      current: {
        claude: ["claude-sonnet-4-6"],
        openai: ["gpt-5.4"],
      },
    };
    const createSession = vi.fn(async () => ({
      run: async function* () {},
      dispose: vi.fn(),
      switchProvider: harness.switchProvider,
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
      await openProviderPickerAndChooseOpenAi();

      expect(harness.switchProvider).not.toHaveBeenCalled();
      expect(harness.state?.providerPickerOpen).toBe(true);
    } finally {
      harness.renderer?.destroy();
      void startPromise.catch(() => undefined);
    }
  });

  it("refreshes provider discovery from the open picker without restarting the TUI", async () => {
    harness.switchProvider.mockResolvedValue("openai");
    const refreshProviders = vi.fn(async () => undefined);
    const createSession = vi.fn(async () => ({
      run: async function* () {},
      dispose: vi.fn(),
      switchProvider: harness.switchProvider,
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
      refreshProviders,
    );

    try {
      await waitForTuiReady();
      emitText("/provider");
      emitKey("\r", "return");
      await flushUi();

      emitKey("r", "r");
      await flushUi();

      expect(refreshProviders).toHaveBeenCalledOnce();
      expect(harness.state?.providerPickerOpen).toBe(true);
      expect(harness.ui?.commandBarStatus.content).toContain("Provider discovery refreshed");
    } finally {
      harness.renderer?.destroy();
      void startPromise.catch(() => undefined);
    }
  });

  it("switches from a modeled provider to metadata-modeless claude without a model", async () => {
    harness.switchProvider.mockResolvedValue("claude");

    const createSession = vi.fn(async () => ({
      run: async function* () {},
      dispose: vi.fn(),
      switchProvider: harness.switchProvider,
    }));

    const startPromise = startTui(
      createSession,
      [
        { id: "openai", group: "direct-api", models: ["gpt-5.4"], free: false },
        { id: "claude", group: "harness", models: [], free: false },
      ],
      "openai",
      "kiln",
      TEST_THEME,
    );

    try {
      await waitForTuiReady();
      emitText("/provider");
      emitKey("\r", "return");
      await flushUi();
      expect(harness.state?.providerPickerOpen).toBe(true);

      emitKey("\x1b[B", "down");
      await flushUi();
      emitKey("\r", "return");
      await flushUi();

      expect(harness.switchProvider).toHaveBeenCalledWith("claude", undefined);
      expect(harness.state?.currentProvider).toBe("claude");
      expect(harness.state?.currentModel).toBe("");
      expect(harness.state?.providerPickerOpen).toBe(false);
    } finally {
      harness.renderer?.destroy();
      void startPromise.catch(() => undefined);
    }
  });

  it("does not allow provider-only switching for non-modeless providers without models", async () => {
    harness.switchProvider.mockResolvedValue("codex");

    const createSession = vi.fn(async () => ({
      run: async function* () {},
      dispose: vi.fn(),
      switchProvider: harness.switchProvider,
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
      emitText("/provider");
      emitKey("\r", "return");
      await flushUi();
      expect(harness.state?.providerPickerOpen).toBe(true);

      emitKey("\x1b[B", "down");
      await flushUi();
      emitKey("\r", "return");
      await flushUi();

      expect(harness.switchProvider).not.toHaveBeenCalled();
      expect(harness.state?.currentProvider).toBe("openai");
      expect(harness.state?.currentModel).toBe("gpt-5.4");
      expect(harness.state?.providerPickerOpen).toBe(true);
    } finally {
      harness.renderer?.destroy();
      void startPromise.catch(() => undefined);
    }
  });
});
