import type { GuiSessionMeta } from "@kilnai/gateway-contracts";
import { Button } from "@/components/ui/button";

interface WorkspacePanelProps {
  readonly domainLabel?: string;
  readonly gatewayWorkingDirectory?: string;
  readonly selectedSessionId: string | null;
  readonly sessionMeta: GuiSessionMeta | null;
  readonly activeProvider: string | null;
  readonly activeModel: string | null;
  readonly onStartNewSession: () => void;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function SummaryRow(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{props.label}</p>
      <p className="mt-1 text-sm leading-5 text-foreground">{props.value}</p>
    </div>
  );
}

function PathBlock(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{props.label}</p>
      <p className="mt-2 break-all font-mono text-[12px] leading-5 text-foreground">{normalizePath(props.value)}</p>
    </div>
  );
}

export function WorkspacePanel(props: WorkspacePanelProps) {
  const sessionLedger = props.sessionMeta?.sessionLedger;
  const workspaceRoot = sessionLedger?.workingDirectory ?? props.gatewayWorkingDirectory;
  const worktreePath = sessionLedger?.worktreePath;
  const sessionPhase = sessionLedger?.currentPhase ?? "idle";
  const activeRoute = [props.activeProvider, props.activeModel].filter(Boolean).join(" / ") || "Not selected";
  const sessionBinding = props.selectedSessionId ?? "No active session selected";

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-border/70 bg-card">
      <header className="flex items-center gap-2 border-b border-border/70 px-3.5 py-3">
        <p className="text-sm font-semibold tracking-tight text-foreground">Workspace</p>
        <p className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          metadata
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-3">
          <SummaryRow label="Domain" value={props.domainLabel ?? "Unknown"} />
          <SummaryRow label="Session" value={sessionBinding} />
          <SummaryRow label="Route" value={activeRoute} />
          <SummaryRow label="Session phase" value={sessionPhase} />

          {workspaceRoot ? (
            <PathBlock label="Workspace root" value={workspaceRoot} />
          ) : (
            <div className="rounded-md border border-dashed border-border/70 bg-background px-3 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Workspace root</p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Gateway did not provide a working directory for this session.
              </p>
            </div>
          )}

          {worktreePath ? (
            <PathBlock label="Worktree path" value={worktreePath} />
          ) : null}

          <div className="rounded-md border border-dashed border-border/70 bg-background px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Tree status</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              File-tree browsing is intentionally gated until the gateway exposes a canonical workspace-tree contract.
            </p>
          </div>
        </div>
      </div>

      <footer className="border-t border-border/70 p-2.5">
        <Button
          type="button"
          variant="outline"
          aria-label="New Session"
          onClick={props.onStartNewSession}
          className="h-9 w-full justify-start border-border/80 bg-transparent font-medium hover:bg-secondary/50"
        >
          <span aria-hidden="true" className="text-base leading-none">+</span>
          New Session
        </Button>
      </footer>
    </aside>
  );
}
