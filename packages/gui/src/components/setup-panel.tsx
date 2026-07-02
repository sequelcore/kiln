import type {
  KilnConfigSetupAction,
  KilnConfigSetupSnapshot,
  KilnConfigSourceStatus,
  KilnProjectionTargetStatus,
  OperatorThemeName,
  TrustedExecutionIntegrity,
} from "@kilnai/gateway-contracts";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { ThemeSwitcher } from "./theme-switcher.js";
import { SetupSourceInventory } from "./setup-source-inventory.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface SetupPanelProps {
  readonly snapshot: KilnConfigSetupSnapshot | null | undefined;
  readonly loading: boolean;
  readonly refreshing?: boolean;
  readonly error: Error | null;
  readonly actionInFlight?: KilnConfigSetupAction | null;
  readonly actionFeedback?: string | null;
  readonly onRefresh: () => void;
  readonly onExecuteAction: (action: KilnConfigSetupAction) => void;
  readonly onPreviewSource: (path: string) => void;
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

export function SetupPanel(props: SetupPanelProps) {
  const summary = summarizeSetup(props.snapshot);
  const actionItems = setupActionItems(props.snapshot);
  const repoShims = props.snapshot?.repoShims ?? [];
  const nativeProjections = props.snapshot?.nativeProjections ?? [];
  const permissionIntegrity = props.snapshot?.permissionIntegrity ?? [];

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
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-5 py-7 sm:px-8 sm:py-9">
            <section aria-label="Configuration Overview">
              <Card>
                <CardHeader>
                  <CardTitle><h3>{summary.title}</h3></CardTitle>
                  <CardDescription className="max-w-2xl text-pretty">{summary.description}</CardDescription>
                  <CardAction>
                    <Badge variant={summary.actionCount === 0 ? "outline" : "destructive"}>{summary.badge}</Badge>
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <dl className="grid divide-y divide-border/70 border-y border-border/70 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                    <SetupHealthFact label="Project Context" value={props.snapshot.projectContext.status} />
                    <SetupHealthFact label="Repo Shims" value={statusSummary(repoShims)} />
                    <SetupHealthFact label="Native Projections" value={statusSummary(nativeProjections)} />
                  </dl>
                </CardContent>
                <CardFooter className="justify-between gap-4 text-sm text-muted-foreground">
                  <span>{summary.actionCount === 0 ? "No configuration repair is required." : "Resolve required actions before trusting generated guidance."}</span>
                  <span className="shrink-0 tabular-nums">{repoShims.length + nativeProjections.length + 1} sources</span>
                </CardFooter>
              </Card>
            </section>

            <section aria-label="Required Setup Actions">
              <Card>
                <CardHeader>
                  <CardTitle><h3>Required Setup Actions</h3></CardTitle>
                  <CardDescription>Repair generated state here; inspect drift before any destructive replacement.</CardDescription>
                </CardHeader>
                <CardContent className="divide-y divide-border/70 p-0">
                  {actionItems.length === 0 ? (
                    <div className="flex items-center gap-3 px-4 py-5 text-sm text-muted-foreground">
                      <CheckCircle2 className="size-4 shrink-0 text-[var(--color-accent)]" aria-hidden="true" />
                      No setup actions are required.
                    </div>
                  ) : actionItems.map((action) => (
                    <SetupActionRow
                      key={action}
                      action={action}
                      busy={props.actionInFlight === action}
                      disabled={Boolean(props.actionInFlight)}
                      onExecute={props.onExecuteAction}
                    />
                  ))}
                </CardContent>
                {props.actionFeedback ? (
                  <CardFooter>
                    <p role="status" className="text-sm text-muted-foreground">{props.actionFeedback}</p>
                  </CardFooter>
                ) : null}
              </Card>
            </section>

            <PermissionIntegrityCard integrity={permissionIntegrity} />

            <SetupSourceInventory snapshot={props.snapshot} onPreviewSource={props.onPreviewSource} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function summarizeSetup(snapshot: KilnConfigSetupSnapshot | null | undefined) {
  const actionCount = setupActionItems(snapshot).length;
  const permissionIssueCount = permissionIntegrityIssues(snapshot?.permissionIntegrity ?? []).length;
  if (!snapshot) {
    return {
      actionCount: 0,
      title: "Setup Status Unavailable",
      description: "Kiln setup status will appear when the gateway responds.",
      badge: "Waiting",
    };
  }
  if (permissionIssueCount > 0 && actionCount === 0) {
    return {
      actionCount: permissionIssueCount,
      title: "Permission Integrity Needs Attention",
      description: "Setup files may be aligned, but trusted execution evidence is mismatched, stale, failed, or unproven.",
      badge: `${permissionIssueCount} Permission ${permissionIssueCount === 1 ? "Issue" : "Issues"}`,
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

function PermissionIntegrityCard(props: { readonly integrity: readonly TrustedExecutionIntegrity[] }) {
  if (props.integrity.length === 0) {
    return null;
  }
  return (
    <section aria-label="Permission Integrity">
      <Card>
        <CardHeader>
          <CardTitle><h3>Permission Integrity</h3></CardTitle>
          <CardDescription>Trusted execution evidence is reported from the shared config-status contract.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border/70 p-0">
          {props.integrity.map((integrity) => (
            <div key={integrity.harness} className="grid gap-2 px-4 py-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">{integrity.harness}</span>
                <Badge variant={integrity.classification === "current-verified" ? "outline" : "destructive"}>
                  {integrity.classification}
                </Badge>
                {integrity.remediationRequiresApproval ? <Badge variant="outline">approval required</Badge> : null}
              </div>
              <p className="text-muted-foreground">
                desired {integrity.desired.profile}; persisted {integrity.persistedNative?.profile ?? "-"}; effective {integrity.effectiveRuntime?.profile ?? "unproven"}
              </p>
              <p className="text-muted-foreground">
                enforcement {integrity.enforcement.strength}; source {integrity.effectiveRuntime?.source ?? "unavailable"}; verified {integrity.lastVerifiedAt ?? "unverified"}
              </p>
              <p className="text-foreground">{integrity.recommendation}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

function permissionIntegrityIssues(
  integrity: readonly TrustedExecutionIntegrity[],
): readonly TrustedExecutionIntegrity[] {
  return integrity.filter((entry) => entry.classification !== "current-verified");
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
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-5 py-7 sm:px-8 sm:py-9" aria-label="Loading setup status">
      <Skeleton className="h-28 rounded-md" />
      <Skeleton className="h-40 rounded-md" />
      <Skeleton className="h-52 rounded-md" />
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

function SetupHealthFact(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="min-w-0 px-3 py-3">
      <dt className="truncate text-xs text-muted-foreground">{props.label}</dt>
      <dd className="mt-1 truncate text-sm font-medium text-foreground">{props.value}</dd>
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
    <div className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="flex min-w-0 gap-3">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center text-muted-foreground" aria-hidden="true">
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
