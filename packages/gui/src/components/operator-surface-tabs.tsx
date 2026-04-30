import { lazy, Suspense } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { OperatorWorkspaceFileSnapshot } from "@kilnai/gateway-contracts";
import { File, Image, MessageSquare, Network, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type OperatorSurfaceKind = "chat" | "memory" | "workspace";

interface OperatorSurfaceTabsProps {
  readonly activeSurface: OperatorSurfaceKind;
  readonly chatContent: ReactNode;
  readonly memoryContent: ReactNode;
  readonly memoryOpen: boolean;
  readonly files: readonly OperatorWorkspaceFileSnapshot[];
  readonly selectedPath: string | null;
  readonly loadingPath: string | null;
  readonly error: string | null;
  readonly onSelectChat: () => void;
  readonly onSelectMemory: () => void;
  readonly onCloseMemory: () => void;
  readonly onSelectFile: (path: string) => void;
  readonly onCloseFile: (path: string) => void;
}

const CHAT_TAB_VALUE = "__kiln_chat__";
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

export function OperatorSurfaceTabs(props: OperatorSurfaceTabsProps) {
  const selectedFile = props.selectedPath ? props.files.find((file) => file.path === props.selectedPath) ?? null : null;
  const pendingPath = props.selectedPath && props.loadingPath === props.selectedPath && !selectedFile ? props.selectedPath : null;
  const transientPath = pendingPath ?? (props.selectedPath && !selectedFile ? props.selectedPath : null);
  const selectedValue = props.activeSurface === "memory" && props.memoryOpen
    ? MEMORY_TAB_VALUE
    : props.activeSurface === "workspace" && props.selectedPath
      ? props.selectedPath
      : CHAT_TAB_VALUE;

  function handleTabChange(value: unknown) {
    if (value === CHAT_TAB_VALUE) {
      props.onSelectChat();
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
        {props.chatContent}
      </TabsContent>
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
