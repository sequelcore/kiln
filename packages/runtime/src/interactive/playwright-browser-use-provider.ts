import type {
  InteractiveObservationMetadata,
  InteractiveUseProvider,
  InteractiveUseProviderResult,
  InteractiveUseRequest,
} from "@kilnai/core";
import type {
  PlaywrightBrowserCaptureProof,
  PlaywrightBrowserCaptureRecorder,
  PlaywrightBrowserCaptureTransport,
  PlaywrightBrowserExternalEditorExportProof,
  PlaywrightBrowserRenderProof,
} from "./playwright-browser-capture-recorder.js";

export const PLAYWRIGHT_BROWSER_USE_MISSING_DEPENDENCY_MESSAGE =
  "Playwright browser use provider is not available. Install the optional peer dependency 'playwright' in the runtime host and install a browser before enabling interactiveUse.browserProvider=playwright. For Bun: bun add -d playwright && bun x playwright install chromium.";

type PlaywrightLoader = () => Promise<PlaywrightModule>;

export interface PlaywrightBrowserUseProviderOptions {
  readonly loader?: PlaywrightLoader;
  readonly allowedDomains?: readonly string[];
  readonly allowExternalBrowser?: boolean;
  readonly headless?: boolean;
  readonly allowHeaded?: boolean;
  readonly defaultTimeoutMs?: number;
  readonly idleSessionTtlMs?: number;
  readonly artifactSink?: InteractiveArtifactSink;
  readonly captureRecorder?: PlaywrightBrowserCaptureRecorder;
  readonly liveStream?: PlaywrightBrowserLiveStreamOptions;
  readonly now?: () => Date;
  readonly onBrowserSessionUpdated?: (state: PlaywrightBrowserSessionState) => void | Promise<void>;
}

export interface InteractiveArtifactSink {
  writeInteractiveArtifact(input: InteractiveArtifactWrite): Promise<string>;
}

export interface InteractiveArtifactWrite {
  readonly sessionId: string;
  readonly kind: "screenshot";
  readonly mimeType: string;
  readonly content: Uint8Array;
}

export interface PlaywrightBrowserLiveStreamOptions {
  readonly enabled?: boolean;
  readonly intervalMs?: number;
}

type PlaywrightBrowserLiveViewportTransport = PlaywrightBrowserCaptureTransport;

export interface PlaywrightBrowserSessionState {
  readonly target: "browser";
  readonly status: "running" | "succeeded" | "failed";
  readonly updatedAt: string;
  readonly provider: "playwright";
  readonly sessionId: string;
  readonly operation?: string;
  readonly url?: string;
  readonly title?: string;
  readonly ownership: "agent" | "released";
  readonly viewMode: "snapshot" | "live";
  readonly stream: {
    readonly status: "starting" | "live" | "paused" | "ended" | "failed";
    readonly reason?: string;
  };
  readonly latestCapture?: {
    readonly uri: string;
    readonly relation: "snapshot";
    readonly mimeType: "image/png";
    readonly width?: number;
    readonly height?: number;
    readonly transport?: PlaywrightBrowserLiveViewportTransport;
  };
}

interface PlaywrightModule {
  readonly chromium: BrowserType;
}

interface BrowserType {
  launch(options?: { readonly headless?: boolean }): Promise<Browser>;
}

interface Browser {
  newContext(options?: { readonly viewport?: ViewportSize }): Promise<BrowserContext>;
  close(): Promise<void>;
}

interface BrowserContext {
  newPage(): Promise<Page>;
  newCDPSession?(page: Page): Promise<CdpSession>;
  close(): Promise<void>;
}

interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

interface Page {
  goto(url: string, options?: { readonly timeout?: number; readonly waitUntil?: "domcontentloaded" }): Promise<unknown>;
  url(): string;
  title(): Promise<string>;
  screenshot(options?: { readonly type?: "png"; readonly fullPage?: boolean }): Promise<Uint8Array>;
  viewportSize?(): ViewportSize | null;
  locator(selector: string): Locator;
  mouse: {
    click(x: number, y: number, options?: { readonly button?: "left" | "middle" | "right"; readonly clickCount?: number }): Promise<void>;
    move?(x: number, y: number): Promise<void>;
    down?(options?: { readonly button?: "left" | "middle" | "right" }): Promise<void>;
    up?(options?: { readonly button?: "left" | "middle" | "right" }): Promise<void>;
    wheel(deltaX: number, deltaY: number): Promise<void>;
  };
  keyboard: {
    press(key: string): Promise<void>;
    type(text: string): Promise<void>;
  };
}

interface Locator {
  click(options?: { readonly button?: "left" | "middle" | "right"; readonly clickCount?: number; readonly timeout?: number }): Promise<void>;
  type(text: string, options?: { readonly timeout?: number }): Promise<void>;
  innerText(options?: { readonly timeout?: number }): Promise<string>;
}

interface BrowserSession {
  readonly id: string;
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly viewport?: ViewportSize;
}

interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: "Page.screencastFrame", handler: (event: CdpScreencastFrame) => void): void;
  off?(event: "Page.screencastFrame", handler: (event: CdpScreencastFrame) => void): void;
  detach?(): Promise<void>;
}

interface CdpScreencastFrame {
  readonly data: string;
  readonly sessionId: number;
  readonly metadata?: {
    readonly deviceWidth?: number;
    readonly deviceHeight?: number;
    readonly pageScaleFactor?: number;
  };
}

interface BrowserCdpScreencastStream {
  readonly session: CdpSession;
  readonly handler: (event: CdpScreencastFrame) => void;
}

interface PlaywrightBrowserRecorderSessionProof {
  readonly version: "playwright-browser-recorder-session.v1";
  readonly sessionId: string;
  readonly capture: PlaywrightBrowserCaptureProof;
  readonly video: PlaywrightBrowserRenderProof;
  readonly editor: PlaywrightBrowserExternalEditorExportProof;
}

export class PlaywrightBrowserUseProvider implements InteractiveUseProvider {
  private readonly loader: PlaywrightLoader;
  private readonly allowedDomains: readonly string[];
  private readonly allowExternalBrowser: boolean;
  private readonly headless: boolean;
  private readonly allowHeaded: boolean;
  private readonly defaultTimeoutMs: number;
  private readonly idleSessionTtlMs: number | undefined;
  private artifactSink?: InteractiveArtifactSink;
  private readonly captureRecorder?: PlaywrightBrowserCaptureRecorder;
  private readonly liveStream: Required<PlaywrightBrowserLiveStreamOptions>;
  private readonly now: () => Date;
  private onBrowserSessionUpdated?: (state: PlaywrightBrowserSessionState) => void | Promise<void>;
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly streamTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly cdpStreams = new Map<string, BrowserCdpScreencastStream>();
  private readonly recorderSessionIds = new Set<string>();
  private activeSessionId: string | undefined;
  private sequence = 0;

  constructor(options: PlaywrightBrowserUseProviderOptions = {}) {
    this.loader = options.loader ?? loadPlaywright;
    this.allowedDomains = options.allowedDomains ?? [];
    this.allowExternalBrowser = options.allowExternalBrowser === true;
    this.headless = options.headless ?? true;
    this.allowHeaded = options.allowHeaded === true;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.idleSessionTtlMs = normalizeIdleSessionTtl(options.idleSessionTtlMs);
    this.artifactSink = options.artifactSink;
    this.captureRecorder = options.captureRecorder;
    this.liveStream = {
      enabled: options.liveStream?.enabled === true,
      intervalMs: normalizeLiveStreamInterval(options.liveStream?.intervalMs),
    };
    this.now = options.now ?? (() => new Date());
    this.onBrowserSessionUpdated = options.onBrowserSessionUpdated;
  }

  async execute(request: InteractiveUseRequest): Promise<InteractiveUseProviderResult> {
    if (request.target !== "browser") {
      throw new Error("Playwright browser use provider only supports browser targets.");
    }
    const startedAt = this.now().toISOString();
    let result: InteractiveUseProviderResult;
    try {
      result = await this.executeBrowserRequest(request);
    } catch (error) {
      this.recordBrowserOperation({
        request,
        startedAt,
        completedAt: this.now().toISOString(),
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const completedAt = this.now().toISOString();
    const sessionId = result.sessionId ?? request.sessionId;
    this.markRecorderSessionIfRequested(request, sessionId);
    this.recordBrowserOperation({
      request,
      result,
      startedAt,
      completedAt,
      status: "succeeded",
    });

    if (request.operation !== "session_stop" || !sessionId || !this.isRecorderSession(sessionId)) {
      return result;
    }
    try {
      const proof = await this.finalizeRecorderSession(sessionId, completedAt, result.observation?.title);
      return {
        ...result,
        output: recorderProofOutput(result.output, proof),
        content: [
          ...(result.content ?? []),
          ...recorderProofContent(proof),
        ],
        resourcePayload: {
          title: "Recorder browser video proof",
          mimeType: "application/json",
          text: JSON.stringify(proof, null, 2),
        },
      };
    } finally {
      this.recorderSessionIds.delete(sessionId);
    }
  }

  private async executeBrowserRequest(request: InteractiveUseRequest): Promise<InteractiveUseProviderResult> {
    switch (request.operation) {
      case "session_start":
        return this.startSession(request);
      case "navigate":
        return this.navigate(request);
      case "observe":
        return this.observe(request);
      case "click":
        return this.click(request);
      case "type":
        return this.type(request);
      case "keypress":
        return this.keypress(request);
      case "scroll":
        return this.scroll(request);
      case "session_stop":
        return this.stopSession(request);
      default:
        throw new Error(`Playwright browser use provider does not support operation '${request.operation}'.`);
    }
  }

  private recordBrowserOperation(input: {
    readonly request: InteractiveUseRequest;
    readonly result?: InteractiveUseProviderResult;
    readonly startedAt: string;
    readonly completedAt: string;
    readonly status: "succeeded" | "failed";
    readonly errorMessage?: string;
  }): void {
    const recorder = this.captureRecorder;
    if (!recorder) {
      return;
    }
    const sessionId = input.result?.sessionId ?? input.request.sessionId;
    if (!sessionId || !this.recorderSessionIds.has(sessionId)) {
      return;
    }
    recorder.recordBrowserOperation({
      sessionId,
      toolName: input.request.toolName,
      operation: input.request.operation,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      ...(input.request.action ? { action: input.request.action } : {}),
      status: input.status,
      ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
      ...(input.result?.observation?.url ? { url: input.result.observation.url } : {}),
      ...(input.result?.observation?.title ? { title: input.result.observation.title } : {}),
    });
  }

  setInteractiveArtifactSink(sink: InteractiveArtifactSink | undefined): void {
    this.artifactSink = sink;
  }

  setBrowserSessionUpdateHandler(handler: ((state: PlaywrightBrowserSessionState) => void | Promise<void>) | undefined): void {
    this.onBrowserSessionUpdated = handler;
  }

  async closeAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();
    for (const timer of this.streamTimers.values()) {
      clearTimeout(timer);
    }
    this.streamTimers.clear();
    await Promise.allSettled([...this.cdpStreams.keys()].map((sessionId) => this.stopCdpScreencast(sessionId)));
    this.recorderSessionIds.clear();
    this.activeSessionId = undefined;
    await Promise.allSettled(sessions.map((session) => this.closeSession(session)));
  }

  private async startSession(request: InteractiveUseRequest): Promise<InteractiveUseProviderResult> {
    if (request.url) {
      this.assertUrlAllowed(request.url);
    }
    const existingSessionId = request.sessionId ?? this.activeSessionId;
    const existingSession = existingSessionId ? this.sessions.get(existingSessionId) : undefined;
    if (existingSession) {
      this.clearIdleTimer(existingSession.id);
      this.activeSessionId = existingSession.id;
      if (request.url && existingSession.page.url() !== request.url) {
        await existingSession.page.goto(request.url, {
          timeout: request.timeoutMs ?? this.defaultTimeoutMs,
          waitUntil: "domcontentloaded",
        });
      }
      const result = {
        provider: "playwright",
        sessionId: existingSession.id,
        output: `Attached to Playwright browser session ${existingSession.id}.`,
        observation: await this.observeSession(existingSession, request),
      };
      await this.startLiveStream(existingSession, request);
      this.scheduleIdleClose(existingSession);
      return result;
    }

    const playwright = await this.loader();
    const sessionId = request.sessionId ?? `browser-${++this.sequence}`;
    const browser = await this.launchBrowser(playwright, request);
    const viewport = readViewport(request.input);
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const session: BrowserSession = { id: sessionId, browser, context, page, ...(viewport ? { viewport } : {}) };
    this.sessions.set(sessionId, session);
    this.activeSessionId = sessionId;

    try {
      if (request.url) {
        await page.goto(request.url, {
          timeout: request.timeoutMs ?? this.defaultTimeoutMs,
          waitUntil: "domcontentloaded",
        });
      }

      const result = {
        provider: "playwright",
        sessionId,
        output: `Started Playwright browser session ${sessionId}.`,
        observation: await this.observeSession(session, request),
      };
      await this.startLiveStream(session, request);
      this.scheduleIdleClose(session);
      return result;
    } catch (error) {
      await this.closeSession(session);
      throw error;
    }
  }

  private async navigate(request: InteractiveUseRequest): Promise<InteractiveUseProviderResult> {
    const session = this.requireSession(request.sessionId);
    try {
      if (!request.url) {
        throw new Error("browser_navigate requires url.");
      }
      this.assertUrlAllowed(request.url);
      await session.page.goto(request.url, {
        timeout: request.timeoutMs ?? this.defaultTimeoutMs,
        waitUntil: "domcontentloaded",
      });
      return {
        provider: "playwright",
        sessionId: session.id,
        output: `Navigated browser session ${session.id} to ${request.url}.`,
        observation: await this.observeSession(session, request),
      };
    } finally {
      this.scheduleIdleClose(session);
    }
  }

  private async observe(request: InteractiveUseRequest): Promise<InteractiveUseProviderResult> {
    const session = this.requireSession(request.sessionId);
    try {
      return {
        provider: "playwright",
        sessionId: session.id,
        output: `Observed browser session ${session.id}.`,
        observation: await this.observeSession(session, request),
      };
    } finally {
      this.scheduleIdleClose(session);
    }
  }

  private async click(request: InteractiveUseRequest): Promise<InteractiveUseProviderResult> {
    const session = this.requireSession(request.sessionId);
    try {
      this.assertCurrentUrlAllowed(session);
      const action = request.action;
      if (action?.selector) {
        await session.page.locator(action.selector).click({
          button: action.button,
          clickCount: readClickCount(request.input),
          timeout: request.timeoutMs ?? this.defaultTimeoutMs,
        });
      } else if (typeof action?.x === "number" && typeof action.y === "number") {
        await session.page.mouse.click(action.x, action.y, {
          button: action.button,
          clickCount: readClickCount(request.input),
        });
      } else {
        throw new Error("browser_click requires target.selector or target x/y coordinates.");
      }
      return {
        provider: "playwright",
        sessionId: session.id,
        output: `Clicked in browser session ${session.id}.`,
        observation: await this.observeSession(session, request),
      };
    } finally {
      this.scheduleIdleClose(session);
    }
  }

  private async type(request: InteractiveUseRequest): Promise<InteractiveUseProviderResult> {
    const session = this.requireSession(request.sessionId);
    try {
      this.assertCurrentUrlAllowed(session);
      const text = readText(request.input);
      if (request.action?.selector) {
        await session.page.locator(request.action.selector).type(text, {
          timeout: request.timeoutMs ?? this.defaultTimeoutMs,
        });
      } else {
        await session.page.keyboard.type(text);
      }
      return {
        provider: "playwright",
        sessionId: session.id,
        output: `Typed ${text.length} character(s) in browser session ${session.id}.`,
        observation: await this.observeSession(session, request),
      };
    } finally {
      this.scheduleIdleClose(session);
    }
  }

  private async keypress(request: InteractiveUseRequest): Promise<InteractiveUseProviderResult> {
    const session = this.requireSession(request.sessionId);
    try {
      this.assertCurrentUrlAllowed(session);
      for (const key of request.action?.keys ?? []) {
        await session.page.keyboard.press(key);
      }
      return {
        provider: "playwright",
        sessionId: session.id,
        output: `Sent keypresses in browser session ${session.id}.`,
        observation: await this.observeSession(session, request),
      };
    } finally {
      this.scheduleIdleClose(session);
    }
  }

  private async scroll(request: InteractiveUseRequest): Promise<InteractiveUseProviderResult> {
    const session = this.requireSession(request.sessionId);
    try {
      this.assertCurrentUrlAllowed(session);
      const { deltaX, deltaY } = scrollDelta(request);
      await session.page.mouse.wheel(deltaX, deltaY);
      return {
        provider: "playwright",
        sessionId: session.id,
        output: `Scrolled browser session ${session.id}.`,
        observation: await this.observeSession(session, request),
      };
    } finally {
      this.scheduleIdleClose(session);
    }
  }

  private async stopSession(request: InteractiveUseRequest): Promise<InteractiveUseProviderResult> {
    const session = this.requireSession(request.sessionId);
    if (this.isRecorderSession(session.id)) {
      await this.captureAndEmitLiveFrame(session, "session_stop");
    }
    await this.closeSession(session);
    return {
      provider: "playwright",
      sessionId: session.id,
      output: `Stopped Playwright browser session ${session.id}.`,
    };
  }

  private requireSession(sessionId: string | undefined): BrowserSession {
    const id = sessionId ?? this.activeSessionId;
    const session = id ? this.sessions.get(id) : undefined;
    if (!session) {
      throw new Error("No active Playwright browser session. Call browser_session_start first.");
    }
    this.activeSessionId = session.id;
    this.clearIdleTimer(session.id);
    return session;
  }

  private async observeSession(
    session: BrowserSession,
    request: InteractiveUseRequest,
  ): Promise<InteractiveObservationMetadata> {
    this.assertCurrentUrlAllowed(session);
    const [title, visibleText] = await Promise.all([
      session.page.title().catch(() => undefined),
      session.page.locator("body").innerText({ timeout: 1_000 }).catch(() => undefined),
    ]);
    const screenshot = request.observationRequest?.includeScreenshot === true
      ? await this.captureScreenshot(session).catch(() => undefined)
      : undefined;
    return {
      url: session.page.url(),
      ...(title ? { title } : {}),
      ...(visibleText ? { visibleText } : {}),
      ...(screenshot?.uri ? { screenshotUri: screenshot.uri } : {}),
      ...(screenshot?.dataUrl ? { screenshotDataUrl: screenshot.dataUrl } : {}),
    };
  }

  private async captureScreenshot(
    session: BrowserSession,
  ): Promise<{ readonly uri?: string; readonly dataUrl: string; readonly width?: number; readonly height?: number }> {
    const content = await session.page.screenshot({ type: "png", fullPage: false });
    const dataUrl = `data:image/png;base64,${Buffer.from(content).toString("base64")}`;
    const viewport = session.page.viewportSize?.() ?? session.viewport;
    const uri = this.artifactSink
      ? await this.artifactSink.writeInteractiveArtifact({
          sessionId: session.id,
          kind: "screenshot",
          mimeType: "image/png",
          content,
        })
      : undefined;
    return {
      dataUrl,
      ...(uri ? { uri } : {}),
      ...(viewport ? { width: viewport.width, height: viewport.height } : {}),
    };
  }

  private assertUrlAllowed(value: string): void {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`Invalid browser URL: ${value}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Browser automation only allows HTTP(S) URLs.");
    }
    if (this.allowExternalBrowser) {
      return;
    }
    if (this.allowedDomains.length === 0) {
      throw new Error("Browser automation domain policy is missing. Configure interactiveUse.allowedDomains or set allowExternalBrowser=true.");
    }
    if (!this.allowedDomains.some((domain) => domainMatches(url.hostname, domain))) {
      throw new Error(`Browser automation denied for domain '${url.hostname}'. Configure interactiveUse.allowedDomains to allow it.`);
    }
  }

  private assertCurrentUrlAllowed(session: BrowserSession): void {
    const currentUrl = session.page.url();
    if (!currentUrl || currentUrl === "about:blank") {
      return;
    }
    this.assertUrlAllowed(currentUrl);
  }

  private async closeSession(session: BrowserSession): Promise<void> {
    this.clearIdleTimer(session.id);
    this.clearStreamTimer(session.id);
    await this.stopCdpScreencast(session.id);
    this.sessions.delete(session.id);
    if (this.activeSessionId === session.id) {
      this.activeSessionId = this.sessions.keys().next().value;
    }
    await Promise.allSettled([
      session.context.close(),
      session.browser.close(),
    ]);
    this.emitBrowserSessionState({
      session,
      operation: "session_stop",
      ownership: "released",
      viewMode: "snapshot",
      stream: { status: "ended" },
    });
  }

  private async startLiveStream(session: BrowserSession, request: InteractiveUseRequest): Promise<void> {
    if (!this.liveStream.enabled || (!this.onBrowserSessionUpdated && !this.captureRecorder)) {
      return;
    }
    this.emitBrowserSessionState({
      session,
      operation: request.operation,
      ownership: "agent",
      viewMode: "live",
      stream: { status: "starting" },
    });
    if (await this.startCdpScreencast(session, request.operation)) {
      return;
    }
    this.scheduleStreamCapture(session, request.operation);
  }

  private async startCdpScreencast(session: BrowserSession, operation: InteractiveUseRequest["operation"]): Promise<boolean> {
    if (!this.artifactSink || !session.context.newCDPSession || this.cdpStreams.has(session.id)) {
      return false;
    }
    try {
      const cdpSession = await session.context.newCDPSession(session.page);
      const handler = (frame: CdpScreencastFrame) => {
        void this.handleCdpScreencastFrame(session, cdpSession, operation, frame);
      };
      cdpSession.on("Page.screencastFrame", handler);
      this.cdpStreams.set(session.id, { session: cdpSession, handler });
      await cdpSession.send("Page.startScreencast", {
        format: "png",
        everyNthFrame: 1,
      });
      return true;
    } catch {
      await this.stopCdpScreencast(session.id);
      return false;
    }
  }

  private async handleCdpScreencastFrame(
    session: BrowserSession,
    cdpSession: CdpSession,
    operation: InteractiveUseRequest["operation"],
    frame: CdpScreencastFrame,
  ): Promise<void> {
    try {
      if (!this.sessions.has(session.id) || !this.artifactSink) {
        return;
      }
      this.assertCurrentUrlAllowed(session);
      const content = Buffer.from(frame.data, "base64");
      const viewport = session.page.viewportSize?.() ?? session.viewport;
      const width = frame.metadata?.deviceWidth ?? viewport?.width;
      const height = frame.metadata?.deviceHeight ?? viewport?.height;
      const uri = await this.artifactSink.writeInteractiveArtifact({
        sessionId: session.id,
        kind: "screenshot",
        mimeType: "image/png",
        content,
      });
      await cdpSession.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
      this.emitBrowserSessionState({
        session,
        operation,
        title: await session.page.title().catch(() => undefined),
        ownership: "agent",
        viewMode: "live",
        stream: { status: "live" },
        latestCaptureUri: uri,
        latestCaptureWidth: width,
        latestCaptureHeight: height,
        latestCaptureTransport: "cdp-screencast",
      });
    } catch (error) {
      this.emitBrowserSessionState({
        session,
        operation,
        ownership: "agent",
        viewMode: "live",
        stream: {
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private async stopCdpScreencast(sessionId: string): Promise<void> {
    const stream = this.cdpStreams.get(sessionId);
    if (!stream) {
      return;
    }
    this.cdpStreams.delete(sessionId);
    stream.session.off?.("Page.screencastFrame", stream.handler);
    await stream.session.send("Page.stopScreencast").catch(() => undefined);
    await stream.session.detach?.().catch(() => undefined);
  }

  private scheduleStreamCapture(session: BrowserSession, operation: InteractiveUseRequest["operation"]): void {
    if (!this.liveStream.enabled || (!this.onBrowserSessionUpdated && !this.captureRecorder) || !this.sessions.has(session.id)) {
      return;
    }
    this.clearStreamTimer(session.id);
    const timer = setTimeout(() => {
      void this.captureAndEmitLiveFrame(session, operation).finally(() => {
        if (this.sessions.has(session.id)) {
          this.scheduleStreamCapture(session, operation);
        }
      });
    }, this.liveStream.intervalMs);
    timer.unref?.();
    this.streamTimers.set(session.id, timer);
  }

  private async captureAndEmitLiveFrame(session: BrowserSession, operation: InteractiveUseRequest["operation"]): Promise<void> {
    try {
      this.assertCurrentUrlAllowed(session);
      const [title, screenshot] = await Promise.all([
        session.page.title().catch(() => undefined),
        this.captureScreenshot(session),
      ]);
      this.emitBrowserSessionState({
        session,
        operation,
        title,
        ownership: "agent",
        viewMode: "live",
        stream: { status: "live" },
        latestCaptureUri: screenshot.uri,
        latestCaptureWidth: screenshot.width,
        latestCaptureHeight: screenshot.height,
      });
    } catch (error) {
      this.emitBrowserSessionState({
        session,
        operation,
        ownership: "agent",
        viewMode: "live",
        stream: {
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private emitBrowserSessionState(input: {
    readonly session: BrowserSession;
    readonly operation?: string;
    readonly title?: string;
    readonly ownership: PlaywrightBrowserSessionState["ownership"];
    readonly viewMode: PlaywrightBrowserSessionState["viewMode"];
    readonly stream: PlaywrightBrowserSessionState["stream"];
    readonly latestCaptureUri?: string;
    readonly latestCaptureWidth?: number;
    readonly latestCaptureHeight?: number;
    readonly latestCaptureTransport?: PlaywrightBrowserLiveViewportTransport;
  }): PlaywrightBrowserSessionState {
    const url = input.session.page.url();
    const state: PlaywrightBrowserSessionState = {
      target: "browser",
      status: input.stream.status === "failed" ? "failed" : input.stream.status === "ended" ? "succeeded" : "running",
      updatedAt: this.now().toISOString(),
      provider: "playwright",
      sessionId: input.session.id,
      ...(input.operation ? { operation: input.operation } : {}),
      ...(url && url !== "about:blank" ? { url } : {}),
      ...(input.title ? { title: input.title } : {}),
      ownership: input.ownership,
      viewMode: input.viewMode,
      stream: input.stream,
      ...(input.latestCaptureUri
        ? {
            latestCapture: {
              uri: input.latestCaptureUri,
              relation: "snapshot",
              mimeType: "image/png",
              ...(input.latestCaptureWidth ? { width: input.latestCaptureWidth } : {}),
              ...(input.latestCaptureHeight ? { height: input.latestCaptureHeight } : {}),
              transport: input.latestCaptureTransport ?? "snapshot-polling",
            },
          }
        : {}),
    };
    this.recordBrowserCaptureState(state);
    if (this.onBrowserSessionUpdated) {
      void Promise.resolve(this.onBrowserSessionUpdated(state)).catch(() => {});
    }
    return state;
  }

  private recordBrowserCaptureState(state: PlaywrightBrowserSessionState): void {
    const recorder = this.captureRecorder;
    if (!recorder || !this.recorderSessionIds.has(state.sessionId) || !state.latestCapture?.uri) {
      return;
    }
    recorder.recordBrowserCaptureFrame({
      sessionId: state.sessionId,
      capturedAt: state.updatedAt,
      ...(state.operation ? { operation: state.operation } : {}),
      transport: state.latestCapture.transport ?? "snapshot-polling",
      artifactUri: state.latestCapture.uri,
      ...(state.url ? { url: state.url } : {}),
      ...(state.title ? { title: state.title } : {}),
      ...(state.latestCapture.width !== undefined ? { width: state.latestCapture.width } : {}),
      ...(state.latestCapture.height !== undefined ? { height: state.latestCapture.height } : {}),
    });
  }

  private markRecorderSessionIfRequested(
    request: InteractiveUseRequest,
    sessionId: string | undefined,
  ): void {
    if (request.operation !== "session_start" || request.recordArtifacts !== true || !sessionId || !this.captureRecorder) {
      return;
    }
    this.recorderSessionIds.add(sessionId);
  }

  private isRecorderSession(sessionId: string | undefined): boolean {
    return Boolean(this.captureRecorder && sessionId && this.recorderSessionIds.has(sessionId));
  }

  private async finalizeRecorderSession(
    sessionId: string,
    completedAt: string,
    title: string | undefined,
  ): Promise<PlaywrightBrowserRecorderSessionProof> {
    if (!this.captureRecorder) {
      throw new Error("Playwright browser recorder is not configured.");
    }
    const capture = this.captureRecorder.finalizeSession(sessionId, {
      completedAt,
      ...(title ? { title } : {}),
    });
    const video = await this.captureRecorder.renderBasicVideo(sessionId, {
      completedAt,
      ...(title ? { title } : {}),
    });
    const editor = this.captureRecorder.exportExternalEditorProject(sessionId, {
      completedAt,
      ...(title ? { title } : {}),
    });
    return {
      version: "playwright-browser-recorder-session.v1",
      sessionId,
      capture,
      video,
      editor,
    };
  }

  private scheduleIdleClose(session: BrowserSession): void {
    if (!this.sessions.has(session.id) || this.idleSessionTtlMs === undefined) {
      return;
    }
    this.clearIdleTimer(session.id);
    const timer = setTimeout(() => {
      void this.closeSession(session).catch(() => {});
    }, this.idleSessionTtlMs);
    timer.unref?.();
    this.idleTimers.set(session.id, timer);
  }

  private clearIdleTimer(sessionId: string): void {
    const timer = this.idleTimers.get(sessionId);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.idleTimers.delete(sessionId);
  }

  private clearStreamTimer(sessionId: string): void {
    const timer = this.streamTimers.get(sessionId);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.streamTimers.delete(sessionId);
  }

  private readHeadless(request: InteractiveUseRequest): boolean {
    const raw = request.input.headless;
    const requested = typeof raw === "boolean" ? raw : this.headless;
    if (!requested && !this.allowHeaded) {
      throw new Error(
        "Headed Playwright browser sessions are disabled. Configure interactiveUse.browserEnvironment=isolated-headed before launching a visible browser session.",
      );
    }
    return requested;
  }

  private async launchBrowser(playwright: PlaywrightModule, request: InteractiveUseRequest): Promise<Browser> {
    try {
      return await playwright.chromium.launch({ headless: this.readHeadless(request) });
    } catch (error) {
      if (isPlaywrightBrowserInstallError(error)) {
        throw new Error(PLAYWRIGHT_BROWSER_USE_MISSING_DEPENDENCY_MESSAGE);
      }
      throw error;
    }
  }
}

async function loadPlaywright(): Promise<PlaywrightModule> {
  try {
    const importOptional = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
    const mod = await importOptional("playwright");
    if (!isPlaywrightModule(mod)) {
      throw new Error("The installed 'playwright' package did not expose chromium.");
    }
    return mod;
  } catch (error) {
    if (error instanceof Error && error.message.includes("did not expose chromium")) {
      throw error;
    }
    throw new Error(PLAYWRIGHT_BROWSER_USE_MISSING_DEPENDENCY_MESSAGE);
  }
}

function isPlaywrightModule(value: unknown): value is PlaywrightModule {
  return Boolean(
    value
      && typeof value === "object"
      && "chromium" in value
      && typeof (value as { chromium?: { launch?: unknown } }).chromium?.launch === "function",
  );
}

function isPlaywrightBrowserInstallError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("executable doesn't exist") || message.includes("playwright install");
}

function readViewport(input: Record<string, unknown>): ViewportSize | undefined {
  const viewport = input.viewport;
  if (!viewport || typeof viewport !== "object" || Array.isArray(viewport)) {
    return undefined;
  }
  const width = (viewport as Record<string, unknown>).width;
  const height = (viewport as Record<string, unknown>).height;
  if (typeof width !== "number" || typeof height !== "number") {
    return undefined;
  }
  return { width, height };
}

function readClickCount(input: Record<string, unknown>): number | undefined {
  const value = input.clickCount;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readText(input: Record<string, unknown>): string {
  const value = input.text;
  if (typeof value !== "string") {
    throw new Error("Type action requires text.");
  }
  return value;
}

function scrollDelta(request: InteractiveUseRequest): { readonly deltaX: number; readonly deltaY: number } {
  if (typeof request.action?.deltaX === "number" || typeof request.action?.deltaY === "number") {
    return {
      deltaX: request.action.deltaX ?? 0,
      deltaY: request.action.deltaY ?? 0,
    };
  }
  switch (request.action?.direction) {
    case "up":
      return { deltaX: 0, deltaY: -600 };
    case "left":
      return { deltaX: -600, deltaY: 0 };
    case "right":
      return { deltaX: 600, deltaY: 0 };
    case "down":
    default:
      return { deltaX: 0, deltaY: 600 };
  }
}

function domainMatches(hostname: string, configuredDomain: string): boolean {
  const normalized = configuredDomain.trim().toLowerCase();
  const host = hostname.toLowerCase();
  return normalized === "*" || host === normalized || host.endsWith(`.${normalized}`);
}

function normalizeIdleSessionTtl(value: number | undefined): number | undefined {
  if (value === undefined) {
    return 120_000;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.trunc(value);
}

function normalizeLiveStreamInterval(value: number | undefined): number {
  if (value === undefined) {
    return 1_000;
  }
  if (!Number.isFinite(value) || value < 10) {
    return 10;
  }
  return Math.trunc(value);
}

function recorderProofOutput(
  baseOutput: string | undefined,
  proof: PlaywrightBrowserRecorderSessionProof,
): string {
  const lines = [
    baseOutput?.trim() || `Stopped Playwright browser session ${proof.sessionId}.`,
    "Recorder artifacts:",
    `- Video: ${proof.video.exportUri}`,
    `- Editor project: ${proof.editor.editorProjectUri}`,
    `- Captions SRT: ${proof.editor.captionsSrtUri}`,
    `- Captions VTT: ${proof.editor.captionsVttUri}`,
    `- Capture manifest: ${proof.capture.manifestUri}`,
  ];
  return lines.join("\n");
}

function recorderProofContent(
  proof: PlaywrightBrowserRecorderSessionProof,
): NonNullable<InteractiveUseProviderResult["content"]> {
  return [
    recorderResourceLink(proof.video.exportUri, "Recorder WebM video", proof.video.mimeType, 0.95),
    recorderResourceLink(
      proof.editor.editorProjectUri,
      "Recorder editor project",
      "application/vnd.kiln.recorder.editor-project+json",
      0.9,
    ),
    recorderResourceLink(proof.editor.captionsSrtUri, "Recorder captions SRT", "application/x-subrip", 0.75),
    recorderResourceLink(proof.editor.captionsVttUri, "Recorder captions VTT", "text/vtt", 0.75),
    recorderResourceLink(proof.editor.markerJsonUri, "Recorder edit markers", "application/json", 0.7),
    recorderResourceLink(proof.editor.manifestUri, "Recorder editor manifest", "application/json", 0.65),
    recorderResourceLink(proof.capture.manifestUri, "Recorder capture manifest", "application/json", 0.65),
  ];
}

function recorderResourceLink(
  uri: string,
  name: string,
  mimeType: string,
  priority: number,
): NonNullable<InteractiveUseProviderResult["content"]>[number] {
  return {
    type: "resource_link",
    uri,
    name,
    mimeType,
    annotations: {
      audience: ["assistant"],
      priority,
    },
  };
}
