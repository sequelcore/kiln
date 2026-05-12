import type { TimelineEntry } from "../lib/session-store.js";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface WorkflowOverviewPanelProps {
  readonly entries: readonly TimelineEntry[];
}

interface WorkflowPlanPreview {
  readonly id: string;
  readonly summary: string;
  readonly mode?: string;
  readonly status: "submitted" | "approved" | "analysis-blocked";
  readonly workflowProfile?: string;
  readonly riskClassification?: string;
  readonly proposedWorkItemCount?: number;
}

interface WorkflowGoalPreview {
  readonly id: string;
  readonly objective: string;
  readonly status: string;
  readonly planId?: string;
  readonly workflowProfile?: string;
  readonly authority?: string;
  readonly escalation?: string;
  readonly workItemCount: number;
}

interface WorkflowMaterializationPreview {
  readonly id: string;
  readonly planId?: string;
  readonly goalRunId?: string;
  readonly approvalId?: string;
  readonly workItemCount: number;
  readonly createdCount: number;
  readonly reusedCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => readString(entry) ? [readString(entry)!] : [])
    : [];
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function badgeTone(value: string): string {
  if (value === "approved" || value === "completed") return "border-emerald-500/35 bg-emerald-500/10 text-emerald-300";
  if (value === "analysis-blocked" || value === "blocked" || value === "failed") return "border-amber-500/35 bg-amber-500/10 text-amber-300";
  if (value === "active" || value === "submitted") return "border-sky-500/35 bg-sky-500/10 text-sky-300";
  return "border-border bg-background text-muted-foreground";
}

function normalizeLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function latestWorkflowPreview(entries: readonly TimelineEntry[]): {
  readonly plan?: WorkflowPlanPreview;
  readonly goal?: WorkflowGoalPreview;
  readonly materialization?: WorkflowMaterializationPreview;
} {
  let plan: WorkflowPlanPreview | undefined;
  let goal: WorkflowGoalPreview | undefined;
  let materialization: WorkflowMaterializationPreview | undefined;

  for (const entry of entries) {
    if (entry.type !== "event") continue;
    const details = isRecord(entry.details) ? entry.details : {};

    if (entry.eventKind === "plan_submitted") {
      const id = readString(details.planId);
      const summary = readString(details.summary) ?? readString(details.objective) ?? entry.summary;
      if (id && summary) {
        plan = {
          id,
          summary,
          mode: readString(details.mode),
          status: "submitted",
          workflowProfile: readString(details.workflowProfile),
          riskClassification: readString(details.riskClassification),
          proposedWorkItemCount: readNumber(details.proposedWorkItemCount),
        };
      }
      continue;
    }

    if (entry.eventKind === "plan_approved") {
      const id = readString(details.planId);
      if (id) {
        plan = {
          id,
          summary: plan?.id === id ? plan.summary : entry.summary ?? id,
          mode: readString(details.toMode) ?? plan?.mode,
          status: "approved",
          workflowProfile: plan?.id === id ? plan.workflowProfile : undefined,
          riskClassification: plan?.id === id ? plan.riskClassification : undefined,
          proposedWorkItemCount: plan?.id === id ? plan.proposedWorkItemCount : undefined,
        };
      }
      continue;
    }

    if (entry.eventKind === "plan_analysis_reported") {
      const status = readString(details.status);
      if (status === "blocked" && plan) {
        plan = { ...plan, status: "analysis-blocked" };
      }
      continue;
    }

    if (
      entry.eventKind === "goal.created"
      || entry.eventKind === "goal.updated"
      || entry.eventKind === "goal.completed"
      || entry.eventKind === "goal.failed"
      || entry.eventKind === "goal.cancelled"
    ) {
      const rawGoal = isRecord(details.goal) ? details.goal : {};
      const id = readString(rawGoal.id);
      const objective = readString(rawGoal.objective) ?? entry.summary;
      const status = readString(rawGoal.status);
      const routePolicy = isRecord(rawGoal.routePolicy) ? rawGoal.routePolicy : {};
      const authorityEnvelope = isRecord(rawGoal.authorityEnvelope) ? rawGoal.authorityEnvelope : {};
      if (id && objective && status) {
        goal = {
          id,
          objective,
          status,
          planId: readString(rawGoal.planId),
          workflowProfile: readString(routePolicy.workflowProfile),
          authority: readString(authorityEnvelope.maximumAuthority),
          escalation: readString(authorityEnvelope.escalationPolicy),
          workItemCount: readStringArray(rawGoal.workItemIds).length,
        };
      }
      continue;
    }

    if (entry.eventKind === "work_items.materialized") {
      const rawMaterialization = isRecord(details.materialization) ? details.materialization : {};
      const id = readString(rawMaterialization.id);
      if (id) {
        materialization = {
          id,
          planId: readString(rawMaterialization.planId),
          goalRunId: readString(rawMaterialization.goalRunId),
          approvalId: readString(rawMaterialization.approvalId),
          workItemCount: readStringArray(rawMaterialization.workItemIds).length,
          createdCount: readStringArray(rawMaterialization.createdWorkItemIds).length,
          reusedCount: readStringArray(rawMaterialization.reusedWorkItemIds).length,
        };
      }
    }
  }

  return { plan, goal, materialization };
}

function MetricRow(props: { readonly label: string; readonly value?: string | number }) {
  if (props.value === undefined || props.value === "") return null;
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-t border-border/50 py-2">
      <span className="text-xs text-muted-foreground">{props.label}</span>
      <span className="min-w-0 truncate font-mono text-[11px] text-foreground">{props.value}</span>
    </div>
  );
}

export function WorkflowOverviewPanel(props: WorkflowOverviewPanelProps) {
  const { plan, goal, materialization } = latestWorkflowPreview(props.entries);
  const hasWorkflow = Boolean(plan || goal || materialization);

  if (!hasWorkflow) {
    return (
      <section aria-label="Workflow overview" className="grid h-full place-items-center bg-card px-6 text-center">
        <div className="max-w-sm">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">no workflow lifecycle yet</p>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Canonical plan, goal, and materialization events will appear here when governed workflow state is recorded.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Workflow overview" className="h-full min-h-0 overflow-y-auto bg-card">
      <div className="border-b border-border/60 px-5 py-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">workflow overview</p>
        <p className="mt-1 text-sm text-muted-foreground">Canonical plan, goal, and work-item lifecycle.</p>
      </div>
      <div className="divide-y divide-border/60">
        {plan ? (
          <article className="px-5 py-4">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Plan review</p>
                <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{plan.summary}</p>
              </div>
              <Badge variant="outline" className={cn("shrink-0", badgeTone(plan.status))}>
                {normalizeLabel(plan.status)}
              </Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {plan.workflowProfile ? <Badge variant="secondary" className="font-mono text-[10px]">{plan.workflowProfile}</Badge> : null}
              {plan.riskClassification ? <Badge variant="outline" className="font-mono text-[10px]">{plan.riskClassification} risk</Badge> : null}
              {plan.mode ? <Badge variant="outline" className="font-mono text-[10px]">{plan.mode}</Badge> : null}
            </div>
            <div className="mt-3">
              <MetricRow label="Plan" value={plan.id} />
              <MetricRow label="Work items" value={plan.proposedWorkItemCount} />
            </div>
          </article>
        ) : null}

        {goal ? (
          <article className="px-5 py-4">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Goal run</p>
                <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{goal.objective}</p>
              </div>
              <Badge variant="outline" className={cn("shrink-0", badgeTone(goal.status))}>
                {normalizeLabel(goal.status)}
              </Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {goal.workflowProfile ? <Badge variant="secondary" className="font-mono text-[10px]">{goal.workflowProfile}</Badge> : null}
              {goal.authority ? <Badge variant="outline" className="font-mono text-[10px]">{goal.authority} authority</Badge> : null}
              {goal.escalation ? <Badge variant="outline" className="font-mono text-[10px]">{normalizeLabel(goal.escalation)}</Badge> : null}
            </div>
            <div className="mt-3">
              <MetricRow label="Goal" value={goal.id} />
              <MetricRow label="Plan" value={goal.planId} />
              <MetricRow label="Work items" value={goal.workItemCount} />
            </div>
          </article>
        ) : null}

        {materialization ? (
          <article className="px-5 py-4">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Work items</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {materialization.createdCount} created, {materialization.reusedCount} reused.
                </p>
              </div>
              <Badge variant="outline" className="shrink-0 border-emerald-500/35 bg-emerald-500/10 text-emerald-300">
                {materialization.workItemCount} materialized
              </Badge>
            </div>
            <div className="mt-3">
              <MetricRow label="Materialization" value={materialization.id} />
              <MetricRow label="Goal" value={materialization.goalRunId} />
              <MetricRow label="Plan" value={materialization.planId} />
              <MetricRow label="Approval" value={materialization.approvalId} />
            </div>
          </article>
        ) : null}
      </div>
    </section>
  );
}
