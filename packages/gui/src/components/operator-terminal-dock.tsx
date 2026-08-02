import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { ChevronDown, RotateCcw, SquareTerminal, X } from "lucide-react";
import type { GuiInboundFrame, GuiOutboundFrame } from "@kilnai/gateway-contracts";
import { Button } from "@/components/ui/button";
import {
  projectOperatorThemeHexVariables,
  resolveAppliedOperatorThemePalette,
} from "@/lib/operator-theme-projection";
import { useAppliedOperatorThemeSignature } from "@/lib/use-operator-theme";
import {
  MAX_OPERATOR_TERMINAL_HEIGHT,
  MIN_OPERATOR_TERMINAL_HEIGHT,
  OPERATOR_TERMINAL_PANEL_ID,
  persistOperatorTerminalHeightPreference,
  readOperatorTerminalHeightPreference,
} from "./app-shell-runtime.js";

type TerminalFrame = Extract<GuiInboundFrame, { type: `operator_terminal_${string}` }>;

interface OperatorTerminalDockProps {
  readonly available: boolean;
  readonly expanded: boolean;
  readonly layout?: "drawer" | "surface";
  readonly workspaceScope: string;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly send: (frame: GuiOutboundFrame) => void;
  readonly subscribe: (listener: (frame: TerminalFrame) => void) => () => void;
}

interface ResizeState {
  readonly pointerId: number;
  readonly startY: number;
  readonly startHeight: number;
}

const RESIZE_STEP = 16;
const MAX_DRAWER_HEIGHT_RATIO = 0.75;

function readTerminalTheme() {
  const root = document.documentElement;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const tokens = projectOperatorThemeHexVariables(resolveAppliedOperatorThemePalette(root, prefersDark));
  return {
    background: tokens["--color-background-panel"],
    foreground: tokens["--color-text"],
    cursor: tokens["--color-primary"],
    selectionBackground: tokens["--color-surface-selected"],
  };
}

function maximumDrawerHeight(section: HTMLElement | null) {
  const availableHeight = section?.parentElement?.clientHeight || window.innerHeight;
  return Math.min(MAX_OPERATOR_TERMINAL_HEIGHT, Math.max(
    MIN_OPERATOR_TERMINAL_HEIGHT,
    Math.floor(availableHeight * MAX_DRAWER_HEIGHT_RATIO),
  ));
}

function clampDrawerHeight(height: number, section: HTMLElement | null) {
  return Math.min(
    Math.max(Math.round(height), MIN_OPERATOR_TERMINAL_HEIGHT),
    maximumDrawerHeight(section),
  );
}

export function OperatorTerminalDock(props: OperatorTerminalDockProps) {
  const { available, expanded, layout = "drawer", onExpandedChange, send, subscribe, workspaceScope } = props;
  const [requestId, setRequestId] = useState<string | null>(null);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "opening" | "running" | "exited" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState(() => readOperatorTerminalHeightPreference(workspaceScope));
  const operatorThemeSignature = useAppliedOperatorThemeSignature();
  const sectionRef = useRef<HTMLElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const resizeStateRef = useRef<ResizeState | null>(null);

  useEffect(() => {
    terminalIdRef.current = terminalId;
  }, [terminalId]);

  useEffect(() => {
    if (available) return;
    terminalIdRef.current = null;
    requestIdRef.current = null;
    setRequestId(null);
    setTerminalId(null);
    setCwd(null);
    setStatus("idle");
    setError(null);
  }, [available]);

  useEffect(() => {
    setHeight(readOperatorTerminalHeightPreference(workspaceScope));
  }, [workspaceScope]);

  useEffect(() => {
    if (!expanded || layout !== "drawer") return;
    const fitToWorkbench = () => {
      setHeight((currentHeight) => clampDrawerHeight(currentHeight, sectionRef.current));
      fitRef.current?.fit();
    };
    fitToWorkbench();
    window.addEventListener("resize", fitToWorkbench);
    return () => window.removeEventListener("resize", fitToWorkbench);
  }, [expanded, layout]);

  useEffect(() => {
    if (!available || !expanded || status !== "idle" || terminalIdRef.current || requestIdRef.current) return;
    const nextRequestId = crypto.randomUUID();
    requestIdRef.current = nextRequestId;
    setRequestId(nextRequestId);
    setStatus("opening");
    setError(null);
    send({ type: "operator_terminal_open", requestId: nextRequestId, cols: 100, rows: 16 });
  }, [available, expanded, send, status]);

  useEffect(() => {
    if (!requestId || !containerRef.current) return;
    const terminal = new Terminal({
      cursorBlink: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.35,
      screenReaderMode: true,
      scrollback: 5_000,
      theme: readTerminalTheme(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(containerRef.current);
    fit.fit();
    terminal.focus();
    terminalRef.current = terminal;
    fitRef.current = fit;

    const inputSubscription = terminal.onData((data) => {
      const activeTerminalId = terminalIdRef.current;
      if (activeTerminalId) {
        send({ type: "operator_terminal_write", terminalId: activeTerminalId, data });
      }
    });
    let previousSize = { cols: terminal.cols, rows: terminal.rows };
    const observer = new ResizeObserver(() => {
      if (!containerRef.current || containerRef.current.clientWidth === 0 || containerRef.current.clientHeight === 0) return;
      fit.fit();
      const activeTerminalId = terminalIdRef.current;
      if (!activeTerminalId || (previousSize.cols === terminal.cols && previousSize.rows === terminal.rows)) return;
      previousSize = { cols: terminal.cols, rows: terminal.rows };
      send({
        type: "operator_terminal_resize",
        terminalId: activeTerminalId,
        cols: terminal.cols,
        rows: terminal.rows,
      });
    });
    observer.observe(containerRef.current);
    return () => {
      observer.disconnect();
      inputSubscription.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  }, [requestId, send]);

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = readTerminalTheme();
  }, [operatorThemeSignature]);

  useEffect(() => {
    if (!expanded) return;
    fitRef.current?.fit();
    terminalRef.current?.focus();
  }, [expanded, height, layout]);

  useEffect(() => subscribe((frame) => {
    if (frame.type === "operator_terminal_opened" && frame.requestId === requestIdRef.current) {
      terminalIdRef.current = frame.terminalId;
      setTerminalId(frame.terminalId);
      setCwd(frame.cwd);
      setStatus("running");
      terminalRef.current?.focus();
      return;
    }
    if (frame.type === "operator_terminal_output" && frame.terminalId === terminalIdRef.current) {
      terminalRef.current?.write(frame.data);
      return;
    }
    if (frame.type === "operator_terminal_exited" && frame.terminalId === terminalIdRef.current) {
      setStatus("exited");
      terminalIdRef.current = null;
      requestIdRef.current = null;
      setTerminalId(null);
      setRequestId(null);
      terminalRef.current?.writeln(`\r\n[process exited with code ${frame.exitCode}]`);
      return;
    }
    if (frame.type === "operator_terminal_error"
      && (frame.requestId === requestIdRef.current || frame.terminalId === terminalIdRef.current)) {
      setStatus("error");
      setError(frame.message);
      if (!frame.terminalId) {
        requestIdRef.current = null;
        setRequestId(null);
      }
    }
  }), [subscribe]);

  if (!available) return null;

  const updateHeight = (nextHeight: number, persist = false) => {
    const clamped = clampDrawerHeight(nextHeight, sectionRef.current);
    setHeight(clamped);
    if (persist) persistOperatorTerminalHeightPreference(workspaceScope, clamped);
  };
  const handleResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeStateRef.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: height };
  };
  const handleResizePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    event.preventDefault();
    updateHeight(resizeState.startHeight + resizeState.startY - event.clientY);
  };
  const handleResizePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    resizeStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    persistOperatorTerminalHeightPreference(workspaceScope, height);
  };
  const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? RESIZE_STEP * 4 : RESIZE_STEP;
    const nextHeight = event.key === "ArrowUp"
      ? height + step
      : event.key === "ArrowDown"
        ? height - step
        : event.key === "Home"
          ? MIN_OPERATOR_TERMINAL_HEIGHT
          : event.key === "End"
          ? maximumDrawerHeight(sectionRef.current)
            : null;
    if (nextHeight === null) return;
    event.preventDefault();
    updateHeight(nextHeight, true);
  };
  const closeTerminal = () => {
    if (terminalId) send({ type: "operator_terminal_close", terminalId });
    terminalIdRef.current = null;
    requestIdRef.current = null;
    setTerminalId(null);
    setRequestId(null);
    setCwd(null);
    setStatus("idle");
    setError(null);
    onExpandedChange(false);
  };
  const restartTerminal = () => {
    terminalIdRef.current = null;
    requestIdRef.current = null;
    setTerminalId(null);
    setRequestId(null);
    setCwd(null);
    setError(null);
    setStatus("idle");
  };

  const maximumHeight = maximumDrawerHeight(sectionRef.current);
  const drawer = layout === "drawer";
  return (
    <section
      ref={sectionRef}
      id={OPERATOR_TERMINAL_PANEL_ID}
      aria-label="Operator terminal"
      hidden={!expanded}
      className={expanded
        ? drawer
          ? "relative shrink-0 border-t border-border bg-card"
          : "relative flex min-h-0 flex-1 flex-col bg-card"
        : undefined}
      style={expanded && drawer ? { height: `${height}px` } : undefined}
    >
      {drawer ? (
        <div
          role="separator"
          aria-label="Resize terminal"
          aria-orientation="horizontal"
          aria-valuemin={MIN_OPERATOR_TERMINAL_HEIGHT}
          aria-valuemax={maximumHeight}
          aria-valuenow={height}
          tabIndex={0}
          className="absolute inset-x-0 top-0 z-20 h-2 -translate-y-1/2 cursor-row-resize touch-none outline-none focus-visible:bg-ring/70"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerEnd}
          onPointerCancel={handleResizePointerEnd}
          onKeyDown={handleResizeKeyDown}
        />
      ) : null}
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border/70 px-3">
        <SquareTerminal className="size-4 text-primary" aria-hidden="true" />
        <p className="text-xs font-medium text-foreground">Terminal</p>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground" title={cwd ?? undefined}>
          {cwd ?? (status === "opening" ? "Starting shell..." : status)}
        </span>
        <span className="sr-only" aria-live="polite">Terminal {status}{error ? `: ${error}` : ""}</span>
        {!terminalId && (status === "exited" || status === "error") ? (
          <Button type="button" variant="ghost" size="sm" onClick={restartTerminal}>
            <RotateCcw data-icon="inline-start" aria-hidden="true" />
            Restart
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Collapse terminal"
          aria-expanded="true"
          aria-controls={OPERATOR_TERMINAL_PANEL_ID}
          onClick={() => onExpandedChange(false)}
        >
          <ChevronDown aria-hidden="true" />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close terminal" onClick={closeTerminal}>
          <X aria-hidden="true" />
        </Button>
      </header>
      {error ? <p role="alert" className="shrink-0 px-3 py-2 text-xs text-destructive">{error}</p> : null}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden p-2" />
    </section>
  );
}
