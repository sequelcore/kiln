import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { ApprovalRequest, ApprovalResponseFailure } from "../lib/session-store/index.js";
import type { ChatLayout } from "./chat-layout.js";
import { Button } from "@/components/ui/button";

interface ChatWorkbenchProps {
  readonly layout: ChatLayout;
  readonly surfaces: ReactNode;
  readonly composer: ReactNode;
  readonly pendingApprovals: readonly ApprovalRequest[];
  readonly approvalResponseFailure: ApprovalResponseFailure | null;
  readonly selectedSessionId: string | null;
  readonly onApprove: (approvalId: string) => void;
  readonly onDeny: (approvalId: string) => void;
  readonly onOpenApprovals: () => void;
}

function primaryApprovalForSession(
  approvals: readonly ApprovalRequest[],
  selectedSessionId: string | null,
): ApprovalRequest | null {
  if (selectedSessionId) {
    return approvals.find((approval) => approval.sessionId === selectedSessionId) ?? null;
  }
  return approvals.length === 1 ? approvals[0]! : null;
}

function ApprovalDock(props: {
  readonly approvals: readonly ApprovalRequest[];
  readonly failure: ApprovalResponseFailure | null;
  readonly selectedSessionId: string | null;
  readonly onApprove: (approvalId: string) => void;
  readonly onDeny: (approvalId: string) => void;
  readonly onOpenApprovals: () => void;
}) {
  const primaryApproval = primaryApprovalForSession(props.approvals, props.selectedSessionId);
  if (props.approvals.length === 0) {
    return null;
  }

  if (!primaryApproval) {
    return (
      <section aria-label="Pending approvals" className="border-t border-border/70 bg-card px-4 py-2">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <AlertTriangle className="size-4 shrink-0 text-[var(--color-warning)]" aria-hidden="true" />
          <p className="min-w-0 flex-1 truncate text-sm text-foreground">
            {props.approvals.length} approvals are waiting in other sessions.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={props.onOpenApprovals}>
            Review
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Approval required" className="border-t border-border/70 bg-card px-4 py-2">
      <div className="mx-auto grid max-w-3xl gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangle className="size-4 shrink-0 text-[var(--color-warning)]" aria-hidden="true" />
            <p className="truncate text-sm font-medium text-foreground">Approval required</p>
          </div>
          <p className="mt-1 max-h-10 overflow-hidden text-sm leading-5 text-muted-foreground">
            {primaryApproval.description}
          </p>
          {props.failure?.approvalId === primaryApproval.id ? (
            <p className="mt-1 text-xs text-error" role="alert">{props.failure.message}</p>
          ) : null}
          <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/80">{primaryApproval.sessionId}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={() => props.onApprove(primaryApproval.id)}>
            <CheckCircle2 data-icon="inline-start" aria-hidden="true" />
            Approve
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => props.onDeny(primaryApproval.id)}>
            Deny
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={props.onOpenApprovals}>
            Details
          </Button>
        </div>
      </div>
    </section>
  );
}

export function ChatWorkbench(props: ChatWorkbenchProps) {
  const landing = props.layout === "landing";
  return (
    <section
      aria-label="Chat workspace"
      className="kiln-operator-field flex h-full min-h-0 min-w-0 flex-col bg-workspace-viewer"
      data-layout="kiln-chat-workbench"
      data-chat-layout={props.layout}
    >
      {landing ? (
        <div
          className="flex min-h-0 min-w-[min(100%,38rem)] flex-1 flex-col justify-center overflow-y-auto py-6"
          data-layout="landing-composition"
        >
          <div className="h-24 min-h-20 shrink-0 overflow-hidden sm:h-28">{props.surfaces}</div>
          {props.composer}
        </div>
      ) : (
        <>
          <div className="min-h-0 min-w-[min(100%,38rem)] flex-1 overflow-hidden">{props.surfaces}</div>
          <ApprovalDock
            approvals={props.pendingApprovals}
            failure={props.approvalResponseFailure}
            selectedSessionId={props.selectedSessionId}
            onApprove={props.onApprove}
            onDeny={props.onDeny}
            onOpenApprovals={props.onOpenApprovals}
          />
          {props.composer}
        </>
      )}
    </section>
  );
}
