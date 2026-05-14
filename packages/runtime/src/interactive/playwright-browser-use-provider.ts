import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
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
type PlaywrightNodeSidecarRunner = {
  execute(request: InteractiveUseRequest): Promise<InteractiveUseProviderResult>;
  control(request: PlaywrightBrowserSessionControlRequest): Promise<PlaywrightBrowserSessionState>;
  operatorInput(request: PlaywrightBrowserOperatorInputRequest): Promise<PlaywrightBrowserOperatorInputAck>;
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
    readonly width?: number;
    readonly height?: number;
    readonly transport?: PlaywrightBrowserLiveViewportTransport;
  };
}

export interface PlaywrightBrowserSessionControlRequest {
  readonly action: "takeover" | "release";
  readonly sessionId?: string;
  readonly operatorId?: string;
  readonly reason?: string;
}

export type PlaywrightBrowserOperatorInput =
  | {
      readonly kind: "pointer";
      readonly phase: "move" | "down" | "up" | "click";
      readonly x: number;
      readonly y: number;
      readonly button?: "left" | "middle" | "right" | "back" | "forward" | "none";
      readonly clickCount?: number;
    }
  | {
      readonly kind: "wheel";
      readonly x: number;
      readonly y: number;
      readonly deltaX: number;
      readonly deltaY: number;
    }
  | {
      readonly kind: "key";
      readonly phase: "down" | "up" | "press";
      readonly key: string;
      readonly text?: string;
    }
  | {
      readonly kind: "text";
      readonly text: string;
    };

export interface PlaywrightBrowserOperatorInputRequest {
  readonly requestId: string;
  readonly sessionId: string;
  readonly operatorId?: string;
  readonly input: PlaywrightBrowserOperatorInput;
}

export interface PlaywrightBrowserOperatorInputAck {
  readonly requestId: string;
  readonly sessionId?: string;
  readonly status: "accepted" | "blocked" | "failed" | "stale-session";
  readonly reason?: string;
  readonly handledAt: string;
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
    readonly width?: number;
    readonly height?: number;
    readonly transport?: PlaywrightBrowserLiveViewportTransport;
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
  private readonly sidecarRunner?: PlaywrightNodeSidecarRunner;
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly streamTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly cdpStreams = new Map<string, BrowserCdpScreencastStream>();
  private readonly operatorLocks = new Map<string, BrowserSessionOperatorLock>();
  private readonly recorderSessionIds = new Set<string>();
  private readonly pendingSidecarUpdates = new Map<string, Set<Promise<void>>>();
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
                enabled: this.liveStream.enabled && Boolean(this.onBrowserSessionUpdated || this.captureRecorder),
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
      await this.flushSidecarBrowserSessionUpdates(sessionId);
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

  async requestBrowserSessionControl(request: PlaywrightBrowserSessionControlRequest): Promise<PlaywrightBrowserSessionState> {
    if (this.sidecarRunner) {
      return this.sidecarRunner.control(request);
    }
    const session = this.requireSession(request.sessionId);
    if (request.action === "takeover") {
      this.operatorLocks.set(session.id, {
        ...(request.operatorId ? { operatorId: request.operatorId } : {}),
        ...(request.reason ? { reason: request.reason } : {}),
        acquiredAt: this.now().toISOString(),
      });
      try {
        const [title, screenshot] = await Promise.all([
          session.page.title().catch(() => undefined),
          this.captureScreenshot(session),
        ]);
        const state = this.emitBrowserSessionState({
          session,
          operation: "operator_takeover",
          title,
          ownership: "operator",
          viewMode: "live",
          stream: { status: "live" },
          latestCaptureUri: screenshot.uri,
          latestCaptureWidth: screenshot.width,
          latestCaptureHeight: screenshot.height,
        });
        this.scheduleStreamCapture(session, "observe");
        this.scheduleIdleClose(session);
        return state;
      } catch (error) {
        const state = this.emitBrowserSessionState({
          session,
          operation: "operator_takeover",
          ownership: "operator",
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
        latestCaptureWidth: screenshot.width,
        latestCaptureHeight: screenshot.height,
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

  async requestBrowserOperatorInput(request: PlaywrightBrowserOperatorInputRequest): Promise<PlaywrightBrowserOperatorInputAck> {
    if (this.sidecarRunner) {
      return this.sidecarRunner.operatorInput(request).catch((error) => ({
        requestId: request.requestId,
        sessionId: request.sessionId,
        status: "failed" as const,
        reason: error instanceof Error ? error.message : String(error),
        handledAt: this.now().toISOString(),
      }));
    }
    const handledAt = this.now().toISOString();
    const session = this.sessions.get(request.sessionId);
    if (!session) {
      return {
        requestId: request.requestId,
        sessionId: request.sessionId,
        status: "stale-session",
        reason: "Browser session is not active.",
        handledAt,
      };
    }
    if (!this.operatorLocks.has(session.id)) {
      return {
        requestId: request.requestId,
        sessionId: session.id,
        status: "blocked",
        reason: "Operator does not own the browser session.",
        handledAt,
      };
    }
    try {
      this.assertCurrentUrlAllowed(session);
      await this.dispatchOperatorInput(session, request.input);
      await this.captureAndEmitLiveFrame(session, "observe");
      this.scheduleIdleClose(session);
      return {
        requestId: request.requestId,
        sessionId: session.id,
        status: "accepted",
        handledAt,
      };
    } catch (error) {
      return {
        requestId: request.requestId,
        sessionId: session.id,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error),
        handledAt,
      };
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
    await Promise.allSettled([...this.cdpStreams.keys()].map((sessionId) => this.stopCdpScreencast(sessionId)));
    this.operatorLocks.clear();
    this.recorderSessionIds.clear();
    this.pendingSidecarUpdates.clear();
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

  private async dispatchOperatorInput(session: BrowserSession, input: PlaywrightBrowserOperatorInput): Promise<void> {
    const cdpStream = this.cdpStreams.get(session.id);
    if (cdpStream) {
      await this.dispatchCdpOperatorInput(cdpStream.session, input);
      return;
    }
    switch (input.kind) {
      case "pointer": {
        assertViewportCoordinate(input.x, input.y);
        const button = input.button === "none" || input.button === "back" || input.button === "forward"
          ? undefined
          : input.button;
        if (input.phase === "click") {
          await session.page.mouse.click(input.x, input.y, {
            ...(button ? { button } : {}),
            ...(input.clickCount ? { clickCount: input.clickCount } : {}),
          });
          return;
        }
        if (input.phase === "move") {
          if (!session.page.mouse.move) {
            throw new Error("Pointer move is not supported by the active browser provider.");
          }
          await session.page.mouse.move(input.x, input.y);
          return;
        }
        if (input.phase === "down") {
          if (!session.page.mouse.move || !session.page.mouse.down) {
            throw new Error("Pointer down is not supported by the active browser provider.");
          }
          await session.page.mouse.move(input.x, input.y);
          await session.page.mouse.down(button ? { button } : undefined);
          return;
        }
        if (!session.page.mouse.move || !session.page.mouse.up) {
          throw new Error("Pointer up is not supported by the active browser provider.");
        }
        await session.page.mouse.move(input.x, input.y);
        await session.page.mouse.up(button ? { button } : undefined);
        return;
      }
      case "wheel":
        assertViewportCoordinate(input.x, input.y);
        if (session.page.mouse.move) {
          await session.page.mouse.move(input.x, input.y);
        }
        await session.page.mouse.wheel(input.deltaX, input.deltaY);
        return;
      case "key":
        if (input.phase === "press") {
          await session.page.keyboard.press(input.key);
          return;
        }
        throw new Error("Key down/up operator input requires the CDP transport slice.");
      case "text":
        await session.page.keyboard.type(input.text);
        return;
      default:
        throw new Error("Unsupported browser operator input.");
    }
  }

  private async dispatchCdpOperatorInput(cdpSession: CdpSession, input: PlaywrightBrowserOperatorInput): Promise<void> {
    switch (input.kind) {
      case "pointer": {
        assertViewportCoordinate(input.x, input.y);
        const button = input.button === "none" || input.button === "back" || input.button === "forward"
          ? "none"
          : input.button ?? "left";
        if (input.phase === "click") {
          await cdpSession.send("Input.dispatchMouseEvent", {
            type: "mousePressed",
            x: input.x,
            y: input.y,
            button,
            clickCount: input.clickCount ?? 1,
          });
          await cdpSession.send("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: input.x,
            y: input.y,
            button,
            clickCount: input.clickCount ?? 1,
          });
          return;
        }
        await cdpSession.send("Input.dispatchMouseEvent", {
          type: input.phase === "move" ? "mouseMoved" : input.phase === "down" ? "mousePressed" : "mouseReleased",
          x: input.x,
          y: input.y,
          button,
          clickCount: input.clickCount ?? (input.phase === "move" ? 0 : 1),
        });
        return;
      }
      case "wheel":
        assertViewportCoordinate(input.x, input.y);
        await cdpSession.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: input.x,
          y: input.y,
          deltaX: input.deltaX,
          deltaY: input.deltaY,
        });
        return;
      case "key":
        await cdpSession.send("Input.dispatchKeyEvent", {
          type: input.phase === "up" ? "keyUp" : input.phase === "down" ? "rawKeyDown" : "keyDown",
          key: input.key,
          ...(input.text ? { text: input.text } : {}),
        });
        return;
      case "text":
        await cdpSession.send("Input.insertText", { text: input.text });
        return;
      default:
        throw new Error("Unsupported browser operator input.");
    }
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
        ownership: this.operatorLocks.has(session.id) ? "operator" : "agent",
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
        ownership: this.operatorLocks.has(session.id) ? "operator" : "agent",
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
        ownership: this.operatorLocks.has(session.id) ? "operator" : "agent",
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
        ownership: this.operatorLocks.has(session.id) ? "operator" : "agent",
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

  private forwardSidecarBrowserSessionUpdate(event: PlaywrightNodeSidecarBrowserSessionUpdateEvent): void {
    if (!this.onBrowserSessionUpdated && !this.captureRecorder) {
      return;
    }
    const update = this.materializeSidecarBrowserSessionState(event)
      .then((state) => {
        this.recordBrowserCaptureState(state);
        return this.onBrowserSessionUpdated?.(state);
      })
      .catch(() => {});
    this.trackSidecarBrowserSessionUpdate(event.state.sessionId, update);
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
        ...(latestCapture.width ? { width: latestCapture.width } : {}),
        ...(latestCapture.height ? { height: latestCapture.height } : {}),
        transport: latestCapture.transport ?? "snapshot-polling",
      },
    };
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

  private trackSidecarBrowserSessionUpdate(sessionId: string, update: Promise<void>): void {
    let updates = this.pendingSidecarUpdates.get(sessionId);
    if (!updates) {
      updates = new Set();
      this.pendingSidecarUpdates.set(sessionId, updates);
    }
    updates.add(update);
    update.finally(() => {
      updates?.delete(update);
      if (updates?.size === 0) {
        this.pendingSidecarUpdates.delete(sessionId);
      }
    });
  }

  private async flushSidecarBrowserSessionUpdates(sessionId: string): Promise<void> {
    while (true) {
      const updates = this.pendingSidecarUpdates.get(sessionId);
      if (!updates || updates.size === 0) {
        return;
      }
      await Promise.allSettled([...updates]);
    }
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

function assertViewportCoordinate(x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
    throw new Error("Browser operator input coordinates must be finite viewport-relative pixels.");
  }
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
    | ({ readonly operation: "browser_session_control" } & PlaywrightBrowserSessionControlRequest)
    | ({ readonly operation: "browser_operator_input" } & PlaywrightBrowserOperatorInputRequest);
}

interface PlaywrightNodeSidecarWireResponse {
  readonly id: number;
  readonly ok: boolean;
  readonly result?: InteractiveUseProviderResult | PlaywrightBrowserSessionState | PlaywrightBrowserOperatorInputAck;
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
    readonly resolve: (value: InteractiveUseProviderResult | PlaywrightBrowserSessionState | PlaywrightBrowserOperatorInputAck) => void;
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

  async function send<TResult extends InteractiveUseProviderResult | PlaywrightBrowserSessionState | PlaywrightBrowserOperatorInputAck>(
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
    operatorInput(request) {
      return send<PlaywrightBrowserOperatorInputAck>(
        readConfig(),
        { operation: "browser_operator_input", ...request },
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
