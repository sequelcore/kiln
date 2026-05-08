import { useEffect, useMemo, useState } from "react";
import type { ApprovalRequest } from "../lib/session-store.js";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SidebarPanelShell } from "./sidebar-panel-shell.js";

interface ApprovalsPanelProps {
  readonly approvals: readonly ApprovalRequest[];
  readonly onApprove: (approvalId: string) => void;
  readonly onDeny: (approvalId: string) => void;
}

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatRequestedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return timeFormatter.format(date);
}

function approvalKey(entry: ApprovalRequest): string {
  return `${entry.requestedAt}:${entry.id}`;
}

export function ApprovalsPanel(props: ApprovalsPanelProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedApproval = useMemo(
    () => props.approvals.find((entry) => approvalKey(entry) === selectedKey) ?? props.approvals[0] ?? null,
    [props.approvals, selectedKey],
  );

  useEffect(() => {
    if (props.approvals.length === 0) {
      if (selectedKey !== null) {
        setSelectedKey(null);
      }
      return;
    }
    const stillExists = selectedKey ? props.approvals.some((entry) => approvalKey(entry) === selectedKey) : false;
    if (!stillExists) {
      setSelectedKey(approvalKey(props.approvals[0]!));
    }
  }, [props.approvals, selectedKey]);

  const approveSelected = () => {
    if (!selectedApproval) return;
    props.onApprove(selectedApproval.id);
  };

  const denySelected = () => {
    if (!selectedApproval) return;
    props.onDeny(selectedApproval.id);
  };

  return (
    <SidebarPanelShell title="Approvals" meta={`${props.approvals.length} pending`}>
      <div className="grid min-h-0 flex-1 lg:grid-rows-[minmax(0,1.1fr)_minmax(14rem,0.9fr)]">
        <div className="min-h-0 overflow-y-auto border-b border-border/60">
          {props.approvals.length === 0 ? (
            <div className="grid h-full place-items-center px-6 py-16 text-center">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">no cross-session approvals</p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  Current-turn approvals appear inline in the transcript and above the message composer.
                </p>
              </div>
            </div>
          ) : (
            <ul aria-label="Pending approvals" className="divide-y divide-border/60">
              {props.approvals.map((approval) => {
                const active = selectedApproval ? approvalKey(approval) === approvalKey(selectedApproval) : false;
                return (
                  <li key={approvalKey(approval)}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelectedKey(approvalKey(approval))}
                      className={cn(
                        "grid w-full grid-cols-[1.5rem_1fr] gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        active ? "bg-secondary/60" : "hover:bg-secondary/35",
                      )}
                    >
                      <span className="mt-0.5 inline-flex size-5 items-center justify-center rounded border border-border/80 font-mono text-[11px] text-muted-foreground">
                        <CheckCheck className="size-3.5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0">
                        <span className="min-w-0 truncate text-[13px] font-medium leading-5 text-foreground">
                          {approval.description}
                        </span>
                        <span className="mt-1 flex min-w-0 items-center gap-2 font-mono text-[10.5px] tracking-[0.01em] text-muted-foreground/75">
                          <span>{formatRequestedAt(approval.requestedAt)}</span>
                          <span className="text-muted-foreground/40">·</span>
                          <span className="truncate">{approval.sessionId}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto px-4 py-4">
          {selectedApproval ? (
            <section aria-label="Selected approval review" className="flex flex-col gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Review</p>
                <p className="mt-2 text-sm font-medium leading-6 text-foreground">{selectedApproval.description}</p>
              </div>

              <div className="grid gap-2">
                <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Session</p>
                  <p className="mt-1 text-sm leading-5 text-foreground">{selectedApproval.sessionId}</p>
                </div>
                <div className="rounded-md border border-border/60 bg-background px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Requested</p>
                  <p className="mt-1 text-sm leading-5 text-foreground">{formatRequestedAt(selectedApproval.requestedAt)}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" className="h-8" onClick={approveSelected}>
                  Approve
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-8" onClick={denySelected}>
                  Deny
                </Button>
              </div>
            </section>
          ) : (
            <div className="grid h-full place-items-center text-center">
              <p className="text-sm leading-6 text-muted-foreground">Select an approval request to review and decide.</p>
            </div>
          )}
        </div>
      </div>
    </SidebarPanelShell>
  );
}
