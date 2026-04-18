import type { ApprovalRequest } from "../lib/session-store.js";

interface ApprovalQueueProps {
  readonly queue: readonly ApprovalRequest[];
  readonly onApprove: (sessionId: string) => void;
  readonly onDeny: (sessionId: string, reason?: string) => void;
}

export function ApprovalQueue(props: ApprovalQueueProps) {
  if (props.queue.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Approval queue"
      className="border-b border-[var(--color-warning)]/40 bg-[var(--color-warning)]/5 px-4 py-3"
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-warning)]">
        Approval required ({props.queue.length})
      </p>
      <ul className="space-y-2" role="list">
        {props.queue.map((request) => (
          <li
            key={request.id}
            className="flex flex-col gap-2 rounded-md border border-[var(--color-warning)]/30 bg-[var(--color-background-element)] p-3 sm:flex-row sm:items-start sm:justify-between"
          >
            <p className="flex-1 text-sm text-[var(--color-text)]">{request.description}</p>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                aria-label={`Approve: ${request.description}`}
                onClick={() => props.onApprove(request.sessionId)}
                className="rounded border border-[var(--color-success)]/60 bg-[var(--color-success)]/10 px-3 py-1 text-xs text-[var(--color-success)] hover:bg-[var(--color-success)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-success)]"
              >
                Approve
              </button>
              <button
                type="button"
                aria-label={`Deny: ${request.description}`}
                onClick={() => props.onDeny(request.sessionId)}
                className="rounded border border-[var(--color-error)]/60 bg-[var(--color-error)]/10 px-3 py-1 text-xs text-[var(--color-error)] hover:bg-[var(--color-error)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-error)]"
              >
                Deny
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
