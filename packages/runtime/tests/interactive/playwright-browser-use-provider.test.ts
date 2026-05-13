import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PLAYWRIGHT_BROWSER_USE_MISSING_DEPENDENCY_MESSAGE,
  PlaywrightBrowserUseProvider,
  type PlaywrightBrowserSessionState,
} from "../../src/interactive/playwright-browser-use-provider.js";

describe("PlaywrightBrowserUseProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a clear setup error when the optional playwright dependency is missing", async () => {
    const provider = new PlaywrightBrowserUseProvider({
      loader: async () => {
        throw new Error(PLAYWRIGHT_BROWSER_USE_MISSING_DEPENDENCY_MESSAGE);
      },
      allowedDomains: ["example.com"],
    });

    await expect(provider.execute({
      toolName: "browser_session_start",
      target: "browser",
      operation: "session_start",
      url: "https://example.com",
      input: { url: "https://example.com" },
    })).rejects.toThrow(PLAYWRIGHT_BROWSER_USE_MISSING_DEPENDENCY_MESSAGE);
  });

  it("returns a clear setup error when Playwright is installed but Chromium is missing", async () => {
    const provider = new PlaywrightBrowserUseProvider({
      loader: async () => ({
        chromium: {
          async launch() {
            throw new Error("Executable doesn't exist. Please run: npx playwright install");
          },
        },
      }),
      allowedDomains: ["example.com"],
    });

    await expect(provider.execute({
      toolName: "browser_session_start",
      target: "browser",
      operation: "session_start",
      url: "https://example.com",
      input: { url: "https://example.com" },
    })).rejects.toThrow(PLAYWRIGHT_BROWSER_USE_MISSING_DEPENDENCY_MESSAGE);
  });

  it("starts, navigates, observes, acts, and stops through the Playwright API", async () => {
    const events: string[] = [];
    const page = fakePage(events);
    const provider = new PlaywrightBrowserUseProvider({
      loader: async () => fakePlaywright(page, events),
      allowedDomains: ["example.com"],
      artifactSink: {
        async writeInteractiveArtifact(input) {
          events.push(`artifact:${input.kind}:${input.mimeType}:${input.content.length}`);
          return `kiln://artifacts/interactive/${input.sessionId}/screenshot`;
        },
      },
    });

    await expect(provider.execute({
      toolName: "browser_session_start",
      target: "browser",
      operation: "session_start",
      sessionId: "browser-1",
      url: "https://example.com/start",
      input: {
        sessionId: "browser-1",
        url: "https://example.com/start",
        viewport: { width: 1280, height: 720 },
      },
    })).resolves.toMatchObject({
      provider: "playwright",
      sessionId: "browser-1",
      observation: {
        url: "https://example.com/start",
        title: "Example",
      },
    });

    await provider.execute({
      toolName: "browser_navigate",
      target: "browser",
      operation: "navigate",
      sessionId: "browser-1",
      url: "https://example.com/next",
      input: { sessionId: "browser-1", url: "https://example.com/next" },
    });
    await provider.execute({
      toolName: "browser_click",
      target: "browser",
      operation: "click",
      sessionId: "browser-1",
      action: { type: "click", selector: "#submit" },
      input: { sessionId: "browser-1", target: { selector: "#submit" } },
    });
    await provider.execute({
      toolName: "browser_type",
      target: "browser",
      operation: "type",
      sessionId: "browser-1",
      action: { type: "type", textLength: 5 },
      input: { sessionId: "browser-1", text: "hello" },
    });
    await expect(provider.execute({
      toolName: "browser_observe",
      target: "browser",
      operation: "observe",
      sessionId: "browser-1",
      observationRequest: { includeScreenshot: true },
      input: { sessionId: "browser-1", includeScreenshot: true },
    })).resolves.toMatchObject({
      observation: {
        screenshotUri: "kiln://artifacts/interactive/browser-1/screenshot",
      },
    });
    await provider.execute({
      toolName: "browser_session_stop",
      target: "browser",
      operation: "session_stop",
      sessionId: "browser-1",
      input: { sessionId: "browser-1" },
    });

    expect(events).toEqual([
      "launch:true",
      "context:1280x720",
      "newPage",
      "goto:https://example.com/start",
      "bodyText",
      "goto:https://example.com/next",
      "bodyText",
      "click:#submit",
      "bodyText",
      "keyboard.type:hello",
      "bodyText",
      "bodyText",
      "screenshot",
      "artifact:screenshot:image/png:3",
      "context.close",
      "browser.close",
    ]);
  });

  it("attaches browser_session_start to the active session instead of opening a duplicate", async () => {
    const events: string[] = [];
    const page = fakePage(events);
    const provider = new PlaywrightBrowserUseProvider({
      loader: async () => fakePlaywright(page, events),
      allowedDomains: ["example.com"],
    });

    await provider.execute({
      toolName: "browser_session_start",
      target: "browser",
      operation: "session_start",
      url: "https://example.com/start",
      input: { url: "https://example.com/start" },
    });

    await expect(provider.execute({
      toolName: "browser_session_start",
      target: "browser",
      operation: "session_start",
      url: "https://example.com/next",
      input: { url: "https://example.com/next" },
    })).resolves.toMatchObject({
      provider: "playwright",
      sessionId: "browser-1",
      output: "Attached to Playwright browser session browser-1.",
      observation: {
        url: "https://example.com/next",
      },
    });

    expect(events.filter((event) => event === "launch:true")).toHaveLength(1);
    expect(events.filter((event) => event === "newPage")).toHaveLength(1);
    expect(events).toContain("goto:https://example.com/start");
    expect(events).toContain("goto:https://example.com/next");
  });

  it("emits provider-owned live browser screenshot stream updates", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const updates: PlaywrightBrowserSessionState[] = [];
    const provider = new PlaywrightBrowserUseProvider({
      loader: async () => fakePlaywright(fakePage(events), events),
      allowedDomains: ["example.com"],
      liveStream: {
        enabled: true,
        intervalMs: 25,
      },
      onBrowserSessionUpdated(update) {
        updates.push(update);
      },
      artifactSink: {
        async writeInteractiveArtifact(input) {
          events.push(`artifact:${input.kind}:${input.mimeType}:${input.content.length}`);
          return `kiln://artifacts/live/${input.sessionId}/${events.filter((event) => event === "screenshot").length}`;
        },
      },
    });

    await provider.execute({
      toolName: "browser_session_start",
      target: "browser",
      operation: "session_start",
      sessionId: "browser-live",
      url: "https://example.com/start",
      input: {
        sessionId: "browser-live",
        url: "https://example.com/start",
      },
    });

    expect(updates.some((update) => (
      update.sessionId === "browser-live"
        && update.ownership === "agent"
        && update.viewMode === "live"
        && update.stream.status === "starting"
    ))).toBe(true);

    await advanceTimersByTime(26);

    expect(updates.some((update) => (
      update.sessionId === "browser-live"
        && update.ownership === "agent"
        && update.viewMode === "live"
        && update.stream.status === "live"
        && update.latestCapture?.uri === "kiln://artifacts/live/browser-live/1"
    ))).toBe(true);

    await provider.execute({
      toolName: "browser_session_stop",
      target: "browser",
      operation: "session_stop",
      sessionId: "browser-live",
      input: { sessionId: "browser-live" },
    });

    expect(updates.at(-1)).toMatchObject({
      sessionId: "browser-live",
      ownership: "released",
      viewMode: "snapshot",
      stream: { status: "ended" },
    });
  });

  it("reports stream capture failure without failing the active browser session", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const updates: PlaywrightBrowserSessionState[] = [];
    const provider = new PlaywrightBrowserUseProvider({
      loader: async () => fakePlaywright(fakePage(events, {
        screenshotError: new Error("screenshot failed"),
      }), events),
      allowedDomains: ["example.com"],
      liveStream: {
        enabled: true,
        intervalMs: 25,
      },
      onBrowserSessionUpdated(update) {
        updates.push(update);
      },
    });

    await provider.execute({
      toolName: "browser_session_start",
      target: "browser",
      operation: "session_start",
      sessionId: "browser-live",
      url: "https://example.com/start",
      input: {
        sessionId: "browser-live",
        url: "https://example.com/start",
      },
    });

    await advanceTimersByTime(26);

    expect(updates.some((update) => (
      update.stream.status === "failed"
        && update.stream.reason === "screenshot failed"
    ))).toBe(true);
    await expect(provider.execute({
      toolName: "browser_observe",
      target: "browser",
      operation: "observe",
      sessionId: "browser-live",
      input: { sessionId: "browser-live" },
    })).resolves.toMatchObject({
      sessionId: "browser-live",
    });
  });

  it("transfers browser ownership to the operator and blocks agent mutations until release", async () => {
    const events: string[] = [];
    const updates: PlaywrightBrowserSessionState[] = [];
    const provider = new PlaywrightBrowserUseProvider({
      loader: async () => fakePlaywright(fakePage(events), events),
      allowedDomains: ["example.com"],
      liveStream: {
        enabled: true,
        intervalMs: 25,
      },
      onBrowserSessionUpdated(update) {
        updates.push(update);
      },
      artifactSink: {
        async writeInteractiveArtifact(input) {
          events.push(`artifact:${input.kind}:${input.mimeType}:${input.content.length}`);
          return `kiln://artifacts/live/${input.sessionId}/${events.filter((event) => event === "screenshot").length}`;
        },
      },
    });

    await provider.execute({
      toolName: "browser_session_start",
      target: "browser",
      operation: "session_start",
      sessionId: "browser-lock",
      url: "https://example.com/start",
      input: {
        sessionId: "browser-lock",
        url: "https://example.com/start",
      },
    });

    const takeover = await provider.requestBrowserSessionControl({
      action: "takeover",
      sessionId: "browser-lock",
      operatorId: "operator-1",
      reason: "Inspect page state.",
    });

    expect(takeover).toMatchObject({
      sessionId: "browser-lock",
      ownership: "operator",
      viewMode: "live",
      stream: {
        status: "paused",
        reason: "Inspect page state.",
      },
    });
    expect(updates.at(-1)).toMatchObject({
      sessionId: "browser-lock",
      ownership: "operator",
      stream: { status: "paused" },
    });

    await expect(provider.execute({
      toolName: "browser_click",
      target: "browser",
      operation: "click",
      sessionId: "browser-lock",
      action: { type: "click", selector: "#submit" },
      input: { sessionId: "browser-lock", target: { selector: "#submit" } },
    })).rejects.toThrow("Browser session browser-lock is under operator control.");

    const release = await provider.requestBrowserSessionControl({
      action: "release",
      sessionId: "browser-lock",
      operatorId: "operator-1",
      reason: "Return to agent.",
    });

    expect(release).toMatchObject({
      sessionId: "browser-lock",
      ownership: "agent",
      viewMode: "live",
      stream: { status: "live" },
      latestCapture: {
        uri: "kiln://artifacts/live/browser-lock/1",
        relation: "snapshot",
        mimeType: "image/png",
      },
    });

    await expect(provider.execute({
      toolName: "browser_click",
      target: "browser",
      operation: "click",
      sessionId: "browser-lock",
      action: { type: "click", selector: "#submit" },
      input: { sessionId: "browser-lock", target: { selector: "#submit" } },
    })).resolves.toMatchObject({
      sessionId: "browser-lock",
    });
  });

  it("denies headed browser launch when the provider is configured for headless background sessions", async () => {
    const events: string[] = [];
    const provider = new PlaywrightBrowserUseProvider({
      loader: async () => fakePlaywright(fakePage(events), events),
      allowedDomains: ["example.com"],
      headless: true,
      allowHeaded: false,
    });

    await expect(provider.execute({
      toolName: "browser_session_start",
      target: "browser",
      operation: "session_start",
      url: "https://example.com/start",
      input: {
        url: "https://example.com/start",
        headless: false,
      },
    })).rejects.toThrow("Headed Playwright browser sessions are disabled");
    expect(events).toEqual([]);
  });

  it("allows headed browser launch only when explicitly configured", async () => {
    const events: string[] = [];
    const provider = new PlaywrightBrowserUseProvider({
      loader: async () => fakePlaywright(fakePage(events), events),
      allowedDomains: ["example.com"],
      headless: false,
      allowHeaded: true,
    });

    await provider.execute({
      toolName: "browser_session_start",
      target: "browser",
      operation: "session_start",
      url: "https://example.com/start",
      input: { url: "https://example.com/start" },
    });

    expect(events[0]).toBe("launch:false");
  });

  it("denies navigation outside the configured domain policy", async () => {
    const events: string[] = [];
    const provider = new PlaywrightBrowserUseProvider({
      loader: async () => fakePlaywright(fakePage(events), events),
      allowedDomains: ["example.com"],
    });

    await expect(provider.execute({
      toolName: "browser_session_start",
      target: "browser",
      operation: "session_start",
      url: "https://blocked.test",
      input: { url: "https://blocked.test" },
    })).rejects.toThrow("Browser automation denied for domain 'blocked.test'");
    expect(events).toEqual([]);
  });

  it("cleans up a browser session when startup navigation fails", async () => {
    const events: string[] = [];
    const provider = new PlaywrightBrowserUseProvider({
      loader: async () => fakePlaywright(fakePage(events, {
        gotoError: new Error("navigation failed"),
      }), events),
      allowedDomains: ["example.com"],
    });

    await expect(provider.execute({
      toolName: "browser_session_start",
      target: "browser",
      operation: "session_start",
      sessionId: "browser-1",
      url: "https://example.com/start",
      input: { sessionId: "browser-1", url: "https://example.com/start" },
    })).rejects.toThrow("navigation failed");
    await expect(provider.execute({
      toolName: "browser_observe",
      target: "browser",
      operation: "observe",
      sessionId: "browser-1",
      input: { sessionId: "browser-1" },
    })).rejects.toThrow("No active Playwright browser session");
    expect(events).toEqual([
      "launch:true",
      "context:autoxauto",
      "newPage",
      "goto:https://example.com/start",
      "context.close",
      "browser.close",
    ]);
  });

  it("closes idle browser sessions when the agent forgets to stop them", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const provider = new PlaywrightBrowserUseProvider({
      loader: async () => fakePlaywright(fakePage(events), events),
      allowedDomains: ["example.com"],
      idleSessionTtlMs: 50,
    });

    await provider.execute({
      toolName: "browser_session_start",
      target: "browser",
      operation: "session_start",
      sessionId: "browser-1",
      url: "https://example.com/start",
      input: { sessionId: "browser-1", url: "https://example.com/start" },
    });

    expect(events).not.toContain("browser.close");
    await advanceTimersByTime(51);

    expect(events).toContain("context.close");
    expect(events).toContain("browser.close");
    await expect(provider.execute({
      toolName: "browser_observe",
      target: "browser",
      operation: "observe",
      sessionId: "browser-1",
      input: { sessionId: "browser-1" },
    })).rejects.toThrow("No active Playwright browser session");
  });

  it("blocks actions when the current page has left the configured domain policy", async () => {
    const events: string[] = [];
    const page = fakePage(events);
    const provider = new PlaywrightBrowserUseProvider({
      loader: async () => fakePlaywright(page, events),
      allowedDomains: ["example.com"],
    });

    await provider.execute({
      toolName: "browser_session_start",
      target: "browser",
      operation: "session_start",
      sessionId: "browser-1",
      input: { sessionId: "browser-1" },
    });
    page.setUrl("https://blocked.test");

    await expect(provider.execute({
      toolName: "browser_click",
      target: "browser",
      operation: "click",
      sessionId: "browser-1",
      action: { type: "click", selector: "#submit" },
      input: { sessionId: "browser-1", target: { selector: "#submit" } },
    })).rejects.toThrow("Browser automation denied for domain 'blocked.test'");
    expect(events).not.toContain("click:#submit");
  });

  it("blocks follow-up observation when an action redirects outside the configured domain policy", async () => {
    const events: string[] = [];
    const provider = new PlaywrightBrowserUseProvider({
      loader: async () => fakePlaywright(fakePage(events, {
        clickRedirectUrl: "https://blocked.test/after-click",
      }), events),
      allowedDomains: ["example.com"],
    });

    await provider.execute({
      toolName: "browser_session_start",
      target: "browser",
      operation: "session_start",
      sessionId: "browser-1",
      url: "https://example.com/start",
      input: { sessionId: "browser-1", url: "https://example.com/start" },
    });

    await expect(provider.execute({
      toolName: "browser_click",
      target: "browser",
      operation: "click",
      sessionId: "browser-1",
      action: { type: "click", selector: "#submit" },
      input: { sessionId: "browser-1", target: { selector: "#submit" } },
    })).rejects.toThrow("Browser automation denied for domain 'blocked.test'");
    expect(events).toContain("click:#submit");
  });
});

function fakePlaywright(page: ReturnType<typeof fakePage>, events: string[]) {
  return {
    chromium: {
      async launch(options?: { readonly headless?: boolean }) {
        events.push(`launch:${options?.headless}`);
        return {
          async newContext(contextOptions?: { readonly viewport?: { readonly width: number; readonly height: number } }) {
            const viewport = contextOptions?.viewport;
            events.push(`context:${viewport?.width ?? "auto"}x${viewport?.height ?? "auto"}`);
            return {
              async newPage() {
                events.push("newPage");
                return page;
              },
              async close() {
                events.push("context.close");
              },
            };
          },
          async close() {
            events.push("browser.close");
          },
        };
      },
    },
  };
}

async function advanceTimersByTime(ms: number): Promise<void> {
  const timerApi = vi as typeof vi & { advanceTimersByTimeAsync?: (duration: number) => Promise<void> };
  if (typeof timerApi.advanceTimersByTimeAsync === "function") {
    await timerApi.advanceTimersByTimeAsync(ms);
    return;
  }
  vi.advanceTimersByTime(ms);
  await Promise.resolve();
}

function fakePage(
  events: string[],
  options: {
    readonly gotoError?: Error;
    readonly clickRedirectUrl?: string;
    readonly screenshotError?: Error;
  } = {},
) {
  let currentUrl = "about:blank";
  return {
    async goto(url: string) {
      currentUrl = url;
      events.push(`goto:${url}`);
      if (options.gotoError) {
        throw options.gotoError;
      }
    },
    url() {
      return currentUrl;
    },
    setUrl(url: string) {
      currentUrl = url;
    },
    async title() {
      return "Example";
    },
    async screenshot() {
      events.push("screenshot");
      if (options.screenshotError) {
        throw options.screenshotError;
      }
      return new Uint8Array([1, 2, 3]);
    },
    locator(selector: string) {
      return {
        async click() {
          events.push(`click:${selector}`);
          if (options.clickRedirectUrl) {
            currentUrl = options.clickRedirectUrl;
          }
        },
        async type(text: string) {
          events.push(`type:${text}`);
        },
        async innerText() {
          events.push("bodyText");
          return "Visible text";
        },
      };
    },
    mouse: {
      async click(x: number, y: number) {
        events.push(`mouse.click:${x},${y}`);
      },
      async wheel(deltaX: number, deltaY: number) {
        events.push(`wheel:${deltaX},${deltaY}`);
      },
    },
    keyboard: {
      async press(key: string) {
        events.push(`press:${key}`);
      },
      async type(text: string) {
        events.push(`keyboard.type:${text}`);
      },
    },
  };
}
