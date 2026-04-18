import { useState } from "react";
import type { ToolCallEntry } from "../lib/session-store.js";

interface ToolCallLogProps {
  readonly entries: readonly ToolCallEntry[];
}

function StatusBadge(props: { readonly status: ToolCallEntry["status"] }) {
  const classes = {
    running: "text-[var(--color-info)] border-[var(--color-info)]/40 bg-[var(--color-info)]/10",
    success: "text-[var(--color-success)] border-[var(--color-success)]/40 bg-[var(--color-success)]/10",
    error: "text-[var(--color-error)] border-[var(--color-error)]/40 bg-[var(--color-error)]/10",
  }[props.status];

  const label = props.status === "running" ? "running" : props.status === "success" ? "done" : "error";

  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${classes}`}>
      {label}
    </span>
  );
}

function JsonCollapse(props: { readonly label: string; readonly value: unknown }) {
  const [open, setOpen] = useState(false);
  const json = JSON.stringify(props.value, null, 2);

  return (
    <div className="mt-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-border-active)]"
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        {props.label}
      </button>
      {open ? (
        <pre className="mt-1 max-h-40 overflow-auto rounded bg-[var(--color-background)] px-2 py-1.5 text-[10px] text-[var(--color-text-muted)]">
          {json}
        </pre>
      ) : null}
    </div>
  );
}

function ToolCallRow(props: { readonly entry: ToolCallEntry }) {
  const { entry } = props;
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="border-b border-[var(--color-border)]/50 px-3 py-2 last:border-b-0">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${entry.toolName}`}
          onClick={() => setExpanded((prev) => !prev)}
          className="flex flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-border-active)]"
        >
          <span aria-hidden="true" className="text-[var(--color-text-muted)]">
            {expanded ? "▾" : "▸"}
          </span>
          <span className="font-mono text-xs text-[var(--color-tool-fg)]">{entry.toolName}</span>
          <StatusBadge status={entry.status} />
          {entry.status === "running" ? (
            <span
              aria-hidden="true"
              className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--color-info)]"
            />
          ) : null}
        </button>
        <time
          dateTime={entry.startedAt}
          className="shrink-0 text-[10px] text-[var(--color-text-muted)]"
          title={entry.startedAt}
        >
          {new Date(entry.startedAt).toLocaleTimeString()}
        </time>
      </div>
      {expanded ? (
        <div className="ml-5 mt-1">
          <JsonCollapse label="args" value={entry.input} />
          {entry.result !== undefined ? (
            <JsonCollapse label="result" value={entry.result} />
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function ToolCallLog(props: ToolCallLogProps) {
  const [open, setOpen] = useState(false);

  if (props.entries.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Tool call log"
      className="border-b border-[var(--color-border)] bg-[var(--color-background-panel)]"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls="tool-call-log-list"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-active)]"
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span>Tool calls ({props.entries.length})</span>
        {props.entries.some((e) => e.status === "running") ? (
          <span
            aria-label="Tool running"
            className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-[var(--color-info)]"
          />
        ) : null}
      </button>
      {open ? (
        <ul
          id="tool-call-log-list"
          role="list"
          className="max-h-64 overflow-y-auto border-t border-[var(--color-border)]/50"
        >
          {props.entries.map((entry) => (
            <ToolCallRow key={entry.callId} entry={entry} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
