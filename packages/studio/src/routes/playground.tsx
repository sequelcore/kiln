import { useState, useRef, useEffect, type ReactNode, type FormEvent } from "react";
import { useKilnWsChat, useKilnEvents, useKilnContext } from "@kilnai/react";

interface ApprovalRequest {
  approvalId: string;
  sessionId: string;
  description: string;
}

interface PhaseState {
  phase: string | number;
  phaseName: string;
  phaseDescription: string;
}

function ApprovalCard({
  request,
  onResolved,
}: {
  request: ApprovalRequest;
  onResolved: () => void;
}): ReactNode {
  const { client } = useKilnContext();
  const [rejectMode, setRejectMode] = useState(false);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleApprove = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await client.post("/dev/approve", { approvalId: request.approvalId });
      onResolved();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Approve failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async (ev: FormEvent) => {
    ev.preventDefault();
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await client.post("/dev/reject", { approvalId: request.approvalId, reason: reason.trim() || undefined });
      onResolved();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Reject failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        alignSelf: "flex-start",
        maxWidth: "80%",
        padding: "12px 16px",
        borderRadius: 12,
        background: "var(--bg-tertiary)",
        border: "1px solid var(--warning)",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
          color: "var(--warning)",
          fontWeight: 600,
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        <span>&#9888;</span> Approval Required
      </div>
      <div style={{ color: "var(--text-primary)", marginBottom: 12 }}>
        {request.description}
      </div>
      {!rejectMode ? (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn btn-primary"
            onClick={() => void handleApprove()}
            disabled={isSubmitting}
            style={{ fontSize: 12, padding: "4px 12px" }}
          >
            {isSubmitting ? "..." : "Approve"}
          </button>
          <button
            className="btn"
            onClick={() => setRejectMode(true)}
            disabled={isSubmitting}
            style={{ fontSize: 12, padding: "4px 12px" }}
          >
            Reject
          </button>
        </div>
      ) : (
        <form onSubmit={(ev) => void handleReject(ev)} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            disabled={isSubmitting}
            autoFocus
            style={{ fontSize: 12 }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn"
              type="submit"
              disabled={isSubmitting}
              style={{ fontSize: 12, padding: "4px 12px", borderColor: "var(--error)", color: "var(--error)" }}
            >
              {isSubmitting ? "..." : "Confirm Reject"}
            </button>
            <button
              className="btn"
              type="button"
              onClick={() => setRejectMode(false)}
              disabled={isSubmitting}
              style={{ fontSize: 12, padding: "4px 12px" }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {submitError && (
        <div style={{ color: "var(--error)", fontSize: 11, marginTop: 6 }}>{submitError}</div>
      )}
    </div>
  );
}

export function PlaygroundView(): ReactNode {
  const { messages, send, isLoading, error, clearMessages } = useKilnWsChat();
  const { events } = useKilnEvents();
  const [input, setInput] = useState("");
  const [resolvedApprovals, setResolvedApprovals] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, events]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    void send(input.trim());
    setInput("");
  };

  const currentPhase = events.reduce<PhaseState | null>((acc, ev) => {
    if (ev.type !== "phase_changed") return acc;
    return {
      phase: ev.data.phase as string | number,
      phaseName: ev.data.phaseName as string,
      phaseDescription: (ev.data.phaseDescription as string) ?? "",
    };
  }, null);

  const receivedApprovalIds = new Set(
    events
      .filter((ev) => ev.type === "approval_received")
      .map((ev) => ev.data.approvalId as string),
  );

  const pendingApprovals = events.flatMap((ev) => {
    if (ev.type !== "approval_requested") return [];
    const approvalId = typeof ev.data.approvalId === "string" ? ev.data.approvalId : "";
    if (!approvalId || receivedApprovalIds.has(approvalId) || resolvedApprovals.has(approvalId)) return [];
    return [{
      approvalId,
      sessionId: typeof ev.data.sessionId === "string" ? ev.data.sessionId : "",
      description: typeof ev.data.description === "string" ? ev.data.description : "Approval required",
    }];
  });

  const toolEvents = events.filter(
    (e) => e.type === "tool_called" || e.type === "tool_result",
  );

  return (
    <div style={{ display: "flex", height: "calc(100vh - 48px)", gap: 16 }}>
      <div className="card flex-col" style={{ flex: 1 }}>
        <div className="flex justify-between items-center mb-16">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="card-header" style={{ marginBottom: 0 }}>Playground</div>
            {currentPhase && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "3px 10px",
                  borderRadius: "var(--radius-sm)",
                  background: "rgba(74, 158, 255, 0.1)",
                  border: "1px solid rgba(74, 158, 255, 0.25)",
                  fontSize: 11,
                }}
              >
                <span style={{ color: "var(--text-muted)" }}>Phase:</span>
                <span style={{ color: "var(--accent)", fontWeight: 600 }}>
                  {currentPhase.phaseName}
                </span>
                {currentPhase.phaseDescription && (
                  <span style={{ color: "var(--text-muted)" }} title={currentPhase.phaseDescription}>
                    &mdash; {currentPhase.phaseDescription}
                  </span>
                )}
              </div>
            )}
          </div>
          <button className="btn" onClick={clearMessages}>Clear</button>
        </div>

        <div
          style={{
            flex: 1,
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: "8px 0",
          }}
        >
          {messages.length === 0 && pendingApprovals.length === 0 && (
            <div className="empty-state">Send a message to get started</div>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "80%",
                padding: "10px 14px",
                borderRadius: 12,
                background: msg.role === "user" ? "var(--accent)" : "var(--bg-tertiary)",
                color: msg.role === "user" ? "#fff" : "var(--text-primary)",
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
              }}
            >
              {msg.content}
            </div>
          ))}
          {pendingApprovals.map((req) => (
            <ApprovalCard
              key={req.approvalId}
              request={req}
              onResolved={() =>
                setResolvedApprovals((prev) => new Set([...prev, req.approvalId]))
              }
            />
          ))}
          {isLoading && (
            <div style={{ color: "var(--text-muted)", fontSize: 13, fontStyle: "italic" }}>
              Thinking...
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {error && (
          <div style={{ color: "var(--error)", fontSize: 12, marginBottom: 8 }}>
            {error.message}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8 }}>
          <input
            className="input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Send a message..."
            disabled={isLoading}
          />
          <button className="btn btn-primary" type="submit" disabled={isLoading}>
            Send
          </button>
        </form>
      </div>

      <div className="card" style={{ width: 300, overflow: "auto" }}>
        <div className="card-header">Tool Calls</div>
        {toolEvents.length === 0 && (
          <div className="text-muted" style={{ fontSize: 12 }}>No tool calls yet</div>
        )}
        {toolEvents.map((event, i) => (
          <div key={i} style={{ marginBottom: 8, padding: 8, background: "var(--bg-tertiary)", borderRadius: 4, fontSize: 12 }}>
            <div className="mono" style={{ color: event.type === "tool_called" ? "var(--accent)" : "var(--success)" }}>
              {event.type}
            </div>
            <pre className="mono text-secondary" style={{ fontSize: 11, marginTop: 4, overflow: "auto", maxHeight: 100 }}>
              {JSON.stringify(event.data, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
