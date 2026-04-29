import { useEffect, useMemo, useState } from "react";
import type { ChangedFileEntry } from "../lib/session-store.js";
import { cn } from "@/lib/utils";
import { SidebarPanelShell } from "./sidebar-panel-shell.js";

interface ChangedFilesPanelProps {
  readonly files: readonly ChangedFileEntry[];
}

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatRecordedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return timeFormatter.format(date);
}

function fileKey(entry: ChangedFileEntry): string {
  return `${entry.recordedAt}:${entry.path}`;
}

function changeGlyph(changeType: ChangedFileEntry["changeType"]): string {
  if (changeType === "created") {
    return "+";
  }
  if (changeType === "deleted") {
    return "-";
  }
  return "~";
}

function changeLabel(changeType: ChangedFileEntry["changeType"]): string {
  if (changeType === "created") {
    return "Created";
  }
  if (changeType === "deleted") {
    return "Deleted";
  }
  return "Modified";
}

function lineDelta(entry: ChangedFileEntry): string | null {
  const added = typeof entry.linesAdded === "number" && entry.linesAdded > 0 ? `+${entry.linesAdded}` : "";
  const removed = typeof entry.linesRemoved === "number" && entry.linesRemoved > 0 ? `-${entry.linesRemoved}` : "";
  const delta = `${added}${removed}`;
  return delta.length > 0 ? delta : null;
}

function DetailRow(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{props.label}</p>
      <p className="mt-1 text-sm leading-5 text-foreground">{props.value}</p>
    </div>
  );
}

export function ChangedFilesPanel(props: ChangedFilesPanelProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedFile = useMemo(
    () => props.files.find((entry) => fileKey(entry) === selectedKey) ?? props.files[0] ?? null,
    [props.files, selectedKey],
  );

  useEffect(() => {
    if (props.files.length === 0) {
      if (selectedKey !== null) {
        setSelectedKey(null);
      }
      return;
    }
    const stillExists = selectedKey ? props.files.some((entry) => fileKey(entry) === selectedKey) : false;
    if (!stillExists) {
      setSelectedKey(fileKey(props.files[0]!));
    }
  }, [props.files, selectedKey]);

  return (
    <SidebarPanelShell title="Changed Files" meta={`${props.files.length} tracked`}>
      <div className="grid min-h-0 flex-1 lg:grid-rows-[minmax(0,1.1fr)_minmax(14rem,0.9fr)]">
        <div className="min-h-0 overflow-y-auto border-b border-border/60">
          {props.files.length === 0 ? (
            <div className="grid h-full place-items-center px-6 py-16 text-center">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">no file changes yet</p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  File-change events from the canonical timeline will appear here for the active Kiln session.
                </p>
              </div>
            </div>
          ) : (
            <ul aria-label="Changed files" className="divide-y divide-border/60">
              {props.files.map((entry) => {
                const active = selectedFile ? fileKey(entry) === fileKey(selectedFile) : false;
                const delta = lineDelta(entry);
                return (
                  <li key={fileKey(entry)}>
                    <button
                      type="button"
                      onClick={() => setSelectedKey(fileKey(entry))}
                      aria-pressed={active}
                      className={cn(
                        "grid w-full grid-cols-[1.5rem_1fr] gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        active ? "bg-secondary/60" : "hover:bg-secondary/35",
                      )}
                    >
                      <span className="mt-0.5 inline-flex size-5 items-center justify-center rounded border border-border/80 font-mono text-[11px] text-muted-foreground">
                        {changeGlyph(entry.changeType)}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-start gap-2">
                          <span className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5 text-foreground">
                            {entry.path.replace(/\\/g, "/")}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                            {changeLabel(entry.changeType)}
                          </span>
                        </span>
                        <span className="mt-1 flex min-w-0 items-center gap-2 font-mono text-[10.5px] tracking-[0.01em] text-muted-foreground/75">
                          <span>{formatRecordedAt(entry.recordedAt)}</span>
                          {delta ? (
                            <>
                              <span className="text-muted-foreground/40">·</span>
                              <span>{delta}</span>
                            </>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto px-4 py-4">
          {selectedFile ? (
            <section aria-label="Selected file review" className="flex flex-col gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Review</p>
                <p className="mt-2 text-sm font-medium leading-6 text-foreground">{selectedFile.path.replace(/\\/g, "/")}</p>
              </div>

              <div className="grid gap-2">
                <DetailRow label="Change" value={changeLabel(selectedFile.changeType)} />
                <DetailRow label="Recorded" value={formatRecordedAt(selectedFile.recordedAt)} />
                <DetailRow label="Line delta" value={lineDelta(selectedFile) ?? "No line counts recorded"} />
              </div>

              <div className="rounded-md border border-dashed border-border/70 bg-background px-3 py-3">
                {selectedFile.diffPreview ? (
                  <>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Diff preview</p>
                    <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded border border-border/50 bg-secondary/25 px-2.5 py-2 text-[11px] leading-5 text-foreground">
                      {selectedFile.diffPreview.split(/\r?\n/).map((line, index) => (
                        <span key={`${index}:${line}`} className="block">
                          {line.length > 0 ? line : " "}
                        </span>
                      ))}
                    </pre>
                    {selectedFile.diffTruncated ? (
                      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                        Preview truncated to keep timeline events bounded.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Diff status</p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Diff preview is not available for this file-change event.
                    </p>
                  </>
                )}
              </div>
            </section>
          ) : (
            <div className="grid h-full place-items-center text-center">
              <p className="text-sm leading-6 text-muted-foreground">Select a changed file to inspect its event details.</p>
            </div>
          )}
        </div>
      </div>
    </SidebarPanelShell>
  );
}
