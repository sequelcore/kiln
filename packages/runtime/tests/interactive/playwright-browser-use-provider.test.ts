import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PLAYWRIGHT_BROWSER_USE_MISSING_DEPENDENCY_MESSAGE,
  PlaywrightBrowserUseProvider,
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
    await vi.advanceTimersByTimeAsync(51);

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

function fakePage(
  events: string[],
  options: {
    readonly gotoError?: Error;
    readonly clickRedirectUrl?: string;
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
