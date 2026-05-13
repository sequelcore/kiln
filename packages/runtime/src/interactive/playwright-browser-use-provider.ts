import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import type {
  InteractiveObservationMetadata,
  InteractiveUseProvider,
  InteractiveUseProviderResult,
  InteractiveUseRequest,
} from "@kilnai/core";

export const PLAYWRIGHT_BROWSER_USE_MISSING_DEPENDENCY_MESSAGE =
  "Playwright browser use provider is not available. Install the optional peer dependency 'playwright' in the runtime host and install a browser before enabling interactiveUse.browserProvider=playwright. For Bun: bun add -d playwright && bun x playwright install chromium.";

type PlaywrightLoader = () => Promise<PlaywrightModule>;
type PlaywrightNodeSidecarRunner = {
  execute(request: InteractiveUseRequest): Promise<InteractiveUseProviderResult>;
  control(request: PlaywrightBrowserSessionControlRequest): Promise<PlaywrightBrowserSessionState>;
  closeAll(): Promise<void>;
};

export interface PlaywrightBrowserUseProviderOptions {
  readonly loader?: PlaywrightLoader;
  readonly sidecarRunner?: PlaywrightNodeSidecarRunner;
  readonly allowedDomains?: readonly string[];
  readonly allowExternalBrowser?: boolean;
  readonly headless?: boolean;
  readonly allowHeaded?: boolean;
  readonly defaultTimeoutMs?: number;
  readonly idleSessionTtlMs?: number;
  readonly artifactSink?: InteractiveArtifactSink;
  readonly liveStream?: PlaywrightBrowserLiveStreamOptions;
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

export interface PlaywrightBrowserSessionState {
  readonly target: "browser";
  readonly status: "running" | "succeeded" | "failed";
  readonly updatedAt: string;
  readonly provider: "playwright";
  readonly sessionId: string;
  readonly operation?: string;
  readonly url?: string;
  readonly title?: string;
  readonly ownership: "agent" | "operator" | "released";
  readonly viewMode: "snapshot" | "live";
  readonly stream: {
    readonly status: "starting" | "live" | "paused" | "ended" | "failed";
    readonly reason?: string;
  };
  readonly latestCapture?: {
    readonly uri: string;
    readonly relation: "snapshot";
    readonly mimeType: "image/png";
  };
}

export interface PlaywrightBrowserSessionControlRequest {
  readonly action: "takeover" | "release";
  readonly sessionId?: string;
  readonly operatorId?: string;
  readonly reason?: string;
}

interface BrowserSessionOperatorLock {
  readonly operatorId?: string;
  readonly reason?: string;
  readonly acquiredAt: string;
}

interface PlaywrightNodeSidecarBrowserSessionState extends Omit<PlaywrightBrowserSessionState, "latestCapture"> {
  readonly latestCapture?: {
    readonly dataUrl: string;
    readonly relation: "snapshot";
    readonly mimeType: "image/png";
  };
}

interface PlaywrightNodeSidecarBrowserSessionUpdateEvent {
  readonly type: "browser_session_updated";
  readonly state: PlaywrightNodeSidecarBrowserSessionState;
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
  locator(selector: string): Locator;
  mouse: {
    click(x: number, y: number, options?: { readonly button?: "left" | "middle" | "right"; readonly clickCount?: number }): Promise<void>;
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
  private readonly liveStream: Required<PlaywrightBrowserLiveStreamOptions>;
  private onBrowserSessionUpdated?: (state: PlaywrightBrowserSessionState) => void | Promise<void>;
  private readonly sidecarRunner?: PlaywrightNodeSidecarRunner;
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly streamTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly operatorLocks = new Map<string, BrowserSessionOperatorLock>();
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
    this.liveStream = {
      enabled: options.liveStream?.enabled === true,
      intervalMs: normalizeLiveStreamInterval(options.liveStream?.intervalMs),
    };
    this.onBrowserSessionUpdated = options.onBrowserSessionUpdated;
    this.sidecarRunner = options.sidecarRunner ?? (
      options.loader
        ? undefined
        : shouldUseNodeSidecar()
          ? createPlaywrightNodeSidecarRunner(() => ({
              allowedDomains: this.allowedDomains,
              allowExternalBrowser: this.allowExternalBrowser,
              headless: this.headless,
              allowHeaded: this.allowHeaded,
              defaultTimeoutMs: this.defaultTimeoutMs,
              idleSessionTtlMs: this.idleSessionTtlMs,
              liveStream: {
                enabled: this.liveStream.enabled && Boolean(this.onBrowserSessionUpdated),
                intervalMs: this.liveStream.intervalMs,
              },
            }), {
              onBrowserSessionUpdated: (event) => this.forwardSidecarBrowserSessionUpdate(event),
            })
          : undefined
    );
  }

  async execute(request: InteractiveUseRequest): Promise<InteractiveUseProviderResult> {
    if (request.target !== "browser") {
      throw new Error("Playwright browser use provider only supports browser targets.");
    }
    if (this.sidecarRunner) {
      return this.sidecarRunner.execute(request);
    }

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

  setInteractiveArtifactSink(sink: InteractiveArtifactSink | undefined): void {
    this.artifactSink = sink;
  }

  setBrowserSessionUpdateHandler(handler: ((state: PlaywrightBrowserSessionState) => void | Promise<void>) | undefined): void {
    this.onBrowserSessionUpdated = handler;
  }

  async requestBrowserSessionControl(request: PlaywrightBrowserSessionControlRequest): Promise<PlaywrightBrowserSessionState> {
    if (this.sidecarRunner) {
      return this.sidecarRunner.control(request);
    }
    const session = this.requireSession(request.sessionId);
    if (request.action === "takeover") {
      this.operatorLocks.set(session.id, {
        ...(request.operatorId ? { operatorId: request.operatorId } : {}),
        ...(request.reason ? { reason: request.reason } : {}),
        acquiredAt: new Date().toISOString(),
      });
      this.clearStreamTimer(session.id);
      return this.emitBrowserSessionState({
        session,
        operation: "operator_takeover",
        ownership: "operator",
        viewMode: "live",
        stream: {
          status: "paused",
          reason: request.reason ?? "Operator took control of the browser session.",
        },
      });
    }

    this.operatorLocks.delete(session.id);
    try {
      const [title, screenshot] = await Promise.all([
        session.page.title().catch(() => undefined),
        this.captureScreenshot(session),
      ]);
      const state = this.emitBrowserSessionState({
        session,
        operation: "operator_release",
        title,
        ownership: "agent",
        viewMode: "live",
        stream: { status: "live" },
        latestCaptureUri: screenshot.uri,
      });
      this.scheduleStreamCapture(session, "observe");
      this.scheduleIdleClose(session);
      return state;
    } catch (error) {
      const state = this.emitBrowserSessionState({
        session,
        operation: "operator_release",
        ownership: "agent",
        viewMode: "live",
        stream: {
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
        },
      });
      this.scheduleIdleClose(session);
      return state;
    }
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
    this.operatorLocks.clear();
    this.activeSessionId = undefined;
    await Promise.allSettled([
      ...sessions.map((session) => this.closeSession(session)),
      ...(this.sidecarRunner ? [this.sidecarRunner.closeAll()] : []),
    ]);
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
        this.assertAgentBrowserControl(existingSession);
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
      this.startLiveStream(existingSession, request);
      this.scheduleIdleClose(existingSession);
      return result;
    }

    const playwright = await this.loader();
    const sessionId = request.sessionId ?? `browser-${++this.sequence}`;
    const browser = await this.launchBrowser(playwright, request);
    const context = await browser.newContext({ viewport: readViewport(request.input) });
    const page = await context.newPage();
    const session: BrowserSession = { id: sessionId, browser, context, page };
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
      this.startLiveStream(session, request);
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
      this.assertAgentBrowserControl(session);
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
      this.assertAgentBrowserControl(session);
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
      this.assertAgentBrowserControl(session);
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
      this.assertAgentBrowserControl(session);
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
      this.assertAgentBrowserControl(session);
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

  private async captureScreenshot(session: BrowserSession): Promise<{ readonly uri?: string; readonly dataUrl: string }> {
    const content = await session.page.screenshot({ type: "png", fullPage: false });
    const dataUrl = `data:image/png;base64,${Buffer.from(content).toString("base64")}`;
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
    this.operatorLocks.delete(session.id);
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

  private startLiveStream(session: BrowserSession, request: InteractiveUseRequest): void {
    if (!this.liveStream.enabled || !this.onBrowserSessionUpdated) {
      return;
    }
    this.emitBrowserSessionState({
      session,
      operation: request.operation,
      ownership: "agent",
      viewMode: "live",
      stream: { status: "starting" },
    });
    this.scheduleStreamCapture(session, request.operation);
  }

  private scheduleStreamCapture(session: BrowserSession, operation: InteractiveUseRequest["operation"]): void {
    if (!this.liveStream.enabled || !this.onBrowserSessionUpdated || !this.sessions.has(session.id)) {
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
  }): PlaywrightBrowserSessionState {
    const url = input.session.page.url();
    const state: PlaywrightBrowserSessionState = {
      target: "browser",
      status: input.stream.status === "failed" ? "failed" : input.stream.status === "ended" ? "succeeded" : "running",
      updatedAt: new Date().toISOString(),
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
            },
          }
        : {}),
    };
    if (this.onBrowserSessionUpdated) {
      void Promise.resolve(this.onBrowserSessionUpdated(state)).catch(() => {});
    }
    return state;
  }

  private forwardSidecarBrowserSessionUpdate(event: PlaywrightNodeSidecarBrowserSessionUpdateEvent): void {
    if (!this.onBrowserSessionUpdated) {
      return;
    }
    void this.materializeSidecarBrowserSessionState(event)
      .then((state) => this.onBrowserSessionUpdated?.(state))
      .catch(() => {});
  }

  private async materializeSidecarBrowserSessionState(
    event: PlaywrightNodeSidecarBrowserSessionUpdateEvent,
  ): Promise<PlaywrightBrowserSessionState> {
    const { latestCapture, ...state } = event.state;
    if (!latestCapture || !this.artifactSink) {
      return state;
    }
    const content = parseImageDataUrl(latestCapture.dataUrl);
    if (!content) {
      return state;
    }
    const uri = await this.artifactSink.writeInteractiveArtifact({
      sessionId: state.sessionId,
      kind: "screenshot",
      mimeType: latestCapture.mimeType,
      content,
    });
    return {
      ...state,
      latestCapture: {
        uri,
        relation: latestCapture.relation,
        mimeType: latestCapture.mimeType,
      },
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

  private assertAgentBrowserControl(session: BrowserSession): void {
    if (!this.operatorLocks.has(session.id)) {
      return;
    }
    throw new Error(`Browser session ${session.id} is under operator control.`);
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

function shouldUseNodeSidecar(): boolean {
  return Boolean(process.versions.bun) && process.platform === "win32";
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

interface PlaywrightNodeSidecarConfig {
  readonly allowedDomains: readonly string[];
  readonly allowExternalBrowser: boolean;
  readonly headless: boolean;
  readonly allowHeaded: boolean;
  readonly defaultTimeoutMs: number;
  readonly idleSessionTtlMs?: number;
  readonly liveStream?: Required<PlaywrightBrowserLiveStreamOptions>;
}

interface PlaywrightNodeSidecarWireRequest {
  readonly id: number;
  readonly config: PlaywrightNodeSidecarConfig;
  readonly request:
    | InteractiveUseRequest
    | { readonly operation: "close_all" }
    | ({ readonly operation: "browser_session_control" } & PlaywrightBrowserSessionControlRequest);
}

interface PlaywrightNodeSidecarWireResponse {
  readonly id: number;
  readonly ok: boolean;
  readonly result?: InteractiveUseProviderResult | PlaywrightBrowserSessionState;
  readonly error?: string;
}

interface PlaywrightNodeSidecarRunnerEvents {
  readonly onBrowserSessionUpdated?: (event: PlaywrightNodeSidecarBrowserSessionUpdateEvent) => void;
}

function createPlaywrightNodeSidecarRunner(
  readConfig: () => PlaywrightNodeSidecarConfig,
  events: PlaywrightNodeSidecarRunnerEvents = {},
): PlaywrightNodeSidecarRunner {
  const sidecarPath = fileURLToPath(new URL("./playwright-node-sidecar.js", import.meta.url));
  let child: ChildProcessWithoutNullStreams | undefined;
  let sequence = 0;
  const pending = new Map<number, {
    readonly resolve: (value: InteractiveUseProviderResult | PlaywrightBrowserSessionState) => void;
    readonly reject: (error: Error) => void;
    readonly timer: ReturnType<typeof setTimeout>;
  }>();
  let stderrTail = "";

  function ensureChild(): ChildProcessWithoutNullStreams {
    if (child && !child.killed && child.exitCode === null) {
      return child;
    }
    child = spawn("node", [sidecarPath], {
      cwd: fileURLToPath(new URL(".", import.meta.url)),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    stderrTail = "";
    child.stderr.on("data", (chunk) => {
      stderrTail = `${stderrTail}${String(chunk)}`.slice(-4000);
    });
    child.on("exit", () => {
      const suffix = stderrTail.trim() ? ` Stderr: ${stderrTail.trim()}` : "";
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`Playwright browser sidecar exited before completing request ${id}.${suffix}`));
      }
      pending.clear();
      child = undefined;
    });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      let message: PlaywrightNodeSidecarWireResponse | PlaywrightNodeSidecarBrowserSessionUpdateEvent;
      try {
        message = JSON.parse(line) as PlaywrightNodeSidecarWireResponse | PlaywrightNodeSidecarBrowserSessionUpdateEvent;
      } catch {
        return;
      }
      if (isPlaywrightNodeSidecarBrowserSessionUpdateEvent(message)) {
        events.onBrowserSessionUpdated?.(message);
        return;
      }
      const entry = pending.get(message.id);
      if (!entry) {
        return;
      }
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.ok && message.result) {
        entry.resolve(message.result);
      } else {
        entry.reject(new Error(message.error ?? "Playwright browser sidecar failed."));
      }
    });
    return child;
  }

  async function send<TResult extends InteractiveUseProviderResult | PlaywrightBrowserSessionState>(
    config: PlaywrightNodeSidecarConfig,
    request: PlaywrightNodeSidecarWireRequest["request"],
    timeoutMs: number,
  ): Promise<TResult> {
    const activeChild = ensureChild();
    const id = ++sequence;
    const payload: PlaywrightNodeSidecarWireRequest = { id, config, request };
    return await new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        activeChild.kill();
        reject(new Error(`Playwright browser sidecar timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      pending.set(id, { resolve: (value) => resolve(value as TResult), reject, timer });
      activeChild.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (error) {
          pending.delete(id);
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }

  return {
    execute(request) {
      const config = readConfig();
      return send<InteractiveUseProviderResult>(config, request, request.timeoutMs ?? config.defaultTimeoutMs);
    },
    control(request) {
      return send<PlaywrightBrowserSessionState>(
        readConfig(),
        { operation: "browser_session_control", ...request },
        5_000,
      );
    },
    async closeAll() {
      if (!child || child.killed || child.exitCode !== null) {
        return;
      }
      try {
        await send<InteractiveUseProviderResult>(readConfig(), { operation: "close_all" }, 5_000);
      } finally {
        child.kill();
      }
    },
  };
}

function isPlaywrightNodeSidecarBrowserSessionUpdateEvent(
  value: unknown,
): value is PlaywrightNodeSidecarBrowserSessionUpdateEvent {
  return Boolean(
    value
      && typeof value === "object"
      && (value as { type?: unknown }).type === "browser_session_updated"
      && typeof (value as { state?: { sessionId?: unknown } }).state?.sessionId === "string",
  );
}

function parseImageDataUrl(value: string): Uint8Array | undefined {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/u.exec(value);
  if (!match) {
    return undefined;
  }
  const base64 = match[1];
  return base64 ? Buffer.from(base64, "base64") : undefined;
}
