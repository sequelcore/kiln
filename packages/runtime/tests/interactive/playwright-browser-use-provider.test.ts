import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryArtifactResourceStore } from "@kilnai/core/tools";
import { PlaywrightBrowserCaptureRecorder } from "../../src/interactive/playwright-browser-capture-recorder.js";
import type { PlaywrightBrowserVideoRenderer } from "../../src/interactive/playwright-browser-video-renderer.js";
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
        && update.latestCapture?.width === 1280
        && update.latestCapture?.height === 720
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

  it("uses Chromium CDP screencast frames as the live browser transport when available", async () => {
    const events: string[] = [];
    const updates: PlaywrightBrowserSessionState[] = [];
    const cdp = fakeCdpSession(events);
    const provider = new PlaywrightBrowserUseProvider({
      loader: async () => fakePlaywright(fakePage(events), events, { cdp }),
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
          return `kiln://artifacts/live/${input.sessionId}/${events.filter((event) => event.startsWith("artifact:")).length}`;
        },
      },
    });

    await provider.execute({
      toolName: "browser_session_start",
      target: "browser",
      operation: "session_start",
      sessionId: "browser-cdp",
      url: "https://example.com/start",
      input: {
        sessionId: "browser-cdp",
        url: "https://example.com/start",
      },
    });

    await cdp.emitScreencastFrame({
      data: Buffer.from([4, 5, 6]).toString("base64"),
      sessionId: 7,
      metadata: {
        deviceWidth: 1440,
        deviceHeight: 900,
        pageScaleFactor: 1,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toContain("cdp.send:Page.startScreencast");
    expect(events).toContain("cdp.send:Page.screencastFrameAck:7");
    expect(updates.some((update) => (
      update.sessionId === "browser-cdp"
        && update.stream.status === "live"
        && update.latestCapture?.transport === "cdp-screencast"
        && update.latestCapture?.uri === "kiln://artifacts/live/browser-cdp/1"
        && update.latestCapture?.width === 1440
        && update.latestCapture?.height === 900
    ))).toBe(true);

    await provider.execute({
      toolName: "browser_session_stop",
      target: "browser",
      operation: "session_stop",
      sessionId: "browser-cdp",
      input: { sessionId: "browser-cdp" },
    });

    expect(events).toContain("cdp.send:Page.stopScreencast");
    expect(events).toContain("cdp.detach");
  });

  it("renders video and editor artifacts when recordArtifacts is requested", async () => {
    const events: string[] = [];
    const cdp = fakeCdpSession(events);
    const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-14T10:00:05.000Z" });
    const render = vi.fn<PlaywrightBrowserVideoRenderer["render"]>(async () => ({
      format: "webm",
      mimeType: "video/webm",
      content: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
      durationMs: 1200,
      width: 1440,
      height: 900,
      renderedFrameCount: 1,
      captionCount: 1,
      cursorHighlightCount: 1,
      zoomCount: 1,
      editTracks: [{
        id: "browser-recorder-caption-1",
        kind: "edit",
        status: "ready",
        editKind: "caption",
        startedAtOffsetMs: 0,
        durationMs: 1200,
        text: "browser_click Example",
      }],
    }));
    const captureRecorder = new PlaywrightBrowserCaptureRecorder({
      artifactStore,
      videoRenderer: { render },
    });
    const provider = new PlaywrightBrowserUseProvider({
      loader: async () => fakePlaywright(fakePage(events), events, { cdp }),
      allowedDomains: ["example.com"],
      liveStream: {
        enabled: true,
        intervalMs: 25,
      },
      onBrowserSessionUpdated() {},
      captureRecorder,
      artifactSink: {
        async writeInteractiveArtifact(input) {
          const artifact = artifactStore.put({
            namespace: "interactive-screenshots",
            title: "Live browser screenshot",
            mimeType: input.mimeType,
            content: { type: "blob", blob: Buffer.from(input.content).toString("base64") },
            producer: { kind: "tool", name: "browser_observe" },
            retention: { scope: "session", maxArtifacts: 50 },
          });
          return `kiln://artifacts/${artifact.namespace}/${artifact.id}/content`;
        },
      },
    });

    await provider.execute({
      toolName: "browser_session_start",
      target: "browser",
      operation: "session_start",
      sessionId: "browser-recorder",
      url: "https://example.com/start",
      recordArtifacts: true,
      input: {
        sessionId: "browser-recorder",
        url: "https://example.com/start",
        recordArtifacts: true,
      },
    });
    await cdp.emitScreencastFrame({
      data: Buffer.from([4, 5, 6]).toString("base64"),
      sessionId: 7,
      metadata: {
        deviceWidth: 1440,
        deviceHeight: 900,
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await provider.execute({
      toolName: "browser_click",
      target: "browser",
      operation: "click",
      sessionId: "browser-recorder",
      action: { type: "click", selector: "#submit" },
      input: { sessionId: "browser-recorder", target: { selector: "#submit" } },
    });

    const stopResult = await provider.execute({
      toolName: "browser_session_stop",
      target: "browser",
      operation: "session_stop",
      sessionId: "browser-recorder",
      input: { sessionId: "browser-recorder" },
    });

    expect(stopResult.resourcePayload).toMatchObject({
      mimeType: "application/json",
      title: "Recorder browser video proof",
    });
    const proof = JSON.parse(stopResult.resourcePayload!.text) as {
      readonly version: string;
      readonly capture: {
        readonly manifestUri: string;
        readonly rawCaptureEvidenceUri: string;
        readonly eventTrackUri: string;
      };
      readonly video: {
        readonly exportUri: string;
        readonly manifestUri: string;
        readonly mimeType: string;
      };
      readonly editor: {
        readonly markerJsonUri: string;
        readonly captionsSrtUri: string;
        readonly captionsVttUri: string;
        readonly editorProjectUri: string;
        readonly manifestUri: string;
      };
    };
    expect(proof.version).toBe("playwright-browser-recorder-session.v1");
    expect(proof.video).toMatchObject({
      mimeType: "video/webm",
      exportUri: expect.stringMatching(/^kiln:\/\/artifacts\/recorder-browser-capture-/u),
    });
    expect(proof.editor).toMatchObject({
      captionsSrtUri: expect.stringMatching(/^kiln:\/\/artifacts\/recorder-editor-export-/u),
      captionsVttUri: expect.stringMatching(/^kiln:\/\/artifacts\/recorder-editor-export-/u),
      editorProjectUri: expect.stringMatching(/^kiln:\/\/artifacts\/recorder-editor-export-/u),
    });
    expect(stopResult.output).toContain(proof.video.exportUri);
    expect(stopResult.output).toContain(proof.editor.editorProjectUri);
    expect(stopResult.content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "resource_link",
        uri: proof.video.exportUri,
        mimeType: "video/webm",
      }),
      expect.objectContaining({
        type: "resource_link",
        uri: proof.editor.editorProjectUri,
        mimeType: "application/vnd.kiln.recorder.editor-project+json",
      }),
    ]));

    const rawEvidence = readJsonArtifact(artifactStore, proof.capture.rawCaptureEvidenceUri);
    expect(rawEvidence.frames).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sessionId: "browser-recorder",
        operation: "session_start",
        transport: "cdp-screencast",
        width: 1440,
        height: 900,
      }),
      expect.objectContaining({
        sessionId: "browser-recorder",
        operation: "session_stop",
        transport: "snapshot-polling",
        width: 1280,
        height: 720,
      }),
    ]));

    const eventTrack = readJsonArtifact(artifactStore, proof.capture.eventTrackUri) as {
      readonly events: readonly { readonly toolName: string }[];
    };
    expect(eventTrack.events.map((event) => event.toolName)).toEqual([
      "browser_session_start",
      "browser_click",
      "browser_session_stop",
    ]);

    const manifest = readJsonArtifact(artifactStore, proof.capture.manifestUri) as {
      readonly tracks: {
        readonly rawCapture: readonly unknown[];
        readonly events: readonly { readonly resource: { readonly uri: string } }[];
      };
    };
    expect(manifest.tracks.rawCapture[0]).toMatchObject({
      source: {
        kind: "browser_session",
        target: "browser",
        sessionId: "browser-recorder",
      },
      capture: {
        transport: "frame-stream",
        resource: {
          uri: proof.capture.rawCaptureEvidenceUri,
          relation: "raw_capture",
        },
      },
    });
    const [manifestEventTrack] = manifest.tracks.events;
    expect(manifestEventTrack).toBeDefined();
    if (!manifestEventTrack) throw new Error("expected the recorder manifest to contain an event track");
    expect(manifestEventTrack.resource.uri).toBe(proof.capture.eventTrackUri);
    expect(readArtifact(artifactStore, proof.video.exportUri).mimeType).toBe("video/webm");
    expect(readArtifact(artifactStore, proof.editor.captionsSrtUri).mimeType).toBe("application/x-subrip");
    expect(readArtifact(artifactStore, proof.editor.captionsVttUri).mimeType).toBe("text/vtt");
    expect(readArtifact(artifactStore, proof.editor.editorProjectUri).mimeType)
      .toBe("application/vnd.kiln.recorder.editor-project+json");
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("does not emit recorder artifacts when recordArtifacts is omitted", async () => {
    const events: string[] = [];
    const artifactStore = new MemoryArtifactResourceStore({ now: () => "2026-05-14T10:00:05.000Z" });
    const captureRecorder = new PlaywrightBrowserCaptureRecorder({ artifactStore });
    const provider = new PlaywrightBrowserUseProvider({
      loader: async () => fakePlaywright(fakePage(events), events),
      allowedDomains: ["example.com"],
      liveStream: {
        enabled: true,
        intervalMs: 25,
      },
      captureRecorder,
      artifactSink: {
        async writeInteractiveArtifact(input) {
          const artifact = artifactStore.put({
            namespace: "interactive-screenshots",
            title: "Live browser screenshot",
            mimeType: input.mimeType,
            content: { type: "blob", blob: Buffer.from(input.content).toString("base64") },
            producer: { kind: "tool", name: "browser_observe" },
            retention: { scope: "session", maxArtifacts: 50 },
          });
          return `kiln://artifacts/${artifact.namespace}/${artifact.id}/content`;
        },
      },
    });

    await provider.execute({
      toolName: "browser_session_start",
      target: "browser",
      operation: "session_start",
      sessionId: "browser-unrecorded",
      url: "https://example.com/start",
      input: {
        sessionId: "browser-unrecorded",
        url: "https://example.com/start",
      },
    });

    const stopResult = await provider.execute({
      toolName: "browser_session_stop",
      target: "browser",
      operation: "session_stop",
      sessionId: "browser-unrecorded",
      input: { sessionId: "browser-unrecorded" },
    });

    expect(stopResult.resourcePayload).toBeUndefined();
    expect(captureRecorder.getLastProof("browser-unrecorded")).toBeUndefined();
  });

  it("cleans up the CDP session and falls back to polling when screencast start fails", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const updates: PlaywrightBrowserSessionState[] = [];
    const cdp = fakeCdpSession(events, { failStartScreencast: true });
    const provider = new PlaywrightBrowserUseProvider({
      loader: async () => fakePlaywright(fakePage(events), events, { cdp }),
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
          return `kiln://artifacts/live/${input.sessionId}/${events.filter((event) => event.startsWith("artifact:")).length}`;
        },
      },
    });

    await provider.execute({
      toolName: "browser_session_start",
      target: "browser",
      operation: "session_start",
      sessionId: "browser-cdp-fallback",
      url: "https://example.com/start",
      input: {
        sessionId: "browser-cdp-fallback",
        url: "https://example.com/start",
      },
    });

    expect(events).toContain("cdp.send:Page.startScreencast");
    expect(events).toContain("cdp.off:Page.screencastFrame");
    expect(events).toContain("cdp.send:Page.stopScreencast");
    expect(events).toContain("cdp.detach");

    await advanceTimersByTime(26);

    expect(updates.some((update) => (
      update.sessionId === "browser-cdp-fallback"
        && update.stream.status === "live"
        && update.latestCapture?.transport === "snapshot-polling"
        && update.latestCapture?.uri === "kiln://artifacts/live/browser-cdp-fallback/1"
    ))).toBe(true);
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

function fakePlaywright(
  page: ReturnType<typeof fakePage>,
  events: string[],
  fakeOptions: { readonly cdp?: ReturnType<typeof fakeCdpSession> } = {},
) {
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
              async newCDPSession() {
                if (!fakeOptions.cdp) {
                  throw new Error("CDP not configured");
                }
                events.push("newCDPSession");
                return fakeOptions.cdp;
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

function fakeCdpSession(
  events: string[],
  options: { readonly failStartScreencast?: boolean } = {},
) {
  const handlers = new Map<string, (event: {
    readonly data: string;
    readonly sessionId: number;
    readonly metadata?: {
      readonly deviceWidth?: number;
      readonly deviceHeight?: number;
      readonly pageScaleFactor?: number;
    };
  }) => void>();

  return {
    async send(method: string, params?: Record<string, unknown>) {
      events.push(params && "sessionId" in params ? `cdp.send:${method}:${String(params.sessionId)}` : `cdp.send:${method}`);
      if (method === "Page.startScreencast" && options.failStartScreencast) {
        throw new Error("start screencast failed");
      }
      return {};
    },
    on(event: string, handler: (payload: never) => void) {
      handlers.set(event, handler as never);
      events.push(`cdp.on:${event}`);
    },
    off(event: string) {
      handlers.delete(event);
      events.push(`cdp.off:${event}`);
    },
    async detach() {
      events.push("cdp.detach");
    },
    async emitScreencastFrame(frame: {
      readonly data: string;
      readonly sessionId: number;
      readonly metadata?: {
        readonly deviceWidth?: number;
        readonly deviceHeight?: number;
        readonly pageScaleFactor?: number;
      };
    }) {
      handlers.get("Page.screencastFrame")?.(frame);
      await Promise.resolve();
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
    viewportSize() {
      return { width: 1280, height: 720 };
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

function readJsonArtifact(artifactStore: MemoryArtifactResourceStore, uri: string): Record<string, unknown> {
  const match = /^kiln:\/\/artifacts\/([^/]+)\/([^/]+)\/content$/u.exec(uri);
  if (!match) {
    throw new Error(`Unexpected artifact URI: ${uri}`);
  }
  const artifact = artifactStore.get(match[1]!, match[2]!);
  if (!artifact || artifact.content.type !== "json") {
    throw new Error(`Expected JSON artifact: ${uri}`);
  }
  return artifact.content.value as Record<string, unknown>;
}

function readArtifact(artifactStore: MemoryArtifactResourceStore, uri: string): { readonly mimeType: string } {
  const match = /^kiln:\/\/artifacts\/([^/]+)\/([^/]+)\/content$/u.exec(uri);
  if (!match) {
    throw new Error(`Unexpected artifact URI: ${uri}`);
  }
  const artifact = artifactStore.get(match[1]!, match[2]!);
  if (!artifact) {
    throw new Error(`Expected artifact: ${uri}`);
  }
  return artifact;
}
