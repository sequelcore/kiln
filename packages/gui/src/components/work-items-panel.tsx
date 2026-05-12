import { projectAgentProfileIdentity } from "@kilnai/gateway-contracts";
import type { WorkItemEntry } from "../lib/session-store.js";
import { OperatorAvatar } from "./operator-avatar.js";
import type { OperatorAvatarState } from "./operator-avatar.js";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface WorkItemsPanelProps {
  readonly items: readonly WorkItemEntry[];
}

function statusTone(status: string): string {
  if (status === "completed") return "border-emerald-500/35 bg-emerald-500/10 text-emerald-300";
  if (status === "blocked") return "border-amber-500/35 bg-amber-500/10 text-amber-300";
  if (status === "cancelled") return "border-destructive/35 bg-destructive/10 text-destructive";
  if (status === "in_progress") return "border-sky-500/35 bg-sky-500/10 text-sky-300";
  return "border-border bg-background text-muted-foreground";
}

function evidenceLabel(item: WorkItemEntry): string {
  if (item.expectedEvidence.length === 0) return "No evidence gates";
  return `${item.providedEvidence.length}/${item.expectedEvidence.length} evidence`;
}

function avatarStateForStatus(status: string): OperatorAvatarState {
  if (status === "in_progress") return "running";
  if (status === "completed") return "success";
  if (status === "blocked") return "warning";
  if (status === "cancelled") return "error";
  return "idle";
}

function latestAttempt(item: WorkItemEntry) {
  return item.executionAttempts?.at(-1);
}

function attemptModeLabel(value: string): string {
  return value.replace(/_/g, " ");
}

export function WorkItemsPanel(props: WorkItemsPanelProps) {
  if (props.items.length === 0) {
    return (
      <section aria-label="Work items" className="grid h-full place-items-center bg-card px-6 text-center">
        <div className="max-w-sm">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">no work items yet</p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Governed work items will appear here when the assistant decomposes work through `work_item.update`.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Work items" className="h-full min-h-0 overflow-y-auto bg-card">
      <ul className="divide-y divide-border/60">
        {props.items.map((item) => {
          const missing = [
            ...(item.missingEvidence ?? []),
            ...(item.missingResidualRisk ? ["residual-risk"] : []),
          ];
          const pendingRequirements = item.pauseRequirements?.filter((requirement) => requirement.status === "pending") ?? [];
          const attempt = latestAttempt(item);
          const identity = projectAgentProfileIdentity(item.assignedAgentProfile);
          return (
            <li key={item.id} className="px-5 py-4">
              <div className="flex min-w-0 items-start gap-3">
                {identity ? (
                  <OperatorAvatar
                    identity={identity}
                    size="sm"
                    state={avatarStateForStatus(item.status)}
                    className="mt-0.5"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold text-foreground">{item.summary}</p>
                    <Badge variant="outline" className={cn("shrink-0", statusTone(item.status))}>
                      {item.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <p className="mt-1 font-mono text-[10.5px] tracking-[0.01em] text-muted-foreground">
                    {item.id} / {item.workflowProfile}
                    {item.surface ? ` / ${item.surface}` : ""}
                    {item.assignedAgentProfile ? ` / ${item.assignedAgentProfile}` : ""}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {evidenceLabel(item)}
                </Badge>
              </div>
              {item.verificationGates.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {item.verificationGates.map((gate) => (
                    <Badge key={gate} variant="secondary" className="font-mono text-[10px]">
                      {gate}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {missing.length > 0 ? (
                <p className="mt-3 text-sm leading-6 text-amber-300">
                  Missing: {missing.join(", ")}
                </p>
              ) : null}
              {pendingRequirements.length > 0 ? (
                <div className="mt-3 space-y-1">
                  {pendingRequirements.map((requirement) => (
                    <p key={requirement.id} className="text-sm leading-6 text-amber-300">
                      {requirement.kind.replace(/_/g, " ")}: {requirement.summary}
                    </p>
                  ))}
                </div>
              ) : null}
              {attempt ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground">
                  <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                    {attemptModeLabel(attempt.executionMode)} / {attempt.status.replace(/_/g, " ")}
                  </Badge>
                  {attempt.managedInvocationId ? (
                    <span>{attempt.managedInvocationId}</span>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
