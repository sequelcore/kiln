import type {
  KilnConfigSetupAction,
  KilnConfigSetupSnapshot,
  KilnConfigSourceStatus,
  KilnProjectionTargetStatus,
  OperatorThemeName,
} from "@kilnai/gateway-contracts";
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  FileCode2,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { ThemeSwitcher } from "./theme-switcher.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface SetupPanelProps {
  readonly snapshot: KilnConfigSetupSnapshot | null | undefined;
  readonly loading: boolean;
  readonly refreshing?: boolean;
  readonly error: Error | null;
  readonly actionInFlight?: KilnConfigSetupAction | null;
  readonly actionFeedback?: string | null;
  readonly onRefresh: () => void;
  readonly onExecuteAction: (action: KilnConfigSetupAction) => void;
  readonly onThemeSelected?: (theme: OperatorThemeName) => void;
}

const ACTION_LABELS: Record<KilnConfigSetupAction, string> = {
  none: "Current",
  "adopt-project-context": "Adopt Project Context",
  "review-project-context": "Review Project Context",
  "sync-repo-shims": "Sync Repo Shims",
  "sync-native-projections": "Sync Native Projections",
  "review-and-force-sync-repo-shims": "Review Shim Drift",
  "adopt-or-back-up-native-guidance": "Review Native Guidance",
  "review-native-projection-drift": "Review Native Drift",
};

const ACTION_DESCRIPTIONS: Record<KilnConfigSetupAction, string> = {
  none: "All setup sources are aligned.",
  "adopt-project-context": "Create the canonical project-context document from deterministic repository evidence.",
  "review-project-context": "The project-context document exists but needs manual review before replacement.",
  "sync-repo-shims": "Regenerate AGENTS.md, CLAUDE.md, and workflow projection files from canonical Kiln context.",
  "sync-native-projections": "Refresh managed native harness projections from canonical Kiln config.",
  "review-and-force-sync-repo-shims": "Repo shims drifted from generated output; review before forcing replacement.",
  "adopt-or-back-up-native-guidance": "Native guidance is unmanaged; review before adopting or backing it up.",
  "review-native-projection-drift": "Native projection files drifted; review before overwriting managed fields.",
};

const REVIEW_ONLY_ACTIONS = new Set<KilnConfigSetupAction>([
  "review-project-context",
  "review-and-force-sync-repo-shims",
  "adopt-or-back-up-native-guidance",
  "review-native-projection-drift",
]);

const STATUS_TONE: Record<KilnConfigSourceStatus | KilnProjectionTargetStatus, "default" | "secondary" | "destructive" | "outline"> = {
  current: "default",
  valid: "default",
  managed: "default",
  missing: "secondary",
  stale: "secondary",
  unmanaged: "secondary",
  invalid: "destructive",
  drifted: "destructive",
};

export function SetupPanel(props: SetupPanelProps) {
  const summary = summarizeSetup(props.snapshot);
  const actionItems = setupActionItems(props.snapshot);

  return (
    <section aria-label="Setup" className="flex h-full min-h-0 min-w-0 flex-col bg-workspace-viewer">
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border/60 bg-workspace-viewer-panel px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <SetupStatusIcon issueCount={summary.actionCount} loading={props.loading} />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">Configuration Health</h2>
            <p className="truncate text-xs text-muted-foreground">
              {props.snapshot?.projectRoot ?? "Global config, project context, shims, native projections"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeSwitcher onThemeSelected={props.onThemeSelected} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Refresh Setup"
            disabled={props.refreshing || props.loading}
            onClick={props.onRefresh}
          >
            <RefreshCw data-icon="inline-start" className={props.refreshing ? "animate-spin" : undefined} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {props.loading ? <SetupLoading /> : null}
        {props.error ? <SetupError message={props.error.message} /> : null}
        {!props.loading && !props.error && props.snapshot ? (
          <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
            <section aria-label="Setup Summary" className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
              <Card className="rounded-lg">
                <CardHeader>
                  <CardTitle>{summary.title}</CardTitle>
                  <CardDescription>{summary.description}</CardDescription>
                  <CardAction>
                    <Badge variant={summary.actionCount === 0 ? "default" : "destructive"}>
                      {summary.badge}
                    </Badge>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <SetupHealthMetric label="Project Context" value={props.snapshot.projectContext.status} />
                    <SetupHealthMetric label="Repo Shims" value={statusSummary(props.snapshot.repoShims)} />
                    <SetupHealthMetric label="Native Projections" value={statusSummary(props.snapshot.nativeProjections)} />
                  </div>
                  {props.actionFeedback ? (
                    <p role="status" className="mt-3 rounded-md border border-border/70 bg-background/70 px-3 py-2 text-sm text-muted-foreground">
                      {props.actionFeedback}
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              <Card className="rounded-lg" size="sm">
                <CardHeader>
                  <CardTitle>Setup Sources</CardTitle>
                  <CardDescription>Canonical sources projected to every operator surface.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2">
                  <SetupSourceSummary label="Context" status={props.snapshot.projectContext.status} />
                  <SetupSourceSummary label="Repo Shims" status={statusSummary(props.snapshot.repoShims)} />
                  <SetupSourceSummary label="Native" status={statusSummary(props.snapshot.nativeProjections)} />
                </CardContent>
              </Card>
            </section>

            <section aria-label="Required Setup Actions">
              <Card className="rounded-lg">
                <CardHeader>
                  <CardTitle>Required Setup Actions</CardTitle>
                  <CardDescription>
                    Run safe setup actions here. Review-only actions stay blocked until the operator inspects the drift.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2">
                  {actionItems.length === 0 ? (
                    <div className="rounded-md border border-dashed border-border/70 bg-background/50 px-3 py-4 text-sm text-muted-foreground">
                      No setup actions are required.
                    </div>
                  ) : (
                    actionItems.map((action) => (
                      <SetupActionRow
                        key={action}
                        action={action}
                        busy={props.actionInFlight === action}
                        disabled={Boolean(props.actionInFlight)}
                        onExecute={props.onExecuteAction}
                      />
                    ))
                  )}
                </CardContent>
              </Card>
            </section>

            <section aria-label="Setup Details" className="grid gap-4 xl:grid-cols-3">
              <SetupDetailGroup
                title="Project Context"
                description="Canonical repo guidance used by generated harness instructions."
                items={[{
                  id: "project-context",
                  label: "Project Context",
                  path: props.snapshot.projectContext.path,
                  status: props.snapshot.projectContext.status,
                  recommendation: props.snapshot.projectContext.recommendation,
                }]}
              />
              <SetupDetailGroup
                title="Repo Shims"
                description="Generated guidance for Codex, Claude Code, and OpenCode."
                emptyLabel="No repo shims found."
                items={props.snapshot.repoShims.map((shim) => ({
                  id: shim.targetId,
                  label: shim.target,
                  path: shim.path,
                  status: shim.status,
                  recommendation: shim.recommendation,
                }))}
              />
              <SetupDetailGroup
                title="Native Projections"
                description="Native harness files managed from canonical Kiln config."
                emptyLabel="No native projections installed."
                items={props.snapshot.nativeProjections.map((projection) => ({
                  id: projection.targetId,
                  label: projection.targetId,
                  path: projection.path,
                  status: projection.status,
                  details: projection.details,
                }))}
              />
            </section>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function summarizeSetup(snapshot: KilnConfigSetupSnapshot | null | undefined) {
  const actionCount = setupActionItems(snapshot).length;
  if (!snapshot) {
    return {
      actionCount: 0,
      title: "Setup Status Unavailable",
      description: "Kiln setup status will appear when the gateway responds.",
      badge: "Waiting",
    };
  }
  if (actionCount === 0) {
    return {
      actionCount,
      title: "Configuration Is Current",
      description: "Global config, project context, repo shims, and native projections are aligned.",
      badge: "Current",
    };
  }
  return {
    actionCount,
    title: `${actionCount} Action${actionCount === 1 ? "" : "s"} Need Attention`,
    description: "Run the safe actions below first. Review-only drift actions stay blocked until inspected.",
    badge: `${actionCount} Action${actionCount === 1 ? "" : "s"}`,
  };
}

function setupActionItems(snapshot: KilnConfigSetupSnapshot | null | undefined): readonly KilnConfigSetupAction[] {
  const actions = snapshot?.recommendedActions.filter((action) => action !== "none") ?? [];
  return [...new Set(actions)];
}

function SetupStatusIcon(props: { readonly issueCount: number; readonly loading: boolean }) {
  if (props.loading) {
    return <RefreshCw className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />;
  }
  if (props.issueCount === 0) {
    return <CheckCircle2 className="size-4 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />;
  }
  return <AlertTriangle className="size-4 shrink-0 text-[var(--color-warning)]" aria-hidden="true" />;
}

function SetupLoading() {
  return (
    <div className="mx-auto grid max-w-6xl gap-4 p-4" aria-label="Loading setup status">
      <Skeleton className="h-36 rounded-lg" />
      <Skeleton className="h-56 rounded-lg" />
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-44 rounded-lg" />
        <Skeleton className="h-44 rounded-lg" />
        <Skeleton className="h-44 rounded-lg" />
      </div>
    </div>
  );
}

function SetupError(props: { readonly message: string }) {
  return (
    <div role="alert" className="m-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm text-foreground">
      <p className="font-medium">Setup Status Failed</p>
      <p className="mt-1 text-muted-foreground">{props.message}</p>
    </div>
  );
}

function SetupHealthMetric(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border/70 bg-background/60 px-3 py-2">
      <p className="truncate text-xs text-muted-foreground">{props.label}</p>
      <p className="mt-1 truncate font-mono text-sm text-foreground">{props.value}</p>
    </div>
  );
}

function SetupSourceSummary(props: { readonly label: string; readonly status: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border/60 bg-background/50 px-3 py-2">
      <span className="truncate text-sm text-muted-foreground">{props.label}</span>
      <Badge variant={badgeTone(props.status)}>{props.status}</Badge>
    </div>
  );
}

function SetupActionRow(props: {
  readonly action: KilnConfigSetupAction;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onExecute: (action: KilnConfigSetupAction) => void;
}) {
  const reviewOnly = REVIEW_ONLY_ACTIONS.has(props.action);
  return (
    <div className="grid gap-3 rounded-md border border-border/70 bg-background/60 px-3 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="flex min-w-0 gap-3">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md border border-border/70 bg-card text-muted-foreground" aria-hidden="true">
          {reviewOnly ? <ShieldCheck className="size-4" /> : <Wrench className="size-4" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{ACTION_LABELS[props.action]}</p>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{ACTION_DESCRIPTIONS[props.action]}</p>
        </div>
      </div>
      <Button
        type="button"
        variant={reviewOnly ? "outline" : "default"}
        size="sm"
        disabled={props.disabled || reviewOnly}
        onClick={() => props.onExecute(props.action)}
      >
        {props.busy ? <RefreshCw data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : null}
        {ACTION_LABELS[props.action]}
      </Button>
    </div>
  );
}

function SetupDetailGroup(props: {
  readonly title: string;
  readonly description: string;
  readonly emptyLabel?: string;
  readonly items: readonly {
    readonly id: string;
    readonly label: string;
    readonly path: string;
    readonly status: KilnConfigSourceStatus | KilnProjectionTargetStatus;
    readonly recommendation?: KilnConfigSetupAction;
    readonly details?: string;
  }[];
}) {
  return (
    <Card className="rounded-lg" size="sm">
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-0">
        {props.items.length === 0 ? (
          <div className="rounded-md border border-dashed border-border/70 bg-background/50 px-3 py-3 text-sm text-muted-foreground">
            {props.emptyLabel ?? "No records found."}
          </div>
        ) : (
          props.items.map((item, index) => (
            <SetupDetailRow key={item.id} item={item} first={index === 0} />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function SetupDetailRow(props: {
  readonly first: boolean;
  readonly item: {
    readonly label: string;
    readonly path: string;
    readonly status: KilnConfigSourceStatus | KilnProjectionTargetStatus;
    readonly recommendation?: KilnConfigSetupAction;
    readonly details?: string;
  };
}) {
  return (
    <div className={cn("grid gap-2 py-3", !props.first && "border-t border-border/60")}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="min-w-0 truncate text-sm font-medium text-foreground">{props.item.label}</p>
        </div>
        <Badge variant={STATUS_TONE[props.item.status]}>{props.item.status}</Badge>
      </div>
      <p className="min-w-0 break-all font-mono text-[11px] leading-5 text-muted-foreground">{props.item.path}</p>
      {props.item.details ? <p className="text-xs text-muted-foreground">{props.item.details}</p> : null}
      {props.item.recommendation && props.item.recommendation !== "none" ? (
        <p className="text-xs text-muted-foreground">{ACTION_LABELS[props.item.recommendation]}</p>
      ) : null}
      <Separator />
      <div>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => void copyText(props.item.path)}
        >
          <Clipboard data-icon="inline-start" aria-hidden="true" />
          Copy Path
        </Button>
      </div>
    </div>
  );
}

function statusSummary(
  items: readonly { readonly status: KilnConfigSourceStatus | KilnProjectionTargetStatus }[],
): string {
  if (items.length === 0) {
    return "none";
  }
  if (items.every((item) => item.status === "current" || item.status === "managed" || item.status === "valid")) {
    return "current";
  }
  const firstProblem = items.find((item) => item.status !== "current" && item.status !== "managed" && item.status !== "valid");
  return firstProblem?.status ?? "current";
}

function badgeTone(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "current" || status === "valid" || status === "managed") {
    return "default";
  }
  if (status === "drifted" || status === "invalid") {
    return "destructive";
  }
  return "secondary";
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard?.writeText(text);
}
