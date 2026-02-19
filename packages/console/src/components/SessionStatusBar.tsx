import { useState, useEffect, useCallback } from "react";
import type { SessionStatus } from "../lib/protocol";
import type { CostSummary } from "../lib/protocol";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Play, Square, RotateCcw, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

interface SessionStatusBarProps {
  sessionStatus: SessionStatus;
  statusMessage: string;
  task: string | null;
  cost: CostSummary;
  error: string | null;
  onStart: (task: string) => void;
  onStop: () => void;
}

function useElapsedTime(running: boolean): string {
  const [startTime] = useState(() => (running ? Date.now() : 0));
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!running) {
      setElapsed(0);
      return;
    }
    const start = startTime || Date.now();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [running, startTime]);

  if (!running || elapsed === 0) return "";
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

export function SessionStatusBar({
  sessionStatus,
  statusMessage,
  task,
  cost,
  error,
  onStart,
  onStop,
}: SessionStatusBarProps) {
  const [taskInput, setTaskInput] = useState("");
  const elapsed = useElapsedTime(sessionStatus === "running");

  const handleStart = useCallback(() => {
    const trimmed = taskInput.trim();
    if (trimmed) {
      onStart(trimmed);
      setTaskInput("");
    }
  }, [taskInput, onStart]);

  if (sessionStatus === "idle") {
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />
          <span className="text-sm text-muted-foreground">No active session</span>
        </div>
        <Input
          value={taskInput}
          onChange={(e) => setTaskInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleStart()}
          placeholder="Describe the task..."
          className="flex-1 font-mono text-sm"
        />
        <Button
          onClick={handleStart}
          disabled={!taskInput.trim()}
          size="sm"
        >
          <Play className="h-3.5 w-3.5" />
          Start Session
        </Button>
      </div>
    );
  }

  if (sessionStatus === "starting") {
    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
          <span className="text-sm text-amber-400 font-medium">
            {statusMessage || "Starting session..."}
          </span>
        </div>
        <Button variant="outline" size="sm" disabled>
          <Square className="h-3.5 w-3.5" />
          Stop
        </Button>
      </div>
    );
  }

  if (sessionStatus === "running") {
    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          <span className="text-sm font-medium text-emerald-400">Running</span>
          {task && (
            <span className="text-sm text-muted-foreground truncate max-w-md">
              {task}
            </span>
          )}
          {elapsed && (
            <Badge variant="secondary" className="font-mono text-xs">
              {elapsed}
            </Badge>
          )}
        </div>
        <Button variant="destructive" size="sm" onClick={onStop}>
          <Square className="h-3.5 w-3.5" />
          Stop Session
        </Button>
      </div>
    );
  }

  if (sessionStatus === "error") {
    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-red-400" />
          <span className="text-sm text-red-400 font-medium">Error</span>
          <span className="text-sm text-red-300/70 truncate max-w-md">
            {error || statusMessage}
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={() => {
          setTaskInput(task ?? "");
        }}>
          <RotateCcw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  // completed
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        <span className="text-sm text-emerald-400 font-medium">Completed</span>
        {cost.total > 0 && (
          <Badge variant="secondary" className="font-mono text-xs">
            ${cost.total.toFixed(4)}
          </Badge>
        )}
        <span className="text-sm text-muted-foreground">
          {statusMessage}
        </span>
      </div>
      <Button variant="outline" size="sm" onClick={() => {
        setTaskInput("");
      }}>
        New Session
      </Button>
    </div>
  );
}
