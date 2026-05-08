import type {
  KilnConfigSetupAction,
  KilnConfigSetupSnapshot,
  KilnConfigSourceStatus,
  KilnProjectionTargetStatus,
  OperatorThemeName,
} from "@kilnai/gateway-contracts";
import { AlertTriangle, CheckCircle2, FileCode2, RefreshCw, Settings2 } from "lucide-react";
import { ThemeSwitcher } from "./theme-switcher.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SetupPanelProps {
  readonly snapshot: KilnConfigSetupSnapshot | null | undefined;
  readonly loading: boolean;
  readonly refreshing?: boolean;
  readonly error: Error | null;
  readonly onRefresh: () => void;
  readonly onThemeSelected?: (theme: OperatorThemeName) => void;
}

const ACTION_LABELS: Record<KilnConfigSetupAction, string> = {
  none: "Current",
  "adopt-project-context": "Adopt context",
  "review-project-context": "Review context",
  "sync-repo-shims": "Sync repo shims",
  "sync-native-projections": "Sync native projections",
  "review-and-force-sync-repo-shims": "Review shim drift",
  "adopt-or-back-up-native-guidance": "Adopt native guidance",
  "review-native-projection-drift": "Review native drift",
};

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
  const activeActions = props.snapshot?.recommendedActions.filter((action) => action !== "none") ?? [];
  const summary = summarizeSetup(props.snapshot, activeActions.length);

  return (
    <section aria-label="Setup" className="flex h-full min-h-0 min-w-0 flex-col bg-workspace-viewer">
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border/60 bg-workspace-viewer-panel px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <SetupStatusIcon issueCount={summary.issueCount} loading={props.loading} />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {props.loading ? "Reading setup" : summary.title}
            </h2>
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
            size="icon-sm"
            aria-label="Refresh setup"
            disabled={props.refreshing || props.loading}
            onClick={props.onRefresh}
          >
            <RefreshCw className={props.refreshing ? "animate-spin" : undefined} aria-hidden="true" />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {props.loading ? <SetupLoading /> : null}
        {props.error ? (
          <div role="alert" className="m-4 border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-foreground">
            {props.error.message}
          </div>
        ) : null}
        {!props.loading && !props.error && props.snapshot ? (
          <div className="mx-auto flex max-w-5xl flex-col gap-5 p-4">
            <section aria-label="Setup actions" className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(16rem,20rem)]">
              <div className="border border-border/70 bg-card px-4 py-3">
                <p className="text-sm font-semibold text-foreground">{summary.headline}</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{summary.description}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(activeActions.length > 0 ? activeActions : (["none"] as const)).map((action) => (
                    <Badge key={action} variant={action === "none" ? "default" : "outline"}>
                      {ACTION_LABELS[action]}
                    </Badge>
                  ))}
                </div>
              </div>
              <dl className="grid border border-border/70 bg-card text-xs md:grid-cols-1">
                <SetupMetric label="Project context" value={props.snapshot.projectContext.status} />
                <SetupMetric label="Repo shims" value={String(props.snapshot.repoShims.length)} />
                <SetupMetric label="Native projections" value={String(props.snapshot.nativeProjections.length)} />
                <SetupMetric label="Actions" value={String(activeActions.length)} />
              </dl>
            </section>

            <section aria-label="Project context" className="border border-border/70 bg-card">
              <SetupGroupHeader
                title="Project context"
                description="Canonical repo guidance consumed by generated harness shims."
              />
              <SetupSourceRow
                label="Project context"
                path={props.snapshot.projectContext.path}
                status={props.snapshot.projectContext.status}
                recommendation={props.snapshot.projectContext.recommendation}
              />
            </section>

            <SetupProjectionGroup
              title="Repo shims"
              description="Generated instructions for Codex, Claude Code, and OpenCode."
              emptyLabel="No repo shims found."
              items={props.snapshot.repoShims.map((shim) => ({
                id: shim.targetId,
                label: shim.target,
                path: shim.path,
                status: shim.status,
                recommendation: shim.recommendation,
              }))}
            />

            <SetupProjectionGroup
              title="Native projections"
              description="Provider-native configuration files managed from canonical Kiln config."
              emptyLabel="No native projections installed."
              items={props.snapshot.nativeProjections.map((projection) => ({
                id: projection.targetId,
                label: projection.targetId,
                path: projection.path,
                status: projection.status,
                details: projection.details,
              }))}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function summarizeSetup(snapshot: KilnConfigSetupSnapshot | null | undefined, activeActionCount: number) {
  const repoShimIssues = snapshot?.repoShims.filter((shim) => shim.status !== "current").length ?? 0;
  const nativeProjectionIssues = snapshot?.nativeProjections.filter((projection) => {
    return projection.status !== "current" && projection.status !== "managed";
  }).length ?? 0;
  const projectContextIssue = snapshot && snapshot.projectContext.status !== "valid" ? 1 : 0;
  const issueCount = activeActionCount + repoShimIssues + nativeProjectionIssues + projectContextIssue;

  if (!snapshot) {
    return {
      issueCount: 0,
      title: "Setup",
      headline: "Setup status unavailable",
      description: "Kiln setup status will appear when the gateway responds.",
    };
  }

  if (issueCount === 0) {
    return {
      issueCount,
      title: "Setup current",
      headline: "Configuration is current",
      description: "Global config, project context, repo shims, and native projections are aligned.",
    };
  }

  return {
    issueCount,
    title: `${issueCount} setup issue${issueCount === 1 ? "" : "s"}`,
    headline: "Review setup before relying on native harness behavior",
    description: "At least one generated projection or canonical config source is missing, stale, unmanaged, or drifted.",
  };
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
    <div className="mx-auto flex max-w-5xl flex-col gap-3 p-4" aria-label="Loading setup status">
      <div className="h-20 animate-pulse border border-border/70 bg-card" />
      <div className="h-40 animate-pulse border border-border/70 bg-card" />
      <div className="h-40 animate-pulse border border-border/70 bg-card" />
    </div>
  );
}

function SetupMetric(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border/60 px-3 py-2.5 last:border-b-0">
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd className="font-mono text-foreground">{props.value}</dd>
    </div>
  );
}

function SetupGroupHeader(props: { readonly title: string; readonly description: string }) {
  return (
    <div className="grid gap-1 border-b border-border/70 px-4 py-3 md:grid-cols-[minmax(11rem,14rem)_minmax(0,1fr)] md:items-center">
      <div className="flex min-w-0 items-center gap-2">
        <Settings2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h3 className="truncate text-sm font-semibold text-foreground">{props.title}</h3>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">{props.description}</p>
    </div>
  );
}

function SetupSourceRow(props: {
  readonly label: string;
  readonly path: string;
  readonly status: KilnConfigSourceStatus | KilnProjectionTargetStatus;
  readonly recommendation?: KilnConfigSetupAction;
  readonly details?: string;
}) {
  return (
    <div
      aria-label={props.label}
      className="grid gap-2 border-b border-border/60 px-4 py-3 last:border-b-0 md:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)_auto] md:items-start"
    >
      <div className="flex min-w-0 items-center gap-2">
        <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="min-w-0 truncate text-sm font-medium text-foreground">{props.label}</p>
      </div>
      <div className="min-w-0">
        <p className="break-all font-mono text-[11px] leading-5 text-muted-foreground">{props.path}</p>
        {props.details ? <p className="mt-1 text-xs text-muted-foreground">{props.details}</p> : null}
        {props.recommendation && props.recommendation !== "none" ? (
          <p className="mt-1 text-xs text-muted-foreground">{ACTION_LABELS[props.recommendation]}</p>
        ) : null}
      </div>
      <Badge variant={STATUS_TONE[props.status]} className={cn("justify-self-start md:justify-self-end")}>
        {props.status}
      </Badge>
    </div>
  );
}

function SetupProjectionGroup(props: {
  readonly title: string;
  readonly description: string;
  readonly emptyLabel: string;
  readonly items: readonly {
    readonly id: string;
    readonly label: string;
    readonly path: string;
    readonly status: KilnProjectionTargetStatus;
    readonly recommendation?: KilnConfigSetupAction;
    readonly details?: string;
  }[];
}) {
  return (
    <section aria-label={props.title} className="border border-border/70 bg-card">
      <SetupGroupHeader title={props.title} description={props.description} />
      {props.items.length === 0 ? (
        <div className="px-4 py-3 text-sm text-muted-foreground">{props.emptyLabel}</div>
      ) : (
        props.items.map((item) => (
          <SetupSourceRow
            key={item.id}
            label={item.label}
            path={item.path}
            status={item.status}
            recommendation={item.recommendation}
            details={item.details}
          />
        ))
      )}
    </section>
  );
}
