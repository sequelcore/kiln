import type {
  ArtifactResource,
  ArtifactResourceStore,
  RecorderEditTrack,
} from "@kilnai/core";

export interface BrowserVideoSourceFrame {
  readonly sessionId: string;
  readonly artifactUri: string;
  readonly capturedAt: string;
  readonly offsetMs: number;
  readonly operation?: string;
  readonly transport: string;
  readonly url?: string;
  readonly title?: string;
  readonly width?: number;
  readonly height?: number;
}

export interface BrowserVideoOperationEvent {
  readonly sessionId: string;
  readonly toolName: string;
  readonly operation: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly offsetMs: number;
  readonly durationMs: number;
  readonly status: string;
  readonly url?: string;
  readonly title?: string;
  readonly selector?: string;
  readonly x?: number;
  readonly y?: number;
}

export interface BrowserVideoOutputOptions {
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
  readonly mimeType?: "video/webm";
}

export interface BrowserVideoEncoderFrame {
  readonly dataUrl: string;
  readonly offsetMs: number;
  readonly durationMs: number;
}

export interface BrowserVideoEncoderInput {
  readonly frames: readonly BrowserVideoEncoderFrame[];
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationMs: number;
  readonly mimeType: "video/webm";
}

export interface BrowserVideoEncoderResult {
  readonly mimeType: "video/webm";
  readonly content: Uint8Array;
  readonly durationMs: number;
}

export interface BrowserVideoEncoder {
  encode(input: BrowserVideoEncoderInput): Promise<BrowserVideoEncoderResult>;
}

export interface PlaywrightBrowserVideoRenderInput {
  readonly artifactStore: ArtifactResourceStore;
  readonly sessionId: string;
  readonly frames: readonly BrowserVideoSourceFrame[];
  readonly operations: readonly BrowserVideoOperationEvent[];
  readonly output?: BrowserVideoOutputOptions;
  readonly encoder?: BrowserVideoEncoder;
}

export interface PlaywrightBrowserVideoRenderResult {
  readonly format: "webm";
  readonly mimeType: "video/webm";
  readonly content: Uint8Array;
  readonly durationMs: number;
  readonly width: number;
  readonly height: number;
  readonly renderedFrameCount: number;
  readonly captionCount: number;
  readonly cursorHighlightCount: number;
  readonly zoomCount: number;
  readonly editTracks: readonly RecorderEditTrack[];
}

interface LoadedFrame {
  readonly frame: BrowserVideoSourceFrame;
  readonly artifact: ArtifactResource;
  readonly content: Buffer;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
}

interface ActiveViewportTransform {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const DEFAULT_OUTPUT_WIDTH = 1280;
const DEFAULT_OUTPUT_HEIGHT = 720;
const DEFAULT_FPS = 6;
const DEFAULT_FRAME_HOLD_MS = 1000;
const CAPTION_DURATION_MS = 1800;
const CURSOR_DURATION_MS = 650;
const ZOOM_DURATION_MS = 1400;

export async function renderPlaywrightBrowserVideo(
  input: PlaywrightBrowserVideoRenderInput,
): Promise<PlaywrightBrowserVideoRenderResult> {
  requireText(input.sessionId, "sessionId");
  if (input.frames.length === 0) {
    throw new Error("Cannot render browser video without captured frame artifacts.");
  }
  const width = positiveInteger(input.output?.width, DEFAULT_OUTPUT_WIDTH, "output.width");
  const height = positiveInteger(input.output?.height, DEFAULT_OUTPUT_HEIGHT, "output.height");
  const fps = positiveInteger(input.output?.fps, DEFAULT_FPS, "output.fps");
  const mimeType = input.output?.mimeType ?? "video/webm";
  const loadedFrames = await Promise.all(input.frames.map((frame) => loadFrame(input.artifactStore, frame)));
  const editTracks = createBrowserVideoEditTracks(input.sessionId, input.operations);
  const durationMs = computeDurationMs(input.frames, input.operations);
  const frameDurationMs = Math.max(1, Math.round(1000 / fps));
  const outputFrames: BrowserVideoEncoderFrame[] = [];

  for (let offsetMs = 0; offsetMs < durationMs; offsetMs += frameDurationMs) {
    const loadedFrame = selectFrameAtOffset(loadedFrames, offsetMs);
    const png = await renderCompositedFrame({
      loadedFrame,
      editTracks,
      offsetMs,
      width,
      height,
    });
    outputFrames.push({
      dataUrl: `data:image/png;base64,${png.toString("base64")}`,
      offsetMs,
      durationMs: Math.min(frameDurationMs, Math.max(1, durationMs - offsetMs)),
    });
  }

  const encoder = input.encoder ?? createPlaywrightBrowserVideoEncoder();
  const encoded = await encoder.encode({
    frames: outputFrames,
    width,
    height,
    fps,
    durationMs,
    mimeType,
  });
  if (encoded.mimeType !== "video/webm") {
    throw new Error(`Browser video renderer returned unsupported mime type: ${encoded.mimeType}`);
  }

  return {
    format: "webm",
    mimeType: encoded.mimeType,
    content: encoded.content,
    durationMs: encoded.durationMs,
    width,
    height,
    renderedFrameCount: outputFrames.length,
    captionCount: editTracks.filter((track) => track.editKind === "caption").length,
    cursorHighlightCount: editTracks.filter((track) => track.editKind === "cursor_emphasis").length,
    zoomCount: editTracks.filter((track) => track.editKind === "auto_zoom").length,
    editTracks,
  };
}

export interface PlaywrightBrowserVideoRenderer {
  render(input: Omit<PlaywrightBrowserVideoRenderInput, "encoder">): Promise<PlaywrightBrowserVideoRenderResult>;
}

export function createPlaywrightBrowserVideoRenderer(
  encoder: BrowserVideoEncoder = createPlaywrightBrowserVideoEncoder(),
): PlaywrightBrowserVideoRenderer {
  return {
    render: (input) => renderPlaywrightBrowserVideo({ ...input, encoder }),
  };
}

export interface PlaywrightVideoEncoderOptions {
  readonly loader?: () => Promise<PlaywrightVideoEncoderModule>;
  readonly headless?: boolean;
}

export interface PlaywrightVideoEncoderModule {
  readonly chromium: {
    launch(options?: { readonly headless?: boolean }): Promise<PlaywrightVideoBrowser>;
  };
}

interface PlaywrightVideoBrowser {
  newContext(options?: { readonly viewport?: { readonly width: number; readonly height: number } }): Promise<PlaywrightVideoBrowserContext>;
  close(): Promise<void>;
}

interface PlaywrightVideoBrowserContext {
  newPage(): Promise<PlaywrightVideoPage>;
  close(): Promise<void>;
}

interface PlaywrightVideoPage {
  setContent(html: string): Promise<void>;
  evaluate<T, A>(fn: (arg: A) => Promise<T>, arg: A): Promise<T>;
}

export function createPlaywrightBrowserVideoEncoder(
  options: PlaywrightVideoEncoderOptions = {},
): BrowserVideoEncoder {
  return {
    async encode(input) {
      const playwright = await (options.loader ?? loadPlaywrightForVideo)();
      const browser = await playwright.chromium.launch({ headless: options.headless ?? true });
      try {
        const context = await browser.newContext({ viewport: { width: input.width, height: input.height } });
        try {
          const page = await context.newPage();
          await page.setContent("<!doctype html><html><body></body></html>");
          const result = await page.evaluate(async (payload) => {
            const delay = (durationMs: number): Promise<void> => new Promise((resolve) => {
              setTimeout(resolve, durationMs);
            });
            const loadImage = (dataUrl: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
              const image = new Image();
              image.onload = () => resolve(image);
              image.onerror = () => reject(new Error("Unable to load rendered browser video frame."));
              image.src = dataUrl;
            });
            const canvas = document.createElement("canvas");
            canvas.width = payload.width;
            canvas.height = payload.height;
            const context2d = canvas.getContext("2d");
            if (!context2d) {
              throw new Error("Cannot render browser video without a 2D canvas context.");
            }
            if (typeof MediaRecorder === "undefined" || typeof canvas.captureStream !== "function") {
              throw new Error("Cannot render browser video because MediaRecorder or canvas.captureStream is unavailable.");
            }
            const stream = canvas.captureStream(payload.fps);
            const recorder = new MediaRecorder(stream, { mimeType: payload.mimeType });
            const chunks: Blob[] = [];
            recorder.addEventListener("dataavailable", (event) => {
              if (event.data.size > 0) chunks.push(event.data);
            });
            const stopped = new Promise<void>((resolve) => {
              recorder.addEventListener("stop", () => resolve(), { once: true });
            });
            recorder.start();
            for (const frame of payload.frames) {
              const image = await loadImage(frame.dataUrl);
              context2d.clearRect(0, 0, payload.width, payload.height);
              context2d.drawImage(image, 0, 0, payload.width, payload.height);
              await delay(Math.max(1, frame.durationMs));
            }
            recorder.stop();
            await stopped;
            for (const track of stream.getTracks()) track.stop();
            const blob = new Blob(chunks, { type: payload.mimeType });
            const buffer = await blob.arrayBuffer();
            let binary = "";
            for (const value of new Uint8Array(buffer)) {
              binary += String.fromCharCode(value);
            }
            return {
              mimeType: payload.mimeType,
              base64: btoa(binary),
            };
          }, input);
          return {
            mimeType: "video/webm",
            content: Buffer.from(result.base64, "base64"),
            durationMs: input.durationMs,
          };
        } finally {
          await context.close();
        }
      } finally {
        await browser.close();
      }
    },
  };
}

function createBrowserVideoEditTracks(
  sessionId: string,
  operations: readonly BrowserVideoOperationEvent[],
): readonly RecorderEditTrack[] {
  return operations.flatMap((operation, index) => {
    const tracks: RecorderEditTrack[] = [];
    const suffix = `${index + 1}`;
    const caption = captionText(operation);
    if (caption) {
      tracks.push({
        id: `${sessionId}-caption-${suffix}`,
        kind: "edit",
        status: "ready",
        editKind: "caption",
        startedAtOffsetMs: operation.offsetMs,
        durationMs: CAPTION_DURATION_MS,
        text: caption,
        evidence: [{ kind: "tool_call", id: operation.toolName }],
      });
    }
    if (operation.operation === "click" && operation.x !== undefined && operation.y !== undefined) {
      tracks.push({
        id: `${sessionId}-cursor-${suffix}`,
        kind: "edit",
        status: "ready",
        editKind: "cursor_emphasis",
        startedAtOffsetMs: operation.offsetMs,
        durationMs: CURSOR_DURATION_MS,
        target: { x: operation.x, y: operation.y, width: 96, height: 96 },
        evidence: [{ kind: "tool_call", id: operation.toolName }],
      });
      tracks.push({
        id: `${sessionId}-zoom-${suffix}`,
        kind: "edit",
        status: "ready",
        editKind: "auto_zoom",
        startedAtOffsetMs: operation.offsetMs,
        durationMs: ZOOM_DURATION_MS,
        target: {
          x: operation.x,
          y: operation.y,
          width: 420,
          height: 240,
        },
        evidence: [{ kind: "tool_call", id: operation.toolName }],
      });
    }
    return tracks;
  });
}

async function renderCompositedFrame(input: {
  readonly loadedFrame: LoadedFrame;
  readonly editTracks: readonly RecorderEditTrack[];
  readonly offsetMs: number;
  readonly width: number;
  readonly height: number;
}): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const activeZoom = activeTrack(input.editTracks, "auto_zoom", input.offsetMs);
  const transform = activeZoom?.target
    ? zoomTransform(activeZoom.target, input.loadedFrame.sourceWidth, input.loadedFrame.sourceHeight)
    : null;
  let image = sharp(input.loadedFrame.content);
  if (transform) {
    image = image.extract({
      left: Math.round(transform.left),
      top: Math.round(transform.top),
      width: Math.round(transform.width),
      height: Math.round(transform.height),
    });
  }
  image = image.resize(input.width, input.height, { fit: "cover" });
  const overlays = [
    cursorOverlay(input),
    captionOverlay(input),
  ].filter((overlay): overlay is { input: Buffer } => overlay !== null);
  return image
    .composite(overlays)
    .png()
    .toBuffer();
}

function cursorOverlay(input: {
  readonly loadedFrame: LoadedFrame;
  readonly editTracks: readonly RecorderEditTrack[];
  readonly offsetMs: number;
  readonly width: number;
  readonly height: number;
}): { input: Buffer } | null {
  const cursor = activeTrack(input.editTracks, "cursor_emphasis", input.offsetMs);
  if (!cursor?.target) return null;
  const activeZoom = activeTrack(input.editTracks, "auto_zoom", input.offsetMs);
  const transform = activeZoom?.target
    ? zoomTransform(activeZoom.target, input.loadedFrame.sourceWidth, input.loadedFrame.sourceHeight)
    : {
        left: 0,
        top: 0,
        width: input.loadedFrame.sourceWidth,
        height: input.loadedFrame.sourceHeight,
      };
  const cx = ((cursor.target.x - transform.left) / transform.width) * input.width;
  const cy = ((cursor.target.y - transform.top) / transform.height) * input.height;
  const svg = `<svg width="${input.width}" height="${input.height}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="28" fill="rgba(14,165,233,0.22)" stroke="rgba(14,165,233,0.95)" stroke-width="5"/>
    <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="7" fill="rgba(255,255,255,0.94)" stroke="rgba(2,8,23,0.75)" stroke-width="2"/>
  </svg>`;
  return { input: Buffer.from(svg) };
}

function captionOverlay(input: {
  readonly editTracks: readonly RecorderEditTrack[];
  readonly offsetMs: number;
  readonly width: number;
  readonly height: number;
}): { input: Buffer } | null {
  const caption = activeTrack(input.editTracks, "caption", input.offsetMs);
  if (!caption?.text) return null;
  const boxHeight = 72;
  const y = input.height - boxHeight - 28;
  const text = escapeSvgText(caption.text.length > 96 ? `${caption.text.slice(0, 93)}...` : caption.text);
  const svg = `<svg width="${input.width}" height="${input.height}" xmlns="http://www.w3.org/2000/svg">
    <rect x="32" y="${y}" width="${input.width - 64}" height="${boxHeight}" rx="16" fill="rgba(2,8,23,0.78)"/>
    <text x="64" y="${y + 44}" fill="rgba(255,255,255,0.96)" font-family="Arial, sans-serif" font-size="28" font-weight="700">${text}</text>
  </svg>`;
  return { input: Buffer.from(svg) };
}

function activeTrack(
  tracks: readonly RecorderEditTrack[],
  editKind: RecorderEditTrack["editKind"],
  offsetMs: number,
): RecorderEditTrack | undefined {
  return tracks.find((track) => (
    track.editKind === editKind
    && offsetMs >= track.startedAtOffsetMs
    && offsetMs <= track.startedAtOffsetMs + (track.durationMs ?? 1)
  ));
}

function zoomTransform(
  target: NonNullable<RecorderEditTrack["target"]>,
  sourceWidth: number,
  sourceHeight: number,
): ActiveViewportTransform {
  const zoomWidth = Math.max(1, Math.min(sourceWidth, Math.round(sourceWidth / 1.35)));
  const zoomHeight = Math.max(1, Math.min(sourceHeight, Math.round(sourceHeight / 1.35)));
  const targetCenterX = target.x + target.width / 2;
  const targetCenterY = target.y + target.height / 2;
  const left = clamp(targetCenterX - zoomWidth / 2, 0, Math.max(0, sourceWidth - zoomWidth));
  const top = clamp(targetCenterY - zoomHeight / 2, 0, Math.max(0, sourceHeight - zoomHeight));
  return { left, top, width: zoomWidth, height: zoomHeight };
}

function selectFrameAtOffset(frames: readonly LoadedFrame[], offsetMs: number): LoadedFrame {
  let selected = frames[0]!;
  for (const frame of frames) {
    if (frame.frame.offsetMs <= offsetMs) {
      selected = frame;
    }
  }
  return selected;
}

async function loadFrame(
  artifactStore: ArtifactResourceStore,
  frame: BrowserVideoSourceFrame,
): Promise<LoadedFrame> {
  const reference = parseArtifactContentUri(frame.artifactUri);
  const artifact = artifactStore.get(reference.namespace, reference.id);
  if (!artifact) {
    throw new Error(`Cannot render browser video because frame artifact is missing: ${frame.artifactUri}`);
  }
  if (!artifact.mimeType.startsWith("image/") || artifact.content.type !== "blob") {
    throw new Error(`Cannot render browser video because frame artifact is not an image blob: ${frame.artifactUri}`);
  }
  const content = Buffer.from(artifact.content.blob, "base64");
  const sharp = (await import("sharp")).default;
  const metadata = await sharp(content).metadata();
  return {
    frame,
    artifact,
    content,
    sourceWidth: metadata.width ?? frame.width ?? DEFAULT_OUTPUT_WIDTH,
    sourceHeight: metadata.height ?? frame.height ?? DEFAULT_OUTPUT_HEIGHT,
  };
}

function computeDurationMs(
  frames: readonly BrowserVideoSourceFrame[],
  operations: readonly BrowserVideoOperationEvent[],
): number {
  const frameEnd = Math.max(...frames.map((frame) => frame.offsetMs + DEFAULT_FRAME_HOLD_MS));
  const operationEnd = operations.length > 0
    ? Math.max(...operations.map((operation) => operation.offsetMs + Math.max(operation.durationMs, CAPTION_DURATION_MS)))
    : 0;
  return Math.max(DEFAULT_FRAME_HOLD_MS, frameEnd, operationEnd);
}

function captionText(operation: BrowserVideoOperationEvent): string {
  const context = operation.title ?? operation.url ?? operation.selector;
  return [operation.toolName, context].filter(Boolean).join(" ");
}

function parseArtifactContentUri(uri: string): { readonly namespace: string; readonly id: string } {
  const match = /^kiln:\/\/artifacts\/([^/]+)\/([^/]+)\/content$/u.exec(uri);
  if (!match) {
    throw new Error(`Cannot render browser video because frame artifact URI is invalid: ${uri}`);
  }
  return { namespace: match[1]!, id: match[2]! };
}

async function loadPlaywrightForVideo(): Promise<PlaywrightVideoEncoderModule> {
  const mod = await import("playwright");
  if (!isPlaywrightVideoEncoderModule(mod)) {
    throw new Error("Cannot render browser video because the Playwright module is unavailable.");
  }
  return mod;
}

function isPlaywrightVideoEncoderModule(value: unknown): value is PlaywrightVideoEncoderModule {
  return typeof value === "object"
    && value !== null
    && "chromium" in value
    && typeof (value as { readonly chromium?: unknown }).chromium === "object";
}

function positiveInteger(value: number | undefined, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Browser video ${field} must be a positive integer.`);
  }
  return value;
}

function requireText(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new Error(`Browser video ${field} is required.`);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function escapeSvgText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}
