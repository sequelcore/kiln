import type { TaskNode } from "../lib/protocol";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ListTree, Circle, CircleDot, Check, X, CircleSlash } from "lucide-react";

const STATUS_ICON: Record<string, typeof Circle> = {
  pending: Circle,
  in_progress: CircleDot,
  completed: Check,
  failed: X,
  pruned: CircleSlash,
};

const STATUS_COLOR: Record<string, string> = {
  pending: "text-muted-foreground",
  in_progress: "text-chart-1",
  completed: "text-emerald-400",
  failed: "text-red-400",
  pruned: "text-muted-foreground/50",
};

function TaskRow({ task }: { task: TaskNode }) {
  const Icon = STATUS_ICON[task.status] ?? Circle;
  const color = STATUS_COLOR[task.status] ?? "text-muted-foreground";

  return (
    <>
      <div
        className="flex items-center gap-1.5 py-0.5"
        style={{ paddingLeft: `${task.depth * 16}px` }}
      >
        <Icon className={cn("h-3 w-3 shrink-0", color)} />
        <span
          className={cn(
            "text-sm",
            task.status === "in_progress" && "text-foreground font-medium",
            task.status === "pruned" && "text-muted-foreground/50 line-through",
            task.status !== "in_progress" && task.status !== "pruned" && "text-muted-foreground",
          )}
        >
          {task.label}
        </span>
      </div>
      {task.children.map((child) => (
        <TaskRow key={child.id} task={child} />
      ))}
    </>
  );
}

interface TaskTreeProps {
  tasks: TaskNode[];
}

export function TaskTree({ tasks }: TaskTreeProps) {
  return (
    <Card>
      <CardHeader className="pb-2 p-4 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <ListTree className="h-3.5 w-3.5" />
          Tasks
        </CardTitle>
        {tasks.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {tasks.length}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground/50">No tasks yet</p>
        ) : (
          <div className="font-mono space-y-0">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
