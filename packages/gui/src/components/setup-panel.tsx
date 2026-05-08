import type {
  KilnConfigSetupAction,
  KilnConfigSetupSnapshot,
  KilnConfigSourceStatus,
  KilnProjectionTargetStatus,
} from "@kilnai/gateway-contracts";
import { AlertTriangle, CheckCircle2, FileCode2, RefreshCw, Settings2 } from "lucide-react";
import { SidebarPanelShell } from "./sidebar-panel-shell.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface SetupPanelProps {
  readonly snapshot: KilnConfigSetupSnapshot | null | undefined;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly onRefresh: () => void;
}

const ACTION_LABELS: Record<KilnConfigSetupAction, string> = {
  none: "Setup current",
  "adopt-project-context": "Adopt project context",
  "review-project-context": "Review project context",
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
  const meta = props.snapshot
    ? activeActions.length === 0 ? "ready" : `${activeActions.length} action${activeActions.length === 1 ? "" : "s"}`
    : "status";

  return (
    <SidebarPanelShell
      title="Setup"
      meta={meta}
      footer={(
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={props.onRefresh}>
          <RefreshCw data-icon="inline-start" aria-hidden="true" />
          Refresh setup
        </Button>
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        {props.loading ? <SetupLoading /> : null}
        {props.error ? (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground">
            {props.error.message}
          </div>
        ) : null}
        {!props.loading && !props.error && props.snapshot ? (
          <>
            <section aria-label="Setup actions" className="rounded-lg border border-border/70 bg-background/55 p-3">
              <div className="flex items-center gap-2">
                {activeActions.length === 0 ? (
                  <CheckCircle2 className="size-4 text-[var(--color-accent)]" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="size-4 text-[var(--color-warning)]" aria-hidden="true" />
                )}
                <p className="text-sm font-semibold text-foreground">
                  {activeActions.length === 0 ? "Configuration is current" : "Recommended actions"}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(activeActions.length > 0 ? activeActions : (["none"] as const)).map((action) => (
                  <Badge key={action} variant={action === "none" ? "default" : "outline"}>
                    {ACTION_LABELS[action]}
                  </Badge>
                ))}
              </div>
            </section>

            <SetupSourceRow
              label="Project context"
              path={props.snapshot.projectContext.path}
              status={props.snapshot.projectContext.status}
              recommendation={props.snapshot.projectContext.recommendation}
            />

            <SetupProjectionGroup
              title="Repo shims"
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
              emptyLabel="No native projections installed."
              items={props.snapshot.nativeProjections.map((projection) => ({
                id: projection.targetId,
                label: projection.targetId,
                path: projection.path,
                status: projection.status,
                details: projection.details,
              }))}
            />
          </>
        ) : null}
      </div>
    </SidebarPanelShell>
  );
}

function SetupLoading() {
  return (
    <div className="rounded-lg border border-border/70 bg-background/55 p-3 text-sm text-muted-foreground">
      Loading setup status...
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
    <section aria-label={props.label} className="rounded-lg border border-border/70 bg-background/55 p-3">
      <div className="flex min-w-0 items-center gap-2">
        <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{props.label}</p>
        <Badge variant={STATUS_TONE[props.status]}>{props.status}</Badge>
      </div>
      <p className="mt-2 break-all font-mono text-[11px] leading-4 text-muted-foreground">{props.path}</p>
      {props.details ? <p className="mt-2 text-xs text-muted-foreground">{props.details}</p> : null}
      {props.recommendation && props.recommendation !== "none" ? (
        <p className="mt-2 text-xs text-muted-foreground">{ACTION_LABELS[props.recommendation]}</p>
      ) : null}
    </section>
  );
}

function SetupProjectionGroup(props: {
  readonly title: string;
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
    <section aria-label={props.title} className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <Settings2 className="size-4 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-semibold text-foreground">{props.title}</p>
      </div>
      {props.items.length === 0 ? (
        <div className="rounded-lg border border-border/70 bg-background/55 p-3 text-sm text-muted-foreground">
          {props.emptyLabel}
        </div>
      ) : props.items.map((item) => (
        <SetupSourceRow
          key={item.id}
          label={item.label}
          path={item.path}
          status={item.status}
          recommendation={item.recommendation}
          details={item.details}
        />
      ))}
    </section>
  );
}
