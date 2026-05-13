import { createInterface } from "node:readline";
import type {
  InteractiveObservationMetadata,
  InteractiveUseProviderResult,
  InteractiveUseRequest,
} from "@kilnai/core";

interface PlaywrightNodeSidecarConfig {
  readonly allowedDomains: readonly string[];
  readonly allowExternalBrowser: boolean;
  readonly headless: boolean;
  readonly allowHeaded: boolean;
  readonly defaultTimeoutMs: number;
  readonly idleSessionTtlMs?: number;
  readonly liveStream?: {
    readonly enabled?: boolean;
    readonly intervalMs?: number;
  };
}

interface WireRequest {
  readonly id: number;
  readonly config: PlaywrightNodeSidecarConfig;
  readonly request:
    | InteractiveUseRequest
    | { readonly operation: "close_all" }
    | BrowserSessionControlRequest;
}

interface WireResponse {
  readonly id: number;
  readonly ok: boolean;
  readonly result?: InteractiveUseProviderResult | BrowserSessionState;
  readonly error?: string;
}

interface BrowserSessionControlRequest {
  readonly operation: "browser_session_control";
  readonly action: "takeover" | "release";
  readonly sessionId?: string;
  readonly operatorId?: string;
  readonly reason?: string;
}

interface BrowserSessionUpdatedWireEvent {
  readonly type: "browser_session_updated";
  readonly state: BrowserSessionState;
}

interface BrowserSessionState {
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
    readonly dataUrl: string;
    readonly relation: "snapshot";
    readonly mimeType: "image/png";
  };
}

interface PlaywrightModule {
  readonly chromium: BrowserType;
}

interface BrowserType {
  launch(options?: { readonly headless?: boolean; readonly timeout?: number }): Promise<Browser>;
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

const PLAYWRIGHT_BROWSER_USE_MISSING_DEPENDENCY_MESSAGE =
  "Playwright browser use provider is not available. Install the optional peer dependency 'playwright' in the runtime host and install a browser before enabling interactiveUse.browserProvider=playwright. For Bun: bun add -d playwright && bun x playwright install chromium.";

const sessions = new Map<string, BrowserSession>();
const idleTimers = new Map<string, ReturnType<typeof setTimeout>>();
const streamTimers = new Map<string, ReturnType<typeof setTimeout>>();
const operatorLocks = new Map<string, { readonly operatorId?: string; readonly reason?: string; readonly acquiredAt: string }>();
let activeSessionId: string | undefined;
let sequence = 0;
let sidecarExitTimer: ReturnType<typeof setTimeout> | undefined;

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  void handleLine(line);
});

async function handleLine(line: string): Promise<void> {
  let message: WireRequest;
  try {
    message = JSON.parse(line) as WireRequest;
  } catch (error) {
    write({ id: 0, ok: false, error: errorMessage(error) });
    return;
  }

  try {
    const result = message.request.operation === "close_all"
      ? await closeAll()
      : message.request.operation === "browser_session_control"
        ? await controlBrowserSession(message.config, message.request)
        : await execute(message.config, message.request);
    write({ id: message.id, ok: true, result });
  } catch (error) {
    write({ id: message.id, ok: false, error: errorMessage(error) });
  } finally {
    scheduleSidecarExitIfIdle();
  }
}

async function execute(
  config: PlaywrightNodeSidecarConfig,
  request: InteractiveUseRequest,
): Promise<InteractiveUseProviderResult> {
  if (request.target !== "browser") {
    throw new Error("Playwright browser use provider only supports browser targets.");
  }
  switch (request.operation) {
    case "session_start":
      return startSession(config, request);
    case "navigate":
      return navigate(config, request);
    case "observe":
      return observe(config, request);
    case "click":
      return click(config, request);
    case "type":
      return type(config, request);
    case "keypress":
      return keypress(config, request);
    case "scroll":
      return scroll(config, request);
    case "session_stop":
      return stopSession(request);
    default:
      throw new Error(`Playwright browser use provider does not support operation '${request.operation}'.`);
  }
}

async function startSession(
  config: PlaywrightNodeSidecarConfig,
  request: InteractiveUseRequest,
): Promise<InteractiveUseProviderResult> {
  if (request.url) {
    assertUrlAllowed(config, request.url);
  }
  const playwright = await loadPlaywright();
  const sessionId = request.sessionId ?? `browser-${++sequence}`;
  const browser = await launchBrowser(playwright, config, request);
  const context = await browser.newContext({ viewport: readViewport(request.input) });
  const page = await context.newPage();
  const session: BrowserSession = { id: sessionId, browser, context, page };
  sessions.set(sessionId, session);
  cancelSidecarExit();
  activeSessionId = sessionId;
  try {
    if (request.url) {
      await page.goto(request.url, {
        timeout: request.timeoutMs ?? config.defaultTimeoutMs,
        waitUntil: "domcontentloaded",
      });
    }
    const result = {
      provider: "playwright",
      sessionId,
      output: `Started Playwright browser session ${sessionId}.`,
      observation: await observeSession(config, session, request),
    };
    startLiveStream(config, session, request);
    scheduleIdleClose(config, session);
    return result;
  } catch (error) {
    await closeSession(session);
    throw error;
  }
}

async function navigate(
  config: PlaywrightNodeSidecarConfig,
  request: InteractiveUseRequest,
): Promise<InteractiveUseProviderResult> {
  const session = requireSession(request.sessionId);
  try {
    assertAgentBrowserControl(session);
    if (!request.url) {
      throw new Error("browser_navigate requires url.");
    }
    assertUrlAllowed(config, request.url);
    await session.page.goto(request.url, {
      timeout: request.timeoutMs ?? config.defaultTimeoutMs,
      waitUntil: "domcontentloaded",
    });
    return {
      provider: "playwright",
      sessionId: session.id,
      output: `Navigated browser session ${session.id} to ${request.url}.`,
      observation: await observeSession(config, session, request),
    };
  } finally {
    scheduleIdleClose(config, session);
  }
}

async function observe(
  config: PlaywrightNodeSidecarConfig,
  request: InteractiveUseRequest,
): Promise<InteractiveUseProviderResult> {
  const session = requireSession(request.sessionId);
  try {
    return {
      provider: "playwright",
      sessionId: session.id,
      output: `Observed browser session ${session.id}.`,
      observation: await observeSession(config, session, request),
    };
  } finally {
    scheduleIdleClose(config, session);
  }
}

async function click(
  config: PlaywrightNodeSidecarConfig,
  request: InteractiveUseRequest,
): Promise<InteractiveUseProviderResult> {
  const session = requireSession(request.sessionId);
  try {
    assertAgentBrowserControl(session);
    assertCurrentUrlAllowed(config, session);
    const action = request.action;
    if (action?.selector) {
      await session.page.locator(action.selector).click({
        button: action.button,
        clickCount: readClickCount(request.input),
        timeout: request.timeoutMs ?? config.defaultTimeoutMs,
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
      observation: await observeSession(config, session, request),
    };
  } finally {
    scheduleIdleClose(config, session);
  }
}

async function type(
  config: PlaywrightNodeSidecarConfig,
  request: InteractiveUseRequest,
): Promise<InteractiveUseProviderResult> {
  const session = requireSession(request.sessionId);
  try {
    assertAgentBrowserControl(session);
    assertCurrentUrlAllowed(config, session);
    const text = readText(request.input);
    if (request.action?.selector) {
      await session.page.locator(request.action.selector).type(text, {
        timeout: request.timeoutMs ?? config.defaultTimeoutMs,
      });
    } else {
      await session.page.keyboard.type(text);
    }
    return {
      provider: "playwright",
      sessionId: session.id,
      output: `Typed ${text.length} character(s) in browser session ${session.id}.`,
      observation: await observeSession(config, session, request),
    };
  } finally {
    scheduleIdleClose(config, session);
  }
}

async function keypress(
  config: PlaywrightNodeSidecarConfig,
  request: InteractiveUseRequest,
): Promise<InteractiveUseProviderResult> {
  const session = requireSession(request.sessionId);
  try {
    assertAgentBrowserControl(session);
    assertCurrentUrlAllowed(config, session);
    for (const key of request.action?.keys ?? []) {
      await session.page.keyboard.press(key);
    }
    return {
      provider: "playwright",
      sessionId: session.id,
      output: `Sent keypresses in browser session ${session.id}.`,
      observation: await observeSession(config, session, request),
    };
  } finally {
    scheduleIdleClose(config, session);
  }
}

async function scroll(
  config: PlaywrightNodeSidecarConfig,
  request: InteractiveUseRequest,
): Promise<InteractiveUseProviderResult> {
  const session = requireSession(request.sessionId);
  try {
    assertAgentBrowserControl(session);
    assertCurrentUrlAllowed(config, session);
    const { deltaX, deltaY } = scrollDelta(request);
    await session.page.mouse.wheel(deltaX, deltaY);
    return {
      provider: "playwright",
      sessionId: session.id,
      output: `Scrolled browser session ${session.id}.`,
      observation: await observeSession(config, session, request),
    };
  } finally {
    scheduleIdleClose(config, session);
  }
}

async function stopSession(request: InteractiveUseRequest): Promise<InteractiveUseProviderResult> {
  const session = requireSession(request.sessionId);
  await closeSession(session);
  return {
    provider: "playwright",
    sessionId: session.id,
    output: `Stopped Playwright browser session ${session.id}.`,
  };
}

async function closeAll(): Promise<InteractiveUseProviderResult> {
  const activeSessions = [...sessions.values()];
  for (const timer of idleTimers.values()) {
    clearTimeout(timer);
  }
  idleTimers.clear();
  operatorLocks.clear();
  activeSessionId = undefined;
  await Promise.allSettled(activeSessions.map(closeSession));
  return { provider: "playwright", output: "Stopped all Playwright browser sessions." };
}

async function controlBrowserSession(
  config: PlaywrightNodeSidecarConfig,
  request: BrowserSessionControlRequest,
): Promise<BrowserSessionState> {
  const session = requireSession(request.sessionId);
  if (request.action === "takeover") {
    operatorLocks.set(session.id, {
      ...(request.operatorId ? { operatorId: request.operatorId } : {}),
      ...(request.reason ? { reason: request.reason } : {}),
      acquiredAt: new Date().toISOString(),
    });
    clearStreamTimer(session.id);
    return emitBrowserSessionState({
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

  operatorLocks.delete(session.id);
  try {
    const [title, screenshotDataUrl] = await Promise.all([
      session.page.title().catch(() => undefined),
      captureScreenshot(session),
    ]);
    const state = emitBrowserSessionState({
      session,
      operation: "operator_release",
      title,
      ownership: "agent",
      viewMode: "live",
      stream: { status: "live" },
      latestCaptureDataUrl: screenshotDataUrl,
    });
    scheduleStreamCapture(config, session, "observe");
    scheduleIdleClose(config, session);
    return state;
  } catch (error) {
    const state = emitBrowserSessionState({
      session,
      operation: "operator_release",
      ownership: "agent",
      viewMode: "live",
      stream: {
        status: "failed",
        reason: errorMessage(error),
      },
    });
    scheduleIdleClose(config, session);
    return state;
  }
}

function requireSession(sessionId: string | undefined): BrowserSession {
  const id = sessionId ?? activeSessionId;
  const session = id ? sessions.get(id) : undefined;
  if (!session) {
    throw new Error("No active Playwright browser session. Call browser_session_start first.");
  }
  activeSessionId = session.id;
  clearIdleTimer(session.id);
  return session;
}

async function observeSession(
  config: PlaywrightNodeSidecarConfig,
  session: BrowserSession,
  request: InteractiveUseRequest,
): Promise<InteractiveObservationMetadata> {
  assertCurrentUrlAllowed(config, session);
  const [title, visibleText] = await Promise.all([
    session.page.title().catch(() => undefined),
    session.page.locator("body").innerText({ timeout: 1_000 }).catch(() => undefined),
  ]);
  const screenshotDataUrl = request.observationRequest?.includeScreenshot === true
    ? await captureScreenshot(session).catch(() => undefined)
    : undefined;
  return {
    url: session.page.url(),
    ...(title ? { title } : {}),
    ...(visibleText ? { visibleText } : {}),
    ...(screenshotDataUrl ? { screenshotDataUrl } : {}),
  };
}

async function captureScreenshot(session: BrowserSession): Promise<string> {
  const content = await session.page.screenshot({ type: "png", fullPage: false });
  return `data:image/png;base64,${Buffer.from(content).toString("base64")}`;
}

async function loadPlaywright(): Promise<PlaywrightModule> {
  try {
    const mod = await import("playwright");
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

async function launchBrowser(
  playwright: PlaywrightModule,
  config: PlaywrightNodeSidecarConfig,
  request: InteractiveUseRequest,
): Promise<Browser> {
  try {
    return await playwright.chromium.launch({
      headless: readHeadless(config, request),
      timeout: request.timeoutMs ?? config.defaultTimeoutMs,
    });
  } catch (error) {
    if (isPlaywrightBrowserInstallError(error)) {
      throw new Error(PLAYWRIGHT_BROWSER_USE_MISSING_DEPENDENCY_MESSAGE);
    }
    throw error;
  }
}

function readHeadless(config: PlaywrightNodeSidecarConfig, request: InteractiveUseRequest): boolean {
  const raw = request.input.headless;
  const requested = typeof raw === "boolean" ? raw : config.headless;
  if (!requested && !config.allowHeaded) {
    throw new Error(
      "Headed Playwright browser sessions are disabled. Configure interactiveUse.browserEnvironment=isolated-headed before launching a visible browser session.",
    );
  }
  return requested;
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

function assertCurrentUrlAllowed(config: PlaywrightNodeSidecarConfig, session: BrowserSession): void {
  const currentUrl = session.page.url();
  if (!currentUrl || currentUrl === "about:blank") {
    return;
  }
  assertUrlAllowed(config, currentUrl);
}

function assertUrlAllowed(config: PlaywrightNodeSidecarConfig, value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid browser URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Browser automation only allows HTTP(S) URLs.");
  }
  if (config.allowExternalBrowser) {
    return;
  }
  if (config.allowedDomains.length === 0) {
    throw new Error("Browser automation domain policy is missing. Configure interactiveUse.allowedDomains or set allowExternalBrowser=true.");
  }
  if (!config.allowedDomains.some((domain) => domainMatches(url.hostname, domain))) {
    throw new Error(`Browser automation denied for domain '${url.hostname}'. Configure interactiveUse.allowedDomains to allow it.`);
  }
}

async function closeSession(session: BrowserSession): Promise<void> {
  clearIdleTimer(session.id);
  clearStreamTimer(session.id);
  operatorLocks.delete(session.id);
  sessions.delete(session.id);
  if (activeSessionId === session.id) {
    activeSessionId = sessions.keys().next().value;
  }
  await closeBrowserSession(session);
  emitBrowserSessionState({
    session,
    operation: "session_stop",
    ownership: "released",
    viewMode: "snapshot",
    stream: { status: "ended" },
  });
}

async function closeBrowserSession(session: BrowserSession): Promise<void> {
  await Promise.allSettled([
    session.context.close(),
    session.browser.close(),
  ]);
}

function startLiveStream(
  config: PlaywrightNodeSidecarConfig,
  session: BrowserSession,
  request: InteractiveUseRequest,
): void {
  if (config.liveStream?.enabled !== true) {
    return;
  }
  emitBrowserSessionState({
    session,
    operation: request.operation,
    ownership: "agent",
    viewMode: "live",
    stream: { status: "starting" },
  });
  scheduleStreamCapture(config, session, request.operation);
}

function scheduleStreamCapture(
  config: PlaywrightNodeSidecarConfig,
  session: BrowserSession,
  operation: InteractiveUseRequest["operation"],
): void {
  if (config.liveStream?.enabled !== true || !sessions.has(session.id)) {
    return;
  }
  clearStreamTimer(session.id);
  const timer = setTimeout(() => {
    void captureAndEmitLiveFrame(config, session, operation).finally(() => {
      if (sessions.has(session.id)) {
        scheduleStreamCapture(config, session, operation);
      }
    });
  }, normalizeLiveStreamInterval(config.liveStream.intervalMs));
  timer.unref?.();
  streamTimers.set(session.id, timer);
}

async function captureAndEmitLiveFrame(
  config: PlaywrightNodeSidecarConfig,
  session: BrowserSession,
  operation: InteractiveUseRequest["operation"],
): Promise<void> {
  try {
    assertCurrentUrlAllowed(config, session);
    const [title, screenshotDataUrl] = await Promise.all([
      session.page.title().catch(() => undefined),
      captureScreenshot(session),
    ]);
    emitBrowserSessionState({
      session,
      operation,
      title,
      ownership: "agent",
      viewMode: "live",
      stream: { status: "live" },
      latestCaptureDataUrl: screenshotDataUrl,
    });
  } catch (error) {
    emitBrowserSessionState({
      session,
      operation,
      ownership: "agent",
      viewMode: "live",
      stream: {
        status: "failed",
        reason: errorMessage(error),
      },
    });
  }
}

function emitBrowserSessionState(input: {
  readonly session: BrowserSession;
  readonly operation?: string;
  readonly title?: string;
  readonly ownership: BrowserSessionState["ownership"];
  readonly viewMode: BrowserSessionState["viewMode"];
  readonly stream: BrowserSessionState["stream"];
  readonly latestCaptureDataUrl?: string;
}): BrowserSessionState {
  const url = input.session.page.url();
  const state: BrowserSessionState = {
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
    ...(input.latestCaptureDataUrl
      ? {
          latestCapture: {
            dataUrl: input.latestCaptureDataUrl,
            relation: "snapshot",
            mimeType: "image/png",
          },
        }
      : {}),
  };
  writeEvent({ type: "browser_session_updated", state });
  return state;
}

function scheduleIdleClose(config: PlaywrightNodeSidecarConfig, session: BrowserSession): void {
  if (!sessions.has(session.id) || config.idleSessionTtlMs === undefined) {
    return;
  }
  clearIdleTimer(session.id);
  const timer = setTimeout(() => {
    void closeSession(session)
      .catch(() => {})
      .finally(() => scheduleSidecarExitIfIdle());
  }, config.idleSessionTtlMs);
  timer.unref?.();
  idleTimers.set(session.id, timer);
}

function clearIdleTimer(sessionId: string): void {
  const timer = idleTimers.get(sessionId);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  idleTimers.delete(sessionId);
}

function clearStreamTimer(sessionId: string): void {
  const timer = streamTimers.get(sessionId);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  streamTimers.delete(sessionId);
}

function assertAgentBrowserControl(session: BrowserSession): void {
  if (!operatorLocks.has(session.id)) {
    return;
  }
  throw new Error(`Browser session ${session.id} is under operator control.`);
}

function scheduleSidecarExitIfIdle(): void {
  if (sessions.size > 0 || sidecarExitTimer) {
    return;
  }
  sidecarExitTimer = setTimeout(() => {
    process.exit(0);
  }, 100);
  sidecarExitTimer.unref?.();
}

function cancelSidecarExit(): void {
  if (!sidecarExitTimer) {
    return;
  }
  clearTimeout(sidecarExitTimer);
  sidecarExitTimer = undefined;
}

function domainMatches(hostname: string, configuredDomain: string): boolean {
  const normalized = configuredDomain.trim().toLowerCase();
  const host = hostname.toLowerCase();
  return normalized === "*" || host === normalized || host.endsWith(`.${normalized}`);
}

function write(response: WireResponse): void {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function writeEvent(event: BrowserSessionUpdatedWireEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
