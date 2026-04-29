import type { GuiDashboardSnapshot, GuiSessionMeta } from "@kilnai/gateway-contracts";
import { SidebarPanelShell } from "./sidebar-panel-shell.js";

interface WorkspacePanelProps {
  readonly domainLabel?: string;
  readonly gatewayWorkingDirectory?: string;
  readonly workspaceTree?: GuiDashboardSnapshot["workspaceTree"];
  readonly selectedSessionId: string | null;
  readonly sessionMeta: GuiSessionMeta | null;
  readonly activeProvider: string | null;
  readonly activeModel: string | null;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function SummaryRow(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] gap-3 border-b border-border/60 px-1 py-2 last:border-b-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{props.label}</p>
      <p className="min-w-0 break-words text-sm leading-5 text-foreground">{props.value}</p>
    </div>
  );
}

function PathBlock(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="border-b border-border/60 px-1 py-2 last:border-b-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{props.label}</p>
      <p className="mt-1 break-all font-mono text-[12px] leading-5 text-foreground">{normalizePath(props.value)}</p>
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
    <SidebarPanelShell title="Workspace" meta="metadata">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-4">
          <section aria-label="Workspace metadata" className="rounded-md border border-border/60 bg-background px-3 py-1">
            <SummaryRow label="Domain" value={props.domainLabel ?? "Unknown"} />
            <SummaryRow label="Session" value={sessionBinding} />
            <SummaryRow label="Route" value={activeRoute} />
            <SummaryRow label="Phase" value={sessionPhase} />
          </section>

          <section aria-label="Workspace paths" className="rounded-md border border-border/60 bg-background px-3 py-1">
            {workspaceRoot ? (
              <PathBlock label="Root" value={workspaceRoot} />
            ) : (
              <div className="border-b border-border/60 px-1 py-2 last:border-b-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Root</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">No working directory available.</p>
              </div>
            )}

            {worktreePath ? <PathBlock label="Worktree" value={worktreePath} /> : null}
          </section>

          <section aria-label="Workspace tree" className="rounded-md border border-border/60 bg-background px-3 py-3">
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Tree</p>
              {props.workspaceTree ? (
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">read-only</p>
              ) : null}
            </div>
            {props.workspaceTree ? (
              <>
                <p className="mt-2 break-all font-mono text-[11px] leading-5 text-muted-foreground">
                  root: {normalizePath(props.workspaceTree.rootPath)}
                </p>
                {props.workspaceTree.entries.length > 0 ? (
                  <ul className="mt-3 flex flex-col gap-1.5" aria-label="Workspace root entries">
                    {props.workspaceTree.entries.map((entry) => (
                      <li
                        key={entry.path}
                        className="rounded-md border border-border/60 bg-card/35 px-2.5 py-2"
                      >
                        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                          {entry.kind} · {entry.name}
                        </p>
                        <p className="mt-1 break-all font-mono text-[11px] leading-5 text-foreground">
                          {normalizePath(entry.path)}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">Workspace root is empty.</p>
                )}
                {props.workspaceTree.truncated ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Showing first {props.workspaceTree.entries.length} root entries.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">No workspace tree available.</p>
            )}
          </section>
        </div>
      </div>
    </SidebarPanelShell>
  );
}
