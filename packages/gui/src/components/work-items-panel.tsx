import { projectAgentProfileIdentity, type OperatorCockpitActionTarget } from "@kilnai/gateway-contracts";
import type { WorkItemEntry } from "../lib/session-store.js";
import { OperatorIdentityMark } from "./operator-identity-mark.js";
import { ExternalLink } from "lucide-react";
import { BorderBeam } from "border-beam";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Task, TaskContent, TaskItem, TaskTrigger, type TaskStatus } from "@/components/ai-elements/task";
import { resolveBorderBeamTheme } from "../lib/border-beam-theme.js";
import { useUiStore } from "../lib/ui-store.js";

interface WorkItemsPanelProps {
  readonly items: readonly WorkItemEntry[];
  readonly onOpenResource?: (uri: string, target?: OperatorCockpitActionTarget) => void;
}

function taskStatus(status: string): TaskStatus {
  if (status === "in_progress" || status === "completed" || status === "blocked" || status === "cancelled") {
    return status;
  }
  return "pending";
}

function evidenceLabel(item: WorkItemEntry): string {
  if (item.expectedEvidence.length === 0) return "No evidence gates";
  return `${item.providedEvidence.length} of ${item.expectedEvidence.length} evidence`;
}

function latestAttempt(item: WorkItemEntry) {
  return item.executionAttempts?.at(-1);
}

function attemptModeLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function activeWorkItemId(items: readonly WorkItemEntry[]): string | null {
  return items.reduce<WorkItemEntry | null>((current, item) => {
    if (item.status !== "in_progress") return current;
    if (!current || item.updatedAt > current.updatedAt) return item;
    return current;
  }, null)?.id ?? null;
}

export function WorkItemsPanel(props: WorkItemsPanelProps) {
  const kilnTheme = useUiStore((state) => state.theme);
  const beamTheme = resolveBorderBeamTheme(kilnTheme);
  const emphasizedWorkItemId = activeWorkItemId(props.items);
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
      <ul className="flex flex-col gap-2 p-4">
        {props.items.map((item, index) => {
          const missing = [
            ...(item.missingEvidence ?? []),
            ...(item.missingGoalEvidence ?? []),
            ...(item.missingVerificationGates ?? []).map((gate) => `missing gate: ${gate}`),
            ...(item.failedVerificationGates ?? []).map((gate) => `failed gate: ${gate}`),
            ...(item.missingResidualRisk ? ["residual-risk"] : []),
          ];
          const pendingRequirements = item.pauseRequirements?.filter((requirement) => requirement.status === "pending") ?? [];
          const attempt = latestAttempt(item);
          const identity = projectAgentProfileIdentity(item.assignedAgentProfile);
          const status = taskStatus(item.status);
          const task = (
              <Task status={status} variant="card" defaultOpen={status !== "completed" && status !== "cancelled"}>
                <TaskTrigger
                  title={item.summary}
                  status={status}
                  description={evidenceLabel(item)}
                  leading={identity ? (
                    <OperatorIdentityMark
                      identity={identity}
                      size="sm"
                    />
                  ) : undefined}
                />
                <TaskContent>
                  <TaskItem className="font-mono text-[10.5px] tracking-[0.01em]">
                    {item.id} / {item.workflowProfile}
                    {item.surface ? ` / ${item.surface}` : ""}
                    {item.assignedAgentProfile ? ` / ${item.assignedAgentProfile}` : ""}
                    {item.authorityProfile ? ` / ${item.authorityProfile}` : ""}
                  </TaskItem>
                  {item.resourceUri ? (
                    <div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!props.onOpenResource}
                        aria-label={`Open work item ${item.id} resource`}
                        title={item.resourceUri}
                        onClick={() => props.onOpenResource?.(item.resourceUri!, {
                          resourceUri: item.resourceUri!,
                          workItemId: item.id,
                        })}
                      >
                        <ExternalLink aria-hidden="true" data-icon="inline-start" />
                        Open resource
                      </Button>
                    </div>
                  ) : null}
                  {item.verificationGates.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {item.verificationGates.map((gate) => (
                        <Badge key={gate} variant="secondary" className="font-mono text-[10px]">
                          {gate}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {item.referenceRoots && item.referenceRoots.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {item.referenceRoots.map((root) => (
                        <Badge key={root} variant="outline" className="max-w-full truncate font-mono text-[10px] text-muted-foreground">
                          {root}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {missing.length > 0 ? (
                    <TaskItem className="text-warning">
                      Missing: {missing.join(", ")}
                    </TaskItem>
                  ) : null}
                  {pendingRequirements.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {pendingRequirements.map((requirement) => (
                        <TaskItem key={requirement.id} className="text-warning">
                          {requirement.kind.replace(/_/g, " ")}: {requirement.summary}
                        </TaskItem>
                      ))}
                    </div>
                  ) : null}
                  {attempt ? (
                    <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground">
                      <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                        {attemptModeLabel(attempt.executionMode)} / {attempt.status.replace(/_/g, " ")}
                      </Badge>
                      {attempt.managedInvocationId ? (
                        <span>{attempt.managedInvocationId}</span>
                      ) : null}
                    </div>
                  ) : null}
                </TaskContent>
              </Task>
          );
          return (
            <li key={item.sessionId ? `${item.sessionId}\u001f${item.id}` : `${item.id}\u001f${index}`}>
              {item.id === emphasizedWorkItemId ? (
                <BorderBeam
                  active
                  className="w-full"
                  colorVariant="colorful"
                  data-beam-motion="pulse"
                  data-beam-theme={beamTheme}
                  data-role="work-item-activity-beam"
                  data-work-item-id={item.id}
                  duration={2.8}
                  size="pulse-inner"
                  strength={0.72}
                  theme={beamTheme}
                >
                  {task}
                </BorderBeam>
              ) : task}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
