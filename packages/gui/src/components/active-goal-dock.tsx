import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, CircleDashed, LoaderCircle, Pause, Pencil, Play, Trash2 } from "lucide-react";
import type { WorkflowGoalActivity } from "@kilnai/gateway-contracts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

export type ActiveGoalAction = "pause" | "resume" | "edit" | "cancel";

export interface ActiveGoalDockProps {
  readonly activity: WorkflowGoalActivity;
  readonly pendingAction?: ActiveGoalAction;
  readonly onPause?: () => void;
  readonly onResume?: () => void;
  readonly onUpdateObjective?: (objective: string) => boolean;
  readonly onCancel?: () => boolean;
}

function elapsedMilliseconds(activity: WorkflowGoalActivity, now: number): number {
  const accumulated = activity.goal.activeDurationMs ?? 0;
  if (activity.goal.status !== "active" || !activity.goal.activeSince) {
    return accumulated;
  }
  const activeSince = Date.parse(activity.goal.activeSince);
  return Number.isFinite(activeSince) ? accumulated + Math.max(0, now - activeSince) : accumulated;
}

function formatElapsed(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function ActiveGoalDock(props: ActiveGoalDockProps) {
  const objectiveInputRef = useRef<HTMLTextAreaElement>(null);
  const [now, setNow] = useState(() => Date.now());
  const [editorOpen, setEditorOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [objective, setObjective] = useState(props.activity.goal.objective);
  const isPaused = props.activity.goal.status === "paused";
  const completedItems = props.activity.workItems.filter(({ item }) => item.status === "completed").length;
  const fileCount = new Set(props.activity.fileChanges.map((change) => change.path)).size;
  const linesAdded = props.activity.fileChanges.reduce((total, change) => total + (change.linesAdded ?? 0), 0);
  const linesRemoved = props.activity.fileChanges.reduce((total, change) => total + (change.linesRemoved ?? 0), 0);
  const elapsed = useMemo(
    () => formatElapsed(elapsedMilliseconds(props.activity, now)),
    [props.activity, now],
  );

  useEffect(() => {
    if (isPaused) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [isPaused, props.activity.goal.id, props.activity.goal.activeSince]);

  const controlsAvailable = Boolean(props.onPause || props.onResume || props.onUpdateObjective || props.onCancel);

  function openEditor(): void {
    setObjective(props.activity.goal.objective);
    setEditorOpen(true);
  }

  function updateObjective(): void {
    const nextObjective = objective.trim();
    if (nextObjective && props.onUpdateObjective?.(nextObjective)) setEditorOpen(false);
  }

  function cancelGoal(): void {
    if (props.onCancel?.()) setCancelOpen(false);
  }

  return (
    <div
      className="flex min-w-0 items-center gap-1 rounded-lg border border-border/70 bg-workspace-viewer-panel px-2 py-1 shadow-sm"
      data-role="active-goal-dock"
    >
      <Popover>
        <PopoverTrigger
          aria-label={`Open goal progress: ${props.activity.goal.objective}`}
          className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          {isPaused ? (
            <Pause aria-hidden="true" className="size-3.5 shrink-0 text-warning" />
          ) : (
            <LoaderCircle aria-hidden="true" className="size-3.5 shrink-0 text-primary motion-safe:animate-spin" />
          )}
          <span className="shrink-0 text-xs font-medium text-foreground">
            {isPaused ? "Goal paused" : "Goal in progress"}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {props.activity.goal.objective}
          </span>
          <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">
            {completedItems}/{props.activity.workItems.length} · {fileCount} files
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{elapsed}</span>
          <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
        </PopoverTrigger>
        <PopoverContent align="start" side="top" sideOffset={8} className="w-[min(28rem,calc(100vw-2rem))] gap-3 p-3">
          <PopoverHeader>
            <PopoverTitle>{props.activity.goal.objective}</PopoverTitle>
            <PopoverDescription>
              {completedItems} of {props.activity.workItems.length} work items completed · {fileCount} files changed · {elapsed} active time
            </PopoverDescription>
          </PopoverHeader>
          <ol className="flex flex-col gap-2" aria-label="Goal progress">
            {props.activity.workItems.map(({ item }) => (
              <li key={item.id} className="flex min-w-0 items-start gap-2 text-xs leading-5">
                {item.status === "completed" ? (
                  <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-success" />
                ) : item.status === "in_progress" ? (
                  <LoaderCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-primary motion-safe:animate-spin" />
                ) : (
                  <CircleDashed aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 text-foreground">{item.summary}</span>
              </li>
            ))}
          </ol>
          {fileCount > 0 ? (
            <div className="border-t border-border/60 pt-2">
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="font-medium text-foreground">{fileCount} files changed</span>
                <span className="tabular-nums">
                  <span className="text-success">+{linesAdded}</span>{" "}
                  <span className="text-destructive">−{linesRemoved}</span>
                </span>
              </div>
              <ul className="max-h-32 space-y-1 overflow-auto" aria-label="Goal file changes">
                {props.activity.fileChanges.map((change) => (
                  <li key={`${change.sequence}:${change.path}`} className="flex min-w-0 items-center gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{change.path}</span>
                    <span className="shrink-0 tabular-nums">
                      <span className="text-success">+{change.linesAdded ?? 0}</span>{" "}
                      <span className="text-destructive">−{change.linesRemoved ?? 0}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      {controlsAvailable ? (
        <div className="flex shrink-0 items-center gap-0.5" aria-label="Goal controls" role="group">
          {isPaused ? (
            <Button
              aria-label="Resume goal"
              disabled={Boolean(props.pendingAction)}
              onClick={props.onResume}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <Play />
            </Button>
          ) : (
            <Button
              aria-label="Pause goal"
              disabled={Boolean(props.pendingAction)}
              onClick={props.onPause}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <Pause />
            </Button>
          )}
          {props.onUpdateObjective ? (
            <Button
              aria-label="Edit goal objective"
              disabled={Boolean(props.pendingAction)}
              onClick={openEditor}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <Pencil />
            </Button>
          ) : null}
          <Button
            aria-label="Cancel goal"
            disabled={Boolean(props.pendingAction)}
            onClick={() => setCancelOpen(true)}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <Trash2 />
          </Button>
        </div>
      ) : null}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent initialFocus={objectiveInputRef}>
          <DialogHeader>
            <DialogTitle>Edit goal objective</DialogTitle>
            <DialogDescription>
              This updates the canonical objective without creating a new goal or transcript row.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="Goal objective"
            ref={objectiveInputRef}
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={!objective.trim()} onClick={updateObjective}>
              Save objective
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this goal?</DialogTitle>
            <DialogDescription>
              Kiln will preserve the goal and its evidence as cancelled audit history. This does not delete files.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCancelOpen(false)}>
              Keep goal
            </Button>
            <Button type="button" variant="destructive" onClick={cancelGoal}>
              Cancel goal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
