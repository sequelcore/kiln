import { lazy, Suspense, useEffect, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode, WheelEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  GuiBrowserLiveViewportFrame,
  GuiBrowserOperatorInput,
  GuiBrowserSessionState,
  GuiInteractiveUseSnapshot,
  OperatorWorkspaceFileSnapshot,
} from "@kilnai/gateway-contracts";
import { File, Image, Lock, MessageSquare, Monitor, Network, Unlock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type OperatorSurfaceKind = "chat" | "browser" | "memory" | "workspace";

interface OperatorSurfaceTabsProps {
  readonly activeSurface: OperatorSurfaceKind;
  readonly chatContent: ReactNode;
  readonly browserSnapshot?: GuiInteractiveUseSnapshot | null;
  readonly browserSession?: GuiBrowserSessionState | null;
  readonly browserLiveViewportFrame?: GuiBrowserLiveViewportFrame | null;
  readonly loadResourceDataUrl?: (uri: string) => Promise<string | null>;
  readonly onBrowserSessionControl?: (action: "takeover" | "release", options?: { readonly sessionId?: string; readonly reason?: string }) => void;
  readonly onBrowserOperatorInput?: (request: { readonly sessionId: string; readonly input: GuiBrowserOperatorInput }) => void;
  readonly memoryContent: ReactNode;
  readonly memoryOpen: boolean;
  readonly files: readonly OperatorWorkspaceFileSnapshot[];
  readonly selectedPath: string | null;
  readonly loadingPath: string | null;
  readonly error: string | null;
  readonly onSelectChat: () => void;
  readonly onSelectBrowser?: () => void;
  readonly onSelectMemory: () => void;
  readonly onCloseMemory: () => void;
  readonly onSelectFile: (path: string) => void;
  readonly onCloseFile: (path: string) => void;
}

const CHAT_TAB_VALUE = "__kiln_chat__";
const BROWSER_TAB_VALUE = "__kiln_browser__";
const MEMORY_TAB_VALUE = "__kiln_memory_lattice__";

const WorkspaceCodeHighlighter = lazy(async () => {
  const module = await import("./workspace-code-highlighter.js");
  return { default: module.WorkspaceCodeHighlighter };
});

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function basename(path: string): string {
  return normalizePath(path).split("/").filter(Boolean).at(-1) ?? path;
}

function extension(file: OperatorWorkspaceFileSnapshot): string {
  const normalizedName = file.name.toLocaleLowerCase("en-US");
  const dotIndex = normalizedName.lastIndexOf(".");
  return dotIndex >= 0 ? normalizedName.slice(dotIndex + 1) : "";
}

function language(file: OperatorWorkspaceFileSnapshot): string {
  return (file.language ?? extension(file)).toLocaleLowerCase("en-US");
}

function syntaxLanguage(languageName: string | undefined): string {
  switch ((languageName ?? "text").toLocaleLowerCase("en-US")) {
    case "cjs":
    case "mjs":
    case "js": return "javascript";
    case "jsx": return "jsx";
    case "ts": return "typescript";
    case "tsx": return "tsx";
    case "md":
    case "mdx": return "markdown";
    case "yml": return "yaml";
    case "sh": return "bash";
    case "ps1": return "powershell";
    default: return languageName ?? "text";
  }
}

function isJson(file: OperatorWorkspaceFileSnapshot): boolean {
  return language(file) === "json" || file.mimeType === "application/json";
}

function isMarkdown(file: OperatorWorkspaceFileSnapshot): boolean {
  const detected = language(file);
  return detected === "md" || detected === "mdx" || detected === "markdown" || file.mimeType === "text/markdown";
}

function formatJson(content: string): { readonly content: string; readonly error: string | null } {
  try {
    return { content: JSON.stringify(JSON.parse(content), null, 2), error: null };
  } catch {
    return { content, error: "JSON parse failed; showing raw content." };
  }
}

function CodeBlock(props: { readonly content: string; readonly language?: string; readonly notice?: string | null }) {
  const resolvedLanguage = syntaxLanguage(props.language);
  return (
    <div data-testid="workspace-code-scroll" className="h-full min-h-0 min-w-0 overflow-auto bg-workspace-viewer">
      <div className="sticky top-0 z-10 flex min-h-9 min-w-0 items-center justify-between border-b border-border/60 bg-workspace-viewer-panel/95 px-4 backdrop-blur">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {props.language ?? "text"}
        </span>
        {props.notice ? <span className="min-w-0 truncate text-xs text-muted-foreground">{props.notice}</span> : null}
      </div>
      <Suspense fallback={<PlainCodeBlock content={props.content} />}>
        <WorkspaceCodeHighlighter content={props.content} language={resolvedLanguage} />
      </Suspense>
    </div>
  );
}

function PlainCodeBlock(props: { readonly content: string }) {
  const lines = props.content.split(/\r?\n/);
  return (
    <pre data-testid="workspace-code" className="grid min-w-max grid-cols-[3.5rem_minmax(0,1fr)] px-0 py-3 font-mono text-[12px] leading-5 text-foreground">
      {lines.map((line, index) => (
        <span key={`${index}:${line}`} className="contents">
          <span className="select-none border-r border-border/50 bg-workspace-viewer-gutter px-3 text-right text-muted-foreground/65">
            {index + 1}
          </span>
          <span className="px-4">{line.length > 0 ? line : " "}</span>
        </span>
      ))}
    </pre>
  );
}

function MarkdownPreview(props: { readonly content: string }) {
  return (
    <div className="h-full min-w-0 overflow-auto bg-workspace-viewer px-6 py-5">
      <article className="mx-auto min-w-0 max-w-4xl text-sm leading-7 text-foreground">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          components={{
            h1: ({ children }) => <h1 className="mb-4 mt-2 text-2xl font-semibold">{children}</h1>,
            h2: ({ children }) => <h2 className="mb-3 mt-6 text-xl font-semibold">{children}</h2>,
            h3: ({ children }) => <h3 className="mb-2 mt-5 text-base font-semibold">{children}</h3>,
            p: ({ children }) => <p className="my-3">{children}</p>,
            ul: ({ children }) => <ul className="my-3 list-disc pl-6">{children}</ul>,
            ol: ({ children }) => <ol className="my-3 list-decimal pl-6">{children}</ol>,
            li: ({ children }) => <li className="my-1">{children}</li>,
            blockquote: ({ children }) => (
              <blockquote className="my-4 border-l-2 border-border pl-4 text-muted-foreground">{children}</blockquote>
            ),
            code: ({ children }) => (
              <code className="rounded border border-border/60 bg-workspace-viewer-panel px-1.5 py-0.5 font-mono text-[12px]">
                {children}
              </code>
            ),
            pre: ({ children }) => (
              <pre className="my-4 overflow-auto rounded-md border border-border/70 bg-workspace-viewer-panel p-3 font-mono text-[12px] leading-5">
                {children}
              </pre>
            ),
            table: ({ children }) => (
              <div className="my-4 overflow-auto">
                <table className="w-full border-collapse text-left text-sm">{children}</table>
              </div>
            ),
            th: ({ children }) => <th className="border border-border/70 bg-workspace-viewer-panel px-3 py-2 font-semibold">{children}</th>,
            td: ({ children }) => <td className="border border-border/70 px-3 py-2">{children}</td>,
            a: ({ children, href }) => (
              <a href={href} target="_blank" rel="noreferrer" className="text-[var(--color-accent)] underline-offset-4 hover:underline">
                {children}
              </a>
            ),
          }}
        >
          {props.content}
        </ReactMarkdown>
      </article>
    </div>
  );
}

function FilePreview(props: { readonly file: OperatorWorkspaceFileSnapshot }) {
  if (props.file.kind === "image" && props.file.dataUrl) {
    return (
      <div className="grid h-full place-items-center overflow-auto bg-workspace-viewer p-4">
        <img src={props.file.dataUrl} alt={props.file.name} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }

  if (props.file.kind === "text" && props.file.content !== undefined) {
    if (isMarkdown(props.file)) {
      return <MarkdownPreview content={props.file.content} />;
    }
    if (isJson(props.file)) {
      const formatted = formatJson(props.file.content);
      return <CodeBlock content={formatted.content} language="json" notice={formatted.error} />;
    }
    return <CodeBlock content={props.file.content} language={language(props.file) || "text"} notice={props.file.truncated ? "Preview truncated" : null} />;
  }

  return (
    <div className="grid h-full place-items-center bg-workspace-viewer p-6 text-center">
      <div>
        <Image className="mx-auto size-7 text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">
          {props.file.unsupportedReason ?? "Preview is not supported for this file type."}
        </p>
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">{props.file.sizeBytes.toLocaleString("en-US")} bytes</p>
      </div>
    </div>
  );
}

function BrowserUsePanel(props: {
  readonly snapshot?: GuiInteractiveUseSnapshot | null;
  readonly browserSession?: GuiBrowserSessionState | null;
  readonly browserLiveViewportFrame?: GuiBrowserLiveViewportFrame | null;
  readonly loadResourceDataUrl?: (uri: string) => Promise<string | null>;
  readonly onBrowserSessionControl?: (action: "takeover" | "release", options?: { readonly sessionId?: string; readonly reason?: string }) => void;
  readonly onBrowserOperatorInput?: (request: { readonly sessionId: string; readonly input: GuiBrowserOperatorInput }) => void;
}) {
  const snapshot = props.snapshot;
  const loadResourceDataUrl = props.loadResourceDataUrl;
  const label = props.browserSession?.title
    ?? snapshot?.title
    ?? props.browserSession?.url
    ?? snapshot?.url
    ?? props.browserSession?.sessionId
    ?? snapshot?.sessionId
    ?? "Browser";
  const url = props.browserSession?.url ?? snapshot?.url;
  const status = props.browserSession?.status ?? snapshot?.status ?? "succeeded";
  const screenshotUri = props.browserSession?.latestCapture?.uri ?? snapshot?.screenshotUri;
  const browserSessionId = props.browserSession?.sessionId ?? snapshot?.sessionId;
  const browserSurfaceKey = browserSessionId ?? `${props.browserSession?.provider ?? snapshot?.provider ?? "browser"}:${url ?? label}`;
  const operatorOwnsBrowser = props.browserSession?.ownership === "operator";
  const liveViewportFrame = props.browserLiveViewportFrame?.sessionId === browserSessionId ? props.browserLiveViewportFrame : null;
  const [loadedScreenshot, setLoadedScreenshot] = useState<{ readonly sessionKey: string; readonly dataUrl: string } | null>(null);
  const [loadedLiveViewport, setLoadedLiveViewport] = useState<{ readonly frameId: string; readonly dataUrl: string } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const retainedScreenshotDataUrl = loadedScreenshot?.sessionKey === browserSurfaceKey ? loadedScreenshot.dataUrl : null;
  const screenshotDataUrl = snapshot?.screenshotDataUrl ?? retainedScreenshotDataUrl;
  const liveViewportDataUrl = liveViewportFrame
    ? liveViewportFrame.dataUrl
      ?? (loadedLiveViewport?.frameId === liveViewportFrame.frameId ? loadedLiveViewport.dataUrl : null)
    : null;

  function sendOperatorInput(input: GuiBrowserOperatorInput): void {
    if (!operatorOwnsBrowser || !browserSessionId || !props.onBrowserOperatorInput) {
      return;
    }
    props.onBrowserOperatorInput({ sessionId: browserSessionId, input });
  }

  function viewportPoint(event: MouseEvent<HTMLElement> | WheelEvent<HTMLElement>): { readonly x: number; readonly y: number } | null {
    if (!liveViewportFrame) {
      return null;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    const normalizedX = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
    const normalizedY = Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1);
    return {
      x: Math.round(normalizedX * liveViewportFrame.width),
      y: Math.round(normalizedY * liveViewportFrame.height),
    };
  }

  function pointerButton(event: MouseEvent<HTMLElement>): Extract<GuiBrowserOperatorInput, { kind: "pointer" }>["button"] {
    if (event.button === 1) return "middle";
    if (event.button === 2) return "right";
    return "left";
  }

  function handleViewportClick(event: MouseEvent<HTMLElement>): void {
    const point = viewportPoint(event);
    if (!point) {
      return;
    }
    sendOperatorInput({
      kind: "pointer",
      phase: "click",
      x: point.x,
      y: point.y,
      button: pointerButton(event),
      clickCount: event.detail > 0 ? event.detail : 1,
    });
  }

  function handleViewportWheel(event: WheelEvent<HTMLElement>): void {
    const point = viewportPoint(event);
    if (!point) {
      return;
    }
    event.preventDefault();
    sendOperatorInput({
      kind: "wheel",
      x: point.x,
      y: point.y,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
    });
  }

  function handleViewportKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (!operatorOwnsBrowser || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (event.key.length === 1) {
      event.preventDefault();
      sendOperatorInput({ kind: "text", text: event.key });
      return;
    }
    if (["Enter", "Tab", "Escape", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      sendOperatorInput({ kind: "key", phase: "press", key: event.key });
    }
  }

  useEffect(() => {
    if (snapshot?.screenshotDataUrl) {
      setLoadedScreenshot({ sessionKey: browserSurfaceKey, dataUrl: snapshot.screenshotDataUrl });
    }
  }, [browserSurfaceKey, snapshot?.screenshotDataUrl]);

  useEffect(() => {
    setLoadFailed(false);
    if (snapshot?.screenshotDataUrl || !screenshotUri || !loadResourceDataUrl) {
      return;
    }
    let cancelled = false;
    loadResourceDataUrl(screenshotUri).then((dataUrl) => {
      if (cancelled) return;
      if (dataUrl) {
        setLoadedScreenshot({ sessionKey: browserSurfaceKey, dataUrl });
      } else {
        setLoadFailed(true);
      }
    }).catch(() => {
      if (!cancelled) {
        setLoadFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [browserSurfaceKey, loadResourceDataUrl, screenshotUri, snapshot?.screenshotDataUrl]);

  useEffect(() => {
    if (!liveViewportFrame) {
      setLoadedLiveViewport(null);
      return;
    }
    if (liveViewportFrame.dataUrl) {
      setLoadedLiveViewport({ frameId: liveViewportFrame.frameId, dataUrl: liveViewportFrame.dataUrl });
      return;
    }
    if (!liveViewportFrame.artifactUri || !loadResourceDataUrl) {
      return;
    }
    let cancelled = false;
    loadResourceDataUrl(liveViewportFrame.artifactUri).then((dataUrl) => {
      if (cancelled || !dataUrl) return;
      setLoadedLiveViewport({ frameId: liveViewportFrame.frameId, dataUrl });
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [liveViewportFrame, loadResourceDataUrl]);

  return (
    <section aria-label="Browser use" className="flex h-full min-h-0 flex-col bg-workspace-viewer">
      <header className="flex min-h-12 min-w-0 items-center gap-3 border-b border-border/60 bg-workspace-viewer-panel px-4">
        <Monitor className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{label}</p>
          {url ? (
            <p className="truncate font-mono text-[10.5px] text-muted-foreground">{url}</p>
          ) : null}
        </div>
        <span className="shrink-0 rounded border border-border/60 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {status}
        </span>
        {status === "running" || props.browserSession?.ownership === "agent" ? (
          <span className="shrink-0 rounded border border-amber-500/45 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-200">
            Agent controlling
          </span>
        ) : null}
        {props.browserSession ? (
          <>
            <span className="shrink-0 rounded border border-border/60 px-2 py-1 text-xs text-muted-foreground">
              Stream {props.browserSession.stream.status}
            </span>
            <span className="shrink-0 rounded border border-border/60 px-2 py-1 text-xs text-muted-foreground">
              View {props.browserSession.viewMode}
            </span>
          </>
        ) : null}
        {props.browserSession && props.onBrowserSessionControl ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
            onClick={() => {
              props.onBrowserSessionControl?.(
                operatorOwnsBrowser ? "release" : "takeover",
                {
                  ...(browserSessionId ? { sessionId: browserSessionId } : {}),
                  reason: operatorOwnsBrowser ? "Operator released browser control." : "Operator took browser control.",
                },
              );
            }}
          >
            {operatorOwnsBrowser ? (
              <Unlock data-icon="inline-start" aria-hidden="true" />
            ) : (
              <Lock data-icon="inline-start" aria-hidden="true" />
            )}
            {operatorOwnsBrowser ? "Release" : "Take control"}
          </Button>
        ) : null}
      </header>
      <div className="min-h-0 flex-1 overflow-auto bg-workspace-viewer p-4">
        {liveViewportFrame && liveViewportDataUrl ? (
          <div className="grid min-h-full place-items-center">
            <button
              type="button"
              aria-label="Live browser viewport"
              aria-disabled={!operatorOwnsBrowser}
              data-testid="browser-live-viewport"
              tabIndex={operatorOwnsBrowser ? 0 : -1}
              className={cn(
                "relative block max-h-full max-w-full overflow-hidden rounded-md border border-border/70 bg-background p-0 text-left shadow-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                operatorOwnsBrowser ? "cursor-crosshair" : "cursor-default",
              )}
              style={{
                aspectRatio: `${liveViewportFrame.width} / ${liveViewportFrame.height}`,
                width: "min(100%, 1280px)",
              }}
              onClick={handleViewportClick}
              onWheel={handleViewportWheel}
              onKeyDown={handleViewportKeyDown}
            >
              <img
                src={liveViewportDataUrl}
                alt={`Live browser viewport for ${label}`}
                className="h-full w-full select-none object-contain"
                draggable={false}
              />
            </button>
          </div>
        ) : screenshotDataUrl ? (
          <div className="grid min-h-full place-items-center">
            <img
              src={screenshotDataUrl}
              alt={`Browser screenshot for ${label}`}
              className="max-h-full max-w-full rounded-md border border-border/70 bg-background object-contain shadow-sm"
            />
          </div>
        ) : (
          <div className="grid h-full place-items-center text-center">
            <div>
              <Monitor className="mx-auto size-7 text-muted-foreground" aria-hidden="true" />
              <p className="mt-3 text-sm text-muted-foreground">No browser screenshot has been captured yet.</p>
              {screenshotUri ? (
                <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">{screenshotUri}</p>
              ) : null}
              {loadFailed ? (
                <p className="mt-2 text-xs text-muted-foreground">Screenshot artifact could not be loaded.</p>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export function OperatorSurfaceTabs(props: OperatorSurfaceTabsProps) {
  const browserSession = props.browserSession ?? null;
  const browserSnapshot = props.browserSnapshot ?? null;
  const hasBrowserSurface = Boolean(browserSession || browserSnapshot);
  const showBrowserDock = hasBrowserSurface && props.activeSurface === "chat";
  const browserTabLabel = browserSession?.title ?? browserSnapshot?.title ?? browserSession?.sessionId ?? browserSnapshot?.sessionId ?? "session";
  const selectedFile = props.selectedPath ? props.files.find((file) => file.path === props.selectedPath) ?? null : null;
  const pendingPath = props.selectedPath && props.loadingPath === props.selectedPath && !selectedFile ? props.selectedPath : null;
  const transientPath = pendingPath ?? (props.selectedPath && !selectedFile ? props.selectedPath : null);
  const selectedValue = props.activeSurface === "memory" && props.memoryOpen
    ? MEMORY_TAB_VALUE
    : props.activeSurface === "browser" && hasBrowserSurface
      ? BROWSER_TAB_VALUE
    : props.activeSurface === "workspace" && props.selectedPath
      ? props.selectedPath
      : CHAT_TAB_VALUE;
  const hasTabAlternatives = props.memoryOpen || hasBrowserSurface || props.files.length > 0 || Boolean(transientPath);

  function handleTabChange(value: unknown) {
    if (value === CHAT_TAB_VALUE) {
      props.onSelectChat();
      return;
    }
    if (value === BROWSER_TAB_VALUE && hasBrowserSurface) {
      props.onSelectBrowser?.();
      return;
    }
    if (value === MEMORY_TAB_VALUE && props.memoryOpen) {
      props.onSelectMemory();
      return;
    }
    if (typeof value === "string") {
      props.onSelectFile(value);
    }
  }

  function renderSelectedFileContent() {
    if (props.loadingPath === props.selectedPath) {
      return (
        <div className="flex flex-col gap-3 p-4">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
      );
    }
    if (props.error) {
      return <p className="p-4 text-sm text-destructive">{props.error}</p>;
    }
    if (selectedFile) {
      return <FilePreview file={selectedFile} />;
    }
    return <p className="p-4 text-sm text-muted-foreground">Select a file to preview it here.</p>;
  }

  function renderBrowserPanel() {
    if (!hasBrowserSurface) {
      return null;
    }
    return (
      <BrowserUsePanel
        snapshot={browserSnapshot}
        browserSession={browserSession}
        browserLiveViewportFrame={props.browserLiveViewportFrame}
        loadResourceDataUrl={props.loadResourceDataUrl}
        onBrowserSessionControl={props.onBrowserSessionControl}
        onBrowserOperatorInput={props.onBrowserOperatorInput}
      />
    );
  }

  if (!hasTabAlternatives) {
    return (
      <section aria-label="Operator surfaces" className="h-full min-h-0 min-w-0 overflow-hidden bg-workspace-viewer">
        {props.chatContent}
      </section>
    );
  }

  return (
    <Tabs
      aria-label="Operator surfaces"
      value={selectedValue}
      onValueChange={handleTabChange}
      className="h-full min-h-0 min-w-0 gap-0 overflow-hidden bg-workspace-viewer"
    >
      <div className="min-h-10 min-w-0 max-w-full overflow-x-auto border-b border-border/60 bg-workspace-viewer-panel">
        <TabsList variant="line" className="min-h-10 w-max justify-start gap-1 rounded-none px-2 py-1">
          <TabsTrigger value={CHAT_TAB_VALUE} className="h-8 flex-none px-3">
            <MessageSquare data-icon="inline-start" />
            Chat
          </TabsTrigger>
          {hasBrowserSurface ? (
            <TabsTrigger value={BROWSER_TAB_VALUE} className="h-8 flex-none px-3">
              <Monitor data-icon="inline-start" />
              <span className="max-w-52 truncate">
                Browser: {browserTabLabel}
              </span>
            </TabsTrigger>
          ) : null}
          {props.memoryOpen ? (
            <div
              className={cn(
                "flex h-8 max-w-60 shrink-0 items-center overflow-hidden rounded-md border border-border/60",
                selectedValue === MEMORY_TAB_VALUE ? "bg-secondary text-foreground" : "bg-workspace-viewer text-muted-foreground",
              )}
            >
              <TabsTrigger
                value={MEMORY_TAB_VALUE}
                title="Memory Lattice"
                className="min-w-0 flex-1 justify-start overflow-hidden rounded-r-none border-0 bg-transparent px-2 data-active:bg-transparent"
              >
                <Network data-icon="inline-start" />
                <span className="block min-w-0 truncate">Memory Lattice</span>
              </TabsTrigger>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 rounded-l-none"
                aria-label="Close Memory Lattice"
                onClick={props.onCloseMemory}
              >
                <X />
              </Button>
            </div>
          ) : null}
          {props.files.map((file) => (
            <div
              key={file.path}
              className={cn(
                "flex h-8 max-w-60 shrink-0 items-center overflow-hidden rounded-md border border-border/60",
                selectedValue === file.path ? "bg-secondary text-foreground" : "bg-workspace-viewer text-muted-foreground",
              )}
            >
              <TabsTrigger
                value={file.path}
                title={file.path}
                className="min-w-0 flex-1 justify-start overflow-hidden rounded-r-none border-0 bg-transparent px-2 data-active:bg-transparent"
              >
                <File data-icon="inline-start" />
                <span className="block min-w-0 truncate">{file.name}</span>
              </TabsTrigger>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 rounded-l-none"
                aria-label={`Close ${file.name}`}
                onClick={() => props.onCloseFile(file.path)}
              >
                <X />
              </Button>
            </div>
          ))}
          {transientPath ? (
            <TabsTrigger
              value={transientPath}
              title={transientPath}
              className="h-8 max-w-60 flex-none overflow-hidden border-border/60 bg-secondary px-2 text-foreground"
            >
              <File data-icon="inline-start" />
              <span className="block min-w-0 truncate">{basename(transientPath)}</span>
            </TabsTrigger>
          ) : null}
        </TabsList>
      </div>
      <TabsContent value={CHAT_TAB_VALUE} keepMounted className="min-h-0 min-w-0 overflow-hidden bg-workspace-viewer">
        {showBrowserDock ? (
          <div className="grid h-full min-h-0 min-w-0 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(22rem,40vw)]">
            <div className="min-h-0 min-w-0 overflow-hidden">
              {props.chatContent}
            </div>
            <aside aria-label="Browser dock" className="hidden min-h-0 min-w-0 overflow-hidden border-l border-border/70 bg-workspace-viewer lg:block">
              {renderBrowserPanel()}
            </aside>
          </div>
        ) : props.chatContent}
      </TabsContent>
      {hasBrowserSurface ? (
        <TabsContent value={BROWSER_TAB_VALUE} className="min-h-0 min-w-0 overflow-hidden bg-workspace-viewer">
          {renderBrowserPanel()}
        </TabsContent>
      ) : null}
      {props.memoryOpen ? (
        <TabsContent value={MEMORY_TAB_VALUE} className="min-h-0 min-w-0 overflow-hidden bg-workspace-viewer">
          {props.memoryContent}
        </TabsContent>
      ) : null}
      {props.files.map((file) => (
        <TabsContent key={file.path} value={file.path} className="min-h-0 min-w-0 overflow-hidden bg-workspace-viewer">
          {file.path === props.selectedPath ? renderSelectedFileContent() : <FilePreview file={file} />}
        </TabsContent>
      ))}
      {transientPath ? (
        <TabsContent value={transientPath} className="min-h-0 min-w-0 overflow-hidden bg-workspace-viewer">
          {renderSelectedFileContent()}
        </TabsContent>
      ) : null}
    </Tabs>
  );
}
